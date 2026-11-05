// What makes Foli DNA easier to read on the Mac, iPad and iPhone (GraphScreen.swift), as the web's
// components/views/DnaGuide.tsx and lib/graph/neighbourhood.ts: the map around one note (what it's connected to
// and why, one hop out, a neighbour expandable), the Key, the first-time tips, and the panel that says in words
// why a note is connected. The rules and the words are the web's.
#if os(macOS) || os(iOS)
import SwiftUI
import FoleviDesign
import FoleviEngine

// MARK: - Around one note (lib/graph/neighbourhood.ts)

enum DnaReason: Equatable, Hashable {
    case link, backlink, mention, mentionedIn
    case ai(String)
    case suggested([String])
    case tag(String)
    case folder(String)

    var rank: Int {
        switch self {
        case .link: 0
        case .backlink: 1
        case .mention, .mentionedIn: 2
        case .ai: 3
        case .suggested: 4
        case .tag: 5
        case .folder: 6
        }
    }
}

struct DnaConnection: Equatable {
    var id: String
    var reasons: [DnaReason]
}

struct DnaNames {
    var tag: (String) -> String? = { _ in nil }
    var folder: (String) -> String? = { _ in nil }
}

enum DnaAround {
    /// At most this many notes for one shared tag or one folder (the most recently edited).
    static let sharedLimit = 8
    static let limit = 60

    struct Index {
        var byId: [String: GraphNode]
        var adj: [String: [(other: String, edge: GraphEdge, out: Bool)]]
        var byTag: [String: [String]]
        var byFolder: [String: [String]]
        var suggested: [GraphSuggestion]
    }

