// The native screens a Mac window shows outside a note: the shared SwiftUI screens (FoleviScreens: Home, every
// note list and folder, Shared with me, Changes, Tasks, Calendar, Search), given the frame's navigator (routes
// become tabs), intents (places, Settings, sign-in, notes at a block) and feedback (toasts), plus Catch me up on
// its own screen.
#if os(macOS) || os(iOS)
import SwiftUI
import FoleviDesign
import FoleviEngine
import FoleviScreens

/// The drag types (plan 5.5), as FoleviScreens' DragItems carry them: JSON of NoteDragItem / FolderDragItem.
public enum FrameDrag {
    public static let noteType = "com.folevi.note-ref"
    public static let folderType = "com.folevi.folder-ref"

    #if os(macOS)
    /// The note ids on a pasteboard item (FoleviScreens' JSON: one note or a whole selection; or a bare id).
    static func noteIds(_ item: NSPasteboardItem) -> [String] {
        guard let data = item.data(forType: .init(noteType)) else { return [] }
        if let d = try? JSONDecoder().decode(NoteDragItem.self, from: data) { return d.ids }
        if let s = String(data: data, encoding: .utf8), !s.isEmpty, !s.hasPrefix("{") { return [s] }
        return []
    }

    static func folderId(_ item: NSPasteboardItem) -> String? {
        if let data = item.data(forType: .init(folderType)) {
            if let d = try? JSONDecoder().decode(FolderDragItem.self, from: data) { return d.id }
            if let s = String(data: data, encoding: .utf8), !s.isEmpty, !s.hasPrefix("{") { return s }
        }
        return nil
    }
    #endif
}

/// The shared screens' view models, one per route, kept while the window lives (a tab coming back finds its
/// scroll, sort and filter as it left them).
@MainActor
final class ScreenModels {
    private let frame: FrameModel
    private var home: HomeModel?
    private var lists: [NotesListKind: NotesListModel] = [:]
    private var shared: SharedListModel?
    private var changes: ChangesModel?
    private var tasks: TasksModel?
    private var calendar: CalendarModel?
    private var search: SearchModel?
    /// Help, Graph, Reviews and shared folders (Views/More).
    lazy var more = MoreModels(frame: frame, feedback: feedback)
    /// Every folder as a card (Home's Recent folders, the Folders page).
    private var allFolders: ValueStore<FolderCardsValue>?
    private var tags: ValueStore<TagsIndexValue>?
    private var aiPage: FoliChatModel?
    private var settings: MacSettingsModel?

    init(frame: FrameModel) { self.frame = frame }

    var feedback: ScreenFeedback {
        ScreenFeedback(toast: { [weak frame] t in
            frame?.toast(t.message, tone: t.tone == .error ? .error : t.tone == .success ? .success : .info, actionTitle: t.actionTitle, action: t.action)
        })
    }

    func homeModel() -> HomeModel {
        if let home { return home }
        let m = HomeModel(client: frame.client, feedback: feedback)
        home = m
        return m
    }

    func list(_ kind: NotesListKind) -> NotesListModel {
        if let m = lists[kind] { return m }
        let m = NotesListModel(client: frame.client, kind: kind, feedback: feedback)
        // Move and Copy in Folevi's own dialogs (FrameDialogs), never the system's sheets.
        let frame = self.frame
        m.presentMove = { [weak m] ids in
            let rows = m?.loadedRows.filter { ids.contains($0.id) } ?? []
            let folders = Set(rows.map { $0.folder?.id })
            FrameDialogs.moveNotes(frame, ids: ids, title: ids.count == 1 ? rows.first?.title : nil, currentFolderId: rows.count == ids.count && folders.count == 1 ? .some(folders.first!) : nil)
        }
        m.presentCopy = { [weak m] ids in
            guard let m else { return }
            FrameDialogs.copyNotes(frame, ids: ids, spaces: m.copyTargets) { space, folder in
                m.selecting = false
                await m.actions.copy(ids, to: space, folder: folder)
            }
        }
        lists[kind] = m
        return m
    }

    func sharedModel() -> SharedListModel {
        if let shared { return shared }
        let m = SharedListModel(client: frame.client, feedback: feedback)
        shared = m
        return m
    }

