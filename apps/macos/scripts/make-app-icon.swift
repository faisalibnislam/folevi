#!/usr/bin/env swift
// Renders the Folevi app icon (the leaf/folio "F" mark on a warm paper squircle with an ultramarine
// accent) into apps/macos/Folevi/Resources/Assets.xcassets/AppIcon.appiconset at every macOS size.
//
//   swift apps/macos/scripts/make-app-icon.swift
//
// Pure CoreGraphics; no external assets. The mark geometry matches DesignSystem/FoleviMark.swift.
import AppKit
import CoreGraphics
import Foundation

let scriptURL = URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL
let macosDir = scriptURL.deletingLastPathComponent().deletingLastPathComponent()
let iconSet = macosDir.appendingPathComponent("Folevi/Resources/Assets.xcassets/AppIcon.appiconset", isDirectory: true)
try FileManager.default.createDirectory(at: iconSet, withIntermediateDirectories: true)

func color(_ hex: UInt32, _ alpha: CGFloat = 1) -> CGColor {
    CGColor(srgbRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: alpha)
}

/// Mark in a 100×100 design space (y down), mapped into `rect`.
func markPaths(in rect: CGRect) -> (stem: CGPath, leaf: CGPath) {
    let s = min(rect.width, rect.height)
    func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
        // Flip y for CoreGraphics (origin bottom-left).
        CGPoint(x: rect.minX + x / 100 * s, y: rect.maxY - y / 100 * s)
    }
    let stem = CGMutablePath()
    stem.move(to: p(24, 90))
    stem.addLine(to: p(24, 34))
    stem.addCurve(to: p(82, 12), control1: p(24, 16), control2: p(52, 8))
    stem.addCurve(to: p(41, 36), control1: p(70, 30), control2: p(52, 33))
    stem.addLine(to: p(41, 90))
    stem.addQuadCurve(to: p(24, 90), control: p(32.5, 96))
    stem.closeSubpath()
    let leaf = CGMutablePath()
    leaf.move(to: p(47, 64))
    leaf.addCurve(to: p(78, 44), control1: p(50, 50), control2: p(64, 43))
    leaf.addCurve(to: p(47, 64), control1: p(72, 57), control2: p(60, 64))
    leaf.closeSubpath()
    return (stem, leaf)
}

func render(size: Int) -> Data? {
    let px = CGFloat(size)
    guard let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
                              space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
    ctx.setShouldAntialias(true)
    ctx.interpolationQuality = .high
    // macOS icon grid: 824pt content in 1024 canvas, with a soft drop shadow.
    let inset = px * 100 / 1024
    let body = CGRect(x: inset, y: inset * 1.15, width: px - inset * 2, height: px - inset * 2)
    let radius = body.width * 0.225
    let squircle = CGPath(roundedRect: body, cornerWidth: radius, cornerHeight: radius, transform: nil)
    ctx.saveGState()
    ctx.setShadow(offset: CGSize(width: 0, height: -px * 0.012), blur: px * 0.03, color: color(0x18201C, 0.28))
    ctx.addPath(squircle)
    ctx.setFillColor(color(0xF4F1E9))
    ctx.fillPath()
    ctx.restoreGState()
    // Warm paper gradient.
    ctx.saveGState()
    ctx.addPath(squircle)
    ctx.clip()
    let gradient = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB), colors: [color(0xFBFAF6), color(0xEDE8DC)] as CFArray, locations: [0, 1])!
    ctx.drawLinearGradient(gradient, start: CGPoint(x: body.midX, y: body.maxY), end: CGPoint(x: body.midX, y: body.minY), options: [])
    // Folio page edge: a faint ultramarine band on the right, like a bookmark ribbon.
    ctx.setFillColor(color(0x3159D8, 0.08))
    ctx.fill(CGRect(x: body.maxX - body.width * 0.1, y: body.minY, width: body.width * 0.1, height: body.height))
    ctx.restoreGState()
    // Hairline border for definition on light backgrounds.
    ctx.addPath(squircle)
    ctx.setStrokeColor(color(0x18201C, 0.08))
    ctx.setLineWidth(max(1, px / 512))
    ctx.strokePath()
    // The mark.
    let markRect = body.insetBy(dx: body.width * 0.2, dy: body.height * 0.2)
    let (stem, leaf) = markPaths(in: markRect)
    ctx.addPath(stem)
    ctx.setFillColor(color(0x18201C))
    ctx.fillPath()
    ctx.addPath(leaf)
    ctx.setFillColor(color(0x3159D8))
    ctx.fillPath()
    guard let image = ctx.makeImage() else { return nil }
    let rep = NSBitmapImageRep(cgImage: image)
    return rep.representation(using: .png, properties: [:])
}

struct Entry { let size: Int; let scale: Int }
let entries = [Entry(size: 16, scale: 1), Entry(size: 16, scale: 2), Entry(size: 32, scale: 1), Entry(size: 32, scale: 2),
               Entry(size: 128, scale: 1), Entry(size: 128, scale: 2), Entry(size: 256, scale: 1), Entry(size: 256, scale: 2),
               Entry(size: 512, scale: 1), Entry(size: 512, scale: 2)]
var images: [[String: String]] = []
for e in entries {
    let px = e.size * e.scale
    let name = "icon_\(e.size)x\(e.size)\(e.scale == 2 ? "@2x" : "").png"
    guard let data = render(size: px) else { fatalError("render failed for \(px)") }
    try data.write(to: iconSet.appendingPathComponent(name))
    images.append(["idiom": "mac", "size": "\(e.size)x\(e.size)", "scale": "\(e.scale)x", "filename": name])
}
let contents: [String: Any] = ["images": images, "info": ["author": "xcode", "version": 1]]
let json = try JSONSerialization.data(withJSONObject: contents, options: [.prettyPrinted, .sortedKeys])
try json.write(to: iconSet.appendingPathComponent("Contents.json"))
print("Wrote \(entries.count) icons to \(iconSet.path)")
