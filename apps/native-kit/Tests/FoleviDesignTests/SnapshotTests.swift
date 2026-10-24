// Snapshot tests (plan section 10): each component rendered in light and dark with ImageRenderer and compared to
// the reference PNGs in __Snapshots__ (per platform), with a small tolerance. No third-party dependency.
//
//   FOLEVI_RECORD_SNAPSHOTS=1 swift test --filter FoleviDesignTests     record new references
//   FOLEVI_GALLERY_OUT=/some/dir swift test --filter Gallery           also write the whole gallery as PNGs
import Foundation
import SwiftUI
import Testing
@testable import FoleviDesign
#if canImport(UIKit)
import UIKit
#else
import AppKit
#endif

#if os(iOS)
let platformSuffix = "ios"
#else
let platformSuffix = "macos"
#endif

let snapshotDir = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("__Snapshots__")

@MainActor
func render<V: View>(_ view: V, scheme: ColorScheme, width: CGFloat? = nil) -> CGImage? {
    FoleviFonts.register()
    let content = view
        .frame(width: width)
        .fixedSize(horizontal: width == nil, vertical: true)
        .background(Folevi.color.canvas)
        .environment(\.colorScheme, scheme)
        .environment(\.coverArt, .none)
    let renderer = ImageRenderer(content: content)
    renderer.scale = 2
    return renderer.cgImage
}

func pngData(_ image: CGImage) -> Data? {
    #if canImport(UIKit)
    return UIImage(cgImage: image).pngData()
    #else
    return NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])
    #endif
}