    static func index(_ nodes: [GraphNode], _ edges: [GraphEdge], suggested: [GraphSuggestion] = []) -> Index {
        let byId = Dictionary(nodes.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        var adj: [String: [(other: String, edge: GraphEdge, out: Bool)]] = [:]
        for e in edges where e.source != e.target && byId[e.source] != nil && byId[e.target] != nil {
            adj[e.source, default: []].append((e.target, e, true))
            adj[e.target, default: []].append((e.source, e, false))
        }
        var byTag: [String: [String]] = [:], byFolder: [String: [String]] = [:]
        let notes = nodes.filter { $0.kind == "note" }.sorted { ($0.updatedAt ?? 0) != ($1.updatedAt ?? 0) ? ($0.updatedAt ?? 0) > ($1.updatedAt ?? 0) : $0.id < $1.id }
        for n in notes {
            for t in n.tagIds { byTag[t, default: []].append(n.id) }
            if let f = n.folderId { byFolder[f, default: []].append(n.id) }
        }
        return Index(byId: byId, adj: adj, byTag: byTag, byFolder: byFolder, suggested: suggested.filter { byId[$0.source] != nil && byId[$0.target] != nil })
    }

    /// What `id` is connected to and why, strongest first (then most recently edited).
    static func connections(_ ix: Index, _ id: String, ai: Bool = true, limit: Int = DnaAround.limit) -> [DnaConnection] {
        guard let me = ix.byId[id] else { return [] }
        var out: [String: [DnaReason]] = [:]
        var order: [String] = []
        func add(_ other: String, _ r: DnaReason) {
            guard other != id, ix.byId[other] != nil else { return }
            if out[other] == nil { order.append(other) }
            if !(out[other] ?? []).contains(r) { out[other, default: []].append(r) }
        }
        for (other, e, mine) in ix.adj[id] ?? [] {
            if e.kind == "link" { add(other, mine ? .link : .backlink) } else if !ai { continue } else if e.kind == "mention" { add(other, me.kind == "note" ? .mention : .mentionedIn) } else { add(other, .ai(e.kind)) }
        }
        if ai {
            for s in ix.suggested {
                if s.source == id { add(s.target, .suggested(s.entities)) } else if s.target == id { add(s.source, .suggested(s.entities)) }
            }
        }
        if me.kind == "note" {
            for t in me.tagIds { for o in (ix.byTag[t] ?? []).filter({ $0 != id }).prefix(sharedLimit) { add(o, .tag(t)) } }
            if let f = me.folderId { for o in (ix.byFolder[f] ?? []).filter({ $0 != id }).prefix(sharedLimit) { add(o, .folder(f)) } }
        }
        var list = order.map { DnaConnection(id: $0, reasons: (out[$0] ?? []).sorted { $0.rank < $1.rank }) }
        list.sort { a, b in
            let ra = a.reasons[0].rank, rb = b.reasons[0].rank
            if ra != rb { return ra < rb }
            let ua = ix.byId[a.id]?.updatedAt ?? 0, ub = ix.byId[b.id]?.updatedAt ?? 0
            if ua != ub { return ua > ub }
            return (ix.byId[a.id]?.label ?? "") < (ix.byId[b.id]?.label ?? "")
        }
        return Array(list.prefix(limit))
    }

    static func word(_ r: DnaReason, _ names: DnaNames) -> String {
        switch r {
        case .link: "links to"
        case .backlink: "links here"
        case .mention: "mentions"
        case .mentionedIn: "mentioned in"
        case .ai(let k): ["similar": "similar", "related": "related", "references": "refers to", "contradicts": "contradicts", "supersedes": "replaces"][k] ?? "related"
        case .suggested: "could link"
        case .tag(let t): "#\(names.tag(t) ?? "tag")"
        case .folder: "same folder"
        }
    }

    /// The words on a line: the strongest two reasons; a link both ways says so.
    static func lineLabel(_ reasons: [DnaReason], _ names: DnaNames) -> String {
        let both = reasons.contains(.link) && reasons.contains(.backlink)
        var words = both ? ["links both ways"] : []
        for r in reasons where !(both && (r == .link || r == .backlink)) {
            let w = word(r, names)
            if !words.contains(w) { words.append(w) }
        }
        return words.prefix(2).joined(separator: " · ")
    }

    private static func edgeKind(_ r: DnaReason) -> String {
        switch r {
        case .link, .backlink: "link"
        case .mention, .mentionedIn: "mention"
        case .ai(let k): k
        case .suggested: "suggested"
        case .tag: "tag"
        case .folder: "folder"
        }
    }

    static func pairKey(_ a: String, _ b: String) -> String { a < b ? "\(a)|\(b)" : "\(b)|\(a)" }

    struct Map {
        var nodes: [GraphNode]
        var edges: [GraphEdge]
        /// Why, beside each line (by `pairKey`).
        var labels: [String: String]
        var connections: [DnaConnection]
        var expandable: Set<String>
    }

    /// The map around one note, laid out in rings: the note in the middle, its connections around it (strongest
    /// first, from the top), an expanded neighbour's own beyond it. Nil when the note isn't in the map.
    static func map(_ ix: Index, center: String, expanded: Set<String>, ai: Bool, names: DnaNames) -> Map? {
        guard ix.byId[center] != nil else { return nil }
        let conns = connections(ix, center, ai: ai)
        var shown = [center] + conns.map(\.id)
        var seen = Set(shown)
        var edges: [String: GraphEdge] = [:]
        var labels: [String: String] = [:]
        var place: [String: CGPoint] = [center: .zero]
        let r1 = max(170, CGFloat(conns.count) * 30 / (2 * .pi))
        for (i, c) in conns.enumerated() {
            let a = -CGFloat.pi / 2 + CGFloat(i) / CGFloat(max(1, conns.count)) * 2 * .pi
            place[c.id] = CGPoint(x: cos(a) * r1, y: sin(a) * r1)
        }
        func draw(_ from: String, _ c: DnaConnection) {
            let key = pairKey(from, c.id)
            guard edges[key] == nil else { return }
            let first = c.reasons[0]
            let kind = edgeKind(first)
            let reverse = first == .backlink || first == .mention
            let real = (ix.adj[from] ?? []).first { $0.other == c.id && $0.edge.kind == kind }?.edge
            let inferred: Bool
            switch first {
            case .ai, .suggested, .mention, .mentionedIn: inferred = true
            default: inferred = real?.inferred ?? false
            }
            edges[key] = GraphEdge(source: reverse ? c.id : from, target: reverse ? from : c.id, kind: kind, inferred: inferred, createdAt: real?.createdAt)
            labels[key] = lineLabel(c.reasons, names)
        }
        for c in conns { draw(center, c) }
        for id in shown where expanded.contains(id) && id != center {
            let more = connections(ix, id, ai: ai, limit: 24)
            let fresh = more.filter { !seen.contains($0.id) }
            let base = place[id] ?? .zero
            let angle = atan2(base.y, base.x)
            let spread = min(CGFloat.pi / 2.5, CGFloat(fresh.count) * 0.2)
            for (j, c) in fresh.enumerated() {
                let a = angle + (fresh.count == 1 ? 0 : -spread / 2 + spread * CGFloat(j) / CGFloat(fresh.count - 1))
                place[c.id] = CGPoint(x: base.x + cos(a) * 150, y: base.y + sin(a) * 150)
                seen.insert(c.id)
                shown.append(c.id)
            }
            for c in more { draw(id, c) }
        }
        // Lines already joining two of the notes shown, unlabelled.
        for id in shown {
            for (other, e, _) in ix.adj[id] ?? [] where seen.contains(other) && edges[pairKey(id, other)] == nil {
                if !ai && e.kind != "link" { continue }
                edges[pairKey(id, other)] = e
            }
        }
        let degree = Dictionary(grouping: edges.values.flatMap { [$0.source, $0.target] }, by: { $0 }).mapValues(\.count)
        let nodes = shown.compactMap { id -> GraphNode? in
            guard var n = ix.byId[id], let p = place[id] else { return nil }
            n.x = p.x
            n.y = p.y
            n.degree = degree[id] ?? 0
            n.cluster = nil
            n.bridge = false
            return n
        }
        let expandable = Set(shown.filter { $0 != center && ix.byId[$0]?.kind == "note" && !expanded.contains($0) })
        return Map(nodes: nodes, edges: Array(edges.values).sorted { pairKey($0.source, $0.target) < pairKey($1.source, $1.target) }, labels: labels, connections: conns, expandable: expandable)
    }

    struct Group: Identifiable {
        var title: String
        var ids: [String]
        var id: String { title }
    }

    /// Why a node is connected, in words: one sentence, then the connections by reason.
    static func explain(_ ix: Index, _ id: String, names: DnaNames, ai: Bool = true) -> (summary: String, groups: [Group]) {
        guard let me = ix.byId[id] else { return ("", []) }
        let conns = connections(ix, id, ai: ai, limit: .max)
        func by(_ pred: (DnaReason) -> Bool) -> [String] { conns.filter { $0.reasons.contains(where: pred) }.map(\.id) }
        func label(_ x: String) -> String { let l = ix.byId[x]?.label ?? ""; return l.isEmpty ? "Untitled" : l }
        func plural(_ n: Int, _ one: String) -> String { "\(n) \(n == 1 ? one : one + "s")" }
        func nameList(_ ns: [String]) -> String { ns.count <= 2 ? ns.joined(separator: " and ") : "\(ns.prefix(2).joined(separator: ", ")) and \(ns.count - 2) more" }
        let links = by { $0 == .link }, back = by { $0 == .backlink }, mentions = by { $0 == .mention }, mentionedIn = by { $0 == .mentionedIn }
        let aiIds = by { if case .ai = $0 { return true }; return false }
        let sugg = by { if case .suggested = $0 { return true }; return false }
        var parts: [String] = [], groups: [Group] = []
        if !links.isEmpty { parts.append("links to \(plural(links.count, "note"))"); groups.append(Group(title: "Links to", ids: links)) }
        if !back.isEmpty { parts.append("linked from \(links.isEmpty ? plural(back.count, "note") : "\(back.count)")"); groups.append(Group(title: "Linked from", ids: back)) }
        if !mentions.isEmpty { parts.append("mentions \(nameList(mentions.map(label)))"); groups.append(Group(title: "Mentions", ids: mentions)) }
        if !mentionedIn.isEmpty { parts.append("mentioned in \(plural(mentionedIn.count, "note"))"); groups.append(Group(title: "Mentioned in", ids: mentionedIn)) }
        if !aiIds.isEmpty { parts.append("Foli AI finds it related to \(plural(aiIds.count, "note"))"); groups.append(Group(title: "Foli AI found", ids: aiIds)) }
        if !sugg.isEmpty { parts.append("could link to \(sugg.count)"); groups.append(Group(title: "Could link to", ids: sugg)) }
        if me.kind == "note" {
            let tags = me.tagIds.map { t in (t, (ix.byTag[t] ?? []).filter { $0 != id }) }.filter { !$0.1.isEmpty }.sorted { $0.1.count > $1.1.count }
            for (i, x) in tags.enumerated() {
                let name = "#\(names.tag(x.0) ?? "tag")"
                if i < 2 { parts.append("shares the tag \(name) with \(x.1.count)") }
                groups.append(Group(title: "Also tagged \(name)", ids: x.1))
            }
            if let f = me.folderId {
                let folder = (ix.byFolder[f] ?? []).filter { $0 != id }
                if !folder.isEmpty {
                    let name = names.folder(f)
                    parts.append(name.map { "is in \($0) with \(folder.count) more" } ?? "shares its folder with \(plural(folder.count, "note"))")
                    groups.append(Group(title: name.map { "Also in \($0)" } ?? "Same folder", ids: folder))
                }
            }
        }
        guard !parts.isEmpty else { return (me.kind == "note" ? "Not connected to anything yet. Type [[ in it to link another note." : "Not mentioned in any note shown.", groups) }
        let s = parts.count == 1 ? parts[0] : "\(parts.dropLast().joined(separator: ", ")) and \(parts.last!)"
        return (s.prefix(1).uppercased() + s.dropFirst() + ".", groups)
    }
}

// MARK: - The first-time tips

enum DnaTour {
    static let steps: [(title: String, body: String)] = [
        ("This is Foli DNA", "A map of your notes. Each dot is a note, and a line joins two notes that link to each other. Bigger dots have more connections. The Key in the corner explains every colour and line."),
        ("Move around and open notes", "Drag to move, scroll or pinch to zoom. Click a note to see, in words, why it’s connected. Double-click it to open it."),
        ("Focus on one note", "To see only what one note is connected to, choose Foli DNA in a note’s ••• menu, or Map around this note in its panel here. Whole map brings everything back."),
    ]
}

struct DnaTourCard: View {
    let step: Int
    let onStep: (Int) -> Void
    let onDone: () -> Void
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let s = DnaTour.steps[min(step, DnaTour.steps.count - 1)]
        let last = step >= DnaTour.steps.count - 1
        VStack(alignment: .leading, spacing: 4) {
            Text(verbatim: "\(step + 1) of \(DnaTour.steps.count)").webText(.role(.footnote)).monospacedDigit().foregroundStyle(moreVar("color-ink-faint", scheme))
            Text(verbatim: s.title).webText(.role(.body, weight: 600)).foregroundStyle(moreVar("color-heading", scheme))
            Text(verbatim: s.body).webText(.role(.subheadline)).foregroundStyle(moreVar("color-ink-muted", scheme)).fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 8) {
                HStack(spacing: 4) {
                    ForEach(0..<DnaTour.steps.count, id: \.self) { i in
                        Circle().fill(i == step ? moreVar("color-heading", scheme) : moreVar("color-line-strong", scheme)).frame(width: 6, height: 6)
                    }
                }
                .accessibilityHidden(true)
                Spacer(minLength: 0)
                if !last { WebButton("Skip", variant: .quiet, size: .sm) { onDone() } }
                WebButton(last ? "Got it" : "Next", variant: .primary, size: .sm) { last ? onDone() : onStep(step + 1) }
                    .keyboardShortcut(.defaultAction)
            }
            .padding(.top, 8)
        }
        .padding(16)
        .frame(maxWidth: 360, alignment: .leading)
        // Opaque under the panel's glass: the map's lines and labels showed through and the words were hard to read.
        .background(moreVar("color-surface", scheme), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .webBox(WebStyles.named("menu.panel"))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Foli DNA tips")
        #if os(macOS)
        .onExitCommand { onDone() }
        #endif
    }
}

