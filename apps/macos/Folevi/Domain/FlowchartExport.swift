import Foundation

// Ports of packages/editor-schema/src/flowchartMermaid.ts (export) and flowchartSvg.ts. Markdown exports
// write a Mermaid `flowchart TD|LR` diagram so a chart stays portable; HTML exports embed a standalone SVG
// with light-theme colours and the same geometry the canvas draws with. All text is escaped.

enum FlowchartExport {
    // MARK: Mermaid

    private static func brackets(_ shape: FlowShape) -> (String, String) {
        switch shape {
        case .process, .text: return ("[", "]")
        case .decision: return ("{", "}")
        case .terminator: return ("([", "])")
        case .io: return ("[/", "/]")
        case .circle: return ("((", "))")
        case .note: return (">", "]")
        }
    }

    /// Light-theme fills for exported colours (Mermaid classDefs).
    private static func mermaidFill(_ c: FlowColor) -> (String, String)? {
        switch c {
        case .neutral: return nil
        case .accent: return ("#f1f1f3", "#8e8e96")
        case .blue: return ("#e8f0fe", "#8fb0ea")
        case .green: return ("#e5f5ea", "#86c79c")
        case .yellow: return ("#fdf3d0", "#e3c35e")
        case .pink: return ("#fce8ee", "#eba3b8")
        case .purple: return ("#efe9fb", "#b6a1e6")
        }
    }

    /// Text safe inside a quoted Mermaid label.
    private static func mermaidText(_ s: String) -> String {
        var out = ""
        for c in s.unicodeScalars {
            switch c {
            case "&": out += "#amp;"
            case "\"": out += "#quot;"
            case "<": out += "#lt;"
            case ">": out += "#gt;"
            case "|": out += "#124;"
            case "\n": out += "<br/>"
            default: out.unicodeScalars.append(c)
            }
        }
        return out
    }

    /// Which way a chart mostly flows (for the exported direction and "Tidy up").
    static func direction(_ fc: FlowchartData) -> FlowDirection {
        var byId: [String: FlowNode] = [:]
        for n in fc.nodes { byId[n.id] = n }
        var horizontal = 0, vertical = 0
        for e in fc.edges {
            guard let a = byId[e.from], let b = byId[e.to] else { continue }
            let dx = abs(b.x + b.w / 2 - (a.x + a.w / 2))
            let dy = abs(b.y + b.h / 2 - (a.y + a.h / 2))
            if dx > dy { horizontal += 1 } else { vertical += 1 }
        }
        return horizontal > vertical ? .leftRight : .topDown
    }

    /// A Mermaid `flowchart` diagram for the chart (node order kept; ids renamed to n1, n2…).
    static func mermaid(_ fc: FlowchartData) -> String {
        var lines = ["flowchart \(direction(fc).rawValue)"]
        var ids: [String: String] = [:]
        for (i, n) in fc.nodes.enumerated() { ids[n.id] = "n\(i + 1)" }
        for n in fc.nodes {
            let (open, close) = brackets(n.shape)
            lines.append("  \(ids[n.id]!)\(open)\"\(mermaidText(n.text.isEmpty ? " " : n.text))\"\(close)")
        }
        for e in fc.edges {
            guard let a = ids[e.from], let b = ids[e.to] else { continue }
            let dashed = e.style == .dashed
            let op: String
            switch e.arrow {
            case .noArrow: op = dashed ? "-.-" : "---"
            case .both: op = dashed ? "<-.->" : "<-->"
            case .end: op = dashed ? "-.->" : "-->"
            }
            lines.append("  \(a) \(op)\(e.label.isEmpty ? "" : "|\"\(mermaidText(e.label))\"|") \(b)")
        }
        var used: [FlowColor] = []
        for n in fc.nodes where !used.contains(n.color) && mermaidFill(n.color) != nil { used.append(n.color) }
        for c in used {
            let (fill, stroke) = mermaidFill(c)!
            lines.append("  classDef \(c.rawValue) fill:\(fill),stroke:\(stroke)")
            lines.append("  class \(fc.nodes.filter { $0.color == c }.map { ids[$0.id]! }.joined(separator: ",")) \(c.rawValue)")
        }
        return lines.joined(separator: "\n")
    }

    // MARK: SVG

    static let fontStack = "'Instrument Sans', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"

    /// Exported colours: (fill, stroke, text).
    static func exportColors(_ c: FlowColor) -> (String, String, String) {
        switch c {
        case .neutral: return ("#ffffff", "#cfcfd5", "#18181b")
        case .accent: return ("#f1f1f3", "#8e8e96", "#18181b")
        case .blue: return ("#e8f0fe", "#8fb0ea", "#1e3a6e")
        case .green: return ("#e5f5ea", "#86c79c", "#1d4d2e")
        case .yellow: return ("#fdf3d0", "#e3c35e", "#5a4608")
        case .pink: return ("#fce8ee", "#eba3b8", "#6e2338")
        case .purple: return ("#efe9fb", "#b6a1e6", "#3f2a6e")
        }
    }

