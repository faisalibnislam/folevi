// The redesigned Home (the web's HomeDashboard.tsx, design version 19): the block rules as homeLayout.ts has them
// (order, pairs, move, hide, unknown ids), the words (greeting, reading time, Up next), Foli DNA of the week, and
// Customize, Reset and the capture field through the engine (home.setLayout, note.create) on the scripted engine.
// With FOLEVI_HOME_OUT set, the Mac Home is drawn there whole, light and dark, plain and in Customize mode.
#if os(macOS)
import AppKit
import Foundation
import SwiftUI
import Testing
import FoleviDesign
import FoleviEngine
@testable import FoleviMac
import FoleviScreens

@Suite("Home dashboard", .serialized) @MainActor
struct HomeDashboardTests {
    @Test func theDefaultOrderPairsAtAGlanceWithFoliDnaAndTodayWithMyTasks() {
        let rows = HomeBlocks.arrange(nil)
        #expect(rows.filter { !$0.hidden }.map(\.block) == [.recent, .bookmarks, .folders, .stats, .dna, .today, .tasks])
        #expect(rows.filter(\.hidden).map(\.block) == [.shared, .pinned, .templates])
        let laid = HomeBlocks.rows(rows.filter { !$0.hidden }.map(\.block))
        #expect(laid == [.one(.recent), .one(.bookmarks), .one(.folders), .pair(main: [.stats], side: [.dna]), .pair(main: [.today], side: [.tasks])])
    }

    @Test func aSavedLayoutKeepsItsOrderDropsUnknownIdsAndPlacesNewBlocks() {
        let saved = HomeLayout(order: ["dna", "recent", "scratch", "today"], hidden: ["today"])
        let rows = HomeBlocks.arrange(saved)
        // Unnamed blocks go in after the block before them by default; unknown ids are gone.
        #expect(rows.map(\.block) == [.dna, .recent, .bookmarks, .folders, .stats, .today, .tasks, .shared, .pinned, .templates])
        #expect(rows.first { $0.block == .today }?.hidden == true)
        #expect(rows.first { $0.block == .shared }?.hidden == true)
        // A side block alone is drawn on its own row.
        #expect(HomeBlocks.rows([.dna, .recent]) == [.one(.dna), .one(.recent)])
    }

    @Test func movingAndHidingAsTheWebDoes() {
        let moved = HomeBlocks.move(nil, .bookmarks, by: -1)
        #expect(Array(moved.order.prefix(3)) == ["bookmarks", "recent", "folders"])
        // The first can't move earlier.
        #expect(HomeBlocks.move(nil, .recent, by: -1).order == HomeBlocks.arrange(nil).map(\.block.rawValue))
        let hidden = HomeBlocks.setHidden(nil, .dna, true)
        #expect(hidden.hidden.contains("dna"))
        let back = HomeBlocks.setHidden(hidden, .templates, false)
        #expect(back.order.last == "templates")
        #expect(!back.hidden.contains("templates"))
    }

    @Test func words() {
        #expect(HomeWords.greeting(hour: 4) == "Good evening")
        #expect(HomeWords.greeting(hour: 9, name: "Faisal Islam") == "Good morning, Faisal")
        #expect(HomeWords.greeting(hour: 14, name: "") == "Good afternoon")
        #expect(HomeWords.greeting(hour: 20) == "Good evening")
        #expect(HomeWords.readingTime(100) == "under a minute of reading")
        #expect(HomeWords.readingTime(9044) == "≈ 38 min of reading")
        #expect(HomeWords.readingTime(238 * 180) == "≈ 3 h of reading")
        #expect(HomeWords.readingTime(238 * 90) == "≈ 1.5 h of reading")
        let now = 1_000_000_000
        #expect(HomeWords.upNextTag(at: now + 25 * 60_000, end: nil, now: now) == "Up next · in 25 min")
        #expect(HomeWords.upNextTag(at: now + 70 * 60_000, end: nil, now: now) == "Up next · in 1 h 10 min")
        #expect(HomeWords.upNextTag(at: now + 120 * 60_000, end: nil, now: now) == "Up next · in 2 h")
        #expect(HomeWords.upNextTag(at: now - 1, end: now + 10, now: now) == "Now")
        #expect(HomeWords.upNextTag(at: nil, end: nil, now: now) == nil)
    }

