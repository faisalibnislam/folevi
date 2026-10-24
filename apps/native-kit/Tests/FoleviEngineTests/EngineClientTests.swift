// EngineClient against a scripted engine: handshake, live values and lists, rev gaps, commands and errors,
// timeouts, events, and resubscribing after the page reloads.
import Foundation
import Testing
@testable import FoleviEngine

@MainActor
final class FakeEngine {
    var ready = true
    var helloCount = 0
    var watches: [String: JSONValue] = [:] // sub -> message
    var log: [String] = []
    var commandReply: (JSONValue) async throws -> JSONValue = { _ in .object(["done": .array([]), "skipped": .number(0), "queued": .bool(false)]) }
    lazy var transport = ScriptedTransport { [unowned self] m in try await self.respond(m) }

    func respond(_ m: JSONValue) async throws -> JSONValue {
        let kind = m["kind"]?.string ?? ""
        log.append(kind + (m["name"]?.string.map { " " + $0 } ?? ""))
        switch kind {
        case "hello":
            helloCount += 1
            return .object([
                "protocol": .number(Double(EngineContract.protocolVersion)), "revision": .number(Double(EngineContract.revision)), "build": .string("test"),
                "schemaHash": .string(EngineContract.schemaHash), "ready": .bool(ready), "place": .string("acct:u1"),
                "features": .array([]), "views": .array([]), "listViews": .array([]), "commands": .array([]), "editorCommands": .array([]), "events": .array([]),
            ])
        case "watch":
            let sub = m["sub"]?.string ?? ""
            watches[sub] = m
            return .object(["sub": .string(sub)])
        case "unwatch":
            watches[m["sub"]?.string ?? ""] = nil
            return .object(["ok": .bool(true)])
        case "window":
            return .object(["ok": .bool(true)])
        case "command":
            return try await commandReply(m)
        default:
            throw EngineFailure.engine(EngineError(code: "unknown_view", message: "No such view."))
        }
    }

    func push(_ items: [JSONValue]) { transport.push(.array(items)) }

    static func syncStatus(_ state: String, pending: Int = 0) -> JSONValue {
        .object(["state": .string(state), "label": .string(state.capitalized), "pending": .number(Double(pending)), "conflicts": .number(0), "online": .bool(true), "authRequired": .bool(false), "spaces": .array([])])
    }

    static func update(_ sub: String, rev: Int, value: JSONValue? = nil, diff: JSONValue? = nil, stale: Bool = false) -> JSONValue {
        var o: [String: JSONValue] = ["kind": .string("update"), "sub": .string(sub), "rev": .number(Double(rev))]
        if let value { o["value"] = value }
        if let diff { o["diff"] = diff }
        if stale { o["stale"] = .bool(true) }
        return .object(o)
    }
}

let app = AppInfo(platform: .ios, version: "1.1.00", build: "1", protocol: EngineContract.protocolVersion)

/// Waits (briefly) for a condition the main actor will make true.
@MainActor
func eventually(_ what: String = "", timeout: Duration = .seconds(2), _ condition: @MainActor () -> Bool) async {
    let clock = ContinuousClock()
    let end = clock.now + timeout
    while clock.now < end {
        if condition() { return }
        try? await Task.sleep(for: .milliseconds(5))
    }
    Issue.record("timed out waiting: \(what)")
}

@Suite("EngineClient") @MainActor
struct EngineClientTests {
    @Test func handshakeAndLiveValue() async throws {
        let engine = FakeEngine()
        let client = EngineClient(transport: engine.transport, place: "acct:u1", app: app)
        client.start()
        await eventually("ready") { client.state == .ready }
        #expect(client.contractWarning == nil)

        let store = client.watch(.syncStatus)
        await eventually("watch sent") { !engine.watches.isEmpty }
        let sub = try #require(engine.watches.keys.first)
        #expect(engine.watches[sub]?["place"]?.string == "acct:u1")
        engine.push([FakeEngine.update(sub, rev: 1, value: FakeEngine.syncStatus("saved"), stale: true)])
        await eventually("value") { store.value != nil }
        #expect(store.value?.state == .saved)
        #expect(store.isStale)
        engine.push([FakeEngine.update(sub, rev: 2, value: FakeEngine.syncStatus("offline", pending: 3))])
        await eventually("second value") { store.value?.state == .offline }
        #expect(store.value?.pending == 3)
        #expect(!store.isStale)
    }

