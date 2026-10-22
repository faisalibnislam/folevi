// The widgets, Shortcuts and Spotlight in local mode (Shared/LocalExtras.swift): the queue of what they did
// for the page, the notes Shortcuts picks from, and the widgets' copy the page writes.
import XCTest
@testable import App

final class LocalExtrasTests: XCTestCase {
    private var folder: URL!
    private var wasLocal = false

    override func setUpWithError() throws {
        wasLocal = LocalMode.on
        folder = FileManager.default.temporaryDirectory.appendingPathComponent("local-extras-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        LocalMode.on = wasLocal
        try? FileManager.default.removeItem(at: folder)
    }

    private func task(_ id: String, due: String) -> TaskItem {
        TaskItem(id: id, text: "Task \(id)", status: "open", dueDate: due, dueTime: nil, priority: nil, note: .init(id: "01JAAAAAAAAAAAAAAAAAAAAAAA", title: "Inbox"), place: nil)
    }

    func testQueueKeepsOrderAndOnlyTheLastCheckOfATask() throws {
        let queue = LocalActions(root: folder.appendingPathComponent("LocalActions"))
        try queue.add(.toggleTask, taskId: "t1", completed: true)
        try queue.add(.addTask, text: "Call Sam", dueDate: "2026-10-22")
        try queue.add(.toggleTask, taskId: "t1", completed: false)
        try queue.add(.newNote, title: "Idea", markdown: "Some text")
        let all = queue.all()
        XCTAssertEqual(all.map(\.kind), [.addTask, .toggleTask, .newNote])
        XCTAssertEqual(all[1].completed, false)
        XCTAssertTrue(queue.togglePending("t1"))
        XCTAssertTrue(all.allSatisfy { LocalActions.validId($0.id) })
        queue.remove(all[1].id)
        XCTAssertFalse(queue.togglePending("t1"))
        XCTAssertEqual(queue.all().count, 2)
        // Ids are the queue's own: nothing else is removed by one.
        queue.remove("../widgets")
        XCTAssertFalse(LocalActions.validId("../x"))
        queue.removeAll()
        XCTAssertTrue(queue.all().isEmpty)
    }

    func testCatalogSearchMatchesEveryWordInTheTitle() {
        let notes = ["Weekly review", "Reading list", "Review the garden plan"].enumerated().map { i, title in
            NoteSummary(id: "n\(i)", title: title, place: .init(id: nil, name: "Notes"), updatedAt: "2026-10-22T00:00:00Z", url: nil)
        }
        XCTAssertEqual(LocalCatalog.search("review", in: notes).map(\.id), ["n0", "n2"])
        XCTAssertEqual(LocalCatalog.search("plan REVIEW", in: notes).map(\.id), ["n2"])
        XCTAssertEqual(LocalCatalog.search("  ", in: notes, limit: 2).map(\.id), ["n0", "n1"])
    }

    func testWidgetsKeepChecksThePageHasNotTakenAndRollOverAtMidnight() async throws {
        LocalMode.on = true
        let queue = LocalActions(root: folder.appendingPathComponent("LocalActions"))
        let store = WidgetStore(file: folder.appendingPathComponent("widgets.json"))
        store.setLocal(tasks: [task("a", due: "2026-10-22"), task("b", due: "2026-10-23")], notes: [], day: "2026-10-22", actions: queue)
        XCTAssertEqual(store.load().openTasks.map(\.id), ["a"])

        // Checked in a widget: pending until the page puts it in the library, even across the page's copies.
        var snapshot = store.load()
        snapshot.pending["a"] = true
        store.save(snapshot)
        try queue.add(.toggleTask, taskId: "a", completed: true)
        store.setLocal(tasks: [task("a", due: "2026-10-22"), task("b", due: "2026-10-23")], notes: [], day: "2026-10-22", actions: queue)
        XCTAssertEqual(store.load().pending, ["a": true])
        XCTAssertTrue(store.load().openTasks.isEmpty)
        store.settleLocal("a", completed: true)
        XCTAssertEqual(store.load().pending, [:])
        XCTAssertEqual(store.load().tasks.map(\.id), ["b"])

        // No REST API in local mode: a refresh only moves the day on (tomorrow's task is today's).
        let calendar = Calendar.current
        let nextDay = try XCTUnwrap(calendar.date(from: DateComponents(year: 2026, month: 10, day: 23, hour: 9)))
        let rolled = await store.refresh(api: nil, now: nextDay)
        XCTAssertEqual(rolled.state, .ready)
        XCTAssertEqual(rolled.day, "2026-10-23")
        XCTAssertEqual(rolled.openTasks.map(\.id), ["b"])
    }

    func testNoRestApiInLocalMode() {
        LocalMode.on = true
        XCTAssertNil(SharedAccount.api())
    }
}

/// Several places (Shared/SaveTargets.swift, docs/MULTI_ACCOUNT_PLAN.md §6): where the share sheet and intents save,
/// and which page takes what was kept.
final class SaveTargetsTests: XCTestCase {
    private var defaults: UserDefaults!
    private var folder: URL!
    private let suite = "save-targets-\(UUID().uuidString)"

