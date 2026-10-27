// The Mac window's native frame, put together (docs/NATIVE_APP_PLAN.md section 4.5):
//
//   FrameRootViewController
//   ├── FrameSplitViewController (the web's layout: the window colour, the sidebar, the content card)
//   │   ├── WebSidebarController: WebSidebar (SwiftUI, the web's Sidebar.tsx)
//   │   └── ContentViewController: the rounded card
//   │       ├── WebTopBar (the web's glass bar: back, forward, tabs, New note)
//   │       └── body: the native screen (SwiftUI) over the Page View, or the Page View (a note)
//   └── the Page View full window while the engine isn't up (the web's sign-in, onboarding and lock gates)
//
// One Page View per window (plan 2.1): the window's FoleviWebView, both the engine and the note page. It never
// leaves the window (so WebKit keeps its timers running); a native screen covers it while a list is in front.
#if os(macOS)
import AppKit
import SwiftUI
import FoleviDesign
import FoleviEngine
import FoleviScreens

@MainActor
public final class FrameRootViewController: NSViewController {
    public let model: FrameModel
    public let split: FrameSplitViewController
    let pageView: NSView
    private var observers: [Observer] = []
    private var gateShown = false
    /// The native gate screen (FoleviScreens' GateScreen), over the frame while it shows.
    private var gateHost: NSHostingView<AnyView>?
    private lazy var gateModel = GateModel(client: model.client, feedback: ScreenModels(frame: model).feedback, device: .mac)
    /// Which gates draw natively; the rest (and every gate with `nativeGates` off) are the page's own screens,
    /// full window. Sign-in needs the host's AuthService and the library's setup and lock its folder pickers,
    /// which the Mac doesn't hand the screens yet, so those stay the page's.
    public static var nativeGates = true
    nonisolated static func drawsNatively(_ kind: GateKind) -> Bool {
        switch kind {
        case .loading, .signedOut, .librarySetup, .libraryLocked, .other: return false
        default: return true
        }
    }

    /// `pageView`: the window's Page View (it must be loading the app in native chrome mode).
    public init(model: FrameModel, pageView: NSView) {
        self.model = model
        self.pageView = pageView
        split = FrameSplitViewController(model: model, pageView: pageView)
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not from a nib") }

    public override func loadView() {
        view = NSView(frame: NSRect(x: 0, y: 0, width: 1280, height: 820))
        addChild(split)
        split.view.frame = view.bounds
        split.view.autoresizingMask = [.width, .height]
        view.addSubview(split.view)
    }

    public override func viewDidLoad() {
        super.viewDidLoad()
        observers.append(Observer { [weak self] in
            guard let self else { return }
            let event = self.model.gateEvent
            if let event { self.gateModel.show(event) }
            let kind = event?.gate.map(GateKind.init)
            let native = Self.nativeGates && kind.map(Self.drawsNatively) == true
            self.setGate(!self.model.isEngineReady, native: native)
        })
    }

    /// The web gate (sign-in, onboarding, a lock, the page booting) takes the whole window; the frame comes back
    /// once the engine is up.
    private func setGate(_ on: Bool, native: Bool) {
        // Native gate: GateScreen over the frame; the page's own screen stays mounted (hidden behind it) and its
        // buttons are pressed with gate.act.
        if on && native {
            if gateShown { leaveWebGate() }
            if gateHost == nil {
                let host = NSHostingView(rootView: AnyView(GateScreen(model: gateModel, signIn: nil).frame(maxWidth: .infinity, maxHeight: .infinity).background(Folevi.color.canvas)))
                host.frame = view.bounds
                host.autoresizingMask = [.width, .height]
                view.addSubview(host, positioned: .above, relativeTo: nil)
                gateHost = host
            }
            return
        }
        gateHost?.removeFromSuperview()
        gateHost = nil
        guard on != gateShown else { return }
        gateShown = on
        if on {
            pageView.removeFromSuperview()
            pageView.frame = view.bounds
            pageView.autoresizingMask = [.width, .height]
            view.addSubview(pageView, positioned: .above, relativeTo: split.view)
            split.view.isHidden = true
        } else {
            leaveWebGate()
        }
    }

    private func leaveWebGate() {
        gateShown = false
        split.view.isHidden = false
        split.content.adoptPageView()
    }

    /// Whether the web gate is on screen (tests, the eval hook).
    public var showsGate: Bool { gateShown }
    /// Whether the native gate screen is on screen.
    public var showsNativeGate: Bool { gateHost != nil }
}

/// The window's frame laid out as the web app's (Shell.tsx as Folevi for Mac shows it, from "frame.*" styles):
/// the window's own background, the sidebar 8 pt from the edges, and the content as a rounded card beside it,
/// its glass top bar floating inside. (The name is kept from the split view it replaced: menus and the eval hook
/// reach the sidebar and the content through it.)
@MainActor
public final class FrameSplitViewController: NSViewController {
    public let model: FrameModel
    public let sidebar: WebSidebarController
    public let content: ContentViewController
    private var observers: [Observer] = []

