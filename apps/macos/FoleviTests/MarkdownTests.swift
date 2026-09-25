import XCTest

final class MarkdownTests: XCTestCase {
    private func goldenBlocks() throws -> [WireBlock] {
        let fixture = try Fixtures.json(Fixtures.editorSchema("document-golden.json"))
        return try XCTUnwrap(fixture["blocks"]?.arrayValue).map { try WireBlock(json: $0) }
    }

    func testExportWithResolversMatchesTypeScript() throws {
        let expected = try XCTUnwrap(Fixtures.reference["markdown"]?["withResolvers"]?.stringValue)
        let out = MarkdownCodec.blocksToMarkdown(try goldenBlocks(), .init(
            resolveFile: { "assets/\($0).bin" },
            resolveDocument: { $0.hasSuffix("2") ? "Project Atlas Brief.md" : nil }))
        XCTAssertEqual(out, expected)
    }

    func testExportWithTitleAndFrontMatterMatchesTypeScript() throws {
        let expected = try XCTUnwrap(Fixtures.reference["markdown"]?["withTitle"]?.stringValue)
        let out = MarkdownCodec.blocksToMarkdown(try goldenBlocks(), .init(
            title: "Field Notes & [Tides]", frontMatter: [("created", "2026-09-25"), ("tags", "travel \"sea\"")]))
        XCTAssertEqual(out, expected)
    }

    func testHTMLExportMatchesTypeScript() throws {
        let expected = try XCTUnwrap(Fixtures.reference["html"]?.stringValue)
        let out = HTMLExport.blocksToHTML(try goldenBlocks(), .init(title: "Field <Notes>", resolveFile: { "assets/\($0).bin" }))
        XCTAssertEqual(out, expected)
    }

    func testInlineParsingMatchesTypeScript() throws {
        for c in try XCTUnwrap(Fixtures.reference["inline"]?.arrayValue) {
            let input = try XCTUnwrap(c["input"]?.stringValue)
            let expected = try XCTUnwrap(c["output"])
            let actual = try JSONValue(encoding: MarkdownCodec.parseInline(input))
            XCTAssertEqual(actual.canonicalString, expected.canonicalString, input)
        }
    }

    func testImportMatchesTypeScript() throws {
        let src = try XCTUnwrap(Fixtures.reference["importSource"]?.stringValue)
        let expected = try XCTUnwrap(Fixtures.reference["importResult"])
        var n = 0
        let result = MarkdownCodec.markdownToBlocks(src, newId: {
            n += 1
            return String(format: "id%02d", n)
        })
        XCTAssertEqual(result.title, expected["title"]?.stringValue)
        let expectedBlocks = try XCTUnwrap(expected["blocks"]?.arrayValue)
        XCTAssertEqual(result.blocks.count, expectedBlocks.count)
        for (a, e) in zip(result.blocks, expectedBlocks) {
            XCTAssertEqual(a.jsonValue.canonicalString, e.canonicalString)
        }
        let warnings = result.warnings.map { "\($0.line):\($0.code)" }
        let expectedWarnings = (expected["warnings"]?.arrayValue ?? []).map { "\($0["line"]?.intValue ?? -1):\($0["code"]?.stringValue ?? "")" }
        XCTAssertEqual(warnings, expectedWarnings)
        XCTAssertEqual(result.frontMatter["author"], "Ada")
    }

    func testPlainTextImportMatchesTypeScript() throws {
        let expected = try XCTUnwrap(Fixtures.reference["plain"]?.arrayValue)
        var k = 0
        let blocks = MarkdownCodec.plainTextToBlocks("One\npara\n\n\nTwo  \n\nThree", newId: {
            k += 1
            return "p\(k)"
        })
        XCTAssertEqual(blocks.map(\.jsonValue.canonicalString), expected.map(\.canonicalString))
    }
}

final class RichTextTests: XCTestCase {
    func testNormalizeMergesRunsAndOrdersMarks() {
        let nodes: [InlineNode] = [
            .text(text: "a", marks: [.italic, .bold]),
            .text(text: "b", marks: [.bold, .italic]),
            .text(text: "", marks: nil),
            .text(text: "c", marks: []),
            .date(date: "2026-01-01"),
        ]
        XCTAssertEqual(RichText.normalizeInline(nodes), [
            .text(text: "ab", marks: [.bold, .italic]),
            .text(text: "c", marks: nil),
            .date(date: "2026-01-01"),
        ])
    }

    func testSanitizeHrefMatchesTypeScript() throws {
        for c in try XCTUnwrap(Fixtures.reference["hrefs"]?.arrayValue) {
            let input = try XCTUnwrap(c["input"]?.stringValue)
            XCTAssertEqual(RichText.sanitizeHref(input), c["output"]?.stringValue, input.debugDescription)
        }
    }

    func testWordCountMatchesTypeScript() throws {
        for c in try XCTUnwrap(Fixtures.reference["words"]?.arrayValue) {
            let input = try XCTUnwrap(c["input"]?.stringValue)
            XCTAssertEqual(RichText.wordCount(input), c["count"]?.intValue, input)
        }
    }

    func testPlainText() {
        XCTAssertEqual(RichText.plainText([.text(text: "Hi ", marks: nil), .mention(userId: "u", label: "Ada"), .pageLink(documentId: "d", label: " Doc")]), "Hi @Ada Doc")
    }

    func testSearchHighlightIsDiacriticInsensitive() {
        XCTAssertEqual(SearchText.highlightRanges("Café crème", query: "cafe"), [0..<4])
        XCTAssertEqual(SearchText.normalize("  Ünïcode\tTEXT "), "unicode text")
    }

    func testTaskViews() {
        XCTAssertEqual(TaskLogic.views(status: .open, dueDate: nil, assigneeId: nil, today: "2026-09-25", viewerId: "me"), [.all, .inbox])
        XCTAssertEqual(TaskLogic.views(status: .open, dueDate: "2026-09-20", assigneeId: "me", today: "2026-09-25", viewerId: "me"), [.all, .today, .mine])
        XCTAssertEqual(TaskLogic.views(status: .done, dueDate: nil, assigneeId: nil, today: "2026-09-25", viewerId: "me"), [.completed])
        XCTAssertEqual(TaskLogic.addDays("2026-12-31", 1), "2027-01-01")
    }
}
