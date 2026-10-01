import Foundation

/// Mermaid flowcharts (`flowchart` / `graph`), read and laid out natively so a Mermaid code block shows
/// its diagram on the Mac. A port of the subset the web reads (editor-schema flowchartMermaid.ts:
/// shapes, labels, `&` groups, solid / dotted / thick links with labels) and its layered layout
/// (flowchartLayout.ts). Other diagram types (sequence, class…) aren't drawn.
public enum MermaidFlow {
    public enum Shape: String, Sendable { case process, decision, terminator, io, circle, note, subroutine, database }
    public enum Arrow: Sendable, Equatable { case none, end, both }

    public struct Node: Sendable, Equatable {
        public var id: String
        public var text: String
        public var shape: Shape
        public var x: Double = 0
        public var y: Double = 0
        public var w: Double = 160
        public var h: Double = 64
    }

    public struct Edge: Sendable, Equatable {
        public var from: String
        public var to: String
        public var label: String
        public var dashed: Bool
        public var thick: Bool
        public var arrow: Arrow
    }

    public struct Diagram: Sendable, Equatable {
        public var nodes: [Node]
        public var edges: [Edge]
        public var leftToRight: Bool
        public var width: Double { (nodes.map { $0.x + $0.w }.max() ?? 0) }
        public var height: Double { (nodes.map { $0.y + $0.h }.max() ?? 0) }
    }

    public enum ParseError: Error, Equatable {
        case notFlowchart
        case empty
        case unreadable
    }

    /// Base sizes per shape (FLOWCHART_SHAPE_SIZE).
    public static func baseSize(_ shape: Shape) -> (w: Double, h: Double) {
        switch shape {
        case .process, .subroutine, .database: return (160, 64)
        case .decision: return (176, 96)
        case .terminator: return (160, 56)
        case .io: return (176, 64)
        case .circle: return (104, 104)
        case .note: return (176, 112)
        }
    }

    static let maxNodes = 300
    static let maxEdges = 600

    // MARK: Parsing

    /// Longest openers first.
    static let shapes: [(String, String, Shape)] = [
        ("(((", ")))", .circle), ("((", "))", .circle), ("([", "])", .terminator), ("[[", "]]", .subroutine), ("[(", ")]", .database),
        ("{{", "}}", .decision), ("[/", "/]", .io), ("[/", "\\]", .io), ("[\\", "\\]", .io), ("[\\", "/]", .io),
        ("[", "]", .process), ("(", ")", .process), ("{", "}", .decision), (">", "]", .note),
    ]

    static func decodeLabel(_ raw: String) -> String {
        var s = raw.trimmingCharacters(in: .whitespaces)
        if s.count >= 2, s.hasPrefix("\""), s.hasSuffix("\"") { s = String(s.dropFirst().dropLast()) }
        if s.count >= 2, s.hasPrefix("`"), s.hasSuffix("`") { s = String(s.dropFirst().dropLast()) }
        s = s.replacingOccurrences(of: "<br\\s*/?>", with: "\n", options: [.regularExpression, .caseInsensitive])
            .replacingOccurrences(of: "#quot;", with: "\"").replacingOccurrences(of: "#amp;", with: "&")
            .replacingOccurrences(of: "#lt;", with: "<").replacingOccurrences(of: "#gt;", with: ">")
        // #123; character codes
        while let r = s.range(of: "#(\\d+);", options: .regularExpression) {
            let digits = s[r].dropFirst().dropLast()
            let scalar = UInt32(digits).flatMap { Unicode.Scalar(min($0, 0x10FFFF)) }
            s.replaceSubrange(r, with: scalar.map { String(Character($0)) } ?? "")
        }
        s = s.replacingOccurrences(of: "<[^>]*>", with: "", options: .regularExpression)
            .replacingOccurrences(of: "\\s*\\n\\s*", with: "\n", options: .regularExpression)
        return s.trimmingCharacters(in: .whitespaces)
    }

    struct Ref { var id: String; var text: String?; var shape: Shape? }

