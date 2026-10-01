import Foundation

// Port of packages/editor-schema/src/flowchartLayout.ts. "Tidy up": a compact layered (Sugiyama-style)
// layout, top-down or left-to-right.
//
//   1. connected components are laid out separately, side by side;
//   2. cycles are broken by reversing DFS back edges (loops keep their direction when drawn);
//   3. layers come from the longest path from the sources;
//   4. node order within a layer is improved with a few barycenter sweeps (fewer crossings);
//   5. positions: layers stacked with a fixed gap, nodes pulled toward their neighbours' centres
//      without overlapping, everything snapped to the grid.

enum FlowDirection: String, Hashable, Sendable {
    case topDown = "TD"
    case leftRight = "LR"
}

enum FlowchartLayout {
    private struct Item {
        /// Size across the flow (width for TD) and along it (height for TD).
        var cross: Double
        var main: Double
    }

    private static func components(_ ids: [String], _ adj: [String: [String]]) -> [[String]] {
        var seen = Set<String>()
        var out: [[String]] = []
        var order: [String: Int] = [:]
        for (i, id) in ids.enumerated() where order[id] == nil { order[id] = i }
        for id in ids {
            if seen.contains(id) { continue }
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
            out.append(FlowGeometry.stableSorted(comp) { order[$0]! < order[$1]! })
        }
        return out
    }

