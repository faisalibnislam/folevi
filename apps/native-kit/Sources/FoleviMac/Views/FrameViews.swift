// The Mac window's native frame, put together (docs/NATIVE_APP_PLAN.md section 4.5):
//
//   FrameRootViewController
//   ├── FrameSplitViewController (NSSplitViewController)
//   │   ├── sidebar item: SidebarViewController (translucent source list)
//   │   └── content item: ContentViewController
//   │       ├── TopBarView (52 pt: back, forward, the tab strip, New note, and on a note Share, "...", Foli AI)
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

@MainActor
public final class FrameRootViewController: NSViewController {
    public let model: FrameModel
    public let split: FrameSplitViewController
    let pageView: NSView
    private var observers: [Observer] = []
    private var gateShown = false

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
            self.setGate(!self.model.isEngineReady)
        })
    }

    /// The web gate (sign-in, onboarding, a lock, the page booting) takes the whole window; the frame comes back
    /// once the engine is up.
    private func setGate(_ on: Bool) {
        guard on != gateShown else { return }
        gateShown = on
        if on {
            pageView.removeFromSuperview()
            pageView.frame = view.bounds
            pageView.autoresizingMask = [.width, .height]
            view.addSubview(pageView, positioned: .above, relativeTo: split.view)
            split.view.isHidden = true
        } else {
            split.view.isHidden = false
            split.content.adoptPageView()
        }
    }

    /// Whether the web gate is on screen (tests, the eval hook).
    public var showsGate: Bool { gateShown }
}

@MainActor
public final class FrameSplitViewController: NSSplitViewController {
    public let model: FrameModel
    public let sidebar: SidebarViewController
    public let content: ContentViewController
    private var sidebarItem: NSSplitViewItem!

    init(model: FrameModel, pageView: NSView) {
        self.model = model
        sidebar = SidebarViewController(model: model)
        content = ContentViewController(model: model, pageView: pageView)
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not from a nib") }

    public override func viewDidLoad() {
        super.viewDidLoad()
        splitView.dividerStyle = .thin
        splitView.autosaveName = "FoleviFrameSplit"
        let side = NSSplitViewItem(sidebarWithViewController: sidebar)
        side.minimumThickness = 220
        side.maximumThickness = 360
        side.canCollapse = true
        side.allowsFullHeightLayout = true
        side.titlebarSeparatorStyle = .none
        sidebarItem = side
        let main = NSSplitViewItem(viewController: content)
        main.titlebarSeparatorStyle = .none
        main.minimumThickness = 480
        addSplitViewItem(side)
        addSplitViewItem(main)
        // 264 wide to start (polish 2.1).
        DispatchQueue.main.async { [weak self] in
            guard let self, self.splitView.autosaveName.map({ UserDefaults.standard.object(forKey: "NSSplitView Subview Frames \($0)") == nil }) ?? true else { return }
            self.splitView.setPosition(264, ofDividerAt: 0)
        }
    }

    public override func splitViewDidResizeSubviews(_ notification: Notification) {
        super.splitViewDidResizeSubviews(notification)
        let collapsed = sidebarItem?.isCollapsed ?? false
        if model.sidebarCollapsed != collapsed { model.sidebarCollapsed = collapsed }
    }

    public var isSidebarCollapsed: Bool { sidebarItem?.isCollapsed ?? false }
}

@MainActor
public final class ContentViewController: NSViewController {
    let model: FrameModel
    let pageView: NSView
    public let topBar: TopBarView
    private let body = NSView()
    private var screen: NSHostingView<ScreenRoot>?
    private lazy var models = ScreenModels(frame: model)
    private var toasts: NSHostingView<ToastStack>?
    private var observers: [Observer] = []
    private var shownRoute: FrameRoute?
    static let barHeight: CGFloat = 52

