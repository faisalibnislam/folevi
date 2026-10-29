// Folevi's one tooltip on the Mac, never the system's (the owner's rule: "always use our native tooltip, across the
// whole apps"). Drawn as the web's `[data-mac-tooltip]` (lib/desktop/tooltip.ts, globals.css): footnote text 12/16,
// 3 x 8 padding, chip corners, the --mac-pop glass with a 0.5 pt edge and a soft shadow, a shortcut written as
// "New note (⌘⌥N)" in a keycap. It shows after 700 ms of the pointer resting on the control, at once while another
// has just shown (until a second passes with none), under the control or above it when there's no room, inside the
// window; a press, a key, a scroll or the window losing focus hides it.
//
//   Button { … } label: { … }.foleviTooltip("New note (⌘⌥N)")     SwiftUI
//   button.foleviTooltip = "Notifications"                           AppKit
#if os(macOS)
import AppKit
import SwiftUI

public enum FoleviTooltip {
    static let rest: TimeInterval = 0.7
    static let warm: TimeInterval = 1.0
    /// The gap between the control and the tooltip, and the least room kept to the window's edges.
    static let gap: CGFloat = 6
    static let edge: CGFloat = 4
    /// Room around the chip in its panel for the shadow.
    static let margin: CGFloat = 16

    private static let shortcut = try! NSRegularExpression(pattern: #"^(.*?)\s*\(((?:[⌘⌃⌥⇧]+)[^\s()]+|[⌘⌃⌥⇧]*(?:Tab|Space|Return|Esc|F\d+))\)$"#)

    /// "New note (⌘⌥N)" as its words and its shortcut (tooltip.ts splitTooltip).
    public static func split(_ text: String) -> (text: String, shortcut: String?) {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let ns = t as NSString
        guard let m = shortcut.firstMatch(in: t, range: NSRange(location: 0, length: ns.length)) else { return (t, nil) }
        return (ns.substring(with: m.range(at: 1)), ns.substring(with: m.range(at: 2)))
    }
}

// MARK: The chip

/// The tooltip as drawn: its words, then the shortcut in a keycap.
public struct FoleviTooltipChip: View {
    let text: String
    let shortcut: String?
    @Environment(\.colorScheme) private var scheme

    public init(_ words: String) {
        (text, shortcut) = FoleviTooltip.split(words)
    }

    public var body: some View {
        let ink = (WebStyles.vars["color-ink"]?.resolve(scheme) ?? RGBA(24, 24, 27)).color
        let edge = (WebStyles.vars["mac-pop-edge"]?.resolve(scheme) ?? RGBA(0, 0, 0, 0.12)).color
        // --mac-pop: the glass's tint over the blur.
        let tint = scheme == .dark ? RGBA(40, 40, 44, 0.86) : RGBA(255, 255, 255, 0.82)
        let shape = RoundedRectangle(cornerRadius: 6, style: .continuous)
        HStack(spacing: 4) {
            Text(text).webText(WebTextStyle(size: 12, leading: 16)).foregroundStyle(ink)
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
            if let shortcut { Keycap(shortcut) }
        }
        .padding(.vertical, 3)
        .padding(.horizontal, 8)
        .frame(maxWidth: 320, alignment: .leading)
        .fixedSize(horizontal: true, vertical: false)
        .background {
            ZStack {
                TooltipBlur()
                tint.color
            }
            .clipShape(shape)
        }
        .overlay { shape.strokeBorder(edge, lineWidth: 0.5) }
        .shadow(color: .black.opacity(0.14), radius: 7, y: 4)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isStaticText)
    }

    /// `.ui-kbd` at the tooltip's size: caption 2, 16 tall, 4 pt sides, raised with a line ring.
    private struct Keycap: View {
        let keys: String
        @Environment(\.colorScheme) private var scheme
        init(_ keys: String) { self.keys = keys }

