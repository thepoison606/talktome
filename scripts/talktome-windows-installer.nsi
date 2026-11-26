Unicode true
RequestExecutionLevel admin
ShowInstDetails show
SetCompressor /SOLID lzma
Name "Talktome Setup"
OutFile "${OUT_FILE}"
Icon "../server-app/src-tauri/icons/icon.ico"

!include MUI2.nsh
!include LogicLib.nsh
!include Sections.nsh
!include FileFunc.nsh
!include nsDialogs.nsh
!include x64.nsh

!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall"
!define MUI_ABORTWARNING

Var Scope
Var ScopeMachineRadio
Var ServerData
Var SharedDataRadio
Var ExistingServer
Var ExistingBridge
Var ExistingShared
Var ServerChoice
Var BridgeChoice

!insertmacro MUI_PAGE_WELCOME
!define MUI_COMPONENTSPAGE_TEXT_TOP "Select the components to install or update. Other installed components stay installed."
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE ValidateComponents
!insertmacro MUI_PAGE_COMPONENTS
Page custom ShowScope SaveScope
Page custom ShowServerData SaveServerData
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_TEXT "Setup is complete. You can open the installed Talktome apps from the Windows Start menu."
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_LANGUAGE "English"

Section "Talktome Server" Server
SectionEnd

Section /o "Talktome Bridge" Bridge
SectionEnd

Section -Install
  Call ReadSelection
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File "install-talktome-windows.ps1"
  ${If} $ServerChoice == "yes"
    File /oname=server.exe "${SERVER_INSTALLER}"
  ${EndIf}
  ${If} $BridgeChoice == "yes"
    File /oname=bridge.exe "${BRIDGE_INSTALLER}"
  ${EndIf}

retry_install:
  nsExec::ExecToLog '"$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File "$PLUGINSDIR\install-talktome-windows.ps1" -Server $ServerChoice -Bridge $BridgeChoice -Scope $Scope -ServerData $ServerData'
  Pop $0
  ${If} $0 == 2
    MessageBox MB_ICONEXCLAMATION|MB_RETRYCANCEL "Quit the selected Talktome apps using their tray menus and stop any standalone server before continuing." /SD IDCANCEL IDRETRY retry_install
  ${EndIf}
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "Talktome setup could not finish. Check the details for the reason, then run setup again." /SD IDOK
    SetErrorLevel 1
    Abort
  ${EndIf}
SectionEnd

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "Talktome requires 64-bit Windows." /SD IDOK
    SetErrorLevel 1
    Abort
  ${EndIf}
  SetRegView 64
  ReadRegStr $ExistingServer HKCU "${UNINSTALL_KEY}\Talktome Server" "InstallLocation"
  ReadRegStr $ExistingBridge HKCU "${UNINSTALL_KEY}\Talktome Bridge" "InstallLocation"
  ${If} $ExistingServer == ""
    ReadRegStr $ExistingServer HKLM "${UNINSTALL_KEY}\Talktome Server" "InstallLocation"
  ${EndIf}
  ${If} $ExistingBridge == ""
    ReadRegStr $ExistingBridge HKLM "${UNINSTALL_KEY}\Talktome Bridge" "InstallLocation"
  ${EndIf}
  SetRegView 32
  ${If} $ExistingServer == ""
    ReadRegStr $ExistingServer HKCU "${UNINSTALL_KEY}\Talktome Server" "InstallLocation"
  ${EndIf}
  ${If} $ExistingServer == ""
    ReadRegStr $ExistingServer HKLM "${UNINSTALL_KEY}\Talktome Server" "InstallLocation"
  ${EndIf}
  ${If} $ExistingBridge == ""
    ReadRegStr $ExistingBridge HKCU "${UNINSTALL_KEY}\Talktome Bridge" "InstallLocation"
  ${EndIf}
  ${If} $ExistingBridge == ""
    ReadRegStr $ExistingBridge HKLM "${UNINSTALL_KEY}\Talktome Bridge" "InstallLocation"
  ${EndIf}
  SetRegView 64

  StrCpy $Scope "machine"
  StrCpy $ServerData "personal"
  ${If} $ExistingServer != ""
    ${OrIf} $ExistingBridge != ""
    !insertmacro UnselectSection ${Server}
    ${If} $ExistingServer != ""
      !insertmacro SelectSection ${Server}
      ${If} $ExistingServer != ""
        StrCpy $0 $ExistingServer 1
        ${If} $0 == '$\"'
          StrCpy $ExistingServer $ExistingServer -1 1
        ${EndIf}
        IfFileExists "$ExistingServer\server-data.shared" 0 +3
          StrCpy $ExistingShared "yes"
          StrCpy $ServerData "shared"
      ${EndIf}
    ${EndIf}
    ${If} $ExistingBridge != ""
      !insertmacro SelectSection ${Bridge}
    ${EndIf}
  ${EndIf}

  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "/SCOPE=" $1
  ${IfNot} ${Errors}
    StrCpy $Scope $1
  ${EndIf}
  ClearErrors
  ${GetOptions} $0 "/SERVERDATA=" $1
  ${IfNot} ${Errors}
    StrCpy $ServerData $1
  ${EndIf}
  ClearErrors
  ${GetOptions} $0 "/COMPONENTS=" $1
  ${IfNot} ${Errors}
    ${If} $1 == "server"
      !insertmacro SelectSection ${Server}
      !insertmacro UnselectSection ${Bridge}
    ${ElseIf} $1 == "bridge"
      !insertmacro UnselectSection ${Server}
      !insertmacro SelectSection ${Bridge}
    ${ElseIf} $1 == "both"
      !insertmacro SelectSection ${Server}
      !insertmacro SelectSection ${Bridge}
    ${Else}
      SetErrorLevel 1
      Abort
    ${EndIf}
  ${EndIf}
