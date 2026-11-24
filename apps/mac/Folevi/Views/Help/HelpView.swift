// Help (Help > Folevi Help, ⌘?): where the guide and support are, the keyboard shortcuts, and what the save
// status words mean. A window of its own, so it can sit beside a note.
import SwiftUI

struct HelpView: View {
    var section: String? = nil

    private static let shortcuts: [(String, [(String, String)])] = [
        ("Everywhere", [("⌘K", "Search or run a command"), ("⇧⌘F", "Search all notes"), ("⌘N", "New note (on Tasks: new task)"), ("⇧⌘A", "Quick Add task"), ("⌥Space", "Quick Add from any app (change it in Settings)"), ("⌘J", "Ask Foli AI"), ("⇧⌘J", "Go to Foli AI"), ("⌘T", "New tab"), ("⇧⌘T", "Reopen closed tab"), ("⌘1 to ⌘9", "Show tab 1 to 9"), ("⌘[ / ⌘]", "Back / Forward"), ("⇧⌘H", "Home"), ("⌃⌘T", "Tasks"), ("⌥⌘T", "Today's tasks"), ("⇧⌘N", "New folder"), ("⌥⌘N", "New window"), ("⌃⌘I", "Inspector"), ("⌘,", "Settings")]),
        ("In a note", [("⌘F", "Find in the note"), ("⌘G / ⇧⌘G", "Find next / previous"), ("⌘B / ⌘I / ⌘U", "Bold, italic, underline"), ("⌥⌘] / ⌥⌘[", "Indent / outdent"), ("⌘Z / ⇧⌘Z", "Undo / Redo"), ("⌘P", "Print"), ("⇧⌘E", "Export"), ("⌘⌫", "Move the note to Trash")]),
        ("Lists and calendar", [("Return", "Open the selected note"), ("⌫", "Move selected notes to Trash"), ("⌘A", "Select all"), ("Esc", "Clear the selection"), ("⌘Return", "Open in a new tab (palette)"), ("← → ↑ ↓", "Move a day or a week (calendar)"), ("⌘← / ⌘→", "Previous / next month or week")]),
    ]

    private static let statuses: [(String, String)] = [
        ("Saved", "Everything you wrote is safe on Folevi (or in the library's folder)."),
        ("Saving…", "A change is on its way."),
        ("Syncing…", "Folevi is bringing this Mac up to date."),
        ("Offline", "Changes are kept on this Mac and go up when it's back online."),
        ("Conflict", "Two devices changed the same note; Folevi kept both versions."),
        ("Not saved", "Something stopped a change from saving. Open the status to see why."),
    ]

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Folevi Help").font(.title.weight(.semibold))
                        (Text("The guide is at ") + Text("[folevi.com/docs](https://folevi.com/docs)") + Text(". Write to ") + Text("[support@folevi.com](mailto:support@folevi.com)") + Text(" for help, or ") + Text("[security@folevi.com](mailto:security@folevi.com)") + Text(" to report a security problem."))
                            .foregroundStyle(.secondary)
                    }
                    VStack(alignment: .leading, spacing: 14) {
                        Text("Keyboard Shortcuts").font(.title3.weight(.semibold)).id("shortcuts")
                        ForEach(Self.shortcuts, id: \.0) { group in
                            VStack(alignment: .leading, spacing: 6) {
                                Text(group.0).font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                                Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 5) {
                                    ForEach(group.1, id: \.0) { row in
                                        GridRow {
                                            Text(row.0).font(.body.monospaced()).frame(minWidth: 120, alignment: .leading)
                                            Text(row.1)
                                        }
                                    }
                                }
                            }
                        }
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        Text("What the Save Status Means").font(.title3.weight(.semibold)).id("status")
                        Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 6) {
                            ForEach(Self.statuses, id: \.0) { s in
                                GridRow {
                                    Text(s.0).fontWeight(.medium).frame(minWidth: 120, alignment: .leading)
                                    Text(s.1).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                                }
                            }
                        }
                        Text("In a library on this Mac, Saved means the change is in the library's folder; syncing follows iCloud or the folder you picked.").font(.callout).foregroundStyle(.secondary)
                    }
                }
                .padding(28)
                .frame(maxWidth: 680, alignment: .leading)
            }
            .onAppear { if let section { proxy.scrollTo(section, anchor: .top) } }
        }
        .frame(minWidth: 520, minHeight: 480)
    }
}
