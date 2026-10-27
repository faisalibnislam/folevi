// Graph (apps/web/src/components/views/GraphView.tsx as Folevi for Mac shows it): the space's notes and the
// links between them, and where the plan has them, people, projects, organizations, topics and decisions.
// Positions come from the bridge's `graph` view, laid out by the web's own force layout (lib/graph/layout.ts),
// so the picture is the web's; drawn here with the web's maths (fit, zoom around a point, radii, shapes).
// Pan by dragging, zoom with the wheel or a pinch, arrow keys move between nodes, Return opens a note or shows
// an entity's notes, + and - zoom, 0 fits. The List view shows the same graph as text.
#if os(macOS)
import AppKit
import SwiftUI
import FoleviDesign
import FoleviEngine
import FoleviScreens

@MainActor
@Observable
final class GraphModel {
    let client: EngineClient
    let feedback: ScreenFeedback
    let session: ValueStore<SessionValue>
    private(set) var store: ValueStore<GraphValue>
    var kinds: [String] = GraphMath.entityKinds { didSet { if kinds != oldValue { store = client.watch(.graph(kinds: kinds.count == GraphMath.entityKinds.count ? nil : kinds)) } } }
    var query = ""
    var list = UserDefaults.standard.string(forKey: "folevi.graph.view") == "list" { didSet { UserDefaults.standard.set(list ? "list" : "graph", forKey: "folevi.graph.view") } }

    init(client: EngineClient, feedback: ScreenFeedback) {
        self.client = client
        self.feedback = feedback
        session = client.watch(.session, snapshotKey: "session.\(client.place)")
        store = client.watch(.graph())
    }

    /// The graph is part of what this place offers (a library on this Mac doesn't have it yet).
    var available: Bool { session.value?.capabilities.graph ?? true }
    var value: GraphValue? { store.value }
    var matches: Set<String> { GraphMath.match(value?.nodes ?? [], query) }
}

/// The web's graph maths (lib/graph/layout.ts), the same numbers.
enum GraphMath {
    static let entityKinds = ["person", "project", "organization", "topic", "decision"]
    static let filterLabel = ["person": "People", "project": "Projects", "organization": "Organizations", "topic": "Topics", "decision": "Decisions"]
    static let kindLabel = ["note": "Note", "person": "Person", "project": "Project", "organization": "Organization", "topic": "Topic", "decision": "Decision"]
    static let edgeLabel = ["link": "Linked", "mention": "Mentions", "similar": "Similar", "related": "Related", "references": "Refers to", "contradicts": "Contradicts", "supersedes": "Replaces"]
    static let minZoom: CGFloat = 0.15, maxZoom: CGFloat = 4
    static let alwaysLabelled = 12

    struct Transform: Equatable { var x: CGFloat, y: CGFloat, k: CGFloat }

    static func clamp(_ k: CGFloat) -> CGFloat { min(maxZoom, max(minZoom, k)) }

    static func fit(_ nodes: [GraphNode], _ size: CGSize, padding: CGFloat = 36) -> Transform {
        guard let minX = nodes.map(\.x).min(), let maxX = nodes.map(\.x).max(), let minY = nodes.map(\.y).min(), let maxY = nodes.map(\.y).max(), size.width > 0, size.height > 0 else {
            return Transform(x: size.width / 2, y: size.height / 2, k: 1)
        }
        let b = (minX: CGFloat(minX) - 20, minY: CGFloat(minY) - 20, maxX: CGFloat(maxX) + 20, maxY: CGFloat(maxY) + 20)
        let w = max(1, b.maxX - b.minX), h = max(1, b.maxY - b.minY)
        let k = clamp(min((size.width - padding * 2) / w, (size.height - padding * 2) / h, 1.6))
        return Transform(x: size.width / 2 - (b.minX + b.maxX) / 2 * k, y: size.height / 2 - (b.minY + b.maxY) / 2 * k, k: k)
    }

    static func zoom(_ t: Transform, _ factor: CGFloat, around p: CGPoint) -> Transform {
        let k = clamp(t.k * factor), f = k / t.k
        return Transform(x: p.x - (p.x - t.x) * f, y: p.y - (p.y - t.y) * f, k: k)
    }

