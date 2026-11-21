// One Folevi Core window (or window tab): where it is, its history (Back and Forward, as Safari's), and the
// note it shows. The note's page is lent by the pool while the note is on screen and given back when the window
// leaves it, hides or closes.
import AppKit
import FoleviEngine
import Observation
import SwiftUI

@MainActor
@Observable
final class WindowModel: Identifiable {
    let id = UUID()
    let app: AppModel

    /// Where the window is now.
    private(set) var current: Destination
    private(set) var backStack: [Destination] = []
    private(set) var forwardStack: [Destination] = []
    /// The sidebar row that's selected: the place itself, or the list a note was opened from.
    var sidebarSelection: Destination? = .home

    /// The page the note shows in, while one is on screen.
    private(set) var page: Page?
    /// The note page's state, from its page's events.
    private(set) var editorState: EditorStateEvent?
    private(set) var noteTools: NoteToolsEvent?
    private(set) var noteMeta: NoteMeta?
    private(set) var editorPanel: EditorPanel?
    /// The note's first frame is drawn (the placeholder goes).
    private(set) var noteReady = false

    var inspectorShown = false
    var inspectorTab: InspectorTab = .foliAI
    var findShown = false
    var paletteShown = false
    var columnVisibility: NavigationSplitViewVisibility = .all
    /// The list's search field (the toolbar's search), per window.
    var filterText = ""
    /// A new note opened: its title takes the caret once it shows.
    var focusNoteSoon = false
    /// The inspector's Foli AI chat (about the note on screen).
    var inspectorChat: String?
    /// The folder whose sharing sheet is up.
    var sharingFolder: String?
    /// The note whose sharing popover is up.
    var sharingNote: String?
    /// Lists as cards (gallery) or rows, per window (View > as Cards / as List).
    var listStyle: ListStyleChoice = .list

    enum ListStyleChoice: String, CaseIterable { case list, cards }

    @ObservationIgnored weak var window: NSWindow?
    @ObservationIgnored private var pageEvents: Task<Void, Never>?
    @ObservationIgnored private var visible = true
    @ObservationIgnored private var hideTask: Task<Void, Never>?

    enum InspectorTab: String, CaseIterable, Identifiable {
        case foliAI, info
        var id: String { rawValue }
        var title: String { self == .foliAI ? "Foli AI" : "Info" }
    }

    init(app: AppModel = .shared, start: Destination = .home) {
        self.app = app
        current = start
        sidebarSelection = start.isNote ? nil : start
        app.register(self)
        if start.isNote { Task { await self.enterNote() } }
    }

    // MARK: navigation

    var canGoBack: Bool { !backStack.isEmpty }
    var canGoForward: Bool { !forwardStack.isEmpty }

    /// Goes to `dest`, keeping the way back.
    func go(_ dest: Destination) {
        guard dest != current else { return }
        backStack.append(current)
        if backStack.count > 200 { backStack.removeFirst() }
        forwardStack.removeAll()
        move(to: dest)
    }

    /// A sidebar choice: the place itself, from the sidebar.
    func select(_ dest: Destination?) {
        guard let dest else { return }
        sidebarSelection = dest
        go(dest)
    }

    /// Where the window is, without a history step.
    func replace(with dest: Destination) {
        guard dest != current else { return }
        move(to: dest)
    }

    func back() {
        guard let prev = backStack.popLast() else { return }
        forwardStack.append(current)
        move(to: prev)
    }

    func forward() {
        guard let next = forwardStack.popLast() else { return }
        backStack.append(current)
        move(to: next)
    }

    private func move(to dest: Destination) {
        let wasNote = current.isNote
        current = dest
        if !dest.isNote { sidebarSelection = dest }
        if dest.isNote {
            Task { await enterNote() }
        } else if wasNote {
            leaveNote()
        }
        window?.title = title
    }

    /// The place's pages were made again (a switch): back to Home with no history.
    func reset() {
        leaveNote()
        backStack.removeAll()
        forwardStack.removeAll()
        current = .home
        sidebarSelection = .home
    }

