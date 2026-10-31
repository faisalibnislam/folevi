// A paragraph broken into lines as WebKit breaks a `<p>` in the web app: globals.css gives every `p`
// `text-wrap: pretty` (and every heading `balance`), so the lines are not the greedy ones SwiftUI makes. WebKit
// weighs the whole paragraph and keeps the lines even; here that is the break set with the least squared room
// left over on every line, the last one included (it matches WebKit on the gate screens' paragraphs), found by dynamic programming over the break opportunities
// CSS has (after a space, which is dropped, and after a hyphen), each line measured with Core Text in the
// element's own font, features and letter spacing. Each line is then drawn as one CSS line box.
import CoreText
import SwiftUI

/// One run of a paragraph: its text and, optionally, its own weight and colour (a `<span className="font-medium
/// text-ink">` inside the paragraph).
public struct WebRun: Hashable, Sendable {
    public var text: String
    public var weight: CGFloat?
    public var color: RGBA?

    public init(_ text: String, weight: CGFloat? = nil, color: RGBA? = nil) {
        self.text = text.webKitShaped
        self.weight = weight
        self.color = color
    }
}

public extension String {
    /// The text as WebKit shapes it: in pieces split where a line may break, so no kerning across a hyphen (the
    /// "-1" in "2026-11-12" loses 1.7 pt in Core Text, none in WebKit). A zero-width non-joiner after each hyphen
    /// keeps Core Text from kerning across it (it kerns straight across a zero-width space), and a zero-width space
    /// after that keeps the line break the hyphen allows (the non-joiner takes it away); both draw nothing. iOS only for now: the Mac's matched screens were measured without it.
    var webKitShaped: String {
        #if os(iOS)
        guard contains("-") else { return self }
        var out = ""
        let chars = Array(self)
        for (i, c) in chars.enumerated() {
            out.append(c)
            if c == "-", i + 1 < chars.count, !chars[i + 1].isWhitespace, chars[i + 1] != "\u{200C}" { out.append("\u{200C}\u{200B}") }
        }
        return out
        #else
        self
        #endif
    }
}

public enum WebTextWrap: Sendable, Equatable {
    /// `text-wrap: pretty` (paragraphs).
    case pretty
    /// `text-wrap: balance` (headings): the same, the last line weighed like the others.
    case balance
    /// The plain greedy breaks.
    case greedy
    /// `text-wrap: pretty` as the iPhone's WebKit lays it out: even lines, the last one counting `lastLine` as much
    /// as the others (it may be shorter).
    case prettyLastWeighted(CGFloat)
    /// The same for every paragraph, one of two lines too: Foli AI's answers on the iPhone, whose two-line paragraphs
    /// WebKit evens (fitted to its breaks: a last-line weight of 0.24 to 0.33).
    case prettyAllLastWeighted(CGFloat)

    /// The iPhone's `text-wrap: pretty`: one or two lines as they fall, longer paragraphs evened out with the last line
    /// weighed at 0.6 (0.5 to 0.75 match the gates' paragraphs as the Simulator's WebKit breaks them; PrettyWrapTests).
    public static let iPhonePretty = WebTextWrap.prettyLastWeighted(0.6)
}

public struct WebParagraph: View {
    let runs: [WebRun]
    let style: WebTextStyle
    let width: CGFloat
    let alignment: TextAlignment
    let wrap: WebTextWrap

    public init(_ runs: [WebRun], style: WebTextStyle, width: CGFloat, alignment: TextAlignment = .leading, wrap: WebTextWrap = .pretty) {
        self.runs = runs
        self.style = style
        self.width = width
        self.alignment = alignment
        self.wrap = wrap
    }

    public init(_ text: String, style: WebTextStyle, width: CGFloat, alignment: TextAlignment = .leading, wrap: WebTextWrap = .pretty) {
        self.init([WebRun(text)], style: style, width: width, alignment: alignment, wrap: wrap)
    }

    public var body: some View {
        let lines = WebLineBreaker.lines(runs, style: style, width: width, wrap: wrap)
        VStack(alignment: alignment == .center ? .center : alignment == .trailing ? .trailing : .leading, spacing: 0) {
            ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                line.reduce(Text("")) { text, run in
                    var t = Text(run.text)
                    if let w = run.weight { t = t.font(Font(WebFont.ctFont(style.family, size: style.size, weight: w))) }
                    if let c = run.color { t = t.foregroundColor(c.color) }
                    return text + t
                }
                .webText(style)
                .lineLimit(1)
                .fixedSize()
            }
        }
        .frame(width: width, alignment: alignment == .center ? .center : alignment == .trailing ? .trailing : .leading)
    }
}

