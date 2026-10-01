import XCTest

/// Editor behaviours ported from the web editor: paste normalization (paste.ts), find and replace
/// (findReplace.ts) and "Convert to flowchart" (flowchartMermaid.ts).
final class EditorParityTests: XCTestCase {
    private func ids() -> () -> String {
        var n = 0
        return {
            n += 1
            return "b\(n)"
        }
    }

    // MARK: Paste

    func testPasteHTMLStructureAndMarks() {
        let html = """
        <html><body><h1>Title</h1><p>Hello <strong>bold</strong> and <a href="https://example.com">link</a></p>
        <ul><li>One<ul><li>Nested</li></ul></li><li>Two</li></ul>
        <blockquote>Quoted</blockquote><pre><code class="language-swift">let x = 1
        </code></pre><hr><script>alert(1)</script></body></html>
        """
        let blocks = PasteHTML.blocks(html, newId: ids())
        XCTAssertEqual(blocks.map(\.type), ["heading", "paragraph", "bulleted", "bulleted", "bulleted", "quote", "code", "divider"])
        // The nested item hangs under "One".
        XCTAssertEqual(blocks[3].parentId, blocks[2].id)
        XCTAssertNil(blocks[4].parentId)
        let para = Block(wire: blocks[1])
        XCTAssertEqual(para.text, [
            .text(text: "Hello ", marks: nil), .text(text: "bold", marks: [.bold]), .text(text: " and ", marks: nil),
            .text(text: "link", marks: [.link(href: "https://example.com")]),
        ])
        if case .code(let p) = Block(wire: blocks[6]).content {
            XCTAssertEqual(p.language, "swift")
            XCTAssertEqual(p.code, "let x = 1")
        } else {
            XCTFail("expected code")
        }
    }

    func testPasteHTMLChecklistAndTable() {
        let html = #"<ul><li><input type="checkbox" checked>Done</li><li class="task-list-item">Open</li></ul><table><tr><th>A</th><th>B</th></tr><tr><td>1</td></tr></table>"#
        let blocks = PasteHTML.blocks(html, newId: ids())
        XCTAssertEqual(blocks.map(\.type), ["todo", "todo", "table"])
        if case .todo(let p) = Block(wire: blocks[0]).content { XCTAssertTrue(p.checked) } else { XCTFail("todo") }
        if case .todo(let p) = Block(wire: blocks[1]).content { XCTAssertFalse(p.checked) } else { XCTFail("todo") }
        if case .table(let t) = Block(wire: blocks[2]).content {
            XCTAssertTrue(t.headerRow)
            XCTAssertEqual(t.rows.count, 2)
            XCTAssertEqual(t.rows[1].count, 2, "short rows are padded")
        } else {
            XCTFail("table")
        }
    }

    // MARK: Find and replace

    func testFindRespectsMatchCase() {
        XCTAssertEqual(FindReplace.ranges(of: "cat", in: "Cat cat CAT").count, 3)
        XCTAssertEqual(FindReplace.ranges(of: "cat", in: "Cat cat CAT", caseSensitive: true), [NSRange(location: 4, length: 3)])
    }

    func testReplaceOneOccurrenceBySkipping() {
        let r = FindReplace.replace(in: [.text(text: "a-a-a", marks: nil)], query: "a", with: "b", limit: 1, skip: 1)
        XCTAssertEqual(r.count, 1)
        XCTAssertEqual(r.nodes, [.text(text: "a-b-a", marks: nil)])
        let code = Block(id: "c", parentId: nil, rank: "V", content: .code(CodeProps(language: "plaintext", code: "x x x")))
        let c = FindReplace.replace(in: code, query: "x", with: "y", limit: 1, skip: 2)
        if case .code(let p)? = c?.block.content { XCTAssertEqual(p.code, "x x y") } else { XCTFail("code") }
    }

    // MARK: Mermaid to flowchart

    func testConvertMermaidFlowchart() throws {
        let source = "flowchart LR\n  A([Start]) --> B{Ready?}\n  B -- yes --> C[Ship]\n  B -.-> D[Wait]"
        XCTAssertTrue(MermaidConvert.isFlowchartSource(source))
        let r = try MermaidConvert.convert(source).get()
        XCTAssertEqual(r.direction, .leftRight)
        XCTAssertEqual(r.data.nodes.count, 4)
        XCTAssertEqual(r.data.edges.count, 3)
        XCTAssertEqual(r.data.nodes.map(\.shape), [.terminator, .decision, .process, .process])
        XCTAssertEqual(r.data.edges.first { $0.label == "yes" }?.style, .solid)
        XCTAssertTrue(r.data.edges.contains { $0.style == .dashed })
        XCTAssertGreaterThanOrEqual(r.height, Double(FoleviLimits.minFlowchartHeight))
    }

    func testConvertRejectsOtherDiagrams() {
        XCTAssertFalse(MermaidConvert.isFlowchartSource("sequenceDiagram\n A->>B: hi"))
        guard case .failure(let e) = MermaidConvert.convert("sequenceDiagram\n A->>B: hi") else { return XCTFail("should fail") }
        XCTAssertEqual(e.text, "Only Mermaid flowcharts (starting with “flowchart” or “graph”) can be converted.")
    }
}
