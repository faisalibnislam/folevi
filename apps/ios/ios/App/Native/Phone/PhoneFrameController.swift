// The window's root with the native frame (plan 4.1 and 4.6): the Page View parked at the back, the tab stacks over
// it, the gate screen or the splash when the app can't show yet, the toasts on top. It routes everything screens,
// links, notifications and keyboard shortcuts ask for: pushes native screens, opens notes with the zoom, presents
// the sheets, and starts the page again in another place (restart, as FoleviViewController did).
//
// Startup: the client gets the launch snapshot before any screen subscribes, so Home draws the last screen it had
// at once from Application Support/Places/<place>/launch.json, and the engine's live values replace it by id.
import SafariServices
import SwiftUI
import UIKit
import WebKit
import FoleviDesign
import FoleviEngine
import FoleviScreens

@MainActor
final class PhoneFrameController: UIViewController, PhoneRouting, PhoneNavigationObserver {
    func share(noteId: String) { presentShare(noteId: noteId) }

    /// The frame on show (links, notifications and Debug hooks find it here).
    static weak var current: PhoneFrameController?

    let host: WebHost
    let model: PhoneModel
    let pageHost: PageViewHost
    let snapshot: LaunchSnapshotStore
    private let transport: PhoneEngineTransport
    private let home: HomeModel
    private let tasksModel: TasksModel
    private let calendarModel: CalendarModel
    var tabs: PhoneTabsController!
    var navigator: ScreenNavigator!
    var feedback: ScreenFeedback!
    private var gateHost: UIHostingController<AnyView>?
    private var gateModel: GateModel!
    private var signInModel: SignInModel!
    private var splash: UIHostingController<SplashView>?
    private var toastHost: UIHostingController<ToastStack>!
    private var observers: [Observer] = []
    private var notificationTokens: [NSObjectProtocol] = []
    private var retiring: PageRetirement?
    private var authService: PhoneAuthService?

    init(host given: WebHost? = nil) {
        PhoneMetrics.mark("frame.init")
        PhoneMetrics.launchBegan()
        let host = given ?? WebHost.take()
        self.host = host
        let place = ShellPlaces.state.current
        let transport = PhoneEngineTransport(host: host)
        self.transport = transport
        let platform: AppInfo.Platform = UIDevice.current.userInterfaceIdiom == .pad ? .ipados : .ios
        let info = Bundle.main.infoDictionary
        let client = EngineClient(transport: transport, place: place ?? "", app: AppInfo(platform: platform, version: info?["CFBundleShortVersionString"] as? String ?? "0", build: info?["CFBundleVersion"] as? String ?? "0", protocol: EngineContract.protocolVersion, schemaHash: EngineContract.schemaHash))
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let safe = (place ?? "none").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: ":", with: "_")
        snapshot = LaunchSnapshotStore(url: support.appendingPathComponent("Places/\(safe)/launch.json"))
        client.snapshot = snapshot
        model = PhoneModel(client: client)
        pageHost = PageViewHost(pageView: host.pageView)
        // Home subscribes now (with the snapshot), before the window draws.
        home = HomeModel(client: client, feedback: ScreenFeedback())
        tasksModel = TasksModel(client: client)
        calendarModel = CalendarModel(client: client)
        super.init(nibName: nil, bundle: nil)
        host.viewController = self
        WebHost.current = host
        host.onPageLifecycle = { [weak transport] event in transport?.pageEvent(event) }
        model.router = self
        navigator = ScreenNavigator(open: { [weak self] route, source in self?.open(route, source: source) }, prepareNote: { [weak self] id in self?.model.prepare(id) })
        feedback = ScreenFeedback(toast: { [weak self] t in
            self?.model.toast(t.message, tone: t.tone == .error ? .error : t.tone == .success ? .success : .info, actionTitle: t.actionTitle, action: t.action)
        }, haptic: { h in
            switch h {
            case .selection: UISelectionFeedbackGenerator().selectionChanged()
            case .success: UINotificationFeedbackGenerator().notificationOccurred(.success)
            case .warning: UINotificationFeedbackGenerator().notificationOccurred(.warning)
            case .error: UINotificationFeedbackGenerator().notificationOccurred(.error)
            case .impactLight: UIImpactFeedbackGenerator(style: .light).impactOccurred()
            }
        })
        Self.current = self
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    deinit {
        notificationTokens.forEach(NotificationCenter.default.removeObserver)
    }

