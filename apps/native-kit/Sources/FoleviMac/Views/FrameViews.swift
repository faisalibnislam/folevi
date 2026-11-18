// The Mac window's native frame, put together (docs/MAC_NATIVE_LOOK.md; the owner's layout, 2026-11-18):
//
//   FrameRootViewController
//   ├── FrameSplitViewController (the window's translucent material and everything on it)
//   │   ├── the title bar strip: WebTopBar (traffic lights, the sidebar's button, the tabs, the bell, the inspector's)
//   │   ├── WebSidebarController: WebSidebar (SwiftUI; on the Mac its native body, WebSidebar+Mac.swift)
//   │   ├── ContentViewController: the content card, its controls floating in glass at its top (CardControls)
//   │   │   └── body: the native screen (SwiftUI) over the Page View, or the Page View (a note draws its own card)
//   │   ├── the note's inspector on the material at the right (NoteInspector)
//   │   └── a tab's picture under the pointer (TabPreviewLayer)
//   └── the Page View full window while the engine isn't up (the web's sign-in, onboarding and lock gates)
//
// One Page View per window (plan 2.1): the window's FoleviWebView, both the engine and the note page. It never
// leaves the window (so WebKit keeps its timers running); a native screen covers it while a list is in front.
#if os(macOS)
import AppKit
import SwiftUI
import WebKit
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
                // (System type and controls, as the rest of the app: docs/MAC_NATIVE_LOOK.md.)
                let host = ClickThroughHostingView(rootView: AnyView(WebGateScreen(model: gateModel).macNativeChrome().macClickThrough()))
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

/// The window's frame (the owner's layout): one translucent surface (the sidebar material, behind the window) under
/// everything; on it the title bar strip at the top, the sidebar under it at the leading edge, the content card
/// beside the sidebar (`MacLook.containerMargin` from the trailing and bottom edges, the margin on its leading edge
/// too while the sidebar is hidden), and on a note the inspector column at the trailing edge. The sidebar's button,
/// ⌘\ and View > Hide Sidebar hide the sidebar; so does Focus mode on a note. While a note's page has its own panel
/// open (Style, Format, Insert, Foli AI), the page takes the inspector's column too and draws the panel there.
/// (The name is kept from the split view it replaced: menus and the eval hook reach the sidebar and the content
/// through it.)
@MainActor
public final class FrameSplitViewController: NSViewController {
    public let model: FrameModel
    public let sidebar: WebSidebarController
    public let content: ContentViewController
    /// The title bar strip: the tabs and the strip's buttons (the traffic lights sit on it).
    public let titleBar: NSHostingView<WebTopBar>
    private var observers: [Observer] = []
    /// Under the strip's SwiftUI: the window moves from here too (never `isMovableByWindowBackground`).
    private let strip = WindowDragStrip()
    /// The note's tools on the window's material at the right (NoteInspector).
    private var inspector: NSHostingView<AnyView>?
    /// Whether the inspector is on screen (asked for, and the window wide enough beside the card).
    public private(set) var showsInspector = false
    private var laidOut: (hidden: Bool, wanted: Bool, panel: Bool)?

