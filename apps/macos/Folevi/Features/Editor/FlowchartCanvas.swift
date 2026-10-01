import AppKit
import SwiftUI

// The flowchart block's canvas (web: apps/web/src/components/editor/flowchart/FlowchartView.tsx): an
// unbounded, pannable and zoomable surface inside the note. Shapes and connectors are drawn from the shared
// geometry (Domain/FlowchartGeometry.swift), so the canvas, read-only notes and exports match the web.
//
//   Pointer   click select · ⇧/⌘-click add · drag move (snaps to the grid and to other shapes' edges)
//             drag empty space to select an area · space-drag, middle-drag or scroll to pan
//             ⌘-scroll or pinch to zoom · drag a side handle to connect (drop on empty space for a new
//             connected shape) · double-click to write in a shape or on a connector, or to add one
//   Keyboard  Tab through shapes · Return edit · arrows nudge (⇧ more) · ⌫ delete · ⌘D duplicate
//             ⌘A select all · ⌘Z / ⇧⌘Z undo and redo · +/− zoom · ⇧1 fit · Esc back to the note
//
// While the canvas has the keyboard it owns ⌘Z (its own history); outside it the note's Undo reverts whole
// flowchart edits, and the canvas follows. Changes are written to the block's `data` 400 ms after they
// settle (one write per drag, not per pixel).

@MainActor
@Observable
final class FlowchartController {
    struct Viewport: Equatable {
        var x: Double = 0
        var y: Double = 0
        var k: Double = 1
    }

    /// Text being written in a shape or on a connector; `typed` when it started with a keystroke.
    struct Editing: Equatable {
        enum Kind: Equatable { case node, edge }
        var kind: Kind
        var id: String
        var before: FlowchartData
        var typed = false
    }

    struct LinkPreview: Equatable {
        var points: [FlowPoint]
        var target: String?
    }

    enum EdgeEnd: Equatable { case from, to }

    enum Hit: Equatable {
        case port(node: String, side: FlowSide)
        case edgeEnd(edge: String, end: EdgeEnd)
        case resize(node: String, handle: FlowResizeHandle)
        case node(String)
        case edge(String)
        case background
    }

    private enum Drag {
        case pan(start: CGPoint, view: Viewport)
        case move(start: FlowPoint, screen: CGPoint, origin: [String: FlowPoint], before: FlowchartData, box: FlowRect, moved: Bool, clicked: String, toggled: Bool)
        case marquee(start: FlowPoint, base: FlowSelection)
        case resize(start: FlowPoint, orig: FlowNode, handle: FlowResizeHandle, before: FlowchartData)
        case link(from: String, side: FlowSide, screen: CGPoint, reconnect: (edge: String, end: EdgeEnd)?)
    }

    static let minZoom = 0.2
    static let maxZoom = 2.5

    private(set) var doc = FlowchartData() {
        didSet {
            routed = FlowGeometry.routeEdges(doc)
            var map: [String: FlowNode] = [:]
            for n in doc.nodes { map[n.id] = n }
            byId = map
            if let e = editing, e.kind == .node ? map[e.id] == nil : !doc.edges.contains(where: { $0.id == e.id }) {
                // The shape or connector being edited was removed (remote change, undo): stop editing.
                editing = nil
            }
            redraw()
        }
    }
    private(set) var routed: [RoutedEdge] = []
    @ObservationIgnored private(set) var byId: [String: FlowNode] = [:]
    var sel = FlowSelection.none { didSet { redraw() } }
    var view = Viewport() { didSet { redraw() } }
    private(set) var editing: Editing? { didSet { redraw() } }
    var hover: String? { didSet { if hover != oldValue { redraw() } } }
    var hoverEdge: String? { didSet { if hoverEdge != oldValue { redraw() } } }
    var hoverPort: FlowSide? { didSet { if hoverPort != oldValue { redraw() } } }
    private(set) var guides: [FlowGuide] = [] { didSet { redraw() } }
    private(set) var marquee: FlowRect? { didSet { redraw() } }
    private(set) var link: LinkPreview? { didSet { redraw() } }
    private(set) var isDragging = false { didSet { redraw() } }
    private(set) var panning = false { didSet { redraw() } }
    var spaceDown = false
    var active = false
    var aiOpen = false
    private(set) var tooLarge = false
    private(set) var size = CGSize.zero
    private(set) var canUndo = false
    private(set) var canRedo = false

    @ObservationIgnored weak var canvas: FlowchartCanvasView?
    @ObservationIgnored var write: ((String) -> Void)?
    @ObservationIgnored var exitToNote: (() -> Void)?
    @ObservationIgnored private var lastWritten: String?
    @ObservationIgnored private var history = FlowHistory()
    @ObservationIgnored private var saveTask: Task<Void, Never>?
    @ObservationIgnored private var fitted = false
    @ObservationIgnored private var drag: Drag?

    private func redraw() { canvas?.needsDisplay = true; canvas?.syncTextEditor() }

    // MARK: Document

    /// The block's stored data. Outside changes (another device, the note's Undo) replace the local chart
    /// and its history; our own writes coming back are ignored.
    func load(_ data: String) {
        guard data != lastWritten else { return }
        let first = lastWritten == nil
        lastWritten = data
        saveTask?.cancel()
        saveTask = nil
        history.clear()
        doc = Flowchart.parse(data)
        updateUndo()
        if first { fitIfReady() }
    }

    func setSize(_ s: CGSize) {
        guard s != size else { return }
        size = s
        fitIfReady()
    }

    private func fitIfReady() {
        guard !fitted, size.width > 0, lastWritten != nil else { return }
        fitted = true
        fitView()
    }

    /// Writes the chart now (a pending save, or before the block goes away).
    func flush() {
        saveTask?.cancel()
        saveTask = nil
        guard lastWritten != nil else { return }
        let s = Flowchart.serialize(doc)
        if Flowchart.length(s) > Flowchart.maxDataLength {
            tooLarge = true
            return
        }
        tooLarge = false
        if s == lastWritten { return }
        lastWritten = s
        write?(s)
    }

