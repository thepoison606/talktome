Unicode true

!ifndef APP_VERSION
  !error "APP_VERSION is required"
!endif

!ifndef SOURCE_DIR
  !error "SOURCE_DIR is required"
!endif

!ifndef OUT_FILE
  !error "OUT_FILE is required"
!endif

!define APP_NAME "Talktome Server"
!define APP_PUBLISHER "Talktome"
!define APP_EXE "talktome_win64.exe"
!define APP_REG_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Talktome Server"

Name "${APP_NAME}"
OutFile "${OUT_FILE}"
InstallDir "$PROGRAMFILES64\Talktome Server"
RequestExecutionLevel admin
SetCompressor /SOLID lzma

!ifdef ICON_FILE
  Icon "${ICON_FILE}"
  UninstallIcon "${ICON_FILE}"
!endif

Section "Install"
  SetOutPath "$INSTDIR"
  File /r "${SOURCE_DIR}\*"

  CreateDirectory "$SMPROGRAMS\Talktome"
  CreateShortcut "$SMPROGRAMS\Talktome\Talktome Server.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}"
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  WriteRegStr HKLM "${APP_REG_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKLM "${APP_REG_KEY}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKLM "${APP_REG_KEY}" "Publisher" "${APP_PUBLISHER}"
  WriteRegStr HKLM "${APP_REG_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${APP_REG_KEY}" "DisplayIcon" "$INSTDIR\${APP_EXE}"
  WriteRegStr HKLM "${APP_REG_KEY}" "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegDWORD HKLM "${APP_REG_KEY}" "NoModify" 1
  WriteRegDWORD HKLM "${APP_REG_KEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  Delete "$SMPROGRAMS\Talktome\Talktome Server.lnk"
  RMDir "$SMPROGRAMS\Talktome"
  DeleteRegKey HKLM "${APP_REG_KEY}"
  RMDir /r "$INSTDIR"
SectionEnd