    func changesModel() -> ChangesModel {
        if let changes { return changes }
        let m = ChangesModel(client: frame.client, feedback: feedback)
        changes = m
        return m
    }

    func tasksModel() -> TasksModel {
        if let tasks { return tasks }
        let m = TasksModel(client: frame.client, feedback: feedback)
        tasks = m
        return m
    }

    func calendarModel() -> CalendarModel {
        if let calendar { return calendar }
        let m = CalendarModel(client: frame.client, feedback: feedback)
        calendar = m
        return m
    }

    func searchModel() -> SearchModel {
        if let search { return search }
        let m = SearchModel(client: frame.client, feedback: feedback)
        search = m
        return m
    }

    /// The Foli AI page's chat (one per window, kept while its tab is open).
    func aiPageModel() -> FoliChatModel {
        if let aiPage { return aiPage }
        let m = FoliChatModel(client: frame.client, feedback: feedback)
        m.onOpen = { [weak frame] route in
            guard let frame, let r = FrameNavigation.route(route) else { return }
            frame.open(r)
        }
        aiPage = m
        return m
    }

    func settingsModel() -> MacSettingsModel {
        if let settings { return settings }
        let m = MacSettingsModel(frame: frame)
        settings = m
        return m
    }

    /// Brings a kept screen to what the route asks before it shows (a Tasks view, a calendar day, the words).
    func prepare(_ route: FrameRoute) {
        switch route {
        case .tasks(let v): tasksModel().select(v)
        case .calendar(let d): if let d { calendarModel().select(d) }
        case .search(let q): if !q.isEmpty, searchModel().text != q { searchModel().text = q }
        default: break
        }
    }

    /// The note list on screen for a route, when it has been shown.
    /// The Tags page's tags, with their page counts.
    func tagsIndex() -> ValueStore<TagsIndexValue> {
        if let tags { return tags }
        let v = frame.client.watch(.tagsIndex())
        tags = v
        return v
    }

    func allFolderCards() -> ValueStore<FolderCardsValue> {
        if let allFolders { return allFolders }
        let v = frame.client.watch(.foldersCards(all: true))
        allFolders = v
        return v
    }

    func listModel(for route: FrameRoute) -> NotesListModel? {
        switch route {
        case .notes(let v): return lists[NotesListKind(v)]
        case .folder(let id): return lists[.folder(id)]
        case .tag(let id): return lists[.tag(id)]
        default: return nil
        }
    }

    /// Lets go of the screens whose tabs closed (Home stays).
    func keep(only routes: Set<FrameRoute>) {
        lists = lists.filter { kind, _ in
            switch kind.view {
            case .folder: return routes.contains(.folder(kind.folderId ?? ""))
            case .tag: return routes.contains(.tag(kind.tagId ?? ""))
            default: return routes.contains(.notes(kind.view))
            }
        }
        if !routes.contains(.shared) { shared = nil }
        if !routes.contains(.changes) { changes = nil }
        if !routes.contains(where: { if case .tasks = $0 { return true } else { return false } }) { tasks = nil }
        if !routes.contains(where: { if case .calendar = $0 { return true } else { return false } }) { calendar = nil }
        if !routes.contains(where: { if case .search = $0 { return true } else { return false } }) { search = nil }
        if !routes.contains(where: { $0.tabKey == "view:ai" }) { aiPage?.closed(); aiPage = nil }
        // The card items of screens whose tabs closed.
        let keys = Set(routes.map(\.tabKey))
        frame.cardItems = frame.cardItems.filter { keys.contains($0.key) }
    }
}

/// Where the shared screens' routes go in a Mac window.
@MainActor
enum FrameNavigation {
    static func route(_ r: ScreenRoute) -> FrameRoute? {
        switch r {
        case .home: return .home
        case .notes(let v): return .notes(v)
        case .folder(let id): return .folder(id)
        case .tag(let id): return .tag(id)
        case .allFolders: return .web("/folders")
        case .shared: return .shared
        case .changes: return .changes
        case .reviews: return .web("/review")
        case .graph: return .web("/graph")
        case .search(let prompt): return .search(prompt)
        case .note(let id), .noteInNewTab(let id): return .note(id)
        case .web(let path): return webRoute(path)
        default: return nil
        }
    }

