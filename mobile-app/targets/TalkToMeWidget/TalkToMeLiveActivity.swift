import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

struct TalkToMePresenceAttributes: ActivityAttributes {
  public static var activityIdentifier: String { "TalkToMePresence" }

  public struct ContentState: Codable, Hashable {
    var connected: Bool
    var title: String
    var detail: String
    var audioActive: Bool
    var talking: Bool
    var listening: Bool
  }

  var name: String
}

@available(iOS 16.1, *)
struct TalkToMeLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: TalkToMePresenceAttributes.self) { context in
      // Paint ActivityKit state as-is. A TimelineView liveness overlay was
      // rewriting this to "Not connected" on the lock screen while the app
      // was still alive (file protection / probe false-dead). Swipe-kill
      // dismisses the island from the app process via Activity.end(.immediate).
      TalkToMeLockScreenView(state: context.state)
        .padding()
        .activityBackgroundTint(Color.black.opacity(0.82))
        .activitySystemActionForegroundColor(.white)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          VStack(alignment: .leading, spacing: 4) {
            TalkToMeMark(size: 32, filled: true)
            Text("Talktome")
              .font(.caption2.weight(.semibold))
              .foregroundStyle(.secondary)
          }
        }
        DynamicIslandExpandedRegion(.center) {
          VStack(alignment: .leading, spacing: 2) {
            ForEach(presenceLines(context.state.title), id: \.self) { line in
              Text(line)
                .font(.headline)
                .foregroundStyle(isOutgoingTalkLine(line) ? talkGreen : .white)
                .minimumScaleFactor(0.8)
            }
            Text(context.state.detail)
              .font(.subheadline)
              .foregroundStyle(.secondary)
              .minimumScaleFactor(0.8)
          }
        }
        DynamicIslandExpandedRegion(.trailing) {
          AudioAnalyzer(talking: context.state.talking, listening: context.state.listening)
        }
        DynamicIslandExpandedRegion(.bottom) {
          if context.state.connected, #available(iOS 17.0, *) {
            TalkToMeSessionActions(talking: context.state.talking)
          }
        }
      } compactLeading: {
        TalkToMeMark(size: 22)
      } compactTrailing: {
        AudioAnalyzer(talking: context.state.talking, listening: context.state.listening, compact: true)
      } minimal: {
        if context.state.talking || context.state.listening {
          AudioAnalyzer(talking: context.state.talking, listening: context.state.listening, compact: true)
        } else {
          TalkToMeMark(size: 18)
        }
      }
    }
  }
}

struct TalkToMeLockScreenView: View {
  let state: TalkToMePresenceAttributes.ContentState

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 12) {
        VStack(alignment: .leading, spacing: 4) {
          TalkToMeMark(size: 36, filled: true)
          Text("Talktome")
            .font(.caption2.weight(.semibold))
            .foregroundStyle(.secondary)
        }
        VStack(alignment: .leading, spacing: 2) {
          ForEach(presenceLines(state.title), id: \.self) { line in
            Text(line)
              .font(.headline)
              .foregroundStyle(isOutgoingTalkLine(line) ? talkGreen : .white)
          }
          Text(state.detail)
            .font(.subheadline)
            .foregroundStyle(.secondary)
        }
        Spacer()
        AudioAnalyzer(talking: state.talking, listening: state.listening)
      }
      if state.connected, #available(iOS 17.0, *) {
        TalkToMeSessionActions(talking: state.talking)
      }
    }
  }
}

struct TalkToMeMark: View {
  var size: CGFloat = 24
  var filled = false

  var body: some View {
    let radius = size * 0.24
    ZStack {
      if filled {
        RoundedRectangle(cornerRadius: radius, style: .continuous)
          .fill(Color.black)
      }
      Image("TalkToMeMarkGlyph")
        .renderingMode(.original)
        .resizable()
        .interpolation(.high)
        .scaledToFit()
        .padding(size * 0.04)
    }
    .frame(width: size, height: size)
    .accessibilityHidden(true)
  }
}

private let listenYellow = Color(red: 0.98, green: 0.78, blue: 0.22)
private let talkGreen = Color(red: 0.46, green: 0.95, blue: 0.72)

struct AudioAnalyzer: View {
  var talking = false
  var listening = false
  var compact = false

  var body: some View {
    let active = talking || listening
    TimelineView(.periodic(from: .now, by: active ? 0.12 : 3600)) { context in
      let t = context.date.timeIntervalSinceReferenceDate
      HStack(alignment: .center, spacing: compact ? 2 : 3) {
        ForEach(0..<5, id: \.self) { index in
          Capsule()
            .fill(barColor(index: index, active: active))
            .frame(width: compact ? 3 : 4, height: active ? barHeight(t: t, index: index) : (compact ? 6 : 8))
        }
      }
      .frame(height: compact ? 18 : 28)
    }
  }

  private func barColor(index: Int, active: Bool) -> Color {
    if !active {
      return Color.white.opacity(0.22)
    }
    if talking && listening {
      return index < 3 ? listenYellow : talkGreen
    }
    if talking {
      return talkGreen
    }
    return listenYellow
  }

  private func barHeight(t: Double, index: Int) -> CGFloat {
    let minH: CGFloat = compact ? 5 : 7
    let maxH: CGFloat = compact ? 16 : 26
    let phase = t * (2.35 + Double(index) * 0.52) + Double(index) * 0.85
    let n = (sin(phase) + 1) / 2
    return minH + CGFloat(n) * (maxH - minH)
  }
}

private func presenceLines(_ title: String) -> [String] {
  title.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
}

private func isOutgoingTalkLine(_ line: String) -> Bool {
  line.hasPrefix("Talking ·") || line.hasPrefix("Locked ·")
}
