// A note: Folevi's web editor (the page lent by the pool, already warm) inside the app's native window. Around it
// everything is native: the toolbar (bookmark, the note's menu, the window's Ask Foli AI), Find (⌘F, the page's
// own matches driven natively), Focus Mode, the inspector (Foli AI and the note's outline, links, tasks,
// attachments and comments), and the breadcrumb of where the note lives.
import AppKit
import FoleviDesign
import FoleviEngine
import SwiftUI
import WebKit

struct NoteScreen: View {
    let window: WindowModel
    let id: String
    private var app: AppModel { .shared }

    var body: some View {
        VStack(spacing: 0) {
            if window.findShown {
                FindBar(window: window)
                    .motionTransition(.move(edge: .top).combined(with: .opacity))
                    .zIndex(1)
            }
            ZStack {
                PageHostView(page: window.page)
                    .accessibilityLabel("Note")
                if !window.noteReady {
                    NotePlaceholder(title: window.noteMeta?.title)
                        .transition(.opacity)
                        .allowsHitTesting(false)
                }
            }
            .appAnimation(Motion.fade, value: window.noteReady)
        }
        // On the stack that stays, so the bar's leaving animates too.
        .appAnimation(Motion.bar, value: window.findShown)
        .clipped()
        .background(Color(nsColor: .textBackgroundColor))
        .sheet(isPresented: Binding(get: { window.sharingNote == id }, set: { if !$0 { window.sharingNote = nil } })) { NoteSharingSheet(noteId: id) }
        .onChange(of: window.editorState?.focus) { _, on in
            // Focus Mode: the page hides its own chrome; the app hides the sidebar and the inspector with it.
            Motion.run(Motion.column) {
                window.columnVisibility = on == true ? .detailOnly : .all
                if on == true { window.inspectorShown = false }
            }
        }
    }
}

/// While the page prepares the note's first frame: the title in the page's type, nothing else.
struct NotePlaceholder: View {
    var title: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text(title?.nonEmpty ?? " ")
                .font(AppType.screenTitle(34))
                .foregroundStyle(.primary.opacity(0.85))
            ForEach(0..<4, id: \.self) { i in
                RoundedRectangle(cornerRadius: 4).fill(.quaternary).frame(width: [420, 380, 440, 260][i], height: 12)
            }
            Spacer()
        }
        .padding(.top, 72)
        .frame(maxWidth: 720, maxHeight: .infinity, alignment: .topLeading)
        .frame(maxWidth: .infinity)
        .background(Color(nsColor: .textBackgroundColor))
    }
}

/// Hosts a page's web view in the SwiftUI layout. The same view moves between windows as the pool lends it.
struct PageHostView: NSViewRepresentable {
    let page: Page?

    func makeNSView(context: Context) -> HostView { HostView() }

    func updateNSView(_ host: HostView, context: Context) {
        host.show(page?.view)
    }

    static func dismantleNSView(_ host: HostView, coordinator: ()) {
        host.show(nil)
    }

    final class HostView: NSView {
        private weak var shown: WKWebView?

        func show(_ view: WKWebView?) {
            guard view !== shown else { return }
            if let shown, shown.superview === self { shown.removeFromSuperview() }
            shown = view
            guard let view else { return }
            view.removeFromSuperview()
            view.frame = bounds
            view.autoresizingMask = [.width, .height]
            addSubview(view)
            // The page takes the keyboard once it's in the window.
            DispatchQueue.main.async { [weak view] in
                guard let view, let window = view.window, window.firstResponder === window || window.firstResponder == nil else { return }
                window.makeFirstResponder(view)
            }
        }

        override func layout() {
            super.layout()
            shown?.frame = bounds
        }
    }
}

/// The note's part of the window's bar: the place chip (where the note lives) before the title, then star, the
/// note's menu and the inspector in one capsule.
struct NoteBarChip: View {
    let window: WindowModel

    var body: some View {
        if let crumbs = window.noteMeta?.breadcrumbs, let folder = window.noteMeta?.folder {
            Menu {
                Button("Open \(folder.name)") { window.go(.folder(folder.id)) }
                ForEach(crumbs, id: \.id) { c in Button(c.title.nonEmpty ?? "Untitled") { window.go(.note(c.id), inNote: true) } }
            } label: {
                Label { Text(folder.name).lineLimit(1) } icon: { FolderMark(colorId: folder.color, size: 13) }
                    .labelStyle(.titleAndIcon)
            }
            .help("Where this note is")
            .fixedSize()
        }
    }
}

struct NoteBarActions: View {
    let window: WindowModel
    private var app: AppModel { .shared }

