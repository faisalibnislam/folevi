// The Mac's title bar in the native look (docs/MAC_NATIVE_LOOK.md; the owner's layout, 2026-11-18): the window's
// top strip, with no toolbar inside the card:
//
//   ● ● ●  [sidebar]   [⌂] [Calendar] [× Kyoto in November] [Recipes] [+]  ..................  [bell] [inspector]
//
// The traffic lights; the sidebar's button at the sidebar's trailing end; Folevi's tabs from the content card's
// leading edge: compact capsules, an SF Symbol and the title, the open one raised; a + after the last; the bell and,
// on a note, the inspector's button at the strip's end. Empty strip space moves the window.
//
// Folevi's tab model is unchanged (WebTopBar.swift keeps it: pinned, joined and per-place tabs, folder tabs, close,
// middle click, dragging to reorder, sideways scrolling, a picture on hover, the Tab Overview, the tab's menu); only
// its drawing is the Mac's. The card's own controls (Back, New note, the title, search or Share) float in the card
// (CardControls, below).
#if os(macOS)
import AppKit
import SwiftUI
import FoleviDesign
import FoleviEngine
import FoleviScreens

extension WebTopBar {
    var macBody: some View {
        HStack(spacing: 0) {
            lead
            tail
        }
        .padding(.trailing, 10)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        // (A tab's picture is placed from its tab's frame in the strip, and the strip starts at the window's top left.)
        .coordinateSpace(name: Self.space)
        // The strip's empty room moves the window (its tabs and buttons keep their clicks).
        .background { Color.clear.contentShape(Rectangle()).windowDrag() }
        // A tab or button clicked in an inactive window acts at once (MAC-05).
        .macClickThrough()
    }

    /// The traffic lights' room, then the sidebar's button at the sidebar's trailing end (right after the lights
    /// while the sidebar is hidden): the tabs start where the card does.
    private var lead: some View {
        let hidden = model.sidebarHidden
        return HStack(spacing: 0) {
            Color.clear.frame(width: MacLook.trafficLightsRoom)
            Spacer(minLength: 0)
            stripButton("sidebar.left", label: hidden ? "Show sidebar" : "Hide sidebar", help: hidden ? "Show Sidebar (⌘\\)" : "Hide Sidebar (⌘\\)") {
                withAnimation(MacLook.animation(NSWorkspace.shared.accessibilityDisplayShouldReduceMotion)) { model.sidebarCollapsed.toggle() }
            }
            .padding(.trailing, 8)
        }
        .frame(width: hidden ? MacLook.trafficLightsRoom + 38 : MacLook.sidebarWidth)
    }

    /// The tabs and the strip's trailing buttons, after its leading part.
    private var tail: some View {
        HStack(spacing: 6) {
            tabStrip
            Spacer(minLength: 8)
            stripButton("bell", label: "Notifications", help: "Notifications", anchored: true) { model.showNotifications?(bellAnchor) }
            if model.route.isNote {
                let shown = model.noteToolsShown
                stripButton("sidebar.right", label: "Note tools", help: shown ? "Hide Note Tools" : "Show Note Tools") {
                    withAnimation(MacLook.animation(NSWorkspace.shared.accessibilityDisplayShouldReduceMotion)) {
                        WebSidebarController.setNoteTools(model, shown: !shown)
                    }
                }
                .accessibilityValue(shown ? "Shown" : "Hidden")
            }
        }
    }

