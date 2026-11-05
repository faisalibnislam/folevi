// Foli DNA of one note on the Mac, iPad and iPhone (DnaGuide.swift, GraphScreen.swift), from the owner's report of
// 6 November 2026: "Foli DNA of this note" opened an empty map or the wrong one. The route dropped the note
// (FrameRoute read `/graph?note=<id>` as `/graph`), and the map around a note read the filtered map, so a filter
// or the hidden unlinked notes could leave the note itself out. Also the map around a note (each line saying why,
// a neighbour expandable), the plain-language panel, the calmer defaults, and pictures of the map around a note
// with its panel and of the first-time tips (light and dark, Mac and iPhone sizes).
#if os(macOS)
import AppKit
import Foundation
import SwiftUI
import Testing
import FoleviDesign
import FoleviEngine
import FoleviScreens
@testable import FoleviMac

// Nested in the snapshot suite, which runs one test at a time: both read and write the same remembered settings.
extension DnaSnapshotTests {
@Suite("Foli DNA around one note") @MainActor
struct Around {
    init() {
        for k in ["folevi.dna.settings.acct:demo", "folevi.dna.pins.acct:demo", "folevi.graph.view", "folevi.dna.insights", "folevi.dna.focus", "folevi.dna.key"] { UserDefaults.standard.removeObject(forKey: k) }
        UserDefaults.standard.set(true, forKey: "folevi.dna.tourDone")
    }

    @Test func theRouteKeepsTheNote() {
        // The bug: the note was dropped, so the screen showed the whole map (or the last note's).
        #expect(FrameRoute(path: "/graph?note=n1") == .web("/graph?note=n1"))
        #expect(FrameRoute(path: "/graph?note=n1&depth=2&junk=1") == .web("/graph?note=n1&depth=2"))
        #expect(FrameRoute(path: "/graph?view=v1") == .web("/graph?view=v1"))
        #expect(FrameRoute(path: "/graph") == .web("/graph"))
        #expect(FrameRoute(path: FrameRoute.web("/graph?note=n1").path) == .web("/graph?note=n1"))
        // One Foli DNA tab, whichever note it's around (it follows you, as on the web).
        #expect(FrameRoute(path: "/graph?note=n1").tabKey == "view:graph")
        #expect(FrameRoute(path: "/graph").tabKey == "view:graph")
        // The tab strip shows the note's map, not the whole one.
        let tabs = TabsModel()
        tabs.show(.web("/graph"))
        tabs.show(.web("/graph?note=n1"))
        #expect(tabs.tabs.filter { $0.id == "view:graph" }.count == 1)
        #expect(tabs.tabs.first { $0.id == "view:graph" }?.route == .web("/graph?note=n1"))
    }

    @Test func theScreenOpensAroundTheNoteEvenWhenFiltersWouldHideIt() async {
        let demo = DemoEngine(now: Date(timeIntervalSince1970: 1_800_000_000))
        let model = GraphModel(client: demo.client(), feedback: ScreenFeedback())
        // A folder filter that leaves the note out, and unlinked notes hidden: the map around it still shows it.
        model.settings.filter.folders = ["f2"]
        model.apply(path: "/graph?note=a3")
        await eventually("graph", timeout: .seconds(8)) { model.value != nil }
        let ids = Set(model.shown.nodes.map(\.id))
        #expect(ids.contains("a3"))
        #expect(ids == ["a3", "a0", "b2", "a1", "a2", "a4", "a5", "a6", "a7"])
        // Each line says why: a3 links to Involets' ClimbOS, a0 links to a3, the rest share its folder.
        let labels = model.around!.labels
        #expect(labels[DnaAround.pairKey("a3", "b2")] == "links to")
        #expect(labels[DnaAround.pairKey("a3", "a0")] == "links here · same folder")
        #expect(labels[DnaAround.pairKey("a3", "a5")] == "same folder")
        // The note sits in the middle.
        #expect(model.shown.nodes.first { $0.id == "a3" }.map { $0.x == 0 && $0.y == 0 } == true)
        // Expanding ClimbOS adds its own links.
        model.toggleExpanded("b2")
        #expect(Set(model.shown.nodes.map(\.id)).isSuperset(of: ["b0", "b3"]))
        // Back to the whole map: the filters apply again.
        model.showEverything()
        model.apply(path: "/graph")
        #expect(!model.shown.nodes.contains { $0.id == "a3" })
    }

