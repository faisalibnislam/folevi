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

    /// What the engine shows while it isn't ready (nil: ready).
    private(set) var gate: GateChangedEvent?
    /// The engine has said it's ready at least once for this page.
    private(set) var ready = false
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
            ready = client.state == .ready
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
            ready = true
            gate = nil
            rebind()
        case .gateChanged(let g):
            gate = g.gate == nil ? nil : g
            if g.gate == nil { ready = true }
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

    func unregister(_ window: WindowModel) {
        windows[window.id] = nil
        if frontWindow == window.id { frontWindow = nil }
        pool.giveBack(from: window.id)
    }

    func becameFront(_ window: WindowModel) { frontWindow = window.id }

    /// The notes open in other windows and tabs (the page's Join picker lists them first).
    func openNoteTabs(except id: UUID) -> [PaneTab] {
        windows.values.compactMap(\.model).filter { $0.id != id }.compactMap { w in
            w.current.noteId.map { PaneTab(id: $0, title: w.title) }
        }
    }

    var front: WindowModel? { frontWindow.flatMap { windows[$0]?.model } ?? windows.values.compactMap(\.model).first }

    /// Asked by the shared host (a link with no window): opens one.
    var openWindow: ((Destination?, Bool) -> Void)?

    func showAnyWindow() {
        if let front, let w = front.window {
            w.makeKeyAndOrderFront(nil)
        } else {
            openWindow?(nil, false)
        }
        NSApp.activate()
    }

    /// Opens one of Folevi's paths: in the front window, or a new tab when asked.
    func open(path: String, newTab: Bool = false) {
        if let section = Destination.settingsSection(path: path) {
            SettingsRouter.shared.open(section)
            return
        }
        guard let dest = Destination(path: path) else { return }
        open(dest, newTab: newTab)
    }

    /// The window a new tab was opened from (its Back returns there).
    @ObservationIgnored weak var pendingOpener: NSWindow?

    func open(_ dest: Destination, newTab: Bool = false) {
        if newTab || front == nil {
            pendingOpener = front?.window
            openWindow?(dest, newTab)
        } else {
            front?.go(dest)
        }
        NSApp.activate()
    }

    /// folevi-core:// links, Spotlight results and app.folevi.com links.
    func openLink(_ url: URL) {
        if url.scheme == Paths.urlScheme {
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
        case .noteTrash: if let a = decode(NoteIdsArgs.self) { perform { _ = try await $0.command(Commands.NoteTrash(a)) } }
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
