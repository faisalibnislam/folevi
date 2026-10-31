// Home and every note list drawn as the web app's (views/HomeDashboard.tsx, DocumentBrowser.tsx,
// OrganizeIndex.tsx, SelectionBar.tsx, ai/CatchUp.tsx, ai/AskAiChat.tsx's launcher), from the live app's computed
// styles (WebStyles "notes.*", app-styles/notes.json). The data is the shared screens' models (FoleviScreens
// HomeModel, NotesListModel); menus are Folevi's own (WebMenus), never the system's.
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

@MainActor
private func notesStyle(_ id: String, _ scheme: ColorScheme) -> WebComputedStyle { WebStyles.named("notes.\(id)").resolve(scheme) }

private func webVar(_ name: String, _ scheme: ColorScheme) -> RGBA { WebStyles.vars[name]?.resolve(scheme) ?? RGBA(0, 0, 0, 0) }

// MARK: shared pieces

/// A note in a grid or a carousel: the card, its "…" menu on hover (and focus), its right-click menu, a click to
/// open it, ⌘-click and ⇧-click to select, a drag that carries it (or the whole selection) to a folder.
struct WebNoteCell: View {
    let card: NoteCardModel
    let drag: NoteDragItem
    let selected: Bool
    let compact: Bool
    let unsynced: Bool
    let menu: @MainActor () -> [WebMenuEntry]
    let open: @MainActor () -> Void
    var select: (@MainActor (_ range: Bool) -> Void)?
    var useTemplate: (@MainActor () -> Void)?
    @State private var hovered = false
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Group {
                if compact {
                    WebCompactNoteCard(card, hovered: hovered)
                } else {
                    WebNoteCard(card, unsynced: unsynced, hovered: hovered)
                }
            }
            .offset(y: hovered ? -2 : 0)
            .animation(.timingCurve(0.2, 0.8, 0.2, 1, duration: 0.2), value: hovered)
            .contentShape(Rectangle())
            .onTapGesture {
                let flags = NSEvent.modifierFlags
                if let select, flags.contains(.command) { select(false) } else if let select, flags.contains(.shift) { select(true) } else { open() }
            }
            .draggable(drag)
            if hovered {
                GeometryReader { geo in
                    HStack(spacing: 4) {
                        if let useTemplate { WebButton("Use", icon: .filePlusCorner, variant: .secondary, size: .sm, action: useTemplate) }
                        cardMenu
                    }
                    .padding(.top, 8)
                    .padding(.trailing, card.starred && !compact ? geo.size.width * 0.12 + 8 : 8)
                    .frame(maxWidth: .infinity, alignment: .topTrailing)
                }
            }
            if selected {
                RoundedRectangle(cornerRadius: FoleviTokens.Radius.chip + 4, style: .circular)
                    .strokeBorder(webVar("color-heading", scheme).color, lineWidth: 2)
                    .padding(-6)
                    .allowsHitTesting(false)
                ZStack {
                    Circle().fill(Color.clear)
                    RoundedRectangle(cornerRadius: FoleviTokens.Radius.chip, style: .circular).fill(webVar("color-heading", scheme).color)
                        .shadow(color: .black.opacity(0.2), radius: 3, y: 2)
                    WebIconView(.check, size: 14, strokeWidth: 3).foregroundStyle(webVar("color-canvas", scheme).color)
                }
                .frame(width: 24, height: 24)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .offset(x: -8, y: -8)
                .allowsHitTesting(false)
            }
        }
        .aspectRatio(compact ? nil : WebNoteCard.aspect, contentMode: .fit)
        .onHover { hovered = $0 }
        .webContextMenu(menu)
    }

    private var cardMenu: some View {
        let raised = WebStyles.named("notes.card.menu")
        let r = raised.resolve(scheme)
        let button = notesStyle("card.menu.button", scheme)
        return WebMenuButton(width: 200, entries: menu) {
            WebIconView(.ellipsis, size: 16)
                .foregroundStyle(button.color.color)
                .frame(width: r.width, height: r.height)
                .webBox(raised)
        }
        .foleviTooltip("Actions for \(card.title.isEmpty ? "Untitled" : card.title)")
    }
}

/// A folder card with its link, hover lift, the "…" menu over the cover on hover, a right-click menu and notes
/// dropped on it moving inside.
struct WebFolderCell: View {
    let card: FolderCardModel
    var labelScale: CGFloat = 1
    let menu: @MainActor () -> [WebMenuEntry]
    let open: @MainActor () -> Void
    let drop: @MainActor ([NoteDragItem]) -> Void
    @State private var hovered = false
    @State private var targeted = false
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        ZStack {
            if targeted {
                RoundedRectangle(cornerRadius: FoleviTokens.Radius.panel, style: .circular)
                    .fill(webVar("glass-active", scheme).color)
                    .overlay(RoundedRectangle(cornerRadius: FoleviTokens.Radius.panel, style: .circular).strokeBorder(webVar("color-heading", scheme).color, lineWidth: 2))
                    .padding(-8)
            }
            WebFolderCard(card, labelScale: labelScale, hovered: hovered)
                .contentShape(Rectangle())
                .onTapGesture { open() }
                .draggable(FolderDragItem(id: card.id, name: card.name, parentId: nil))
            GeometryReader { geo in
                let m = WebStyles.named("notes.folder.menu")
                let ms = m.resolve(scheme)
                let b = notesStyle("folder.menu.button", scheme)
                WebMenuButton(width: 240, entries: menu) {
                    WebIconView(.ellipsis, size: 16)
                        .foregroundStyle(b.color.color)
                        .frame(width: ms.width, height: ms.height)
                        .background(RoundedRectangle(cornerRadius: ms.radius, style: .circular).fill(ms.background.color))
                        .shadow(color: .black.opacity(0.18), radius: 1.5, y: 1)
                }
                .foleviTooltip("Folder options for \(card.name)")
                .position(x: geo.size.width / 2, y: geo.size.height * 0.7 + (hovered ? -4 : 0))
                .opacity(hovered ? 1 : 0)
            }
        }
        .aspectRatio(WebFolderCard.aspect, contentMode: .fit)
        .onHover { hovered = $0 }
        .webContextMenu(menu)
        .dropDestination(for: NoteDragItem.self) { items, _ in
            drop(items)
            return true
        } isTargeted: { targeted = $0 }
    }
}

/// The folder menu's rows (the web's FolderMenu) as Folevi menu entries.
@MainActor
func folderMenuEntries(_ folder: MenuFolder, context: FolderMenuContext, actions: NoteActions, dialogs: FolderDialogState, navigator: ScreenNavigator, feedback: ScreenFeedback, frame: FrameModel) -> [WebMenuEntry] {
    var out: [WebMenuEntry] = [WebMenuEntry(.item("Open in new tab", icon: .externalLink)) { frame.open(.folder(folder.id), .newTab) }, .separator(100)]
    for (n, group) in FolderMenuItem.groups(for: folder, in: context).enumerated() {
        if n > 0 { out.append(.separator(n)) }
        for item in group where item != .color && item != .lock {
            let icon: WebIcon = switch item {
            case .newNote: .filePlusCorner
            case .newFolderInside: .folderPlus
            case .rename: .pencil
            case .color: .palette
            case .move: .folderInput
            case .movePlaces: .arrowLeftRight
            case .moveToTop: .folderUp
            case .askAI: .sparkles
            case .lock: .lock
            case .copyLink: .link
            case .invite: .userPlus
            case .delete: .trash
            }
            out.append(WebMenuEntry(.item(item.title, icon: icon, danger: item == .delete)) {
                FolderMenuItems.perform(item, folder: folder, context: context, actions: actions, dialogs: dialogs, navigator: navigator, feedback: feedback)
            })
        }
    }
    return out
}