    /// A button in the strip: a symbol in a 28 pt rounded square with the quiet hover, its tooltip and its name.
    func stripButton(_ symbol: String, label: String, help: String, anchored: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: 14))
                .frame(width: 30, height: MacLook.tabHeight)
                .contentShape(Rectangle())
                .background { if anchored { MenuAnchor { bellAnchor = $0 } } }
        }
        .buttonStyle(QuietHoverStyle(shape: AnyShape(RoundedRectangle(cornerRadius: 7, style: .continuous))))
        .foregroundStyle(MacLook.Colors.secondary)
        .foleviTooltip(help)
        .accessibilityLabel(label)
    }

    // MARK: the tabs

    /// Home, pinned; then the tabs, the only part that scrolls; a + after the last.
    private var tabStrip: some View {
        HStack(spacing: 2) {
            HStack(spacing: tabGap) {
                if let home = model.tabs.tabs.first(where: \.isHome) {
                    macTab(home).fixedSize()
                }
                macTabs
                    .layoutPriority(1)
                    // The arrows while the tabs overflow, over the list's trailing end (the list keeps their room
                    // after its last tab, so its width never depends on them).
                    .overlay(alignment: .trailing) {
                        if overflow.start || overflow.end {
                            HStack(spacing: 0) {
                                scrollChevron("chevron.left", "Scroll tabs left", enabled: overflow.start) { scrollTabs(-1) }
                                scrollChevron("chevron.right", "Scroll tabs right", enabled: overflow.end) { scrollTabs(1) }
                            }
                        }
                    }
            }
            .coordinateSpace(name: Self.strip)
            .animation(MacLook.animation(NSWorkspace.shared.accessibilityDisplayShouldReduceMotion), value: model.tabs.activeID)
            .onPreferenceChange(TabFrames.self) { tabFrames = $0 }
            #if DEBUG
            .background(GeometryReader { g in
                Color.clear.onChange(of: tabFrames, initial: true) { _, frames in
                    let origin = g.frame(in: .global).origin
                    model.debugTabFrames = frames.mapValues { $0.offsetBy(dx: origin.x, dy: origin.y) }
                }
            })
            #endif
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Tabs")
            stripButton("plus", label: "New tab", help: "New Tab (⌘T)") {
                model.open(.home)
                model.barSearchFocus += 1
            }
        }
    }

    /// The arrows' room after the last tab while the tabs overflow (two 20 pt chevrons and a little air).
    static let arrowsRoom: CGFloat = 44

    private func scrollChevron(_ symbol: String, _ label: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: 11, weight: .semibold))
                .frame(width: 20, height: MacLook.tabHeight)
                .contentShape(Rectangle())
        }
        .buttonStyle(QuietHoverStyle(shape: AnyShape(Capsule())))
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.35)
        .foleviTooltip(label)
        .accessibilityLabel(label)
    }

    private var macTabs: some View {
        TabRow(gap: tabGap, padding: EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: overflow.start || overflow.end ? Self.arrowsRoom : 0), offset: scroller.scroll, titleBar: true, report: { m in
            // (Only the measures made at the width the list really has: see TabScroller.shownWidth.)
            if scroller.shownWidth == 0 || abs(m.visible - scroller.shownWidth) < 0.5 { measured(m) }
        }) {
            ForEach(model.tabs.tabs.filter { !$0.isHome }) { t in
                macTab(t)
                    // Each tab its own width up to 180 pt, all shrinking together to 90 before the strip scrolls;
                    // Home and pinned tabs their icon's width, joined notes as wide as two.
                    .layoutValue(key: TabRoleKey.self, value: t.isHome || t.pinned ? .own : t.isJoined ? .joined : .other)
                    .layoutValue(key: TabActiveKey.self, value: t.id == model.tabs.activeID)
                    .transition(.opacity)
            }
        }
        .onGeometryChange(for: CGFloat.self, of: { $0.size.width }) { scroller.shownWidth = $0 }
        // A tab opening, closing or moving: the others ease into their new places and widths (macOS's tab bars).
        .animation(MacLook.animation(NSWorkspace.shared.accessibilityDisplayShouldReduceMotion), value: model.tabs.tabs.map(\.id))
        .clipped()
        // Clipping only hides the tabs scrolled out of the list: they'd still take the pointer over Home and the
        // arrows. The list takes the pointer only where it shows.
        .contentShape(Rectangle())
        // The soft edges, only while more tabs continue past that edge.
        .modifier(EdgeFade(leading: overflow.start, trailing: overflow.end))
        .overlay(SidewaysScroll { dx in scrollTo(scroller.scroll + dx, animated: false) })
        // The tab picture goes once the pointer leaves the strip (it stays while it moves between tabs).
        .onHover { if !$0 { model.preview.hide() } }
        .onAppear { scroller.pendingReveal = false }
        .onChange(of: dragging?.id) { _, id in scroller.dragging = id != nil }
        .onChange(of: model.tabs.activeID) { revealSoon() }
        .onChange(of: model.tabs.tabs.map(\.id)) { revealSoon() }
    }

    /// One tab: a compact capsule, its symbol (the × in its place on the open tab and under the pointer) and its
    /// title; the open one raised on the card's fill. Home and pinned tabs are their icon alone.
    func macTab(_ t: FrameTab) -> some View {
        let active = t.id == model.tabs.activeID
        let label = model.tabs.label(t)
        let hovered = hoveredTab == t.id
        let compact = t.isHome || t.pinned
        let closes = !compact && (active || hovered)
        return HStack(spacing: 5) {
            if compact {
                if t.isJoined, let panes = t.panes {
                    ForEach(panes, id: \.self) { _ in Image(systemName: "doc.text").font(.system(size: 11)) }
                } else if Self.wearsFlower(t.route) {
                    AiMarkGlyph(size: 13)
                } else {
                    Image(systemName: Self.symbol(for: t.route)).font(.system(size: 12, weight: active ? .semibold : .regular))
                }
            } else {
                ZStack {
                    if closes {
                        macCloseButton(t, label: label, visible: true)
                    } else if Self.wearsFlower(t.route) {
                        AiMarkGlyph(size: 12)
                    } else {
                        Image(systemName: Self.symbol(for: t.route)).font(.system(size: 11))
                    }
                }
                .frame(width: 16, height: 16)
                if t.isJoined, let panes = t.panes {
                    macJoinedSections(t, panes, active: active)
                } else {
                    MacTruncatingText(text: label, font: active ? MacLook.Text.body.weight(.medium) : MacLook.Text.body)
                }
                if !t.isJoined, let id = t.route.noteId, model.floatingNotes.contains(id) { macFloatingBadge(id, label: label) }
            }
        }
        .padding(.horizontal, compact ? 0 : 10)
        .foregroundStyle(active ? MacLook.Colors.label : MacLook.Colors.secondary)
        .frame(width: compact ? (t.isJoined ? 52 : 34) : nil, height: MacLook.tabHeight, alignment: .leading)
        .frame(maxWidth: compact ? nil : .infinity, alignment: .leading)
        .background {
            if !active && hovered { Capsule().fill(MacLook.Colors.hover.opacity(0.5)) }
        }
        // The open tab's capsule slides here from the tab that had it (one shape, matched across the strip).
        .background {
            if active {
                Capsule()
                    .fill(MacLook.Colors.container)
                    .shadow(color: .black.opacity(0.14), radius: 0.5, y: 0.5)
                    .shadow(color: .black.opacity(0.06), radius: 3, y: 1)
                    .matchedGeometryEffect(id: "open-tab", in: tabPill)
            }
        }
        // The whole tab opens it (its buttons keep their own clicks); the strip's window drag is only outside the tabs.
        .contentShape(Capsule())
        .onTapGesture { model.selectTab(t.id) }
        .overlay { TabMiddleClick { if !t.isHome && !t.pinned { model.closeTab(t.id) } } }
        .background(GeometryReader { g in Color.clear.preference(key: TabFrames.self, value: [t.id: g.frame(in: .named(Self.strip))]) })
        .modifier(TabDrag(id: t.id, enabled: !t.isHome, dragging: $dragging, drag: drag))
        .onHover { hoveredTab = $0 ? t.id : (hoveredTab == t.id ? nil : hoveredTab) }
        .modifier(TabPreviewHover(id: t.id, active: active, model: model))
        // (Home and pinned tabs show their icon alone: the tooltip names them.)
        .foleviTooltip(compact ? (t.isHome ? "Home" : label) : "")
        .accessibilityElement(children: .contain)
        .accessibilityLabel(t.isHome ? "Home" : label)
        .accessibilityAddTraits(active ? [.isSelected, .isButton] : .isButton)
        .accessibilityAction { model.selectTab(t.id) }
        .webContextMenu { tabMenu(t) }
    }

    /// Joined notes: one tab, a section per note (each opens the group with that note in focus), divided by a hairline.
    /// Pinned, just their icons.
    private func macJoinedSections(_ t: FrameTab, _ panes: [String], active: Bool) -> some View {
        let focus = active ? t.route.noteId : nil
        return HStack(spacing: 0) {
            ForEach(Array(panes.enumerated()), id: \.element) { i, id in
                if i > 0 { Rectangle().fill(MacLook.Colors.separator).frame(width: 1, height: 14).padding(.horizontal, 4) }
                let here = id == focus
                HStack(spacing: 5) {
                    Image(systemName: "doc.text").font(.system(size: 11))
                    if !t.pinned {
                        MacTruncatingText(text: model.tabs.paneTitles[id] ?? "Untitled", font: here ? MacLook.Text.body.weight(.semibold) : MacLook.Text.body)
                            .opacity(active && !here ? 0.85 : 1)
                    }
                }
                .padding(.horizontal, 2)
                .frame(maxWidth: t.pinned ? nil : .infinity, alignment: .leading)
                .contentShape(Rectangle())
                // (hover: the tab's own fill, drawn by macTab round all its sections)
                .onTapGesture { model.open(.note(id)) }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// A note floating in its own window (Float note) says so on its tab; clicking brings that window forward.
    private func macFloatingBadge(_ id: String, label: String) -> some View {
        Button { model.floatNote(id) } label: {
            Image(systemName: "macwindow").font(.system(size: 10)).frame(width: 18, height: 18).contentShape(Circle())
        }
        .buttonStyle(QuietHoverStyle(shape: AnyShape(Circle())))
        .foregroundStyle(MacLook.Colors.secondary)
        .accessibilityLabel("Show \(label)'s floating window")
        .foleviTooltip("Floating in Its Own Window")
    }

    private func macCloseButton(_ t: FrameTab, label: String, visible: Bool) -> some View {
        Button { model.closeTab(t.id) } label: {
            Image(systemName: "xmark").font(.system(size: 9, weight: .semibold))
                .frame(width: 18, height: 18)
                // (It takes clicks 3 points round it: a near miss no longer selects the tab instead, MAC-34.)
                .padding(3)
                .contentShape(Rectangle())
                .padding(-3)
        }
        .buttonStyle(QuietHoverStyle(shape: AnyShape(Circle())))
        .foregroundStyle(MacLook.Colors.secondary)
        .opacity(visible ? 1 : 0)
        // (Hidden, it takes no clicks: they select the tab.)
        .allowsHitTesting(visible)
        .accessibilityLabel("Close \(label)")
        .foleviTooltip("Close Tab (⌘W)")
    }

    /// The SF Symbol for a tab's page (WebTopBar.icon(for:) names the web's).
    static func symbol(for route: FrameRoute) -> String {
        switch route {
        case .home: return "house"
        case .notes(let v):
            switch v {
            case .starred: return "bookmark"
            case .unsorted: return "tray"
            case .templates: return "rectangle.3.group"
            case .archive: return "archivebox"
            case .trash: return "trash"
            default: return "doc.on.doc"
            }
        case .folder: return "folder"
        case .tag: return "number"
        case .shared: return "person.2"
        case .changes: return "plus.forwardslash.minus"
        case .tasks: return "checkmark.square"
        case .calendar: return "calendar"
        case .note: return "doc.text"
        case .search: return "magnifyingglass"
        case .catchUp: return "newspaper"
        case .web(let path):
            if path.hasPrefix("/graph") { return "point.3.connected.trianglepath.dotted" }
            if path.hasPrefix("/review") { return "rectangle.stack" }
            if path.hasPrefix("/settings") { return "gearshape" }
            if path.hasPrefix("/vault") { return "lock" }
            if path == "/folders" { return "folder" }
            if path == "/tags" { return "number" }
            if path.hasPrefix("/help") { return "questionmark.circle" }
            return "list.bullet"
        }
    }
}

/// A one-line label cut off at its end when it doesn't fit, with the whole of it as a tooltip only then (tooltips
/// never repeat what shows).
struct MacTruncatingText: View {
    let text: String
    let font: Font
    @State private var full: CGFloat = 0
    @State private var shown: CGFloat = 0

    var body: some View {
        Text(text).font(font).lineLimit(1).truncationMode(.tail)
            .onGeometryChange(for: CGFloat.self, of: { $0.size.width }) { shown = $0 }
            .background(alignment: .leading) {
                Text(text).font(font).lineLimit(1).fixedSize().hidden()
                    .onGeometryChange(for: CGFloat.self, of: { $0.size.width }) { full = $0 }
            }
            .foleviTooltip(full > shown + 0.5 ? text : "")
    }
}
#endif