    init(model: FrameModel, pageView: NSView) {
        self.model = model
        sidebar = WebSidebarController(model: model)
        content = ContentViewController(model: model, pageView: pageView)
        titleBar = ClickThroughHostingView(rootView: WebTopBar(model: model))
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not from a nib") }

    public override func loadView() {
        let root = FrameMaterialRoot()
        view = root
        let material = WindowMaterialView(frame: root.bounds)
        material.autoresizingMask = [.width, .height]
        root.addSubview(material)
        addChild(sidebar)
        addChild(content)
        root.addSubview(sidebar.view)
        root.addSubview(content.view)
        let tools = ClickThroughHostingView(rootView: AnyView(NoteInspector(model: model).defaultAppStorage(WebSidebarController.defaults).macClickThrough()))
        tools.safeAreaRegions = []
        tools.sizingOptions = []
        tools.isHidden = true
        root.addSubview(tools)
        inspector = tools
        root.addSubview(strip)
        titleBar.safeAreaRegions = []
        titleBar.sizingOptions = []
        root.addSubview(titleBar)
        // A tab's picture under the pointer, over everything (the strip starts at the window's top left, so its
        // tabs' frames are the layer's).
        let preview = PassThroughHostingView(rootView: TabPreviewLayer(model: model, barOrigin: .zero))
        preview.safeAreaRegions = []
        preview.frame = root.bounds
        preview.autoresizingMask = [.width, .height]
        root.addSubview(preview)
        WebSidebarController.loadNoteToolsChoice(model)
    }

    public override func viewDidLoad() {
        super.viewDidLoad()
        observers.append(Observer { [weak self] in
            guard let self else { return }
            let now = (self.model.sidebarHidden, self.inspectorWanted, self.pagePanel)
            guard self.laidOut.map({ $0 != now }) ?? true else { return }
            let first = self.laidOut == nil
            self.laidOut = now
            self.view.needsLayout = true
            // (The sidebar or the inspector coming or going: the card eases to its new edges; none with Reduce Motion.)
            if !first, !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion, self.view.window != nil {
                NSAnimationContext.runAnimationGroup { ctx in
                    ctx.duration = 0.18
                    ctx.allowsImplicitAnimation = true
                    self.view.layoutSubtreeIfNeeded()
                }
            }
        })
    }

    /// Whether a note's tools are asked for now (the inspector shows when the window also has the room).
    private var inspectorWanted: Bool {
        model.route.isNote && model.noteToolsShown && model.editorPanel == nil && !model.focusMode
    }

    /// A note's page has its own panel open: the page takes the inspector's column for it.
    private var pagePanel: Bool { model.route.isNote && model.editorPanel != nil }

    public override func viewDidLayout() {
        super.viewDidLayout()
        let f = Self.layout(bounds: view.bounds, sidebarHidden: model.sidebarHidden, inspector: inspectorWanted, pagePanel: pagePanel)
        sidebar.view.isHidden = model.sidebarHidden
        sidebar.view.frame = f.sidebar
        content.view.frame = f.card
        strip.frame = f.strip
        titleBar.frame = f.strip
        if let inspector {
            inspector.isHidden = f.inspector == nil
            if let r = f.inspector { inspector.frame = r }
        }
        if showsInspector != (f.inspector != nil) { showsInspector = f.inspector != nil }
    }

    /// Where the strip, the sidebar, the card and the inspector go in the window's content (AppKit's origin, bottom
    /// left). `inspector`: a note's tools are asked for (they show if the card keeps `inspectorMinContent` beside
    /// them); `pagePanel`: the note's page has its own panel open and takes the inspector's column. A pure function
    /// (tests).
    nonisolated public static func layout(bounds b: CGRect, sidebarHidden: Bool, inspector: Bool = false, pagePanel: Bool = false)
        -> (sidebar: CGRect, card: CGRect, inspector: CGRect?, strip: CGRect) {
        let m = MacLook.containerMargin
        let top = MacLook.titleBarHeight
        let below = max(0, b.height - top)
        let strip = CGRect(x: 0, y: below, width: b.width, height: top)
        let side = CGRect(x: 0, y: 0, width: MacLook.sidebarWidth, height: below)
        let left = sidebarHidden ? m : MacLook.sidebarWidth
        let column = CGRect(x: b.width - MacLook.inspectorWidth, y: 0, width: MacLook.inspectorWidth, height: below)
        if pagePanel, column.minX - left >= MacLook.inspectorMinContent {
            // (The page draws its card in all but its last `inspectorWidth` points, and its panel there. Narrower,
            // the card keeps its margin and the page lays its panel over the note.)
            return (side, CGRect(x: left, y: m, width: max(0, b.width - left), height: max(0, below - m)), nil, strip)
        }
        if inspector, column.minX - left >= MacLook.inspectorMinContent {
            return (side, CGRect(x: left, y: m, width: max(0, column.minX - left), height: max(0, below - m)), column, strip)
        }
        return (side, CGRect(x: left, y: m, width: max(0, b.width - left - m), height: max(0, below - m)), nil, strip)
    }

    /// Whether the sidebar is hidden now (its button, ⌘\, or Focus mode on a note).
    public var isSidebarCollapsed: Bool { model.sidebarHidden }

    /// ⌘\, View > Hide Sidebar.
    @objc public func toggleSidebar(_ sender: Any?) {
        model.sidebarCollapsed.toggle()
    }
}

/// The window's root: the translucent material behind the sidebar and the card.
@MainActor
final class FrameMaterialRoot: NSView {
    override var isFlipped: Bool { false }
}

/// The strip along the window's top edge (above the card): a press moves the window, a double click does what
/// System Settings says a title bar's does. It takes only its own strip, so nothing in the content loses a drag.
@MainActor
final class WindowDragStrip: NSView {
    override var mouseDownCanMoveWindow: Bool { true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func mouseDown(with event: NSEvent) {
        guard let window else { return }
        if event.clickCount == 2 { WindowTitleBar.doubleClick(window) } else { window.performDrag(with: event) }
    }
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
    /// Whether a note shows its tools: "document" (the web's default) or "folders" (`folevi:doc-sidebar-mode`). The
    /// web shows them in its sidebar; the Mac in the inspector at the card's right.
    static let noteToolsKey = "folevi.sidebar.docMode"

    static func loadNoteToolsChoice(_ model: FrameModel) {
        let shown = (defaults.string(forKey: noteToolsKey) ?? "document") == "document"
        if model.noteToolsShown != shown { model.noteToolsShown = shown }
    }

    /// The top bar's Note Tools button: the inspector shown or hidden, and kept.
    public static func setNoteTools(_ model: FrameModel, shown: Bool) {
        model.noteToolsShown = shown
        defaults.set(shown ? "document" : "folders", forKey: noteToolsKey)
    }

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
        let host = ClickThroughHostingView(rootView: WebSidebar(model: model, tasks: tasks, actions: actions).defaultAppStorage(Self.defaults).macClickThrough())
        host.sizingOptions = []
        host.safeAreaRegions = []
        view = host
    }