    var body: some View {
        if let id = window.current.noteId {
            let starred = window.noteMeta?.starred ?? false
            Button {
                app.perform { _ = try await $0.command(Commands.NoteStar(NoteStarArgs(ids: [id], starred: !starred))) }
                window.toggleStarLocally()
            } label: {
                Label { Text(starred ? "Remove Bookmark" : "Bookmark") } icon: { (starred ? WebIcon.bookmarkOff : WebIcon.bookmark).image(size: 16) }
            }
            .help(starred ? "Remove Bookmark" : "Bookmark")

            Menu {
                NoteMoreMenu(window: window)
            } label: {
                Label { Text("More") } icon: { WebIcon.ellipsis.image(size: 16) }
            }
            .help("More")
        }
        Button {
            Motion.run(Motion.column) {
                window.inspectorTab = .info
                window.inspectorShown.toggle()
            }
        } label: {
            Label { Text("Note Info") } icon: { WebIcon.info.image(size: 16) }
        }
        .help(window.inspectorShown ? "Hide Note Info" : "Show Note Info")
    }
}

/// The note's menu (the toolbar's More, the menu bar's Note menu): what the page says it offers now.
struct NoteMoreMenu: View {
    let window: WindowModel
    private var app: AppModel { .shared }
    @Environment(\.openWindow) private var openWindow

    private var offered: Set<NoteMenuAction> { Set(window.editorState?.menu?.actions ?? NoteMenuAction.allCases) }

    var body: some View {
        if offered.contains(.move), let id = window.current.noteId { Button("Move To…") { window.pickFolder(.moveNotes, [id]) } }
        if offered.contains(.copyTo), let id = window.current.noteId { Button("Copy To…") { window.pickFolder(.copyNotes, [id]) } }
        if offered.contains(.duplicate) { Button("Duplicate") { window.noteMenu(.duplicate) } }
        Divider()
        if let id = window.current.noteId {
            Button("Share…") { window.sharingNote = id }
            Button(window.noteMeta?.archived == true ? "Unarchive" : "Archive") {
                let archived = window.noteMeta?.archived == true
                app.perform { _ = try await $0.command(Commands.NoteArchive(NoteArchiveArgs(ids: [id], archived: !archived))) }
            }
            Button("Foli DNA of This Note") { window.graphCenter = id; window.go(.graph) }
        }
        Divider()
        Button("Find in Note") { window.findShown = true }
        Button(window.editorState?.focus == true ? "Leave Focus Mode" : "Focus Mode") { window.editor(EditorCommands.FocusToggle()) }
        if window.editorState?.canLock == true {
            Button(window.editorState?.locked == true ? "Unlock Note" : "Lock Note") { window.editor(EditorCommands.NoteLock()) }
        }
        Button("Style and Theme…") { window.panel(.style) }
        Button("Comments") { window.panel(.comments) }
        if offered.contains(.history) { Button("Version History…") { window.noteMenu(.history) } }
        Divider()
        if offered.contains(.present) { Button("Present") { window.noteMenu(.present) } }
        if offered.contains(.export) { Button("Export…") { window.noteMenu(.export) } }
        if offered.contains(.print) { Button("Print…") { window.noteMenu(.print) } }
        if offered.contains(.saveAsTemplate) { Button("Save as Template") { window.noteMenu(.saveAsTemplate) } }
        if offered.contains(.moveToVault) { Button("Move to Vault…") { window.noteMenu(.moveToVault) } }
        if offered.contains(.readImages), let n = window.editorState?.menu?.readImages, n > 0 { Button("Read Text in Images") { window.noteMenu(.readImages) } }
        if offered.contains(.showEditors) { Button(window.editorState?.menu?.showingEditors == true ? "Hide Who Edited" : "Show Who Edited") { window.noteMenu(.showEditors) } }
        Divider()
        if let id = window.current.noteId {
            Button("Copy Link") { NoteActions.copyLink(id, title: window.title) }
            Button("Open in New Tab") { app.open(.note(id), newTab: true) }
            Button("Float on Top") { openWindow(id: "float", value: id) }
        }
        Divider()
        if offered.contains(.delete) { Button("Move to Trash", role: .destructive) { window.noteMenu(.delete) }.keyboardShortcut(.delete, modifiers: .command) }
    }
}

