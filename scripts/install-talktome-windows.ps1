param(
    [Parameter(Mandatory)][ValidateSet('yes', 'no')][string] $Server,
    [Parameter(Mandatory)][ValidateSet('yes', 'no')][string] $Bridge,
    [Parameter(Mandatory)][ValidateSet('user', 'machine')][string] $Scope,
    [Parameter(Mandatory)][ValidateSet('personal', 'shared')][string] $ServerData
)

$ErrorActionPreference = 'Stop'
$uninstallKey = 'Software\Microsoft\Windows\CurrentVersion\Uninstall'
$sharedMarker = 'server-data.shared'
if ($env:TALKTOME_INSTALLER_TEST_LOG) {
    Start-Transcript -LiteralPath $env:TALKTOME_INSTALLER_TEST_LOG -Append | Out-Null
}

function Get-Installation([string] $Name, [string] $Hive, [string] $Prefix = '') {
    foreach ($view in 'Registry64', 'Registry32') {
        $root = [Microsoft.Win32.RegistryKey]::OpenBaseKey($Hive, $view)
        try {
            $entry = $root.OpenSubKey("$Prefix$uninstallKey\$Name")
            if ($entry) {
                try {
                    $directory = ([string] $entry.GetValue('InstallLocation')).Trim('"')
                    if ($directory -and (Test-Path -LiteralPath $directory -PathType Container)) {
                        return @{
                            Hive = $Hive
                            View = $view
                            Directory = $directory
                            Binary = $entry.GetValue('MainBinaryName')
                        }
                    }
                } finally {
                    $entry.Dispose()
                }
            }
        } finally {
            $root.Dispose()
        }
    }
}

function Get-Component([string] $Name, [string] $Installer, [string] $Executable) {
    $userInstall = Get-Installation $Name CurrentUser
    $machineInstall = Get-Installation $Name LocalMachine
    if ($userInstall -and $machineInstall) {
        throw "$Name is registered both for this account and for all users. Resolve the duplicate before updating."
    }

    $existing = if ($userInstall) { $userInstall } else { $machineInstall }
    $allUsers = if ($existing) { $existing.Hive -eq 'LocalMachine' } else { $Scope -eq 'machine' }
    $directory = if ($existing) { $existing.Directory }
        elseif ($allUsers) { Join-Path $env:ProgramFiles $Name }
        else { Join-Path $env:LOCALAPPDATA $Name }
    if (-not [IO.Path]::IsPathRooted($directory) -or $directory.Contains('"')) {
        throw "Invalid installation directory for $Name."
    }
    if ($allUsers -and $directory -notmatch '^[A-Za-z]:\\') {
        throw "$Name must have a local installation directory."
    }

    return @{
        Name = $Name
        Installer = Join-Path $PSScriptRoot $Installer
        Executable = $Executable
        Existing = $existing
        AllUsers = $allUsers
        Directory = $directory
    }
}

function Get-DesktopAccount {
    # Over-the-shoulder elevation changes HKCU and Local AppData. Avoid operating
    # on an administrator's personal installation instead of the desktop user's.
    $session = (Get-Process -Id $PID).SessionId
    foreach ($shell in Get-CimInstance Win32_Process -Filter "Name='explorer.exe' AND SessionId=$session") {
        $owner = Invoke-CimMethod -InputObject $shell -MethodName GetOwnerSid
        if ($owner.ReturnValue -eq 0) { return $owner.Sid }
    }
}

function Assert-AccountScope($Component, [string] $DesktopSid, [string] $SetupSid, [bool] $NeedsPersonalData = $false) {
    if ($DesktopSid -and $DesktopSid -ne $SetupSid) {
        $desktopInstall = Get-Installation $Component.Name Users "$DesktopSid\"
        if ($desktopInstall -or -not $Component.AllUsers -or $NeedsPersonalData) {
            throw 'Run setup from the Windows account that owns the personal installation or server data. Setup was elevated with a different account.'
        }
    }
}