    static func screen(_ t: Transform, _ n: GraphNode) -> CGPoint { CGPoint(x: CGFloat(n.x) * t.k + t.x, y: CGFloat(n.y) * t.k + t.y) }
    static func radius(_ degree: Int, entity: Bool) -> CGFloat { min(entity ? 20 : 18, (entity ? 7 : 6) + sqrt(CGFloat(degree)) * 2.4) }
    static func drawn(_ r: CGFloat, _ k: CGFloat) -> CGFloat { max(r, 4.5 / k) }

    static func top(_ nodes: [GraphNode]) -> Set<String> {
        Set(nodes.filter { $0.degree > 0 }.sorted { $0.degree != $1.degree ? $0.degree > $1.degree : $0.id < $1.id }.prefix(alwaysLabelled).map(\.id))
    }

    static func neighbours(_ edges: [GraphEdge], _ id: String) -> Set<String> {
        var out = Set<String>()
        for e in edges { if e.source == id { out.insert(e.target) } else if e.target == id { out.insert(e.source) } }
        return out
    }

    static func fold(_ s: String) -> String {
        s.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: nil).split(whereSeparator: \.isWhitespace).joined(separator: " ")
    }

    static func match(_ nodes: [GraphNode], _ query: String) -> Set<String> {
        let words = fold(query).split(separator: " ").map(String.init)
        guard !words.isEmpty else { return [] }
        return Set(nodes.filter { n in let l = fold(n.label); return words.allSatisfy { l.contains($0) } }.map(\.id))
    }

    /// A kind's shape around (0, 0) with radius r (lib/graph/layout.ts shapePath), or nil for a circle.
    static func shape(_ kind: String, _ r: CGFloat, at c: CGPoint) -> Path? {
        let spec: (Int, CGFloat, CGFloat)?
        switch kind {
        case "person": spec = (4, r * 1.2, -.pi / 2)
        case "project": spec = (4, r * 1.15, .pi / 4)
        case "organization": spec = (6, r * 1.1, 0)
        case "topic": spec = (3, r * 1.3, -.pi / 2)
        case "decision": spec = (5, r * 1.15, -.pi / 2)
        default: spec = nil
        }
        guard let (sides, rr, rot) = spec else { return nil }
        var p = Path()
        for i in 0..<sides {
            let a = rot + CGFloat(i) * 2 * .pi / CGFloat(sides)
            let pt = CGPoint(x: c.x + cos(a) * rr, y: c.y + sin(a) * rr)
            if i == 0 { p.move(to: pt) } else { p.addLine(to: pt) }
        }
        p.closeSubpath()
        return p
    }

    static func colorVar(_ kind: String) -> String {
        switch kind {
        case "person": "color-coral"
        case "project": "color-accent"
        case "organization": "color-moss"
        case "topic": "color-marigold"
        case "decision": "color-plum"
        default: "color-ink-muted"
        }
    }
}

