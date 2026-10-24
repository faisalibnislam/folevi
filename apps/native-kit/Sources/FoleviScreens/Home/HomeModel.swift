// Home's view model (plan 5.3; web IphoneHome.tsx and HomeDashboard.tsx): the `home` view (recents, Catch me
// up, counted rows, starred, top-level folders, tags) plus `session` (who, the space, what's allowed),
// `places.list` (the bell's unread count), `sync.status` and `folders.tree` (the nesting rules for drops and
// "New folder inside"). Every value comes from the engine; the launch snapshot draws the last Home at once.
import Foundation
import Observation
import FoleviDesign
import FoleviEngine

@MainActor
@Observable
public final class HomeModel {
    public let client: EngineClient
    public let actions: NoteActions
    public let home: ValueStore<HomeValue>
    public let session: ValueStore<SessionValue>
    public let places: ValueStore<PlacesValue>
    public let sync: ValueStore<SyncStatusValue>
    public let tree: ValueStore<FoldersTreeValue>
    /// The folder menu's open dialog (rename, new folder, move, delete), shared by the screen and its toolbar.
    public let dialogs = FolderDialogState()

    /// The Catch me up command's own state while it runs (the `home` view's `catchUp` is the truth otherwise).
    public private(set) var catchUpRunning = false
    public private(set) var catchUpError: EngineError?
    public private(set) var refreshing = false

    public init(client: EngineClient, feedback: ScreenFeedback = ScreenFeedback(), space: SpaceRef? = nil) {
        self.client = client
        self.actions = NoteActions(client: client, feedback: feedback, space: space)
        let key = "home.\(client.place).\(space ?? "current")"
        self.home = client.watch(.home(space: space), snapshotKey: key)
        self.session = client.watch(.session, snapshotKey: "session.\(client.place)")
        self.places = client.watch(.placesList)
        self.sync = client.watch(.syncStatus)
        self.tree = client.watch(.foldersTree(space: space))
    }

    // MARK: What the screen shows

    public var value: HomeValue? { home.value }
    public var isLoading: Bool { home.value == nil }
    public var recentsLoaded: Bool { home.value?.recentsLoaded ?? false }

    public var recents: [NoteRow] {
        (home.value?.recents ?? []).filter { !actions.isHidden($0.id) }
    }

    public var recentCards: [NoteCardModel] {
        recents.map { CardMapping.noteCard($0, starred: actions.isStarred($0)) }
    }

    /// "Personal" or the workspace's name: only a workspace names itself above the title (as the web does).
    public var eyebrow: String? {
        guard let s = session.value, let space = s.spaces.first(where: { $0.id == s.space }), space.kind == .workspace else { return nil }
        return space.name
    }

    public var spaceName: String { home.value?.spaceName ?? "Personal" }
    public var searchPrompt: String { "Search in \(spaceName)" }

    public var currentSpace: SpaceInfo? {
        guard let s = session.value else { return nil }
        return s.spaces.first { $0.id == s.space }
    }

    public var canEdit: Bool { currentSpace?.canEdit ?? true }
    public var aiOn: Bool { session.value?.capabilities.ai ?? false }
    /// Home's "…" offers Graph when Foli AI's graph is available.
    public var graphOn: Bool { session.value?.capabilities.graph ?? false }
    public var locked: Bool { currentSpace?.locked ?? false }

    public var unread: Int {
        guard let p = places.value else { return 0 }
        return p.places.first { $0.id == p.current }?.unread ?? 0
    }

    public var profileName: String { session.value?.profile.name ?? "" }

    public var syncIndicator: SyncIndicator? { sync.value.map(CardMapping.sync) }

    /// The rows under the recents: All notes, Drafts, Shared with Me, Changes, Reviews (the engine leaves out
    /// what this place doesn't offer; counts of zero show none, as the web does).
    public var rows: [HomeRow] { home.value?.rows ?? [] }

    public func count(_ row: HomeRow) -> Int? {
        guard let c = row.count, c > 0 else { return nil }
        return c
    }

    public static func symbol(for row: HomeRow.Id) -> String {
        switch row {
        case .notes: "doc.on.doc"
        case .drafts: "tray"
        case .shared: "person.2"
        case .changes: "arrow.triangle.2.circlepath.doc.on.clipboard"
        case .reviews: "rectangle.stack"
        }
    }

