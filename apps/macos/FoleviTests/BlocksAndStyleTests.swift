import XCTest

/// Blocks, the slash menu and note style, brought to parity with the web.
final class InsertCatalogTests: XCTestCase {
    func testPlainInsertsMakeTheWebsBlocks() throws {
        XCTAssertEqual(InsertCatalog.content(for: "divider-strong"), .divider(DividerProps(style: .strong)))
        XCTAssertEqual(InsertCatalog.content(for: "divider-extralight"), .divider(DividerProps(style: .extralight)))
        XCTAssertNil(InsertCatalog.content(for: "divider-bold"))
        XCTAssertEqual(InsertCatalog.content(for: "pagebreak"), .pageBreak(PageBreakProps()))
        XCTAssertEqual(InsertCatalog.content(for: "formula"), .formula(FormulaProps(latex: "")))
        XCTAssertEqual(InsertCatalog.content(for: "whiteboard"), .whiteboard(WhiteboardProps(data: "", height: 420)))
        guard case .code(let code) = try XCTUnwrap(InsertCatalog.content(for: "mermaid")) else { return XCTFail("mermaid is a code block") }
        XCTAssertEqual(code.language, "mermaid")
        XCTAssertTrue(code.code.hasPrefix("flowchart TD\n  A[Idea] --> B{Worth doing?}"))
        XCTAssertNil(InsertCatalog.content(for: "collection"))
    }

    func testTablesAreThreeByThreeOrThePickedSize() throws {
        guard case .table(let t) = try XCTUnwrap(InsertCatalog.content(for: "table")) else { return XCTFail() }
        XCTAssertEqual(t.rows.count, 3)
        XCTAssertEqual(t.rows[0].count, 3)
        XCTAssertTrue(t.headerRow)
        guard case .table(let picked) = try XCTUnwrap(InsertCatalog.content(for: "table-5x8")) else { return XCTFail() }
        XCTAssertEqual(picked.rows.count, 5)
        XCTAssertEqual(picked.rows.map(\.count), Array(repeating: 8, count: 5))
        XCTAssertNil(InsertCatalog.content(for: "table-x"))
        // defaultContent falls through to the catalog.
        XCTAssertEqual(BlockContent.defaultContent(for: "pagebreak"), .pageBreak(PageBreakProps()))
        XCTAssertEqual(BlockContent.defaultContent(for: "nonsense"), .paragraph(ParagraphProps()))
    }

    func testSlashRankPutsLabelMatchesFirst() {
        let items: [(String, String)] = [
            ("Divider", "divider rule separator line"),
            ("Mermaid diagram", "mermaid diagram flowchart chart graph sequence"),
            ("Flowchart", "flowchart diagram process flow chart"),
            ("Page break", "page break print pdf new sheet"),
            ("Page", "page nested subpage child link"),
        ]
        let flow = InsertCatalog.filter(items, query: "flowchart", label: \.0, keywords: \.1).map(\.0)
        XCTAssertEqual(flow, ["Flowchart", "Mermaid diagram"])
        let page = InsertCatalog.filter(items, query: "page", label: \.0, keywords: \.1).map(\.0)
        XCTAssertEqual(page, ["Page break", "Page"])
        let all = InsertCatalog.filter(items, query: "", label: \.0, keywords: \.1).map(\.0)
        XCTAssertEqual(all, items.map(\.0))
        let line = InsertCatalog.filter(items, query: "LINE", label: \.0, keywords: \.1).map(\.0)
        XCTAssertEqual(line, ["Divider"])
        XCTAssertEqual(InsertCatalog.rank(label: "Divider: Strong", query: "strong"), 1)
        XCTAssertEqual(InsertCatalog.rank(label: "Divider: Strong", query: "div"), 0)
        XCTAssertEqual(InsertCatalog.rank(label: "Table", query: "grid"), 2)
    }
}

final class LaTeXTests: XCTestCase {
    func testFractionsScriptsAndRoots() {
        guard case .frac(let num, let den, true) = LaTeX.parse("\\frac{a}{b}") else { return XCTFail() }
        XCTAssertEqual(num, .symbol("a", .ord, .math))
        XCTAssertEqual(den, .symbol("b", .ord, .math))
        guard case .scripts(let base, let sub, let sup) = LaTeX.parse("x_i^2") else { return XCTFail() }
        XCTAssertEqual(base, .symbol("x", .ord, .math))
        XCTAssertEqual(sub, .symbol("i", .ord, .math))
        XCTAssertEqual(sup, .symbol("2", .ord, .roman))
        guard case .sqrt(_, let index) = LaTeX.parse("\\sqrt[3]{x}") else { return XCTFail() }
        XCTAssertEqual(index, .symbol("3", .ord, .roman))
    }