struct GraphScreen: View {
    let model: GraphModel
    let frame: FrameModel
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        Group {
            if !model.available {
                VStack(spacing: 0) {
                    WebEmptyState(icon: .waypoints, title: "The graph isn’t available here yet", message: "It isn’t part of a library on your devices yet. Links between notes still work everywhere.")
                    Spacer(minLength: 0)
                }
            } else {
                full
            }
        }
        .accessibilityIdentifier("screen.graph")
    }

    private var full: some View {
        let v = model.value
        let nodes = v?.nodes ?? []
        let notes = nodes.filter { $0.kind == "note" }.count
        let muted = moreVar("color-ink-muted", scheme), faint = moreVar("color-ink-faint", scheme)
        return VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                segmented
                HStack(spacing: 6) {
                    WebIconView(.search, size: 14).foregroundStyle(faint)
                    TextField("Find in the graph", text: Bindable(model).query).textFieldStyle(.plain).webText(.role(.subheadline))
                }
                .padding(.horizontal, 10)
                .frame(minWidth: 160, maxWidth: 320)
                .frame(height: 32)
                .webBox(WebStyles.named("input"))
                if v?.full == true { kindChips }
                Spacer(minLength: 0)
                if let v {
                    Text(verbatim: "\(notes) \(notes == 1 ? "note" : "notes")\(v.nodes.count > notes ? ", \(v.nodes.count - notes) more" : "")\(model.query.trimmingCharacters(in: .whitespaces).isEmpty ? "" : " · \(model.matches.count) found")")
                        .webText(.role(.footnote)).lineLimit(1).monospacedDigit().foregroundStyle(faint)
                }
            }
            .padding(.horizontal, 24).padding(.top, 4).padding(.bottom, 8)
            if let v, v.note != nil || v.truncated {
                VStack(alignment: .leading, spacing: 0) {
                    if let note = v.note { Text(verbatim: note).webText(.role(.subheadline)).foregroundStyle(muted) }
                    if v.truncated { Text(verbatim: "Showing the most recently edited notes.").webText(.role(.subheadline)).foregroundStyle(muted) }
                }
                .padding(.horizontal, 24).padding(.bottom, 8)
            }
            if v == nil {
                Text(verbatim: "Loading the graph…").webText(.role(.subheadline)).foregroundStyle(muted).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if nodes.isEmpty {
                WebEmptyState(icon: .waypoints, title: "No notes here yet", message: "Notes and the links between them show up here.").frame(maxHeight: .infinity)
            } else if model.list {
                GraphListView(nodes: nodes, edges: v?.edges ?? [], query: model.query, open: { frame.open(.note($0)) })
            } else {
                GraphCanvasView(value: v!, matches: model.matches, searching: !model.query.trimmingCharacters(in: .whitespaces).isEmpty, open: { frame.open(.note($0)) })
            }
        }
    }

    private var segmented: some View {
        HStack(spacing: 0) {
            segment("Graph", on: !model.list) { model.list = false }
            segment("List", on: model.list) { model.list = true }
        }
        .padding(2)
        .webBox(WebStyles.named("input"))
    }

    private func segment(_ title: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(verbatim: title).webText(.role(.subheadline, weight: on ? 550 : 400)).lineLimit(1)
                .foregroundStyle(on ? moreVar("color-heading", scheme) : moreVar("color-ink-muted", scheme))
                .padding(.horizontal, 12).frame(height: 28)
                .background(RoundedRectangle(cornerRadius: 6, style: .circular).fill(on ? moreVar("color-surface", scheme) : .clear).shadow(color: .black.opacity(on ? 0.08 : 0), radius: 1, y: 0.5))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var kindChips: some View {
        HStack(spacing: 4) {
            ForEach(GraphMath.entityKinds, id: \.self) { k in
                let on = model.kinds.contains(k)
                Button {
                    model.kinds = on ? model.kinds.filter { $0 != k } : GraphMath.entityKinds.filter { $0 == k || model.kinds.contains($0) }
                } label: {
                    HStack(spacing: 6) {
                        KindGlyph(kind: k, muted: !on)
                        Text(verbatim: GraphMath.filterLabel[k] ?? k).webText(WebStyles.named("chip").resolve(scheme).text).lineLimit(1)
                    }
                    .foregroundStyle(on ? moreVar("color-heading", scheme) : moreVar("color-ink-faint", scheme))
                    .webElement(WebStyles.named("chip"))
                }
                .buttonStyle(.plain)
            }
        }
    }
}

/// A kind's small shape (the filters, the list).
struct KindGlyph: View {
    let kind: String
    var size: CGFloat = 10
    var muted = false
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let fill = muted ? moreVar("color-line-strong", scheme) : moreVar(GraphMath.colorVar(kind), scheme)
        Canvas { ctx, s in
            let r = size / 2 - 1, c = CGPoint(x: s.width / 2, y: s.height / 2)
            if let p = GraphMath.shape(kind, r * 0.85, at: c) { ctx.fill(p, with: .color(fill)) } else { ctx.fill(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)), with: .color(fill)) }
        }
        .frame(width: size, height: size)
    }
}

/// The graph itself: quiet edges, nodes sized by their connections, the best-connected labelled, entities shaped
/// by kind; the hovered node and its neighbours stand out.
struct GraphCanvasView: View {
    let value: GraphValue
    let matches: Set<String>
    let searching: Bool
    let open: (String) -> Void
    @Environment(\.colorScheme) private var scheme
    @State private var t = GraphMath.Transform(x: 0, y: 0, k: 1)
    @State private var moved = false
    @State private var size: CGSize = .zero
    @State private var hover: String?
    @State private var selected: String?
    @State private var focusedNode: String?
    @State private var dragStart: GraphMath.Transform?
    @State private var pinchStart: GraphMath.Transform?
    @FocusState private var focused: Bool

