import XCTest

/// The Swift flowchart port against outputs of the TypeScript reference
/// (Fixtures/flowchart-reference.json, written by apps/macos/scripts/generate-flowchart-fixtures.mjs).
final class FlowchartTests: XCTestCase {
    private var ref: JSONValue!

    override func setUpWithError() throws {
        ref = try Fixtures.json(Fixtures.local("flowchart-reference.json"))
    }

    // MARK: Fixture helpers

    private func num(_ v: JSONValue?) -> Double { v?.doubleValue ?? .nan }

    private func node(_ v: JSONValue) -> FlowNode {
        FlowNode(id: v["id"]!.stringValue!, shape: FlowShape(rawValue: v["shape"]!.stringValue!)!, x: num(v["x"]), y: num(v["y"]),
                 w: num(v["w"]), h: num(v["h"]), text: v["text"]?.stringValue ?? "", color: FlowColor(rawValue: v["color"]?.stringValue ?? "neutral")!)
    }

    private func edge(_ v: JSONValue) -> FlowEdge {
        FlowEdge(id: v["id"]!.stringValue!, from: v["from"]!.stringValue!, to: v["to"]!.stringValue!,
                 fromSide: v["fromSide"]?.stringValue.flatMap(FlowSide.init(rawValue:)), toSide: v["toSide"]?.stringValue.flatMap(FlowSide.init(rawValue:)),
                 label: v["label"]?.stringValue ?? "", style: FlowEdgeStyle(rawValue: v["style"]?.stringValue ?? "solid")!,
                 arrow: FlowArrow(rawValue: v["arrow"]?.stringValue ?? "end")!)
    }

    private func chart(_ v: JSONValue) -> FlowchartData {
        FlowchartData(nodes: (v["nodes"]?.arrayValue ?? []).map(node), edges: (v["edges"]?.arrayValue ?? []).map(edge))
    }

    private func point(_ v: JSONValue) -> FlowPoint { FlowPoint(x: num(v["x"]), y: num(v["y"])) }
    private func rect(_ v: JSONValue) -> FlowRect { FlowRect(x: num(v["x"]), y: num(v["y"]), w: num(v["w"]), h: num(v["h"])) }

    /// The source charts, rebuilt from their serialised form.
    private func source(_ name: String) -> FlowchartData {
        Flowchart.parse(ref["flowchartData"]![name]!.stringValue!)
    }

    // MARK: Model

    func testSerializeRoundTripsTheReferenceCharts() {
        for (name, data) in ref["flowchartData"]!.objectValue! {
            let s = data.stringValue!
            XCTAssertEqual(Flowchart.serialize(Flowchart.parse(s)), s, name)
            XCTAssertNil(Flowchart.dataIssue(s), name)
        }
        XCTAssertEqual(Flowchart.serialize(.empty), "")
    }

    func testDataIssueAndForgivingParse() {
        for (i, c) in ref["issues"]!.arrayValue!.enumerated() {
            let data = c["data"]!.stringValue!
            XCTAssertEqual(Flowchart.dataIssue(data), c["issue"]?.stringValue, data)
            let parsed = Flowchart.serialize(Flowchart.parse(data))
            if i == 16 {
                // Duplicate ids: the second is renamed to a random one.
                let fc = Flowchart.parse(data)
                XCTAssertEqual(fc.nodes.count, 2)
                XCTAssertEqual(fc.nodes[0].id, "a")
                XCTAssertTrue(fc.nodes[1].id.hasPrefix("n") && fc.nodes[1].id.count == 8)
            } else {
                XCTAssertEqual(parsed, c["parsed"]!.stringValue!, data)
            }
        }
        XCTAssertEqual(Flowchart.dataIssue(String(repeating: "x", count: 200_001)), ref["tooLarge"]!.stringValue!)
    }