/// A note's actions (the web's DocMenu, desktop order): shared by its "…" button and its right-click menu.
@MainActor
func noteMenuEntries(_ row: NoteRow, list: NotesListModel, frame: FrameModel, recent: Bool = false, canSelect: Bool = true) -> [WebMenuEntry] {
    let run: (NotesListModel.RowAction) -> Void = { a in Task { await list.run(a, on: row) } }
    let selected = list.selection.contains(row.id)
    if list.isTrash {
        var out = [WebMenuEntry(.item("Restore", icon: .undo2)) { run(.restore) }]
        if canSelect { out.append(WebMenuEntry(.item(selected ? "Deselect" : "Select", icon: .squareCheck)) { list.toggle(row.id) }) }
        out.append(.separator())
        out.append(WebMenuEntry(.item("Delete permanently…", icon: .trash, danger: true)) { run(.deleteForever) })
        return out
    }
    let template = row.kind == "template"
    var out: [WebMenuEntry] = []
    if template {
        out.append(WebMenuEntry(.item("New page from template", icon: .filePlusCorner)) {
            Task { if let id = await list.actions.create(folderId: nil, templateId: row.id, title: row.title) { frame.open(.note(id)) } }
        })
    }
    out.append(WebMenuEntry(.item(template ? "Edit template" : "Open", icon: .externalLink)) { frame.open(.note(row.id)) })
    out.append(WebMenuEntry(.item("Open in new tab", icon: .externalLink, id: "newtab")) { frame.open(.note(row.id), .newTab) })
    let starred = list.isStarred(row)
    out.append(WebMenuEntry(.item(starred ? "Unstar" : "Star", icon: starred ? .starOff : .star)) { run(starred ? .unstar : .star) })
    out.append(WebMenuEntry(.item("Duplicate", icon: .copy)) { run(.duplicate) })
    if !template { out.append(WebMenuEntry(.item("Move to folder…", icon: .folderInput)) { run(.move) }) }
    if !list.copyTargets.isEmpty { out.append(WebMenuEntry(.item("Copy to…", icon: .copyPlus)) { run(.copyTo) }) }
    out.append(WebMenuEntry(.item(row.archived ? "Unarchive" : "Archive", icon: row.archived ? .archiveRestore : .archive)) { run(row.archived ? .unarchive : .archive) })
    if recent { out.append(WebMenuEntry(.item("Remove from recent", icon: .eyeOff)) { Task { await list.actions.removeFromRecent([row.id]) } }) }
    if canSelect && list.selectable { out.append(WebMenuEntry(.item(selected ? "Deselect" : "Select", icon: .squareCheck)) { list.toggle(row.id) }) }
    if list.canArrange {
        out.append(.separator(1))
        out.append(WebMenuEntry(.item("Move up", icon: .arrowUp)) { run(.moveUp) })
        out.append(WebMenuEntry(.item("Move down", icon: .arrowDown)) { run(.moveDown) })
    }
    out.append(.separator(2))
    out.append(WebMenuEntry(.item("Move to Trash", icon: .trash, danger: true)) { run(.trash) })
    return out
}

/// The floating "Ask Foli AI" button (ai/AskAiChat.tsx AskAiLauncher), bottom right of the content card.
struct WebAskFoliPill: View {
    let action: @MainActor () -> Void
    @State private var hovered = false
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let style = WebStyles.named("notes.ask")
        let s = style.resolve(scheme)
        Button(action: action) {
            HStack(spacing: s.gap) {
                WebAiMark(size: 17)
                Text("Ask Foli AI").webText(notesStyle("ask.label", scheme).text).lineLimit(1)
            }
            .foregroundStyle(s.color.color)
            .padding(s.padding.edgeInsets)
            .frame(height: s.height)
            .background(RoundedRectangle(cornerRadius: s.radius, style: .circular).fill(hovered ? RGBA(28, 28, 31).color : s.background.color))
            .webBox(WebStylePair(light: Self.shadowOnly(style.light), dark: Self.shadowOnly(style.dark)))
            .offset(y: hovered ? -2 : 0)
            .animation(.easeOut(duration: 0.2), value: hovered)
        }
        .buttonStyle(.plain)
        .onHover { hovered = $0 }
        .accessibilityLabel("Ask Foli AI")
    }

    static func shadowOnly(_ s: WebComputedStyle) -> WebComputedStyle {
        var c = s
        c.background = RGBA(0, 0, 0, 0)
        return c
    }

    /// Where it sits: 28 pt in from the content card's bottom right corner.
    static let inset: CGFloat = 28

    /// The screens this area draws it on (Home, the note lists, Folders and Tags).
    static func shows(on route: FrameRoute) -> Bool {
        switch route {
        case .home, .notes, .folder, .tag: return true
        case .web(let p): return p == "/folders" || p == "/tags"
        default: return false
        }
    }
}

