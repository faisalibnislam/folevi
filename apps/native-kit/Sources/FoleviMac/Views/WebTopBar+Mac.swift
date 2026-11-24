// The Mac's title bar in the native look (docs/MAC_NATIVE_LOOK.md; the owner's layout, 2026-11-18): the window's
// top strip, with no toolbar inside the card:
//
//   ● ● ●  [note tools/folders] [sidebar]   ‹ ›  (⌂) (▦) [ Calendar | (× Kyoto in November) | Recipes ]  (+ New note)  [sync] [bell]
//
// The traffic lights; the sidebar's button at the sidebar's trailing end; then, from the content card's leading
// edge, Back and Forward and the tab bar drawn as Finder's (the owner, 2026-11-18): Home in a round button, the tabs in a grey capsule
// track with a hairline between them, each its own width with its icon and title centred, the open one a Liquid
// Glass capsule inset in the track, and the Tab Overview's round button right after Home. With only Home open there
// is no track. The bell sits at the strip's end, the sync status before it; on a note, the switch between the note's
// tools and the folders in the sidebar is beside the sidebar's button. Empty strip space moves the window.
//
// Folevi's tab model is unchanged (WebTopBar.swift keeps it: pinned, joined and per-place tabs, folder tabs, close,
// middle click, dragging to reorder, sideways scrolling, a picture on hover, the Tab Overview, the tab's menu); only
// its drawing is the Mac's. The card's own controls (Back, New note, the title, search or Share) float in the card
// (CardControls, below). On the iPad (the owner's Mac UI guide, 2026-11-23) Back, Forward and New note leave the
// strip for the card's own top bar (IPadScreenBar), so each is on screen once.
#if os(macOS) || os(iOS)
#if os(macOS)
import AppKit
#endif
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
        // (A narrow iPad's sidebar floats over the card instead: the strip keeps its compact lead.)
        let hidden = model.sidebarHidden || model.sidebarFloats
        return HStack(spacing: 0) {
            Color.clear.frame(width: MacLook.trafficLightsRoom + windowControlsRoom)
            #if os(iOS)
            // The iPad: the account sits up here, in the corner the Mac keeps for its window buttons (the owner,
            // 2026-11-19: the empty corner looked unfinished), after iPadOS's own window buttons when a resizable
            // window shows them. The sidebar beside the card then starts with its page.
            if MacAccountButton.inBar(model) {
                MacAccountButton(model: model, fills: false) { anchor in
                    guard let window = NSApp.keyWindow else { return }
                    AccountMenuWindow.show(model: model, in: window, anchor: anchor)
                }
                .padding(.leading, MacLook.sidebarInset - MacLook.trafficLightsRoom)
                .layoutPriority(-1)
            }
            #endif
            Spacer(minLength: 0)
            // On a note the sidebar shows the note's tools or the folders, as the web's (its sidebar mode): this
            // switches between them, beside the sidebar's own button (the owner, 2026-11-18).
            if model.route.isNote {
                let tools = model.noteToolsShown
                stripButton(tools ? "folder" : "list.bullet.rectangle", label: tools ? "Show folders" : "Show note tools",
                            help: tools ? "Show Folders in the Sidebar" : "Show Note Tools in the Sidebar") {
                    withAnimation(MacLook.animation(NSWorkspace.shared.accessibilityDisplayShouldReduceMotion)) {
                        // (Hidden, the sidebar comes back with what was asked for.)
                        if hidden { showSidebar(); WebSidebarController.setNoteTools(model, shown: true) }
                        else { WebSidebarController.setNoteTools(model, shown: !tools) }
                    }
                }
                .accessibilityValue(tools ? "Note tools" : "Folders")
            }
            stripButton("sidebar.left", label: hidden ? "Show sidebar" : "Hide sidebar", help: hidden ? "Show Sidebar (⌘\\)" : "Hide Sidebar (⌘\\)") {
                withAnimation(MacLook.animation(NSWorkspace.shared.accessibilityDisplayShouldReduceMotion)) { model.toggleSidebar() }
            }
            .padding(.trailing, 8)
        }
        .frame(width: hidden ? MacLook.trafficLightsRoom + windowControlsRoom + (model.route.isNote ? 76 : 38) : MacLook.sidebarWidth)
        #if os(iOS)
        .background(WindowControlsProbe(room: $windowControlsRoom))
        #endif
    }

    /// Brings the sidebar back: beside the card, or over it on a narrow iPad.
    private func showSidebar() {
        if model.sidebarFloats { model.sidebarOverlayShown = true } else { model.sidebarCollapsed = false }
    }

    /// Back and Forward, the tabs, and the strip's trailing buttons, after its leading part.
    private var tail: some View {
        HStack(spacing: 6) {
            #if os(macOS)
            // Back and Forward stay put, dimmed with nowhere to go (Finder's and Safari's), so the tabs never shift
            // and nothing floats over the page for them. (A view of their own: only they redraw when the history
            // changes, not the whole strip.) On the iPad they are in the card's own bar (IPadScreenBar), once.
            MacHistoryButtons(model: model)
                .padding(.trailing, 2)
            #endif
            // The tabs fill the bar up to the sync status (Safari's rule: every tab the same width).
            tabStrip
                .frame(maxWidth: .infinity, alignment: .leading)
                .layoutPriority(1)
                .padding(.trailing, 2)
            #if os(macOS)
            // New note, the web's top bar's black pill (the owner, 2026-11-19: the one New note on screen, moved
            // from the sidebar), right after the tabs. It opens the note in a new tab, ready to type. (The iPad's is
            // in the card's bar, IPadScreenBar.)
            MacNewNotePill(model: model)
                .padding(.horizontal, 2)
            #endif
            // Whether everything is saved and synced, then the bell (the owner, 2026-11-18).
            MacSyncStatus(model: model) { model.showSync?($0) }
            stripButton("bell", label: "Notifications", help: "Notifications", anchored: true) { model.showNotifications?(bellAnchor) }
        }
    }

    /// A button in the strip: a symbol in a 28 pt capsule (the tabs' shape) with the quiet hover, its tooltip and its
    /// name.
    func stripButton(_ symbol: String, label: String, help: String, anchored: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            MacSymbol(symbol, size: MacLook.iconButtonSymbol)
                .frame(width: MacLook.stripButtonWidth, height: MacLook.iconButton)
                .contentShape(Rectangle())
                .background { if anchored { MenuAnchor { bellAnchor = $0 } } }
        }
        .buttonStyle(QuietHoverStyle(shape: AnyShape(Capsule())))
        .foregroundStyle(MacLook.Colors.secondary)
        .foleviTooltip(help)
        .accessibilityLabel(label)
    }

    // MARK: the tabs

    /// The tabs alone, in a row under the iPad's system toolbar (the owner, 2026-11-24: tabs kept, drawn the way
    /// Safari draws them on iPadOS).
    var tabsBody: some View {
        let place = rowTabsPlace
        return tabStrip
            // iPhone Duo partly closed: nothing in the crease (FoldSpan). The tabs end before the fold, or start past
            // it when there isn't room for them before it.
            .frame(maxWidth: place.width, alignment: .leading)
            .padding(.leading, place.lead)
            .padding(.trailing, 12)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            #if os(iOS)
            .readFold { fold = $0 }
            #endif
            .coordinateSpace(name: Self.space)
    }

    /// Where the tabs row's tabs go: from 12 pt in, across all the room there is; partly folded, before the fold when
    /// 240 pt fit there, otherwise just past it.
    private var rowTabsPlace: (lead: CGFloat, width: CGFloat) {
        #if os(iOS)
        if let fold {
            let before = fold.minX - 12 - FoldSpan.margin
            if before >= 240 { return (12, before) }
            return (fold.maxX + FoldSpan.margin, .infinity)
        }
        #endif
        return (12, .infinity)
    }

    /// Home and Show All Tabs in their round buttons; then the tabs in their track, the only part that scrolls.
    private var tabStrip: some View {
        HStack(spacing: MacLook.barSpacing) {
            HStack(spacing: MacLook.barSpacing) {
                if let home = model.tabs.tabs.first(where: \.isHome) {
                    macTab(home).fixedSize()
                }
                // Every tab at a glance (File > Show All Tabs, ⌘⇧\), right after Home (the owner, 2026-11-18): it
                // stays put however many tabs there are.
                MacOverviewButton(model: model)
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
        }
    }

    /// A tab's inset inside the track, and the track's height round the tabs.
    static let trackInset = MacLook.capsuleInset
    static var trackHeight: CGFloat { MacLook.tabHeight + trackInset * 2 }


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
                    // Every tab the same width, together filling the bar, down to 90 pt before the strip scrolls
                    // (TabStripMath.filling); pinned tabs their icon's width, joined notes as wide as two.
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

    /// One tab: a capsule in the track, its icon and its title, centred; the open one in Liquid Glass. The × (on the
    /// open tab and under the pointer) is always at the tab's leading edge, whatever the tab's width (TabCloseSpot).
    /// Pinned tabs are their icon alone; Home is its icon in a round button before the track. `separator`: a
    /// hairline in the gap before it.
    func macTab(_ t: FrameTab, separator: Bool = false) -> some View {
        // (Read once: FrameTab.route parses the tab's path every time.)
        let route = t.route
        let flower = Self.wearsFlower(route)
        let active = t.id == model.tabs.activeID
        let label = model.tabs.label(t)
        let hovered = hoveredTab == t.id
        let compact = t.isHome || t.pinned
        let closes = !compact && (active || hovered)
        return Group {
            if compact {
                HStack(spacing: 5) {
                    if t.isJoined, let panes = t.panes {
                        ForEach(panes, id: \.self) { _ in MacSymbol("doc.text", size: 11) }
                    } else if flower {
                        AiMarkGlyph(size: 13)
                    } else {
                        WebIconView(Self.icon(for: route), size: 15, strokeWidth: active ? 2.3 : 2)
                    }
                }
            } else if t.isJoined {
                // (Joined notes fill their tab: the × is always over the icon's place.)
                macTabContent(t, route: route, label: label, active: active, flower: flower, icon: !closes)
                    .padding(.horizontal, TabCloseSpot.padding)
            } else {
                // Where the icon and title, centred, stay clear of the ×'s place, the icon stays beside the title
                // and nothing moves when the × shows; in a narrower tab the × shows in the icon's stead.
                ViewThatFits(in: .horizontal) {
                    macTabContent(t, route: route, label: label, active: active, flower: flower, icon: true)
                        .padding(.horizontal, TabCloseSpot.clear)
                    macTabContent(t, route: route, label: label, active: active, flower: flower, icon: !closes)
                        .padding(.horizontal, TabCloseSpot.padding)
                }
            }
        }
        .foregroundStyle(active ? MacLook.Colors.label : MacLook.Colors.secondary)
        // (A tab wider than its title keeps the title in its middle, so the strip's rhythm stays even.)
        // (Home is a circle as tall as the track; every other tab a capsule inside it.)
        .frame(width: compact ? (t.isJoined ? 52 : Self.trackHeight) : nil, height: t.isHome ? Self.trackHeight : MacLook.tabHeight, alignment: .center)
        .frame(maxWidth: compact ? nil : .infinity, alignment: .center)
        // The ×: at the tab's leading edge in every tab, wide or narrow (the owner, 2026-11-19: it sat beside the
        // title, so it moved with the tab's width and the title's length).
        .overlay(alignment: .leading) {
            if !compact { macCloseButton(t, label: label, visible: closes).padding(.leading, TabCloseSpot.leading) }
        }
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
                    .nativeGlass(Capsule())
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

    /// A tab's icon and title (or its joined notes), and its floating badge. `icon` false keeps the icon's room and
    /// hides it: the × is over it.
    private func macTabContent(_ t: FrameTab, route: FrameRoute, label: String, active: Bool, flower: Bool, icon: Bool) -> some View {
        HStack(spacing: 5) {
            ZStack {
                if flower {
                    AiMarkGlyph(size: 12)
                } else {
                    WebIconView(Self.icon(for: route), size: 14)
                }
            }
            .frame(width: TabCloseSpot.icon, height: TabCloseSpot.icon)
            .opacity(icon ? 1 : 0)
            if t.isJoined, let panes = t.panes {
                macJoinedSections(t, panes, active: active)
            } else {
                MacTruncatingText(text: label, font: active ? MacLook.Text.body.weight(.medium) : MacLook.Text.body)
            }
            if !t.isJoined, let id = route.noteId, model.floatingNotes.contains(id) { macFloatingBadge(id, label: label) }
        }
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
                .frame(width: TabCloseSpot.button, height: TabCloseSpot.button)
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

/// Back and Forward in the title bar: a view of its own, so the history changing (every tab switch) redraws only
/// these two buttons, not the whole strip.
struct MacHistoryButtons: View {
    let model: FrameModel

    var body: some View {
        HStack(spacing: 0) {
            MacStripButton(symbol: "chevron.left", label: "Back", help: "Back (⌘[)") { model.goBack() }
                .disabled(!model.canGoBack)
                .opacity(model.canGoBack ? 1 : 0.35)
            MacStripButton(symbol: "chevron.right", label: "Forward", help: "Forward (⌘])") { model.goForward() }
                .disabled(!model.history.canGoForward)
                .opacity(model.history.canGoForward ? 1 : 0.35)
        }
    }
}

/// Show All Tabs, a round button right after Home: a view of its own, so only it watches whether the
/// overview is showing.
struct MacOverviewButton: View {
    let model: FrameModel

    var body: some View {
        let on = model.overviewShown
        Button { model.overviewShown.toggle() } label: {
            MacSymbol("square.grid.2x2", size: 14, weight: .medium)
                .frame(width: WebTopBar.trackHeight, height: WebTopBar.trackHeight)
                .contentShape(Circle())
        }
        // (While the overview shows, its symbol in the label colour on a deeper fill.)
        .buttonStyle(QuietHoverStyle(shape: AnyShape(Circle()), active: !on))
        .background(on ? MacLook.Colors.hover : MacLook.Colors.track, in: Circle())
        .foregroundStyle(on ? MacLook.Colors.label : MacLook.Colors.secondary)
        .foleviTooltip("Show All Tabs (⌘⇧\\)")
        .accessibilityLabel("Show all tabs")
        .accessibilityValue(on ? "Shown" : "Hidden")
    }
}

/// New note, as the web's top bar has it: a capsule with + and its words, black in light mode and white in dark
/// (the web's primary button), in the system's prominent Liquid Glass button.
struct MacNewNotePill: View {
    let model: FrameModel
    /// Its height in the iPad's card bar (a control's, 44 pt); nil: the strip's, inside the tab track's height.
    var height: CGFloat? = nil
    @Environment(\.colorScheme) private var scheme
    /// The pointer's over it (a Mac's, an iPad's trackpad): the pill lightens a touch, as the web's primary does.
    @State private var hover = false

    var body: some View {
        let dark = scheme == .dark
        let button = Button { model.newNote() } label: {
            HStack(spacing: height == nil ? 5 : 6) {
                MacSymbol("plus", size: height == nil ? 13 : 15, weight: .semibold)
                Text("New note").font(height == nil ? .system(size: 13, weight: .semibold) : MacLook.Text.headline)
            }
            .foregroundStyle(dark ? Color.black : Color.white)
            .padding(.horizontal, height == nil ? 14 : 18)
            .frame(height: height ?? WebTopBar.trackHeight - 8)
            .contentShape(Capsule())
        }
        // (A solid black or white under Liquid Glass, not the system's prominent button or a tint alone: those came out
        // grey on the Mac's dark window, the dark words then unreadable on them. The glass gives its edge and its
        // press.)
        let fill = dark ? Color.white : Color.black
        Group {
            if #available(iOS 26, macOS 26, *) {
                button.buttonStyle(.plain).onHover { hover = $0 }
                    .background(fill, in: Capsule())
                    .glassEffect(.regular.tint(fill).interactive(), in: Capsule())
            } else {
                button.buttonStyle(.plain).onHover { hover = $0 }
                    .background(fill, in: Capsule())
            }
        }
        .brightness(hover ? (dark ? -0.08 : 0.18) : 0)
        .fixedSize()
        // (The button says New note: its tooltip is the shortcut alone.)
        .foleviTooltip("(⌘N)")
        .accessibilityLabel("New note")
        .accessibilityIdentifier("strip.newNote")
    }
}

/// A button in the title bar: a symbol in a 32 by 28 capsule with the quiet hover, its tooltip and its name.
struct MacStripButton: View {
    let symbol: String
    let label: String
    let help: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            MacSymbol(symbol, size: MacLook.iconButtonSymbol)
                .frame(width: MacLook.stripButtonWidth, height: MacLook.iconButton)
                .contentShape(Rectangle())
        }
        .buttonStyle(QuietHoverStyle(shape: AnyShape(Capsule())))
        .foregroundStyle(MacLook.Colors.secondary)
        .foleviTooltip(help)
        .accessibilityLabel(label)
    }
}

/// A rectangle inset by its own amounts on each axis (a hit shape smaller than what's drawn).
struct InsetRect: Shape {
    var dx: CGFloat
    var dy: CGFloat
    func path(in rect: CGRect) -> Path { Path(rect.insetBy(dx: dx, dy: dy)) }
}

/// Where a tab's × sits: at the tab's leading edge, its centre where a narrow tab's icon is, so it is in the same
/// place in every tab whatever the tab's width and its title's length (the owner, 2026-11-19).
enum TabCloseSpot {
    /// A tab's room either side of its icon and title.
    static let padding: CGFloat = 10
    /// The icon's place, and the ×'s round button.
    static let icon: CGFloat = 16
    static let button: CGFloat = 18
    /// The button's leading edge from the tab's.
    static var leading: CGFloat { padding + icon / 2 - button / 2 }
    /// The room a tab's centred icon and title keep either side to stay clear of the ×.
    static var clear: CGFloat { leading + button + 4 }
    /// Whether a tab this wide shows its icon beside the × (its icon and title `content` wide, centred), or the × in
    /// the icon's stead.
    static func iconStays(tab: CGFloat, content: CGFloat) -> Bool { content + clear * 2 <= tab }
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