    init(model: FrameModel, pageView: NSView) {
        self.model = model
        sidebar = WebSidebarController(model: model)
        content = ContentViewController(model: model, pageView: pageView)
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not from a nib") }

    public override func loadView() {
        let root = WebFrameView()
        view = root
        addChild(sidebar)
        addChild(content)
        root.addSubview(sidebar.view)
        root.addSubview(content.view)
    }

    public override func viewDidLoad() {
        super.viewDidLoad()
        observers.append(Observer { [weak self] in
            guard let self else { return }
            _ = self.model.sidebarCollapsed
            self.view.needsLayout = true
        })
    }

    public override func viewDidLayout() {
        super.viewDidLayout()
        let b = view.bounds
        let side = WebStyles.named("frame.sidebar").light
        let card = WebStyles.named("frame.content").light
        let m = side.y
        sidebar.view.isHidden = model.sidebarCollapsed
        // (AppKit's origin is the bottom left.)
        sidebar.view.frame = CGRect(x: side.x, y: m, width: side.width, height: max(0, b.height - m * 2))
        let left = model.sidebarCollapsed ? m : card.x
        content.view.frame = CGRect(x: left, y: m, width: max(0, b.width - left - m), height: max(0, b.height - m * 2))
    }

    /// ⌘\, View > Hide Sidebar.
    @objc public func toggleSidebar(_ sender: Any?) {
        model.sidebarCollapsed.toggle()
        NSAnimationContext.runAnimationGroup { ctx in
            ctx.duration = 0.18
            view.layoutSubtreeIfNeeded()
        }
    }

    public var isSidebarCollapsed: Bool { model.sidebarCollapsed }
}

/// The window's background behind the sidebar and the card: the system window colour, as the web page in the
/// shipped app is transparent over it.
@MainActor
final class WebFrameView: NSView {
    override var isFlipped: Bool { false }
    override var wantsUpdateLayer: Bool { true }
    override func updateLayer() { layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor }
}

/// The web-drawn sidebar in the frame, with the popovers its buttons open.
@MainActor
public final class WebSidebarController: NSViewController {
    let model: FrameModel
    private var popover: NSPopover?
    private lazy var notifications = NotificationsModel(client: model.client, feedback: ScreenModels(frame: model).feedback)
    private lazy var tasks: ValueStore<TaskCounts> = model.client.watch(.tasksCounts(), snapshotKey: "tasks.counts")
    /// Where sidebar choices are kept (the app sets its own domain).
    public static var defaults: UserDefaults = .standard

