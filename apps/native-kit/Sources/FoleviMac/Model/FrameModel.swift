// One Mac window's frame state (docs/NATIVE_APP_PLAN.md section 4.5): its tabs and history, the live values the
// sidebar and bars show (session, home, folders, sync status, places), what the note page says about itself
// (note.meta, editor.state, editor.panel), toasts, and every action the frame offers. All data comes from the
// window's EngineClient (its Page View); native holds no authority. The views (FrameViews) only draw this and
// call its actions; the app (apps/mac) implements `FrameHost` for what belongs to the app (places, Settings,
// windows, sign-in).
import Foundation
import Observation
import FoleviEngine

/// What the frame asks of the app around it.
@MainActor
public protocol FrameHost: AnyObject {
    /// Settings window (a section id from the web's Settings, or nil for the last one).
    func frameOpenSettings(section: String?)
    /// Opens another place in this Mac's windows (and a space in it).
    func frameSwitchPlace(_ place: String, space: String?)
    func frameSignInAnotherAccount()
    func frameSignOut(place: String)
    /// Sign out without asking again (the screen already warned about unsynced changes and the person confirmed).
    func frameSignOutConfirmed(place: String)
    /// A file a notification delivers (an export).
    func frameDownloadFile(_ id: String)
    func frameMoveOrCopy()
    func frameOpenHelp()
    func frameOpenExternal(_ url: URL)
    func frameOpenInNewWindow(_ route: FrameRoute)
    /// Tabs or the route changed (window restoration saves).
    func frameStateChanged()
}

public struct FrameToast: Identifiable, Equatable, Sendable {
    public enum Tone: Sendable { case info, success, error }
    public let id: UUID
    public var message: String
    public var tone: Tone
    public var actionTitle: String?
    /// What the button does (opaque to views).
    let action: Action?

    enum Action: Sendable {
        case engine(String)
        case undo(ToastUndo)
        case retrySync
        /// A screen's own button (FoleviScreens' ScreenToast).
        case run(@MainActor @Sendable () -> Void)
    }

    public static func == (a: FrameToast, b: FrameToast) -> Bool { a.id == b.id }
}

/// Back and forward through the routes this window showed (⌘[ and ⌘]).
public struct RouteHistory: Equatable, Sendable {
    public private(set) var items: [FrameRoute] = [.home]
    public private(set) var index = 0
    public static let limit = 100

    public init() {}

    public var current: FrameRoute { items[index] }
    public var canGoBack: Bool { index > 0 }
    public var canGoForward: Bool { index < items.count - 1 }

    public mutating func push(_ route: FrameRoute) {
        guard route != current else { return }
        items.removeSubrange((index + 1)...)
        items.append(route)
        if items.count > Self.limit { items.removeFirst(items.count - Self.limit) }
        index = items.count - 1
    }

    public mutating func back() -> FrameRoute? {
        guard canGoBack else { return nil }
        index -= 1
        return items[index]
    }

    public mutating func forward() -> FrameRoute? {
        guard canGoForward else { return nil }
        index += 1
        return items[index]
    }

    /// A note that's gone (Trash) leaves the history.
    public mutating func forget(_ route: FrameRoute) {
        let cur = current
        items.removeAll { $0 == route }
        if items.isEmpty { items = [.home] }
        index = items.lastIndex(of: cur) ?? (items.count - 1)
    }
}

@MainActor
@Observable
public final class FrameModel {
    public let client: EngineClient
    public let tabs = TabsModel()
    public private(set) var history = RouteHistory()
    @ObservationIgnored public weak var host: (any FrameHost)?

    // Live values (the engine's views).
    public let session: ValueStore<SessionValue>
    public let home: ValueStore<HomeValue>
    public let folders: ValueStore<FoldersTreeValue>
    public let sync: ValueStore<SyncStatusValue>
    public let places: ValueStore<PlacesValue>

