// The Mac sidebar drawn as the web app's (apps/web/src/components/app/Sidebar.tsx, as Folevi for Mac shows it),
// from the live app's computed styles (FoleviDesign WebStyles "frame.sidebar.*", pnpm styles:gen --app):
//
//   the top bar (52 pt: the window buttons' room, sync status, notifications), the "Search or jump to…" well,
//   Home, Work with Foli AI, Starred (with its first starred notes), Drafts, All notes, Tasks, Calendar, Shared
//   with Me, Changes, Templates; Folders (the tree, a New folder button); Tags (closed until opened); Archive and
//   Trash; and the account button at the bottom.
#if os(macOS) || os(iOS)
#if os(macOS)
import AppKit
#else
import UIKit
#endif
import SwiftUI
import FoleviDesign
import FoleviEngine
import FoleviScreens

/// What the sidebar asks its window for (popovers and menus anchored to the button pressed).
public struct WebSidebarActions {
    public var notifications: @MainActor (NSView?) -> Void = { _ in }
    public var account: @MainActor (NSView?) -> Void = { _ in }
    public var sync: @MainActor (NSView?) -> Void = { _ in }
    public init() {}
}

@MainActor
public struct WebSidebar: View {
    @Bindable var model: FrameModel
    let tasks: ValueStore<TaskCounts>
    let actions: WebSidebarActions
    @Environment(\.colorScheme) private var scheme
    #if os(macOS)
    @Environment(\.controlActiveState) private var active
    #else
    private let active = ControlActiveStateShim.key
    #endif
    @AppStorage("folevi.sidebar.starredOpen") private var starredOpen = true
    @AppStorage("folevi.sidebar.section.folders") private var foldersOpen = true
    @AppStorage("folevi.sidebar.section.tags") private var tagsOpen = false
    /// On a note: the note's own tools ("document", the web's default) or the folders (`folevi:doc-sidebar-mode`).
    @AppStorage("folevi.sidebar.docMode") private var docMode = "document"
    /// The folders closed in the sidebar (every folder starts open; lib/app/folders.ts useOpenFolders keeps the
    /// closed ones, `folevi:sidebar-folders-closed`).
    @AppStorage("folevi.sidebar-folders-closed") private var closedFolders = ""
    /// The sidebar's own folder order (Manual, Name or Recent; Sidebar.tsx `folevi:sidebar-folders-sort`).
    @AppStorage("folevi.sidebar.folders-sort") private var folderSortRaw = SidebarFolderSort.manual.rawValue
    /// Every top-level folder listed, after Show more (`folevi:sidebar-folders-all`).
    @AppStorage("folevi.sidebar.folders-all") private var allFoldersShown = false
    /// Each folder's last change, for Recent (watched only while the sidebar is sorted by it).
    @State private var folderChanges: ValueStore<FolderCardsValue>?
    #if os(iOS)
    /// The account row, for the account menu's place on the iPad.
    @State private var accountAnchor: UIView?
    #endif
    /// The folder row a dragged note or folder is over, and where on it (a folder: the line above, inside, the line
    /// below), on the iPad and the Mac alike.
    @State private var dropTarget: String?
    @State private var dropZone: FolderRules.Zone?
    @State private var spring = SpringLoader()
    /// `dropTarget` while a folder is over the Folders heading.
    private static let topLevel = "@top"

    /// The first few starred notes, folders and tags; the rest are a click away on their own pages.
    static let limit = 5

    public init(model: FrameModel, tasks: ValueStore<TaskCounts>, actions: WebSidebarActions) {
        self.model = model
        self.tasks = tasks
        self.actions = actions
    }

    private func style(_ id: String) -> WebComputedStyle { WebStyles.named("frame.sidebar.\(id)").resolve(scheme) }

