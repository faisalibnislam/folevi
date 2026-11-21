// A note: Folevi's web editor (the page lent by the pool, already warm) inside Core's native window. Around it
// everything is native: the toolbar (star, share, Foli AI, the note's menu), Find (⌘F, the page's own matches
// driven natively), Focus Mode, the inspector (Foli AI and the note's outline, links, tasks, attachments and
// comments), and the breadcrumb of where the note lives.
import AppKit
import FoleviDesign
import FoleviEngine
import SwiftUI
import WebKit

struct NoteScreen: View {
    let window: WindowModel
    let id: String
    @Environment(AppModel.self) private var app

    var body: some View {
        VStack(spacing: 0) {
            if window.findShown { FindBar(window: window) }
            ZStack {
                PageHostView(page: window.page)
                    .accessibilityLabel("Note")
                if !window.noteReady {
                    NotePlaceholder(title: window.noteMeta?.title)
                        .transition(.opacity)
                        .allowsHitTesting(false)
                }
            }
            .animation(.easeOut(duration: 0.15), value: window.noteReady)
        }
        .background(Color(nsColor: .textBackgroundColor))
        .sheet(isPresented: Binding(get: { window.sharingNote == id }, set: { if !$0 { window.sharingNote = nil } })) { NoteSharingSheet(noteId: id) }
        .onChange(of: window.editorState?.focus) { _, on in
            // Focus Mode: the page hides its own chrome; Core hides the sidebar and the inspector with it.
            withAnimation(.snappy) {
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
                .font(CoreType.screenTitle(34))
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

/// The note's toolbar items: the place chip (where the note lives), star, share, Foli AI and the inspector, the
/// note's menu.
struct NoteToolbar: ToolbarContent {
    let window: WindowModel
    @Environment(AppModel.self) private var app

    var body: some ToolbarContent {
        ToolbarItem(placement: .navigation) {
            if let crumbs = window.noteMeta?.breadcrumbs, let folder = window.noteMeta?.folder {
                Menu {
                    Button("Open \(folder.name)") { window.go(.folder(folder.id)) }
                    ForEach(crumbs, id: \.id) { c in Button(c.title.nonEmpty ?? "Untitled") { window.go(.note(c.id)) } }
                } label: {
                    Label { Text(folder.name) } icon: { FolderMark(colorId: folder.color, size: 13) }
                        .labelStyle(.titleAndIcon)
                }
                .help("Where this note is")
            }
        }
        ToolbarItemGroup(placement: .primaryAction) {
            if let id = window.current.noteId {
                let starred = window.noteMeta?.starred ?? false
                Button {
                    app.perform { _ = try await $0.command(Commands.NoteStar(NoteStarArgs(ids: [id], starred: !starred))) }
                    window.toggleStarLocally()
                } label: {
                    Label(starred ? "Remove Star" : "Star", systemImage: starred ? "star.fill" : "star")
                }
                .help(starred ? "Remove Star" : "Star")

                Button { window.sharingNote = id } label: { Label("Share", systemImage: "square.and.arrow.up") }
                    .help("Share")

                Menu {
                    NoteMoreMenu(window: window)
                } label: {
                    Label("More", systemImage: "ellipsis")
                }
                .help("More")
            }
        }
        ToolbarItem(placement: .primaryAction) {
            Button {
                withAnimation(.snappy) { window.inspectorShown.toggle() }
            } label: {
                Label("Inspector", systemImage: "sidebar.trailing")
            }
            .help(window.inspectorShown ? "Hide Inspector" : "Show Inspector")
        }
    }
}

/// The note's menu (the toolbar's More, the menu bar's Note menu): what the page says it offers now.
struct NoteMoreMenu: View {
    let window: WindowModel
    @Environment(AppModel.self) private var app

    private var offered: Set<NoteMenuAction> { Set(window.editorState?.menu?.actions ?? NoteMenuAction.allCases) }

    var body: some View {
        if offered.contains(.move) { Button("Move To…") { window.noteMenu(.move) } }
        if offered.contains(.copyTo) { Button("Copy To…") { window.noteMenu(.copyTo) } }
        if offered.contains(.duplicate) { Button("Duplicate") { window.noteMenu(.duplicate) } }
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
            Button("Open in New Window") { app.open(.note(id), newTab: true) }
        }
        Divider()
        if offered.contains(.delete) { Button("Move to Trash", role: .destructive) { window.noteMenu(.delete) } }
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
            .controlSize(.small)
            .frame(width: 64)
            .disabled((result?.count ?? 0) == 0)
            Button("Done") { close() }.controlSize(.small).keyboardShortcut(.cancelAction)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
        .background(.bar)
        .overlay(alignment: .bottom) { Divider() }
        .onAppear { focused = true }
        .onReceive(NotificationCenter.default.publisher(for: .coreFindNext)) { n in
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
    static let coreFindNext = Notification.Name("app.folevicore.findNext")
}

extension WindowModel {
    /// The star shows its new state at once; the engine's note.meta confirms it.
    func toggleStarLocally() {
        guard var meta = noteMeta else { return }
        meta.starred.toggle()
        setNoteMeta(meta)
    }
}
