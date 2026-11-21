// Folevi Core's app-wide state: the open place's engine (PagePool), the live values every window shares (the
// session, sync, the folder tree, places, counts), the gate the engine shows while it isn't ready (first launch,
// sign-in, unlocking, onboarding), toasts, and which window is in front. Native holds no authority: every value
// comes from the engine, every write is an engine command.
import AppKit
import FoleviEngine
import Observation
import SwiftUI

/// A message at the foot of a window (the engine's toasts and Core's own), with an optional action.
struct Toast: Identifiable, Equatable {
    let id = UUID()
    var message: String
    var tone: ToastEvent.Tone
    var actionLabel: String?
    var action: (@MainActor () -> Void)?

    static func == (a: Toast, b: Toast) -> Bool { a.id == b.id }
}

/// A live value of the engine, recreated when the engine page is made again (a place switch).
@MainActor
@Observable
final class Live<V: EngineViewSpec> {
    private(set) var store: ValueStore<V.Value>?
    @ObservationIgnored private var key: (ObjectIdentifier, V.Args)?

    var value: V.Value? { store?.value }
    var isLoading: Bool { store?.value == nil && store?.error == nil }
    var error: EngineError? { store?.error }

    init() {}

    /// Watches `spec` on `client` (no-op when it already does).
    func bind(_ client: EngineClient?, _ spec: V) {
        guard let client else { return }
        let k = (ObjectIdentifier(client), spec.args)
        if let key, key.0 == k.0, key.1 == k.1 { return }
        store?.cancel()
        key = k
        store = client.watch(spec)
    }

    func cancel() {
        store?.cancel()
        store = nil
        key = nil
    }
}

/// A live windowed list (All Notes, a folder, a tag...).
@MainActor
@Observable
final class LiveList<L: EngineListSpec> {
    private(set) var store: ListStore<L.Row>?
    @ObservationIgnored private var key: (ObjectIdentifier, L.Args)?

    var rows: [L.Row] { store?.rows ?? [] }
    var total: Int { store?.total ?? 0 }
    var isLoading: Bool { store == nil || (store?.rows.isEmpty == true && store?.isComplete == false) }

    func bind(_ client: EngineClient?, _ spec: L) {
        guard let client else { return }
        let k = (ObjectIdentifier(client), spec.args)
        if let key, key.0 == k.0, key.1 == k.1 { return }
        store?.cancel()
        key = k
        store = client.watchList(spec, window: ListWindow(start: 0, count: 300))
    }

    func cancel() {
        store?.cancel()
        store = nil
        key = nil
    }
}

@MainActor
@Observable
final class AppModel {
    static let shared = AppModel()

    let pool = PagePool.shared

    /// The open place's engine client (every window's native screens use it).
    var client: EngineClient? { pool.client }

    // Live values every window shares.
    let session = Live<Views.Session>()
    let sync = Live<Views.SyncStatus>()
    let tree = Live<Views.FoldersTree>()
    let places = Live<Views.PlacesList>()
    let taskCounts = Live<Views.TasksCounts>()
    let notifications = Live<Views.NotificationsList>()
    let changes = Live<Views.Changes>()
    /// Review cards (the sidebar's count, shown when there are some).
    let reviews = Live<Views.Reviews>()
    /// Whether a Vault is here (the sidebar shows its row only then, or when one can be set up).
    let vault = Live<Views.VaultSummary>()

    /// What the engine shows while it isn't ready (nil: ready).
    private(set) var gate: GateChangedEvent?
    /// The engine has said it's ready at least once for this page.
    private var readySeen = false
    /// The engine is up with no gate. Also true when the client turned ready before this model started listening
    /// (the `engine.ready` event isn't replayed), so a window never waits on a missed event.
    var ready: Bool { readySeen || (client?.state == .ready && gate == nil) }
    private(set) var toasts: [Toast] = []
    /// The windows, by id, and the one in front.
    @ObservationIgnored private var windows: [UUID: WeakWindow] = [:]
    private(set) var frontWindow: UUID?

    @ObservationIgnored private var eventTask: Task<Void, Never>?
    @ObservationIgnored private var boundClient: ObjectIdentifier?
    @ObservationIgnored private var started = false