    public var body: some View {
        let list = style("list")
        VStack(alignment: .leading, spacing: 0) {
            topBar
            search
                .padding(.horizontal, list.padding.left)
                .padding(.top, style("search").y - style("topbar").y - style("topbar").height)
            if let noteId = model.route.noteId, docMode == "document" {
                // The note's own sidebar (DocumentSidebar.tsx), between the search and the account.
                WebNoteSidebar(model: model, noteId: noteId)
                    // (The gap as measured together on the Mac: the note tools aren't measured on the iPad yet, and
                    // their place against the iPad's taller search would come out negative.)
                    .padding(.top, Self.noteToolsGap(scheme))
            } else {
                appList
            }
            account
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    static func noteToolsGap(_ scheme: ColorScheme) -> CGFloat {
        let mac = { (id: String) in (WebStyles.all[id] ?? WebStyles.named(id)).resolve(scheme) }
        return max(0, mac("notetools.card.wrap").y - mac("frame.sidebar.search").y - mac("frame.sidebar.search").height)
    }

    /// The app's places, folders and tags (Sidebar.tsx's list).
    private var appList: some View {
        let list = style("list")
        return ScrollView(.vertical) {
                VStack(alignment: .leading, spacing: 0) {
                    destinations.padding(.top, style("item.active").y - style("list").y)
                    foldersSection
                    tagsSection
                    VStack(alignment: .leading, spacing: 2) {
                        item(.notes(.archive), icon: .archive, title: "Archive")
                        item(.notes(.trash), icon: .trash, title: "Trash")
                    }
                    .padding(.top, 20)
                }
                .padding(.horizontal, list.padding.left)
                .padding(.bottom, list.padding.bottom)
            }
            .scrollIndicators(.never)
    }

    // MARK: the top bar

    private var topBar: some View {
        let bar = style("topbar")
        let local = model.session.value?.mode == .local
        return HStack(spacing: bar.gap) {
            if WebStyles.isPad {
                // The iPad: the wordmark, to Home (the Mac has its window's buttons there).
                Button { model.open(.home, .replace) } label: {
                    WebFoleviLogo(height: 26, color: Folevi.color.heading).padding(4)
                }
                .buttonStyle(.webPlain)
                .accessibilityLabel("Folevi")
            }
            Spacer(minLength: 0)
            SyncDot(model: model)
            if !local {
                WebIconButton(.bell, label: "Notifications") { actions.notifications(nil) }
            }
            SidebarMenuButton(model: model)
        }
        .padding(.horizontal, bar.padding.left)
        .frame(height: bar.height)
        .contentShape(Rectangle())
        .windowDrag()
    }

    // MARK: search

    private var search: some View {
        let s = WebStyles.named("frame.sidebar.search")
        let r = s.resolve(scheme)
        let label = style("search.label")
        return Button { CommandPalette.show(model) } label: {
            HStack(spacing: r.gap) {
                WebIconView(.search, size: style("search.icon").height).foregroundStyle(style("search.icon").color.color)
                Text("Search or jump to…").webText(label.text).lineLimit(1).foregroundStyle(label.color.color)
                Spacer(minLength: 0)
                if HardwareKeyboard.shared.connected { WebKbd("⌘K") }
            }
            .padding(r.padding.edgeInsets)
            .frame(maxWidth: .infinity, minHeight: r.height, maxHeight: r.height)
            .webBox(s)
            .contentShape(Rectangle())
        }
        .buttonStyle(.webPlain)
    }

    // MARK: destinations

    private var destinations: some View {
        let caps = model.session.value?.capabilities
        let home = model.home.value
        let count = { (id: HomeRow.Id) -> Int? in home?.rows.first { $0.id == id }?.count }
        let starred = home?.starred.rows ?? []
        return VStack(alignment: .leading, spacing: 2) {
            item(.home, icon: .house, title: "Home")
            if caps?.ai ?? false { item(.web("/ai"), icon: .wandSparkles, title: "Work with Foli AI", glyph: AnyView(AiMarkGlyph(size: 16))) }
            // Foli DNA (/graph), where this place has it (Sidebar.tsx: after Foli AI).
            if caps?.graph ?? false {
                item(.web("/graph"), icon: .waypoints, title: "Foli DNA")
                // Its saved views, under it (Sidebar.tsx).
                DnaSidebarViews(model: model) { v in AnyView(item(.web("/graph?view=\(v.id)"), icon: .waypoints, iconSize: 15, title: v.name)) }
            }
            ZStack(alignment: .trailing) {
                item(.notes(.starred), icon: .bookmark, title: "Bookmarks")
                if !starred.isEmpty {
                    let t = style("starred.toggle")
                    Button { WebMotion.animate { starredOpen.toggle() } } label: {
                        DisclosureChevron(open: starredOpen)
                            .frame(width: t.width, height: t.height)
                            .foregroundStyle(t.color.color)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.webPlain)
                    .padding(.trailing, 4)
                }
            }
            if starredOpen, !starred.isEmpty {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(starred.prefix(Self.limit), id: \.id) { note in
                        item(.note(note.id), icon: .fileText, iconSize: 15, title: note.title.isEmpty ? "Untitled" : note.title, newTab: true)
                    }
                }
                .padding(.leading, 20)
                .transition(.opacity)
            }
            item(.notes(.unsorted), icon: .inbox, title: "Drafts", count: count(.drafts))
            item(.notes(.all), icon: .files, title: "All notes")
            item(.tasks(.today), icon: .squareCheckBig, title: "Tasks", count: tasks.value?.today)
            item(.calendar(nil), icon: .calendar, title: "Calendar")
            // Listed once there's something to study, and while Reviews is open (Sidebar.tsx).
            if (count(.reviews) ?? 0) > 0 || model.route.tabKey == FrameRoute.web("/review").tabKey { item(.web("/review"), icon: .layers, title: "Reviews", count: count(.reviews)) }
            if caps?.sharing ?? false { item(.shared, icon: .share2, title: "Shared with Me") }
            // The Vault where there's one for this person (vault.summary; a library's own Vault too, plan 5.6).
            VaultSidebarRow(model: model) { item(.web("/vault"), icon: .lock, title: "Vault") }
            if caps?.changes ?? false { item(.changes, icon: .fileDiff, title: "Changes", count: count(.changes)) }
            item(.notes(.templates), icon: .layoutTemplate, title: "Templates")
        }
    }

    /// One row (the web's NavItem): icon, label, an optional count; the page's own row is selected.
    /// `inRow`: the row around it (a folder's or a tag's, with its chevron and "…") draws the hover and selected fills
    /// across all of it (rowFill), so this draws only its press (MAC-31).
    private func item(_ route: FrameRoute, icon: WebIcon, iconSize: CGFloat = 18, title: String, count: Int? = nil, newTab: Bool = false, glyph: AnyView? = nil, inRow: Bool = false) -> some View {
        let selected = isSelected(route)
        let base = WebStyles.named(selected ? "frame.sidebar.item.active" : "frame.sidebar.item")
        let s = base.resolve(scheme)
        let selectedFill = (WebStyles.vars[active == .inactive ? "mac-selected-inactive" : "mac-selected"] ?? FoleviTokens.Chrome.surfaceSunken).resolve(scheme)
        let iconColor = style(selected ? "item.active.icon" : "item.icon").color
        let iconBox = style("item.icon").height
        let countStyle = style("item.count")
        return Button {
            // A folder ⌘-clicked opens in a tab behind this one (FolderTabClicks).
            if case .folder = route, FolderTabClicks.commandHeld { model.openInBackground(route, title: title) } else { model.open(route, newTab ? .newTab : .replace) }
        } label: {
            HStack(spacing: s.gap) {
                Group {
                    // (The iPad's touch rows have 20 pt icons, the Mac's 18: sized from the measured box.)
                    if let glyph { glyph.scaleEffect(iconBox / 18) } else { WebIconView(icon, size: iconSize * iconBox / 18) }
                }
                .frame(width: iconBox, height: iconBox)
                .foregroundStyle(iconColor.color)
                Text(title).webText(s.text).lineLimit(1).foregroundStyle(s.color.color).frame(maxWidth: .infinity, alignment: .leading)
                if let count, count > 0 {
                    Text("\(count)")
                        .webText(countStyle.text)
                        .lineLimit(1)
                        .monospacedDigit()
                        // The open item's count inverts (Sidebar.tsx: `bg-heading text-canvas` when active).
                        .foregroundStyle(selected ? Folevi.color.canvas : countStyle.color.color)
                        .padding(countStyle.padding.edgeInsets)
                        .frame(minWidth: countStyle.width, minHeight: countStyle.height)
                        .background(RoundedRectangle(cornerRadius: countStyle.radius, style: .circular).fill(selected ? Folevi.color.heading : countStyle.background.color))
                }
            }
            .padding(s.padding.edgeInsets)
            .frame(maxWidth: .infinity, minHeight: s.height, maxHeight: s.height)
            .background(RoundedRectangle(cornerRadius: s.radius, style: .circular).fill(selected && !inRow ? selectedFill.color : .clear))
            .contentShape(Rectangle())
        }
        .buttonStyle(WebHoverRowStyle(radius: s.radius, hover: inRow ? nil : WebStyles.vars["mac-hover"], press: WebStyles.vars["mac-press"], selected: selected && !inRow))
    }

    /// The page's own row (a place's every view: Tasks on any of its lists, the Calendar on any day, Foli AI, Settings
    /// and the Vault on any section, as Sidebar.tsx isActive).
    private func isSelected(_ route: FrameRoute) -> Bool {
        model.route == route || (!route.isNote && model.route.tabKey == route.tabKey)
    }

    /// A folder's or a tag's row fill (MAC-31): the selected pill or the hover fill across the whole row, its chevron
    /// and "…" inside it, as the web's row draws them.
    @ViewBuilder
    private func rowFill(selected: Bool, hovered: Bool) -> some View {
        let s = style(selected ? "item.active" : "item")
        if selected {
            let fill = (WebStyles.vars[active == .inactive ? "mac-selected-inactive" : "mac-selected"] ?? FoleviTokens.Chrome.surfaceSunken).resolve(scheme)
            RoundedRectangle(cornerRadius: s.radius, style: .circular).fill(fill.color)
        } else if hovered, let hover = WebStyles.vars["mac-hover"] {
            RoundedRectangle(cornerRadius: s.radius, style: .circular).fill(hover.resolve(scheme).color)
        }
    }

    // MARK: folders

    private var foldersSection: some View {
        let sort = SidebarFolderSort(rawValue: folderSortRaw) ?? .manual
        // The folders in the sidebar's own order (synced with the account; none saved: rank order), then sorted.
        let all = shownFolders
        let roots = all.filter { $0.parentId == nil }
        // The first five top-level folders (and the one you're in); Show more lists them all, here.
        let activeRoot = activeRootId(all)
        let shown = allFoldersShown ? roots : roots.enumerated().filter { $0.offset < Self.limit || $0.element.id == activeRoot }.map(\.element)
        return section("Folders", route: .web("/folders"), open: $foldersOpen, action: AnyView(
            HStack(spacing: 0) {
                WebMenuButton(width: 180, entries: {
                    [WebMenuEntry.heading("Sort folders")] + SidebarFolderSort.allCases.map { o in
                        WebMenuEntry(.item(o.title, checked: o == sort)) { folderSortRaw = o.rawValue }
                    }
                }) {
                    WebIconView(.arrowDownUp, size: 14)
                        .frame(width: 28, height: 28)
                        .foregroundStyle(Folevi.color.inkMuted)
                        .contentShape(Rectangle())
                }
                .foleviTooltip("Sort folders")
                .accessibilityLabel("Sort folders")
                WebIconButton(.folderPlus, label: "New folder") { FrameDialogs.newFolder(model) }
            }
        ), takesFolders: true) {
            if roots.isEmpty {
                Text("No folders yet").webText(.role(.footnote)).foregroundStyle(Folevi.color.inkMuted).padding(.horizontal, 8).padding(.vertical, 4)
            }
            ForEach(shown, id: \.id) { f in
                folder(f, all: all, sort: sort)
            }
            if shown.count < roots.count {
                toggleLink("Show more") { WebMotion.animate { allFoldersShown = true } }
            } else if allFoldersShown && roots.count > Self.limit {
                toggleLink("Show less") { WebMotion.animate { allFoldersShown = false } }
            }
        }
        .task(id: sort) {
            if sort == .recent, folderChanges == nil { folderChanges = model.client.watch(.foldersCards(all: true)) }
        }
    }

    /// The folders as the sidebar lists them: its own order, then sorted by the sort chosen.
    private var shownFolders: [FolderNode] {
        let sort = SidebarFolderSort(rawValue: folderSortRaw) ?? .manual
        var changed: [String: Double] = [:]
        for c in folderChanges?.value?.folders ?? [] { changed[c.id] = c.updatedAt }
        return SidebarFolderSort.sorted(SidebarFolderSort.applying(model.folders.value?.sidebarOrder, to: model.folders.value?.folders ?? []), by: sort, changed: changed)
    }

    /// The top-level folder the open folder is in (or is), kept listed when the rest are folded away.
    private func activeRootId(_ all: [FolderNode]) -> String? {
        guard case .folder(let id) = model.route else { return nil }
        var cur = all.first { $0.id == id }
        var guardCount = 0
        while let c = cur, let pid = c.parentId, guardCount < 50 {
            cur = all.first { $0.id == pid }
            guardCount += 1
        }
        return cur?.id
    }

    private func folder(_ f: FolderNode, all: [FolderNode], sort: SidebarFolderSort) -> AnyView {
        let children = all.filter { $0.parentId == f.id }
        let closed = Set(closedFolders.split(separator: ",").map(String.init))
        // The open folder's own ancestors are always open (Sidebar.tsx activePath).
        let open = !closed.contains(f.id) || activePath(all).contains(f.id)
        let toggle = style("folder.toggle")
        return AnyView(VStack(alignment: .leading, spacing: 2) {
            HoverReveal { hovered in
            HStack(spacing: 0) {
                if children.isEmpty {
                    Color.clear.frame(width: toggle.width, height: 1)
                } else {
                    Button {
                        var next = closed
                        if open { next.insert(f.id) } else { next.remove(f.id) }
                        WebMotion.animate { closedFolders = next.sorted().joined(separator: ",") }
                    } label: {
                        DisclosureChevron(open: open)
                            .frame(width: toggle.width, height: toggle.height)
                            .foregroundStyle(hovered ? Folevi.color.heading : toggle.color.color)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.webPlain)
                }
                item(.folder(f.id), icon: .folder, title: f.name, glyph: AnyView(FolderGlyph(colorId: f.color, size: 18)), inRow: true)
                    .onMiddleClick { model.openInBackground(.folder(f.id), title: f.name) }
                RowMoreButton(label: "Folder options for \(f.name)", shown: hovered) { folderMenu(f) }
            }
            .background(rowFill(selected: isSelected(.folder(f.id)), hovered: hovered))
            }
            .padding(.leading, CGFloat(f.depth) * 14)
            .webContextMenu { folderMenu(f) }
            // Drop notes (one or a selection) on a folder to move them into it; a folder goes on the line above or
            // below it (the sidebar's own order) or inside it, as on the web (lib/app/sidebarFolderSort.ts).
            .overlay {
                if dropTarget == f.id, let zone = dropZone {
                    switch zone {
                    case .inside:
                        RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(Folevi.color.heading, lineWidth: 2)
                    case .before, .after:
                        Capsule().fill(Folevi.color.heading).frame(height: 2)
                            .frame(maxHeight: .infinity, alignment: zone == .before ? .top : .bottom)
                            .padding(.leading, toggle.width)
                            .allowsHitTesting(false)
                    }
                }
            }
            // (One target for notes and folders: two stacked drop destinations only honour the outer one.)
            .onDrop(of: [.foleviNoteRef, .foleviFolderRef], delegate: FolderDrop(
                folderId: f.id, axis: .vertical, length: canEdit ? style("item").height : 0,
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
                onSpring: children.isEmpty || open ? nil : { WebMotion.animate { closedFolders = closed.subtracting([f.id]).sorted().joined(separator: ",") } },
                onNotes: { items in
                    let ids = items.flatMap(\.ids)
                    if !ids.isEmpty { model.move(notes: ids, to: f.id) }
                },
                onFolder: { dragged, zone in dropFolder(dragged, on: f.id, zone: zone, shown: all, sort: sort) }
            ))
            .draggable(FolderDragItem(id: f.id, name: f.name, parentId: f.parentId))
            if open {
                ForEach(children, id: \.id) { c in folder(c, all: all, sort: sort).transition(.opacity) }
            }
        })
    }

    /// A folder dropped on the sidebar's tree (`target` nil: the Folders heading, the top level). Between two rows it
    /// moves in the sidebar's own order (sorted by Name or Recent, the order shown becomes it, and the sort Manual);
    /// onto a folder, or between rows of another level, it really moves there too, last by rank among its new
    /// siblings (SidebarFolderSort.planDrop, the web's Sidebar.tsx). One Undo puts it all back.
    private func dropFolder(_ dragged: FolderDragItem, on target: String?, zone: FolderRules.Zone, shown all: [FolderNode], sort: SidebarFolderSort) {
        guard canEdit else { return }
        let rank = model.folders.value?.folders ?? []
        let order = model.folders.value?.sidebarOrder
        let closed = Set(closedFolders.split(separator: ",").map(String.init))
        let targetOpen = target.map { t in (!closed.contains(t) || activePath(all).contains(t)) && all.contains { $0.parentId == t } } ?? false
        let nest = target == nil || zone == .inside
        switch SidebarFolderSort.resolveDrop(all, dragged: dragged.id, target: target, zone: nest ? .inside : zone, targetOpen: targetOpen) {
        case .refused(let problem):
            if !(problem == .selfTarget && target == dragged.id) { model.toast(FolderRules.message(problem), tone: .error) }
        case .move(let place, let changed):
            guard changed else { return }
            let plan = SidebarFolderSort.planDrop(rank: rank, order: order, shown: all, sort: sort, id: dragged.id, place: place, nest: nest)
            guard plan.move != nil || plan.order != nil else { return }
            let was = FolderRules.place(FolderRules.links(rank), dragged.id)
            let id = dragged.id
            let model = self.model
            if let m = plan.move { model.move(folder: id, into: m.parentId, after: m.afterId) }
            if let next = plan.order { model.perform { _ = try await model.client.command(.folderSetSidebarOrder(ids: next)) } }
            if plan.adopt { folderSortRaw = SidebarFolderSort.manual.rawValue }
            if let parent = place.parentId, closed.contains(parent) {
                WebMotion.animate { closedFolders = closed.subtracting([parent]).sorted().joined(separator: ",") }
            }
            let name = rank.first { $0.id == id }?.name ?? dragged.name
            let whereTo = place.parentId.map { p in rank.first { $0.id == p }?.name ?? "the folder" } ?? "the top level"
            let message = place.parentId == was?.parentId ? "Moved “\(name)”" : "Moved “\(name)” to \(whereTo)"
            let movedBack = plan.move != nil ? was : nil
            let reorder = plan.order != nil
            model.toast(message, actionTitle: "Undo") {
                if let back = movedBack { model.move(folder: id, into: back.parentId, after: back.afterId) }
                if reorder { model.perform { _ = try await model.client.command(.folderSetSidebarOrder(ids: order)) } }
            }
        }
    }

    /// The folder on screen and the folders it's in (Sidebar.tsx folderAncestors), open whatever was closed.
    private func activePath(_ all: [FolderNode]) -> Set<String> {
        guard case .folder(let id) = model.route else { return [] }
        var out: Set<String> = []
        var p = all.first { $0.id == id }?.parentId
        var guardCount = 0
        while let pid = p, guardCount < 50 {
            out.insert(pid)
            p = all.first { $0.id == pid }?.parentId
            guardCount += 1
        }
        return out
    }

    /// A folder's menu (the web's FolderMenu, WebFolderMenu.swift): its "…" button and its right click.
    private func folderMenu(_ f: FolderNode) -> [WebMenuEntry] {
        WebFolderMenu.entries(MenuFolder(f), context: WebFolderMenu.context(model, locks: nil), frame: model)
    }

    // MARK: tags

    private var canEdit: Bool {
        guard let s = model.session.value else { return true }
        return s.spaces.first { $0.id == s.space }?.canEdit ?? true
    }

    /// The web's TagMenu: Edit tag…, the other colours, Delete tag….
    private func tagMenu(_ t: TagRow) -> [WebMenuEntry] {
        var out = [WebMenuEntry(.item("Edit tag…")) { FrameDialogs.editTag(model, id: t.id, name: t.name, color: t.color) }]
        for c in Self.tagColors where c.id != t.color {
            out.append(WebMenuEntry(.item("Color: \(c.label)", swatch: Self.tagColor(c.id), id: "color:\(c.id)")) {
                model.perform { _ = try await model.client.command(.tagUpdate(id: t.id, color: c.id)) }
            })
        }
        out.append(.separator())
        out.append(WebMenuEntry(.item("Delete tag…", danger: true)) { FrameDialogs.deleteTag(model, id: t.id, name: t.name) })
        return out
    }

    /// The tag colours, in the web's order (Sidebar.tsx TAG_COLORS).
    static let tagColors: [(id: String, label: String)] = [("accent", "Cocoa"), ("moss", "Moss"), ("marigold", "Marigold"), ("plum", "Plum"), ("coral", "Coral"), ("muted", "Gray")]

    private var tagsSection: some View {
        let tags = model.folders.value?.tags ?? model.home.value?.tags ?? []
        return section("Tags", route: .web("/tags"), open: $tagsOpen, action: nil) {
            if tags.isEmpty {
                Text("Tag documents from the inspector").webText(.role(.footnote)).foregroundStyle(Folevi.color.inkMuted).padding(.horizontal, 8).padding(.vertical, 4)
            }
            ForEach(Array(tags.prefix(Self.limit)), id: \.id) { t in
                if canEdit {
                    HoverReveal { hovered in
                        HStack(spacing: 0) {
                            item(.tag(t.id), icon: .hash, iconSize: 15, title: t.name, glyph: AnyView(WebIconView(.hash, size: 15).foregroundStyle(Self.tagColor(t.color))), inRow: true)
                            RowMoreButton(label: "Tag options for \(t.name)", shown: hovered) { tagMenu(t) }
                        }
                        .background(rowFill(selected: isSelected(.tag(t.id)), hovered: hovered))
                    }
                    .webContextMenu { tagMenu(t) }
                } else {
                    item(.tag(t.id), icon: .hash, iconSize: 15, title: t.name, glyph: AnyView(WebIconView(.hash, size: 15).foregroundStyle(Self.tagColor(t.color))))
                }
            }
            if tags.count > Self.limit {
                moreLink("+\(tags.count - Self.limit) more", route: .web("/tags"))
            }
        }
    }

    static func tagColor(_ id: String) -> Color {
        switch id {
        case "moss": return Folevi.color.moss
        case "marigold": return Folevi.color.marigold
        case "coral": return Folevi.color.coral
        case "muted": return Folevi.color.inkMuted
        case "plum": return FoleviTokens.Chrome.named["plum"]?.color ?? Folevi.color.accent
        default: return Folevi.color.accent
        }
    }

    /// A section (the web's Section): a chevron, the caps title (a link to its page), an action; then its rows.
    /// `takesFolders`: a folder dropped on the heading goes to the top level (Folders, as on the Mac and the web).
    private func section<Rows: View>(_ title: String, route: FrameRoute, open: Binding<Bool>, action: AnyView?, takesFolders: Bool = false, @ViewBuilder rows: () -> Rows) -> some View {
        let header = style("section.header")
        let chevron = style("section.chevron")
        let titleStyle = style("section.title")
        let here = model.route.tabKey == route.tabKey
        return VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: header.gap) {
                Button { WebMotion.animate { open.wrappedValue.toggle() } } label: {
                    DisclosureChevron(open: open.wrappedValue)
                        .frame(width: chevron.width, height: chevron.height)
                        .foregroundStyle(chevron.color.color)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.webPlain)
                Button { model.open(route, .replace) } label: {
                    Text(title.uppercased())
                        .webText(titleStyle.text)
                        .lineLimit(1)
                        .foregroundStyle(here ? Folevi.color.heading : titleStyle.color.color)
                        .padding(titleStyle.padding.edgeInsets)
                        .frame(maxWidth: .infinity, minHeight: titleStyle.height, alignment: .leading)
                        // Its page open: the glass fill and the heading's ink (Sidebar.tsx's Section, isActive).
                        .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.chip, style: .circular).fill(here ? (WebStyles.vars["glass-hover"]?.resolve(scheme).color ?? .clear) : .clear))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.webPlain)
                if let action { action }
            }
            .padding(header.padding.edgeInsets)
            .frame(height: header.height)
            .background {
                if takesFolders && dropTarget == Self.topLevel {
                    RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(Folevi.color.heading, lineWidth: 2)
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
                VStack(alignment: .leading, spacing: 2) { rows() }
                    .padding(.top, 4)
                    .transition(.opacity)
            }
        }
        .padding(.top, 20)
    }

    /// Show more / Show less under the folders: the list grows or folds in place.
    private func toggleLink(_ text: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(text).webText(.role(.subheadline)).lineLimit(1).foregroundStyle(Folevi.color.inkMuted)
                .padding(.leading, 32).padding(.trailing, 10)
                .frame(maxWidth: .infinity, minHeight: 32, alignment: .leading)
                .contentShape(Rectangle())
        }
        .buttonStyle(WebHoverRowStyle(radius: 6, hover: WebStyles.vars["mac-hover"], press: WebStyles.vars["mac-press"], selected: false))
    }

    private func moreLink(_ text: String, route: FrameRoute) -> some View {
        Button { model.open(route, .replace) } label: {
            Text(text).webText(.role(.subheadline)).lineLimit(1).foregroundStyle(Folevi.color.inkMuted)
                .padding(.leading, 32).padding(.trailing, 10)
                .frame(maxWidth: .infinity, minHeight: 32, alignment: .leading)
                .contentShape(Rectangle())
        }
        .buttonStyle(WebHoverRowStyle(radius: 6, hover: WebStyles.vars["mac-hover"], press: WebStyles.vars["mac-press"], selected: false))
    }

    // MARK: the account

    private var account: some View {
        let bottom = style("bottom")
        let a = style("account")
        let name = model.accountName.isEmpty ? "You" : model.accountName
        let foot = accountFoot(name)
        return Button {
            #if os(macOS)
            actions.account(NSApp.keyWindow?.contentView?.hitTest(NSEvent.mouseLocation(in: NSApp.keyWindow)))
            #else
            actions.account(accountAnchor)
            #endif
        } label: {
            HStack(spacing: a.gap) {
                WebAvatar(name: foot.markName, url: foot.markUrl, size: 28)
                VStack(alignment: .leading, spacing: 0) {
                    Text(foot.title).webText(WebTextStyle.role(.body, weight: 600).leading(17.5)).lineLimit(1).foregroundStyle(Folevi.color.heading)
                    Text(foot.detail).webText(WebTextStyle.role(.footnote).leading(15)).lineLimit(1).foregroundStyle(Folevi.color.inkMuted)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                WebIconView(.chevronsUpDown, size: 14).foregroundStyle(Folevi.color.inkFaint)
            }
            .padding(a.padding.edgeInsets)
            .frame(maxWidth: .infinity, minHeight: a.height, maxHeight: a.height)
            .contentShape(Rectangle())
        }
        .buttonStyle(WebHoverRowStyle(radius: a.radius, hover: WebStyles.vars["mac-hover"], press: WebStyles.vars["mac-press"], selected: false))
        .padding(bottom.padding.edgeInsets)
    }

    /// What the account button shows (WorkspaceMenu.tsx): in a team workspace its logo (or initial), its name and
    /// you under it; in Personal your picture (or initial), you and "Personal"; in the library your picture and "On
    /// your devices". The picture is the profile's signed avatarUrl, so a new photo comes with the next session.
    private func accountFoot(_ name: String) -> (markName: String, markUrl: String?, title: String, detail: String) {
        guard let s = model.session.value else { return (name, nil, name, "") }
        if s.mode == .local { return (name, s.profile.avatarUrl, name, "On your devices") }
        if let space = s.spaces.first(where: { $0.id == s.space }), space.kind == .workspace {
            let places = model.places.value
            let logo = places?.places.first { $0.id == places?.current }?.workspaces.first { $0.id == space.id }?.logoUrl
            return (space.name, logo, space.name, name)
        }
        return (name, s.profile.avatarUrl, name, "Personal")
    }
}

