// View model tests against a scripted engine fed by the web's contract fixtures: what Home and the lists show,
// what each action sends, optimistic changes and their rollback, windowing, Select mode, and the folder rules.
import Foundation
import Testing
@testable import FoleviDesign
@testable import FoleviEngine
@testable import FoleviScreens

@Suite("Home model") @MainActor
struct HomeModelTests {
    @Test func fillsFromTheHomeFixture() async {
        let engine = FakeEngine()
        let model = HomeModel(client: engine.client())
        await eventually("home") { model.value != nil && model.session.value != nil && model.places.value != nil }
        #expect(model.recents.count == 10)
        #expect(model.recentCards.first?.title == "Kyoto in November")
        #expect(model.recentCards.first?.cover == .theme("art-03"))
        #expect(model.rows.map(\.id) == [.notes, .drafts, .shared, .changes, .reviews])
        #expect(model.folders.map(\.id) == ["fld_trips", "fld_work", "fld_reading"])
        #expect(model.starred.count == 3)
        #expect(model.eyebrow == nil, "Personal doesn't name itself above the title")
        #expect(model.searchPrompt == "Search in Personal")
        #expect(model.canEdit)
        if case .ready(let brief) = model.catchUp { #expect(!brief.sources.isEmpty) } else { Issue.record("catch up isn't ready: \(model.catchUp)") }
        let unread = Fixtures.decode(PlacesValue.self, "view.places.list.json")
        #expect(model.unread == (unread.places.first { $0.id == unread.current }?.unread ?? 0))
    }

    @Test func aWorkspaceNamesItselfAboveTheTitle() async {
        let engine = FakeEngine()
        var session = Fixtures.decode(SessionValue.self, "view.session.json")
        session.space = "ws_studio"
        engine.values["session"] = try! JSONValue.from(session)
        let model = HomeModel(client: engine.client())
        await eventually { model.session.value != nil }
        #expect(model.eyebrow == session.spaces.first { $0.id == "ws_studio" }?.name)
    }

    @Test func emptyHomeShowsNoCountsAndOffersCatchUp() async {
        let engine = FakeEngine()
        engine.values["home"] = Fixtures.value("view.home.empty.json")
        let model = HomeModel(client: engine.client())
        await eventually { model.value != nil }
        #expect(model.recents.isEmpty)
        #expect(model.folders.isEmpty)
        #expect(model.rows.allSatisfy { model.count($0) == nil })
    }

    @Test func catchUpRunsTheCommandAndShowsItsError() async {
        let engine = FakeEngine()
        var home = Fixtures.decode(HomeValue.self, "view.home.json")
        home.catchUp = CatchUpCard(available: true, state: .idle, brief: nil, error: nil)
        engine.values["home"] = try! JSONValue.from(home)
        engine.onCommand = { name, _ in
            if name == "catchUp.run" { throw EngineFailure.engine(EngineError(code: "no_credits", message: "You're out of AI credits.")) }
            return .object(["ok": .bool(true)])
        }
        let model = HomeModel(client: engine.client())
        await eventually { model.value != nil }
        #expect(model.catchUp == .offer(error: nil))
        await model.runCatchUp()
        #expect(engine.commands(named: "catchUp.run").count == 1)
        #expect(model.catchUp == .offer(error: "You're out of AI credits."))
    }

    @Test func droppingNotesOnAFolderMovesThem() async throws {
        let engine = FakeEngine()
        let log = FeedbackLog()
        let model = HomeModel(client: engine.client(), feedback: log.feedback)
        await eventually { model.value != nil }
        let work = try #require(model.folders.first { $0.id == "fld_work" })
        await model.dropNotes([NoteDragItem(id: "doc_00001", title: "Kyoto", folderId: "fld_trips")], on: work)
        let sent = engine.commands(named: "note.move")
        #expect(sent.count == 1)
        #expect(sent.first?["folderId"]?.string == "fld_work")
        #expect(log.toasts.last?.message == "Moved to Work")
        #expect(log.toasts.last?.actionTitle == "Undo")
    }

    @Test func droppingAFolderIntoItsOwnSubfolderIsRefused() async {
        let engine = FakeEngine()
        let log = FeedbackLog()
        let model = HomeModel(client: engine.client(), feedback: log.feedback)
        await eventually { model.tree.value != nil && model.value != nil }
        await FolderDrops.drop(FolderDragItem(id: "fld_trips", name: "Trips", parentId: nil), targetId: "fld_kyoto", targetName: "Kyoto", zone: .inside, links: model.folderLinks, actions: model.actions)
        #expect(engine.commands(named: "folder.move").isEmpty)
        #expect(log.toasts.last?.tone == .error)
        #expect(log.haptics.contains(.error))
    }
}

@Suite("Note actions") @MainActor
struct NoteActionsTests {
    @Test func starIsOptimisticAndRollsBackWhenRefused() async {
        let engine = FakeEngine()
        let log = FeedbackLog()
        engine.onCommand = { _, _ in throw EngineFailure.engine(EngineError(code: "forbidden", message: "You can't change this note.")) }
        let actions = NoteActions(client: engine.client(), feedback: log.feedback)
        let row = try! makeRows(1)[0].decode(NoteRow.self)
        let task = Task { await actions.star([row.id], !row.starred) }
        await eventually { actions.starOverrides[row.id] != nil || engine.commands(named: "note.star").count == 1 }
        await task.value
        #expect(actions.isStarred(row) == row.starred, "rolled back")
        #expect(log.toasts.last?.message == "You can't change this note.")
        #expect(log.toasts.last?.tone == .error)
    }