    private func schedule() {
        saveTask?.cancel()
        saveTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }
            self?.flush()
        }
    }

    /// Shows a state without recording it (live dragging); `save` also schedules a write.
    private func setLive(_ next: FlowchartData, save: Bool = false) {
        doc = next
        if save { schedule() }
    }

    /// A finished change: recorded for undo (from `before`, default the current chart) and saved.
    func commit(_ next: FlowchartData, before: FlowchartData? = nil, key: String? = nil) {
        let before = before ?? doc
        guard before != next else { return }
        history.push(before, key: key)
        setLive(next, save: true)
        updateUndo()
    }

    private func updateUndo() {
        canUndo = history.canUndo
        canRedo = history.canRedo
    }

    func undo() {
        if editing != nil { finishEdit(refocus: true) }
        guard let prev = history.undo(doc) else { return }
        setLive(prev, save: true)
        updateUndo()
    }

    func redo() {
        if editing != nil { finishEdit(refocus: true) }
        guard let next = history.redo(doc) else { return }
        setLive(next, save: true)
        updateUndo()
    }

    // MARK: Viewport

    func toWorld(_ p: CGPoint) -> FlowPoint {
        FlowPoint(x: (Double(p.x) - view.x) / view.k, y: (Double(p.y) - view.y) / view.k)
    }

    func toScreen(_ p: FlowPoint) -> CGPoint {
        CGPoint(x: p.x * view.k + view.x, y: p.y * view.k + view.y)
    }

    func fitView(_ fc: FlowchartData? = nil) {
        let fc = fc ?? doc
        let w = Double(size.width), h = Double(size.height)
        guard w > 0 else { return }
        let top = 52.0 // room for the toolbar
        guard let b = FlowGeometry.bounds(fc) else {
            view = Viewport(x: w / 2, y: (h + top) / 2, k: 1)
            return
        }
        let pad = 40.0
        let k = Flowchart.clamp(min((w - pad * 2) / max(1, b.w), (h - top - pad * 1.5) / max(1, b.h), 1), Self.minZoom, Self.maxZoom)
        view = Viewport(x: w / 2 - (b.x + b.w / 2) * k, y: top + (h - top) / 2 - (b.y + b.h / 2) * k, k: k)
    }

    func zoomAt(_ k: Double, _ sx: Double, _ sy: Double) {
        let v = view
        let nk = Flowchart.clamp(k, Self.minZoom, Self.maxZoom)
        let wx = (sx - v.x) / v.k, wy = (sy - v.y) / v.k
        view = Viewport(x: sx - wx * nk, y: sy - wy * nk, k: nk)
    }

    func zoomBy(_ f: Double) { zoomAt(view.k * f, Double(size.width) / 2, Double(size.height) / 2) }

    private var viewCenter: FlowPoint {
        FlowPoint(x: (Double(size.width) / 2 - view.x) / view.k, y: (Double(size.height) / 2 + 20 - view.y) / view.k)
    }

    // MARK: Derived

    var selNodes: [FlowNode] { sel.nodes.compactMap { byId[$0] } }
    var selEdges: [FlowEdge] { sel.edges.compactMap { id in doc.edges.first { $0.id == id } } }

    /// The one selected shape, when exactly one shape (and no connector) is selected and not being edited.
    var single: FlowNode? {
        let nodes = selNodes
        return nodes.count == 1 && selEdges.isEmpty && editing == nil ? nodes[0] : nil
    }

    /// The hovered shape's handles, else the selected one's, so a connection can start from any shape.
    var portNode: FlowNode? {
        if link != nil || isDragging { return nil }
        if let hover, editing == nil, let n = byId[hover] { return n }
        return single
    }

    var selectedEdge: RoutedEdge? {
        guard sel.edges.count == 1, sel.nodes.isEmpty, editing == nil else { return nil }
        return routed.first { $0.edge.id == sel.edges[0] }
    }

    /// The selection's bounds in world coordinates (shapes and the points of selected connectors).
    var selectionBox: FlowRect? {
        var rects = selNodes.map(\.rect)
        for e in selEdges {
            if let r = routed.first(where: { $0.edge.id == e.id }), let b = FlowOps.boxOf(r.points.map { FlowRect(x: $0.x, y: $0.y, w: 0, h: 0) }) {
                rects.append(b)
            }
        }
        return FlowOps.boxOf(rects)
    }

    var showsSelectionBar: Bool { selectionBox != nil && !isDragging && editing == nil && !sel.isEmpty }

    static func portOffset(_ side: FlowSide, _ off: Double) -> FlowPoint {
        switch side {
        case .top: return FlowPoint(x: 0, y: -off)
        case .right: return FlowPoint(x: off, y: 0)
        case .bottom: return FlowPoint(x: 0, y: off)
        case .left: return FlowPoint(x: -off, y: 0)
        }
    }

    static func handlePoint(_ n: FlowNode, _ h: FlowResizeHandle) -> FlowPoint {
        FlowPoint(x: h.west ? n.x : h.east ? n.x + n.w : n.x + n.w / 2, y: h.north ? n.y : h.south ? n.y + n.h : n.y + n.h / 2)
    }

    // MARK: Hit testing

    func hitTest(_ p: FlowPoint) -> Hit {
        let k = view.k
        if let n = portNode {
            for side in FlowSide.allCases {
                let pp = FlowGeometry.portPoint(n, side)
                let o = Self.portOffset(side, 14 / k)
                if Flowchart.hypot(p.x - (pp.x + o.x), p.y - (pp.y + o.y)) <= 12 / k { return .port(node: n.id, side: side) }
            }
        }
        if let r = selectedEdge, let first = r.points.first, let last = r.points.last {
            if Flowchart.hypot(p.x - last.x, p.y - last.y) <= 8 / k { return .edgeEnd(edge: r.edge.id, end: .to) }
            if Flowchart.hypot(p.x - first.x, p.y - first.y) <= 8 / k { return .edgeEnd(edge: r.edge.id, end: .from) }
        }
        if let n = single {
            for h in FlowResizeHandle.allCases {
                let hp = Self.handlePoint(n, h)
                if abs(p.x - hp.x) <= 6 / k && abs(p.y - hp.y) <= 6 / k { return .resize(node: n.id, handle: h) }
            }
        }
        for r in routed.reversed() {
            if let l = r.label, p.x >= l.x && p.x <= l.x + l.w && p.y >= l.y && p.y <= l.y + l.h { return .edge(r.edge.id) }
        }
        if let n = FlowOps.nodeAt(doc, p) { return .node(n.id) }
        for r in routed.reversed() where Self.distance(p, to: r.points) <= 7 { return .edge(r.edge.id) }
        return .background
    }

    private static func distance(_ p: FlowPoint, to pts: [FlowPoint]) -> Double {
        var best = Double.infinity
        for i in pts.indices.dropFirst() {
            let a = pts[i - 1], b = pts[i]
            let dx = b.x - a.x, dy = b.y - a.y
            let len2 = dx * dx + dy * dy
            let t = len2 == 0 ? 0 : Flowchart.clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1)
            best = min(best, Flowchart.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)))
        }
        return best
    }

    // MARK: Pointer input

    func pointerMoved(_ screen: CGPoint) {
        guard drag == nil else { return }
        let p = toWorld(screen)
        hover = FlowOps.nodeAt(doc, p, pad: 26 / view.k)?.id
        switch hitTest(p) {
        case .port(_, let side):
            hoverPort = side
            hoverEdge = nil
        case .edge(let id):
            hoverPort = nil
            hoverEdge = id
        default:
            hoverPort = nil
            hoverEdge = nil
        }
    }

    func pointerExited() {
        guard drag == nil else { return }
        hover = nil
        hoverEdge = nil
        hoverPort = nil
    }

    func mouseDown(_ screen: CGPoint, shift: Bool, command: Bool, middle: Bool, clickCount: Int) {
        if editing != nil { finishEdit(refocus: false) }
        let p = toWorld(screen)
        if middle || spaceDown {
            drag = .pan(start: screen, view: view)
            panning = true
            isDragging = true
            return
        }
        let hit = hitTest(p)
        if clickCount == 2 {
            switch hit {
            case .node(let id): startEdit(.node, id); return
            case .edge(let id): startEdit(.edge, id); return
            case .background: add(.process, at: p); return
            default: break
            }
        }
        switch hit {
        case .port(let node, let side):
            drag = .link(from: node, side: side, screen: screen, reconnect: nil)
        case .edgeEnd(let edgeId, let end):
            guard let edge = doc.edges.first(where: { $0.id == edgeId }) else { return }
            let fixed = end == .to ? edge.from : edge.to
            let r = routed.first { $0.edge.id == edgeId }
            let side = (end == .to ? r?.fromSide : r?.toSide) ?? .bottom
            drag = .link(from: fixed, side: side, screen: screen, reconnect: (edgeId, end))
        case .resize(let id, let handle):
            guard let n = byId[id] else { return }
            drag = .resize(start: p, orig: n, handle: handle, before: doc)
        case .node(let id):
            var nodes = sel.nodes
            var toggled = false
            if shift || command {
                toggled = true
                nodes = sel.nodes.contains(id) ? sel.nodes.filter { $0 != id } : sel.nodes + [id]
                sel = FlowSelection(nodes: nodes, edges: sel.edges)
            } else if !sel.nodes.contains(id) {
                nodes = [id]
                sel = FlowSelection(nodes: nodes, edges: [])
            }
            let moving = doc.nodes.filter { nodes.contains($0.id) }
            guard let box = FlowOps.boxOf(moving.map(\.rect)) else { return }
            var origin: [String: FlowPoint] = [:]
            for n in moving { origin[n.id] = FlowPoint(x: n.x, y: n.y) }
            drag = .move(start: p, screen: screen, origin: origin, before: doc, box: box, moved: false, clicked: id, toggled: toggled)
        case .edge(let id):
            if shift || command {
                sel = FlowSelection(nodes: sel.nodes, edges: sel.edges.contains(id) ? sel.edges.filter { $0 != id } : sel.edges + [id])
            } else {
                sel = FlowSelection(nodes: [], edges: [id])
            }
            return
        case .background:
            // Empty canvas: select an area (adding to the selection with ⇧ or ⌘).
            let base = shift || command ? sel : .none
            if !(shift || command) { sel = .none }
            drag = .marquee(start: p, base: base)
        }
        isDragging = true
    }

    func mouseDragged(_ screen: CGPoint, option: Bool, shift: Bool) {
        guard let d = drag else { return }
        let p = toWorld(screen)
        let k = view.k
        switch d {
        case .pan(let start, let v):
            view = Viewport(x: v.x + Double(screen.x - start.x), y: v.y + Double(screen.y - start.y), k: v.k)
        case .move(let start, let s, let origin, let before, let box, let moved, let clicked, let toggled):
            if !moved && hypot(screen.x - s.x, screen.y - s.y) < 3 { return }
            if !moved { drag = .move(start: start, screen: s, origin: origin, before: before, box: box, moved: true, clicked: clicked, toggled: toggled) }
            let dx = p.x - start.x, dy = p.y - start.y
            let moving = FlowRect(x: box.x + dx, y: box.y + dy, w: box.w, h: box.h)
            // Only nearby shapes offer alignment (keeps big charts fast and guides relevant).
            let reach = FlowRect(x: moving.x - 600, y: moving.y - 600, w: moving.w + 1200, h: moving.h + 1200)
            let others = before.nodes.filter { origin[$0.id] == nil && FlowGeometry.rectsOverlap($0.rect, reach) }.map(\.rect)
            let s = option ? (dx: 0.0, dy: 0.0, guides: [FlowGuide]()) : FlowOps.snapGroup(moving, others: others, threshold: 6 / k)
            setLive(FlowOps.moveNodes(before, origin: origin, dx: dx + s.dx, dy: dy + s.dy))
            guides = s.guides
        case .marquee(let start, let base):
            let r = FlowRect(x: min(start.x, p.x), y: min(start.y, p.y), w: abs(p.x - start.x), h: abs(p.y - start.y))
            marquee = r
            let hits = doc.nodes.filter { FlowGeometry.rectsOverlap($0.rect, r) }.map(\.id)
            var nodes = base.nodes
            for id in hits where !nodes.contains(id) { nodes.append(id) }
            sel = FlowSelection(nodes: nodes, edges: base.edges)
        case .resize(let start, let orig, let handle, let before):
            let next = FlowOps.resizeNode(orig, handle: handle, dx: p.x - start.x, dy: p.y - start.y, keepRatio: shift)
            setLive(FlowOps.updateNodes(before, [orig.id]) { _ in next })
        case .link(let from, let side, _, _):
            guard let src = byId[from] else { return }
            let target = FlowOps.nodeAt(doc, p, pad: 8)
            let start = FlowGeometry.portPoint(src, side)
            if let tgt = target, tgt.id != from {
                let s = FlowGeometry.nearestSide(tgt.rect, p)
                link = LinkPreview(points: FlowGeometry.orthogonalRoute(start, side, FlowGeometry.portPoint(tgt, s), s, src.rect, tgt.rect), target: tgt.id)
            } else {
                let probe = FlowRect(x: p.x, y: p.y, w: 0, h: 0)
                let s = FlowGeometry.autoSides(src.rect, probe).1
                link = LinkPreview(points: FlowGeometry.orthogonalRoute(start, side, p, s, src.rect, probe), target: nil)
            }
        }
    }

    func mouseUp(_ screen: CGPoint) {
        guard let d = drag else { return }
        drag = nil
        isDragging = false
        panning = false
        guides = []
        marquee = nil
        switch d {
        case .move(_, _, _, let before, _, let moved, let clicked, let toggled):
            if moved { commit(doc, before: before) } else if !toggled && sel.nodes.count > 1 { sel = FlowSelection(nodes: [clicked], edges: []) }
        case .resize(_, _, _, let before):
            if doc != before { commit(doc, before: before) }
        case .link(let from, let side, let start, let reconnect):
            link = nil
            finishLink(from: from, side: side, start: start, reconnect: reconnect, screen: screen)
        default:
            break
        }
    }

    private func finishLink(from: String, side: FlowSide, start: CGPoint, reconnect: (edge: String, end: EdgeEnd)?, screen: CGPoint) {
        let fc = doc
        let p = toWorld(screen)
        guard let src = byId[from] else { return }
        let hit = FlowOps.nodeAt(fc, p, pad: 8)
        // Dropped back on the shape it started from: nothing to connect.
        if let hit, hit.id == from, reconnect == nil { return }
        let target = hit.flatMap { $0.id != from ? $0 : nil }
        if let reconnect {
            guard let target else { return }
            let s = FlowGeometry.nearestSide(target.rect, p)
            commit(FlowOps.updateEdges(fc, [reconnect.edge]) { e in
                var e = e
                if reconnect.end == .to {
                    e.to = target.id
                    e.toSide = s
                } else {
                    e.from = target.id
                    e.fromSide = s
                }
                return e
            })
            return
        }
        if let target {
            if let res = FlowOps.connect(fc, from: from, to: target.id, fromSide: side, toSide: FlowGeometry.nearestSide(target.rect, p)), res.doc != fc {
                commit(res.doc)
                sel = FlowSelection(nodes: [], edges: [res.id])
            }
            return
        }
        // Dropped on empty space: a new shape there, connected (unless it was just a click on the handle).
        if hypot(screen.x - start.x, screen.y - start.y) < 12 { return }
        let shape: FlowShape = src.shape == .decision || src.shape == .terminator || src.shape == .text ? .process : src.shape
        let inSide = side.opposite
        let size: (w: Double, h: Double) = (src.shape == shape ? src.w : 160, src.shape == shape ? src.h : 64)
        let offset: FlowPoint
        switch inSide {
        case .top: offset = FlowPoint(x: 0, y: size.h / 2)
        case .bottom: offset = FlowPoint(x: 0, y: -size.h / 2)
        case .left: offset = FlowPoint(x: size.w / 2, y: 0)
        case .right: offset = FlowPoint(x: -size.w / 2, y: 0)
        }
        guard let added = FlowOps.addNode(fc, shape: shape, at: FlowPoint(x: p.x + offset.x, y: p.y + offset.y), size: size, color: src.color),
              let res = FlowOps.connect(added.doc, from: from, to: added.id, fromSide: side, toSide: inSide) else { return }
        commit(res.doc, before: fc)
        editing = Editing(kind: .node, id: added.id, before: res.doc)
        sel = FlowSelection(nodes: [added.id], edges: [])
    }

    func magnify(by factor: Double, at screen: CGPoint) {
        zoomAt(view.k * (1 + factor), Double(screen.x), Double(screen.y))
    }

    func scroll(dx: Double, dy: Double) {
        view = Viewport(x: view.x + dx, y: view.y + dy, k: view.k)
    }

    // MARK: Edits

    func add(_ shape: FlowShape, at: FlowPoint? = nil, edit: Bool = true) {
        guard let res = FlowOps.addNode(doc, shape: shape, at: at ?? viewCenter) else { return }
        commit(res.doc)
        sel = FlowSelection(nodes: [res.id], edges: [])
        if edit { editing = Editing(kind: .node, id: res.id, before: res.doc) }
        canvas?.focus()
    }

    func removeSelection() {
        guard !sel.isEmpty else { return }
        commit(FlowOps.deleteSelection(doc, sel))
        sel = .none
    }

    func duplicateSelection() {
        guard !sel.nodes.isEmpty else { return }
        let res = FlowOps.duplicate(doc, sel.nodes)
        commit(res.doc)
        sel = FlowSelection(nodes: res.ids, edges: [])
    }

    func selectAll() {
        sel = FlowSelection(nodes: doc.nodes.map(\.id), edges: doc.edges.map(\.id))
    }

    func setColor(_ c: FlowColor) { commit(FlowOps.setColor(doc, sel.nodes, c)) }
    func setShape(_ s: FlowShape) { commit(FlowOps.setShape(doc, sel.nodes, s)) }

    func setEdgeStyle(_ s: FlowEdgeStyle) {
        commit(FlowOps.updateEdges(doc, sel.edges) { e in
            var e = e
            e.style = s
            return e
        })
    }

    func setArrow(_ a: FlowArrow) {
        commit(FlowOps.updateEdges(doc, sel.edges) { e in
            var e = e
            e.arrow = a
            return e
        })
    }

    func tidy() {
        guard let box = FlowOps.boxOf(doc.nodes.map(\.rect)) else { return }
        let next = FlowchartLayout.layout(doc, direction: FlowchartExport.direction(doc), origin: FlowPoint(x: Flowchart.snap(box.x), y: Flowchart.snap(box.y)))
        commit(next)
        fitView(next)
    }

    func applyDraft(_ draft: JSONValue, update: Bool) {
        let next = FlowOps.chartFromDraft(draft, current: doc, update: update)
        commit(next)
        sel = .none
        aiOpen = false
        fitView(next)
        canvas?.focus()
    }

    func nudge(_ dx: Double, _ dy: Double) {
        if sel.nodes.isEmpty {
            view = Viewport(x: view.x - dx * 5, y: view.y - dy * 5, k: view.k)
            return
        }
        var origin: [String: FlowPoint] = [:]
        for n in doc.nodes where sel.nodes.contains(n.id) { origin[n.id] = FlowPoint(x: n.x, y: n.y) }
        commit(FlowOps.moveNodes(doc, origin: origin, dx: dx, dy: dy), key: "nudge")
    }

    /// Tab and ⇧Tab move the selection through the shapes.
    func selectNext(backward: Bool) {
        guard !doc.nodes.isEmpty else { return }
        let ids = doc.nodes.map(\.id)
        let current = sel.nodes.last.flatMap { ids.firstIndex(of: $0) }
        let next: Int
        if let current { next = (current + (backward ? -1 : 1) + ids.count) % ids.count } else { next = backward ? ids.count - 1 : 0 }
        sel = FlowSelection(nodes: [ids[next]], edges: [])
    }

    // MARK: Text

    func startEdit(_ kind: Editing.Kind, _ id: String, replaceWith: String? = nil) {
        let before = doc
        if let replaceWith, kind == .node {
            setLive(FlowOps.updateNodes(before, [id]) { n in
                var n = n
                n.text = replaceWith
                return Flowchart.fitToText(n)
            })
        }
        editing = Editing(kind: kind, id: id, before: before, typed: replaceWith != nil)
        sel = kind == .node ? FlowSelection(nodes: [id], edges: []) : FlowSelection(nodes: [], edges: [id])
    }

    func editText(_ value: String) {
        guard let ed = editing else { return }
        if ed.kind == .node {
            setLive(FlowOps.updateNodes(doc, [ed.id]) { n in
                var n = n
                n.text = Flowchart.prefix(value, Flowchart.maxText)
                return Flowchart.fitToText(n)
            })
        } else {
            setLive(FlowOps.updateEdges(doc, [ed.id]) { e in
                var e = e
                e.label = Flowchart.prefix(Flowchart.collapseNewlines(value), Flowchart.maxLabel)
                return e
            })
        }
    }

    /// Ends text editing (recorded as one change); `refocus` returns the keyboard to the canvas.
    func finishEdit(refocus: Bool) {
        guard let ed = editing else { return }
        editing = nil
        if doc != ed.before { commit(doc, before: ed.before) }
        if refocus { canvas?.focus() }
    }

    // MARK: Keyboard

    /// Handles a key press while the canvas has the keyboard; false lets it through.
    func key(_ event: NSEvent) -> Bool {
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        let mod = flags.contains(.command) || flags.contains(.control)
        let shift = flags.contains(.shift)
        let chars = event.charactersIgnoringModifiers ?? ""
        let key = chars.lowercased()
        if event.keyCode == 49, !mod { // space
            spaceDown = true
            canvas?.updateCursor()
            return true
        }
        if mod {
            switch key {
            case "z": shift ? redo() : undo(); return true
            case "y": redo(); return true
            case "d": duplicateSelection(); return true
            case "a": selectAll(); return true
            default: return false
            }
        }
        switch event.keyCode {
        case 51, 117: removeSelection(); return true // delete, forward delete
        case 53: // escape
            if aiOpen { aiOpen = false } else if !sel.isEmpty { sel = .none } else { exitToNote?() }
            return true
        case 123: nudge(shift ? -32 : -8, 0); return true
        case 124: nudge(shift ? 32 : 8, 0); return true
        case 126: nudge(0, shift ? -32 : -8); return true
        case 125: nudge(0, shift ? 32 : 8); return true
        case 36, 76: // return, enter
            if sel.nodes.count == 1 && sel.edges.isEmpty { startEdit(.node, sel.nodes[0]) } else if sel.edges.count == 1 && sel.nodes.isEmpty { startEdit(.edge, sel.edges[0]) }
            return true
        case 48: selectNext(backward: shift); return true // tab
        default: break
        }
        let typed = event.characters ?? ""
        if typed == "+" || typed == "=" { zoomBy(1.2); return true }
        if typed == "-" || typed == "_" { zoomBy(1 / 1.2); return true }
        if typed == "!" && shift { fitView(); return true }
        // Typing on a selected shape replaces its text.
        if typed.count == 1, !flags.contains(.option), sel.nodes.count == 1, sel.edges.isEmpty,
           let scalar = typed.unicodeScalars.first, scalar.value >= 0x20, scalar.value != 0x7F, !(0xF700...0xF8FF).contains(scalar.value) {
            startEdit(.node, sel.nodes[0], replaceWith: typed)
            return true
        }
        return false
    }

    func keyUp(_ event: NSEvent) {
        if event.keyCode == 49 {
            spaceDown = false
            canvas?.updateCursor()
        }
    }

    func resignedKeyboard() {
        spaceDown = false
        hover = nil
    }
}

