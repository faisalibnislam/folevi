// Folevi's own tooltip everywhere on the Mac, never the system's (FoleviTooltip.swift): the shortcut in a tooltip's
// words, and no system tooltip left in the Mac's sources (SwiftUI's help modifier, AppKit's tool tip property).
import Foundation
import Testing
@testable import FoleviDesign

@Suite("Tooltips")
struct TooltipTests {
    @Test func theShortcutGoesInAKeycap() {
        #expect(FoleviTooltip.split("New note (⌘⌥N)") == ("New note", "⌘⌥N"))
        #expect(FoleviTooltip.split("Hide Sidebar (⌘\\)") == ("Hide Sidebar", "⌘\\"))
        #expect(FoleviTooltip.split("Clear selection (Esc)") == ("Clear selection", "Esc"))
        // Words in brackets that aren't a shortcut stay words.
        #expect(FoleviTooltip.split("Comments (3)") == ("Comments (3)", nil))
        #expect(FoleviTooltip.split("  Saved ") == ("Saved", nil))
    }

    @Test func noSystemTooltipsInTheMacApp() throws {
        // Tests/FoleviDesignTests/TooltipTests.swift → native-kit, then apps.
        let kit = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let roots = [kit.appendingPathComponent("Sources"), kit.deletingLastPathComponent().appendingPathComponent("mac/Folevi")]
        let banned = try NSRegularExpression(pattern: #"\.help\(|\btoolTip\b"#)
        var found: [String] = []
        var scanned = 0
        for root in roots {
            let files = FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil)?.compactMap { $0 as? URL }.filter { $0.pathExtension == "swift" } ?? []
            for file in files {
                scanned += 1
                let lines = try String(contentsOf: file, encoding: .utf8).components(separatedBy: "\n")
                for (i, line) in lines.enumerated() where banned.firstMatch(in: line, range: NSRange(line.startIndex..., in: line)) != nil {
                    found.append("\(file.path.replacingOccurrences(of: kit.deletingLastPathComponent().path + "/", with: "")):\(i + 1)")
                }
            }
        }
        #expect(scanned > 100, "the sources weren't found")
        #expect(found.isEmpty, "Use .foleviTooltip(…) (or view.foleviTooltip) instead of the system's tooltip: \(found.joined(separator: ", "))")
    }
}
