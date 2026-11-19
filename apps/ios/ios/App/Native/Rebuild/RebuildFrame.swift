// The iOS rebuild's frame (docs/IOS_REBUILD_PLAN.md): Release builds' frame (TestFlight and the App Store), and in
// Debug builds with FOLEVI_REBUILD=1 in the environment (or the `folevi.rebuild` setting). A note is the real note
// page (RebuildNote.swift) on the app's one web view and engine.
import SafariServices
import SwiftUI
import UIKit
import FoleviDesign
import FoleviEngine
import FoleviMac
import FoleviPhone
import FoleviScreens

@MainActor
enum RebuildFrame {
    /// The new frame: in Release builds wherever the native frame runs (the built-in interface, not the web frame);
    /// in Debug builds when asked for (FOLEVI_REBUILD=1 or the `folevi.rebuild` setting), so the harnesses can shoot
    /// the web frame (FOLEVI_WEB_FRAME=1) and the new frame from the same build.
    static let enabled: Bool = {
        guard PhoneFrame.enabled else { return false }
        #if DEBUG
        return ProcessInfo.processInfo.environment["FOLEVI_REBUILD"] == "1" || UserDefaults.standard.bool(forKey: "folevi.rebuild")
        #else
        return true
        #endif
    }()

    static let model: PhoneFrameModel = {
        let m = PhoneFrameModel()
        // FOLEVI_REBUILD_OPEN: routes to open at launch, comma-separated (for checking the stacks headlessly).
        for path in (ProcessInfo.processInfo.environment["FOLEVI_REBUILD_OPEN"] ?? "").split(separator: ",") {
            m.open(FrameRoute(path: String(path)))
        }
        return m
    }()

    static let menus = PhoneMenus()

    /// Foli AI's sheet and page (RebuildAI.swift).
    static let ai = RebuildAI()

    /// The scene's restoration activity (SceneDelegate): its type and the snapshot's key in it.
    static let restorationType = "com.folevi.ios.frame"
    static let restorationKey = "frame"
    /// The iPad's wide layout's tabs in the same activity (RebuildIPad.swift restoreDesk).
    static let deskRestorationKey = "desk"

    /// Back where the scene was, unless launched to open routes (FOLEVI_REBUILD_OPEN).
    static func restore(_ data: Data) {
        guard (ProcessInfo.processInfo.environment["FOLEVI_REBUILD_OPEN"] ?? "").isEmpty else { return }
        model.restore(data: data)
    }

    static func controller() -> UIViewController {
        FoleviFonts.register()
        WebStyles.isPad = UIDevice.current.userInterfaceIdiom == .pad
        return RebuildFrameController(frame: model, menus: menus)
    }
}

/// The window's root: the Page View parked at the back (the engine runs in it; a note's screen adopts it), the
/// frame over it, the keyboard followed for the note's bars. Links from the page and the engine arrive here.
@MainActor
final class RebuildFrameController: UIViewController, PhoneRouting {
    let host: WebHost
    let model: PhoneModel
    let pageHost: PageViewHost
    let frame: PhoneFrameModel
    let menus: PhoneMenus
    private let transport: PhoneEngineTransport
    private var retiring: PageRetirement?
    private var observers: [Observer] = []
    private var tokens: [NSObjectProtocol] = []
    /// The iPad's wide layout: the Mac frame's model on the same engine (RebuildIPad.swift).
    lazy var desk: FrameModel = {
        let f = FrameModel(client: model.client)
        f.host = self
        // FOLEVI_REBUILD_OPEN: the routes to open at launch, as on the phone (each in a tab of its own).
        for path in (ProcessInfo.processInfo.environment["FOLEVI_REBUILD_OPEN"] ?? "").split(separator: ",") {
            f.open(FrameRoute(path: String(path)))
        }
        return f
    }()

    /// The window's rebuild frame (links from other apps, widgets, intents and Spotlight come here).
    static weak var current: RebuildFrameController?
    private var linksReady = false

