import AppIntents
import Foundation

enum TalkToMeNotify {
  static let talk = "io.github.leeo86.talktome.talk" as CFString
  static let disconnect = "io.github.leeo86.talktome.disconnect" as CFString

  static func post(_ name: CFString) {
    CFNotificationCenterPostNotification(
      CFNotificationCenterGetDarwinNotifyCenter(),
      CFNotificationName(name),
      nil,
      nil,
      true
    )
  }
}

@available(iOS 17.0, *)
struct TalkToMeReplyLockIntent: AppIntent, LiveActivityIntent {
  static var title: LocalizedStringResource = "Reply lock"
  static var description = IntentDescription("Lock reply, or stop a locked reply.")
  static var openAppWhenRun = false

  func perform() async throws -> some IntentResult {
    TalkToMeNotify.post(TalkToMeNotify.talk)
    return .result()
  }
}

@available(iOS 17.0, *)
struct TalkToMeDisconnectIntent: AppIntent, LiveActivityIntent {
  static var title: LocalizedStringResource = "Disconnect"
  static var description = IntentDescription("Disconnect the Talktome session.")
  static var openAppWhenRun = false

  func perform() async throws -> some IntentResult {
    TalkToMeNotify.post(TalkToMeNotify.disconnect)
    return .result()
  }
}