    private static let edgeColor = "#8a8a93"
    private static let labelColor = "#56565e"

    private static func esc(_ s: String) -> String {
        var out = ""
        for c in s.unicodeScalars {
            switch c {
            case "&": out += "&amp;"
            case "<": out += "&lt;"
            case ">": out += "&gt;"
            case "\"": out += "&quot;"
            default: out.unicodeScalars.append(c)
            }
        }
        return out
    }

    /// The label's lines, centred on the node (sticky notes read from the top). `y` is the first baseline.
    static func nodeTextLayout(_ n: FlowNode) -> (x: Double, y: Double, lines: [String]) {
        let lines = Flowchart.lines(n)
        let block = Double(lines.count) * Flowchart.lineHeight
        let cy = n.shape == .note ? n.y + min(n.h / 2, 14 + block / 2) : n.y + n.h / 2
        // First baseline: centre the block, then drop by ~0.72em (cap height) within the first line.
        let y = cy - block / 2 + Flowchart.lineHeight / 2 + Flowchart.fontSize * 0.36
        return (n.x + n.w / 2, y, lines)
    }

    static func svg(_ data: String, title: String? = nil, padding: Double? = nil) -> String {
        let fc = Flowchart.parse(data)
        let cleanTitle = String(String.UnicodeScalarView((title ?? "Flowchart").unicodeScalars.filter { !"<>&\"".unicodeScalars.contains($0) }))
        let t = esc(cleanTitle)
        let routed = FlowGeometry.routeEdges(fc)
        guard let b = FlowGeometry.bounds(fc, routed: routed) else {
            return "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 320 80\" width=\"320\" height=\"80\" role=\"img\" aria-label=\"\(t) (empty)\"></svg>"
        }
        let js = Flowchart.js
        let pad = padding ?? 24
        let vx = (b.x - pad).rounded(.down)
        let vy = (b.y - pad).rounded(.down)
        let vw = (b.w + pad * 2).rounded(.up)
        let vh = (b.h + pad * 2).rounded(.up)
        var parts: [String] = []
        for r in routed {
            let dash = r.edge.style == .dashed ? " stroke-dasharray=\"6 5\"" : ""
            parts.append("<path d=\"\(r.d)\" fill=\"none\" stroke=\"\(edgeColor)\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"\(dash)/>")
            for h in r.heads { parts.append("<path d=\"\(h)\" fill=\"\(edgeColor)\" stroke=\"\(edgeColor)\" stroke-width=\"1\" stroke-linejoin=\"round\"/>") }
        }
        for n in fc.nodes {
            // A neutral sticky note is yellow, like paper ones.
            let (fill, stroke, ink) = exportColors(n.shape == .note && n.color == .neutral ? .yellow : n.color)
            if n.shape == .note {
                parts.append("<path d=\"\(FlowGeometry.shapePath(n))\" fill=\"\(fill)\" stroke=\"rgba(0,0,0,0.08)\" stroke-width=\"1\"/>")
            } else if n.shape != .text {
                parts.append("<path d=\"\(FlowGeometry.shapePath(n))\" fill=\"\(fill)\" stroke=\"\(stroke)\" stroke-width=\"1.5\"/>")
            }
            let l = nodeTextLayout(n)
            if !l.lines.isEmpty {
                let spans = l.lines.enumerated().map { i, line in
                    "<tspan x=\"\(js(l.x))\" y=\"\(js(Flowchart.jsRound((l.y + Double(i) * Flowchart.lineHeight) * 10) / 10))\">\(esc(line))</tspan>"
                }.joined()
                parts.append("<text text-anchor=\"middle\" font-size=\"\(js(Flowchart.fontSize))\" fill=\"\(ink)\">\(spans)</text>")
            }
        }
        for r in routed {
            guard let l = r.label else { continue }
            parts.append("<rect x=\"\(js(l.x))\" y=\"\(js(l.y))\" width=\"\(js(l.w))\" height=\"\(js(l.h))\" rx=\"6\" fill=\"#ffffff\"/>")
            parts.append("<text x=\"\(js(l.cx))\" y=\"\(js(l.cy + Flowchart.labelFontSize * 0.35))\" text-anchor=\"middle\" font-size=\"\(js(Flowchart.labelFontSize))\" fill=\"\(labelColor)\">\(esc(r.edge.label))</text>")
        }
        return "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"\(js(vx)) \(js(vy)) \(js(vw)) \(js(vh))\" width=\"\(js(vw))\" height=\"\(js(vh))\" role=\"img\" aria-label=\"\(t)\" font-family=\"\(fontStack)\"><rect x=\"\(js(vx))\" y=\"\(js(vy))\" width=\"100%\" height=\"100%\" fill=\"#ffffff\"/>\(parts.joined())</svg>"
    }
}