// MARK: - Colours

/// The canvas's colours for the current appearance (web flowchart.css): shapes mix their tint into the
/// page colour, so a chart sits well on any note style, light or dark; `accent` follows the note's accent.
struct FlowchartPalette {
    var surface: NSColor
    var surfaceRaised: NSColor
    var ink: NSColor
    var accent: NSColor
    var dark: Bool

    var select: NSColor { dark ? .flowHex(0x7AA2FF) : .flowHex(0x3D6EE8) }
    var edge: NSColor { ink.flowMix(surface, 0.5) }
    var edgeHover: NSColor { ink.flowMix(surface, 0.7) }
    var nodeLine: NSColor { ink.flowMix(surface, 0.22) }
    var dot: NSColor { ink.withAlphaComponent(0.16) }
    var labelInk: NSColor { ink.flowMix(surface, 0.78) }
    var guide: NSColor { .flowHex(0xE5484D) }

    func tint(_ c: FlowColor) -> NSColor? {
        switch c {
        case .neutral: return nil
        case .accent: return accent
        case .blue: return dark ? .flowHex(0x6EA8FE) : .flowHex(0x3B82F6)
        case .green: return dark ? .flowHex(0x4CC38A) : .flowHex(0x22A05A)
        case .yellow: return dark ? .flowHex(0xF0C24B) : .flowHex(0xE0A800)
        case .pink: return dark ? .flowHex(0xF07AA5) : .flowHex(0xE05A8A)
        case .purple: return dark ? .flowHex(0xA78BFA) : .flowHex(0x8B5CF6)
        }
    }

