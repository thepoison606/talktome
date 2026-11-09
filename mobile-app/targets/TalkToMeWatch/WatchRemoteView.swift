import SwiftUI

private let ttmBg = Color(red: 7 / 255, green: 11 / 255, blue: 20 / 255)
private let ttmText = Color(red: 244 / 255, green: 247 / 255, blue: 251 / 255)
private let ttmMuted = Color.white.opacity(0.62)
private let ttmAccent = Color(red: 61 / 255, green: 214 / 255, blue: 245 / 255)
/// Outgoing talk — same purple as iOS `colors.talking` / web `.talking-to`.
private let ttmTalking = Color(red: 122 / 255, green: 71 / 255, blue: 199 / 255)
/// Incoming talk — same green as iOS `colors.speaking` / web `.speaking`.
private let ttmSpeaking = Color(red: 117 / 255, green: 242 / 255, blue: 184 / 255)

struct WatchRemoteView: View {
  @EnvironmentObject private var remote: WatchRemoteSession
  @Environment(\.scenePhase) private var scenePhase

  var body: some View {
    ZStack {
      ttmBg.ignoresSafeArea()
      content
      if let holding = remote.holdingTarget {
        Button { remote.stopTalk(holding) } label: {
          TalkingOverlay(target: holding, locked: remote.isLocked(holding))
        }
        .buttonStyle(.plain)
        // The original target retains the gesture until lift. Once latched,
        // the whole overlay becomes a stop button, including above a list.
        .allowsHitTesting(remote.isLocked(holding) && remote.touchTargetKey == nil)
        .accessibilityHidden(!remote.isLocked(holding))
        .accessibilityLabel("Stop talking to \(holding.label)")
      }
    }
    .onChange(of: scenePhase) { _, phase in
      if phase != .active, let target = remote.holdingTarget, !remote.isLocked(target) {
        remote.endTalk(target)
      }
    }
  }

  @ViewBuilder
  private var content: some View {
    if !remote.snapshot.connected {
      StatusScreen(
        title: "Talktome",
        detail: remote.status,
        hint: "Keep the iPhone session connected. The watch only remotes talk — audio stays on the phone."
      )
    } else if remote.snapshot.targets.isEmpty {
      StatusScreen(
        title: remote.status,
        detail: "No talk targets",
        hint: "Choose Watch targets in Accessories on iPhone. Saved targets may be unavailable in this production."
      )
    } else if remote.snapshot.twoTargetMode && remote.snapshot.targets.count == 2 {
      GeometryReader { geometry in
        VStack(spacing: 4) {
          ForEach(remote.snapshot.targets) { target in
            SplitTargetTalkView(target: target)
              .frame(height: max(0, (geometry.size.height - 4) / 2))
          }
        }
        .frame(width: geometry.size.width, height: geometry.size.height)
      }
      .ignoresSafeArea(.container, edges: .vertical)
      .padding(.horizontal, 4)
    } else if remote.snapshot.singleTargetMode,
              let target = remote.snapshot.targets.first {
      SingleTargetTalkView(target: target)
    } else {
      List {
        header
        if let reply = remote.snapshot.reply {
          Section("Reply") {
            HoldTalkRow(target: reply, asReply: true)
              .id(reply.id)
          }
        }
        Section {
          ForEach(remote.snapshot.targets.filter { !$0.pinned }) { target in
            HoldTalkRow(target: target, asReply: false)
          }
        }
      }
      .listStyle(.elliptical)
      .scrollDisabled(remote.holdingKey != nil)
      .scrollIndicators(remote.holdingKey == nil ? .automatic : .hidden)
    }
  }

  private var header: some View {
    VStack(alignment: .leading, spacing: 2) {
      HStack(spacing: 6) {
        Circle()
          .fill(remote.reachable ? ttmAccent : Color.orange)
          .frame(width: 7, height: 7)
        Text(remote.reachable ? "Live" : "iPhone away")
          .font(.caption2.weight(.semibold))
          .foregroundStyle(remote.reachable ? ttmAccent : Color.orange)
      }
      Text(remote.status)
        .font(.caption)
        .foregroundStyle(ttmMuted)
        .lineLimit(2)
    }
    .listRowBackground(Color.clear)
  }
}