    // MARK: Building

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        authService?.window = view.window
        becomeFirstResponder()
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Chrome.canvas
        _ = FoleviFonts.register()
        pageHost.parking = view
        pageHost.park()

        let actions = RootBarActions(account: { [weak self] in self?.presentAccount(from: $0) }, notifications: { [weak self] in self?.presentNotifications(from: $0) }, sync: { [weak self] in self?.presentSync(from: $0) })
        let homeScreen = HomeScreenController(home: home, phone: model, navigator: navigator, feedback: feedback, actions: actions)
        let tasks = TabRootController(title: TasksScreen.title, content: AnyView(TasksScreen(model: tasksModel, showsHeader: true).phoneEnvironment(navigator, feedback)), trailing: barItem(TasksTrailingMenu(model: tasksModel).phoneEnvironment(navigator, feedback), glass: true), phone: model, actions: actions)
        let calendar = TabRootController(title: "Calendar", content: AnyView(CalendarScreen(model: calendarModel, showsHeader: true).phoneEnvironment(navigator, feedback)), trailing: nil, phone: model, actions: actions)
        let stacks = [homeScreen, tasks, calendar].map { PhoneNavigationController(rootViewController: $0) }
        stacks.forEach { $0.observer = self }
        tabs = PhoneTabsController(stacks: stacks)
        tabs.bar.onFoliAI = { [weak self] in self?.presentFoliAI() }
        tabs.bar.onQuickTask = { [weak self] in self?.presentQuickAdd(.task) }
        tabs.bar.plusMenu = plusMenu()
        addChild(tabs)
        tabs.view.frame = view.bounds
        tabs.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(tabs.view)
        tabs.didMove(toParent: self)

        toastHost = UIHostingController(rootView: ToastStack(model: model))
        toastHost.view.backgroundColor = .clear
        let passthrough = PassthroughView(frame: view.bounds)
        passthrough.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        passthrough.host = toastHost.view
        addChild(toastHost)
        toastHost.view.frame = passthrough.bounds
        toastHost.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        passthrough.addSubview(toastHost.view)
        view.addSubview(passthrough)
        toastHost.didMove(toParent: self)

