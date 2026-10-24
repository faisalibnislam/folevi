// Snapshot tests of the screens (plan section 10): each screen hosted at iPhone and iPad sizes (iOS Simulator)
// or the Mac size (macOS), light and dark, against a scripted engine with the contract fixtures and a fixed
// clock. Core screens compare to 1x references in __Snapshots__; every screen also writes a 2x picture to
// FOLEVI_SCREENS_OUT when set. And the scrolling performance test over 5,000 notes.
//
//   FOLEVI_RECORD_SNAPSHOTS=1   record references       FOLEVI_SCREENS_OUT=/dir   write every picture
import Foundation
import SwiftUI
import Testing
@testable import FoleviDesign
@testable import FoleviEngine
@testable import FoleviScreens

/// What the frame would draw around a screen: its title and bar items (iOS), or a plain title (Mac content).
struct Framed<Content: View, Bar: ToolbarContent>: View {
    let title: String
    let large: Bool
    @ViewBuilder let content: () -> Content
    @ToolbarContentBuilder let bar: () -> Bar

    var body: some View {
        #if os(iOS)
        NavigationStack {
            content()
                .navigationTitle(title)
                .navigationBarTitleDisplayMode(large ? .large : .inline)
                .toolbar { bar() }
        }
        #else
        VStack(alignment: .leading, spacing: 0) {
            if !large {
                Text(title).foleviFont(.title).foregroundStyle(Folevi.color.heading).padding(.horizontal, 28).padding(.top, 18).padding(.bottom, 4)
            }
            content()
        }
        #endif
    }
}

let fixedNow = Date(timeIntervalSince1970: 1_792_836_000)

/// The revision 4 views from the contract's own fixtures.
@MainActor
func sampleValues(_ engine: FakeEngine) {
    for (view, file) in [("templates.builtIn", "view.templates.builtIn.json"), ("changes", "view.changes.json"), ("shared.list", "view.shared.list.json"), ("folders.cards", "view.folders.cards.json"), ("trash.summary", "view.trash.summary.json")] {
        engine.values[view] = Fixtures.value(file)
    }
}

/// Screens drawn in real windows: one at a time, so timings and pictures never share the main thread.
@Suite("Rendering", .serialized) @MainActor
struct Rendering {}

extension Rendering {
@Suite("Screen snapshots", .serialized) @MainActor
struct ScreenSnapshotTests {
    init() { ScreenClock.fixed = fixedNow }

    func defaults(_ layout: NotesLayout? = nil, view: NotesListView = .all) -> UserDefaults {
        let d = UserDefaults(suiteName: "folevi.snap.\(UUID().uuidString)")!
        if let layout { d.set(layout.rawValue, forKey: "folevi.layout.\(view.rawValue)") }
        return d
    }

    func run<V: View>(_ name: String, reference: Bool, ready: @escaping () -> Bool, prepare: () -> Void = {}, _ make: () -> V) async {
        for size in hostSizes {
            for scheme in [ColorScheme.light, .dark] {
                let host = ScreenHost(make(), size: size, scheme: scheme)
                prepare()
                await eventually(name, timeout: .seconds(8), ready)
                await host.settle(0.6)
                checkScreen(host, named: "\(name)-\(size.rawValue)-\(scheme == .dark ? "dark" : "light")-\(hostPlatform)", reference: reference)
                host.close()
            }
        }
    }

    @Test func home() async {
        let engine = FakeEngine()
        let model = HomeModel(client: engine.client())
        await run("home", reference: true, ready: { model.value != nil && model.session.value != nil && model.tree.value != nil }) {
            Framed(title: "Home", large: true) {
                #if os(iOS)
                HomeScreen(model: model)
                #else
                HomeScreen(model: model, showsHeader: true)
                #endif
            } bar: { HomeToolbar(model: model) }
        }
    }