    /// The engine page's client changed: a note on screen opens again in the new page.
    func engineChanged() {
        guard current.isNote else { return }
        page = nil
        Task { await enterNote() }
    }

    var title: String {
        if current.isNote { return noteMeta?.title.nonEmpty ?? noteTools?.title.nonEmpty ?? "Untitled" }
        return current.title
    }

    // MARK: the note

    private func enterNote() async {
        guard let id = current.noteId else { return }
        guard let page = app.pool.editor(for: self.id) else { return }
        if self.page !== page {
            self.page = page
            listen(page)
        }
        noteReady = page.shownNote == id
        if page.shownNote != id { noteTools = nil; editorState = nil }
        noteMeta = nil
        let focus = focusNoteSoon
        focusNoteSoon = false
        await page.show(note: id, focus: focus)
        noteReady = true
        if let meta = try? await app.client?.query(Views.NoteMeta(NoteIdArgs(id: id))), current.noteId == id {
            noteMeta = meta
            window?.title = title
        }
    }

    private func leaveNote() {
        pageEvents?.cancel()
        pageEvents = nil
        page = nil
        editorState = nil
        noteTools = nil
        noteMeta = nil
        noteReady = false
        app.pool.giveBack(from: id)
    }

    private func listen(_ page: Page) {
        pageEvents?.cancel()
        let isEngine = page.kind == .engine
        pageEvents = Task { @MainActor [weak self] in
            for await event in page.client.events() {
                guard let self, !Task.isCancelled else { return }
                switch event {
                case .editorState(let s): self.editorState = s
                case .noteTools(let t): self.noteTools = t
                case .noteMeta(let m) where m.id == self.current.noteId:
                    self.noteMeta = m
                    self.window?.title = self.title
                case .noteReady(let r) where r.id == self.current.noteId: self.noteReady = true
                case .editorPanel(let p): self.editorPanel = p.panel
                case .navigateRequest(let n) where !isEngine:
                    if n.external, let url = URL(string: n.route) { NSWorkspace.shared.open(url) } else { self.app.open(path: n.route, newTab: n.newTab) }
                case .toast(let t) where !isEngine: self.app.toast(t)
                default: break
                }
            }
        }
    }

    /// The window hid (a background tab, minimized, closed): its page goes back after a moment.
    func setVisible(_ on: Bool) {
        guard on != visible else { return }
        visible = on
        hideTask?.cancel()
        if on {
            if current.isNote, page == nil { Task { await enterNote() } }
        } else if current.isNote {
            hideTask = Task { @MainActor [weak self] in
                try? await Task.sleep(for: .seconds(20))
                guard let self, !Task.isCancelled, !self.visible else { return }
                self.pageEvents?.cancel()
                self.page = nil
                self.app.pool.giveBack(from: self.id)
            }
        }
    }

    func closed() {
        leaveNote()
        app.unregister(self)
    }

    // MARK: the editor

    func editor<E: EngineEditorSpec>(_ command: E) {
        guard let page else { return }
        Task { _ = try? await page.client.editor(command) }
    }

    func format(_ mark: EditorMark) { editor(EditorCommands.Format(FormatArgs(mark: mark, block: nil))) }

    func block(_ block: EditorBlock) { editor(EditorCommands.Format(FormatArgs(mark: nil, block: block))) }

    func noteMenu(_ action: NoteMenuAction) { editor(EditorCommands.NoteMenu(NoteMenuArgs(action: action))) }

    func panel(_ panel: EditorPanel) { editor(EditorCommands.PanelOpen(PanelOpenArgs(panel: panel))) }

    func setNoteMeta(_ meta: NoteMeta) {
        noteMeta = meta
        window?.title = title
    }
}

extension String {
    var nonEmpty: String? { isEmpty ? nil : self }
}

/// What a new window opens on, and whether it joins the front window as a tab.
struct WindowSeed: Codable, Hashable {
    var start: Destination
    var asTab: Bool
    var token = UUID()
}