    func testNormalizeMatchesReference() {
        for c in ref["normalize"]!.arrayValue! {
            let (data, unplaced) = Flowchart.normalize(c["input"]!)
            let expected = chart(c["out"]!)
            XCTAssertEqual(data, expected)
            XCTAssertEqual(unplaced, (c["out"]!["unplaced"]?.arrayValue ?? []).map { $0.stringValue! })
        }
    }

    func testSearchText() {
        for (name, text) in ref["texts"]!.objectValue! {
            XCTAssertEqual(Flowchart.text(source(name)), text.stringValue!, name)
        }
        let block = WireBlock(id: ULID.make(), type: FlowchartProps.type, parentId: nil, rank: "V",
                              props: FlowchartProps(data: ref["flowchartData"]!["sideways"]!.stringValue!, height: 440).json)
        XCTAssertEqual(SearchText.blockText(block), ref["texts"]!["sideways"]!.stringValue!)
    }

    func testTextMetrics() {
        for c in ref["measures"]!.arrayValue! {
            let t = c["text"]!.stringValue!
            XCTAssertEqual(Flowchart.measure(t), num(c["w14"]), accuracy: 1e-9, t)
            XCTAssertEqual(Flowchart.measure(t, fontSize: 12.5), num(c["w12"]), accuracy: 1e-9, t)
        }
        for c in ref["wraps"]!.arrayValue! {
            let t = c["text"]!.stringValue!
            XCTAssertEqual(Flowchart.wrap(t, maxWidth: num(c["width"])), c["lines"]!.arrayValue!.map { $0.stringValue! }, t)
        }
    }

    func testFitNodeToText() {
        for c in ref["fit"]!.arrayValue! {
            let n = node(c["input"]!)
            XCTAssertEqual(Flowchart.fitToText(n), node(c["plain"]!), n.text)
            XCTAssertEqual(Flowchart.fitToText(n, maxWidth: 240), node(c["wide"]!), n.text)
            XCTAssertEqual(Flowchart.lines(n), c["lines"]!.arrayValue!.map { $0.stringValue! })
            XCTAssertEqual(Flowchart.neededHeight(n), num(c["needed"]))
            XCTAssertEqual(Flowchart.textWidth(n), num(c["textWidth"]), accuracy: 1e-9)
        }
    }

    func testPropsAndHeight() {
        let p = FlowchartProps(.object(["data": "", "height": 99999]))
        XCTAssertEqual(p?.height, 1600)
        XCTAssertEqual(FlowchartProps(.object(["data": "x"]))?.height, 440)
        XCTAssertEqual(FlowchartProps(.object(["height": 250.4]))?.height, 250)
        XCTAssertEqual(FlowchartProps().json, .object(["data": "", "height": 440]))
        XCTAssertEqual(Flowchart.jsRound(-2.5), -2)
        XCTAssertEqual(Flowchart.jsRound(2.5), 3)
    }

    // MARK: Geometry

    func testShapesAndPorts() {
        for c in ref["shapes"]!.arrayValue! {
            let n = node(c["node"]!)
            XCTAssertEqual(FlowGeometry.shapePath(n), c["path"]!.stringValue!, n.shape.rawValue)
            for (si, side) in FlowSide.allCases.enumerated() {
                for (ti, t) in [0.5, 0.18, 0.86].enumerated() {
                    let p = FlowGeometry.portPoint(n, side, t)
                    let e = point(c["ports"]!.arrayValue![si].arrayValue![ti])
                    XCTAssertEqual(p.x, e.x, accuracy: 1e-9)
                    XCTAssertEqual(p.y, e.y, accuracy: 1e-9)
                }
            }
            XCTAssertFalse(FlowPath.parse(c["path"]!.stringValue!).isEmpty)
        }
    }