/// RGBA8 pixels of an image.
func pixels(_ image: CGImage) -> [UInt8] {
    let w = image.width, h = image.height
    var data = [UInt8](repeating: 0, count: w * h * 4)
    let ctx = CGContext(data: &data, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    ctx?.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
    return data
}

func loadPNG(_ url: URL) -> CGImage? {
    guard let src = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
    return CGImageSourceCreateImageAtIndex(src, 0, nil)
}

/// Compares to the reference (or records it). Passes when at most 0.5% of pixels differ by more than 8 levels.
@MainActor
func assertSnapshot<V: View>(_ view: V, named name: String, width: CGFloat? = 360, sourceLocation: SourceLocation = #_sourceLocation) {
    let record = ProcessInfo.processInfo.environment["FOLEVI_RECORD_SNAPSHOTS"] == "1"
    for scheme in [ColorScheme.light, .dark] {
        let file = snapshotDir.appendingPathComponent("\(name)-\(scheme == .dark ? "dark" : "light")-\(platformSuffix).png")
        guard let image = render(view, scheme: scheme, width: width) else {
            Issue.record("\(name): couldn't render", sourceLocation: sourceLocation)
            continue
        }
        guard !record, let reference = loadPNG(file) else {
            try? FileManager.default.createDirectory(at: snapshotDir, withIntermediateDirectories: true)
            try? pngData(image)?.write(to: file)
            continue
        }
        guard reference.width == image.width, reference.height == image.height else {
            Issue.record("\(name) \(scheme): size \(image.width)x\(image.height), reference \(reference.width)x\(reference.height)", sourceLocation: sourceLocation)
            try? pngData(image)?.write(to: file.deletingPathExtension().appendingPathExtension("failed.png"))
            continue
        }
        let a = pixels(image), b = pixels(reference)
        var off = 0
        for i in stride(from: 0, to: a.count, by: 4) where (0..<4).contains(where: { abs(Int(a[i + $0]) - Int(b[i + $0])) > 8 }) { off += 1 }
        let ratio = Double(off) / Double(a.count / 4)
        if ratio > 0.005 {
            Issue.record("\(name) \(scheme): \(String(format: "%.2f", ratio * 100))% of pixels differ", sourceLocation: sourceLocation)
            try? pngData(image)?.write(to: file.deletingPathExtension().appendingPathExtension("failed.png"))
        }
    }
}

@Suite("Design snapshots") @MainActor
struct SnapshotTests {
    @Test func fontsRegister() {
        #expect(FoleviFonts.register())
        for name in ["InstrumentSans-Regular", "InstrumentSans-Regular_SemiBold", "Spectral-Regular", "Spectral-Medium", "Spectral-SemiBold", "Spectral-Italic", "JetBrainsMono-Regular", "JetBrainsMonoRoman-Bold", "Inter-Regular"] {
            let font = CTFontCreateWithName(name as CFString, 12, nil)
            #expect(CTFontCopyPostScriptName(font) as String == name, "\(name) isn't registered")
        }
    }

    @Test func tokensMatchTheDesignSystem() {
        #expect(FoleviTokens.Chrome.canvas.light == RGBA(255, 255, 255))
        #expect(FoleviTokens.Chrome.canvas.dark == RGBA(16, 16, 17))
        #expect(FoleviTokens.Radius.container == 18)
        #expect(FoleviTokens.noteThemes.count >= 40)
        #expect(NoteTheme.named("art-01")?.name == "Poppy print")
        #expect(FolderColor.resolve(nil).id == "sky")
        #expect(FolderColor.resolve("kraft").id == "amber")
        // Every chrome text pair reads (the web's contrast check, on the Swift output).
        for (ink, bg) in [(FoleviTokens.Chrome.ink, FoleviTokens.Chrome.canvas), (FoleviTokens.Chrome.inkMuted, FoleviTokens.Chrome.surface), (FoleviTokens.Chrome.inkFaint, FoleviTokens.Chrome.surface)] {
            #expect(ink.light.contrast(bg.light) >= 4.5)
            #expect(ink.dark.contrast(bg.dark) >= 4.5)
        }
    }

    @Test func wordWrapNeverSplitsWords() {
        FoleviFonts.register()
        let font = CTFontCreateWithName("Spectral-Regular" as CFString, 20, nil)
        let lines = WordWrap.lines("Extraordinarily long folder names wrap between words", font: font, width: 160, maxLines: 2)
        #expect(lines.count == 2)
        #expect(lines.last?.hasSuffix("…") == true)
        let words = Set("Extraordinarily long folder names wrap between words".split(separator: " ").map(String.init))
        for word in lines.joined(separator: " ").replacingOccurrences(of: "…", with: "").split(separator: " ") {
            #expect(words.contains(String(word)), "\(word) was split")
        }
        let cut = WordWrap.lines("Supercalifragilisticexpialidocious", font: font, width: 120, maxLines: 2)
        #expect(cut.count == 1)
        #expect(cut[0].hasSuffix("…"))
        #expect(WordWrap.lines("Trips", font: font, width: 160, maxLines: 2) == ["Trips"])
    }

    @Test func ageTextMatchesTheWeb() {
        let now = Date(timeIntervalSince1970: 1_790_000_000)
        #expect(AgeText.age(now.addingTimeInterval(-10), now: now) == "Just now")
        #expect(AgeText.age(now.addingTimeInterval(-60), now: now) == "1 min ago")
        #expect(AgeText.age(now.addingTimeInterval(-300), now: now) == "5 mins ago")
        #expect(AgeText.age(now.addingTimeInterval(-3600 * 10), now: now) == "10 hours ago")
        #expect(AgeText.age(now.addingTimeInterval(-86400 * 3), now: now) == "3 days ago")
        #expect(AgeText.relative(now.addingTimeInterval(300), now: now) == "in 5 mins")
    }

    @Test func previewTextMatchesTheWeb() {
        let lines = [
            CardPreviewLine(type: "heading", text: "Plan"),
            CardPreviewLine(type: "todo", text: "Book", checked: true),
            CardPreviewLine(type: "todo", text: "Pass", checked: false),
            CardPreviewLine(type: "numbered", text: "One"),
            CardPreviewLine(type: "paragraph", text: "End"),
        ]
        #expect(NoteCardView.previewText(lines, excerpt: "x") == "Plan\n\n☑ Book\n☐ Pass\n1. One\n\nEnd")
        #expect(NoteCardView.previewText([], excerpt: "Fallback") == "Fallback")
    }

    @Test func buttons() {
        assertSnapshot(VStack(alignment: .leading, spacing: 10) {
            HStack { Button("Primary") {}.buttonStyle(.foleviPrimary); Button("Secondary") {}.buttonStyle(.foleviSecondary); Button("Ghost") {}.buttonStyle(.foleviGhost) }
            HStack { Button("Delete") {}.buttonStyle(.foleviDestructive); Button("Small") {}.buttonStyle(.folevi(.secondary, size: .small)) }
        }.padding(), named: "buttons")
    }

    @Test func noteCards() {
        assertSnapshot(HStack(spacing: 14) {
            NoteCardView(GallerySamples.notes[0])
            NoteCardView(GallerySamples.notes[2])
        }.padding(), named: "note-cards", width: 380)
    }

    @Test func folderCards() {
        assertSnapshot(HStack(spacing: 14) {
            FolderCardView(GallerySamples.folders[0])
            FolderCardView(GallerySamples.folders[1])
        }.padding(), named: "folder-cards", width: 380)
    }

    @Test func rowsAndHeaders() {
        assertSnapshot(VStack(spacing: 8) {
            SectionHeader("Recent notes", actionTitle: "See all") {}
            RowGroup {
                ListRow("All notes", systemImage: "doc.on.doc", accessory: .count(128))
                RowDivider()
                ListRow("Changes", subtitle: "3 notes changed", systemImage: "arrow.triangle.2.circlepath", accessory: .badge(3))
            }
        }.padding(), named: "rows")
    }

    @Test func controls() {
        assertSnapshot(VStack(alignment: .leading, spacing: 12) {
            SegmentedControl(selection: .constant("cards"), options: [("cards", "Cards"), ("list", "List")])
            SearchField(text: .constant(""), prompt: "Search notes")
            HStack { Chip("Inbox", count: 4, isSelected: true) {}; Chip("Today") {}; Badge(count: 3); Avatar(name: "Faisal Islam") }
            HStack(spacing: 14) { ForEach(GallerySamples.syncStates, id: \.self) { SyncStatusView($0) } }
            EmptyState(systemImage: "tray", title: "Nothing in Drafts", message: "New notes land here.")
        }.padding(), named: "controls")
    }

    /// Writes the whole gallery (light and dark) when FOLEVI_GALLERY_OUT is set.
    @Test func gallery() throws {
        guard let out = ProcessInfo.processInfo.environment["FOLEVI_GALLERY_OUT"] else { return }
        let dir = URL(fileURLWithPath: out)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        for scheme in [ColorScheme.light, .dark] {
            let image = try #require(render(DesignGalleryContent(), scheme: scheme, width: nil))
            try #require(pngData(image)).write(to: dir.appendingPathComponent("gallery-\(scheme == .dark ? "dark" : "light")-\(platformSuffix).png"))
        }
    }
}