    /// (fill, line, ink, tint) for a node; a neutral sticky note is yellow, like paper ones.
    func colors(_ n: FlowNode) -> (fill: NSColor, line: NSColor, ink: NSColor, tint: NSColor?) {
        let t = tint(n.shape == .note && n.color == .neutral ? .yellow : n.color)
        guard let t else { return (surfaceRaised, nodeLine, ink, nil) }
        return (t.flowMix(surface, 0.13), t.flowMix(surface, 0.48), t.flowMix(ink, 0.32), t)
    }

    /// Resolves the SwiftUI colours for an appearance.
    static func resolve(surface: Color, ink: Color, accent: Color, appearance: NSAppearance) -> FlowchartPalette {
        var out: FlowchartPalette!
        appearance.performAsCurrentDrawingAppearance {
            let s = NSColor(surface).flowSRGB
            out = FlowchartPalette(surface: s, surfaceRaised: NSColor(FoleviColor.surfaceRaised).flowSRGB, ink: NSColor(ink).flowSRGB,
                                   accent: NSColor(accent).flowSRGB, dark: s.flowLuminance < 0.5)
        }
        return out
    }
}

extension NSColor {
    static func flowHex(_ v: Int) -> NSColor {
        NSColor(srgbRed: CGFloat((v >> 16) & 0xFF) / 255, green: CGFloat((v >> 8) & 0xFF) / 255, blue: CGFloat(v & 0xFF) / 255, alpha: 1)
    }