    @Test func movingToDraftsSendsAnExplicitNull() async {
        let engine = FakeEngine()
        let actions = NoteActions(client: engine.client())
        await actions.move(["n00001"], to: .drafts)
        let args = engine.commands(named: "note.move").first
        #expect(args?["folderId"] == .null, "the engine refuses a missing folderId")
    }

    @Test func trashHidesAtOnceAndOffersUndo() async {
        let engine = FakeEngine()
        let log = FeedbackLog()
        let actions = NoteActions(client: engine.client(), feedback: log.feedback)
        actions.settleAfter = .milliseconds(50)
        await actions.trash(["n00001", "n00002"])
        #expect(actions.isHidden("n00001"))
        #expect(log.toasts.last?.message == "Moved 2 notes to Trash")
        log.toasts.last?.action?()
        await eventually { engine.commands(named: "note.restore").count == 1 }
        await eventually("settled") { !actions.isHidden("n00001") }
    }

    @Test func skippedNotesAreReported() async {
        let engine = FakeEngine()
        let log = FeedbackLog()
        engine.onCommand = { _, _ in .object(["done": .array([.string("a")]), "skipped": .number(1), "queued": .bool(false)]) }
        let actions = NoteActions(client: engine.client(), feedback: log.feedback)
        await actions.archive(["a", "b"], true)
        #expect(log.toasts.contains { $0.message == "1 note couldn’t be changed. You may not have permission." })
        #expect(log.toasts.contains { $0.message == "Archived" })
        #expect(!actions.isHidden("b"), "a skipped note comes straight back")
    }

    @Test func queuedOfflineChangesHaveNoUndo() async {
        let engine = FakeEngine()
        let log = FeedbackLog()
        engine.onCommand = { _, args in .object(["done": args["ids"]!, "skipped": .number(0), "queued": .bool(true)]) }
        let actions = NoteActions(client: engine.client(), feedback: log.feedback)
        await actions.star(["a"], true)
        #expect(log.toasts.last?.message == "Starred")
        #expect(log.toasts.last?.actionTitle == nil)
    }
}

@Suite("Notes list model") @MainActor
struct NotesListModelTests {
    func defaults() -> UserDefaults {
        let d = UserDefaults(suiteName: "folevi.tests.\(UUID().uuidString)")!
        return d
    }