// MARK: - The Key

struct DnaLegendShows {
    var kinds: [(kind: String, label: String)] = []
    var groups: [(name: String, color: Color)] = []
    var colorBy = "kind"
    var arrows = false
    var mentions = false
    var aiLines = false
    var contradicts = false
    var duplicates = false
    var suggested = false
    var shared = false
    var clusters = false
    var bridges = false
    var fresh = false
}

struct DnaLegendCard: View {
    let shows: DnaLegendShows
    let open: Bool
    let onToggle: () -> Void
    @Environment(\.colorScheme) private var scheme

    private func line(_ color: String = "color-line-strong", dash: [CGFloat] = [], arrow: Bool = false) -> some View {
        Canvas { ctx, s in
            var p = Path()
            p.move(to: CGPoint(x: 1, y: s.height / 2))
            p.addLine(to: CGPoint(x: arrow ? s.width - 6 : s.width - 1, y: s.height / 2))
            let c = moreVar(color, scheme)
            ctx.stroke(p, with: .color(c), style: StrokeStyle(lineWidth: 1.2, dash: dash))
            if arrow {
                var h = Path()
                h.move(to: CGPoint(x: s.width - 7, y: s.height / 2 - 3.5))
                h.addLine(to: CGPoint(x: s.width - 1, y: s.height / 2))
                h.addLine(to: CGPoint(x: s.width - 7, y: s.height / 2 + 3.5))
                h.closeSubpath()
                ctx.fill(h, with: .color(c))
            }
        }
        .frame(width: 28, height: 10)
    }

