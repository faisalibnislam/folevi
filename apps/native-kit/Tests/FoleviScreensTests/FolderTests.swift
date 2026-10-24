// N9 and the N7 follow-ups: the folder tree's rows and "+N more", spring loading, All folders, the lock item and
// its dialog, dragging a selection, Copy to with a folder, Generate with Foli AI, and a note's changes.
import Foundation
import Testing
@testable import FoleviDesign
@testable import FoleviEngine
@testable import FoleviScreens

func node(_ id: String, _ parent: String?, depth: Int, children: Int = 0, count: Int = 1) -> FolderNode {
    FolderNode(id: id, name: id.capitalized, color: nil, parentId: parent, depth: depth, rank: id, childCount: children, noteCount: count, encrypted: false, sync: .saved)
}

@Suite("Folder tree rows (the sidebar's rules)")
struct FolderTreeRowsTests {
    // a(b(c)), d, e, f, g, h(i): six top-level folders.
    let tree = [node("a", nil, depth: 0, children: 1), node("b", "a", depth: 1, children: 1), node("c", "b", depth: 2), node("d", nil, depth: 0), node("e", nil, depth: 0), node("f", nil, depth: 0), node("g", nil, depth: 0), node("h", nil, depth: 0, children: 1), node("i", "h", depth: 1)]

    @Test func firstFiveTopLevelAndMore() {
        let r = FolderTreeRows.rows(tree, open: [], activeId: nil, showAll: false)
        #expect(r.rows.map(\.node.id) == ["a", "d", "e", "f", "g"])
        #expect(r.hidden == 1)
        #expect(r.rows.first?.hasChildren == true)
        #expect(r.rows.first?.open == false)
    }

    @Test func openFoldersShowTheirChildren() {
        let r = FolderTreeRows.rows(tree, open: ["a", "b"], activeId: nil, showAll: true)
        #expect(r.rows.map(\.node.id) == ["a", "b", "c", "d", "e", "f", "g", "h"])
        #expect(r.hidden == 0)
    }

    @Test func theActiveFolderShowsOpenedDownToIt() {
        let r = FolderTreeRows.rows(tree, open: [], activeId: "i", showAll: false)
        #expect(r.rows.map(\.node.id) == ["a", "d", "e", "f", "g", "h", "i"], "its top-level folder is kept past the limit, opened")
        #expect(r.hidden == 0)
    }
}

@Suite("Spring loading", .serialized) @MainActor
struct SpringLoaderTests {
    @Test func opensAfterTheDelayUnlessTheDragLeaves() async {
        SpringLoader.forceEnabled = true
        SpringLoader.delay = .milliseconds(40)
        defer { SpringLoader.forceEnabled = false; SpringLoader.delay = .milliseconds(600) }
        let spring = SpringLoader()
        var opened: [String] = []
        spring.arm("a") { opened.append("a") }
        await eventually { opened == ["a"] }
        #expect(spring.sprung == "a")
        spring.arm("b") { opened.append("b") }
        spring.cancel()
        try? await Task.sleep(for: .milliseconds(120))
        #expect(opened == ["a"], "a drag that left doesn't open")
    }
}

@Suite("Folders and the N7 follow-ups") @MainActor
struct FolderFeatureTests {
    func defaults() -> UserDefaults { UserDefaults(suiteName: "folevi.n9.\(UUID().uuidString)")! }

