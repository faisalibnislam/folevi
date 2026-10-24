// Snapshot tests of Tasks, the Calendar, Search, Notifications and Places (N10, N11): each hosted at iPhone and
// iPad sizes (iOS Simulator) or the Mac size, light and dark, on the scripted engine with the contract fixtures
// and a fixed clock; compared to 1x references in __Snapshots__ and written at 2x to FOLEVI_SCREENS_OUT when set.
// And scrolling 5,000 tasks.
import Foundation
import SwiftUI
import Testing
@testable import FoleviDesign
@testable import FoleviEngine
@testable import FoleviScreens

/// A sheet or popover's content as the frames show it: full height on iPhone, a popover-sized panel elsewhere.
struct PanelFrame<Content: View>: View {
    let title: String
    let size: DeviceSize
    @ViewBuilder let content: () -> Content

    var body: some View {
        if size == .iphone {
            VStack(spacing: 0) {
                Text(title).foleviFont(.headline).foregroundStyle(Folevi.color.heading).frame(maxWidth: .infinity).padding(.vertical, 14)
                content()
            }
            .background(Folevi.color.canvas)
        } else {
            ZStack(alignment: .topTrailing) {
                Folevi.color.canvas
                content()
                    .frame(width: 380, height: 560)
                    .background(Folevi.color.surfaceRaised)
                    .clipShape(RoundedRectangle(cornerRadius: FoleviTokens.Radius.panel, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: FoleviTokens.Radius.panel, style: .continuous).strokeBorder(Folevi.color.line))
                    .shadow(color: .black.opacity(0.12), radius: 18, y: 8)
                    .padding(.top, 60)
                    .padding(.trailing, 40)
            }
        }
    }
}

extension Rendering {
@Suite("Feature snapshots", .serialized) @MainActor
struct FeatureSnapshotTests {
    init() { ScreenClock.fixed = fixedNow }

    func run<V: View>(_ name: String, ready: @escaping () -> Bool, _ make: (DeviceSize) -> V) async {
        for size in hostSizes {
            for scheme in [ColorScheme.light, .dark] {
                let host = ScreenHost(make(size), size: size, scheme: scheme)
                await eventually(name, timeout: .seconds(8), ready)
                await host.settle(0.6)
                checkScreen(host, named: "\(name)-\(size.rawValue)-\(scheme == .dark ? "dark" : "light")-\(hostPlatform)")
                host.close()
            }
        }
    }

    @Test func tasksToday() async {
        let engine = featureEngine()
        let model = TasksModel(client: engine.client(), view: .today, defaults: testDefaults())
        await run("tasks-today", ready: { !model.sections.isEmpty && model.counts.value != nil }) { _ in
            Framed(title: TasksScreen.title, large: true) {
                TasksScreen(model: model, showsHeader: hostPlatform == "macos")
            } bar: {
                ToolbarItem(placement: .primaryAction) { TasksTrailingMenu(model: model) }
            }
        }
    }

    @Test func tasksUpcoming() async {
        let engine = featureEngine()
        let model = TasksModel(client: engine.client(), view: .upcoming, defaults: testDefaults())
        await run("tasks-upcoming", ready: { model.value?.view == .upcoming && !model.sections.isEmpty }) { _ in
            Framed(title: TasksScreen.title, large: true) {
                TasksScreen(model: model, showsHeader: hostPlatform == "macos")
            } bar: {
                ToolbarItem(placement: .primaryAction) { TasksTrailingMenu(model: model) }
            }
        }
    }

    @Test func taskDetails() async {
        let engine = featureEngine()
        let model = TasksModel(client: engine.client(), view: .today, defaults: testDefaults())
        await eventually("tasks") { !model.sections.isEmpty }
        let task = model.sections[1].tasks[0]
        await run("task-details", ready: { model.session.value != nil }) { _ in
            TaskDetailSheet(model: model, taskId: task.id, initial: task)
        }
    }

    @Test func calendar() async {
        let engine = featureEngine()
        let model = CalendarModel(client: engine.client(), defaults: testDefaults())
        await run("calendar", ready: { model.tasks.value != nil && model.events.value != nil && model.todayList.value != nil }) { size in
            Framed(title: model.title, large: size != .iphone) {
                CalendarScreen(model: model, showsHeader: false)
            } bar: {
                ToolbarItem(placement: .primaryAction) { CalendarToolbarItems(model: model) }
            }
        }
    }

