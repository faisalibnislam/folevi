// Foli DNA as the frame shows it (ScreenRoot at /graph) on the scripted engine's map (DemoGraph.swift: 44 notes,
// most unlinked, two clusters), at the Mac, iPad and iPhone sizes, light and dark. From the owner's report of
// 5 November 2026: the note waiting behind showed through, most notes had no label, a cluster's name ran under the
// filter bar, a dot sat outside the map, the map wasn't fitted, and the filter bar was two crowded rows.
// Each picture is compared to a 1x reference in __Snapshots__ (written when missing or with
// FOLEVI_RECORD_SNAPSHOTS=1), and written at 2x to FOLEVI_SCREENS_OUT when set. Rendered on the Mac: the iPad and
// iPhone use this same SwiftUI screen (the iPhone at its phone width, which switches it to the compact layout).
#if os(macOS)
import AppKit
import Foundation
import SwiftUI
import Testing
import FoleviDesign
import FoleviEngine
@testable import FoleviMac

@Suite("Foli DNA snapshots", .serialized) @MainActor
struct DnaSnapshotTests {
    static let sizes: [(name: String, size: CGSize)] = [("mac", CGSize(width: 1180, height: 820)), ("ipad", CGSize(width: 1024, height: 1366)), ("iphone", CGSize(width: 393, height: 852))]
    static let dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("__Snapshots__")

    init() {
        // A fresh map: no saved filters, pins or side panel from another run.
        for k in ["folevi.dna.settings.acct:demo", "folevi.dna.pins.acct:demo", "folevi.graph.view", "folevi.dna.insights", "folevi.dna.focus"] { UserDefaults.standard.removeObject(forKey: k) }
    }

    /// The red stand-in for the note page that waits behind the screens (a note's title and body).
    struct NoteBehind: View {
        var body: some View {
            VStack(alignment: .leading, spacing: 12) {
                ForEach(0..<14, id: \.self) { _ in Rectangle().fill(Color(red: 1, green: 0, blue: 0)).frame(height: 18) }
            }
            .padding(80)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }

    @Test func dnaOnEveryPlatformLightAndDark() async throws {
        _ = FoleviFonts.register()
        for (name, size) in Self.sizes {
            for scheme in [ColorScheme.light, .dark] {
                let demo = DemoEngine(now: Date(timeIntervalSince1970: 1_800_000_000))
                let frame = FrameModel(client: demo.client())
                let models = ScreenModels(frame: frame)
                let root = ZStack {
                    NoteBehind()
                    ScreenRoot(model: frame, models: models, route: .web("/graph"))
                }
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
                let graph = models.more.graphModel()
                await eventually("graph \(name)", timeout: .seconds(8)) { graph.value != nil }
                for _ in 0..<6 {
                    view.layoutSubtreeIfNeeded()
                    try? await Task.sleep(for: .milliseconds(150))
                }
                let label = "dna-\(name)-\(scheme == .dark ? "dark" : "light")"
                let image = try #require(Self.image(view, scale: 1), "\(label): couldn't draw")
                // 1. Nothing of the note behind shows through, anywhere on the screen.
                let px = Self.pixels(image)
                var red = 0
                for i in stride(from: 0, to: px.count, by: 4) where px[i] > 200 && px[i + 1] < 70 && px[i + 2] < 70 { red += 1 }
                #expect(red == 0, "\(label): \(red) pixels of the note behind show through")
                Self.check(image, view: view, named: label)
            }
        }
    }

    /// Labels, fit and bridges on the demo map, as the canvas works them out.
    @Test func everyNoteWithRoomIsLabelledAndTheMapFits() {
        let v = DemoEngine.graph
        let size = CGSize(width: 1180, height: 640)
        let pts = v.nodes.map { CGPoint(x: $0.x, y: $0.y) }
        let clusters = v.clusters.map { c in v.nodes.filter { $0.cluster == c.id }.map { CGPoint(x: $0.x, y: $0.y) } }
        let t = GraphMath.fit(GraphMath.extent(pts, clusters: clusters), size, padding: 28)
        // Every node and every cluster's name is inside the map.
        for p in GraphMath.extent(pts, clusters: clusters) {
            let s = GraphMath.screen(t, p)
            #expect(s.x >= 0 && s.x <= size.width && s.y >= 0 && s.y <= size.height, "\(p) is off the map at \(s)")
        }
        // Most notes get a label (it was 12 of 46), and no two labels overlap.
        let deg = GraphMath.degrees(v.edges)
        let order = v.nodes.sorted { (deg[$0.id] ?? 0) > (deg[$1.id] ?? 0) }.map(\.id)
        let byId = Dictionary(uniqueKeysWithValues: v.nodes.map { ($0.id, $0) })
        let center = { (id: String) in byId[id].map { GraphMath.screen(t, CGPoint(x: $0.x, y: $0.y)) } }
        let width = { (id: String) in CGFloat(min(40, byId[id]?.label.count ?? 8)) * 6.2 }
        let radius = { (id: String) in GraphMath.drawn(GraphMath.radius(deg[id] ?? 0, entity: byId[id]?.kind != "note"), t.k) * t.k }
        let hubs = GraphMath.top(v.nodes, deg)
        let labels = GraphMath.labelPlan(order, always: [], preferred: hubs, bounds: CGRect(origin: .zero, size: size), center: center, radius: radius, width: width)
        #expect(labels.count >= 34, "only \(labels.count) of \(v.nodes.count) labelled")
        // The best-connected note of each cluster is labelled.
        #expect(labels.contains("a0") && labels.contains("b0"))
        let rects = labels.compactMap { id in center(id).map { c in CGRect(x: c.x - width(id) / 2, y: c.y + radius(id) - 2, width: width(id), height: 14) } }
        for (i, a) in rects.enumerated() { for b in rects[(i + 1)...] { #expect(!a.intersects(b)) } }
        // What must be labelled always is, even where it's crowded.
        #expect(GraphMath.labelPlan(order, always: ["b6"], center: center, radius: radius, width: { _ in 2000 }).contains("b6"))
        // Bridges: only nodes whose lines on the map reach another cluster, never an unlinked dot.
        let bridges = GraphMath.shownBridges(v.nodes, v.edges)
        #expect(bridges.allSatisfy { id in !GraphMath.neighbours(v.edges, id).isEmpty })
        #expect(!bridges.contains { $0.hasPrefix("u") })
    }

    // MARK: pictures

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
            try? png(image)?.write(to: file.deletingPathExtension().appendingPathExtension("failed.png"))
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
#endif
