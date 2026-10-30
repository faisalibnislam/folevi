// The native half of the screenshot diffs (docs/MAC_REBUILD_PLAN.md section 3.2): every specimen of
// packages/design-tokens/match/specimens.json drawn in a real window, light and dark, at the file's scale,
// written as <id>-<light|dark>.png. apps/mac/scripts/match.mjs runs this with FOLEVI_MATCH_OUT set and
// compares the pictures with the web's; without it the test only checks that every specimen draws. On iOS (the
// iPhone and iPad rebuild, docs/IOS_REBUILD_PLAN.md section 3) the same specimens are drawn in a UIWindow in the
// Simulator, at FOLEVI_MATCH_SCALE (3 for an iPhone) when it's set; `match.mjs --platform ios` runs that.
import Foundation
import SwiftUI
import Testing
@testable import FoleviDesign
#if os(macOS)
import AppKit
#elseif os(iOS)
import UIKit
#endif

let specimensFile = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent() // FoleviDesignTests
    .deletingLastPathComponent() // Tests
    .deletingLastPathComponent() // native-kit
    .deletingLastPathComponent() // apps
    .deletingLastPathComponent() // repo
    .appendingPathComponent("packages/design-tokens/match/specimens.json")

#if os(macOS)
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
        for specimen in file.specimens where specimen.checkedHere {
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
#elseif os(iOS)
@Suite("Match shots", .serialized) @MainActor
struct MatchShotTests {
    @Test func everySpecimenDraws() throws {
        let file = try JSONDecoder().decode(MatchSpecimens.self, from: Data(contentsOf: specimensFile))
        let env = ProcessInfo.processInfo.environment
        let out = env["FOLEVI_MATCH_OUT"].map { URL(fileURLWithPath: $0) }
        let scale = env["FOLEVI_MATCH_SCALE"].flatMap(Double.init).map { CGFloat($0) } ?? file.scale
        if let out { try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true) }
        #expect(!file.specimens.isEmpty)
        for specimen in file.specimens where specimen.checkedHere {
            for scheme in [ColorScheme.light, .dark] {
                let image = try #require(windowShot(MatchSpecimenView(specimen), scheme: scheme, scale: scale), "\(specimen.id) didn't draw")
                #expect(image.width == Int((specimen.width * scale).rounded()), "\(specimen.id): \(image.width) px wide")
                if let out, let png = UIImage(cgImage: image).pngData() {
                    try png.write(to: out.appendingPathComponent("\(specimen.id)-\(scheme == .dark ? "dark" : "light").png"))
                }
            }
        }
    }

    /// The view drawn by SwiftUI's ImageRenderer at `scale` (a test without an app has no window scene to draw a
    /// UIWindow in), in sRGB as the browser's screenshots are.
    func windowShot<V: View>(_ view: V, scheme: ColorScheme, scale: CGFloat) -> CGImage? {
        FoleviFonts.register()
        let renderer = ImageRenderer(content: view.environment(\.colorScheme, scheme).environment(\.webSnapshot, true))
        renderer.scale = scale
        renderer.isOpaque = false
        renderer.colorMode = .nonLinear
        return renderer.cgImage
    }
}
#endif
