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
            Button("New Note") {
                // On Tasks, ⌘N adds a task (Quick Add in the window), as today's app does.
                if let window, case .tasks = window.current { window.quickAddShown = true } else { NoteActions.newNote(app: app, window: window, newTab: window == nil) }
            }
                .keyboardShortcut("n")
            Button("New Note from Template…") { window?.go(.templates) }.keyboardShortcut("n", modifiers: [.command, .option, .shift])
            Divider()
            // A new tab starts at Search, its field focused, with recent searches and notes (today's New Tab
            // opens Home with search focused).
            Button("New Tab") { openWindow(id: "main", value: WindowSeed(start: .search(""), asTab: true)) }
                .keyboardShortcut("t")
            Button("New Window") { openWindow(id: "main", value: WindowSeed(start: .home, asTab: false)) }
                .keyboardShortcut("n", modifiers: [.command, .shift])
            Button("Quick Add Task…") { if let window { window.quickAddShown = true } else { QuickAdd.shared.show() } }
                .keyboardShortcut("a", modifiers: [.command, .shift])
            QuickAddAnywhereItem()
            Button("Reopen Closed Tab") { app.reopenClosedTab() }
                .keyboardShortcut("t", modifiers: [.command, .shift])
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
            Button("New Folder…") { window?.newFolderRequested = true }
                .keyboardShortcut("n", modifiers: [.command, .control])
                .disabled(window == nil)
            Button("Import Notes…") { SettingsRouter.shared.open("data") }
        }
        CommandGroup(after: .saveItem) {
            Menu("Share") {
                Button("Share with People…") { window?.sharingNote = window?.current.noteId }
                if let url = window?.current.noteId.map(NoteActions.webURL) ?? ShareTarget.current?.url {
                    Divider()
                    ForEach(NSSharingService.sharingServices(forItems: [url]), id: \.title) { service in
                        Button { service.perform(withItems: [url]) } label: { Label { Text(service.title) } icon: { Image(nsImage: service.image) } }
                    }
                }
            }
                .disabled(window?.current.isNote != true)
            Button("Copy Link") { if let id = window?.current.noteId { NoteActions.copyLink(id, title: window?.title ?? "") } }
                .keyboardShortcut("c", modifiers: [.command, .option])
                .disabled(window?.current.isNote != true)
        }

        // Edit: Find drives the note's own find when a note is on screen.
        CommandGroup(after: .textEditing) {
            // On a note: its find bar. Elsewhere: Search, its field ready.
            Button(window?.current.isNote == true ? "Find in Note…" : "Find…") {
                guard let window else { return }
                if window.current.isNote { window.findShown = true } else if window.current.hasFilter { window.filterFocus += 1 } else { window.go(.search("")) }
            }
            .keyboardShortcut("f")
            .disabled(window == nil)
            Button("Find Next") { NotificationCenter.default.post(name: .coreFindNext, object: window) }
                .keyboardShortcut("g")
                .disabled(window?.findShown != true)
            Button("Use Selection for Find") {
                guard let window, let page = window.page else { return }
                page.view.evaluateJavaScript("String(window.getSelection() || '')") { r, _ in
                    MainActor.assumeIsolated {
                        guard let s = r as? String, !s.isEmpty else { return }
                        window.findSeed = s
                        window.findShown = true
                    }
                }
            }
            .disabled(window?.current.isNote != true)
            Button("Find Previous") { NotificationCenter.default.post(name: .coreFindNext, object: window, userInfo: ["back": true]) }
                .keyboardShortcut("g", modifiers: [.command, .shift])
                .disabled(window?.findShown != true)
            Button("Search All Notes…") { window?.go(.search("")) }
                .keyboardShortcut("f", modifiers: [.command, .shift])
            Button("Command Palette…") { window?.paletteShown = true }
                .keyboardShortcut("k")
            Divider()
            // The standard text menus, sent along the responder chain (the note's web view answers them).
            Menu("Spelling and Grammar") {
                TextAction("Show Spelling and Grammar", #selector(NSText.showGuessPanel(_:)), key: ":")
                TextAction("Check Document Now", #selector(NSText.checkSpelling(_:)), key: ";")
                Divider()
                TextAction("Check Spelling While Typing", #selector(NSTextView.toggleContinuousSpellChecking(_:)))
                TextAction("Check Grammar With Spelling", #selector(NSTextView.toggleGrammarChecking(_:)))
                TextAction("Correct Spelling Automatically", #selector(NSTextView.toggleAutomaticSpellingCorrection(_:)))
            }
            Menu("Substitutions") {
                TextAction("Show Substitutions", #selector(NSTextView.orderFrontSubstitutionsPanel(_:)))
                Divider()
                TextAction("Smart Copy/Paste", #selector(NSTextView.toggleSmartInsertDelete(_:)))
                TextAction("Smart Quotes", #selector(NSTextView.toggleAutomaticQuoteSubstitution(_:)))
                TextAction("Smart Dashes", #selector(NSTextView.toggleAutomaticDashSubstitution(_:)))
                TextAction("Smart Links", #selector(NSTextView.toggleAutomaticLinkDetection(_:)))
                TextAction("Text Replacement", #selector(NSTextView.toggleAutomaticTextReplacement(_:)))
            }
            Menu("Transformations") {
                TextAction("Make Upper Case", #selector(NSResponder.uppercaseWord(_:)))
                TextAction("Make Lower Case", #selector(NSResponder.lowercaseWord(_:)))
                TextAction("Capitalize", #selector(NSResponder.capitalizeWord(_:)))
            }
            Menu("Speech") {
                TextAction("Start Speaking", #selector(NSTextView.startSpeaking(_:)))
                TextAction("Stop Speaking", #selector(NSTextView.stopSpeaking(_:)))
            }
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
                Button("Highlight") { window?.format(.highlight) }
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
            Button("Indent") { window?.editor(EditorCommands.Indent()) }.keyboardShortcut("]", modifiers: [.command, .option]).disabled(!canEdit)
            Button("Outdent") { window?.editor(EditorCommands.Outdent()) }.keyboardShortcut("[", modifiers: [.command, .option]).disabled(!canEdit)
            Divider()
            Button("Move Block Up") { window?.editor(EditorCommands.BlockMove(BlockMoveArgs(dir: .up))) }.keyboardShortcut(.upArrow, modifiers: [.command, .option]).disabled(!canEdit)
            Button("Move Block Down") { window?.editor(EditorCommands.BlockMove(BlockMoveArgs(dir: .down))) }.keyboardShortcut(.downArrow, modifiers: [.command, .option]).disabled(!canEdit)
            Button("Duplicate Block") { window?.editor(EditorCommands.BlockDuplicate()) }.keyboardShortcut("d").disabled(!canEdit)
            Divider()
            Button("Insert…") { window?.panel(.insert) }.keyboardShortcut("/", modifiers: [.command]).disabled(!canEdit)
            Button("Style and Theme…") { window?.panel(.style) }.disabled(window?.current.isNote != true)
        }

        // View
        CommandGroup(replacing: .sidebar) {}
        CommandGroup(before: .sidebar) {
            Button("as List") { window?.listStyle = .list }.keyboardShortcut("1", modifiers: [.command, .control])
            Button("as Cards") { window?.listStyle = .cards }.keyboardShortcut("2", modifiers: [.command, .control])
            Button("as Compact Cards") { window?.listStyle = .compact }.keyboardShortcut("3", modifiers: [.command, .control])
            Divider()
            Button(window?.inspectorShown == true ? "Hide Inspector" : "Show Inspector") { window?.inspectorShown.toggle() }
                .keyboardShortcut("i", modifiers: [.command, .option])
            Button("Focus Mode") { window?.editor(EditorCommands.FocusToggle()) }
                .keyboardShortcut("f", modifiers: [.command, .control, .shift])
                .disabled(window?.current.isNote != true)
            Button("Note Info") { window?.inspectorTab = .info; window?.inspectorShown = true }
            Button("Reload") { app.perform { _ = try await $0.command(Commands.EngineRefresh()) } }.keyboardShortcut("r")
            Divider()
            Menu("Appearance") {
                ForEach([("light", "Light"), ("dark", "Dark"), ("system", "Match System")], id: \.0) { v in
                    Button(v.1) { app.perform { _ = try await $0.command(Commands.SettingsUpdate(SettingsUpdateArgs(name: nil, appearance: .init(rawValue: v.0), timeZone: nil, reviewAppEdits: nil, aiEnabled: nil, editorZoom: nil))) } }
                }
            }
            Button("Actual Size") { PageZoom.set(1) }.keyboardShortcut("0")
            Button("Zoom In") { PageZoom.step(1) }.keyboardShortcut("+")
            Button("Zoom Out") { PageZoom.step(-1) }.keyboardShortcut("-")
                .disabled(window?.current.isNote != true)
            Divider()
        }
        // Window > Show Tab 1…9 (⌘1 to ⌘9; ⌘9 the last), as Safari.
        CommandGroup(before: .windowList) {
            ForEach(1..<10) { n in
                Button(n == 9 ? "Show Last Tab" : "Show Tab \(n)") { TabNumbers.show(n) }
                    .keyboardShortcut(KeyEquivalent(Character("\(n)")), modifiers: .command)
            }
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
            Button("Ask Foli AI") {
                guard let window else { return }
                if window.current.isNote { window.editor(EditorCommands.Ai(AiArgs(action: .open, prompt: nil))) } else { withAnimation(.snappy) { window.askShown.toggle() } }
            }
            .keyboardShortcut("j")
            .disabled(app.session.value?.capabilities.ai == false)
            Button("Notifications") { window?.select(.notifications) }.keyboardShortcut("y", modifiers: [.command, .shift])
            Button("Inbox") { window?.select(.inbox) }
            Button("Tasks") { window?.select(.tasks(.today)) }.keyboardShortcut("t", modifiers: [.command, .control])
            Button("Today's Tasks") { window?.select(.tasks(.today)) }.keyboardShortcut("t", modifiers: [.command, .option])
            Button("Task Inbox") { window?.select(.tasks(.inbox)) }
            Button("Calendar") { window?.select(.calendar(nil)) }.keyboardShortcut("k", modifiers: [.command, .control])
            Button("Today's Note") { window?.select(.daily(nil)) }.keyboardShortcut("d", modifiers: [.command, .shift])
            Divider()
            Button("All Notes") { window?.select(.allNotes) }
            Button("Recent") { window?.select(.recent) }.keyboardShortcut("r", modifiers: [.command, .shift])
            Button("Starred") { window?.select(.starred) }
            Button("Shared with Me") { window?.select(.shared) }
            Button("Drafts") { window?.select(.drafts) }
            Button("Changes") { window?.select(.changes) }
            Button("Templates") { window?.select(.templates) }
            Button("Folders") { window?.select(.folders) }
            Button("Tags") { window?.select(.tags) }
            Divider()
            if app.session.value?.capabilities.graph != false { Button("Foli DNA") { window?.select(.graph) } }
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
                Button("Ask Foli AI About This Note") { window.editor(EditorCommands.Ai(AiArgs(action: .open, prompt: nil))) }
                    .keyboardShortcut("j", modifiers: [.command, .option])
                Button("Comments") { window.panel(.comments) }.keyboardShortcut("m", modifiers: [.command, .option])
                Button("Related Notes") { window.panel(.related) }
            } else {
                Button("Open a note to see its commands") {}.disabled(true)
            }
        }

        CommandGroup(replacing: .help) {
            Button("Folevi Core Help") { openWindow(id: "help") }.keyboardShortcut("?", modifiers: .command)
            Button("Keyboard Shortcuts") { openWindow(id: "shortcuts") }.keyboardShortcut("/", modifiers: [.command, .option])
            Button("Online Guide") { NSWorkspace.shared.open(URL(string: "https://folevi.com/docs")!) }
            Button("What's New") { NSWorkspace.shared.open(URL(string: "https://folevi.com/changelog")!) }
            Divider()
            Button("Send Feedback…") { SupportWindow.show() }
            Button("Contact Support…") { SettingsActions.contactSupport() }
        }
        CommandGroup(replacing: .appInfo) {
            // The version alone, never a build number.
            Button("About Folevi Core") {
                let v = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
                NSApp.orderFrontStandardAboutPanel(options: [.applicationVersion: "Version \(v)", .version: ""])
            }
        }
        CommandGroup(after: .appSettings) {
            Button(Updater.shared.menuTitle ?? "Check for Updates…") { Updater.shared.menuAction() }
                .disabled(!Updater.enabled)
        }
    }
}

/// The front window's tabs by number.
@MainActor
enum TabNumbers {
    static func show(_ n: Int) {
        guard let key = NSApp.keyWindow, let tabs = key.tabbedWindows ?? [key] as [NSWindow]?, !tabs.isEmpty else { return }
        let target = n == 9 ? tabs.last : (n <= tabs.count ? tabs[n - 1] : nil)
        target?.makeKeyAndOrderFront(nil)
    }
}


/// Page zoom for note pages (View > Actual Size, Zoom In, Zoom Out): every editor page, kept on this Mac.
@MainActor
enum PageZoom {
    static let steps: [Double] = [0.75, 0.85, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]
    static var value: Double {
        get { let v = UserDefaults.standard.double(forKey: "core.pageZoom"); return v == 0 ? 1 : v }
        set { UserDefaults.standard.set(newValue, forKey: "core.pageZoom") }
    }

    static func set(_ z: Double) {
        value = z
        for p in AppModel.shared.pool.all { p.view.pageZoom = z }
    }

    static func step(_ d: Int) {
        let i = steps.firstIndex { $0 >= value - 0.001 } ?? 3
        set(steps[min(max(i + d, 0), steps.count - 1)])
    }
}


/// A menu item that sends a standard text action to whatever has focus.
struct TextAction: View {
    let title: String
    let action: Selector
    var key: Character?

    init(_ title: String, _ action: Selector, key: Character? = nil) {
        self.title = title
        self.action = action
        self.key = key
    }

    var body: some View {
        if let key {
            Button(title) { NSApp.sendAction(action, to: nil, from: nil) }.keyboardShortcut(KeyEquivalent(key), modifiers: .command)
        } else {
            Button(title) { NSApp.sendAction(action, to: nil, from: nil) }
        }
    }
}


/// File > Quick Add from Any App: the floating panel, with the person's own global shortcut beside it.
struct QuickAddAnywhereItem: View {
    var body: some View {
        let accel = DesktopSettings.current.quickAddShortcut
        if let (key, mods) = Self.parse(accel) {
            Button("Quick Add from Any App") { QuickAdd.shared.show() }.keyboardShortcut(key, modifiers: mods)
        } else {
            Button("Quick Add from Any App") { QuickAdd.shared.show() }
        }
    }

    /// "Alt+Space" as a key equivalent.
    static func parse(_ accel: String) -> (KeyEquivalent, EventModifiers)? {
        var parts = accel.components(separatedBy: "+")
        guard let key = parts.popLast(), !parts.isEmpty else { return nil }
        var mods: EventModifiers = []
        for p in parts {
            switch p {
            case "Command", "Cmd", "CommandOrControl", "CmdOrCtrl", "Super", "Meta": mods.insert(.command)
            case "Control", "Ctrl": mods.insert(.control)
            case "Alt", "Option": mods.insert(.option)
            case "Shift": mods.insert(.shift)
            default: return nil
            }
        }
        let k: KeyEquivalent
        switch key {
        case "Space": k = .space
        case "Return", "Enter": k = .return
        case "Tab": k = .tab
        case "Escape": k = .escape
        case "Up": k = .upArrow
        case "Down": k = .downArrow
        case "Left": k = .leftArrow
        case "Right": k = .rightArrow
        default:
            guard key.count == 1, let c = key.lowercased().first else { return nil }
            k = KeyEquivalent(c)
        }
        return (k, mods)
    }
}