    @Test func inWords() {
        let v = DemoEngine.graph
        let ix = DnaAround.index(v.nodes, v.edges)
        let names = DnaNames(tag: { _ in nil }, folder: { ["f1": "Airly.io", "f2": "In-house Products"][$0] })
        let a3 = DnaAround.explain(ix, "a3", names: names)
        #expect(a3.summary == "Links to 1 note, linked from 1 and is in Airly.io with 7 more.")
        #expect(a3.groups.map(\.title) == ["Links to", "Linked from", "Also in Airly.io"])
        #expect(DnaAround.explain(ix, "e_sam", names: names).summary == "Mentioned in 2 notes.")
        #expect(DnaAround.explain(ix, "u3", names: names).summary == "Not connected to anything yet. Type [[ in it to link another note.")
        #expect(DnaAround.lineLabel([.link, .backlink], names) == "links both ways")
        #expect(DnaAround.map(ix, center: "missing", expanded: [], ai: true, names: names) == nil)
    }

    @Test func aFreshMapIsCalmer() {
        let fresh = DnaSettings()
        #expect(fresh.filter.hideOrphans == true && fresh.filter.hideAiLines == true)
        let v = DemoEngine.graph
        let f = DnaMath.filter(v.nodes, v.edges + [GraphEdge(source: "a1", target: "b1", kind: "similar", inferred: true)], fresh.filter)
        #expect(!f.nodes.contains { $0.id.hasPrefix("u") })
        #expect(!f.edges.contains { $0.kind == "similar" })
        // Saved settings from before keep what they showed.
        #expect(DnaSettings.read(#"{"filter":{"hideOrphans":false}}"#)?.filter.hideAiLines == nil)
        #expect(DnaMath.labelBudget(0.3, 100) == 12 && DnaMath.labelBudget(1, 100) == 100)
    }

    // MARK: pictures

    @Test func pictures() async throws {
        _ = FoleviFonts.register()
        let out: [(name: String, route: String, size: CGSize, tour: Bool, panel: String?)] = [
            ("dna-note-mac", "/graph?note=a3", CGSize(width: 1180, height: 820), false, nil),
            ("dna-panel-mac", "/graph?note=a3", CGSize(width: 1180, height: 820), false, "a0"),
            ("dna-tour-mac", "/graph", CGSize(width: 1180, height: 820), true, nil),
            ("dna-note-iphone", "/graph?note=a3", CGSize(width: 393, height: 852), false, "a3"),
        ]
        for o in out {
            for scheme in [ColorScheme.light, .dark] {
                UserDefaults.standard.set(!o.tour, forKey: "folevi.dna.tourDone")
                let demo = DemoEngine(now: Date(timeIntervalSince1970: 1_800_000_000))
                let frame = FrameModel(client: demo.client())
                let models = ScreenModels(frame: frame)
                let root = ScreenRoot(model: frame, models: models, route: .web(o.route))
                    .environment(\.colorScheme, scheme)
                    .frame(width: o.size.width, height: o.size.height)
                let view = NSHostingView(rootView: root)
                view.frame = CGRect(origin: .zero, size: o.size)
                let window = NSWindow(contentRect: view.frame, styleMask: [.borderless], backing: .buffered, defer: false)
                window.appearance = NSAppearance(named: scheme == .dark ? .darkAqua : .aqua)
                window.contentView = view
                window.setFrameOrigin(CGPoint(x: -20000, y: -20000))
                window.orderFrontRegardless()
                defer { window.orderOut(nil) }
                let graph = models.more.graphModel()
                await eventually("graph \(o.name)", timeout: .seconds(8)) { graph.value != nil }
                graph.panel = o.panel
                for _ in 0..<10 {
                    view.layoutSubtreeIfNeeded()
                    try? await Task.sleep(for: .milliseconds(150))
                }
                if o.route.contains("note=") { #expect(graph.shown.nodes.contains { $0.id == "a3" }, "\(o.name): the note is on its map") }
                let label = "\(o.name)-\(scheme == .dark ? "dark" : "light")"
                let image = try #require(DnaSnapshotTests.image(view, scale: 1), "\(label): couldn't draw")
                DnaSnapshotTests.check(image, view: view, named: label)
            }
        }
        UserDefaults.standard.set(true, forKey: "folevi.dna.tourDone")
    }
}
}
#endif
