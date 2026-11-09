import SwiftUI
import WidgetKit

struct TalkToMeHomeEntry: TimelineEntry {
  let date: Date
  let connected: Bool
  let title: String
  let detail: String
  let talking: Bool
}

struct TalkToMeHomeProvider: TimelineProvider {
  func placeholder(in context: Context) -> TalkToMeHomeEntry {
    TalkToMeHomeEntry(date: Date(), connected: true, title: "Nobody Talking", detail: "Reply: none", talking: false)
  }

  func getSnapshot(in context: Context, completion: @escaping (TalkToMeHomeEntry) -> Void) {
    completion(TalkToMeWidgetPresence.homeEntry())
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<TalkToMeHomeEntry>) -> Void) {
    completion(TalkToMeWidgetPresence.timeline(from: TalkToMeWidgetPresence.homeEntry()))
  }
}

struct TalkToMeHomeWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "TalkToMeHomeWidget", provider: TalkToMeHomeProvider()) { entry in
      if #available(iOS 17.0, *) {
        TalkToMeHomeView(entry: entry)
          .containerBackground(.background, for: .widget)
      } else {
        TalkToMeHomeView(entry: entry)
      }
    }
    .configurationDisplayName("Talktome")
    .description("Who is talking, and the current Reply or Talk target.")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}

struct TalkToMeHomeView: View {
  let entry: TalkToMeHomeEntry
  @Environment(\.widgetFamily) private var family

  var body: some View {
    contents
      .padding()
  }

  private var contents: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        TalkToMeMark(size: 28, filled: true)
        Text("talktome")
          .font(.caption.weight(.semibold))
          .foregroundStyle(.secondary)
        Spacer()
      }
      Text(entry.title)
        .font(.title3.weight(.bold))
        .foregroundStyle(.primary)
        .minimumScaleFactor(0.7)
        .lineLimit(2)
      Text(entry.detail)
        .font(.subheadline)
        .foregroundStyle(.secondary)
        .lineLimit(2)
      if entry.connected, #available(iOS 17.0, *) {
        TalkToMeSessionActions(talking: entry.talking, compact: family == .systemSmall)
      }
    }
  }
}
