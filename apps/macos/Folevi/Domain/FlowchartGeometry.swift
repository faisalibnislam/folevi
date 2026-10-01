import Foundation

// Port of packages/editor-schema/src/flowchartGeometry.ts: shape outlines, connection points, orthogonal
// connector routing (with rounded corners), arrowheads, label placement and bounds. Pure functions of the
// chart data, so the canvas, read-only notes and exports draw exactly the same picture. Paths are SVG path
// strings (numbers rounded to 0.1, printed like JavaScript); `FlowPath` turns them into drawing commands.

struct RoutedEdge: Hashable, Sendable {
    struct Label: Hashable, Sendable {
        var x: Double
        var y: Double
        var w: Double
        var h: Double
        var cx: Double
        var cy: Double
    }

    var edge: FlowEdge
    var points: [FlowPoint]
    /// The line (shortened under its arrowheads).
    var d: String
    /// Arrowhead outlines (filled).
    var heads: [String]
    var fromSide: FlowSide
    var toSide: FlowSide
    /// Label box, when the edge has a label.
    var label: Label?
}

enum FlowGeometry {
    private static let corner = 10.0
    private static let stub = 18.0
    private static let arrowLen = 9.0
    private static let arrowHalf = 4.6

    static func r1(_ n: Double) -> Double { Flowchart.jsRound(n * 10) / 10 }
    private static func f(_ n: Double) -> String { Flowchart.js(r1(n)) }

    private static func normal(_ s: FlowSide) -> FlowPoint {
        switch s {
        case .top: return FlowPoint(x: 0, y: -1)
        case .right: return FlowPoint(x: 1, y: 0)
        case .bottom: return FlowPoint(x: 0, y: 1)
        case .left: return FlowPoint(x: -1, y: 0)
        }
    }

    // MARK: Shapes

    /// SVG path for a node's outline.
    static func shapePath(shape: FlowShape, x: Double, y: Double, w: Double, h: Double) -> String {
        switch shape {
        case .decision:
            // A diamond with softened corners.
            let cx = x + w / 2, cy = y + h / 2
            return roundedPolygon([FlowPoint(x: cx, y: y), FlowPoint(x: x + w, y: cy), FlowPoint(x: cx, y: y + h), FlowPoint(x: x, y: cy)], min(8, w / 10, h / 10))
        case .io:
            let s = Flowchart.ioSkew(w: w, h: h)
            return roundedPolygon([FlowPoint(x: x + s, y: y), FlowPoint(x: x + w, y: y), FlowPoint(x: x + w - s, y: y + h), FlowPoint(x: x, y: y + h)], 6)
        case .circle:
            return "M\(f(x)) \(f(y + h / 2))A\(f(w / 2)) \(f(h / 2)) 0 1 0 \(f(x + w)) \(f(y + h / 2))A\(f(w / 2)) \(f(h / 2)) 0 1 0 \(f(x)) \(f(y + h / 2))Z"
        case .terminator:
            return roundedRect(x, y, w, h, min(h, w) / 2)
        case .note:
            return roundedRect(x, y, w, h, 4)
        case .text:
            return roundedRect(x, y, w, h, 6)
        case .process:
            return roundedRect(x, y, w, h, corner)
        }
    }

    static func shapePath(_ n: FlowNode) -> String { shapePath(shape: n.shape, x: n.x, y: n.y, w: n.w, h: n.h) }

    private static func roundedRect(_ x: Double, _ y: Double, _ w: Double, _ h: Double, _ r: Double) -> String {
        let rr = min(r, w / 2, h / 2)
        return "M\(f(x + rr)) \(f(y))H\(f(x + w - rr))A\(f(rr)) \(f(rr)) 0 0 1 \(f(x + w)) \(f(y + rr))V\(f(y + h - rr))A\(f(rr)) \(f(rr)) 0 0 1 \(f(x + w - rr)) \(f(y + h))H\(f(x + rr))A\(f(rr)) \(f(rr)) 0 0 1 \(f(x)) \(f(y + h - rr))V\(f(y + rr))A\(f(rr)) \(f(rr)) 0 0 1 \(f(x + rr)) \(f(y))Z"
    }

