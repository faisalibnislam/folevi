// The Mac's top bar in the native look (docs/MAC_NATIVE_LOOK.md; the HIG's toolbars.md), the first thing in the
// content card, in two rows:
//
//   the toolbar   [Back | Forward]  Title / subtitle  ...............  [New folder]  (New note)  [Search]  [Inspector]
//   the tab bar   [Home | tab | tab | tab ...  (equal widths, then scrolling)]                     (+)  (All Tabs)
//
// The toolbar's controls are 36 pt glass capsules in one glass container (TopBar): back navigation and the view's
// title lead, New note (the window's one prominent action) and the search field trail, and the button that opens the
// note's inspector sits at the trailing edge. The tab bar shows only with two or more tabs open (Home counts), as
// macOS's own tab bars (Safari, Finder): one quiet track, the open tab raised on it, titles centred.
//
// Folevi's tab model is unchanged (WebTopBar.swift keeps it: pinned, joined and per-place tabs, folder tabs, close,
// middle click, dragging to reorder, sideways scrolling, a picture on hover, the Tab Overview, the tab's menu); only
// its drawing is the Mac's. Typing in the search field opens the palette (⌘K) with what was typed; ⌘K and Edit >
// Search All Notes give it the keyboard.
#if os(macOS)
import AppKit
import SwiftUI
import FoleviDesign
import FoleviEngine
import FoleviScreens

extension WebTopBar {
    var macBody: some View {
        VStack(spacing: 0) {
            TopBar { toolbarRow }
            if model.showsTabRow {
                tabRow
                    .padding(.horizontal, MacLook.barPaddingSides)
                    .padding(.bottom, MacLook.tabRowPaddingBottom)
                    .transition(.opacity)
            }
        }
        .frame(maxHeight: .infinity, alignment: .top)
        // (A tab's picture is placed from its tab's frame in the bar, and the bar starts at the card's top left.)
        .coordinateSpace(name: Self.space)
        .onGeometryChange(for: CGFloat.self, of: { $0.size.width }) { barWidth = $0 }
        // The bar's empty room moves the window, as the strip above the card does (its controls keep their clicks).
        .background { Color.clear.contentShape(Rectangle()).windowDrag() }
        // A tab or button clicked in an inactive window acts at once (MAC-05).
        .macClickThrough()
    }

    /// The toolbar: back navigation and the view's title leading; New note, search and the inspector's button
    /// trailing. Narrower, the title gives way first, then the search field down to its least; the buttons stay whole.
    private var toolbarRow: some View {
        Group {
            BarGroup {
                barButton("chevron.left", label: "Back", help: "Back (⌘[)", enabled: model.history.canGoBack) { model.goBack() }
                barButton("chevron.right", label: "Forward", help: "Forward (⌘])", enabled: model.history.canGoForward) { model.goForward() }
            }
            .fixedSize()
            viewTitle
            if let parent = newFolderParent {
                BarGroup {
                    barButton("folder.badge.plus", label: parent == nil ? "New folder" : "New folder in this folder", help: "New Folder in This Folder") { newFolder(in: parent) }
                }
                .fixedSize()
            }
            newNoteButton
            BarSearchField(text: $searchText, prompt: "Search", focus: $searchFocused) { openPalette(searchText) }
                .frame(minWidth: Self.searchMin, idealWidth: Self.searchWidth, maxWidth: Self.searchWidth)
                .layoutPriority(1)
                .foleviTooltip("Search or jump to… (⌘K)")
                .onChange(of: searchText) { _, q in if !q.isEmpty { openPalette(q) } }
                .onChange(of: model.barSearchFocus) { searchFocused = true }
                .onKeyPress(.escape) {
                    guard searchFocused else { return .ignored }
                    searchFocused = false
                    return .handled
                }
            if model.route.isNote {
                let shown = model.noteToolsShown
                BarGroup {
                    barButton("sidebar.right", label: "Note tools", help: shown ? "Hide Note Tools" : "Show Note Tools") {
                        WebSidebarController.setNoteTools(model, shown: !shown)
                    }
                    .accessibilityValue(shown ? "Shown" : "Hidden")
                }
                .fixedSize()
            }
        }
    }