/// The web's `.ui-seg` layout switch (one icon per choice).
struct WebSegmented<T: Hashable>: View {
    let options: [(T, WebIcon, String)]
    @Binding var value: T
    let prefix: String
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let seg = WebStyles.named("notes.\(prefix).seg")
        let s = seg.resolve(scheme)
        HStack(spacing: s.gap) {
            ForEach(options, id: \.0) { option in
                let on = option.0 == value
                let b = WebStyles.named("notes.\(prefix).seg.\(on ? "on" : "off")")
                let bs = b.resolve(scheme)
                Button { value = option.0 } label: {
                    WebIconView(option.1, size: 15)
                        .foregroundStyle(bs.color.color)
                        .frame(width: bs.width, height: bs.height)
                        .webBox(b)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .foleviTooltip(option.2)
                .accessibilityLabel(option.2)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .padding(s.padding.edgeInsets)
        .frame(height: s.height)
        .webBox(seg)
    }
}

/// "Sort [Last edited ⌄]": the web's Select, opening a Folevi menu with the choice checked.
struct WebSortSelect<T: Hashable>: View {
    let options: [(T, String)]
    @Binding var value: T
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let sort = notesStyle("toolbar.sort", scheme)
        let label = notesStyle("toolbar.sort.label", scheme)
        let select = notesStyle("toolbar.select", scheme)
        HStack(spacing: sort.gap) {
            Text("Sort").webText(label.text).lineLimit(1).foregroundStyle(label.color.color)
            WebMenuButton(width: max(160, select.width), entries: {
                options.map { o in WebMenuEntry(.item(o.1, checked: o.0 == value)) { value = o.0 } }
            }) {
                trigger(options.first { $0.0 == value }?.1 ?? "")
            }
        }
    }
}

extension WebSortSelect {
    /// The Select trigger at its content's width (label, 6 pt, chevron), as `.ui-input` draws it.
    func trigger(_ label: String) -> some View {
        let style = WebStyles.named("notes.toolbar.select")
        let s = style.resolve(scheme)
        let chevron = WebStyles.named("select.trigger.chevron").resolve(scheme)
        return HStack(spacing: s.gap) {
            Text(label).webText(notesStyle("toolbar.select.label", scheme).text).lineLimit(1)
            WebIconView(.chevronDown, size: 14).opacity(chevron.opacity)
        }
        .padding(s.padding.edgeInsets)
        .frame(height: s.height)
        .foregroundStyle(s.color.color)
        .webBox(style)
        .fixedSize()
    }
}

/// The floating bar while notes are selected (SelectionBar.tsx).
struct WebSelectionBar: View {
    let model: NotesListModel
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let count = model.selection.count
        let total = model.slots.count
        HStack(spacing: 2) {
            Text("\(count.formatted()) selected").webText(.role(.subheadline, weight: 600)).lineLimit(1).foregroundStyle(webVar("color-heading", scheme).color).padding(.horizontal, 10)
            if count < total {
                barButton("Select all", icon: nil, muted: true) { model.selection = Set(model.slots.compactMap(\.row?.id)) }
            }
            divider
            ForEach(model.bulkActions) { a in
                barButton(title(a), icon: icon(a), danger: a.destructive) { Task { await model.runBulk(a) } }
            }
            divider
            barButton(nil, icon: .x, muted: true) { model.selection.removeAll() }
                .foleviTooltip("Clear selection (Esc)")
        }
        .padding(6)
        .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.panel, style: .circular).fill(WebStyles.named("menu.panel").resolve(scheme).background.color))
        .webBox(WebStyles.named("menu.panel"))
    }

    private var divider: some View {
        Rectangle().fill(webVar("color-line", scheme).color).frame(width: 1, height: 24).padding(.horizontal, 4)
    }

    private func title(_ a: BulkAction) -> String {
        switch a {
        case .move: "Move to folder…"
        case .copy: "Copy to…"
        case .trash: "Move to Trash"
        case .deleteForever: "Delete permanently…"
        default: a.title
        }
    }

    private func icon(_ a: BulkAction) -> WebIcon {
        switch a {
        case .move: .folderInput
        case .copy: .copyPlus
        case .star: .star
        case .unstar: .starOff
        case .archive: .archive
        case .unarchive: .archiveRestore
        case .trash, .deleteForever: .trash
        case .restore: .undo2
        }
    }

    private func barButton(_ title: String?, icon: WebIcon?, muted: Bool = false, danger: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let icon { WebIconView(icon, size: 15) }
                if let title { Text(title).webText(.role(.subheadline, weight: 500)).lineLimit(1) }
            }
            .foregroundStyle((danger ? webVar("color-danger", scheme) : muted ? webVar("color-ink-muted", scheme) : webVar("color-ink", scheme)).color)
            .padding(.horizontal, title == nil ? 0 : 10)
            .frame(minWidth: 36, minHeight: 36)
            .contentShape(Rectangle())
        }
        .buttonStyle(WebHoverRowStyle(radius: FoleviTokens.Radius.chip, hover: danger ? WebStyles.vars["color-danger-soft"] : WebStyles.vars["color-accent-soft"], press: nil, selected: false))
    }
}

// MARK: Home

struct WebHomeScreen: View {
    let frame: FrameModel
    let home: HomeModel
    let list: NotesListModel
    let allFolders: ValueStore<FolderCardsValue>
    @Environment(\.colorScheme) private var scheme
    @Environment(\.screenNavigator) private var navigator
    @Environment(\.screenFeedback) private var feedback

    var body: some View {
        let content = notesStyle("home.content", scheme)
        GeometryReader { geo in
            let inner = min(1400, geo.size.width) - content.padding.left - content.padding.right
            ScrollView(.vertical) {
                VStack(alignment: .leading, spacing: 0) {
                    catchUp
                    reviews
                    section("Recent notes", icon: .clock3, route: .notes(.all), top: 36, count: nil) {
                        if home.recentsLoaded && home.recents.isEmpty {
                            WebEmptyState(icon: nil, title: "No notes yet", message: "Press New to write your first one.", page: false)
                        } else {
                            WebNoteCarousel(label: "Recent notes", rows: Array(home.recents.prefix(10)), width: inner, list: list, frame: frame, recent: true)
                        }
                    }
                    section("Starred", icon: .star, route: .notes(.starred), top: 36, count: nil) {
                        if home.value != nil && home.starred.isEmpty {
                            WebEmptyState(icon: nil, title: "Nothing starred yet", message: "Star notes you come back to often and they’ll appear here.", page: false)
                        } else {
                            WebNoteCarousel(label: "Starred notes", rows: home.starred, width: inner, list: list, frame: frame, recent: false)
                        }
                    }
                    foldersSection(width: inner)
                }
                .padding(content.padding.edgeInsets)
                .frame(maxWidth: 1400, alignment: .topLeading)
                .frame(maxWidth: .infinity)
            }
            .scrollIndicators(.automatic)
        }
        .folderDialogs(home.dialogs, actions: home.actions, tree: home.tree.value?.folders ?? [])
        .notesListSheets(list)
        .onAppear { home.setVisible(true) }
        .onDisappear { home.setVisible(false) }
        .accessibilityIdentifier("screen.home")
    }

    // MARK: Catch me up (the resting state; a brief shows on its own screen)

    @ViewBuilder private var catchUp: some View {
        switch home.catchUp {
        case .hidden:
            EmptyView()
        case .offer(let error):
            catchUpOffer(error: error)
        case .running, .ready:
            catchUpOffer(error: nil)
        }
    }