    private static func roundedPolygon(_ pts: [FlowPoint], _ r: Double) -> String {
        var d = ""
        for i in pts.indices {
            let p = pts[i]
            let prev = pts[(i + pts.count - 1) % pts.count]
            let next = pts[(i + 1) % pts.count]
            let a = toward(p, prev, r)
            let b = toward(p, next, r)
            d += "\(i == 0 ? "M" : "L")\(f(a.x)) \(f(a.y))Q\(f(p.x)) \(f(p.y)) \(f(b.x)) \(f(b.y))"
        }
        return d + "Z"
    }

    private static func toward(_ from: FlowPoint, _ to: FlowPoint, _ dist: Double) -> FlowPoint {
        let dx = to.x - from.x, dy = to.y - from.y
        let l = Flowchart.hypot(dx, dy)
        let len = l == 0 ? 1 : l
        let d = min(dist, len / 2)
        return FlowPoint(x: from.x + (dx / len) * d, y: from.y + (dy / len) * d)
    }

    // MARK: Ports and sides

    /// Where a connector meets a node side; `t` (0…1) spreads several connectors along one side.
    static func portPoint(_ n: FlowNode, _ side: FlowSide, _ t: Double = 0.5) -> FlowPoint {
        let x = n.x, y = n.y, w = n.w, h = n.h
        // Diamonds, circles and pill ends connect at the tips only.
        let spread = n.shape == .decision || n.shape == .circle || (n.shape == .terminator && (side == .left || side == .right)) ? 0.5 : t
        if n.shape == .io {
            let s = Flowchart.ioSkew(w: w, h: h)
            switch side {
            case .top: return FlowPoint(x: x + s + (w - s) * spread, y: y)
            case .bottom: return FlowPoint(x: x + (w - s) * spread, y: y + h)
            case .left: return FlowPoint(x: x + s * (1 - spread), y: y + h * spread)
            case .right: return FlowPoint(x: x + w - s * spread, y: y + h * spread)
            }
        }
        if n.shape == .terminator && (side == .top || side == .bottom) {
            let r = min(h, w) / 2
            return FlowPoint(x: x + r + (w - 2 * r) * spread, y: side == .top ? y : y + h)
        }
        switch side {
        case .top: return FlowPoint(x: x + w * spread, y: y)
        case .bottom: return FlowPoint(x: x + w * spread, y: y + h)
        case .left: return FlowPoint(x: x, y: y + h * spread)
        case .right: return FlowPoint(x: x + w, y: y + h * spread)
        }
    }

    static func center(_ r: FlowRect) -> FlowPoint { FlowPoint(x: r.x + r.w / 2, y: r.y + r.h / 2) }

    /// Natural sides for a connector between two nodes (vertical flow preferred).
    static func autoSides(_ a: FlowRect, _ b: FlowRect) -> (FlowSide, FlowSide) {
        let ca = center(a), cb = center(b)
        let dx = cb.x - ca.x, dy = cb.y - ca.y
        let gy = abs(dy) - (a.h + b.h) / 2
        let gx = abs(dx) - (a.w + b.w) / 2
        let vertical = gy >= 0 ? gx < 0 || gy >= gx * 0.6 : gx < 0
        if vertical { return dy >= 0 ? (.bottom, .top) : (.top, .bottom) }
        return dx >= 0 ? (.right, .left) : (.left, .right)
    }

    /// The side of a node closest to a point (for dropping a connector on a node).
    static func nearestSide(_ n: FlowRect, _ p: FlowPoint) -> FlowSide {
        let d: [(FlowSide, Double)] = [
            (.top, abs(p.y - n.y)),
            (.bottom, abs(p.y - (n.y + n.h))),
            (.left, abs(p.x - n.x)),
            (.right, abs(p.x - (n.x + n.w))),
        ]
        var best = d[0]
        for item in d.dropFirst() where item.1 < best.1 { best = item }
        return best.0
    }

    // MARK: Routing

    private static func simplify(_ pts: [FlowPoint]) -> [FlowPoint] {
        var out: [FlowPoint] = []
        for p in pts {
            if let last = out.last, abs(last.x - p.x) < 0.01 && abs(last.y - p.y) < 0.01 { continue }
            out.append(p)
            // Drop the middle of three points on one line.
            while out.count >= 3 {
                let a = out[out.count - 3], b = out[out.count - 2], c = out[out.count - 1]
                let colinear = (abs(a.x - b.x) < 0.01 && abs(b.x - c.x) < 0.01) || (abs(a.y - b.y) < 0.01 && abs(b.y - c.y) < 0.01)
                if !colinear { break }
                out.remove(at: out.count - 2)
            }
        }
        return out
    }