    /// The search field's width, and the least it shrinks to in a narrow window (after the title has given way).
    static let searchWidth: CGFloat = 240
    static let searchMin: CGFloat = 170
    /// The least the title keeps (a note's first words) in the narrowest window.
    static let titleMin: CGFloat = 96

    /// The view's title (13 pt semibold) and what it is under it (11 pt): a note's folder path, a list's count. It
    /// takes the room the controls leave and is cut off first.
    private var viewTitle: some View {
        let t = Self.title(model)
        return VStack(alignment: .leading, spacing: 0) {
            MacTruncatingText(text: t.title, font: MacLook.Text.headline)
                .foregroundStyle(MacLook.Colors.label)
            if let sub = t.subtitle {
                Text(sub).font(MacLook.Text.small).foregroundStyle(MacLook.Colors.secondary).lineLimit(1).truncationMode(.middle)
            }
        }
        .padding(.leading, 4)
        // (It keeps a few words before the search field gives way; the field keeps its least after that.)
        .frame(minWidth: Self.titleMin, maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }

    /// The title and subtitle for what's on screen: a note's name and the folders it's in ("Travel › Japan"), a
    /// folder's name and its count, a view's name (and its count where the frame knows one).
    static func title(_ model: FrameModel) -> (title: String, subtitle: String?) {
        let route = model.route
        if let id = route.noteId {
            let name = model.activeNote.map { $0.title.isEmpty ? "Untitled" : $0.title } ?? model.tabs.label(model.tabs.active)
            let trail = WebNoteSidebar.trail(tools: model.noteTools[id]?.trail, meta: model.activeNote).map(\.label)
            return (name, trail.isEmpty ? nil : trail.joined(separator: " › "))
        }
        let label = model.tabs.label(model.tabs.active)
        switch route {
        case .folder(let id):
            let all = model.folders.value?.folders ?? []
            let f = all.first { $0.id == id }
            var parts: [String] = []
            var p = f?.parentId
            var guardCount = 0
            while let pid = p, let parent = all.first(where: { $0.id == pid }), guardCount < 20 {
                parts.insert(parent.name, at: 0)
                p = parent.parentId
                guardCount += 1
            }
            let count = f?.noteCount.map { $0 == 1 ? "1 note" : "\($0) notes" }
            let sub = [parts.isEmpty ? nil : parts.joined(separator: " › "), count].compactMap { $0 }.joined(separator: " · ")
            return (f?.name ?? label, sub.isEmpty ? nil : sub)
        case .notes(.unsorted):
            let n = model.home.value?.rows.first { $0.id == .drafts }?.count
            return (label, n.map { $0 == 1 ? "1 note" : "\($0) notes" })
        default:
            return (label, nil)
        }
    }

    /// An icon button in a bar group: a symbol, its tooltip (with the shortcut) and its accessible name.
    func barButton(_ symbol: String, label: String, help: String, enabled: Bool = true, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).imageScale(.medium)
        }
        .buttonStyle(BarButtonStyle())
        .disabled(!enabled)
        .foleviTooltip(help)
        .accessibilityLabel(label)
    }

    /// New note: the window's one prominent action, in Folevi's accent.
    private var newNoteButton: some View {
        Button { model.newNote() } label: {
            HStack(spacing: 6) {
                Image(systemName: "square.and.pencil")
                Text("New note")
            }
            .font(MacLook.Text.body.weight(.medium))
            // Ink on the accent; in an inactive window the system greys the button, and the label takes the label colour.
            .foregroundStyle(barActive == .inactive ? MacLook.Colors.label : MacLook.Colors.onAccent)
            .padding(.horizontal, 6)
            .frame(height: MacLook.barControlHeight - 12)
        }
        .buttonStyle(.glassProminent)
        .buttonBorderShape(.capsule)
        .tint(MacLook.Colors.accent)
        .fixedSize()
        .foleviTooltip("New Note (⌘N)")
        .accessibilityLabel("New note")
    }

    /// What was typed into the search field opens the palette with it. The field gives up the keyboard first, so the
    /// keys typed next wait for the palette's own field (EarlyKeys) instead of landing here again.
    func openPalette(_ query: String) {
        searchText = ""
        searchFocused = false
        FrameSheets.window(for: model)?.makeFirstResponder(nil)
        CommandPalette.show(model, query: query)
    }

    // MARK: the tab bar

    /// Home, pinned; the arrows while the tabs overflow; then the tabs, the only part that scrolls, in one quiet track;
    /// New Tab and Show All Tabs at the row's end.
    private var tabRow: some View {
        HStack(spacing: 6) {
            HStack(spacing: tabGap) {
                if let home = model.tabs.tabs.first(where: \.isHome) {
                    macTab(home).fixedSize()
                }
                macTabs
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .layoutPriority(1)
                    // The arrows while the tabs overflow, over the list's trailing end (the list keeps their room
                    // after its last tab, so its width never depends on them).
                    .overlay(alignment: .trailing) {
                        if overflow.start || overflow.end {
                            HStack(spacing: 0) {
                                scrollChevron("chevron.left", "Scroll tabs left", enabled: overflow.start) { scrollTabs(-1) }
                                scrollChevron("chevron.right", "Scroll tabs right", enabled: overflow.end) { scrollTabs(1) }
                            }
                            // (On the track's own look, hiding the tab under them.)
                            .background {
                                ZStack {
                                    Capsule().fill(MacLook.Colors.container)
                                    Capsule().fill(MacLook.Colors.hover.opacity(0.7))
                                }
                            }
                        }
                    }
            }
            .padding(.horizontal, Self.trackInset)
            .frame(maxWidth: .infinity, minHeight: MacLook.tabRowHeight, maxHeight: MacLook.tabRowHeight, alignment: .leading)
            .background(MacLook.Colors.hover.opacity(0.7), in: Capsule())
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
            rowButton("plus", label: "New tab", help: "New Tab (⌘T)") {
                model.open(.home)
                model.barSearchFocus += 1
            }
            rowButton("square.grid.2x2", label: "Show all tabs", help: "Show All Tabs (⇧⌘\\)") { model.overviewShown.toggle() }
                .accessibilityAddTraits(model.overviewShown ? .isSelected : [])
        }
    }

    /// The arrows' room after the last tab while the tabs overflow (two 20 pt chevrons and a little air).
    static let arrowsRoom: CGFloat = 44

    /// The track's inset round its tabs: the open tab's capsule is the track's height less this on each side.
    static var trackInset: CGFloat { (MacLook.tabRowHeight - MacLook.tabHeight) / 2 }

    /// A button at the tab bar's end: a symbol in a circle the track's height, its quiet hover.
    private func rowButton(_ symbol: String, label: String, help: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: 13, weight: .medium))
                .frame(width: MacLook.tabRowHeight, height: MacLook.tabRowHeight)
                .contentShape(Circle())
        }
        .buttonStyle(QuietHoverStyle(shape: AnyShape(Circle())))
        .foregroundStyle(MacLook.Colors.secondary)
        .foleviTooltip(help)
        .accessibilityLabel(label)
    }

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
        TabRow(gap: tabGap, padding: EdgeInsets(top: Self.trackInset, leading: 0, bottom: Self.trackInset, trailing: overflow.start || overflow.end ? Self.arrowsRoom : 0), offset: scroller.scroll, fill: true, report: { m in
            // (Only the measures made at the width the list really has: see TabScroller.shownWidth.)
            if scroller.shownWidth == 0 || abs(m.visible - scroller.shownWidth) < 0.5 { measured(m) }
        }) {
            ForEach(model.tabs.tabs.filter { !$0.isHome }) { t in
                macTab(t)
                    // Every tab the same width, open or not, sharing the row (macOS's tab bars); Home and pinned tabs
                    // their icon's width, joined notes as wide as two.
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

    /// One tab in the tab bar: its title centred, the × at its leading end (on the open tab and under the pointer),
    /// the pin at its trailing end under the pointer. Home and pinned tabs are their icon alone.
    func macTab(_ t: FrameTab) -> some View {
        let active = t.id == model.tabs.activeID
        let label = model.tabs.label(t)
        let hovered = hoveredTab == t.id
        let compact = t.isHome || t.pinned
        return ZStack {
            if compact {
                HStack(spacing: 4) {
                    if t.isJoined, let panes = t.panes {
                        ForEach(panes, id: \.self) { _ in Image(systemName: "doc.text").font(.system(size: 11)) }
                    } else if Self.wearsFlower(t.route) {
                        AiMarkGlyph(size: 13)
                    } else {
                        Image(systemName: Self.symbol(for: t.route)).font(.system(size: 12, weight: active ? .semibold : .regular))
                    }
                }
            } else if t.isJoined, let panes = t.panes {
                macJoinedSections(t, panes, active: active)
                    .padding(.horizontal, 24)
            } else {
                HStack(spacing: 6) {
                    // (Foli AI's tabs wear its flower, as the web's: its page and Catch me up.)
                    if Self.wearsFlower(t.route) {
                        AiMarkGlyph(size: 13)
                    } else {
                        Image(systemName: Self.symbol(for: t.route)).font(.system(size: 11))
                    }
                    MacTruncatingText(text: label, font: active ? MacLook.Text.body.weight(.semibold) : MacLook.Text.body)
                }
                // Centred, clear of the × and the pin on either side while they show (the title has the room
                // otherwise).
                .padding(.horizontal, active || hovered ? 24 : 10)
                .frame(maxWidth: .infinity)
            }
            if !compact {
                HStack(spacing: 0) {
                    macCloseButton(t, label: label, visible: active || hovered)
                    Spacer(minLength: 0)
                    if !t.isJoined, let id = t.route.noteId, model.floatingNotes.contains(id) { macFloatingBadge(id, label: label) }
                    if hovered { macPinButton(t, label: label, hovered: hovered) }
                }
                .padding(.horizontal, 4)
            }
        }
        .foregroundStyle(active ? MacLook.Colors.label : MacLook.Colors.secondary)
        .frame(width: compact ? (t.isJoined ? 56 : 40) : nil, height: MacLook.tabHeight)
        .background {
            if !active && hovered { Capsule().fill(MacLook.Colors.hover.opacity(0.5)) }
        }
        // The open tab's capsule slides here from the tab that had it (one shape, matched across the track).
        .background {
            if active {
                Capsule()
                    .fill(MacLook.Colors.container)
                    .shadow(color: .black.opacity(0.12), radius: 1.5, y: 0.5)
                    .matchedGeometryEffect(id: "open-tab", in: tabPill)
            }
        }
        // The whole tab opens it (its buttons keep their own clicks); the bar's window drag is only outside the tabs.
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
                .onTapGesture { model.open(.note(id)) }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// The pin: shown on hover (filled while pinned, the crossed pin under the pointer to unpin).
    private func macPinButton(_ t: FrameTab, label: String, hovered: Bool) -> some View {
        Button { model.setTabPinned(t.id, !t.pinned) } label: {
            Image(systemName: t.pinned ? (hovered ? "pin.slash" : "pin.fill") : "pin")
                .font(.system(size: 10))
                .frame(width: 18, height: 18)
                .contentShape(Circle())
        }
        .buttonStyle(QuietHoverStyle(shape: AnyShape(Circle())))
        .foregroundStyle(t.pinned ? MacLook.Colors.secondary : MacLook.Colors.tertiary)
        .opacity(t.pinned || hovered ? 1 : 0)
        .accessibilityLabel(t.pinned ? "Unpin \(label)" : "Pin \(label)")
        .foleviTooltip(t.pinned ? "Unpin Tab" : "Pin Tab")
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
