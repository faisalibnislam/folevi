// The Mac's sidebar in the native look (docs/MAC_NATIVE_LOOK.md; the owner's layout, 2026-11-18): drawn straight on
// the window's translucent material under the title bar strip (no card of its own, no divider), compact rows
// (SidebarRow, SidebarHeading) with quiet monochrome symbols:
//
//   the place and account switcher; New note; Home, Work with Foli AI, Foli DNA (and its saved views), Bookmarks (and
//   the first bookmarked notes), Drafts, All notes, Tasks, Calendar, Reviews, Shared with Me, Vault, Changes,
//   Templates; Folders (the tree, sorting, New folder); Tags; Archive and Trash. No footer (the owner, 2026-11-18):
//   the sync status is in the title bar by the bell, and Settings and Help are the menu bar's (Folevi > Settings,
//   ⌘, and the Help menu).
//
// Every row's behaviour is WebSidebar's (WebSidebar.swift): opening in place or in a tab behind (⌘-click, the middle
// button), the folder tree's drag and drop (notes into a folder, folders above, below or inside one, onto the Folders
// heading for the top level), the rows' menus, the counts. The title bar's button, ⌘\ and View > Hide Sidebar hide
// it (so does Focus mode on a note); the bell is in the title bar, search in the card's controls.
#if os(macOS) || os(iOS)
#if os(macOS)
import AppKit
#endif
import SwiftUI
import FoleviDesign
import FoleviEngine
import FoleviScreens