    private func catchUpOffer(error: String?) -> some View {
        let b = WebStyles.named("notes.catchup.button")
        let bs = b.resolve(scheme)
        let hint = notesStyle("catchup.hint", scheme)
        return VStack(alignment: .leading, spacing: 8) {
            // `flex flex-wrap gap-3`: the words go under the button when the row is too narrow for both (the iPad).
            let button = CatchUpButton(style: b) {
                frame.runCatchUp()
                frame.open(.catchUp)
            }
            let words = Text("A quick AI brief of this week’s notes and what’s due.").webText(hint.text).lineLimit(1).foregroundStyle(hint.color.color)
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 12) {
                    button
                    words
                }
                VStack(alignment: .leading, spacing: 12) {
                    button
                    words
                }
            }
            if let error {
                Text(error).webText(.role(.subheadline)).foregroundStyle(webVar("color-danger", scheme).color)
            }
        }
        .padding(.top, bs.margin.top + 24)
        .accessibilityIdentifier("home.catchUp")
    }

    struct CatchUpButton: View {
        let style: WebStylePair
        let action: () -> Void
        @State private var hovered = false
        @Environment(\.colorScheme) private var scheme

        var body: some View {
            let s = style.resolve(scheme)
            Button(action: action) {
                HStack(spacing: s.gap) {
                    WebAiMark(size: 15)
                    Text("Catch me up").webText(s.text).lineLimit(1)
                }
                .foregroundStyle(s.color.color)
                .padding(s.padding.edgeInsets)
                .frame(height: s.height)
                .webBox(style)
                .offset(y: hovered ? -1 : 0)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .onHover { hovered = $0 }
        }
    }

    // MARK: Today's reviews

    @ViewBuilder private var reviews: some View {
        if let n = home.rows.first(where: { $0.id == .reviews })?.count {
            HStack(spacing: 16) {
                WebIconView(.layers, size: 17, strokeWidth: 1.9)
                    .frame(width: 32, height: 32)
                    .foregroundStyle(webVar("color-heading", scheme).color)
                    .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.chip, style: .circular).fill(webVar("glass-hover", scheme).color))
                VStack(alignment: .leading, spacing: 0) {
                    Text("Today’s reviews").webText(.role(.body, weight: 600)).lineLimit(1).foregroundStyle(webVar("color-heading", scheme).color)
                    Text(n > 0 ? "\(n == 1 ? "1 card" : "\(n.formatted()) cards") to review." : "All caught up for today.").webText(.role(.subheadline)).lineLimit(1).foregroundStyle(webVar("color-ink-muted", scheme).color)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if n > 0 {
                    WebButton("Start review", variant: .primary) { frame.open(.web("/review")) }
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 16)
            .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.container, style: .circular).fill(webVar("glass-active", scheme).color))
            .padding(.top, 24)
        }
    }

    // MARK: sections

    private func section<Body: View>(_ title: String, icon: WebIcon, route: FrameRoute, top: CGFloat, count: String?, @ViewBuilder body: () -> Body) -> some View {
        let header = notesStyle("section.header", scheme)
        let t = notesStyle("section.title", scheme)
        let tile = notesStyle("section.icon", scheme)
        let c = notesStyle("section.count", scheme)
        return VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: header.gap) {
                HStack(spacing: t.gap) {
                    WebIconView(icon, size: 17, strokeWidth: 1.9)
                        .frame(width: tile.width, height: tile.height)
                        .foregroundStyle(tile.color.color)
                        .background(RoundedRectangle(cornerRadius: tile.radius, style: .circular).fill(tile.background.color))
                    Text(title).webText(t.text).lineLimit(1).foregroundStyle(t.color.color)
                    if let count {
                        Text(count).webText(c.text).lineLimit(1).foregroundStyle(c.color.color).padding(.leading, c.margin.left)
                    }
                }
                .accessibilityAddTraits(.isHeader)
                Spacer(minLength: 0)
                SeeAll(title: title) { frame.open(route, .newTab) }
            }
            .frame(height: header.height)
            .padding(.bottom, header.margin.bottom)
            body()
        }
        .padding(.top, top)
    }

    struct SeeAll: View {
        let title: String
        let action: () -> Void
        @Environment(\.colorScheme) private var scheme

        var body: some View {
            let s = notesStyle("section.seeAll", scheme)
            Button(action: action) {
                HStack(spacing: s.gap) {
                    Text("See all").webText(s.text).lineLimit(1)
                    WebIconView(.arrowRight, size: 13)
                }
                .foregroundStyle(s.color.color)
                .padding(s.padding.edgeInsets)
                .frame(height: s.height)
                .contentShape(Rectangle())
            }
            .buttonStyle(WebHoverRowStyle(radius: s.radius, hover: WebStyles.vars["color-accent-soft"], press: nil, selected: false))
            .accessibilityLabel("See all \(title.lowercased())")
        }
    }

    /// Recent folders (organization.recentFolders): every folder, the most recently changed first, two whole
    /// rows at the width there is; nested ones say where they are.
    private func foldersSection(width: CGFloat) -> some View {
        let gap: CGFloat = 32
        let cols = max(1, Int((width + gap) / (210 + gap)))
        let all = allFolders.value?.folders ?? home.folders
        let recent = all.sorted { $0.updatedAt != $1.updatedAt ? $0.updatedAt > $1.updatedAt : $0.createdAt < $1.createdAt }
        let shown = Array(recent.prefix(cols * 2))
        let colW = (width - gap * CGFloat(cols - 1)) / CGFloat(cols)
        return section("Recent folders", icon: .folder, route: .web("/folders"), top: 48, count: allFolders.value != nil || home.value != nil ? "\(all.count)" : nil) {
            if (allFolders.value != nil || home.value != nil) && all.isEmpty {
                WebEmptyState(icon: nil, title: "No folders yet", message: "Create one from the sidebar to group related notes.", page: false)
            } else {
                LazyVGrid(columns: Array(repeating: GridItem(.fixed(colW), spacing: gap, alignment: .top), count: cols), alignment: .leading, spacing: 40) {
                    ForEach(shown, id: \.id) { f in
                        let model = CardMapping.folderCard(f, parentName: f.path)
                        WebFolderCell(card: model, menu: {
                            folderMenuEntries(MenuFolder(f), context: FolderMenuContext(session: home.session.value, places: home.places.value, links: home.folderLinks, locks: home.locks.error == nil ? home.locks.value : nil), actions: home.actions, dialogs: home.dialogs, navigator: navigator, feedback: feedback, frame: frame)
                        }, open: { frame.open(.folder(f.id)) }, drop: { items in Task { await home.dropNotes(items, on: f) } })
                        .frame(width: colW)
                    }
                }
            }
        }
    }
}

/// One row of note cards scrolling sideways (NoteCarousel), with arrow buttons and fades at the ends while there's
/// more to see that way.
struct WebNoteCarousel: View {
    let label: String
    let rows: [NoteRow]
    let width: CGFloat
    let list: NotesListModel
    let frame: FrameModel
    let recent: Bool
    @State private var offset: CGFloat = 0
    @State private var contentWidth: CGFloat = 0
    @State private var hovered = false
    @State private var position = ScrollPosition(edge: .leading)
    @Environment(\.colorScheme) private var scheme

    static let cardWidth: CGFloat = 250
    static let gap: CGFloat = 32

    var body: some View {
        let ul = notesStyle("carousel", scheme)
        let visible = width - ul.margin.left - ul.margin.right
        let atStart = offset <= 2
        let atEnd = offset + visible >= contentWidth - 2
        ZStack(alignment: .topLeading) {
            ScrollView(.horizontal) {
                HStack(alignment: .top, spacing: ul.gap) {
                    ForEach(rows, id: \.id) { row in
                        WebNoteCell(card: list.card(row), drag: NoteDragItem(id: row.id, title: row.title, folderId: row.folder?.id), selected: false, compact: false, unsynced: row.sync != .saved, menu: {
                            noteMenuEntries(row, list: list, frame: frame, recent: recent, canSelect: false)
                        }, open: { frame.open(.note(row.id)) })
                        .frame(width: Self.cardWidth)
                    }
                }
                .padding(ul.padding.edgeInsets)
                .scrollTargetLayout()
                .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { contentWidth = $0 }
            }
            .scrollIndicators(.never)
            .scrollTargetBehavior(.viewAligned)
            .scrollPosition($position)
            .onScrollGeometryChange(for: CGFloat.self) { $0.contentOffset.x } action: { _, x in offset = x }
            .mask {
                HStack(spacing: 0) {
                    LinearGradient(colors: [atStart ? .black : .clear, .black], startPoint: .leading, endPoint: .trailing).frame(width: 64)
                    Color.black
                    LinearGradient(colors: [.black, atEnd ? .black : .clear], startPoint: .leading, endPoint: .trailing).frame(width: 64)
                }
            }
            .frame(width: visible, height: ul.height)
            .padding(.leading, ul.margin.left)
            arrows(visible: visible, atStart: atStart, atEnd: atEnd, height: ul.height)
        }
        .frame(width: width, height: ul.height + ul.margin.bottom, alignment: .topLeading)
        .onHover { hovered = $0 }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(label)
    }

    private func arrows(visible: CGFloat, atStart: Bool, atEnd: Bool, height: CGFloat) -> some View {
        let style = WebStyles.named("notes.carousel.arrow")
        let s = style.resolve(scheme)
        let y = (height + notesStyle("carousel", scheme).margin.bottom) / 2 - 10
        return ZStack {
            if !atStart {
                arrow(.chevronLeft, style: style, size: s.width, label: "Scroll \(label.lowercased()) back") { scroll(-1, visible: visible) }
                    .position(x: s.width / 2, y: y)
            }
            if !atEnd {
                arrow(.chevronRight, style: style, size: s.width, label: "Scroll \(label.lowercased()) forward") { scroll(1, visible: visible) }
                    .position(x: width - s.width / 2, y: y)
            }
        }
        .frame(width: width, height: height)
        .opacity(hovered ? 1 : 0)
    }