    @Test func calendarWeek() async {
        let engine = featureEngine()
        let d = testDefaults()
        d.set(CalendarLayout.week.rawValue, forKey: CalendarModel.layoutKey)
        let model = CalendarModel(client: engine.client(), date: "2026-10-22", defaults: d)
        await run("calendar-week", ready: { model.tasks.value != nil && model.events.value != nil }) { size in
            Framed(title: model.title, large: size != .iphone) {
                CalendarScreen(model: model, showsHeader: false)
            } bar: {
                ToolbarItem(placement: .primaryAction) { CalendarToolbarItems(model: model) }
            }
        }
    }

    @Test func calendars() async {
        let engine = featureEngine()
        let model = CalendarModel(client: engine.client(), defaults: testDefaults())
        model.openCalendars()
        await run("calendars-sheet", ready: { model.calendars?.value != nil }) { _ in CalendarsSheet(model: model) }
    }

    @Test func search() async {
        let engine = featureEngine()
        engine.queryAnswers["search"] = { _ in Fixtures.value("view.search.json") }
        let model = SearchModel(client: engine.client(), text: "kyoto", defaults: testDefaults())
        await run("search-results", ready: { !model.searching && !model.sections.isEmpty && model.tree.value != nil }) { size in
            PanelFrame(title: "Search", size: .iphone) { SearchScreen(model: model, showsCancel: size == .iphone) }
        }
    }

    @Test func searchRecents() async {
        let engine = featureEngine()
        let d = testDefaults()
        d.set(["kyoto ryokan", "budget"], forKey: SearchModel.recentKey)
        let model = SearchModel(client: engine.client(), defaults: d)
        await run("search-recents", ready: { model.home.value != nil }) { size in
            PanelFrame(title: "Search", size: .iphone) { SearchScreen(model: model, showsCancel: size == .iphone) }
        }
    }

    @Test func notifications() async {
        let engine = featureEngine()
        let model = NotificationsModel(client: engine.client())
        await run("notifications", ready: { !model.rows.isEmpty }) { size in
            PanelFrame(title: "Notifications", size: size) { NotificationsContent(model: model, phone: size == .iphone) }
        }
    }

    @Test func places() async {
        let engine = featureEngine()
        let model = PlacesModel(client: engine.client())
        await run("places", ready: { model.places.value != nil && model.session.value != nil && model.account.value != nil }) { size in
            PanelFrame(title: "Account", size: size) { PlacesMenuContent(model: model, phone: size == .iphone) }
        }
    }
}

@Suite("Scrolling 5,000 tasks", .serialized) @MainActor
struct TaskScrollPerformanceTests {
    /// A fling through 5,000 tasks (200 notes) at 40 pt a frame for 240 frames, timing each frame's work. Budgets
    /// are loose: Simulator and debug builds are several times slower than a release build on a device.
    @Test func fling() async throws {
        ScreenClock.fixed = fixedNow
        let engine = featureEngine()
        engine.values["tasks.list"] = longTasksValue(5000)
        let model = TasksModel(client: engine.client(), view: .all, defaults: testDefaults())
        let t0 = CFAbsoluteTimeGetCurrent()
        let host = ScreenHost(TasksScreen(model: model), size: hostSizes[0], scheme: .light)
        defer { host.close() }
        await eventually("5,000 tasks", timeout: .seconds(10)) { model.total == 5000 }
        await host.settle(0.5)
        let firstDraw = (CFAbsoluteTimeGetCurrent() - t0) * 1000
        let scroll = try #require(host.scrollView(), "no scroll view")
        #if os(iOS)
        let height = scroll.contentSize.height - scroll.bounds.height
        #else
        let height = (scroll.documentView?.frame.height ?? 0) - scroll.contentView.bounds.height
        #endif
        #expect(height > 10_000, "the list is as tall as its tasks (\(height))")
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
            let t = CFAbsoluteTimeGetCurrent()
            go(CGFloat(frame) * 40)
            await nextTurn()
            await nextTurn()
            times.append((CFAbsoluteTimeGetCurrent() - t) * 1000)
        }
        let sorted = times.sorted()
        let p95 = sorted[Int(Double(sorted.count) * 0.95)]
        print("PERF \(hostPlatform) tasks 5000: first draw \(Int(firstDraw)) ms; avg \(String(format: "%.2f", times.reduce(0, +) / Double(times.count))) ms, p95 \(String(format: "%.2f", p95)) ms, max \(String(format: "%.2f", sorted.last ?? 0)) ms per frame")
        #expect(p95 < 33, "p95 \(p95) ms per frame")
    }
}
}
