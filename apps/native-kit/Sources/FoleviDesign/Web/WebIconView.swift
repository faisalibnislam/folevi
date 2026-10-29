// The web app's icons drawn natively (docs/MAC_REBUILD_PLAN.md section 3.1). Generated/Icons.swift holds each
// lucide icon's elements; this file turns them into a CGPath on lucide's 24 pt grid and strokes it as lucide's
// SVG does: no fill, round caps and joins, `strokeWidth` (2 by default) scaled with the size, `currentColor`
// (the foreground style here).
import CoreGraphics
import Foundation
import SwiftUI

/// One element of a lucide icon (the SVG element and its attributes).
public enum WebIconNode: Hashable, Sendable {
    case path(String)
    case circle(cx: CGFloat, cy: CGFloat, r: CGFloat)
    case ellipse(cx: CGFloat, cy: CGFloat, rx: CGFloat, ry: CGFloat)
    case rect(x: CGFloat, y: CGFloat, width: CGFloat, height: CGFloat, rx: CGFloat, ry: CGFloat)
    case line(x1: CGFloat, y1: CGFloat, x2: CGFloat, y2: CGFloat)
    case polyline(String)
    case polygon(String)

    func add(to path: CGMutablePath) {
        switch self {
        case .path(let d):
            SVGPath.add(d, to: path)
        case .circle(let cx, let cy, let r):
            path.addEllipse(in: CGRect(x: cx - r, y: cy - r, width: r * 2, height: r * 2))
        case .ellipse(let cx, let cy, let rx, let ry):
            path.addEllipse(in: CGRect(x: cx - rx, y: cy - ry, width: rx * 2, height: ry * 2))
        case .rect(let x, let y, let w, let h, let rx, let ry):
            let r = CGRect(x: x, y: y, width: w, height: h)
            if rx > 0 || ry > 0 {
                path.addRoundedRect(in: r, cornerWidth: min(rx, w / 2), cornerHeight: min(ry, h / 2))
            } else {
                path.addRect(r)
            }
        case .line(let x1, let y1, let x2, let y2):
            path.move(to: CGPoint(x: x1, y: y1))
            path.addLine(to: CGPoint(x: x2, y: y2))
        case .polyline(let points), .polygon(let points):
            let p = SVGPath.numbers(points)
            guard p.count >= 2 else { return }
            path.move(to: CGPoint(x: p[0], y: p[1]))
            var i = 2
            while i + 1 < p.count {
                path.addLine(to: CGPoint(x: p[i], y: p[i + 1]))
                i += 2
            }
            if case .polygon = self { path.closeSubpath() }
        }
    }
}

public extension WebIcon {
    /// The icon on its 24 x 24 grid.
    var cgPath: CGPath {
        WebIconCache.shared.path(self)
    }
}

/// Parsed paths, kept for the process (an icon is parsed once).
final class WebIconCache: @unchecked Sendable {
    static let shared = WebIconCache()
    private let lock = NSLock()
    private var paths: [WebIcon: CGPath] = [:]

    func path(_ icon: WebIcon) -> CGPath {
        lock.lock()
        defer { lock.unlock() }
        if let p = paths[icon] { return p }
        let p = CGMutablePath()
        for node in icon.nodes { node.add(to: p) }
        let done = p.copy() ?? p
        paths[icon] = done
        return done
    }
}

/// A web icon at a size, stroked like lucide-react's `<Icon size strokeWidth />`.
public struct WebIconView: View {
    public let icon: WebIcon
    public var size: CGFloat
    public var strokeWidth: CGFloat
    /// lucide's `absoluteStrokeWidth`: the stroke stays `strokeWidth` points whatever the size.
    public var absoluteStrokeWidth: Bool
    /// lucide's `fill-current`: the shape filled as well as stroked (a pinned tab's pin).
    public var fill: Bool

    public init(_ icon: WebIcon, size: CGFloat = 24, strokeWidth: CGFloat = 2, absoluteStrokeWidth: Bool = false, fill: Bool = false) {
        self.icon = icon
        self.size = size
        self.strokeWidth = strokeWidth
        self.absoluteStrokeWidth = absoluteStrokeWidth
        self.fill = fill
    }