    @Test func allNotesCards() async {
        let engine = FakeEngine(rows: 40)
        let model = NotesListModel(client: engine.client(), kind: NotesListKind(.all), defaults: defaults(.cards))
        await run("all-notes-cards", reference: true, ready: { model.total == 40 && model.session.value != nil }) {
            Framed(title: model.title, large: true) { NotesListScreen(model: model) } bar: { NotesListToolbar(model: model) }
        }
    }

    @Test func allNotesList() async {
        let engine = FakeEngine(rows: 40)
        let model = NotesListModel(client: engine.client(), kind: NotesListKind(.all), defaults: defaults(.list))
        await run("all-notes-list", reference: true, ready: { model.total == 40 && model.session.value != nil }) {
            Framed(title: model.title, large: true) { NotesListScreen(model: model) } bar: { NotesListToolbar(model: model) }
        }
    }

    @Test func folder() async {
        let engine = FakeEngine(rows: 12)
        sampleValues(engine)
        let model = NotesListModel(client: engine.client(), kind: .folder("fld_trips"), defaults: defaults(.cards, view: .folder))
        await run("folder", reference: true, ready: { model.total == 12 && model.tree.value != nil && model.subfolderCards?.value != nil }) {
            Framed(title: "Trips", large: true) { NotesListScreen(model: model) } bar: { NotesListToolbar(model: model) }
        }
    }

    @Test func selectMode() async {
        let engine = FakeEngine(rows: 20)
        let model = NotesListModel(client: engine.client(), kind: NotesListKind(.all), defaults: defaults(.cards))
        await run("select-mode", reference: false, ready: { model.total == 20 }, prepare: {
            model.selecting = true
            model.selection = ["n00000", "n00002", "n00003"]
        }) {
            Framed(title: model.selectionStatus, large: false) { NotesListScreen(model: model) } bar: { NotesListToolbar(model: model) }
        }
    }

    @Test func trash() async {
        let engine = FakeEngine(rows: 8)
        let model = NotesListModel(client: engine.client(), kind: NotesListKind(.trash), defaults: defaults())
        await run("trash", reference: false, ready: { model.total == 8 }) {
            Framed(title: model.title, large: true) { NotesListScreen(model: model) } bar: { NotesListToolbar(model: model) }
        }
    }

    @Test func draftsEmpty() async {
        let engine = FakeEngine(rows: 0)
        let model = NotesListModel(client: engine.client(), kind: NotesListKind(.unsorted), defaults: defaults())
        await run("drafts-empty", reference: false, ready: { model.store.status == .live }) {
            Framed(title: model.title, large: true) { NotesListScreen(model: model) } bar: { NotesListToolbar(model: model) }
        }
    }

    @Test func templates() async {
        let engine = FakeEngine(rows: 3)
        sampleValues(engine)
        let model = NotesListModel(client: engine.client(), kind: NotesListKind(.templates), defaults: defaults(.list, view: .templates))
        await run("templates", reference: false, ready: { model.total == 3 && model.builtIns?.value != nil }) {
            Framed(title: model.title, large: true) { NotesListScreen(model: model) } bar: { NotesListToolbar(model: model) }
        }
    }

    @Test func shared() async {
        let engine = FakeEngine()
        sampleValues(engine)
        let model = SharedListModel(client: engine.client())
        await run("shared", reference: false, ready: { !model.rows.isEmpty }) {
            Framed(title: model.title, large: true) { SharedListScreen(model: model) } bar: { ToolbarItem { EmptyView() } }
        }
    }

    @Test func changes() async {
        let engine = FakeEngine()
        sampleValues(engine)
        let model = ChangesModel(client: engine.client())
        await run("changes", reference: false, ready: { model.changes.value != nil }) {
            Framed(title: "Changes", large: true) { ChangesScreen(model: model) } bar: { ToolbarItem { EmptyView() } }
        }
    }
}
}

@MainActor
func nextTurn() async {
    await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
        DispatchQueue.main.async { c.resume() }
    }
}

