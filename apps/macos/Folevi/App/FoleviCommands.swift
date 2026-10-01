import SwiftUI

/// Menus: File, Edit (Find), Format, Block, View, Help, routed to the focused window's navigation
/// and editor models.
struct FoleviCommands: Commands {
    let app: AppModel
    @FocusedValue(\.navigation) private var nav
    @FocusedValue(\.editor) private var editor
    @Environment(\.openWindow) private var openWindow

    private var ready: Bool { app.phase == .ready }
    private var canEdit: Bool { editor.map { !$0.isReadOnly } ?? false }

    private func newNote() {
        let folderId = nav?.currentFolderId
        Task {
            guard let id = await app.createDocument(folderId: folderId) else { return }
            if let nav { nav.open(id, newTab: true) } else { openWindow(id: "document", value: id) }
        }
    }

    private func quickAdd() {
        if NSApp.keyWindow?.isMainWindow == true, nav != nil {
            app.showQuickAdd = true
        } else {
            openWindow(id: "quickAdd")
        }
    }

    var body: some Commands {
        CommandGroup(replacing: .newItem) {
            // A new note starts in the open folder, as on the web (⌘⌥N there).
            Button("New Document") { newNote() }
                .keyboardShortcut("n")
                .disabled(!ready)
            Button("New Note") { newNote() }
                .keyboardShortcut("n", modifiers: [.command, .option])
                .disabled(!ready)
            Button("New Window") { openWindow(id: "main") }
                .keyboardShortcut("n", modifiers: [.command, .shift])
            Divider()
            Button("Open Quickly…") { app.showCommandPalette = true }
                .keyboardShortcut("k")
                .disabled(!ready)
            // ⇧⌘A, as on the web: the Quick add dialog in the window (its own small window when no Folevi
            // window is in front).
            Button("Quick Add Task…") { quickAdd() }
                .keyboardShortcut("a", modifiers: [.command, .shift])
                .disabled(!ready)
            Button("Quick Add Task (Alternate)") { quickAdd() }
                .keyboardShortcut(.space, modifiers: [.control, .option])
                .disabled(!ready)
            Divider()
            Button("Import Markdown…") {
                ExportService.importMarkdown(app: app) { id in
                    if let id { nav?.open(id) }
                }
            }
            .disabled(!ready)
            Menu("Export") {
                // The page menu's exports (doc/export.ts on the web).
                Button("Export as Markdown") { if let editor { ExportService.exportPage(.markdown, editor: editor) } }
                Button("Export as HTML") { if let editor { ExportService.exportPage(.html, editor: editor) } }
                Button("Export as PDF (print)") { if let editor { ExportService.exportPage(.pdf, editor: editor) } }
            }
            .disabled(editor == nil)
            Button("Open in New Window") {
                if let id = editor?.documentId { openWindow(id: "document", value: id) }
            }
            .keyboardShortcut("o", modifiers: [.command, .option])
            .disabled(editor == nil)
        }

        CommandGroup(after: .textEditing) {
            Button("Find in Document") {
                editor?.findShowsReplace = false
                nav?.showFind = true
                editor?.page.findFocusToken = UUID()
            }
                .keyboardShortcut("f")
                .disabled(editor == nil)
            Button("Find and Replace…") {
                editor?.findShowsReplace = true
                nav?.showFind = true
                editor?.page.findFocusToken = UUID()
            }
                .keyboardShortcut("f", modifiers: [.command, .option])
                .disabled(editor == nil || !canEdit)
            Button("Find Next") { editor?.findNext() }
                .keyboardShortcut("g")
                .disabled(editor == nil)
            Button("Find Previous") { editor?.findNext(backwards: true) }
                .keyboardShortcut("g", modifiers: [.command, .shift])
                .disabled(editor == nil)
            Divider()
            // ⌘J: in a note's text, the AI composer (the title's AI in the title); anywhere else, Ask AI.
            Button("Ask AI…") {
                let textView = NSApp.keyWindow?.firstResponder as? BlockTextView
                if let editor, editor.aiWritable, textView != nil || !editor.selectedBlockIds.isEmpty {
                    editor.aiShortcut(from: textView)
                } else {
                    NotificationCenter.default.post(name: .foleviToggleAskAi, object: nil)
                }
            }
            .keyboardShortcut("j")
            .disabled(!ready || !app.aiAvailable)
        }

        CommandMenu("Format") {
            Button("Bold") { editor?.toggleMark(.bold) }.keyboardShortcut("b")
            Button("Italic") { editor?.toggleMark(.italic) }.keyboardShortcut("i")
            Button("Underline") { editor?.toggleMark(.underline) }.keyboardShortcut("u")
            Button("Strikethrough") { editor?.toggleMark(.strike) }.keyboardShortcut("x", modifiers: [.command, .shift])
            Button("Inline Code") { editor?.toggleMark(.code) }.keyboardShortcut("e")
            Button("Link…") { editor?.beginLink() }.keyboardShortcut("k", modifiers: [.command, .shift])
            Menu("Text Color") {
                Button("Default") { editor?.setColor(nil) }
                ForEach(TextColor.allCases, id: \.self) { c in
                    Button(c.rawValue.capitalized) { editor?.setColor(c) }
                }
            }
            Menu("Highlight") {
                Button("None") { editor?.setHighlight(nil) }
                ForEach(HighlightColor.allCases, id: \.self) { c in
                    Button(c.rawValue.capitalized) { editor?.setHighlight(c) }
                }
            }
            // No shortcut, as on the web: ⌘\ shows and hides the sidebar.
            Button("Clear Formatting") { editor?.clearFormatting() }
            Divider()
            Menu("Turn Into") {
                ForEach(TurnIntoOption.all) { option in
                    Button(option.title) { editor?.turnInto(option.id) }
                        .keyboardShortcut(option.shortcut, modifiers: [.command, .option])
                }
            }
        }

        CommandMenu("Block") {
            Button("Indent") { if let e = editor { e.indent(e.commandTargets) } }
                .keyboardShortcut("]")
                .disabled(!canEdit)
            Button("Outdent") { if let e = editor { e.outdent(e.commandTargets) } }
                .keyboardShortcut("[")
                .disabled(!canEdit)
            Divider()
            Button("Move Up") { if let e = editor { e.move(e.commandTargets, up: true) } }
                .keyboardShortcut(.upArrow, modifiers: [.option, .shift])
                .disabled(!canEdit)
            Button("Move Down") { if let e = editor { e.move(e.commandTargets, up: false) } }
                .keyboardShortcut(.downArrow, modifiers: [.option, .shift])
                .disabled(!canEdit)
            Divider()
            Button("Duplicate") { if let e = editor { e.duplicate(e.commandTargets) } }
                .keyboardShortcut("d")
                .disabled(!canEdit)
            Button("Delete Block") { if let e = editor { e.delete(e.commandTargets) } }
                .keyboardShortcut(.delete, modifiers: [.command, .shift])
                .disabled(!canEdit)
            Divider()
            Button("Comment") { editor?.comments.commentOnFocusedBlock() }
                .keyboardShortcut("m", modifiers: [.command, .option])
                .disabled(editor == nil)
            Divider()
            Button("Version History…") { nav?.showHistory = true }
                .disabled(editor == nil)
        }

        CommandGroup(replacing: .sidebar) {
            // The web's shortcuts: ⌘\ sidebar, ⌥⌘I inspector, ⌥⌘T Tasks · Today.
            Button(nav?.sidebarVisible == false ? "Show Sidebar" : "Hide Sidebar") { if let nav { withSidebarAnimation { nav.toggleSidebar() } } }
                .keyboardShortcut("\\", modifiers: [.command])
            Button(nav?.focusMode == true ? "Exit Focus Mode" : "Focus Mode") {
                if let nav { withSidebarAnimation { nav.setFocusMode(!nav.focusMode) } }
            }
            Button("Toggle Inspector") { nav?.showInspector.toggle() }
                .keyboardShortcut("i", modifiers: [.command, .option])
            Button("Go to Tasks") { nav?.show(.tasks) }
                .keyboardShortcut("t", modifiers: [.command, .option])
                .disabled(nav == nil || !ready)
            Divider()
            Button("Zoom In") { app.zoomIn() }.keyboardShortcut("+")
            Button("Zoom Out") { app.zoomOut() }.keyboardShortcut("-")
            Button("Actual Size") { app.zoomReset() }.keyboardShortcut("0")
            Menu("Appearance") {
                ForEach(AppearancePreference.allCases) { p in
                    Toggle(isOn: Binding(get: { app.appearance == p }, set: { if $0 { app.appearance = p } })) { Text(p.title) }
                }
            }
            Divider()
            Button("Go Back") { nav?.goBack() }
                .keyboardShortcut("[", modifiers: [.command, .control])
                .disabled(!(nav?.canGoBack ?? false))
            Button("Go Forward") { nav?.goForward() }
                .keyboardShortcut("]", modifiers: [.command, .control])
                .disabled(!(nav?.canGoForward ?? false))
            #if DEBUG
            Divider()
            Toggle("Force Offline (Debug)", isOn: Binding(get: { app.sync.forcedOffline }, set: { v in Task { await app.setForcedOffline(v) } }))
                .keyboardShortcut("o", modifiers: [.command, .control, .option])
            #endif
        }

        CommandGroup(replacing: .help) {
            Button("Folevi Help") { app.showHelp = true }
                .keyboardShortcut("?", modifiers: [.command])
            Link("Folevi Guide on the Web", destination: URL(string: "https://folevi.com/help") ?? URL(fileURLWithPath: "/"))
        }
    }
}
