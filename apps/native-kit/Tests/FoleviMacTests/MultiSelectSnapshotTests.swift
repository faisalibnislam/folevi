// Finder-style multi-select on the Mac and the iPad (ListSelection; docs/DESIGN_SYSTEM.md "Multi-select"): a folder's
// page with one of its folders and one of its notes selected (the wash and check on each, the floating bar with only
// Open in new tabs and Move to folder), and All notes with two notes selected. Drawn by ScreenRoot on the scripted
// engine at the Mac's and the iPad's widths, light and dark; written at 2x to FOLEVI_SCREENS_OUT when set (no
// reference images: the selection's look is checked by eye, its rules by ListSelectionTests).
#if os(macOS)
import AppKit
import Foundation
import SwiftUI
import Testing
import FoleviDesign
import FoleviEngine
@testable import FoleviMac
import FoleviScreens

@Suite("Multi-select pictures", .serialized) @MainActor
struct MultiSelectSnapshotTests {
    static let sizes: [(name: String, size: CGSize)] = [("mac", CGSize(width: 1180, height: 820)), ("ipad", CGSize(width: 1024, height: 900))]

    init() {
        for k in ["folevi.web.layout.folder", "folevi.web.layout.all", "folevi.sort.folder", "folevi.sort.all"] { UserDefaults.standard.removeObject(forKey: k) }
    }

    @Test func selectionsLightAndDark() async throws {
        _ = FoleviFonts.register()
        for (page, route) in [("folder-mixed", FrameRoute.folder("fld_work")), ("all-notes", .notes(.all))] {
            for (name, size) in Self.sizes {
                for scheme in [ColorScheme.light, .dark] {
                    let demo = DemoEngine(now: Date(timeIntervalSince1970: 1_800_000_000))
                    let frame = FrameModel(client: demo.client())
                    let models = ScreenModels(frame: frame)
                    let list: NotesListModel = if case .folder(let id) = route { models.list(.folder(id)) } else { models.list(NotesListKind(.all)) }
                    let root = ScreenRoot(model: frame, models: models, route: route)
                        .background(WebStyles.vars["color-canvas"]?.resolve(scheme).color ?? .white)
                        .environment(\.colorScheme, scheme)
                        .frame(width: size.width, height: size.height)
                    let view = NSHostingView(rootView: root)
                    view.frame = CGRect(origin: .zero, size: size)
                    let window = NSWindow(contentRect: view.frame, styleMask: [.borderless], backing: .buffered, defer: false)
                    window.appearance = NSAppearance(named: scheme == .dark ? .darkAqua : .aqua)
                    window.contentView = view
                    window.setFrameOrigin(CGPoint(x: -20000, y: -20000))
                    window.orderFrontRegardless()
                    defer { window.orderOut(nil) }
                    await eventually("\(page) \(name)", timeout: .seconds(8)) { !list.isLoading && list.tree.value != nil && list.session.value != nil && !list.loadedRows.isEmpty }
                    let notes = list.slots.compactMap(\.row?.id)
                    try #require(notes.count >= 2, "\(page): notes to select")
                    if case .folder = route {
                        let folder = try #require(list.subfolders.first?.id, "the folder has a folder inside")
                        list.select(folder, range: false)
                        list.select(notes[0], range: false)
                        #expect(list.bulkActions(tabs: true) == [.openTabs, .move], "a folder and a note: only what both take")
                        #expect(list.selectionDragItem(forFolder: folder)?.folders.map(\.id) == [folder])
                    } else {
                        list.select(notes[0], range: false)
                        list.select(notes[1], range: true)
                        #expect(list.bulkActions(tabs: true).first == .openTabs)
                    }
                    for _ in 0..<8 {
                        view.layoutSubtreeIfNeeded()
                        try? await Task.sleep(for: .milliseconds(150))
                    }
                    let label = "multiselect-\(page)-\(name)-\(scheme == .dark ? "dark" : "light")"
                    let image = try #require(DnaSnapshotTests.image(view, scale: 1), "\(label): couldn't draw")
                    #expect(image.width > 0)
                    if let out = ProcessInfo.processInfo.environment["FOLEVI_SCREENS_OUT"], let big = DnaSnapshotTests.image(view, scale: 2), let data = DnaSnapshotTests.png(big) {
                        let d = URL(fileURLWithPath: out)
                        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
                        try? data.write(to: d.appendingPathComponent("\(label).png"))
                    }
                }
            }
        }
    }
}
#endif