    @Test func windowedRowsAndPlaceholders() async {
        let engine = FakeEngine(rows: 5000)
        let model = NotesListModel(client: engine.client(), kind: NotesListKind(.all), defaults: defaults())
        await eventually { model.total == 5000 }
        let slots = model.slots
        #expect(slots.count == 5000)
        #expect(slots[0].row?.id == "n00000")
        #expect(slots[199].row != nil)
        #expect(slots[200].row == nil, "outside the first window: a placeholder")
        #expect(slots[200].id == "#200")
        // Scrolling to row 1,000 moves the window there.
        for i in 990..<1010 { model.slotAppeared(i) }
        for i in 0..<20 { model.slotDisappeared(i) }
        await eventually("window moved") { model.slots[1000].row != nil }
        #expect(engine.windows.last.map { $0.start <= 990 && $0.start + $0.count >= 1010 } == true)
        #expect(model.store.rows.count <= EngineContract.maxWindowRows)
    }

    @Test func sortAndLayoutAreKeptPerListAndSortRestartsTheView() async {
        let engine = FakeEngine()
        let d = defaults()
        let model = NotesListModel(client: engine.client(), kind: NotesListKind(.unsorted), defaults: d)
        await eventually { model.total == 25 }
        #expect(model.layout == .cards)
        model.layout = .list
        model.sort = .title
        await eventually { engine.watches.values.contains { $0["args"]?["sort"]?.string == "title" } }
        let again = NotesListModel(client: engine.client(), kind: NotesListKind(.unsorted), defaults: d)
        #expect(again.layout == .list)
        #expect(again.sort == .title)
        let trash = NotesListModel(client: engine.client(), kind: NotesListKind(.trash), defaults: d)
        #expect(trash.layout == .list, "Trash and Archive start as lists")
        #expect(!trash.sortOptions.contains { $0.0 == .manual })
    }

    @Test func filterNarrowsTheLoadedRows() async {
        let engine = FakeEngine()
        let model = NotesListModel(client: engine.client(), kind: NotesListKind(.all), defaults: defaults())
        await eventually { model.total == 25 }
        model.filter = "kyoto"
        #expect(model.slots.compactMap(\.row?.title).allSatisfy { $0.lowercased().contains("kyoto") })
        #expect(!model.slots.isEmpty)
        await eventually("the engine filters too") { engine.watches.values.contains { $0["args"]?["filter"]?.string == "kyoto" } }
        model.filter = "zzz-nothing"
        #expect(model.slots.isEmpty)
        #expect(model.filterEmptyTitle == "No notes match “zzz-nothing”")
    }

    @Test func menusFollowTheWeb() async {
        let engine = FakeEngine()
        let model = NotesListModel(client: engine.client(), kind: NotesListKind(.all), defaults: defaults())
        await eventually { model.total == 25 && model.session.value != nil }
        let row = model.loadedRows[1]
        let menu = model.menu(for: row, wide: true).flatMap { $0 }
        #expect(menu.first == .open)
        #expect(menu.contains(.openInNewTab))
        #expect(menu.contains(.move))
        #expect(menu.contains(.duplicate))
        #expect(menu.contains(.copyTo("ws_studio")), "the session has a team workspace to copy to")
        #expect(menu.last == .trash)
        #expect(model.leadingSwipes(row) == [row.starred ? .unstar : .star])
        #expect(model.trailingSwipes(row) == [.trash, .archive, .move])

        let trash = NotesListModel(client: engine.client(), kind: NotesListKind(.trash), defaults: defaults())
        await eventually { trash.total == 25 }
        let trow = trash.loadedRows[0]
        #expect(trash.menu(for: trow, wide: false) == [[.restore, .select], [.deleteForever]])
        #expect(trash.trailingSwipes(trow) == [.deleteForever])
        #expect(trash.bulkActions == [.restore, .deleteForever])
        #expect(trash.screenActions.contains(.emptyTrash))
    }

