// The native screens a Mac window shows outside a note: the shared SwiftUI screens (FoleviScreens: Home, every
// note list and folder, Shared with me, Changes, Tasks, Calendar, Search), given the frame's navigator (routes
// become tabs), intents (places, Settings, sign-in, notes at a block) and feedback (toasts), plus Catch me up on
// its own screen.
#if os(macOS)
import SwiftUI
import FoleviDesign
import FoleviEngine
import FoleviScreens

/// The drag types (plan 5.5), as FoleviScreens' DragItems carry them: JSON of NoteDragItem / FolderDragItem.
public enum FrameDrag {
    public static let noteType = "com.folevi.note-ref"
    public static let folderType = "com.folevi.folder-ref"

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
    /// Every folder as a card (Home's Recent folders, the Folders page).
    private var allFolders: ValueStore<FolderCardsValue>?

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
        case .allFolders: return .home
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
            case .newWorkspace: frame.host?.frameOpenSettings(section: "workspace")
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
            case .places, .notifications: frame.toast("They're at the bottom of the sidebar: the account button and the bell.")
            case .foliAI: frame.toast("The Foli AI chat comes to the Mac with the next update.")
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

    var body: some View {
        Group {
            switch route {
            case .home: WebHomeScreen(frame: model, home: models.homeModel(), list: models.list(NotesListKind(.all)), allFolders: models.allFolderCards())
            case .notes(let v): WebNoteBrowser(frame: model, model: models.list(NotesListKind(v)))
            case .folder(let id): WebNoteBrowser(frame: model, model: models.list(.folder(id)))
            case .tag(let id): WebNoteBrowser(frame: model, model: models.list(.tag(id)))
            case .web("/folders"): WebFoldersIndex(frame: model, home: models.homeModel(), allFolders: models.allFolderCards())
            case .web("/tags"): WebTagsIndex(frame: model)
            case .shared: SharedListScreen(model: models.sharedModel())
            case .changes: ChangesScreen(model: models.changesModel())
            case .catchUp: CatchUpScreen(model: model)
            case .search: SearchScreen(model: models.searchModel(), showsCancel: false)
            case .tasks: WebTasksScreen(model: models.tasksModel(), frame: model)
            case .calendar: WebCalendarScreen(model: models.calendarModel(), frame: model)
            // The Vault (Vault/VaultScreen.swift); /vault/<section> opens a section.
            case .web(let path) where path == "/vault" || path.hasPrefix("/vault/"): VaultScreen(frame: model, path: path)
            case .web(let path): Placeholder(symbol: "globe", title: "Not here yet", message: "\(path) doesn't have a screen in the Mac app yet.")
            case .note: Color.clear
            }
        }
        .id(route.tabKey)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        // Foli AI's floating launcher over Home and the note lists (the web's AskAiLauncher).
        .overlay(alignment: .bottomTrailing) {
            if model.session.value?.capabilities.ai == true, WebAskFoliPill.shows(on: route) {
                WebAskFoliPill { model.open(.web("/ai")) }
                    .padding(WebAskFoliPill.inset)
            }
        }
        .background(Folevi.color.canvas)
        // Another place or space: the screen crossfades instead of cutting.
        .placeCrossfade("\(model.session.value?.place ?? "")|\(model.session.value?.space ?? "")")
        .environment(\.screenNavigator, FrameNavigation.navigator(model))
        .environment(\.screenIntents, FrameNavigation.intents(model))
        .environment(\.screenFeedback, models.feedback)
    }
}

// MARK: the frame's own screens

struct CatchUpScreen: View {
    let model: FrameModel
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Catch me up").font(FoleviFonts.font(.display, size: 28, weight: .semibold)).foregroundStyle(Folevi.color.heading)
                let card = model.home.value?.catchUp
                if card?.state == .running {
                    CatchUpCardView(phase: .running, onRefresh: {}, onClose: {}, onSource: { _ in })
                } else if let brief = card?.brief {
                    CatchUpCardView(phase: .ready(brief), onRefresh: { model.runCatchUp() }, onClose: { model.open(.home) }, onSource: { id in model.open(.note(id)) })
                } else {
                    Text(card?.error?.message ?? "Foli AI reads what changed this week and sums it up.").foleviFont(.callout).foregroundStyle(Folevi.color.inkMuted)
                    Button("Catch me up") { model.runCatchUp() }.buttonStyle(.folevi(.primary, size: .medium))
                        .accessibilityIdentifier("catchup.run")
                }
            }
            .padding(32)
            .frame(maxWidth: 760, alignment: .leading)
        }
        .accessibilityIdentifier("screen.catchUp")
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