        var body: some View {
            let v = { (name: String, fallback: RGBA) in (WebStyles.vars[name]?.resolve(scheme) ?? fallback).color }
            let shape = RoundedRectangle(cornerRadius: 4, style: .continuous)
            Text(keys).webText(WebTextStyle(size: 11, leading: 16, weight: 550))
                .foregroundStyle(v("color-ink-muted", RGBA(86, 86, 94)))
                .padding(.horizontal, 4)
                .frame(height: 16)
                .background(shape.fill(v("color-surface-raised", RGBA(255, 255, 255))))
                .overlay(shape.strokeBorder(v("color-line", RGBA(226, 226, 230)), lineWidth: 1))
                .overlay(alignment: .bottom) { Rectangle().fill(v("color-line-strong", RGBA(207, 207, 213))).frame(height: 1).offset(y: 1).clipShape(shape) }
                .offset(y: -0.5)
        }
    }
}

/// The blur behind the glass (backdrop-filter: blur(24px) saturate(1.8)).
private struct TooltipBlur: NSViewRepresentable {
    func makeNSView(context: Context) -> NSVisualEffectView {
        let v = NSVisualEffectView()
        v.material = .popover
        v.blendingMode = .behindWindow
        v.state = .active
        return v
    }
    func updateNSView(_ nsView: NSVisualEffectView, context: Context) {}
}

// MARK: Showing it

/// The one tooltip on screen, and the timing between them.
@MainActor
public final class FoleviTooltipCenter {
    public static let shared = FoleviTooltipCenter()

    private weak var owner: FoleviTooltipAnchor?
    private var panel: NSPanel?
    private var timer: Timer?
    private var lastHidden = Date.distantPast
    private var monitor: Any?
    private var observers: [any NSObjectProtocol] = []

    /// The tooltip's words while one shows (tests and the eval hook).
    public private(set) var showing: String?
    /// The tooltip's panel while one shows (the eval hook draws it into a window's picture).
    public var shownWindow: NSWindow? { panel }

    private init() {}

    func enter(_ anchor: FoleviTooltipAnchor) {
        guard anchor !== owner else { return }
        hide()
        guard !(anchor.text ?? "").trimmingCharacters(in: .whitespaces).isEmpty else { return }
        owner = anchor
        watch()
        let delay = Date().timeIntervalSince(lastHidden) < FoleviTooltip.warm ? 0 : FoleviTooltip.rest
        timer = Timer.scheduledTimer(withTimeInterval: delay, repeats: false) { _ in
            MainActor.assumeIsolated { FoleviTooltipCenter.shared.show() }
        }
    }

    func leave(_ anchor: FoleviTooltipAnchor) {
        if anchor === owner { hide() }
    }

    /// Hides the tooltip now (a press, a key, a scroll, the window going to the back).
    public func hide() {
        timer?.invalidate()
        timer = nil
        if let panel {
            panel.parent?.removeChildWindow(panel)
            panel.orderOut(nil)
            self.panel = nil
            showing = nil
            lastHidden = Date()
        }
        owner = nil
    }

    /// Shows `text` for `anchor` at once, with no wait (screenshots).
    public func showNow(for view: NSView) {
        guard let anchor = view as? FoleviTooltipAnchor ?? view.subviews.lazy.compactMap({ $0 as? FoleviTooltipAnchor }).first else { return }
        hide()
        owner = anchor
        watch()
        show()
    }