    @Test func selectModeBulkActions() async {
        let engine = FakeEngine()
        let model = NotesListModel(client: engine.client(), kind: NotesListKind(.all), defaults: defaults())
        await eventually { model.total == 25 }
        model.selecting = true
        model.toggleSelectAll()
        #expect(model.allSelected)
        #expect(model.selectionStatus == "25 selected")
        #expect(model.bulkActions.contains(.copy))
        await model.runBulk(.archive)
        #expect(engine.commands(named: "note.archive").first?["ids"].map { if case .array(let a) = $0 { a.count } else { 0 } } == 25)
        #expect(!model.selecting, "Select mode ends after an action")
        #expect(model.selection.isEmpty)
    }

    @Test func deletingForeverAsksFirst() async {
        let engine = FakeEngine()
        let model = NotesListModel(client: engine.client(), kind: NotesListKind(.trash), defaults: defaults())
        await eventually { model.total == 25 }
        let row = model.loadedRows[0]
        await model.run(.deleteForever, on: row)
        #expect(engine.commands(named: "note.deleteForever").isEmpty)
        let c = try! #require(model.confirmation)
        #expect(model.confirmationText(c).button == "Delete permanently")
        await model.confirm(c)
        #expect(engine.commands(named: "note.deleteForever").count == 1)
    }

    @Test func manualOrderSendsTheNoteItFollows() async {
        let engine = FakeEngine()
        engine.onCommand = { _, _ in .object(["ok": .bool(true)]) }
        let d = defaults()
        d.set("manual", forKey: "folevi.sort.folder")
        let model = NotesListModel(client: engine.client(), kind: .folder("fld_trips"), defaults: d)
        await eventually { model.total == 25 && model.session.value != nil }
        #expect(model.canArrange)
        await model.reorder(from: IndexSet(integer: 3), to: 1)
        let sent = engine.commands(named: "note.reorder").first
        #expect(sent?["id"]?.string == "n00003")
        #expect(sent?["afterId"]?.string == "n00000")
        await model.run(.moveUp, on: model.loadedRows[1])
        #expect(engine.commands(named: "note.reorder").last?["afterId"] == .null, "moved to the top")
    }

    @Test func aFolderScreenShowsItsNameSubfoldersAndOffersNewFolderInside() async {
        let engine = FakeEngine()
        let model = NotesListModel(client: engine.client(), kind: .folder("fld_trips"), defaults: defaults())
        await eventually { model.tree.value != nil && model.session.value != nil }
        #expect(model.title == "Trips")
        #expect(model.subfolders.map(\.id) == ["fld_japan", "fld_iceland"], "from the tree until folders.cards exists")
        #expect(model.screenActions.contains(.newNote))
        #expect(model.screenActions.contains(.newFolderInside))
        #expect(model.moveTargets.first?.target == .drafts)
        let kyoto = NotesListModel(client: engine.client(), kind: .folder("fld_kyoto"), defaults: defaults())
        await eventually { kyoto.tree.value != nil }
        #expect(kyoto.parentFolder?.id == "fld_japan")
    }

    @Test func subfolderCardsComeFromFoldersCardsWhenTheEngineHasIt() async {
        let engine = FakeEngine()
        engine.values["folders.cards"] = Fixtures.value("view.folders.cards.json")
        let model = NotesListModel(client: engine.client(), kind: .folder("fld_trips"), defaults: defaults())
        await eventually { model.subfolderCards?.value != nil && model.tree.value != nil }
        let cards = Fixtures.decode(FolderCardsValue.self, "view.folders.cards.json").folders
        #expect(model.subfolders.map(\.id) == cards.map(\.id))
        #expect(model.subfolders.first?.notes.isEmpty == cards.first?.previews.isEmpty)
    }