    private func arrow(_ icon: WebIcon, style: WebStylePair, size: CGFloat, label: String, action: @escaping () -> Void) -> some View {
        var pair = style
        pair = WebStylePair(light: Self.visible(style.light), dark: Self.visible(style.dark))
        return Button(action: action) {
            WebIconView(icon, size: 18)
                .foregroundStyle(pair.resolve(scheme).color.color)
                .frame(width: size, height: size)
                .webBox(pair)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    static func visible(_ s: WebComputedStyle) -> WebComputedStyle {
        var c = s
        c.opacity = 1
        return c
    }

    private func scroll(_ dir: CGFloat, visible: CGFloat) {
        let step = max(Self.cardWidth + Self.gap, visible - Self.cardWidth / 2)
        let target = max(0, min(contentWidth - visible, offset + dir * step))
        withAnimation(.easeInOut(duration: 0.35)) { position.scrollTo(x: target) }
    }
}

// MARK: the note lists

enum WebNotesLayout: String, Hashable { case grid, compact, list }

struct WebNoteBrowser: View {
    let frame: FrameModel
    @Bindable var model: NotesListModel
    let builtIns: [BuiltInTemplate]
    @AppStorage private var layoutRaw: String
    @Environment(\.colorScheme) private var scheme
    @Environment(\.screenNavigator) private var navigator
    @Environment(\.screenFeedback) private var feedback
    @FocusState private var focused: Bool

    init(frame: FrameModel, model: NotesListModel) {
        self.frame = frame
        self.model = model
        self.builtIns = model.builtIns?.value?.templates ?? []
        let view = model.kind.view
        _layoutRaw = AppStorage(wrappedValue: (view == .trash || view == .archive) ? WebNotesLayout.list.rawValue : WebNotesLayout.grid.rawValue, "folevi.web.layout.\(view.rawValue)")
    }

    private var layout: WebNotesLayout { WebNotesLayout(rawValue: layoutRaw) ?? .grid }

    var body: some View {
        let content = notesStyle("browser.content", scheme)
        GeometryReader { geo in
            let inner = min(1180, geo.size.width) - content.padding.left - content.padding.right
            ZStack(alignment: .bottom) {
                ScrollView(.vertical) {
                    VStack(alignment: .leading, spacing: 0) {
                        toolbar
                        if !model.subfolders.isEmpty { subfolders }
                        if model.kind.view == .templates, !builtIns.isEmpty { builtInTemplates(width: inner) }
                        if model.isLoading {
                            Color.clear.frame(height: 200)
                        } else if model.total == 0 || (model.isFiltering && model.slots.isEmpty) {
                            empty
                        } else {
                            switch layout {
                            case .list: listLayout
                            case .grid, .compact: gridLayout(width: inner)
                            }
                        }
                    }
                    .padding(content.padding.edgeInsets)
                    .frame(maxWidth: 1180, alignment: .topLeading)
                    .frame(maxWidth: .infinity)
                    .contentShape(Rectangle())
                    .onTapGesture { if !model.selection.isEmpty { model.selection.removeAll() } }
                }
                if !model.selection.isEmpty {
                    WebSelectionBar(model: model)
                        .padding(.bottom, 20)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
        }
        .background(tint)
        .focusable()
        .focusEffectDisabled()
        .focused($focused)
        .onKeyPress(.escape) {
            guard !model.selection.isEmpty else { return .ignored }
            model.selection.removeAll()
            return .handled
        }
        .onKeyPress(characters: ["a"], phases: .down) { press in
            guard press.modifiers.contains(.command), model.selectable else { return .ignored }
            model.selection = Set(model.slots.compactMap(\.row?.id))
            return .handled
        }
        .animation(.easeOut(duration: 0.16), value: model.selection.isEmpty)
        .notesListSheets(model)
        .onAppear {
            model.setVisible(true)
            focused = true
        }
        .onDisappear { model.setVisible(false) }
        .accessibilityIdentifier("screen.list.\(model.kind.view.rawValue)")
    }

    /// A folder's page takes a faint wash of its colour (`.ui-view-tint`).
    @ViewBuilder private var tint: some View {
        if model.kind.view == .folder, let f = model.folder {
            FolderColor.resolve(f.color).color.opacity(scheme == .dark ? 0.16 : 0.1).color
        }
    }

    // MARK: toolbar

    private var statusText: String {
        let n = model.isFiltering ? model.slots.count : model.total
        let noun = model.kind.view == .templates ? (n == 1 ? "template" : "templates") : (n == 1 ? "note" : "notes")
        return "\(n) \(noun)\(model.canArrange ? " · drag to arrange" : "")"
    }

    private var toolbar: some View {
        let bar = notesStyle("toolbar", scheme)
        let status = notesStyle("toolbar.status", scheme)
        return HStack(spacing: bar.gap) {
            Text(model.isLoading ? "" : statusText).webText(status.text).lineLimit(1).foregroundStyle(status.color.color)
                .frame(maxWidth: .infinity, alignment: .leading)
            WebSortSelect(options: model.sortOptions.map { ($0.0, $0.1) }, value: $model.sort)
            WebSegmented(options: [(WebNotesLayout.grid, WebIcon.layoutGrid, "Grid"), (.compact, .rows3, "Compact cards"), (.list, .list, "List")], value: Binding(get: { layout }, set: { layoutRaw = $0.rawValue }), prefix: "toolbar")
            if model.isTrash && model.total > 0 {
                WebButton("Empty Trash", variant: .quiet) { model.confirmation = .emptyTrash(model.total) }
            }
            if model.kind.view == .templates {
                if model.screenActions.contains(.generateTemplate) {
                    Button { model.startGenerating() } label: {
                        HStack(spacing: WebStyles.named("button.secondary.md").resolve(scheme).gap) {
                            WebAiMark(size: 14)
                            Text("Generate with AI").webText(WebStyles.named("button.secondary.md").resolve(scheme).text).lineLimit(1).fixedSize()
                        }
                        .webElement(WebStyles.named("button.secondary.md"))
                    }
                    .buttonStyle(.plain)
                }
                WebButton("New template", icon: .plus, variant: .primary) {
                    Task { if let id = await model.actions.createTemplate() { frame.open(.note(id)) } }
                }
            }
        }
        .frame(height: bar.height)
        .padding(.bottom, bar.margin.bottom)
    }

    // MARK: subfolders (a folder's page)

    private var subfolders: some View {
        let grid = notesStyle("folderpage.subfolders", scheme)
        return LazyVGrid(columns: [GridItem(.adaptive(minimum: 152, maximum: 152), spacing: grid.gap, alignment: .top)], alignment: .leading, spacing: 32) {
            ForEach(model.subfolders, id: \.id) { card in
                WebFolderCell(card: card, labelScale: 234.0 / 152.0, menu: {
                    guard let f = model.menuFolder(card.id) else { return [] }
                    return folderMenuEntries(f, context: model.folderContext, actions: model.actions, dialogs: model.dialogs, navigator: navigator, feedback: feedback, frame: frame)
                }, open: { frame.open(.folder(card.id)) }, drop: { items in Task { await model.dropNotes(items, into: card.id) } })
                .frame(width: 152)
            }
        }
        .padding(.bottom, grid.margin.bottom)
    }

    // MARK: built-in templates

    private func builtInTemplates(width: CGFloat) -> some View {
        // Tailwind's sm/lg breakpoints are the window's width: the content card plus the sidebar and gutters.
        let viewport = width + 64 + 272
        let cols = viewport >= 1024 ? 3 : viewport >= 640 ? 2 : 1
        var card = WebStyles.named("card")
        card = WebStylePair(light: Self.radius(card.light, 10), dark: Self.radius(card.dark, 10))
        return VStack(alignment: .leading, spacing: 0) {
            caps("Built-in templates")
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12, alignment: .top), count: cols), spacing: 12) {
                ForEach(builtIns, id: \.key) { t in
                    Button {
                        Task { if let id = await model.actions.create(folderId: nil, templateId: t.key, title: t.name) { frame.open(.note(id)) } }
                    } label: {
                        HStack(alignment: .top, spacing: 12) {
                            WebTemplateTile(name: t.icon)
                            VStack(alignment: .leading, spacing: 0) {
                                Text(t.name).webText(WebTextStyle(size: 16, leading: 24.8, weight: 500)).lineLimit(1).foregroundStyle(webVar("color-ink", scheme).color)
                                Text(t.description).webText(.role(.subheadline)).foregroundStyle(webVar("color-ink-muted", scheme).color)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .padding(16)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                        .webBox(card)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("New page from \(t.name)")
                }
            }
            caps("Your templates").padding(.top, 32)
        }
        .padding(.bottom, 40)
    }

    static func radius(_ s: WebComputedStyle, _ r: CGFloat) -> WebComputedStyle {
        var c = s
        c.radius = r
        return c
    }

    private func caps(_ t: String) -> some View {
        Text(t.uppercased())
            .webText(WebTextStyle.role(.footnote, weight: 600).tracking(em: 0.06))
            .lineLimit(1)
            .foregroundStyle(webVar("color-ink-faint", scheme).color)
            .padding(.bottom, 12)
    }

    // MARK: empty

    private var empty: some View {
        let e = model.empty
        let icon: WebIcon = switch model.kind.view {
        case .all: .files
        case .starred: .star
        case .archive: .archive
        case .trash: .trash
        case .templates: .layoutTemplate
        case .unsorted: .inbox
        case .folder: .folderOpen
        case .tag: .hash
        }
        return Group {
            if model.isFiltering {
                WebEmptyState(icon: .search, title: model.filterEmptyTitle, message: nil)
            } else {
                WebEmptyState(icon: icon, title: e.title, message: e.message) {
                    if model.emptyOffersNewNote {
                        WebButton("New document", icon: .plus, variant: .primary) {
                            Task { if let id = await model.actions.create(folderId: model.kind.folderId) { frame.open(.note(id)) } }
                        }
                    }
                }
            }
        }
    }

    // MARK: grid

    private func gridLayout(width: CGFloat) -> some View {
        let gap: CGFloat = 32
        let compact = layout == .compact
        let viewport = width + 64 + 272
        let cols: Int = compact ? (viewport >= 1280 ? 5 : viewport >= 1024 ? 4 : viewport >= 640 ? 3 : 2) : max(1, Int((width + gap) / (230 + gap)))
        let colW = (width - gap * CGFloat(cols - 1)) / CGFloat(cols)
        let count = model.isFiltering ? model.slots.count : model.total
        return LazyVGrid(columns: Array(repeating: GridItem(.fixed(colW), spacing: gap, alignment: .top), count: cols), alignment: .leading, spacing: 40) {
            ForEach(0..<count, id: \.self) { i in
                let slot = model.isFiltering ? model.slots[i] : model.slot(at: i)
                Group {
                    if let row = slot.row {
                        cell(row, compact: compact)
                    } else {
                        RoundedRectangle(cornerRadius: FoleviTokens.Radius.control, style: .circular).fill(webVar("color-surface", scheme).color)
                            .aspectRatio(compact ? nil : WebNoteCard.aspect, contentMode: .fit)
                            .frame(height: compact ? 112 : nil)
                    }
                }
                .frame(width: colW)
                .onAppear { model.slotAppeared(slot.index) }
                .onDisappear { model.slotDisappeared(slot.index) }
            }
        }
    }

    private func cell(_ row: NoteRow, compact: Bool) -> some View {
        WebNoteCell(
            card: model.card(row),
            drag: model.dragItem(for: row),
            selected: model.selection.contains(row.id),
            compact: compact,
            unsynced: row.sync != .saved,
            menu: { noteMenuEntries(row, list: model, frame: frame) },
            open: {
                if model.selection.isEmpty { frame.open(.note(row.id)) } else { model.toggle(row.id) }
            },
            select: model.selectable ? { range in range ? selectRange(to: row.id) : model.toggle(row.id) } : nil,
            useTemplate: row.kind == "template" && !model.isTrash ? {
                Task { if let id = await model.actions.create(folderId: nil, templateId: row.id, title: row.title) { frame.open(.note(id)) } }
            } : nil
        )
    }

    private func selectRange(to id: String) {
        let ids = model.slots.compactMap(\.row?.id)
        guard let anchor = ids.firstIndex(where: { model.selection.contains($0) }), let end = ids.firstIndex(of: id) else {
            model.toggle(id)
            return
        }
        for i in min(anchor, end)...max(anchor, end) { model.selection.insert(ids[i]) }
    }

    // MARK: list

    private var listLayout: some View {
        let list = WebStyles.named("notes.list")
        let count = model.isFiltering ? model.slots.count : model.total
        return LazyVStack(spacing: 0) {
            ForEach(0..<count, id: \.self) { i in
                let slot = model.isFiltering ? model.slots[i] : model.slot(at: i)
                VStack(spacing: 0) {
                    if i > 0 { Rectangle().fill(webVar("color-line", scheme).color).frame(height: 1) }
                    if let row = slot.row {
                        WebNoteListRow(row: row, model: model, frame: frame, selectRange: { selectRange(to: row.id) })
                    } else {
                        Color.clear.frame(height: notesStyle("list.row", scheme).height)
                    }
                }
                .onAppear { model.slotAppeared(slot.index) }
                .onDisappear { model.slotDisappeared(slot.index) }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: list.resolve(scheme).radius, style: .circular))
        .webBox(list)
    }
}

/// One row of the List layout: drag handle, icon (or the selection check), title, folder badge, tags, time, menu.
struct WebNoteListRow: View {
    let row: NoteRow
    let model: NotesListModel
    let frame: FrameModel
    let selectRange: () -> Void
    @State private var hovered = false
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let r = notesStyle("list.row", scheme)
        let icon = notesStyle("list.icon", scheme)
        let title = notesStyle("list.title", scheme)
        let tags = notesStyle("list.tags", scheme)
        let time = notesStyle("list.time", scheme)
        let handle = notesStyle("list.handle", scheme)
        let on = model.selection.contains(row.id)
        HStack(spacing: r.gap) {
            Text("⋮⋮").webText(handle.text).lineLimit(1).foregroundStyle(handle.color.color).opacity(hovered ? 1 : 0)
            if on {
                WebIconView(.check, size: 11, strokeWidth: 3)
                    .foregroundStyle(webVar("color-canvas", scheme).color)
                    .frame(width: 16, height: 16)
                    .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.tiny, style: .circular).fill(webVar("color-heading", scheme).color))
            } else {
                WebIconView(.fileText, size: 16).foregroundStyle(icon.color.color)
            }
            Text(row.title.isEmpty ? "Untitled" : row.title).webText(title.text).lineLimit(1).foregroundStyle(title.color.color)
                .frame(maxWidth: .infinity, alignment: .leading)
            if row.sync != .saved {
                HStack(spacing: 4) {
                    Circle().fill(webVar("color-heading", scheme).color).frame(width: 6, height: 6)
                    Text("Waiting to sync").webText(.role(.footnote, weight: 500)).lineLimit(1)
                }
                .foregroundStyle(webVar("color-heading", scheme).color)
            }
            if row.kind != "template" { WebFolderBadge(name: row.folder?.name, colorId: row.folder?.color) }
            if !row.tags.isEmpty {
                Text(row.tags.map { "#\($0.name)" }.joined(separator: " ")).webText(tags.text).lineLimit(1).foregroundStyle(tags.color.color)
            }
            Text(CardMapping.timeText(row, inTrash: model.isTrash)).webText(time.text).lineLimit(1).foregroundStyle(time.color.color)
                .frame(width: time.width, alignment: .trailing)
            if row.kind == "template" && !model.isTrash {
                WebButton("Use", icon: .filePlusCorner, variant: .ghost, size: .sm) {
                    Task { if let id = await model.actions.create(folderId: nil, templateId: row.id, title: row.title) { frame.open(.note(id)) } }
                }
            }
            WebMenuButton(width: 200, entries: { noteMenuEntries(row, list: model, frame: frame) }) {
                WebIconView(.ellipsis, size: 16)
                    .foregroundStyle(webVar("color-ink-muted", scheme).color)
                    .frame(width: 32, height: 32)
                    .contentShape(Rectangle())
            }
            .foleviTooltip("Actions for \(row.title.isEmpty ? "Untitled" : row.title)")
        }
        .padding(r.padding.edgeInsets)
        .frame(height: r.height)
        .background(on ? webVar("glass-active", scheme).color : hovered ? webVar("color-surface", scheme).color : .clear)
        .contentShape(Rectangle())
        .onTapGesture {
            let flags = NSEvent.modifierFlags
            if model.selectable && flags.contains(.command) { model.toggle(row.id) } else if model.selectable && flags.contains(.shift) { selectRange() } else if !model.selection.isEmpty { model.toggle(row.id) } else { frame.open(.note(row.id)) }
        }
        .onHover { hovered = $0 }
        .draggable(model.dragItem(for: row))
        .webContextMenu { noteMenuEntries(row, list: model, frame: frame) }
    }
}

/// A built-in template's icon on its pastel tile (ui/TemplateIcon.tsx TemplateTile).
struct WebTemplateTile: View {
    let name: String
    @Environment(\.colorScheme) private var scheme

