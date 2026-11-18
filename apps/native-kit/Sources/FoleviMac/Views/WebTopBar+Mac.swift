// The Mac's title bar in the native look (docs/MAC_NATIVE_LOOK.md; the owner's layout, 2026-11-18): the window's
// top strip, with no toolbar inside the card:
//
//   ● ● ●  [sidebar]   ‹ ›  (⌂) [ Calendar | (× Kyoto in November) | Recipes ] (+)  .......  [bell] [inspector]
//
// The traffic lights; the sidebar's button at the sidebar's trailing end; then, from the content card's leading
// edge, Back and Forward and the tab bar drawn as Finder's (the owner, 2026-11-18): Home in a round button, the tabs in a grey capsule
// track with a hairline between them, each its own width with its icon and title centred, the open one a Liquid
// Glass capsule inset in the track, and a round + after the track. With only Home open there is no track, just the
// two round buttons. The bell and, on a note, the inspector's button sit at the strip's end. Empty strip space
// moves the window.
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
        // (The bell's hover capsule ends on the card's trailing edge.)
        .padding(.trailing, MacLook.containerMargin)
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

    /// Back and Forward, the tabs, and the strip's trailing buttons, after its leading part.
    private var tail: some View {
        HStack(spacing: 6) {
            // Back and Forward stay put, dimmed with nowhere to go (Finder's and Safari's), so the tabs never shift
            // and nothing floats over the page for them.
            HStack(spacing: 0) {
                stripButton("chevron.left", label: "Back", help: "Back (⌘[)") { model.goBack() }
                    .disabled(!model.history.canGoBack)
                    .opacity(model.history.canGoBack ? 1 : 0.35)
                stripButton("chevron.right", label: "Forward", help: "Forward (⌘])") { model.goForward() }
                    .disabled(!model.history.canGoForward)
                    .opacity(model.history.canGoForward ? 1 : 0.35)
            }
            .padding(.trailing, 2)
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

    /// A button in the strip: a symbol in a 28 pt capsule (the tabs' shape) with the quiet hover, its tooltip and its
    /// name.
    func stripButton(_ symbol: String, label: String, help: String, anchored: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            MacSymbol(symbol, size: MacLook.iconButtonSymbol)
                .frame(width: 32, height: MacLook.iconButton)
                .contentShape(Rectangle())
                .background { if anchored { MenuAnchor { bellAnchor = $0 } } }
        }
        .buttonStyle(QuietHoverStyle(shape: AnyShape(Capsule())))
        .foregroundStyle(MacLook.Colors.secondary)
        .foleviTooltip(help)
        .accessibilityLabel(label)
    }

    // MARK: the tabs

    /// Home in its round button; then the tabs in their track, the only part that scrolls; a round + after it.
    private var tabStrip: some View {
        HStack(spacing: MacLook.barSpacing) {
            HStack(spacing: MacLook.barSpacing) {
                if let home = model.tabs.tabs.first(where: \.isHome) {
                    macTab(home).fixedSize()
                }
                // (No empty track while Home is the only tab.)
                if model.tabs.tabs.contains(where: { !$0.isHome }) {
                    macTabs
                        // The arrows while the tabs overflow, over the list's trailing end (the list keeps their
                        // room after its last tab, so its width never depends on them).
                        .overlay(alignment: .trailing) {
                            if overflow.start || overflow.end {
                                HStack(spacing: 0) {
                                    scrollChevron("chevron.left", "Scroll tabs left", enabled: overflow.start) { scrollTabs(-1) }
                                    scrollChevron("chevron.right", "Scroll tabs right", enabled: overflow.end) { scrollTabs(1) }
                                }
                            }
                        }
                        // The track: a grey capsule round the tabs, each inset in it on every side (Finder's tab bar).
                        // Nothing shows outside it: a tab scrolling away leaves under its rounded end.
                        .padding(.horizontal, Self.trackInset)
                        .frame(height: Self.trackHeight)
                        .background(MacLook.Colors.track)
                        .clipShape(Capsule())
                        .layoutPriority(1)
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
            trackCircle("plus", label: "New tab", help: "New Tab (⌘T)") {
                model.open(.home)
                model.barSearchFocus += 1
            }
        }
    }

    /// A tab's inset inside the track, and the track's height round the tabs.
    static let trackInset = MacLook.capsuleInset
    static var trackHeight: CGFloat { MacLook.tabHeight + trackInset * 2 }

    /// A round button beside the track, on the track's own fill (Finder's +): a symbol, its tooltip and its name.
    private func trackCircle(_ symbol: String, label: String, help: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            MacSymbol(symbol, size: 14, weight: .medium)
                .frame(width: Self.trackHeight, height: Self.trackHeight)
                .contentShape(Circle())
        }
        .buttonStyle(QuietHoverStyle(shape: AnyShape(Circle())))
        .background(MacLook.Colors.track, in: Circle())
        .foregroundStyle(MacLook.Colors.secondary)
        .foleviTooltip(help)
        .accessibilityLabel(label)
    }

    /// The arrows' room after the last tab while the tabs overflow (two 20 pt chevrons and a little air).
    static let arrowsRoom: CGFloat = 44
    /// The room the list keeps round its tabs inside its clip, so the open tab's raised capsule (its glass and its
    /// shadow) is never cut by the list's edge; the list is laid out as if it weren't there.
    static let tabBleed = (x: CGFloat(6), y: CGFloat(10))

    private func scrollChevron(_ symbol: String, _ label: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            MacSymbol(symbol, size: 12, weight: .semibold)
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
        let arrows = overflow.start || overflow.end
        let bleed = Self.tabBleed
        return TabRow(gap: tabGap, padding: EdgeInsets(top: bleed.y, leading: bleed.x, bottom: bleed.y, trailing: bleed.x + (arrows ? Self.arrowsRoom : 0)), offset: scroller.scroll, titleBar: true, report: { m in
            // (Only the measures made at the width the list really has: see TabScroller.shownWidth.)
            if scroller.shownWidth == 0 || abs(m.visible - scroller.shownWidth) < 0.5 { measured(m) }
        }) {
            let listed = model.tabs.tabs.filter { !$0.isHome }
            ForEach(Array(listed.enumerated()), id: \.element.id) { i, t in
                macTab(t, separator: i > 0 && !lit(t) && !lit(listed[i - 1]))
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
        // arrows. The list takes the pointer only where it shows (never in the room kept for the open tab's shadow).
        .contentShape(InsetRect(dx: bleed.x, dy: bleed.y))
        // The soft edges, only while more tabs continue past that edge; nothing shows under the arrows.
        .modifier(EdgeFade(leading: overflow.start, trailing: overflow.end, trailingInset: arrows ? Self.arrowsRoom : 0))
        .overlay(SidewaysScroll { dx in scrollTo(scroller.scroll + dx, animated: false) })
        .padding(.horizontal, -bleed.x)
        .padding(.vertical, -bleed.y)
        // The tab picture goes once the pointer leaves the strip (it stays while it moves between tabs).
        .onHover { if !$0 { model.preview.hide() } }
        .onAppear { scroller.pendingReveal = false }
        .onChange(of: dragging?.id) { _, id in scroller.dragging = id != nil }
        .onChange(of: model.tabs.activeID) { revealSoon() }
        .onChange(of: model.tabs.tabs.map(\.id)) { revealSoon() }
    }

    /// A tab that draws a fill of its own (the open one, the one under the pointer, the one being dragged): the
    /// hairlines beside it are hidden, as Finder's.
    private func lit(_ t: FrameTab) -> Bool {
        t.id == model.tabs.activeID || t.id == hoveredTab || t.id == dragging?.id
    }

    /// One tab: a capsule in the track, its icon (the × in its place on the open tab and under the pointer) and its
    /// title, centred; the open one in Liquid Glass. Pinned tabs are their icon alone; Home is its icon in a round
    /// button before the track. `separator`: a hairline in the gap before it.
    func macTab(_ t: FrameTab, separator: Bool = false) -> some View {
        let active = t.id == model.tabs.activeID
        let label = model.tabs.label(t)
        let hovered = hoveredTab == t.id
        let compact = t.isHome || t.pinned
        let closes = !compact && (active || hovered)
        return HStack(spacing: 5) {
            if compact {
                if t.isJoined, let panes = t.panes {
                    ForEach(panes, id: \.self) { _ in MacSymbol("doc.text", size: 11) }
                } else if Self.wearsFlower(t.route) {
                    AiMarkGlyph(size: 13)
                } else {
                    WebIconView(Self.icon(for: t.route), size: 15, strokeWidth: active ? 2.3 : 2)
                }
            } else {
                ZStack {
                    if closes {
                        macCloseButton(t, label: label, visible: true)
                    } else if Self.wearsFlower(t.route) {
                        AiMarkGlyph(size: 12)
                    } else {
                        WebIconView(Self.icon(for: t.route), size: 14)
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
        // (A tab wider than its title keeps the title in its middle, so the strip's rhythm stays even.)
        // (Home is a circle as tall as the track; every other tab a capsule inside it.)
        .frame(width: compact ? (t.isJoined ? 52 : Self.trackHeight) : nil, height: t.isHome ? Self.trackHeight : MacLook.tabHeight, alignment: .center)
        .frame(maxWidth: compact ? nil : .infinity, alignment: .center)
        .background {
            if t.isHome, !active {
                // Home's own round button, on the track's fill.
                Capsule().fill(MacLook.Colors.track)
                if hovered { Capsule().fill(MacLook.Colors.hover.opacity(0.5)) }
            } else if !active && hovered {
                Capsule().fill(MacLook.Colors.hover.opacity(0.5))
            }
        }
        // The hairline between two tabs, in the middle of the gap before this one.
        .overlay(alignment: .leading) {
            if separator {
                Capsule().fill(MacLook.Colors.separator)
                    .frame(width: 1, height: 14)
                    .offset(x: -(tabGap + 1) / 2)
                    .allowsHitTesting(false)
                    .transition(.opacity)
            }
        }
        // The open tab's capsule, in Liquid Glass on the window's material, slides here from the tab that had it (one
        // shape, matched across the strip).
        .background {
            if active {
                Capsule()
                    .fill(.clear)
                    .glassEffect(.regular, in: .capsule)
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
                    MacSymbol("doc.text", size: 11)
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
            MacSymbol("macwindow", size: 10).frame(width: 18, height: 18).contentShape(Circle())
        }
        .buttonStyle(QuietHoverStyle(shape: AnyShape(Circle())))
        .foregroundStyle(MacLook.Colors.secondary)
        .accessibilityLabel("Show \(label)'s floating window")
        .foleviTooltip("Floating in Its Own Window")
    }

    private func macCloseButton(_ t: FrameTab, label: String, visible: Bool) -> some View {
        Button { model.closeTab(t.id) } label: {
            MacSymbol("xmark", size: 10, weight: .semibold)
                .frame(width: 18, height: 18)
                // (It takes clicks 3 points round it: a near miss no longer selects the tab instead, MAC-34.)
                .padding(3)
                .contentShape(Rectangle())
                .padding(-3)
        }
        .buttonStyle(QuietHoverStyle(shape: AnyShape(Circle())))
        .foregroundStyle(MacLook.Colors.secondary)
        .opacity(visible ? 1 : 0)
        // (On the ×, the tab's picture goes: it lay over the button's tooltip.)
        .onHover { if $0 { model.preview.hide() } }
        // (Hidden, it takes no clicks: they select the tab.)
        .allowsHitTesting(visible)
        .accessibilityLabel("Close \(label)")
        .foleviTooltip("Close Tab (⌘W)")
    }
}

/// A rectangle inset by its own amounts on each axis (a hit shape smaller than what's drawn).
struct InsetRect: Shape {
    var dx: CGFloat
    var dy: CGFloat
    func path(in rect: CGRect) -> Path { Path(rect.insetBy(dx: dx, dy: dy)) }
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