    /// ⌘K / Open Quickly / Search All Notes / Find off a note: the top bar's search field takes the keyboard (what's
    /// typed there opens the palette with it). Typed right after the shortcut, before the field has the focus, the
    /// keys wait for it (EarlyKeys, QA audit F04) instead of reaching the note.
    public func focusSearch() {
        FrameSheets.attach(model, window: view.window)
        // On a note (no search control in its card) the palette itself, at once, as ⌘K always opened it.
        if model.route.isNote { return CommandPalette.show(model) }
        if FrameSheets.isShowing(model) { FrameSheets.dismiss(model, returnKeyboard: false) }
        if let window = view.window { EarlyKeys.start(in: window) }
        model.barSearchFocus += 1
    }

    public override func viewDidAppear() {
        super.viewDidAppear()
        FrameSheets.attach(model, window: view.window)
        AppContextMenu.attach(model, window: view.window)
        // The title bar's bell opens the notifications here.
        model.showNotifications = { [weak self] anchor in self?.showNotifications(anchor) }
        // The title bar's sync status opens the sync details here.
        model.showSync = { [weak self] anchor in self?.showSync(anchor) }
        // A search link opens ⌘K with its query, not a search tab (MAC-61).
        model.searchInPalette = { [weak self] q in
            guard let self else { return }
            FrameSheets.attach(self.model, window: self.view.window)
            CommandPalette.show(self.model, query: q)
        }
    }

    /// The bell: the web's notifications panel, in glass under the sidebar's top bar.
    private func showNotifications(_ anchor: NSView?) {
        FrameSheets.attach(model, window: view.window)
        if FrameSheets.isShowing(model) { return FrameSheets.dismiss(model) }
        // The panel is a popover from the bell.
        FrameSheets.attach(model, popoverAnchor: anchor)
        FrameDialogs.notifications(model, model: notifications)
    }

    private func showSync(_ anchor: NSView?) { show(AnyView(SyncPopover(model: model)), from: anchor) }

