// Text that wraps only between words, at most `maxLines` lines, ending in "…" (the web's
// `line-clamp-2 wrap-normal break-normal` for card titles and folder names: a word is never split across
// lines; a word too long for a line is cut with "…" instead). SwiftUI's Text would break such a word, so the
// lines are laid out here with Core Text and drawn as one-line Texts.
import CoreText
import SwiftUI

public struct WordWrappedText: View {
    let text: String
    let family: FoleviFonts.Family
    let size: CGFloat
    let weight: Font.Weight
    let maxLines: Int
    let lineHeight: CGFloat
    let tracking: CGFloat
    let width: CGFloat?

    /// `width` is the line width; cards know it from their own size. Without it the view reads its width
    /// from the layout (one extra layout pass).
    public init(_ text: String, family: FoleviFonts.Family = .display, size: CGFloat, weight: Font.Weight = .medium, maxLines: Int = 2, lineHeight: CGFloat = 1.2, trackingEm: CGFloat = 0, width: CGFloat? = nil) {
        self.text = text
        self.family = family
        self.size = size
        self.weight = weight
        self.maxLines = maxLines
        self.lineHeight = lineHeight
        self.tracking = trackingEm * size
        self.width = width
    }

    public var body: some View {
        if let width {
            lines(width)
        } else {
            AdaptiveWidth { lines($0) }
        }
    }

    private func lines(_ width: CGFloat) -> some View {
        let font = FoleviFonts.font(family, size: size, weight: weight)
        let laid = WordWrap.lines(text, font: ctFont, tracking: tracking, width: width, maxLines: maxLines)
        return VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(laid.enumerated()), id: \.offset) { _, line in
                Text(line).font(font).tracking(tracking).lineLimit(1).fixedSize().frame(height: size * lineHeight)
            }
        }
        .frame(width: width, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(text)
    }

    private var ctFont: CTFont {
        FoleviFonts.register()
        return CTFontCreateWithName(FoleviFonts.postScriptName(family, weight, italic: false) as CFString, size, nil)
    }
}

/// Reads the proposed width, then lays out its content at that width.
private struct AdaptiveWidth<Content: View>: View {
    @State private var width: CGFloat = 0
    let content: (CGFloat) -> Content
    var body: some View {
        content(max(width, 1))
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(GeometryReader { proxy in Color.clear.preference(key: WidthKey.self, value: proxy.size.width) })
            .onPreferenceChange(WidthKey.self) { width = $0 }
    }
}

private struct WidthKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}

public enum WordWrap {
    /// Greedy word wrap into at most `maxLines` lines that fit `width`. Words are never split; a word wider than
    /// a line is cut with "…", and text left over after the last line ends that line in "…".
    public static func lines(_ text: String, font: CTFont, tracking: CGFloat = 0, width: CGFloat, maxLines: Int) -> [String] {
        let words = text.split(whereSeparator: { $0 == " " || $0 == "\n" || $0 == "\t" }).map(String.init)
        guard !words.isEmpty, maxLines > 0 else { return [] }
        guard width.isFinite, width > 0 else { return [words.joined(separator: " ")] }
        var lines: [String] = []
        var current = ""
        var i = 0
        while i < words.count {
            let word = words[i]
            let candidate = current.isEmpty ? word : current + " " + word
            if measure(candidate, font, tracking) <= width {
                current = candidate
                i += 1
                continue
            }
            if current.isEmpty {
                // A single word wider than the line: cut it, and stop (nothing reads after a cut word).
                lines.append(truncate(word, font, tracking, width))
                return lines
            }
            lines.append(current)
            current = ""
            if lines.count == maxLines { break }
        }
        if !current.isEmpty, lines.count < maxLines {
            lines.append(current)
            current = ""
        }
        if i < words.count || !current.isEmpty, let last = lines.popLast() {
            // More words than lines: the last line ends in "…".
            lines.append(truncate(last + "…", font, tracking, width, forceEllipsis: true))
        }
        return lines
    }

    static func measure(_ s: String, _ font: CTFont, _ tracking: CGFloat) -> CGFloat {
        let attr = NSAttributedString(string: s, attributes: [NSAttributedString.Key(kCTFontAttributeName as String): font, NSAttributedString.Key(kCTKernAttributeName as String): tracking])
        let line = CTLineCreateWithAttributedString(attr)
        return CGFloat(CTLineGetTypographicBounds(line, nil, nil, nil))
    }

    static func truncate(_ s: String, _ font: CTFont, _ tracking: CGFloat, _ width: CGFloat, forceEllipsis: Bool = false) -> String {
        if !forceEllipsis, measure(s, font, tracking) <= width { return s }
        var base = forceEllipsis && s.hasSuffix("…") ? String(s.dropLast()) : s
        // Drop whole words first, so the last line ends on a word boundary ("long folder…").
        var words = base.split(separator: " ").map(String.init)
        while words.count > 1 {
            let candidate = words.joined(separator: " ") + "…"
            if measure(candidate, font, tracking) <= width { return candidate }
            words.removeLast()
        }
        base = words.first ?? ""
        while !base.isEmpty {
            let candidate = base.trimmingCharacters(in: .whitespaces) + "…"
            if measure(candidate, font, tracking) <= width { return candidate }
            base.removeLast()
        }
        return "…"
    }
}