    var flowSRGB: NSColor { usingColorSpace(.sRGB) ?? self }

    var flowLuminance: Double {
        let c = flowSRGB
        return 0.2126 * Double(c.redComponent) + 0.7152 * Double(c.greenComponent) + 0.0722 * Double(c.blueComponent)
    }

    /// `color-mix(in srgb, self t, other)`.
    func flowMix(_ other: NSColor, _ t: CGFloat) -> NSColor {
        let a = flowSRGB, b = other.flowSRGB
        return NSColor(srgbRed: a.redComponent * t + b.redComponent * (1 - t), green: a.greenComponent * t + b.greenComponent * (1 - t),
                       blue: a.blueComponent * t + b.blueComponent * (1 - t), alpha: a.alphaComponent * t + b.alphaComponent * (1 - t))
    }
}

// MARK: - Drawing

/// Parsed outlines by path string, so drawing a frame doesn't re-parse every shape (cleared when large).
final class FlowPathCache {
    private var paths: [String: CGPath] = [:]

    func path(_ d: String) -> CGPath {
        if let p = paths[d] { return p }
        if paths.count > 4000 { paths.removeAll(keepingCapacity: true) }
        let p = FlowchartDrawing.path(d)
        paths[d] = p
        return p
    }
}

enum FlowchartDrawing {
    static func cg(_ p: FlowPoint) -> CGPoint { CGPoint(x: p.x, y: p.y) }

    /// A CGPath for one of the geometry's SVG paths.
    static func path(_ d: String) -> CGPath {
        let path = CGMutablePath()
        var cur = CGPoint.zero
        var start = CGPoint.zero
        for c in FlowPath.parse(d) {
            switch c {
            case .move(let p):
                cur = cg(p)
                start = cur
                path.move(to: cur)
            case .line(let p):
                cur = cg(p)
                path.addLine(to: cur)
            case .quad(let control, let to):
                cur = cg(to)
                path.addQuadCurve(to: cur, control: cg(control))
            case .arc(let rx, let ry, _, let large, let sweep, let to):
                addArc(path, from: cur, to: cg(to), rx: rx, ry: ry, large: large, sweep: sweep)
                cur = cg(to)
            case .close:
                path.closeSubpath()
                cur = start
            }
        }
        return path
    }

    /// An SVG endpoint arc (no rotation) as a centre arc.
    private static func addArc(_ path: CGMutablePath, from p0: CGPoint, to p1: CGPoint, rx: Double, ry: Double, large: Bool, sweep: Bool) {
        if p0 == p1 { return }
        var rx = abs(rx), ry = abs(ry)
        if rx == 0 || ry == 0 {
            path.addLine(to: p1)
            return
        }
        let dx2 = Double(p0.x - p1.x) / 2, dy2 = Double(p0.y - p1.y) / 2
        let lambda = (dx2 * dx2) / (rx * rx) + (dy2 * dy2) / (ry * ry)
        if lambda > 1 {
            rx *= lambda.squareRoot()
            ry *= lambda.squareRoot()
        }
        let num = rx * rx * ry * ry - rx * rx * dy2 * dy2 - ry * ry * dx2 * dx2
        let den = rx * rx * dy2 * dy2 + ry * ry * dx2 * dx2
        var coef = den == 0 ? 0 : max(0, num / den).squareRoot()
        if large == sweep { coef = -coef }
        let cx = coef * (rx * dy2 / ry) + Double(p0.x + p1.x) / 2
        let cy = coef * (-ry * dx2 / rx) + Double(p0.y + p1.y) / 2
        let t1 = atan2((Double(p0.y) - cy) / ry, (Double(p0.x) - cx) / rx)
        let t2 = atan2((Double(p1.y) - cy) / ry, (Double(p1.x) - cx) / rx)
        var dt = t2 - t1
        if sweep && dt < 0 { dt += 2 * .pi } else if !sweep && dt > 0 { dt -= 2 * .pi }
        let transform = CGAffineTransform(translationX: cx, y: cy).scaledBy(x: rx, y: ry)
        path.addArc(center: .zero, radius: 1, startAngle: t1, endAngle: t1 + dt, clockwise: dt < 0, transform: transform)
    }

    static func polyline(_ pts: [FlowPoint]) -> CGPath { path(FlowGeometry.roundedPolyline(pts)) }

    static func nodeFont(_ n: FlowNode) -> NSFont {
        FoleviFont.nsFont(.sans, size: Flowchart.fontSize, weight: n.shape == .text ? FoleviFont.Face.regular : FoleviFont.Face.medium)
    }

    static var labelFont: NSFont { FoleviFont.nsFont(.sans, size: Flowchart.labelFontSize, weight: FoleviFont.Face.medium) }

    /// Draws a line of text centred on `cx` with its baseline at `baseline` (flipped coordinates).
    static func text(_ s: String, cx: Double, baseline: Double, font: NSFont, color: NSColor, tracking: Double = -0.005) {
        let str = NSAttributedString(string: s, attributes: [.font: font, .foregroundColor: color, .kern: tracking * Double(font.pointSize)])
        let w = str.size().width
        str.draw(at: CGPoint(x: cx - Double(w) / 2, y: baseline - Double(font.ascender)))
    }

    /// The chart in world coordinates (shapes, connectors and labels), into the current context.
    static func drawChart(_ ctx: CGContext, doc: FlowchartData, routed: [RoutedEdge], palette pal: FlowchartPalette, k: Double, cache: FlowPathCache,
                          selectedEdges: Set<String> = [], hoverEdge: String? = nil, hiddenText: String? = nil, hiddenLabel: String? = nil, shadows: Bool = true) {
        // Connectors under the shapes.
        for r in routed {
            let selected = selectedEdges.contains(r.edge.id)
            let color = selected ? pal.select : r.edge.id == hoverEdge ? pal.edgeHover : pal.edge
            ctx.saveGState()
            ctx.addPath(cache.path(r.d))
            ctx.setStrokeColor(color.cgColor)
            ctx.setLineWidth(selected ? 2 : 1.5)
            ctx.setLineCap(.round)
            ctx.setLineJoin(.round)
            if r.edge.style == .dashed { ctx.setLineDash(phase: 0, lengths: [6, 5]) }
            ctx.strokePath()
            ctx.restoreGState()
            for h in r.heads {
                ctx.saveGState()
                ctx.addPath(cache.path(h))
                ctx.setFillColor(color.cgColor)
                ctx.setStrokeColor(color.cgColor)
                ctx.setLineWidth(1)
                ctx.setLineJoin(.round)
                ctx.drawPath(using: .fillStroke)
                ctx.restoreGState()
            }
        }
        for n in doc.nodes {
            let c = pal.colors(n)
            let outline = cache.path(FlowGeometry.shapePath(n))
            if n.shape != .text {
                ctx.saveGState()
                if shadows {
                    ctx.setShadow(offset: CGSize(width: 0, height: -2 * k), blur: 5 * k, color: NSColor.black.withAlphaComponent(n.shape == .note ? 0.08 : 0.05).cgColor)
                }
                ctx.addPath(outline)
                ctx.setFillColor(c.fill.cgColor)
                ctx.fillPath()
                ctx.restoreGState()
                ctx.saveGState()
                ctx.addPath(outline)
                if n.shape == .note {
                    ctx.setStrokeColor((c.tint ?? pal.nodeLine).withAlphaComponent(0.22).cgColor)
                    ctx.setLineWidth(1)
                } else {
                    ctx.setStrokeColor(c.line.cgColor)
                    ctx.setLineWidth(1.5)
                }
                ctx.strokePath()
                ctx.restoreGState()
            }
            if n.shape == .note {
                ctx.saveGState()
                ctx.move(to: CGPoint(x: n.x + n.w - 14, y: n.y + n.h))
                ctx.addLine(to: CGPoint(x: n.x + n.w, y: n.y + n.h - 14))
                ctx.setStrokeColor((c.tint ?? pal.nodeLine).withAlphaComponent(0.4).cgColor)
                ctx.setLineWidth(1)
                ctx.strokePath()
                ctx.restoreGState()
            }
            if n.id != hiddenText {
                let t = FlowchartExport.nodeTextLayout(n)
                let font = nodeFont(n)
                for (i, line) in t.lines.enumerated() {
                    text(line, cx: t.x, baseline: Flowchart.jsRound((t.y + Double(i) * Flowchart.lineHeight) * 10) / 10, font: font, color: c.ink)
                }
            }
        }
        // Labels above the shapes.
        for r in routed {
            guard let l = r.label, r.edge.id != hiddenLabel else { continue }
            let rect = CGRect(x: l.x, y: l.y, width: l.w, height: l.h)
            let box = CGPath(roundedRect: rect, cornerWidth: 6, cornerHeight: 6, transform: nil)
            ctx.saveGState()
            ctx.addPath(box)
            ctx.setFillColor(pal.surface.cgColor)
            ctx.fillPath()
            ctx.addPath(box)
            ctx.setStrokeColor((selectedEdges.contains(r.edge.id) ? pal.select : pal.ink.withAlphaComponent(0.1)).cgColor)
            ctx.setLineWidth(1)
            ctx.strokePath()
            ctx.restoreGState()
            text(r.edge.label, cx: l.cx, baseline: l.cy + Flowchart.labelFontSize * 0.35, font: labelFont, color: pal.labelInk, tracking: 0)
        }
    }
}

