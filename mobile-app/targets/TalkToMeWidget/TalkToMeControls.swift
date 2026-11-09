import AppIntents
import SwiftUI
import WidgetKit

@available(iOS 17.0, *)
struct TalkToMeSessionActions: View {
  var talking: Bool
  var compact = false

  var body: some View {
    HStack(spacing: compact ? 8 : 10) {
      Button(intent: TalkToMeReplyLockIntent()) {
        actionLabel(
          talking ? "Stop reply" : "Reply lock",
          systemImage: talking ? "mic.fill" : "mic",
          compact: compact
        )
      }
      .tint(talking ? Color(red: 0.46, green: 0.95, blue: 0.72) : .primary)

      Button(intent: TalkToMeDisconnectIntent()) {
        actionLabel("Disconnect", systemImage: "phone.down.fill", compact: compact)
      }
      .tint(Color(red: 1, green: 0.42, blue: 0.38))
    }
  }

  @ViewBuilder
  private func actionLabel(_ title: String, systemImage: String, compact: Bool) -> some View {
    if compact {
      Image(systemName: systemImage)
        .font(.system(size: 15, weight: .semibold))
        .frame(maxWidth: .infinity, minHeight: 28)
    } else {
      Label(title, systemImage: systemImage)
        .font(.subheadline.weight(.semibold))
        .frame(maxWidth: .infinity, minHeight: 32)
        .labelStyle(.titleAndIcon)
    }
  }
}

@available(iOS 18.0, *)
struct TalkToMeReplyControl: ControlWidget {
  static let kind = "io.github.leeo86.talktome-mobile.control.reply"

  var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: Self.kind) {
      ControlWidgetButton(action: TalkToMeReplyLockIntent()) {
        Label("Reply lock", systemImage: "mic.fill")
      }
    }
    .displayName("Reply lock")
    .description("Lock reply, or stop a locked reply.")
  }
}

@available(iOS 18.0, *)
struct TalkToMeDisconnectControl: ControlWidget {
  static let kind = "io.github.leeo86.talktome-mobile.control.disconnect"

  var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: Self.kind) {
      ControlWidgetButton(action: TalkToMeDisconnectIntent()) {
        Label("Disconnect", systemImage: "phone.down.fill")
      }
    }
    .displayName("Disconnect")
    .description("Disconnect the Talktome session.")
  }
}