    /// The web's icon names in its order (the tint follows the position).
    static let icons: [(String, WebIcon?)] = [
        ("book-open", .bookOpen), ("briefcase", .briefcase), ("bug", .bug), ("calendar-check", .calendarCheck), ("calendar-range", .calendarRange),
        ("chef-hat", .chefHat), ("clipboard-list", .clipboardList), ("compass", .compass), ("dumbbell", .dumbbell), ("flask-conical", .flaskConical),
        ("graduation-cap", .graduationCap), ("heart", .heart), ("history", .rotateCcwClock), ("lightbulb", .lightbulb), ("messages-square", .messagesSquare),
        ("party-popper", .partyPopper), ("pen-line", .penLine), ("plane", .plane), ("refresh-cw", .refreshCw), ("scale", .scale),
        ("sun", .sun), ("target", .target), ("timer", .timer), ("user-round-search", .userRoundSearch), ("users", .users), ("wallet", .wallet),
    ]
    static let tints = ["#e0607e", "#e8844a", "#d6a21e", "#6fa83a", "#2fa58a", "#3a9cc9", "#5b7fe0", "#8a6ee0", "#c465c9", "#d9738f"]

    var body: some View {
        let index = Self.icons.firstIndex { $0.0 == name }
        let hue = RGBA(hex: Self.tints[index.map { ($0 * 3) % Self.tints.count } ?? 0]) ?? RGBA(224, 96, 126)
        let icon = index.flatMap { Self.icons[$0].1 } ?? .fileText
        WebIconView(icon, size: 18, strokeWidth: 1.75)
            .foregroundStyle(hue.oklabMix(webVar("color-heading", scheme), 0.78).color)
            .frame(width: 36, height: 36)
            .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.control, style: .circular).fill(hue.opacity(0.17).color))
    }
}