    /// Whether an axis-aligned segment passes through a rectangle's interior.
    private static func segmentHitsRect(_ a: FlowPoint, _ b: FlowPoint, _ r: FlowRect, inset: Double = 2) -> Bool {
        let x0 = r.x + inset, x1 = r.x + r.w - inset
        let y0 = r.y + inset, y1 = r.y + r.h - inset
        if abs(a.y - b.y) < 0.01 {
            if a.y <= y0 || a.y >= y1 { return false }
            return max(a.x, b.x) > x0 && min(a.x, b.x) < x1
        }
        if a.x <= x0 || a.x >= x1 { return false }
        return max(a.y, b.y) > y0 && min(a.y, b.y) < y1
    }

    private static func sign(_ n: Double) -> Double { n > 0 ? 1 : n < 0 ? -1 : 0 }

    private static func pathScore(_ pts: [FlowPoint], _ ra: FlowRect, _ rb: FlowRect) -> Double {
        var len = 0.0, penalty = 0.0
        for i in 1..<max(1, pts.count) {
            let a = pts[i - 1], b = pts[i]
            len += abs(a.x - b.x) + abs(a.y - b.y)
            // The first and last segments leave and enter their own node by construction.
            if i > 1 && segmentHitsRect(a, b, ra) { penalty += 1000 }
            if i < pts.count - 1 && segmentHitsRect(a, b, rb) { penalty += 1000 }
            if i >= 2 {
                let p = pts[i - 2]
                let d1 = (sign(a.x - p.x), sign(a.y - p.y))
                let d2 = (sign(b.x - a.x), sign(b.y - a.y))
                if d1.0 == -d2.0 && d1.1 == -d2.1 { penalty += 2000 } // doubling back
            }
        }
        return len + Double(pts.count - 2) * 14 + penalty
    }

    /// An orthogonal route from `a` (leaving through side `sa`) to `b` (entering through `sb`): short stubs
    /// straight out of each node, then the cheapest of a few elbow shapes that doesn't cut through either node.
    static func orthogonalRoute(_ a: FlowPoint, _ sa: FlowSide, _ b: FlowPoint, _ sb: FlowSide, _ ra: FlowRect, _ rb: FlowRect) -> [FlowPoint] {
        let na = normal(sa), nb = normal(sb)
        let p1 = FlowPoint(x: a.x + na.x * stub, y: a.y + na.y * stub)
        let p2 = FlowPoint(x: b.x + nb.x * stub, y: b.y + nb.y * stub)
        let mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2
        let top = min(ra.y, rb.y) - stub
        let bottom = max(ra.y + ra.h, rb.y + rb.h) + stub
        let left = min(ra.x, rb.x) - stub
        let right = max(ra.x + ra.w, rb.x + rb.w) + stub
        let middles: [[FlowPoint]] = [
            [FlowPoint(x: p1.x, y: p2.y)],
            [FlowPoint(x: p2.x, y: p1.y)],
            [FlowPoint(x: p1.x, y: my), FlowPoint(x: p2.x, y: my)],
            [FlowPoint(x: mx, y: p1.y), FlowPoint(x: mx, y: p2.y)],
            [FlowPoint(x: p1.x, y: top), FlowPoint(x: p2.x, y: top)],
            [FlowPoint(x: p1.x, y: bottom), FlowPoint(x: p2.x, y: bottom)],
            [FlowPoint(x: left, y: p1.y), FlowPoint(x: left, y: p2.y)],
            [FlowPoint(x: right, y: p1.y), FlowPoint(x: right, y: p2.y)],
        ]
        var best: [FlowPoint] = []
        var bestScore = Double.infinity
        for mid in middles {
            let pts = simplify([a, p1] + mid + [p2, b])
            let s = pathScore(pts, ra, rb)
            if s < bestScore {
                bestScore = s
                best = pts
            }
        }
        return best
    }

