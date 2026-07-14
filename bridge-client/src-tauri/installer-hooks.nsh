; MUI owns .onGUIInit. Register a callback so the installer can request focus
; when its first page is created without redefining MUI's callback function.
!define MUI_CUSTOMFUNCTION_GUIINIT FocusInstallerWindow
Function FocusInstallerWindow
  BringToFront
FunctionEnd