        gateModel = GateModel(client: model.client, feedback: feedback, device: .current)
        let auth = PhoneAuthService(window: view.window)
        auth.signedIn = { [weak self] id, name, email, avatar in self?.adoptAccount(userId: id, name: name, email: email, avatarUrl: avatar) }
        signInModel = SignInModel(auth: auth, feedback: feedback, device: .current)
        authService = auth
        observeKeyboard()
        observers.append(Observer { [weak self] in self?.updateCover() })
        observers.append(Observer { [weak self] in
            guard let self else { return }
            self.tabs.bar.setAI(self.model.aiOn)
            // Encrypted spaces: no launch snapshot on disk (plan 3.7; sealing it comes with the device storage key).
            if self.model.session.value?.spaces.contains(where: { $0.encrypted }) == true { self.snapshot.clear(lock: true) }
        })
        model.start()
        PhoneMetrics.mark("frame.viewDidLoad")
        if let path = FoleviViewController.startPath {
            FoleviViewController.startPath = nil
            openPath(path)
        }
        DeepLinkRouter.bridgeReady()
    }

    /// The gate screen or the splash over the app, when the app can't show yet.
    private func updateCover() {
        let gate = model.gate
        let showsGate = gate.map { $0.gate != nil && $0.gate != "loading" } ?? false
        if showsGate, let gate {
            gateModel.show(gate)
            if gateHost == nil {
                let h = UIHostingController(rootView: AnyView(GateScreen(model: gateModel, signIn: signInModel).phoneEnvironment(navigator, feedback)))
                h.view.backgroundColor = Chrome.canvas
                addChild(h)
                h.view.frame = view.bounds
                h.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
                view.insertSubview(h.view, belowSubview: toastHost.view.superview ?? toastHost.view)
                h.didMove(toParent: self)
                gateHost = h
            }
        } else if let gateHost {
            gateHost.willMove(toParent: nil)
            gateHost.view.removeFromSuperview()
            gateHost.removeFromParent()
            self.gateHost = nil
        }
        // The splash only on a first launch (nothing to draw from the snapshot) while the page boots.
        let ready = model.client.state == .ready
        let wantsSplash = !showsGate && home.value == nil && !ready && model.session.value == nil
        if wantsSplash, splash == nil {
            let s = UIHostingController(rootView: SplashView())
            s.view.backgroundColor = Chrome.canvas
            addChild(s)
            s.view.frame = view.bounds
            s.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            view.insertSubview(s.view, belowSubview: toastHost.view.superview ?? toastHost.view)
            s.didMove(toParent: self)
            splash = s
        } else if !wantsSplash, let s = splash {
            splash = nil
            UIView.animate(withDuration: 0.18) { s.view.alpha = 0 } completion: { _ in
                s.willMove(toParent: nil)
                s.view.removeFromSuperview()
                s.removeFromParent()
            }
        }
        if !showsGate && !wantsSplash && (home.value != nil || ready) {
            PhoneMetrics.firstFrame(ready ? "live" : "snapshot")
        }
    }

    private func plusMenu() -> UIMenu {
        UIMenu(children: [
            UIAction(title: "New Note", image: UIImage(systemName: "square.and.pencil")) { [weak self] _ in self?.model.newNote() },
            UIAction(title: "From Template", image: UIImage(systemName: "rectangle.stack")) { [weak self] _ in self?.open(.notes(.templates), source: nil) },
            UIAction(title: "New Folder", image: UIImage(systemName: "folder.badge.plus")) { [weak self] _ in
                guard let self else { return }
                self.tabs.show(.home)
                self.tabs.stacks[0].popToRootViewController(animated: false)
                self.home.dialogs.open(.newFolder(parent: nil))
            },
            UIAction(title: "Quick Task", image: UIImage(systemName: "checklist")) { [weak self] _ in self?.presentQuickAdd(.task) },
        ])
    }

    // MARK: Keyboard

    private func observeKeyboard() {
        let center = NotificationCenter.default
        notificationTokens = [
            center.addObserver(forName: UIResponder.keyboardWillChangeFrameNotification, object: nil, queue: .main) { [weak self] note in
                let end = (note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue ?? .zero
                MainActor.assumeIsolated { self?.keyboardMoved(to: end, hiding: false) }
            },
            center.addObserver(forName: UIResponder.keyboardWillHideNotification, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.keyboardMoved(to: .zero, hiding: true) }
            },
            center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.snapshot.flush() }
            },
        ]
    }

    private func keyboardMoved(to end: CGRect, hiding: Bool) {
        guard let window = view.window else { return }
        let overlap = hiding ? 0 : KeyboardBridge.coveredHeight(keyboard: end, bounds: window.bounds)
        model.keyboardOverlap = overlap
        let appeared = overlap > 0 && !model.keyboardVisible
        model.keyboardVisible = overlap > 0
        if appeared { model.refreshEditorState() }
        if overlap > 0 { tabs.hideReasons.insert("keyboard") } else { tabs.hideReasons.remove("keyboard") }
    }

    // MARK: PhoneNavigationObserver

    func navigation(_ nav: PhoneNavigationController, willShow top: UIViewController, animated: Bool) {
        tabs.updateBar(animated: animated, top: top)
    }

    func navigation(_ nav: PhoneNavigationController, didShow top: UIViewController) {
        // No note on screen any more: the page view goes back behind the screens and lets the note go.
        if !(top is NoteViewController) && !(top is PageScreenController) && nav === tabs.currentStack {
            pageHost.park()
            model.closeNote()
        }
    }

    // MARK: PhoneRouting

    func open(_ route: ScreenRoute, source: CardSource?) {
        let nav = tabs.currentStack
        switch route {
        case .home:
            tabs.show(.home)
            tabs.stacks[0].popToRootViewController(animated: true)
        case .notes(let v): nav.pushViewController(listScreen(NotesListKind(v)), animated: true)
        case .folder(let id): nav.pushViewController(listScreen(.folder(id)), animated: true)
        case .tag(let id): nav.pushViewController(listScreen(.tag(id)), animated: true)
        case .allFolders: nav.pushViewController(listScreen(NotesListKind(.all)), animated: true)
        case .shared: nav.pushViewController(SharedScreenController(model: SharedListModel(client: model.client, feedback: feedback), navigator: navigator, feedback: feedback), animated: true)
        case .changes: nav.pushViewController(ChangesScreenController(model: ChangesModel(client: model.client, feedback: feedback), navigator: navigator, feedback: feedback), animated: true)
        case .reviews: nav.pushViewController(PageScreenController(page: .reviews, title: "Reviews", model: model, pageHost: pageHost), animated: true)
        case .graph: nav.pushViewController(PageScreenController(page: .graph, title: "Graph", model: model, pageHost: pageHost), animated: true)
        case .search: openSearch("")
        case .notifications: presentNotifications(from: nil)
        case .places: presentAccount(from: nil)
        case .note(let id), .noteInNewTab(let id): openNote(id, source: source, focus: false)
        case .foliAI: presentFoliAI()
        case .invite, .movePlaces: model.toast("That comes to the app with the next update.")
        case .web(let path):
            if let f = FeatureRoute(webRoute: path) { open(f) } else { model.toast("That page comes to the app with the next update.") }
        }
    }

    private func listScreen(_ kind: NotesListKind) -> ListScreenController {
        ListScreenController(list: NotesListModel(client: model.client, kind: kind, feedback: feedback), navigator: navigator, feedback: feedback, tabs: tabs)
    }

    func openNote(_ id: String, source: CardSource?, focus: Bool) {
        let nav = tabs.currentStack
        if let top = nav.topViewController as? NoteViewController, top.noteId == id { return }
        PhoneMetrics.openBegan(id)
        if model.shownNote != id { model.prepare(id) }
        let note = NoteViewController(noteId: id, source: source, focus: focus, model: model, pageHost: pageHost, router: self)
        NoteTransitions.configure(note, source: source)
        nav.pushViewController(note, animated: true)
    }

    func openExternal(_ url: URL) {
        guard let scheme = url.scheme?.lowercased() else { return }
        if scheme == "http" || scheme == "https" {
            let safari = SFSafariViewController(url: url)
            safari.preferredControlTintColor = Chrome.heading
            topmost().present(safari, animated: true)
        } else {
            UIApplication.shared.open(url)
        }
    }

    /// A folevi:// link or an app path (deep links, Spotlight, notifications, widgets).
    func openLink(_ url: URL) {
        guard let path = DeepLink.path(of: url) else { return }
        openPath(path)
    }

    func openPath(_ path: String) {
        guard isViewLoaded, tabs != nil else { return FoleviViewController.startPath = path }
        if let f = FeatureRoute(webRoute: path) { return open(f) }
        if let (kind, token) = Self.invite(in: path) { return presentInvite(kind: kind, token: token) }
        let route = ScreenRoute(webRoute: path)
        if case .web(let p) = route, p.hasPrefix("/documents") || p == "/" { return open(.home, source: nil) }
        open(route, source: nil)
    }

    private func topmost() -> UIViewController {
        var top: UIViewController = self
        while let p = top.presentedViewController { top = p }
        return top
    }

    // MARK: Tasks, Calendar, Search (FeatureRoute) and the screens' intents

    func open(_ f: FeatureRoute) {
        switch f {
        case .tasks(let v):
            tabs.show(.tasks)
            tabs.stacks[1].popToRootViewController(animated: false)
            tasksModel.select(v)
        case .calendar(let date):
            tabs.show(.calendar)
            tabs.stacks[2].popToRootViewController(animated: false)
            if let date { calendarModel.select(date) }
        case .search(let text): openSearch(text)
        case .notifications: presentNotifications(from: nil)
        case .noteBlock(let id, _): openNote(id, source: nil, focus: false)
        }
    }

    func openSearch(_ text: String) {
        let screen = SearchScreenController(model: SearchModel(client: model.client, text: text, feedback: feedback)) { [navigator, feedback] v in AnyView(v.phoneEnvironment(navigator!, feedback)) }
        tabs.currentStack.pushViewController(screen, animated: true)
    }

    /// What FoleviScreens' Tasks, Calendar, Search, Notifications and Places ask for (ScreenIntent).
    func handle(_ intent: ScreenIntent) {
        switch intent {
        case .openTasks(let v): open(.tasks(v))
        case .openCalendar(let d): open(.calendar(date: d))
        case .openNote(let id, _): openNote(id, source: nil, focus: false)
        case .openRoute(let r): openPath(r)
        case .openSettings(let section): openSettings(section: section)
        case .help: if let url = URL(string: "https://folevi.com/help") { openExternal(url) }
        case .switchPlace(let id, _): switchPlace(id)
        case .newWorkspace: model.toast("New workspaces come to the app with the next update.")
        case .signInAnotherAccount: signIn(first: false)
        case .moveOrCopy: model.toast("Moving notes between places comes to the app with the next update.")
        case .signOut(let place): if let place { signOutNow(place) }
        case .downloadFile: model.toast("Downloads come to the app with the next update.")
        case .dismiss: if presentedViewController != nil { dismiss(animated: true) }
        }
    }

    // MARK: Sheets

    func presentAccount(from anchor: UIBarButtonItem?) {
        let content = PlacesMenuContent(model: PlacesModel(client: model.client, feedback: feedback), phone: UIDevice.current.userInterfaceIdiom != .pad).phoneEnvironment(navigator, feedback)
        PhoneSheets.present(content, from: self, id: "account-sheet", anchor: anchor)
    }

    func presentNotifications(from anchor: UIBarButtonItem?) {
        let content = NotificationsContent(model: NotificationsModel(client: model.client, feedback: feedback), phone: UIDevice.current.userInterfaceIdiom != .pad).phoneEnvironment(navigator, feedback)
        PhoneSheets.present(content, from: self, id: "notifications-sheet", anchor: anchor)
    }

    func presentFoliAI() {
        PhoneSheets.present(FoliAISheet(), from: self, id: "foli-sheet")
    }

    func presentSync(from anchor: UIBarButtonItem?) {
        PhoneSheets.present(SyncSheet(phone: model), from: self, id: "sync-sheet", detents: [.medium()], anchor: anchor, popoverSize: CGSize(width: 340, height: 260))
    }

    // MARK: Places and sign-in (ShellAuth and ShellPlaces, as the page's foleviShell did)

    private func switchPlace(_ id: String) {
        guard ShellPlaces.has(id) else { return }
        dismiss(animated: true)
        ShellPlaces.setCurrent(id)
        FoleviViewController.restart()
    }

    private func signIn(first: Bool) {
        Task { @MainActor in
            guard let u = await ShellAuth.shared.signInAccount(window: self.view.window, provider: nil) else { return }
            self.adoptAccount(userId: u.userId, name: u.name, email: u.email, avatarUrl: u.avatarUrl)
        }
    }

    /// The native sign-in flow as a sheet ("Sign in to another account" could use it too).
    func presentSignIn() {
        PhoneSheets.present(SignInFlow(model: signInModel).phoneEnvironment(navigator, feedback), from: self, id: "sign-in-sheet", detents: [.large()])
    }

    /// A new session (native sign-in, or the sheet) becomes a place and the app opens again in it.
    func adoptAccount(userId: String, name: String, email: String, avatarUrl: String?) {
        let wasEmpty = ShellPlaces.state.accounts.isEmpty
        guard let a = ShellPlaces.addAccount(userId: userId, name: name, email: email, avatarUrl: avatarUrl) else { return }
        if wasEmpty { E2eeKeys.adoptLegacy(userId: userId) }
        ShellMode.current = "account"
        ShellPlaces.setCurrent(a.id)
        if presentedViewController != nil { dismiss(animated: true) }
        FoleviViewController.restart()
    }

    /// Signs out of a place (the content has already warned and the person confirmed).
    func signOutNow(_ place: String) {
        guard let user = ShellPlaces.userIdOf(place) else { return }
        Task { @MainActor in
            await ShellAuth.shared.signOut(userId: user)
            E2eeKeys.forget(userId: user)
            let after = ShellPlaces.removeAccount(place)
            ShellPlaces.setCurrent(after)
            self.snapshot.clear()
            FoleviViewController.restart()
        }
    }

    // MARK: Restart (a mode or place switch: a new page on the same storage)

    /// Sends this page away (about:blank, so its databases and locks close), then `done`; at most 1.5 s.
    func retire(then done: @escaping () -> Void) {
        model.stop()
        transport.detach()
        snapshot.flush()
        let load = PageRetirement(host.pageView) { [weak self] in
            self?.retiring = nil
            self?.host.tearDown()
            done()
        }
        retiring = load
    }

    #if DEBUG
    /// The top bar as drawn (Debug hooks): the item's title and every label in the bar with its alpha.
    func debugBar() -> [String: Any] {
        let nav = tabs.currentStack
        var labels: [String] = []
        func walk(_ v: UIView, _ a: CGFloat) {
            let alpha = a * v.alpha
            if let l = v as? UILabel, let t = l.text { labels.append("\(t) a=\(alpha) hidden=\(v.isHidden) f=\(l.frame)") }
            v.subviews.forEach { walk($0, alpha) }
        }
        walk(nav.navigationBar, 1)
        let item = nav.topViewController?.navigationItem
        return ["title": item?.title ?? "nil", "vcTitle": nav.topViewController?.title ?? "nil", "large": item?.largeTitleDisplayMode.rawValue ?? -1, "prefers": nav.navigationBar.prefersLargeTitles, "labels": labels]
    }
    #endif

    // MARK: Keyboard shortcuts (KeyCommands.swift's list, as native actions)

    override var canBecomeFirstResponder: Bool { true }

    override var keyCommands: [UIKeyCommand]? {
        FoleviShortcut.all.map { $0.keyCommand(action: #selector(pressShortcut(_:))) }
    }

    @objc private func pressShortcut(_ command: UIKeyCommand) {
        guard let s = FoleviShortcut.matching(command) else { return }
        press(s)
    }

    func press(_ shortcut: FoleviShortcut) {
        switch shortcut.title {
        case "New Note": model.newNote()
        case "Search": openSearch("")
        case "Ask Foli AI": presentFoliAI()
        case "Today's Tasks": open(.tasks(.today))
        case "Back": tabs.currentStack.popViewController(animated: true)
        default: model.toast("\(shortcut.title) comes to the app with the next update.")
        }
    }
}

/// Lets touches through except on the toasts.
final class PassthroughView: UIView {
    weak var host: UIView?
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        let hit = super.hitTest(point, with: event)
        return hit === self || hit === host ? nil : hit
    }
}

/// Loads about:blank in a page that's going away and calls back once (or after 1.5 s).
@MainActor
final class PageRetirement: NSObject, WKNavigationDelegate {
    private var done: (() -> Void)?

    init(_ view: WKWebView, done: @escaping () -> Void) {
        self.done = done
        super.init()
        view.stopLoading()
        view.navigationDelegate = self
        view.load(URLRequest(url: URL(string: "about:blank")!))
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in self?.finish() }
    }

    func finish() {
        let d = done
        done = nil
        d?()
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
        decisionHandler(navigationAction.request.url?.absoluteString == "about:blank" ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { finish() }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { finish() }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { finish() }
}