    override func setUpWithError() throws {
        defaults = UserDefaults(suiteName: suite)
        folder = FileManager.default.temporaryDirectory.appendingPathComponent(suite, isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        defaults.removePersistentDomain(forName: suite)
        try? FileManager.default.removeItem(at: folder)
    }

    private let targets = [
        SaveTarget(id: "library", name: "On this iPhone", detail: "Kept on this iPhone"),
        SaveTarget(id: "acct:userAna", name: "Ana", detail: "ana@example.com"),
        SaveTarget(id: "acct:userBen", name: "Ben", detail: "ben@example.com"),
    ]

    func testThePickerStartsOnTheLastChoiceThenTheOpenPlace() {
        XCTAssertFalse(SaveTargets.several(defaults: defaults))
        XCTAssertNil(SaveTargets.preferred(defaults: defaults))
        SaveTargets.write(targets + [SaveTarget(id: "acct:../x", name: "Bad", detail: "")], current: "acct:userAna", defaults: defaults)
        XCTAssertEqual(SaveTargets.load(defaults: defaults).map(\.id), ["library", "acct:userAna", "acct:userBen"])
        XCTAssertTrue(SaveTargets.several(defaults: defaults))
        XCTAssertEqual(SaveTargets.preferred(defaults: defaults)?.id, "acct:userAna")
        SaveTargets.remember("acct:userBen", defaults: defaults)
        XCTAssertEqual(SaveTargets.preferred(defaults: defaults)?.id, "acct:userBen")
        SaveTargets.remember("nowhere", defaults: defaults)
        XCTAssertEqual(SaveTargets.last(defaults: defaults), "acct:userBen")
        // A place that went: back to the open one.
        SaveTargets.write(Array(targets.prefix(2)), current: "library", defaults: defaults)
        XCTAssertEqual(SaveTargets.preferred(defaults: defaults)?.id, "library")
        XCTAssertTrue(SaveTargets.isOpen("library", defaults: defaults))
        XCTAssertFalse(SaveTargets.isOpen("acct:userAna", defaults: defaults))
    }

    func testEachAccountKeepsItsOwnTokenUntilItGoes() {
        SaveTargets.write(targets, current: "acct:userAna", defaults: defaults)
        SaveTargets.keep(userId: "userAna", accountId: "accountAna", tokenId: "tokAna", token: "fvpat_ana_0123456789", defaults: defaults)
        SaveTargets.keep(userId: "userBen", accountId: "accountBen", tokenId: "tokBen", token: "fvpat_ben_0123456789", defaults: defaults)
        XCTAssertEqual(SaveTargets.credential(userId: "userBen").token, "fvpat_ben_0123456789")
        XCTAssertEqual(SaveTargets.accountIds(defaults: defaults)["userAna"], "accountAna")
        // Ben signed out on this device: his token goes with him, Ana's stays.
        SaveTargets.write(Array(targets.prefix(2)), current: "acct:userAna", defaults: defaults)
        XCTAssertNil(SaveTargets.credential(userId: "userBen").token)
        XCTAssertEqual(SaveTargets.credential(userId: "userAna").token, "fvpat_ana_0123456789")
        SaveTargets.forget(userId: "userAna", defaults: defaults)
        XCTAssertNil(SaveTargets.credential(userId: "userAna").token)
        XCTAssertTrue(SaveTargets.accountIds(defaults: defaults).isEmpty)
    }

    func testEachPlacesPageTakesOnlyWhatWasSavedToIt() throws {
        let actions = LocalActions(root: folder.appendingPathComponent("LocalActions"))
        try actions.add(.toggleTask, taskId: "t1", completed: true)
        try actions.add(.addTask, text: "For the library", place: "library")
        try actions.add(.addTask, text: "For Ben", place: "acct:userBen")
        XCTAssertEqual(actions.for(place: "library").map(\.text), [nil, "For the library"])
        XCTAssertEqual(actions.for(place: nil).count, 2)
        XCTAssertEqual(actions.for(place: "acct:userBen").map(\.text), ["For Ben"])
        XCTAssertTrue(actions.for(place: "acct:userAna").isEmpty)

        let shares = ShareQueue(root: folder.appendingPathComponent("Shares"))
        try shares.add(title: "Old", text: "", url: "", place: nil, accountId: "accountAna", files: [])
        try shares.add(title: "To Ben", text: "", url: "https://example.com", place: "personal", accountId: "accountBen", target: "acct:userBen", files: [])
        try shares.add(title: "To the library", text: "x", url: "", place: nil, accountId: nil, target: "library", files: [])
        XCTAssertEqual(shares.forOpenPlace(current: "acct:userAna", accountId: "accountAna").map(\.title), ["Old"])
        XCTAssertEqual(shares.forOpenPlace(current: "acct:userBen", accountId: "accountBen").map(\.title), ["To Ben"])
        XCTAssertEqual(shares.forOpenPlace(current: "library", accountId: nil).map(\.title), ["To the library"])
    }

    func testALinkOpensInItsPlace() {
        let url = DeepLink.inPlace(DeepLink.quickAddURL, "acct:userBen")
        XCTAssertEqual(url.absoluteString, "folevi://quick-add?place=acct:userBen")
        let (place, link) = DeepLink.place(of: url)
        XCTAssertEqual(place, "acct:userBen")
        XCTAssertEqual(link, DeepLink.quickAddURL)
        XCTAssertEqual(DeepLink.parse(link.absoluteString), .quickAdd)
        XCTAssertEqual(DeepLink.inPlace(DeepLink.newNoteURL, nil), DeepLink.newNoteURL)
        XCTAssertEqual(DeepLink.inPlace(DeepLink.newNoteURL, "javascript:x"), DeepLink.newNoteURL)
        XCTAssertNil(DeepLink.place(of: URL(string: "folevi://new?place=evil")!).place)
    }
}
