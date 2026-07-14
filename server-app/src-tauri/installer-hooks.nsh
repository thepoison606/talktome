; Tauri includes this file before it defines installer callbacks, so this is
; early enough to request focus for the very first installer page.
Function .onGUIInit
  BringToFront
FunctionEnd
