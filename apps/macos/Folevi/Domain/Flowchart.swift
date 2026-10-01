import Foundation

// Port of packages/editor-schema/src/flowchart.ts: the flowchart block's data (shapes and connectors stored
// as a JSON string in `props.data`), the server's strict check, the forgiving reader every surface draws
// from, the compact writer, and the text metrics that size and wrap labels the same way everywhere.
//
//   { "v": 1,
//     "nodes": [{ "id": "a1", "shape": "process", "x": 0, "y": 0, "w": 160, "h": 64, "text": "Review", "color": "blue" }],
//     "edges": [{ "id": "e1", "from": "a1", "to": "b2", "fromSide": "bottom", "toSide": "top", "label": "Yes",
//                 "style": "dashed", "arrow": "end" }] }
//
// Coordinates are in an unbounded logical space; x/y is a node's top-left corner. Numbers are Doubles and
// rounding follows JavaScript (`Flowchart.jsRound`), so every surface computes the same picture as the web.

enum FlowShape: String, CaseIterable, Hashable, Sendable {
    case process, decision, terminator, io, circle, note, text
}

/// Neutral plus soft tints; `accent` follows the note's style palette in the editor.
enum FlowColor: String, CaseIterable, Hashable, Sendable {
    case neutral, accent, blue, green, yellow, pink, purple
}

enum FlowSide: String, CaseIterable, Hashable, Sendable {
    case top, right, bottom, left

    var opposite: FlowSide {
        switch self {
        case .top: return .bottom
        case .bottom: return .top
        case .left: return .right
        case .right: return .left
        }
    }
}

enum FlowEdgeStyle: String, CaseIterable, Hashable, Sendable {
    case solid, dashed
}

enum FlowArrow: String, CaseIterable, Hashable, Sendable {
    case end, both
    /// "none" on the wire.
    case noArrow = "none"
}

struct FlowNode: Hashable, Sendable {
    var id: String
    var shape: FlowShape
    var x: Double
    var y: Double
    var w: Double
    var h: Double
    var text: String = ""
    var color: FlowColor = .neutral

    var rect: FlowRect { FlowRect(x: x, y: y, w: w, h: h) }
}

struct FlowEdge: Hashable, Sendable {
    var id: String
    var from: String
    var to: String
    var fromSide: FlowSide?
    var toSide: FlowSide?
    var label: String = ""
    var style: FlowEdgeStyle = .solid
    var arrow: FlowArrow = .end
}

struct FlowchartData: Hashable, Sendable {
    var nodes: [FlowNode] = []
    var edges: [FlowEdge] = []

    static let empty = FlowchartData()
}

struct FlowPoint: Hashable, Sendable {
    var x: Double
    var y: Double
}

struct FlowRect: Hashable, Sendable {
    var x: Double
    var y: Double
    var w: Double
    var h: Double
}

/// The flowchart block's props (`flowchart`, written by "/flowchart" on the web and here). The Swift block
/// types leave it out (web-only), so it travels as `.unknown(type: "flowchart", props:)`.
struct FlowchartProps: Hashable, Sendable {
    var data: String
    var height: Double

    static let type = "flowchart"

    init(data: String = "", height: Double = Double(Flowchart.defaultHeight)) {
        self.data = data
        self.height = height
    }

    init?(_ props: JSONValue) {
        guard let o = props.objectValue else { return nil }
        data = o["data"]?.stringValue ?? ""
        height = Flowchart.clampHeight(o["height"])
    }

    var json: JSONValue {
        .object(["data": .string(data), "height": .number(height)])
    }
}

enum Flowchart {
    static let maxNodes = 500
    static let maxEdges = 1000
    static let maxText = 300
    static let maxLabel = 120
    static let maxCoord: Double = 100_000
    static let minSize: Double = 24
    static let maxWidth: Double = 960
    static let maxHeight: Double = 720
    static let maxIdLength = 32

    static let defaultHeight = 440
    /// Snapping step for positions and sizes (the dot grid is drawn every 3 steps).
    static let grid: Double = 8
    static let fontSize: Double = 14
    static let lineHeight: Double = 19
    static let labelFontSize: Double = 12.5

    static var maxDataLength: Int { FoleviLimits.maxFlowchartDataLength }
    static var minBlockHeight: Int { FoleviLimits.minFlowchartHeight }
    static var maxBlockHeight: Int { FoleviLimits.maxFlowchartHeight }