    func testSidesRoutesAndPolylines() {
        for c in ref["autoSides"]!.arrayValue! {
            let s = FlowGeometry.autoSides(rect(c["a"]!), rect(c["b"]!))
            XCTAssertEqual([s.0.rawValue, s.1.rawValue], c["sides"]!.arrayValue!.map { $0.stringValue! })
        }
        for c in ref["nearest"]!.arrayValue! {
            XCTAssertEqual(FlowGeometry.nearestSide(rect(c["n"]!), point(c["p"]!)).rawValue, c["side"]!.stringValue!)
        }
        for c in ref["ortho"]!.arrayValue! {
            let a = c["args"]!.arrayValue!
            let pts = FlowGeometry.orthogonalRoute(point(a[0]), FlowSide(rawValue: a[1].stringValue!)!, point(a[2]), FlowSide(rawValue: a[3].stringValue!)!, rect(a[4]), rect(a[5]))
            XCTAssertEqual(pts, c["points"]!.arrayValue!.map(point))
        }
        for c in ref["polylines"]!.arrayValue! {
            let pts = c["points"]!.arrayValue!.map(point)
            let d = c["radius"]!.isNull ? FlowGeometry.roundedPolyline(pts) : FlowGeometry.roundedPolyline(pts, radius: num(c["radius"]))
            XCTAssertEqual(d, c["d"]!.stringValue!)
        }
    }

    func testRouteEdgesAndBounds() {
        for (name, expected) in ref["routes"]!.objectValue! {
            let fc = source(name)
            let routed = FlowGeometry.routeEdges(fc)
            let list = expected["routed"]!.arrayValue!
            XCTAssertEqual(routed.count, list.count, name)
            for (r, e) in zip(routed, list) {
                XCTAssertEqual(r.edge.id, e["id"]!.stringValue!)
                XCTAssertEqual(r.points, e["points"]!.arrayValue!.map(point), "\(name) \(r.edge.id)")
                XCTAssertEqual(r.d, e["d"]!.stringValue!, "\(name) \(r.edge.id)")
                XCTAssertEqual(r.heads, e["heads"]!.arrayValue!.map { $0.stringValue! }, "\(name) \(r.edge.id)")
                XCTAssertEqual(r.fromSide.rawValue, e["fromSide"]!.stringValue!)
                XCTAssertEqual(r.toSide.rawValue, e["toSide"]!.stringValue!)
                if let l = e["label"], !l.isNull {
                    XCTAssertEqual(r.label, RoutedEdge.Label(x: num(l["x"]), y: num(l["y"]), w: num(l["w"]), h: num(l["h"]), cx: num(l["cx"]), cy: num(l["cy"])))
                } else {
                    XCTAssertNil(r.label)
                }
            }
            XCTAssertEqual(FlowGeometry.bounds(fc, routed: routed), rect(expected["bounds"]!), name)
        }
        XCTAssertNil(FlowGeometry.bounds(.empty))
    }

    // MARK: Layout, Mermaid, SVG

    func testLayoutMatchesReference() {
        let cases: [(String, String, () -> FlowchartData)] = [
            ("approvalTD", "approval", { FlowchartLayout.layout(self.source("approval"), direction: .topDown) }),
            ("approvalLR", "approval", { FlowchartLayout.layout(self.source("approval"), direction: .leftRight, origin: FlowPoint(x: 100, y: -40)) }),
            ("sidewaysAuto", "sideways", { FlowchartLayout.layout(self.source("sideways"), direction: FlowchartExport.direction(self.source("sideways"))) }),
            ("tangledTD", "tangled", { FlowchartLayout.layout(self.source("tangled")) }),
            ("tangledLR", "tangled", { FlowchartLayout.layout(self.source("tangled"), direction: .leftRight, nodeGap: 30, layerGap: 50) }),
            ("fanTD", "fan", { FlowchartLayout.layout(self.source("fan"), origin: FlowPoint(x: 0, y: 0)) }),
        ]
        for (key, _, run) in cases {
            XCTAssertEqual(run(), chart(ref["layouts"]![key]!), key)
        }
    }

