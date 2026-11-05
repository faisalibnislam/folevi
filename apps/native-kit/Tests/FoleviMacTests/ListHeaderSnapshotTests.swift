// The title rows of a folder's page and the Folders page (the owner, 6 November 2026): a folder's mark, name, the way
// up when nested, "N notes · edited …", Share, its menu and New note; the Folders page's name, count and New folder;
// a folder's subfolders under a small "Folders" heading. The title row, the toolbar and the cards share their left and
// right edges. Drawn by ScreenRoot on the scripted engine at the Mac's and the iPad's widths, light and dark, and
// compared to 1x references in __Snapshots__ (written when missing or with FOLEVI_RECORD_SNAPSHOTS=1); written at 2x
// to FOLEVI_SCREENS_OUT when set.
#if os(macOS)
import AppKit
import Foundation
import SwiftUI
import Testing
import FoleviDesign
import FoleviEngine
@testable import FoleviMac
import FoleviScreens

@Suite("List page title rows", .serialized) @MainActor
struct ListHeaderSnapshotTests {
    static let sizes: [(name: String, size: CGSize)] = [("mac", CGSize(width: 1180, height: 820)), ("ipad", CGSize(width: 1024, height: 900))]
    static let pages: [(name: String, route: FrameRoute)] = [("folder-nested", .folder("fld_projects")), ("folder", .folder("fld_trips")), ("folders", .web("/folders")), ("all-notes", .notes(.all))]

    init() {
        // The default layouts and sorts, not ones another run kept.
        for k in ["folevi.web.layout.folder", "folevi.web.folders-sort", "folevi.web.folders-layout", "folevi.sort.folder"] { UserDefaults.standard.removeObject(forKey: k) }
    }

    @Test func titleRowsLightAndDark() async throws {
        _ = FoleviFonts.register()
        for (page, route) in Self.pages {
            for (name, size) in Self.sizes {
                for scheme in [ColorScheme.light, .dark] {
                    let demo = DemoEngine(now: Date(timeIntervalSince1970: 1_800_000_000))
                    let frame = FrameModel(client: demo.client())
                    let models = ScreenModels(frame: frame)
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
                    let cards = models.allFolderCards()
                    await eventually("\(page) \(name)", timeout: .seconds(8)) {
                        if case .folder(let id) = route {
                            let list = models.list(.folder(id))
                            return !list.isLoading && list.tree.value != nil && cards.value != nil && list.session.value != nil
                        }
                        if case .notes(let v) = route { return !models.list(NotesListKind(v)).isLoading }
                        return cards.value != nil
                    }
                    for _ in 0..<8 {
                        view.layoutSubtreeIfNeeded()
                        try? await Task.sleep(for: .milliseconds(150))
                    }
                    let label = "list-header-\(page)-\(name)-\(scheme == .dark ? "dark" : "light")"
                    let image = try #require(DnaSnapshotTests.image(view, scale: 1), "\(label): couldn't draw")
                    DnaSnapshotTests.check(image, view: view, named: label)
                }
            }
        }
    }
}
#endif
