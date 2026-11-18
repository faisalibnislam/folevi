// The Mac's top bar in the native look (docs/MAC_NATIVE_LOOK.md, the owner's window profile): the first thing in the
// content card, its controls 36 pt glass capsules 10 pt apart in one glass container (TopBar):
//
//   [Back | Forward | Show All Tabs]  [Home | tab | tab | tab ...  (the flexible capsule track)]  [New folder | Note
//   tools]  [New note]  [Search]
//
// Folevi's tab model is unchanged (WebTopBar.swift keeps it: pinned, joined and per-place tabs, folder tabs, close,
// middle click, dragging to reorder, sideways scrolling, a picture on hover, the Tab Overview, the tab's menu); only
// its drawing is the Mac's: a capsule track with a capsule selection, the system font, SF Symbols. Typing in the
// search field opens the palette (⌘K) with what was typed; ⌘K and Edit > Search All Notes give it the keyboard.
#if os(macOS)
import AppKit
import SwiftUI
import FoleviDesign
import FoleviEngine
import FoleviScreens

extension WebTopBar {
    /// The selected tab's capsule inside the track: the track's height less its inset on each side.
    static var tabHeight: CGFloat { MacLook.barControlHeight - MacLook.capsuleInset * 2 }

    var macBody: some View {
        TopBar {
            BarGroup {
                barButton("chevron.left", label: "Back", help: "Back (⌘[)", enabled: model.history.canGoBack) { model.goBack() }
                barButton("chevron.right", label: "Forward", help: "Forward (⌘])", enabled: model.history.canGoForward) { model.goForward() }
                barButton("square.grid.2x2", label: "Show all tabs", help: "Show All Tabs (⇧⌘\\)") { model.overviewShown.toggle() }
                    .accessibilityAddTraits(model.overviewShown ? .isSelected : [])
            }
            tabTrack
            if newFolderParent != nil || model.route.isNote {
                BarGroup {
                    if let parent = newFolderParent {
                        barButton("folder.badge.plus", label: parent == nil ? "New folder" : "New folder in this folder", help: "New Folder in This Folder") { newFolder(in: parent) }
                    }
                    if model.route.isNote {
                        let shown = model.noteToolsShown
                        barButton("sidebar.right", label: "Note tools", help: shown ? "Hide Note Tools" : "Show Note Tools") {
                            WebSidebarController.setNoteTools(model, shown: !shown)
                        }
                        .accessibilityValue(shown ? "Shown" : "Hidden")
                    }
                }
            }
            newNoteButton
            BarSearchField(text: $searchText, prompt: "Search", focus: $searchFocused) { openPalette(searchText) }
                .frame(width: barWidth > 0 && barWidth < Self.compactBar ? 170 : 240)
                .help("Search or jump to… (⌘K)")
                .onChange(of: searchText) { _, q in if !q.isEmpty { openPalette(q) } }
                .onChange(of: model.barSearchFocus) { searchFocused = true }
                .onKeyPress(.escape) {
                    guard searchFocused else { return .ignored }
                    searchFocused = false
                    return .handled
                }
        }
        // (A tab's picture is placed from its tab's frame in the bar, and the bar starts at the card's top left.)
        .coordinateSpace(name: Self.space)
        .onGeometryChange(for: CGFloat.self, of: { $0.size.width }) { barWidth = $0 }
        // The bar's empty room moves the window, as the strip above the card does (its controls keep their clicks).
        .background { Color.clear.contentShape(Rectangle()).windowDrag() }
        // A tab or button clicked in an inactive window acts at once (MAC-05).
        .macClickThrough()
    }

    /// Narrower than this (the narrowest windows), the search field and New note give the tabs their room.
    static let compactBar: CGFloat = 720

