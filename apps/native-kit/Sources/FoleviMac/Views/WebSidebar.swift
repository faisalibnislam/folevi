// The Mac sidebar drawn as the web app's (apps/web/src/components/app/Sidebar.tsx, as Folevi for Mac shows it),
// from the live app's computed styles (FoleviDesign WebStyles "frame.sidebar.*", pnpm styles:gen --app):
//
//   the top bar (52 pt: the window buttons' room, sync status, notifications), the "Search or jump to…" well,
//   Home, Work with Foli AI, Starred (with its first starred notes), Drafts, All notes, Tasks, Calendar, Shared
//   with Me, Changes, Templates; Folders (the tree, a New folder button); Tags (closed until opened); Archive and
//   Trash; and the account button at the bottom.
#if os(macOS)
import AppKit
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
    @Environment(\.controlActiveState) private var active
    @AppStorage("folevi.sidebar.starredOpen") private var starredOpen = true
    @AppStorage("folevi.sidebar.section.folders") private var foldersOpen = true
    @AppStorage("folevi.sidebar.section.tags") private var tagsOpen = false
    /// On a note: the note's own tools ("document", the web's default) or the folders (`folevi:doc-sidebar-mode`).
    @AppStorage("folevi.sidebar.docMode") private var docMode = "document"
    @State private var openFolders: Set<String> = []

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
                    .padding(.top, WebStyles.named("notetools.card.wrap").resolve(scheme).y - style("search").y - style("search").height)
            } else {
                appList
            }
            account
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
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
            Spacer(minLength: 0)
            SyncDot(model: model)
            if !local {
                WebIconButton(.bell, label: "Notifications") { actions.notifications(nil) }
            }
            WebMenuButton(width: 200, entries: { sidebarMenu }) {
                WebIconView(.panelLeft, size: 16)
                    .frame(width: 32, height: 32)
                    .foregroundStyle(Folevi.color.inkMuted)
                    .contentShape(Rectangle())
            }
            .help("Sidebar")
        }
        .padding(.horizontal, bar.padding.left)
        .frame(height: bar.height)
        .contentShape(Rectangle())
        .gesture(WindowDragGesture())
    }

    /// The sidebar's own menu (the web's SidebarMenu).
    private var sidebarMenu: [WebMenuEntry] {
        [
            WebMenuEntry(.item(model.sidebarCollapsed ? "Show sidebar" : "Hide sidebar", icon: .panelLeft, shortcut: "⌘\\")) { model.sidebarCollapsed.toggle() },
        ] + (model.route.isNote ? [
            .separator(),
            WebMenuEntry(.item("Show folders", checked: docMode == "folders")) { docMode = "folders" },
            WebMenuEntry(.item("Show document", checked: docMode == "document")) { docMode = "document" },
        ] : [])
    }

    // MARK: search

    private var search: some View {
        let s = WebStyles.named("frame.sidebar.search")
        let r = s.resolve(scheme)
        let label = style("search.label")
        return Button { model.open(.search("")) } label: {
            HStack(spacing: r.gap) {
                WebIconView(.search, size: 14).foregroundStyle(style("search.icon").color.color)
                Text("Search or jump to…").webText(label.text).lineLimit(1).foregroundStyle(label.color.color)
                Spacer(minLength: 0)
                WebKbd("⌘K")
            }
            .padding(r.padding.edgeInsets)
            .frame(maxWidth: .infinity, minHeight: r.height, maxHeight: r.height)
            .webBox(s)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: destinations

    private var destinations: some View {
        let caps = model.session.value?.capabilities
        let home = model.home.value
        let count = { (id: HomeRow.Id) -> Int? in home?.rows.first { $0.id == id }?.count }
        let starred = home?.starred.rows ?? []
        return VStack(alignment: .leading, spacing: 2) {
            item(.home, icon: .house, title: "Home")
            if caps?.ai ?? false { item(.web("/ai"), icon: .sparkles, title: "Work with Foli AI") }
            ZStack(alignment: .trailing) {
                item(.notes(.starred), icon: .star, title: "Starred")
                if !starred.isEmpty {
                    let t = style("starred.toggle")
                    Button { starredOpen.toggle() } label: {
                        WebIconView(starredOpen ? .chevronDown : .chevronRight, size: 12)
                            .frame(width: t.width, height: t.height)
                            .foregroundStyle(t.color.color)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
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
            }
            item(.notes(.unsorted), icon: .inbox, title: "Drafts", count: count(.drafts))
            item(.notes(.all), icon: .files, title: "All notes")
            item(.tasks(.today), icon: .squareCheck, title: "Tasks", count: tasks.value?.today)
            item(.calendar(nil), icon: .calendar, title: "Calendar")
            if let n = count(.reviews), n > 0 { item(.web("/review"), icon: .layers, title: "Reviews", count: n) }
            if caps?.sharing ?? false { item(.shared, icon: .share2, title: "Shared with Me") }
            // The Vault where there's one for this person (vault.summary; a library's own Vault too, plan 5.6).
            VaultSidebarRow(model: model) { item(.web("/vault"), icon: .lock, title: "Vault") }
            if caps?.changes ?? false { item(.changes, icon: .fileDiff, title: "Changes", count: count(.changes)) }
            item(.notes(.templates), icon: .layoutTemplate, title: "Templates")
        }
    }

    /// One row (the web's NavItem): icon, label, an optional count; the page's own row is selected.
    private func item(_ route: FrameRoute, icon: WebIcon, iconSize: CGFloat = 18, title: String, count: Int? = nil, newTab: Bool = false, glyph: AnyView? = nil) -> some View {
        let selected = model.route == route
        let base = WebStyles.named(selected ? "frame.sidebar.item.active" : "frame.sidebar.item")
        let s = base.resolve(scheme)
        let selectedFill = (WebStyles.vars[active == .inactive ? "mac-selected-inactive" : "mac-selected"] ?? FoleviTokens.Chrome.surfaceSunken).resolve(scheme)
        let iconColor = style(selected ? "item.active.icon" : "item.icon").color
        let countStyle = style("item.count")
        return Button {
            model.open(route, newTab ? .newTab : .replace)
        } label: {
            HStack(spacing: s.gap) {
                Group {
                    if let glyph { glyph } else { WebIconView(icon, size: iconSize) }
                }
                .frame(width: 18, height: 18)
                .foregroundStyle(iconColor.color)
                Text(title).webText(s.text).lineLimit(1).foregroundStyle(s.color.color).frame(maxWidth: .infinity, alignment: .leading)
                if let count, count > 0 {
                    Text("\(count)")
                        .webText(countStyle.text)
                        .lineLimit(1)
                        .monospacedDigit()
                        .foregroundStyle(countStyle.color.color)
                        .padding(countStyle.padding.edgeInsets)
                        .frame(minWidth: countStyle.width, minHeight: countStyle.height)
                        .background(RoundedRectangle(cornerRadius: countStyle.radius, style: .circular).fill(countStyle.background.color))
                }
            }
            .padding(s.padding.edgeInsets)
            .frame(maxWidth: .infinity, minHeight: s.height, maxHeight: s.height)
            .background(RoundedRectangle(cornerRadius: s.radius, style: .circular).fill(selected ? selectedFill.color : .clear))
            .contentShape(Rectangle())
        }
        .buttonStyle(WebHoverRowStyle(radius: s.radius, hover: WebStyles.vars["mac-hover"], press: WebStyles.vars["mac-press"], selected: selected))
    }

    // MARK: folders

    private var foldersSection: some View {
        let all = model.folders.value?.folders ?? []
        let roots = all.filter { $0.parentId == nil }
        return section("Folders", route: .web("/folders"), open: $foldersOpen, action: AnyView(
            WebIconButton(.folderPlus, label: "New folder") { model.newFolder() }
        )) {
            if roots.isEmpty {
                Text("No folders yet").webText(.role(.footnote)).foregroundStyle(Folevi.color.inkFaint).padding(.horizontal, 8).padding(.vertical, 4)
            }
            ForEach(Array(roots.prefix(Self.limit)), id: \.id) { f in
                folder(f, all: all)
            }
            if roots.count > Self.limit {
                moreLink("+\(roots.count - Self.limit) more", route: .web("/folders"))
            }
        }
    }

    private func folder(_ f: FolderNode, all: [FolderNode]) -> AnyView {
        let children = all.filter { $0.parentId == f.id }
        let open = openFolders.contains(f.id)
        let toggle = style("folder.toggle")
        return AnyView(VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 0) {
                if children.isEmpty {
                    Color.clear.frame(width: toggle.width, height: 1)
                } else {
                    Button {
                        if open { openFolders.remove(f.id) } else { openFolders.insert(f.id) }
                    } label: {
                        WebIconView(open ? .chevronDown : .chevronRight, size: 12)
                            .frame(width: toggle.width, height: toggle.height)
                            .foregroundStyle(toggle.color.color)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
                item(.folder(f.id), icon: .folder, title: f.name, glyph: AnyView(FolderGlyph(colorId: f.color, size: 18)))
            }
            .padding(.leading, CGFloat(f.depth) * 14)
            .webContextMenu { folderMenu(f) }
            if open {
                ForEach(children, id: \.id) { c in folder(c, all: all) }
            }
        })
    }

    /// A folder's right-click menu (the web's FolderMenu).
    private func folderMenu(_ f: FolderNode) -> [WebMenuEntry] {
        [
            WebMenuEntry(.item("Open in new tab", icon: .externalLink)) { model.open(.folder(f.id), .newTab) },
            .separator(),
            WebMenuEntry(.item("New note here", icon: .plus)) { model.newNote(in: f.id) },
            WebMenuEntry(.item("New subfolder", icon: .folderPlus)) { model.newFolder(parent: f.id) },
        ]
    }

    // MARK: tags

    private var tagsSection: some View {
        let tags = model.folders.value?.tags ?? model.home.value?.tags ?? []
        return section("Tags", route: .web("/tags"), open: $tagsOpen, action: nil) {
            if tags.isEmpty {
                Text("Tag documents from the inspector").webText(.role(.footnote)).foregroundStyle(Folevi.color.inkFaint).padding(.horizontal, 8).padding(.vertical, 4)
            }
            ForEach(Array(tags.prefix(Self.limit)), id: \.id) { t in
                item(.tag(t.id), icon: .hash, iconSize: 15, title: t.name, glyph: AnyView(WebIconView(.hash, size: 15).foregroundStyle(Self.tagColor(t.color))))
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
    private func section<Rows: View>(_ title: String, route: FrameRoute, open: Binding<Bool>, action: AnyView?, @ViewBuilder rows: () -> Rows) -> some View {
        let header = style("section.header")
        let chevron = style("section.chevron")
        let titleStyle = style("section.title")
        return VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: header.gap) {
                Button { open.wrappedValue.toggle() } label: {
                    WebIconView(open.wrappedValue ? .chevronDown : .chevronRight, size: 12)
                        .frame(width: chevron.width, height: chevron.height)
                        .foregroundStyle(chevron.color.color)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                Button { model.open(route, .replace) } label: {
                    Text(title.uppercased())
                        .webText(titleStyle.text)
                        .lineLimit(1)
                        .foregroundStyle(titleStyle.color.color)
                        .padding(titleStyle.padding.edgeInsets)
                        .frame(maxWidth: .infinity, minHeight: titleStyle.height, alignment: .leading)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                if let action { action }
            }
            .padding(header.padding.edgeInsets)
            .frame(height: header.height)
            if open.wrappedValue {
                VStack(alignment: .leading, spacing: 2) { rows() }
                    .padding(.top, 4)
            }
        }
        .padding(.top, 20)
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
        return Button { actions.account(NSApp.keyWindow?.contentView?.hitTest(NSEvent.mouseLocation(in: NSApp.keyWindow))) } label: {
            HStack(spacing: a.gap) {
                Text(String(name.prefix(1)).uppercased())
                    .font(WebFont.font(.sans, size: (28 * 0.46).rounded(), weight: 600))
                    .foregroundStyle(Folevi.color.canvas)
                    .frame(width: 28, height: 28)
                    .background(RoundedRectangle(cornerRadius: 6, style: .circular).fill(Folevi.color.heading))
                VStack(alignment: .leading, spacing: 0) {
                    Text(name).webText(WebTextStyle.role(.body, weight: 600).leading(17.5)).lineLimit(1).foregroundStyle(Folevi.color.heading)
                    Text(model.session.value?.mode == .local ? "On your devices" : model.spaceName).webText(WebTextStyle.role(.footnote).leading(15)).lineLimit(1).foregroundStyle(Folevi.color.inkMuted)
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
        HoverFill(label: configuration.label, pressed: configuration.isPressed, radius: radius, hover: hover, press: press, selected: selected)
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
struct SyncDot: View {
    let model: FrameModel

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            WebIconView(.cloud, size: 16).foregroundStyle(Folevi.color.inkMuted)
            Circle().fill(Folevi.color.success).frame(width: 6, height: 6).offset(x: 1, y: 1)
        }
        .frame(width: 28, height: 28)
        .help("Saved")
    }
}

extension NSEvent {
    /// The mouse location in a window's content view coordinates (for anchoring a popover to what was clicked).
    @MainActor static func mouseLocation(in window: NSWindow?) -> NSPoint {
        guard let window, let content = window.contentView else { return .zero }
        return content.convert(window.mouseLocationOutsideOfEventStream, from: nil)
    }
}

#endif