    @Test func emptyStatesUseTheWebWording() async {
        let engine = FakeEngine(rows: 0)
        let model = NotesListModel(client: engine.client(), kind: NotesListKind(.unsorted), defaults: defaults())
        await eventually { model.store.status == .live }
        #expect(model.slots.isEmpty)
        #expect(model.empty.title == "No drafts")
        #expect(model.empty.message == "Everything has a folder. Nicely done.")
        let all = NotesListModel(client: engine.client(), kind: NotesListKind(.all), defaults: defaults())
        #expect(all.emptyOffersNewNote)
    }
}

@Suite("Folder rules (folderDrop.ts and editor-schema folders.ts)")
struct FolderRulesTests {
    let tree: [FolderRules.Link] = [
        .init(id: "trips", parentId: nil), .init(id: "japan", parentId: "trips"), .init(id: "kyoto", parentId: "japan"),
        .init(id: "iceland", parentId: "trips"), .init(id: "work", parentId: nil),
    ]

    @Test func zones() {
        #expect(FolderRules.zone(at: 10, length: 100) == .before)
        #expect(FolderRules.zone(at: 50, length: 100) == .inside)
        #expect(FolderRules.zone(at: 90, length: 100) == .after)
        #expect(FolderRules.zone(at: 10, length: 0) == .inside)
    }

    @Test func nestingRules() {
        #expect(FolderRules.moveProblem(tree, id: "trips", into: "trips") == .selfTarget)
        #expect(FolderRules.moveProblem(tree, id: "trips", into: "kyoto") == .descendant)
        #expect(FolderRules.moveProblem(tree, id: "work", into: "kyoto") == nil)
        #expect(FolderRules.moveProblem(tree, id: "work", into: nil) == nil)
        var deep: [FolderRules.Link] = [.init(id: "l1", parentId: nil)]
        for i in 2...5 { deep.append(.init(id: "l\(i)", parentId: "l\(i - 1)")) }
        deep.append(.init(id: "x", parentId: nil))
        deep.append(.init(id: "xchild", parentId: "x"))
        #expect(FolderRules.depth(deep, "l5") == 5)
        #expect(!FolderRules.canNest(deep, in: "l5"))
        #expect(FolderRules.canNest(deep, in: "l4"))
        #expect(FolderRules.moveProblem(deep, id: "x", into: "l4") == .depth, "x and its child need two levels")
        #expect(FolderRules.moveProblem(deep, id: "xchild", into: "l4") == nil)
    }

    @Test func drops() {
        #expect(FolderRules.resolveDrop(tree, dragged: "work", target: "trips", zone: .inside) == .move(.init(parentId: "trips", afterId: "iceland"), changed: true))
        #expect(FolderRules.resolveDrop(tree, dragged: "work", target: "trips", zone: .before) == .move(.init(parentId: nil, afterId: nil), changed: true))
        #expect(FolderRules.resolveDrop(tree, dragged: "trips", target: "work", zone: .after) == .move(.init(parentId: nil, afterId: "work"), changed: true))
        #expect(FolderRules.resolveDrop(tree, dragged: "kyoto", target: nil, zone: .after) == .move(.init(parentId: nil, afterId: "work"), changed: true), "un-nesting to the top level, last")
        #expect(FolderRules.resolveDrop(tree, dragged: "trips", target: "trips", zone: .before) == .move(.init(parentId: nil, afterId: nil), changed: false))
        #expect(FolderRules.resolveDrop(tree, dragged: "trips", target: "trips", zone: .inside) == .refused(.selfTarget))
        #expect(FolderRules.resolveDrop(tree, dragged: "trips", target: "japan", zone: .inside) == .refused(.descendant))
        #expect(FolderRules.resolveDrop(tree, dragged: "iceland", target: "japan", zone: .before) == .move(.init(parentId: "trips", afterId: nil), changed: true), "reordering among siblings")
    }
}

@Suite("Folder menu")
struct FolderMenuTests {
    let links: [FolderRules.Link] = [.init(id: "a", parentId: nil), .init(id: "b", parentId: "a")]

