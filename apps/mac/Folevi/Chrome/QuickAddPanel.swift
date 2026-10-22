// Quick Add from any app (docs/MAC_POLISH_PLAN.md §3.8): a floating panel that takes the keyboard without making
// Folevi the active app, so the app in front stays in front and a full-screen Space doesn't switch (Things' Quick
// Entry, Raycast). The HUD material is under a clear page (the page draws the field; WM4's one growing field,
// <html data-mac-panel="quick-add" data-vibrancy="hud">). It opens on the screen with the pointer, 28 % from the
// top, grows with the page (foleviDesktop.sizeQuickAdd), and goes away on Escape (the page) or a click elsewhere.
// It shows the Quick Add place's page (docs/MULTI_ACCOUNT_PLAN.md §6): picking another place there opens it again
// in that place.
import AppKit
import WebKit

final class QuickAddWindow: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }

    /// Escape that the page didn't take.
    override func cancelOperation(_ sender: Any?) {
        MainActor.assumeIsolated { QuickAddPanel.shared.hide() }
    }
}

@MainActor
final class QuickAddPanel: NSObject, NSWindowDelegate {
    static let shared = QuickAddPanel()

    static let width: CGFloat = 640
    static let minHeight: CGFloat = 56
    /// Today's labelled form is taller than the one growing field (160 at most) that replaces it.
    static let maxHeight: CGFloat = 640
    static let radius: CGFloat = 18

    private(set) var panel: QuickAddWindow?
    private(set) var view: FoleviWebView?
    private var material: NSVisualEffectView?
    private var height: CGFloat = 320
    private var placesObserver: NSObjectProtocol?

    /// The place Quick Add adds to: the one picked there last, or the open place.
    var place: String? {
        let q = ShellPlaces.state.quickAdd
        return q.flatMap { ShellPlaces.has($0) ? $0 : nil } ?? WindowManager.shared.currentPlace()
    }

    var isShown: Bool { panel?.isVisible == true }

    func toggle() {
        if let panel, panel.isVisible, panel.isKeyWindow { hide() } else { show() }
    }

    func show() {
        // Before the first launch's choice there's nothing to add to: the main window says what to do.
        guard ShellMode.current != "unset" else {
            WindowManager.shared.showMain()
            return
        }
        let panel = self.panel ?? makePanel()
        if view == nil || view?.place != place { load() }
        position(panel)
        panel.alphaValue = 1
        panel.makeKeyAndOrderFront(nil)
        if let view { panel.makeFirstResponder(view) }
        if let view { Chrome.whenLoaded(view) { Events.command(["type": "quick-add-shown"], to: $0) } }
    }

    func hide() {
        guard let panel, panel.isVisible else { return }
        NSAnimationContext.runAnimationGroup({ ctx in
            ctx.duration = 0.15
            panel.animator().alphaValue = 0
        }, completionHandler: {
            MainActor.assumeIsolated {
                panel.orderOut(nil)
                panel.alphaValue = 1
            }
        })
    }

    /// The page's height (CSS px): the panel grows downwards, its top staying put.
    func size(height h: Double) {
        let next = min(Self.maxHeight, max(Self.minHeight, CGFloat(h) * (view?.pageZoom ?? 1))).rounded()
        guard next != height || panel?.frame.height != next else { return }
        height = next
        guard let panel else { return }
        var f = panel.frame
        let top = f.maxY
        f.size = NSSize(width: Self.width, height: next)
        f.origin.y = top - next
        panel.setFrame(f, display: true, animate: false)
        panel.invalidateShadow()
    }

    // MARK: making it

    private func makePanel() -> QuickAddWindow {
        let panel = QuickAddWindow(contentRect: NSRect(x: 0, y: 0, width: Self.width, height: height), styleMask: [.nonactivatingPanel, .borderless, .fullSizeContentView], backing: .buffered, defer: false)
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient, .ignoresCycle]
        panel.becomesKeyOnlyIfNeeded = false
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.isMovableByWindowBackground = false
        panel.backgroundColor = .clear
        panel.isOpaque = false
        panel.hasShadow = true
        panel.animationBehavior = .utilityWindow
        panel.title = "Quick Add"
        panel.delegate = self

        let effect = NSVisualEffectView(frame: NSRect(x: 0, y: 0, width: Self.width, height: height))
        effect.material = .hudWindow
        effect.blendingMode = .behindWindow
        effect.state = .active
        effect.maskImage = Self.roundedMask(radius: Self.radius)
        effect.autoresizingMask = [.width, .height]
        panel.contentView = effect
        material = effect
        self.panel = panel

        placesObserver = NotificationCenter.default.addObserver(forName: ShellPlaces.changed, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated {
                // Another place picked for Quick Add (or the open place changed): its page, in that place.
                let me = QuickAddPanel.shared
                if me.view != nil, me.view?.place != me.place { me.load() }
            }
        }
        return panel
    }

    /// The page of the Quick Add place, new (a place change makes a new view: its session and data are that place's).
    private func load() {
        guard let panel, let content = panel.contentView else { return }
        let old = view
        let place = self.place
        let next = WebViewFactory.make(place: place, role: .quickAdd, bootstrap: WindowManager.shared.bootstrapOf(place, .quickAdd), frame: content.bounds, window: { [weak panel] in panel })
        next.autoresizingMask = [.width, .height]
        next.wantsLayer = true
        next.layer?.cornerRadius = Self.radius
        next.layer?.masksToBounds = true
        old?.load(URLRequest(url: URL(string: "about:blank")!))
        old?.removeFromSuperview()
        content.addSubview(next)
        view = next
        let path = place.map { "/quick-add?place=\($0.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "")" } ?? "/quick-add"
        next.load(URLRequest(url: Links.appURL(path)))
    }

    /// On the screen with the pointer, centred, its top 28 % down the screen.
    private func position(_ panel: NSPanel) {
        let mouse = NSEvent.mouseLocation
        let screen = NSScreen.screens.first { NSMouseInRect(mouse, $0.frame, false) } ?? NSScreen.main ?? NSScreen.screens.first
        guard let area = screen?.visibleFrame else { return }
        let top = area.maxY - area.height * 0.28
        panel.setFrame(NSRect(x: (area.midX - Self.width / 2).rounded(), y: (top - height).rounded(), width: Self.width, height: height), display: false)
    }

    /// A 9-slice rounded rectangle for the material's corners.
    static func roundedMask(radius: CGFloat) -> NSImage {
        let edge = radius * 2 + 1
        let image = NSImage(size: NSSize(width: edge, height: edge), flipped: false) { rect in
            NSColor.black.setFill()
            NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius).fill()
            return true
        }
        image.capInsets = NSEdgeInsets(top: radius, left: radius, bottom: radius, right: radius)
        image.resizingMode = .stretch
        return image
    }

    // MARK: NSWindowDelegate

    /// A click elsewhere puts it away, like Spotlight.
    func windowDidResignKey(_ notification: Notification) {
        hide()
    }
}
