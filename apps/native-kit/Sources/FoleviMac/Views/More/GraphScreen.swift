// Foli DNA, route /graph (apps/web/src/components/views/GraphView.tsx as Folevi for Mac and iPad shows it): the
// space's notes and the links between them, and where the plan has them, people, projects, organizations, topics
// and decisions. Positions come from the bridge's `graph` view, laid out by the web's own force layout
// (lib/graph/layout.ts), and clusters, bridges, suggested links and saved views come with it (revision 28), so the
// picture is the web's. Filters, the view around one note (`/graph?note=<id>&depth=2`), time and export follow
// lib/graph/analysis.ts (DnaMath here, the same rules). Pan by dragging, zoom with the wheel or a pinch, drag a
// node to pin it (double-click unpins), Shift-click or Select mode picks notes, arrow keys move between nodes,
// Return opens a note or shows an entity's notes, + and - zoom, 0 fits. The List view shows the same map as text.
#if os(macOS) || os(iOS)
#if os(macOS)
import AppKit
#else
import UIKit
#endif
import SwiftUI
import FoleviDesign
import FoleviEngine
import FoleviScreens

// MARK: - Settings (the web's DnaSettings, the same JSON so saved views read the same everywhere)

struct DnaFilter: Codable, Equatable {
    var folders: [String]?
    var tags: [String]?
    var editedSince: Double?
    var linksOnly: Bool?
    var hideOrphans: Bool?
}

struct DnaSettings: Codable, Equatable {
    var filter = DnaFilter()
    var kinds: [String]?
    var colorBy = "kind"
    var arrows = false
    var clusters = true
    var spacing = 1.0
    var pull = 1.0
    var center: String?
    var depth = 1.0

    init() {}

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        filter = (try? c.decodeIfPresent(DnaFilter.self, forKey: .filter)) ?? DnaFilter()
        kinds = try? c.decodeIfPresent([String].self, forKey: .kinds)
        let by = (try? c.decodeIfPresent(String.self, forKey: .colorBy)) ?? "kind"
        colorBy = ["kind", "folder", "tag"].contains(by) ? by : "kind"
        arrows = (try? c.decodeIfPresent(Bool.self, forKey: .arrows)) ?? false
        clusters = (try? c.decodeIfPresent(Bool.self, forKey: .clusters)) ?? true
        spacing = min(2, max(0.5, (try? c.decodeIfPresent(Double.self, forKey: .spacing)) ?? 1))
        pull = min(3, max(0.25, (try? c.decodeIfPresent(Double.self, forKey: .pull)) ?? 1))
        center = try? c.decodeIfPresent(String.self, forKey: .center)
        depth = min(3, max(1, (try? c.decodeIfPresent(Double.self, forKey: .depth)) ?? 1))
    }

    static func read(_ json: String) -> DnaSettings? { json.data(using: .utf8).flatMap { try? JSONDecoder().decode(DnaSettings.self, from: $0) } }
    var json: String { (try? JSONEncoder().encode(self)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}" }
}

// MARK: - Model

@MainActor
@Observable
final class GraphModel {
    let client: EngineClient
    let feedback: ScreenFeedback
    let session: ValueStore<SessionValue>
    let folderTree: ValueStore<FoldersTreeValue>
    private(set) var store: ValueStore<GraphValue>
    var settings: DnaSettings { didSet { settingsChanged(from: oldValue) } }
    var query = ""
    var list = UserDefaults.standard.string(forKey: "folevi.graph.view") == "list" { didSet { UserDefaults.standard.set(list ? "list" : "graph", forKey: "folevi.graph.view") } }
    var insights = UserDefaults.standard.bool(forKey: "folevi.dna.insights") { didSet { UserDefaults.standard.set(insights, forKey: "folevi.dna.insights") } }
    var focusMode = UserDefaults.standard.bool(forKey: "folevi.dna.focus") { didSet { UserDefaults.standard.set(focusMode, forKey: "folevi.dna.focus") } }
    var sinceWeek = false
    var playAt: Double?
    var layoutOpen = false
    var selecting = false
    var picked: Set<String> = []
    var pins: [String: CGPoint] { didSet { savePins() } }
    /// A node the canvas glides to (search's Return, a hub in Insights).
    var glideTo: String?
    /// Opened from a route (`?note=`, `?depth=`, `?view=`).
    private var routeCenter: String?
    private var routeDepth: Int?
    private var appliedView: String?
    let weekAgo = Date().timeIntervalSince1970 * 1000 - 7 * 86_400_000

    init(client: EngineClient, feedback: ScreenFeedback) {
        self.client = client
        self.feedback = feedback
        session = client.watch(.session, snapshotKey: "session.\(client.place)")
        folderTree = client.watch(.foldersTree())
        let saved = UserDefaults.standard.string(forKey: "folevi.dna.settings.\(client.place)").flatMap(DnaSettings.read) ?? DnaSettings()
        settings = saved
        pins = Self.readPins("folevi.dna.pins.\(client.place)")
        store = client.watch(Self.args(saved))
    }

    private static func args(_ s: DnaSettings) -> Views.Graph {
        let kinds = s.kinds.flatMap { $0.isEmpty || $0.count == GraphMath.entityKinds.count ? nil : $0 }
        return .graph(kinds: kinds, spacing: s.spacing == 1 ? nil : s.spacing, pull: s.pull == 1 ? nil : s.pull)
    }

    private func settingsChanged(from old: DnaSettings) {
        UserDefaults.standard.set(settings.json, forKey: "folevi.dna.settings.\(client.place)")
        if old.kinds != settings.kinds || old.spacing != settings.spacing || old.pull != settings.pull { store = client.watch(Self.args(settings)) }
    }

    private static func readPins(_ key: String) -> [String: CGPoint] {
        guard let raw = UserDefaults.standard.dictionary(forKey: key) as? [String: [Double]] else { return [:] }
        return raw.compactMapValues { $0.count == 2 ? CGPoint(x: $0[0], y: $0[1]) : nil }
    }

    private func savePins() {
        UserDefaults.standard.set(pins.mapValues { [Double($0.x), Double($0.y)] }, forKey: "folevi.dna.pins.\(client.place)")
    }

    /// The graph is part of what this place offers.
    var available: Bool { session.value?.capabilities.graph ?? true }
    var value: GraphValue? { store.value }
    var kinds: [String] { settings.kinds.flatMap { $0.isEmpty ? nil : $0 } ?? GraphMath.entityKinds }
    var center: String? { routeCenter ?? settings.center }
    var depth: Int { routeDepth ?? Int(settings.depth) }

    /// The route's query: the note to center on, how far out, a saved view to apply.
    func apply(path: String) {
        let q = URLComponents(string: "https://x\(path)")?.queryItems ?? []
        routeCenter = q.first { $0.name == "note" }?.value
        routeDepth = q.first { $0.name == "depth" }?.value.flatMap(Int.init).map { min(3, max(1, $0)) }
        if let view = q.first(where: { $0.name == "view" })?.value, view != appliedView, let v = value?.views.first(where: { $0.id == view }), let s = DnaSettings.read(v.settings) {
            appliedView = view
            settings = s
        }
    }

    func showEverything() {
        routeCenter = nil
        routeDepth = nil
        settings.center = nil
    }

    func setDepth(_ d: Int) {
        routeDepth = d
        settings.depth = Double(d)
    }

    func center(on id: String) {
        routeCenter = id
    }

    // The map as it's shown: filtered, then around the center note when there is one.
    var shown: (nodes: [GraphNode], edges: [GraphEdge]) {
        guard let v = value else { return ([], []) }
        let f = DnaMath.filter(v.nodes, v.edges, settings.filter)
        if let c = center { return DnaMath.local(f.nodes, f.edges, center: c, depth: depth) }
        return f
    }

    var matches: Set<String> { GraphMath.match(shown.nodes, query) }

    func link(_ s: GraphSuggestion) {
        Task {
            do {
                _ = try await client.command(.graphLink(noteId: s.source, targetId: s.target))
                feedback.toast(ScreenToast("Linked", tone: .success))
            } catch { feedback.toast(ScreenToast(error.localizedDescription, tone: .error)) }
        }
    }

    func saveView(_ name: String) {
        var s = settings
        s.center = center
        s.depth = Double(depth)
        let json = s.json
        Task {
            do {
                _ = try await client.command(.graphSaveView(name: name, settings: json))
                feedback.toast(ScreenToast("Saved “\(name)”", tone: .success))
            } catch { feedback.toast(ScreenToast(error.localizedDescription, tone: .error)) }
        }
    }

    func removeView(_ v: GraphSavedView) {
        Task {
            _ = try? await client.command(.graphRemoveView(id: v.id))
            feedback.toast(ScreenToast("Removed “\(v.name)”"))
        }
    }

    func star(_ ids: [String]) {
        Task { _ = try? await client.command(.noteStar(ids: ids, starred: true)) }
    }

    func move(_ ids: [String], to folder: String?) {
        Task { _ = try? await client.command(.noteMove(ids: ids, folderId: folder)) }
    }

    func tag(_ ids: [String], tagId: String, name: String) {
        let notes = ids.compactMap { id in value?.nodes.first { $0.id == id } }.map { GraphTagNote(id: $0.id, tagIds: $0.tagIds) }
        Task {
            do {
                let r = try await client.command(.graphTag(notes: notes, tagId: tagId))
                feedback.toast(ScreenToast(r.tagged == 1 ? "Tagged 1 note #\(name)" : "Tagged \(r.tagged) notes #\(name)"))
            } catch { feedback.toast(ScreenToast(error.localizedDescription, tone: .error)) }
        }
    }
}

// MARK: - Maths