extension WebSidebar {
    var macBody: some View {
        VStack(alignment: .leading, spacing: 0) {
            // (On an iPad with the sidebar beside the card, the account is up in the title bar's corner instead.)
            if MacAccountButton.inBar(model) {
                Color.clear.frame(height: MacLook.Space.s)
            } else {
                macAccount
                    .padding(.horizontal, MacLook.sidebarInset)
                    .padding(.top, MacLook.sidebarTop)
                    // (New note is the title bar's black pill, as the web's top bar has it: the owner, 2026-11-19, one
                    // New note on screen, not here as well.)
                    .padding(.bottom, MacLook.Space.s)
            }
            if let noteId = model.route.noteId, model.noteToolsShown {
                // On a note, its own tools (WebNoteSidebar: its name and place, its pages, Table of contents, Comments,
                // Tasks, Attachments, Find), as the web's sidebar shows them; the title bar's switch brings the
                // folders back. Format, Style, Insert and Foli AI keep the column at the right (the owner, 2026-11-18).
                WebNoteSidebar(model: model, noteId: noteId)
                    .id(noteId)
                    .padding(.horizontal, MacLook.sidebarInset - 4)
                    .frame(maxHeight: .infinity, alignment: .top)
                    .accessibilityElement(children: .contain)
                    .accessibilityLabel("Note tools")
            } else {
                macList
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Sidebar")
    }

    /// The places, folders and tags.
    private var macList: some View {
            QuietScrollView(.vertical) {
                VStack(alignment: .leading, spacing: 0) {
                    macDestinations
                    macFolders
                    macTags
                    VStack(alignment: .leading, spacing: 0) {
                        macItem(.notes(.archive), symbol: "archivebox", title: "Archive")
                        macItem(.notes(.trash), symbol: "trash", title: "Trash")
                    }
                    .padding(.top, MacLook.sectionGap)
                }
                .padding(.horizontal, MacLook.sidebarInset)
                .padding(.bottom, MacLook.Space.m)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .scrollIndicators(.automatic)
    }

    // MARK: destinations

    private var macDestinations: some View {
        let caps = model.session.value?.capabilities
        let home = model.home.value
        let count = { (id: HomeRow.Id) -> Int? in home?.rows.first { $0.id == id }?.count }
        let starred = home?.starred.rows ?? []
        return VStack(alignment: .leading, spacing: 0) {
            macItem(.home, symbol: "house", title: "Home")
            if caps?.ai ?? false {
                macItem(.web("/ai"), symbol: "sparkles", title: "Work with Foli AI")
            }
            // Foli DNA (/graph), where this place has it, and its saved views under it.
            if caps?.graph ?? false {
                macItem(.web("/graph"), symbol: "point.3.connected.trianglepath.dotted", title: "Foli DNA")
                DnaSidebarViews(model: model, indent: 0) { v in
                    AnyView(macItem(.web("/graph?view=\(v.id)"), symbol: "point.3.connected.trianglepath.dotted", title: v.name, level: 1))
                }
            }
            macItem(.notes(.starred), symbol: "bookmark", title: "Bookmarks")
                .overlay(alignment: .trailing) {
                    if !starred.isEmpty {
                        disclosure(open: starredOpen, label: "bookmarked notes") {
                            withAnimation(MacLook.animation(reduceMotion)) { starredOpen.toggle() }
                        }
                        .padding(.trailing, 4)
                    }
                }
            if starredOpen, !starred.isEmpty {
                ForEach(starred.prefix(Self.limit), id: \.id) { note in
                    macItem(.note(note.id), symbol: "doc.text", title: note.title.isEmpty ? "Untitled" : note.title, level: 1, newTab: true)
                }
                .transition(.opacity)
            }
            macItem(.notes(.unsorted), symbol: "tray", title: "Drafts", count: count(.drafts))
            macItem(.notes(.all), symbol: "doc.on.doc", title: "All notes")
            macItem(.tasks(.today), symbol: "checkmark.square", title: "Tasks", count: tasks.value?.today)
            macItem(.calendar(nil), symbol: "calendar", title: "Calendar")
            // Listed once there's something to study, and while Reviews is open (Sidebar.tsx).
            if (count(.reviews) ?? 0) > 0 || model.route.tabKey == FrameRoute.web("/review").tabKey {
                macItem(.web("/review"), symbol: "rectangle.stack", title: "Reviews", count: count(.reviews))
            }
            if caps?.sharing ?? false {
                // (The web's row icon: share-2.)
                macItem(.shared, title: "Shared with Me") {
                    WebIconView(.share2, size: 17).foregroundStyle(isSelected(.shared) ? MacLook.Colors.label : MacLook.Colors.secondary)
                }
            }
            // The Vault where there's one for this person (vault.summary; a library's own Vault too, plan 5.6).
            VaultSidebarRow(model: model) { macItem(.web("/vault"), symbol: "lock", title: "Vault") }
            if caps?.changes ?? false { macItem(.changes, symbol: "plus.forwardslash.minus", title: "Changes", count: count(.changes)) }
            macItem(.notes(.templates), symbol: "rectangle.3.group", title: "Templates")
        }
    }

    private var reduceMotion: Bool { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }

    /// One row: a symbol, its label, an optional count; the page's own row selected. A folder ⌘-clicked opens in a
    /// tab behind this one (FolderTabClicks).
    func macItem(_ route: FrameRoute, symbol: String, title: String, level: Int = 0, count: Int? = nil, newTab: Bool = false) -> some View {
        macItem(route, title: title, level: level, count: count, newTab: newTab) {
            MacSymbol(symbol, size: MacLook.rowSymbolSize).foregroundStyle(isSelected(route) ? MacLook.Colors.label : MacLook.Colors.secondary)
        }
    }

    func macItem<Icon: View>(_ route: FrameRoute, title: String, level: Int = 0, count: Int? = nil, newTab: Bool = false, @ViewBuilder icon: () -> Icon) -> some View {
        let selected = isSelected(route)
        return Button {
            if case .folder = route, FolderTabClicks.commandHeld { model.openInBackground(route, title: title, fromPage: false) } else { model.open(route, newTab ? .newTab : .replace, fromPage: false) }
        } label: {
            SidebarRow(title, selected: selected, level: level, icon: icon) {
                if let count, count > 0 { Text("\(count)").monospacedDigit() }
            }
        }
        .buttonStyle(SidebarRowButtonStyle())
        .accessibilityLabel(count.map { $0 > 0 ? "\(title), \($0)" : title } ?? title)
    }

    /// A disclosure chevron in a row or a heading: pointing right when closed, turned down when open.
    func disclosure(open: Bool, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            MacSymbol("chevron.right", size: 11, weight: .semibold)
                .rotationEffect(.degrees(open ? 90 : 0))
                .frame(width: 24, height: 24)
                .contentShape(Rectangle())
        }
        .buttonStyle(QuietHoverStyle(shape: AnyShape(RoundedRectangle(cornerRadius: MacLook.rowRadius - 2, style: .continuous))))
        .foregroundStyle(MacLook.Colors.secondary)
        .foleviTooltip(open ? "Hide \(label)" : "Show \(label)")
        .accessibilityLabel(open ? "Hide \(label)" : "Show \(label)")
    }

    // MARK: sections

    /// A section: its heading (the title opens its page; the actions and the chevron that folds it at its end),
    /// then its rows. `takesFolders`: a folder dropped on the heading goes to the top level.
    private func macSection<Actions: View, Rows: View>(_ title: String, route: FrameRoute, open: Binding<Bool>, takesFolders: Bool = false,
                                                       @ViewBuilder actions: () -> Actions, @ViewBuilder rows: () -> Rows) -> some View {
        let here = model.route.tabKey == route.tabKey
        return VStack(alignment: .leading, spacing: 0) {
            SidebarHeading(title, selected: here, action: { model.open(route, .replace, fromPage: false) }) {
                HStack(spacing: 2) {
                    actions()
                    disclosure(open: open.wrappedValue, label: title) {
                        withAnimation(MacLook.animation(reduceMotion)) { open.wrappedValue.toggle() }
                    }
                }
            }
            .background {
                if takesFolders && dropTarget == Self.topLevel {
                    RoundedRectangle(cornerRadius: MacLook.rowRadius, style: .continuous).strokeBorder(MacLook.Colors.accent, lineWidth: 2)
                }
            }
            .dropDestination(for: FolderDragItem.self) { items, _ in
                guard takesFolders, let dragged = items.first else { return false }
                dropFolder(dragged, on: nil, zone: .inside, shown: shownFolders, sort: SidebarFolderSort(rawValue: folderSortRaw) ?? .manual)
                return true
            } isTargeted: { over in
                guard takesFolders else { return }
                dropTarget = over ? Self.topLevel : (dropTarget == Self.topLevel ? nil : dropTarget)
            }
            if open.wrappedValue {
                VStack(alignment: .leading, spacing: 0) { rows() }
                    .transition(.opacity)
            }
        }
    }

    /// A quiet line in a section ("No folders yet"), at the rows' label edge.
    private func note(_ text: String) -> some View {
        Text(text).font(MacLook.Text.small).foregroundStyle(MacLook.Colors.secondary)
            .padding(.leading, MacLook.rowPadding + MacLook.rowIconSlot + MacLook.rowIconGap)
            .frame(minHeight: MacLook.rowPitch, alignment: .leading)
    }

    /// Show more, Show less, "+3 more": a row of secondary text at the rows' label edge.
    private func linkRow(_ text: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(text).font(MacLook.Text.body).foregroundStyle(MacLook.Colors.secondary)
                .padding(.leading, MacLook.rowPadding + MacLook.rowIconSlot + MacLook.rowIconGap)
                .frame(maxWidth: .infinity, minHeight: MacLook.rowHeight, alignment: .leading)
                .contentShape(Rectangle())
        }
        .buttonStyle(SidebarRowButtonStyle(hoverFill: true))
        .padding(.vertical, MacLook.rowGap / 2)
    }

    // MARK: folders

    private var macFolders: some View {
        let sort = SidebarFolderSort(rawValue: folderSortRaw) ?? .manual
        let all = shownFolders
        let roots = all.filter { $0.parentId == nil }
        // The first five top-level folders (and the one you're in); Show more lists them all, here.
        let activeRoot = activeRootId(all)
        let shown = allFoldersShown ? roots : roots.enumerated().filter { $0.offset < Self.limit || $0.element.id == activeRoot }.map(\.element)
        return macSection("Folders", route: .web("/folders"), open: $foldersOpen, takesFolders: true) {
            WebMenuButton(width: 180, entries: {
                [WebMenuEntry.heading("Sort folders")] + SidebarFolderSort.allCases.map { o in
                    WebMenuEntry(.item(o.title, checked: o == sort)) { folderSortRaw = o.rawValue }
                }
            }) {
                MacSymbol("arrow.up.arrow.down", size: 13, weight: .medium)
                    .frame(width: 24, height: 24)
                    .contentShape(Rectangle())
            }
            .foleviTooltip("Sort Folders")
            .accessibilityLabel("Sort folders")
            Button { FrameDialogs.newFolder(model) } label: {
                MacSymbol("folder.badge.plus", size: 13, weight: .medium)
                    .frame(width: 24, height: 24)
                    .contentShape(Rectangle())
            }
            .buttonStyle(QuietHoverStyle(shape: AnyShape(RoundedRectangle(cornerRadius: MacLook.rowRadius - 2, style: .continuous))))
            .foleviTooltip("New Folder (⌃⌘N)")
            .accessibilityLabel("New folder")
        } rows: {
            if roots.isEmpty { note("No folders yet") }
            ForEach(shown, id: \.id) { f in macFolder(f, all: all, sort: sort) }
            if shown.count < roots.count {
                linkRow("Show more") { withAnimation(MacLook.animation(reduceMotion)) { allFoldersShown = true } }
            } else if allFoldersShown && roots.count > Self.limit {
                linkRow("Show less") { withAnimation(MacLook.animation(reduceMotion)) { allFoldersShown = false } }
            }
        }
        .task(id: sort) {
            if sort == .recent, folderChanges == nil { folderChanges = model.client.watch(.foldersCards(all: true)) }
        }
    }

    /// A folder's row and, open, its folders under it: one indent step per level, the disclosure chevron in the
    /// step before its icon, its "…" at the end under the pointer. Drop notes on it to move them in, a folder on its
    /// upper or lower edge to put it beside, in the middle to put it inside.
    private func macFolder(_ f: FolderNode, all: [FolderNode], sort: SidebarFolderSort) -> AnyView {
        let children = all.filter { $0.parentId == f.id }
        let closed = Set(closedFolders.split(separator: ",").map(String.init))
        // The open folder's own ancestors are always open (Sidebar.tsx activePath).
        let open = !closed.contains(f.id) || activePath(all).contains(f.id)
        return AnyView(VStack(alignment: .leading, spacing: 0) {
            HoverReveal { hovered in
                macItem(.folder(f.id), title: f.name, level: f.depth + 1) {
                    // (The web's folder glyph, in the folder's colour.)
                    FolderGlyph(colorId: f.color, size: 15, kind: f.childCount > 0 ? .stack : .notes)
                }
                .onMiddleClick { model.openInBackground(.folder(f.id), title: f.name) }
                .overlay(alignment: .leading) {
                    if !children.isEmpty {
                        disclosure(open: open, label: "folders in \(f.name)") {
                            var next = closed
                            if open { next.insert(f.id) } else { next.remove(f.id) }
                            withAnimation(MacLook.animation(reduceMotion)) { closedFolders = next.sorted().joined(separator: ",") }
                        }
                        .padding(.leading, MacLook.rowPadding + CGFloat(f.depth) * MacLook.rowIndent - 4)
                    }
                }
                .overlay(alignment: .trailing) {
                    RowMoreButton(label: "Folder options for \(f.name)", shown: hovered, size: 24, iconSize: 14) { folderMenu(f) }
                        .padding(.trailing, 4)
                }
            }
            .webContextMenu { folderMenu(f) }
            .overlay {
                if dropTarget == f.id, let zone = dropZone {
                    switch zone {
                    case .inside:
                        RoundedRectangle(cornerRadius: MacLook.rowRadius, style: .continuous).strokeBorder(MacLook.Colors.accent, lineWidth: 2)
                            .allowsHitTesting(false)
                    case .before, .after:
                        Capsule().fill(MacLook.Colors.accent).frame(height: 2)
                            .frame(maxHeight: .infinity, alignment: zone == .before ? .top : .bottom)
                            .padding(.leading, MacLook.rowPadding + CGFloat(f.depth + 1) * MacLook.rowIndent)
                            .allowsHitTesting(false)
                    }
                }
            }
            // (One target for notes and folders: two stacked drop destinations only honour the outer one.)
            .onDrop(of: [.foleviNoteRef, .foleviFolderRef], delegate: FolderDrop(
                folderId: f.id, axis: .vertical, length: canEdit ? MacLook.rowPitch : 0,
                zone: Binding(get: { dropTarget == f.id ? dropZone : nil }, set: { z in
                    if let z {
                        dropTarget = f.id
                        dropZone = z
                    } else if dropTarget == f.id {
                        dropTarget = nil
                        dropZone = nil
                    }
                }),
                spring: spring,
                onSpring: children.isEmpty || open ? nil : { withAnimation(MacLook.animation(reduceMotion)) { closedFolders = closed.subtracting([f.id]).sorted().joined(separator: ",") } },
                onNotes: { items in
                    // (A multi-selection with folders in it: they go inside too.)
                    if items.contains(where: { !$0.folders.isEmpty }) { return model.move(items: items, to: f.id, name: f.name) }
                    let ids = items.flatMap(\.ids)
                    if !ids.isEmpty { model.move(notes: ids, to: f.id) }
                },
                onFolder: { dragged, zone in dropFolder(dragged, on: f.id, zone: zone, shown: all, sort: sort) }
            ))
            .draggable(FolderDragItem(id: f.id, name: f.name, parentId: f.parentId))
            if open {
                ForEach(children, id: \.id) { c in macFolder(c, all: all, sort: sort).transition(.opacity) }
            }
        })
    }

    // MARK: tags

    private var macTags: some View {
        let tags = model.folders.value?.tags ?? model.home.value?.tags ?? []
        return macSection("Tags", route: .web("/tags"), open: $tagsOpen) {
            EmptyView()
        } rows: {
            if tags.isEmpty { note("Tag documents from the inspector") }
            ForEach(Array(tags.prefix(Self.limit)), id: \.id) { t in
                let row = macItem(.tag(t.id), title: t.name) {
                    // (The web's: the hash in the tag's colour.)
                    WebIconView(.hash, size: 16).foregroundStyle(Self.tagColor(t.color))
                }
                if canEdit {
                    HoverReveal { hovered in
                        row.overlay(alignment: .trailing) {
                            RowMoreButton(label: "Tag options for \(t.name)", shown: hovered, size: 24, iconSize: 14) { tagMenu(t) }
                                .padding(.trailing, 4)
                        }
                    }
                    .webContextMenu { tagMenu(t) }
                } else {
                    row
                }
            }
            if tags.count > Self.limit {
                linkRow("\(tags.count - Self.limit) more") { model.open(.web("/tags"), .replace, fromPage: false) }
            }
        }
    }

    // MARK: the place and account switcher, the footer

    /// The place and the account (WorkspaceMenu.tsx): the picture or logo, the place's name, a chevron; it opens the
    /// account menu (places, workspaces, the account).
    private var macAccount: some View {
        MacAccountButton(model: model) { actions.account($0) }
    }
}

/// The account, places and workspaces button: its picture, its name and a chevron, opening the account menu. In the
/// sidebar's top row on the Mac; on an iPad with the sidebar beside the card, in the title bar's leading corner.
struct MacAccountButton: View {
    let model: FrameModel
    /// Whether it fills its row (the sidebar's) or keeps to its words (the title bar's).
    var fills = true
    let action: (NSView?) -> Void
    @State private var anchor: NSView?

