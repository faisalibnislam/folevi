import AppKit
import SwiftUI
import QuartzCore

/// Shows, hides, pins, detaches and sizes the Notlet panel. The hosting view is created once
/// and moved between the popover panel and the detached window, never rebuilt.
@MainActor
final class PanelController: NSObject, NSWindowDelegate {
    let model: MenuBarNoteModel
    let panel: MenuBarNotePanel
    private let glass = NSGlassEffectView()
    /// Panel content: the glass sheet plus resize handles on top of it.
    /// The panel's content view. The window server can't trace a shadow from layer-composited glass
    /// and falls back to the window rectangle (a faint square around the rounded panel). A visual
    /// effect view as the content view, with a rounded mask image, is AppKit's documented way to
    /// shape a borderless window, and its shadow. The glass covers the material completely.
    private let container: NSVisualEffectView = {
        let view = NSVisualEffectView()
        view.blendingMode = .withinWindow
        view.state = .active
        view.maskImage = PanelController.roundedMask(radius: PanelRootView.cornerRadius)
        return view
    }()
    private let hosting: NSHostingView<AnyView>
    private var handles: [ResizeHandleView] = []
    private(set) var detachedWindow: NSWindow?
    /// The menu bar icon's frame on screen (the panel opens under it), and its highlight while the panel shows.
    var anchor: () -> NSRect? = { nil }
    var onShownChange: (Bool) -> Void = { _ in }
    /// > 0 while an open/save panel or share sheet is up, so the popover doesn't close under it.
    var suppressAutoHide = 0
    private var isHiding = false

    var isVisible: Bool {
        if model.settings.isDetached { return detachedWindow?.isVisible ?? false }
        return panel.isVisible && !isHiding
    }

    var activeWindow: NSWindow? { model.settings.isDetached ? detachedWindow : panel }

    init(model: MenuBarNoteModel) {
        self.model = model
        panel = MenuBarNotePanel(size: model.settings.panelSize)
        hosting = NSHostingView(rootView: AnyView(PanelRootView().environment(model)))
        super.init()
        hosting.sizingOptions = []
        glass.cornerRadius = PanelRootView.cornerRadius
        glass.style = .regular
        glass.contentView = hosting
        container.frame = NSRect(origin: .zero, size: model.settings.panelSize)
        glass.frame = container.bounds
        glass.autoresizingMask = [.width, .height]
        container.addSubview(glass)
        panel.contentView = container
        panel.delegate = self
        panel.onCancel = { [weak self] in self?.model.hidePanel() }
        panel.keyHandler = { [weak self] in self?.model.handleKey($0) ?? false }
        installResizeHandles(in: container)
        applyAppearance()
    }

    // MARK: Warm-up

    /// Builds the SwiftUI tree and loads the active dot while idle, so the first open is instant.
    func prewarm() {
        model.prepare()
        panel.setContentSize(model.settings.panelSize)
        hosting.layoutSubtreeIfNeeded()
        // Put the panel on screen once, fully transparent and without taking focus, so the window
        // server builds its backing store and glass layers now instead of on the first real open.
        guard !model.settings.isDetached else { return }
        panel.setFrame(frameForShow(), display: false)
        panel.alphaValue = 0
        panel.orderFrontRegardless()
        panel.displayIfNeeded()
        CATransaction.flush()
        panel.invalidateShadow()
        panel.orderOut(nil)
        panel.alphaValue = 1
    }