    /// Lays out one connected component; positions relative to (0, 0) along the cross/main axes.
    private static func layoutComponent(_ ids: [String], _ items: [String: Item], _ edges: [(String, String)], nodeGap: Double, layerGap: Double)
        -> (result: [String: (c: Double, m: Double)], width: Double) {
        let idSet = Set(ids)
        let own = edges.filter { idSet.contains($0.0) && idSet.contains($0.1) && $0.0 != $0.1 }
        var out: [String: [String]] = [:]
        var indeg: [String: Int] = [:]
        for id in ids {
            out[id] = []
            indeg[id] = 0
        }
        for (a, b) in own {
            out[a]!.append(b)
            indeg[b]! += 1
        }

        // Break cycles: DFS from sources (then anything left), reversing edges that point back up the stack.
        var state: [String: Int] = [:]
        var dag: [(String, String)] = []
        var visitOrder: [String] = []
        let starts = ids.filter { indeg[$0] == 0 } + ids
        for s in starts {
            if (state[s] ?? 0) != 0 { continue }
            var stack: [(v: String, i: Int)] = [(s, 0)]
            state[s] = 1
            visitOrder.append(s)
            while !stack.isEmpty {
                let top = stack[stack.count - 1]
                let list = out[top.v]!
                stack[stack.count - 1].i += 1
                guard top.i < list.count else {
                    state[top.v] = 2
                    stack.removeLast()
                    continue
                }
                let next = list[top.i]
                let st = state[next] ?? 0
                if st == 1 {
                    dag.append((next, top.v))
                } else {
                    dag.append((top.v, next))
                    if st == 0 {
                        state[next] = 1
                        visitOrder.append(next)
                        stack.append((next, 0))
                    }
                }
            }
        }

        // Longest-path layering over the DAG (Kahn's order).
        var preds: [String: [String]] = [:], succs: [String: [String]] = [:], deg: [String: Int] = [:]
        for id in ids {
            preds[id] = []
            succs[id] = []
            deg[id] = 0
        }
        for (a, b) in dag {
            succs[a]!.append(b)
            preds[b]!.append(a)
            deg[b]! += 1
        }
        var layerOf: [String: Int] = [:]
        var queue = visitOrder.filter { deg[$0] == 0 }
        for id in queue { layerOf[id] = 0 }
        var head = 0
        while head < queue.count {
            let v = queue[head]
            head += 1
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

        // Crossing reduction: barycenter sweeps down and up.
        var pos: [String: Double] = [:]
        for l in layers { for (i, id) in l.enumerated() { pos[id] = Double(i) } }
        for iter in 0..<8 {
            let down = iter % 2 == 0
            let range: [Int] = down ? Array(layers.indices.dropFirst()) : Array(layers.indices.dropLast().reversed())
            for li in range {
                let ref = down ? preds : succs
                var bary: [String: Double] = [:]
                for id in layers[li] {
                    let ns = ref[id]!.filter { layerOf[$0] == li + (down ? -1 : 1) }
                    bary[id] = ns.isEmpty ? pos[id]! : ns.reduce(0.0) { $0 + pos[$1]! } / Double(ns.count)
                }
                layers[li] = FlowGeometry.stableSorted(layers[li]) { a, b in
                    let d = bary[a]! - bary[b]!
                    if d != 0 { return d < 0 }
                    return pos[a]! < pos[b]!
                }
                for (i, id) in layers[li].enumerated() { pos[id] = Double(i) }
            }
        }

        // Coordinates across the flow: pack, then pull toward neighbours' centres a few times.
        var cross: [String: Double] = [:]
        for layer in layers {
            var c = 0.0
            for id in layer {
                cross[id] = c
                c += items[id]!.cross + nodeGap
            }
        }
        func centerOf(_ id: String) -> Double { cross[id]! + items[id]!.cross / 2 }
        func place(_ layer: [String], _ desired: [String: Double]) {
            // Forward pass keeps the left order, backward pass keeps the right order; average both.
            var fwd = Array(repeating: 0.0, count: layer.count)
            var edge = -Double.infinity
            for (i, id) in layer.enumerated() {
                let w = items[id]!.cross
                fwd[i] = max(desired[id]! - w / 2, edge)
                edge = fwd[i] + w + nodeGap
            }
            var bwd = Array(repeating: 0.0, count: layer.count)
            edge = Double.infinity
            for i in stride(from: layer.count - 1, through: 0, by: -1) {
                let w = items[layer[i]]!.cross
                bwd[i] = min(desired[layer[i]]! - w / 2, edge - w)
                edge = bwd[i] - nodeGap
            }
            edge = -Double.infinity
            for (i, id) in layer.enumerated() {
                let w = items[id]!.cross
                let x = max((fwd[i] + bwd[i]) / 2, edge)
                cross[id] = x
                edge = x + w + nodeGap
            }
        }
        for iter in 0..<6 {
            let down = iter % 2 == 0
            let order = down ? layers : layers.reversed()
            for layer in order {
                var desired: [String: Double] = [:]
                for id in layer {
                    let ns = preds[id]! + succs[id]!
                    desired[id] = ns.isEmpty ? centerOf(id) : ns.reduce(0.0) { $0 + centerOf($1) } / Double(ns.count)
                }
                place(layer, desired)
            }
        }

        // Along the flow: each layer as tall as its tallest node, nodes centred in their band.
        var main: [String: Double] = [:]
        var m = 0.0
        for layer in layers {
            let band = layer.map { items[$0]!.main }.max() ?? -Double.infinity
            for id in layer { main[id] = m + (band - items[id]!.main) / 2 }
            m += band + layerGap
        }
        let minCross = ids.map { cross[$0]! }.min() ?? 0
        let width = (ids.map { cross[$0]! + items[$0]!.cross }.max() ?? 0) - minCross
        var result: [String: (c: Double, m: Double)] = [:]
        for id in ids { result[id] = (cross[id]! - minCross, main[id]!) }
        return (result, width)
    }

    /// The chart with every node repositioned (sizes kept) and every connector on automatic sides.
    static func layout(_ fc: FlowchartData, direction: FlowDirection = .topDown, origin: FlowPoint? = nil, nodeGap: Double? = nil, layerGap: Double? = nil) -> FlowchartData {
        if fc.nodes.isEmpty { return fc }
        let lr = direction == .leftRight
        let nodeGap = nodeGap ?? (lr ? 40 : 56)
        let layerGap = layerGap ?? (lr ? 72 : 64)
        var items: [String: Item] = [:]
        for n in fc.nodes { items[n.id] = Item(cross: lr ? n.h : n.w, main: lr ? n.w : n.h) }
        let ids = fc.nodes.map(\.id)
        let known = Set(ids)
        let edges = fc.edges.filter { known.contains($0.from) && known.contains($0.to) }.map { ($0.from, $0.to) }
        var adj: [String: [String]] = [:]
        for id in ids { adj[id] = [] }
        for (a, b) in edges {
            if !adj[a]!.contains(b) { adj[a]!.append(b) }
            if !adj[b]!.contains(a) { adj[b]!.append(a) }
        }
        // Components side by side across the flow, the biggest first; lone nodes gather at the end.
        let comps = FlowGeometry.stableSorted(components(ids, adj)) { a, b in (a.count > 1 ? 1 : 0) > (b.count > 1 ? 1 : 0) }
        var placed: [String: (c: Double, m: Double)] = [:]
        var offset = 0.0
        for comp in comps {
            let (result, width) = layoutComponent(comp, items, edges, nodeGap: nodeGap, layerGap: layerGap)
            for (id, p) in result { placed[id] = (p.c + offset, p.m) }
            offset += width + nodeGap * 1.75
        }
        let o = origin ?? FlowPoint(x: fc.nodes.map(\.x).min()!, y: fc.nodes.map(\.y).min()!)
        var next = FlowchartData()
        next.nodes = fc.nodes.map { n in
            var n = n
            let p = placed[n.id]!
            n.x = Flowchart.snap(o.x + (lr ? p.m : p.c))
            n.y = Flowchart.snap(o.y + (lr ? p.c : p.m))
            return n
        }
        next.edges = fc.edges.map { e in
            var e = e
            e.fromSide = nil
            e.toSide = nil
            return e
        }
        return next
    }
}
