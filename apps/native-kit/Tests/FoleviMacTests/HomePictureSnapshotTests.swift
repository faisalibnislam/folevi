// Home's picture in Show All Tabs and the strip's hover card (the owner, 21 November 2026): drawn from Home's own
// data, a "Recent notes" row of note cards and a "Recent folders" row of folder cards, every card whole at the
// picture's 16:10 (a picture of the window cropped it). Drawn on the scripted engine, light and dark, and compared to
// 1x references in __Snapshots__ (written when missing or with FOLEVI_RECORD_SNAPSHOTS=1).
#if os(macOS)
import AppKit
import Foundation
import SwiftUI
import Testing
import FoleviDesign
import FoleviEngine
@testable import FoleviMac
import FoleviScreens

@Suite("Home's tab picture", .serialized) @MainActor
struct HomePictureSnapshotTests {
    @Test func homePictureLightAndDark() async throws {
        _ = FoleviFonts.register()
        let size = CGSize(width: 480, height: 300)
        for scheme in [ColorScheme.light, .dark] {
            let demo = DemoEngine(now: Date(timeIntervalSince1970: 1_800_000_000))
            let frame = FrameModel(client: demo.client())
            let root = TabPicture(tab: nil, model: frame)
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
            for _ in 0..<12 {
                view.layoutSubtreeIfNeeded()
                try? await Task.sleep(for: .milliseconds(150))
            }
            let label = "home-picture-\(scheme == .dark ? "dark" : "light")"
            let image = try #require(DnaSnapshotTests.image(view, scale: 1), "\(label): couldn't draw")
            DnaSnapshotTests.check(image, view: view, named: label)
        }
    }
}
#endif