    init(model: FrameModel) {
        self.model = model
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not from a nib") }

    public override func loadView() {
        var actions = WebSidebarActions()
        actions.notifications = { [weak self] anchor in self?.showNotifications(anchor) }
        actions.account = { [weak self] anchor in self?.showAccount(anchor) }
        actions.sync = { [weak self] anchor in self?.showSync(anchor) }
        let host = NSHostingView(rootView: WebSidebar(model: model, tasks: tasks, actions: actions).defaultAppStorage(Self.defaults))
        host.sizingOptions = []
        host.safeAreaRegions = []
        view = host
    }

    /// ⌘K / Open Quickly / Search All Notes: the search page (the web's palette).
    public func focusSearch() {
        if model.sidebarCollapsed { model.sidebarCollapsed = false }
        model.open(.search(""))
    }

    private func showNotifications(_ anchor: NSView?) {
        let close: @MainActor () -> Void = { [weak self] in self?.popover?.close() }
        let content = NotificationsContent(model: notifications, phone: false)
            .frame(width: 384, height: 480)
            .environment(\.screenIntents, FrameNavigation.intents(model, close: close))
            .environment(\.screenNavigator, FrameNavigation.navigator(model))
            .environment(\.screenFeedback, ScreenModels(frame: model).feedback)
            .accessibilityIdentifier("popover.notifications")
        show(AnyView(content), from: anchor)
    }

    private func showSync(_ anchor: NSView?) { show(AnyView(SyncPopover(model: model)), from: anchor) }

    private func showAccount(_ anchor: NSView?) {
        let menu = AccountMenu.build(model: model)
        let at = anchor.map { view.convert($0.bounds.origin, from: $0) } ?? NSPoint(x: 10, y: 60)
        menu.popUp(positioning: nil, at: at, in: view)
    }

    private func show(_ content: AnyView, from anchor: NSView?) {
        popover?.close()
        let p = NSPopover()
        p.behavior = .transient
        p.contentViewController = NSHostingController(rootView: content)
        let target = anchor ?? view
        p.show(relativeTo: target.bounds, of: target, preferredEdge: .maxY)
        popover = p
    }

    /// The popover on screen (tests, the eval hook).
    public var shownPopover: NSPopover? { popover?.isShown == true ? popover : nil }
    public func openSyncPopover() { showSync(nil) }
    public func openNotificationsPopover() { showNotifications(nil) }
}

@MainActor
public final class ContentViewController: NSViewController {
    let model: FrameModel
    let pageView: NSView
    public let topBar: NSHostingView<WebTopBar>
    private let body = NSView()
    private var screen: NSHostingView<ScreenRoot>?
    private lazy var models = ScreenModels(frame: model)
    private var toasts: NSHostingView<ToastStack>?
    private var observers: [Observer] = []
    private var shownRoute: FrameRoute?
    /// Where the content starts under the glass bar (the web's main: padding-top 56).
    static var barHeight: CGFloat { WebStyles.named("frame.main").light.padding.top }