    private func dot(_ color: Color, kind: String = "note", r: CGFloat = 4, ring: (String, [CGFloat], Bool)? = nil) -> some View {
        Canvas { ctx, s in
            let c = CGPoint(x: s.width / 2, y: s.height / 2)
            if let ring {
                let rr = r + (ring.2 ? 4 : 3)
                let path = Path(ellipseIn: CGRect(x: c.x - rr, y: c.y - rr, width: rr * 2, height: rr * 2))
                if ring.2 { ctx.fill(path, with: .color(moreVar(ring.0, scheme).opacity(0.35))) } else { ctx.stroke(path, with: .color(moreVar(ring.0, scheme)), style: StrokeStyle(lineWidth: 1.3, dash: ring.1)) }
            }
            ctx.fill(GraphMath.shape(kind, r, at: c) ?? Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)), with: .color(color))
        }
        .frame(width: 20, height: 20)
    }

    private func row(_ icon: some View, _ text: String) -> some View {
        HStack(spacing: 8) {
            icon.frame(width: 28)
            Text(verbatim: text).webText(.role(.footnote)).foregroundStyle(moreVar("color-ink-muted", scheme)).fixedSize(horizontal: false, vertical: true)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button(action: onToggle) {
                HStack {
                    Text(verbatim: "Key").webText(.role(.footnote, weight: 600)).foregroundStyle(moreVar("color-heading", scheme))
                    Spacer(minLength: 0)
                    WebIconView(open ? .chevronDown : .chevronUp, size: 14).foregroundStyle(moreVar("color-ink-faint", scheme))
                }
                .padding(.horizontal, 12).padding(.vertical, 8)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Key")
            .accessibilityValue(open ? "Open" : "Folded")
            if open {
                ScrollView {
                    VStack(alignment: .leading, spacing: 4) {
                        if shows.colorBy == "kind" {
                            ForEach(shows.kinds, id: \.kind) { k in row(dot(moreVar(GraphMath.colorVar(k.kind), scheme), kind: k.kind), k.kind == "note" ? "A note" : k.label) }
                        } else {
                            ForEach(Array(shows.groups.prefix(12).enumerated()), id: \.offset) { _, g in row(dot(g.color), g.name) }
                            row(dot(moreVar("color-line-strong", scheme)), shows.colorBy == "folder" ? "In no folder" : "No tag")
                        }
                        row(HStack(spacing: 0) { dot(moreVar("color-ink-muted", scheme), r: 2.5); dot(moreVar("color-ink-muted", scheme), r: 5) }, "Bigger dot: more connections")
                        row(line(arrow: shows.arrows), shows.arrows ? "A link you wrote, pointing at the note it links to" : "A link you wrote with [[")
                        if shows.mentions { row(line(), "A note mentions this person, project or topic") }
                        if shows.aiLines { row(line(dash: [4, 3]), "Foli AI found them related") }
                        if shows.contradicts { row(line("color-coral", dash: [4, 3]), "They contradict each other") }
                        if shows.duplicates { row(line("color-plum", dash: [1, 3]), "Likely the same note twice, or one replaces the other") }
                        if shows.suggested { row(line("color-accent", dash: [2, 4]), "Could be linked: click the line to link them") }
                        if shows.shared { row(line(dash: [1, 3]), "Share a tag or a folder") }
                        if shows.clusters { row(Capsule().fill(moreVar("color-accent", scheme).opacity(0.15)).frame(width: 24, height: 14), "A group of closely linked notes") }
                        if shows.bridges { row(dot(moreVar("color-ink-muted", scheme), ring: ("color-accent", [2, 2], false)), "Joins two groups") }
                        if shows.fresh { row(dot(moreVar("color-ink-muted", scheme), ring: ("color-marigold", [], true)), "New this week") }
                    }
                    .padding(.horizontal, 12).padding(.bottom, 12)
                }
                .frame(maxHeight: 260)
                .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(width: 250, alignment: .leading)
        // Opaque under the panel's glass: the map's lines and labels showed through and the words were hard to read.
        .background(moreVar("color-surface", scheme), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .webBox(WebStyles.named("menu.panel"))
    }
}

// MARK: - Why a note is connected, in words

struct DnaPanelCard: View {
    let id: String
    let ix: DnaAround.Index
    let names: DnaNames
    let ai: Bool
    let isCenter: Bool
    /// On the map around a note: whether this one's own connections show, and how to switch them.
    let expanded: Bool?
    let onToggleExpand: () -> Void
    let onOpen: (String) -> Void
    let onCenter: (String) -> Void
    let onPick: (String) -> Void
    let onClose: () -> Void
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let n = ix.byId[id]
        let words = DnaAround.explain(ix, id, names: names, ai: ai)
        let note = n?.kind == "note"
        let title = (n?.label).flatMap { $0.isEmpty ? nil : $0 } ?? "Untitled"
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                Text(verbatim: title).webText(.role(.body, weight: 600)).foregroundStyle(moreVar("color-heading", scheme)).frame(maxWidth: .infinity, alignment: .leading)
                WebIconButton(.x, label: "Close") { onClose() }
            }
            Text(verbatim: words.summary).webText(.role(.subheadline)).foregroundStyle(moreVar("color-ink", scheme)).fixedSize(horizontal: false, vertical: true)
            DnaButtonRow {
                if note { WebButton("Open note", variant: .primary, size: .sm) { onOpen(id) } }
                if note && !isCenter { WebButton("Map around this note", icon: .waypoints, size: .sm) { onCenter(id) } }
                if let expanded { WebButton(expanded ? "Hide its connections" : "Show its connections", variant: .quiet, size: .sm) { onToggleExpand() } }
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(words.groups) { g in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(verbatim: "\(g.title.uppercased())  \(g.ids.count)").webText(.role(.caption1, weight: 600)).foregroundStyle(moreVar("color-ink-faint", scheme))
                            ForEach(g.ids.prefix(8), id: \.self) { x in
                                let o = ix.byId[x]
                                Button { o?.kind == "note" ? onOpen(x) : onPick(x) } label: {
                                    HStack(spacing: 6) {
                                        if o?.kind == "note" { WebIconView(.fileText, size: 13).foregroundStyle(moreVar("color-ink-muted", scheme)) }
                                        Text(verbatim: (o?.label).flatMap { $0.isEmpty ? nil : $0 } ?? "Untitled").webText(.role(.subheadline)).lineLimit(1)
                                    }
                                    .padding(.horizontal, 6).padding(.vertical, 4)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                            }
                            if g.ids.count > 8 { Text(verbatim: "and \(g.ids.count - 8) more").webText(.role(.footnote)).foregroundStyle(moreVar("color-ink-faint", scheme)).padding(.horizontal, 6) }
                        }
                    }
                }
            }
            .frame(maxHeight: 260)
            .fixedSize(horizontal: false, vertical: true)
        }
        .padding(12)
        .frame(width: 320, alignment: .leading)
        // Opaque under the panel's glass: the map's lines and labels showed through and the words were hard to read.
        .background(moreVar("color-surface", scheme), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .webBox(WebStyles.named("menu.panel"))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Why \(title) is connected")
    }
}