function Assert-ProgramsStopped([string[]] $Names) {
    if (Get-Process -Name $Names -ErrorAction SilentlyContinue) {
        Write-Host 'Quit the selected Talktome apps from their tray menus. If the server runs independently, stop it first.'
        exit 2
    }
}

function Install-Component($Component) {
    Write-Host "Installing $($Component.Name) into $($Component.Directory)"
    $mode = if ($Component.AllUsers) { '/AllUsers' } else { '/CurrentUser' }
    $update = if ($Component.Existing.Binary) { ' /UPDATE' } else { '' }
    $previousDirectory = $env:TALKTOME_SETUP_INSTALL_DIR
    $env:TALKTOME_SETUP_INSTALL_DIR = $Component.Directory
    try {
        $process = Start-Process -FilePath $Component.Installer -ArgumentList "/S $mode$update" -Wait -PassThru
    } finally {
        $env:TALKTOME_SETUP_INSTALL_DIR = $previousDirectory
    }
    if ($process.ExitCode -ne 0) {
        throw "$($Component.Name) setup failed (exit code $($process.ExitCode))."
    }
    $hive = if ($Component.AllUsers) { 'LocalMachine' } else { 'CurrentUser' }
    $installed = Get-Installation $Component.Name $hive
    if (-not $installed -or $installed.Directory -ne $Component.Directory -or
        -not (Test-Path -LiteralPath (Join-Path $Component.Directory $Component.Executable) -PathType Leaf)) {
        throw "$($Component.Name) was not registered at the expected installation path."
    }

    # The original standalone server installer wrote a 32-bit uninstall entry.
    # If Tauri replaced it with a 64-bit entry, remove only the superseded entry.
    if ($Component.Existing -and $Component.Existing.View -ne $installed.View) {
        $previous = $Component.Existing
        $root = [Microsoft.Win32.RegistryKey]::OpenBaseKey($previous.Hive, $previous.View)
        try { $root.DeleteSubKeyTree("$uninstallKey\$($Component.Name)", $false) }
        finally { $root.Dispose() }
    }

    if ($Component.Name -eq 'Talktome Server' -and $Component.Existing -and -not $Component.Existing.Binary) {
        $oldBinary = Join-Path $Component.Directory 'talktome_win64.exe'
        if (Test-Path -LiteralPath $oldBinary -PathType Leaf) {
            # Keep the old standalone binary recoverable without leaving a runnable
            # server behind its old shortcuts.
            Move-Item -LiteralPath $oldBinary -Destination "$oldBinary.previous"
        }
        if ($Component.AllUsers) {
            $programs = [Environment]::GetFolderPath('CommonPrograms')
            Remove-Item -LiteralPath (Join-Path $programs 'Talktome\Talktome Server.lnk') -ErrorAction SilentlyContinue
        }
    }
}

function Assert-NoLinks([string] $Directory) {
    $pending = [Collections.Generic.Stack[string]]::new()
    $pending.Push($Directory)
    while ($pending.Count -gt 0) {
        $path = $pending.Pop()
        $item = Get-Item -LiteralPath $path -Force
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw 'Server data contains a junction or symbolic link. Migrate this data manually.'
        }
        if ($item.PSIsContainer) {
            foreach ($child in Get-ChildItem -LiteralPath $path -Force) {
                $pending.Push($child.FullName)
            }
        }
    }
}