    /// What the note page said about each note it showed (titles, star, access), by id.
    public private(set) var noteMeta: [String: NoteMeta] = [:]
    public private(set) var editorState: EditorStateEvent?
    public private(set) var editorPanel: EditorPanel?
    /// What each note's own sidebar shows (`note.tools`, revision 14), by note id.
    public private(set) var noteTools: [String: NoteToolsEvent] = [:]
    /// The note the Page View shows now (after note.show answered).
    public private(set) var shownNote: String?
    /// Which full-screen web gate the page shows (sign in, onboarding, lock), as `gate.changed` says.
    /// Nil while the engine is up; "loading" while it isn't attached (signed out, switching places, a lock).
    public private(set) var gate: String?
    /// The whole last `gate.changed` (its words, fields and buttons), for the native gate screen.
    public var gateEvent: GateChangedEvent? { gateSeen ? lastGateEvent : client.hello?.gate }
    private var lastGateEvent: GateChangedEvent?
    public private(set) var toasts: [FrameToast] = []
    /// Notifications (`notifications.list`): nil until the engine answers.
    public private(set) var notifications: NotificationsValue?
    public private(set) var notificationsUnavailable = false

    /// The sidebar is collapsed (⌘\, View > Hide Sidebar).
    public var sidebarCollapsed = false
    #if DEBUG
    /// Each tab's frame in the window (top-left points), for scripts that click and drag tabs.
    @ObservationIgnored public var debugTabFrames: [String: CGRect] = [:]
    #endif

    /// Titles of the note tabs (`notes.meta`, revision 8), so restored tabs and notes renamed elsewhere stay current.
    @ObservationIgnored private var tabMeta: ValueStore<NotesMetaValue>?
    @ObservationIgnored private var tabMetaIds: [String] = []
    @ObservationIgnored private var tabMetaObserver: Task<Void, Never>?

    @ObservationIgnored private var eventsTask: Task<Void, Never>?
    @ObservationIgnored private var closeNoteTask: Task<Void, Never>?
    /// How long a note stays mounted in the Page View after a native screen comes in front (plan 2.4).
    @ObservationIgnored public var keepNoteMounted: Duration = .seconds(30)

    public init(client: EngineClient) {
        self.client = client
        session = client.watch(.session, snapshotKey: "session")
        home = client.watch(.home(), snapshotKey: "home")
        folders = client.watch(.foldersTree(), snapshotKey: "folders.tree")
        sync = client.watch(.syncStatus)
        places = client.watch(.placesList, snapshotKey: "places.list")
        client.start()
        eventsTask = Task { [weak self] in
            guard let stream = self?.client.events() else { return }
            for await event in stream {
                guard let self else { return }
                self.handle(event)
            }
        }
    }

    /// Ends the model's work (the window closed).
    public func stop() {
        eventsTask?.cancel()
        closeNoteTask?.cancel()
        tabMetaObserver?.cancel()
        tabMeta?.cancel()
        session.cancel()
        home.cancel()
        folders.cancel()
        sync.cancel()
        places.cancel()
    }

    public var route: FrameRoute { tabs.activeRoute }
    /// The engine is up and no gate screen is asked for: the native frame shows (otherwise the page's own gate
    /// screens do, full window). Before any `gate.changed`, hello's `gate` says (revision 3).
    public var isEngineReady: Bool {
        guard client.state == .ready else { return false }
        return (gateSeen ? gate : client.hello?.gate.gate) == nil
    }

    private var gateSeen = false

    /// The sidebar's sections now.
    public var sidebar: [SidebarNode] { SidebarModel.sections(session: session.value, home: home.value, tree: folders.value) }

    /// The meta of the note on screen (nil on native screens).
    public var activeNote: NoteMeta? { route.noteId.flatMap { noteMeta[$0] } }

    /// The place and space for the sidebar's header and the account button.
    public var spaceName: String {
        guard let s = session.value else { return "Folevi" }
        if s.mode == .local { return "On this Mac" }
        return s.spaces.first { $0.id == s.space }?.name ?? "Personal"
    }

    public var accountName: String {
        guard let s = session.value else { return "" }
        return s.profile.name.isEmpty ? s.profile.email : s.profile.name
    }