    func testSymbolsOperatorsAndText() {
        guard case .row(let items) = LaTeX.parse("E = mc^2") else { return XCTFail() }
        XCTAssertEqual(items.count, 4)
        XCTAssertEqual(items[1], .symbol("=", .rel, .roman))
        XCTAssertEqual(LaTeX.parse("\\alpha"), .symbol("α", .ord, .math))
        XCTAssertEqual(LaTeX.parse("\\Omega"), .symbol("Ω", .ord, .roman))
        XCTAssertEqual(LaTeX.parse("\\leq"), .symbol("≤", .rel, .roman))
        XCTAssertEqual(LaTeX.parse("\\sin"), .text("sin", .roman))
        XCTAssertEqual(LaTeX.parse("\\text{if } x"), .row([.text("if ", .roman), .symbol("x", .ord, .math)]))
        XCTAssertEqual(LaTeX.parse("\\mathbb{R}"), .symbol("R", .ord, .blackboard))
        guard case .scripts(.bigOp("∑", true), let sub, let sup) = LaTeX.parse("\\sum_{i=1}^{n}") else { return XCTFail() }
        XCTAssertNotNil(sub)
        XCTAssertEqual(sup, .symbol("n", .ord, .math))
        XCTAssertEqual(LaTeX.parse("\\nosuchthing"), .error("\\nosuchthing"))
    }

    func testDelimitersAndEnvironments() {
        guard case .fenced("(", _, ")") = LaTeX.parse("\\left( \\frac{1}{2} \\right)") else { return XCTFail() }
        guard case .matrix(let rows, let align, "(", ")") = LaTeX.parse("\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}") else { return XCTFail() }
        XCTAssertEqual(rows.count, 2)
        XCTAssertEqual(rows.map(\.count), [2, 2])
        XCTAssertEqual(align, ["c", "c"])
        guard case .matrix(let cases, _, "{", "") = LaTeX.parse("f(x) = \\begin{cases} 1 & x > 0 \\\\ 0 & \\text{otherwise} \\end{cases}".components(separatedBy: "= ").last!) else {
            return XCTFail()
        }
        XCTAssertEqual(cases.count, 2)
        guard case .matrix(_, let aligned, "", "") = LaTeX.parse("\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}") else { return XCTFail() }
        XCTAssertEqual(aligned, ["r", "l"])
    }

    func testNeverLosesInputOnMalformedSource() {
        // Unbalanced groups and stray scripts still parse.
        _ = LaTeX.parse("\\frac{a")
        _ = LaTeX.parse("}{^_")
        _ = LaTeX.parse("\\left(")
        _ = LaTeX.parse("\\begin{matrix} a &")
        XCTAssertEqual(LaTeX.parse(""), .row([]))
    }
}

final class WhiteboardEditingTests: XCTestCase {
    func testSerializeRoundTripsThroughTheValidator() {
        let strokes = [
            Whiteboard.Stroke(points: [(10, 20), (30.5, 40)], color: "blue", width: 2.5),
            Whiteboard.Stroke(points: [(1, 1)], color: "yellow", width: 18, opacity: 0.4),
        ]
        let data = Whiteboard.serialize(strokes)
        let back = Whiteboard.strokes(data)
        XCTAssertEqual(back.count, 2)
        XCTAssertEqual(back[0].color, "blue")
        XCTAssertEqual(back[0].points?.map(\.0), [10, 30.5])
        XCTAssertEqual(back[1].opacity, 0.4)
        XCTAssertEqual(Whiteboard.serialize([]), "")
        XCTAssertTrue(Whiteboard.svg(data: data, height: 420).contains("stroke=\"#2563eb\""))
    }

    func testEraserHitsStrokesNearThePointer() {
        let s = Whiteboard.Stroke(points: [(0, 0), (100, 0)], color: "ink", width: 4)
        XCTAssertTrue(Whiteboard.strokeHit(s, (50, 9), radius: 8))
        XCTAssertFalse(Whiteboard.strokeHit(s, (50, 11), radius: 8))
        XCTAssertFalse(Whiteboard.strokeHit(Whiteboard.Stroke(d: "M0 0L10 10", color: "ink", width: 2), (5, 5), radius: 8))
        XCTAssertEqual(Whiteboard.distanceToSegment((5, 5), (0, 0), (0, 0)), (50.0).squareRoot(), accuracy: 1e-9)
    }

