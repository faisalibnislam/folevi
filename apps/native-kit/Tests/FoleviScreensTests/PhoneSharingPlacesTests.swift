// The iPhone's sharing, places and routes (feature parity with the web): Reviews' and Foli DNA's routes, the
// folder menu's Share…, folders in Shared with Me, and Move or copy notes.
import Foundation
import Testing
import FoleviEngine
import FoleviPhone
@testable import FoleviScreens

@Suite("Phone routes")
struct PhoneRouteTests {
    @Test func reviewsOpenTheWebsRoute() {
        // The web's route is /review (router.tsx); /reviews isn't one.
        #expect(FrameRoute(phone: .reviews) == .web("/review"))
        #expect(ScreenRoute(webRoute: "/reviews") == .reviews)
        #expect(FrameRoute(phone: ScreenRoute(webRoute: "/review")) == .web("/review"))
    }

    @Test func fooliDnaKeepsItsNoteAndView() {
        #expect(ScreenRoute(webRoute: "/graph") == .graph)
        #expect(ScreenRoute(webRoute: "/graph?note=doc_1") == .web("/graph?note=doc_1"))
        #expect(FrameRoute(phone: ScreenRoute(webRoute: "/graph?note=doc_1")) == .web("/graph?note=doc_1"))
        #expect(FrameRoute(phone: ScreenRoute(webRoute: "/graph?view=v_1")) == .web("/graph?view=v_1"))
        #expect(FrameRoute(phone: .graph) == .web("/graph"))
    }

    @Test func screensAndWhatTheFrameOpensItself() {
        #expect(FrameRoute(phone: .allFolders) == .web("/folders"))
        #expect(FrameRoute(phone: .note(id: "n1")) == .note("n1"))
        #expect(FrameRoute(phone: .web("/shared/fld_1")) == .web("/shared/fld_1"))
        #expect(FrameRoute(phone: .web("/help")) == .web("/help"))
        #expect(FrameRoute(phone: .movePlaces(folders: ["f"], notes: [])) == nil)
        #expect(FrameRoute(phone: .shareFolder(id: "f", name: "F")) == nil)
        #expect(FrameRoute(phone: .invite(space: "ws")) == nil)
    }

    @Test func inboxIsThePageNotTasksView() {
        // The web: /inbox opens the Inbox page; /tasks/inbox is Tasks' view of undated tasks.
        #expect(FrameRoute.opensInboxPage("/inbox"))
        #expect(FrameRoute.opensInboxPage("inbox"))
        #expect(FrameRoute.opensInboxPage("/inbox?from=widget"))
        #expect(!FrameRoute.opensInboxPage("/tasks/inbox"))
        #expect(!FrameRoute.opensInboxPage("/d/inbox-0123456789abcdef"))
    }

    @MainActor
    @Test func foliAILinksKeepTheirQuery() async {
        let model = FoliChatModel(client: chatEngine().client(), defaults: scratchDefaults())
        var opened: [ScreenRoute] = []
        model.onOpen = { opened.append($0) }
        #expect(model.openLink(URL(string: "/graph?note=doc_1")!))
        #expect(model.openLink(URL(string: "https://app.folevi.com/d/doc_2")!))
        #expect(opened == [.web("/graph?note=doc_1"), .note(id: "doc_2")])
    }
}

@Suite("Folder menu: Share")
struct FolderMenuShareTests {
    let links: [FolderRules.Link] = [.init(id: "a", parentId: nil)]

    @Test func shareSitsBeforeCopyLinkWhenSharingIsOn() {
        let ctx = FolderMenuContext(canEdit: true, inviteSpace: "ws", aiOn: true, otherPlaces: false, links: links, sharing: true)
        let items = FolderMenuItem.groups(for: MenuFolder(id: "a", name: "A", parentId: nil, color: nil), in: ctx).flatMap { $0 }
        #expect(items.suffix(4) == [.share, .copyLink, .invite, .delete])
        #expect(FolderMenuItem.share.title == "Share…")
    }

    @Test func noShareWithoutSharing() {
        let ctx = FolderMenuContext(canEdit: false, inviteSpace: nil, aiOn: false, otherPlaces: false, links: links)
        #expect(FolderMenuItem.groups(for: MenuFolder(id: "a", name: "A", parentId: nil, color: nil), in: ctx) == [[.copyLink]])
    }

    @MainActor
    @Test func theSessionSaysWhetherSharingIsOn() {
        let session = Fixtures.decode(SessionValue.self, "view.session.json")
        #expect(FolderMenuContext(session: session, places: nil, links: links).sharing == session.capabilities.sharing)
        #expect(FolderMenuContext(session: nil, places: nil, links: links).sharing == false)
    }
}

@Suite("Shared with Me: folders") @MainActor
struct SharedFoldersTests {
    @Test func foldersComeFirstWithTheWebsWords() async {
        let engine = FakeEngine()
        engine.values["shared.list"] = Fixtures.value("view.shared.list.json")
        engine.values["shared.folders"] = Fixtures.value("view.shared.folders.json")
        let model = SharedListModel(client: engine.client())
        await eventually { !model.isLoading }
        #expect(model.folderRows.map(\.id) == ["fld_garden", "fld_launch"])
        #expect(model.counts == "2 folders · \(model.rows.count) \(model.rows.count == 1 ? "page" : "pages")")
        #expect(SharedListModel.folderDetail(model.folderRows[0]) == "Shared by Faisal · Personal · Faisal · Can edit · 12 notes")
        #expect(SharedListModel.folderDetail(model.folderRows[1]) == "Shared by Maya · Airly Studio · Can view · 4 notes")
    }

