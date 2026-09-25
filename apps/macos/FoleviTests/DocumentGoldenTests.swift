import XCTest

final class DocumentGoldenTests: XCTestCase {
    func testDecodeEncodeIsCanonicallyIdentical() throws {
        let fixture = try Fixtures.json(Fixtures.editorSchema("document-golden.json"))
        let blocks = try XCTUnwrap(fixture["blocks"]?.arrayValue)
        XCTAssertEqual(blocks.count, 19)
        for raw in blocks {
            let wire = try WireBlock(json: raw)
            let typed = Block(wire: wire)
            let back = typed.wire
            XCTAssertEqual(back.jsonValue.canonicalString, raw.canonicalString, "round-trip of \(wire.type)")
        }
    }

    func testKnownTypesDecodeTyped() throws {
        let fixture = try Fixtures.json(Fixtures.editorSchema("document-golden.json"))
        let typed = try XCTUnwrap(fixture["blocks"]?.arrayValue).map { Block(wire: try WireBlock(json: $0)) }
        let names = typed.map(\.typeName)
        XCTAssertEqual(names.filter { $0 == "timeline" }.count, 1)
        let unknown = try XCTUnwrap(typed.first { $0.isUnknown })
        XCTAssertEqual(unknown.originalSchemaVersion, 2)
        XCTAssertEqual(typed.filter(\.isUnknown).count, 1, "only the future block is unknown")
        if case .todo(let p) = typed[4].content {
            XCTAssertEqual(p.priority, .high)
            XCTAssertEqual(p.reminderAt, 1_790_000_000_000)
        } else {
            XCTFail("expected todo")
        }
        if case .heading(let h) = typed[0].content { XCTAssertEqual(h.level, .level1) } else { XCTFail("expected heading") }
    }

    func testWholeDocumentCanonicalJSON() throws {
        let data = try Fixtures.editorSchema("document-golden.json")
        let fixture = try Fixtures.json(data)
        let blocks = try XCTUnwrap(fixture["blocks"]?.arrayValue).map { try WireBlock(json: $0) }
        let reencoded = JSONValue.array(blocks.map { Block(wire: $0).wire.jsonValue })
        XCTAssertEqual(reencoded.canonicalString, fixture["blocks"]?.canonicalString)
    }

    func testMigrationFromV0() throws {
        let legacy = WireBlock(id: "x1", type: "h2", parentId: nil, rank: "V", schemaVersion: 0, text: "Old heading", props: .emptyObject)
        let block = Block(wire: legacy)
        XCTAssertEqual(block.typeName, "heading")
        XCTAssertEqual(RichText.plainText(block.text), "Old heading")
        let check = WireBlock(id: "x2", type: "checklist", parentId: nil, rank: "V", schemaVersion: 0, text: .array([]), props: ["done": true])
        if case .todo(let p) = Block(wire: check).content { XCTAssertTrue(p.checked) } else { XCTFail() }
    }

    func testInvalidKnownBlockIsPreservedAsUnknown() throws {
        let bad = WireBlock(id: "b1", type: "heading", parentId: nil, rank: "V", text: .array([]), props: ["level": 9])
        let block = Block(wire: bad)
        XCTAssertTrue(block.isUnknown)
        XCTAssertEqual(block.wire.jsonValue.canonicalString, bad.jsonValue.canonicalString)
    }
}
