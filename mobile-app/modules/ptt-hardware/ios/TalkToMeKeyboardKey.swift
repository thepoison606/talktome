// USB HID usage -> browser KeyboardEvent.code, independent of keyboard layout.
enum TalkToMeKeyboardKey {
  static func code(_ usage: Int) -> String? {
    if (4...29).contains(usage) { return "Key" + String(UnicodeScalar(65 + usage - 4)!) }
    if (30...38).contains(usage) { return "Digit\(usage - 29)" }
    if (58...69).contains(usage) { return "F\(usage - 57)" }
    if (104...115).contains(usage) { return "F\(usage - 91)" }
    if (89...97).contains(usage) { return "Numpad\(usage - 88)" }
    return [39: "Digit0", 40: "Enter", 41: "Escape", 42: "Backspace", 43: "Tab", 44: "Space",
            45: "Minus", 46: "Equal", 47: "BracketLeft", 48: "BracketRight", 49: "Backslash",
            51: "Semicolon", 52: "Quote", 53: "Backquote", 54: "Comma", 55: "Period", 56: "Slash",
            79: "ArrowRight", 80: "ArrowLeft", 81: "ArrowDown", 82: "ArrowUp",
            84: "NumpadDivide", 85: "NumpadMultiply", 86: "NumpadSubtract", 87: "NumpadAdd",
            88: "NumpadEnter", 98: "Numpad0", 99: "NumpadDecimal"][usage]
  }
}