    func testHeightIsClamped() {
        XCTAssertEqual(Whiteboard.clampHeight(nil), 420)
        XCTAssertEqual(Whiteboard.clampHeight(10), 120)
        XCTAssertEqual(Whiteboard.clampHeight(99_999), 2400)
        XCTAssertEqual(Whiteboard.clampHeight(500), 500)
    }
}

final class CollectionLogicTests: XCTestCase {
    private func snapshot() throws -> CollectionSnapshot {
        let json = """
        {"id":"c1","name":"Tasks","canEdit":true,"workspaceId":null,"isMember":true,"hostDocumentId":"d0",
         "people":[{"id":"p1","name":"Ada"}],
         "properties":[
           {"id":"status","name":"Status","type":"select","options":[{"id":"todo","name":"Not started","color":"muted"},{"id":"done","name":"Done","color":"moss"}]},
           {"id":"est","name":"Estimate","type":"number"},
           {"id":"due","name":"Date","type":"date"}],
         "views":[{"id":"v1","name":"Board","type":"board","config":{"filters":[],"sorts":[],"groupBy":"status","visibleProperties":["status","est"],"cardPreview":"cover","cardSize":"medium"}}],
         "rows":[
           {"id":"r1","documentId":"a","title":"Write","icon":null,"cover":{"kind":"none"},"excerpt":"","rank":"a","values":{"status":"todo","est":3},"updatedAt":1},
           {"id":"r2","documentId":"b","title":"Ship","icon":null,"cover":{"kind":"art","value":"art-02"},"excerpt":"","rank":"b","values":{"status":"done","est":8,"due":"2026-10-02"},"updatedAt":2},
           {"id":"r3","documentId":"c","title":"Plan","icon":null,"cover":{"kind":"none"},"excerpt":"","rank":"c","values":{},"updatedAt":3}]}
        """
        return try JSONDecoder().decode(CollectionSnapshot.self, from: Data(json.utf8))
    }

    func testDecodesTheServersShape() throws {
        let s = try snapshot()
        XCTAssertEqual(s.properties.map(\.id), ["status", "est", "due"])
        XCTAssertEqual(s.properties[0].options.map(\.name), ["Not started", "Done"])
        XCTAssertEqual(s.properties[1].options, [])
        XCTAssertEqual(s.views.first?.config.groupBy, "status")
        XCTAssertEqual(s.rows[1].cover?.value, "art-02")
        XCTAssertEqual(s.view(preferred: "missing", fallback: "v1")?.id, "v1")
    }

    func testFiltersAndSorts() throws {
        let s = try snapshot()
        func ids(_ c: CollectionSnapshot.ViewConfig) -> [String] { CollectionLogic.apply(s.rows, c, s.properties).map(\.id) }
        XCTAssertEqual(ids(.init(filters: [.init(propertyId: "status", op: "is", value: .string("done"))])), ["r2"])
        // Older views stored the option's name.
        XCTAssertEqual(ids(.init(filters: [.init(propertyId: "status", op: "is", value: .string("Not started"))])), ["r1"])
        XCTAssertEqual(ids(.init(filters: [.init(propertyId: "est", op: "gt", value: .number(4))])), ["r2"])
        XCTAssertEqual(ids(.init(filters: [.init(propertyId: "status", op: "isEmpty")])), ["r3"])
        XCTAssertEqual(ids(.init(filters: [.init(propertyId: "title", op: "contains", value: .string("PL"))])), ["r3"])
        XCTAssertEqual(ids(.init(filters: [.init(propertyId: "due", op: "lt", value: .string("2026-12-01"))])), ["r2"])
        // A filter without a value yet, or on a deleted property, hides nothing.
        XCTAssertEqual(ids(.init(filters: [.init(propertyId: "est", op: "is")])), ["r1", "r2", "r3"])
        XCTAssertEqual(ids(.init(filters: [.init(propertyId: "gone", op: "isEmpty")])), ["r1", "r2", "r3"])
        // As on the web: rows without a value come last ascending, so first descending.
        XCTAssertEqual(ids(.init(sorts: [.init(propertyId: "est", direction: "desc")])), ["r3", "r2", "r1"])
        XCTAssertEqual(ids(.init(sorts: [.init(propertyId: "est", direction: "asc")])), ["r1", "r2", "r3"])
        XCTAssertEqual(ids(.init(sorts: [.init(propertyId: "title", direction: "asc")])), ["r3", "r2", "r1"])
    }