    /// Unread notifications in the open place (from places.list until the notifications view answers).
    public var unreadCount: Int {
        if let n = notifications { return n.unread }
        guard let p = places.value else { return 0 }
        return p.places.first { $0.id == p.current }?.unread ?? 0
    }

    // MARK: navigation

    /// Shows a route in this window (its own tab, or the one it has).
    public func open(_ route: FrameRoute, _ opening: TabsModel.Opening = .newTab, title: String? = nil, icon: String? = nil) {
        let shown = tabs.show(route, opening)
        if let title { tabs.setTitle(title, icon: icon, for: shown.tabKey) }
        if opening != .history { history.push(shown) }
        routeChanged()
    }

    public func goBack() {
        guard let r = history.back() else { return }
        open(r, .history)
    }

    public func goForward() {
        guard let r = history.forward() else { return }
        open(r, .history)
    }

    public func selectTab(_ id: String) {
        guard let r = tabs.select(id: id) else { return }
        history.push(r)
        routeChanged()
    }

    public func selectTab(number n: Int) {
        guard let r = tabs.select(number: n) else { return }
        history.push(r)
        routeChanged()
    }

    public func nextTab(_ step: Int = 1) {
        history.push(tabs.selectNext(step))
        routeChanged()
    }

    public func closeTab(_ id: String? = nil) {
        if let r = tabs.close(id ?? tabs.activeID) { history.push(r) }
        routeChanged()
    }

    public func closeOtherTabs(_ id: String) {
        if let r = tabs.closeOthers(id) { history.push(r) }
        routeChanged()
    }

    public func closeTabsToTheRight(of id: String) {
        if let r = tabs.closeToTheRight(of: id) { history.push(r) }
        routeChanged()
    }

    public func reopenClosedTab() {
        guard let r = tabs.reopenClosed() else { return }
        history.push(r)
        routeChanged()
    }

    public func moveTab(_ id: String, to index: Int) {
        tabs.move(id, to: index)
        host?.frameStateChanged()
    }

    /// Restores this window's tabs (window restoration).
    public func restore(_ saved: TabsModel.Saved) {
        tabs.restore(saved)
        history = RouteHistory()
        history.push(tabs.activeRoute)
        routeChanged()
    }

    /// The route on screen changed: the Page View shows the note (or lets it go a little later).
    private func routeChanged() {
        host?.frameStateChanged()
        if let id = route.noteId {
            closeNoteTask?.cancel()
            closeNoteTask = nil
            guard shownNote != id else { return }
            shownNote = id
            Task { [weak self] in
                guard let self else { return }
                do {
                    _ = try await self.client.editor(.noteShow(id: id))
                    if let meta = try? await self.client.query(.noteMeta(id: id)) { self.took(meta) }
                } catch let f as EngineFailure {
                    if self.shownNote == id { self.shownNote = nil }
                    if f.code != BridgeErrorCode.engineNotReady.rawValue { self.toast(f.message, tone: .error) }
                } catch {}
            }
        } else if shownNote != nil, closeNoteTask == nil {
            let wait = keepNoteMounted
            closeNoteTask = Task { [weak self] in
                try? await Task.sleep(for: wait)
                guard let self, !Task.isCancelled, self.route.noteId == nil else { return }
                self.closeNoteTask = nil
                self.shownNote = nil
                _ = try? await self.client.editor(.noteClose)
            }
        }
        updateViewTitles()
    }

    /// Folder and tag tabs take their names from the tree.
    private func updateViewTitles() {
        watchTabTitles()
        guard let tree = folders.value else { return }
        for t in tabs.tabs {
            switch t.route {
            case .folder(let id): if let f = tree.folders.first(where: { $0.id == id }) { tabs.setTitle(f.name, for: t.id) }
            case .tag(let id): if let g = tree.tags.first(where: { $0.id == id }) { tabs.setTitle("#\(g.name)", for: t.id) }
            default: break
            }
        }
    }