    @Test func revGapRefetches() async throws {
        let engine = FakeEngine()
        let client = EngineClient(transport: engine.transport, place: "acct:u1", app: app)
        let store = client.watch(.syncStatus)
        await eventually("watch sent") { !engine.watches.isEmpty }
        let sub = try #require(engine.watches.keys.first)
        engine.push([FakeEngine.update(sub, rev: 1, value: FakeEngine.syncStatus("saved"))])
        await eventually("value") { store.value != nil }
        let watchesBefore = engine.log.filter { $0.hasPrefix("watch") }.count
        engine.push([FakeEngine.update(sub, rev: 5, value: FakeEngine.syncStatus("error"))])
        await eventually("re-watch") { engine.log.filter { $0.hasPrefix("watch") }.count == watchesBefore + 1 }
        #expect(store.value?.state == .saved, "an update after a gap isn't applied")
    }

    @Test func windowedListAppliesDiffsAndMovesTheWindow() async throws {
        let engine = FakeEngine()
        let client = EngineClient(transport: engine.transport, place: "acct:u1", app: app)
        let list = client.watchList(.notesList(view: .all), windowing: ListWindowing(overscan: 10))
        await eventually("watch sent") { !engine.watches.isEmpty }
        let sub = try #require(engine.watches.keys.first)
        #expect(engine.watches[sub]?["window"]?["count"]?.number == 20)
        let fixture = try Fixtures.load(Fixtures.dir.appendingPathComponent("list.notes.scroll.json"))
        let updates = try #require(fixture["updates"] as? [[String: Any]])
        let batch = try JSONDecoder().decode([JSONValue].self, from: Fixtures.data(updates.map { u in u.merging(["sub": sub]) { $1 } }))
        engine.push(batch)
        let expected = try #require(fixture["expected"] as? [String: Any])
        await eventually("rows") { list.version == updates.count }
        #expect(list.total == expected["total"] as? Int)
        #expect(list.state.start == expected["start"] as? Int)
        #expect(list.rows.count == (expected["rows"] as? [Any])?.count)

        list.setVisibleRange(list.state.start + 25 ..< list.state.start + 40)
        await eventually("window moved") { engine.log.contains("window") }
    }