    /// SVG path through the points with rounded corners.
    static func roundedPolyline(_ pts: [FlowPoint], radius: Double = 10) -> String {
        guard let first = pts.first else { return "" }
        var d = "M\(f(first.x)) \(f(first.y))"
        if pts.count > 2 {
            for i in 1..<(pts.count - 1) {
                let p = pts[i], prev = pts[i - 1], next = pts[i + 1]
                let lin = Flowchart.hypot(p.x - prev.x, p.y - prev.y)
                let lout = Flowchart.hypot(next.x - p.x, next.y - p.y)
                let r = min(radius, lin / 2, lout / 2)
                let a = toward(p, prev, r)
                let b = toward(p, next, r)
                d += "L\(f(a.x)) \(f(a.y))Q\(f(p.x)) \(f(p.y)) \(f(b.x)) \(f(b.y))"
            }
        }
        let last = pts[pts.count - 1]
        return d + "L\(f(last.x)) \(f(last.y))"
    }

    /// A small swept arrowhead with its tip at `tip`, pointing along `dir` (a unit vector).
    private static func arrowHead(_ tip: FlowPoint, _ dir: FlowPoint) -> String {
        let base = FlowPoint(x: tip.x - dir.x * arrowLen, y: tip.y - dir.y * arrowLen)
        let notch = FlowPoint(x: tip.x - dir.x * arrowLen * 0.72, y: tip.y - dir.y * arrowLen * 0.72)
        let perp = FlowPoint(x: -dir.y, y: dir.x)
        let l = FlowPoint(x: base.x + perp.x * arrowHalf, y: base.y + perp.y * arrowHalf)
        let r = FlowPoint(x: base.x - perp.x * arrowHalf, y: base.y - perp.y * arrowHalf)
        return "M\(f(tip.x)) \(f(tip.y))L\(f(l.x)) \(f(l.y))Q\(f(notch.x)) \(f(notch.y)) \(f(r.x)) \(f(r.y))Z"
    }

    private static func unit(_ from: FlowPoint, _ to: FlowPoint) -> FlowPoint {
        let dx = to.x - from.x, dy = to.y - from.y
        let l = Flowchart.hypot(dx, dy)
        let len = l == 0 ? 1 : l
        return FlowPoint(x: dx / len, y: dy / len)
    }