    /// An id: letters, digits, "_" and "." or "-" (not starting a link).
    static func readId(_ s: Substring) -> Substring? {
        var end = s.startIndex
        var first = true
        while end < s.endIndex {
            let c = s[end]
            if c.isLetter || c.isNumber || c == "_" { end = s.index(after: end); first = false; continue }
            if !first && c == "." { end = s.index(after: end); continue }
            if !first && c == "-" {
                let next = s.index(after: end)
                if next < s.endIndex, "-.>".contains(s[next]) { break }
                if next == s.endIndex { break }
                end = next
                continue
            }
            break
        }
        return end == s.startIndex ? nil : s[s.startIndex..<end]
    }

    static func stripClass(_ s: Substring) -> Substring {
        guard s.hasPrefix(":::") else { return s }
        var i = s.index(s.startIndex, offsetBy: 3)
        while i < s.endIndex, s[i].isLetter || s[i].isNumber || s[i] == "_" || s[i] == "-" { i = s.index(after: i) }
        return s[i...]
    }

    static func readNode(_ s: Substring) -> (Ref, Substring)? {
        guard let id = readId(s) else { return nil }
        var rest = s[id.endIndex...]
        for (open, close, shape) in shapes where rest.hasPrefix(open) {
            let body = rest.dropFirst(open.count)
            var endIdx: Substring.Index?
            if body.hasPrefix("\""), let q = body.dropFirst().firstIndex(of: "\""), body[body.index(after: q)...].hasPrefix(close) {
                endIdx = body.index(after: q)
            }
            if endIdx == nil, let r = body.range(of: close) { endIdx = r.lowerBound }
            guard let e = endIdx else { continue }
            let text = decodeLabel(String(body[body.startIndex..<e]))
            rest = stripClass(body[e...].dropFirst(close.count))
            return (Ref(id: String(id), text: text, shape: shape), rest)
        }
        return (Ref(id: String(id)), stripClass(rest))
    }

    static func readGroup(_ s: Substring) -> ([Ref], Substring)? {
        var refs: [Ref] = []
        var rest = s
        while true {
            guard let (ref, r) = readNode(rest.drop { $0 == " " || $0 == "\t" }) else { return refs.isEmpty ? nil : (refs, rest) }
            refs.append(ref)
            rest = r
            let trimmed = rest.drop { $0 == " " || $0 == "\t" }
            guard trimmed.hasPrefix("&") else { return (refs, rest) }
            rest = trimmed.dropFirst()
        }
    }

    /// A link (`-->`, `---`, `-.->`, `==>`, `<-->`, `--x`, `--o`, `-- text -->`, `-->|text|`).
    static func readLink(_ s: Substring) -> (Edge, Substring)? {
        let t = s.drop { $0 == " " || $0 == "\t" }
        let str = String(t)
        // Inline label forms: -- text -->  -. text .->  == text ==>
        if let m = str.range(of: "^(<)?(--|==|-\\.)(?![->=.])\\s*([^-=.>|][^>]*?)\\s*(-{2,}>|={2,}>|\\.+->|-{3,}|={3,}|\\.+-)", options: .regularExpression) {
            let whole = String(str[m])
            let ns = whole as NSString
            let re = try? NSRegularExpression(pattern: "^(<)?(--|==|-\\.)\\s*(.*?)\\s*(-{2,}>|={2,}>|\\.+->|-{3,}|={3,}|\\.+-)$")
            if let match = re?.firstMatch(in: whole, range: NSRange(location: 0, length: ns.length)) {
                let start = match.range(at: 1).location != NSNotFound
                let op = ns.substring(with: match.range(at: 2))
                let label = ns.substring(with: match.range(at: 3))
                let head = ns.substring(with: match.range(at: 4))
                let dashed = op == "-." || head.contains(".")
                let arrow: Arrow = head.hasSuffix(">") ? (start ? .both : .end) : .none
                let edge = Edge(from: "", to: "", label: decodeLabel(label), dashed: dashed, thick: op == "==", arrow: arrow)
                return (edge, t.dropFirst(whole.count))
            }
        }
        guard let m = str.range(of: "^(<|x|o)?(-{2,}|={2,}|-?\\.+-)(>|x|o)?", options: .regularExpression) else { return nil }
        let token = String(str[m])
        var rest = t.dropFirst(token.count)
        let start = token.hasPrefix("<")
        let end = token.hasSuffix(">")
        var label = ""
        let afterSpace = rest.drop { $0 == " " || $0 == "\t" }
        if afterSpace.hasPrefix("|"), let close = afterSpace.dropFirst().firstIndex(of: "|") {
            label = decodeLabel(String(afterSpace[afterSpace.index(after: afterSpace.startIndex)..<close]))
            rest = afterSpace[afterSpace.index(after: close)...]
        }
        let core = token.trimmingCharacters(in: CharacterSet(charactersIn: "<>xo"))
        let edge = Edge(from: "", to: "", label: label, dashed: core.contains("."), thick: core.hasPrefix("="),
                        arrow: start && end ? .both : (start || end) ? .end : .none)
        return (edge, rest)
    }