    var body: some View {
        let byId = Dictionary(value.nodes.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let labelled = GraphMath.top(value.nodes)
        let focus = hover ?? focusedNode ?? selected
        let near: Set<String>? = focus.map { Set([$0]).union(GraphMath.neighbours(value.edges, $0)) }
        let notes = value.nodes.filter { $0.kind == "note" }.count
        let sparse = notes < 3 ? "Your graph grows as you write. Notes show up here, and lines join the ones that link to each other." : value.edges.isEmpty ? "None of these notes link to each other yet. Type [[ in a note to link another one, and a line joins them here." : nil
        GeometryReader { geo in
            ZStack(alignment: .topLeading) {
                Canvas { ctx, _ in
                    draw(&ctx, byId: byId, labelled: labelled, near: near)
                }
                .contentShape(Rectangle())
                .gesture(DragGesture(minimumDistance: 5).onChanged { g in
                    if dragStart == nil { dragStart = t }
                    moved = true
                    t = GraphMath.Transform(x: dragStart!.x + g.translation.width, y: dragStart!.y + g.translation.height, k: t.k)
                }.onEnded { _ in dragStart = nil })
                .simultaneousGesture(MagnifyGesture().onChanged { g in
                    if pinchStart == nil { pinchStart = t }
                    moved = true
                    t = GraphMath.zoom(pinchStart!, g.magnification, around: g.startLocation)
                }.onEnded { _ in pinchStart = nil })
                .onTapGesture(coordinateSpace: .local) { p in
                    if let id = hit(p) { activate(id, byId) } else { selected = nil }
                }
                .onContinuousHover { phase in
                    if case .active(let p) = phase { hover = hit(p) } else { hover = nil }
                }
                .background(ScrollWheelCatcher { delta, at in
                    moved = true
                    t = GraphMath.zoom(t, exp(-delta * 0.0015 * -1), around: at)
                })
                if let sparse {
                    Text(verbatim: sparse).webText(.role(.subheadline)).foregroundStyle(moreVar("color-ink-muted", scheme))
                        .padding(.horizontal, 12).padding(.vertical, 8)
                        .frame(maxWidth: min(340, geo.size.width - 80), alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 10, style: .circular).fill(moreVar("glass-hover", scheme)))
                        .padding(12)
                        .allowsHitTesting(false)
                }
                if let id = hover ?? focusedNode, let n = byId[id] { tooltip(n) }
                if let id = selected, let n = byId[id] { picked(n, byId: byId) }
                zoomButtons.frame(maxWidth: .infinity, alignment: .topTrailing).padding(12)
            }
            .onAppear { size = geo.size; t = GraphMath.fit(value.nodes, geo.size) }
            .onChange(of: geo.size) { _, s in size = s; if !moved { t = GraphMath.fit(value.nodes, s) } }
            .onChange(of: value.nodes.map(\.id)) { _, _ in if !moved { t = GraphMath.fit(value.nodes, size) } }
        }
        .focusable()
        .focusEffectDisabled()
        .focused($focused)
        .onKeyPress(phases: .down) { press in key(press, byId) }
    }