    struct WeakWindow { weak var model: WindowModel? }

    // MARK: launch

    /// After the shared host started (Places), the engine page, then the live values.
    func start() async {
        guard !started else { return }
        started = true
        installHooks()
        CoreLog.debug("app: waiting for launch")
        await AppDelegate.whenLaunched()
        CoreLog.debug("app: starting pages")
        pool.start()
        rebind()
        watchMemoryPressure()
        #if DEBUG
        DebugCommands.install()
        MacEval.start()
        #endif
    }

    /// Watches the engine page's client: a new client (a place switch) means every value again.
    func rebind() {
        guard let client else { return }
        if boundClient != ObjectIdentifier(client) {
            boundClient = ObjectIdentifier(client)
            readySeen = client.state == .ready
            gate = nil
            listen(client)
            for w in windows.values.compactMap(\.model) { w.engineChanged() }
        }
        session.bind(client, Views.Session())
        sync.bind(client, Views.SyncStatus())
        tree.bind(client, Views.FoldersTree(SpaceArgs()))
        places.bind(client, Views.PlacesList())
        taskCounts.bind(client, Views.TasksCounts(SpaceArgs()))
        notifications.bind(client, Views.NotificationsList())
        changes.bind(client, Views.Changes())
        reviews.bind(client, Views.Reviews(ReviewsArgs(noteId: nil, space: nil)))
        vault.bind(client, Views.VaultSummary(SpaceArgs()))
    }

    private func listen(_ client: EngineClient) {
        eventTask?.cancel()
        eventTask = Task { @MainActor [weak self] in
            for await event in client.events() {
                guard let self, !Task.isCancelled else { return }
                self.handle(event)
            }
        }
    }

    private func handle(_ event: EngineEvent) {
        switch event {
        case .engineReady:
            readySeen = true
            Task { @MainActor in try? await Task.sleep(for: .milliseconds(300)); self.flushWaitingPaths() }
            gate = nil
            rebind()
            QuickAddQueue.shared.flush()
        case .gateChanged(let g):
            gate = g.gate == nil ? nil : g
            if g.gate == nil { readySeen = true }
        case .toast(let t):
            toast(t)
        case .navigateRequest(let n):
            if n.external, let url = URL(string: n.route) { NSWorkspace.shared.open(url); return }
            open(path: n.route, newTab: n.newTab)
        case .placeChanged:
            rebind()
        default:
            break
        }
    }

    private func installHooks() {
        Navigation.shared.openInApp = { [weak self] path in self?.open(path: path) }
        DesktopHooks.openPath = { [weak self] path, _ in self?.open(path: path) }
        CoreNotifications.onOpen = { [weak self] path, _ in self?.open(path: path) }
        WindowManager.shared.front = { [weak self] in
            guard let self else { return nil }
            if let id = self.frontWindow, let page = self.pool.page(of: id) { return .init(view: page.view, window: page.view.window) }
            return self.pool.engine.map { .init(view: $0.view, window: NSApp.keyWindow) }
        }
        WindowManager.shared.showWindow = { [weak self] in self?.showAnyWindow() }
        AppDelegate.onReopen = { [weak self] in self?.showAnyWindow() }
        AppDelegate.onOpenURLs = { [weak self] urls in urls.forEach { self?.openLink($0) } }
    }

    /// Every window starts over at Home in the new place (its pages were made again).
    func placeSwitched() {
        rebind()
        for w in windows.values.compactMap(\.model) { w.reset() }
    }

    // MARK: windows

    func register(_ window: WindowModel) {
        windows[window.id] = WeakWindow(model: window)
        windows = windows.filter { $0.value.model != nil }
    }

    /// Where closed windows and tabs were (File > Reopen Closed Tab), newest last.
    @ObservationIgnored private(set) var closedTabs: [Destination] = []

    func reopenClosedTab() {
        guard let d = closedTabs.popLast() else { return }
        openWindow?(d, true, false)
    }

    func unregister(_ window: WindowModel) {
        closedTabs.append(window.current)
        if closedTabs.count > 20 { closedTabs.removeFirst() }
        windows[window.id] = nil
        if frontWindow == window.id { frontWindow = nil }
        pool.giveBack(from: window.id)
    }

