// The menu bar: every command Folevi Core has, with the Mac's standard shortcuts and few of its own. Menus act on
// the front window (focusedSceneValue), and on the note's editor when a note is on screen (Format, Edit's Find).
import FoleviEngine
import SwiftUI

struct AppCommands: SwiftUI.Commands {
    let app: AppModel
    @FocusedValue(\.window) private var window
    @Environment(\.openWindow) private var openWindow

    var body: some SwiftUI.Commands {
        // File
        CommandGroup(replacing: .newItem) {
            Button("New Note") { NoteActions.newNote(app: app, window: window, newTab: window == nil) }
                .keyboardShortcut("n")
            Button("New Note from Template…") { window?.go(.templates) }
            Button("New Folder…") { window?.go(.folders) }
            Divider()
            Button("New Tab") { openWindow(id: "main", value: WindowSeed(start: .home, asTab: true)) }
                .keyboardShortcut("t")
            Button("New Window") { openWindow(id: "main", value: WindowSeed(start: .home, asTab: false)) }
                .keyboardShortcut("n", modifiers: [.command, .shift])
            Button("Quick Add…") { QuickAdd.shared.show() }
                .keyboardShortcut("a", modifiers: [.command, .option, .control])
        }
        CommandGroup(after: .newItem) {
            Divider()
            Button("Open Inbox") { window?.go(.inbox) }
            if let id = window?.current.noteId {
                Button("Open Note in New Window") { openWindow(id: "main", value: WindowSeed(start: .note(id), asTab: false)) }
            }
        }
        CommandGroup(replacing: .printItem) {
            Button("Print…") { window?.noteMenu(.print) }
                .keyboardShortcut("p")
                .disabled(window?.current.isNote != true)
            Button("Export…") { window?.noteMenu(.export) }
                .keyboardShortcut("e", modifiers: [.command, .shift])
                .disabled(window?.current.isNote != true)
        }
        CommandGroup(after: .saveItem) {
            Button("Share…") { window?.noteMenu(.share) }
                .disabled(window?.current.isNote != true)
            Button("Copy Link") { if let id = window?.current.noteId { NoteActions.copyLink(id, title: window?.title ?? "") } }
                .keyboardShortcut("c", modifiers: [.command, .option])
                .disabled(window?.current.isNote != true)
        }

        // Edit: Find drives the note's own find when a note is on screen.
        CommandGroup(after: .textEditing) {
            Divider()
            Button("Find in Note…") { window?.findShown = true }
                .keyboardShortcut("f")
                .disabled(window?.current.isNote != true)
            Button("Find Next") { NotificationCenter.default.post(name: .coreFindNext, object: window) }
                .keyboardShortcut("g")
                .disabled(window?.findShown != true)
            Button("Find Previous") { NotificationCenter.default.post(name: .coreFindNext, object: window, userInfo: ["back": true]) }
                .keyboardShortcut("g", modifiers: [.command, .shift])
                .disabled(window?.findShown != true)
            Button("Search All Notes…") { window?.go(.search("")) }
                .keyboardShortcut("f", modifiers: [.command, .shift])
            Button("Command Palette…") { window?.paletteShown = true }
                .keyboardShortcut("k")
        }

        // Format: the editor's marks and blocks on the note on screen.
        CommandMenu("Format") {
            let state = window?.editorState
            let canEdit = window?.current.isNote == true && state?.canEdit != false
            Group {
                Button("Bold") { window?.format(.bold) }.keyboardShortcut("b")
                Button("Italic") { window?.format(.italic) }.keyboardShortcut("i")
                Button("Underline") { window?.format(.underline) }.keyboardShortcut("u")
                Button("Strikethrough") { window?.format(.strike) }.keyboardShortcut("x", modifiers: [.command, .shift])
                Button("Code") { window?.format(.code) }.keyboardShortcut("e")
                Button("Highlight") { window?.format(.highlight) }.keyboardShortcut("h", modifiers: [.command, .shift])
                Button("Link…") { window?.editor(EditorCommands.Link(LinkArgs(href: nil))) }.keyboardShortcut("k", modifiers: [.command, .shift])
            }
            .disabled(!canEdit)
            Divider()
            Menu("Text Style") {
                Button("Body") { window?.block(.paragraph) }.keyboardShortcut("0", modifiers: [.command, .option])
                Button("Heading 1") { window?.block(.heading1) }.keyboardShortcut("1", modifiers: [.command, .option])
                Button("Heading 2") { window?.block(.heading2) }.keyboardShortcut("2", modifiers: [.command, .option])
                Button("Heading 3") { window?.block(.heading3) }.keyboardShortcut("3", modifiers: [.command, .option])
                Divider()
                Button("Bulleted List") { window?.block(.bulleted) }.keyboardShortcut("8", modifiers: [.command, .shift])
                Button("Numbered List") { window?.block(.numbered) }.keyboardShortcut("7", modifiers: [.command, .shift])
                Button("To-Do") { window?.block(.todo) }.keyboardShortcut("l", modifiers: [.command, .shift])
                Button("Toggle") { window?.block(.toggle) }
                Button("Quote") { window?.block(.quote) }
                Button("Callout") { window?.block(.callout) }
                Button("Code Block") { window?.block(.code) }
            }
            .disabled(!canEdit)
            Button("Indent") { window?.editor(EditorCommands.Indent()) }.keyboardShortcut("]").disabled(!canEdit)
            Button("Outdent") { window?.editor(EditorCommands.Outdent()) }.keyboardShortcut("[").disabled(!canEdit)
            Divider()
            Button("Move Block Up") { window?.editor(EditorCommands.BlockMove(BlockMoveArgs(dir: .up))) }.keyboardShortcut(.upArrow, modifiers: [.command, .option]).disabled(!canEdit)
            Button("Move Block Down") { window?.editor(EditorCommands.BlockMove(BlockMoveArgs(dir: .down))) }.keyboardShortcut(.downArrow, modifiers: [.command, .option]).disabled(!canEdit)
            Button("Duplicate Block") { window?.editor(EditorCommands.BlockDuplicate()) }.keyboardShortcut("d").disabled(!canEdit)
            Divider()
            Button("Insert…") { window?.panel(.insert) }.keyboardShortcut("/", modifiers: [.command]).disabled(!canEdit)
            Button("Style and Theme…") { window?.panel(.style) }.disabled(window?.current.isNote != true)
        }

        // View
        CommandGroup(before: .sidebar) {
            Button("as List") { window?.listStyle = .list }.keyboardShortcut("1")
            Button("as Cards") { window?.listStyle = .cards }.keyboardShortcut("2")
            Divider()
            Button(window?.inspectorShown == true ? "Hide Inspector" : "Show Inspector") { window?.inspectorShown.toggle() }
                .keyboardShortcut("0", modifiers: [.command, .option])
            Button("Focus Mode") { window?.editor(EditorCommands.FocusToggle()) }
                .keyboardShortcut("f", modifiers: [.command, .control, .shift])
                .disabled(window?.current.isNote != true)
            Button("Note Info") { window?.inspectorTab = .info; window?.inspectorShown = true }
                .keyboardShortcut("i", modifiers: [.command, .option])
                .disabled(window?.current.isNote != true)
            Divider()
        }
        SidebarCommands()
        InspectorCommands()
        ToolbarCommands()

        // Go
        CommandMenu("Go") {
            Button("Back") { window?.back() }.keyboardShortcut("[").disabled(window?.canGoBack != true)
            Button("Forward") { window?.forward() }.keyboardShortcut("]").disabled(window?.canGoForward != true)
            Divider()
            Button("Home") { window?.select(.home) }.keyboardShortcut("h", modifiers: [.command, .shift])
            Button("Search") { window?.select(.search("")) }
            Button("Foli AI") { window?.select(.foliAI(nil)) }.keyboardShortcut("j", modifiers: [.command, .shift])
            Button("Notifications") { window?.select(.notifications) }.keyboardShortcut("y", modifiers: [.command, .shift])
            Button("Inbox") { window?.select(.inbox) }
            Button("Tasks") { window?.select(.tasks(.today)) }.keyboardShortcut("t", modifiers: [.command, .shift])
            Button("Calendar") { window?.select(.calendar(nil)) }.keyboardShortcut("k", modifiers: [.command, .control])
            Button("Today's Note") { window?.select(.daily(nil)) }.keyboardShortcut("d", modifiers: [.command, .shift])
            Divider()
            Button("All Notes") { window?.select(.allNotes) }.keyboardShortcut("a", modifiers: [.command, .shift])
            Button("Recent") { window?.select(.recent) }.keyboardShortcut("r", modifiers: [.command, .shift])
            Button("Starred") { window?.select(.starred) }
            Button("Shared with Me") { window?.select(.shared) }
            Button("Drafts") { window?.select(.drafts) }
            Button("Changes") { window?.select(.changes) }
            Button("Templates") { window?.select(.templates) }
            Button("Folders") { window?.select(.folders) }
            Button("Tags") { window?.select(.tags) }
            Divider()
            Button("Foli DNA") { window?.select(.graph) }
            Button("Reviews") { window?.select(.reviews) }
            Button("Vault") { window?.select(.vault) }
            Button("Archive") { window?.select(.archive) }
            Button("Trash") { window?.select(.trash) }
        }

        // Note
        CommandMenu("Note") {
            let isNote = window?.current.isNote == true
            if let window, isNote {
                let starred = window.noteMeta?.starred ?? false
                Button(starred ? "Remove Star" : "Star") {
                    if let id = window.current.noteId {
                        app.perform { _ = try await $0.command(Commands.NoteStar(NoteStarArgs(ids: [id], starred: !starred))) }
                        window.toggleStarLocally()
                    }
                }
                .keyboardShortcut("s", modifiers: [.command, .option])
                Divider()
                NoteMoreMenu(window: window)
                Divider()
                Button("Ask Foli AI About This Note") { window.inspectorTab = .foliAI; window.inspectorShown = true }
                    .keyboardShortcut("j", modifiers: [.command, .option])
                Button("Comments") { window.panel(.comments) }.keyboardShortcut("m", modifiers: [.command, .option])
                Button("Related Notes") { window.panel(.related) }
            } else {
                Button("Open a note to see its commands") {}.disabled(true)
            }
        }

        CommandGroup(replacing: .help) {
            Button("Folevi Core Help") { NSWorkspace.shared.open(URL(string: "https://folevi.com/help")!) }
            Button("What's New") { NSWorkspace.shared.open(URL(string: "https://folevi.com/changelog")!) }
            Divider()
            Button("Contact Support…") { NSWorkspace.shared.open(URL(string: "https://folevi.com/support")!) }
        }
        CommandGroup(after: .appSettings) {
            Button(Updater.shared.menuTitle ?? "Check for Updates…") { Updater.shared.menuAction() }
                .disabled(!Updater.enabled)
        }
    }
}