    private func draw(_ ctx: inout GraphicsContext, byId: [String: GraphNode], labelled: Set<String>, near: Set<String>?) {
        let k = t.k
        for e in value.edges {
            guard let a = byId[e.source], let b = byId[e.target] else { continue }
            let on = near.map { $0.contains(e.source) && $0.contains(e.target) } ?? (!searching || (matches.contains(e.source) && matches.contains(e.target)))
            var p = Path()
            p.move(to: GraphMath.screen(t, a))
            p.addLine(to: GraphMath.screen(t, b))
            let color = moreVar(e.kind == "contradicts" ? "color-coral" : e.kind == "supersedes" ? "color-plum" : "color-line-strong", scheme)
            let style = StrokeStyle(lineWidth: e.kind == "link" ? 1.2 : 1, dash: e.inferred && e.kind != "mention" ? [4, 3] : [])
            ctx.stroke(p, with: .color(color.opacity(on ? (near != nil ? 0.9 : 0.45) : 0.07)), style: style)
        }
        let canvas = moreVar("color-canvas", scheme), heading = moreVar("color-heading", scheme), ink = moreVar("color-ink", scheme)
        for n in value.nodes {
            let entity = n.kind != "note"
            let r = GraphMath.drawn(GraphMath.radius(n.degree, entity: entity), k) * k
            let c = GraphMath.screen(t, n)
            let on = near.map { $0.contains(n.id) } ?? (searching ? matches.contains(n.id) : true)
            var layer = ctx
            layer.opacity = on ? 1 : 0.25
            let path = GraphMath.shape(n.kind, r, at: c) ?? Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2))
            layer.fill(path, with: .color(moreVar(GraphMath.colorVar(n.kind), scheme)))
            layer.stroke(path, with: .color(n.id == selected ? heading : canvas), lineWidth: 1.5)
            if n.id == focusedNode {
                layer.stroke(Path(ellipseIn: CGRect(x: c.x - r - 4, y: c.y - r - 4, width: (r + 4) * 2, height: (r + 4) * 2)), with: .color(moreVar("color-focus", scheme)), lineWidth: 2.5)
            }
            let showLabel = on && (k >= 1.3 || labelled.contains(n.id) || (near?.contains(n.id) ?? false) || (searching && matches.contains(n.id)))
            if showLabel, n.id != hover, n.id != focusedNode {
                let label = String((n.label.isEmpty ? "Untitled" : n.label).prefix(40))
                let text = Text(verbatim: label).font(WebFont.font(.sans, size: 11.5)).foregroundColor(ink)
                let at = CGPoint(x: c.x, y: c.y + r + 12)
                // The label's halo (paint-order: stroke), then the label.
                for (dx, dy) in [(-1.5, 0.0), (1.5, 0.0), (0.0, -1.5), (0.0, 1.5)] {
                    layer.draw(Text(verbatim: label).font(WebFont.font(.sans, size: 11.5)).foregroundColor(canvas), at: CGPoint(x: at.x + dx, y: at.y + dy), anchor: .bottom)
                }
                layer.draw(text, at: at, anchor: .bottom)
            }
        }
    }

    private func hit(_ p: CGPoint) -> String? {
        var best: (String, CGFloat)?
        for n in value.nodes {
            let r = max(GraphMath.radius(n.degree, entity: n.kind != "note"), 12 / t.k) * t.k
            let c = GraphMath.screen(t, n)
            let d = hypot(c.x - p.x, c.y - p.y)
            if d <= r, d < (best?.1 ?? .infinity) { best = (n.id, d) }
        }
        return best?.0
    }

    private func activate(_ id: String, _ byId: [String: GraphNode]) {
        guard let n = byId[id] else { return }
        if n.kind == "note" { open(n.id) } else { selected = selected == n.id ? nil : n.id }
    }

    private func key(_ press: KeyPress, _ byId: [String: GraphNode]) -> KeyPress.Result {
        let dirs: [KeyEquivalent: (CGFloat, CGFloat)] = [.leftArrow: (-1, 0), .rightArrow: (1, 0), .upArrow: (0, -1), .downArrow: (0, 1)]
        if let (ax, ay) = dirs[press.key] {
            if let from = focusedNode ?? GraphMath.top(value.nodes).first ?? value.nodes.first?.id, !press.modifiers.contains(.shift), let p = byId[from] {
                if focusedNode == nil { focusedNode = from; return .handled }
                var best: (String, CGFloat)?
                for q in value.nodes where q.id != from {
                    let dx = CGFloat(q.x - p.x), dy = CGFloat(q.y - p.y)
                    let ahead = dx * ax + dy * ay, side = abs(dx * ay - dy * ax)
                    guard ahead > 0, side <= ahead * 1.732 else { continue }
                    let score = ahead + side * 2
                    if score < (best?.1 ?? .infinity) { best = (q.id, score) }
                }
                if let b = best?.0 { focusedNode = b }
            } else {
                moved = true
                t = GraphMath.Transform(x: t.x - ax * 40, y: t.y - ay * 40, k: t.k)
            }
            return .handled
        }
        switch press.characters {
        case "+", "=": zoomBy(1.25)
        case "-": zoomBy(0.8)
        case "0": moved = false; t = GraphMath.fit(value.nodes, size)
        default:
            if press.key == .return || press.key == .space, let id = focusedNode { activate(id, byId); return .handled }
            if press.key == .escape, selected != nil { selected = nil; return .handled }
            return .ignored
        }
        return .handled
    }

    private func zoomBy(_ f: CGFloat) {
        moved = true
        t = GraphMath.zoom(t, f, around: CGPoint(x: size.width / 2, y: size.height / 2))
    }

    private func tooltip(_ n: GraphNode) -> some View {
        let at = GraphMath.screen(t, n)
        let keyboard = n.id == focusedNode && hover == nil
        let what = n.kind == "note" ? (keyboard ? "Enter opens it" : "Click to open") : "\(GraphMath.kindLabel[n.kind] ?? "Topic") · \(keyboard ? "Enter shows its notes" : "Click for its notes")"
        return VStack(alignment: .leading, spacing: 0) {
            Text(verbatim: n.label.isEmpty ? "Untitled" : n.label).webText(.role(.subheadline, weight: 500)).foregroundStyle(moreVar("color-heading", scheme))
            Text(verbatim: what).webText(.role(.footnote)).foregroundStyle(moreVar("color-ink-muted", scheme))
        }
        .padding(.horizontal, 10).padding(.vertical, 6)
        .frame(maxWidth: 240, alignment: .leading)
        .webBox(WebStyles.named("menu.panel"))
        .fixedSize()
        .alignmentGuide(.leading) { d in d.width / 2 - at.x }
        .alignmentGuide(.top) { _ in -(at.y + 16) }
        .allowsHitTesting(false)
    }

    private func picked(_ n: GraphNode, byId: [String: GraphNode]) -> some View {
        let notes = GraphMath.neighbours(value.edges, n.id).compactMap { byId[$0] }.filter { $0.kind == "note" }.sorted { $0.label.localizedCompare($1.label) == .orderedAscending }
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 8) {
                KindGlyph(kind: n.kind).padding(.top, 6)
                (Text(verbatim: n.label).font(WebFont.font(.sans, size: 16, weight: 600)).foregroundColor(moreVar("color-heading", scheme))
                    + Text(verbatim: " \(GraphMath.kindLabel[n.kind] ?? "")").font(WebFont.font(.sans, size: 12)).foregroundColor(moreVar("color-ink-faint", scheme)))
                    .frame(maxWidth: .infinity, alignment: .leading)
                WebIconButton(.x, label: "Close") { selected = nil }
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(notes, id: \.id) { note in
                        Button { open(note.id) } label: {
                            HStack(spacing: 6) {
                                WebIconView(.fileText, size: 13).foregroundStyle(moreVar("color-ink-muted", scheme))
                                Text(verbatim: note.label.isEmpty ? "Untitled" : note.label).webText(.role(.subheadline)).lineLimit(1)
                            }
                            .padding(.horizontal, 6).padding(.vertical, 4)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .frame(maxHeight: 192)
        }
        .padding(12)
        .frame(width: min(300, size.width - 24))
        .webBox(WebStyles.named("menu.panel"))
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
        .padding(12)
    }

    private var zoomButtons: some View {
        VStack(spacing: 2) {
            WebIconButton(.zoomIn, label: "Zoom in") { zoomBy(1.25) }
            WebIconButton(.zoomOut, label: "Zoom out") { zoomBy(0.8) }
            WebIconButton(.maximize, label: "Fit to screen") { moved = false; t = GraphMath.fit(value.nodes, size) }
        }
        .padding(4)
        .webBox(WebStyles.named("menu.panel"))
    }
}