    @Test func onlyFoldersLeavesOutPages() async {
        let engine = FakeEngine()
        engine.values["shared.list"] = .object(["rows": .array([])])
        engine.values["shared.folders"] = Fixtures.value("view.shared.folders.json")
        let model = SharedListModel(client: engine.client())
        await eventually { !model.isLoading }
        #expect(model.counts == "2 folders")
    }

    @Test func pagesStillShowWhenFoldersFail() async {
        // (An engine without the view: the pages show as before.)
        let engine = FakeEngine()
        engine.values["shared.list"] = Fixtures.value("view.shared.list.json")
        let model = SharedListModel(client: engine.client())
        await eventually { !model.isLoading }
        #expect(model.folderRows.isEmpty)
        #expect(!model.rows.isEmpty)
    }
}

@Suite("Tags index") @MainActor
struct TagsIndexModelTests {
    @Test func searchAndSortAsTheWeb() async {
        let engine = FakeEngine()
        engine.values["tags.index"] = Fixtures.value("view.tags.index.json")
        let defaults = UserDefaults(suiteName: "folevi.tags.\(UUID().uuidString)")!
        let model = TagsIndexModel(client: engine.client(), defaults: defaults)
        await eventually { !model.isLoading }
        #expect(model.sort == .name)
        #expect(model.shown.map(\.name) == ["ideas", "travel"])
        model.sort = .count
        #expect(model.shown.map(\.name) == ["travel", "ideas"])
        #expect(defaults.string(forKey: TagsIndexModel.sortKey) == "count", "kept for next time")
        model.sort = .created
        #expect(model.shown.map(\.name) == ["ideas", "travel"])
        model.query = "  #TRA "
        #expect(model.shown.map(\.id) == ["tag_travel"])
        #expect(TagsIndexModel(client: engine.client(), defaults: defaults).sort == .created)
        #expect(TagsIndexModel.Sort.allCases.map(\.label) == ["Name", "Most used", "Newest"])
    }

    @Test func tagsOpenTheirNotes() {
        #expect(FrameRoute(path: "/tags") == .web("/tags"))
        #expect(FrameRoute(path: "/tags/tag_travel") == .tag("tag_travel"))
    }
}

@Suite("Move or copy notes") @MainActor
struct MovePlacesModelTests {
    private func engine() -> FakeEngine {
        let e = FakeEngine()
        e.queryAnswers["places.move.preview"] = { args in
            guard case .object(var v) = Fixtures.value("view.places.move.preview.json") else { return .null }
            func count(_ key: String) -> Int { if case .array(let a)? = args[key] { a.count } else { 0 } }
            let folders = count("folders")
            let notes = count("notes")
            let picked = folders + notes > 0
            v["everything"] = .bool(!picked)
            if picked {
                v["folders"] = .number(Double(folders))
                v["notes"] = .number(Double(notes))
            }
            if let to = args["to"]?.string, case .array(let ds)? = v["destinations"] {
                v["to"] = ds.first { $0["value"]?.string == to } ?? .null
            }
            return .object(v)
        }
        e.onCommand = { name, _ in
            name == "places.move" ? Fixtures.json("command.places.move.json")["result"]! : .object(["ok": .bool(true)])
        }
        return e
    }

    @Test func everythingFromTheAccountSheet() async {
        let e = engine()
        let log = FeedbackLog()
        let model = MovePlacesModel(client: e.client(), feedback: log.feedback)
        await model.load()
        #expect(model.destination == "acct:user_2|personal")
        #expect(model.everything && !model.hasPick)
        #expect(model.whatLabel == "Everything in Personal")
        #expect(model.description == "From Personal to another place. Nothing crosses between places unless you move it.")
        #expect(model.actionTitle == "Copy notes", "copy is the web's default")
        #expect(await model.run())
        let args = e.commands(named: "places.move").last
        #expect(args?["to"]?.string == "acct:user_2|personal")
        #expect(args?["copy"] == .bool(true))
        #expect(args?["folders"] == nil || args?["folders"] == .null)
        #expect(log.toasts.last?.message == "Copied 19 notes.")
    }

    @Test func aFolderFromItsMenu() async {
        let e = engine()
        let model = MovePlacesModel(client: e.client(), request: MovePlacesRequest(folders: ["fld_trips"]))
        await model.load()
        #expect(!model.everything)
        #expect(model.whatLabel == "Folders and notes I pick")
        #expect(e.queries.last?.args["folders"] == .array([.string("fld_trips")]))
        model.copy = false
        #expect(model.actionTitle == "Move notes")
        #expect(model.summary == "1 folder, with everything inside, will move. They go to Trash here once they've arrived.")
        await model.choose(destination: "library|personal")
        #expect(model.chosen?.label == "On this Mac")
        #expect(await model.run())
        let args = e.commands(named: "places.move").last
        #expect(args?["folders"] == .array([.string("fld_trips")]))
        #expect(args?["to"]?.string == "library|personal")
        #expect(args?["copy"] == .bool(false))
        #expect(args?["versions"] == .bool(true))
    }

    @Test func aRefusalStaysInTheSheet() async {
        let e = engine()
        e.onCommand = { _, _ in throw EngineFailure.engine(EngineError(code: "not_found", message: "That place isn't on this device any more.")) }
        let model = MovePlacesModel(client: e.client())
        await model.load()
        #expect(await model.run() == false)
        #expect(model.error == "That place isn't on this device any more.")
    }

    @Test func nothingElseToMoveTo() async {
        let e = FakeEngine()
        e.queryAnswers["places.move.preview"] = { _ in
            .object(["from": .string("Personal"), "destinations": .array([]), "to": .null, "folders": .number(0), "notes": .number(0), "everything": .bool(true), "fits": .null])
        }
        let model = MovePlacesModel(client: e.client())
        await model.load()
        #expect(model.loaded && model.destinations.isEmpty)
        #expect(!model.canRun)
    }
}