    init(model: FrameModel, pageView: NSView) {
        self.model = model
        self.pageView = pageView
        topBar = NSHostingView(rootView: WebTopBar(model: model))
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not from a nib") }

    /// The card: its fill and shadows (the web's frame.content) behind, everything inside clipped to its corners.
    public override func loadView() {
        let card = WebStyles.named("frame.content")
        let root = NSView()
        view = root
        let back = NSHostingView(rootView: Color.clear.webBox(card))
        // (The frame draws under the title bar, as the web page does: no safe area anywhere in it.)
        back.safeAreaRegions = []
        topBar.safeAreaRegions = []
        back.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(back)
        let clip = NSView()
        clip.wantsLayer = true
        clip.layer?.cornerRadius = card.light.radius
        clip.layer?.masksToBounds = true
        clip.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(clip)
        topBar.translatesAutoresizingMaskIntoConstraints = false
        body.translatesAutoresizingMaskIntoConstraints = false
        clip.addSubview(body)
        clip.addSubview(topBar)
        let toastView = NSHostingView(rootView: ToastStack(model: model))
        toastView.safeAreaRegions = []
        toastView.translatesAutoresizingMaskIntoConstraints = false
        clip.addSubview(toastView)
        toasts = toastView
        let bar = WebStyles.named("frame.topbar").light
        let inset = bar.y - card.light.y
        NSLayoutConstraint.activate([
            back.topAnchor.constraint(equalTo: root.topAnchor),
            back.bottomAnchor.constraint(equalTo: root.bottomAnchor),
            back.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            back.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            clip.topAnchor.constraint(equalTo: root.topAnchor),
            clip.bottomAnchor.constraint(equalTo: root.bottomAnchor),
            clip.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            clip.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            topBar.topAnchor.constraint(equalTo: clip.topAnchor, constant: inset),
            topBar.leadingAnchor.constraint(equalTo: clip.leadingAnchor, constant: bar.x - card.light.x),
            topBar.trailingAnchor.constraint(equalTo: clip.trailingAnchor, constant: -(bar.x - card.light.x)),
            topBar.heightAnchor.constraint(equalToConstant: bar.height),
            body.topAnchor.constraint(equalTo: clip.topAnchor, constant: Self.barHeight),
            body.leadingAnchor.constraint(equalTo: clip.leadingAnchor),
            body.trailingAnchor.constraint(equalTo: clip.trailingAnchor),
            body.bottomAnchor.constraint(equalTo: clip.bottomAnchor),
            toastView.centerXAnchor.constraint(equalTo: clip.centerXAnchor),
            toastView.bottomAnchor.constraint(equalTo: clip.bottomAnchor),
            toastView.widthAnchor.constraint(lessThanOrEqualTo: clip.widthAnchor, constant: -40),
        ])
    }

    public override func viewDidLoad() {
        super.viewDidLoad()
        adoptPageView()
        observers.append(Observer { [weak self] in
            guard let self else { return }
            self.show(self.model.route)
        })
        observers.append(Observer { [weak self] in
            guard let self else { return }
            _ = self.model.folders.value
            self.model.refreshTitles()
        })
    }

    /// The Page View into the body, under the native screen.
    func adoptPageView() {
        guard isViewLoaded, pageView.superview !== body else { return }
        pageView.removeFromSuperview()
        pageView.frame = body.bounds
        pageView.autoresizingMask = [.width, .height]
        body.addSubview(pageView, positioned: .below, relativeTo: screen)
        if model.route.isNote { view.window?.makeFirstResponder(pageView) }
    }

    private func show(_ route: FrameRoute) {
        if route.isNote {
            screen?.isHidden = true
            if pageView.superview === body { view.window?.makeFirstResponder(pageView) }
        } else {
            models.prepare(route)
            if let s = screen {
                if shownRoute != route { s.rootView = ScreenRoot(model: model, models: models, route: route) }
                s.isHidden = false
            } else {
                let s = NSHostingView(rootView: ScreenRoot(model: model, models: models, route: route))
                s.safeAreaRegions = []
                s.frame = body.bounds
                s.autoresizingMask = [.width, .height]
                body.addSubview(s, positioned: .above, relativeTo: pageView.superview === body ? pageView : nil)
                screen = s
            }
            // Keys go to the native screen, never to the hidden note.
            if view.window?.firstResponder === pageView || (view.window?.firstResponder as? NSView)?.isDescendant(of: pageView) == true {
                view.window?.makeFirstResponder(screen)
            }
        }
        shownRoute = route
        models.keep(only: Set(model.tabs.tabs.map(\.route)))
        view.window?.title = route.isNote ? (model.activeNote?.title.nonEmpty ?? model.tabs.active.title) : model.tabs.active.title
    }

    /// View > As Cards / As List for the note list on screen (nil: no list on screen).
    public var listShowsCards: Bool? {
        models.listModel(for: model.route).map { $0.layout == .cards }
    }

    public func setListCards(_ cards: Bool) {
        models.listModel(for: model.route)?.layout = cards ? .cards : .list
    }

    /// Whether a native screen covers the Page View now (tests).
    public var showsNativeScreen: Bool { screen.map { !$0.isHidden } ?? false }
}

/// A 28 pt toolbar button with the Mac's quiet hover and press fills (polish 2.4), and an "on" state.
@MainActor
final class HoverButton: NSButton {
    private var hovering = false { didSet { updateLayer() } }
    private var tracking: NSTrackingArea?
    var isOn = false { didSet { if isOn != oldValue { updateLayer() } } }

    init() {
        super.init(frame: .zero)
        isBordered = false
        title = ""
        imagePosition = .imageOnly
        wantsLayer = true
        layer?.cornerRadius = 6
        contentTintColor = .secondaryLabelColor
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not from a nib") }

    override var mouseDownCanMoveWindow: Bool { false }
    override var wantsUpdateLayer: Bool { true }

    override func updateLayer() {
        let dark = effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
        let fill: CGFloat = isHighlighted ? (dark ? 0.10 : 0.09) : (hovering || isOn) ? (dark ? 0.07 : 0.05) : 0
        layer?.backgroundColor = (dark ? NSColor(white: 1, alpha: fill) : NSColor(white: 0, alpha: fill)).cgColor
        contentTintColor = isOn ? .labelColor : (isEnabled ? .secondaryLabelColor : .tertiaryLabelColor)
    }

    override var isEnabled: Bool { didSet { updateLayer() } }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let t = tracking { removeTrackingArea(t) }
        let t = NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect], owner: self)
        addTrackingArea(t)
        tracking = t
    }

    override func mouseEntered(with event: NSEvent) { hovering = true }
    override func mouseExited(with event: NSEvent) { hovering = false }
}

extension String {
    var nonEmpty: String? { isEmpty ? nil : self }
}
#endif