    /// The iPad with the sidebar beside the card: the account is in the title bar, not the sidebar.
    /// (Since the iPad's native window, 2026-11-24, the account is the sidebar's on the iPad too.)
    static func inBar(_ model: FrameModel) -> Bool { false }

    var body: some View {
        let name = model.accountName.isEmpty ? "You" : model.accountName
        let foot = WebSidebar.accountFoot(model, name)
        Button { action(anchor) } label: {
            HStack(spacing: MacLook.rowIconGap) {
                WebAvatar(name: foot.markName, url: foot.markUrl, size: 20)
                    .frame(width: MacLook.rowIconSlot)
                Text(foot.title).font(MacLook.Text.headline).foregroundStyle(MacLook.Colors.label).lineLimit(1)
                MacSymbol("chevron.down", size: 10, weight: .semibold).foregroundStyle(MacLook.Colors.secondary)
                if fills { Spacer(minLength: 0) }
            }
            // (The picture sits in the rows' icon column, the name on their labels' edge.)
            .padding(.horizontal, MacLook.rowPadding)
            .frame(height: 36)
            .contentShape(Rectangle())
            .background(MenuAnchor { anchor = $0 })
        }
        .buttonStyle(SidebarRowButtonStyle(hoverFill: true))
        .foleviTooltip(foot.detail.isEmpty ? "Account, places and workspaces" : foot.detail)
        .accessibilityLabel("Account: \(foot.title)\(foot.detail.isEmpty ? "" : ", \(foot.detail)")")
    }
}

#if os(iOS)
/// How much room iPadOS's own window buttons take at the leading edge (a resizable window shows them at its top
/// left; full screen there are none): the safe area adapted to the window's corner, less the plain safe area.
struct WindowControlsProbe: UIViewRepresentable {
    @Binding var room: CGFloat

