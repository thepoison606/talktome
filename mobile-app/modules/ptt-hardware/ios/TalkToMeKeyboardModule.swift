import ExpoModulesCore
import UIKit

public final class TalkToMeKeyboardModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TalkToMeKeyboard")
    View(TalkToMeKeyboardView.self) {
      Events("onKeyboardEvent", "onReset")
      Prop("listening") { (view, value: Bool) in view.setListening(value) }
      Prop("capture") { (view, value: Bool) in view.capture = value }
      Prop("codes") { (view, value: [String]) in view.codes = Set(value) }
      Prop("focusRequest") { (view, _: Int) in view.focusIfNeeded() }
    }
  }
}

public final class TalkToMeKeyboardView: ExpoView {
  let onKeyboardEvent = EventDispatcher()
  let onReset = EventDispatcher()
  var capture = false
  var codes = Set<String>()
  private var listening = false
  private var held = Set<String>()
  private var observers: [NSObjectProtocol] = []

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    isAccessibilityElement = false
    accessibilityElementsHidden = true
    observers.append(NotificationCenter.default.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
      self?.reset()
      self?.resignFirstResponder()
    })
    observers.append(NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in self?.focusIfNeeded() })
    observers.append(NotificationCenter.default.addObserver(forName: UIWindow.didResignKeyNotification, object: nil, queue: .main) { [weak self] notification in
      guard let self, let window = notification.object as? UIWindow, window === self.window else { return }
      self.reset()
      self.resignFirstResponder()
    })
    observers.append(NotificationCenter.default.addObserver(forName: UIWindow.didBecomeKeyNotification, object: nil, queue: .main) { [weak self] notification in
      guard let self, let window = notification.object as? UIWindow, window === self.window else { return }
      self.focusIfNeeded()
    })
  }

  deinit { observers.forEach(NotificationCenter.default.removeObserver) }
  public override var canBecomeFirstResponder: Bool { listening }

  func setListening(_ value: Bool) {
    listening = value
    if value { focusIfNeeded() } else { reset(); resignFirstResponder() }
  }

  public override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil { reset() } else { focusIfNeeded() }
  }

  func focusIfNeeded() {
    // RN updates `listening` before UIKit finishes dismissing the settings
    // sheet. A focus request made during that transition can fail or be
    // superseded by the screen controller restoring its own responder.
    for delay in [0.0, 0.15, 0.4, 0.8] {
      DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
        guard let self, self.listening, !self.isFirstResponder,
              let window = self.window, window.isKeyWindow,
              UIApplication.shared.applicationState == .active else { return }
        // Never take the keyboard from an editable field or a system prompt.
        if let responder = self.firstResponder(in: window), responder is UIKeyInput { return }
        self.becomeFirstResponder()
      }
    }
  }

  private func firstResponder(in view: UIView) -> UIView? {
    if view.isFirstResponder { return view }
    for child in view.subviews {
      if let responder = firstResponder(in: child) { return responder }
    }
    return nil
  }

  public override func resignFirstResponder() -> Bool {
    let result = super.resignFirstResponder()
    if result { reset() }
    return result
  }

  private func reset() {
    held.removeAll()
    onReset([:])
  }

  public override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    var unhandled = Set<UIPress>()
    for press in presses {
      guard listening, let key = press.key,
            key.modifierFlags.intersection([.command, .control, .alternate]).isEmpty,
            let code = TalkToMeKeyboardKey.code(Int(key.keyCode.rawValue)), capture || codes.contains(code)
      else { unhandled.insert(press); continue }
      if held.insert(code).inserted { onKeyboardEvent(["code": code, "pressed": true]) }
    }
    if !unhandled.isEmpty { super.pressesBegan(unhandled, with: event) }
  }

  public override func pressesEnded(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    var unhandled = Set<UIPress>()
    for press in presses {
      guard let key = press.key, let code = TalkToMeKeyboardKey.code(Int(key.keyCode.rawValue)), held.remove(code) != nil
      else { unhandled.insert(press); continue }
      onKeyboardEvent(["code": code, "pressed": false])
    }
    if !unhandled.isEmpty { super.pressesEnded(unhandled, with: event) }
  }

  public override func pressesCancelled(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    reset()
    super.pressesCancelled(presses, with: event)
  }
}
