// The iOS rebuild's frame (docs/IOS_REBUILD_PLAN.md, I1), while it's being built: Debug builds only, and only with
// FOLEVI_REBUILD=1 in the environment (or the `folevi.rebuild` setting). Release builds, TestFlight and today's
// frame are untouched. Screens are placeholders that name their route until the lists land (I3); a note is the real
// note page (RebuildNote.swift) on today's app's one web view and engine.
import SafariServices
import SwiftUI
import UIKit
import FoleviDesign
import FoleviEngine
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
        let root = UIHostingController(rootView: RebuildRoot(model: frame, menus: menus, phone: model, pageHost: pageHost, gate: gate, places: places, home: home, accountAction: { [weak self] action, close in
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
        // FOLEVI_REBUILD_NEWNOTE=1: a new note at launch (for checking the note page headlessly; scratch data only).
        if ProcessInfo.processInfo.environment["FOLEVI_REBUILD_NEWNOTE"] == "1" {
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in self?.model.newNote() }
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
}

private struct RebuildRoot: View {
    let model: PhoneFrameModel
    let menus: PhoneMenus
    let phone: PhoneModel
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

    var body: some View {
        PhoneFrameView(model: model, menus: menus, aiOn: phone.aiOn, tabBarHidden: selecting || model.top.isSearch, actions: PhoneFrameActions(newNote: { phone.newNote() }, fromTemplate: { model.open(FrameRoute(path: "/templates")) })) { route in
            if case .note(let id) = route {
                RebuildNoteScreen(noteId: id, model: phone, pageHost: pageHost, frame: model, menus: menus)
            } else if route == .home {
                RebuildHomeScreen(frame: model, menus: menus, home: home, phone: phone) { account = true }
            } else if case .search(let text) = route {
                RebuildSearchScreen(text: text, frame: model, menus: menus, phone: phone)
            } else if let kind = NotesListKind(route: route) {
                RebuildNotesScreen(kind: kind, frame: model, menus: menus, phone: phone) { selecting = $0 }
            } else {
                PlaceholderScreen(model: model, route: route) { account = true }
            }
        }
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
private struct PlaceholderScreen: View {
    let model: PhoneFrameModel
    let route: FrameRoute
    let openAccount: () -> Void

    var body: some View {
        let root = PhoneFrameModel.isTabRoot(route) && model.stack.first?.route == route
        PhoneScreen(PhoneScreenOptions(title: route.fallbackTitle, large: !route.isNote, eyebrow: route == .home ? "Personal" : nil), root: root, scrollToTop: model.scrollToTop, back: { model.back() }) {
            Button(action: openAccount) {
                PhonePlaceMarkView(mark: .avatar(name: "Sam Rivera", url: nil), size: 34).frame(width: 44, height: 44)
            }
            .accessibilityLabel("Account")
        } trailing: {
            WebGlassPill {
                WebPillButton("Notifications") { WebIconView(.bell, size: 21, strokeWidth: 1.9) }
                WebPillButton("More") { WebIconView(.ellipsis, size: 24, strokeWidth: 2.2) }
            }
        } content: {
            VStack(alignment: .leading, spacing: 12) {
                Text(route.path).webText(.role(.footnote)).foregroundStyle(.secondary)
                ForEach(["/folders/sample", "/d/sample-note", "/tasks/completed", "/calendar", "/documents"], id: \.self) { path in
                    WebButton("Open \(path)", variant: .secondary) { model.open(FrameRoute(path: path)) }
                        .phoneZoomSource(String(path.split(separator: "/").last ?? ""))
                }
                ForEach(0..<40, id: \.self) { i in
                    Text("Row \(i + 1)").webText(.role(.body)).foregroundStyle(.primary).frame(height: 44)
                }
            }
            .padding(.horizontal, 20)
        }
    }
}
