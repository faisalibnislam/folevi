// The pages behind Folevi Core's windows. Each open place has:
//
// - one engine page: the bundled export in native chrome mode, hidden, keeping the place's data layer (sync,
//   outbox, replica, encryption) and answering every window's native screens through its EngineClient; it is
//   also the first window's editor, so one window costs one web process, as today's Folevi;
// - a small pool of warm editor pages for other windows showing notes at the same time. A window that hides (a
//   background tab, minimized, closed) gives its editor back after a short grace, so tabs stay cheap.
//
// Every page loads /native and is moved between windows as SwiftUI shows and hides note panes.
import AppKit
import FoleviEngine
import Observation
import WebKit
import FoleviEngineDemo

/// FoleviEngine's transport plus the big-batch route: a batch over 256 KB is POSTed to /_bridge/<id>, AppScheme
/// keeps it, and the message names it.
@MainActor
final class CoreEngineTransport: EngineTransport {
    let inner: WebViewTransport
    var onBatch: (@MainActor (Data) -> Void)?
    var onLifecycle: (@MainActor (PageLifecycle) -> Void)?

    init(view: WKWebView) {
        inner = WebViewTransport(webView: view, allowed: [WebViewTransport.Origin(scheme: AppScheme.scheme, host: AppScheme.host)])
        inner.onBatch = { [weak self] data in self?.receive(data) }
        inner.onLifecycle = { [weak self] e in self?.onLifecycle?(e) }
    }

    func call(_ message: String) async throws -> Data { try await inner.call(message) }

    func pageEvent(_ event: PageLifecycle) {
        switch event {
        case .reloading: inner.pageWillReload()
        case .terminated: inner.contentProcessDidTerminate()
        }
    }

    func detach() { inner.detach() }

    private func receive(_ data: Data) {
        if data.first == UInt8(ascii: "{"), let pointer = try? JSONDecoder().decode(BigBatchPointer.self, from: data) {
            if let body = BridgeBodies.shared.takeCall(pointer.bodyId) { onBatch?(body) }
            return
        }
        onBatch?(data)
    }
}

/// One page and its engine client.
@MainActor
@Observable
final class Page: PageHost {
    enum Kind { case engine, editor }

    let kind: Kind
    @ObservationIgnored private(set) var view: FoleviWebView
    private(set) var client: EngineClient
    @ObservationIgnored private var transport: CoreEngineTransport
    /// Bumps when the page is made again (a place or mode switch): screens watch the new client.
    private(set) var generation = 0
    /// The note the page shows now (its editor), nil when none.
    var shownNote: String?
    /// The note's editor state as the page last said it (undo and redo for the Edit menu).
    @ObservationIgnored var editorState: EditorStateEvent?
    /// The window the page is lent to, nil when it's in the pool (or the engine page between windows).
    @ObservationIgnored var lentTo: UUID?
    @ObservationIgnored var lentAt = Date()

    var place: String? { view.place }

    init(kind: Kind, place: String?) {
        self.kind = kind
        let made = Self.make(place: place)
        view = made.view
        transport = made.transport
        client = made.client
        WindowManager.shared.register(host: self)
        hook()
    }

    private static let demoClient = DemoEngine.shared.client()

    private static func make(place: String?) -> (view: FoleviWebView, transport: CoreEngineTransport, client: EngineClient) {
        let view = WebViewFactory.make(place: place, role: .main, bootstrap: WindowManager.shared.bootstrapOf(place, .main), frame: NSRect(x: 0, y: 0, width: 900, height: 700), nativeFrame: true, window: { NSApp.keyWindow })
        view.autoresizingMask = [.width, .height]
        let transport = CoreEngineTransport(view: view)
        let client: EngineClient
        if Paths.demo {
            // One client for the one scripted transport: a second client would take its messages away.
            client = demoClient
        } else {
            client = EngineClient(transport: transport, place: place ?? "", app: AppInfo(platform: .macos, version: Paths.version, build: Paths.build, protocol: EngineContract.protocolVersion, schemaHash: EngineContract.schemaHash))
            // The launch snapshot: the last sidebar, Home and counts, drawn at once on the next launch (written at most
            // every 2 s, per place).
            let safe = (place ?? "none").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: ":", with: "_")
            client.snapshot = LaunchSnapshotStore(url: Paths.supportFolder.appendingPathComponent("Places/\(safe)/launch.json"))
        }
        view.load(URLRequest(url: Links.appURL("/native")))
        client.start()
        return (view, transport, client)
    }

    private func hook() {
        view.onLifecycle = { [weak self] event in self?.transport.pageEvent(event) }
        view.editorHistory = (
            run: { [weak self] undo in
                guard let self else { return }
                Task { _ = try? await undo ? self.client.editor(EditorCommands.Undo()) : self.client.editor(EditorCommands.Redo()) }
            },
            state: { [weak self] in
                guard let self, self.shownNote != nil, let s = self.editorState else { return nil }
                return (s.undo, s.redo)
            }
        )
    }

    /// PageHost: the page again in `place` (a switch), from a fresh bootstrap.
    func rebuild(place: String??, path: String) {
        let next = place ?? self.place
        let old = view
        let oldClient = client
        let oldTransport = transport
        let parent = old.superview
        let frame = old.frame
        let made = Self.make(place: next)
        view = made.view
        transport = made.transport
        client = made.client
        shownNote = nil
        hook()
        if let parent {
            made.view.frame = frame
            parent.addSubview(made.view)
        }
        old.removeFromSuperview()
        oldClient.stop()
        oldTransport.detach()
        PageClosing.flush(old) { old.load(URLRequest(url: URL(string: "about:blank")!)) }
        generation += 1
    }

    /// Ends the page (the pool shrinking, the app quitting).
    func close() {
        WindowManager.shared.unregister(host: self)
        client.stop()
        transport.detach()
        let old = view
        old.removeFromSuperview()
        PageClosing.flush(old) { old.load(URLRequest(url: URL(string: "about:blank")!)) }
    }

    // MARK: the note

    /// The note asked for on a press, before the click ends (its first frame starts drawing then).
    private(set) var preparedNote: String?

    func prepare(note id: String) {
        guard shownNote != id, preparedNote != id else { return }
        preparedNote = id
        Task { _ = try? await client.editor(EditorCommands.NotePrepare(NotePrepareArgs(id: id))) }
    }

    /// Shows `id` in this page (prepared first so its first frame is ready).
    func show(note id: String, focus: Bool = false, panes: [String]? = nil, sizes: [Double]? = nil, tabs: [PaneTab]? = nil) async {
        if shownNote != id, preparedNote != id {
            _ = try? await client.editor(EditorCommands.NotePrepare(NotePrepareArgs(id: id)))
        }
        preparedNote = nil
        shownNote = id
        _ = try? await client.editor(EditorCommands.NoteShow(NoteShowArgs(id: id, focus: focus, panes: panes, sizes: sizes, tabs: tabs)))
    }

    /// One of the screens that stay on the page (Reviews, Graph, some Settings sections).
    func show(web page: FoleviEngine.WebPage) async {
        shownNote = nil
        _ = try? await client.editor(EditorCommands.WebShow(WebShowArgs(page: page)))
    }

    func closeNote() async {
        guard shownNote != nil else { return }
        shownNote = nil
        _ = try? await client.editor(EditorCommands.NoteClose())
    }
}