extension WebTextStyle {
    /// The same style with another line height (`leading-tight` and the like).
    func leading(_ l: CGFloat) -> WebTextStyle {
        var s = self
        s.leading = l
        return s
    }
}

/// The Mac sidebar's hover and press fills (`--mac-hover`, `--mac-press`), as the web's rows have.
struct WebHoverRowStyle: ButtonStyle {
    let radius: CGFloat
    let hover: ColorPair?
    let press: ColorPair?
    let selected: Bool

    func makeBody(configuration: Configuration) -> some View {
        // The Mac: the press fill alone (pressed rows darken, never scale: MAC-07); a touch dips as well.
        #if os(macOS)
        HoverFill(label: configuration.label, pressed: configuration.isPressed, radius: radius, hover: hover, press: press, selected: selected)
        #else
        HoverFill(label: configuration.label, pressed: configuration.isPressed, radius: radius, hover: hover, press: press, selected: selected)
            .pressDip(configuration.isPressed, scale: 0.97)
        #endif
    }

    struct HoverFill<L: View>: View {
        let label: L
        let pressed: Bool
        let radius: CGFloat
        let hover: ColorPair?
        let press: ColorPair?
        let selected: Bool
        @State private var over = false
        @Environment(\.colorScheme) private var scheme

        var body: some View {
            label
                .background {
                    if pressed, let press {
                        RoundedRectangle(cornerRadius: radius, style: .circular).fill(press.resolve(scheme).color)
                    } else if over, !selected, let hover {
                        RoundedRectangle(cornerRadius: radius, style: .circular).fill(hover.resolve(scheme).color)
                    }
                }
                .onHover { over = $0 }
        }
    }
}