    func becameFront(_ window: WindowModel) {
        frontWindow = window.id
        flushWaitingPaths()
    }

    /// The notes open in other windows and tabs (the page's Join picker lists them first).
    func openNoteTabs(except id: UUID) -> [PaneTab] {
        windows.values.compactMap(\.model).filter { $0.id != id }.compactMap { w in
            w.current.noteId.map { PaneTab(id: $0, title: w.title) }
        }
    }

    var front: WindowModel? { frontWindow.flatMap { windows[$0]?.model } ?? windows.values.compactMap(\.model).first }

    /// Asked by the shared host (a link with no window): opens one.
    var openWindow: ((Destination?, Bool, Bool) -> Void)?

    func showAnyWindow() {
        if let front, let w = front.window {
            w.makeKeyAndOrderFront(nil)
        } else {
            openWindow?(nil, false, false)
        }
        NSApp.activate()
    }

    /// Opens one of Folevi's paths: in the front window, or a new tab when asked.
    /// Under memory pressure the warm editor pages that aren't showing are let go.
    @ObservationIgnored private lazy var memoryPressure: DispatchSourceMemoryPressure = {
        let source = DispatchSource.makeMemoryPressureSource(eventMask: [.warning, .critical], queue: .main)
        source.setEventHandler { MainActor.assumeIsolated { AppModel.shared.pool.relieve() } }
        return source
    }()

    func watchMemoryPressure() { memoryPressure.resume() }

    /// Links that came before the app was ready (a link that launched it, Spotlight, Shortcuts): opened then.
    @ObservationIgnored private var waitingPaths: [(String, Bool)] = []
    /// Opens Help (set by the window, which can open scenes).
    @ObservationIgnored var openHelp: (() -> Void)?

