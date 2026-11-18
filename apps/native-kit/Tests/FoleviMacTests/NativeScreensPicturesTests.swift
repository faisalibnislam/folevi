// The Mac's native look on every screen inside the content card (docs/MAC_NATIVE_LOOK.md, 2026-11-18): ScreenRoot
// on the scripted engine at the Mac's size, light and dark, with the card's top bar room left empty, written at 2x
// to FOLEVI_NATIVE_OUT when it's set, to look at. No references are kept (the screens' own snapshot suites keep
// theirs); without the variable the test draws nothing.
#if os(macOS)
import AppKit
import Foundation
import SwiftUI
import Testing
import FoleviDesign
import FoleviEngine
@testable import FoleviMac
import FoleviScreens

@Suite("Native look pictures", .serialized) @MainActor
struct NativeScreensPicturesTests {
    static var out: URL? { ProcessInfo.processInfo.environment["FOLEVI_NATIVE_OUT"].map { URL(fileURLWithPath: $0) } }

    static let routes: [(String, FrameRoute)] = [
        ("home", .home), ("all-notes", .notes(.all)), ("drafts", .notes(.unsorted)), ("starred", .notes(.starred)),
        ("archive", .notes(.archive)), ("trash", .notes(.trash)), ("templates", .notes(.templates)),
        ("folder", .folder("fld_work")), ("folder-nested", .folder("fld_projects")), ("folders", .web("/folders")),
        ("tags", .web("/tags")), ("tag", .tag("tag_ideas")), ("shared", .shared), ("changes", .changes),
        ("tasks", .tasks(.all)), ("calendar", .calendar(nil)), ("ai", .web("/ai")), ("vault", .web("/vault")),
        ("graph", .web("/graph")), ("review", .web("/review")), ("help", .web("/help")), ("catch-up", .catchUp),
        ("missing", .web("/nowhere")),
    ]

    /// Draws `view` light and dark into the output folder.
    func draw<V: View>(_ name: String, size: CGSize, settle: Int = 6, _ view: () -> V) async {
        guard let out = Self.out else { return }
        try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
        for scheme in [ColorScheme.light, .dark] {
            let root = view().environment(\.colorScheme, scheme).frame(width: size.width, height: size.height)
                .background(MacLook.Colors.container)
            let host = NSHostingView(rootView: root)
            host.frame = CGRect(origin: .zero, size: size)
            let window = NSWindow(contentRect: host.frame, styleMask: [.borderless], backing: .buffered, defer: false)
            window.appearance = NSAppearance(named: scheme == .dark ? .darkAqua : .aqua)
            window.contentView = host
            window.setFrameOrigin(CGPoint(x: -20000, y: -20000))
            window.orderFrontRegardless()
            for _ in 0..<settle {
                host.layoutSubtreeIfNeeded()
                try? await Task.sleep(for: .milliseconds(150))
            }
            if let image = DnaSnapshotTests.image(host, scale: 2), let data = DnaSnapshotTests.png(image) {
                try? data.write(to: out.appendingPathComponent("\(name)-\(scheme == .dark ? "dark" : "light").png"))
            }
            window.orderOut(nil)
        }
    }

    @Test func dialogs() async throws {
        guard Self.out != nil else { return }
        _ = FoleviFonts.register()
        let demo = DemoEngine(now: Date(timeIntervalSince1970: 1_800_000_000))
        let frame = FrameModel(client: demo.client())
        let models = ScreenModels(frame: frame)
        let tasksModel = models.tasksModel()
        tasksModel.select(.all)
        await eventually("tasks", timeout: .seconds(8)) { tasksModel.list.value?.view == .all }
        let row = try #require(tasksModel.list.value?.groups.flatMap(\.tasks).first)
        let tasks = PlannerTasks(frame: frame, host: tasksModel)
        await draw("dialog-edit-task", size: CGSize(width: 560, height: 520)) {
            TaskEditDialog(tasks: tasks, task: row, close: {}).padding(40)
        }
        await draw("dialog-new-folder", size: CGSize(width: 480, height: 280)) {
            PromptSheet(title: "New folder", label: "Folder name", initial: "Trips", confirm: "Create folder", close: {}, onSubmit: { _ in }).padding(40)
        }
        await draw("dialog-delete-folders", size: CGSize(width: 480, height: 280)) {
            DeleteFoldersSheet(title: "Delete 2 folders?", close: {}, confirm: {}).padding(40)
        }
    }

    @Test func everyScreenLightAndDark() async throws {
        guard let out = Self.out else { return }
        let only = ProcessInfo.processInfo.environment["FOLEVI_NATIVE_ONLY"].map { Set($0.split(separator: ",").map(String.init)) }
        _ = FoleviFonts.register()
        try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
        UserDefaults.standard.set(true, forKey: "folevi.dna.tourDone")
        let size = CGSize(width: 1180, height: 820)
        for (name, route) in Self.routes where only?.contains(name) ?? true {
            for scheme in [ColorScheme.light, .dark] {
                let demo = DemoEngine(now: Date(timeIntervalSince1970: 1_800_000_000))
                let frame = FrameModel(client: demo.client())
                let models = ScreenModels(frame: frame)
                let root = ScreenRoot(model: frame, models: models, route: route)
                    .environment(\.colorScheme, scheme)
                    .frame(width: size.width, height: size.height)
                let view = NSHostingView(rootView: root)
                view.frame = CGRect(origin: .zero, size: size)
                let window = NSWindow(contentRect: view.frame, styleMask: [.borderless], backing: .buffered, defer: false)
                window.appearance = NSAppearance(named: scheme == .dark ? .darkAqua : .aqua)
                window.contentView = view
                window.setFrameOrigin(CGPoint(x: -20000, y: -20000))
                window.orderFrontRegardless()
                for _ in 0..<14 {
                    view.layoutSubtreeIfNeeded()
                    try? await Task.sleep(for: .milliseconds(150))
                }
                if let image = DnaSnapshotTests.image(view, scale: 2), let data = DnaSnapshotTests.png(image) {
                    try? data.write(to: out.appendingPathComponent("\(name)-\(scheme == .dark ? "dark" : "light").png"))
                }
                window.orderOut(nil)
            }
        }
    }
}
#endif
