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
        .onHover { hoveredTab = $0 ? t.id : (hoveredTab == t.id ? nil : hoveredTab) }
        .webContextMenu { tabMenu(t) }
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
            return .layoutList
        }
    }
}
#endif