    init(frame: PhoneFrameModel, menus: PhoneMenus) {
        let host = WebHost.take()
        self.host = host
        self.frame = frame
        self.menus = menus
        let transport = PhoneEngineTransport(host: host)
        self.transport = transport
        let info = Bundle.main.infoDictionary
        let platform: AppInfo.Platform = UIDevice.current.userInterfaceIdiom == .pad ? .ipados : .ios
        let client = EngineClient(transport: transport, place: ShellPlaces.state.current ?? "", app: AppInfo(platform: platform, version: info?["CFBundleShortVersionString"] as? String ?? "0", build: info?["CFBundleVersion"] as? String ?? "0", protocol: EngineContract.protocolVersion, schemaHash: EngineContract.schemaHash))
        model = PhoneModel(client: client)
        pageHost = PageViewHost(pageView: host.pageView)
        super.init(nibName: nil, bundle: nil)
        host.viewController = self
        WebHost.current = host
        host.onPageLifecycle = { [weak transport] event in transport?.pageEvent(event) }
        model.router = self
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    deinit { tokens.forEach(NotificationCenter.default.removeObserver) }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Chrome.canvas
        pageHost.parking = view
        pageHost.park()
        let gate = GateModel(client: model.client, feedback: ScreenFeedback(toast: { [weak self] t in self?.model.toast(t.message, tone: t.tone == .error ? .error : .info) }), device: .current)
        let feedback = ScreenFeedback(toast: { [weak self] t in self?.model.toast(t.message, tone: t.tone == .error ? .error : .info) })
        let places = PlacesModel(client: model.client, feedback: feedback)
        let home = HomeModel(client: model.client, feedback: feedback)
        RebuildFrame.ai.attach(phone: model, frame: frame)
        let root = UIHostingController(rootView: RebuildRoot(model: frame, menus: menus, phone: model, desk: desk, pageHost: pageHost, gate: gate, places: places, home: home, ai: RebuildFrame.ai, accountAction: { [weak self] action, close in
            self?.account(action, places: places, close: close)
        }, signOut: { [weak self] in self?.signOutNow() }))
        root.view.backgroundColor = .clear
        addChild(root)
        root.view.frame = view.bounds
        root.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(root.view)
        root.didMove(toParent: self)
        // Tab stacks stay mounted behind opacity. The controller owns page attachment because a retained
        // destination need not receive onAppear (or view-level observation) when its tab becomes active.
        observers.append(Observer { [weak self] in
            guard let self else { return }
            let route = self.frame.top
            guard !self.wide else { return }
            if case .note(let id) = route {
                let owner = NotePageRegistry.controller(for: id)
                _ = owner.view
                if !self.pageHost.isOwned(by: owner) {
                    self.pageHost.adopt(by: owner)
                    self.model.show(id)
                }
                return
            }
            if self.model.shownNote != nil {
                self.pageHost.park()
                self.model.closeNote()
            }
        })
        // The status bar over a note follows its page (a dark clock over a light page, whatever the phone's
        // appearance; RebuildNote's NotePageTones); everywhere else, and in the iPad's wide layout, the phone's own.
        observers.append(Observer { [weak self] in
            guard let self else { return }
            var style = UIStatusBarStyle.default
            if case .note(let id) = self.frame.top, !self.wide, let page = NotePageTones.shared.statusBar(for: id) { style = page }
            self.setStatusBarStyle(style)
        })
        // The phone's fallback screens are the desk's: where they go, the phone goes (the iPad's wide layout
        // shows the desk itself).
        observers.append(Observer { [weak self] in
            guard let self else { return }
            let r = self.desk.route
            guard r != RebuildDeskBridge.placed, (self.view.window?.bounds.width ?? 0) < RebuildIPad.minWidth || UIDevice.current.userInterfaceIdiom != .pad else { return }
            RebuildDeskBridge.placed = r
            if case .note(let id) = r { self.openNote(id, source: nil, focus: false) } else { self.frame.open(r) }
        })
        let center = NotificationCenter.default
        tokens = [
            center.addObserver(forName: UIResponder.keyboardWillChangeFrameNotification, object: nil, queue: .main) { [weak self] note in
                let end = (note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue ?? .zero
                MainActor.assumeIsolated { self?.keyboardMoved(to: end, hiding: false) }
            },
            center.addObserver(forName: UIResponder.keyboardWillHideNotification, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.keyboardMoved(to: .zero, hiding: true) }
            },
            // Low on memory: the native side's own caches go (decoded card covers, cards' line breaks; what shows
            // asks again), as the Mac lets them go (its 2026-11-19 performance pass). WebKit drops its own.
            center.addObserver(forName: UIApplication.didReceiveMemoryWarningNotification, object: nil, queue: .main) { _ in
                MainActor.assumeIsolated {
                    CoverFiles.shared.relieve()
                    WebLineLayout.shared.relieve()
                }
            },
        ]
        model.start()
        Self.current = self
        // Links that came before the engine was up open once it is (DeepLinkRouter keeps them till then).
        observers.append(Observer { [weak self] in
            guard let self, !self.linksReady, self.model.client.state == .ready else { return }
            self.linksReady = true
            DispatchQueue.main.async {
                // Restarted into another place to open something there (a notification from it).
                if let path = FoleviViewController.startPath, let url = DeepLink.fromPath(path) {
                    FoleviViewController.startPath = nil
                    self.openLink(url)
                }
                DeepLinkRouter.bridgeReady()
            }
        })
        // Small web text drawn natively asks the page how WebKit breaks it (`text.layout`).
        let client = model.client
        WebLineLayout.shared.requester = { style, texts in
            let r = try await client.command(.textLayout(
                texts: texts,
                family: style.family == .display ? .display : .sans,
                pxSize: Double(style.size), pxLineHeight: Double(style.lineHeight), weight: Int(style.weight),
                pxLetterSpacing: Double(style.letterSpacing), pxWidth: Double(style.width),
                wrap: style.wrap == .balance ? .balance : style.wrap == .wrap ? .wrap : .pretty,
                pre: style.pre, clamp: style.clamp))
            return r.lines
        }
        // Note cards with the person's own style image fetch it, and its colours, through `files.urls`.
        CoverFiles.shared.loader = CoverFiles.engineLoader(client)
        // FOLEVI_REBUILD_NEWNOTE=1: a new note at launch (for checking the note page headlessly; scratch data only).
        if ProcessInfo.processInfo.environment["FOLEVI_REBUILD_NEWNOTE"] == "1" {
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in
                guard let self else { return }
                if UIDevice.current.userInterfaceIdiom == .pad, (self.view.window?.bounds.width ?? 0) >= RebuildIPad.minWidth { self.desk.newNote() } else { self.model.newNote() }
            }
        }
    }

    // MARK: status bar

    private var statusBarStyle: UIStatusBarStyle = .default
    override var preferredStatusBarStyle: UIStatusBarStyle { statusBarStyle }
    override var preferredStatusBarUpdateAnimation: UIStatusBarAnimation { .fade }

    private func setStatusBarStyle(_ style: UIStatusBarStyle) {
        guard style != statusBarStyle else { return }
        statusBarStyle = style
        if UIAccessibility.isReduceMotionEnabled {
            setNeedsStatusBarAppearanceUpdate()
        } else {
            UIView.animate(withDuration: 0.2) { self.setNeedsStatusBarAppearanceUpdate() }
        }
    }

    /// Before a new mode's web view (FoleviViewController.restart): the engine stops and the page goes away first.
    func retire(then done: @escaping () -> Void) {
        model.stop()
        transport.detach()
        retiring = PageRetirement(host.pageView) { [weak self] in
            self?.retiring = nil
            self?.host.tearDown()
            done()
        }
    }

    private func keyboardMoved(to end: CGRect, hiding: Bool) {
        guard let window = view.window else { return }
        let keyboard = window.convert(end, from: window.screen.coordinateSpace)
        let overlap = hiding ? 0 : KeyboardBridge.coveredHeight(keyboard: keyboard, bounds: window.bounds)
        model.keyboardOverlap = overlap
        let appeared = overlap > 0 && !model.keyboardVisible
        model.keyboardVisible = overlap > 0
        if appeared { model.refreshEditorState() }
    }

    // MARK: PhoneRouting

    func open(_ route: ScreenRoute, source: CardSource?) {
        switch route {
        case .note(let id), .noteInNewTab(let id): return openNote(id, source: source, focus: false)
        case .movePlaces(let folders, let notes): return moveToAnotherPlace(folders: folders, notes: notes)
        case .shareFolder(let id, let name): return shareFolder(id, name: name)
        // Invite people: the workspace's Members, as the Mac opens it.
        case .invite: return open(.web("/settings/members"), source: nil)
        case .foliAI(let about):
            if let about { RebuildFrame.ai.ask(about: about) } else { RebuildFrame.ai.ask() }
            return
        case .web(let path) where FrameRoute.opensInboxPage(path): return openInboxPage()
        default: break
        }
        guard let destination = FrameRoute(phone: route) else {
            model.toast("That screen comes to the new app soon.")
            return
        }
        if wide { desk.open(destination) } else { frame.open(destination) }
    }

    func openNote(_ id: String, source: CardSource?, focus: Bool) {
        if wide {
            desk.open(.note(id))
            return
        }
        if case .note(let top) = frame.top, top == id { return }
        if model.shownNote != id { model.prepare(id) }
        frame.open(.note(id))
        if focus { model.show(id, focus: true) }
    }

    func openExternal(_ url: URL) {
        guard let scheme = url.scheme?.lowercased() else { return }
        if scheme == "http" || scheme == "https" {
            let safari = SFSafariViewController(url: url)
            safari.preferredControlTintColor = Chrome.heading
            present(safari, animated: true)
        } else {
            UIApplication.shared.open(url)
        }
    }

    func share(noteId: String) {
        FrameSheets.attach(desk, window: view.window)
        FrameDialogs.share(desk, noteId: noteId, title: model.noteMeta[noteId]?.title ?? "Share")
    }

    /// A folevi:// link (another app, a widget, an App Intent, Spotlight, Handoff): its screen, in the layout on
    /// screen (the iPad's wide one opens it in the desk's tab).
    func openLink(_ url: URL) {
        switch DeepLink.parse(url.absoluteString) {
        case .newNote?: return wide ? desk.newNote() : model.newNote()
        case .quickAdd?:
            model.quickAddShown = true
            return
        default: break
        }
        guard let path = DeepLink.path(of: url) else { return }
        if FrameRoute.opensInboxPage(path) { return openInboxPage() }
        let route = FrameRoute(path: path)
        if UIDevice.current.userInterfaceIdiom == .pad, (view.window?.bounds.width ?? 0) >= RebuildIPad.minWidth {
            desk.open(route)
            return
        }
        if case .note(let id) = route { return openNote(id, source: nil, focus: false) }
        frame.open(route)
    }

    /// The person's Inbox page in the open space (folevi://inbox, `/inbox`), as the web opens it: the engine finds
    /// it (or makes it on this device) and the note opens.
    func openInboxPage() {
        Task { @MainActor in
            do {
                let r = try await model.client.command(.inboxOpen())
                openNote(r.id, source: nil, focus: false)
            } catch {
                model.toast(ScreenErrors.message(error), tone: .error)
            }
        }
    }
}