    /// A web path, the features' own paths first (FeatureRoute: /tasks, /calendar?date=, /search?q=, a note at a
    /// block).
    static func webRoute(_ path: String) -> FrameRoute {
        switch FeatureRoute(webRoute: path) {
        case .tasks(let v)?: return .tasks(v)
        case .calendar(let d)?: return .calendar(d)
        case .search(let t)?: return .search(t)
        case .noteBlock(let id, _)?: return .note(id)
        case .notifications?, nil: return FrameRoute(path: path)
        }
    }

    /// What the screens ask beyond routes (ScreenIntent). `close` closes the popover or sheet the content is in.
    static func intents(_ frame: FrameModel, close: (@MainActor () -> Void)? = nil) -> ScreenIntents {
        ScreenIntents { [weak frame] intent in
            guard let frame else { return }
            switch intent {
            case .openTasks(let v): frame.open(.tasks(v))
            case .openCalendar(let d): frame.open(.calendar(d))
            case .openNote(let id, _):
                // The block (a task's to-do, a match in a file) needs note.show { blockId } (requested, R8.10).
                frame.open(.note(id))
            case .openRoute(let r): frame.open(webRoute(r))
            case .openSettings(let section): frame.host?.frameOpenSettings(section: section)
            case .help: frame.host?.frameOpenHelp()
            case .switchPlace(let id, let ws): frame.host?.frameSwitchPlace(id, space: ws)
            case .newWorkspace: FrameDialogs.newWorkspace(frame)
            case .signInAnotherAccount: frame.host?.frameSignInAnotherAccount()
            case .moveOrCopy: frame.host?.frameMoveOrCopy()
            case .signOut(let place): if let p = place ?? frame.session.value?.place { frame.host?.frameSignOutConfirmed(place: p) }
            case .downloadFile(let id): frame.host?.frameDownloadFile(id)
            case .dismiss: break
            @unknown default: break
            }
            if case .dismiss = intent { close?() } else if intentCloses(intent) { close?() }
        }
    }

    private static func intentCloses(_ i: ScreenIntent) -> Bool {
        switch i {
        case .openTasks, .openCalendar, .openNote, .openRoute, .openSettings, .help, .switchPlace, .moveOrCopy, .signInAnotherAccount: return true
        default: return false
        }
    }

    static func navigator(_ frame: FrameModel) -> ScreenNavigator {
        ScreenNavigator(open: { [weak frame] r, _ in
            guard let frame else { return }
            if let route = route(r) {
                frame.open(route)
                return
            }
            switch r {
            case .movePlaces: frame.host?.frameMoveOrCopy()
            case .invite: frame.host?.frameOpenSettings(section: "members")
            case .shareFolder(let id, let name): FrameDialogs.folderShare(frame, folderId: id, name: name)
            case .places, .notifications: frame.toast("They're at the bottom of the sidebar: the account button and the bell.")
            case .foliAI: frame.askAI()
            default: break
            }
        }, prepareNote: { [weak frame] id in
            frame?.prepare(id)
        })
    }
}

struct ScreenRoot: View {
    let model: FrameModel
    let models: ScreenModels
    let route: FrameRoute
    @Environment(\.colorScheme) private var scheme
    /// The native look (docs/MAC_NATIVE_LOOK.md): the Mac's and the iPad's wide layout's; false where this stands
    /// for the iPhone's screens (DeskScreen) or the web-matched layout in tests.
    @Environment(\.macNativeLook) private var native

    /// The room the card's top bar takes: the screen starts below it.
    private var barRoom: CGFloat {
        #if os(iOS)
        // The iPad's bar sits above the screen in the card (IPadScreenBar), not over it: no room to leave.
        if native { return 0 }
        #endif
        return native ? model.barHeight : ContentViewController.barHeight
    }

    /// The screen's own fill, under the bar too. The native look: the card's opaque fill (controlBackgroundColor).
    @ViewBuilder private var fill: some View {
        if native {
            MacLook.Colors.container
        } else {
            webFill
        }
    }