    public var body: some View {
        let stroke = StrokeStyle(lineWidth: absoluteStrokeWidth ? strokeWidth : strokeWidth * size / 24, lineCap: .round, lineJoin: .round)
        ZStack {
            if fill { WebIconShape(icon: icon).fill() }
            WebIconShape(icon: icon).stroke(style: stroke)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// The icon as a shape, scaled from its 24 pt grid into the frame.
public struct WebIconShape: Shape {
    public let icon: WebIcon

    public init(icon: WebIcon) { self.icon = icon }

    public func path(in rect: CGRect) -> Path {
        var t = CGAffineTransform(translationX: rect.minX, y: rect.minY).scaledBy(x: rect.width / 24, y: rect.height / 24)
        return Path(icon.cgPath.copy(using: &t) ?? icon.cgPath)
    }
}

/// SVG path data ("M18 6 6 18", "m6 6 12 12", arcs and curves) to a CGPath. Covers the whole path grammar:
/// M L H V C S Q T A Z, absolute and relative, implicit repeats and the compact number forms ("1.5.5", "-1-2").
enum SVGPath {
    static func add(_ d: String, to path: CGMutablePath) {
        var scanner = Tokens(d)
        var current = CGPoint.zero, start = CGPoint.zero
        var lastControl: CGPoint?
        var lastCommand: Character = " "
        var command: Character = " "

        while let next = scanner.nextCommandOrNumber() {
            if case .command(let c) = next {
                command = c
            } else {
                scanner.pushBack()
                // A number right after a moveto is an implicit lineto.
                if command == "M" { command = "L" } else if command == "m" { command = "l" }
            }
            let rel = command.isLowercase
            let base = rel ? current : .zero
            switch command.uppercased().first! {
            case "M":
                guard let x = scanner.number(), let y = scanner.number() else { return }
                current = CGPoint(x: base.x + x, y: base.y + y)
                start = current
                path.move(to: current)
                lastControl = nil
            case "L":
                guard let x = scanner.number(), let y = scanner.number() else { return }
                current = CGPoint(x: base.x + x, y: base.y + y)
                path.addLine(to: current)
                lastControl = nil
            case "H":
                guard let x = scanner.number() else { return }
                current = CGPoint(x: (rel ? current.x : 0) + x, y: current.y)
                path.addLine(to: current)
                lastControl = nil
            case "V":
                guard let y = scanner.number() else { return }
                current = CGPoint(x: current.x, y: (rel ? current.y : 0) + y)
                path.addLine(to: current)
                lastControl = nil
            case "C":
                guard let x1 = scanner.number(), let y1 = scanner.number(), let x2 = scanner.number(), let y2 = scanner.number(),
                      let x = scanner.number(), let y = scanner.number() else { return }
                let c1 = CGPoint(x: base.x + x1, y: base.y + y1), c2 = CGPoint(x: base.x + x2, y: base.y + y2)
                current = CGPoint(x: base.x + x, y: base.y + y)
                path.addCurve(to: current, control1: c1, control2: c2)
                lastControl = c2
            case "S":
                guard let x2 = scanner.number(), let y2 = scanner.number(), let x = scanner.number(), let y = scanner.number() else { return }
                let c1 = "CcSs".contains(lastCommand) ? reflect(lastControl, around: current) : current
                let c2 = CGPoint(x: base.x + x2, y: base.y + y2)
                current = CGPoint(x: base.x + x, y: base.y + y)
                path.addCurve(to: current, control1: c1, control2: c2)
                lastControl = c2
            case "Q":
                guard let x1 = scanner.number(), let y1 = scanner.number(), let x = scanner.number(), let y = scanner.number() else { return }
                let c = CGPoint(x: base.x + x1, y: base.y + y1)
                current = CGPoint(x: base.x + x, y: base.y + y)
                path.addQuadCurve(to: current, control: c)
                lastControl = c
            case "T":
                guard let x = scanner.number(), let y = scanner.number() else { return }
                let c = "QqTt".contains(lastCommand) ? reflect(lastControl, around: current) : current
                current = CGPoint(x: base.x + x, y: base.y + y)
                path.addQuadCurve(to: current, control: c)
                lastControl = c
            case "A":
                guard let rx = scanner.number(), let ry = scanner.number(), let rot = scanner.number(),
                      let large = scanner.flag(), let sweep = scanner.flag(),
                      let x = scanner.number(), let y = scanner.number() else { return }
                let end = CGPoint(x: base.x + x, y: base.y + y)
                arc(path, from: current, to: end, rx: rx, ry: ry, rotation: rot, large: large, sweep: sweep)
                current = end
                lastControl = nil
            case "Z":
                path.closeSubpath()
                current = start
                lastControl = nil
            default:
                return
            }
            lastCommand = command
        }
    }

    private static func reflect(_ p: CGPoint?, around c: CGPoint) -> CGPoint {
        guard let p else { return c }
        return CGPoint(x: 2 * c.x - p.x, y: 2 * c.y - p.y)
    }

    /// An SVG elliptical arc as cubic Béziers (the endpoint to centre conversion of SVG 1.1 appendix F.6).
    static func arc(_ path: CGMutablePath, from p0: CGPoint, to p1: CGPoint, rx rxIn: CGFloat, ry ryIn: CGFloat, rotation: CGFloat, large: Bool, sweep: Bool) {
        if p0 == p1 { return }
        var rx = abs(rxIn), ry = abs(ryIn)
        if rx == 0 || ry == 0 {
            path.addLine(to: p1)
            return
        }
        let phi = rotation * .pi / 180
        let cosPhi = cos(phi), sinPhi = sin(phi)
        let dx = (p0.x - p1.x) / 2, dy = (p0.y - p1.y) / 2
        let x1p = cosPhi * dx + sinPhi * dy
        let y1p = -sinPhi * dx + cosPhi * dy
        let lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
        if lambda > 1 {
            rx *= sqrt(lambda)
            ry *= sqrt(lambda)
        }
        let num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p
        let den = rx * rx * y1p * y1p + ry * ry * x1p * x1p
        var coef = den == 0 ? 0 : sqrt(max(0, num / den))
        if large == sweep { coef = -coef }
        let cxp = coef * (rx * y1p / ry)
        let cyp = coef * -(ry * x1p / rx)
        let cx = cosPhi * cxp - sinPhi * cyp + (p0.x + p1.x) / 2
        let cy = sinPhi * cxp + cosPhi * cyp + (p0.y + p1.y) / 2

        func angle(_ ux: CGFloat, _ uy: CGFloat, _ vx: CGFloat, _ vy: CGFloat) -> CGFloat {
            let a = atan2(ux * vy - uy * vx, ux * vx + uy * vy)
            return a
        }
        let theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
        var delta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
        if !sweep, delta > 0 { delta -= 2 * .pi }
        if sweep, delta < 0 { delta += 2 * .pi }

        let segments = max(1, Int(ceil(abs(delta) / (.pi / 2))))
        let step = delta / CGFloat(segments)
        let k = 4 / 3 * tan(step / 4)
        var t = theta1
        func point(_ a: CGFloat) -> CGPoint {
            CGPoint(x: cx + rx * cos(a) * cosPhi - ry * sin(a) * sinPhi, y: cy + rx * cos(a) * sinPhi + ry * sin(a) * cosPhi)
        }
        func derivative(_ a: CGFloat) -> CGPoint {
            CGPoint(x: -rx * sin(a) * cosPhi - ry * cos(a) * sinPhi, y: -rx * sin(a) * sinPhi + ry * cos(a) * cosPhi)
        }
        for i in 0..<segments {
            let t2 = t + step
            let a = point(t), b = i == segments - 1 ? p1 : point(t2)
            let da = derivative(t), db = derivative(t2)
            path.addCurve(to: b, control1: CGPoint(x: a.x + k * da.x, y: a.y + k * da.y), control2: CGPoint(x: b.x - k * db.x, y: b.y - k * db.y))
            t = t2
        }
    }

    /// The numbers in a points list ("12 2 2 7 12 12").
    static func numbers(_ s: String) -> [CGFloat] {
        var t = Tokens(s)
        var out: [CGFloat] = []
        while let n = t.number() { out.append(n) }
        return out
    }

    enum Token { case command(Character), number }

    /// Reads commands and numbers from path data.
    struct Tokens {
        let chars: [Character]
        var i = 0
        var mark = 0

        init(_ s: String) { chars = Array(s) }

        private mutating func skipSeparators() {
            while i < chars.count, chars[i] == " " || chars[i] == "," || chars[i] == "\n" || chars[i] == "\t" || chars[i] == "\r" { i += 1 }
        }

        mutating func nextCommandOrNumber() -> Token? {
            skipSeparators()
            mark = i
            guard i < chars.count else { return nil }
            let c = chars[i]
            if c.isLetter, c != "e", c != "E" {
                i += 1
                return .command(c)
            }
            return .number
        }

        mutating func pushBack() { i = mark }

        /// An arc flag: one 0 or 1, which may be written with no separator ("a1 1 0 011 1").
        mutating func flag() -> Bool? {
            skipSeparators()
            guard i < chars.count else { return nil }
            let c = chars[i]
            guard c == "0" || c == "1" else { return nil }
            i += 1
            return c == "1"
        }

        mutating func number() -> CGFloat? {
            skipSeparators()
            guard i < chars.count else { return nil }
            let begin = i
            if chars[i] == "-" || chars[i] == "+" { i += 1 }
            var sawDot = false, sawDigit = false
            while i < chars.count {
                let c = chars[i]
                if c.isNumber {
                    sawDigit = true
                    i += 1
                } else if c == ".", !sawDot {
                    sawDot = true
                    i += 1
                } else {
                    break
                }
            }
            if sawDigit, i < chars.count, chars[i] == "e" || chars[i] == "E" {
                var j = i + 1
                if j < chars.count, chars[j] == "-" || chars[j] == "+" { j += 1 }
                if j < chars.count, chars[j].isNumber {
                    i = j
                    while i < chars.count, chars[i].isNumber { i += 1 }
                }
            }
            guard sawDigit, let v = Double(String(chars[begin..<i])) else {
                i = begin
                return nil
            }
            return CGFloat(v)
        }
    }
}
