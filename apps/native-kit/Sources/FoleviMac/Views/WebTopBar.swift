// The content's top bar drawn as the web app's (apps/web/src/components/app/TabStrip.tsx and BackForward.tsx,
// as Folevi for Mac shows them), from the live app's computed styles ("frame.topbar.*", "frame.tab*"): a glass
// bar inside the content's card with Back and Forward, a divider, the tabs (Home first, then one per open page,
// the open one raised), and New note at the end. While the sidebar is hidden (its Home row with it) Home is pinned:
// it stays put after Back and Forward and only the tabs after it scroll; with the sidebar, Home is the list's first
// tab, as on the web. While the sidebar is hidden, the window buttons' room and the
// sync state come first, as on the web.
#if os(macOS)
import AppKit
import SwiftUI
import FoleviDesign
import FoleviEngine

@MainActor
public struct WebTopBar: View {
    @Bindable var model: FrameModel
    @Environment(\.colorScheme) private var scheme
    @State private var hoveredTab: String?
    /// Each tab's frame in the strip (for dragging one among the others).
    @State private var tabFrames: [String: CGRect] = [:]
    /// The tab being dragged: how far it's moved from its own place, and where the pointer took hold of it.
    @State private var dragging: (id: String, dx: CGFloat, grab: CGFloat)?
    /// The list of tabs' scroll and measures, in one object the layout's reports and the timers change directly.
    @State private var scroller = TabScroller()

    public init(model: FrameModel) { self.model = model }

    private func style(_ id: String) -> WebComputedStyle { WebStyles.named(id).resolve(scheme) }

    public var body: some View {
        let bar = style("frame.topbar")
        HStack(spacing: bar.gap) {
            if model.sidebarCollapsed {
                Color.clear.frame(width: 60, height: 1)
                SyncDot(model: model)
                divider
            }
            historyButton(.arrowLeft, "Back", enabled: model.history.canGoBack, style: "frame.topbar.back") { model.goBack() }
                .padding(.trailing, -bar.gap)
            historyButton(.arrowRight, "Forward", enabled: model.history.canGoForward, style: "frame.topbar.forward") { model.goForward() }
            divider
            strip.layoutPriority(1)
            Spacer(minLength: 0)
            // The web's <Button size="sm"> with <Plus size={14} />, as the top bar measures it (its icon at 70%).
            WebButton("New note", icon: .plus, iconSize: 14, iconOpacity: style("frame.topbar.new.icon").opacity, styleName: "frame.topbar.new", variant: .primary, size: .sm) { model.newNote() }
                .foleviTooltip("New note (⌘⌥N)")
                .fixedSize()
                .padding(.trailing, newNoteInset - bar.padding.right)
        }
        .padding(bar.padding.edgeInsets)
        .frame(height: bar.height)
        .frame(maxWidth: .infinity)
        .webBox(WebStyles.named("frame.topbar"))
        // Over the Vault (drawn in the other theme), the strip sits on the surface, so its tabs stay readable (the web's
        // `!bg-surface` on the Vault route).
        .background {
            if case .web(let path) = model.route, path.hasPrefix("/vault") {
                RoundedRectangle(cornerRadius: style("frame.topbar").radius, style: .continuous).fill(WebStyles.vars["color-surface"]?.resolve(scheme).color ?? .clear)
            }
        }
        // The bar moves the window, as the web's .ui-drag bars do (its buttons still take their clicks).
        .contentShape(Rectangle())
        .gesture(WindowDragGesture())
    }

    /// New note sits as far from the bar's right edge as from its top and bottom edges (the owner's ask, 1.1.04): the
    /// room the bar leaves round the button's height.
    private var newNoteInset: CGFloat {
        (style("frame.topbar").height - style("frame.topbar.new").height) / 2
    }