/// The web's graph maths (lib/graph/layout.ts), the same numbers.
enum GraphMath {
    static let entityKinds = ["person", "project", "organization", "topic", "decision"]
    static let filterLabel = ["person": "People", "project": "Projects", "organization": "Organizations", "topic": "Topics", "decision": "Decisions"]
    static let kindLabel = ["note": "Note", "person": "Person", "project": "Project", "organization": "Organization", "topic": "Topic", "decision": "Decision"]
    static let edgeLabel = ["link": "Linked", "mention": "Mentions", "similar": "Similar", "related": "Related", "references": "Refers to", "contradicts": "Contradicts", "supersedes": "Replaces"]
    static let minZoom: CGFloat = 0.15, maxZoom: CGFloat = 4
    static let alwaysLabelled = 12
    /// Past this many nodes the map draws less (labels for hubs only): it stays smooth (GraphView.tsx LARGE_GRAPH).
    static let large = 400

    struct Transform: Equatable { var x: CGFloat, y: CGFloat, k: CGFloat }

    static func clamp(_ k: CGFloat) -> CGFloat { min(maxZoom, max(minZoom, k)) }

    static func fit(_ points: [CGPoint], _ size: CGSize, padding: CGFloat = 36) -> Transform {
        guard let minX = points.map(\.x).min(), let maxX = points.map(\.x).max(), let minY = points.map(\.y).min(), let maxY = points.map(\.y).max(), size.width > 0, size.height > 0 else {
            return Transform(x: size.width / 2, y: size.height / 2, k: 1)
        }
        let b = (minX: minX - 20, minY: minY - 20, maxX: maxX + 20, maxY: maxY + 20)
        let w = max(1, b.maxX - b.minX), h = max(1, b.maxY - b.minY)
        let k = clamp(min((size.width - padding * 2) / w, (size.height - padding * 2) / h, 1.6))
        return Transform(x: size.width / 2 - (b.minX + b.maxX) / 2 * k, y: size.height / 2 - (b.minY + b.maxY) / 2 * k, k: k)
    }

    static func fit(_ nodes: [GraphNode], _ size: CGSize, padding: CGFloat = 36) -> Transform {
        fit(nodes.map { CGPoint(x: $0.x, y: $0.y) }, size, padding: padding)
    }

    static func zoom(_ t: Transform, _ factor: CGFloat, around p: CGPoint) -> Transform {
        let k = clamp(t.k * factor), f = k / t.k
        return Transform(x: p.x - (p.x - t.x) * f, y: p.y - (p.y - t.y) * f, k: k)
    }

    static func screen(_ t: Transform, _ p: CGPoint) -> CGPoint { CGPoint(x: p.x * t.k + t.x, y: p.y * t.k + t.y) }
    static func world(_ t: Transform, _ p: CGPoint) -> CGPoint { CGPoint(x: (p.x - t.x) / t.k, y: (p.y - t.y) / t.k) }
    static func radius(_ degree: Int, entity: Bool) -> CGFloat { min(entity ? 20 : 18, (entity ? 7 : 6) + sqrt(CGFloat(degree)) * 2.4) }
    static func drawn(_ r: CGFloat, _ k: CGFloat) -> CGFloat { max(r, 4.5 / k) }

    static func degrees(_ edges: [GraphEdge]) -> [String: Int] {
        var out: [String: Int] = [:]
        for e in edges { out[e.source, default: 0] += 1; out[e.target, default: 0] += 1 }
        return out
    }