private struct RebuildRoot: View {
    let model: PhoneFrameModel
    let menus: PhoneMenus
    let phone: PhoneModel
    let desk: FrameModel
    let pageHost: PageViewHost
    let gate: GateModel
    let places: PlacesModel
    let home: HomeModel
    let ai: RebuildAI
    let accountAction: (PhoneAccountAction, @escaping () -> Void) -> Void
    let signOut: () -> Void
    // FOLEVI_REBUILD_SHEET=account opens the account sheet at launch (for checking it headlessly).
    @State private var account = ProcessInfo.processInfo.environment["FOLEVI_REBUILD_SHEET"] == "account"
    /// A list in Select mode: its bar takes the tab bar's place.
    @State private var selecting = false
    /// The bell's sheet.
    @State private var notifications = false
    /// New folder's card, over everything.
    @State private var newFolder: NewFolderRequest?
    /// New workspace's card, over everything (from the account sheet).
    @State private var newWorkspace = false
    /// What sheets grow out of (phoneZoomSource / phoneSheet(zoomFrom:)).
    @Namespace private var zoom
    /// Regular width (iPhone Duo open): Home's detail column shows the last note opened when nothing is open.
    @Environment(\.horizontalSizeClass) private var sizeClass

    /// What decides whether Home's empty detail column should show the most recent note.
    private struct RecentKey: Hashable {
        var regular: Bool
        var onHome: Bool
        var noteOpen: Bool
        var recent: String?
    }