    func makeUIView(context: Context) -> Probe {
        let v = Probe()
        v.report = { r in if abs(room - r) > 0.5 { room = r } }
        return v
    }
    func updateUIView(_ v: Probe, context: Context) {
        v.report = { r in if abs(room - r) > 0.5 { room = r } }
    }

    final class Probe: UIView {
        var report: ((CGFloat) -> Void)?
        override init(frame: CGRect) {
            super.init(frame: frame)
            isUserInteractionEnabled = false
            backgroundColor = .clear
        }
        @available(*, unavailable) required init?(coder: NSCoder) { fatalError() }
        override func layoutSubviews() { super.layoutSubviews(); measure() }
        override func safeAreaInsetsDidChange() { super.safeAreaInsetsDidChange(); measure() }
        private func measure() {
            guard #available(iOS 26, *) else { return }
            let adapted = directionalEdgeInsets(for: .safeArea(cornerAdaptation: .horizontal)).leading
            let plain = safeAreaInsets.left
            let r = max(0, adapted - plain)
            DispatchQueue.main.async { [weak self] in self?.report?(r) }
        }
    }
}
#endif

/// The sync state in the title bar, before the bell (the owner, 2026-11-18): a cloud with a dot in the state's
/// status colour (green saved, orange while saving or syncing, red for a conflict or an error, quiet offline), as
/// the popover it opens says it.
struct MacSyncStatus: View {
    let model: FrameModel
    let action: (NSView?) -> Void
    @State private var anchor: NSView?