// MARK: - The AppKit view

final class FlowchartCanvasView: NSView {
    var controller: FlowchartController? {
        didSet {
            oldValue?.canvas = nil
            controller?.canvas = self
            needsDisplay = true
        }
    }
    var surface: Color = FoleviColor.surface { didSet { needsDisplay = true } }
    var ink: Color = FoleviColor.ink { didSet { needsDisplay = true } }
    var accent: Color = FoleviColor.ember { didSet { needsDisplay = true } }
    /// Read-only notes: a static picture that fits its content, no interaction.
    var readOnly = false { didSet { needsDisplay = true } }
    var staticData: FlowchartData? { didSet { staticRouted = staticData.map(FlowGeometry.routeEdges) ?? []; needsDisplay = true } }
    private var staticRouted: [RoutedEdge] = []
    private let paths = FlowPathCache()
    private var textEditor: FlowchartTextEditor?

    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { !readOnly }
    override var mouseDownCanMoveWindow: Bool { false }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func hitTest(_ point: NSPoint) -> NSView? {
        readOnly ? nil : super.hitTest(point)
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        trackingAreas.forEach(removeTrackingArea)
        guard !readOnly else { return }
        addTrackingArea(NSTrackingArea(rect: .zero, options: [.mouseMoved, .mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect], owner: self, userInfo: nil))
    }

    override func setFrameSize(_ newSize: NSSize) {
        super.setFrameSize(newSize)
        controller?.setSize(newSize)
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        controller?.setSize(bounds.size)
    }

    func focus() {
        guard let window, !readOnly else { return }
        if window.firstResponder !== self, !(window.firstResponder is FlowchartTextEditor) || textEditor == nil {
            window.makeFirstResponder(self)
        }
    }

    // MARK: Accessibility

    override func isAccessibilityElement() -> Bool { true }
    override func accessibilityRole() -> NSAccessibility.Role? { .group }
    override func accessibilityLabel() -> String? {
        let count = readOnly ? staticData?.nodes.count ?? 0 : controller?.doc.nodes.count ?? 0
        let names = (readOnly ? staticData?.nodes : controller?.doc.nodes)?.prefix(12).map(\.text).filter { !$0.isEmpty }.joined(separator: ", ") ?? ""
        return String(localized: "Flowchart, \(count) shapes") + (names.isEmpty ? "" : ": \(names)")
    }
    override func accessibilityHelp() -> String? {
        readOnly ? nil : String(localized: "Tab moves between shapes. Return edits the selected shape, arrow keys move it, Delete removes it, Command D duplicates. Command Z undoes. Escape returns to the note.")
    }

    // MARK: Drawing

    override func draw(_ dirtyRect: NSRect) {
        guard let ctx = NSGraphicsContext.current?.cgContext else { return }
        let pal = FlowchartPalette.resolve(surface: surface, ink: ink, accent: accent, appearance: effectiveAppearance)
        if readOnly {
            drawStatic(ctx, pal)
            return
        }
        guard let c = controller else { return }
        let v = c.view, k = v.k
        // The dot grid (every 3 grid steps, twice as sparse when zoomed far out).
        let dot = 24 * k < 10 ? 48 * k : 24 * k
        let ox = v.x.truncatingRemainder(dividingBy: dot), oy = v.y.truncatingRemainder(dividingBy: dot)
        ctx.setFillColor(pal.dot.cgColor)
        var y = oy - dot
        while y < Double(bounds.height) + dot {
            var x = ox - dot
            while x < Double(bounds.width) + dot {
                ctx.fillEllipse(in: CGRect(x: x + dot / 2 - 1, y: y + dot / 2 - 1, width: 2, height: 2))
                x += dot
            }
            y += dot
        }
        ctx.saveGState()
        ctx.translateBy(x: v.x, y: v.y)
        ctx.scaleBy(x: k, y: k)
        let editing = c.editing
        FlowchartDrawing.drawChart(ctx, doc: c.doc, routed: c.routed, palette: pal, k: k, cache: paths, selectedEdges: Set(c.sel.edges), hoverEdge: c.hoverEdge,
                                   hiddenText: editing?.kind == .node ? editing?.id : nil, hiddenLabel: editing?.kind == .edge ? editing?.id : nil,
                                   shadows: !c.panning)
        drawOverlay(ctx, c, pal)
        ctx.restoreGState()
    }

    private func drawOverlay(_ ctx: CGContext, _ c: FlowchartController, _ pal: FlowchartPalette) {
        let k = c.view.k
        func stroke(_ p: CGPath, _ color: NSColor, _ width: Double, dash: [CGFloat] = [], fill: NSColor? = nil) {
            ctx.saveGState()
            if let fill {
                ctx.addPath(p)
                ctx.setFillColor(fill.cgColor)
                ctx.fillPath()
            }
            ctx.addPath(p)
            ctx.setStrokeColor(color.cgColor)
            ctx.setLineWidth(width / k)
            ctx.setLineCap(.round)
            if !dash.isEmpty { ctx.setLineDash(phase: 0, lengths: dash.map { $0 / k }) }
            ctx.strokePath()
            ctx.restoreGState()
        }
        for n in c.selNodes {
            let r = CGRect(x: n.x - 3 / k, y: n.y - 3 / k, width: n.w + 6 / k, height: n.h + 6 / k)
            stroke(CGPath(roundedRect: r, cornerWidth: min(8, r.width / 2), cornerHeight: min(8, r.height / 2), transform: nil), pal.select, 1.5)
        }
        for g in c.guides {
            let p = CGMutablePath()
            if g.axis == .x {
                p.move(to: CGPoint(x: g.at, y: g.from - 16))
                p.addLine(to: CGPoint(x: g.at, y: g.to + 16))
            } else {
                p.move(to: CGPoint(x: g.from - 16, y: g.at))
                p.addLine(to: CGPoint(x: g.to + 16, y: g.at))
            }
            stroke(p, pal.guide, 1, dash: [3, 3])
        }
        if let link = c.link {
            stroke(FlowchartDrawing.polyline(link.points), pal.select, 1.75, dash: [5, 4])
            if let id = link.target, let t = c.byId[id] {
                let r = CGRect(x: t.x - 4 / k, y: t.y - 4 / k, width: t.w + 8 / k, height: t.h + 8 / k)
                stroke(CGPath(roundedRect: r, cornerWidth: 10, cornerHeight: 10, transform: nil), pal.select, 1.5, fill: pal.select.withAlphaComponent(0.08))
            }
        }
        if let n = c.single {
            let s = 8 / k
            for h in FlowResizeHandle.allCases {
                let p = FlowchartController.handlePoint(n, h)
                let r = CGRect(x: p.x - s / 2, y: p.y - s / 2, width: s, height: s)
                stroke(CGPath(roundedRect: r, cornerWidth: 2 / k, cornerHeight: 2 / k, transform: nil), pal.select, 1.5, fill: pal.surfaceRaised)
            }
        }
        if let n = c.portNode {
            for side in FlowSide.allCases {
                let p = FlowGeometry.portPoint(n, side)
                let o = FlowchartController.portOffset(side, 14 / k)
                let r = 4.5 / k
                let hovered = c.hoverPort == side && c.hover == n.id
                stroke(CGPath(ellipseIn: CGRect(x: p.x + o.x - r, y: p.y + o.y - r, width: r * 2, height: r * 2), transform: nil), pal.select, 1.5,
                       fill: hovered ? pal.select : pal.surfaceRaised)
            }
        }
        if let r = c.selectedEdge {
            for p in [r.points.first, r.points.last].compactMap({ $0 }) {
                let rad = 5 / k
                stroke(CGPath(ellipseIn: CGRect(x: p.x - rad, y: p.y - rad, width: rad * 2, height: rad * 2), transform: nil), pal.select, 2, fill: pal.surfaceRaised)
            }
        }
        if let m = c.marquee {
            stroke(CGPath(rect: CGRect(x: m.x, y: m.y, width: m.w, height: m.h), transform: nil), pal.select.withAlphaComponent(0.7), 1, fill: pal.select.withAlphaComponent(0.08))
        }
    }

