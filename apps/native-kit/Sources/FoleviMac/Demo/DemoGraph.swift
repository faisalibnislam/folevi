// The scripted engine's Foli DNA (the `graph` view): a space like the one in the owner's report of 5 November 2026,
// 44 notes, most of them not linked to anything, two linked clusters, long titles, a person and a project Foli AI
// found, and notes the engine called bridges whose links on screen don't cross clusters. Positions are spread the
// way the web's force layout leaves them: the clusters off centre and the unlinked notes in a wide ring, some far
// out to one side. Never real data.
import Foundation
import FoleviEngine

extension DemoEngine {
    static let graph: GraphValue = {
        let day = 86_400_000.0
        let now = 1_800_000_000_000.0
        var nodes: [GraphNode] = []
        var edges: [GraphEdge] = []
        func note(_ id: String, _ label: String, _ x: Double, _ y: Double, cluster: Int? = nil, bridge: Bool = false, folder: String? = nil, age: Double = 30) {
            nodes.append(GraphNode(id: id, kind: "note", label: label, x: x, y: y, degree: 0, folderId: folder, tagIds: [], createdAt: now - age * day, updatedAt: now - age * day / 2, cluster: cluster, bridge: bridge))
        }
        func link(_ a: String, _ b: String, kind: String = "link") { edges.append(GraphEdge(source: a, target: b, kind: kind, inferred: kind != "link", createdAt: now - 10 * day)) }

        // Airly Studio: eight linked notes.
        let studio = ["Airly Studio Website Idea #2", "Hero titles ideas #2", "Hero title ideas #1", "Issues", "Customer Target Flow", "Airly Studio Website Ideas", "In-house Products & Services", "Pricing page draft"]
        for (i, t) in studio.enumerated() {
            let a = Double(i) / Double(studio.count) * 2 * .pi
            note("a\(i)", t, 120 + cos(a) * 95, -120 + sin(a) * 80, cluster: 0, folder: "f1", age: Double(40 - i))
        }
        for i in 1..<studio.count { link("a0", "a\(i)") }
        link("a1", "a2")
        // Involets: seven linked notes.
        let involets = ["Folevi", "AI Assistant", "ClimbOS", "Livoform roadmap", "Influaincer launch", "Weekly review", "Mebel, The complete feature roadmap for a professional AI-powered furniture design app"]
        for (i, t) in involets.enumerated() {
            let a = Double(i) / Double(involets.count) * 2 * .pi + 0.4
            note("b\(i)", t, -110 + cos(a) * 90, 140 + sin(a) * 85, cluster: 1, folder: "f2", age: Double(20 - i))
        }
        for i in 1..<involets.count { link("b0", "b\(i)") }
        link("b2", "b3")
        // One note joining the two.
        link("a3", "b2")
        // Foli AI's finds: a person in both clusters and a project.
        nodes.append(GraphNode(id: "e_sam", kind: "person", label: "Sam Rivera", x: 10, y: 20, degree: 0, tagIds: [], cluster: nil, bridge: true))
        nodes.append(GraphNode(id: "e_mebel", kind: "project", label: "Mebel", x: -190, y: 250, degree: 0, tagIds: [], cluster: 1, bridge: false))
        link("a4", "e_sam", kind: "mention")
        link("b5", "e_sam", kind: "mention")
        link("b6", "e_mebel", kind: "mention")
        // Unlinked notes in a wide ring; every third one the engine called a bridge (from links to notes outside this
        // map), which used to draw a dotted ring on a dot with no lines.
        let loose = ["Brainstorming", "Drafts for the launch email", "Macloving", "Vault checklist", "Reading list", "Kyoto in November", "Packing list", "Trip budget", "Ryokan options", "Book notes: The Design of Everyday Things", "Ideas", "Meeting with Lena", "Q4 goals", "Hiring plan", "Interview questions", "Space Cherries LLC", "Invoices", "Logo sketches", "Typeface shortlist", "Podcast outline", "Recipes", "Garden plan", "Morning pages", "Weekly groceries", "Running log", "Gift ideas", "Old notes", "Untitled", "Website copy v3"]
        for (i, t) in loose.enumerated() {
            let a = Double(i) * 2.399963
            let r = 300 + Double(i % 5) * 28
            // A few far out to the right, as in the report.
            let far = i % 9 == 4 ? 260.0 : 0
            note("u\(i)", t, cos(a) * r + far, sin(a) * r * 0.8, cluster: nil, bridge: i % 3 == 0, age: Double(i % 12))
        }
        var deg: [String: Int] = [:]
        for e in edges { deg[e.source, default: 0] += 1; deg[e.target, default: 0] += 1 }
        nodes = nodes.map { var n = $0; n.degree = deg[n.id] ?? 0; return n }
        return GraphValue(
            full: true, upgrade: false, truncated: false, nodes: nodes, edges: edges,
            folders: [GraphGroup(id: "f1", name: "Airly.io", color: "red"), GraphGroup(id: "f2", name: "In-house Products", color: "blue")],
            tags: [],
            clusters: [GraphCluster(id: 0, name: "Airly Studio", size: studio.count), GraphCluster(id: 1, name: "Involets", size: involets.count + 1)],
            suggested: [GraphSuggestion(source: "a6", target: "b3", entities: ["Livoform"])],
            duplicates: [GraphDuplicate(a: "a1", b: "a2", percent: 82)],
            views: []
        )
    }()
}
