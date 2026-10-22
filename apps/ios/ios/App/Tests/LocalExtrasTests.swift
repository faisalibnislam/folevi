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
