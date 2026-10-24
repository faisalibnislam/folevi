// The contract tests (docs/NATIVE_APP_PLAN.md section 3.8): every fixture the web writes in
// apps/web/src/lib/engine/fixtures/*.json goes through the generated Swift types, and every list story through
// the same ListState the screens use, ending with the rows the fixture expects.
import Foundation
import Testing
@testable import FoleviEngine

enum Fixtures {
    static let dir = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .appendingPathComponent("../../../web/src/lib/engine/fixtures")
        .standardized

    static var files: [URL] {
        ((try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? [])
            .filter { $0.pathExtension == "json" }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
    }

    static func load(_ url: URL) throws -> [String: Any] {
        try #require(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    }

    static func data(_ value: Any) throws -> Data {
        try JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed])
    }
}

/// Decodes `value` as `type`, then re-encodes and decodes again: the two must be equal (nothing dropped).
func roundTrip<T: Codable>(_ type: T.Type, _ value: Any, _ what: String) throws {
    let decoded = try JSONDecoder().decode(T.self, from: Fixtures.data(value))
    let again = try JSONDecoder().decode(T.self, from: JSONEncoder().encode(decoded))
    if let a = decoded as? any Hashable, let b = again as? any Hashable {
        #expect(AnyHashable(a) == AnyHashable(b), "\(what) changed in a round trip")
    }
}

func decodeAny(_ type: any (Codable & Sendable).Type, _ value: Any, _ what: String) throws {
    try roundTrip(type, value, what)
}

@Suite("Contract fixtures")
struct ContractFixtureTests {
    @Test func fixturesExist() {
        #expect(Fixtures.files.count >= 20, "no fixtures at \(Fixtures.dir.path)")
    }