    /// Default size for a new node of each shape.
    static func shapeSize(_ shape: FlowShape) -> (w: Double, h: Double) {
        switch shape {
        case .process: return (160, 64)
        case .decision: return (176, 96)
        case .terminator: return (160, 56)
        case .io: return (176, 64)
        case .circle: return (104, 104)
        case .note: return (176, 112)
        case .text: return (160, 40)
        }
    }

    static func shapeLabel(_ shape: FlowShape) -> String {
        switch shape {
        case .process: return String(localized: "Process")
        case .decision: return String(localized: "Decision")
        case .terminator: return String(localized: "Start / end")
        case .io: return String(localized: "Input / output")
        case .circle: return String(localized: "Circle")
        case .note: return String(localized: "Sticky note")
        case .text: return String(localized: "Text")
        }
    }

    static func colorLabel(_ color: FlowColor) -> String {
        switch color {
        case .neutral: return String(localized: "Neutral")
        case .accent: return String(localized: "Accent")
        case .blue: return String(localized: "Blue")
        case .green: return String(localized: "Green")
        case .yellow: return String(localized: "Yellow")
        case .pink: return String(localized: "Pink")
        case .purple: return String(localized: "Purple")
        }
    }

    // MARK: JavaScript number semantics

    /// `Math.round`: halves round toward +infinity.
    static func jsRound(_ n: Double) -> Double {
        guard n.isFinite else { return n }
        let f = n.rounded(.down)
        return n - f >= 0.5 ? f + 1 : f
    }

    /// A number as JavaScript prints it in a template string.
    static func js(_ n: Double) -> String { JSONValue.formatNumber(n) }

    /// `Math.hypot` for two values, computed the way V8 does (scaled, compensated sum).
    static func hypot(_ a: Double, _ b: Double) -> Double {
        let x = abs(a), y = abs(b)
        if x.isInfinite || y.isInfinite { return .infinity }
        if x.isNaN || y.isNaN { return .nan }
        let m = max(x, y)
        if m == 0 { return 0 }
        var sum = 0.0, compensation = 0.0
        for v in [x, y] {
            let n = v / m
            let summand = n * n - compensation
            let preliminary = sum + summand
            compensation = (preliminary - sum) - summand
            sum = preliminary
        }
        return sum.squareRoot() * m
    }

    static func clamp(_ n: Double, _ lo: Double, _ hi: Double) -> Double { min(hi, max(lo, n)) }

    static func snap(_ n: Double, step: Double = grid) -> Double { jsRound(n / step) * step }
    static func snapUp(_ n: Double) -> Double { (n / grid).rounded(.up) * grid }

    /// The block height, clamped (web render.tsx `clampFlowHeight`).
    static func clampHeight(_ value: JSONValue?) -> Double {
        var n = Double.nan
        switch value {
        case .number(let d): n = d
        case .string(let s): n = Double(s.trimmingCharacters(in: .whitespaces)) ?? (s.trimmingCharacters(in: .whitespaces).isEmpty ? 0 : .nan)
        case .bool(let b): n = b ? 1 : 0
        case .null: n = 0
        default: break
        }
        let h = n.isFinite && n > 0 ? n : Double(defaultHeight)
        return jsRound(clamp(h, Double(minBlockHeight), Double(maxBlockHeight)))
    }

    // MARK: Strings (UTF-16 lengths, like JavaScript)

    static func length(_ s: String) -> Int { s.utf16.count }

    /// `s.slice(0, max)` in UTF-16 units (a split surrogate pair is dropped rather than kept half).
    static func prefix(_ s: String, _ max: Int) -> String {
        let units = s.utf16
        guard units.count > max else { return s }
        var cut = Array(units.prefix(max))
        if let last = cut.last, UTF16.isLeadSurrogate(last) { cut.removeLast() }
        return String(decoding: cut, as: UTF16.self)
    }

    /// Control characters (other than new lines) never reach the canvas or an export.
    static func cleanText(_ value: JSONValue?, max: Int) -> String {
        guard case .string(let s) = value else { return "" }
        return cleanText(s, max: max)
    }

    static func cleanText(_ s: String, max: Int) -> String {
        var out = String.UnicodeScalarView()
        var it = s.unicodeScalars.makeIterator()
        var pending = it.next()
        while let c = pending {
            pending = it.next()
            if c == "\r" {
                out.append("\n")
                if pending == "\n" { pending = it.next() }
                continue
            }
            if c.value <= 0x09 || (c.value >= 0x0B && c.value <= 0x1F) || c.value == 0x7F { continue }
            out.append(c)
        }
        return prefix(String(out), max)
    }