    func testBoardColumns() throws {
        let s = try snapshot()
        let board = try XCTUnwrap(s.boardColumns(for: s.views[0]))
        XCTAssertEqual(board.columns.map(\.name), ["Not started", "Done", "No status"])
        XCTAssertEqual(CollectionLogic.rows(s.rows, inColumn: "todo", groupBy: "status").map(\.id), ["r1"])
        XCTAssertEqual(CollectionLogic.rows(s.rows, inColumn: nil, groupBy: "status").map(\.id), ["r3"])
        var table = s.views[0]
        table.config.groupBy = "est"
        XCTAssertNil(s.boardColumns(for: table))
    }

    func testViewConfigEncodesWithoutEmptyKeys() throws {
        let c = CollectionSnapshot.ViewConfig(filters: [.init(propertyId: "status", op: "isEmpty")], visibleProperties: ["status"])
        let json = c.json
        XCTAssertNil(json["groupBy"])
        XCTAssertNil(json["filters"]?.arrayValue?.first?["value"])
        XCTAssertEqual(json["cardSize"], .string("medium"))
    }
}

final class MonthGridTests: XCTestCase {
    func testMonthsStartOnTheRightWeekday() {
        XCTAssertEqual(MonthGrid.weekdayOfFirst(year: 2026, month: 10), 5) // Thursday
        XCTAssertEqual(MonthGrid.weekdayOfFirst(year: 2024, month: 2), 5) // Thursday
        XCTAssertEqual(MonthGrid.daysIn(year: 2024, month: 2), 29)
        XCTAssertEqual(MonthGrid.daysIn(year: 2100, month: 2), 28)
        let cells = MonthGrid.cells(year: 2026, month: 10, firstWeekday: 2) // Monday first
        XCTAssertEqual(cells.count % 7, 0)
        XCTAssertEqual(cells.prefix(3).compactMap { $0 }, [])
        XCTAssertEqual(cells[3], "2026-10-01")
        XCTAssertEqual(cells.compactMap { $0 }.count, 31)
    }

    func testMonthArithmetic() {
        XCTAssertTrue(MonthGrid.adding(-1, to: (2026, 1)) == (2025, 12))
        XCTAssertTrue(MonthGrid.adding(13, to: (2026, 1)) == (2027, 2))
        XCTAssertTrue(MonthGrid.month(of: "2026-10-01")! == (2026, 10))
        XCTAssertNil(MonthGrid.month(of: "nope"))
    }
}

final class MermaidFlowTests: XCTestCase {
    func testReadsTheStarterDiagram() throws {
        let d = try MermaidFlow.parse(InsertCatalog.mermaidSample).get()
        XCTAssertFalse(d.leftToRight)
        XCTAssertEqual(d.nodes.map(\.id), ["A", "B", "C", "D", "E"])
        XCTAssertEqual(d.nodes.map(\.text), ["Idea", "Worth doing?", "Plan it", "Park it", "Ship"])
        XCTAssertEqual(d.nodes[1].shape, .decision)
        XCTAssertEqual(d.edges.count, 4)
        XCTAssertEqual(d.edges[1].label, "Yes")
        XCTAssertEqual(d.edges[2].label, "Not yet")
        XCTAssertEqual(d.edges[0].arrow, .end)
    }

    func testLinkFormsAndGroups() throws {
        let d = try MermaidFlow.parse("graph LR\n  A([Start]) -.-> B[(Data)] & C\n  C ==>|go| D((End))\n  D --- A; %% comment").get()
        XCTAssertTrue(d.leftToRight)
        XCTAssertEqual(d.nodes.first { $0.id == "A" }?.shape, .terminator)
        XCTAssertEqual(d.nodes.first { $0.id == "D" }?.shape, .circle)
        XCTAssertEqual(d.edges.count, 4)
        XCTAssertTrue(d.edges[0].dashed)
        XCTAssertTrue(d.edges[2].thick)
        XCTAssertEqual(d.edges[2].label, "go")
        XCTAssertEqual(d.edges[3].arrow, .none)
    }

