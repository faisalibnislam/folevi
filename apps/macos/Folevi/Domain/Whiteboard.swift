import Foundation

/// Port of packages/editor-schema/src/whiteboard.ts (the parts exports need).
///
/// A whiteboard's `props.data` is a JSON string of freehand strokes in a fixed logical space
/// (x in 0…1000, y in 0…props.height). Each stroke has `points` or an SVG path `d`.
public enum Whiteboard {
    public static let width = 1000
    public static let defaultHeight = 420
    static let maxStrokes = 4000
    static let maxPoints = 4000

    static let colors: [String: String] = [
        "ink": "#1f2328", "blue": "#2563eb", "red": "#dc2626", "green": "#16a34a",
        "orange": "#ea580c", "purple": "#7c3aed", "yellow": "#facc15",
    ]

    struct Stroke {
        var points: [(Double, Double)]?
        var d: String?
        var color: String
        var width: Double
        var opacity: Double?
    }

    private static func isNum(_ v: JSONValue?) -> Double? {
        guard let n = v?.doubleValue, n.isFinite, abs(n) <= 100_000 else { return nil }
        return n
    }

    private static func matches(_ s: String, _ pattern: String) -> Bool {
        s.range(of: pattern, options: .regularExpression) != nil
    }

    /// The strokes of valid data; invalid data reads as an empty drawing (as on the web).
    static func strokes(_ data: String) -> [Stroke] {
        guard !data.isEmpty, data.utf16.count <= FoleviLimits.maxWhiteboardDataLength,
              let parsed = try? JSONValue(jsonString: data), let obj = parsed.objectValue,
              obj.keys.allSatisfy({ $0 == "v" || $0 == "strokes" }),
              obj["v"] == nil || obj["v"]?.doubleValue == 1,
              let raw = obj["strokes"]?.arrayValue, raw.count <= maxStrokes
        else { return [] }
        var out: [Stroke] = []
        for item in raw {
            guard let st = item.objectValue,
                  st.keys.allSatisfy({ ["points", "d", "color", "width", "opacity"].contains($0) }),
                  let color = st["color"]?.stringValue, matches(color, "^(#[0-9a-fA-F]{6}|[a-z]{1,16})$"),
                  let width = isNum(st["width"]), width > 0, width <= 80
            else { return [] }
            var opacity: Double?
            if let o = st["opacity"] {
                guard let n = isNum(o), n >= 0, n <= 1 else { return [] }
                opacity = n
            }
            let hasPoints = st["points"] != nil
            guard hasPoints != (st["d"] != nil) else { return [] }
            if hasPoints {
                guard let pts = st["points"]?.arrayValue, !pts.isEmpty, pts.count <= maxPoints else { return [] }
                var points: [(Double, Double)] = []
                for p in pts {
                    guard let xy = p.arrayValue, xy.count == 2, let x = isNum(xy[0]), let y = isNum(xy[1]) else { return [] }
                    points.append((x, y))
                }
                out.append(Stroke(points: points, color: color, width: width, opacity: opacity))
            } else {
                guard let d = st["d"]?.stringValue, !d.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                      d.utf16.count <= 50_000, matches(d, "^[MLQCTSZmlqctsz0-9.,\\s-]*$")
                else { return [] }
                out.append(Stroke(d: d, color: color, width: width, opacity: opacity))
            }
        }
        return out
    }

    private static func r1(_ n: Double) -> String {
        // JS Math.round rounds halves up (towards +∞).
        JSONValue.formatNumber((n * 10 + 0.5).rounded(.down) / 10)
    }

    /// A smooth SVG path through the points (quadratic curves between midpoints).
    static func path(_ points: [(Double, Double)]) -> String {
        guard let (x0, y0) = points.first else { return "" }
        if points.count == 1 { return "M\(r1(x0)) \(r1(y0))L\(r1(x0 + 0.1)) \(r1(y0))" }
        if points.count == 2 { return "M\(r1(x0)) \(r1(y0))L\(r1(points[1].0)) \(r1(points[1].1))" }
        var d = "M\(r1(x0)) \(r1(y0))"
        for i in 1..<(points.count - 1) {
            let (x, y) = points[i]
            let (nx, ny) = points[i + 1]
            d += "Q\(r1(x)) \(r1(y)) \(r1((x + nx) / 2)) \(r1((y + ny) / 2))"
        }
        let last = points[points.count - 1]
        return "\(d)L\(r1(last.0)) \(r1(last.1))"
    }