    /// Replaces runs of new lines with one space.
    static func collapseNewlines(_ s: String) -> String {
        var out = String.UnicodeScalarView()
        var inRun = false
        for c in s.unicodeScalars {
            if c == "\n" {
                if !inRun { out.append(" ") }
                inRun = true
            } else {
                out.append(c)
                inRun = false
            }
        }
        return String(out)
    }

    // MARK: Ids

    /// A short random id for new nodes and edges (not a block id; unique within one flowchart).
    static func newId(_ prefix: String = "n") -> String {
        let alphabet = Array("abcdefghijklmnopqrstuvwxyz0123456789")
        var s = prefix
        for _ in 0..<7 { s.append(alphabet[Int.random(in: 0..<36)]) }
        return s
    }

    static func isValidId(_ s: String) -> Bool {
        let units = s.utf8
        guard (1...maxIdLength).contains(units.count) else { return false }
        return units.allSatisfy { isIdByte($0) }
    }

    private static func isIdByte(_ b: UInt8) -> Bool {
        (b >= 48 && b <= 57) || (b >= 65 && b <= 90) || (b >= 97 && b <= 122) || b == 95 || b == 45
    }

    /// `String(v)` for an id-like JSON value (strings and numbers; anything else reads as no id).
    private static func idString(_ v: JSONValue?) -> String? {
        switch v {
        case .string(let s): return s
        case .number(let n): return js(n)
        default: return nil
        }
    }

    /// `String(raw.from ?? "")` in JavaScript.
    private static func refString(_ v: JSONValue?) -> String {
        switch v {
        case nil, .null: return ""
        case .string(let s): return s
        case .number(let n): return js(n)
        case .bool(let b): return b ? "true" : "false"
        case .array(let a): return a.map { $0.isNull ? "" : refString($0) }.joined(separator: ",")
        case .object: return "[object Object]"
        }
    }

    private static func cleanId(_ v: JSONValue?, used: inout Set<String>, prefix: String) -> String {
        var id = ""
        if let s = idString(v) {
            id = String(String.UnicodeScalarView(s.unicodeScalars.filter { $0.isASCII && isIdByte(UInt8($0.value)) }).prefix(32))
        }
        while id.isEmpty || used.contains(id) { id = newId(prefix) }
        used.insert(id)
        return id
    }

    private static func finite(_ v: JSONValue?) -> Double? {
        if case .number(let n) = v, n.isFinite { return n }
        return nil
    }

    // MARK: Validation (the server's check on every write)

    private static let nodeKeys: Set<String> = ["id", "shape", "x", "y", "w", "h", "text", "color"]
    private static let edgeKeys: Set<String> = ["id", "from", "to", "fromSide", "toSide", "label", "style", "arrow"]

    /// Why `data` isn't valid flowchart JSON, or nil when it is.
    static func dataIssue(_ data: String) -> String? {
        if length(data) > maxDataLength { return "flowchart too large" }
        if data.isEmpty { return nil }
        guard let parsed = try? JSONValue(jsonString: data) else { return "expected JSON" }
        guard let obj = parsed.objectValue else { return "expected an object" }
        for k in obj.keys.sorted() where k != "v" && k != "nodes" && k != "edges" { return "unexpected field \(k)" }
        if let v = obj["v"], v != .number(1) { return "unsupported version" }
        guard let nodes = obj["nodes"]?.arrayValue else { return "nodes must be an array" }
        var edges: [JSONValue] = []
        if let e = obj["edges"] {
            guard let list = e.arrayValue else { return "edges must be an array" }
            edges = list
        }
        if nodes.count > maxNodes { return "too many nodes" }
        if edges.count > maxEdges { return "too many edges" }
        var ids = Set<String>()
        for (i, raw) in nodes.enumerated() {
            guard let n = raw.objectValue else { return "node \(i) must be an object" }
            for k in n.keys.sorted() where !nodeKeys.contains(k) { return "node \(i): unexpected field \(k)" }
            guard let id = n["id"]?.stringValue, isValidId(id), !ids.contains(id) else { return "node \(i): invalid id" }
            ids.insert(id)
            guard let s = n["shape"]?.stringValue, FlowShape(rawValue: s) != nil else { return "node \(i): invalid shape" }
            for k in ["x", "y"] {
                guard let v = finite(n[k]), abs(v) <= maxCoord else { return "node \(i): invalid \(k)" }
            }
            guard let w = finite(n["w"]), w >= minSize, w <= maxWidth else { return "node \(i): invalid w" }
            guard let h = finite(n["h"]), h >= minSize, h <= maxHeight else { return "node \(i): invalid h" }
            if let t = n["text"] {
                guard let s = t.stringValue, length(s) <= maxText else { return "node \(i): invalid text" }
            }
            if let c = n["color"] {
                guard let s = c.stringValue, FlowColor(rawValue: s) != nil else { return "node \(i): invalid color" }
            }
        }
        var edgeIds = Set<String>()
        for (i, raw) in edges.enumerated() {
            guard let e = raw.objectValue else { return "edge \(i) must be an object" }
            for k in e.keys.sorted() where !edgeKeys.contains(k) { return "edge \(i): unexpected field \(k)" }
            guard let id = e["id"]?.stringValue, isValidId(id), !edgeIds.contains(id) else { return "edge \(i): invalid id" }
            edgeIds.insert(id)
            guard let from = e["from"]?.stringValue, ids.contains(from), let to = e["to"]?.stringValue, ids.contains(to) else {
                return "edge \(i): unknown node"
            }
            for k in ["fromSide", "toSide"] {
                if let v = e[k] {
                    guard let s = v.stringValue, FlowSide(rawValue: s) != nil else { return "edge \(i): invalid \(k)" }
                }
            }
            if let l = e["label"] {
                guard let s = l.stringValue, length(s) <= maxLabel else { return "edge \(i): invalid label" }
            }
            if let s = e["style"], s != .string("solid"), s != .string("dashed") { return "edge \(i): invalid style" }
            if let a = e["arrow"], a != .string("end"), a != .string("both"), a != .string("none") { return "edge \(i): invalid arrow" }
        }
        return nil
    }