    /// Keeps a `notes.meta` view on the note tabs (one subscription for all of them, up to 200).
    private func watchTabTitles() {
        let ids = Array(tabs.tabs.compactMap { $0.route.noteId }.prefix(200))
        guard ids != tabMetaIds else { return }
        tabMetaIds = ids
        tabMeta?.cancel()
        tabMetaObserver?.cancel()
        guard !ids.isEmpty else { tabMeta = nil; return }
        let store = client.watch(.notesMeta(ids: ids))
        tabMeta = store
        tabMetaObserver = Task { [weak self, weak store] in
            while !Task.isCancelled {
                guard let self, let store else { return }
                self.applyTabMeta(store.value)
                await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
                    withObservationTracking { _ = store.value } onChange: { c.resume() }
                }
            }
        }
    }

    func applyTabMeta(_ value: NotesMetaValue?) {
        for n in value?.notes ?? [] where n.found {
            tabs.setTitle(n.title.isEmpty ? "Untitled" : n.title, icon: n.icon, for: n.id)
            // A note moved to Trash elsewhere leaves the strip (unless it's on screen).
            if n.inTrash, route.noteId != n.id { _ = tabs.forget(noteId: n.id) }
        }
    }

    /// Re-reads names after the tree changed (the view calls it from its observer).
    public func refreshTitles() { updateViewTitles() }

    // MARK: events

    func handle(_ event: EngineEvent) {
        switch event {
        case .engineReady:
            // A reloaded page shows no note: show the one on screen again.
            shownNote = nil
            gate = nil
            lastGateEvent = nil
            gateSeen = true
            routeChanged()
            loadNotifications()
        case .gateChanged(let e):
            gateSeen = true
            lastGateEvent = e
            gate = e.gate
            if e.gate == nil { routeChanged() }
        case .noteMeta(let meta):
            took(meta)
        case .noteReady(let e):
            if !e.title.isEmpty { tabs.setTitle(e.title, icon: noteMeta[e.id]?.icon, for: e.id) }
        case .editorState(let e):
            editorState = e
        case .editorPanel(let e):
            editorPanel = e.panel
        case .noteTools(let e):
            if noteTools[e.noteId] != e { noteTools[e.noteId] = e }
        case .navigateRequest(let e):
            if e.external, let url = URL(string: e.route) {
                host?.frameOpenExternal(url)
            } else {
                // A link inside a note replaces the note's tab; a link to a screen opens its tab.
                let r = FrameRoute(path: e.noteId.map { "/d/\($0)" } ?? e.route)
                open(r, r.isNote && route.isNote && !e.newTab ? .replace : .newTab)
            }
        case .toast(let e):
            var action: FrameToast.Action?
            var title: String?
            if let a = e.action {
                action = .engine(a.id)
                title = a.label
            } else if let u = e.undo {
                action = .undo(u)
                title = "Undo"
            }
            push(FrameToast(id: UUID(), message: e.message, tone: e.tone == .error ? .error : e.tone == .success ? .success : .info, actionTitle: title, action: action))
        case .placeChanged:
            // Another space: its notes, folders and tabs. The views follow on their own; tabs of the old space's
            // notes stay (the web keeps tabs per space; native keeps them per window for now).
            shownNote = nil
            routeChanged()
        case .syncStatus, .memoryRelieved, .unknown:
            break
        }
    }

    private func took(_ meta: NoteMeta) {
        noteMeta[meta.id] = meta
        if meta.found { tabs.setTitle(meta.title.isEmpty ? "Untitled" : meta.title, icon: meta.icon, for: meta.id) }
        if meta.inTrash, route.noteId != meta.id { _ = tabs.forget(noteId: meta.id) }
    }

    // MARK: toasts

    public func toast(_ message: String, tone: FrameToast.Tone = .info, actionTitle: String? = nil, action: (@MainActor @Sendable () -> Void)? = nil) {
        push(FrameToast(id: UUID(), message: message, tone: tone, actionTitle: action == nil ? nil : actionTitle, action: action.map { .run($0) }))
    }

    private func push(_ t: FrameToast) {
        toasts.append(t)
        if toasts.count > 3 { toasts.removeFirst(toasts.count - 3) }
        let id = t.id
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(t.actionTitle == nil ? 4 : 7))
            self?.dismissToast(id)
        }
    }

    public func dismissToast(_ id: UUID) { toasts.removeAll { $0.id == id } }

    /// The toast's button.
    public func runToastAction(_ toast: FrameToast) {
        dismissToast(toast.id)
        switch toast.action {
        case .engine(let id): perform { try await self.client.command(.toastAction(id: id)) }
        case .undo(let u): undo(u)
        case .retrySync: retrySync()
        case .run(let f): f()
        case nil: break
        }
    }

    /// Runs a toast's undo command (the commands the engine attaches undo to).
    private func undo(_ u: ToastUndo) {
        let args = JSONValue.object(u.args)
        func decode<A: Decodable>(_: A.Type) -> A? { (try? JSONEncoder().encode(args)).flatMap { try? JSONDecoder().decode(A.self, from: $0) } }
        switch u.command {
        case .noteStar: if let a = decode(NoteStarArgs.self) { perform { try await self.client.command(Commands.NoteStar(a)) } }
        case .noteArchive: if let a = decode(NoteArchiveArgs.self) { perform { try await self.client.command(Commands.NoteArchive(a)) } }
        case .noteMove: if let a = decode(NoteMoveArgs.self) { perform { try await self.client.command(Commands.NoteMove(a)) } }
        case .noteTrash: if let a = decode(NoteIdsArgs.self) { perform { try await self.client.command(Commands.NoteTrash(a)) } }
        case .noteRestore: if let a = decode(NoteIdsArgs.self) { perform { try await self.client.command(Commands.NoteRestore(a)) } }
        default: toast("That can't be undone from here.", tone: .error)
        }
    }

    // MARK: actions

    /// Runs an engine call; a refusal shows its message as a toast.
    public func perform(_ work: @escaping @MainActor () async throws -> Void) {
        Task { @MainActor in
            do { try await work() } catch let f as EngineFailure {
                let unknown = [BridgeErrorCode.unknownCommand.rawValue, BridgeErrorCode.unknownView.rawValue].contains(f.code)
                self.toast(unknown ? "That isn't available in this version yet." : f.message, tone: .error)
            } catch {
                self.toast("Something went wrong. Try again.", tone: .error)
            }
        }
    }

    /// New note (⌘N, "+"): in the folder on screen, else Drafts; opens it in a new tab ready to type.
    public func newNote(in folderId: String? = nil, template: String? = nil) {
        let folder = folderId ?? { if case .folder(let id) = route { return id } else { return nil } }()
        perform {
            let r = try await self.client.command(.noteCreate(folderId: folder, templateId: template))
            self.open(.note(r.id), title: "Untitled")
            _ = try? await self.client.editor(.noteShow(id: r.id, focus: true))
        }
    }

    /// A note made from text (Services, Shortcuts): its first line the title, the rest the body. Opens it.
    @discardableResult
    public func newNote(text: String) async throws -> String {
        let r = try await client.command(.noteCreate(text: text))
        open(.note(r.id))
        return r.id
    }

    /// A task in the Inbox (Shortcuts' Add Task); natural dates are the engine's.
    public func addTask(text: String, dueDate: String?) async throws -> TaskCreateResult {
        try await client.command(.taskCreate(text: text, dueDate: dueDate))
    }

    /// A banner's action (reply, read, done, snooze-hour, snooze-evening, snooze-tomorrow).
    public func notificationAction(id: String, action: String, text: String?, thread: String?) {
        perform { _ = try await self.client.command(.notificationAct(id: id, action: action, text: text, thread: thread)) }
    }

    /// Settings > Appearance from the View menu.
    public func setAppearance(_ a: SettingsUpdateArgs.Appearance) {
        perform { _ = try await self.client.command(.settingsUpdate(appearance: a)) }
    }

    public func newFolder(name: String = "New folder", parent: String? = nil) {
        perform { _ = try await self.client.command(.folderCreate(name: name, parentId: parent)) }
    }

    public func star(_ ids: [String], _ on: Bool) {
        perform { _ = try await self.client.command(.noteStar(ids: ids, starred: on)) }
    }

    public func archive(_ ids: [String], _ on: Bool = true) {
        perform { _ = try await self.client.command(.noteArchive(ids: ids, archived: on)) }
    }

    public func trash(_ ids: [String]) {
        perform {
            _ = try await self.client.command(.noteTrash(ids: ids))
            for id in ids {
                self.history.forget(.note(id))
                if let r = self.tabs.forget(noteId: id) { self.history.push(r) }
            }
            self.routeChanged()
        }
    }

    public func move(notes ids: [String], to folderId: String?) {
        perform { _ = try await self.client.command(.noteMove(ids: ids, folderId: folderId)) }
    }

    /// Nests, un-nests or reorders a folder (refused here first by the web's rules, so a drag never offers a move
    /// the engine would refuse).
    public func move(folder id: String, into parent: String?, after: String?) {
        if let refusal = FolderTree(folders.value?.folders ?? []).canMove(id, into: parent) {
            switch refusal {
            case .selfTarget, .descendant: toast("A folder can't go inside itself.", tone: .error)
            case .tooDeep: toast("Folders nest up to \(FolderTree.maxDepth) levels.", tone: .error)
            }
            return
        }
        perform { _ = try await self.client.command(.folderMove(id: id, parentId: parent, afterId: after)) }
    }

    /// Switches the space inside this place (Personal or a workspace).
    public func switchSpace(_ space: SpaceRef) {
        perform { _ = try await self.client.command(.spaceSwitch(space: space)) }
    }

    public func refresh() {
        perform { _ = try await self.client.command(.engineRefresh) }
    }

    public func retrySync() { refresh() }

    public func runCatchUp() {
        perform { _ = try await self.client.command(.catchUpRun()) }
    }

    // MARK: the note on screen

    /// Touch-down on a card (plan 4.2): the Page View starts drawing the note before the click ends.
    public func prepare(_ id: String) {
        guard shownNote != id, route.noteId == nil else { return }
        Task { [weak self] in _ = try? await self?.client.editor(.notePrepare(id: id)) }
    }

    public func editor<E: EngineEditorSpec>(_ command: E) {
        guard route.isNote else { return }
        perform { _ = try await self.client.editor(command) }
    }

    /// The note's "..." menu actions: native commands where the engine has them, the note page otherwise.
    public func noteMenu(_ action: NoteMenuAction) { editor(.noteMenu(action: action)) }

    public var focusMode: Bool { editorState?.focus ?? false }
    public var noteLocked: Bool { editorState?.locked ?? false }
    public var canLockNote: Bool { editorState?.canLock ?? false }

    /// The floating Ask Foli AI chat (⌘J off a note and off the AI page; FoliAI/AiAskPanel.swift).
    public var askAiOpen = false

    /// ⌘J: on a note its own Foli AI panel (in the note page), on the AI page its box, elsewhere the floating chat.
    public func askAI() {
        if route.isNote { return toggleNoteAI() }
        if route.tabKey == "view:ai" { return NotificationCenter.default.post(name: Self.focusAiComposer, object: nil) }
        askAiOpen.toggle()
    }

    /// Asks the AI page's box to take the keys.
    public static let focusAiComposer = Notification.Name("FoleviAiFocusComposer")

    /// The Foli AI toggle on a note: its web panel opens or closes.
    public func toggleNoteAI() {
        if editorPanel == .ai { editor(.panelClose) } else { editor(.ai(action: .open)) }
    }

    // MARK: notifications

    public func loadNotifications() {
        Task { [weak self] in
            guard let self else { return }
            do {
                self.notifications = try await self.client.query(.notificationsList)
                self.notificationsUnavailable = false
            } catch {
                self.notificationsUnavailable = true
            }
        }
    }

    public func markNotificationsRead(_ ids: [String]) {
        perform {
            _ = try await self.client.command(.notificationMarkRead(ids: ids, read: true))
            self.loadNotifications()
        }
    }

    public func markAllNotificationsRead() {
        perform {
            _ = try await self.client.command(.notificationMarkAllRead)
            self.loadNotifications()
        }
    }
}