    /// Opaque, stretchable rounded rectangle. It shapes the whole window (contents included), so it
    /// must stay fully opaque inside the corners.
    private static func roundedMask(radius: CGFloat) -> NSImage {
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

    /// The window's shadow is cached; recompute it once the content is on screen and after resizes.
    private func refreshShadow() {
        guard panel.isVisible else { return }
        panel.displayIfNeeded()
        panel.invalidateShadow()
    }

    // MARK: Show / hide

    func toggle() {
        if isVisible && (activeWindow?.isKeyWindow ?? false || model.settings.isPinned || model.settings.isDetached) {
            hide()
        } else {
            show()
        }
    }

    func show() {
        if model.settings.isDetached {
            showDetached()
            return
        }
        isHiding = false
        panel.alphaValue = panel.isVisible ? panel.alphaValue : 0
        let frame = frameForShow()
        if panel.frame != frame { panel.setFrame(frame, display: false) }
        applyPinnedState()
        model.prepare()
        panel.makeKeyAndOrderFront(nil)
        refreshShadow()
        model.isPanelVisible = true
        animateIn()
        // Recompute once more after the open spring settles, when the glass is at full size.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { [weak self] in self?.refreshShadow() }
        onShownChange(true)
    }

    func hide() {
        guard !isHiding else { return }
        if model.settings.isDetached {
            detachedWindow?.orderOut(nil)
            model.isPanelVisible = false
            onShownChange(false)
            return
        }
        guard panel.isVisible else { return }
        isHiding = true
        onShownChange(false)
        let finish: @MainActor () -> Void = { [weak self] in
            guard let self, self.isHiding else { return }
            self.panel.orderOut(nil)
            self.panel.alphaValue = 1
            self.isHiding = false
            self.model.isPanelVisible = false
        }
        if Motion.isEnabled {
            NSAnimationContext.runAnimationGroup { ctx in
                ctx.duration = Motion.closeDuration
                ctx.timingFunction = CAMediaTimingFunction(name: .easeOut)
                panel.animator().alphaValue = 0
            } completionHandler: {
                MainActor.assumeIsolated { finish() }
            }
        } else {
            finish()
        }
    }

    private func animateIn() {
        guard Motion.isEnabled, let layer = glass.layer else {
            panel.alphaValue = 1
            return
        }
        let size = glass.bounds.size
        // Scale 0.96 → 1 around the top-centre (the status item), plus fade.
        var t = CATransform3DMakeTranslation(size.width / 2, size.height, 0)
        t = CATransform3DScale(t, 0.96, 0.96, 1)
        t = CATransform3DTranslate(t, -size.width / 2, -size.height, 0)
        let spring = CASpringAnimation(keyPath: "transform")
        spring.fromValue = NSValue(caTransform3D: t)
        spring.toValue = NSValue(caTransform3D: CATransform3DIdentity)
        // response 0.32 s, damping ratio 0.86
        spring.mass = 1
        spring.stiffness = pow(2 * .pi / Motion.openResponse, 2)
        spring.damping = 4 * .pi * Motion.openDamping / Motion.openResponse
        spring.duration = spring.settlingDuration
        layer.add(spring, forKey: "open")
        NSAnimationContext.runAnimationGroup { ctx in
            ctx.duration = 0.14
            panel.animator().alphaValue = 1
        }
    }

    // MARK: Positioning

    private func frameForShow() -> NSRect {
        var size = model.settings.panelSize
        if model.settings.isPinned, let origin = model.settings.pinnedOrigin,
           let screen = NSScreen.screens.first(where: { $0.visibleFrame.contains(NSPoint(x: origin.x + 20, y: origin.y + size.height - 20)) }) {
            return clamp(NSRect(origin: origin, size: size), to: screen)
        }
        // The status item's frame is only meaningful once the menu bar has laid it out.
        if let anchor = anchor(),
           let screen = NSScreen.screens.first(where: { $0.frame.intersects(anchor) }),
           anchor.minY >= screen.visibleFrame.maxY - 2, anchor.width > 0 {
            size.width = min(size.width, screen.visibleFrame.width - 16)
            size.height = min(size.height, screen.visibleFrame.height - 16)
            let origin = NSPoint(x: anchor.midX - size.width / 2, y: anchor.minY - 6 - size.height)
            return clamp(NSRect(origin: origin, size: size), to: screen)
        }
        let screen = NSScreen.screens.first { $0.frame.contains(NSEvent.mouseLocation) } ?? NSScreen.main ?? NSScreen.screens[0]
        let vf = screen.visibleFrame
        let origin = NSPoint(x: vf.midX - size.width / 2, y: vf.maxY - 10 - size.height)
        return clamp(NSRect(origin: origin, size: size), to: screen)
    }

    private func clamp(_ rect: NSRect, to screen: NSScreen) -> NSRect {
        let vf = screen.visibleFrame.insetBy(dx: 8, dy: 8)
        var r = rect
        r.size.width = min(r.width, vf.width)
        r.size.height = min(r.height, vf.height)
        r.origin.x = min(max(r.minX, vf.minX), vf.maxX - r.width)
        r.origin.y = min(max(r.minY, vf.minY), vf.maxY - r.height)
        return r.integral
    }

    // MARK: Size, pin, detach

    func setSize(_ preset: MenuBarNoteSettings.PanelSize) {
        model.settings.panelSize = preset.size
        if model.settings.isDetached, let w = detachedWindow {
            var f = w.frame
            f.origin.y += f.height - preset.size.height
            f.size = preset.size
            w.setFrame(f, display: true, animate: Motion.isEnabled)
            return
        }
        guard panel.isVisible else { return }
        var f = panel.frame
        let top = f.maxY
        f.origin.x += (f.width - preset.size.width) / 2
        f.size = preset.size
        f.origin.y = top - f.height
        if let screen = panel.screen { f = clamp(f, to: screen) }
        panel.setFrame(f, display: true, animate: Motion.isEnabled)
    }

    func togglePin() {
        model.settings.isPinned.toggle()
        applyPinnedState()
        if model.settings.isPinned {
            model.settings.pinnedOrigin = panel.frame.origin
        }
    }

    private var appliedPinned: Bool?

    private func applyPinnedState() {
        let pinned = model.settings.isPinned
        guard appliedPinned != pinned else { return }
        appliedPinned = pinned
        panel.level = pinned ? .floating : MenuBarNotePanel.popoverLevel
        panel.isMovableByWindowBackground = pinned
        glass.tintColor = pinned ? NSColor.windowBackgroundColor.withAlphaComponent(0.25) : nil
    }

    func toggleDetach() {
        model.settings.isDetached ? attach() : detach()
    }

    private func detach() {
        let frame = panel.isVisible ? panel.frame : frameForShow()
        panel.orderOut(nil)
        model.isPanelVisible = false
        model.settings.isDetached = true
        let window = makeDetachedWindow(frame: frame)
        moveGlass(to: window)
        detachedWindow = window
        showDetached()
    }

    private func attach() {
        let frame = detachedWindow?.frame
        detachedWindow?.orderOut(nil)
        detachedWindow?.contentView = NSView()
        detachedWindow = nil
        model.settings.isDetached = false
        glass.cornerRadius = PanelRootView.cornerRadius
        glass.removeFromSuperview()
        glass.frame = container.bounds
        container.addSubview(glass, positioned: .below, relativeTo: nil)
        if let frame { model.settings.panelSize = frame.size }
        show()
    }

    private func moveGlass(to window: NSWindow) {
        glass.cornerRadius = 0
        glass.removeFromSuperview()
        window.contentView = glass
    }

    private func makeDetachedWindow(frame: NSRect) -> NSWindow {
        let window = MenuBarNoteWindow(contentRect: frame, styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                              backing: .buffered, defer: false)
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.title = "Folevi"
        window.keyHandler = { [weak self] in self?.model.handleKey($0) ?? false }
        window.isReleasedWhenClosed = false
        window.minSize = MenuBarNoteSettings.minimumPanelSize
        window.collectionBehavior = [.fullScreenPrimary]
        window.setFrameAutosaveName("FoleviMenuBarNoteWindow")
        window.delegate = self
        window.titlebarSeparatorStyle = .none
        return window
    }

    private func showDetached() {
        if detachedWindow == nil {
            let frame = frameForShow()
            let window = makeDetachedWindow(frame: frame)
            moveGlass(to: window)
            detachedWindow = window
        }
        model.prepare()
        NSApp.activate()
        detachedWindow?.makeKeyAndOrderFront(nil)
        model.isPanelVisible = true
        onShownChange(true)
    }

    // MARK: Resize handles

    private func installResizeHandles(in view: NSView) {
        let t: CGFloat = 6
        let specs: [(ResizeHandleView.Edge, NSView.AutoresizingMask, (NSRect) -> NSRect)] = [
            (.left, [.height, .maxXMargin], { NSRect(x: 0, y: t, width: t, height: $0.height - 2 * t) }),
            (.right, [.height, .minXMargin], { NSRect(x: $0.width - t, y: t, width: t, height: $0.height - 2 * t) }),
            (.bottom, [.width, .maxYMargin], { NSRect(x: t, y: 0, width: $0.width - 2 * t, height: t) }),
            (.top, [.width, .minYMargin], { NSRect(x: t, y: $0.height - t, width: $0.width - 2 * t, height: t) }),
            ([.bottom, .left], [.maxXMargin, .maxYMargin], { _ in NSRect(x: 0, y: 0, width: t * 2, height: t * 2) }),
            ([.bottom, .right], [.minXMargin, .maxYMargin], { NSRect(x: $0.width - t * 2, y: 0, width: t * 2, height: t * 2) }),
            ([.top, .left], [.maxXMargin, .minYMargin], { NSRect(x: 0, y: $0.height - t * 2, width: t * 2, height: t * 2) }),
            ([.top, .right], [.minXMargin, .minYMargin], { NSRect(x: $0.width - t * 2, y: $0.height - t * 2, width: t * 2, height: t * 2) }),
        ]
        let bounds = NSRect(origin: .zero, size: model.settings.panelSize)
        for (edge, mask, rect) in specs {
            let handle = ResizeHandleView(edge: edge)
            handle.frame = rect(bounds)
            handle.autoresizingMask = mask
            handle.onResizeEnded = { [weak self] in self?.persistSize() }
            view.addSubview(handle, positioned: .above, relativeTo: nil)
            handles.append(handle)
        }
    }

    private func persistSize() {
        guard !model.settings.isDetached else { return }
        model.settings.panelSize = panel.frame.size
        if model.settings.isPinned { model.settings.pinnedOrigin = panel.frame.origin }
        panel.invalidateShadow()
    }

    // MARK: NSWindowDelegate

    func windowDidResignKey(_ notification: Notification) {
        guard (notification.object as? NSWindow) === panel, !model.settings.isPinned, !model.settings.isDetached,
              suppressAutoHide == 0, panel.isVisible else { return }
        // Keep the popover while one of our own auxiliary windows (color panel, Quick Look,
        // share sheet) takes focus.
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            if let key = NSApp.keyWindow, key !== self.panel, key.level.rawValue >= NSWindow.Level.floating.rawValue || key is NSColorPanel { return }
            if !self.panel.isKeyWindow { self.hide() }
        }
    }

    func windowDidMove(_ notification: Notification) {
        guard (notification.object as? NSWindow) === panel, model.settings.isPinned, panel.isVisible else { return }
        model.settings.pinnedOrigin = panel.frame.origin
    }

    func windowDidResize(_ notification: Notification) {
        if (notification.object as? NSWindow) === panel { panel.invalidateShadow() }
    }

    func windowDidEndLiveResize(_ notification: Notification) {
        if (notification.object as? NSWindow) === panel { persistSize() }
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if sender === detachedWindow {
            sender.orderOut(nil)
            model.isPanelVisible = false
            onShownChange(false)
            return false
        }
        return true
    }

    func applyAppearance() {
        defer { DispatchQueue.main.async { [weak self] in self?.refreshShadow() } }
        let appearance = model.settings.nsAppearance
        panel.appearance = appearance
        detachedWindow?.appearance = appearance
    }
}
