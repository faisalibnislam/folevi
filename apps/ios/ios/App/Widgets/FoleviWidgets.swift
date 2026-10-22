// Folevi's widgets (WidgetKit): Today (today's and overdue tasks, checked off right in the widget), Recent
// notes, Quick add, the Lock Screen's count and next task, and on iOS 18 the Control Center control for
// Quick add task. They draw from the App Group's copy of tasks and notes (WidgetStore, refreshed with this
// device's token) and open the app with folevi:// links.
import AppIntents
import SwiftUI
import WidgetKit

@main
struct FoleviWidgets: WidgetBundle {
    var body: some Widget {
        TodayWidget()
        RecentNotesWidget()
        QuickAddWidget()
        LockScreenWidget()
        if #available(iOS 18.0, *) {
            QuickAddTaskControl()
        }
    }
}

// MARK: Today

struct TodayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "com.folevi.ios.today", provider: FoleviTimelineProvider()) { entry in
            TodayView(entry: entry)
        }
        .configurationDisplayName("Today")
        .description("Today's and overdue tasks. Check them off here.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .systemExtraLarge])
    }
}

// MARK: Recent notes

struct RecentNotesWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "com.folevi.ios.recent-notes", provider: FoleviTimelineProvider()) { entry in
            RecentNotesView(entry: entry)
        }
        .configurationDisplayName("Recent notes")
        .description("The notes you worked on last.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .systemExtraLarge])
    }
}

// MARK: Quick add

struct QuickAddWidget: Widget {
    var body: some WidgetConfiguration {
        // Its one setting, Save to, matters only with several places on this device (the library and accounts):
        // the place picked, else the one chosen last.
        AppIntentConfiguration(kind: "com.folevi.ios.quick-add", intent: QuickAddPlaceIntent.self, provider: QuickAddProvider()) { entry in
            QuickAddView(entry: entry.base, place: entry.place)
        }
        .configurationDisplayName("Quick add")
        .description("Add a task to Folevi in a tap.")
        .supportedFamilies([.systemSmall])
    }
}

struct QuickAddEntry: TimelineEntry {
    let base: FoleviEntry
    let place: SaveTarget?
    var date: Date { base.date }
}

/// The Quick add widget's timeline: the usual entry, and the place it adds to.
struct QuickAddProvider: AppIntentTimelineProvider {
    private let inner = FoleviTimelineProvider()

    private func place(_ config: QuickAddPlaceIntent) -> SaveTarget? {
        guard SaveTargets.several() else { return nil }
        return config.place.flatMap { SaveTargets.target($0.id) } ?? SaveTargets.preferred()
    }

    func placeholder(in context: Context) -> QuickAddEntry {
        QuickAddEntry(base: FoleviEntry(date: Date(), snapshot: .sample), place: nil)
    }

    func snapshot(for configuration: QuickAddPlaceIntent, in context: Context) async -> QuickAddEntry {
        QuickAddEntry(base: FoleviEntry(date: Date(), snapshot: WidgetStore.shared.load()), place: place(configuration))
    }

    func timeline(for configuration: QuickAddPlaceIntent, in context: Context) async -> Timeline<QuickAddEntry> {
        let t = await inner.timeline()
        return Timeline(entries: t.entries.map { QuickAddEntry(base: $0, place: place(configuration)) }, policy: t.policy)
    }
}

// MARK: Lock Screen

struct LockScreenWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "com.folevi.ios.lock-screen", provider: FoleviTimelineProvider()) { entry in
            LockScreenView(entry: entry)
        }
        .configurationDisplayName("Today")
        .description("How many tasks are due today, and the next one.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

// MARK: Control Center (iOS 18)

@available(iOS 18.0, *)
struct QuickAddTaskControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "com.folevi.ios.quick-add-task") {
            ControlWidgetButton(action: OpenQuickAddIntent()) {
                Label("Quick add task", systemImage: "plus.circle")
            }
        }
        .displayName("Quick add task")
        .description("Opens Folevi's Quick add task.")
    }
}