    func testMermaidExport() {
        for name in ["approval", "sideways", "tangled", "fan"] {
            let fc = source(name)
            XCTAssertEqual(FlowchartExport.direction(fc).rawValue, ref["mermaid"]![name]!["direction"]!.stringValue!)
            XCTAssertEqual(FlowchartExport.mermaid(fc), ref["mermaid"]![name]!["text"]!.stringValue!, name)
        }
        let escapes = FlowchartData(
            nodes: [
                FlowNode(id: "a", shape: .process, x: 0, y: 0, w: 100, h: 40, text: "Say \"hi\" & <wave> | bye\nnext"),
                FlowNode(id: "b", shape: .note, x: 0, y: 100, w: 100, h: 40),
                FlowNode(id: "c", shape: .io, x: 0, y: 200, w: 100, h: 40, text: "c", color: .blue),
            ],
            edges: [
                FlowEdge(id: "x", from: "a", to: "b", label: "a|b", style: .dashed, arrow: .both),
                FlowEdge(id: "y", from: "b", to: "c", arrow: .noArrow),
                FlowEdge(id: "z", from: "b", to: "c", style: .dashed, arrow: .noArrow),
                FlowEdge(id: "w", from: "a", to: "c", arrow: .both),
                FlowEdge(id: "q", from: "a", to: "gone"),
            ])
        XCTAssertEqual(FlowchartExport.mermaid(escapes), ref["mermaid"]!["escapes"]!["text"]!.stringValue!)
    }

    func testSvgExport() {
        let s = ref["svgs"]!
        XCTAssertEqual(FlowchartExport.svg(ref["flowchartData"]!["approval"]!.stringValue!), s["approval"]!.stringValue!)
        XCTAssertEqual(FlowchartExport.svg(ref["flowchartData"]!["approval"]!.stringValue!, title: "My <\"chart\"> & co", padding: 10), s["approvalTitled"]!.stringValue!)
        XCTAssertEqual(FlowchartExport.svg(ref["flowchartData"]!["fan"]!.stringValue!), s["fan"]!.stringValue!)
        XCTAssertEqual(FlowchartExport.svg("{\"nodes\":[{\"id\":\"a\",\"shape\":\"process\",\"x\":0,\"y\":0,\"w\":160,\"h\":64,\"text\":\"<b>bold</b> & \\\"q\\\"\",\"color\":\"neutral\"}],\"edges\":[]}"), s["escapes"]!.stringValue!)
        XCTAssertEqual(FlowchartExport.svg(""), s["empty"]!.stringValue!)
    }

    func testMarkdownAndHtmlExports() {
        let data = ref["flowchartData"]!["approval"]!.stringValue!
        let block = WireBlock(id: ULID.make(), type: FlowchartProps.type, parentId: nil, rank: "V", props: FlowchartProps(data: data, height: 440).json)
        let md = MarkdownCodec.blocksToMarkdown([block])
        XCTAssertTrue(md.contains("```mermaid\n\(ref["mermaid"]!["approval"]!["text"]!.stringValue!)\n```"), md)
        let empty = WireBlock(id: ULID.make(), type: FlowchartProps.type, parentId: nil, rank: "V", props: FlowchartProps().json)
        XCTAssertFalse(MarkdownCodec.blocksToMarkdown([empty]).contains("mermaid"))
        let html = HTMLExport.blocksToHTML([block], HTMLExport.Options(title: "Chart"))
        XCTAssertTrue(html.contains("<figure class=\"flowchart\">\(ref["svgs"]!["approval"]!.stringValue!)</figure>"))
        XCTAssertFalse(HTMLExport.blocksToHTML([empty], HTMLExport.Options(title: "Chart")).contains("<figure class=\"flowchart\">"))
    }

    // MARK: Canvas edits