    /// The read-only picture: the whole chart, fitted (never enlarged), centred.
    private func drawStatic(_ ctx: CGContext, _ pal: FlowchartPalette) {
        guard let fc = staticData, let b = FlowGeometry.bounds(fc, routed: staticRouted) else { return }
        let pad = 24.0
        let vb = CGRect(x: (b.x - pad).rounded(.down), y: (b.y - pad).rounded(.down), width: (b.w + pad * 2).rounded(.up), height: (b.h + pad * 2).rounded(.up))
        let k = min(1, Double(bounds.width) / vb.width, Double(bounds.height) / vb.height)
        ctx.saveGState()
        ctx.translateBy(x: (Double(bounds.width) - vb.width * k) / 2, y: (Double(bounds.height) - vb.height * k) / 2)
        ctx.scaleBy(x: k, y: k)
        ctx.translateBy(x: -vb.minX, y: -vb.minY)
        FlowchartDrawing.drawChart(ctx, doc: fc, routed: staticRouted, palette: pal, k: k, cache: paths)
        ctx.restoreGState()
    }

    // MARK: Mouse

    private func local(_ event: NSEvent) -> CGPoint { convert(event.locationInWindow, from: nil) }

    override func mouseDown(with event: NSEvent) {
        guard let c = controller else { return }
        window?.makeFirstResponder(self)
        let flags = event.modifierFlags
        c.mouseDown(local(event), shift: flags.contains(.shift), command: flags.contains(.command), middle: false, clickCount: event.clickCount)
        updateCursor(event)
    }

    override func mouseDragged(with event: NSEvent) {
        controller?.mouseDragged(local(event), option: event.modifierFlags.contains(.option), shift: event.modifierFlags.contains(.shift))
    }

    override func mouseUp(with event: NSEvent) {
        controller?.mouseUp(local(event))
        updateCursor(event)
    }

    override func otherMouseDown(with event: NSEvent) {
        guard let c = controller, event.buttonNumber == 2 else { return super.otherMouseDown(with: event) }
        window?.makeFirstResponder(self)
        c.mouseDown(local(event), shift: false, command: false, middle: true, clickCount: 1)
        updateCursor(event)
    }

    override func otherMouseDragged(with event: NSEvent) { controller?.mouseDragged(local(event), option: false, shift: false) }
    override func otherMouseUp(with event: NSEvent) {
        controller?.mouseUp(local(event))
        updateCursor(event)
    }

    override func mouseMoved(with event: NSEvent) {
        controller?.pointerMoved(local(event))
        updateCursor(event)
    }

    override func mouseExited(with event: NSEvent) {
        controller?.pointerExited()
        NSCursor.arrow.set()
    }

    override func scrollWheel(with event: NSEvent) {
        guard let c = controller, !readOnly else { return super.scrollWheel(with: event) }
        let flags = event.modifierFlags
        let unit: Double = event.hasPreciseScrollingDeltas ? 1 : 16
        if flags.contains(.command) || flags.contains(.control) {
            let p = local(event)
            c.zoomAt(c.view.k * exp(Double(event.scrollingDeltaY) * unit * 0.0022), Double(p.x), Double(p.y))
        } else if c.active {
            // Scrolling pans once the canvas has the keyboard; otherwise the page scrolls as usual.
            var dx = Double(event.scrollingDeltaX), dy = Double(event.scrollingDeltaY)
            if flags.contains(.shift) && dx == 0 {
                dx = dy
                dy = 0
            }
            c.scroll(dx: dx * unit, dy: dy * unit)
        } else {
            super.scrollWheel(with: event)
        }
    }

    override func magnify(with event: NSEvent) {
        guard let c = controller, !readOnly else { return super.magnify(with: event) }
        c.magnify(by: Double(event.magnification), at: local(event))
    }

    func updateCursor(_ event: NSEvent? = nil) {
        guard let c = controller, let window else { return }
        if c.panning { return NSCursor.closedHand.set() }
        if c.spaceDown { return NSCursor.openHand.set() }
        let p = event.map(local) ?? convert(window.mouseLocationOutsideOfEventStream, from: nil)
        guard bounds.contains(p) else { return }
        switch c.hitTest(c.toWorld(p)) {
        case .port: NSCursor.crosshair.set()
        case .edgeEnd: NSCursor.openHand.set()
        case .resize(_, let h): Self.resizeCursor(h).set()
        case .edge: NSCursor.pointingHand.set()
        default: NSCursor.arrow.set()
        }
    }

    private static func resizeCursor(_ h: FlowResizeHandle) -> NSCursor {
        switch h {
        case .n: return .frameResize(position: .top, directions: .all)
        case .s: return .frameResize(position: .bottom, directions: .all)
        case .e: return .frameResize(position: .right, directions: .all)
        case .w: return .frameResize(position: .left, directions: .all)
        case .ne: return .frameResize(position: .topRight, directions: .all)
        case .nw: return .frameResize(position: .topLeft, directions: .all)
        case .se: return .frameResize(position: .bottomRight, directions: .all)
        case .sw: return .frameResize(position: .bottomLeft, directions: .all)
        }
    }

    // MARK: Keyboard

    override func becomeFirstResponder() -> Bool {
        controller?.active = true
        return true
    }

    override func resignFirstResponder() -> Bool {
        if !(window?.firstResponder is FlowchartTextEditor) || textEditor == nil {
            controller?.resignedKeyboard()
        }
        DispatchQueue.main.async { [weak self] in
            guard let self, let c = self.controller else { return }
            let r = self.window?.firstResponder
            c.active = r === self || (r is FlowchartTextEditor && self.textEditor != nil)
        }
        return true
    }

    override func keyDown(with event: NSEvent) {
        if controller?.key(event) != true { super.keyDown(with: event) }
    }