FunctionEnd

Function ReadSelection
  StrCpy $ServerChoice "no"
  StrCpy $BridgeChoice "no"
  ${If} ${SectionIsSelected} ${Server}
    StrCpy $ServerChoice "yes"
  ${EndIf}
  ${If} ${SectionIsSelected} ${Bridge}
    StrCpy $BridgeChoice "yes"
  ${EndIf}
FunctionEnd

Function ValidateComponents
  Call ReadSelection
  ${If} $ServerChoice == "no"
    ${AndIf} $BridgeChoice == "no"
    MessageBox MB_ICONINFORMATION "Select Server, Bridge, or both."
    Abort
  ${EndIf}
FunctionEnd

Function ShowScope
  StrCpy $ScopeMachineRadio ""
  StrCpy $1 ""
  StrCpy $2 ""
  StrCpy $3 ""
  ${If} $ServerChoice == "yes"
    ${If} $ExistingServer == ""
      StrCpy $1 "Talktome Server"
    ${Else}
      StrCpy $2 "Server: update at the existing location."
    ${EndIf}
  ${EndIf}
  ${If} $BridgeChoice == "yes"
    ${If} $ExistingBridge == ""
      ${If} $1 == ""
        StrCpy $1 "Talktome Bridge"
      ${Else}
        StrCpy $1 "Talktome Server and Bridge"
      ${EndIf}
    ${Else}
      StrCpy $3 "Bridge: update at the existing location."
    ${EndIf}
  ${EndIf}

  !insertmacro MUI_HEADER_TEXT "Installation details" "Review which components will be updated or newly installed."
  nsDialogs::Create 1018
  Pop $0
  ${NSD_CreateLabel} 0 0 100% 12u "$2"
  Pop $0
  ${NSD_CreateLabel} 0 14u 100% 12u "$3"
  Pop $0
  ${If} $1 != ""
    ${NSD_CreateLabel} 0 34u 100% 14u "New installation: $1"
    Pop $0
    ${NSD_CreateRadioButton} 0 53u 100% 12u "Only for me (Local AppData)"
    Pop $0
    ${NSD_CreateRadioButton} 0 72u 100% 12u "For all users (Program Files)"
    Pop $ScopeMachineRadio
    ${If} $Scope == "user"
      ${NSD_Check} $0
    ${Else}
      ${NSD_Check} $ScopeMachineRadio
    ${EndIf}
  ${EndIf}
  nsDialogs::Show
FunctionEnd

Function SaveScope
  ${If} $ScopeMachineRadio == ""
    Return
  ${EndIf}
  ${NSD_GetState} $ScopeMachineRadio $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $Scope "machine"
  ${Else}
    StrCpy $Scope "user"
  ${EndIf}
FunctionEnd

Function ShowServerData
  Call ReadSelection
  ${If} $ServerChoice == "no"
    ${OrIf} $ExistingShared == "yes"
    Abort
  ${EndIf}
  !insertmacro MUI_HEADER_TEXT "Server data" "Choose where to store the server configuration and database."
  nsDialogs::Create 1018
  Pop $0
  ${NSD_CreateRadioButton} 0 0 100% 12u "Only for my Windows account (Local AppData)"
  Pop $0
  ${NSD_CreateRadioButton} 0 21u 100% 12u "Shared server instance (ProgramData)"
  Pop $SharedDataRadio
  ${If} $ServerData == "shared"
    ${NSD_Check} $SharedDataRadio
  ${Else}
    ${NSD_Check} $0
  ${EndIf}
  ${NSD_CreateLabel} 0 49u 100% 43u "For a shared instance, setup copies existing server data from your Windows profile and leaves the original in place. Administrators can grant additional Windows accounts access to the shared folder."
  Pop $0
  nsDialogs::Show
FunctionEnd

Function SaveServerData
  ${NSD_GetState} $SharedDataRadio $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $ServerData "shared"
    ${If} $ExistingServer != ""
      ${OrIf} ${FileExists} "$LOCALAPPDATA\talktome\*.*"
      MessageBox MB_ICONQUESTION|MB_YESNO|MB_DEFBUTTON2 "Copy this account's server data into ProgramData and use it for future starts?" IDYES +2
        Abort
    ${EndIf}
  ${Else}
    StrCpy $ServerData "personal"
  ${EndIf}
FunctionEnd