    /// The point halfway along a polyline.
    static func midpoint(_ pts: [FlowPoint]) -> FlowPoint {
        var total = 0.0
        for i in pts.indices.dropFirst() { total += Flowchart.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y) }
        var left = total / 2
        for i in pts.indices.dropFirst() {
            let a = pts[i - 1], b = pts[i]
            let seg = Flowchart.hypot(b.x - a.x, b.y - a.y)
            if seg >= left && seg > 0 { return FlowPoint(x: a.x + ((b.x - a.x) * left) / seg, y: a.y + ((b.y - a.y) * left) / seg) }
            left -= seg
        }
        return pts.first ?? FlowPoint(x: 0, y: 0)
    }

    /// Resolved sides for every edge: explicit ones kept, the rest chosen from the nodes' positions.
    static func edgeSides(_ fc: FlowchartData, _ byId: [String: FlowNode]) -> [String: (FlowSide, FlowSide)] {
        var sides: [String: (FlowSide, FlowSide)] = [:]
        for e in fc.edges {
            guard let a = byId[e.from], let b = byId[e.to] else { continue }
            let (fa, fb) = autoSides(a.rect, b.rect)
            sides[e.id] = (e.fromSide ?? fa, e.toSide ?? fb)
        }
        // A decision with several automatic branches leaving the same tip: send the extra ones out sideways,
        // toward their targets (the classic Yes-down / No-right shape).
        var order: [String] = []
        var bySource: [String: [FlowEdge]] = [:]
        for e in fc.edges {
            guard e.fromSide == nil, let s = sides[e.id], byId[e.from]?.shape == .decision else { continue }
            let key = "\(e.from):\(s.0.rawValue)"
            if bySource[key] == nil { order.append(key) }
            bySource[key, default: []].append(e)
        }
        for key in order {
            guard let list = bySource[key], list.count >= 2, let src = byId[list[0].from], let first = sides[list[0].id] else { continue }
            let c = center(src.rect)
            let vertical = first.0 == .top || first.0 == .bottom
            func off(_ e: FlowEdge) -> Double {
                let t = center(byId[e.to]!.rect)
                return vertical ? t.x - c.x : t.y - c.y
            }
            let sorted = stableSorted(list) { abs(off($0)) < abs(off($1)) }
            var taken = Set<FlowSide>()
            for e in sorted.dropFirst() {
                let o = off(e)
                var side: FlowSide = vertical ? (o >= 0 ? .right : .left) : (o >= 0 ? .bottom : .top)
                if taken.contains(side) { side = side.opposite }
                if taken.contains(side) { continue }
                taken.insert(side)
                let cur = sides[e.id]!
                sides[e.id] = (side, e.toSide ?? cur.1)
            }
        }
        return sides
    }

    /// Routes every connector of the chart (edges whose nodes are missing are skipped).
    static func routeEdges(_ fc: FlowchartData) -> [RoutedEdge] {
        var byId: [String: FlowNode] = [:]
        for n in fc.nodes { byId[n.id] = n }
        let sides = edgeSides(fc, byId)
        // Several connectors on one side of a node spread out along it, ordered by where their other end is.
        struct Item { var edgeId: String; var end: String; var key: Double }
        var groups: [String: [Item]] = [:]
        for e in fc.edges {
            guard let s = sides[e.id] else { continue }
            for end in ["from", "to"] {
                let me = byId[end == "from" ? e.from : e.to]!
                let other = byId[end == "from" ? e.to : e.from]!
                let side = end == "from" ? s.0 : s.1
                let oc = center(other.rect)
                let key = side == .top || side == .bottom ? oc.x : oc.y
                groups["\(me.id):\(side.rawValue)", default: []].append(Item(edgeId: e.id, end: end, key: key))
            }
        }
        var spread: [String: Double] = [:]
        for list in groups.values {
            let sorted = stableSorted(list) { $0.key < $1.key }
            let n = Double(sorted.count)
            let step = n > 1 ? min(0.22, 0.64 / (n - 1)) : 0
            for (i, item) in sorted.enumerated() { spread["\(item.edgeId):\(item.end)"] = 0.5 + (Double(i) - (n - 1) / 2) * step }
        }
        var out: [RoutedEdge] = []
        for e in fc.edges {
            guard let a = byId[e.from], let b = byId[e.to], let s = sides[e.id] else { continue }
            let pa = portPoint(a, s.0, spread["\(e.id):from"] ?? 0.5)
            let pb = portPoint(b, s.1, spread["\(e.id):to"] ?? 0.5)
            let points = orthogonalRoute(pa, s.0, pb, s.1, a.rect, b.rect)
            out.append(routed(e, points: points, fromSide: s.0, toSide: s.1))
        }
        return out
    }

    /// Line, arrowheads and label box for a connector drawn through `points`.
    static func routed(_ e: FlowEdge, points: [FlowPoint], fromSide: FlowSide, toSide: FlowSide) -> RoutedEdge {
        var line = points
        var heads: [String] = []
        if line.count >= 2 && (e.arrow == .end || e.arrow == .both) {
            let tip = points[points.count - 1]
            let dir = unit(points[points.count - 2], tip)
            heads.append(arrowHead(tip, dir))
            line[line.count - 1] = FlowPoint(x: tip.x - dir.x * (arrowLen - 2), y: tip.y - dir.y * (arrowLen - 2))
        }
        if line.count >= 2 && e.arrow == .both {
            let tip = points[0]
            let dir = unit(points[1], tip)
            heads.append(arrowHead(tip, dir))
            line[0] = FlowPoint(x: tip.x - dir.x * (arrowLen - 2), y: tip.y - dir.y * (arrowLen - 2))
        }
        var label: RoutedEdge.Label?
        if !e.label.isEmpty {
            let m = midpoint(points)
            let w = min(220, Flowchart.measure(e.label, fontSize: Flowchart.labelFontSize)) + 12
            let h = 20.0
            label = RoutedEdge.Label(x: m.x - w / 2, y: m.y - h / 2, w: w, h: h, cx: m.x, cy: m.y)
        }
        return RoutedEdge(edge: e, points: points, d: roundedPolyline(line), heads: heads, fromSide: fromSide, toSide: toSide, label: label)
    }

    /// Bounding box of every node, connector and label (nil for an empty chart).
    static func bounds(_ fc: FlowchartData, routed: [RoutedEdge]? = nil) -> FlowRect? {
        if fc.nodes.isEmpty { return nil }
        let routed = routed ?? routeEdges(fc)
        var x0 = Double.infinity, y0 = Double.infinity, x1 = -Double.infinity, y1 = -Double.infinity
        func add(_ x: Double, _ y: Double) {
            x0 = min(x0, x); y0 = min(y0, y); x1 = max(x1, x); y1 = max(y1, y)
        }
        for n in fc.nodes {
            add(n.x, n.y)
            add(n.x + n.w, n.y + n.h)
        }
        for r in routed {
            for p in r.points { add(p.x, p.y) }
            if let l = r.label {
                add(l.x, l.y)
                add(l.x + l.w, l.y + l.h)
            }
        }
        return FlowRect(x: x0, y: y0, w: x1 - x0, h: y1 - y0)
    }

    static func rectsOverlap(_ a: FlowRect, _ b: FlowRect) -> Bool {
        a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
    }

    /// A stable sort (JavaScript's `Array.prototype.sort` is stable; ties keep their order).
    static func stableSorted<T>(_ list: [T], by less: (T, T) -> Bool) -> [T] {
        list.enumerated().sorted { a, b in
            if less(a.element, b.element) { return true }
            if less(b.element, a.element) { return false }
            return a.offset < b.offset
        }.map(\.element)
    }
}

