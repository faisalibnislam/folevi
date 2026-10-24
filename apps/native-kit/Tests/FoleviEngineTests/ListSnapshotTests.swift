// Lists from the launch snapshot (plan 4.6): a list watched with a snapshot key saves its top rows, and the next
// launch's store starts with them before the engine has answered; the engine's first update replaces them.
import Foundation
import Testing
@testable import FoleviEngine

@Suite("List launch snapshot") @MainActor
struct ListSnapshotTests {
    static var keepAlive: [FakeEngine] = []

    func initialBatch(sub: String) throws -> [JSONValue] {
        let fixture = try Fixtures.load(Fixtures.dir.appendingPathComponent("list.notes.initial.json"))
        let updates = try #require(fixture["updates"] as? [[String: Any]])
        return try JSONDecoder().decode([JSONValue].self, from: Fixtures.data(updates.map { $0.merging(["sub": sub]) { $1 } }))
    }

    @Test func savesTheTopAndStartsFromIt() async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("folevi-list-snapshot-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: url) }

        let engine = FakeEngine()
        let client = EngineClient(transport: engine.transport, place: "acct:u1", app: app)
        let snap = LaunchSnapshotStore(url: url)
        snap.throttle = 0
        client.snapshot = snap
        let list = client.watchList(.notesList(view: .all), snapshotKey: "list.all")
        #expect(list.total == 0, "nothing saved yet")
        await eventually("watch sent") { !engine.watches.isEmpty }
        engine.push(try initialBatch(sub: try #require(engine.watches.keys.first)))
        await eventually("rows") { list.total > 0 }
        let live = list.rows
        snap.flush()

        // The next launch: the engine hasn't answered (not even hello).
        let next = FakeEngine()
        next.ready = false
        let client2 = EngineClient(transport: next.transport, place: "acct:u1", app: app)
        client2.snapshot = LaunchSnapshotStore(url: url)
        let list2 = client2.watchList(.notesList(view: .all), snapshotKey: "list.all")
        #expect(list2.status == .loading)
        #expect(list2.total == list.total)
        #expect(list2.rows.map(\.id) == Array(live.prefix(ListSnapshot<NoteRow>.defaultLimit)).map(\.id))
        #expect(list2.row(at: 0)?.title == live.first?.title)
        // The fakes answer the stores' last unwatch after the test returns.
        ListSnapshotTests.keepAlive += [engine, next]
    }

    @Test func aWindowAwayFromTheTopIsNotSaved() {
        var state = ListState<NoteRow>()
        state.apply(RowDiff<NoteRow>(reset: true, total: 500, complete: true, start: 200, order: [], upsert: [:]))
        #expect(state.snapshot() == nil)
        let top = ListState<NoteRow>(snapshot: ListSnapshot(total: 3, complete: true, rows: []))
        #expect(top.total == 3)
        #expect(top.rows.isEmpty)
    }
}