    @ViewBuilder private var webFill: some View {
        Folevi.color.canvas
        if MoreScreen.clear(route) { WebStyles.named("frame.content").resolve(scheme).background.color }
    }

    var body: some View {
        Group {
            switch route {
            case .home: WebHomeScreen(frame: model, home: models.homeModel(), list: models.list(NotesListKind(.all)), allFolders: models.allFolderCards())
            case .notes(let v): WebNoteBrowser(frame: model, model: models.list(NotesListKind(v)))
            case .folder(let id): WebNoteBrowser(frame: model, model: models.list(.folder(id)))
            case .tag(let id): WebNoteBrowser(frame: model, model: models.list(.tag(id)))
            case .web("/folders"): WebFoldersIndex(frame: model, home: models.homeModel(), allFolders: models.allFolderCards())
            case .web("/tags"): WebTagsIndex(frame: model, tags: models.tagsIndex())
            case .shared: SharedWithMeScreen(model: models.more.sharedModel(), frame: model)
            case .changes: ChangesWebScreen(model: models.more.changesModel(), frame: model)
            case .catchUp: CatchUpScreen(model: model)
            case .search: SearchScreen(model: models.searchModel(), showsCancel: false)
            case .tasks: WebTasksScreen(model: models.tasksModel(), frame: model)
            case .calendar: WebCalendarScreen(model: models.calendarModel(), frame: model)
            // The Vault (Vault/VaultScreen.swift); /vault/<section> opens a section.
            case .web(let path) where path == "/vault" || path.hasPrefix("/vault/"): VaultScreen(frame: model, path: path)
            case .web(let path) where route.tabKey == "view:ai":
                AiPageScreen(frame: model, model: models.aiPageModel(), conversationId: path.hasPrefix("/ai/") ? String(path.dropFirst(4)).removingPercentEncoding : nil)
            case .web(let path) where path.hasPrefix("/settings"): SettingsScreen(model: models.settingsModel(), section: MacSettingsSection(path: path))
            case .web(let path): MoreScreen(model: model, more: models.more, path: path)
            case .note: Color.clear
            }
        }
        .id(route.tabKey)
        // The bar's room (the web's main: padding-top 56; the native look's MacLook.barHeight): a screen starts below
        // the bar and its scrolling content runs on under it.
        .safeAreaPadding(.top, barRoom)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        // Help, Graph, Reviews and shared folders show the content card through (the web's main is clear): the card's
        // own fill drawn here, since the note page waiting behind the screens has its own canvas over the card's.
        // (Drawn to the card's top edge, under the glass bar too: on an iPad the padded safe area left a white band
        // of the card's own fill above the screen's canvas.)
        // The card's fill is 90% opaque (the web's glass), so it's laid over the canvas: on its own the note page
        // waiting behind showed through (Foli DNA over a note's title, body and floating bar, November 2026).
        .background {
            ZStack { fill }
                .ignoresSafeArea()
                .contentShape(Rectangle())
        }
        // Another place or space: the screen crossfades instead of cutting.
        .placeCrossfade("\(model.session.value?.place ?? "")|\(model.session.value?.space ?? "")")
        .environment(\.screenNavigator, FrameNavigation.navigator(model))
        .environment(\.screenIntents, FrameNavigation.intents(model))
        .environment(\.screenFeedback, models.feedback)
        .environment(\.macBarRoom, barRoom)
        // The screen's own controls go up into the card's glass controls (CardItems.swift), on the native look only.
        .environment(\.cardSlot, native ? CardSlot(frame: model, owner: route.tabKey) : nil)
        // System chrome, Folevi content: the screens' interface parts draw natively (note cards opt out).
        .macNativeChrome()
    }
}

// MARK: the frame's own screens

