@main
enum KeyboardMappingTests {
  static func main() {
    precondition(TalkToMeKeyboardKey.code(44) == "Space")
    for digit in 1...9 {
      precondition(TalkToMeKeyboardKey.code(29 + digit) == "Digit\(digit)")
      precondition(TalkToMeKeyboardKey.code(88 + digit) == "Numpad\(digit)")
    }
    precondition(TalkToMeKeyboardKey.code(4) == "KeyA")
    precondition(TalkToMeKeyboardKey.code(29) == "KeyZ")
    precondition(TalkToMeKeyboardKey.code(41) == "Escape")
    precondition(TalkToMeKeyboardKey.code(104) == "F13")
    precondition(TalkToMeKeyboardKey.code(115) == "F24")
    for modifier in 224...231 { precondition(TalkToMeKeyboardKey.code(modifier) == nil) }
    print("Keyboard HID mapping tests passed")
  }
}