    static func top(_ nodes: [GraphNode], _ deg: [String: Int], count: Int = alwaysLabelled) -> Set<String> {
        Set(nodes.filter { (deg[$0.id] ?? 0) > 0 }.sorted { (deg[$0.id] ?? 0) != (deg[$1.id] ?? 0) ? (deg[$0.id] ?? 0) > (deg[$1.id] ?? 0) : $0.id < $1.id }.prefix(count).map(\.id))
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

    static let clusterTints = ["color-accent", "color-moss", "color-marigold", "color-plum", "color-coral", "color-ink-muted"]

    /// A tag's colour name as a colour (WebSidebar's).
    @MainActor
    static func tagColor(_ id: String?, _ scheme: ColorScheme) -> Color {
        guard let id, id != "muted" else { return moreVar("color-ink-muted", scheme) }
        return moreVar("color-\(id)", scheme)
    }
}

/// Foli DNA's analysis (lib/graph/analysis.ts), the same rules.
enum DnaMath {
    static func filter(_ nodes: [GraphNode], _ edges: [GraphEdge], _ f: DnaFilter) -> (nodes: [GraphNode], edges: [GraphEdge]) {
        let folders: Set<String>? = (f.folders ?? []).isEmpty ? nil : Set(f.folders!)
        let tags: Set<String>? = (f.tags ?? []).isEmpty ? nil : Set(f.tags!)
        let byId = Dictionary(nodes.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let notes = Set(nodes.filter { n in
            guard n.kind == "note" else { return false }
            if let folders, !(n.folderId.map(folders.contains) ?? false) { return false }
            if let tags, !n.tagIds.contains(where: tags.contains) { return false }
            if let since = f.editedSince, (n.updatedAt ?? 0) < since { return false }
            return true
        }.map(\.id))
        var kept = edges.filter { e in (f.linksOnly != true || e.kind == "link") && (notes.contains(e.source) || notes.contains(e.target)) }
        var ids = notes
        if f.linksOnly != true {
            for e in kept {
                for (a, b) in [(e.source, e.target), (e.target, e.source)] where notes.contains(a) && !notes.contains(b) {
                    if let o = byId[b], o.kind != "note" { ids.insert(b) }
                }
            }
        }
        kept = kept.filter { ids.contains($0.source) && ids.contains($0.target) }
        if f.hideOrphans == true {
            let deg = GraphMath.degrees(kept)
            ids = ids.filter { (deg[$0] ?? 0) > 0 }
            kept = kept.filter { ids.contains($0.source) && ids.contains($0.target) }
        }
        return (nodes.filter { ids.contains($0.id) }, kept)
    }

    static func steps(_ edges: [GraphEdge], from: String, depth: Int) -> [String: Int] {
        var adj: [String: Set<String>] = [:]
        for e in edges where e.source != e.target { adj[e.source, default: []].insert(e.target); adj[e.target, default: []].insert(e.source) }
        var out = [from: 0]
        var ring = [from]
        var d = 1
        while d <= depth, !ring.isEmpty {
            var next: [String] = []
            for id in ring { for n in adj[id] ?? [] where out[n] == nil { out[n] = d; next.append(n) } }
            ring = next
            d += 1
        }
        return out
    }

    static func local(_ nodes: [GraphNode], _ edges: [GraphEdge], center: String, depth: Int) -> (nodes: [GraphNode], edges: [GraphEdge]) {
        guard nodes.contains(where: { $0.id == center }) else { return ([], []) }
        let near = steps(edges, from: center, depth: min(3, max(1, depth)))
        return (nodes.filter { near[$0.id] != nil }, edges.filter { near[$0.source] != nil && near[$0.target] != nil })
    }

    static func within(_ edges: [GraphEdge], _ id: String, _ n: Int = 2) -> Set<String> { Set(steps(edges, from: id, depth: n).keys) }

    static func orphans(_ nodes: [GraphNode], _ edges: [GraphEdge]) -> [GraphNode] {
        let deg = GraphMath.degrees(edges)
        return nodes.filter { $0.kind == "note" && (deg[$0.id] ?? 0) == 0 }.sorted { $0.label.localizedCompare($1.label) == .orderedAscending }
    }

    static func hubs(_ nodes: [GraphNode], _ edges: [GraphEdge], count: Int = 10) -> [(GraphNode, Int)] {
        let deg = GraphMath.degrees(edges)
        var ranked: [(GraphNode, Int)] = []
        for n in nodes {
            let d = deg[n.id] ?? 0
            if d > 0 { ranked.append((n, d)) }
        }
        ranked.sort { (a: (GraphNode, Int), b: (GraphNode, Int)) -> Bool in
            if a.1 != b.1 { return a.1 > b.1 }
            return a.0.label.localizedCompare(b.0.label) == .orderedAscending
        }
        return Array(ranked.prefix(count))
    }

    /// Notes made by `at` and the links made by then (other nodes follow their notes).
    static func asOf(_ nodes: [GraphNode], _ edges: [GraphEdge], _ at: Double) -> Set<String> {
        let notes = Set(nodes.filter { $0.kind == "note" && ($0.createdAt ?? 0) <= at }.map(\.id))
        var ids = notes
        let byId = Dictionary(nodes.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        for e in edges where (e.kind != "link" || (e.createdAt ?? 0) <= at) && (notes.contains(e.source) || notes.contains(e.target)) {
            for id in [e.source, e.target] where byId[id]?.kind != "note" { ids.insert(id) }
        }
        return ids
    }

    static func span(_ nodes: [GraphNode]) -> (start: Double, end: Double)? {
        let t = nodes.filter { $0.kind == "note" }.compactMap(\.createdAt)
        guard let a = t.min(), let b = t.max() else { return nil }
        return (a, b)
    }

    static func newSince(_ nodes: [GraphNode], _ edges: [GraphEdge], _ since: Double) -> Set<String> {
        var out = Set(nodes.filter { $0.kind == "note" && ($0.createdAt ?? 0) >= since }.map(\.id))
        for e in edges where e.kind == "link" && (e.createdAt ?? 0) >= since { out.insert(e.source); out.insert(e.target) }
        return out
    }

    static func markdown(_ nodes: [GraphNode], _ edges: [GraphEdge], title: String) -> String {
        let words = ["link": "links to", "mention": "mentions", "similar": "is similar to", "related": "is related to", "references": "refers to", "contradicts": "contradicts", "supersedes": "replaces"]
        let byId = Dictionary(nodes.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        func name(_ n: GraphNode) -> String { n.kind == "note" ? "[[\(n.label.isEmpty ? "Untitled" : n.label)]]" : "\(n.label) (\(n.kind))" }
        var lines = ["# \(title)", ""]
        for n in nodes.sorted(by: { ($0.kind != "note") != ($1.kind != "note") ? $0.kind == "note" : $0.label.localizedCompare($1.label) == .orderedAscending }) {
            lines.append("- \(name(n))")
            for e in edges {
                let other = e.source == n.id ? byId[e.target] : (e.target == n.id && e.kind != "link" && e.kind != "mention" ? byId[e.source] : nil)
                if let other { lines.append("  - \(words[e.kind] ?? "is joined to") \(name(other))") }
            }
        }
        return lines.joined(separator: "\n") + "\n"
    }

    static func svg(_ nodes: [GraphNode], _ edges: [GraphEdge], at: (String) -> CGPoint?, labelled: Set<String>, deg: [String: Int]) -> String {
        let pts = nodes.compactMap { at($0.id) }
        let minX = (pts.map(\.x).min() ?? 0) - 60, minY = (pts.map(\.y).min() ?? 0) - 60
        let maxX = (pts.map(\.x).max() ?? 0) + 60, maxY = (pts.map(\.y).max() ?? 0) + 60
        let colors = ["note": "#8a8a8a", "person": "#e5735b", "project": "#3b82f6", "organization": "#5d8a5e", "topic": "#d9a43a", "decision": "#8c5fa8"]
        func esc(_ s: String) -> String { s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;") }
        func f(_ v: CGFloat) -> String { String(format: "%.1f", Double(v)) }
        var out = ["<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"\(f(minX)) \(f(minY)) \(f(maxX - minX)) \(f(maxY - minY))\" width=\"\(Int(maxX - minX))\" height=\"\(Int(maxY - minY))\">", "<rect x=\"\(f(minX))\" y=\"\(f(minY))\" width=\"\(f(maxX - minX))\" height=\"\(f(maxY - minY))\" fill=\"#ffffff\"/>"]
        for e in edges {
            guard let a = at(e.source), let b = at(e.target) else { continue }
            out.append("<line x1=\"\(f(a.x))\" y1=\"\(f(a.y))\" x2=\"\(f(b.x))\" y2=\"\(f(b.y))\" stroke=\"\(e.kind == "contradicts" ? "#e5735b" : "#c9c9c9")\" stroke-width=\"1\"/>")
        }
        for n in nodes {
            guard let p = at(n.id) else { continue }
            let r = GraphMath.radius(deg[n.id] ?? 0, entity: n.kind != "note")
            out.append("<circle cx=\"\(f(p.x))\" cy=\"\(f(p.y))\" r=\"\(f(r))\" fill=\"\(colors[n.kind] ?? "#8a8a8a")\" stroke=\"#ffffff\" stroke-width=\"1.5\"/>")
            if labelled.contains(n.id) { out.append("<text x=\"\(f(p.x))\" y=\"\(f(p.y + r + 12))\" font-family=\"-apple-system, system-ui, sans-serif\" font-size=\"11.5\" text-anchor=\"middle\" fill=\"#333333\">\(esc(String((n.label.isEmpty ? "Untitled" : n.label).prefix(40))))</text>") }
        }
        out.append("</svg>")
        return out.joined(separator: "\n")
    }
}

// MARK: - Export (a file saved where the person chooses, or text on the pasteboard)

@MainActor
enum DnaExport {
    static func copy(_ text: String) {
        #if os(macOS)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        #else
        UIPasteboard.general.string = text
        #endif
    }

    static func save(_ data: Data, name: String) {
        #if os(macOS)
        let panel = NSSavePanel()
        panel.nameFieldStringValue = name
        panel.canCreateDirectories = true
        guard panel.runModal() == .OK, let url = panel.url else { return }
        try? data.write(to: url)
        #else
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
        guard (try? data.write(to: url)) != nil else { return }
        let share = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        let root = UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow }.first?.rootViewController
        var top = root
        while let next = top?.presentedViewController { top = next }
        share.popoverPresentationController?.sourceView = top?.view
        share.popoverPresentationController?.sourceRect = CGRect(x: top?.view.bounds.midX ?? 0, y: 80, width: 1, height: 1)
        top?.present(share, animated: true)
        #endif
    }
}

// MARK: - Screen

struct GraphScreen: View {
    let model: GraphModel
    let frame: FrameModel
    var path: String = "/graph"
    @Environment(\.colorScheme) private var scheme
    @State private var saveName: String?
    @State private var exporter = DnaExporter()
    /// A phone-wide screen (the iPhone, a narrow iPad window): the header stacks and Insights covers the map.
    @State private var compact = false
    private var inset: CGFloat { compact ? 16 : 24 }

    var body: some View {
        Group {
            if !model.available {
                VStack(spacing: 0) {
                    MoreEmptyState(icon: .waypoints, title: "Foli DNA isn’t available here yet", message: "It isn’t part of a library on your devices yet. Links between notes still work everywhere.")
                    Spacer(minLength: 0)
                }
            } else {
                full
            }
        }
        .accessibilityIdentifier("screen.graph")
        .onGeometryChange(for: Bool.self) { $0.size.width < 600 } action: { compact = $0 }
        .onAppear { model.apply(path: path) }
        .onChange(of: path) { _, p in model.apply(path: p) }
        .onChange(of: model.value?.views.map(\.id) ?? []) { _, _ in model.apply(path: path) }
        .overlay { if saveName != nil { savePrompt } }
    }

    private var full: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            bars
            content
        }
    }

    private var header: some View {
        let v = model.value
        let shown = model.shown
        let notes = shown.nodes.filter { $0.kind == "note" }.count
        let faint = moreVar("color-ink-faint", scheme)
        let found = model.query.trimmingCharacters(in: .whitespaces).isEmpty ? "" : " · \(model.matches.count) found"
        let more = shown.nodes.count > notes ? ", \(shown.nodes.count - notes) more" : ""
        let count = "\(notes) \(notes == 1 ? "note" : "notes")\(more)\(found)"
        return Group {
            if compact {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 8) {
                        segmented
                        Spacer(minLength: 0)
                        if v != nil { Text(verbatim: count).webText(.role(.footnote)).lineLimit(1).monospacedDigit().foregroundStyle(faint) }
                    }
                    searchField
                    if v?.full == true { ScrollView(.horizontal, showsIndicators: false) { kindChips } }
                }
            } else {
                HStack(spacing: 8) {
                    segmented
                    searchField
                    if v?.full == true { kindChips }
                    Spacer(minLength: 0)
                    if v != nil { Text(verbatim: count).webText(.role(.footnote)).lineLimit(1).monospacedDigit().foregroundStyle(faint) }
                }
            }
        }
        .padding(.horizontal, inset).padding(.top, 4).padding(.bottom, 8)
    }

    private var searchField: some View {
        HStack(spacing: 6) {
            WebIconView(.search, size: 14).foregroundStyle(moreVar("color-ink-faint", scheme))
            TextField("Find in Foli DNA", text: Bindable(model).query).textFieldStyle(.plain).webText(.role(.subheadline))
                .onSubmit { if let first = model.matches.sorted().first { model.glideTo = first } }
        }
        .padding(.horizontal, 10)
        .frame(minWidth: 160, maxWidth: compact ? .infinity : 320)
        .frame(height: compact ? 36 : 32)
        .webBox(WebStyles.named("input"))
    }

    @ViewBuilder private var bars: some View {
        let v = model.value
        let muted = moreVar("color-ink-muted", scheme)
        if let v { filterBar(v).padding(.horizontal, inset).padding(.bottom, 8) }
        if model.layoutOpen { layoutPanel.padding(.horizontal, inset).padding(.bottom, 8) }
        if let c = model.center.flatMap({ c in v?.nodes.first { $0.id == c } }) { aroundBar(c).padding(.horizontal, inset).padding(.bottom, 8) }
        if let v, v.note != nil || v.truncated {
            VStack(alignment: .leading, spacing: 0) {
                if let note = v.note { Text(verbatim: note).webText(.role(.subheadline)).foregroundStyle(muted) }
                if v.truncated { Text(verbatim: "Showing the most recently edited notes.").webText(.role(.subheadline)).foregroundStyle(muted) }
            }
            .padding(.horizontal, inset).padding(.bottom, 8)
        }
        if let v, model.settings.colorBy != "kind" { legend(v).padding(.horizontal, inset).padding(.bottom, 8) }
    }

    @ViewBuilder private var content: some View {
        if let v = model.value {
            let shown = model.shown
            if v.nodes.isEmpty {
                MoreEmptyState(icon: .waypoints, title: "No notes here yet", message: "Notes and the links between them show up here.").frame(maxHeight: .infinity)
            } else if shown.nodes.isEmpty {
                MoreEmptyState(icon: nil, title: "Nothing matches these filters").frame(maxHeight: .infinity)
            } else if model.list {
                GraphListView(nodes: shown.nodes, edges: shown.edges, query: model.query, open: { frame.open(.note($0)) })
            } else {
                if compact {
                    // The phone: Insights covers the map (no room for a side column).
                    ZStack {
                        GraphCanvasView(model: model, value: v, nodes: shown.nodes, edges: shown.edges, frame: frame, exporter: exporter)
                        if model.insights {
                            DnaInsightsView(model: model, value: v, nodes: shown.nodes, edges: shown.edges, frame: frame, wide: true)
                                .background(moreVar("color-canvas", scheme))
                                .transition(.move(edge: .bottom))
                        }
                    }
                } else {
                    HStack(spacing: 0) {
                        GraphCanvasView(model: model, value: v, nodes: shown.nodes, edges: shown.edges, frame: frame, exporter: exporter)
                        if model.insights { DnaInsightsView(model: model, value: v, nodes: shown.nodes, edges: shown.edges, frame: frame) }
                    }
                }
            }
        } else {
            Text(verbatim: "Loading Foli DNA…").webText(.role(.subheadline)).foregroundStyle(moreVar("color-ink-muted", scheme)).frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private var segmented: some View {
        HStack(spacing: 0) {
            segment("Map", on: !model.list) { model.list = false }
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
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private var kindChips: some View {
        HStack(spacing: 4) {
            ForEach(GraphMath.entityKinds, id: \.self) { k in
                let on = model.kinds.contains(k)
                chip(GraphMath.filterLabel[k] ?? k, on: on, glyph: k) {
                    model.settings.kinds = on ? model.kinds.filter { $0 != k } : GraphMath.entityKinds.filter { $0 == k || model.kinds.contains($0) }
                }
            }
        }
    }

    private func chip(_ title: String, on: Bool, glyph: String? = nil, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let glyph { KindGlyph(kind: glyph, muted: !on) }
                Text(verbatim: title).webText(WebStyles.named("chip").resolve(scheme).text).lineLimit(1)
            }
            .foregroundStyle(on ? moreVar("color-heading", scheme) : moreVar("color-ink-faint", scheme))
            .webElement(WebStyles.named("chip"))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private static let edited: [(id: String, title: String, days: Double?)] = [("any", "Edited any time", nil), ("7", "Edited this week", 7), ("30", "Edited this month", 30), ("90", "Edited in 3 months", 90), ("365", "Edited this year", 365)]

    private func filterBar(_ v: GraphValue) -> some View {
        let f = model.settings.filter
        let now = Date().timeIntervalSince1970 * 1000
        let editedId = Self.edited.first { e in e.days != nil && f.editedSince != nil && abs(now - e.days! * 86_400_000 - f.editedSince!) < 86_400_000 }?.id ?? "any"
        let folderId = f.folders?.first ?? ""
        let tagId = f.tags?.first ?? ""
        let base = DnaMath.filter(v.nodes, v.edges, DnaFilter(folders: f.folders, tags: f.tags, editedSince: f.editedSince, linksOnly: f.linksOnly))
        let orphanCount = DnaMath.orphans(base.nodes, base.edges).count
        let span = DnaMath.span(model.shown.nodes)
        let colorTitles = ["kind": "Colour by kind", "folder": "Colour by folder", "tag": "Colour by tag"]
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                WebBareSelect(label: v.folders.first { $0.id == folderId }?.name ?? "All folders", options: [("", "All folders")] + v.folders.map { ($0.id, $0.name) }, selected: folderId) { id in model.settings.filter.folders = id.isEmpty ? [] : [id] }
                WebBareSelect(label: v.tags.first { $0.id == tagId }.map { "#\($0.name)" } ?? "Any tag", options: [("", "Any tag")] + v.tags.map { ($0.id, "#\($0.name)") }, selected: tagId) { id in model.settings.filter.tags = id.isEmpty ? [] : [id] }
                WebBareSelect(label: Self.edited.first { $0.id == editedId }?.title ?? "Edited any time", options: Self.edited.map { ($0.id, $0.title) }, selected: editedId) { id in
                    let days = Self.edited.first { $0.id == id }?.days ?? nil
                    model.settings.filter.editedSince = days.map { Date().timeIntervalSince1970 * 1000 - $0 * 86_400_000 }
                }
                WebBareSelect(label: colorTitles[model.settings.colorBy] ?? "Colour by kind", options: [("kind", "Colour by kind"), ("folder", "Colour by folder"), ("tag", "Colour by tag")], selected: model.settings.colorBy) { model.settings.colorBy = $0 }
                if v.full { chip("Foli AI’s finds", on: f.linksOnly != true) { model.settings.filter.linksOnly = f.linksOnly == true ? false : true } }
                chip(orphanCount > 0 ? "Unlinked notes (\(orphanCount))" : "Unlinked notes", on: f.hideOrphans != true) { model.settings.filter.hideOrphans = f.hideOrphans == true ? false : true }
                chip("Clusters", on: model.settings.clusters) { model.settings.clusters.toggle() }
                chip("Arrows", on: model.settings.arrows) { model.settings.arrows.toggle() }
                chip("Focus", on: model.focusMode) { model.focusMode.toggle() }
                chip("New this week", on: model.sinceWeek) { model.sinceWeek.toggle() }
                WebIconButton(model.playAt == nil ? .play : .pause, label: model.playAt == nil ? "Play how it grew" : "Stop") {
                    model.playAt = model.playAt == nil ? span?.start : nil
                }
                .disabled(span == nil || span?.start == span?.end)
                WebIconButton(.slidersHorizontal, label: "Layout", pressed: model.layoutOpen) { model.layoutOpen.toggle() }
                WebIconButton(.chartNetwork, label: "Insights", pressed: model.insights) { model.insights.toggle() }
                WebMenuButton(entries: { exportEntries }) { WebIconView(.download, size: 16).frame(width: 32, height: 32).contentShape(Rectangle()) }
                    .accessibilityLabel("Export")
                WebMenuButton(entries: { viewEntries(v) }) {
                    Text(verbatim: "Views").webText(.role(.subheadline)).foregroundStyle(moreVar("color-ink", scheme)).padding(.horizontal, 8).frame(height: 32).contentShape(Rectangle())
                }
            }
        }
        .task(id: model.playAt) {
            guard let at = model.playAt, let s = span else { return }
            if at >= s.end {
                try? await Task.sleep(for: .milliseconds(1200))
                model.playAt = nil
                return
            }
            try? await Task.sleep(for: .milliseconds(16))
            if model.playAt != nil { model.playAt = min(s.end, at + max(1, (s.end - s.start) / 480)) }
        }
    }

    private var exportEntries: [WebMenuEntry] {
        [
            WebMenuEntry(.item("Save as PNG")) { if let png = exporter.png?() { DnaExport.save(png, name: "Foli DNA.png") } },
            WebMenuEntry(.item("Save as SVG")) { if let d = exporter.svg?().data(using: .utf8) { DnaExport.save(d, name: "Foli DNA.svg") } },
            WebMenuEntry(.item("Copy as Markdown")) {
                let s = model.shown
                let title = model.center.flatMap { c in model.value?.nodes.first { $0.id == c } }.map { "Foli DNA of \($0.label)" } ?? "Foli DNA"
                DnaExport.copy(DnaMath.markdown(s.nodes, s.edges, title: title))
                model.feedback.toast(ScreenToast("Copied as Markdown"))
            },
        ]
    }

    private func viewEntries(_ v: GraphValue) -> [WebMenuEntry] {
        var out = [WebMenuEntry(.item("Save this view…")) { saveName = model.center.flatMap { c in v.nodes.first { $0.id == c } }.map { "Around \($0.label)" } ?? "" }]
        if !v.views.isEmpty { out.append(.separator()) }
        for view in v.views {
            out.append(WebMenuEntry(.item(view.name)) { if let s = DnaSettings.read(view.settings) { model.settings = s } })
        }
        if !v.views.isEmpty {
            out.append(.separator(1))
            for view in v.views { out.append(WebMenuEntry(.item("Remove “\(view.name)”", danger: true)) { model.removeView(view) }) }
        }
        return out
    }

    private var layoutPanel: some View {
        HStack(spacing: 16) {
            stepper("Spacing", value: model.settings.spacing, step: 0.1, range: 0.5...2) { model.settings.spacing = $0 }
            stepper("Pull to the middle", value: model.settings.pull, step: 0.25, range: 0.25...3) { model.settings.pull = $0 }
            WebButton("Reset layout", variant: .quiet, size: .sm) {
                model.settings.spacing = 1
                model.settings.pull = 1
                model.pins = [:]
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .webBox(WebStyles.named("menu.panel"))
    }

    /// A Folevi-drawn − value + control (no OS slider).
    private func stepper(_ title: String, value: Double, step: Double, range: ClosedRange<Double>, set: @escaping (Double) -> Void) -> some View {
        let less = { set(max(range.lowerBound, ((value - step) * 100).rounded() / 100)) }
        let more = { set(min(range.upperBound, ((value + step) * 100).rounded() / 100)) }
        return HStack(spacing: 6) {
            Text(verbatim: title).webText(.role(.subheadline)).foregroundStyle(moreVar("color-ink", scheme))
            WebIconButton(.minus, label: "Less") { less() }
            Text(verbatim: String(format: "%.2g", value)).webText(.role(.subheadline)).monospacedDigit().frame(minWidth: 28)
            WebIconButton(.plus, label: "More") { more() }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(title)
        .accessibilityValue(String(format: "%.2g", value))
        .accessibilityAdjustableAction { d in if d == .increment { more() } else { less() } }
    }

    private func aroundBar(_ c: GraphNode) -> some View {
        HStack(spacing: 8) {
            Text(verbatim: "Around").webText(.role(.subheadline)).foregroundStyle(moreVar("color-ink-muted", scheme))
            Button { frame.open(.note(c.id)) } label: {
                Text(verbatim: c.label.isEmpty ? "Untitled" : c.label).webText(.role(.subheadline, weight: 500)).foregroundStyle(moreVar("color-heading", scheme))
            }
            .buttonStyle(.plain)
            HStack(spacing: 0) {
                ForEach(1...3, id: \.self) { d in segment(d == 1 ? "1 step" : "\(d) steps", on: model.depth == d) { model.setDepth(d) } }
            }
            .padding(2)
            .webBox(WebStyles.named("input"))
            WebButton("Show everything", variant: .quiet, size: .sm) { model.showEverything() }
        }
    }

    private func legend(_ v: GraphValue) -> some View {
        let groups: [(String, String, Color)] = model.settings.colorBy == "folder" ? v.folders.map { ($0.id, $0.name, FolderColor.resolve($0.color).color.color) } : v.tags.map { ($0.id, "#\($0.name)", GraphMath.tagColor($0.color, scheme)) }
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                ForEach(Array(groups.prefix(16)), id: \.0) { g in
                    HStack(spacing: 6) {
                        RoundedRectangle(cornerRadius: 3, style: .circular).fill(g.2).frame(width: 10, height: 10)
                        Text(verbatim: g.1).webText(.role(.footnote)).foregroundStyle(moreVar("color-ink-muted", scheme))
                    }
                }
            }
        }
        .accessibilityLabel("Colours")
    }

    private var savePrompt: some View {
        ZStack {
            Color.black.opacity(0.18).ignoresSafeArea().onTapGesture { saveName = nil }
            VStack(alignment: .leading, spacing: 12) {
                Text(verbatim: "Save this view").webText(.role(.headline)).foregroundStyle(moreVar("color-heading", scheme))
                TextField("Name", text: Binding(get: { saveName ?? "" }, set: { saveName = $0 }))
                    .textFieldStyle(.plain).webText(.role(.body))
                    .padding(.horizontal, 10).frame(height: 34)
                    .webBox(WebStyles.named("input"))
                    .onSubmit(save)
                HStack {
                    Spacer()
                    WebButton("Cancel", variant: .quiet) { saveName = nil }
                    WebButton("Save", variant: .primary) { save() }
                }
            }
            .padding(16)
            .frame(width: 320)
            .webBox(WebStyles.named("menu.panel"))
        }
    }

    private func save() {
        let name = (saveName ?? "").trimmingCharacters(in: .whitespaces)
        saveName = nil
        guard !name.isEmpty else { return }
        model.saveView(name)
    }
}

/// What the export menu reads from the map on screen (set by the canvas).
@MainActor
final class DnaExporter {
    var svg: (() -> String)?
    var png: (() -> Data?)?
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

// MARK: - Canvas

/// The map itself: quiet edges, nodes sized by their connections, the best-connected labelled, entities shaped by
/// kind, clusters shaded behind, suggested links dashed; the hovered or focused node and its neighbours stand out.
struct GraphCanvasView: View {
    let model: GraphModel
    let value: GraphValue
    let nodes: [GraphNode]
    let edges: [GraphEdge]
    let frame: FrameModel
    let exporter: DnaExporter
    @Environment(\.colorScheme) private var scheme
    @State private var t = GraphMath.Transform(x: 0, y: 0, k: 1)
    @State private var moved = false
    @State private var size: CGSize = .zero
    @State private var hover: String?
    @State private var selected: String?
    @State private var focusedNode: String?
    @State private var dragStart: GraphMath.Transform?
    @State private var dragNode: DragNode?
    @State private var box: CGRect?
    @State private var pinchStart: GraphMath.Transform?
    @State private var offer: Offer?
    @FocusState private var focused: Bool

    struct DragNode: Equatable { var id: String; var at: CGPoint }
    struct Offer: Equatable { var s: GraphSuggestion; var at: CGPoint }

    private var byId: [String: GraphNode] { Dictionary(nodes.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a }) }

    /// Where a node is: dragged, pinned, or as laid out.
    private func at(_ id: String) -> CGPoint? {
        if let d = dragNode, d.id == id { return d.at }
        if let p = model.pins[id] { return p }
        return byId[id].map { CGPoint(x: $0.x, y: $0.y) }
    }

    private var points: [CGPoint] { nodes.compactMap { at($0.id) } }
    private var searching: Bool { !model.query.trimmingCharacters(in: .whitespaces).isEmpty }
    private var matches: Set<String> { GraphMath.match(nodes, model.query) }

    var body: some View {
        let deg = GraphMath.degrees(edges)
        let large = nodes.count > GraphMath.large
        let labelled = GraphMath.top(nodes, deg, count: large ? 8 : GraphMath.alwaysLabelled)
        let focus = hover ?? focusedNode ?? selected ?? model.center.flatMap { byId[$0] != nil ? $0 : nil }
        let near: Set<String>? = focus.map { model.focusMode ? DnaMath.within(edges, $0, 2) : Set([$0]).union(GraphMath.neighbours(edges, $0)) }
        let visible: Set<String>? = model.playAt.map { DnaMath.asOf(nodes, edges, $0) }
        let fresh: Set<String>? = model.sinceWeek ? DnaMath.newSince(nodes, edges, model.weekAgo) : nil
        let ids = Set(nodes.map(\.id))
        let suggested = model.settings.filter.linksOnly == true ? [] : value.suggested.filter { ids.contains($0.source) && ids.contains($0.target) }
        let notes = nodes.filter { $0.kind == "note" }.count
        let sparse: String? = notes < 3 ? "Foli DNA grows as you write. Notes show up here, and lines join the ones that link to each other." : edges.isEmpty ? "None of these notes link to each other yet. Type [[ in a note to link another one, and a line joins them here." : nil
        GeometryReader { geo in
            ZStack(alignment: .topLeading) {
                Canvas { ctx, _ in
                    draw(&ctx, deg: deg, labelled: labelled, near: near, visible: visible, fresh: fresh, suggested: suggested, large: large)
                }
                .contentShape(Rectangle())
                .gesture(drag)
                .simultaneousGesture(MagnifyGesture().onChanged { g in
                    if pinchStart == nil { pinchStart = t }
                    moved = true
                    t = GraphMath.zoom(pinchStart!, g.magnification, around: g.startLocation)
                }.onEnded { _ in pinchStart = nil })
                .onTapGesture(count: 2, coordinateSpace: .local) { p in
                    if let id = hit(p), model.pins[id] != nil { model.pins[id] = nil }
                }
                .onTapGesture(coordinateSpace: .local) { p in tap(p, suggested: suggested) }
                .onContinuousHover { phase in
                    if case .active(let p) = phase { hover = hit(p) } else { hover = nil }
                }
                .background(ScrollWheelCatcher { delta, at in
                    moved = true
                    t = GraphMath.zoom(t, exp(delta * 0.0015), around: at)
                })
                .accessibilityElement(children: .contain)
                .accessibilityLabel("Foli DNA of \(notes) notes and \(nodes.count - notes) people, projects and topics")
                .accessibilityChildren {
                    // Every node for VoiceOver (its rotor moves through them), as the web's node buttons.
                    ForEach(nodes.filter { visible?.contains($0.id) ?? true }, id: \.id) { n in
                        Rectangle().fill(Color.clear)
                            .accessibilityElement()
                            .accessibilityLabel(nodeLabel(n, deg[n.id] ?? 0))
                            .accessibilityAddTraits(.isButton)
                            .accessibilityAction { activate(n.id) }
                    }
                }
                if let box {
                    Rectangle().fill(moreVar("color-accent", scheme).opacity(0.08)).overlay(Rectangle().stroke(moreVar("color-accent", scheme), lineWidth: 1))
                        .frame(width: box.width, height: box.height).offset(x: box.minX, y: box.minY).allowsHitTesting(false)
                }
                if let sparse {
                    Text(verbatim: sparse).webText(.role(.subheadline)).foregroundStyle(moreVar("color-ink-muted", scheme))
                        .padding(.horizontal, 12).padding(.vertical, 8)
                        .frame(maxWidth: min(340, geo.size.width - 80), alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 10, style: .circular).fill(moreVar("glass-hover", scheme)))
                        .padding(12)
                        .allowsHitTesting(false)
                }
                if let playAt = model.playAt {
                    Text(verbatim: Date(timeIntervalSince1970: playAt / 1000).formatted(.dateTime.month(.abbreviated).year()))
                        .webText(.role(.subheadline)).monospacedDigit().foregroundStyle(moreVar("color-heading", scheme))
                        .padding(.horizontal, 12).padding(.vertical, 4)
                        .background(RoundedRectangle(cornerRadius: 10, style: .circular).fill(moreVar("glass-hover", scheme)))
                        .frame(maxWidth: .infinity).padding(.top, 12).allowsHitTesting(false)
                }
                if let id = hover ?? focusedNode, let n = byId[id], let p = at(id) { tooltip(n, GraphMath.screen(t, p)) }
                if let id = selected, let n = byId[id] { entityCard(n) }
                if let o = offer { offerCard(o.s, at: o.at) }
                if !model.picked.isEmpty { selectionBar.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom).padding(12) }
                zoomButtons.frame(maxWidth: .infinity, alignment: .topTrailing).padding(12)
            }
            .onAppear {
                size = geo.size
                t = GraphMath.fit(points, geo.size)
                hookExport(deg: deg, labelled: labelled)
            }
            .onChange(of: geo.size) { _, s in size = s; if !moved { t = GraphMath.fit(points, s) } }
            .onChange(of: nodes.map(\.id)) { _, _ in
                if !moved { t = GraphMath.fit(points, size) }
                hookExport(deg: deg, labelled: labelled)
            }
            .onChange(of: model.glideTo) { _, id in
                guard let id else { return }
                glide(to: id)
                model.glideTo = nil
            }
        }
        .focusable()
        .focusEffectDisabled()
        .focused($focused)
        .onKeyPress(phases: .down) { press in key(press) }
    }

    private func nodeLabel(_ n: GraphNode, _ d: Int) -> String {
        "\(n.label.isEmpty ? "Untitled" : n.label), \(n.kind == "note" ? "note" : (GraphMath.kindLabel[n.kind] ?? "Topic").lowercased()), \(d) \(d == 1 ? "connection" : "connections")"
    }

    private func hookExport(deg: [String: Int], labelled: Set<String>) {
        let nodes = nodes, edges = edges
        let place = { (id: String) in self.at(id) }
        exporter.svg = { DnaMath.svg(nodes, edges, at: place, labelled: labelled, deg: deg) }
        exporter.png = { self.png(deg: deg, labelled: labelled) }
    }

    // MARK: drawing

    private func colorOf(_ n: GraphNode) -> Color {
        if n.kind != "note" || model.settings.colorBy == "kind" { return moreVar(GraphMath.colorVar(n.kind), scheme) }
        if model.settings.colorBy == "folder" {
            guard let f = n.folderId, let g = value.folders.first(where: { $0.id == f }) else { return moreVar("color-line-strong", scheme) }
            return FolderColor.resolve(g.color).color.color
        }
        guard let tg = n.tagIds.first, let g = value.tags.first(where: { $0.id == tg }) else { return moreVar("color-line-strong", scheme) }
        return GraphMath.tagColor(g.color, scheme)
    }

    private func draw(_ ctx: inout GraphicsContext, deg: [String: Int], labelled: Set<String>, near: Set<String>?, visible: Set<String>?, fresh: Set<String>?, suggested: [GraphSuggestion], large: Bool) {
        let k = t.k
        let shows = { (id: String) in visible?.contains(id) ?? true }
        // Clusters: a faint wash behind each, and its name above.
        if model.settings.clusters {
            for c in value.clusters.prefix(12) {
                let pts = nodes.filter { $0.cluster == c.id && shows($0.id) }.compactMap { at($0.id) }
                guard pts.count >= 3 else { continue }
                let cx = pts.map(\.x).reduce(0, +) / CGFloat(pts.count), cy = pts.map(\.y).reduce(0, +) / CGFloat(pts.count)
                let r = (pts.map { hypot($0.x - cx, $0.y - cy) }.max() ?? 0) + 28
                let center = GraphMath.screen(t, CGPoint(x: cx, y: cy))
                let tint = moreVar(GraphMath.clusterTints[c.id % GraphMath.clusterTints.count], scheme)
                ctx.fill(Path(ellipseIn: CGRect(x: center.x - r * k, y: center.y - r * k, width: r * k * 2, height: r * k * 2)), with: .color(tint.opacity(0.06)))
                ctx.draw(Text(verbatim: c.name).font(WebFont.font(.sans, size: 12, weight: 600)).foregroundColor(tint), at: CGPoint(x: center.x, y: center.y - r * k - 6), anchor: .bottom)
            }
        }
        let dups = Set(value.duplicates.map { [$0.a, $0.b].sorted().joined(separator: ":") })
        var quiet = Path()
        for e in edges {
            guard shows(e.source), shows(e.target), let a0 = at(e.source), let b0 = at(e.target) else { continue }
            let a = GraphMath.screen(t, a0), b = GraphMath.screen(t, b0)
            let on = near.map { $0.contains(e.source) && $0.contains(e.target) } ?? (!searching || (matches.contains(e.source) && matches.contains(e.target)))
            let dup = dups.contains([e.source, e.target].sorted().joined(separator: ":"))
            let arrow = model.settings.arrows && e.kind == "link"
            let special = e.kind == "contradicts" || e.kind == "supersedes" || dup || (e.inferred && e.kind != "mention") || arrow
            if !special && on && near == nil {
                quiet.move(to: a)
                quiet.addLine(to: b)
                continue
            }
            var end = b
            if arrow {
                let d = max(1, hypot(b.x - a.x, b.y - a.y))
                let r = GraphMath.drawn(GraphMath.radius(deg[e.target] ?? 0, entity: byId[e.target]?.kind != "note"), k) * k + 2
                end = CGPoint(x: b.x - (b.x - a.x) / d * r, y: b.y - (b.y - a.y) / d * r)
            }
            var p = Path()
            p.move(to: a)
            p.addLine(to: end)
            let color = moreVar(e.kind == "contradicts" ? "color-coral" : e.kind == "supersedes" || dup ? "color-plum" : "color-line-strong", scheme)
            let dash: [CGFloat] = dup ? [1, 3] : e.inferred && e.kind != "mention" ? [4, 3] : []
            ctx.stroke(p, with: .color(color.opacity(on ? (near != nil ? 0.9 : 0.45) : 0.07)), style: StrokeStyle(lineWidth: e.kind == "link" ? 1.2 : 1, dash: dash))
            if arrow {
                let ang = atan2(end.y - a.y, end.x - a.x)
                var head = Path()
                head.move(to: end)
                head.addLine(to: CGPoint(x: end.x - cos(ang - 0.45) * 7, y: end.y - sin(ang - 0.45) * 7))
                head.addLine(to: CGPoint(x: end.x - cos(ang + 0.45) * 7, y: end.y - sin(ang + 0.45) * 7))
                head.closeSubpath()
                ctx.fill(head, with: .color(color.opacity(on ? 0.9 : 0.2)))
            }
        }
        ctx.stroke(quiet, with: .color(moreVar("color-line-strong", scheme).opacity(0.45)), lineWidth: 1.2)
        // Suggested links: dashed accent lines.
        for s in suggested where shows(s.source) && shows(s.target) {
            guard let a = at(s.source), let b = at(s.target) else { continue }
            var p = Path()
            p.move(to: GraphMath.screen(t, a))
            p.addLine(to: GraphMath.screen(t, b))
            let on = near.map { $0.contains(s.source) && $0.contains(s.target) } ?? true
            ctx.stroke(p, with: .color(moreVar("color-accent", scheme).opacity(on ? 0.8 : 0.1)), style: StrokeStyle(lineWidth: 1.2, dash: [2, 4]))
        }
        let canvas = moreVar("color-canvas", scheme), heading = moreVar("color-heading", scheme), ink = moreVar("color-ink", scheme)
        let dim: CGFloat = model.focusMode ? 0.06 : 0.25
        for n in nodes where shows(n.id) {
            guard let p = at(n.id) else { continue }
            let entity = n.kind != "note"
            let r = GraphMath.drawn(GraphMath.radius(deg[n.id] ?? 0, entity: entity), k) * k
            let c = GraphMath.screen(t, p)
            let on = near.map { $0.contains(n.id) } ?? (searching ? matches.contains(n.id) : true)
            var layer = ctx
            layer.opacity = on ? 1 : dim
            if fresh?.contains(n.id) == true { layer.fill(Path(ellipseIn: CGRect(x: c.x - r - 5, y: c.y - r - 5, width: (r + 5) * 2, height: (r + 5) * 2)), with: .color(moreVar("color-marigold", scheme).opacity(0.35))) }
            if model.settings.clusters, n.bridge { layer.stroke(Path(ellipseIn: CGRect(x: c.x - r - 3, y: c.y - r - 3, width: (r + 3) * 2, height: (r + 3) * 2)), with: .color(moreVar("color-accent", scheme)), style: StrokeStyle(lineWidth: 1.5, dash: [2, 2])) }
            let picked = model.picked.contains(n.id)
            let path = GraphMath.shape(n.kind, r, at: c) ?? Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2))
            layer.fill(path, with: .color(colorOf(n)))
            layer.stroke(path, with: .color(n.id == selected || picked ? heading : canvas), lineWidth: picked ? 2.5 : 1.5)
            if model.pins[n.id] != nil { layer.fill(Path(ellipseIn: CGRect(x: c.x - 2, y: c.y - r - 5, width: 4, height: 4)), with: .color(heading)) }
            if n.id == focusedNode {
                layer.stroke(Path(ellipseIn: CGRect(x: c.x - r - 4, y: c.y - r - 4, width: (r + 4) * 2, height: (r + 4) * 2)), with: .color(moreVar("color-focus", scheme)), lineWidth: 2.5)
            }
            let showLabel = on && (k >= 1.3 || labelled.contains(n.id) || (near?.contains(n.id) ?? false) || (searching && matches.contains(n.id)) || n.id == model.center)
            if showLabel, n.id != hover, n.id != focusedNode {
                let label = String((n.label.isEmpty ? "Untitled" : n.label).prefix(40))
                let spot = CGPoint(x: c.x, y: c.y + r + 12)
                // The label's halo (paint-order: stroke), then the label; big maps skip the halo.
                if !large {
                    for (dx, dy) in [(-1.5, 0.0), (1.5, 0.0), (0.0, -1.5), (0.0, 1.5)] {
                        layer.draw(Text(verbatim: label).font(WebFont.font(.sans, size: 11.5)).foregroundColor(canvas), at: CGPoint(x: spot.x + dx, y: spot.y + dy), anchor: .bottom)
                    }
                }
                layer.draw(Text(verbatim: label).font(WebFont.font(.sans, size: 11.5)).foregroundColor(ink), at: spot, anchor: .bottom)
            }
        }
    }