    /// Home pinned while the sidebar is hidden; the arrows while the tabs overflow; then the tabs, the only part that
    /// scrolls.
    private var strip: some View {
        let list = style("frame.tabs")
        return HStack(spacing: 0) {
            if homePinned, let home = model.tabs.tabs.first(where: \.isHome) {
                tab(home)
                    .fixedSize()
                    .padding(.leading, list.padding.left)
                    .padding(.trailing, list.gap)
            }
            // The arrows only while the tabs overflow, each dimmed with nothing more on its side (TabStrip.tsx).
            if overflow.start || overflow.end {
                HStack(spacing: style("frame.topbar").gap) {
                    scrollArrow(.chevronLeft, "Scroll tabs left", enabled: overflow.start) { scrollTabs(-1) }
                    scrollArrow(.chevronRight, "Scroll tabs right", enabled: overflow.end) { scrollTabs(1) }
                }
                .padding(.trailing, list.gap)
            }
            // They take the room the rest leaves them, no more than they need.
            tabs.layoutPriority(1)
        }
        .coordinateSpace(name: Self.strip)
        .onPreferenceChange(TabFrames.self) { tabFrames = $0 }
        #if DEBUG
        .background(GeometryReader { g in
            Color.clear.onChange(of: tabFrames, initial: true) { _, frames in
                let origin = g.frame(in: .global).origin
                model.debugTabFrames = frames.mapValues { $0.offsetBy(dx: origin.x, dy: origin.y) }
            }
        })
        #endif
    }

    private var divider: some View {
        let d = style("frame.topbar.divider")
        return Rectangle().fill(d.background.color).frame(width: d.width, height: d.height)
    }

    private func historyButton(_ icon: WebIcon, _ label: String, enabled: Bool, style id: String, action: @escaping () -> Void) -> some View {
        let s = style("frame.topbar.back")
        return Button(action: action) {
            WebIconView(icon, size: 15)
                .frame(width: s.width, height: s.height)
                .foregroundStyle(s.color.color)
                .contentShape(Rectangle())
        }
        .buttonStyle(WebHoverRowStyle(radius: s.radius, hover: WebStyles.vars["glass-hover"], press: WebStyles.vars["mac-press"], selected: false))
        .opacity(enabled ? 1 : style("frame.topbar.forward").opacity)
        .disabled(!enabled)
        .foleviTooltip("\(label) (⌘\(label == "Back" ? "[" : "]"))")
    }

    // MARK: tabs

    private var overflow: (start: Bool, end: Bool) {
        TabStripMath.overflow(scroll: scroller.scroll, visible: scroller.metrics.visible, content: scroller.metrics.content)
    }