struct CatchUpScreen: View {
    let model: FrameModel
    @Environment(\.nativeChrome) private var chrome
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // (No title of its own: the bar above already says "Catch me up", the owner, 2026-11-20.)
                let card = model.home.value?.catchUp
                if card?.state == .running {
                    CatchUpCardView(phase: .running, onRefresh: {}, onClose: {}, onSource: { _ in })
                } else if let brief = card?.brief {
                    CatchUpCardView(phase: .ready(brief), onRefresh: { model.runCatchUp() }, onClose: { model.open(.home) }, onSource: { id in model.open(.note(id)) })
                } else {
                    intro(error: card?.error?.message)
                }
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 28)
            .frame(maxWidth: 560, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .accessibilityIdentifier("screen.catchUp")
    }

    /// Before a brief: what Foli AI does here, what the brief holds, and the one button (the owner, 2026-11-20: the
    /// page said "Catch me up" three times and nothing about what it does).
    private func intro(error: String?) -> some View {
        VStack(alignment: .leading, spacing: 22) {
            VStack(alignment: .leading, spacing: 14) {
                // Foli AI's flower on a soft tile in its own colours.
                AiMarkGlyph(size: 34)
                    .frame(width: 64, height: 64)
                    .background(
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .fill(LinearGradient(colors: [Color(red: 0.55, green: 0.42, blue: 0.95).opacity(scheme == .dark ? 0.22 : 0.12),
                                                          Color(red: 0.98, green: 0.42, blue: 0.55).opacity(scheme == .dark ? 0.18 : 0.10)],
                                                 startPoint: .topLeading, endPoint: .bottomTrailing))
                    )
                    .accessibilityHidden(true)
                Text("Your week in one short read")
                    .font(.system(.title2, weight: .semibold))
                    .foregroundStyle(Folevi.color.heading)
                    .accessibilityAddTraits(.isHeader)
                Text("Foli AI reads the notes you wrote or changed this week and the tasks that are due, then writes you a short brief.")
                    .font(.system(.body))
                    .foregroundStyle(Folevi.color.inkMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            VStack(alignment: .leading, spacing: 14) {
                row(.pencilLine, "What changed", "The notes you wrote or edited, a few lines each.")
                row(.calendarClock, "What’s due", "Tasks that are due soon or overdue.")
                row(.link, "Where it came from", "Every point links to its note.")
            }
            .padding(16)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Folevi.color.ink.opacity(scheme == .dark ? 0.06 : 0.035)))
            if let error {
                Label { Text(error).fixedSize(horizontal: false, vertical: true) } icon: { WebIconView(.triangleAlert, size: 16, strokeWidth: 2) }
                    .font(.system(.callout))
                    .foregroundStyle(Color.red)
                    .accessibilityIdentifier("catchup.error")
            }
            VStack(alignment: .leading, spacing: 10) {
                runButton(error == nil ? "Write my brief" : "Try again")
                Text("Foli AI writes it only when you ask.")
                    .font(.system(.footnote))
                    .foregroundStyle(Folevi.color.inkFaint)
            }
        }
    }

    private func row(_ icon: WebIcon, _ title: String, _ detail: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            WebIconView(icon, size: 18, strokeWidth: 1.9)
                .foregroundStyle(Folevi.color.heading)
                .frame(width: 22, height: 22)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.system(.callout, weight: .semibold)).foregroundStyle(Folevi.color.heading)
                Text(detail).font(.system(.callout)).foregroundStyle(Folevi.color.inkMuted).fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func runButton(_ title: String) -> some View {
        let label = HStack(spacing: 8) {
            AiMarkGlyph(size: 18).accessibilityHidden(true)
            Text(title).font(.system(.body, weight: .semibold))
        }
        if let chrome {
            // The Mac's native look: the page's one prominent action.
            Button { model.runCatchUp() } label: { label.modifier(NativeAccentInk(chrome)) }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .tint(chrome.accent)
                .accessibilityIdentifier("catchup.run")
        } else {
            Button { model.runCatchUp() } label: {
                label
                    .foregroundStyle(Folevi.color.canvas)
                    .padding(.horizontal, 22)
                    .frame(height: 48)
                    .frame(maxWidth: 360)
                    .background(Capsule().fill(Folevi.color.heading))
                    .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .webBrightHover()
            .accessibilityIdentifier("catchup.run")
        }
    }
}

struct Placeholder: View {
    let symbol: String
    let title: String
    let message: String
    var body: some View {
        EmptyState(systemImage: symbol, title: title, message: message)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
#endif