    // MARK: Reading

    /// Forgiving reader for any flowchart-shaped value (stored data, AI output, pasted JSON). Never fails:
    /// unusable nodes and edges are dropped, numbers clamped, strings trimmed to their limits, duplicate ids
    /// renamed, and edges that point at missing nodes or at their own node removed. Nodes without a position
    /// get (0, 0) and are listed in `unplaced`.
    static func normalize(_ input: JSONValue) -> (data: FlowchartData, unplaced: [String]) {
        var out = FlowchartData()
        var unplaced: [String] = []
        guard let obj = input.objectValue else { return (out, unplaced) }
        var used = Set<String>()
        var rename: [String: String] = [:]
        for raw in obj["nodes"]?.arrayValue ?? [] {
            if out.nodes.count >= maxNodes { break }
            guard let n = raw.objectValue else { continue }
            let shape = n["shape"]?.stringValue.flatMap(FlowShape.init(rawValue:)) ?? .process
            let size = shapeSize(shape)
            let original = idString(n["id"]) ?? ""
            let id = cleanId(n["id"], used: &used, prefix: "n")
            if !original.isEmpty, rename[original] == nil { rename[original] = id }
            let px = finite(n["x"]), py = finite(n["y"])
            let placed = px != nil && py != nil
            if !placed { unplaced.append(id) }
            out.nodes.append(FlowNode(
                id: id,
                shape: shape,
                x: placed ? jsRound(clamp(px!, -maxCoord, maxCoord)) : 0,
                y: placed ? jsRound(clamp(py!, -maxCoord, maxCoord)) : 0,
                w: jsRound(clamp(finite(n["w"]) ?? size.w, minSize, maxWidth)),
                h: jsRound(clamp(finite(n["h"]) ?? size.h, minSize, maxHeight)),
                text: cleanText(n["text"], max: maxText),
                color: n["color"]?.stringValue.flatMap(FlowColor.init(rawValue:)) ?? .neutral
            ))
        }
        var edgeIds = Set<String>()
        var seen = Set<String>()
        for raw in obj["edges"]?.arrayValue ?? [] {
            if out.edges.count >= maxEdges { break }
            guard let e = raw.objectValue else { continue }
            guard let from = rename[refString(e["from"])], let to = rename[refString(e["to"])], from != to else { continue }
            let fromSide = e["fromSide"]?.stringValue.flatMap(FlowSide.init(rawValue:))
            let toSide = e["toSide"]?.stringValue.flatMap(FlowSide.init(rawValue:))
            // The same connection twice (same ends, same sides) draws as one line: keep the first.
            let key = "\(from)>\(to)>\(fromSide?.rawValue ?? "")>\(toSide?.rawValue ?? "")"
            if seen.contains(key) { continue }
            seen.insert(key)
            let arrow = e["arrow"]?.stringValue
            out.edges.append(FlowEdge(
                id: cleanId(e["id"], used: &edgeIds, prefix: "e"),
                from: from,
                to: to,
                fromSide: fromSide,
                toSide: toSide,
                label: collapseNewlines(cleanText(e["label"], max: maxLabel)),
                style: e["style"]?.stringValue == "dashed" ? .dashed : .solid,
                arrow: arrow == "both" ? .both : arrow == "none" ? .noArrow : .end
            ))
        }
        return (out, unplaced)
    }