    private var recentKey: RecentKey {
        let s = model.stacks[.home] ?? []
        return RecentKey(regular: sizeClass == .regular && UIDevice.current.userInterfaceIdiom == .phone,
                         onHome: model.current == .home && !model.searching,
                         noteOpen: PhoneFrameModel.noteRunStart(s) < s.count,
                         recent: model.noteToShow(recents: home.recents.map(\.id)))
    }

    /// The open inner screen with no note beside Home: the last one opened shows there, as Notes does.
    private func showRecent(_ k: RecentKey) {
        guard k.regular, k.onHome, !k.noteOpen, let id = k.recent else { return }
        model.openRecent(id)
    }

    /// Folding: a note the detail column showed by itself (never written in) closes, so the outer screen shows Home.
    private func closeRecent() {
        guard let id = model.autoNote, model.stacks[.home]?.last?.route == .note(id) else { return }
        model.closeNotes(in: .home)
    }

    var body: some View {
        // The iPad in a window wide enough for the sidebar: the web's desktop layout (lib/iphone.ts
        // isIpadLayout, under 700 pt the phone's); the iPhone always the phone's.
        GeometryReader { g in
            let wide = UIDevice.current.userInterfaceIdiom == .pad && g.size.width >= RebuildIPad.minWidth
            Group {
                if wide {
                    RebuildIPadRoot(desk: desk, phone: phone, pageHost: pageHost, gate: gate)
                } else {
                    // The iPhone's native look (the owner, 2026-11-19): system chrome in the system font with
                    // Dynamic Type, Folevi's accent; notes and their cards keep Folevi's fonts.
                    phoneBody.phoneNativeChrome(menus: menus)
                }
            }
            .onChange(of: wide) { _, isWide in
                // Keep the open screen when Split View or Stage Manager crosses the layout boundary.
                if isWide { desk.open(model.top) } else { model.open(desk.route) }
            }
        }
        .ignoresSafeArea(.keyboard)
        .onChange(of: recentKey, initial: true) { _, k in showRecent(k) }
        .onChange(of: sizeClass) { _, c in if c != .regular { closeRecent() } }
        .environment(\.sheetZoom, zoom)
        .phoneSheet(isPresented: Bindable(phone).quickAddShown, size: .fit) {
            // (The iPhone's native look; the iPad keeps its own.)
            if UIDevice.current.userInterfaceIdiom == .phone {
                RebuildQuickAddSheet(phone: phone).phoneNativeChrome(menus: RebuildFrame.menus)
            } else {
                RebuildQuickAddSheet(phone: phone)
            }
        }
    }

