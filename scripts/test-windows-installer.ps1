# Run on a clean, elevated Windows release runner.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$setup = Join-Path $root 'release-artifacts/talktome-setup.exe'
$legacy = Join-Path $root 'release-artifacts/legacy-server.exe'
$server = Join-Path $env:LOCALAPPDATA 'Talktome Server Upgrade Test'
$bridge = Join-Path $env:ProgramFiles 'Talktome Bridge'
$personalData = Join-Path $env:LOCALAPPDATA 'talktome'
$sharedData = Join-Path $env:ProgramData 'Talktome Server'
$registry = 'Software\Microsoft\Windows\CurrentVersion\Uninstall'
$env:TALKTOME_INSTALLER_TEST_LOG = Join-Path $env:RUNNER_TEMP 'talktome-installer-test.log'

function Invoke-Setup([string] $Installer, [string] $Arguments) {
    $process = Start-Process -FilePath $Installer -ArgumentList $Arguments -Wait -PassThru
    if ($process.ExitCode -ne 0) {
        if (Test-Path -LiteralPath $env:TALKTOME_INSTALLER_TEST_LOG) {
            Get-Content -LiteralPath $env:TALKTOME_INSTALLER_TEST_LOG
        }
        throw "Setup failed ($($process.ExitCode)): $Installer $Arguments"
    }
}

function Assert-Installed([string] $Key, [string] $Directory, [string] $Executable) {
    $actual = (Get-ItemProperty -LiteralPath $Key -Name InstallLocation).InstallLocation.Trim('"')
    if ($actual -ne $Directory -or -not (Test-Path -LiteralPath (Join-Path $Directory $Executable) -PathType Leaf)) {
        throw "Expected $Executable in $Directory, registered at $Key."
    }
}

foreach ($path in $server, $bridge, $personalData, $sharedData) {
    if (Test-Path -LiteralPath $path) { throw "Windows installer test requires a clean runner: $path exists." }
}

# Bridge-only setup must work without a Server installation.
Invoke-Setup $setup '/S /COMPONENTS=bridge /SCOPE=machine'
Assert-Installed "HKLM:\$registry\Talktome Bridge" $bridge 'talktome-bridge-client.exe'
if (Test-Path -LiteralPath $server) { throw 'Bridge-only setup installed a Server.' }

# The legacy per-user Server and the new system-wide Bridge upgrade together,
# each retaining its original installation scope.
Invoke-Setup $legacy "/S /D=$server"
New-Item -ItemType Directory -Path $personalData | Out-Null
Set-Content -LiteralPath (Join-Path $personalData 'upgrade-fixture.txt') -Value 'existing server data'
Invoke-Setup $setup '/S /COMPONENTS=both /SCOPE=machine'
Assert-Installed "HKCU:\$registry\Talktome Server" $server 'talktome-server-app.exe'
Assert-Installed "HKLM:\$registry\Talktome Bridge" $bridge 'talktome-bridge-client.exe'
if (Test-Path -LiteralPath $sharedData) { throw 'An in-place update unexpectedly moved server data.' }

# Silent setup with no component arguments preselects the existing components.
Invoke-Setup $setup '/S /SERVERDATA=shared'
if (-not (Test-Path -LiteralPath (Join-Path $server 'server-data.shared') -PathType Leaf)) { throw 'Shared data mode was not saved.' }
$expected = Get-Content -LiteralPath (Join-Path $personalData 'upgrade-fixture.txt')
$actual = Get-Content -LiteralPath (Join-Path $sharedData 'upgrade-fixture.txt')
if ($actual -ne $expected) { throw 'Migration did not preserve the original data.' }
Invoke-Setup $setup '/S'
if (-not (Test-Path -LiteralPath (Join-Path $server 'server-data.shared') -PathType Leaf)) { throw 'Upgrade reset the shared data mode.' }
"TRAY_EXECUTABLE=$(Join-Path $server 'talktome-server-app.exe')" | Out-File -FilePath $env:GITHUB_ENV -Append
