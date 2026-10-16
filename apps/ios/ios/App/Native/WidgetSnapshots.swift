// Debug builds in the Simulator only: Folevi's widgets drawn to PNGs, the way they'd look on the Home Screen
// and Lock Screen, from the App Group's copy (or the sample when signed out), and their empty and signed-out
// states, in light and dark (scripts/simulator.mjs widgets <folder>). The same views as the widget extension
// (AppAndWidgets/WidgetViews.swift), at the iPhone 18 Pro's widget sizes (extra large: the 13-inch iPad's).
// What WidgetKit adds itself (content margins, the Lock Screen's vibrancy, accessory backgrounds) is
// approximated here; the gallery and Home Screen screenshots of the UI tests show the real thing.
#if DEBUG && targetEnvironment(simulator)
import CoreText
import SwiftUI
import WidgetKit

@MainActor
enum WidgetSnapshots {
    private static let small = CGSize(width: 170, height: 170)
    private static let medium = CGSize(width: 364, height: 170)
    private static let large = CGSize(width: 364, height: 382)
    private static let extraLarge = CGSize(width: 715, height: 330)
    private static let circular = CGSize(width: 76, height: 76)
    private static let rectangular = CGSize(width: 172, height: 76)
    private static let inline = CGSize(width: 260, height: 24)

    /// Draws every widget into `folder`; the files written, by name.
    static func render(into folder: URL, font: URL?) throws -> [String] {
        if let font { CTFontManagerRegisterFontsForURL(font as CFURL, .process, nil) }
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let cached = WidgetStore.shared.load()
        let live = cached.state == .ready ? cached : .sample
        var empty = live
        empty.tasks = []
        empty.notes = []
        empty.pending = [:]
        var written: [String] = []
        // What's on this device, in light and dark; and every row filled with long titles, to see nothing
        // runs out of room.
        for (name, snapshot, scheme) in [("light", live, ColorScheme.light), ("dark", live, .dark), ("full", busy, .light)] {
            let sheet = Sheet(live: snapshot, empty: empty).environment(\.colorScheme, scheme)
            let renderer = ImageRenderer(content: sheet)
            renderer.scale = 3
            guard let png = renderer.uiImage?.pngData() else { continue }
            try png.write(to: folder.appendingPathComponent("widgets-\(name).png"))
            written.append("widgets-\(name).png")
        }
        return written
    }

    /// Overdue, timed and untimed tasks and notes, more than any widget shows, with long titles.
    private static var busy: WidgetSnapshot {
        let today = DayFormat.string(Date())
        let yesterday = DayFormat.string(Date().addingTimeInterval(-86400))
        let lastWeek = DayFormat.string(Date().addingTimeInterval(-6 * 86400))
        let note = TaskItem.NoteRef(id: "01JAAAAAAAAAAAAAAAAAAAAAAA", title: "Inbox")
        let texts = ["Renew the studio's insurance before the broker's office closes for the weekend", "Call Sam about the venue", "Send the proposal to Mira", "Review the quarterly numbers with the whole team and write up what changed", "Book the train to Leeds", "Water the plants", "Pick up the prints", "Reply to the landlord", "Draft the newsletter", "Order more labels", "Check the backup", "Plan the offsite agenda"]
        let tasks = texts.enumerated().map { i, text in
            TaskItem(id: "t\(i)", text: text, status: "open", dueDate: i == 0 ? lastWeek : i == 1 ? yesterday : today, dueTime: i == 2 ? "09:30" : i == 3 ? "14:00" : nil, priority: i == 2 ? "high" : nil, note: note, place: nil)
        }
        let titles = ["A very long note title about the spring catalogue and its print run", "Weekly review", "Reading list", "Field notes from the coast", "Acme brief", "Recipes", "Garden plan", "Offsite agenda", "Hiring loop", "Ideas"]
        let notes = titles.enumerated().map { i, title in
            NoteSummary(id: "01JB\(String(repeating: "B", count: 21))\(i)", title: title, place: .init(id: "personal", name: i % 3 == 2 ? "Studio Workspace" : "Personal"), updatedAt: ISO8601DateFormatter().string(from: Date().addingTimeInterval(Double(-i) * 5400)), url: nil)
        }
        return WidgetSnapshot(state: .ready, tasks: WidgetSnapshot.ordered(tasks, today: today), notes: notes, day: today, fetchedAt: Date())
    }

