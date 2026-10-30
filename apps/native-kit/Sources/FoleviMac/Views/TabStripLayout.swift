// The tab strip's sizing and scrolling, as the web's (apps/web/src/components/app/TabStrip.tsx): the list of tabs is
// `flex min-w-0 flex-initial overflow-x-auto px-1 py-1 gap-1.5`, Home keeps its own width, every other tab, open or
// not, is `flex-[0_1_284px] min-w-[172px]` and they shrink evenly before the list scrolls. Only the list scrolls;
// Back, Forward, Home (pinned before the list on the Mac), the arrows and New note stay put.
#if os(macOS)
import SwiftUI

/// The strip's numbers, apart from any view (tests drive them directly).
public enum TabStripMath {
    /// The soft edge on a side with more tabs (FADE).
    public static let fade: CGFloat = 28
    public static let minTab: CGFloat = 172
    public static let maxTab: CGFloat = 284

    public struct Sizes: Equatable {
        /// Each tab's width, in order.
        public var widths: [CGFloat]
        /// The list's own width on screen: its content, or what the bar has left when that's less.
        public var visible: CGFloat
        /// The whole content, padding included (the scroll range is content - visible).
        public var content: CGFloat
    }

    /// A tab that shares the room: it starts at `basis` and gives way, in proportion to its basis (CSS's flex-shrink
    /// 1), down to `min`.
    public struct Flex: Equatable, Sendable {
        public var basis: CGFloat
        public var min: CGFloat
        public init(basis: CGFloat, min: CGFloat) {
            self.basis = basis
            self.min = min
        }
        /// A note's or a view's tab: `min-w-[172px] flex-[0_1_284px]`.
        public static let tab = Flex(basis: maxTab, min: minTab)
        /// Joined notes' tab, as wide as two: `min-w-[240px] flex-[0_1_460px]`.
        public static let joined = Flex(basis: 460, min: 240)
    }

    /// `fixed[i]` is a tab's own width (Home, a pinned tab) or nil for one that shrinks; `available` is the room
    /// the bar leaves the list (nil: as much as it wants).
    public static func sizes(fixed: [CGFloat?], gap: CGFloat, padding: CGFloat, available: CGFloat?) -> Sizes {
        sizes(items: fixed.map { $0.map { .fixed($0) } ?? .flex(.tab) }, gap: gap, padding: padding, available: available)
    }

    public enum Item: Equatable, Sendable {
        case fixed(CGFloat)
        case flex(Flex)
    }

    public static func sizes(items: [Item], gap: CGFloat, padding: CGFloat, available: CGFloat?) -> Sizes {
        let gaps = gap * CGFloat(max(0, items.count - 1))
        var widths: [CGFloat] = items.map {
            switch $0 {
            case .fixed(let w): return w
            case .flex(let f): return f.basis
            }
        }
        let natural = padding + widths.reduce(0, +) + gaps
        let visible = min(natural, max(0, available ?? natural))
        // Shrink as CSS does: the shortfall shared by basis among the tabs not yet at their minimum, again until
        // none is left or every tab is at its minimum.
        var frozen = Set(items.indices.filter { if case .fixed = items[$0] { return true } else { return false } })
        var short = natural - visible
        while short > 0.01 {
            let open = items.indices.filter { !frozen.contains($0) }
            let basis = open.reduce(CGFloat(0)) { sum, i in if case .flex(let f) = items[i] { return sum + f.basis }; return sum }
            guard basis > 0 else { break }
            var taken: CGFloat = 0
            var hit = false
            for i in open {
                guard case .flex(let f) = items[i] else { continue }
                let want = widths[i] - short * f.basis / basis
                if want <= f.min {
                    taken += widths[i] - f.min
                    widths[i] = f.min
                    frozen.insert(i)
                    hit = true
                }
            }
            if !hit {
                for i in open { if case .flex(let f) = items[i] { widths[i] -= short * f.basis / basis } }
                taken = short
            }
            short -= taken
        }
        return Sizes(widths: widths, visible: visible, content: padding + widths.reduce(0, +) + gaps)
    }

    /// The furthest the list scrolls.
    public static func clamp(_ scroll: CGFloat, visible: CGFloat, content: CGFloat) -> CGFloat {
        min(max(0, content - visible), max(0, scroll))
    }

    /// Where to scroll so the open tab (`left`, `width`, in the content) is wholly in view and clear of the soft
    /// edges, moving as little as possible (reveal); nil when it already is.
    public static func reveal(left: CGFloat, width: CGFloat, scroll: CGFloat, visible: CGFloat, content: CGFloat) -> CGFloat? {
        let right = left + width
        let pad = max(0, min(fade + 4, (visible - width) / 2))
        var to = scroll
        if left - pad < to { to = left - pad } else if right + pad > to + visible { to = right + pad - visible }
        to = clamp(to.rounded(), visible: visible, content: content)
        return abs(to - scroll) < 1 ? nil : to
    }