/// The pages of the open place: the engine page and the editor pool.
@MainActor
@Observable
final class PagePool {
    static let shared = PagePool()

    init() {}

    /// The open place's engine page; nil before launch finished.
    private(set) var engine: Page?
    @ObservationIgnored private var editors: [Page] = []
    /// At most this many editor pages besides the engine page.
    @ObservationIgnored var maxEditors = 3
    @ObservationIgnored private var trimTask: Task<Void, Never>?

    /// The engine client every native screen of every window uses.
    var client: EngineClient? { engine?.client }

    /// Makes the engine page for the open place (at launch, after Places started).
    func start() {
        guard engine == nil else { return }
        engine = Page(kind: .engine, place: ShellPlaces.state.current)
        // A second page warm in the background, so the second window's first note opens at once.
        DispatchQueue.main.asyncAfter(deadline: .now() + 4) { [weak self] in
            MainActor.assumeIsolated { self?.warm() }
        }
    }

    private func warm() {
        guard editors.isEmpty, engine != nil, !Paths.testing else { return }
        editors.append(Page(kind: .editor, place: engine?.place))
    }

    /// The page window `window` shows its note in: the one it has, else the engine page when no other window has
    /// it, else a warm editor (or a new one).
    func editor(for window: UUID) -> Page? {
        guard let engine else { return nil }
        if let mine = ([engine] + editors).first(where: { $0.lentTo == window }) {
            mine.lentAt = Date()
            return mine
        }
        let page: Page
        if engine.lentTo == nil {
            page = engine
        } else if let free = editors.first(where: { $0.lentTo == nil && $0.place == engine.place }) {
            page = free
        } else {
            page = Page(kind: .editor, place: engine.place)
            editors.append(page)
        }
        page.lentTo = window
        page.lentAt = Date()
        return page
    }

    /// The window no longer shows a note (it closed, hid or left the note): its page goes back.
    func giveBack(from window: UUID) {
        for page in [engine].compactMap({ $0 }) + editors where page.lentTo == window {
            page.lentTo = nil
            page.view.removeFromSuperview()
            Task { await page.closeNote() }
        }
        scheduleTrim()
    }

    /// The page lent to `window`, if any.
    func page(of window: UUID) -> Page? {
        ([engine].compactMap { $0 } + editors).first { $0.lentTo == window }
    }

    /// Editors nobody used for a while close (memory), keeping one warm.
    private func scheduleTrim() {
        trimTask?.cancel()
        trimTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(90))
            guard let self, !Task.isCancelled else { return }
            let idle = self.editors.filter { $0.lentTo == nil }
            for page in idle.dropFirst() {
                page.close()
                self.editors.removeAll { $0 === page }
            }
            while self.editors.count > self.maxEditors, let extra = self.editors.first(where: { $0.lentTo == nil }) {
                extra.close()
                self.editors.removeAll { $0 === extra }
            }
        }
    }

    /// Memory pressure: every editor nobody shows closes now.
    func relieve() {
        for page in editors where page.lentTo == nil { page.close() }
        editors.removeAll { $0.lentTo == nil }
    }

    /// Every page (Spotlight's place, the Debug channel).
    var all: [Page] { [engine].compactMap { $0 } + editors }
}
