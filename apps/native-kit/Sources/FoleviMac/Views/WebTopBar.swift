// The content's top bar drawn as the web app's (apps/web/src/components/app/TabStrip.tsx and BackForward.tsx,
// as Folevi for Mac shows them), from the live app's computed styles ("frame.topbar.*", "frame.tab*"): a glass
// bar inside the content's card with Back and Forward, a divider, the tabs (Home first, then one per open page,
// the open one raised), and New note at the end. While the sidebar is hidden, the window buttons' room and the
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
            historyButton(.chevronLeft, "Back", enabled: model.history.canGoBack, style: "frame.topbar.back") { model.goBack() }
                .padding(.trailing, -bar.gap)
            historyButton(.chevronRight, "Forward", enabled: model.history.canGoForward, style: "frame.topbar.forward") { model.goForward() }
            divider
            tabs
            Spacer(minLength: 0)
            WebButton(model.route.isNote ? "New note" : "New note", icon: .plus, variant: .primary, size: .sm) { model.newNote() }
                .help("New note (⌘⌥N)")
        }
        .padding(bar.padding.edgeInsets)
        .frame(height: bar.height)
        .frame(maxWidth: .infinity)
        .webBox(WebStyles.named("frame.topbar"))
        // The bar moves the window, as the web's .ui-drag bars do (its buttons still take their clicks).
        .contentShape(Rectangle())
        .gesture(WindowDragGesture())
    }

    private var divider: some View {
        let d = style("frame.topbar.divider")
        return Rectangle().fill(d.background.color).frame(width: d.width, height: d.height)
    }

    private func historyButton(_ icon: WebIcon, _ label: String, enabled: Bool, style id: String, action: @escaping () -> Void) -> some View {
        let s = style("frame.topbar.back")
        return Button(action: action) {
            WebIconView(icon, size: 16)
                .frame(width: s.width, height: s.height)
                .foregroundStyle(s.color.color)
                .contentShape(Rectangle())
        }
        .buttonStyle(WebHoverRowStyle(radius: s.radius, hover: WebStyles.vars["glass-hover"], press: WebStyles.vars["mac-press"], selected: false))
        .opacity(enabled ? 1 : style("frame.topbar.forward").opacity)
        .disabled(!enabled)
        .help("\(label) (⌘\(label == "Back" ? "[" : "]"))")
    }

    // MARK: tabs

    private var tabs: some View {
        let strip = style("frame.tabs")
        return ScrollView(.horizontal) {
            HStack(spacing: strip.gap) {
                ForEach(model.tabs.tabs) { t in
                    tab(t)
                }
            }
            .padding(strip.padding.edgeInsets)
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
        .scrollIndicators(.never)
        .fixedSize(horizontal: true, vertical: false)
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
            if !t.isHome {
                Spacer(minLength: 0)
                Button { model.closeTab(t.id) } label: {
                    WebIconView(.x, size: 12)
                        .frame(width: close.width, height: close.height)
                        .foregroundStyle(close.color.color)
                        .contentShape(Rectangle())
                }
                .buttonStyle(WebHoverRowStyle(radius: close.radius, hover: WebStyles.vars["glass-hover"], press: WebStyles.vars["mac-press"], selected: false))
                .opacity(active || hoveredTab == t.id ? 1 : 0)
                .help("Close \(title)")
            }
        }
        .foregroundStyle(s.color.color)
        .padding(inset.edgeInsets)
        .frame(minWidth: t.isHome ? nil : style("frame.tab").width, maxWidth: t.isHome ? nil : 284)
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
        let tabs = model.tabs.tabs
        guard let i = tabs.firstIndex(where: { $0.id == id }), i > 0, let home = tabFrames[tabs[0].id] else { return }
        // Where each tab sits in the order as it is now, from the widths (the frames lag a layout behind a swap).
        let gap = style("frame.tabs").gap
        let widths = tabs.map { tabFrames[$0.id]?.width ?? 0 }
        var lefts: [CGFloat] = []
        var x = home.minX
        for w in widths {
            lefts.append(x)
            x += w + gap
        }
        let width = widths[i]
        var d = dragging?.id == id ? dragging! : (id: id, dx: 0, grab: value.startLocation.x - lefts[i])
        let left = min(max(value.location.x - d.grab, lefts[1]), x - gap - width)
        d.dx = left - lefts[i]
        if i + 1 < tabs.count, left + width > lefts[i + 1] + widths[i + 1] / 2 {
            model.moveTab(id, to: i + 1)
            d.dx -= widths[i + 1] + gap
        } else if i - 1 >= 1, left < lefts[i - 1] + widths[i - 1] / 2 {
            model.moveTab(id, to: i - 1)
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