    private func show() {
        timer = nil
        guard let owner, let window = owner.window, window.isVisible, let words = owner.text, NSEvent.pressedMouseButtons == 0 else { return }
        let m = FoleviTooltip.margin
        let host = NSHostingView(rootView: FoleviTooltipChip(words).padding(m))
        host.safeAreaRegions = []
        let size = host.fittingSize
        let chip = NSSize(width: size.width - m * 2, height: size.height - m * 2)

        // Under the control, or above it when there's no room; inside the window's content.
        let control = owner.convert(owner.bounds, to: nil)
        let room = window.contentLayoutRect
        let below = control.minY - FoleviTooltip.gap - chip.height >= room.minY + FoleviTooltip.edge
        var x = control.midX - chip.width / 2
        x = min(max(room.minX + FoleviTooltip.edge, x), room.maxX - chip.width - FoleviTooltip.edge)
        let y = below ? control.minY - FoleviTooltip.gap - chip.height : min(control.maxY + FoleviTooltip.gap, room.maxY - chip.height - FoleviTooltip.edge)
        let origin = window.convertPoint(toScreen: NSPoint(x: x - m, y: y - m))

        let panel = NSPanel(contentRect: NSRect(origin: origin, size: size), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.ignoresMouseEvents = true
        panel.level = .popUpMenu
        panel.isReleasedWhenClosed = false
        panel.collectionBehavior = [.transient, .ignoresCycle]
        // (A child window follows the app, not its parent: the parent's pinned appearance.)
        panel.appearance = window.appearance ?? window.effectiveAppearance
        panel.contentView = host
        panel.setAccessibilityRole(.helpTag)
        panel.alphaValue = 0
        window.addChildWindow(panel, ordered: .above)
        panel.orderFront(nil)
        NSAnimationContext.runAnimationGroup { c in
            c.duration = 0.1
            c.timingFunction = CAMediaTimingFunction(name: .easeOut)
            panel.animator().alphaValue = 1
        }
        self.panel = panel
        showing = words
    }

    private func watch() {
        guard monitor == nil else { return }
        monitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown, .keyDown, .scrollWheel]) { event in
            MainActor.assumeIsolated { FoleviTooltipCenter.shared.hide() }
            return event
        }
        let center = NotificationCenter.default
        for name in [NSWindow.didResignKeyNotification, NSApplication.didResignActiveNotification] {
            observers.append(center.addObserver(forName: name, object: nil, queue: .main) { _ in
                MainActor.assumeIsolated { FoleviTooltipCenter.shared.hide() }
            })
        }
    }
}

// MARK: Anchors

public extension View {
    /// Folevi's tooltip on this view (nil or empty: none). Use it in place of the system's.
    func foleviTooltip(_ text: String?) -> some View {
        background(TooltipAnchorView(text: text))
    }
}

/// An invisible view over a control that notices the pointer resting on it. It never takes a click.
public final class FoleviTooltipAnchor: NSView {
    public var text: String? {
        didSet { if text != oldValue, FoleviTooltipCenter.shared.showing != nil, (text ?? "").isEmpty { FoleviTooltipCenter.shared.leave(self) } }
    }
    private var area: NSTrackingArea?

    public init(text: String?) {
        self.text = text
        super.init(frame: .zero)
        setAccessibilityElement(false)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError() }

    override public func hitTest(_ point: NSPoint) -> NSView? { nil }

    override public func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let area { removeTrackingArea(area) }
        let a = NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeInActiveApp, .inVisibleRect], owner: self, userInfo: nil)
        addTrackingArea(a)
        area = a
    }

    override public func mouseEntered(with event: NSEvent) {
        guard event.type == .mouseEntered, NSEvent.pressedMouseButtons == 0 else { return }
        FoleviTooltipCenter.shared.enter(self)
    }

    override public func mouseExited(with event: NSEvent) {
        FoleviTooltipCenter.shared.leave(self)
    }

    override public func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        if window == nil { FoleviTooltipCenter.shared.leave(self) }
    }
}

private struct TooltipAnchorView: NSViewRepresentable {
    let text: String?
    func makeNSView(context: Context) -> FoleviTooltipAnchor { FoleviTooltipAnchor(text: text) }
    func updateNSView(_ nsView: FoleviTooltipAnchor, context: Context) { nsView.text = text }
    static func dismantleNSView(_ nsView: FoleviTooltipAnchor, coordinator: ()) { FoleviTooltipCenter.shared.leave(nsView) }
}


public extension NSView {
    /// Folevi's tooltip on this AppKit view (nil: none), in place of the system's.
    var foleviTooltip: String? {
        get { subviews.lazy.compactMap { $0 as? FoleviTooltipAnchor }.first?.text }
        set {
            if let anchor = subviews.lazy.compactMap({ $0 as? FoleviTooltipAnchor }).first {
                anchor.text = newValue
                return
            }
            guard newValue != nil else { return }
            let anchor = FoleviTooltipAnchor(text: newValue)
            anchor.frame = bounds
            anchor.autoresizingMask = [.width, .height]
            addSubview(anchor)
        }
    }
}
#endif

#if !os(macOS)
import SwiftUI

public extension View {
    /// No tooltips on iPhone and iPad (no pointer to rest; the system's isn't used either).
    func foleviTooltip(_ text: String?) -> some View { self }
}
#endif
