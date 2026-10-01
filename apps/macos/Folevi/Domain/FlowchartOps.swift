import Foundation

// Port of apps/web/src/components/editor/flowchart/ops.ts: the canvas's pure edits (adding, moving,
// resizing, deleting and duplicating shapes, connecting them, snapping to the grid and alignment guides),
// the canvas's own undo history, and turning an AI draft into a laid-out chart.

struct FlowSelection: Hashable, Sendable {
    var nodes: [String] = []
    var edges: [String] = []

    static let none = FlowSelection()
    var isEmpty: Bool { nodes.isEmpty && edges.isEmpty }
}

enum FlowResizeHandle: String, CaseIterable, Hashable, Sendable {
    case n, ne, e, se, s, sw, w, nw

    var west: Bool { rawValue.contains("w") }
    var east: Bool { rawValue.contains("e") }
    var north: Bool { rawValue.contains("n") }
    var south: Bool { rawValue.contains("s") }
}

/// An alignment guide shown while moving shapes.
struct FlowGuide: Hashable, Sendable {
    enum Axis: Hashable, Sendable { case x, y }
    var axis: Axis
    var at: Double
    var from: Double
    var to: Double
}

enum FlowOps {
    static func boxOf(_ rects: [FlowRect]) -> FlowRect? {
        guard !rects.isEmpty else { return nil }
        let x0 = rects.map(\.x).min()!, y0 = rects.map(\.y).min()!
        let x1 = rects.map { $0.x + $0.w }.max()!, y1 = rects.map { $0.y + $0.h }.max()!
        return FlowRect(x: x0, y: y0, w: x1 - x0, h: y1 - y0)
    }

    /// The top-most node under a point.
    static func nodeAt(_ fc: FlowchartData, _ p: FlowPoint, pad: Double = 0) -> FlowNode? {
        for n in fc.nodes.reversed() where p.x >= n.x - pad && p.x <= n.x + n.w + pad && p.y >= n.y - pad && p.y <= n.y + n.h + pad {
            return n
        }
        return nil
    }

    /// A new node of `shape` centred on `at` (snapped), nudged along if that spot is taken.
    static func addNode(_ fc: FlowchartData, shape: FlowShape, at: FlowPoint, size: (w: Double, h: Double)? = nil, color: FlowColor = .neutral, text: String = "")
        -> (doc: FlowchartData, id: String)? {
        guard fc.nodes.count < Flowchart.maxNodes else { return nil }
        let (w, h) = size ?? Flowchart.shapeSize(shape)
        let base = Flowchart.shapeSize(shape)
        var x = Flowchart.snap(at.x - base.w / 2)
        var y = Flowchart.snap(at.y - base.h / 2)
        var i = 0
        while i < 20 && fc.nodes.contains(where: { abs($0.x - x) < 8 && abs($0.y - y) < 8 }) {
            x += 24
            y += 24
            i += 1
        }
        var used = Set(fc.nodes.map(\.id))
        var id = Flowchart.newId("n")
        while used.contains(id) { id = Flowchart.newId("n") }
        used.insert(id)
        var next = fc
        next.nodes.append(FlowNode(id: id, shape: shape, x: x, y: y, w: w, h: h, text: text, color: color))
        return (next, id)
    }

    static func connect(_ fc: FlowchartData, from: String, to: String, fromSide: FlowSide? = nil, toSide: FlowSide? = nil) -> (doc: FlowchartData, id: String)? {
        if from == to || fc.edges.count >= Flowchart.maxEdges { return nil }
        if let dup = fc.edges.first(where: { $0.from == from && $0.to == to }) { return (fc, dup.id) }
        var id = Flowchart.newId("e")
        while fc.edges.contains(where: { $0.id == id }) { id = Flowchart.newId("e") }
        var next = fc
        next.edges.append(FlowEdge(id: id, from: from, to: to, fromSide: fromSide, toSide: toSide))
        return (next, id)
    }

    static func updateNodes(_ fc: FlowchartData, _ ids: [String], _ patch: (FlowNode) -> FlowNode) -> FlowchartData {
        let set = Set(ids)
        var next = fc
        next.nodes = fc.nodes.map { set.contains($0.id) ? patch($0) : $0 }
        return next
    }

    static func updateEdges(_ fc: FlowchartData, _ ids: [String], _ patch: (FlowEdge) -> FlowEdge) -> FlowchartData {
        let set = Set(ids)
        var next = fc
        next.edges = fc.edges.map { set.contains($0.id) ? patch($0) : $0 }
        return next
    }

