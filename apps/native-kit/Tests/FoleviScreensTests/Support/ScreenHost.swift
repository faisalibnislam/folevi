// Hosts a screen in a real window at a device size and takes its picture (ImageRenderer can't draw List or
// ScrollView, which the screens are made of). iOS: a UIHostingController in a UIWindow, drawn with
// drawHierarchy; macOS: an NSHostingView in an off-screen NSWindow, drawn with cacheDisplay.
//
// Known capture artifact: on iOS 26 and later, drawHierarchy draws the system toolbar's glass behind bar items as
// a flat white shape in dark mode (the bell and badge in Home's bar look like a white tile). On screen it's right:
// checked 2026-10-24 with a scratch app showing the same view on the Simulator and `simctl io screenshot`.
import Foundation
import SwiftUI
import Testing
@testable import FoleviDesign
@testable import FoleviScreens
#if canImport(UIKit)
import UIKit
#else
import AppKit
#endif

enum DeviceSize: String, CaseIterable, Sendable {
    case iphone, ipad, mac
    var size: CGSize {
        switch self {
        case .iphone: CGSize(width: 393, height: 852)
        case .ipad: CGSize(width: 1024, height: 1366)
        case .mac: CGSize(width: 1180, height: 820)
        }
    }
}

#if os(iOS)
let hostPlatform = "ios"
let hostSizes: [DeviceSize] = [.iphone, .ipad]
#else
let hostPlatform = "macos"
let hostSizes: [DeviceSize] = [.mac]
#endif

let screenSnapshotDir = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("__Snapshots__")

/// A live, hosted screen: kept on screen while the test drives it, pictured with `image()`.
@MainActor
final class ScreenHost {
    #if os(iOS)
    let window: UIWindow
    let controller: UIViewController
    #else
    let window: NSWindow
    let view: NSView
    #endif
    let size: CGSize

    init<V: View>(_ content: V, size: DeviceSize, scheme: ColorScheme) {
        FoleviFonts.register()
        #if os(macOS)
        // The app's scroll bars (thin, over the content), so the pictures don't depend on this Mac's setting.
        MacScrollers.useOverlay()
        #endif
        self.size = size.size
        let root = content
            .environment(\.colorScheme, scheme)
            .environment(\.coverArt, .none)
            .frame(width: size.size.width, height: size.size.height)
            .background(Folevi.color.canvas)
        #if os(iOS)
        let host = UIHostingController(rootView: root)
        host.overrideUserInterfaceStyle = scheme == .dark ? .dark : .light
        if size == .ipad { host.traitOverrides.horizontalSizeClass = .regular }
        let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        let window = scene.map { UIWindow(windowScene: $0) } ?? UIWindow(frame: CGRect(origin: .zero, size: size.size))
        window.frame = CGRect(origin: .zero, size: size.size)
        window.overrideUserInterfaceStyle = host.overrideUserInterfaceStyle
        window.rootViewController = host
        window.isHidden = false
        host.view.frame = window.bounds
        self.window = window
        self.controller = host
        #else
        let view = NSHostingView(rootView: root)
        view.frame = CGRect(origin: .zero, size: size.size)
        let window = NSWindow(contentRect: view.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: scheme == .dark ? .darkAqua : .aqua)
        window.contentView = view
        window.setFrameOrigin(CGPoint(x: -20000, y: -20000))
        window.orderFrontRegardless()
        self.window = window
        self.view = view
        #endif
    }

    /// Lets layout, data and animations settle.
    func settle(_ seconds: Double = 0.4) async {
        #if os(iOS)
        controller.view.setNeedsLayout()
        controller.view.layoutIfNeeded()
        #else
        view.layoutSubtreeIfNeeded()
        #endif
        try? await Task.sleep(for: .seconds(seconds))
        #if os(iOS)
        controller.view.layoutIfNeeded()
        #else
        view.layoutSubtreeIfNeeded()
        #endif
    }