    @Test func commandsAreTypedAndErrorsMapped() async throws {
        let engine = FakeEngine()
        let client = EngineClient(transport: engine.transport, place: "acct:u1", app: app)
        engine.commandReply = { m in
            if m["name"]?.string == "note.move" { throw EngineFailure.engine(EngineError(code: "not_found", message: "That folder isn't there any more.")) }
            return .object(["done": .array([.string("doc_1")]), "skipped": .number(0), "queued": .bool(true)])
        }
        let result = try await client.command(.noteStar(ids: ["doc_1"], starred: true))
        #expect(result.done == ["doc_1"])
        #expect(result.queued)
        await #expect(throws: EngineFailure.engine(EngineError(code: "not_found", message: "That folder isn't there any more."))) {
            try await client.command(.noteMove(ids: ["doc_1"], folderId: "gone"))
        }
    }

    @Test func callsTimeOut() async throws {
        let engine = FakeEngine()
        let client = EngineClient(transport: engine.transport, place: "acct:u1", app: app)
        client.timeout = .milliseconds(80)
        engine.commandReply = { _ in
            try await Task.sleep(for: .seconds(5))
            return .null
        }
        client.start()
        await eventually("ready") { client.state == .ready }
        do {
            try await client.command(.engineRefresh)
            Issue.record("expected a timeout")
        } catch let failure as EngineFailure {
            #expect(failure.code == "timeout")
        }
    }

    @Test func commandsWaitForReadyThenFail() async throws {
        let engine = FakeEngine()
        engine.ready = false
        let client = EngineClient(transport: engine.transport, place: "acct:u1", app: app)
        client.readyWait = .milliseconds(100)
        client.start()
        await eventually("waiting") { client.state == .waiting }
        await #expect(throws: EngineFailure.notReady) { try await client.command(.engineRefresh) }
        // engine.ready brings it on, and a queued command then goes through.
        engine.ready = true
        client.readyWait = .seconds(2)
        let pending = Task { try await client.command(.engineRefresh) }
        engine.push([.object(["kind": .string("event"), "name": .string("engine.ready"), "data": .object(["place": .string("acct:u1"), "protocol": .number(1), "revision": .number(Double(EngineContract.revision))])])])
        await eventually("ready") { client.state == .ready }
        _ = try? await pending.value
        #expect(engine.log.contains("command engine.refresh"))
    }

    @Test func eventsAreTyped() async throws {
        let engine = FakeEngine()
        let client = EngineClient(transport: engine.transport, place: "acct:u1", app: app)
        client.start()
        await eventually("ready") { client.state == .ready }
        let stream = client.events()
        engine.push([.object(["kind": .string("event"), "name": .string("toast"), "data": .object(["message": .string("Moved to Trips"), "tone": .string("info"), "undo": .null])])])
        var iterator = stream.makeAsyncIterator()
        let event = await iterator.next()
        guard case .toast(let toast)? = event else { Issue.record("expected a toast, got \(String(describing: event))"); return }
        #expect(toast.message == "Moved to Trips")
        #expect(toast.undo == nil)
    }

    @Test func reloadKeepsValuesAndResubscribes() async throws {
        let engine = FakeEngine()
        let client = EngineClient(transport: engine.transport, place: "acct:u1", app: app)
        let store = client.watch(.syncStatus)
        await eventually("watch sent") { !engine.watches.isEmpty }
        let sub = try #require(engine.watches.keys.first)
        engine.push([FakeEngine.update(sub, rev: 1, value: FakeEngine.syncStatus("saved"))])
        await eventually("value") { store.value != nil }

        engine.watches.removeAll()
        engine.transport.simulate(.terminated)
        #expect(client.state == .disconnected)
        #expect(store.status == .disconnected)
        #expect(store.value?.state == .saved, "the last value stays on screen")
        await eventually("hello again and resubscribed") { client.state == .ready && engine.watches[sub] != nil }
        #expect(engine.helloCount == 2)
        engine.push([FakeEngine.update(sub, rev: 1, value: FakeEngine.syncStatus("syncing"))])
        await eventually("fresh value") { store.value?.state == .syncing }
        #expect(store.status == .live)
    }

    @Test func releasingAStoreUnwatches() async throws {
        let engine = FakeEngine()
        let client = EngineClient(transport: engine.transport, place: "acct:u1", app: app)
        var store: ValueStore<SyncStatusValue>? = client.watch(.syncStatus)
        await eventually("watch sent") { !engine.watches.isEmpty }
        #expect(store != nil)
        store = nil
        await eventually("unwatched") { engine.watches.isEmpty && client.subscriptionCount == 0 }
    }

    @Test func pausesOffScreenAndResumes() async throws {
        VisibilityTimer.pauseAfter = .milliseconds(30)
        defer { VisibilityTimer.pauseAfter = .seconds(60) }
        let engine = FakeEngine()
        let client = EngineClient(transport: engine.transport, place: "acct:u1", app: app)
        let store = client.watch(.syncStatus)
        await eventually("watch sent") { !engine.watches.isEmpty }
        store.setVisible(false)
        await eventually("paused") { store.status == .paused && engine.watches.isEmpty }
        store.setVisible(true)
        await eventually("resumed") { !engine.watches.isEmpty }
    }
}
