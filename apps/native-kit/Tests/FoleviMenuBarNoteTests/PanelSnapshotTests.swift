// The menu bar note's panel drawn offscreen (a borderless window far off the screen, never key, never in front of the
// owner's work), light and dark: Home's quick note with words in the box and a folder picked, "Saves to", Add as a
// task, Screenshot and Save, and Pin, Window and "…" at the top. Compared to 1x references in __Snapshots__ (written when missing or with
// FOLEVI_RECORD_SNAPSHOTS=1), written at 2x to FOLEVI_SCREENS_OUT when set. Liquid Glass is drawn by the window
// server, so the pictures use Reduce Transparency's solid look (the panel's own fallback), not the glass itself.
import AppKit
import FoleviDesign
import SwiftUI
import Testing
@testable import FoleviMenuBarNote

@Suite("Menu bar note panel pictures", .serialized) @MainActor
struct PanelSnapshotTests {
    static let dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("__Snapshots__")

    @Test func panelLightAndDark() async throws {
        _ = FoleviFonts.register()
        // Reduce Transparency's look (solid shapes for the glass): the window server draws real glass, so a bitmap
        // of the view can't show it, while the solid fallback is drawn by the view itself.
        UserDefaults.standard.set(true, forKey: "FoleviMenuBarNoteForceReduceTransparency")
        defer { UserDefaults.standard.removeObject(forKey: "FoleviMenuBarNoteForceReduceTransparency") }
        for scheme in [ColorScheme.light, .dark] {
            let (model, _, _) = makeNote()
            model.settings.panelSize = MenuBarNoteSettings.PanelSize.medium.size
            model.text = "Trip ideas\nLisbon in May. Book the train."
            model.choose(NoteDestination(space: "ws_1", spaceName: "Studio", folderId: "fld_s", folderName: "Projects"))
            let size = MenuBarNoteSettings.PanelSize.medium.size
            let root = PanelRootView().environment(model).environment(\.colorScheme, scheme).frame(width: size.width, height: size.height)
            let view = NSHostingView(rootView: root)
            view.frame = CGRect(origin: .zero, size: size)
            let window = NSWindow(contentRect: view.frame, styleMask: [.borderless], backing: .buffered, defer: false)
            window.appearance = NSAppearance(named: scheme == .dark ? .darkAqua : .aqua)
            window.contentView = view
            window.setFrameOrigin(CGPoint(x: -20000, y: -20000))
            window.orderFrontRegardless()
            defer { window.orderOut(nil) }
            for _ in 0..<6 {
                view.layoutSubtreeIfNeeded()
                try? await Task.sleep(for: .milliseconds(120))
            }
            let label = "menu-bar-note-panel-\(scheme == .dark ? "dark" : "light")"
            let image = try #require(Self.image(view, scale: 1), "\(label): couldn't draw")
            Self.check(image, view: view, named: label)
        }
    }

    static func image(_ view: NSView, scale: CGFloat) -> CGImage? {
        guard let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return nil }
        view.cacheDisplay(in: view.bounds, to: rep)
        guard let cg = rep.cgImage else { return nil }
        let w = Int(view.bounds.width * scale), h = Int(view.bounds.height * scale)
        guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        ctx.interpolationQuality = .high
        ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
        return ctx.makeImage()
    }

    static func pixels(_ image: CGImage) -> [UInt8] {
        let w = image.width, h = image.height
        var out = [UInt8](repeating: 0, count: w * h * 4)
        out.withUnsafeMutableBytes { buf in
            let ctx = CGContext(data: buf.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
            ctx?.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
        }
        return out
    }

    static func png(_ image: CGImage) -> Data? { NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) }

    static func check(_ image: CGImage, view: NSView, named name: String, sourceLocation: SourceLocation = #_sourceLocation) {
        let env = ProcessInfo.processInfo.environment
        if let out = env["FOLEVI_SCREENS_OUT"], let big = Self.image(view, scale: 2), let data = png(big) {
            let d = URL(fileURLWithPath: out)
            try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
            try? data.write(to: d.appendingPathComponent("\(name).png"))
        }
        let file = dir.appendingPathComponent("\(name).png")
        guard env["FOLEVI_RECORD_SNAPSHOTS"] != "1", let src = CGImageSourceCreateWithURL(file as CFURL, nil), let ref = CGImageSourceCreateImageAtIndex(src, 0, nil) else {
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            try? png(image)?.write(to: file)
            return
        }
        guard ref.width == image.width, ref.height == image.height else {
            Issue.record("\(name): size \(image.width)x\(image.height), reference \(ref.width)x\(ref.height)", sourceLocation: sourceLocation)
            return
        }
        let a = pixels(image), b = pixels(ref)
        var off = 0
        for i in stride(from: 0, to: a.count, by: 4) where (0..<3).contains(where: { abs(Int(a[i + $0]) - Int(b[i + $0])) > 10 }) { off += 1 }
        let ratio = Double(off) / Double(a.count / 4)
        if ratio > 0.01 {
            Issue.record("\(name): \(String(format: "%.2f", ratio * 100))% of pixels differ", sourceLocation: sourceLocation)
            try? png(image)?.write(to: file.deletingPathExtension().appendingPathExtension("failed.png"))
        }
    }
}
