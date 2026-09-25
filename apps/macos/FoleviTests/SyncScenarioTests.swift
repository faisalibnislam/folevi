import XCTest

/// Runs packages/editor-schema/fixtures/sync-scenarios.json through the Swift reducer and compares
/// the canonical state with the TypeScript reducer's output byte for byte.
final class SyncScenarioTests: XCTestCase {
    func run(_ step: JSONValue, _ state: inout SyncState) throws {
        let action = try XCTUnwrap(step["action"]?.stringValue)
        let input = step["input"] ?? .null
        switch action {
        case "localUpsert":
            let fields = (input["fields"]?.arrayValue ?? []).compactMap { $0.stringValue.flatMap(ChangedField.init(rawValue:)) }
            state.localUpsert(opId: try str(input["opId"]), documentId: try str(input["documentId"]),
                              block: try WireBlock(json: try XCTUnwrap(input["block"])), fields: fields,
                              blockedBy: input["blockedBy"]?.stringValue)
        case "localDelete":
            state.localDelete(opId: try str(input["opId"]), documentId: try str(input["documentId"]), blockId: try str(input["blockId"]))
        case "localRestore":
            state.localRestore(opId: try str(input["opId"]), documentId: try str(input["documentId"]), blockId: try str(input["blockId"]))
        case "setConnection":
            state.setConnection(try XCTUnwrap(ConnectionState(rawValue: try str(input))))
        case "takeBatch":
            state.takeBatch()
        case "applyResults":
            state.applyResults(try input.decode([OpResult].self))
        case "batchFailed":
            state.batchFailed(try XCTUnwrap(BatchFailure(rawValue: try str(input))))
        case "authRefreshed":
            state.authRefreshed()
        case "remoteUpdate":
            state.remoteUpdate(documentId: try str(input["documentId"]), block: try WireBlock(json: try XCTUnwrap(input["block"])),
                               deleted: input["deleted"]?.boolValue ?? false)
        case "queueUpload":
            state.queueUpload(uploadId: try str(input["uploadId"]), documentId: try str(input["documentId"]), blockId: try str(input["blockId"]))
        case "uploadFailed":
            state.uploadFailed(try str(input))
        case "uploadCompleted":
            state.uploadCompleted(uploadId: try str(input["uploadId"]), fileId: try str(input["fileId"]))
        case "resolveConflict":
            try state.resolveConflict(conflictId: try str(input["conflictId"]),
                                      choice: try XCTUnwrap(ConflictChoice(rawValue: try str(input["choice"]))),
                                      opId: try str(input["opId"]), newBlockId: input["newBlockId"]?.stringValue,
                                      newRank: input["newRank"]?.stringValue)
        case "expect":
            break
        default:
            XCTFail("unknown action \(action)")
        }
    }

    func str(_ v: JSONValue?) throws -> String { try XCTUnwrap(v?.stringValue) }

    func check(_ state: SyncState, _ step: JSONValue, _ whereStr: String) {
        if let s = step["status"]?.stringValue { XCTAssertEqual(state.status.rawValue, s, whereStr) }
        if let n = step["pending"]?.intValue { XCTAssertEqual(state.pending.count, n, "\(whereStr) pending") }
        if let n = step["inflight"]?.intValue { XCTAssertEqual(state.inflight.count, n, "\(whereStr) inflight") }
        if let n = step["conflicts"]?.intValue { XCTAssertEqual(state.conflicts.count, n, "\(whereStr) conflicts") }
        if let revs = step["baseRevisions"]?.arrayValue {
            XCTAssertEqual(state.pending.map { $0.baseRevision }, revs.map { $0.intValue }, whereStr)
        }
        if let revs = step["revisions"]?.objectValue {
            for (id, rev) in revs { XCTAssertEqual(state.blocks[id]?.serverRevision, rev.intValue, "\(whereStr) revision \(id)") }
        }
        if let deleted = step["deleted"]?.arrayValue {
            // TS: Object.entries order (insertion order) — compare as sets plus count.
            let actual = state.blocks.filter { $0.value.deleted }.map(\.key).sorted()
            XCTAssertEqual(actual, deleted.compactMap(\.stringValue).sorted(), whereStr)
        }
        if let absent = step["absent"]?.arrayValue {
            for id in absent.compactMap(\.stringValue) { XCTAssertNil(state.blocks[id], whereStr) }
        }
    }

    func testGoldenScenarios() throws {
        let fixture = try Fixtures.json(Fixtures.editorSchema("sync-scenarios.json"))
        let scenarios = try XCTUnwrap(fixture["scenarios"]?.arrayValue)
        XCTAssertEqual(scenarios.count, 9)
        for scenario in scenarios {
            let name = scenario["name"]?.stringValue ?? "?"
            var state = SyncState()
            for (idx, step) in (scenario["steps"]?.arrayValue ?? []).enumerated() {
                try run(step, &state)
                if step["action"]?.stringValue == "expect" { check(state, step, "\(name)#\(idx)") }
            }
            let expected = try XCTUnwrap(scenario["expectedFinal"]?.stringValue, "\(name) has expectedFinal")
            XCTAssertEqual(state.canonical, expected, "canonical state for \(name)")
        }
    }