    @Test func allFoldersShowsEveryFolderWithWhereItIs() async {
        let engine = FakeEngine()
        let model = AllFoldersModel(client: engine.client(), defaults: defaults())
        await eventually { model.tree.value != nil }
        #expect(model.total == 5)
        let kyoto = model.nodes.first { $0.id == "fld_kyoto" }!
        #expect(model.path(kyoto) == "Trips / Japan")
        #expect(model.cardModel(kyoto).parentName == "Trips / Japan")
        model.query = "jap"
        #expect(model.shown.map(\.id).contains("fld_japan"))
        #expect(model.shown.map(\.id).contains("fld_kyoto"), "matches its path too")
        model.query = "zzz"
        #expect(model.shown.isEmpty)
        #expect(model.emptyTitle == "No folders match “zzz”")
        model.query = ""
        model.sort = .name
        #expect(model.shown.map(\.name) == model.shown.map(\.name).sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending })
        let d = defaults()
        let a = AllFoldersModel(client: engine.client(), defaults: d)
        a.layout = .tree
        #expect(AllFoldersModel(client: engine.client(), defaults: d).layout == .tree, "the layout is kept")
    }

    @Test func theLockItemShowsWhenTheSpaceOffersItAndAsksFirst() async {
        let engine = FakeEngine()
        engine.values["folders.locks"] = try! JSONValue.from(FolderLocksValue(canLock: true, level: "standard", locked: ["fld_work"]))
        engine.onCommand = { _, _ in .object(["ok": .bool(true)]) }
        let log = FeedbackLog()
        let model = HomeModel(client: engine.client(), feedback: log.feedback)
        await eventually { model.locks.value != nil && model.session.value != nil && model.value != nil }
        let ctx = FolderMenuContext(session: model.session.value, places: model.places.value, links: model.folderLinks, locks: model.locks.value)
        let work = MenuFolder(id: "fld_work", name: "Work", parentId: nil, color: nil)
        #expect(FolderMenuItem.groups(for: work, in: ctx).flatMap { $0 }.contains(.lock))
        #expect(ctx.isLocked("fld_work"))
        await model.actions.lockFolder("fld_work", name: "Work", locked: false)
        #expect(engine.commands(named: "folder.lock").first?["locked"] == .bool(false))
        #expect(log.toasts.last?.message == "Work is no longer always fully encrypted")

        // Without the view (an engine before R9.1) the item isn't offered.
        let old = FakeEngine()
        let model2 = HomeModel(client: old.client())
        await eventually { model2.locks.error != nil }
        let ctx2 = FolderMenuContext(session: model2.session.value, places: nil, links: [], locks: model2.locks.error == nil ? model2.locks.value : nil)
        #expect(!FolderMenuItem.groups(for: work, in: ctx2).flatMap { $0 }.contains(.lock))
    }

    @Test func draggingASelectedNoteCarriesTheSelection() async {
        let engine = FakeEngine()
        let model = NotesListModel(client: engine.client(), kind: NotesListKind(.all), defaults: defaults())
        await eventually { model.total == 25 }
        let rows = model.loadedRows
        #expect(model.dragItem(for: rows[0]).notes.count == 1)
        model.selecting = true
        model.selection = [rows[0].id, rows[2].id, rows[5].id]
        #expect(model.dragItem(for: rows[2]).ids == [rows[0].id, rows[2].id, rows[5].id])
        #expect(model.dragItem(for: rows[1]).ids == [rows[1].id], "a note outside the selection drags alone")
        // Dropped on a folder, all of them move, each remembering its folder for Undo.
        let item = model.dragItem(for: rows[2])
        let home = HomeModel(client: engine.client())
        await eventually { home.value != nil }
        await home.dropNotes([item], on: home.folders[1])
        let ids = engine.commands(named: "note.move").last?["ids"]
        #expect(ids == .array(item.ids.map(JSONValue.string)))
    }

    @Test func copyToSendsTheChosenFolder() async {
        let engine = FakeEngine()
        let model = NotesListModel(client: engine.client(), kind: NotesListKind(.all), defaults: defaults())
        await eventually { model.total == 25 && model.session.value != nil }
        await model.run(.copyTo, on: model.loadedRows[0])
        #expect(model.copying == [model.loadedRows[0].id])
        let ws = model.copyTargets[0]
        await model.actions.copy(["n00000"], to: ws, folder: FolderTarget(id: "fld_x", name: "Plans"))
        let args = engine.commands(named: "note.copyTo").last
        #expect(args?["space"]?.string == ws.id)
        #expect(args?["folderId"]?.string == "fld_x")
    }

