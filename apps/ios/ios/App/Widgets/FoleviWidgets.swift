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
        StaticConfiguration(kind: "com.folevi.ios.quick-add", provider: FoleviTimelineProvider()) { entry in
            QuickAddView(entry: entry)
        }
        .configurationDisplayName("Quick add")
        .description("Add a task to Folevi in a tap.")
        .supportedFamilies([.systemSmall])
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
