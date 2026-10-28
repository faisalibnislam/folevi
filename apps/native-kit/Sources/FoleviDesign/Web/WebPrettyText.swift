// `text-wrap: pretty` (globals.css sets it on every <p>) for native text: WebKit lays a paragraph out as a whole,
// evening out the lines and keeping the last one from being short, so its line breaks differ from the greedy
// ones SwiftUI makes. WebPrettyText finds the breaks the same way (as many lines as the greedy fill, the sum of
// the squared slack of each line the least, a last line shorter than `lastLine` of the width costing as much as
// slack) and sets the paragraph with them.
import CoreText
import SwiftUI

public enum WebPrettyWrap {
    /// How full the last line should be before it costs nothing (fitted to WebKit's choices in the screenshot
    /// diffs: Help's intro, Reviews' empty state).
    public static let lastLine: CGFloat = 0.85

    /// The width of a run of text in a style (CSS letter spacing after every character, as WebKit adds it).
    public static func width(_ s: Substring, _ style: WebTextStyle) -> CGFloat {
        let attr = NSAttributedString(string: String(s), attributes: [.font: style.ctFont, .kern: style.letterSpacing])
        let line = CTLineCreateWithAttributedString(attr)
        return CTLineGetTypographicBounds(line, nil, nil, nil)
    }

    /// `text-wrap: balance` (globals.css sets it on h1 to h3): as many lines as the greedy fill, as even as they can
    /// be (the narrowest width that still needs no more lines, filled greedily).
    public static func balanced(_ text: String, style: WebTextStyle, width: CGFloat) -> [String] {
        let target = greedy(text, style: style, width: width).count
        guard target > 1 else { return [text] }
        var lo: CGFloat = 1, hi = width
        while hi - lo > 0.5 {
            let mid = (lo + hi) / 2
            if greedy(text, style: style, width: mid).count <= target { hi = mid } else { lo = mid }
        }
        return greedy(text, style: style, width: hi)
    }

    /// The browser's ordinary fill.
    public static func greedy(_ text: String, style: WebTextStyle, width: CGFloat) -> [String] {
        let words = text.split(separator: " ", omittingEmptySubsequences: false)
        let space = Self.width(" ", style)
        var out: [String] = []
        var line: [Substring] = []
        var lw: CGFloat = 0
        for w in words {
            let ww = Self.width(w, style)
            if !line.isEmpty, lw + space + ww > width + 0.01 {
                out.append(line.joined(separator: " "))
                line = [w]
                lw = ww
            } else {
                lw += (line.isEmpty ? 0 : space) + ww
                line.append(w)
            }
        }
        if !line.isEmpty { out.append(line.joined(separator: " ")) }
        return out
    }

    /// The paragraph's lines for `width`.
    public static func lines(_ text: String, style: WebTextStyle, width: CGFloat, lastLine: CGFloat = WebPrettyWrap.lastLine) -> [String] {
        let words = text.split(separator: " ", omittingEmptySubsequences: false)
        guard words.count > 1, width > 0 else { return [text] }
        let space = Self.width(" ", style)
        let w = words.map { Self.width($0, style) }
        func lineWidth(_ i: Int, _ j: Int) -> CGFloat { w[i..<j].reduce(0, +) + space * CGFloat(j - i - 1) }
        // Greedy: how many lines the browser's ordinary fill makes.
        var greedy = 0, i = 0
        while i < words.count {
            var j = i + 1
            while j < words.count, lineWidth(i, j + 1) <= width + 0.01 { j += 1 }
            greedy += 1
            i = j
        }
        guard greedy > 1 else { return [text] }
        // Least cost over break points, with exactly `greedy` lines.
        let n = words.count
        let inf = CGFloat.infinity
        var cost = Array(repeating: Array(repeating: inf, count: greedy + 1), count: n + 1)
        var from = Array(repeating: Array(repeating: -1, count: greedy + 1), count: n + 1)
        cost[0][0] = 0
        for end in 1...n {
            for lines in 1...greedy {
                for start in stride(from: end - 1, through: 0, by: -1) {
                    let lw = lineWidth(start, end)
                    if lw > width + 0.01 { break }
                    guard cost[start][lines - 1] < inf else { continue }
                    let last = end == n
                    let c: CGFloat = last ? pow(max(0, width * lastLine - lw), 2) : pow(width - lw, 2)
                    if cost[start][lines - 1] + c < cost[end][lines] {
                        cost[end][lines] = cost[start][lines - 1] + c
                        from[end][lines] = start
                    }
                }
            }
        }
        guard cost[n][greedy] < inf else { return [text] }
        var out: [String] = []
        var end = n, k = greedy
        while k > 0 {
            let start = from[end][k]
            out.insert(words[start..<end].joined(separator: " "), at: 0)
            end = start
            k -= 1
        }
        return out
    }
}

/// How a paragraph wraps: `pretty` (every <p>), `balance` (headings) or the plain greedy fill.
public enum WebWrap: Sendable { case pretty, balance, greedy }

/// A paragraph wrapped as CSS wraps it, in a web text style: its lines found here (`text-wrap: pretty` or
/// `balance`), each set as its own exact CSS line box (so any font's lines are `leading` apart).
public struct WebPrettyText: View {
    let text: String
    let style: WebTextStyle
    let alignment: TextAlignment
    let wrap: WebWrap
    /// The width to break for, when the caller knows it (the element's computed width); else what's offered.
    let fixedWidth: CGFloat?
    @State private var measured: CGFloat = 0

    public init(_ text: String, style: WebTextStyle, alignment: TextAlignment = .leading, wrap: WebWrap = .pretty, width: CGFloat? = nil) {
        self.text = text
        self.style = style
        self.alignment = alignment
        self.wrap = wrap
        self.fixedWidth = width
    }

    private var width: CGFloat { fixedWidth ?? measured }

    private var lines: [String] {
        guard width > 0 else { return [text] }
        switch wrap {
        case .pretty: return WebPrettyWrap.lines(text, style: style, width: width)
        case .balance: return WebPrettyWrap.balanced(text, style: style, width: width)
        case .greedy: return WebPrettyWrap.greedy(text, style: style, width: width)
        }
    }

    public var body: some View {
        let h: HorizontalAlignment = alignment == .center ? .center : alignment == .trailing ? .trailing : .leading
        VStack(alignment: h, spacing: 0) {
            // The width offered (never the lines' own): what the lines are broken for.
            Color.clear.frame(maxWidth: .infinity, maxHeight: 0)
                .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { measured = $0 }
            ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                Text(verbatim: line).webText(style).lineLimit(1).fixedSize()
            }
        }
        .frame(maxWidth: .infinity, alignment: Alignment(horizontal: h, vertical: .top))
    }
}
