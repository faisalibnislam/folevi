// The native half of the screenshot diffs (docs/MAC_REBUILD_PLAN.md section 3.2): every specimen of
// packages/design-tokens/match/specimens.json drawn in a real window, light and dark, at the file's scale,
// written as <id>-<light|dark>.png. apps/mac/scripts/match.mjs runs this with FOLEVI_MATCH_OUT set and
// compares the pictures with the web's; without it the test only checks that every specimen draws.
#if os(macOS)
import AppKit
import Foundation
import SwiftUI
import Testing
@testable import FoleviDesign

let specimensFile = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent() // FoleviDesignTests
    .deletingLastPathComponent() // Tests
    .deletingLastPathComponent() // native-kit
    .deletingLastPathComponent() // apps
    .deletingLastPathComponent() // repo
    .appendingPathComponent("packages/design-tokens/match/specimens.json")

@Suite("Match shots", .serialized) @MainActor
struct MatchShotTests {
    @Test func everySpecimenDraws() throws {
        let file = try JSONDecoder().decode(MatchSpecimens.self, from: Data(contentsOf: specimensFile))
        let out = ProcessInfo.processInfo.environment["FOLEVI_MATCH_OUT"].map { URL(fileURLWithPath: $0) }
        // Text as the Mac app draws it (it calls this at launch). Only in the harness's own run (match.mjs runs
        // this suite alone): it is process-wide, and the other snapshot references are drawn with smoothing.
        if out != nil { WebFont.useWebTextRendering() }
        if let out { try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true) }
        #expect(!file.specimens.isEmpty)
        for specimen in file.specimens {
            for scheme in [ColorScheme.light, .dark] {
                let image = try #require(windowShot(MatchSpecimenView(specimen), scheme: scheme, scale: file.scale), "\(specimen.id) didn't draw")
                #expect(image.width == Int(specimen.width * file.scale), "\(specimen.id): \(image.width) px wide")
                if let out, let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) {
                    try png.write(to: out.appendingPathComponent("\(specimen.id)-\(scheme == .dark ? "dark" : "light").png"))
                }
            }
        }
    }

    /// The view in an off-screen window with the scheme's appearance, drawn into a bitmap at `scale`.
    func windowShot<V: View>(_ view: V, scheme: ColorScheme, scale: CGFloat) -> CGImage? {
        FoleviFonts.register()
        let host = NSHostingView(rootView: view.environment(\.colorScheme, scheme))
        let size = host.fittingSize
        host.frame = CGRect(origin: .zero, size: size)
        let window = NSWindow(contentRect: host.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: scheme == .dark ? .darkAqua : .aqua)
        window.contentView = host
        window.setFrameOrigin(CGPoint(x: -20000, y: -20000))
        window.orderFrontRegardless()
        defer { window.orderOut(nil) }
        host.layoutSubtreeIfNeeded()
        RunLoop.main.run(until: Date().addingTimeInterval(0.05))
        // sRGB, as the browser's screenshots are, so colours compare channel for channel.
        guard let rep = NSBitmapImageRep(
            bitmapDataPlanes: nil, pixelsWide: Int(size.width * scale), pixelsHigh: Int(size.height * scale),
            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
        )?.retagging(with: .sRGB) else { return nil }
        rep.size = size
        host.cacheDisplay(in: host.bounds, to: rep)
        return rep.cgImage
    }
}
#endif
