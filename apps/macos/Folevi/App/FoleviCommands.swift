import SwiftUI

/// Menus: File, Edit (Find), Format, Block, View, Help — routed to the focused window's navigation
/// and editor models.
struct FoleviCommands: Commands {
    let app: AppModel
    @FocusedValue(\.navigation) private var nav
    @FocusedValue(\.editor) private var editor
    @Environment(\.openWindow) private var openWindow

    private var ready: Bool { app.phase == .ready }
    private var canEdit: Bool { editor.map { !$0.isReadOnly } ?? false }

    var body: some Commands {
        CommandGroup(replacing: .newItem) {
            Button("New Document") {
                Task {
                    guard let id = await app.createDocument() else { return }
                    if let nav { nav.open(id) } else { openWindow(id: "document", value: id) }
                }
            }
            .keyboardShortcut("n")
            .disabled(!ready)
            Button("New Window") { openWindow(id: "main") }
                .keyboardShortcut("n", modifiers: [.command, .shift])
            Divider()
            Button("Open Quickly…") { app.showCommandPalette = true }
                .keyboardShortcut("k")
                .disabled(!ready)
            Button("Quick Add Task…") { openWindow(id: "quickAdd") }
                .keyboardShortcut("a", modifiers: [.command, .shift])
                .disabled(!ready)
            Button("Quick Add Task (Alternate)") { openWindow(id: "quickAdd") }
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
                ForEach(ExportService.Format.allCases) { format in
                    Button {
                        guard let editor else { return }
                        ExportService.export(format, title: editor.document?.displayTitle ?? String(localized: "Untitled"), blocks: editor.exportBlocks(), app: app)
                    } label: {
                        Text("Export as \(Text(format.title))…")
                    }
                }
            }
            .disabled(editor == nil)
            Button("Open in New Window") {
                if let id = editor?.documentId { openWindow(id: "document", value: id) }
            }
            .keyboardShortcut("o", modifiers: [.command, .option])
            .disabled(editor == nil)
        }

        CommandGroup(after: .textEditing) {
            Button("Find in Document") { nav?.showFind = true }
                .keyboardShortcut("f")
                .disabled(editor == nil)
            Button("Find Next") { editor?.findNext() }
                .keyboardShortcut("g")
                .disabled(editor == nil)
            Button("Find Previous") { editor?.findNext(backwards: true) }
                .keyboardShortcut("g", modifiers: [.command, .shift])
                .disabled(editor == nil)
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
            Button("Clear Formatting") { editor?.clearFormatting() }
                .keyboardShortcut("\\", modifiers: [.command])
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
            Button("Toggle Sidebar") { nav?.toggleSidebar() }
                .keyboardShortcut("s", modifiers: [.control, .command])
            Button("Toggle Inspector") { nav?.showInspector.toggle() }
                .keyboardShortcut("i", modifiers: [.command, .option])
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