/// The sync state at the sidebar's top: a cloud with a coloured dot (the web's SyncStatus).
/// The sidebar's own menu (SidebarMenu.tsx): hide or show it, focus mode, and on a note whether the sidebar shows
/// the folders or the note's tools. In the sidebar, or in the tab strip while the sidebar is hidden.
struct SidebarMenuButton: View {
    let model: FrameModel
    @AppStorage("folevi.sidebar.docMode", store: WebSidebarController.defaults) private var docMode = "document"

    var body: some View {
        WebMenuButton(align: .start, entries: { entries }) {
            WebIconView(.panelLeft, size: 16)
                .frame(width: 32, height: 32)
                .foregroundStyle(Folevi.color.inkMuted)
                .contentShape(Rectangle())
        }
        .foleviTooltip("Sidebar")
        .accessibilityLabel("Sidebar")
    }

    private var entries: [WebMenuEntry] {
        // (The web's focusMode: the sidebar hidden and the note's inspector closed.)
        let focus = model.sidebarCollapsed && model.editorPanel == nil
        var out: [WebMenuEntry] = [
            WebMenuEntry(.item(model.sidebarCollapsed ? "Show sidebar" : "Hide sidebar", icon: .panelLeft, shortcut: "⌘\\")) { model.sidebarCollapsed.toggle() },
            focus
                ? WebMenuEntry(.item("Exit focus mode", icon: .minimize2)) { model.sidebarCollapsed = false }
                : WebMenuEntry(.item("Focus mode", icon: .maximize2)) {
                    model.sidebarCollapsed = true
                    if model.editorPanel != nil { model.editor(.panelClose) }
                },
        ]
        if model.route.isNote {
            out += [
                .separator(),
                WebMenuEntry(.item("Show folders", checked: docMode == "folders")) { docMode = "folders"; model.sidebarCollapsed = false },
                WebMenuEntry(.item("Show document", checked: docMode == "document")) { docMode = "document"; model.sidebarCollapsed = false },
            ]
        }
        return out
    }
}

