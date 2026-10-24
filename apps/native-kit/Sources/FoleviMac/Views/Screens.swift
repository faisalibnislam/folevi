// The native screens a Mac window shows outside a note: the shared SwiftUI screens (FoleviScreens, N7: Home,
// every note list and folder, Shared with me, Changes), given the frame's navigator (routes become tabs) and
// feedback (toasts), plus the frame's own small screens for what no package has built yet: Catch me up on its
// own, search over the notes, and quiet placeholders for Tasks and Calendar (N10).
#if os(macOS)
import SwiftUI
import FoleviDesign
import FoleviEngine
import FoleviScreens

/// The drag types (plan 5.5), as FoleviScreens' DragItems carry them: JSON of NoteDragItem / FolderDragItem.
public enum FrameDrag {
    public static let noteType = "com.folevi.note-ref"
    public static let folderType = "com.folevi.folder-ref"

    /// The note ids on a pasteboard item (FoleviScreens' JSON, or a bare id from older sources).
    static func noteId(_ item: NSPasteboardItem) -> String? {
        if let data = item.data(forType: .init(noteType)) {
            if let d = try? JSONDecoder().decode(NoteDragItem.self, from: data) { return d.id }
            if let s = String(data: data, encoding: .utf8), !s.isEmpty, !s.hasPrefix("{") { return s }
        }
        return nil
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

    /// The note list on screen for a route, when it has been shown.
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
        case .web(let path): return FrameRoute(path: path)
        case .notifications, .places, .foliAI, .invite, .movePlaces: return nil
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
            case .places, .notifications: frame.toast("Use the account button at the bottom of the sidebar.")
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
            case .home: HomeScreen(model: models.homeModel(), showsHeader: true)
            case .notes(let v): NotesListScreen(model: models.list(NotesListKind(v)))
            case .folder(let id): NotesListScreen(model: models.list(.folder(id)))
            case .tag(let id): NotesListScreen(model: models.list(.tag(id)))
            case .shared: SharedListScreen(model: models.sharedModel())
            case .changes: ChangesScreen(model: models.changesModel())
            case .catchUp: CatchUpScreen(model: model)
            case .search(let q): SearchScreen(model: model, text: q)
            case .tasks: Placeholder(symbol: "checklist", title: "Tasks", message: "Your tasks will be listed here.")
            case .calendar: Placeholder(symbol: "calendar", title: "Calendar", message: "Your week and month will show here.")
            case .web(let path): Placeholder(symbol: "globe", title: "Not here yet", message: "\(path) doesn't have a screen in the Mac app yet.")
            case .note: Color.clear
            }
        }
        .id(route)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Folevi.color.canvas)
        .environment(\.screenNavigator, FrameNavigation.navigator(model))
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

/// Search over the place: the engine's `search` (revision 4), else (an older engine) the loaded notes of All notes
/// filtered by their title and first lines.
@MainActor
@Observable
final class SearchState {
    var hits: [SearchHit]?
    var store: ListStore<NoteRow>?
}

struct SearchScreen: View {
    let model: FrameModel
    let text: String
    @State private var state = SearchState()

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(text.isEmpty ? "Search" : "Results for \u{201C}\(text)\u{201D}").font(FoleviFonts.font(.display, size: 24, weight: .semibold)).foregroundStyle(Folevi.color.heading)
                .padding(.horizontal, 32).padding(.top, 24)
            ScrollView {
                RowGroup {
                    ForEach(results, id: \.id) { r in
                        Button { model.open(.note(r.id), title: r.title, icon: r.icon) } label: {
                            ListRow(r.title.isEmpty ? "Untitled" : r.title, subtitle: r.snippet) {
                                if let icon = r.icon, !icon.isEmpty { Text(icon).frame(width: 22) } else { RowIcon("doc.text") }
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 32)
                if results.isEmpty, state.hits != nil || state.store?.status == .live {
                    EmptyState(systemImage: "magnifyingglass", title: "No results", message: "Nothing matches \u{201C}\(text)\u{201D}.").padding(.top, 40).frame(maxWidth: .infinity)
                }
            }
        }
        .task(id: text) {
            if let v = try? await model.client.query(.search(text: text)) {
                state.hits = v.hits
            } else {
                state.hits = nil
                if state.store == nil { state.store = model.client.watchList(.notesList(view: .all)) }
            }
        }
        .accessibilityIdentifier("screen.search")
    }

    private struct Result: Identifiable {
        var id: String
        var title: String
        var icon: String?
        var snippet: String
    }

    private var results: [Result] {
        if let hits = state.hits { return hits.map { Result(id: $0.id, title: $0.title, icon: $0.icon, snippet: $0.snippet) } }
        let rows = state.store?.rows ?? []
        return rows.filter { text.isEmpty || $0.title.localizedCaseInsensitiveContains(text) || $0.excerpt.localizedCaseInsensitiveContains(text) }
            .map { Result(id: $0.id, title: $0.title, icon: $0.icon, snippet: $0.excerpt) }
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
