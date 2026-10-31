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
        memo.width(String(s), style) {
            let attr = NSAttributedString(string: String(s), attributes: [.font: style.ctFont, .kern: style.letterSpacing])
            let line = CTLineCreateWithAttributedString(attr)
            return CTLineGetTypographicBounds(line, nil, nil, nil)
        }
    }

    /// Words measured and paragraphs wrapped before (a card's preview is wrapped again on every layout pass, and
    /// again for each card a list scrolls into view): the same answer without measuring again. Bounded, cleared
    /// when full.
    static let memo = Memo()

    final class Memo: @unchecked Sendable {
        private struct WidthKey: Hashable { let text: String; let style: WebTextStyle; let family: WebFontFamily }
        private struct LinesKey: Hashable { let text: String; let style: WebTextStyle; let family: WebFontFamily; let width: CGFloat; let lastLine: CGFloat }
        private let lock = NSLock()
        private var widths: [WidthKey: CGFloat] = [:]
        private var wrapped: [LinesKey: [String]] = [:]

        func width(_ text: String, _ style: WebTextStyle, make: () -> CGFloat) -> CGFloat {
            let k = WidthKey(text: text, style: style, family: style.family)
            lock.lock()
            if let w = widths[k] { lock.unlock(); return w }
            lock.unlock()
            let w = make()
            lock.lock()
            if widths.count > 20_000 { widths.removeAll(keepingCapacity: true) }
            widths[k] = w
            lock.unlock()
            return w
        }

        func lines(_ text: String, _ style: WebTextStyle, width: CGFloat, lastLine: CGFloat, make: () -> [String]) -> [String] {
            let k = LinesKey(text: text, style: style, family: style.family, width: width, lastLine: lastLine)
            lock.lock()
            if let l = wrapped[k] { lock.unlock(); return l }
            lock.unlock()
            let l = make()
            lock.lock()
            if wrapped.count > 4_000 { wrapped.removeAll(keepingCapacity: true) }
            wrapped[k] = l
            lock.unlock()
            return l
        }
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

    /// A piece of a paragraph between two places a line may break: after a space, or after a hyphen inside a word
    /// ("Saiho-" "ji"), as WebKit breaks. `space`: a space follows it (else the next piece joins it directly).
    struct Piece {
        let text: Substring
        let space: Bool
    }

    static func pieces(_ text: String) -> [Piece] {
        var out: [Piece] = []
        for word in text.split(separator: " ", omittingEmptySubsequences: false) {
            var start = word.startIndex
            var i = word.startIndex
            while i < word.endIndex {
                let next = word.index(after: i)
                if word[i] == "-", i > word.startIndex, next < word.endIndex, word[word.index(before: i)].isLetter, word[next].isLetter {
                    out.append(Piece(text: word[start..<next], space: false))
                    start = next
                }
                i = next
            }
            out.append(Piece(text: word[start...], space: true))
        }
        return out
    }

    private static func join(_ p: ArraySlice<Piece>) -> String {
        var s = ""
        for (k, piece) in zip(p.indices, p) {
            s += piece.text
            if k < p.endIndex - 1, piece.space { s += " " }
        }
        return s
    }

    /// The browser's ordinary fill.
    public static func greedy(_ text: String, style: WebTextStyle, width: CGFloat) -> [String] {
        let p = pieces(text)
        let space = Self.width(" ", style)
        let w = p.map { Self.width($0.text, style) }
        var out: [String] = []
        var start = 0
        var lw: CGFloat = 0
        for k in p.indices {
            let gap: CGFloat = k > start && p[k - 1].space ? space : 0
            if k > start, lw + gap + w[k] > width + 0.01 {
                out.append(join(p[start..<k]))
                start = k
                lw = w[k]
            } else {
                lw += gap + w[k]
            }
        }
        if start < p.count { out.append(join(p[start..<p.count])) }
        return out
    }

    /// The paragraph's lines for `width`.
    public static func lines(_ text: String, style: WebTextStyle, width: CGFloat, lastLine: CGFloat = WebPrettyWrap.lastLine) -> [String] {
        memo.lines(text, style, width: width, lastLine: lastLine) { prettyLines(text, style: style, width: width, lastLine: lastLine) }
    }

    private static func prettyLines(_ text: String, style: WebTextStyle, width: CGFloat, lastLine: CGFloat) -> [String] {
        let p = pieces(text)
        guard p.count > 1, width > 0 else { return [text] }
        let space = Self.width(" ", style)
        let w = p.map { Self.width($0.text, style) }
        func lineWidth(_ i: Int, _ j: Int) -> CGFloat {
            var total: CGFloat = 0
            for k in i..<j { total += w[k] + (k < j - 1 && p[k].space ? space : 0) }
            return total
        }
        // Greedy: how many lines the browser's ordinary fill makes.
        var greedy = 0, i = 0
        while i < p.count {
            var j = i + 1
            while j < p.count, lineWidth(i, j + 1) <= width + 0.01 { j += 1 }
            greedy += 1
            i = j
        }
        guard greedy > 1 else { return [text] }
        // Least cost over break points, with exactly `greedy` lines.
        let n = p.count
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
            out.insert(join(p[start..<end]), at: 0)
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
        // WebKit's own breaks when the page can say them (`text.layout`, the Mac and the iPhone): no model of
        // `text-wrap: pretty` matches it everywhere. Mono text and an unanswered request use the model.
        if style.family != .mono, WebLineLayout.shared.requester != nil {
            let s = WebLineLayout.Style(family: style.family == .display ? .display : .sans, size: style.size, lineHeight: style.leading, weight: style.weight, letterSpacing: style.letterSpacing, width: width, wrap: wrap == .pretty ? .pretty : wrap == .balance ? .balance : .wrap, pre: false)
            if let got = WebLineLayout.shared.lines(text, style: s), !got.isEmpty { return got }
        }
        switch wrap {
        case .pretty: return WebPrettyWrap.lines(text, style: style, width: width)
        case .balance: return WebPrettyWrap.balanced(text, style: style, width: width)
        case .greedy: return WebPrettyWrap.greedy(text, style: style, width: width)
        }
    }

    public var body: some View {
        let h: HorizontalAlignment = alignment == .center ? .center : alignment == .trailing ? .trailing : .leading
        // The width the paragraph is placed in (never the lines' own, nor an ideal-size query's): what the lines are
        // broken for.
        PlacedWidth(report: { w in if abs(w - measured) > 0.5 { measured = w } }) {
        VStack(alignment: h, spacing: 0) {
            if width <= 0 {
                // (Until the width is known, the text wraps as SwiftUI wraps it, in the width offered: a single line
                // here would size everything round it to the whole text.)
                Text(verbatim: text).webText(style).multilineTextAlignment(alignment)
            }
            ForEach(Array((width > 0 ? lines : []).enumerated()), id: \.offset) { _, line in
                // Each line its own width, inside a frame that takes only what's offered: a line never widens the
                // paragraph (before the width was known, the whole text on one line did, and the width measured
                // then was that line's, so a dialog's description stayed one line and pushed the dialog wide).
                Text(verbatim: line).webText(style).lineLimit(1).fixedSize()
                    .frame(maxWidth: .infinity, alignment: Alignment(horizontal: h, vertical: .center))
            }
        }
        .frame(maxWidth: .infinity, alignment: Alignment(horizontal: h, vertical: .top))
        }
    }
}

/// Lays out its one child as offered and reports the width it's finally placed in (sizing passes, which may ask
/// with any width or none, report nothing).
private struct PlacedWidth: Layout {
    let report: @MainActor (CGFloat) -> Void

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        subviews.first?.sizeThatFits(proposal) ?? .zero
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        subviews.first?.place(at: bounds.origin, proposal: ProposedViewSize(bounds.size))
        let w = bounds.width
        guard w.isFinite, w > 0 else { return }
        DispatchQueue.main.async { MainActor.assumeIsolated { report(w) } }
    }
}