    /// Reads stored flowchart data; anything unusable reads as an empty chart (never fails).
    static func parse(_ data: String?) -> FlowchartData {
        guard let data, !data.isEmpty, length(data) <= maxDataLength, let raw = try? JSONValue(jsonString: data) else { return FlowchartData() }
        return normalize(raw).data
    }

    // MARK: Writing

    /// Compact wire JSON (defaults omitted, keys in the web's order). Empty charts serialise to "".
    static func serialize(_ fc: FlowchartData) -> String {
        if fc.nodes.isEmpty { return "" }
        var s = "{\"v\":1,\"nodes\":["
        for (i, n) in fc.nodes.enumerated() {
            if i > 0 { s += "," }
            s += "{\"id\":"
            JSONValue.writeString(n.id, into: &s)
            s += ",\"shape\":\"\(n.shape.rawValue)\",\"x\":\(js(jsRound(n.x))),\"y\":\(js(jsRound(n.y))),\"w\":\(js(jsRound(n.w))),\"h\":\(js(jsRound(n.h)))"
            if !n.text.isEmpty {
                s += ",\"text\":"
                JSONValue.writeString(n.text, into: &s)
            }
            if n.color != .neutral { s += ",\"color\":\"\(n.color.rawValue)\"" }
            s += "}"
        }
        s += "],\"edges\":["
        for (i, e) in fc.edges.enumerated() {
            if i > 0 { s += "," }
            s += "{\"id\":"
            JSONValue.writeString(e.id, into: &s)
            s += ",\"from\":"
            JSONValue.writeString(e.from, into: &s)
            s += ",\"to\":"
            JSONValue.writeString(e.to, into: &s)
            if let f = e.fromSide { s += ",\"fromSide\":\"\(f.rawValue)\"" }
            if let t = e.toSide { s += ",\"toSide\":\"\(t.rawValue)\"" }
            if !e.label.isEmpty {
                s += ",\"label\":"
                JSONValue.writeString(e.label, into: &s)
            }
            if e.style != .solid { s += ",\"style\":\"\(e.style.rawValue)\"" }
            if e.arrow != .end { s += ",\"arrow\":\"\(e.arrow.rawValue)\"" }
            s += "}"
        }
        s += "]}"
        return s
    }