private struct HoldTalkRow: View {
  @EnvironmentObject private var remote: WatchRemoteSession
  let target: WatchRemoteTarget
  var asReply = false

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(asReply ? "Reply" : target.kindLabel)
        .font(.caption2.weight(.semibold))
        .foregroundStyle(target.highlighted ? ttmSpeaking : ttmMuted)
      Text(target.label)
        .font(.headline)
        .foregroundStyle(ttmText)
        .lineLimit(2)
      Text(target.canTalk ? "Hold to talk" : "Unavailable")
        .font(.caption2)
        .foregroundStyle(ttmMuted)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.vertical, 8)
    .listRowBackground(rowBackground)
    .contentShape(Rectangle())
    .opacity(target.canTalk ? 1 : 0.45)
    .modifier(WatchTalkControl(target: target, scrollable: true))
  }

  private var rowBackground: Color {
    if remote.holdingKey == target.key || remote.snapshot.talkingTargetKey == target.key {
      return ttmTalking.opacity(0.88)
    }
    if target.highlighted {
      return ttmSpeaking.opacity(0.22)
    }
    return Color.white.opacity(0.08)
  }
}

private struct SplitTargetTalkView: View {
  @EnvironmentObject private var remote: WatchRemoteSession
  let target: WatchRemoteTarget

  private var active: Bool {
    remote.holdingKey == target.key || remote.snapshot.talkingTargetKey == target.key || remote.isLocked(target)
  }

  var body: some View {
    VStack(spacing: 4) {
      Text(target.pinned ? "Reply" : target.kindLabel)
        .font(.caption2).foregroundStyle(ttmMuted)
      Text(target.label)
        .font(.headline).multilineTextAlignment(.center)
        .lineLimit(2).minimumScaleFactor(0.65)
      Text(remote.isLocked(target) ? "Tap to stop" : active ? "Release to stop" : target.canTalk ? "Hold to talk" : "Unavailable")
        .font(.caption2).foregroundStyle(ttmMuted)
    }
    .padding(8)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .foregroundStyle(ttmText)
    .background(active ? ttmTalking : target.highlighted ? ttmSpeaking.opacity(0.22) : Color.white.opacity(0.08))
    .clipShape(RoundedRectangle(cornerRadius: 16))
    .contentShape(Rectangle())
    .opacity(target.canTalk ? 1 : 0.45)
    .modifier(WatchTalkControl(target: target))
  }
}

private struct SingleTargetTalkView: View {
  @EnvironmentObject private var remote: WatchRemoteSession
  let target: WatchRemoteTarget

  var body: some View {
    VStack(spacing: 8) {
      HStack(spacing: 5) {
        Circle().fill(remote.reachable ? ttmAccent : Color.orange).frame(width: 6, height: 6)
        Text(remote.reachable ? "Live" : "iPhone away").font(.caption2)
      }
      .foregroundStyle(ttmMuted)
      Spacer(minLength: 4)
      Text(target.pinned ? "Reply" : target.kindLabel)
        .font(.caption.weight(.semibold))
        .foregroundStyle(target.highlighted ? ttmSpeaking : ttmMuted)
      Text(target.label)
        .font(.title2.weight(.bold))
        .multilineTextAlignment(.center)
        .lineLimit(3)
        .minimumScaleFactor(0.65)
        .foregroundStyle(ttmText)
      Spacer(minLength: 4)
      Image(systemName: remote.isLocked(target) ? "lock.fill" : "mic.fill")
        .font(.title2).foregroundStyle(ttmAccent)
      Text(remote.isLocked(target) ? "Tap to stop" : target.canTalk ? "Hold to talk" : "Unavailable")
        .font(.caption)
        .foregroundStyle(ttmMuted)
    }
    .padding(.horizontal, 10)
    .padding(.vertical, 8)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(remote.isLocked(target) ? ttmTalking : target.highlighted ? ttmSpeaking.opacity(0.18) : ttmBg)
    .contentShape(Rectangle())
    .opacity(target.canTalk ? 1 : 0.5)
    .modifier(WatchTalkControl(target: target))
  }
}