    /// How far an arrow scrolls (scrollTabs).
    public static func step(visible: CGFloat) -> CGFloat { max(160, visible * 0.7) }

    /// Whether there are more tabs before and after what's shown.
    public static func overflow(scroll: CGFloat, visible: CGFloat, content: CGFloat) -> (start: Bool, end: Bool) {
        (scroll > 2, scroll + visible < content - 2)
    }
}

/// A tab's part in the layout.
/// `own`: the tab's own width (Home, a pinned tab); `other`: the tabs that share the room, 172 to 284 each;
/// `joined`: joined notes' tab, 240 to 460.
enum TabRole { case own, other, joined }
struct TabRoleKey: LayoutValueKey { static let defaultValue = TabRole.other }
/// The tab on screen, which the strip keeps in view (none while a pinned Home, outside the list, is open).
struct TabActiveKey: LayoutValueKey { static let defaultValue = false }

/// What the list measured, for the strip to scroll by.
struct TabRowMetrics: Equatable {
    var visible: CGFloat = 0
    var content: CGFloat = 0
    /// The open tab, in the content.
    var openLeft: CGFloat = 0
    var openWidth: CGFloat = 0
}

/// The list's scroll and what it last measured. A class, so the layout's reports and the delayed reveal change the
/// one the strip draws from, never a copy of the view.
@MainActor @Observable
final class TabScroller {
    var scroll: CGFloat = 0
    var metrics = TabRowMetrics()
    /// The open tab is to be brought into view after the next measure: smoothly or at once.
    var pendingReveal: Bool?
    var shownOnce = false
    /// A tab is being dragged (the strip stays put under the pointer).
    var dragging = false
}

/// Lays the tabs out in a row as the web's list does, scrolled by `offset` (animatable, for the smooth scrolls).
struct TabRow: Layout {
    var gap: CGFloat
    var padding: EdgeInsets
    var offset: CGFloat
    var report: (TabRowMetrics) -> Void

    var animatableData: CGFloat {
        get { offset }
        set { offset = newValue }
    }

    private func sizes(_ subviews: Subviews, _ available: CGFloat?) -> TabStripMath.Sizes {
        let items: [TabStripMath.Item] = subviews.map { s in
            switch s[TabRoleKey.self] {
            case .own: return .fixed(s.sizeThatFits(.unspecified).width)
            case .other: return .flex(.tab)
            case .joined: return .flex(.joined)
            }
        }
        return TabStripMath.sizes(items: items, gap: gap, padding: padding.leading + padding.trailing, available: available)
    }

    private func height(_ subviews: Subviews) -> CGFloat {
        (subviews.map { $0.sizeThatFits(.unspecified).height }.max() ?? 0) + padding.top + padding.bottom
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        CGSize(width: sizes(subviews, proposal.width).visible, height: height(subviews))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let s = sizes(subviews, bounds.width)
        var x = padding.leading
        var metrics = TabRowMetrics(visible: bounds.width, content: s.content)
        for (i, sub) in subviews.enumerated() {
            let w = s.widths[i]
            let h = sub.sizeThatFits(ProposedViewSize(width: w, height: nil)).height
            sub.place(at: CGPoint(x: bounds.minX + x - offset, y: bounds.midY - h / 2), proposal: ProposedViewSize(width: w, height: h))
            if sub[TabActiveKey.self] {
                metrics.openLeft = x
                metrics.openWidth = w
            }
            x += w + gap
        }
        let report = report
        DispatchQueue.main.async { report(metrics) }
    }
}

/// Takes the trackpad's and the scroll wheel's sideways scrolls over the list (shift turns a wheel sideways, as
/// AppKit does for every scroller); every other event goes through to the tabs.
struct SidewaysScroll: NSViewRepresentable {
    let by: (CGFloat) -> Void

    final class View: NSView {
        var by: (CGFloat) -> Void = { _ in }
        override func hitTest(_ point: NSPoint) -> NSView? {
            guard NSApp.currentEvent?.type == .scrollWheel else { return nil }
            return super.hitTest(point)
        }
        override func scrollWheel(with event: NSEvent) {
            let dx = event.hasPreciseScrollingDeltas ? event.scrollingDeltaX : event.scrollingDeltaX * 10
            if abs(dx) > abs(event.scrollingDeltaY) || event.scrollingDeltaY == 0 {
                if dx != 0 { by(-dx) }
            } else {
                super.scrollWheel(with: event)
            }
        }
    }

    func makeNSView(context: Context) -> View {
        let v = View()
        v.by = by
        return v
    }

    func updateNSView(_ v: View, context: Context) { v.by = by }
}
#endif
