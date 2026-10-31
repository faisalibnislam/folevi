// The iOS rebuild's frame (docs/IOS_REBUILD_PLAN.md, I1), while it's being built: Debug builds only, and only with
// FOLEVI_REBUILD=1 in the environment (or the `folevi.rebuild` setting). Release builds, TestFlight and today's
// frame are untouched. Screens are placeholders that name their route until the lists land (I3); a note is the real
// note page (RebuildNote.swift) on today's app's one web view and engine.
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
    static let enabled: Bool = {
        #if DEBUG
        ProcessInfo.processInfo.environment["FOLEVI_REBUILD"] == "1" || UserDefaults.standard.bool(forKey: "folevi.rebuild")
        #else
        false
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

    /// The scene's restoration activity (SceneDelegate): its type and the snapshot's key in it.
    static let restorationType = "com.folevi.ios.frame"
    static let restorationKey = "frame"

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
        let root = UIHostingController(rootView: RebuildRoot(model: frame, menus: menus, phone: model, desk: desk, pageHost: pageHost, gate: gate, places: places, home: home, accountAction: { [weak self] action, close in
            self?.account(action, places: places, close: close)
        }, signOut: { [weak self] in self?.signOutNow() }))
        root.view.backgroundColor = .clear
        addChild(root)
        root.view.frame = view.bounds
        root.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(root.view)
        root.didMove(toParent: self)
        // No note on screen any more: the page view goes back behind the screens and lets the note go.
        observers.append(Observer { [weak self] in
            guard let self else { return }
            if case .note = self.frame.top { return }
            if self.model.shownNote != nil {
                self.pageHost.park()
                self.model.closeNote()
            }
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
        // FOLEVI_REBUILD_NEWNOTE=1: a new note at launch (for checking the note page headlessly; scratch data only).
        if ProcessInfo.processInfo.environment["FOLEVI_REBUILD_NEWNOTE"] == "1" {
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in
                guard let self else { return }
                if UIDevice.current.userInterfaceIdiom == .pad, (self.view.window?.bounds.width ?? 0) >= RebuildIPad.minWidth { self.desk.newNote() } else { self.model.newNote() }
            }
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
        let overlap = hiding ? 0 : KeyboardBridge.coveredHeight(keyboard: end, bounds: window.bounds)
        model.keyboardOverlap = overlap
        let appeared = overlap > 0 && !model.keyboardVisible
        model.keyboardVisible = overlap > 0
        if appeared { model.refreshEditorState() }
    }

    // MARK: PhoneRouting

    func open(_ route: ScreenRoute, source: CardSource?) {
        switch route {
        case .home: frame.open(.home)
        case .folder(let id): frame.open(.folder(id))
        case .tag(let id): frame.open(.tag(id))
        case .notes(let v): frame.open(.notes(v))
        case .shared: frame.open(.shared)
        case .changes: frame.open(.changes)
        default: model.toast("That screen comes to the new app soon.")
        }
    }

    func openNote(_ id: String, source: CardSource?, focus: Bool) {
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

    func share(noteId: String) { model.toast("Sharing comes to this screen soon.") }

    /// A folevi:// link (another app, a widget, an App Intent, Spotlight, Handoff): its screen, in the layout on
    /// screen (the iPad's wide one opens it in the desk's tab).
    func openLink(_ url: URL) {
        switch DeepLink.parse(url.absoluteString) {
        case .newNote?: return model.newNote()
        // Quick Add (the widget, the control, the intent): the Tasks tab, where a task is added.
        case .quickAdd?: return openLink(DeepLink.tasksURL)
        default: break
        }
        guard let path = DeepLink.path(of: url) else { return }
        let route = FrameRoute(path: path)
        if UIDevice.current.userInterfaceIdiom == .pad, (view.window?.bounds.width ?? 0) >= RebuildIPad.minWidth {
            desk.open(route)
            return
        }
        if case .note(let id) = route { return openNote(id, source: nil, focus: false) }
        frame.open(route)
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

    var body: some View {
        // The iPad in a window wide enough for the sidebar: the web's desktop layout (lib/iphone.ts
        // isIpadLayout, under 700 pt the phone's); the iPhone always the phone's.
        GeometryReader { g in
            if UIDevice.current.userInterfaceIdiom == .pad, g.size.width >= RebuildIPad.minWidth {
                RebuildIPadRoot(desk: desk, phone: phone, pageHost: pageHost, gate: gate)
            } else {
                phoneBody
            }
        }
        .ignoresSafeArea(.keyboard)
    }

    private var phoneBody: some View {
        PhoneFrameView(model: model, menus: menus, aiOn: phone.aiOn, tabBarHidden: selecting || model.top.isSearch, actions: PhoneFrameActions(newNote: { phone.newNote() }, fromTemplate: { model.open(FrameRoute(path: "/templates")) })) { route in
            if case .note(let id) = route {
                RebuildNoteScreen(noteId: id, model: phone, pageHost: pageHost, frame: model, menus: menus)
            } else if route == .home {
                RebuildHomeScreen(frame: model, menus: menus, home: home, phone: phone, openAccount: { account = true }, openNotifications: { notifications = true }, newFolder: { newFolder = NewFolderRequest(parent: $0) })
            } else if route == .shared {
                RebuildSharedScreen(frame: model, phone: phone)
            } else if route == .changes {
                RebuildChangesScreen(frame: model, phone: phone)
            } else if route == .web("/folders") {
                RebuildAllFoldersScreen(frame: model, menus: menus, phone: phone) { newFolder = NewFolderRequest(parent: $0) }
            } else if case .web(let p) = route, p == "/vault" || p.hasPrefix("/vault/") {
                RebuildVaultScreen(path: p, frame: model, menus: menus, phone: phone)
            } else if case .search(let text) = route {
                RebuildSearchScreen(text: text, frame: model, menus: menus, phone: phone)
            } else if let kind = NotesListKind(route: route) {
                RebuildNotesScreen(kind: kind, frame: model, menus: menus, phone: phone) { selecting = $0 }
            } else {
                PlaceholderScreen(model: model, route: route, desk: desk)
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
        .phoneSheet(isPresented: $notifications, size: .medium) {
            RebuildNotificationsSheet(frame: model, menus: menus, phone: phone) { notifications = false }
        }
        .phoneSheet(isPresented: $account, size: .medium, snapToBlocks: true) {
            PhoneSheetPanel(title: "Account", close: { account = false }) {
                RebuildAccountSheet(places: places) { action in accountAction(action) { account = false } }
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