    /// Reads a flowchart (no positions yet; see `layout`).
    public static func parse(_ source: String) -> Result<Diagram, ParseError> {
        var cleaned = source.replacingOccurrences(of: "%%\\{[\\s\\S]*?\\}%%", with: "", options: .regularExpression)
        cleaned = cleaned.replacingOccurrences(of: "\r\n", with: "\n")
        var statements: [String] = []
        for line in cleaned.split(separator: "\n", omittingEmptySubsequences: false) {
            var l = String(line)
            if let r = l.range(of: "%%") { l = String(l[..<r.lowerBound]) }
            // Split on ";" outside quotes.
            var part = ""
            var inQuote = false
            for c in l {
                if c == "\"" { inQuote.toggle() }
                if c == ";" && !inQuote {
                    statements.append(part.trimmingCharacters(in: .whitespaces))
                    part = ""
                } else { part.append(c) }
            }
            statements.append(part.trimmingCharacters(in: .whitespaces))
        }
        statements = statements.filter { !$0.isEmpty }
        guard let header = statements.first,
              header.range(of: "^(flowchart|graph)(\\s+(TD|TB|BT|LR|RL))?\\s*$", options: [.regularExpression, .caseInsensitive]) != nil
        else { return .failure(.notFlowchart) }
        statements.removeFirst()
        let lr = header.range(of: "\\s(LR|RL)\\s*$", options: [.regularExpression, .caseInsensitive]) != nil

        var order: [String] = []
        var nodes: [String: (text: String?, shape: Shape?)] = [:]
        var edges: [Edge] = []
        var skipped = 0
        func remember(_ r: Ref) -> Bool {
            if let cur = nodes[r.id] {
                if r.shape != nil && cur.shape == nil { nodes[r.id] = (r.text, r.shape) }
                return true
            }
            guard nodes.count < maxNodes else { return false }
            nodes[r.id] = (r.text, r.shape)
            order.append(r.id)
            return true
        }
        for st in statements {
            if st.range(of: "^(subgraph\\b|end$|direction\\b)", options: [.regularExpression, .caseInsensitive]) != nil { continue }
            if st.range(of: "^(classDef|class|style|linkStyle|click|accTitle|accDescr)\\b", options: .regularExpression) != nil { continue }
            guard var g = readGroup(Substring(st)) else { skipped += 1; continue }
            g.0.forEach { _ = remember($0) }
            var rest = g.1
            while !rest.trimmingCharacters(in: .whitespaces).isEmpty {
                guard let (link, after) = readLink(rest) else { skipped += 1; break }
                guard let next = readGroup(after) else { skipped += 1; break }
                next.0.forEach { _ = remember($0) }
                for a in g.0 {
                    for b in next.0 where a.id != b.id && edges.count < maxEdges && nodes[a.id] != nil && nodes[b.id] != nil {
                        var e = link
                        e.from = a.id
                        e.to = b.id
                        edges.append(e)
                    }
                }
                g = next
                rest = next.1
            }
        }
        guard !order.isEmpty else { return .failure(skipped > 0 ? .unreadable : .empty) }
        let out = order.map { id -> Node in
            let n = nodes[id]!
            let shape = n.shape ?? .process
            let size = baseSize(shape)
            return Node(id: id, text: n.text ?? id, shape: shape, w: size.w, h: size.h)
        }
        return .success(Diagram(nodes: out, edges: edges, leftToRight: lr))
    }

    // MARK: Layout (flowchartLayout.ts)