    static func color(_ name: String) -> String {
        name.hasPrefix("#") ? name : (colors[name] ?? colors["ink"]!)
    }

    /// A standalone SVG of the drawing (exports), byte-identical to the web's.
    public static func svg(data: String, height: Double?, title: String = "Whiteboard") -> String {
        let requested = height.flatMap { $0.isFinite && $0 != 0 ? $0 : nil } ?? Double(defaultHeight)
        let h = max(Double(FoleviLimits.minWhiteboardHeight), min(Double(FoleviLimits.maxWhiteboardHeight), requested))
        let paths = strokes(data).map { s -> String in
            let d = s.points.map(path) ?? s.d ?? ""
            if d.isEmpty { return "" }
            let op = s.opacity.flatMap { $0 < 1 ? " stroke-opacity=\"\(JSONValue.formatNumber($0))\"" : nil } ?? ""
            return "<path d=\"\(d)\" fill=\"none\" stroke=\"\(color(s.color))\" stroke-width=\"\(JSONValue.formatNumber(s.width))\" stroke-linecap=\"round\" stroke-linejoin=\"round\"\(op)/>"
        }.joined()
        let safeTitle = title.filter { !"<>&\"".contains($0) }
        let hs = JSONValue.formatNumber(h)
        return "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 \(width) \(hs)\" width=\"\(width)\" height=\"\(hs)\" role=\"img\" aria-label=\"\(safeTitle)\"><rect width=\"100%\" height=\"100%\" fill=\"#ffffff\"/>\(paths)</svg>"
    }

    // MARK: Editing (the web's WhiteboardView)

    /// The saved height, clamped (clampHeight).
    static func clampHeight(_ h: Double?) -> Double {
        let n = h.flatMap { $0.isFinite && $0 > 0 ? $0 : nil } ?? Double(defaultHeight)
        return max(Double(FoleviLimits.minWhiteboardHeight), min(Double(FoleviLimits.maxWhiteboardHeight), n))
    }

    /// The data string for strokes (serializeWhiteboard); no strokes is "".
    static func serialize(_ strokes: [Stroke]) -> String {
        guard !strokes.isEmpty else { return "" }
        let items: [JSONValue] = strokes.map { s in
            var o: [String: JSONValue] = ["color": .string(s.color), "width": .number(s.width)]
            if let points = s.points {
                o["points"] = .array(points.map { .array([.number($0.0), .number($0.1)]) })
            } else if let d = s.d {
                o["d"] = .string(d)
            }
            if let op = s.opacity { o["opacity"] = .number(op) }
            return .object(o)
        }
        let value: JSONValue = .object(["v": .number(1), "strokes": .array(items)])
        return value.canonicalString
    }

    /// Distance from p to the segment ab (stroke-level erasing).
    static func distanceToSegment(_ p: (Double, Double), _ a: (Double, Double), _ b: (Double, Double)) -> Double {
        let dx = b.0 - a.0, dy = b.1 - a.1
        let len = dx * dx + dy * dy
        let t = len > 0 ? max(0, min(1, ((p.0 - a.0) * dx + (p.1 - a.1) * dy) / len)) : 0
        let x = a.0 + t * dx - p.0, y = a.1 + t * dy - p.1
        return (x * x + y * y).squareRoot()
    }

    /// Whether p is within `radius` of a stroke's centre line (strokes stored as a path `d` aren't hit).
    static func strokeHit(_ stroke: Stroke, _ p: (Double, Double), radius: Double) -> Bool {
        guard let pts = stroke.points, !pts.isEmpty else { return false }
        let r = radius + stroke.width / 2
        if pts.count == 1 { return distanceToSegment(p, pts[0], pts[0]) <= r }
        for i in 1..<pts.count where distanceToSegment(p, pts[i - 1], pts[i]) <= r { return true }
        return false
    }

    /// `encodeURIComponent`, with ( and ) escaped too — the web's data-URI encoding for Markdown.
    static func dataURI(_ svg: String) -> String {
        var allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'")
        allowed.remove(charactersIn: "()")
        return "data:image/svg+xml;utf8," + (svg.addingPercentEncoding(withAllowedCharacters: allowed) ?? "")
    }
}