    var body: some View {
        let s = model.sync.value
        let state = s?.indicator ?? .syncing()
        let headline = s?.headline ?? "Connecting…"
        return Button { action(anchor) } label: {
            ZStack(alignment: .bottomTrailing) {
                MacSymbol("icloud", size: MacLook.iconButtonSymbol).foregroundStyle(MacLook.Colors.secondary)
                Circle().fill(SyncPopover.tone(state)).frame(width: 6, height: 6).offset(x: 1, y: 1)
            }
            // (The title bar's buttons' size and hover: 32 by 28, a capsule.)
            .frame(width: MacLook.stripButtonWidth, height: MacLook.iconButton)
            .contentShape(Rectangle())
            .background(MenuAnchor { anchor = $0 })
        }
        .buttonStyle(QuietHoverStyle(shape: AnyShape(Capsule())))
        .foleviTooltip(headline)
        .accessibilityLabel("Sync status: \(headline)")
    }
}

/// A sidebar row's button: SidebarRow draws the hover and the selection itself, so this adds only a press fill (and,
/// for rows without SidebarRow, the hover fill too).
struct SidebarRowButtonStyle: ButtonStyle {
    var hoverFill = false

    func makeBody(configuration: Configuration) -> some View { Face(configuration: configuration, hoverFill: hoverFill) }

    private struct Face: View {
        let configuration: ButtonStyleConfiguration
        let hoverFill: Bool
        @State private var hovered = false

        var body: some View {
            configuration.label
                .background {
                    let shape = RoundedRectangle(cornerRadius: MacLook.rowRadius, style: .continuous)
                    if configuration.isPressed {
                        shape.fill(MacLook.Colors.hover.opacity(0.5))
                    } else if hoverFill && hovered {
                        shape.fill(MacLook.Colors.hover.opacity(0.5))
                    }
                }
                .onHover { hovered = $0 }
        }
    }
}

#endif