    /// Positions every node: layered, top-down or left-to-right, components side by side.
    public static func layout(_ d: Diagram, nodeGap: Double? = nil, layerGap: Double? = nil) -> Diagram {
        guard !d.nodes.isEmpty else { return d }
        let lr = d.leftToRight
        let nGap = nodeGap ?? (lr ? 40 : 56)
        let lGap = layerGap ?? (lr ? 72 : 64)
        let ids = d.nodes.map(\.id)
        var size: [String: (cross: Double, main: Double)] = [:]
        for n in d.nodes { size[n.id] = lr ? (n.h, n.w) : (n.w, n.h) }
        let known = Set(ids)
        let edges = d.edges.filter { known.contains($0.from) && known.contains($0.to) }.map { ($0.from, $0.to) }
        var adj: [String: Set<String>] = Dictionary(uniqueKeysWithValues: ids.map { ($0, []) })
        for (a, b) in edges { adj[a]?.insert(b); adj[b]?.insert(a) }
        // Components, the connected ones first.
        var comps = components(ids, adj)
        comps = comps.enumerated().sorted { x, y in
            let a = x.element.count > 1 ? 1 : 0, b = y.element.count > 1 ? 1 : 0
            return a != b ? a > b : x.offset < y.offset
        }.map(\.element)
        var placed: [String: (c: Double, m: Double)] = [:]
        var offset = 0.0
        for comp in comps {
            let (result, width) = layoutComponent(comp, size, edges, nGap, lGap)
            for (id, p) in result { placed[id] = (p.c + offset, p.m) }
            offset += width + nGap * 1.75
        }
        var out = d
        out.nodes = d.nodes.map { n in
            var m = n
            let p = placed[n.id] ?? (0, 0)
            m.x = (lr ? p.m : p.c).rounded()
            m.y = (lr ? p.c : p.m).rounded()
            return m
        }
        return out
    }

    static func components(_ ids: [String], _ adj: [String: Set<String>]) -> [[String]] {
        var seen = Set<String>()
        var out: [[String]] = []
        let order = Dictionary(uniqueKeysWithValues: ids.enumerated().map { ($1, $0) })
        for id in ids where !seen.contains(id) {
            var comp: [String] = []
            var stack = [id]
            seen.insert(id)
            while let v = stack.popLast() {
                comp.append(v)
                for w in adj[v] ?? [] where !seen.contains(w) {
                    seen.insert(w)
                    stack.append(w)
                }
            }
            out.append(comp.sorted { order[$0]! < order[$1]! })
        }
        return out
    }