/// An SVG path string parsed into drawing commands (the subset the flowchart geometry writes: M, L, H, V,
/// Q, A with absolute coordinates, Z). Lets the canvas draw exactly the outlines exports write.
enum FlowPathCommand: Hashable, Sendable {
    case move(FlowPoint)
    case line(FlowPoint)
    case quad(control: FlowPoint, to: FlowPoint)
    /// An elliptical arc (SVG endpoint form) from the current point.
    case arc(rx: Double, ry: Double, rotation: Double, largeArc: Bool, sweep: Bool, to: FlowPoint)
    case close
}

enum FlowPath {
    static func parse(_ d: String) -> [FlowPathCommand] {
        var out: [FlowPathCommand] = []
        let scalars = Array(d.unicodeScalars)
        var i = 0
        var cur = FlowPoint(x: 0, y: 0)
        var cmd: Unicode.Scalar = "M"
        func skip() { while i < scalars.count, scalars[i] == " " || scalars[i] == "," { i += 1 } }
        func number() -> Double? {
            skip()
            var s = ""
            while i < scalars.count {
                let c = scalars[i]
                if (c >= "0" && c <= "9") || c == "." || c == "e" || ((c == "-" || c == "+") && (s.isEmpty || s.hasSuffix("e"))) {
                    s.unicodeScalars.append(c)
                    i += 1
                } else { break }
            }
            return s.isEmpty ? nil : Double(s)
        }
        while i < scalars.count {
            skip()
            guard i < scalars.count else { break }
            let c = scalars[i]
            if "MLHVQAZ".unicodeScalars.contains(c) {
                cmd = c
                i += 1
                if c == "Z" {
                    out.append(.close)
                    continue
                }
            }
            switch cmd {
            case "M", "L":
                guard let x = number(), let y = number() else { return out }
                cur = FlowPoint(x: x, y: y)
                out.append(cmd == "M" ? .move(cur) : .line(cur))
                if cmd == "M" { cmd = "L" }
            case "H":
                guard let x = number() else { return out }
                cur = FlowPoint(x: x, y: cur.y)
                out.append(.line(cur))
            case "V":
                guard let y = number() else { return out }
                cur = FlowPoint(x: cur.x, y: y)
                out.append(.line(cur))
            case "Q":
                guard let cx = number(), let cy = number(), let x = number(), let y = number() else { return out }
                cur = FlowPoint(x: x, y: y)
                out.append(.quad(control: FlowPoint(x: cx, y: cy), to: cur))
            case "A":
                guard let rx = number(), let ry = number(), let rot = number(), let large = number(), let sweep = number(),
                      let x = number(), let y = number() else { return out }
                cur = FlowPoint(x: x, y: y)
                out.append(.arc(rx: rx, ry: ry, rotation: rot, largeArc: large != 0, sweep: sweep != 0, to: cur))
            default:
                return out
            }
        }
        return out
    }
}