    public var starred: [NoteRow] {
        (home.value?.starred.rows ?? []).filter { !actions.isHidden($0.id) && actions.isStarred($0) }.prefix(6).map { $0 }
    }

    public var moreStarred: Bool { home.value?.starred.more ?? false }

    public var folders: [FolderCard] { home.value?.folders ?? [] }
    public var folderCards: [FolderCardModel] { folders.map { CardMapping.folderCard($0) } }
    public var tags: [TagRow] { home.value?.tags ?? [] }

    /// Folder links for the nesting rules (the tree when it has answered, else Home's top-level folders).
    public var folderLinks: [FolderRules.Link] {
        if let t = tree.value { return FolderRules.links(t.folders) }
        return folders.map { FolderRules.Link(id: $0.id, parentId: $0.parentId) }
    }

    // MARK: Catch me up

    public enum CatchUpPhase: Equatable, Sendable {
        case hidden
        /// One row: "Catch me up".
        case offer(error: String?)
        case running
        case ready(CatchUpBrief)
    }

    public var catchUp: CatchUpPhase {
        guard let card = home.value?.catchUp, card.available else { return .hidden }
        if catchUpRunning || card.state == .running { return .running }
        if card.state == .ready, let brief = card.brief { return .ready(brief) }
        let error = catchUpError ?? (card.state == .error ? card.error : nil)
        return .offer(error: error?.message)
    }

    public func runCatchUp() async {
        guard !catchUpRunning else { return }
        catchUpRunning = true
        catchUpError = nil
        defer { catchUpRunning = false }
        do {
            let card = try await client.command(.catchUpRun(space: actions.space))
            if card.state == .error { catchUpError = card.error }
        } catch let EngineFailure.engine(e) {
            catchUpError = e
        } catch {
            catchUpError = EngineError(code: "failed", message: ScreenErrors.message(error))
        }
    }

    public func closeCatchUp() async {
        catchUpError = nil
        do { try await client.command(.catchUpClear(space: actions.space)) } catch { actions.report(error) }
    }

    // MARK: Pull to refresh

    public func refresh() async {
        refreshing = true
        defer { refreshing = false }
        do { try await client.command(.engineRefresh) } catch { actions.report(error) }
    }

    /// Off screen for a minute pauses the views; back on screen resumes them (plan 3.2).
    public func setVisible(_ visible: Bool) {
        home.setVisible(visible)
        places.setVisible(visible)
        tree.setVisible(visible)
    }

    // MARK: Drops

    /// Notes dropped on a folder card move into it.
    public func dropNotes(_ items: [NoteDragItem], on folder: FolderCard) async {
        let ids = items.map(\.id)
        var from: [String: String?] = [:]
        for item in items { from[item.id] = item.folderId }
        await actions.move(ids, to: FolderTarget(id: folder.id, name: folder.name), from: from)
    }

    /// A folder dropped on a folder card: before, inside or after it (by where on the card), or on the section
    /// itself (`target` nil): the top level.
    public func dropFolder(_ item: FolderDragItem, on target: FolderCard?, zone: FolderRules.Zone) async {
        await FolderDrops.drop(item, targetId: target?.id, targetName: target?.name, zone: zone, links: folderLinks, actions: actions)
    }
}

enum FolderDrops {
    @MainActor
    static func drop(_ item: FolderDragItem, targetId: String?, targetName: String?, zone: FolderRules.Zone, links: [FolderRules.Link], actions: NoteActions) async {
        switch FolderRules.resolveDrop(links, dragged: item.id, target: targetId, zone: zone) {
        case .refused(let problem):
            actions.feedback.haptic(.error)
            actions.feedback.toast(ScreenToast(FolderRules.message(problem), tone: .error))
        case .move(_, changed: false):
            return
        case .move(let place, changed: true):
            let message = place.parentId == nil ? (zone == .inside ? "Moved to the top level" : "Moved") : (zone == .inside ? "Moved to \(targetName ?? "the folder")" : "Moved")
            await actions.moveFolder(item.id, to: place, message: message)
        }
    }
}