    init(model: FrameModel, pageView: NSView) {
        self.model = model
        self.pageView = pageView
        topBar = TopBarView(model: model)
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not from a nib") }

    public override func loadView() {
        let root = CanvasView()
        view = root
        topBar.translatesAutoresizingMaskIntoConstraints = false
        body.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(body)
        root.addSubview(topBar)
        let toastView = NSHostingView(rootView: ToastStack(model: model))
        toastView.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(toastView)
        toasts = toastView
        NSLayoutConstraint.activate([
            topBar.topAnchor.constraint(equalTo: root.topAnchor),
            topBar.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            topBar.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            topBar.heightAnchor.constraint(equalToConstant: Self.barHeight),
            body.topAnchor.constraint(equalTo: topBar.bottomAnchor),
            body.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            body.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            body.bottomAnchor.constraint(equalTo: root.bottomAnchor),
            toastView.centerXAnchor.constraint(equalTo: root.centerXAnchor),
            toastView.bottomAnchor.constraint(equalTo: root.bottomAnchor),
            toastView.widthAnchor.constraint(lessThanOrEqualTo: root.widthAnchor, constant: -40),
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
            if let s = screen {
                if shownRoute != route { s.rootView = ScreenRoot(model: model, models: models, route: route) }
                s.isHidden = false
            } else {
                let s = NSHostingView(rootView: ScreenRoot(model: model, models: models, route: route))
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

/// The content's background (white / near-black, the neutral chrome).
@MainActor
final class CanvasView: NSView {
    override var wantsUpdateLayer: Bool { true }
    override func updateLayer() {
        layer?.backgroundColor = NSColor(name: nil) { a in
            a.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? NSColor(srgbRed: 16 / 255, green: 16 / 255, blue: 17 / 255, alpha: 1) : .white
        }.cgColor
    }
}

/// The content's top bar (polish 2.1: 52 tall, the window buttons' centre line; 28 pt icon buttons).
@MainActor
public final class TopBarView: DragBand, TabStripDelegate {
    let model: FrameModel
    public let strip = TabStripView()
    let toggle = TopBarView.button("sidebar.left", "Show Sidebar", tip: "Show Sidebar ⌘\\")
    let back = TopBarView.button("chevron.left", "Back", tip: "Back ⌘[")
    let forward = TopBarView.button("chevron.right", "Forward", tip: "Forward ⌘]")
    let newNote = TopBarView.button("square.and.pencil", "New Note", tip: "New Note ⌘N")
    let share = TopBarView.button("square.and.arrow.up", "Share", tip: "Share")
    let more = TopBarView.button("ellipsis.circle", "More", tip: "More")
    let ai = TopBarView.button("sparkles", "Foli AI", tip: "Foli AI ⌘J")
    private var observers: [Observer] = []
    private var fullScreen = false

    init(model: FrameModel) {
        self.model = model
        super.init(frame: .zero)
        strip.delegate = self
        for (b, sel, id) in [(toggle, #selector(toggleSidebar), "toggle"), (back, #selector(goBack), "back"), (forward, #selector(goForward), "forward"), (newNote, #selector(makeNote), "newNote"), (share, #selector(shareNote), "share"), (more, #selector(moreMenu(_:)), "more"), (ai, #selector(toggleAI), "ai")] {
            b.target = self
            b.action = sel
            b.setAccessibilityIdentifier("topbar.\(id)")
            addSubview(b)
        }
        addSubview(strip)
        strip.setAccessibilityIdentifier("topbar.tabs")
        observers.append(Observer { [weak self] in self?.refresh() })
        let nc = NotificationCenter.default
        for name in [NSWindow.didEnterFullScreenNotification, NSWindow.didExitFullScreenNotification] {
            nc.addObserver(forName: name, object: nil, queue: .main) { [weak self] n in
                let source = (n.object as AnyObject?).map(ObjectIdentifier.init)
                let entering = n.name == NSWindow.didEnterFullScreenNotification
                MainActor.assumeIsolated {
                    guard let self, let w = self.window, source == ObjectIdentifier(w) else { return }
                    self.fullScreen = entering
                    self.needsLayout = true
                }
            }
        }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not from a nib") }

    static func button(_ symbol: String, _ label: String, tip: String) -> NSButton {
        let b = HoverButton()
        b.image = NSImage(systemSymbolName: symbol, accessibilityDescription: label)
        b.symbolConfiguration = .init(pointSize: 14, weight: .regular)
        b.toolTip = tip
        b.setAccessibilityLabel(label)
        return b
    }

    private func refresh() {
        let note = model.route.isNote
        strip.update(tabs: model.tabs.tabs, activeID: model.tabs.activeID)
        back.isEnabled = model.history.canGoBack
        forward.isEnabled = model.history.canGoForward
        share.isHidden = !note
        more.isHidden = !note
        ai.isHidden = !note || model.session.value?.capabilities.ai == false
        (ai as? HoverButton)?.isOn = model.editorPanel == .ai
        toggle.isHidden = !model.sidebarCollapsed
        needsLayout = true
    }

    public override func layout() {
        super.layout()
        let h = bounds.height
        let s: CGFloat = 28
        let y = (h - s) / 2
        // Room for the window buttons when the sidebar is hidden (they sit over the bar then), none in full screen.
        var x: CGFloat = model.sidebarCollapsed ? (fullScreen ? 12 : 84) : 12
        if !toggle.isHidden {
            toggle.frame = CGRect(x: x, y: y, width: s, height: s)
            x += s + 6
        }
        back.frame = CGRect(x: x, y: y, width: s, height: s)
        x += s + 2
        forward.frame = CGRect(x: x, y: y, width: s, height: s)
        x += s + 10
        var right = bounds.width - 12
        for b in [ai, more, share, newNote] where !b.isHidden {
            right -= s
            b.frame = CGRect(x: right, y: y, width: s, height: s)
            right -= 4
        }
        strip.frame = CGRect(x: x, y: 0, width: max(0, right - 8 - x), height: h)
    }

    // MARK: actions

    @objc private func toggleSidebar() { window?.firstResponder?.tryToPerform(#selector(NSSplitViewController.toggleSidebar(_:)), with: nil) }
    @objc private func goBack() { model.goBack() }
    @objc private func goForward() { model.goForward() }
    @objc private func makeNote() { model.newNote() }
    @objc private func shareNote() { model.noteMenu(.share) }
    @objc private func toggleAI() { model.toggleNoteAI() }

    @objc private func moreMenu(_ sender: NSButton) {
        NoteMenu.build(model: model).popUp(positioning: nil, at: NSPoint(x: 0, y: sender.bounds.height + 4), in: sender)
    }

    // MARK: the strip

    public func tabStrip(select id: String) { model.selectTab(id) }
    public func tabStrip(close id: String) { model.closeTab(id) }
    public func tabStrip(move id: String, to index: Int) { model.moveTab(id, to: index) }
    public func tabStrip(closeOthers id: String) { model.closeOtherTabs(id) }
    public func tabStrip(closeToTheRight id: String) { model.closeTabsToTheRight(of: id) }
    public func tabStrip(openInNewWindow id: String) {
        guard let t = model.tabs.tabs.first(where: { $0.id == id }) else { return }
        model.host?.frameOpenInNewWindow(t.route)
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

extension String {
    var nonEmpty: String? { isEmpty ? nil : self }
}
#endif
