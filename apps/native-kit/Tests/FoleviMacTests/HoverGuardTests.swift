// The owner's standing rule (2026-11-06, docs/claude-context/memory/hover-everywhere.md): every button and clickable
// control shows a visible hover, on the Mac and on the iPad with a pointer. This reads the Mac and iPad sources
// (FoleviMac, FoleviDesign without its iPhone-only Phone/ folder, FoleviScreens) and fails on a new control that has
// none:
//
//   - a Button with a style that draws no hover of its own (`.plain`, `.webPlain`, PlainPress, WebPressStyle, ...)
//     and no hover near it: `.webHover`, `.webLinkHover`, `.webBrightHover`, `listHoverTint`, an `onHover`, a
//     `hovered`/`over` state the label reads, or a `// (hover: ...)` note saying where its hover is drawn;
//   - an `.onTapGesture` with no hover near it, unless a `// (no hover: ...)` note says why it isn't a control
//     (a scrim that closes a sheet, a field's tap-to-focus).
//
// The fix is nearly always `.buttonStyle(.webHover(radius:))` (FoleviDesign/Web/WebHover.swift), `.webLink` for
// a text link, or `.webHover(radius:)` after the button.
import Foundation
import Testing

@Suite("Hover everywhere: every clickable control hovers")
struct HoverGuardTests {
    /// Files another owner handles, or that only the iPhone draws.
    static let skipped: Set<String> = [
        "GraphScreen.swift", "DnaGuide.swift", // Foli DNA: its own owner
        "SharingDialogs.swift", "ShareScreen.swift", // the share dialogs: their own owner
    ]

    static let bareStyle = try! NSRegularExpression(pattern: #"\.buttonStyle\((\.plain|\.webPlain|PlainPress\(\)|PressDipButtonStyle\(\)|WebPressStyleLocal\(\)|WebPressStyle\(\)|GatePressStyle\(\)|CardPressStyle\([^)]*\)|ChoicePress\(\)|PressScale\(\)|SettingsNoHighlight\(\))\)"#)
    static let opener = try! NSRegularExpression(pattern: #"\bButton\s*[({]"#)
    static let hover = try! NSRegularExpression(pattern: #"[Hh]over|\bover\b|\bhot\b"#)

    static var sources: URL {
        URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Sources")
    }

    static func files() -> [(String, [String])] {
        var out: [(String, [String])] = []
        for target in ["FoleviMac", "FoleviDesign", "FoleviScreens"] {
            let dir = sources.appendingPathComponent(target)
            guard let walk = FileManager.default.enumerator(at: dir, includingPropertiesForKeys: nil) else { continue }
            for case let url as URL in walk where url.pathExtension == "swift" {
                let rel = url.path.replacingOccurrences(of: sources.path + "/", with: "")
                if rel.hasPrefix("FoleviDesign/Phone/") || skipped.contains(url.lastPathComponent) { continue }
                guard let text = try? String(contentsOf: url, encoding: .utf8) else { continue }
                out.append((rel, text.components(separatedBy: "\n")))
            }
        }
        return out.sorted { $0.0 < $1.0 }
    }

    static func has(_ re: NSRegularExpression, _ s: String) -> Bool {
        re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) != nil
    }

    @Test func plainButtonsHover() {
        var missing: [String] = []
        for (file, lines) in Self.files() {
            for (i, line) in lines.enumerated() where Self.has(Self.bareStyle, line) {
                if line.trimmingCharacters(in: .whitespaces).hasPrefix("//") { continue }
                var start = i
                while start > max(0, i - 40), !Self.has(Self.opener, lines[start]) { start -= 1 }
                let window = lines[start...min(lines.count - 1, i + 3)].joined(separator: "\n")
                if !Self.has(Self.hover, window) { missing.append("\(file):\(i + 1)") }
            }
        }
        #expect(missing.isEmpty, "Buttons with no hover (use .buttonStyle(.webHover(radius:)), .webLink or .webHover): \(missing.joined(separator: ", "))")
    }

    @Test func tapGesturesHover() {
        var missing: [String] = []
        for (file, lines) in Self.files() {
            for (i, line) in lines.enumerated() where line.contains(".onTapGesture") {
                if line.trimmingCharacters(in: .whitespaces).hasPrefix("//") { continue }
                let window = lines[max(0, i - 12)...min(lines.count - 1, i + 6)].joined(separator: "\n")
                if !Self.has(Self.hover, window) { missing.append("\(file):\(i + 1)") }
            }
        }
        #expect(missing.isEmpty, "Tap targets with no hover (add .webHover, or a `// (no hover: why)` note): \(missing.joined(separator: ", "))")
    }
}
