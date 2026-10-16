// Siri and Shortcuts: the phrases that run Folevi's App Intents (AppAndWidgets/Intents.swift) without setting
// anything up, also offered in Spotlight and the Shortcuts app.
import AppIntents

struct FoleviShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: AddTaskIntent(), phrases: ["Add a task in \(.applicationName)", "Add a \(.applicationName) task", "New task in \(.applicationName)"], shortTitle: "Add a task", systemImageName: "checkmark.circle")
        AppShortcut(intent: NewNoteIntent(), phrases: ["New note in \(.applicationName)", "Make a \(.applicationName) note", "Start a note in \(.applicationName)"], shortTitle: "New note", systemImageName: "square.and.pencil")
        AppShortcut(intent: ShowTodayIntent(), phrases: ["Open my \(.applicationName) tasks", "Show today in \(.applicationName)", "What's due in \(.applicationName)"], shortTitle: "Today's tasks", systemImageName: "calendar")
        AppShortcut(intent: OpenNoteIntent(), phrases: ["Open a note in \(.applicationName)", "Find a note in \(.applicationName)"], shortTitle: "Open note", systemImageName: "doc.text")
        AppShortcut(intent: OpenQuickAddIntent(), phrases: ["Quick add in \(.applicationName)"], shortTitle: "Quick add task", systemImageName: "plus.circle")
    }

    static var shortcutTileColor: ShortcutTileColor { .grayBlue }
}