    /// Moves nodes by (dx, dy) from their original positions.
    static func moveNodes(_ fc: FlowchartData, origin: [String: FlowPoint], dx: Double, dy: Double) -> FlowchartData {
        let l = Flowchart.maxCoord
        var next = fc
        next.nodes = fc.nodes.map { n in
            guard let o = origin[n.id] else { return n }
            var n = n
            n.x = max(-l, min(l, Flowchart.jsRound(o.x + dx)))
            n.y = max(-l, min(l, Flowchart.jsRound(o.y + dy)))
            return n
        }
        return next
    }

    static func setColor(_ fc: FlowchartData, _ ids: [String], _ color: FlowColor) -> FlowchartData {
        updateNodes(fc, ids) { n in
            var n = n
            n.color = color
            return n
        }
    }

    /// Changes shapes, keeping each node's centre and growing it to fit its label.
    static func setShape(_ fc: FlowchartData, _ ids: [String], _ shape: FlowShape) -> FlowchartData {
        updateNodes(fc, ids) { n in
            let size = Flowchart.shapeSize(shape)
            let w = shape == .circle ? size.w : max(n.w, size.w)
            let h = shape == .circle ? size.h : shape == .text ? size.h : max(n.h, size.h)
            var next = n
            next.shape = shape
            next.w = w
            next.h = h
            next.x = Flowchart.snap(n.x + n.w / 2 - w / 2)
            next.y = Flowchart.snap(n.y + n.h / 2 - h / 2)
            return Flowchart.fitToText(next)
        }
    }

    /// Removes the selected nodes (with their connectors) and connectors.
    static func deleteSelection(_ fc: FlowchartData, _ sel: FlowSelection) -> FlowchartData {
        let nodes = Set(sel.nodes), edges = Set(sel.edges)
        var next = fc
        next.nodes = fc.nodes.filter { !nodes.contains($0.id) }
        next.edges = fc.edges.filter { !edges.contains($0.id) && !nodes.contains($0.from) && !nodes.contains($0.to) }
        return next
    }

    /// Copies the selected nodes (and the connectors between them) a little down and to the right.
    static func duplicate(_ fc: FlowchartData, _ ids: [String], offset: Double = 24) -> (doc: FlowchartData, ids: [String]) {
        let room = Flowchart.maxNodes - fc.nodes.count
        let picked = Array(fc.nodes.filter { ids.contains($0.id) }.prefix(max(0, room)))
        var used = Set(fc.nodes.map(\.id))
        var map: [String: String] = [:]
        for n in picked {
            var id = Flowchart.newId("n")
            while used.contains(id) { id = Flowchart.newId("n") }
            used.insert(id)
            map[n.id] = id
        }
        let nodes = picked.map { n -> FlowNode in
            var c = n
            c.id = map[n.id]!
            c.x = n.x + offset
            c.y = n.y + offset
            return c
        }
        var usedEdges = Set(fc.edges.map(\.id))
        let edges = fc.edges.filter { map[$0.from] != nil && map[$0.to] != nil }
            .prefix(max(0, Flowchart.maxEdges - fc.edges.count))
            .map { e -> FlowEdge in
                var c = e
                var id = Flowchart.newId("e")
                while usedEdges.contains(id) { id = Flowchart.newId("e") }
                usedEdges.insert(id)
                c.id = id
                c.from = map[e.from]!
                c.to = map[e.to]!
                return c
            }
        var next = fc
        next.nodes += nodes
        next.edges += edges
        return (next, nodes.map(\.id))
    }

    /// A node resized by dragging one of its handles by (dx, dy), snapped to the grid.
    static func resizeNode(_ orig: FlowNode, handle: FlowResizeHandle, dx: Double, dy: Double, keepRatio: Bool) -> FlowNode {
        let minSize: Double = orig.shape == .text ? 32 : 40
        var x0 = orig.x, y0 = orig.y, x1 = orig.x + orig.w, y1 = orig.y + orig.h
        if handle.west { x0 = min(Flowchart.snap(x0 + dx), x1 - minSize) }
        if handle.east { x1 = max(Flowchart.snap(x1 + dx), x0 + minSize) }
        if handle.north { y0 = min(Flowchart.snap(y0 + dy), y1 - minSize) }
        if handle.south { y1 = max(Flowchart.snap(y1 + dy), y0 + minSize) }
        var w = min(Flowchart.maxWidth, x1 - x0)
        var h = min(Flowchart.maxHeight, y1 - y0)
        if keepRatio || orig.shape == .circle {
            let s = max(w / orig.w, h / orig.h)
            w = min(Flowchart.maxWidth, Flowchart.snap(orig.w * s))
            h = min(Flowchart.maxHeight, Flowchart.snap(orig.h * s))
        }
        if handle.west { x0 = x1 - w }
        if handle.north { y0 = y1 - h }
        var n = orig
        n.x = x0
        n.y = y0
        n.w = w
        n.h = h
        return n
    }