    @Test func foliDnaOfTheWeekPutsTheMostLinkedNoteInTheMiddle() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let ms = now.timeIntervalSince1970 * 1000
        var graph = DemoEngine.graph
        let template = graph.nodes[0]
        func node(_ id: String) -> GraphNode {
            var n = template
            n.id = id
            n.kind = "note"
            n.label = id.uppercased()
            return n
        }
        graph.nodes = ["a", "b", "c", "d"].map(node)
        graph.edges = [
            GraphEdge(source: "a", target: "b", kind: "link", inferred: false, createdAt: ms - 1000),
            GraphEdge(source: "c", target: "b", kind: "link", inferred: false, createdAt: ms - 2000),
            GraphEdge(source: "d", target: "a", kind: "link", inferred: false, createdAt: ms - 30 * 86_400_000),
        ]
        let week = HomeDnaWeek.of(graph, now: now)
        #expect(week.count == 2)
        #expect(week.hub?.id == "b")
        #expect(week.around.map(\.id) == ["a", "c"])
    }

    @Test func customizeAndResetSaveTheLayoutThroughTheEngine() async {
        let demo = DemoEngine(now: Date(timeIntervalSince1970: 1_800_000_000))
        let model = HomeDashboardModel(client: demo.client(), defaults: UserDefaults(suiteName: "home-dash-\(UUID())")!)
        await eventually("prefs", timeout: .seconds(8)) { model.prefs.value != nil }
        model.hide(.dna)
        #expect(!model.shown.contains(.dna))
        await eventually("saved", timeout: .seconds(8)) { demo.homeLayout?.hidden.contains("dna") == true && model.prefs.value?.layout?.hidden.contains("dna") == true }
        #expect(model.hiddenBlocks.contains(.dna))
        model.reset()
        await eventually("reset", timeout: .seconds(8)) { demo.homeLayout == nil && model.prefs.value?.layout == nil }
        #expect(model.shown.contains(.dna))
    }

    @Test func theCaptureFieldSavesANoteWhereItSays() async {
        let demo = DemoEngine(now: Date(timeIntervalSince1970: 1_800_000_000))
        let model = HomeDashboardModel(client: demo.client(), defaults: UserDefaults(suiteName: "home-dash-\(UUID())")!)
        await eventually("session", timeout: .seconds(8)) { model.session.value != nil }
        model.loadFolders()
        let space = model.spaces[0].id
        await eventually("folders", timeout: .seconds(8)) { !model.folders(in: space).isEmpty }
        model.pick(HomeCaptureDest(space: space, folderId: "fld_trips"))
        #expect(model.destLabel.hasSuffix("Trips"))
        let before = demo.notes.count
        let ok = await model.capture("Packing list\nPassport, charger")
        #expect(ok)
        #expect(demo.notes.count == before + 1)
        #expect(demo.notes.contains { $0.folder?.id == "fld_trips" && $0.title == "Packing list" })
    }

    @Test func homePictures() async throws {
        guard let path = ProcessInfo.processInfo.environment["FOLEVI_HOME_OUT"] else { return }
        let out = URL(fileURLWithPath: path)
        try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
        _ = FoleviFonts.register()
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        ScreenClock.fixed = now
        defer { ScreenClock.fixed = nil }
        for (name, size, editing) in [("home-mac", CGSize(width: 1320, height: 2050), false), ("home-mac-customize", CGSize(width: 1320, height: 2250), true), ("home-narrow", CGSize(width: 820, height: 2900), false)] {
            for scheme in [ColorScheme.light, .dark] {
                let demo = DemoEngine(now: now)
                let frame = FrameModel(client: demo.client())
                let models = ScreenModels(frame: frame)
                if editing { models.homeModel().dashboard.editing = true }
                let root = ScreenRoot(model: frame, models: models, route: .home)
                    .environment(\.colorScheme, scheme)
                    .frame(width: size.width, height: size.height)
                    .background(MacLook.Colors.container)
                let view = NSHostingView(rootView: root)
                view.frame = CGRect(origin: .zero, size: size)
                let window = NSWindow(contentRect: view.frame, styleMask: [.borderless], backing: .buffered, defer: false)
                window.appearance = NSAppearance(named: scheme == .dark ? .darkAqua : .aqua)
                window.contentView = view
                window.setFrameOrigin(CGPoint(x: -20000, y: -20000))
                window.orderFrontRegardless()
                for _ in 0..<16 {
                    view.layoutSubtreeIfNeeded()
                    try? await Task.sleep(for: .milliseconds(150))
                }
                if let image = DnaSnapshotTests.image(view, scale: 1), let data = DnaSnapshotTests.png(image) {
                    try? data.write(to: out.appendingPathComponent("\(name)-\(scheme == .dark ? "dark" : "light").png"))
                }
                window.orderOut(nil)
            }
        }
    }
}
#endif
