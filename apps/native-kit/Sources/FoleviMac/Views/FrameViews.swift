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
import CoreImage
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
    /// The native gate screen (WebGateScreen, the web's screens before the app), over the frame while it shows.
    private var gateHost: NSHostingView<AnyView>?
    private lazy var gateModel = GateModel(client: model.client, feedback: ScreenModels(frame: model).feedback, device: .mac)
    /// Which gates draw natively: every gate the page names (its buttons are `gate.act`, so the page's handlers
    /// open the folder picker and the sign-in sheet); an unknown one (and every gate with `nativeGates` off) is
    /// the page's own screen, full window.
    public static var nativeGates = true
    nonisolated static func drawsNatively(_ kind: GateKind) -> Bool {
        switch kind {
        case .other: return false
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
                let host = NSHostingView(rootView: AnyView(WebGateScreen(model: gateModel)))
                host.safeAreaRegions = []
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
        let canvas = NSHostingView(rootView: WebCanvas())
        canvas.safeAreaRegions = []
        canvas.frame = root.bounds
        canvas.autoresizingMask = [.width, .height]
        root.addSubview(canvas)
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

/// The window's root: the web's canvas (WebCanvas) behind the sidebar and the card.
@MainActor
final class WebFrameView: NSView {
    override var isFlipped: Bool { false }
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

    /// ⌘K / Open Quickly / Search All Notes: the web's palette, as a sheet at the window's top.
    public func focusSearch() {
        FrameSheets.attach(model, window: view.window)
        CommandPalette.show(model)
    }

    public override func viewDidAppear() {
        super.viewDidAppear()
        FrameSheets.attach(model, window: view.window)
    }

    /// The bell: the web's notifications panel, in glass under the sidebar's top bar.
    private func showNotifications(_ anchor: NSView?) {
        FrameSheets.attach(model, window: view.window)
        if FrameSheets.isShowing(model) { return FrameSheets.dismiss(model) }
        FrameDialogs.notifications(model, model: notifications)
    }

    private func showSync(_ anchor: NSView?) { show(AnyView(SyncPopover(model: model)), from: anchor) }

    private func showAccount(_ anchor: NSView?) {
        // Folevi's own menu (WebAccountMenu.swift), opening up from the account button as the web's does.
        guard let window = view.window else { return }
        if AccountMenuWindow.shown != nil { AccountMenuWindow.shown?.close(); return }
        AccountMenuWindow.show(model: model, in: window)
    }

    private func show(_ content: AnyView, from anchor: NSView?) {
        popover?.close()
        let p = NSPopover()
        p.behavior = .transient
        p.contentViewController = NSHostingController(rootView: content)
        let target = anchor ?? view
        p.appearance = target.window?.appearance
        p.show(relativeTo: target.bounds, of: target, preferredEdge: .maxY)
        popover = p
    }

    /// The popover on screen (tests, the eval hook).
    public var shownPopover: NSPopover? { popover?.isShown == true ? popover : nil }
    public func openSyncPopover() { showSync(nil) }
    public func openAccountMenu() { showAccount(nil) }
    public func openNotificationsPopover() { showNotifications(nil) }
}

@MainActor
public final class ContentViewController: NSViewController {
    let model: FrameModel
    let pageView: NSView
    public let topBar: NSHostingView<WebTopBar>
    private let body = NSView()
    /// The card's clipped inside: the Page View and the native screens (`body`) fill it, under the glass bar, as the
    /// web's main does (they leave the bar's room at their top and scroll behind it).
    private let clip = NSView()
    /// What's under the bar, blurred (the web's ui-glass backdrop-filter), behind the bar's own tint.
    private let glass = GlassBackdrop()
    private var screen: NSHostingView<ScreenRoot>?
    private lazy var models = ScreenModels(frame: model)
    private var toasts: NSHostingView<ToastStack>?
    private var toastCentre: NSLayoutConstraint?
    /// Ask Foli AI's floating button and chat (FoliAI/AiAskPanel.swift), over everything but a note.
    private lazy var askAi = AiAskState(frame: model, feedback: models.feedback)
    private var askAiView: NSHostingView<AiAskOverlay>?
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
        // Its size comes from the constraints below. Without this the hosting view also lays the bar out at its ideal
        // width to measure itself, and the tab strip (sized to what's left it) would take that pass for real.
        topBar.sizingOptions = []
        back.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(back)
        clip.wantsLayer = true
        clip.layer?.cornerRadius = card.light.radius
        clip.layer?.masksToBounds = true
        clip.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(clip)
        topBar.translatesAutoresizingMaskIntoConstraints = false
        body.translatesAutoresizingMaskIntoConstraints = false
        clip.addSubview(body)
        glass.translatesAutoresizingMaskIntoConstraints = false
        glass.cornerRadius = WebStyles.named("frame.topbar").light.radius
        clip.addSubview(glass)
        clip.addSubview(topBar)
        let toastView = NSHostingView(rootView: ToastStack(model: model))
        toastView.safeAreaRegions = []
        toastView.translatesAutoresizingMaskIntoConstraints = false
        let ask = NSHostingView(rootView: AiAskOverlay(frame: model, state: askAi))
        ask.safeAreaRegions = []
        ask.sizingOptions = [.intrinsicContentSize]
        ask.translatesAutoresizingMaskIntoConstraints = false
        clip.addSubview(ask)
        askAiView = ask
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
            glass.topAnchor.constraint(equalTo: topBar.topAnchor),
            glass.bottomAnchor.constraint(equalTo: topBar.bottomAnchor),
            glass.leadingAnchor.constraint(equalTo: topBar.leadingAnchor),
            glass.trailingAnchor.constraint(equalTo: topBar.trailingAnchor),
            body.topAnchor.constraint(equalTo: clip.topAnchor),
            body.leadingAnchor.constraint(equalTo: clip.leadingAnchor),
            body.trailingAnchor.constraint(equalTo: clip.trailingAnchor),
            body.bottomAnchor.constraint(equalTo: clip.bottomAnchor),
            ask.trailingAnchor.constraint(equalTo: clip.trailingAnchor),
            ask.bottomAnchor.constraint(equalTo: clip.bottomAnchor),
            toastView.bottomAnchor.constraint(equalTo: clip.bottomAnchor),
            toastView.widthAnchor.constraint(lessThanOrEqualTo: clip.widthAnchor, constant: -40),
        ])
        toastCentre = toastView.centerXAnchor.constraint(equalTo: clip.centerXAnchor)
        toastCentre?.isActive = true
    }

    /// Toasts sit at the bottom centre of the window, as the web's fixed toast region (not of the content card).
    public override func viewDidAppear() {
        super.viewDidAppear()
        guard let toasts, let cv = view.window?.contentView, toasts.isDescendant(of: cv) else { return }
        toastCentre?.isActive = false
        toastCentre = toasts.centerXAnchor.constraint(equalTo: cv.centerXAnchor)
        toastCentre?.priority = .defaultHigh
        toastCentre?.isActive = true
    }

    public override func viewDidLayout() {
        super.viewDidLayout()
        // The floating chat is at most the window's height less 136 pt (the web's min(640px, 100dvh - 136px)).
        let h = (view.window?.contentView?.bounds.height ?? view.bounds.height) - 136
        if abs(askAi.maxHeight - h) > 0.5 { askAi.maxHeight = h }
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

    /// The Page View into the card, under the bar and the native screen. The page leaves the bar's room at its
    /// top (--native-inset-top), so a note lays out in the same space as on the web.
    func adoptPageView() {
        guard isViewLoaded, pageView.superview !== clip else { return }
        pageView.removeFromSuperview()
        pageView.frame = clip.bounds
        pageView.autoresizingMask = [.width, .height]
        clip.addSubview(pageView, positioned: .below, relativeTo: body)
        model.editor(.insets(top: Double(Self.barHeight), bottom: 0))
        if model.route.isNote { view.window?.makeFirstResponder(pageView) }
    }

    private func show(_ route: FrameRoute) {
        if route.isNote {
            screen?.isHidden = true
            body.isHidden = true
            model.editor(.insets(top: Double(Self.barHeight), bottom: 0))
            if pageView.superview === clip { view.window?.makeFirstResponder(pageView) }
        } else {
            body.isHidden = false
            models.prepare(route)
            if let s = screen {
                if shownRoute != route { s.rootView = ScreenRoot(model: model, models: models, route: route) }
                s.isHidden = false
            } else {
                let s = NSHostingView(rootView: ScreenRoot(model: model, models: models, route: route))
                s.safeAreaRegions = []
                s.frame = body.bounds
                s.autoresizingMask = [.width, .height]
                body.addSubview(s)
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

/// The tab strip's backdrop: whatever scrolls under it, blurred and saturated as the web's ui-glass
/// (`backdrop-filter: blur(30px) saturate(1.8)`), clipped to the bar's corners. The bar draws its tint and edges on top.
@MainActor
public final class GlassBackdrop: NSView {
    var cornerRadius: CGFloat = 0 { didSet { layer?.cornerRadius = cornerRadius } }

    /// The web's blur(30px) saturate(1.8), in order (screenshots apply the same to what they captured).
    public static func filters() -> [CIFilter] {
        let blur = CIFilter(name: "CIGaussianBlur")!
        blur.setValue(30, forKey: kCIInputRadiusKey)
        let saturate = CIFilter(name: "CIColorControls")!
        saturate.setValue(1.8, forKey: kCIInputSaturationKey)
        return [blur, saturate]
    }

    init() {
        super.init(frame: .zero)
        wantsLayer = true
        layerUsesCoreImageFilters = true
        layer?.masksToBounds = true
        backgroundFilters = Self.filters()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not from a nib") }

    public override func hitTest(_ point: NSPoint) -> NSView? { nil }
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