    /// Snaps a moving group: to another node's edges or centre when within `threshold` (showing a guide),
    /// otherwise to the grid.
    static func snapGroup(_ moving: FlowRect, others: [FlowRect], threshold: Double) -> (dx: Double, dy: Double, guides: [FlowGuide]) {
        var guides: [FlowGuide] = []
        func pick(_ axis: FlowGuide.Axis) -> Double {
            let pos = axis == .x ? moving.x : moving.y
            let size = axis == .x ? moving.w : moving.h
            let lines = [pos, pos + size / 2, pos + size]
            var best: (d: Double, at: Double, other: FlowRect)?
            for o in others {
                let op = axis == .x ? o.x : o.y
                let os = axis == .x ? o.w : o.h
                for target in [op, op + os / 2, op + os] {
                    for l in lines {
                        let d = target - l
                        if abs(d) <= threshold && (best == nil || abs(d) < abs(best!.d)) { best = (d, target, o) }
                    }
                }
            }
            guard let best else { return Flowchart.snap(pos) - pos }
            let o = best.other
            let a0 = axis == .x ? min(moving.y, o.y) : min(moving.x, o.x)
            let a1 = axis == .x ? max(moving.y + moving.h, o.y + o.h) : max(moving.x + moving.w, o.x + o.w)
            guides.append(FlowGuide(axis: axis, at: best.at, from: a0, to: a1))
            return best.d
        }
        let dx = pick(.x)
        let dy = pick(.y)
        return (dx, dy, guides)
    }

    // MARK: AI drafts

    /// Turns an AI draft (`ai:flowchart`'s result) into a chart: validated again here (never trust the
    /// network), sized to its labels, laid out, and placed where the current chart starts. In "update" mode
    /// nodes the AI kept (same id) keep their size and colour.
    static func chartFromDraft(_ draft: JSONValue, current: FlowchartData, update: Bool) -> FlowchartData {
        let safe = Flowchart.normalize(draft).data
        var prev: [String: FlowNode] = [:]
        for n in current.nodes { prev[n.id] = n }
        let nodes = safe.nodes.map { n -> FlowNode in
            let old = update ? prev[n.id] : nil
            var next = n
            let size = old.flatMap { $0.shape == n.shape ? (w: $0.w, h: $0.h) : nil } ?? Flowchart.shapeSize(n.shape)
            next.w = size.w
            next.h = size.h
            if let old, n.color == .neutral { next.color = old.color }
            return Flowchart.fitToText(next, maxWidth: 240)
        }
        let origin = boxOf(current.nodes.map(\.rect)).map { FlowPoint(x: $0.x, y: $0.y) } ?? FlowPoint(x: 0, y: 0)
        let direction: FlowDirection = draft["direction"]?.stringValue == "LR" ? .leftRight : .topDown
        return FlowchartLayout.layout(FlowchartData(nodes: nodes, edges: safe.edges), direction: direction,
                                 origin: FlowPoint(x: Flowchart.snap(origin.x), y: Flowchart.snap(origin.y)))
    }
}

/// Undo and redo for one flowchart while its canvas has the keyboard (⌘Z). Cleared whenever the chart
/// changes from outside (another device, the note's own Undo). Rapid edits with the same key (typing,
/// nudging) coalesce into one step.
struct FlowHistory {
    private var past: [FlowchartData] = []
    private var future: [FlowchartData] = []
    private var lastKey: String?
    private var lastAt: TimeInterval = 0

    mutating func push(_ before: FlowchartData, key: String? = nil, now: TimeInterval = Date().timeIntervalSince1970) {
        if let key, key == lastKey, now - lastAt < 0.8 {
            lastAt = now
            return
        }
        past.append(before)
        if past.count > 200 { past.removeFirst() }
        future = []
        lastKey = key
        lastAt = now
    }

    mutating func undo(_ current: FlowchartData) -> FlowchartData? {
        guard let prev = past.popLast() else { return nil }
        future.append(current)
        lastKey = nil
        return prev
    }

    mutating func redo(_ current: FlowchartData) -> FlowchartData? {
        guard let next = future.popLast() else { return nil }
        past.append(current)
        lastKey = nil
        return next
    }

    mutating func clear() {
        past = []
        future = []
        lastKey = nil
    }

    var canUndo: Bool { !past.isEmpty }
    var canRedo: Bool { !future.isEmpty }
}