/// Buttons that wrap onto a second line when the panel is narrow.
private struct DnaButtonRow<Content: View>: View {
    @ViewBuilder let content: Content
    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) { content }
            VStack(alignment: .leading, spacing: 6) { content }
        }
    }
}

// MARK: - The map around a note: its connections as a list

struct DnaConnectionsList: View {
    let center: String
    let connections: [DnaConnection]
    let ix: DnaAround.Index
    let names: DnaNames
    let expanded: Set<String>
    let onToggle: (String) -> Void
    let onOpen: (String) -> Void
    let onPick: (String) -> Void
    let onWhole: () -> Void
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let me = ix.byId[center]
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: connections.count == 1 ? "1 connection" : "\(connections.count) connections").webText(.role(.body, weight: 600)).foregroundStyle(moreVar("color-heading", scheme))
                Text(verbatim: "What \((me?.label).flatMap { $0.isEmpty ? nil : $0 } ?? "this note") is connected to, and why.").webText(.role(.footnote)).foregroundStyle(moreVar("color-ink-muted", scheme))
            }
            .padding(.horizontal, 16).padding(.top, 12).padding(.bottom, 6)
            ScrollView {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(connections, id: \.id) { c in
                        let o = ix.byId[c.id]
                        let title = (o?.label).flatMap { $0.isEmpty ? nil : $0 } ?? "Untitled"
                        HStack(spacing: 4) {
                            Button { o?.kind == "note" ? onOpen(c.id) : onPick(c.id) } label: {
                                VStack(alignment: .leading, spacing: 0) {
                                    Text(verbatim: title).webText(.role(.subheadline)).foregroundStyle(moreVar("color-heading", scheme)).lineLimit(1)
                                    Text(verbatim: DnaAround.lineLabel(c.reasons, names)).webText(.role(.footnote)).foregroundStyle(moreVar("color-ink-muted", scheme)).lineLimit(1)
                                }
                                .padding(.horizontal, 8).padding(.vertical, 6)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            if o?.kind == "note" {
                                let on = expanded.contains(c.id)
                                WebIconButton(on ? .minus : .plus, label: on ? "Hide what \(title) connects to" : "Show what \(title) connects to", pressed: on) { onToggle(c.id) }
                            }
                        }
                    }
                    if connections.isEmpty {
                        Text(verbatim: "Nothing yet. Type [[ in the note to link another one.").webText(.role(.subheadline)).foregroundStyle(moreVar("color-ink-muted", scheme)).padding(8)
                    }
                }
                .padding(.horizontal, 8)
            }
            Rectangle().fill(moreVar("color-line", scheme)).frame(height: 1)
            WebButton("Back to the whole map", variant: .quiet, size: .sm) { onWhole() }.frame(maxWidth: .infinity).padding(8)
        }
        .frame(width: 280)
        .overlay(alignment: .leading) { Rectangle().fill(moreVar("color-line", scheme)).frame(width: 1) }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Connections")
    }
}
#endif