/// All target layouts use the same hold/drag/cancel handling. A list row waits
/// briefly for a hold so an ordinary vertical scroll can win before talk starts.
private struct WatchTalkControl: ViewModifier {
  @EnvironmentObject private var remote: WatchRemoteSession
  let target: WatchRemoteTarget
  var scrollable = false
  @GestureState private var tracking = false
  @State private var interaction = WatchTalkGesture()
  @State private var pressedTarget: WatchRemoteTarget?

  func body(content: Content) -> some View {
    Group {
      if scrollable {
        content.simultaneousGesture(
          LongPressGesture(minimumDuration: 0.15, maximumDistance: 12)
            .sequenced(before: DragGesture(minimumDistance: 0))
            .updating($tracking) { _, active, _ in active = true }
            .onChanged { value in
              switch value {
              case .first(true): begin()
              case .second(true, let drag):
                begin()
                if let drag { move(drag) }
              default: break
              }
            }
            .onEnded { _ in finish() }
        )
      } else {
        content.gesture(
          DragGesture(minimumDistance: 0)
            .updating($tracking) { _, active, _ in active = true }
            .onChanged { value in begin(); move(value) }
            .onEnded { _ in finish() }
        )
      }
    }
    .onChange(of: tracking) { _, active in if !active { finish() } }
    .onDisappear { finish() }
    .accessibilityElement(children: .combine)
    .accessibilityLabel("Talk to \(target.label)")
    .accessibilityAddTraits(.isButton)
    .accessibilityValue(target.canTalk ? "" : "Unavailable")
    .accessibilityHint("Hold and swipe left to lock; tap the locked screen to stop")
    .accessibilityAction {
      if remote.isLocked(target) { remote.stopTalk(target) }
      else { remote.beginTalk(target); remote.lockTalk(target) }
    }
  }

  private func begin() {
    guard !interaction.active else { return }
    pressedTarget = target
    remote.touchTargetKey = target.key
    dispatch(interaction.begin(wasLocked: remote.isLocked(target)), target: target)
  }

  private func move(_ value: DragGesture.Value) {
    guard let pressedTarget else { return }
    let action = interaction.move(x: Double(value.translation.width),
      y: Double(value.translation.height), startX: Double(value.startLocation.x))
    dispatch(action, target: pressedTarget)
  }

  private func finish() {
    let action = interaction.finish()
    guard let pressedTarget else { return }
    dispatch(action, target: pressedTarget)
    if remote.touchTargetKey == pressedTarget.key { remote.touchTargetKey = nil }
    self.pressedTarget = nil
  }

  private func dispatch(_ action: WatchTalkGesture.Action, target: WatchRemoteTarget) {
    switch action {
    case .start: remote.beginTalk(target)
    case .stop: remote.stopTalk(target)
    case .lock: remote.lockTalk(target)
    case .release: remote.endTalk(target)
    case .none: break
    }
  }
}

private struct TalkingOverlay: View {
  let target: WatchRemoteTarget
  let locked: Bool

  var body: some View {
    GeometryReader { geometry in
      VStack(spacing: 8) {
        Text("Talking · \(target.label)")
          .font(.system(size: 18, weight: .bold))
          .lineLimit(1)
          .minimumScaleFactor(0.55)
        HStack(spacing: 5) {
          if locked { Image(systemName: "lock.fill") }
          Text(locked ? "Tap to stop" : "← Swipe left to lock")
        }
        .font(.caption2)
        .opacity(0.9)
        Spacer(minLength: 0)
      }
      .padding(.horizontal, 8)
      .padding(.top, max(8, geometry.size.height * 0.08))
      .frame(width: geometry.size.width, height: geometry.size.height * 2 / 3, alignment: .top)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .foregroundStyle(.white)
    .background(ttmTalking.ignoresSafeArea())
    .contentShape(Rectangle())
  }
}

private struct StatusScreen: View {
  let title: String
  let detail: String
  let hint: String

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(title)
        .font(.headline)
        .foregroundStyle(ttmText)
      Text(detail)
        .font(.caption)
        .foregroundStyle(ttmAccent)
      Text(hint)
        .font(.caption2)
        .foregroundStyle(ttmMuted)
    }
    .padding(.horizontal, 8)
  }
}