    @Test(arguments: Fixtures.files)
    func fixture(_ url: URL) throws {
        let f = try Fixtures.load(url)
        let kind = try #require(f["kind"] as? String)
        let name = f["name"] as? String ?? ""
        let what = url.lastPathComponent
        switch kind {
        case "view":
            let args = try #require(EngineCatalog.viewArgs[name], "\(what): unknown view \(name)")
            let value = try #require(EngineCatalog.viewValues[name])
            try decodeAny(args, f["args"] ?? [:], "\(what) args")
            try decodeAny(value, try #require(f["value"]), "\(what) value")
        case "list":
            let args = try #require(EngineCatalog.listArgs[name], "\(what): unknown list view \(name)")
            try decodeAny(args, f["args"] ?? [:], "\(what) args")
            try checkListStory(f, what)
        case "command":
            let args = try #require(EngineCatalog.commandArgs[name], "\(what): unknown command \(name)")
            try decodeAny(args, f["args"] ?? [:], "\(what) args")
            if let result = f["result"] { try decodeAny(try #require(EngineCatalog.commandResults[name]), result, "\(what) result") }
            if let error = f["error"] { try roundTrip(EngineError.self, error, "\(what) error") }
        case "editor":
            let args = try #require(EngineCatalog.editorArgs[name], "\(what): unknown editor command \(name)")
            try decodeAny(args, f["args"] ?? [:], "\(what) args")
            if let result = f["result"] { try decodeAny(try #require(EngineCatalog.editorResults[name]), result, "\(what) result") }
            if let error = f["error"] { try roundTrip(EngineError.self, error, "\(what) error") }
        case "event":
            let type = try #require(EngineCatalog.events[name], "\(what): unknown event \(name)")
            try decodeAny(type, f["data"] ?? [:], "\(what) data")
            // And through the envelope decoder the client uses.
            let batch = try Fixtures.data([["kind": "event", "name": name, "data": f["data"] ?? [:]]])
            let items = try InboundItem.decodeBatch(batch, decoders: SubscriptionDecoders())
            guard case .event(let event)? = items.first else { Issue.record("\(what): not decoded as an event"); return }
            #expect(event.name == name)
            if case .unknown = event { Issue.record("\(what): decoded as an unknown event") }
        case "envelope":
            try checkEnvelope(f, what)
        default:
            Issue.record("\(what): unknown fixture kind \(kind)")
        }
    }

    /// Applies every update of a list fixture to a ListState and checks the rows native ends with.
    func checkListStory(_ f: [String: Any], _ what: String) throws {
        var state = ListState<NoteRow>()
        var lastRev = 0
        for case let update as [String: Any] in try #require(f["updates"] as? [Any]) {
            let rev = try #require(update["rev"] as? Int)
            #expect(rev == lastRev + 1 || rev == 1, "\(what): rev \(rev) after \(lastRev)")
            lastRev = rev
            if let diff = update["diff"] {
                state.apply(try JSONDecoder().decode(RowDiff<NoteRow>.self, from: Fixtures.data(diff)))
            }
        }
        let expected = try #require(f["expected"] as? [String: Any])
        #expect(state.total == expected["total"] as? Int, "\(what): total")
        #expect(state.complete == expected["complete"] as? Bool, "\(what): complete")
        #expect(state.start == expected["start"] as? Int, "\(what): start")
        let rows = try JSONDecoder().decode([NoteRow].self, from: Fixtures.data(try #require(expected["rows"])))
        #expect(state.rows == rows, "\(what): rows differ (\(state.rows.count) vs \(rows.count))")
    }

    /// Envelope stories: replies decode with their calls' types, batches with their subscriptions' types.
    func checkEnvelope(_ f: [String: Any], _ what: String) throws {
        let toEngine = f["toEngine"] as? [[String: Any]] ?? []
        var calls: [String: [String: Any]] = [:]
        var subs = SubscriptionDecoders()
        for m in toEngine {
            #expect(m["v"] as? Int == EngineContract.protocolVersion, "\(what): v")
            if let id = m["id"] as? String { calls[id] = m }
            if m["kind"] as? String == "watch", let sub = m["sub"] as? String, let name = m["name"] as? String {
                if let value = EngineCatalog.viewValues[name] {
                    subs.bySub[sub] = payloadDecoder(value)
                } else if EngineCatalog.listRows[name] != nil {
                    subs.bySub[sub] = .list(NoteRow.self)
                }
            }
        }
        for case let reply as [String: Any] in f["fromEngine"] as? [Any] ?? [] {
            let id = try #require(reply["id"] as? String)
            let call = calls[id]
            let data = try Fixtures.data(reply)
            switch call?["kind"] as? String {
            case "hello":
                let r = try JSONDecoder().decode(ReplyEnvelope<HelloValue>.self, from: data)
                if let hello = r.value {
                    #expect(hello.protocol == EngineContract.protocolVersion)
                    #expect(hello.schemaHash == EngineContract.schemaHash, "\(what): the Swift was generated from another contract; run pnpm engine:gen")
                }
            case "watch":
                _ = try JSONDecoder().decode(ReplyEnvelope<WatchValue>.self, from: data)
            default:
                let r = try JSONDecoder().decode(ReplyEnvelope<JSONValue>.self, from: data)
                if !r.ok { #expect(r.error != nil, "\(what): an error reply without its error") }
            }
        }
        // Updates for subscriptions the story didn't open: find the view whose value they carry.
        for case let u as [String: Any] in f["batch"] as? [Any] ?? [] where u["kind"] as? String == "update" {
            guard let sub = u["sub"] as? String, subs.bySub[sub] == nil else { continue }
            if u["diff"] != nil { subs.bySub[sub] = .list(NoteRow.self); continue }
            for (_, type) in EngineCatalog.viewValues.sorted(by: { $0.key < $1.key }) where (try? decodeAny(type, u["value"] ?? [:], "probe")) != nil {
                subs.bySub[sub] = payloadDecoder(type)
                break
            }
        }
        if let batch = f["batch"] {
            let items = try InboundItem.decodeBatch(Fixtures.data(batch), decoders: subs)
            for item in items {
                if case .update(_, _, let payload, _, _) = item { #expect(payload != nil, "\(what): an update without its payload") }
                if case .ignored = item { Issue.record("\(what): an item was ignored") }
            }
        }
    }

    func payloadDecoder<T: Codable & Sendable>(_ type: T.Type) -> PayloadDecoder { .value(T.self) }

    @Test func schemaHashMatchesTheNames() {
        let source = [
            "\(EngineContract.protocolVersion).\(EngineContract.revision)",
            ViewName.allCases.map(\.rawValue).joined(separator: ","),
            ListViewName.allCases.map(\.rawValue).joined(separator: ","),
            CommandName.allCases.map(\.rawValue).joined(separator: ","),
            EditorCommandName.allCases.map(\.rawValue).joined(separator: ","),
            EventName.allCases.map(\.rawValue).joined(separator: ","),
        ].joined(separator: "|")
        #expect(fnv1a(source) == EngineContract.schemaHash)
    }

    @Test func fnvMatchesTheWeb() {
        // protocol.ts fnv1a over UTF-16 code units.
        #expect(fnv1a("") == "811c9dc5")
        #expect(fnv1a("a") == "e40c292c")
        #expect(fnv1a("Folevi … ✓") == fnv1aReference("Folevi … ✓"))
    }

    private func fnv1aReference(_ s: String) -> String {
        var h: UInt32 = 0x811c_9dc5
        for u in Array(s.utf16) { h = (h ^ UInt32(u)) &* 16_777_619 }
        return String(format: "%08x", h)
    }
}