/// The narrow iPad's sidebar button: the sidebar slides over the content, or goes again.
struct SidebarToggleButton: View {
    let model: FrameModel

    var body: some View {
        Button { model.toggleSidebar() } label: {
            WebIconView(.panelLeft, size: 18)
                .frame(width: 40, height: 40)
                .foregroundStyle(Folevi.color.inkMuted)
                .contentShape(Rectangle())
        }
        .buttonStyle(.webPlain)
        .accessibilityLabel(model.sidebarOverlayShown ? "Hide sidebar" : "Show sidebar")
    }
}

struct SyncDot: View {
    let model: FrameModel

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            WebIconView(.cloud, size: 16).foregroundStyle(Folevi.color.inkMuted)
            Circle().fill(Folevi.color.success).frame(width: 6, height: 6).offset(x: 1, y: 1)
        }
        .frame(width: 28, height: 28)
        .foleviTooltip("Saved")
    }
}

#if os(macOS)
extension NSEvent {
    /// The mouse location in a window's content view coordinates (for anchoring a popover to what was clicked).
    @MainActor static func mouseLocation(in window: NSWindow?) -> NSPoint {
        guard let window, let content = window.contentView else { return .zero }
        return content.convert(window.mouseLocationOutsideOfEventStream, from: nil)
    }
}
#endif

#endif

#if os(macOS) || os(iOS)
/// A disclosure triangle's chevron: pointing right when closed, turned down when open, turning between them as
/// an outline's does on macOS.
struct DisclosureChevron: View {
    let open: Bool

    var body: some View {
        WebIconView(.chevronRight, size: 12)
            .rotationEffect(.degrees(open ? 90 : 0))
    }
}
/// Foli DNA's saved views in the sidebar, under Foli DNA (the `graph.views` view, small: it doesn't load the map).
private struct DnaSidebarViews: View {
    @State private var store: ValueStore<GraphViewsValue>
    let row: (GraphSavedView) -> AnyView

    init(model: FrameModel, row: @escaping (GraphSavedView) -> AnyView) {
        _store = State(initialValue: model.client.watch(.graphViews()))
        self.row = row
    }

    var body: some View {
        let views = store.value?.views ?? []
        if !views.isEmpty {
            VStack(alignment: .leading, spacing: 2) {
                ForEach(views.prefix(WebSidebar.limit), id: \.id) { v in row(v) }
            }
            .padding(.leading, 20)
        }
    }
}

#endif