/// The scroll wheel over the graph zooms around the pointer (as the web's non-passive wheel listener).
private struct ScrollWheelCatcher: NSViewRepresentable {
    let onScroll: (CGFloat, CGPoint) -> Void

    func makeNSView(context: Context) -> CatcherView { CatcherView(onScroll: onScroll) }
    func updateNSView(_ v: CatcherView, context: Context) { v.onScroll = onScroll }

    final class CatcherView: NSView {
        var onScroll: (CGFloat, CGPoint) -> Void
        private var monitor: Any?
        init(onScroll: @escaping (CGFloat, CGPoint) -> Void) {
            self.onScroll = onScroll
            super.init(frame: .zero)
        }
        @available(*, unavailable) required init?(coder: NSCoder) { fatalError() }
        override var isFlipped: Bool { true }
        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            if let monitor { NSEvent.removeMonitor(monitor) }
            monitor = nil
            guard window != nil else { return }
            monitor = NSEvent.addLocalMonitorForEvents(matching: .scrollWheel) { [weak self] e in
                guard let self, e.window === self.window else { return e }
                let p = self.convert(e.locationInWindow, from: nil)
                guard self.bounds.contains(p) else { return e }
                self.onScroll(-e.scrollingDeltaY * (e.hasPreciseScrollingDeltas ? 1 : 10), p)
                return nil
            }
        }
        override func removeFromSuperview() {
            if let monitor { NSEvent.removeMonitor(monitor) }
            monitor = nil
            super.removeFromSuperview()
        }
    }
}