    private func showAccount(_ anchor: NSView?) {
        // Folevi's own menu (WebAccountMenu.swift), opening up from the account button as the web's does.
        guard let window = view.window else { return }
        if AccountMenuWindow.shown != nil { AccountMenuWindow.shown?.close(); return }
        AccountMenuWindow.show(model: model, in: window, anchor: anchor)
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
    private let body = NSView()
    /// The card's clipped inside: the Page View and the native screens (`body`) fill it (they leave the controls'
    /// room at their top and run on under them). On a note it neither fills nor clips: the page draws its own card.
    private let clip = CardClipView()
    /// The card's own controls, floating in glass at its top (CardControls).
    private var controls: NSView?
    private var screen: NSHostingView<ClickThrough<ScreenRoot>>?
    private lazy var models = ScreenModels(frame: model)
    private var toasts: NSHostingView<ToastStack>?
    private var toastCentre: NSLayoutConstraint?
    /// Ask Foli AI's floating button and chat (FoliAI/AiAskPanel.swift), over everything but a note.
    private lazy var askAi = AiAskState(frame: model, feedback: models.feedback)
    private var askAiView: NSHostingView<ClickThrough<AiAskOverlay>>?
    private var observers: [Observer] = []
    private var overviewView: NSView?
    private var shownRoute: FrameRoute?
    /// The web frame's bar room (the web's main: padding-top 56), as the iPad's frame keeps it (Platform.swift): for
    /// the iPad's layout pictured on the Mac (`macNativeLook` false). The Mac's own is FrameModel.barHeight.
    static var barHeight: CGFloat { WebStyles.named("frame.main").light.padding.top }
    /// The soft scroll edge effect under the card's controls, where a screen's content runs beneath its title.
    private let edge = ScrollEdgeBand()

    init(model: FrameModel, pageView: NSView) {
        self.model = model
        self.pageView = pageView
        FrameSheets.attach(model, page: pageView)
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not from a nib") }

    /// The card: its fill and quiet shadow behind (ContentCard), everything inside clipped to its corners.
    public override func loadView() {
        let root = ContentCard()
        // (The window switched light and dark: the chrome over a screen in the other theme switches with it.)
        root.onAppearanceChange = { [weak self] in self?.syncChromeAppearance() }
        view = root
        clip.wantsLayer = true
        clip.layer?.cornerRadius = MacLook.containerRadius
        clip.layer?.cornerCurve = .continuous
        clip.layer?.masksToBounds = true
        clip.translatesAutoresizingMaskIntoConstraints = false
        clip.onLayout = { [weak self] in self?.layoutPage() }
        root.addSubview(clip)
        body.translatesAutoresizingMaskIntoConstraints = false
        clip.addSubview(body)
        edge.translatesAutoresizingMaskIntoConstraints = false
        edge.isHidden = true
        clip.addSubview(edge)
        let bar = PassThroughControlsHostingView(rootView: CardControls(model: model))
        bar.safeAreaRegions = []
        bar.sizingOptions = []
        bar.translatesAutoresizingMaskIntoConstraints = false
        clip.addSubview(bar)
        controls = bar
        let toastView = ToastHostingView(rootView: ToastStack(model: model))
        toastView.safeAreaRegions = []
        toastView.translatesAutoresizingMaskIntoConstraints = false
        let ask = ClickThroughHostingView(rootView: ClickThrough(AiAskOverlay(frame: model, state: askAi)))
        ask.safeAreaRegions = []
        ask.sizingOptions = [.intrinsicContentSize]
        ask.translatesAutoresizingMaskIntoConstraints = false
        clip.addSubview(ask)
        askAiView = ask
        clip.addSubview(toastView)
        toasts = toastView
        // The Tab Overview, over everything in the card.
        let overview = ClickThroughHostingView(rootView: TabOverviewHost(model: model).macClickThrough())
        overview.safeAreaRegions = []
        overview.translatesAutoresizingMaskIntoConstraints = false
        overview.isHidden = true
        clip.addSubview(overview)
        overviewView = overview
        for v in [overview, bar] as [NSView] {
            NSLayoutConstraint.activate([
                v.topAnchor.constraint(equalTo: clip.topAnchor), v.bottomAnchor.constraint(equalTo: clip.bottomAnchor),
                v.leadingAnchor.constraint(equalTo: clip.leadingAnchor), v.trailingAnchor.constraint(equalTo: clip.trailingAnchor),
            ])
        }
        NSLayoutConstraint.activate([
            clip.topAnchor.constraint(equalTo: root.topAnchor),
            clip.bottomAnchor.constraint(equalTo: root.bottomAnchor),
            clip.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            clip.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            edge.topAnchor.constraint(equalTo: clip.topAnchor),
            edge.leadingAnchor.constraint(equalTo: clip.leadingAnchor),
            edge.trailingAnchor.constraint(equalTo: clip.trailingAnchor),
            edge.heightAnchor.constraint(equalToConstant: MacLook.barHeight + ScrollEdgeBand.fade),
            body.topAnchor.constraint(equalTo: clip.topAnchor),
            body.leadingAnchor.constraint(equalTo: clip.leadingAnchor),
            body.trailingAnchor.constraint(equalTo: clip.trailingAnchor),
            body.bottomAnchor.constraint(equalTo: clip.bottomAnchor),
            ask.trailingAnchor.constraint(equalTo: clip.trailingAnchor),
            ask.bottomAnchor.constraint(equalTo: clip.bottomAnchor),
            toastView.bottomAnchor.constraint(equalTo: clip.bottomAnchor),
            toastView.widthAnchor.constraint(lessThanOrEqualTo: clip.widthAnchor, constant: -40),
            // Centred on the window where it fits, but never past the card's edges (the card clips it: a long toast in a
            // narrow window lost its left edge and padding under the sidebar, MAC-36).
            toastView.leadingAnchor.constraint(greaterThanOrEqualTo: clip.leadingAnchor, constant: 20),
            toastView.trailingAnchor.constraint(lessThanOrEqualTo: clip.trailingAnchor, constant: -20),
        ])
        toastCentre = toastView.centerXAnchor.constraint(equalTo: clip.centerXAnchor)
        toastCentre?.isActive = true
    }

    /// The note's page fills the card (on a note the card is the page's: it draws its own rounded card, and its own
    /// panel in the inspector's column while that's open). The card draws its fill, shadow and clip only for a native
    /// screen, and the scroll edge effect only where a screen's content runs under its title.
    private func layoutPage() {
        if pageView.superview === clip, pageView.frame != clip.bounds { pageView.frame = clip.bounds }
        let note = model.route.isNote && body.isHidden
        (view as? ContentCard)?.drawsCard = !note
        clip.layer?.masksToBounds = !note
        edge.isHidden = note || model.route.isNote
        syncChromeAppearance()
    }

    /// A screen that draws itself in the other theme (the Vault: dark in a light window, light in a dark one).
    static func drawsOtherTheme(_ route: FrameRoute) -> Bool {
        if case .web(let path) = route { return path == "/vault" || path.hasPrefix("/vault/") }
        return false
    }

    /// Over a screen in the other theme, the card's own chrome (its fill at the corners, the scroll edge effect, the
    /// glass controls and their title, Ask Foli AI, toasts) takes that theme too: a light band and dark ink over the
    /// dark Vault read as a stripe across it. The screen itself keeps the window's appearance (it flips its own
    /// colours).
    private func syncChromeAppearance() {
        var look: NSAppearance?
        if Self.drawsOtherTheme(model.route), !body.isHidden {
            look = NSAppearance(named: view.effectiveAppearance.isDark ? .aqua : .darkAqua)
        }
        (view as? ContentCard)?.fillAppearance = look
        for v in [edge, controls, askAiView, toasts] as [NSView?] where v?.appearance?.name != look?.name {
            v?.appearance = look
        }
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
        // The floating chat ends under the card's own controls (it used to reach over the search control in a short
        // window): the card's height less the controls' room and the chat's lift above the card's bottom edge.
        let h = view.bounds.height - MacLook.barHeight - AiAskOverlay.panelLift
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
        observers.append(Observer { [weak self] in
            guard let self else { return }
            let n = self.model.screenReloads
            if n != self.reloadsSeen { self.reloadsSeen = n; self.reloadScreen() }
        })
        observers.append(Observer { [weak self] in
            guard let self else { return }
            let shown = self.model.overviewShown
            self.overviewView?.isHidden = !shown
            if !shown, self.model.route.isNote { self.view.window?.makeFirstResponder(self.pageView) }
        })
    }

    /// The Page View into the card, under the bar and the native screen. The page leaves the bar's room at its
    /// top (--native-inset-top), so a note lays out in the same space as on the web.
    func adoptPageView() {
        guard isViewLoaded, pageView.superview !== clip else { return }
        pageView.removeFromSuperview()
        // (Laid out with the inspector beside it: layoutPage.)
        pageView.autoresizingMask = []
        pageView.frame = clip.bounds
        clip.addSubview(pageView, positioned: .below, relativeTo: body)
        sendInsets()
        if model.route.isNote { view.window?.makeFirstResponder(pageView) }
    }

    /// Tells the note page how much room to leave at its top for the bar. The page counts in its own pixels,
    /// and View > Zoom (the view's pageZoom) makes each of them that many points: at 75% a 56 px inset came out
    /// 42 pt tall and the note's title slid under the bar. So the bar's height is sent divided by the zoom.
    private func sendInsets() {
        let zoom = max(0.1, (pageView as? WKWebView)?.pageZoom ?? 1)
        // (Nothing floats over a note, so the page keeps only MacLook.notePageTop, not the controls' room.)
        model.editor(.insets(top: Double(MacLook.notePageTop / zoom), bottom: 0))
    }

    /// View > Zoom changed the page's zoom (the app says so): the page's top inset is sent again at the new size.
    public func pageZoomChanged() {
        guard isViewLoaded, pageView.superview === clip else { return }
        sendInsets()
    }

    /// Uncovers the page if the native screen still covers it while a note draws (see `show`).
    private var uncoverLater: DispatchWorkItem?

    /// Runs again whenever what it reads changes (the route, the note being drawn, tab titles, the note's meta): the
    /// content itself changes only with the route, the rest is cheap (a save no longer sends the page its insets
    /// again and refocuses it).
    private func show(_ route: FrameRoute) {
        let changed = shownRoute != route
        if route.isNote {
            if changed {
                sendInsets()
                if pageView.superview === clip { view.window?.makeFirstResponder(pageView) }
            }
            // What was on screen stays over the page until the note's first frame is drawn (it opened as a blank
            // page first), at most 0.6 s. From another note there's nothing to cover: the page shows it already.
            if body.isHidden || model.drawnNote == route.noteId {
                uncover()
            } else if changed {
                uncoverLater?.cancel()
                let work = DispatchWorkItem { [weak self] in self?.uncover() }
                uncoverLater = work
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.6, execute: work)
            }
        } else {
            uncoverLater?.cancel()
            uncoverLater = nil
            body.isHidden = false
            clip.needsLayout = true
            if changed { models.prepare(route) }
            if let s = screen {
                if changed { s.rootView = ClickThrough(ScreenRoot(model: model, models: models, route: route)) }
                s.isHidden = false
            } else {
                let s = ClickThroughHostingView(rootView: ClickThrough(ScreenRoot(model: model, models: models, route: route)))
                s.safeAreaRegions = []
                s.frame = body.bounds
                s.autoresizingMask = [.width, .height]
                body.addSubview(s)
                screen = s
            }
            // Keys go to the native screen, never to the hidden note.
            if changed, view.window?.firstResponder === pageView || (view.window?.firstResponder as? NSView)?.isDescendant(of: pageView) == true {
                view.window?.makeFirstResponder(screen)
            }
        }
        shownRoute = route
        syncPageAccessibility()
        models.keep(only: Set(model.tabs.tabs.map(\.route)))
        let title = route.isNote ? (model.activeNote?.title.nonEmpty ?? model.tabs.active.title) : model.tabs.active.title
        if view.window?.title != title { view.window?.title = title }
    }

    private var reloadsSeen = 0

    /// Reload: the screen on show lets go of its models and draws again from the engine's views (the web reloads
    /// its page). A note reloads in its own page.
    private func reloadScreen() {
        let route = model.route
        guard !route.isNote, let s = screen else { return }
        models.keep(only: Set(model.tabs.tabs.map(\.route)).subtracting([route]))
        models.prepare(route)
        s.rootView = ClickThrough(ScreenRoot(model: model, models: models, route: route))
    }

    /// The note's page shows: the native screen goes, and stops drawing behind the note (its screen is emptied, so
    /// its views let go of what they watch; coming back draws it again, as a change of tab always did).
    private func uncover() {
        uncoverLater?.cancel()
        uncoverLater = nil
        guard model.route.isNote, !body.isHidden else { return }
        body.isHidden = true
        clip.needsLayout = true
        screen?.isHidden = true
        screen?.rootView = ClickThrough(ScreenRoot(model: model, models: models, route: model.route))
        syncPageAccessibility()
    }

    /// While a native screen covers it, the note's page (its title, body and editor controls) is out of the
    /// accessibility tree: VoiceOver reads only the view in front (QA audit F20). It comes back with the note.
    private func syncPageAccessibility() {
        let hide = !body.isHidden
        guard (clip.hiddenChild != nil) != hide else { return }
        clip.hiddenChild = hide ? pageView : nil
        NSAccessibility.post(element: clip, notification: .layoutChanged)
    }

    /// Whether the note's page is in the accessibility tree now (tests).
    public var pageIsAccessible: Bool { clip.hiddenChild == nil }

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

/// The soft scroll edge effect under the card's floating controls on a screen (HIG Liquid Glass: "use a scroll edge
/// effect instead of a solid or semi-opaque background color beneath them"): what scrolls under the screen's title
/// is blurred within the window, fading out `fade` points below the controls so there is no hard line.
@MainActor
final class ScrollEdgeBand: NSVisualEffectView {
    static let fade: CGFloat = 18
    private let fadeMask = CAGradientLayer()

    override init(frame: NSRect) {
        super.init(frame: frame)
        // (The card's own content background, so it reads as the card under the title, not as a bar.)
        material = .contentBackground
        blendingMode = .withinWindow
        state = .active
        wantsLayer = true
        fadeMask.colors = [NSColor.black.cgColor, NSColor.black.cgColor, NSColor.clear.cgColor]
        layer?.mask = fadeMask
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not from a nib") }

    override func layout() {
        super.layout()
        // (AppKit's layer origin is the bottom left: the fade is the band's lowest `fade` points.)
        fadeMask.frame = bounds
        let h = max(bounds.height, 1)
        fadeMask.startPoint = CGPoint(x: 0.5, y: 1)
        fadeMask.endPoint = CGPoint(x: 0.5, y: 0)
        fadeMask.locations = [0, NSNumber(value: Double(max(0, (h - Self.fade * 1.6) / h))), 1]
    }

    // Never takes a click: the bar's controls are above it, the page below.
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

/// The content card's clipped inside. A child it hides (the note's page while a native screen covers it) and
/// everything in that child are left out of its accessibility children.
final class CardClipView: NSView {
    weak var hiddenChild: NSView?
    /// Lays out what the card doesn't constrain (the note's page and the inspector beside it).
    var onLayout: (() -> Void)?

    override func layout() {
        super.layout()
        onLayout?()
    }

    override func accessibilityChildren() -> [Any]? {
        guard let all = super.accessibilityChildren(), let hidden = hiddenChild else { return super.accessibilityChildren() }
        return all.filter { !Self.element($0, isInside: hidden) }
    }

    /// Whether an accessibility element is `view` or inside it (a web view's page is an element of its own, not a
    /// subview, so this follows the parents too).
    static func element(_ element: Any, isInside view: NSView) -> Bool {
        if let v = element as? NSView { return v === view || v.isDescendant(of: view) }
        // (A control stands for itself by its cell.)
        if let v = (element as? NSCell)?.controlView { return v === view || v.isDescendant(of: view) }
        var parent = (element as? (any NSAccessibilityProtocol))?.accessibilityParent()
        for _ in 0..<12 {
            guard let p = parent else { return false }
            if let v = p as? NSView { return v === view || v.isDescendant(of: view) }
            parent = (p as? (any NSAccessibilityProtocol))?.accessibilityParent()
        }
        return false
    }
}

/// The content card's surface (the owner's window profile): `controlBackgroundColor` with 12 pt continuous corners
/// and a quiet shadow (black at 2%, radius 5, 1 pt down), in the window's appearance as it changes.
@MainActor
final class ContentCard: NSView {
    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.cornerRadius = MacLook.containerRadius
        layer?.cornerCurve = .continuous
        layer?.shadowColor = NSColor.black.cgColor
        layer?.shadowOpacity = 0.02
        layer?.shadowRadius = 5
        // (A layer's y runs up on the Mac: 1 pt down is -1.)
        layer?.shadowOffset = CGSize(width: 0, height: -1)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not from a nib") }

    /// The appearance the card's fill is drawn in when it isn't the window's (over a screen in the other theme).
    var fillAppearance: NSAppearance? {
        didSet { if fillAppearance?.name != oldValue?.name { needsDisplay = true } }
    }

    /// Off on a note: the note's page draws its own card (and its panel beside it) on the window's material.
    var drawsCard = true {
        didSet {
            guard drawsCard != oldValue else { return }
            layer?.shadowOpacity = drawsCard ? 0.02 : 0
            needsDisplay = true
        }
    }

    /// The window's appearance changed.
    var onAppearanceChange: (() -> Void)?

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        onAppearanceChange?()
    }

    override var wantsUpdateLayer: Bool { true }

    override func updateLayer() {
        var fill = NSColor.controlBackgroundColor.cgColor
        (fillAppearance ?? effectiveAppearance).performAsCurrentDrawingAppearance { fill = NSColor.controlBackgroundColor.cgColor }
        layer?.backgroundColor = drawsCard ? fill : NSColor.clear.cgColor
    }

    override func layout() {
        super.layout()
        layer?.shadowPath = CGPath(roundedRect: bounds, cornerWidth: MacLook.containerRadius, cornerHeight: MacLook.containerRadius, transform: nil)
    }
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

#endif

#if os(macOS)
/// A hosting view that takes no clicks (the tab preview: the pointer stays with the strip under it).
final class PassThroughHostingView<Content: View>: NSHostingView<Content> {
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

/// A hosting view whose first click acts (MAC-05). By default a click on a window that isn't key (another Folevi
/// window or a floating note was in front, Quick Add was open, another app was active) only brings the window forward:
/// the sidebar row, tab or button under the pointer did nothing until a second click. AppKit asks the view under the
/// click `acceptsFirstMouse(for:)` and passes that click on to it only when it says yes; this one does. Its SwiftUI
/// content says so too (`macClickThrough()`, SwiftUI's `allowsWindowActivationEvents`), for the clicks that land on
/// SwiftUI's own AppKit views inside it (a scroll view's, a text field's). Every part of the window's frame is hosted
/// in one: the sidebar, the top bar, the screens, the toasts, Ask Foli AI, dialogs and the gate.
public class ClickThroughHostingView<Content: View>: NSHostingView<Content> {
    override public func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

/// A root view that takes the first click of an inactive window (macClickThrough), for hosts typed by their root.
struct ClickThrough<Content: View>: View {
    let content: Content
    init(_ content: Content) { self.content = content }
    var body: some View { content.macClickThrough() }
}

/// The toasts' host: the room kept under them (above a note's floating page tools) lets clicks through to the
/// tools, so a toast never blocks them.
final class ToastHostingView: ClickThroughHostingView<ToastStack> {
    override func hitTest(_ point: NSPoint) -> NSView? {
        let local = convert(point, from: superview)
        let fromBottom = isFlipped ? bounds.height - local.y : local.y
        if fromBottom < ToastStack.bottomInset(onNote: rootView.model.route.isNote) { return nil }
        return super.hitTest(point)
    }
}

/// The Tab Overview while it shows (drawn fresh each time, so it opens on the tab on screen with an empty search).
struct TabOverviewHost: View {
    let model: FrameModel
    var body: some View {
        if model.overviewShown { TabOverviewLayer(model: model).macNativeChrome() }
    }
}
#endif