    func testLayoutStacksLayers() throws {
        let d = MermaidFlow.layout(try MermaidFlow.parse(InsertCatalog.mermaidSample).get())
        let y = Dictionary(uniqueKeysWithValues: d.nodes.map { ($0.id, $0.y) })
        XCTAssertLessThan(y["A"]!, y["B"]!)
        XCTAssertLessThan(y["B"]!, y["C"]!)
        XCTAssertEqual(y["C"], y["D"])
        XCTAssertLessThan(y["C"]!, y["E"]!)
        // Nodes in a layer don't overlap.
        let c = d.nodes.first { $0.id == "C" }!, dd = d.nodes.first { $0.id == "D" }!
        XCTAssertTrue(c.x + c.w <= dd.x || dd.x + dd.w <= c.x)
    }

    func testOtherDiagramsAreNotDrawn() {
        XCTAssertEqual(MermaidFlow.parse("sequenceDiagram\n  A->>B: hi").failureValue, .notFlowchart)
        XCTAssertEqual(MermaidFlow.parse("flowchart TD").failureValue, .empty)
    }
}

private extension Result {
    var failureValue: Failure? { if case .failure(let e) = self { return e } else { return nil } }
}

final class NoteStyleTests: XCTestCase {
    private let style = DocumentStyle(font: .sans, width: .wide, background: .paper, accent: .plum, card: .folio)

    func testNewNotesStartPlainAndWide() {
        XCTAssertEqual(defaultDocumentCover.kind, .none)
        XCTAssertEqual(defaultDocumentStyle.width, .wide)
        XCTAssertNil(defaultDocumentStyle.blur)
        XCTAssertNil(PageBackdrop.resolve(style: defaultDocumentStyle, cover: defaultDocumentCover))
    }

    func testBackdropFollowsTheNoteStyle() {
        XCTAssertEqual(PageBackdrop.resolve(style: style, cover: DocumentCover(kind: .art, value: "art-03")), .art("art-03"))
        XCTAssertEqual(PageBackdrop.resolve(style: style, cover: DocumentCover(kind: .gradient)), .cover(.gradient, accent: .plum))
        XCTAssertEqual(PageBackdrop.resolve(style: style, cover: DocumentCover(kind: .color, value: "moss")), .cover(.color, accent: .moss))
        XCTAssertEqual(PageBackdrop.resolve(style: style, cover: DocumentCover(kind: .art, value: "art-99")) { _ in false }, .cover(.gradient, accent: .plum))
        var own = style
        own.backdrop = "color:sky"
        guard case .colors("sky", let stops) = PageBackdrop.resolve(style: own, cover: DocumentCover(kind: .art, value: "art-03")) else { return XCTFail() }
        XCTAssertEqual(stops.count, 3)
        own.backdrop = PageBackdrop.none
        XCTAssertNil(PageBackdrop.resolve(style: own, cover: DocumentCover(kind: .art, value: "art-03")))
        XCTAssertEqual(PageBackdrop.styleName(cover: DocumentCover(kind: .none)) { _ in nil }, "Plain")
        XCTAssertEqual(PageBackdrop.styleName(cover: DocumentCover(kind: .art, value: "art-01")) { _ in "Harbor" }, "Harbor")
    }

    func testBlurRoundTripsInTheStyle() throws {
        var s = style
        s.blur = true
        let back = try JSONValue(encoding: s).decode(DocumentStyle.self)
        XCTAssertEqual(back.blur, true)
        XCTAssertNil(try JSONValue(encoding: style)["blur"])
    }

    func testBlockLookReadsTheProps() {
        let look = BlockLook(.paragraph(ParagraphProps(textStyle: .caption, decoration: .focus, color: .navy, align: .center, font: .serif, group: .card)))
        XCTAssertEqual(look.textStyle, .caption)
        XCTAssertEqual(look.decoration, .focus)
        XCTAssertEqual(look.align, .center)
        XCTAssertFalse(look.isPlain)
        XCTAssertTrue(BlockLook(.divider(DividerProps(style: .light))).isPlain)
        XCTAssertEqual(BlockLook.colorHex(.navy, darkPage: false), "#1d33d6")
        XCTAssertEqual(BlockLook.colorHex(.navy, darkPage: true), "#7b8cff")
        XCTAssertNil(BlockLook.colorHex(.black, darkPage: false))
        let edges = BlockLook.cardEdges(ids: ["a", "b", "c", "d"], grouped: ["b", "c"])
        XCTAssertTrue(edges["b"]! == (true, false))
        XCTAssertTrue(edges["c"]! == (false, true))
        XCTAssertNil(edges["a"])
    }
}