    @Test func generateWritesThenSaves() async {
        let engine = FakeEngine()
        engine.onCommand = { name, args in
            switch name {
            case "ai.generate": return .object(["title": .string("Weekly team meeting"), "text": .string("## Agenda\n- Wins")])
            case "ai.saveDraft": return .object(["id": .string("tpl_1")])
            default: return .object(["ok": .bool(true)])
            }
        }
        let model = GenerateModel(kind: .template, client: engine.client())
        model.prompt = model.examples[0]
        await model.generate()
        #expect(model.draft?.title == "Weekly team meeting")
        #expect(model.title == "Weekly team meeting")
        #expect(engine.commands(named: "ai.generate").first?["kind"]?.string == "template")
        model.title = "Team sync"
        let id = await model.save()
        #expect(id == "tpl_1")
        #expect(engine.commands(named: "ai.saveDraft").first?["title"]?.string == "Team sync")
    }

    @Test func generateShowsTheEnginesProblem() async {
        let engine = FakeEngine()
        engine.onCommand = { _, _ in throw EngineFailure.engine(EngineError(code: "no_credits", message: "You're out of AI credits.")) }
        let model = GenerateModel(kind: .template, client: engine.client())
        model.prompt = "Book notes"
        await model.generate()
        #expect(model.draft == nil)
        #expect(model.error == "You're out of AI credits.")
    }

    @Test func aNotesChangesLoadOnceWhenShown() async {
        let engine = FakeEngine()
        engine.values["changes"] = Fixtures.value("view.changes.json")
        let diff = ChangeDiffValue(id: "doc_00002", title: "Q4 planning", blocks: [
            ChangeDiffBlock(id: "b1", change: "same", t: "heading", x: "Plan", l: 2),
            ChangeDiffBlock(id: "b2", change: "added", t: "todo", x: "Ship it", c: false, who: "Maya"),
            ChangeDiffBlock(id: "b3", change: "changed", t: "paragraph", x: "Friday", before: "Thursday", who: "Maya"),
            ChangeDiffBlock(id: "b4", change: "removed", t: "paragraph", x: "Old line"),
        ], truncated: false)
        engine.queryAnswers["changes.diff"] = { _ in try JSONValue.from(diff) }
        let model = ChangesModel(client: engine.client())
        await eventually { model.changes.value != nil }
        await model.toggleDiff("doc_00002")
        #expect(model.expanded.contains("doc_00002"))
        #expect(model.diffs["doc_00002"]?.blocks.count == 4)
        await model.toggleDiff("doc_00002")
        await model.toggleDiff("doc_00002")
        #expect(engine.queries.filter { $0.name == "changes.diff" }.count == 1, "loaded once")
    }

    @Test func aNewFolderCanOnlyGoWhereTheRulesAllow() {
        var deep: [FolderNode] = [node("l1", nil, depth: 0, children: 1)]
        for i in 2...5 { deep.append(node("l\(i)", "l\(i - 1)", depth: i - 1, children: i < 5 ? 1 : 0)) }
        let sheet = NewFolderSheet(parent: nil, tree: deep, onCreate: { _, _, _ in }, onCancel: {})
        #expect(sheet.parents.map(\.id) == ["l1", "l2", "l3", "l4"], "not inside the fifth level")
    }

    @Test func creatingAFolderSendsItsColour() async {
        let engine = FakeEngine()
        engine.onCommand = { _, _ in .object(["id": .string("fld_new")]) }
        let actions = NoteActions(client: engine.client())
        let id = await actions.createFolder(name: "  Recipes ", parentId: "fld_trips", color: "moss")
        #expect(id == "fld_new")
        let args = engine.commands(named: "folder.create").first
        #expect(args?["name"]?.string == "Recipes")
        #expect(args?["parentId"]?.string == "fld_trips")
        #expect(args?["color"]?.string == "moss")
    }
}
