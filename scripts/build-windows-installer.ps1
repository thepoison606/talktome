$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$artifacts = Join-Path $root 'release-artifacts'
$overlay = Join-Path $PSScriptRoot 'windows-component-installer.json'
New-Item -ItemType Directory -Path $artifacts -Force | Out-Null

function Get-TauriInstaller([string] $App) {
    $files = @(Get-ChildItem -Path (Join-Path $root "$App/src-tauri/target/release/bundle/nsis") -Filter '*.exe')
    if ($files.Count -ne 1) { throw "Expected one NSIS installer for $App, found $($files.Count)." }
    $files[0].FullName
}

Copy-Item (Get-TauriInstaller 'server-app') (Join-Path $artifacts 'legacy-server.exe')
foreach ($app in 'server-app', 'bridge-client') {
    Push-Location (Join-Path $root $app)
    try {
        & npm exec tauri bundle -- --bundles nsis --config tauri.release-version.json --config $overlay
        if ($LASTEXITCODE -ne 0) { throw "NSIS payload build failed for $app." }
    } finally {
        Pop-Location
    }
}

$compiler = Get-Command makensis.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
if (-not $compiler) {
    $compiler = Join-Path $env:LOCALAPPDATA 'tauri/NSIS/makensis.exe'
}
if (-not (Test-Path -LiteralPath $compiler -PathType Leaf)) { throw 'Could not find the NSIS compiler.' }

$output = Join-Path $artifacts 'talktome-setup.exe'
$server = Get-TauriInstaller 'server-app'
$bridge = Get-TauriInstaller 'bridge-client'
& $compiler "/DOUT_FILE=$output" "/DSERVER_INSTALLER=$server" "/DBRIDGE_INSTALLER=$bridge" (Join-Path $PSScriptRoot 'talktome-windows-installer.nsi')
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $output -PathType Leaf)) { throw 'Combined NSIS installer build failed.' }