extension Rendering {
@Suite("Scrolling 5,000 notes", .serialized) @MainActor
struct ScrollPerformanceTests {
    /// A fling through the list at 40 pt a frame (a fast flick at 120 Hz moves 25 to 40 pt a frame) for 240
    /// frames, timing each frame's work (the scroll, SwiftUI's update and the commit, two turns of the main run
    /// loop), across several window moves. Then jumps to the middle and the end and checks the window follows.
    /// Budgets are loose on purpose: Simulator and debug builds are several times slower than a release build
    /// on a device, where plan 10's budget is 8 ms a frame (measured there with signposts).
    func scroll(layout: NotesLayout) async throws -> (avg: Double, p95: Double, max: Double, start: Int) {
        let engine = FakeEngine(rows: 5000)
        let d = UserDefaults(suiteName: "folevi.perf.\(UUID().uuidString)")!
        d.set(layout.rawValue, forKey: "folevi.layout.all")
        let model = NotesListModel(client: engine.client(), kind: NotesListKind(.all), defaults: d)
        let host = ScreenHost(NotesListScreen(model: model), size: hostSizes[0], scheme: .light)
        defer { host.close() }
        await eventually("5,000 rows", timeout: .seconds(5)) { model.total == 5000 }
        await host.settle(0.5)
        let scroll = try #require(host.scrollView(), "no scroll view")
        #if os(iOS)
        let height = scroll.contentSize.height - scroll.bounds.height
        #else
        let height = (scroll.documentView?.frame.height ?? 0) - scroll.contentView.bounds.height
        #endif
        #expect(height > 50_000, "the list is as tall as 5,000 rows (\(height))")
        func go(_ y: CGFloat) {
            #if os(iOS)
            scroll.contentOffset = CGPoint(x: 0, y: y)
            scroll.layoutIfNeeded()
            #else
            scroll.contentView.scroll(to: CGPoint(x: 0, y: y))
            scroll.reflectScrolledClipView(scroll.contentView)
            scroll.layoutSubtreeIfNeeded()
            #endif
        }
        var times: [Double] = []
        for frame in 1...240 {
            let t0 = CFAbsoluteTimeGetCurrent()
            go(CGFloat(frame) * 40)
            await nextTurn()
            await nextTurn()
            times.append((CFAbsoluteTimeGetCurrent() - t0) * 1000)
        }
        for fraction in [0.5, 1.0] {
            go(height * fraction)
            await nextTurn()
            await eventually("window near \(fraction)", timeout: .seconds(3)) { model.store.state.start > Int(4000 * fraction) - 300 }
        }
        let hitches = times.enumerated().filter { $0.element > 33 }.map { "frame \($0.offset + 1): \(Int($0.element)) ms" }
        print("PERF fake engine window pushes (test overhead on the main thread): \(engine.pushMillis.map { Int($0) })")
        if !hitches.isEmpty { print("PERF hitches (\(layout.rawValue)): \(hitches.joined(separator: ", "))") }
        let sorted = times.sorted()
        return (times.reduce(0, +) / Double(times.count), sorted[Int(Double(sorted.count) * 0.95)], sorted.last ?? 0, model.store.state.start)
    }

    @Test func listLayout() async throws {
        let r = try await scroll(layout: .list)
        print("PERF \(hostPlatform) list 5000 rows: avg \(String(format: "%.2f", r.avg)) ms, p95 \(String(format: "%.2f", r.p95)) ms, max \(String(format: "%.2f", r.max)) ms per frame; window start at the end \(r.start)")
        #expect(r.p95 < 33, "p95 \(r.p95) ms per frame")
    }

    @Test func cardLayout() async throws {
        let r = try await scroll(layout: .cards)
        print("PERF \(hostPlatform) cards 5000 rows: avg \(String(format: "%.2f", r.avg)) ms, p95 \(String(format: "%.2f", r.p95)) ms, max \(String(format: "%.2f", r.max)) ms per frame; window start at the end \(r.start)")
        #expect(r.p95 < 33, "p95 \(r.p95) ms per frame")
    }
}
}