    /// The web's ARROW: 24 by 36, the muted chevron, the accent's soft fill under the pointer.
    private func scrollArrow(_ icon: WebIcon, _ label: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            WebIconView(icon, size: 15)
                .frame(width: 24, height: 36)
                .foregroundStyle(style("frame.topbar.back").color.color)
                .contentShape(Rectangle())
        }
        .buttonStyle(WebHoverRowStyle(radius: style("frame.topbar.back").radius, hover: WebStyles.vars["color-accent-soft"], press: WebStyles.vars["mac-press"], selected: false))
        .opacity(enabled ? 1 : 0.3)
        .disabled(!enabled)
        .accessibilityLabel(label)
    }

    /// Home pinned before the list: only while the sidebar (and its Home) is hidden.
    private var homePinned: Bool { model.sidebarCollapsed }

    private var tabs: some View {
        let list = style("frame.tabs")
        let edge = TabStripMath.fade / max(1, scroller.metrics.visible)
        // A pinned Home has the list's left padding itself.
        var inset = list.padding.edgeInsets
        if homePinned { inset.leading = 0 }
        return TabRow(gap: list.gap, padding: inset, offset: scroller.scroll, report: { measured($0) }) {
            ForEach(model.tabs.tabs.filter { !(homePinned && $0.isHome) }) { t in
                tab(t)
                    // Every tab the same width, open or not (the owner, 2026-10-29); Home its own.
                    .layoutValue(key: TabRoleKey.self, value: t.isHome ? .own : .other)
                    .layoutValue(key: TabActiveKey.self, value: t.id == model.tabs.activeID)
            }
        }
        .clipped()
        // The soft edges, on a side with more tabs only (the web's mask).
        .mask(LinearGradient(stops: [
            .init(color: overflow.start ? .clear : .black, location: 0),
            .init(color: .black, location: min(0.5, edge)),
            .init(color: .black, location: max(0.5, 1 - edge)),
            .init(color: overflow.end ? .clear : .black, location: 1),
        ], startPoint: .leading, endPoint: .trailing))
        .overlay(SidewaysScroll { dx in scrollTo(scroller.scroll + dx, animated: false) })
        .onAppear { scroller.pendingReveal = false }
        .onChange(of: dragging?.id) { _, id in scroller.dragging = id != nil }
        .onChange(of: model.tabs.activeID) { revealSoon() }
        .onChange(of: model.tabs.tabs.map(\.id)) { revealSoon() }
        // Home moving into the list (sidebar shown) or out of it (hidden): the tabs after it keep their place on
        // screen, then the open one is brought into view if the new width hides it.
        .onChange(of: homePinned) { _, pinned in
            guard let home = tabFrames[FrameTab.homeID] else { return }
            scrollTo(scroller.scroll + (pinned ? -1 : 1) * (home.width + list.gap), animated: false)
        }
    }

    /// What the list measured: the scroll kept in range (tabs closing shorten it), and the open tab brought back into
    /// view, at once, when the list's width or the open tab's width changed (the window, the sidebar, the arrows
    /// coming or going, a title typed or loaded), or as asked after a change of tab.
    private func measured(_ m: TabRowMetrics) {
        defer { debugStrip() }
        guard m != scroller.metrics else { return }
        let resized = m.visible != scroller.metrics.visible || m.openWidth != scroller.metrics.openWidth
        scroller.metrics = m
        let kept = TabStripMath.clamp(scroller.scroll, visible: m.visible, content: m.content)
        if kept != scroller.scroll { scrollTo(kept, animated: false) }
        if let animated = scroller.pendingReveal {
            scroller.pendingReveal = nil
            reveal(animated: animated)
        } else if resized {
            reveal(animated: false)
        }
    }

    /// After a change of tab (a click, the keyboard, Back or Forward, a link, a new note, tabs opening or closing):
    /// without motion the first time, smoothly after, once the list has measured the change.
    private func revealSoon() {
        scroller.pendingReveal = scroller.shownOnce
        scroller.shownOnce = true
        // The list's next measure brings it (with the new tab's place); this only for a change that moves nothing.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
            guard let animated = scroller.pendingReveal else { return }
            scroller.pendingReveal = nil
            reveal(animated: animated)
        }
    }

    private func reveal(animated: Bool) {
        // On Home (pinned, always in view) the list stays where it is.
        guard !scroller.dragging, scroller.metrics.visible > 0, scroller.metrics.openWidth > 0,
              let to = TabStripMath.reveal(left: scroller.metrics.openLeft, width: scroller.metrics.openWidth, scroll: scroller.scroll, visible: scroller.metrics.visible, content: scroller.metrics.content) else { return }
        scrollTo(to, animated: animated)
    }

    /// What scripts read of the strip (Debug only).
    private func debugStrip() {
        #if DEBUG
        model.debugStrip = ["scroll": scroller.scroll, "visible": scroller.metrics.visible, "content": scroller.metrics.content, "openLeft": scroller.metrics.openLeft, "openWidth": scroller.metrics.openWidth]
        #endif
    }

    private func scrollTabs(_ dir: CGFloat) {
        scrollTo(scroller.scroll + dir * TabStripMath.step(visible: scroller.metrics.visible), animated: true)
    }

    private func scrollTo(_ x: CGFloat, animated: Bool) {
        defer { debugStrip() }
        let to = TabStripMath.clamp(x, visible: scroller.metrics.visible, content: scroller.metrics.content)
        guard to != scroller.scroll else { return }
        if animated && !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
            withAnimation(.easeInOut(duration: 0.3)) { scroller.scroll = to }
        } else {
            var t = Transaction()
            t.disablesAnimations = true
            withTransaction(t) { scroller.scroll = to }
        }
    }

    private func tab(_ t: FrameTab) -> some View {
        let active = t.id == model.tabs.activeID
        let on = WebStyles.named("frame.tab.home")
        let off = WebStyles.named("frame.tab.off")
        let s = (active ? on : off).resolve(scheme)
        let inset = t.isHome ? style("frame.tab.home").padding : style("frame.tab").padding
        let label = style("frame.tab.label")
        let icon = style("frame.tab.icon")
        let close = style("frame.tab.close")
        let title = t.isHome ? "Home" : (t.title.isEmpty ? "Untitled" : t.title)
        let text = WebTextStyle(size: label.fontSize, leading: label.lineHeight ?? 18, weight: active ? 600 : 400, letterSpacing: label.letterSpacing)
        return HStack(spacing: s.gap) {
            Button { model.selectTab(t.id) } label: {
                HStack(spacing: s.gap) {
                    WebIconView(Self.icon(for: t.route), size: 14).opacity(t.isHome ? 1 : icon.opacity)
                    Text(title).webText(text).lineLimit(1).truncationMode(.tail)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            // The title takes the tab's room up to its × (no spacer: it would get the gap on both sides).
            .frame(maxWidth: t.isHome ? nil : .infinity, alignment: .leading)
            if !t.isHome {
                Button { model.closeTab(t.id) } label: {
                    WebIconView(.x, size: 12)
                        .frame(width: close.width, height: close.height)
                        .foregroundStyle(close.color.color)
                        .contentShape(Rectangle())
                }
                .buttonStyle(WebHoverRowStyle(radius: close.radius, hover: WebStyles.vars["glass-hover"], press: WebStyles.vars["mac-press"], selected: false))
                .opacity(active || hoveredTab == t.id ? 1 : 0)
                .foleviTooltip("Close \(title)")
            }
        }
        .foregroundStyle(s.color.color)
        .padding(inset.edgeInsets)
        .frame(height: s.height)
        .webBox(active ? on : off)
        // The whole tab opens it, as the web's link that fills the tab up to its × (the × keeps its own click); the
        // bar's window drag is only for the space outside the tabs.
        .contentShape(RoundedRectangle(cornerRadius: s.radius, style: .continuous))
        .onTapGesture { model.selectTab(t.id) }
        .overlay { MiddleClick { if !t.isHome { model.closeTab(t.id) } } }
        .background(GeometryReader { g in Color.clear.preference(key: TabFrames.self, value: [t.id: g.frame(in: .named(Self.strip))]) })
        .modifier(TabDrag(id: t.id, enabled: !t.isHome, dragging: $dragging, drag: drag))
        .onHover { hoveredTab = $0 ? t.id : (hoveredTab == t.id ? nil : hoveredTab) }
        .webContextMenu { tabMenu(t) }
    }

    // MARK: dragging a tab (TabStrip.tsx's pointer drag)

    private static let strip = "frame.tabs"

    /// Moves the dragged tab with the pointer, kept inside the strip, and swaps it with a neighbour once it passes
    /// that tab's middle, as the web does. Home stays first and doesn't move.
    private func drag(_ id: String, _ value: DragGesture.Value) {
        // The tabs after Home (pinned, first in the model's order: a tab's place there is one more than here).
        let tabs = model.tabs.tabs.filter { !$0.isHome }
        guard let i = tabs.firstIndex(where: { $0.id == id }), let first = tabFrames[tabs[0].id] else { return }
        // Where each tab sits in the order as it is now, from the widths (the frames lag a layout behind a swap).
        let gap = style("frame.tabs").gap
        let widths = tabs.map { tabFrames[$0.id]?.width ?? 0 }
        var lefts: [CGFloat] = []
        var x = first.minX
        for w in widths {
            lefts.append(x)
            x += w + gap
        }
        let width = widths[i]
        var d = dragging?.id == id ? dragging! : (id: id, dx: 0, grab: value.startLocation.x - lefts[i])
        let left = min(max(value.location.x - d.grab, lefts[0]), x - gap - width)
        d.dx = left - lefts[i]
        if i + 1 < tabs.count, left + width > lefts[i + 1] + widths[i + 1] / 2 {
            model.moveTab(id, to: i + 2)
            d.dx -= widths[i + 1] + gap
        } else if i - 1 >= 0, left < lefts[i - 1] + widths[i - 1] / 2 {
            model.moveTab(id, to: i)
            d.dx += widths[i - 1] + gap
        }
        dragging = d
    }

    /// A tab's right-click menu (the web's tab ContextMenu).
    private func tabMenu(_ t: FrameTab) -> [WebMenuEntry] {
        let all = model.tabs.tabs.filter { !$0.isHome }
        let i = all.firstIndex { $0.id == t.id } ?? 0
        let left = Array(all[..<i]).map(\.id), right = all.isEmpty ? [] : Array(all[min(all.count, i + 1)...]).map(\.id)
        return [
            WebMenuEntry(.item("Close tab", icon: .x), disabled: t.isHome) { model.closeTab(t.id) },
            WebMenuEntry(.item("Close tabs to the right", icon: .arrowRightToLine), disabled: right.isEmpty) { right.forEach { model.closeTab($0) } },
            WebMenuEntry(.item("Close tabs to the left", icon: .arrowLeftToLine), disabled: left.isEmpty) { left.forEach { model.closeTab($0) } },
            .separator(),
            WebMenuEntry(.item("Close all tabs", icon: .circleX, danger: true)) { all.forEach { model.closeTab($0.id) } },
        ]
    }

    /// The web's ViewIcon for a tab's page.
    static func icon(for route: FrameRoute) -> WebIcon {
        switch route {
        case .home: return .house
        case .notes(let v):
            switch v {
            case .starred: return .star
            case .unsorted: return .inbox
            case .templates: return .layoutTemplate
            case .archive: return .archive
            case .trash: return .trash
            default: return .files
            }
        case .folder: return .folder
        case .tag: return .hash
        case .shared: return .share2
        case .changes: return .fileDiff
        case .tasks: return .squareCheck
        case .calendar: return .calendar
        case .note: return .fileText
        case .search: return .search
        case .catchUp: return .sparkles
        case .web(let path):
            if path.hasPrefix("/graph") { return .waypoints }
            if path.hasPrefix("/review") { return .layers }
            if path.hasPrefix("/settings") { return .settings }
            if path.hasPrefix("/vault") { return .lock }
            if path.hasPrefix("/help") { return .circleQuestionMark }
            return .layoutList
        }
    }
}
/// Each tab's frame in the strip.
private struct TabFrames: PreferenceKey {
    static let defaultValue: [String: CGRect] = [:]
    static func reduce(value: inout [String: CGRect], nextValue: () -> [String: CGRect]) {
        value.merge(nextValue()) { $1 }
    }
}

/// A tab's drag: after 5 points it follows the pointer (lifted, with the web's shadow) and, let go, settles in its
/// new place. A press that doesn't move is a click.
private struct TabDrag: ViewModifier {
    let id: String
    let enabled: Bool
    @Binding var dragging: (id: String, dx: CGFloat, grab: CGFloat)?
    let drag: (String, DragGesture.Value) -> Void

    func body(content: Content) -> some View {
        let lifted = dragging?.id == id
        content
            .offset(x: lifted ? dragging!.dx : 0)
            .shadow(color: .black.opacity(lifted ? 0.16 : 0), radius: 7, y: 4)
            .zIndex(lifted ? 1 : 0)
            .gesture(
                DragGesture(minimumDistance: 5, coordinateSpace: .named("frame.tabs"))
                    .onChanged { if enabled { drag(id, $0) } }
                    .onEnded { _ in
                        guard dragging?.id == id else { return }
                        withAnimation(.easeOut(duration: 0.15)) { dragging = nil }
                    },
                including: enabled ? .all : .subviews
            )
    }
}

/// Takes only middle clicks (a tab's close, as on the web and in browsers); every other click goes through.
private struct MiddleClick: NSViewRepresentable {
    let action: () -> Void

    final class View: NSView {
        var action: () -> Void = {}
        override func hitTest(_ point: NSPoint) -> NSView? {
            guard let event = NSApp.currentEvent, [.otherMouseDown, .otherMouseUp].contains(event.type), event.buttonNumber == 2 else { return nil }
            return super.hitTest(point)
        }
        override func otherMouseDown(with event: NSEvent) {}
        override func otherMouseUp(with event: NSEvent) {
            if event.buttonNumber == 2, bounds.contains(convert(event.locationInWindow, from: nil)) { action() }
        }
    }

    func makeNSView(context: Context) -> View {
        let v = View()
        v.action = action
        return v
    }

    func updateNSView(_ v: View, context: Context) { v.action = action }
}
#endif