    private static func entry(_ snapshot: WidgetSnapshot) -> FoleviEntry { FoleviEntry(date: Date(), snapshot: snapshot) }

    /// A Home Screen widget: the canvas, WidgetKit's 16 pt margins, the rounded corners.
    private static func home(_ view: some View, _ size: CGSize) -> some View {
        view
            .padding(16)
            .frame(width: size.width, height: size.height)
            .background(Palette.canvas)
            .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
            .shadow(color: .black.opacity(0.12), radius: 8, y: 3)
    }

    /// A Lock Screen widget: white on the wallpaper (the Lock Screen draws them vibrant).
    private static func lock(_ view: some View, _ size: CGSize, round: Bool = false) -> some View {
        view
            .foregroundStyle(.white)
            .frame(width: size.width, height: size.height)
            .background {
                if round { Circle().fill(.white.opacity(0.16)) }
            }
            .environment(\.colorScheme, .dark)
    }

    private struct Sheet: View {
        let live: WidgetSnapshot
        let empty: WidgetSnapshot
        @Environment(\.colorScheme) private var scheme

        var body: some View {
            VStack(alignment: .leading, spacing: 22) {
                section("Today") {
                    HStack(alignment: .top, spacing: 22) {
                        home(TodayView(entry: entry(live), family: .systemSmall), small)
                        home(TodayView(entry: entry(live), family: .systemMedium), medium)
                    }
                    HStack(alignment: .top, spacing: 22) {
                        home(TodayView(entry: entry(live), family: .systemLarge), large)
                        home(TodayView(entry: entry(live), family: .systemExtraLarge), extraLarge)
                    }
                }
                section("Recent notes") {
                    HStack(alignment: .top, spacing: 22) {
                        home(RecentNotesView(entry: entry(live), family: .systemSmall), small)
                        home(RecentNotesView(entry: entry(live), family: .systemMedium), medium)
                    }
                    HStack(alignment: .top, spacing: 22) {
                        home(RecentNotesView(entry: entry(live), family: .systemLarge), large)
                        home(RecentNotesView(entry: entry(live), family: .systemExtraLarge), extraLarge)
                    }
                }
                section("Quick add, empty and signed out") {
                    HStack(alignment: .top, spacing: 22) {
                        home(QuickAddView(entry: entry(live)), small)
                        home(TodayView(entry: entry(empty), family: .systemSmall), small)
                        home(RecentNotesView(entry: entry(empty), family: .systemMedium), medium)
                    }
                    HStack(alignment: .top, spacing: 22) {
                        home(TodayView(entry: entry(.signedOut), family: .systemSmall), small)
                        home(TodayView(entry: entry(.signedOut), family: .systemMedium), medium)
                        home(RecentNotesView(entry: entry(.signedOut), family: .systemSmall), small)
                    }
                }
                section("Lock Screen") {
                    VStack(alignment: .leading, spacing: 16) {
                        HStack(spacing: 22) {
                            lock(LockScreenView(entry: entry(live), family: .accessoryCircular), circular, round: true)
                            lock(LockScreenView(entry: entry(live), family: .accessoryRectangular), rectangular)
                            lock(LockScreenView(entry: entry(live), family: .accessoryInline), inline)
                        }
                        HStack(spacing: 22) {
                            lock(LockScreenView(entry: entry(empty), family: .accessoryCircular), circular, round: true)
                            lock(LockScreenView(entry: entry(empty), family: .accessoryRectangular), rectangular)
                            lock(LockScreenView(entry: entry(.signedOut), family: .accessoryInline), inline)
                        }
                    }
                    .padding(20)
                    .background(LinearGradient(colors: [Color(white: 0.22), Color(white: 0.08)], startPoint: .top, endPoint: .bottom), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
                }
            }
            .padding(28)
            .background(scheme == .dark ? Color(white: 0.16) : Color(white: 0.86))
        }

        private func section(_ title: String, @ViewBuilder _ content: () -> some View) -> some View {
            VStack(alignment: .leading, spacing: 12) {
                Text(title)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(scheme == .dark ? Color(white: 0.75) : Color(white: 0.3))
                content()
            }
        }
    }
}
#endif