/// Find in the note (⌘F): a native field over the page; matches are the page's, shown as the page highlights
/// them. Return and ⌘G go to the next, ⇧⌘G to the previous.
struct FindBar: View {
    let window: WindowModel
    @State private var query = ""
    @State private var result: FindResult?
    @State private var index = 0
    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
            TextField("Find in Note", text: $query)
                .textFieldStyle(.plain)
                .focused($focused)
                .onAppear { if let seed = window.findSeed { query = seed; window.findSeed = nil } }
                .onChange(of: window.findSeed) { if let seed = window.findSeed { query = seed; window.findSeed = nil } }
                .onSubmit { step(1) }
                .onChange(of: query) { _, q in find(q, index: 0) }
            if let r = result, !query.isEmpty {
                Text(r.count == 0 ? "Not found" : "\(r.current + 1) of \(r.count)\(r.truncated ? "+" : "")")
                    .font(.callout).monospacedDigit().foregroundStyle(.secondary)
            }
            ControlGroup {
                Button { step(-1) } label: { Image(systemName: "chevron.up") }.help("Previous (⇧⌘G)")
                Button { step(1) } label: { Image(systemName: "chevron.down") }.help("Next (⌘G)")
            }
            .controlSize(.regular)
            .frame(width: 64)
            .disabled((result?.count ?? 0) == 0)
            Button("Done") { close() }.controlSize(.regular).keyboardShortcut(.cancelAction)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
        .background(.bar)
        .overlay(alignment: .bottom) { Divider() }
        .onAppear { focused = true }
        .onReceive(NotificationCenter.default.publisher(for: .appFindNext)) { n in
            if (n.object as? WindowModel) === window { step((n.userInfo?["back"] as? Bool) == true ? -1 : 1) }
        }
    }

    private func find(_ q: String, index: Int) {
        guard let page = window.page else { return }
        Task {
            let r = try? await page.client.editor(EditorCommands.Find(FindArgs(query: q, index: q.isEmpty ? nil : index)))
            result = r
            self.index = r?.current ?? 0
        }
    }

    private func step(_ d: Int) {
        guard let r = result, r.count > 0 else { return }
        find(query, index: (index + d + r.count) % r.count)
    }

    private func close() {
        window.findShown = false
        window.editor(EditorCommands.FindClear())
    }
}

extension Notification.Name {
    static let appFindNext = Notification.Name("com.folevi.findNext")
}

extension WindowModel {
    /// The star shows its new state at once; the engine's note.meta confirms it.
    func toggleStarLocally() {
        guard var meta = noteMeta else { return }
        meta.starred.toggle()
        setNoteMeta(meta)
    }
}

/// A floating note's window: the note page alone, with its title, above every other window.
struct FloatingNote: View {
    let id: String
    @State private var window: WindowModel
    /// Keep on top (floating, on every Space) or a normal window.
    @State private var onTop = true

    init(id: String) {
        self.id = id
        _window = State(initialValue: WindowModel(start: .note(id)))
    }

    var body: some View {
        NoteScreen(window: window, id: id)
            .navigationTitle(window.title)
            .background(WindowAccessor(model: window, asTab: false))
            .focusedSceneValue(\.window, window)
            .onAppear { window.start() }
            .frame(minWidth: 320, minHeight: 300)
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button { onTop.toggle(); apply() } label: { Image(systemName: onTop ? "pin.fill" : "pin") }
                        .help(onTop ? "Stop Keeping on Top" : "Keep on Top")
                        .accessibilityLabel(onTop ? "Stop Keeping on Top" : "Keep on Top")
                }
            }
            .task { try? await Task.sleep(for: .milliseconds(100)); apply() }
            .onAppear { FloatingNotes.opened(id) }
            .onDisappear { FloatingNotes.closed(id) }
    }

    private func apply() {
        guard let w = window.window else { return }
        w.level = onTop ? .floating : .normal
        w.collectionBehavior = onTop ? [.canJoinAllSpaces, .fullScreenAuxiliary] : [.managed]
    }
}


/// Floating notes open at quit open again at launch (SwiftUI may bring some back itself; none opens twice).
@MainActor
enum FloatingNotes {
    private static let key = "core.floatingNotes"
    private static var open: Set<String> = []
    private static var restored = false
    private static var quitting = false

    static func opened(_ id: String) {
        open.insert(id)
        save()
    }

    static func closed(_ id: String) {
        open.remove(id)
        // Quitting closes every window: what was open at that moment is what comes back.
        if !quitting { save() }
    }

    private static func save() { UserDefaults.standard.set(Array(open), forKey: key) }

    static func restoreOnce(_ openWindow: OpenWindowAction) {
        guard !restored else { return }
        restored = true
        NotificationCenter.default.addObserver(forName: NSApplication.willTerminateNotification, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { quitting = true }
        }
        let saved = UserDefaults.standard.stringArray(forKey: key) ?? []
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(1.5))
            for id in saved where !open.contains(id) { openWindow(id: "float", value: id) }
        }
    }
}