    func testCreateThenDeleteNeverSent() {
        var s = SyncState()
        let b = WireBlock(id: "a", type: "paragraph", parentId: nil, rank: "V")
        s.localUpsert(opId: "o1", documentId: "d", block: b, fields: [.content, .position])
        s.localDelete(opId: "o2", documentId: "d", blockId: "a")
        XCTAssertTrue(s.pending.isEmpty)
        XCTAssertNil(s.blocks["a"])
    }

    func testCoalescingKeepsFirstOpIdAndUnionsFields() {
        var s = SyncState()
        s.remoteUpdate(documentId: "d", block: WireBlock(id: "a", type: "paragraph", parentId: nil, rank: "V", revision: 2), deleted: false)
        s.localUpsert(opId: "o1", documentId: "d", block: WireBlock(id: "a", type: "paragraph", parentId: nil, rank: "V"), fields: [.position])
        s.localUpsert(opId: "o2", documentId: "d", block: WireBlock(id: "a", type: "paragraph", parentId: nil, rank: "W"), fields: [.content])
        XCTAssertEqual(s.pending.count, 1)
        XCTAssertEqual(s.pending[0].opId, "o1")
        XCTAssertEqual(s.pending[0].fields, [.content, .position])
        XCTAssertEqual(s.pending[0].baseRevision, 2)
        XCTAssertEqual(s.pending[0].block?.rank, "W")
    }

    func testRemoteUpdateDoesNotClobberPendingWork() {
        var s = SyncState()
        s.remoteUpdate(documentId: "d", block: WireBlock(id: "a", type: "paragraph", parentId: nil, rank: "V", revision: 1), deleted: false)
        s.localUpsert(opId: "o1", documentId: "d", block: WireBlock(id: "a", type: "paragraph", parentId: nil, rank: "V", text: [["type": "text", "text": "mine"]]), fields: [.content])
        s.remoteUpdate(documentId: "d", block: WireBlock(id: "a", type: "paragraph", parentId: nil, rank: "V", text: [["type": "text", "text": "theirs"]], revision: 3), deleted: false)
        XCTAssertEqual(s.blocks["a"]?.block.inlineText, [.text(text: "mine", marks: nil)])
        XCTAssertEqual(s.status, .saving)
    }

    func testOpWireEncodingShape() throws {
        let op = SyncOp(opId: "01ABCDEFGH", kind: .blockUpsert, documentId: "d",
                        block: WireBlock(id: "a", type: "paragraph", parentId: nil, rank: "V", revision: 9),
                        baseRevision: nil, fields: [.content], blockedBy: "up")
        let json = try JSONValue(encoding: op.forWire)
        XCTAssertEqual(json.canonicalString,
                       #"{"baseRevision":null,"block":{"id":"a","parentId":null,"props":{},"rank":"V","schemaVersion":1,"text":[],"type":"paragraph"},"documentId":"d","fields":["content"],"kind":"block.upsert","opId":"01ABCDEFGH"}"#)
        let doc = SyncOp(opId: "01ABCDEFGI", kind: .documentUpdate, documentId: "d", baseRevision: 3, patch: WireDocumentPatch(title: "T", icon: .some(nil)))
        XCTAssertEqual(try JSONValue(encoding: doc).canonicalString,
                       #"{"baseRevision":3,"documentId":"d","kind":"document.update","opId":"01ABCDEFGI","patch":{"icon":null,"title":"T"}}"#)
    }

    func testDocumentUpdatesCoalesceIntoCreate() {
        var s = SyncState()
        s.enqueueDocumentCreate(opId: "c1", document: WireDocumentCreate(id: "d1", title: ""))
        s.enqueueDocumentUpdate(opId: "u1", documentId: "d1", patch: WireDocumentPatch(title: "Hello"), baseRevision: nil)
        XCTAssertEqual(s.pending.count, 1)
        XCTAssertEqual(s.pending[0].document?.title, "Hello")
        s.takeBatch()
        s.enqueueDocumentUpdate(opId: "u2", documentId: "d1", patch: WireDocumentPatch(title: "Hello again"), baseRevision: 1)
        s.enqueueDocumentUpdate(opId: "u3", documentId: "d1", patch: WireDocumentPatch(icon: .some("🌿")), baseRevision: 1)
        XCTAssertEqual(s.pending.count, 1)
        XCTAssertEqual(s.pending[0].patch?.title, "Hello again")
        XCTAssertEqual(s.pending[0].patch?.icon, .some("🌿"))
    }
}
