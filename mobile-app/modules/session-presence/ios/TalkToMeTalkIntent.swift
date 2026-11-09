import AppIntents
import Foundation

@available(iOS 16.0, *)
struct TalkIntent: AppIntent {
  static var title: LocalizedStringResource = "Reply lock"
  static var description = IntentDescription(
    "Lock or stop reply — or talk to the selected destination in Talk & select."
  )
  static var openAppWhenRun = false

  func perform() async throws -> some IntentResult {
    postPresenceNotification(TalkToMePresenceStore.talkNotification)
    return .result()
  }
}

@available(iOS 16.0, *)
struct DisconnectIntent: AppIntent {
  static var title: LocalizedStringResource = "Disconnect"
  static var description = IntentDescription("Disconnect the Talktome session.")
  static var openAppWhenRun = false

  func perform() async throws -> some IntentResult {
    postPresenceNotification(TalkToMePresenceStore.disconnectNotification)
    return .result()
  }
}

@available(iOS 16.0, *)
private func postPresenceNotification(_ name: CFString) {
  CFNotificationCenterPostNotification(
    CFNotificationCenterGetDarwinNotifyCenter(),
    CFNotificationName(name),
    nil,
    nil,
    true
  )
}

@available(iOS 16.0, *)
struct TalkToMeShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: TalkIntent(),
      phrases: [
        "Talk with \(.applicationName)",
        "Toggle talk in \(.applicationName)",
        "Reply lock in \(.applicationName)",
      ],
      shortTitle: "Reply lock",
      systemImageName: "mic.fill"
    )
    AppShortcut(
      intent: DisconnectIntent(),
      phrases: [
        "Disconnect \(.applicationName)",
        "Leave \(.applicationName)",
      ],
      shortTitle: "Disconnect",
      systemImageName: "phone.down.fill"
    )
  }
}
