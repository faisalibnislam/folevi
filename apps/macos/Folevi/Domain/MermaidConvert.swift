import Foundation

/// "Convert to flowchart" on a Mermaid block (the web's `mermaidToFlowchart`): the diagram's shapes and
/// links become an editable flowchart, each shape sized to its text (at most 240 wide) and laid out in
/// layers in the diagram's direction.
enum MermaidConvert {
    struct Result: Equatable {
        var data: FlowchartData
        var direction: FlowDirection
        /// The flowchart block's height: the drawing plus room, within the block limits.
        var height: Double
    }

    /// Whether the source is a Mermaid flowchart (`flowchart` or `graph`, after any comments).
    static func isFlowchartSource(_ source: String) -> Bool {
        source.range(of: #"^\s*(?:%%[^\n]*\n\s*)*(flowchart|graph)\b"#, options: [.regularExpression, .caseInsensitive]) != nil
    }

    /// The flowchart, or the web's message for why it can't be converted.
    static func convert(_ source: String) -> Swift.Result<Result, ConvertError> {
        let diagram: MermaidFlow.Diagram
        switch MermaidFlow.parse(source) {
        case .success(let d): diagram = d
        case .failure(let e):
            switch e {
            case .notFlowchart: return .failure(.message("Only Mermaid flowcharts (starting with “flowchart” or “graph”) can be converted."))
            case .empty: return .failure(.message("The diagram is empty."))
            case .unreadable: return .failure(.message("Couldn’t read any shapes from this diagram."))
            }
        }
        var idMap: [String: String] = [:]
        let nodes: [FlowNode] = diagram.nodes.prefix(Flowchart.maxNodes).map { n in
            let shape: FlowShape
            switch n.shape {
            case .decision: shape = .decision
            case .terminator: shape = .terminator
            case .io: shape = .io
            case .circle: shape = .circle
            case .note: shape = .note
            case .process, .subroutine, .database: shape = .process
            }
            let id = Flowchart.newId("n")
            idMap[n.id] = id
            let size = Flowchart.shapeSize(shape)
            let node = FlowNode(id: id, shape: shape, x: 0, y: 0, w: size.w, h: size.h, text: String(n.text.prefix(Flowchart.maxText)), color: .neutral)
            return Flowchart.fitToText(node, maxWidth: 240)
        }
        let edges: [FlowEdge] = diagram.edges.prefix(Flowchart.maxEdges).compactMap { e in
            guard let from = idMap[e.from], let to = idMap[e.to] else { return nil }
            let arrow: FlowArrow = e.arrow == .none ? .noArrow : e.arrow == .both ? .both : .end
            return FlowEdge(id: Flowchart.newId("e"), from: from, to: to, fromSide: nil, toSide: nil,
                            label: String(e.label.replacingOccurrences(of: #"\n+"#, with: " ", options: .regularExpression).prefix(Flowchart.maxLabel)),
                            style: e.dashed ? .dashed : .solid, arrow: arrow)
        }
        let direction: FlowDirection = diagram.leftToRight ? .leftRight : .topDown
        let data = FlowchartLayout.layout(FlowchartData(nodes: nodes, edges: edges), direction: direction, origin: FlowPoint(x: 0, y: 0))
        let bounds = FlowGeometry.bounds(data)
        let height = (max(Double(FoleviLimits.minFlowchartHeight), min(720, (bounds?.h ?? 300) + 140))).rounded()
        return .success(Result(data: data, direction: direction, height: height))
    }

    enum ConvertError: Error, Equatable {
        case message(String)
        var text: String { if case .message(let m) = self { return m } else { return "" } }
    }
}