    static func layoutComponent(_ ids: [String], _ size: [String: (cross: Double, main: Double)], _ allEdges: [(String, String)],
                                _ nodeGap: Double, _ layerGap: Double) -> ([String: (c: Double, m: Double)], Double) {
        let idSet = Set(ids)
        let own = allEdges.filter { idSet.contains($0.0) && idSet.contains($0.1) && $0.0 != $0.1 }
        var outs: [String: [String]] = Dictionary(uniqueKeysWithValues: ids.map { ($0, []) })
        var indeg: [String: Int] = Dictionary(uniqueKeysWithValues: ids.map { ($0, 0) })
        for (a, b) in own { outs[a]!.append(b); indeg[b]! += 1 }
        // Break cycles: DFS, reversing edges that point back up the stack.
        var state: [String: Int] = [:]
        var dag: [(String, String)] = []
        var visitOrder: [String] = []
        for s in ids.filter({ indeg[$0] == 0 }) + ids where state[s] == nil {
            var stack: [(v: String, i: Int)] = [(s, 0)]
            state[s] = 1
            visitOrder.append(s)
            while !stack.isEmpty {
                let top = stack[stack.count - 1]
                let list = outs[top.v]!
                guard top.i < list.count else {
                    state[top.v] = 2
                    stack.removeLast()
                    continue
                }
                stack[stack.count - 1].i += 1
                let next = list[top.i]
                let st = state[next]
                if st == 1 { dag.append((next, top.v)) } else {
                    dag.append((top.v, next))
                    if st == nil {
                        state[next] = 1
                        visitOrder.append(next)
                        stack.append((next, 0))
                    }
                }
            }
        }
        // Longest-path layering.
        var preds: [String: [String]] = Dictionary(uniqueKeysWithValues: ids.map { ($0, []) })
        var succs = preds
        var deg: [String: Int] = Dictionary(uniqueKeysWithValues: ids.map { ($0, 0) })
        for (a, b) in dag { succs[a]!.append(b); preds[b]!.append(a); deg[b]! += 1 }
        var layerOf: [String: Int] = [:]
        var queue = visitOrder.filter { deg[$0] == 0 }
        for id in queue { layerOf[id] = 0 }
        var qi = 0
        while qi < queue.count {
            let v = queue[qi]; qi += 1
            for w in succs[v]! {
                layerOf[w] = max(layerOf[w] ?? 0, layerOf[v]! + 1)
                deg[w]! -= 1
                if deg[w] == 0 { queue.append(w) }
            }
        }
        for id in ids where layerOf[id] == nil { layerOf[id] = 0 }
        let layerCount = (ids.map { layerOf[$0]! }.max() ?? 0) + 1
        var layers: [[String]] = Array(repeating: [], count: layerCount)
        for id in visitOrder { layers[layerOf[id]!].append(id) }
        // Crossing reduction (barycenter sweeps).
        var pos: [String: Double] = [:]
        for l in layers { for (i, id) in l.enumerated() { pos[id] = Double(i) } }
        for iter in 0..<8 where layers.count > 1 {
            let down = iter % 2 == 0
            let range: [Int] = down ? Array(1..<layers.count) : Array((0..<(layers.count - 1)).reversed())
            for li in range {
                let ref = down ? preds : succs
                var bary: [String: Double] = [:]
                for id in layers[li] {
                    let ns = ref[id]!.filter { layerOf[$0] == li + (down ? -1 : 1) }
                    bary[id] = ns.isEmpty ? pos[id]! : ns.reduce(0) { $0 + pos[$1]! } / Double(ns.count)
                }
                layers[li].sort { a, b in bary[a]! != bary[b]! ? bary[a]! < bary[b]! : pos[a]! < pos[b]! }
                for (i, id) in layers[li].enumerated() { pos[id] = Double(i) }
            }
        }
        // Across the flow: pack, then pull toward neighbours' centres.
        var cross: [String: Double] = [:]
        for layer in layers {
            var c = 0.0
            for id in layer { cross[id] = c; c += size[id]!.cross + nodeGap }
        }
        func center(_ id: String) -> Double { cross[id]! + size[id]!.cross / 2 }
        func place(_ layer: [String], _ desired: [String: Double]) {
            var fwd = Array(repeating: 0.0, count: layer.count)
            var edge = -Double.infinity
            for (i, id) in layer.enumerated() {
                let w = size[id]!.cross
                fwd[i] = max(desired[id]! - w / 2, edge)
                edge = fwd[i] + w + nodeGap
            }
            var bwd = Array(repeating: 0.0, count: layer.count)
            edge = Double.infinity
            for i in stride(from: layer.count - 1, through: 0, by: -1) {
                let w = size[layer[i]]!.cross
                bwd[i] = min(desired[layer[i]]! - w / 2, edge - w)
                edge = bwd[i] - nodeGap
            }
            edge = -Double.infinity
            for (i, id) in layer.enumerated() {
                let w = size[id]!.cross
                let x = max((fwd[i] + bwd[i]) / 2, edge)
                cross[id] = x
                edge = x + w + nodeGap
            }
        }
        for iter in 0..<6 {
            let order = iter % 2 == 0 ? layers : layers.reversed()
            for layer in order {
                var desired: [String: Double] = [:]
                for id in layer {
                    let ns = preds[id]! + succs[id]!
                    desired[id] = ns.isEmpty ? center(id) : ns.reduce(0) { $0 + center($1) } / Double(ns.count)
                }
                place(layer, desired)
            }
        }
        // Along the flow: each layer as tall as its tallest node.
        var main: [String: Double] = [:]
        var m = 0.0
        for layer in layers where !layer.isEmpty {
            let band = layer.map { size[$0]!.main }.max() ?? 0
            for id in layer { main[id] = m + (band - size[id]!.main) / 2 }
            m += band + layerGap
        }
        let minCross = ids.map { cross[$0]! }.min() ?? 0
        let width = (ids.map { cross[$0]! + size[$0]!.cross }.max() ?? 0) - minCross
        var result: [String: (c: Double, m: Double)] = [:]
        for id in ids { result[id] = (cross[id]! - minCross, main[id] ?? 0) }
        return (result, width)
    }
}