    /// Node texts and connector labels (search, AI context).
    static func text(_ fc: FlowchartData) -> String {
        (fc.nodes.map(\.text) + fc.edges.map(\.label))
            .map { $0.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ") }
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
    }

    // MARK: Text metrics
    // Labels wrap with an estimate of Instrument Sans' advance widths rather than a live measurement, so the
    // editor, share pages and exports all break lines in the same places.

    private static func charWidth(_ c: Unicode.Scalar) -> Double {
        if c == " " { return 0.27 }
        switch c {
        case "i", "l", "j", "I", "|", "!", ".", ",", ":", ";", "'", "`": return 0.26
        case "f", "r", "t", "(", ")", "[", "]", "{", "}", "/", "\\", "-", "\"": return 0.36
        case "m", "w", "M", "W", "@", "%": return 0.84
        default: break
        }
        if c.value >= 0x2E80 { return 1 }
        if c.value >= 65 && c.value <= 90 { return 0.64 }
        if c.value >= 48 && c.value <= 57 { return 0.56 }
        if c.value >= 97 && c.value <= 122 { return 0.52 }
        return 0.6
    }

    /// Estimated width of a line of text at `fontSize`.
    static func measure(_ text: String, fontSize: Double = Flowchart.fontSize) -> Double {
        var w = 0.0
        for c in text.unicodeScalars { w += charWidth(c) }
        return w * fontSize
    }

    private static func measure(_ scalars: [Unicode.Scalar], fontSize: Double) -> Double {
        var w = 0.0
        for c in scalars { w += charWidth(c) }
        return w * fontSize
    }

    /// `text.split(sep)` on single scalars, keeping empty pieces like JavaScript.
    private static func split(_ scalars: [Unicode.Scalar], on sep: Unicode.Scalar, runs: Bool) -> [[Unicode.Scalar]] {
        var out: [[Unicode.Scalar]] = []
        var cur: [Unicode.Scalar] = []
        var i = 0
        while i < scalars.count {
            if scalars[i] == sep {
                out.append(cur)
                cur = []
                if runs { while i + 1 < scalars.count && scalars[i + 1] == sep { i += 1 } }
            } else {
                cur.append(scalars[i])
            }
            i += 1
        }
        out.append(cur)
        return out
    }

    /// Word-wraps text into lines no wider than `maxWidth` (long words break), keeping explicit new lines.
    static func wrap(_ text: String, maxWidth: Double, fontSize: Double = Flowchart.fontSize, maxLines: Int = 24) -> [String] {
        var lines: [[Unicode.Scalar]] = []
        let limit = max(fontSize, maxWidth)
        for para in split(Array(text.unicodeScalars), on: "\n", runs: false) {
            var line: [Unicode.Scalar] = []
            for word in split(para, on: " ", runs: true) {
                let candidate = line.isEmpty ? word : line + [" "] + word
                if measure(candidate, fontSize: fontSize) <= limit {
                    line = candidate
                    continue
                }
                if !line.isEmpty { lines.append(line) }
                // A word wider than the line breaks across lines.
                var piece: [Unicode.Scalar] = []
                for c in word {
                    if measure(piece + [c], fontSize: fontSize) > limit && !piece.isEmpty {
                        lines.append(piece)
                        piece = []
                    }
                    piece.append(c)
                }
                line = piece
            }
            lines.append(line)
        }
        var strings = lines.map { String(String.UnicodeScalarView($0)) }
        if strings.count > maxLines {
            strings = Array(strings.prefix(maxLines))
            var last = Array(strings[maxLines - 1].unicodeScalars)
            if !last.isEmpty { last.removeLast() }
            strings[maxLines - 1] = String(String.UnicodeScalarView(last)) + "…"
        }
        return strings
    }

    /// The horizontal lean of an input/output parallelogram.
    static func ioSkew(w: Double, h: Double) -> Double { min(22, h * 0.34, w * 0.2) }

    /// Width available to a node's label inside its shape.
    static func textWidth(shape: FlowShape, w: Double, h: Double) -> Double {
        switch shape {
        case .decision: return w * 0.58 - 6
        case .terminator: return w - min(h, w) * 0.6 - 8
        case .io: return w - 2 * ioSkew(w: w, h: h) - 12
        case .circle: return w * 0.7
        case .text: return w - 8
        default: return w - 24
        }
    }

    static func textWidth(_ n: FlowNode) -> Double { textWidth(shape: n.shape, w: n.w, h: n.h) }

    /// The label's lines for a node.
    static func lines(_ n: FlowNode) -> [String] {
        n.text.isEmpty ? [] : wrap(n.text, maxWidth: textWidth(n))
    }

    /// The smallest height (on the grid) that fits the node's label.
    static func neededHeight(_ n: FlowNode) -> Double {
        let count = Double(max(1, lines(n).count))
        let textH = count * lineHeight
        let pad: Double
        switch n.shape {
        case .decision: pad = textH * 0.9 + 28
        case .circle: pad = textH * 0.45 + 24
        case .note: pad = 28
        case .text: pad = 10
        case .terminator: pad = 18
        case .io: pad = 22
        case .process: pad = 24
        }
        let minH = n.shape == .text ? 32 : shapeSize(n.shape).h * (n.shape == .circle ? 0.5 : 0.75)
        return snapUp(max(minH, textH + pad))
    }

    /// Sizes a node to its label: widens a single long line (up to `maxWidth`), then grows the height so
    /// every line fits. Circles stay round. Never shrinks below the node's current size.
    static func fitToText(_ node: FlowNode, maxWidth fitWidth: Double? = nil) -> FlowNode {
        if node.text.isEmpty { return node }
        var w = node.w
        let limit = min(maxWidth, fitWidth ?? node.w)
        if limit > w {
            let longest = split(Array(node.text.unicodeScalars), on: "\n", runs: false).map { measure($0, fontSize: fontSize) }.max() ?? 0
            let extra = node.w - textWidth(node)
            w = min(limit, max(w, snapUp(longest + extra + 4)))
        }
        var next = node
        next.w = w
        next.h = min(maxHeight, max(node.h, neededHeight(next)))
        if node.shape == .circle {
            let d = max(next.w, next.h)
            next.w = d
            next.h = d
        }
        return next
    }
}