// MARK: Folders and Tags

enum WebFolderSort: String, CaseIterable { case name, updated, count, created }

struct WebFoldersIndex: View {
    let frame: FrameModel
    let home: HomeModel
    let allFolders: ValueStore<FolderCardsValue>
    @State private var query = ""
    @AppStorage("folevi.web.folders-sort") private var sortRaw = WebFolderSort.name.rawValue
    @AppStorage("folevi.web.folders-layout") private var layoutRaw = "grid"
    @Environment(\.colorScheme) private var scheme
    @Environment(\.screenNavigator) private var navigator
    @Environment(\.screenFeedback) private var feedback

    private var sort: WebFolderSort { WebFolderSort(rawValue: sortRaw) ?? .name }

    private var list: [FolderCard] {
        let all = allFolders.value?.folders ?? []
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
        let rows = all.filter { needle.isEmpty || $0.name.lowercased().contains(needle) }
        return rows.sorted { a, b in
            switch sort {
            case .updated: return a.updatedAt > b.updatedAt
            case .count: return a.noteCount != b.noteCount ? a.noteCount > b.noteCount : a.name.localizedCaseInsensitiveCompare(b.name) == .orderedAscending
            case .created: return a.createdAt > b.createdAt
            case .name: return a.name.localizedCaseInsensitiveCompare(b.name) == .orderedAscending
            }
        }
    }