public enum WebLineBreaker {
    /// The paragraph's lines, each a list of runs.
    public static func lines(_ runs: [WebRun], style: WebTextStyle, width: CGFloat, wrap: WebTextWrap) -> [[WebRun]] {
        // Characters with their run, and the break opportunities: after a space (the space hangs) or a hyphen.
        var chars: [(Character, Int)] = []
        for (i, r) in runs.enumerated() { for c in r.text { chars.append((c, i)) } }
        guard !chars.isEmpty else { return [] }
        var breaks: [Int] = []  // index after which a line may end
        for (i, c) in chars.enumerated() where i < chars.count - 1 {
            // (Not after "› " or "‹ ": a quotation mark stays with the word after it, as WebKit's line breaking keeps
            // "On My iPhone › Folevi" together across the arrow, Unicode's LB19.)
            if c.0 == " ", i > 0, ["\u{203A}", "\u{2039}"].contains(chars[i - 1].0) { continue }
            if c.0 == " " || c.0 == "-" || c.0 == "\u{2010}" { breaks.append(i) }
        }
        breaks.append(chars.count - 1)
        func slice(_ from: Int, _ to: Int) -> [WebRun] {
            // Characters from...to inclusive, a trailing space dropped, as runs.
            var end = to
            while end >= from, chars[end].0 == " " { end -= 1 }
            guard end >= from else { return [] }
            var out: [WebRun] = []
            var lastRun = -1
            for i in from...end {
                let (c, r) = chars[i]
                if r == lastRun { out[out.count - 1].text.append(c) } else { out.append(WebRun(String(c), weight: runs[r].weight, color: runs[r].color)) }
                lastRun = r
            }
            return out
        }
        var cache: [Int: CGFloat] = [:]
        func measure(_ from: Int, _ to: Int) -> CGFloat {
            let key = from * 100_000 + to
            if let w = cache[key] { return w }
            let w = WebLineBreaker.width(of: slice(from, to), style: style)
            cache[key] = w
            return w
        }
        // Greedy first: it is also the answer for `greedy`, and the fallback when a word alone is too wide.
        if wrap == .greedy { return greedy(breaks, measure: measure, width: width).map { slice($0.0, $0.1) } }
        // The iPhone's WebKit leaves a paragraph of one or two lines as it falls.
        if case .prettyLastWeighted = wrap {
            let plain = greedy(breaks, measure: measure, width: width)
            if plain.count <= 2 { return plain.map { slice($0.0, $0.1) } }
        }
        // best[j]: the least cost of lines covering chars 0...breaks[j].
        let n = breaks.count
        var best = [CGFloat](repeating: .infinity, count: n)
        var from = [Int](repeating: -1, count: n)
        for j in 0..<n {
            for i in stride(from: j, through: -1, by: -1) {
                let start = i < 0 ? 0 : breaks[i] + 1
                let w = measure(start, breaks[j])
                if w > width + 0.01 {
                    // Too wide: only a single word may overflow (it can't break anywhere else).
                    if i == j - 1 || (i < 0 && j == 0) {
                        let prior = i < 0 ? 0 : best[i]
                        if prior + 1_000_000 < best[j] { best[j] = prior + 1_000_000; from[j] = i }
                    }
                    break
                }
                let slack = width - w
                // Every line counts, the last too: that is what keeps WebKit's last lines from being orphans.
                var cost = slack * slack
                if case .prettyLastWeighted(let k) = wrap, j == n - 1 { cost *= k }
                if case .prettyAllLastWeighted(let k) = wrap, j == n - 1 { cost *= k }
                let prior = i < 0 ? 0 : best[i]
                if prior + cost < best[j] { best[j] = prior + cost; from[j] = i }
            }
        }
        var ends: [(Int, Int)] = []
        var j = n - 1
        while j >= 0 {
            let i = from[j]
            ends.append((i < 0 ? 0 : breaks[i] + 1, breaks[j]))
            j = i
        }
        return ends.reversed().map { slice($0.0, $0.1) }
    }

    private static func greedy(_ breaks: [Int], measure: (Int, Int) -> CGFloat, width: CGFloat) -> [(Int, Int)] {
        var out: [(Int, Int)] = []
        var start = 0
        var last = -1
        for b in breaks {
            if measure(start, b) <= width + 0.01 { last = b; continue }
            if last >= start {
                out.append((start, last))
                start = last + 1
                last = measure(start, b) <= width + 0.01 ? b : -1
                if last < 0 { out.append((start, b)); start = b + 1 }
            } else {
                out.append((start, b))
                start = b + 1
            }
        }
        if start <= (breaks.last ?? 0) { out.append((start, breaks.last ?? 0)) }
        return out
    }

    /// The advance of runs in the style (Core Text, the style's letter spacing after every character as CSS does,
    /// except that a line's last letter spacing still counts in CSS too).
    public static func width(of runs: [WebRun], style: WebTextStyle) -> CGFloat {
        let s = NSMutableAttributedString()
        for r in runs {
            let font = WebFont.ctFont(style.family, size: style.size, weight: r.weight ?? style.weight)
            s.append(NSAttributedString(string: r.text, attributes: [NSAttributedString.Key(kCTFontAttributeName as String): font, NSAttributedString.Key(kCTKernAttributeName as String): style.letterSpacing]))
        }
        let line = CTLineCreateWithAttributedString(s)
        return CGFloat(CTLineGetTypographicBounds(line, nil, nil, nil))
    }
}