/// The graph as text: every note and entity with what it's connected to.
struct GraphListView: View {
    let nodes: [GraphNode]
    let edges: [GraphEdge]
    let query: String
    let open: (String) -> Void
    @Environment(\.colorScheme) private var scheme

    struct Entry { var node: GraphNode; var connections: [(GraphNode, String)] }

    private var entries: [Entry] {
        let byId = Dictionary(nodes.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        var conns: [String: [(String, String)]] = [:]
        func add(_ from: String, _ to: String, _ kind: String) {
            guard byId[from] != nil, byId[to] != nil, !(conns[from]?.contains { $0.0 == to } ?? false) else { return }
            conns[from, default: []].append((to, kind))
        }
        for e in edges { add(e.source, e.target, e.kind); add(e.target, e.source, e.kind) }
        let matches = query.trimmingCharacters(in: .whitespaces).isEmpty ? nil : GraphMath.match(nodes, query)
        let order: (GraphNode, GraphNode) -> Bool = { a, b in
            (a.kind != "note") != (b.kind != "note") ? a.kind == "note" : a.label.localizedCompare(b.label) == .orderedAscending
        }
        return nodes.filter { matches?.contains($0.id) ?? true }.sorted(by: order).map { n in
            let c = (conns[n.id] ?? []).compactMap { pair in byId[pair.0].map { ($0, pair.1) } }.sorted { order($0.0, $1.0) }
            return Entry(node: n, connections: c)
        }
    }

    var body: some View {
        let all = entries
        let notes = all.filter { $0.node.kind == "note" }, others = all.filter { $0.node.kind != "note" }
        if all.isEmpty {
            WebEmptyState(icon: nil, title: "Nothing matches").frame(maxHeight: .infinity)
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Text(verbatim: "NOTES").webText(.caps).foregroundStyle(moreVar("color-ink-muted", scheme)).padding(.top, 8).padding(.bottom, 8)
                    VStack(alignment: .leading, spacing: 12) { ForEach(notes, id: \.node.id) { row($0) } }
                    if !others.isEmpty {
                        Text(verbatim: "PEOPLE, PROJECTS AND TOPICS").webText(.caps).foregroundStyle(moreVar("color-ink-muted", scheme)).padding(.top, 24).padding(.bottom, 8)
                        VStack(alignment: .leading, spacing: 12) { ForEach(others, id: \.node.id) { row($0) } }
                    }
                }
                .padding(.horizontal, 24).padding(.bottom, 40)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private func row(_ e: Entry) -> some View {
        let heading = moreVar("color-heading", scheme), muted = moreVar("color-ink-muted", scheme), faint = moreVar("color-ink-faint", scheme)
        return VStack(alignment: .leading, spacing: 4) {
            if e.node.kind == "note" {
                Button { open(e.node.id) } label: {
                    HStack(spacing: 6) {
                        WebIconView(.fileText, size: 14).foregroundStyle(muted)
                        Text(verbatim: e.node.label.isEmpty ? "Untitled" : e.node.label).webText(.role(.body, weight: 500)).lineLimit(1).foregroundStyle(heading)
                    }
                }
                .buttonStyle(.plain)
            } else {
                HStack(spacing: 6) {
                    KindGlyph(kind: e.node.kind)
                    Text(verbatim: e.node.label).webText(.role(.body, weight: 500)).lineLimit(1).foregroundStyle(heading)
                    Text(verbatim: GraphMath.kindLabel[e.node.kind] ?? "").webText(.role(.footnote)).lineLimit(1).foregroundStyle(faint)
                }
            }
            if e.connections.isEmpty {
                Text(verbatim: "Not connected yet").webText(.role(.subheadline)).foregroundStyle(faint)
            } else {
                let text = e.connections.prefix(24).map { c, edge in
                    "\(GraphMath.edgeLabel[edge] ?? "Related"): \(c.label.isEmpty ? "Untitled" : c.label)\(c.kind == "note" ? "" : " (\((GraphMath.kindLabel[c.kind] ?? "").lowercased()))")"
                }.joined(separator: "   ")
                Text(verbatim: text).webText(.role(.subheadline)).foregroundStyle(muted)
            }
        }
    }
}
#endif
