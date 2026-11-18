// One light shadow scale for the Mac's native look (the owner, 2026-11-18: "shadows are inconsistent ... I prefer
// less shadows"): four levels, each lighter than the 16 to 25% drops they replaced, and no shadow written with
// numbers of its own in the Mac's sources beside them.
#if os(macOS)
import Foundation
import SwiftUI
import Testing
import FoleviDesign
@testable import FoleviMac

@Suite("Native shadows")
struct NativeShadowTests {
    @Test func theFourLevelsAreLightAndInOrder() {
        let levels: [NativeShadow] = [.card, .floating, .overlay]
        // Each step up is a little stronger and wider, and none is heavier than 13% of black in a light window.
        for (a, b) in zip(levels, levels.dropFirst()) {
            #expect(a.opacity < b.opacity)
            #expect(a.radius < b.radius)
            #expect(a.y < b.y)
        }
        #expect(NativeShadow.overlay.opacity <= 0.13)
        #expect(NativeShadow.overlay.radius <= 20)
        // A raised pill: a hairline of shadow, never a drop.
        #expect(NativeShadow.raised.radius <= 2)
    }

    @Test func theLookKeepsHalfOfTheWebsDrawnShadows() {
        #expect(MacLook.webShadowScale == 0.5)
    }

    /// A heavy shadow written by hand in the Mac's own sources (more than 13% of black, or blurred more than 20 pt):
    /// use `.nativeShadow(_:)` instead. The iPad's frame and the web-matched look's own drawing are left alone.
    @Test func noHeavyShadowIsWrittenByHand() throws {
        let sources = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Sources/FoleviMac")
        let skipped: Set<String> = ["IPadFrame.swift", "TabPictures.swift", "WebNoteScreens.swift"]
        let pattern = try NSRegularExpression(pattern: #"\.shadow\(color: (?:Color)?\.black\.opacity\((0\.\d+)\), radius: (\d+(?:\.\d+)?)"#)
        var heavy: [String] = []
        let walk = FileManager.default.enumerator(at: sources, includingPropertiesForKeys: nil)
        while let url = walk?.nextObject() as? URL {
            guard url.pathExtension == "swift", !skipped.contains(url.lastPathComponent), let text = try? String(contentsOf: url, encoding: .utf8) else { continue }
            for (i, line) in text.components(separatedBy: "\n").enumerated() {
                guard let m = pattern.firstMatch(in: line, range: NSRange(line.startIndex..., in: line)),
                      let o = Range(m.range(at: 1), in: line), let r = Range(m.range(at: 2), in: line),
                      let opacity = Double(line[o]), let radius = Double(line[r]) else { continue }
                if opacity > 0.13 || radius > 20 { heavy.append("\(url.lastPathComponent):\(i + 1)") }
            }
        }
        #expect(heavy.isEmpty, "Shadows heavier than the look's overlay level: \(heavy.joined(separator: ", "))")
    }
}
#endif
