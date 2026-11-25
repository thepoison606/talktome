; MUI owns .onGUIInit. Register a callback so the installer can request focus
; when its first page is created without redefining MUI's callback function.
!define MUI_CUSTOMFUNCTION_GUIINIT FocusInstallerWindow
Function FocusInstallerWindow
  BringToFront
FunctionEnd

; Tauri's multi-user setup resets /D during initialization. The combined
; installer passes the previously registered directory to the payload instead.
!macro NSIS_HOOK_PREINSTALL
  ReadEnvStr $0 "TALKTOME_SETUP_INSTALL_DIR"
  StrCmp $0 "" +3
    StrCpy $INSTDIR $0
    SetOutPath $INSTDIR
!macroend