    func image(scale: CGFloat) -> CGImage? {
        #if os(iOS)
        let format = UIGraphicsImageRendererFormat()
        format.scale = scale
        format.opaque = true
        let renderer = UIGraphicsImageRenderer(size: size, format: format)
        let image = renderer.image { ctx in
            if !controller.view.drawHierarchy(in: controller.view.bounds, afterScreenUpdates: true) {
                controller.view.layer.render(in: ctx.cgContext)
            }
        }
        return image.cgImage
        #else
        guard let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return nil }
        view.cacheDisplay(in: view.bounds, to: rep)
        guard let full = rep.cgImage else { return nil }
        if scale == CGFloat(full.width) / size.width { return full }
        // Resample to the asked scale.
        let w = Int(size.width * scale), h = Int(size.height * scale)
        guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        ctx.interpolationQuality = .high
        ctx.draw(full, in: CGRect(x: 0, y: 0, width: w, height: h))
        return ctx.makeImage()
        #endif
    }

    /// The scroll view inside (the List's or the ScrollView's), for driving scrolls.
    #if os(iOS)
    func scrollView() -> UIScrollView? {
        func find(_ v: UIView) -> UIScrollView? {
            if let s = v as? UIScrollView, s.contentSize.height > s.bounds.height + 10, s.bounds.width > size.width * 0.6 { return s }
            for c in v.subviews { if let s = find(c) { return s } }
            return nil
        }
        return find(controller.view)
    }
    #else
    func scrollView() -> NSScrollView? {
        func find(_ v: NSView) -> NSScrollView? {
            if let s = v as? NSScrollView, let doc = s.documentView, doc.frame.height > s.bounds.height + 10, s.bounds.width > size.width * 0.6 { return s }
            for c in v.subviews { if let s = find(c) { return s } }
            return nil
        }
        return find(view)
    }
    #endif

    func close() {
        #if os(iOS)
        window.isHidden = true
        window.rootViewController = nil
        #else
        window.orderOut(nil)
        window.contentView = nil
        #endif
    }
}

func screenPNG(_ image: CGImage) -> Data? {
    #if canImport(UIKit)
    return UIImage(cgImage: image).pngData()
    #else
    return NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])
    #endif
}

func screenPixels(_ image: CGImage) -> [UInt8] {
    let w = image.width, h = image.height
    var data = [UInt8](repeating: 0, count: w * h * 4)
    let ctx = CGContext(data: &data, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    ctx?.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
    return data
}

func loadScreenPNG(_ url: URL) -> CGImage? {
    guard let src = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
    return CGImageSourceCreateImageAtIndex(src, 0, nil)
}

/// Compares a screen to its reference (1x, in __Snapshots__), recording it when missing or when
/// FOLEVI_RECORD_SNAPSHOTS=1; with FOLEVI_SCREENS_OUT=<dir> also writes a 2x picture there for people.
/// Passes when at most 1% of pixels differ by more than 10 levels (screens carry antialiased text).
@MainActor
func checkScreen(_ host: ScreenHost, named name: String, reference: Bool = true, sourceLocation: SourceLocation = #_sourceLocation) {
    let env = ProcessInfo.processInfo.environment
    if let out = env["FOLEVI_SCREENS_OUT"], let image = host.image(scale: 2), let png = screenPNG(image) {
        let dir = URL(fileURLWithPath: out)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try? png.write(to: dir.appendingPathComponent("\(name).png"))
    }
    guard reference else { return }
    guard let image = host.image(scale: 1) else {
        Issue.record("\(name): couldn't draw", sourceLocation: sourceLocation)
        return
    }
    let file = screenSnapshotDir.appendingPathComponent("\(name).png")
    guard env["FOLEVI_RECORD_SNAPSHOTS"] != "1", let ref = loadScreenPNG(file) else {
        try? FileManager.default.createDirectory(at: screenSnapshotDir, withIntermediateDirectories: true)
        try? screenPNG(image)?.write(to: file)
        return
    }
    guard ref.width == image.width, ref.height == image.height else {
        Issue.record("\(name): size \(image.width)x\(image.height), reference \(ref.width)x\(ref.height)", sourceLocation: sourceLocation)
        try? screenPNG(image)?.write(to: file.deletingPathExtension().appendingPathExtension("failed.png"))
        return
    }
    let a = screenPixels(image), b = screenPixels(ref)
    var off = 0
    for i in stride(from: 0, to: a.count, by: 4) where (0..<3).contains(where: { abs(Int(a[i + $0]) - Int(b[i + $0])) > 10 }) { off += 1 }
    let ratio = Double(off) / Double(a.count / 4)
    if ratio > 0.01 {
        Issue.record("\(name): \(String(format: "%.2f", ratio * 100))% of pixels differ", sourceLocation: sourceLocation)
        try? screenPNG(image)?.write(to: file.deletingPathExtension().appendingPathExtension("failed.png"))
    }
}