function Initialize-SharedData([string] $Destination, [Security.Principal.SecurityIdentifier] $Owner) {
    $source = Join-Path $env:LOCALAPPDATA 'talktome'
    if (Test-Path -LiteralPath $Destination) {
        throw 'The ProgramData folder already exists. Setup cannot overwrite or merge it. Keep the personal data mode or resolve the shared folder first.'
    }
    $hasSourceData = Test-Path -LiteralPath $source -PathType Container
    if ($hasSourceData) { Assert-NoLinks $source }

    # Stage the copy under ProgramData with a private ACL. Publish the completed
    # directory with a rename so a failed migration leaves the source untouched.
    $stage = Join-Path (Split-Path -Parent $Destination) ("Talktome-Setup-" + [guid]::NewGuid())
    New-Item -ItemType Directory -Path $stage | Out-Null
    try {
        $acl = New-Object Security.AccessControl.DirectorySecurity
        $acl.SetAccessRuleProtection($true, $false)
        foreach ($id in 'S-1-5-18', 'S-1-5-32-544') {
            $rule = New-Object Security.AccessControl.FileSystemAccessRule(
                [Security.Principal.SecurityIdentifier] $id, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
            $acl.AddAccessRule($rule)
        }
        Set-Acl -LiteralPath $stage -AclObject $acl

        if ($hasSourceData) {
            Write-Host "Copying the personal server data into ProgramData. The source will be retained."
            # Exclude junctions and copy symbolic links as links, never follow
            # them with elevated permissions. Reject copied links before granting access.
            & "$env:WINDIR\System32\robocopy.exe" $source $stage /E /XJ /SL /COPY:DAT /DCOPY:DAT /R:0 /W:0 /NFL /NDL /NJH /NJS /NP
            if ($LASTEXITCODE -ge 8) { throw "Server data copy failed (robocopy $LASTEXITCODE)." }
            Assert-NoLinks $stage
        }
        New-Item -ItemType File -Path (Join-Path $stage '.talktome-shared') | Out-Null
        # Only the setup account, SYSTEM and Administrators can access the data
        # by default. Administrators can grant other operators access explicitly.
        $rule = New-Object Security.AccessControl.FileSystemAccessRule(
            $Owner, 'Modify', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        $acl.AddAccessRule($rule)
        Set-Acl -LiteralPath $stage -AclObject $acl
        [IO.Directory]::Move($stage, $Destination)
    } finally {
        if (Test-Path -LiteralPath $stage) {
            [IO.Directory]::Delete($stage, $true)
        }
    }
}

try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $desktopSid = Get-DesktopAccount
    if ($Server -eq 'yes') {
        $serverComponent = Get-Component 'Talktome Server' 'server.exe' 'talktome-server-app.exe'
        $marker = Join-Path $serverComponent.Directory $sharedMarker
        $alreadyShared = Test-Path -LiteralPath $marker -PathType Leaf
        $useShared = $alreadyShared -or $ServerData -eq 'shared'
        Assert-AccountScope $serverComponent $desktopSid $identity.User.Value ($useShared -and -not $alreadyShared)
        if ($useShared -and -not $alreadyShared) {
            $sharedDirectory = Join-Path $env:ProgramData 'Talktome Server'
            if ($env:TALKTOME_DATA_DIR) {
                throw 'A custom TALKTOME_DATA_DIR is configured. Migrate that directory manually before enabling the shared data mode.'
            }
            if (Test-Path -LiteralPath $sharedDirectory) {
                throw 'The ProgramData folder already exists. Setup cannot overwrite or merge it.'
            }
        }
        Assert-ProgramsStopped @('Talktome Server', 'talktome-server-app', 'talktome-server', 'talktome-server-x86_64-pc-windows-msvc', 'talktome_win64')
    }
    if ($Bridge -eq 'yes') {
        $bridgeComponent = Get-Component 'Talktome Bridge' 'bridge.exe' 'talktome-bridge-client.exe'
        Assert-AccountScope $bridgeComponent $desktopSid $identity.User.Value
        Assert-ProgramsStopped @('Talktome Bridge', 'talktome-bridge-client')
    }
    if ($Server -eq 'no' -and $Bridge -eq 'no') { throw 'Select Server, Bridge, or both.' }

    if ($Server -eq 'yes') {
        Install-Component $serverComponent
        if ($useShared -and -not $alreadyShared) {
            Initialize-SharedData $sharedDirectory $identity.User
            New-Item -ItemType File -Path $marker | Out-Null
        }
    }
    if ($Bridge -eq 'yes') {
        Install-Component $bridgeComponent
    }
    exit 0
} catch {
    Write-Host ($_ | Out-String)
    exit 1
} finally {
    if ($env:TALKTOME_INSTALLER_TEST_LOG) { Stop-Transcript | Out-Null }
}