    func testResizeSnapAndShapeChanges() {
        for c in ref["resize"]!.arrayValue! {
            let out = FlowOps.resizeNode(node(c["node"]!), handle: FlowResizeHandle(rawValue: c["handle"]!.stringValue!)!, dx: num(c["dx"]), dy: num(c["dy"]), keepRatio: c["keep"]!.boolValue!)
            XCTAssertEqual(out, node(c["out"]!), c["handle"]!.stringValue!)
        }
        let others = [FlowRect(x: 200, y: 0, w: 160, h: 64), FlowRect(x: 0, y: 300, w: 100, h: 40)]
        for c in ref["snap"]!.arrayValue! {
            let out = FlowOps.snapGroup(rect(c["moving"]!), others: others, threshold: 6)
            XCTAssertEqual(out.dx, num(c["out"]!["dx"]), accuracy: 1e-9)
            XCTAssertEqual(out.dy, num(c["out"]!["dy"]), accuracy: 1e-9)
            let guides = c["out"]!["guides"]!.arrayValue!.map { g in
                FlowGuide(axis: g["axis"]!.stringValue! == "x" ? .x : .y, at: num(g["at"]), from: num(g["from"]), to: num(g["to"]))
            }
            XCTAssertEqual(out.guides, guides)
        }
        let base = FlowchartData(nodes: [FlowNode(id: "a", shape: .process, x: 3, y: 5, w: 200, h: 64, text: "A label that wraps over a couple of lines here", color: .blue)])
        for c in ref["setShape"]!.arrayValue! {
            let shape = FlowShape(rawValue: c["shape"]!.stringValue!)!
            XCTAssertEqual(FlowOps.setShape(base, ["a"], shape).nodes[0], node(c["out"]!), shape.rawValue)
        }
    }

    func testChartFromDraft() {
        let draft = ref["draft"]!
        XCTAssertEqual(FlowOps.chartFromDraft(draft, current: .empty, update: false), chart(ref["drafts"]!["create"]!))
        var lr = draft
        lr["direction"] = "LR"
        XCTAssertEqual(FlowOps.chartFromDraft(lr, current: chart(ref["current"]!), update: true), chart(ref["drafts"]!["update"]!))
    }

    func testEditsKeepTheChartValid() {
        var fc = FlowchartData()
        let a = FlowOps.addNode(fc, shape: .process, at: FlowPoint(x: 0, y: 0))!
        fc = a.doc
        XCTAssertEqual(fc.nodes[0].x, -80)
        XCTAssertEqual(fc.nodes[0].y, -32)
        let b = FlowOps.addNode(fc, shape: .process, at: FlowPoint(x: 0, y: 0))!
        fc = b.doc
        XCTAssertEqual(fc.nodes[1].x, -56, "nudged off the taken spot")
        let link = FlowOps.connect(fc, from: a.id, to: b.id, fromSide: .bottom)!
        fc = link.doc
        XCTAssertEqual(FlowOps.connect(fc, from: a.id, to: b.id)!.id, link.id, "no duplicate connector")
        XCTAssertNil(FlowOps.connect(fc, from: a.id, to: a.id))
        let dup = FlowOps.duplicate(fc, [a.id, b.id])
        XCTAssertEqual(dup.doc.nodes.count, 4)
        XCTAssertEqual(dup.doc.edges.count, 2)
        XCTAssertEqual(dup.doc.nodes[2].x, fc.nodes[0].x + 24)
        XCTAssertNil(Flowchart.dataIssue(Flowchart.serialize(dup.doc)))
        let moved = FlowOps.moveNodes(dup.doc, origin: [a.id: FlowPoint(x: 0, y: 0)], dx: 500_000, dy: -3.5)
        XCTAssertEqual(moved.nodes[0].x, 100_000)
        XCTAssertEqual(moved.nodes[0].y, -3)
        let gone = FlowOps.deleteSelection(dup.doc, FlowSelection(nodes: [a.id], edges: []))
        XCTAssertEqual(gone.nodes.count, 3)
        XCTAssertEqual(gone.edges.count, 1)
        XCTAssertEqual(FlowOps.nodeAt(fc, FlowPoint(x: 0, y: 0))?.id, b.id, "top-most wins")

        var history = FlowHistory()
        history.push(fc, key: "nudge", now: 10)
        history.push(moved, key: "nudge", now: 10.5)
        XCTAssertEqual(history.undo(gone), fc)
        XCTAssertFalse(history.canUndo)
        XCTAssertEqual(history.redo(fc), gone)
    }
}