    /// An icon button in a bar group: a symbol, its tooltip (with the shortcut) and its accessible name.
    func barButton(_ symbol: String, label: String, help: String, enabled: Bool = true, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).imageScale(.medium)
        }
        .buttonStyle(BarButtonStyle())
        .disabled(!enabled)
        .help(help)
        .accessibilityLabel(label)
    }

    /// New note: the window's one prominent action, in Folevi's accent.
    private var newNoteButton: some View {
        let compact = barWidth > 0 && barWidth < Self.compactBar
        return Button { model.newNote() } label: {
            HStack(spacing: 6) {
                Image(systemName: "square.and.pencil")
                if !compact { Text("New note") }
            }
            .font(MacLook.Text.body.weight(.medium))
            // Ink on the accent; in an inactive window the system greys the button, and the label takes the label colour.
            .foregroundStyle(barActive == .inactive ? MacLook.Colors.label : MacLook.Colors.onAccent)
            .padding(.horizontal, compact ? 2 : 6)
            .frame(height: MacLook.barControlHeight - 12)
        }
        .buttonStyle(.glassProminent)
        .buttonBorderShape(.capsule)
        .tint(MacLook.Colors.accent)
        .fixedSize()
        .help("New Note (⌘N)")
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

    // MARK: the tabs' capsule track

    /// Home, pinned; the arrows while the tabs overflow; then the tabs, the only part that scrolls. One glass capsule
    /// the bar's width leaves it, the open tab a capsule inset by `capsuleInset` on every side.
    private var tabTrack: some View {
        HStack(spacing: tabGap) {
            if let home = model.tabs.tabs.first(where: \.isHome) {
                macTab(home).fixedSize()
            }
            if overflow.start || overflow.end {
                HStack(spacing: 0) {
                    scrollChevron("chevron.left", "Scroll tabs left", enabled: overflow.start) { scrollTabs(-1) }
                    scrollChevron("chevron.right", "Scroll tabs right", enabled: overflow.end) { scrollTabs(1) }
                }
            }
            macTabs.layoutPriority(1)
        }
        .padding(.horizontal, MacLook.capsuleInset)
        .frame(minWidth: 120, maxWidth: .infinity, minHeight: MacLook.barControlHeight, maxHeight: MacLook.barControlHeight, alignment: .leading)
        .glassEffect(.regular, in: .capsule)
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

    private func scrollChevron(_ symbol: String, _ label: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: 11, weight: .semibold))
                .frame(width: 20, height: Self.tabHeight)
                .contentShape(Rectangle())
        }
        .buttonStyle(QuietHoverStyle(shape: AnyShape(Capsule())))
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.35)
        .help(label)
        .accessibilityLabel(label)
    }

    private var macTabs: some View {
        TabRow(gap: tabGap, padding: EdgeInsets(top: MacLook.capsuleInset, leading: 0, bottom: MacLook.capsuleInset, trailing: 0), offset: scroller.scroll, report: { measured($0) }) {
            ForEach(model.tabs.tabs.filter { !$0.isHome }) { t in
                macTab(t)
                    // Every tab the same width, open or not (the owner, 2026-10-29); Home and pinned tabs their own,
                    // joined notes as wide as two.
                    .layoutValue(key: TabRoleKey.self, value: t.isHome || t.pinned ? .own : t.isJoined ? .joined : .other)
                    .layoutValue(key: TabActiveKey.self, value: t.id == model.tabs.activeID)
                    .transition(.opacity)
            }
        }
        // A tab opening, closing or moving: the others ease into their new places and widths (macOS's tab bars).
        .animation(MacLook.animation(NSWorkspace.shared.accessibilityDisplayShouldReduceMotion), value: model.tabs.tabs.map(\.id))
        .clipped()
        // Clipping only hides the tabs scrolled out of the list: they'd still take the pointer over Home, the arrows and
        // the bar's buttons. The list takes the pointer only where it shows.
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

    /// One tab in the track: the open one on the track's raised capsule, the others plain with a hover fill.
    func macTab(_ t: FrameTab) -> some View {
        let active = t.id == model.tabs.activeID
        let label = model.tabs.label(t)
        let hovered = hoveredTab == t.id
        return HStack(spacing: t.pinned ? 4 : 6) {
            if t.isHome {
                Image(systemName: "house").font(.system(size: 13, weight: active ? .semibold : .regular))
            } else if t.isJoined, let panes = t.panes {
                macJoinedSections(t, panes, active: active)
            } else {
                HStack(spacing: 6) {
                    // (Foli AI's tabs wear its flower, as the web's: its page and Catch me up.)
                    if Self.wearsFlower(t.route) {
                        AiMarkGlyph(size: 13)
                    } else {
                        Image(systemName: Self.symbol(for: t.route)).font(.system(size: 12))
                    }
                    if !t.pinned { MacTruncatingText(text: label, font: active ? MacLook.Text.body.weight(.semibold) : MacLook.Text.body) }
                }
                .contentShape(Rectangle())
                // The title takes the tab's room up to its pin and × (no spacer: it would get the gap on both sides).
                .frame(maxWidth: .infinity, alignment: t.pinned ? .center : .leading)
            }
            if !t.isJoined, let id = t.route.noteId, model.floatingNotes.contains(id) { macFloatingBadge(id, label: label) }
            if !t.isHome {
                // The pin takes its room only while it shows (under the pointer, or on a pinned tab), so the title has
                // it otherwise; a narrow tab (the strip shrunk it toward its least, MAC-35) keeps the ×'s room only on
                // the open tab or under the pointer.
                let narrow = (tabFrames[t.id]?.width ?? .infinity) < 150
                if hovered || t.pinned { macPinButton(t, label: label, hovered: hovered) }
                if !t.pinned && (!narrow || active || hovered) { macCloseButton(t, label: label, visible: active || hovered) }
            }
        }
        .foregroundStyle(active ? MacLook.Colors.label : MacLook.Colors.secondary)
        .padding(.leading, t.isHome ? 0 : t.pinned ? 8 : 12)
        .padding(.trailing, t.isHome ? 0 : 5)
        .frame(width: t.isHome ? 36 : t.pinned ? (t.isJoined ? 112 : 86) : nil, height: Self.tabHeight)
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
        .help(t.isHome ? "Home" : "")
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
        .help(t.pinned ? "Unpin Tab" : "Pin Tab")
    }

    /// A note floating in its own window (Float note) says so on its tab; clicking brings that window forward.
    private func macFloatingBadge(_ id: String, label: String) -> some View {
        Button { model.floatNote(id) } label: {
            Image(systemName: "macwindow").font(.system(size: 10)).frame(width: 18, height: 18).contentShape(Circle())
        }
        .buttonStyle(QuietHoverStyle(shape: AnyShape(Circle())))
        .foregroundStyle(MacLook.Colors.secondary)
        .accessibilityLabel("Show \(label)'s floating window")
        .help("Floating in Its Own Window")
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
        .accessibilityLabel("Close \(label)")
        .help("Close Tab (⌘W)")
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
            .help(full > shown + 0.5 ? text : "")
    }
}
#endif