    var body: some View {
        let content = notesStyle("index.content", scheme)
        let total = allFolders.value?.folders.count ?? 0
        let shown = list
        GeometryReader { geo in
        let inner = min(1180, geo.size.width) - 64
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 12) {
                    WebIndexSearch(placeholder: "Search folders", text: $query, width: WebStyles.isPad ? 384 : min(384, max(160, (inner - 290) / 2)))
                        .layoutPriority(WebStyles.isPad ? 1 : 0)
                    Text(allFolders.value == nil ? "Loading…" : !query.trimmingCharacters(in: .whitespaces).isEmpty ? "\(shown.count) of \(total) folders" : "\(total) \(total == 1 ? "folder" : "folders")")
                        .webText(notesStyle("index.status", scheme).text).lineLimit(1).foregroundStyle(notesStyle("index.status", scheme).color.color)
                        .fixedSize()
                    Spacer(minLength: 0)
                    WebSortSelect(options: [(WebFolderSort.name, "Name"), (.updated, "Last updated"), (.count, "Most pages"), (.created, "Newest")], value: Binding(get: { sort }, set: { sortRaw = $0.rawValue }))
                        .fixedSize()
                    WebSegmented(options: [("grid", WebIcon.layoutGrid, "Grid"), ("list", .rows3, "List")], value: $layoutRaw, prefix: "index")
                        .fixedSize()
                }
                if allFolders.value != nil && shown.isEmpty {
                    WebEmptyState(icon: .folderOpen, title: query.isEmpty ? "No folders yet" : "No folders match “\(query.trimmingCharacters(in: .whitespaces))”", message: query.isEmpty ? "Create one to group related pages." : nil)
                } else if layoutRaw == "list" {
                    folderList(shown).padding(.top, 24)
                } else {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 210), spacing: 32, alignment: .top)], alignment: .leading, spacing: 40) {
                        ForEach(shown, id: \.id) { f in
                            WebFolderCell(card: CardMapping.folderCard(f, parentName: f.path), menu: { menu(f) }, open: { frame.open(.folder(f.id)) }, drop: { items in Task { await home.dropNotes(items, on: f) } })
                        }
                    }
                    .padding(.top, 24)
                }
            }
            .padding(content.padding.edgeInsets)
            .frame(maxWidth: 1180, alignment: .topLeading)
            .frame(maxWidth: .infinity)
        }
        .safeAreaInset(edge: .top, spacing: 0) { actions }
        }
        .folderDialogs(home.dialogs, actions: home.actions, tree: home.tree.value?.folders ?? [])
        .accessibilityIdentifier("screen.folders")
    }

    /// The view's own actions row (ViewChrome `actions`): New folder, top right.
    @ViewBuilder private var actions: some View {
        let b = WebStyles.named("notes.index.newFolder")
        let bs = b.resolve(scheme)
        let content = notesStyle("index.content", scheme)
        HStack {
            Spacer(minLength: 0)
            if home.canEdit {
                Button { home.dialogs.open(.newFolder(parent: nil)) } label: {
                    HStack(spacing: bs.gap) {
                        WebIconView(.folderPlus, size: 14)
                        Text("New folder").webText(bs.text).lineLimit(1)
                    }
                    .foregroundStyle(bs.color.color)
                    .padding(bs.padding.edgeInsets)
                    .frame(height: bs.height)
                    .webBox(b)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 32)
        .frame(maxWidth: 1180 + 0)
        .frame(height: content.y - 64)
        .frame(maxWidth: .infinity)
    }

    private func menu(_ f: FolderCard) -> [WebMenuEntry] {
        folderMenuEntries(MenuFolder(f), context: FolderMenuContext(session: home.session.value, places: home.places.value, links: home.folderLinks, locks: home.locks.error == nil ? home.locks.value : nil), actions: home.actions, dialogs: home.dialogs, navigator: navigator, feedback: feedback, frame: frame)
    }

    private func folderList(_ rows: [FolderCard]) -> some View {
        VStack(spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.element.id) { i, f in
                if i > 0 { Rectangle().fill(webVar("color-line", scheme).color).frame(height: 1) }
                Button { frame.open(.folder(f.id)) } label: {
                    HStack(spacing: 12) {
                        FolderGlyph(colorId: f.color, size: 24)
                        HStack(spacing: 8) {
                            Text(f.name).webText(.role(.body, weight: 500)).lineLimit(1).foregroundStyle(webVar("color-ink", scheme).color)
                            if let path = f.path { Text("in \(path)").webText(.role(.footnote)).lineLimit(1).foregroundStyle(webVar("color-ink-muted", scheme).color) }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        Text(f.noteCount == 1 ? "1 page" : "\(f.noteCount.formatted()) pages").webText(.role(.footnote)).monospacedDigit().foregroundStyle(webVar("color-ink-muted", scheme).color).frame(width: 80, alignment: .trailing)
                        Text(AgeText.age(ms: f.updatedAt)).webText(.role(.footnote)).foregroundStyle(webVar("color-ink-faint", scheme).color).frame(width: 128, alignment: .trailing)
                    }
                    .padding(.vertical, 10)
                    .padding(.leading, 16)
                    .padding(.trailing, 56)
                    .contentShape(Rectangle())
                }
                .buttonStyle(WebHoverRowStyle(radius: 0, hover: WebStyles.vars["color-accent-soft"], press: nil, selected: false))
                .webContextMenu { menu(f) }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: FoleviTokens.Radius.chip, style: .circular))
        .webBox(WebStyles.named("card"))
    }
}

/// The Folders and Tags pages' search field (a magnifier inside a `.ui-input`, a clear button once typed in).
struct WebIndexSearch: View {
    let placeholder: String
    @Binding var text: String
    /// `flex-1 max-w-sm` next to a spacer that shares the row: half of what the row leaves, at most 384.
    var width: CGFloat = 327
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let style = WebStyles.named("notes.index.search")
        let s = style.resolve(scheme)
        HStack(spacing: 0) {
            TextField(placeholder, text: $text)
                .textFieldStyle(.plain)
                .webText(s.text)
                .lineLimit(1)
                .offset(x: -1.125, y: 1.035)
        }
        .padding(s.padding.edgeInsets)
        .frame(height: s.height)
        // (On the iPad the row's touch-sized controls leave the field what's over: `min-w-0`, down to its icon.)
        .frame(minWidth: WebStyles.isPad ? 0 : width, maxWidth: width)
        .foregroundStyle(s.color.color)
        .webBox(style)
        .overlay(alignment: .leading) {
            WebIconView(.search, size: 14).foregroundStyle(webVar("color-ink-faint", scheme).color).padding(.leading, 12).allowsHitTesting(false)
        }
        .overlay(alignment: .trailing) {
            if !text.isEmpty {
                Button { text = "" } label: {
                    WebIconView(.x, size: 13).foregroundStyle(webVar("color-ink-faint", scheme).color).frame(width: 24, height: 24).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .padding(.trailing, 8)
                .accessibilityLabel("Clear search")
            }
        }
    }
}

struct WebTagsIndex: View {
    let frame: FrameModel
    @State private var query = ""
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let content = notesStyle("tags.content", scheme)
        let all = (frame.folders.value?.tags ?? []).sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        let needle = query.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "#", with: "").lowercased()
        let shown = all.filter { needle.isEmpty || $0.name.lowercased().contains(needle) }
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 12) {
                    WebIndexSearch(placeholder: "Search tags", text: $query)
                    Text(frame.folders.value == nil ? "Loading…" : !needle.isEmpty ? "\(shown.count) of \(all.count) tags" : "\(all.count) \(all.count == 1 ? "tag" : "tags")")
                        .webText(notesStyle("tags.status", scheme).text).lineLimit(1).foregroundStyle(notesStyle("tags.status", scheme).color.color)
                    Spacer(minLength: 0)
                    WebSortSelect(options: [("name", "Name"), ("count", "Most used"), ("created", "Newest")], value: .constant("name"))
                }
                if frame.folders.value != nil && shown.isEmpty {
                    WebEmptyState(icon: .hash, title: needle.isEmpty ? "No tags yet" : "No tags match “\(needle)”", message: needle.isEmpty ? "Add tags to a page from its Info panel." : nil)
                } else {
                    WebFlow(spacing: 8) {
                        ForEach(shown, id: \.id) { t in
                            Button { frame.open(.tag(t.id)) } label: {
                                HStack(spacing: 8) {
                                    WebIconView(.hash, size: 14).foregroundStyle(WebSidebar.tagColor(t.color))
                                    Text(t.name).webText(.role(.body, weight: 500)).lineLimit(1).foregroundStyle(webVar("color-ink", scheme).color)
                                }
                                .padding(.leading, 12)
                                .padding(.trailing, 8)
                                .frame(height: 36)
                                .webBox(WebStyles.named("notes.card.menu"))
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.top, 24)
                }
            }
            .padding(content.padding.edgeInsets)
            .frame(maxWidth: 1180, alignment: .topLeading)
            .frame(maxWidth: .infinity)
        }
        .accessibilityIdentifier("screen.tags")
    }
}

/// Wraps its children onto lines (`flex flex-wrap gap-2`).
struct WebFlow: Layout {
    var spacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, line: CGFloat = 0, widest: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x > 0, x + s.width > width {
                y += line + spacing
                x = 0
                line = 0
            }
            x += s.width + spacing
            line = max(line, s.height)
            widest = max(widest, x - spacing)
        }
        return CGSize(width: proposal.width ?? widest, height: y + line)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, line: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x > bounds.minX, x + s.width > bounds.maxX {
                y += line + spacing
                x = bounds.minX
                line = 0
            }
            v.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(s))
            x += s.width + spacing
            line = max(line, s.height)
        }
    }
}
#endif