    func open(path: String, newTab: Bool = false) {
        guard ready, front != nil else { waitingPaths.append((path, newTab)); return }
        if let section = Destination.settingsSection(path: path) {
            SettingsRouter.shared.open(section)
            return
        }
        // "/d/<id>#block-x" keeps the block: the note opens there.
        var route = path, block: String?
        if let hash = path.firstIndex(of: "#") {
            route = String(path[..<hash])
            let frag = String(path[path.index(after: hash)...])
            block = frag.hasPrefix("block-") ? String(frag.dropFirst(6)) : frag.hasPrefix("comment-") ? nil : frag
        }
        if route == "/help" || route.hasPrefix("/help/") { openHelp?(); return }
        guard let dest = Destination(path: route) else { return }
        open(dest, newTab: newTab)
        if let block, !block.isEmpty, dest.isNote {
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(500))
                self.front?.editor(EditorCommands.BlockJump(BlockJumpArgs(blockId: block)))
            }
        }
    }

    /// Opens what waited for launch.
    func flushWaitingPaths() {
        guard ready, front != nil, !waitingPaths.isEmpty else { return }
        let all = waitingPaths
        waitingPaths = []
        for (p, t) in all { open(path: p, newTab: t) }
    }

    /// The window a new tab was opened from (its Back returns there).
    @ObservationIgnored weak var pendingOpener: NSWindow?

    /// Moves notes to the Trash, and takes them out of every window's history (a tab showing one goes back).
    func trash(_ ids: [String]) {
        perform { client in
            _ = try await client.command(Commands.NoteTrash(NoteIdsArgs(ids: ids)))
            for w in self.windows.values.compactMap(\.model) { w.forget(notes: Set(ids)) }
        }
    }

    func open(_ dest: Destination, newTab: Bool = false, background: Bool = false) {
        // A note already open in a window or tab comes forward instead of opening twice.
        if newTab, dest.isNote, let open = windows.values.compactMap(\.model).first(where: { $0.current == dest }), let w = open.window {
            w.makeKeyAndOrderFront(nil)
            NSApp.activate()
            return
        }
        if newTab || front == nil {
            pendingOpener = front?.window
            openWindow?(dest, newTab, background && newTab)
        } else {
            front?.go(dest)
        }
        if !background { NSApp.activate() }
    }

    /// folevi-core:// links, Spotlight results and app.folevi.com links.
    func openLink(_ url: URL) {
        if url.scheme == Paths.urlScheme {
            // folevi-core://new (a new note) and folevi-core://quick-add (the Quick Add panel).
            switch url.host {
            case "new": NoteActions.newNote(app: self, window: front, newTab: front == nil); return
            case "quick-add": QuickAdd.shared.show(); return
            default: break
            }
            var path = "/" + [url.host, url.path].compactMap { $0 }.joined().trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            if let q = url.query { path += "?" + q }
            open(path: path)
        } else if case .app(let path) = Links.target(url) {
            open(path: path)
        }
    }

    // MARK: toasts

    func toast(_ t: ToastEvent) {
        var toast = Toast(message: t.message, tone: t.tone)
        if let action = t.action {
            toast.actionLabel = action.label
            toast.action = { [weak self] in self?.perform { _ = try await $0.command(Commands.ToastAction(ToastActionArgs(id: action.id))) } }
        } else if let undo = t.undo {
            toast.actionLabel = "Undo"
            toast.action = { [weak self] in self?.undo(undo) }
        }
        show(toast)
    }

    func toast(_ message: String, tone: ToastEvent.Tone = .info, action: String? = nil, run: (@MainActor () -> Void)? = nil) {
        show(Toast(message: message, tone: tone, actionLabel: action, action: run))
    }

    private func show(_ toast: Toast) {
        toasts.append(toast)
        if toasts.count > 3 { toasts.removeFirst(toasts.count - 3) }
        let id = toast.id
        Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(toast.action == nil ? 4 : 7))
            self?.dismiss(id)
        }
        NSAccessibility.post(element: NSApp as Any, notification: .announcementRequested, userInfo: [.announcement: toast.message, .priority: NSAccessibilityPriorityLevel.medium.rawValue])
    }

    func dismiss(_ id: UUID) {
        withAnimation(.snappy) { toasts.removeAll { $0.id == id } }
    }

    private func undo(_ u: ToastUndo) {
        let args = JSONValue.object(u.args)
        func decode<A: Decodable>(_: A.Type) -> A? { (try? JSONEncoder().encode(args)).flatMap { try? JSONDecoder().decode(A.self, from: $0) } }
        switch u.command {
        case .noteStar: if let a = decode(NoteStarArgs.self) { perform { _ = try await $0.command(Commands.NoteStar(a)) } }
        case .noteArchive: if let a = decode(NoteArchiveArgs.self) { perform { _ = try await $0.command(Commands.NoteArchive(a)) } }
        case .noteMove: if let a = decode(NoteMoveArgs.self) { perform { _ = try await $0.command(Commands.NoteMove(a)) } }
        case .noteTrash: if let a = decode(NoteIdsArgs.self) { trash(a.ids) }
        case .noteRestore: if let a = decode(NoteIdsArgs.self) { perform { _ = try await $0.command(Commands.NoteRestore(a)) } }
        default: toast("That can't be undone from here.", tone: .error)
        }
    }

    // MARK: running engine calls

    /// Runs an engine call; a refusal shows its message as a toast.
    func perform(_ work: @escaping @MainActor (EngineClient) async throws -> Void) {
        guard let client else { return toast("Folevi Core is still starting. Try again in a moment.", tone: .error) }
        Task { @MainActor in
            do { try await work(client) } catch let f as EngineFailure {
                let unknown = [BridgeErrorCode.unknownCommand.rawValue, BridgeErrorCode.unknownView.rawValue].contains(f.code)
                self.toast(unknown ? "That isn't available in this version yet." : f.message, tone: .error)
            } catch {
                self.toast("Something went wrong. Try again.", tone: .error)
            }
        }
    }

    // MARK: derived

    var spaceName: String {
        guard let s = session.value else { return "Folevi" }
        return s.spaces.first { $0.id == s.space }?.name ?? (s.mode == .local ? "On This Mac" : "Personal")
    }

    var currentSpace: SpaceInfo? {
        guard let s = session.value else { return nil }
        return s.spaces.first { $0.id == s.space }
    }

    var unread: Int { notifications.value?.unread ?? 0 }
}