    private var phoneBody: some View {
        PhoneFrameView(model: model, menus: menus, aiOn: phone.aiOn, tabBarHidden: selecting, actions: PhoneFrameActions(openAI: { ai.ask() }, newNote: { phone.newNote() }, fromTemplate: { model.open(FrameRoute(path: "/templates")) }, newFolder: {
            let parent: String? = if case .folder(let id) = model.top { id } else { nil }
            newFolder = NewFolderRequest(parent: parent)
        }, quickTask: { phone.quickAddShown = true })) { route in
            if case .note(let id) = route {
                RebuildNoteScreen(noteId: id, model: phone, pageHost: pageHost, frame: model, menus: menus)
            } else if route == .home {
                RebuildHomeScreen(frame: model, menus: menus, home: home, phone: phone, openAccount: { account = true }, openNotifications: { notifications = true }, newFolder: { newFolder = NewFolderRequest(parent: $0) })
            } else if case .tasks(let view) = route {
                RebuildTasksScreen(view: view, frame: model, menus: menus, home: home, phone: phone, openAccount: { account = true }, openNotifications: { notifications = true })
            } else if case .calendar(let date) = route {
                RebuildCalendarScreen(date: date, frame: model, menus: menus, home: home, phone: phone, openAccount: { account = true }, openNotifications: { notifications = true })
            } else if case .web(let path) = route, path == "/settings" || path.hasPrefix("/settings/") || path.hasPrefix("/settings?") {
                RebuildSettingsScreen(path: path, frame: model, phone: phone, signIn: { accountAction(.signInAnother) {} }, newWorkspace: { newWorkspace = true })
            } else if route == .shared {
                RebuildSharedScreen(frame: model, phone: phone)
            } else if route == .changes {
                RebuildChangesScreen(frame: model, phone: phone)
            } else if route == .web("/folders") {
                RebuildAllFoldersScreen(frame: model, menus: menus, phone: phone) { newFolder = NewFolderRequest(parent: $0) }
            } else if route == .web("/tags") {
                RebuildTagsScreen(frame: model, menus: menus, phone: phone)
            } else if case .web(let path) = route, path == "/ai" || path.hasPrefix("/ai/") || path.hasPrefix("/ai?") {
                RebuildAiPage(ai: ai, frame: model, path: path).phoneOwnBar()
            } else if case .web(let p) = route, p == "/vault" || p.hasPrefix("/vault/") {
                RebuildVaultScreen(path: p, frame: model, menus: menus, phone: phone)
            } else if case .search(let text) = route {
                RebuildSearchScreen(text: text, frame: model, menus: menus, phone: phone)
            } else if let kind = NotesListKind(route: route) {
                RebuildNotesScreen(kind: kind, frame: model, menus: menus, phone: phone, newFolder: { newFolder = NewFolderRequest(parent: $0) }) { selecting = $0 }
            } else {
                PlaceholderScreen(model: model, route: route, desk: desk).phoneOwnBar()
            }
        }
        // The keyboard covers the tab bar and the screens (the web's page doesn't move for it); a field that needs
        // room takes it itself (search, the note's bars, New folder's card).
        .ignoresSafeArea(.keyboard)
        // The screens before the app (first launch, the library, sign-in), as the web draws them, over the frame
        // while the engine says one is up ("loading" never covers a returning person's app).
        .overlay {
            if let g = phone.gate, g.gate != nil, g.gate != "loading" {
                WebGateScreen(model: gate)
                    .onAppear { gate.show(g) }
                    .onChange(of: g) { _, next in gate.show(next) }
                    .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.2), value: phone.gate?.gate)
        .overlay {
            if let request = newFolder {
                RebuildNewFolder(request: request, frame: model, menus: menus, phone: phone) { newFolder = nil }
                    .id(request.id)
                // (Its Inside menu comes out over the card.)
                PhoneMenuLayer(menus: menus)
            }
            if newWorkspace {
                RebuildNewWorkspace(phone: phone) { newWorkspace = false }
            }
        }
        .overlay(alignment: .top) {
            ToastStack(model: phone)
            #if DEBUG
            if ProcessInfo.processInfo.environment["FOLEVI_REBUILD_DEBUG"] == "1" {
                Text("gate \(phone.gate?.gate ?? "none") known \(phone.gateKnown ? "yes" : "no") state \(String(describing: phone.client.state)) note \(phone.shownNote ?? "-")")
                    .font(.caption2).padding(4).background(.yellow).padding(.top, 60)
            }
            #endif
        }
        .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { screen in
            // FOLEVI_REBUILD_SHEET=create: the Create menu at launch, over where + sits.
            guard ProcessInfo.processInfo.environment["FOLEVI_REBUILD_SHEET"] == "create", menus.open == nil else { return }
            let bottom = (UIApplication.shared.connectedScenes.first as? UIWindowScene)?.windows.first?.safeAreaInsets.bottom ?? 34
            let plus = CGRect(x: screen.maxX - 16 - 4 - 56, y: screen.maxY + bottom - max(10, bottom - 10) - 4 - 56, width: 56, height: 56)
            menus.show([
                PhoneMenuEntry(.item("New note", icon: .filePlusCorner)),
                PhoneMenuEntry(.item("From template", icon: .layoutTemplate)),
                PhoneMenuEntry(.item("New folder", icon: .folderPlus)),
                PhoneMenuEntry(.item("Quick task", icon: .listPlus)),
            ], from: plus, side: .top, align: .end, minWidth: 248)
        }
        // Foli AI from the tab bar (or search's Ask Foli AI): medium, pulled up to the whole screen. With history off,
        // its conversation goes when it closes.
        .phoneSheet(isPresented: Bindable(ai).sheetOpen, size: .medium, zoomFrom: "ai", onDismiss: { ai.sheet.closed() }) {
            RebuildAiSheet(ai: ai, frame: model)
        }
        .phoneSheet(isPresented: $notifications, size: .medium) {
            RebuildNotificationsSheet(frame: model, menus: menus, phone: phone) { notifications = false }
        }
        // Move or copy notes (the account sheet, a folder's "Move to another place…").
        .phoneSheet(isPresented: Binding(get: { phone.movePlaces != nil }, set: { if !$0 { phone.movePlaces = nil } }), size: .fit) {
            if let request = phone.movePlaces {
                RebuildMovePlacesSheet(phone: phone, request: request) { phone.movePlaces = nil }
                    .id(request.id)
            }
        }
        #if DEBUG
        // FOLEVI_REBUILD_SHEET=move: Move or copy notes at launch, once the engine is up (for checking it headlessly).
        .onChange(of: phone.client.state == .ready, initial: true) { _, ready in
            if ready, ProcessInfo.processInfo.environment["FOLEVI_REBUILD_SHEET"] == "move", phone.movePlaces == nil {
                DispatchQueue.main.asyncAfter(deadline: .now() + 1) { phone.movePlaces = MovePlacesRequest() }
            }
        }
        #endif
        .phoneSheet(isPresented: $account, size: .medium, snapToBlocks: true) {
            // (A library with no account at all is "Your library", not an "Account": IPHONE-22.)
            PhoneSheetPanel(title: places.hasAccount ? "Account" : "Your library", close: { account = false }) {
                RebuildAccountSheet(places: places) { action in
                    if action == .place(RebuildAccount.newWorkspace) {
                        account = false
                        newWorkspace = true
                    } else {
                        accountAction(action) { account = false }
                    }
                }
            }
        }
        // Opened again: the checks follow where the engine says this is, not an earlier pick.
        .onChange(of: account) { _, open in if open { places.settle() } }
        // Signing out with changes that haven't synced: what would be lost, first.
        .alert(places.signOutTitle, isPresented: Bindable(places).confirmingSignOut) {
            Button(places.signOutAction, role: .destructive) {
                account = false
                signOut()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(places.signOutMessage)
        }
    }
}

/// A screen that names its route, with links to try the stacks (a folder, a note, another tab's first screen).
/// A route the phone doesn't draw natively yet: the frame's own screen for it (FoleviMac's, the Mac's and the
/// iPad's), under the phone's bar with its back button. Its links go to the desk model, which the controller
/// forwards to the phone's stacks.
private struct PlaceholderScreen: View {
    let model: PhoneFrameModel
    let route: FrameRoute
    let desk: FrameModel
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let root = PhoneFrameModel.isTabRoot(route) && model.stack.first?.route == route
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                if !root {
                    WebGlassCircle("Back", action: { model.back() }) {
                        WebIconView(.chevronLeft, size: 22, strokeWidth: 2.2)
                    }
                }
                Text(route.fallbackTitle).webText(.display(.title3)).lineLimit(1).foregroundStyle(FoleviTokens.Chrome.heading.resolve(scheme).color)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 16)
            .frame(height: 52)
            DeskScreen(model: desk, route: route)
        }
        .background(FoleviTokens.Chrome.canvas.resolve(scheme).color.ignoresSafeArea())
        .onAppear { RebuildDeskBridge.show(route, on: desk) }
    }
}

/// Keeps the desk model on the route the phone shows, and sends where the desk's screens go to the phone.
@MainActor
enum RebuildDeskBridge {
    /// The route the phone last put the desk on (a change to anything else came from a desk screen).
    static var placed: FrameRoute?

    static func show(_ route: FrameRoute, on desk: FrameModel) {
        placed = route
        if desk.route != route { desk.open(route, .replace) }
    }
}

