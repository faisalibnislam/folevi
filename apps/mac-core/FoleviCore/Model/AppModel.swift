// Folevi Core's app-wide state: the open place's engine (PagePool), the live values every window shares (the
// session, sync, the folder tree, places, counts), the gate the engine shows while it isn't ready (first launch,
// sign-in, unlocking, onboarding), toasts, and which window is in front. Native holds no authority: every value
// comes from the engine, every write is an engine command.
import AppKit
import FoleviDesign
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

    /// Watches `spec` on `client` (no-op when it already does). `snapshot` keeps its last value in the place's
    /// launch snapshot, so the next launch draws it before the engine answers.
    func bind(_ client: EngineClient?, _ spec: V, snapshot: String? = nil) {
        guard let client else { return }
        let k = (ObjectIdentifier(client), spec.args)
        if let key, key.0 == k.0, key.1 == k.1 { return }
        store?.cancel()
        key = k
        store = client.watch(spec, snapshotKey: snapshot)
    }

    func cancel() {
        store?.cancel()
        store = nil
        key = nil
    }

    /// Off screen (a hidden tab, a covered or minimised window) for a minute pauses the subscription; back on
    /// screen resumes it (the engine's `setVisible`, as today's Home).
    func setVisible(_ visible: Bool) { store?.setVisible(visible) }
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

    /// Off screen for a minute pauses the list's subscription; back on screen resumes it.
    func setVisible(_ visible: Bool) { store?.setVisible(visible) }

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

    /// A saved-window key of this data folder: a run with its own FOLEVI_USER_DATA keeps its own windows and tabs
    /// (they named notes of another library otherwise); the normal folder keeps the plain key.
    nonisolated static func dataKey(_ key: String) -> String { Paths.runTag.map { "\(key).\($0)" } ?? key }

    #if DEBUG
    /// The Debug channel's stand-in gate (`core.mjs cmd fakegate`), to look at a gate screen without its engine state.
    func showGate(_ g: GateChangedEvent?) { gate = g }
    #endif
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
        // Cards' image covers: their signed links from the engine (files.urls), downloaded once per run.
        CoverFiles.shared.loader = { ids in
            let value = try await client.query(.filesUrls(ids: ids))
            func pair(_ light: String, _ dark: String) -> ColorPair? {
                guard let l = RGBA(hex: light), let d = RGBA(hex: dark) else { return nil }
                return ColorPair(light: l, dark: d)
            }
            return value.urls.mapValues { link in
                // A sealed image's bytes are ciphertext: only the note page can open them, so the card stays plain.
                let palette = link.palette.value
                return CoverFiles.Link(url: link.sealed ? nil : link.url.flatMap(URL.init(string:)), paper: palette.flatMap { pair($0.paper, $0.paperDark) }, ink: palette.flatMap { pair($0.ink, $0.inkDark) })
            }
        }
        // Card previews take the page's own line breaks (`text.layout`), as WebKit sets the card's clamped,
        // `text-wrap: pretty` paragraph; asked of whichever engine is open now.
        WebLineLayout.shared.requester = { style, texts in
            guard let client = await AppModel.shared.client else { throw CancellationError() }
            let r = try await client.command(.textLayout(
                texts: texts,
                family: style.family == .display ? .display : .sans,
                pxSize: Double(style.size), pxLineHeight: Double(style.lineHeight), weight: Int(style.weight),
                pxLetterSpacing: Double(style.letterSpacing), pxWidth: Double(style.width),
                wrap: style.wrap == .balance ? .balance : style.wrap == .wrap ? .wrap : .pretty,
                pre: style.pre, clamp: style.clamp))
            return r.lines
        }
        session.bind(client, Views.Session(), snapshot: "session")
        sync.bind(client, Views.SyncStatus())
        tree.bind(client, Views.FoldersTree(SpaceArgs()), snapshot: "folders.tree")
        places.bind(client, Views.PlacesList(), snapshot: "places.list")
        watchPlacesForBadge()
        taskCounts.bind(client, Views.TasksCounts(SpaceArgs()), snapshot: "tasks.counts")
        guardSnapshot(client)
        notifications.bind(client, Views.NotificationsList())
        changes.bind(client, Views.Changes())
        reviews.bind(client, Views.Reviews(ReviewsArgs(noteId: nil, space: nil)))
        vault.bind(client, Views.VaultSummary(SpaceArgs()))
    }

    /// Encrypted spaces keep nothing on disk in the launch snapshot (as on iPhone): it's cleared and stays off.
    @ObservationIgnored private var snapshotGuard: Task<Void, Never>?
    private func guardSnapshot(_ client: EngineClient) {
        snapshotGuard?.cancel()
        snapshotGuard = Task { @MainActor [weak self] in
            for _ in 0..<120 {
                if let spaces = self?.session.value?.spaces {
                    if spaces.contains(where: { $0.encrypted }) { client.snapshot?.clear(lock: true) }
                    return
                }
                try? await Task.sleep(for: .milliseconds(500))
            }
        }
    }

    // MARK: intents

    /// What a screen asks of the app beyond a route (today's ScreenIntent, one case each).
    enum Intent: Equatable {
        case openTasks(TasksView)
        case openCalendar(date: String?)
        case openNote(id: String, blockId: String?)
        case openRoute(String)
        case openSettings(section: String?)
        case help
        case switchPlace(id: String, workspaceId: String?)
        case newWorkspace
        case signInAnotherAccount
        case moveOrCopy(notes: [String], folders: [String])
        case signOut(place: String?)
        case downloadFile(id: String)
    }

    /// A workspace to open once the place being switched to is ready.
    @ObservationIgnored private var pendingWorkspace: String?

    func perform(_ intent: Intent) {
        switch intent {
        case .openTasks(let v): open(.tasks(v))
        case .openCalendar(let d): open(path: d.map { "/calendar?date=\($0)" } ?? "/calendar")
        case .openNote(let id, let block): open(path: block.map { "/d/\(id)#block-\($0)" } ?? "/d/\(id)")
        case .openRoute(let r): open(path: r)
        case .openSettings(let s): open(path: s.map { "/settings/\($0)" } ?? "/settings")
        case .help: openHelp?()
        case .switchPlace(let id, let ws):
            if id == ShellPlaces.state.current {
                if let ws { perform { _ = try await $0.command(Commands.SpaceSwitch(SpaceSwitchArgs(space: ws))) } }
            } else {
                pendingWorkspace = ws
                Places.shared.switchTo(id)
            }
        case .newWorkspace: front?.newWorkspaceShown = true
        case .signInAnotherAccount: AccountActions.addAccount()
        case .moveOrCopy(let notes, let folders): front?.placeMove = PlaceMoveTarget(notes: notes, folders: folders)
        case .signOut(let place):
            if let p = place ?? ShellPlaces.state.current { AccountActions.signOut(p) }
        case .downloadFile(let id): download(file: id)
        }
    }

    /// A file a notification delivers (an export): its signed link from the engine, saved where the person picks.
    func download(file id: String) {
        perform { client in
            let v = try await client.query(Views.FilesUrls(FileUrlsArgs(ids: [id])))
            guard let link = v.urls[id], let s = link.url, let url = URL(string: s) else { AppModel.shared.toast("The file isn't ready yet.", tone: .error); return }
            let (data, _) = try await URLSession.shared.data(from: url)
            _ = await ShellFiles.shared.save(name: link.filename ?? "Download", bytes: data, from: NSApp.keyWindow)
        }
    }

    private func openPendingWorkspace() {
        guard let ws = pendingWorkspace else { return }
        pendingWorkspace = nil
        perform { _ = try await $0.command(Commands.SpaceSwitch(SpaceSwitchArgs(space: ws))) }
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
            openPendingWorkspace()
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
        AppDelegate.onOpenURLs = { [weak self] urls in
            // Markdown and text files opened with Core become notes; everything else is a link.
            let files = urls.filter { $0.isFileURL && FileImport.accepts($0) }
            if !files.isEmpty { FileImport.importFiles(files, window: self?.front) }
            urls.filter { !($0.isFileURL && FileImport.accepts($0)) }.forEach { self?.openLink($0) }
        }
    }

    /// Every window starts over at Home in the new place (its pages were made again); the front window's tabs are
    /// put away for the place it came from first.
    func placeSwitched() {
        CoreLog.debug("space: place switched, tabs \(frontTabs().map(\.current.path))")
        putAwayTabs()
        rebind()
        for w in windows.values.compactMap(\.model) { w.reset() }
    }

    /// The Dock badge counts places that aren't open with their last-known unread.
    @ObservationIgnored private var badgeWatch: Task<Void, Never>?
    private func watchPlacesForBadge() {
        badgeWatch?.cancel()
        badgeWatch = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                if let list = self?.places.value {
                    DesktopHooks.silentUnread = Dictionary(list.places.filter { $0.id != list.current }.map { ($0.id, $0.unread) }, uniquingKeysWith: { a, _ in a })
                    DesktopHooks.updateBadge()
                }
                try? await Task.sleep(for: .seconds(30))
            }
        }
    }

    // MARK: windows across relaunches

    /// Every main window (front to back), each with its tabs (path, Back, Forward) and frame, kept on this Mac
    /// whatever the system's "close windows when quitting" setting says.
    struct SavedWindow: Codable {
        var frame: String
        var tabs: [SavedTab]
    }
    struct SavedTab: Codable {
        var path: String
        var back: [String]
        var forward: [String]
    }

    @ObservationIgnored private var saveTask: Task<Void, Never>?
    @ObservationIgnored private(set) var windowsRestored = false

    func saveWindowsSoon() {
        saveTask?.cancel()
        saveTask = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(600))
            guard !Task.isCancelled else { return }
            saveWindows()
        }
    }

    func saveWindows() {
        let models = windows.values.compactMap(\.model)
        var seen = Set<ObjectIdentifier>()
        var out: [SavedWindow] = []
        for w in NSApp.orderedWindows {
            guard let lead = models.first(where: { $0.window === w }), !seen.contains(ObjectIdentifier(w)) else { continue }
            let group = (w.tabbedWindows ?? [w])
            group.forEach { seen.insert(ObjectIdentifier($0)) }
            let tabs = group.compactMap { nw in models.first { $0.window === nw } }.map { SavedTab(path: $0.current.path, back: $0.backPaths, forward: $0.forwardPaths) }
            out.append(SavedWindow(frame: NSStringFromRect(w.frame), tabs: tabs.isEmpty ? [SavedTab(path: lead.current.path, back: lead.backPaths, forward: lead.forwardPaths)] : tabs))
        }
        guard !out.isEmpty, let data = try? JSONEncoder().encode(out) else { return }
        UserDefaults.standard.set(data, forKey: AppModel.dataKey("core.windows"))
    }

    /// At launch, once: the first window takes the first saved window's first tab; the rest open as they were.
    func restoreWindows(into first: WindowModel) {
        guard !windowsRestored else { return }
        windowsRestored = true
        NotificationCenter.default.addObserver(forName: NSApplication.willTerminateNotification, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { AppModel.shared.saveWindows() }
        }
        guard let data = UserDefaults.standard.data(forKey: AppModel.dataKey("core.windows")), let saved = try? JSONDecoder().decode([SavedWindow].self, from: data), !saved.isEmpty else { return }
        // macOS brought windows back itself: leave them.
        guard windows.count <= 1, first.current == .home, first.backPaths.isEmpty else { return }
        for (i, win) in saved.prefix(8).enumerated() {
            if i == 0 {
                if let t = win.tabs.first, let d = Destination(path: t.path) {
                    if d != .home { first.replace(with: d) }
                    first.restoreHistory(back: t.back, forward: t.forward)
                }
                first.window?.setFrame(NSRectFromString(win.frame), display: true)
                for t in win.tabs.dropFirst() { if let d = Destination(path: t.path) { open(d, newTab: true, background: true) } }
            } else if let t = win.tabs.first, let d = Destination(path: t.path) {
                openWindow?(d, false, false)
            }
        }
        // The window you were in comes back in front, with its first tab showing.
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(700))
            first.window?.makeKeyAndOrderFront(nil)
            if let w = first.window { w.tabGroup?.selectedWindow = w }
        }
    }

    // MARK: tabs per space

    /// The space shown ("<place>|<space>"), and each space's tabs (the front window's, as paths, up to 50 spaces).
    @ObservationIgnored private var spaceKey: String?
    @ObservationIgnored private var tabsPutAway = false
    @ObservationIgnored private var tabsBySpace: [String: [String]] = (UserDefaults.standard.dictionary(forKey: AppModel.dataKey("core.spaceTabs")) as? [String: [String]]) ?? [:]
    @ObservationIgnored private var spaceOrder: [String] = UserDefaults.standard.stringArray(forKey: AppModel.dataKey("core.spaceTabsOrder")) ?? []

    var currentSpaceKey: String? { session.value.map { "\($0.place ?? "")|\($0.space)" } }

    /// The front window's tabs, in tab order.
    private func frontTabs() -> [WindowModel] {
        guard let w = front?.window else { return front.map { [$0] } ?? [] }
        let models = windows.values.compactMap(\.model)
        return (w.tabbedWindows ?? [w]).compactMap { nw in models.first { $0.window === nw } }
    }

    func debugTabs() -> [String] { frontTabs().map(\.current.path) }

    private func putAwayTabs() {
        guard let key = spaceKey, !tabsPutAway else { return }
        let paths = frontTabs().map(\.current.path)
        guard !paths.isEmpty else { return }
        tabsBySpace[key] = paths
        spaceOrder.removeAll { $0 == key }
        spaceOrder.append(key)
        while spaceOrder.count > 50 { tabsBySpace[spaceOrder.removeFirst()] = nil }
        UserDefaults.standard.set(tabsBySpace, forKey: AppModel.dataKey("core.spaceTabs"))
        UserDefaults.standard.set(spaceOrder, forKey: AppModel.dataKey("core.spaceTabsOrder"))
        tabsPutAway = true
    }

    /// The space changed (a switch of place or of space): put the old space's tabs away, bring this one's back.
    func spaceMaybeChanged() {
        guard let key = currentSpaceKey, key != spaceKey else { return }
        CoreLog.debug("space: \(spaceKey ?? "nil") -> \(key), saved \(tabsBySpace[key] ?? []), tabs \(frontTabs().map(\.current.path))")
        let first = spaceKey == nil
        putAwayTabs()
        spaceKey = key
        tabsPutAway = false
        guard !first else { return }
        let tabs = frontTabs()
        guard let lead = tabs.first else { return }
        for t in tabs.dropFirst() {
            windows[t.id] = nil
            t.window?.close()
        }
        closedTabs.removeAll()
        let saved = (tabsBySpace[key] ?? []).compactMap { Destination(path: $0) }
        lead.reset()
        if let start = saved.first, start != .home { lead.go(start) }
        for d in saved.dropFirst() { open(d, newTab: true, background: true) }
    }

    // MARK: windows

    func register(_ window: WindowModel) {
        windows[window.id] = WeakWindow(model: window)
        windows = windows.filter { $0.value.model != nil }
        if windowsRestored { saveWindowsSoon() }
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
        // Foli DNA links keep their settings: ?note= (the map's centre), ?depth=, ?view= (a saved view).
        if route.hasPrefix("/graph"), let q = route.split(separator: "?", maxSplits: 1).dropFirst().first {
            let keep = String(q).split(separator: "&").filter { ["note", "depth", "view"].contains($0.split(separator: "=").first.map(String.init) ?? "") }
            if !keep.isEmpty, let w = newTab ? nil : front { w.graphQuery = keep.joined(separator: "&") }
        }
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

    // MARK: optimistic list changes

    /// Notes lists leave out at once while a Trash, Archive or Move settles, and stars shown before the engine
    /// confirms; both settle after 3 s, or roll back at once when the change fails.
    var hiddenNotes: Set<String> = []
    var starOverrides: [String: Bool] = [:]

    func optimistic(_ ids: [String], hide: Bool = false, star: Bool? = nil, _ run: @escaping (EngineClient) async throws -> BulkResult) {
        if hide { hiddenNotes.formUnion(ids) }
        if let star { for id in ids { starOverrides[id] = star } }
        let settle = { [weak self] (keep: Set<String>) in
            guard let self else { return }
            for id in ids where !keep.contains(id) { self.hiddenNotes.remove(id); self.starOverrides[id] = nil }
        }
        Task { @MainActor in
            do {
                guard let client else { settle([]); return }
                let r = try await run(client)
                if r.skipped > 0 { toast(r.skipped == 1 ? "1 note couldn't be changed. You may not have permission." : "\(r.skipped) notes couldn't be changed. You may not have permission.", tone: .error) }
                let done = r.queued ? Set(ids) : Set(r.done)
                settle(done)
                try? await Task.sleep(for: .seconds(3))
                settle([])
            } catch let f as EngineFailure {
                settle([])
                toast(f.message, tone: .error)
            } catch {
                settle([])
            }
        }
    }

    /// Moves notes to the Trash, and takes them out of every window's history (a tab showing one goes back).
    func trash(_ ids: [String]) {
        optimistic(ids, hide: true) { client in
            let r = try await client.command(Commands.NoteTrash(NoteIdsArgs(ids: ids)))
            for w in self.windows.values.compactMap(\.model) { w.forget(notes: Set(ids)) }
            return r
        }
    }

    func open(_ dest: Destination, newTab: Bool = false, background: Bool = false) {
        // A note already open in a window or tab comes forward instead of opening twice.
        if newTab, !background, dest != .home, !dest.isSearchLike, let open = windows.values.compactMap(\.model).first(where: { $0.current == dest }), let w = open.window {
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
        Motion.run(Motion.bar) { toasts.removeAll { $0.id == id } }
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