    override func keyUp(with event: NSEvent) {
        controller?.keyUp(event)
        super.keyUp(with: event)
    }

    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        guard window?.firstResponder === self, let c = controller else { return super.performKeyEquivalent(with: event) }
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        guard flags.contains(.command), ["z", "y", "d", "a"].contains(event.charactersIgnoringModifiers?.lowercased() ?? "") else {
            return super.performKeyEquivalent(with: event)
        }
        return c.key(event)
    }

    @objc func undo(_ sender: Any?) { controller?.undo() }
    @objc func redo(_ sender: Any?) { controller?.redo() }
    override func selectAll(_ sender: Any?) { controller?.selectAll() }
    @objc func delete(_ sender: Any?) { controller?.removeSelection() }

    // MARK: Text editor

    /// Shows, moves or removes the text box over the shape or connector being edited.
    func syncTextEditor() {
        guard let c = controller, let ed = c.editing else {
            if let t = textEditor {
                textEditor = nil
                let hadFocus = window?.firstResponder === t
                t.removeFromSuperview()
                if hadFocus { window?.makeFirstResponder(self) }
            }
            return
        }
        let k = c.view.k
        let editor: FlowchartTextEditor
        if let t = textEditor, t.editingId == ed.id, t.kind == ed.kind {
            editor = t
        } else {
            textEditor?.removeFromSuperview()
            editor = FlowchartTextEditor(kind: ed.kind, id: ed.id)
            editor.controller = c
            textEditor = editor
            addSubview(editor)
        }
        let pal = FlowchartPalette.resolve(surface: surface, ink: ink, accent: accent, appearance: effectiveAppearance)
        if ed.kind == .node, let n = c.byId[ed.id] {
            let lines = Double(max(1, Flowchart.lines(n).count))
            let tw = Flowchart.textWidth(n) * k
            let th = lines * Flowchart.lineHeight * k
            let center = c.toScreen(FlowPoint(x: n.x + n.w / 2, y: n.y + n.h / 2))
            let font = FlowchartDrawing.nodeFont(n)
            editor.configure(text: n.text, font: NSFont(descriptor: font.fontDescriptor, size: font.pointSize * k) ?? font,
                             color: pal.colors(n).ink, lineHeight: Flowchart.lineHeight * k, caret: pal.select, boxed: false, surface: pal.surface)
            editor.frame = CGRect(x: center.x - tw / 2, y: center.y - th / 2, width: tw, height: th + 2)
        } else if ed.kind == .edge, let r = c.routed.first(where: { $0.edge.id == ed.id }) {
            let mid = r.label.map { FlowPoint(x: $0.cx, y: $0.cy) } ?? (r.points.isEmpty ? FlowPoint(x: 0, y: 0) : r.points[r.points.count / 2])
            let w = max(80, (r.label?.w ?? 60) + 24) * k
            let s = c.toScreen(mid)
            let font = FlowchartDrawing.labelFont
            editor.configure(text: r.edge.label, font: NSFont(descriptor: font.fontDescriptor, size: font.pointSize * k) ?? font,
                             color: pal.ink, lineHeight: 24 * k, caret: pal.select, boxed: true, surface: pal.surface)
            editor.frame = CGRect(x: s.x - w / 2, y: s.y - 12 * k, width: w, height: 24 * k)
        }
        if window?.firstResponder !== editor, !editor.didFocus {
            editor.didFocus = true
            window?.makeFirstResponder(editor)
            if ed.typed { editor.setSelectedRange(NSRange(location: (editor.string as NSString).length, length: 0)) } else { editor.selectAll(nil) }
        }
    }
}

/// The text box over a shape (multi-line, centred, like the label it replaces) or a connector (one line,
/// boxed). Return finishes (⇧Return adds a line in a shape); Escape finishes too.
final class FlowchartTextEditor: NSTextView {
    let kind: FlowchartController.Editing.Kind
    let editingId: String
    weak var controller: FlowchartController?
    var didFocus = false
    private var applying = false

    init(kind: FlowchartController.Editing.Kind, id: String) {
        self.kind = kind
        editingId = id
        let storage = NSTextStorage()
        let layout = NSLayoutManager()
        storage.addLayoutManager(layout)
        let container = NSTextContainer(size: CGSize(width: 100, height: CGFloat.greatestFiniteMagnitude))
        container.widthTracksTextView = true
        container.lineFragmentPadding = 0
        layout.addTextContainer(container)
        super.init(frame: .zero, textContainer: container)
        isRichText = false
        importsGraphics = false
        allowsUndo = false
        isAutomaticQuoteSubstitutionEnabled = false
        isAutomaticDashSubstitutionEnabled = false
        isAutomaticTextReplacementEnabled = false
        isAutomaticSpellingCorrectionEnabled = false
        drawsBackground = false
        textContainerInset = .zero
        isVerticallyResizable = false
        isHorizontallyResizable = false
        focusRingType = .none
        setAccessibilityLabel(kind == .node ? String(localized: "Text for this shape") : String(localized: "Connector label"))
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError() }

    override var isFlipped: Bool { true }

    private var signature: [AnyHashable] = []
    private var signatureStyle: [AnyHashable] = []

    func configure(text: String, font: NSFont, color: NSColor, lineHeight: Double, caret: NSColor, boxed: Bool, surface: NSColor) {
        // Only touch the text when something changed: re-styling on every keystroke would break input
        // methods in the middle of composing.
        let sig: [AnyHashable] = [text, font, color, lineHeight, caret, boxed, surface]
        guard sig != signature, !hasMarkedText() else { return }
        signature = sig
        applying = true
        defer { applying = false }
        let para = NSMutableParagraphStyle()
        para.alignment = .center
        if boxed {
            para.lineBreakMode = .byClipping
        } else {
            para.minimumLineHeight = lineHeight
            para.maximumLineHeight = lineHeight
        }
        let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color, .paragraphStyle: para]
        typingAttributes = attrs
        if string != text {
            let sel = selectedRange()
            textStorage?.setAttributedString(NSAttributedString(string: text, attributes: attrs))
            setSelectedRange(NSRange(location: min(sel.location, (text as NSString).length), length: 0))
        } else if let storage = textStorage, storage.length > 0, Array(sig.dropFirst()) != signatureStyle {
            storage.setAttributes(attrs, range: NSRange(location: 0, length: storage.length))
        }
        signatureStyle = Array(sig.dropFirst())
        insertionPointColor = caret
        if boxed {
            wantsLayer = true
            drawsBackground = true
            backgroundColor = surface
            layer?.cornerRadius = 6
            layer?.borderWidth = 1.5
            layer?.borderColor = caret.cgColor
            let lh = font.ascender - font.descender
            textContainerInset = NSSize(width: 6, height: max(0, (frame.height - lh) / 2))
        }
    }

    override func setFrameSize(_ newSize: NSSize) {
        super.setFrameSize(newSize)
        if kind == .edge, let font {
            textContainerInset = NSSize(width: 6, height: max(0, (newSize.height - (font.ascender - font.descender)) / 2))
        }
    }

    override func didChangeText() {
        super.didChangeText()
        guard !applying else { return }
        controller?.editText(string)
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        if kind == .edge, string.isEmpty, let font {
            let s = NSAttributedString(string: String(localized: "Label"), attributes: [.font: font, .foregroundColor: NSColor(FoleviColor.inkFaint)])
            let size = s.size()
            s.draw(at: CGPoint(x: (bounds.width - size.width) / 2, y: (bounds.height - size.height) / 2))
        }
    }

    override func keyDown(with event: NSEvent) {
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        let isReturn = event.keyCode == 36 || event.keyCode == 76
        if event.keyCode == 53 || (isReturn && (kind == .edge || !flags.contains(.shift))) {
            controller?.finishEdit(refocus: true)
            return
        }
        super.keyDown(with: event)
    }

    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        let key = event.charactersIgnoringModifiers?.lowercased()
        // ⌘Z here would reach the note; finish the edit as one step and use the chart's history instead.
        if window?.firstResponder === self, flags.contains(.command), key == "z" || key == "y", let c = controller {
            c.finishEdit(refocus: true)
            if key == "y" || flags.contains(.shift) { c.redo() } else { c.undo() }
            return true
        }
        return super.performKeyEquivalent(with: event)
    }

    override func resignFirstResponder() -> Bool {
        let ok = super.resignFirstResponder()
        if ok, didFocus {
            // Clicking elsewhere ends the edit (keeping the text).
            DispatchQueue.main.async { [weak self] in
                guard let self, let c = self.controller, c.editing?.id == self.editingId, self.window?.firstResponder !== self else { return }
                c.finishEdit(refocus: false)
            }
        }
        return ok
    }
}

// MARK: - SwiftUI bridge

struct FlowchartCanvas: NSViewRepresentable {
    var controller: FlowchartController?
    var staticData: FlowchartData?
    var surface: Color
    var ink: Color
    var accent: Color

    func makeNSView(context: Context) -> FlowchartCanvasView {
        let v = FlowchartCanvasView()
        update(v)
        return v
    }

    func updateNSView(_ nsView: FlowchartCanvasView, context: Context) { update(nsView) }

    private func update(_ v: FlowchartCanvasView) {
        v.readOnly = controller == nil
        if v.controller !== controller { v.controller = controller }
        if v.staticData != staticData { v.staticData = staticData }
        v.surface = surface
        v.ink = ink
        v.accent = accent
    }

    static func dismantleNSView(_ nsView: FlowchartCanvasView, coordinator: ()) {
        nsView.controller?.flush()
    }
}