    @Test func everythingForAnEditorOfATeamWorkspace() {
        let ctx = FolderMenuContext(canEdit: true, inviteSpace: "ws", aiOn: true, otherPlaces: true, links: links)
        let items = FolderMenuItem.groups(for: MenuFolder(id: "b", name: "B", parentId: "a", color: nil), in: ctx).flatMap { $0 }
        #expect(items == [.newNote, .newFolderInside, .rename, .color, .move, .movePlaces, .moveToTop, .askAI, .copyLink, .invite, .delete])
        #expect(items.map(\.title).contains("Ask Foli AI about this folder…"))
    }

    @Test func aReaderGetsOnlyTheLink() {
        let ctx = FolderMenuContext(canEdit: false, inviteSpace: nil, aiOn: false, otherPlaces: false, links: links)
        #expect(FolderMenuItem.groups(for: MenuFolder(id: "a", name: "A", parentId: nil, color: nil), in: ctx) == [[.copyLink]])
    }

    @Test func noMoveToTopForATopLevelFolder() {
        let ctx = FolderMenuContext(canEdit: true, inviteSpace: nil, aiOn: false, otherPlaces: false, links: links)
        let items = FolderMenuItem.groups(for: MenuFolder(id: "a", name: "A", parentId: nil, color: nil), in: ctx).flatMap { $0 }
        #expect(!items.contains(.moveToTop))
        #expect(!items.contains(.invite), "Personal has no members to invite")
        #expect(ctx.subfolderCount("a") == 1)
    }
}

@Suite("Routes and mapping")
struct RoutesAndMappingTests {
    @Test func webRoutes() {
        #expect(ScreenRoute(webRoute: "/notes") == .notes(.all))
        #expect(ScreenRoute(webRoute: "/drafts") == .notes(.unsorted))
        #expect(ScreenRoute(webRoute: "/shared") == .shared)
        #expect(ScreenRoute(webRoute: "/changes") == .changes)
        #expect(ScreenRoute(webRoute: "/review") == .reviews)
        #expect(ScreenRoute(webRoute: "/folders/fld_1") == .folder(id: "fld_1"))
        #expect(ScreenRoute(webRoute: "/folders") == .allFolders)
        #expect(ScreenRoute(webRoute: "/d/doc_1?x=1") == .note(id: "doc_1"))
        #expect(ScreenRoute(webRoute: "/tasks/today") == .web("/tasks/today"))
    }

    @Test func coversAndSync() {
        #expect(CardMapping.cover(CardCover(kind: "theme", value: "art-03")) == .theme("art-03"))
        #expect(CardMapping.cover(CardCover(kind: "theme", value: "nope")) == .plain)
        #expect(CardMapping.cover(CardCover(kind: "none")) == .plain)
        #expect(CardMapping.cover(CardCover(kind: "image", value: "x")) == .plain)
        let offline = Fixtures.decode(SyncStatusValue.self, "view.sync.status.offline.json")
        if case .offline = CardMapping.sync(offline) {} else { Issue.record("offline maps to \(CardMapping.sync(offline))") }
    }

    @Test func trashTimeReadsDeleted() throws {
        let row = try makeRows(1)[0].decode(NoteRow.self)
        let now = Date(timeIntervalSince1970: row.updatedAt / 1000 + 2 * 86400)
        #expect(CardMapping.timeText(row, inTrash: true, now: now) == "Deleted 2 days ago")
        #expect(CardMapping.timeText(row, inTrash: false, now: now) == "2 days ago")
        var deleted = row
        deleted.deletedAt = row.updatedAt + 86_400_000
        #expect(CardMapping.timeText(deleted, inTrash: true, now: now) == "Deleted 1 day ago", "Trash reads deletedAt")
    }
}