    /// The map drawn at 2x for Save as PNG.
    private func png(deg: [String: Int], labelled: Set<String>) -> Data? {
        let s = CGSize(width: max(size.width, 600), height: max(size.height, 400))
        let fitT = GraphMath.fit(points, s)
        let places = Dictionary(nodes.compactMap { n in at(n.id).map { (n.id, $0) } }, uniquingKeysWith: { a, _ in a })
        let colors = Dictionary(nodes.map { ($0.id, colorOf($0)) }, uniquingKeysWith: { a, _ in a })
        let nodes = nodes, edges = edges
        let snapshot = Canvas { ctx, _ in
            ctx.fill(Path(CGRect(origin: .zero, size: s)), with: .color(.white))
            for e in edges {
                guard let a = places[e.source], let b = places[e.target] else { continue }
                var p = Path()
                p.move(to: GraphMath.screen(fitT, a))
                p.addLine(to: GraphMath.screen(fitT, b))
                ctx.stroke(p, with: .color(.gray.opacity(0.5)), lineWidth: 1)
            }
            for n in nodes {
                guard let p = places[n.id] else { continue }
                let r = GraphMath.radius(deg[n.id] ?? 0, entity: n.kind != "note") * fitT.k
                let c = GraphMath.screen(fitT, p)
                ctx.fill(GraphMath.shape(n.kind, r, at: c) ?? Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)), with: .color(colors[n.id] ?? .gray))
                if labelled.contains(n.id) {
                    ctx.draw(Text(verbatim: String((n.label.isEmpty ? "Untitled" : n.label).prefix(40))).font(.system(size: 11.5)).foregroundColor(.black), at: CGPoint(x: c.x, y: c.y + r + 12), anchor: .bottom)
                }
            }
        }
        .frame(width: s.width, height: s.height)
        let renderer = ImageRenderer(content: snapshot)
        renderer.scale = 2
        #if os(macOS)
        guard let img = renderer.nsImage, let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff) else { return nil }
        return rep.representation(using: .png, properties: [:])
        #else
        return renderer.uiImage?.pngData()
        #endif
    }

    // MARK: input

    private var shiftHeld: Bool {
        #if os(macOS)
        NSEvent.modifierFlags.contains(.shift)
        #else
        false
        #endif
    }

    private var commandHeld: Bool {
        #if os(macOS)
        NSEvent.modifierFlags.contains(.command)
        #else
        false
        #endif
    }

    /// Drag a node to pin it; with Shift or in Select mode draw a box that picks notes; else pan.
    private var drag: some Gesture {
        DragGesture(minimumDistance: 5).onChanged { g in
            if dragStart == nil && dragNode == nil && box == nil {
                if let id = hit(g.startLocation) {
                    dragNode = DragNode(id: id, at: GraphMath.world(t, g.location))
                    return
                }
                if shiftHeld || model.selecting {
                    box = CGRect(origin: g.startLocation, size: .zero)
                    return
                }
                dragStart = t
            }
            if let d = dragNode {
                dragNode = DragNode(id: d.id, at: GraphMath.world(t, g.location))
            } else if box != nil {
                box = CGRect(x: min(g.startLocation.x, g.location.x), y: min(g.startLocation.y, g.location.y), width: abs(g.location.x - g.startLocation.x), height: abs(g.location.y - g.startLocation.y))
            } else if let s = dragStart {
                moved = true
                t = GraphMath.Transform(x: s.x + g.translation.width, y: s.y + g.translation.height, k: t.k)
            }
        }.onEnded { _ in
            if let d = dragNode { model.pins[d.id] = d.at }
            if let b = box {
                let inside = nodes.filter { n in n.kind == "note" && (at(n.id).map { b.contains(GraphMath.screen(t, $0)) } ?? false) }.map(\.id)
                model.picked.formUnion(inside)
            }
            dragNode = nil
            box = nil
            dragStart = nil
        }
    }

    private func tap(_ p: CGPoint, suggested: [GraphSuggestion]) {
        offer = nil
        guard let id = hit(p) else {
            // A suggested link's dashed line, near enough.
            for s in suggested {
                guard let a0 = at(s.source), let b0 = at(s.target) else { continue }
                let a = GraphMath.screen(t, a0), b = GraphMath.screen(t, b0)
                let l2 = max(1, pow(b.x - a.x, 2) + pow(b.y - a.y, 2))
                let u = max(0, min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2))
                if hypot(p.x - (a.x + u * (b.x - a.x)), p.y - (a.y + u * (b.y - a.y))) < 8 {
                    offer = Offer(s: s, at: p)
                    return
                }
            }
            selected = nil
            if !shiftHeld { model.picked = [] }
            return
        }
        if shiftHeld || model.selecting, byId[id]?.kind == "note" {
            if model.picked.contains(id) { model.picked.remove(id) } else { model.picked.insert(id) }
            return
        }
        activate(id, newTab: commandHeld)
    }

    private func hit(_ p: CGPoint) -> String? {
        var best: (String, CGFloat)?
        let deg = GraphMath.degrees(edges)
        let visible: Set<String>? = model.playAt.map { DnaMath.asOf(nodes, edges, $0) }
        for n in nodes where visible?.contains(n.id) ?? true {
            guard let q = at(n.id) else { continue }
            let r = max(GraphMath.radius(deg[n.id] ?? 0, entity: n.kind != "note"), 12 / t.k) * t.k
            let c = GraphMath.screen(t, q)
            let d = hypot(c.x - p.x, c.y - p.y)
            if d <= r, d < (best?.1 ?? .infinity) { best = (n.id, d) }
        }
        return best?.0
    }

    private func activate(_ id: String, newTab: Bool = false) {
        guard let n = byId[id] else { return }
        if n.kind == "note" { frame.open(.note(n.id), newTab ? .newTab : .replace) } else { selected = selected == n.id ? nil : n.id }
    }

    /// Moves the view to `id`, zoomed in enough to read.
    private func glide(to id: String) {
        guard let p = at(id), size.width > 0 else { return }
        moved = true
        let k = max(t.k, 1.4)
        withAnimation(.easeOut(duration: 0.32)) { t = GraphMath.Transform(x: size.width / 2 - p.x * k, y: size.height / 2 - p.y * k, k: k) }
        focusedNode = id
    }

    private func key(_ press: KeyPress) -> KeyPress.Result {
        let dirs: [KeyEquivalent: (CGFloat, CGFloat)] = [.leftArrow: (-1, 0), .rightArrow: (1, 0), .upArrow: (0, -1), .downArrow: (0, 1)]
        let deg = GraphMath.degrees(edges)
        if let (ax, ay) = dirs[press.key] {
            if let from = focusedNode ?? GraphMath.top(nodes, deg).first ?? nodes.first?.id, !press.modifiers.contains(.shift), let p = at(from) {
                if focusedNode == nil { focusedNode = from; return .handled }
                var best: (String, CGFloat)?
                for q in nodes where q.id != from {
                    guard let qp = at(q.id) else { continue }
                    let dx = qp.x - p.x, dy = qp.y - p.y
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
        case "0": moved = false; t = GraphMath.fit(points, size)
        default:
            if press.key == .return || press.key == .space, let id = focusedNode { activate(id, newTab: press.modifiers.contains(.command)); return .handled }
            if press.key == .escape, selected != nil || !model.picked.isEmpty { selected = nil; model.picked = []; return .handled }
            return .ignored
        }
        return .handled
    }

    private func zoomBy(_ f: CGFloat) {
        moved = true
        t = GraphMath.zoom(t, f, around: CGPoint(x: size.width / 2, y: size.height / 2))
    }

    // MARK: overlays

    private func tooltip(_ n: GraphNode, _ spot: CGPoint) -> some View {
        let keyboard = n.id == focusedNode && hover == nil
        let what = n.kind == "note" ? (keyboard ? "Enter opens it" : model.pins[n.id] != nil ? "Click to open · double-click to unpin" : "Click to open · drag to pin") : "\(GraphMath.kindLabel[n.kind] ?? "Topic") · \(keyboard ? "Enter shows its notes" : "Click for its notes")"
        return VStack(alignment: .leading, spacing: 0) {
            Text(verbatim: n.label.isEmpty ? "Untitled" : n.label).webText(.role(.subheadline, weight: 500)).foregroundStyle(moreVar("color-heading", scheme))
            Text(verbatim: what).webText(.role(.footnote)).foregroundStyle(moreVar("color-ink-muted", scheme))
        }
        .padding(.horizontal, 10).padding(.vertical, 6)
        .frame(maxWidth: 240, alignment: .leading)
        .webBox(WebStyles.named("menu.panel"))
        .fixedSize()
        .alignmentGuide(.leading) { d in d.width / 2 - spot.x }
        .alignmentGuide(.top) { _ in -(spot.y + 16) }
        .allowsHitTesting(false)
    }

    private func entityCard(_ n: GraphNode) -> some View {
        let notes = GraphMath.neighbours(edges, n.id).compactMap { byId[$0] }.filter { $0.kind == "note" }.sorted { $0.label.localizedCompare($1.label) == .orderedAscending }
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
                        Button { frame.open(.note(note.id)) } label: {
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
            .fixedSize(horizontal: false, vertical: true)
        }
        .padding(12)
        .frame(width: min(300, size.width - 24))
        .webBox(WebStyles.named("menu.panel"))
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
        .padding(12)
    }

    private func offerCard(_ s: GraphSuggestion, at p: CGPoint) -> some View {
        let a = byId[s.source].map { $0.label.isEmpty ? "Untitled" : $0.label } ?? "Untitled"
        let b = byId[s.target].map { $0.label.isEmpty ? "Untitled" : $0.label } ?? "Untitled"
        return VStack(alignment: .leading, spacing: 8) {
            Text(verbatim: "Link \(a) to \(b)?").webText(.role(.subheadline, weight: 500)).foregroundStyle(moreVar("color-heading", scheme))
            Text(verbatim: "Both mention \(s.entities.joined(separator: ", ")). A “Related:” line goes at the end of the first note.").webText(.role(.footnote)).foregroundStyle(moreVar("color-ink-muted", scheme))
            HStack(spacing: 8) {
                WebButton("Link them", variant: .primary, size: .sm) { offer = nil; model.link(s) }
                WebButton("Not now", variant: .quiet, size: .sm) { offer = nil }
            }
        }
        .padding(12)
        .frame(width: 280, alignment: .leading)
        .webBox(WebStyles.named("menu.panel"))
        .offset(x: max(8, min(p.x - 140, size.width - 288)), y: min(p.y + 12, size.height - 150))
    }

    private var selectionBar: some View {
        ScrollView(.horizontal, showsIndicators: false) { selectionButtons }
            .fixedSize(horizontal: size.width > 560, vertical: true)
    }

    private var selectionButtons: some View {
        let ids = Array(model.picked)
        let tree = model.folderTree.value
        return HStack(spacing: 6) {
            Text(verbatim: ids.count == 1 ? "1 note" : "\(ids.count) notes").webText(.role(.subheadline)).monospacedDigit().foregroundStyle(moreVar("color-heading", scheme)).padding(.horizontal, 6)
            WebMenuButton(side: .top, entries: {
                [WebMenuEntry(.item("Drafts (no folder)")) { model.move(ids, to: nil) }] + (tree?.folders ?? []).map { f in WebMenuEntry(.item(f.name)) { model.move(ids, to: f.id) } }
            }) {
                HStack(spacing: 4) {
                    WebIconView(.folderInput, size: 14)
                    Text(verbatim: "Move").webText(.role(.subheadline))
                }
                .padding(.horizontal, 6).frame(height: 30).contentShape(Rectangle())
            }
            WebButton("Bookmark", icon: .bookmark, variant: .quiet, size: .sm) { model.star(ids) }
            if let tags = tree?.tags, !tags.isEmpty {
                WebMenuButton(side: .top, entries: { tags.map { tg in WebMenuEntry(.item("#\(tg.name)")) { model.tag(ids, tagId: tg.id, name: tg.name) } } }) {
                    HStack(spacing: 4) {
                        WebIconView(.tag, size: 14)
                        Text(verbatim: "Tag").webText(.role(.subheadline))
                    }
                    .padding(.horizontal, 6).frame(height: 30).contentShape(Rectangle())
                }
            }
            WebButton("Ask Foli AI", icon: .sparkles, variant: .quiet, size: .sm) {
                let names = ids.compactMap { byId[$0] }.map { $0.label.isEmpty ? "Untitled" : $0.label }
                frame.askAI(question: "What connects these notes, and what do they add up to? \(names.joined(separator: ", ")).")
            }
            WebIconButton(.x, label: "Clear selection") { model.picked = [] }
        }
        .padding(.horizontal, 8).padding(.vertical, 6)
        .webBox(WebStyles.named("menu.panel"))
    }

    private var zoomButtons: some View {
        VStack(spacing: 2) {
            WebIconButton(.zoomIn, label: "Zoom in") { zoomBy(1.25) }
            WebIconButton(.zoomOut, label: "Zoom out") { zoomBy(0.8) }
            WebIconButton(.maximize, label: "Fit to screen") { moved = false; t = GraphMath.fit(points, size) }
            // Touch has no Shift: Select mode picks notes by tapping and draws a box by dragging.
            WebIconButton(.squareDashed, label: model.selecting ? "Stop selecting" : "Select notes", pressed: model.selecting) { model.selecting.toggle() }
        }
        .padding(4)
        .webBox(WebStyles.named("menu.panel"))
    }
}

#if os(macOS)
/// The scroll wheel over the map zooms around the pointer (as the web's non-passive wheel listener).
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
                self.onScroll(e.scrollingDeltaY * (e.hasPreciseScrollingDeltas ? 1 : 10), p)
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
#else
/// (The iPad zooms the map by pinching: nothing to catch for a wheel.)
private struct ScrollWheelCatcher: View {
    let onScroll: (CGFloat, CGPoint) -> Void
    var body: some View { Color.clear.allowsHitTesting(false) }
}
#endif

// MARK: - Insights

/// Foli DNA's side list (GraphView.tsx DnaInsights): hubs, clusters, bridges, suggested links, unlinked notes, likely
/// duplicates and contradictions.
struct DnaInsightsView: View {
    let model: GraphModel
    let value: GraphValue
    let nodes: [GraphNode]
    let edges: [GraphEdge]
    let frame: FrameModel
    /// Full width (the phone), not a 280 pt column.
    var wide = false
    @Environment(\.colorScheme) private var scheme

    private var byId: [String: GraphNode] { Dictionary(value.nodes.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a }) }
    private func name(_ id: String) -> String { byId[id].map { $0.label.isEmpty ? "Untitled" : $0.label } ?? "Untitled" }

    var body: some View {
        let ids = Set(nodes.map(\.id))
        let hubs = DnaMath.hubs(nodes, edges)
        let clusters = value.clusters.filter { c in nodes.contains { $0.cluster == c.id } }
        let bridges = nodes.filter(\.bridge)
        let suggested = value.full ? value.suggested.filter { ids.contains($0.source) && ids.contains($0.target) } : []
        let f = model.settings.filter
        let base = DnaMath.filter(value.nodes, value.edges, DnaFilter(folders: f.folders, tags: f.tags, editedSince: f.editedSince, linksOnly: f.linksOnly))
        let orphans = DnaMath.orphans(base.nodes, base.edges)
        let clashes = edges.filter { $0.kind == "contradicts" || $0.kind == "supersedes" }
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Text(verbatim: "Insights").webText(.role(.body, weight: 600)).foregroundStyle(moreVar("color-heading", scheme))
                    Spacer()
                    WebIconButton(.x, label: "Close Insights") { model.insights = false }
                }
                section("Hubs", empty: hubs.isEmpty ? "Nothing is connected yet." : nil) {
                    ForEach(hubs, id: \.0.id) { h in
                        HStack(spacing: 6) {
                            KindGlyph(kind: h.0.kind)
                            row(h.0.label.isEmpty ? "Untitled" : h.0.label) { model.center(on: h.0.id) }
                            Text(verbatim: "\(h.1)").webText(.role(.footnote)).monospacedDigit().foregroundStyle(moreVar("color-ink-faint", scheme))
                        }
                    }
                }
                section("Clusters", empty: clusters.isEmpty ? "Clusters show once a few notes link together." : nil) {
                    ForEach(Array(clusters.prefix(12)), id: \.id) { c in
                        HStack(spacing: 6) {
                            RoundedRectangle(cornerRadius: 3, style: .circular).fill(moreVar(GraphMath.clusterTints[c.id % GraphMath.clusterTints.count], scheme)).frame(width: 10, height: 10)
                            Text(verbatim: c.name).webText(.role(.subheadline)).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                            Text(verbatim: "\(c.size)").webText(.role(.footnote)).monospacedDigit().foregroundStyle(moreVar("color-ink-faint", scheme))
                            WebIconButton(.sparkles, label: "Ask Foli AI to sum up \(c.name)") {
                                let names = value.nodes.filter { $0.cluster == c.id && $0.kind == "note" }.prefix(20).map { $0.label.isEmpty ? "Untitled" : $0.label }
                                frame.askAI(question: "Sum up what these notes say together: \(names.joined(separator: ", ")).")
                            }
                        }
                    }
                }
                if !bridges.isEmpty {
                    section("Bridges") {
                        ForEach(Array(bridges.prefix(10)), id: \.id) { b in row(b.label.isEmpty ? "Untitled" : b.label) { if b.kind == "note" { frame.open(.note(b.id)) } } }
                    }
                }
                if value.full {
                    section("Suggested links", empty: suggested.isEmpty ? "No suggestions right now." : nil) {
                        ForEach(Array(suggested.prefix(12).enumerated()), id: \.offset) { _, s in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(verbatim: "\(name(s.source)) and \(name(s.target))").webText(.role(.subheadline)).foregroundStyle(moreVar("color-ink", scheme))
                                Text(verbatim: "Both mention \(s.entities.joined(separator: ", "))").webText(.role(.footnote)).foregroundStyle(moreVar("color-ink-faint", scheme))
                                WebButton("Link them", variant: .quiet, size: .sm) { model.link(s) }
                            }
                        }
                    }
                }
                section("Unlinked notes", empty: orphans.isEmpty ? "Every note links to another." : nil) {
                    ForEach(Array(orphans.prefix(15)), id: \.id) { o in row(o.label.isEmpty ? "Untitled" : o.label) { openRelated(o.id) } }
                    if orphans.count > 15 { Text(verbatim: "and \(orphans.count - 15) more").webText(.role(.footnote)).foregroundStyle(moreVar("color-ink-faint", scheme)) }
                }
                if value.full, !value.duplicates.isEmpty {
                    section("Likely duplicates") {
                        ForEach(Array(value.duplicates.prefix(10).enumerated()), id: \.offset) { _, d in row("\(name(d.a)) and \(name(d.b))") { openRelated(d.a) } }
                    }
                }
                if !clashes.isEmpty {
                    section("Contradictions") {
                        ForEach(Array(clashes.prefix(10).enumerated()), id: \.offset) { _, e in
                            row("\(name(e.source)) \(e.kind == "supersedes" ? "replaces" : "and") \(name(e.target))") { openRelated(e.source) }
                        }
                    }
                }
            }
            .padding(.horizontal, 16).padding(.bottom, 32)
        }
        .frame(width: wide ? nil : 280)
        .frame(maxWidth: wide ? .infinity : nil)
        .overlay(alignment: .leading) { if !wide { Rectangle().fill(moreVar("color-line", scheme)).frame(width: 1) } }
        .accessibilityLabel("Insights")
    }

    /// A note opened on its Related notes (the web's `?panel=related`).
    private func openRelated(_ id: String) {
        frame.open(.note(id))
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(700))
            frame.editor(.panelOpen(panel: .related))
        }
    }

    private func section<C: View>(_ title: String, empty: String? = nil, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(verbatim: title.uppercased()).webText(.caps).foregroundStyle(moreVar("color-ink-muted", scheme))
            if let empty { Text(verbatim: empty).webText(.role(.footnote)).foregroundStyle(moreVar("color-ink-faint", scheme)) } else { content() }
        }
    }

    private func row(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(verbatim: title).webText(.role(.subheadline)).lineLimit(1).foregroundStyle(moreVar("color-ink", scheme)).frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - List

/// The map as text: every note and entity with what it's connected to.
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
            MoreEmptyState(icon: nil, title: "Nothing matches").frame(maxHeight: .infinity)
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

    /// "Linked: Packing list   Mentions: Sam (person)", with the notes as links (handled by the row's openURL).
    private func connections(_ e: Entry, muted: Color, faint: Color, ink: Color) -> AttributedString {
        var out = AttributedString()
        for (i, (c, edge)) in e.connections.prefix(24).enumerated() {
            if i > 0 { out += AttributedString("   ") }
            var label = AttributedString("\(GraphMath.edgeLabel[edge] ?? "Related"): ")
            label.foregroundColor = faint
            out += label
            var name = AttributedString(c.label.isEmpty ? "Untitled" : c.label)
            if c.kind == "note" {
                name.foregroundColor = ink
                var parts = URLComponents()
                parts.scheme = "folevi-graph-note"
                parts.host = c.id
                name.link = parts.url
            } else {
                name.foregroundColor = muted
            }
            out += name
            if c.kind != "note" {
                var kind = AttributedString(" (\((GraphMath.kindLabel[c.kind] ?? "").lowercased()))")
                kind.foregroundColor = faint
                out += kind
            }
        }
        return out
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
                // Each connected note is a link to it, as the web's list (AppLink); entities are plain text.
                Text(connections(e, muted: muted, faint: faint, ink: moreVar("color-ink", scheme))).webText(.role(.subheadline))
                    .tint(moreVar("color-ink", scheme))
                    .environment(\.openURL, OpenURLAction { url in
                        guard url.scheme == "folevi-graph-note" else { return .systemAction }
                        open(url.host() ?? url.lastPathComponent)
                        return .handled
                    })
            }
        }
    }
}
#endif
