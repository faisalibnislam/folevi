// An answer's Markdown as the web draws it (AiMarkdown.tsx: the note's own read-only blocks, `.fb-ai-answer`,
// 14 pt at 1.55 with no letter spacing, paragraphs 3 pt above and below), from FoleviScreens' MDBlocks (parsed
// as the answer streams, only the growing block redone). Citations ("[2]") are small numbered chips that open
// the cited note; app links stay in the app, other links open in the browser.
import SwiftUI
#if canImport(AppKit)
import AppKit
#endif
#if canImport(UIKit)
import UIKit
#endif
import FoleviDesign
import FoleviEngine

public struct AiAnswerText: View {
    let blocks: [MDBlock]
    /// The citation numbers this answer has (others stay as typed).
    var cited: Set<Int> = []
    var onCite: (Int) -> Void = { _ in }
    var onLink: (URL) -> Bool = { _ in false }
    @Environment(\.aiPhone) private var phone
    @State private var width: CGFloat = 0

    public init(blocks: [MDBlock], cited: Set<Int> = [], onCite: @escaping (Int) -> Void = { _ in }, onLink: @escaping (URL) -> Bool = { _ in false }) {
        self.blocks = blocks
        self.cited = cited
        self.onCite = onCite
        self.onLink = onLink
    }
    @Environment(\.colorScheme) private var scheme

    public var body: some View {
        let look = AiLook(scheme: scheme, phone: phone)
        VStack(alignment: .leading, spacing: 0) {
            ForEach(blocks) { b in
                block(b, look: look)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        .environment(\.openURL, OpenURLAction { url in
            if url.scheme == "folevi-cite", let n = Int(url.host ?? "") {
                onCite(n)
                return .handled
            }
            if onLink(url) { return .handled }
            if url.scheme == "http" || url.scheme == "https" { AiExternal.open(url) }
            return .handled
        })
        .textSelection(.enabled)
    }

    @ViewBuilder
    private func block(_ b: MDBlock, look: AiLook) -> some View {
        let p = look.s("ai.answer.p")
        let body = WebTextStyle(size: p.fontSize, leading: p.lineHeight ?? 21.7, weight: 400, letterSpacing: p.letterSpacing)
        switch b.kind {
        case .paragraph:
            AiLineSnap(leading: body.leading) {
                paragraph(phone && width > 0 ? AiPrettyBreaks.source(b.source, style: body, width: width - p.padding.left - p.padding.right) : b.source, look: look, size: p.fontSize)
                    .webText(body)
            }
                .foregroundStyle(look.ink)
                .padding(.vertical, p.padding.top)
                .padding(.horizontal, p.padding.left)
                .fixedSize(horizontal: false, vertical: true)
        case .heading(let level):
            // The note's headings (fb-heading): Instrument Sans, semibold, larger for the first levels.
            let size: CGFloat = level <= 1 ? 22 : level == 2 ? 18 : 16
            Text(inline(b.source, look: look, size: size, weight: 600))
                .webText(WebTextStyle(size: size, leading: (size * 1.3).rounded(), weight: 600, letterSpacing: 0))
                .foregroundStyle(look.heading)
                .padding(.top, level <= 2 ? 10 : 6)
                .padding(.bottom, 3)
                .padding(.horizontal, p.padding.left)
                .fixedSize(horizontal: false, vertical: true)
        case .listItem(let marker, let level, let task):
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Group {
                    if let task {
                        WebIconView(task ? .squareCheck : .square, size: 14).foregroundStyle(look.muted)
                    } else if let marker, marker != "•" {
                        Text(marker).webText(body).foregroundStyle(look.muted)
                    } else {
                        Text("•").webText(body).foregroundStyle(look.ink)
                    }
                }
                .frame(minWidth: 14, alignment: .trailing)
                Text(inline(b.source, look: look, size: p.fontSize))
                    .webText(body)
                    .foregroundStyle(look.ink)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.leading, CGFloat(level) * 24 + 4)
            .padding(.vertical, 1)
        case .quote:
            Text(inline(b.source, look: look, size: p.fontSize))
                .webText(body)
                .foregroundStyle(look.muted)
                .padding(.leading, 14)
                .overlay(alignment: .leading) { Rectangle().fill(look.color("color-line")).frame(width: 3) }
                .padding(.vertical, 4)
                .fixedSize(horizontal: false, vertical: true)
        case .code(let language, _):
            AiCodeBlock(code: b.source, language: language)
                .padding(.vertical, 6)
        case .table(let header, let rows):
            ScrollView(.horizontal) {
                Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
                    GridRow {
                        ForEach(Array(header.enumerated()), id: \.offset) { _, h in cell(h, look: look, bold: true) }
                    }
                    ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                        GridRow { ForEach(Array(row.enumerated()), id: \.offset) { _, c in cell(c, look: look, bold: false) } }
                    }
                }
                .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(look.color("color-line")))
            }
            .padding(.vertical, 6)
        case .rule:
            Rectangle().fill(look.color("color-line")).frame(height: 1).padding(.vertical, 10)
        }
    }

    private func cell(_ s: String, look: AiLook, bold: Bool) -> some View {
        Text(inline(s, look: look, size: 13, weight: bold ? 600 : 400))
            .webText(WebTextStyle(size: 13, leading: 18, weight: bold ? 600 : 400, letterSpacing: 0))
            .foregroundStyle(look.ink)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .frame(minWidth: 80, alignment: .leading)
            .border(look.color("color-line").opacity(0.7), width: 0.5)
    }

    /// A paragraph with its citations drawn as the web's chips (AiMarkdown's `#cite-n` links): the text runs
    /// with the chips between them as images on the line.
    private func paragraph(_ source: String, look: AiLook, size: CGFloat) -> Text {
        let pattern = #/\[(\d{1,2})\](?!\()/#
        var out = Text("")
        var rest = source[...]
        while let m = rest.firstMatch(of: pattern) {
            let n = Int(m.output.1) ?? 0
            let before = String(rest[rest.startIndex..<m.range.lowerBound])
            if !before.isEmpty { out = out + Text(inline(before, look: look, size: size)) }
            if cited.contains(n) {
                out = out + Text(AiCiteChip.image(n, scheme: scheme, phone: phone)).baselineOffset(AiCiteChip.baselineOffset(size: size, phone: phone))
            } else {
                out = out + Text(inline("[\(n)]", look: look, size: size))
            }
            rest = rest[m.range.upperBound...]
        }
        if !rest.isEmpty { out = out + Text(inline(String(rest), look: look, size: size)) }
        return out
    }

    /// Bold, italic, code, links and citations, in the web's fonts.
    private func inline(_ source: String, look: AiLook, size: CGFloat, weight: CGFloat = 400) -> AttributedString {
        let marked = source.replacingOccurrences(of: #"\[(\d{1,2})\](?!\()"#, with: "[$1](folevi-cite://$1)", options: .regularExpression)
        var s = (try? AttributedString(markdown: marked, options: .init(allowsExtendedAttributes: false, interpretedSyntax: .inlineOnlyPreservingWhitespace, failurePolicy: .returnPartiallyParsedIfPossible))) ?? AttributedString(source)
        let cite = look.s("ai.answer.cite")
        for run in s.runs {
            let intent = run.inlinePresentationIntent ?? []
            let bold = intent.contains(.stronglyEmphasized)
            let italic = intent.contains(.emphasized)
            if let url = run.link, url.scheme == "folevi-cite" {
                let n = Int(url.host ?? "") ?? 0
                if cited.contains(n) {
                    // The web's cite chip: a small rounded number on the glass, beside the word.
                    s[run.range].font = WebFont.font(.sans, size: cite.fontSize + 1, weight: 600)
                    s[run.range].foregroundColor = look.muted
                    s[run.range].backgroundColor = look.glassHover
                    s[run.range].baselineOffset = 1.5
                    s[run.range].underlineStyle = nil
                } else {
                    s[run.range].link = nil
                    var plain = AttributedString("[\(n)]")
                    plain.font = WebFont.font(.sans, size: size, weight: weight)
                    s.replaceSubrange(run.range, with: plain)
                    continue
                }
            } else if run.link != nil {
                s[run.range].foregroundColor = look.ink
                s[run.range].underlineStyle = .single
                s[run.range].font = WebFont.font(.sans, size: size, weight: bold ? 700 : weight, italic: italic)
            } else if intent.contains(.code) {
                s[run.range].font = WebFont.font(.mono, size: size - 1)
                s[run.range].backgroundColor = look.glassHover
            } else {
                s[run.range].font = WebFont.font(.sans, size: size, weight: bold ? 700 : weight, italic: italic)
            }
        }
        // Thin spaces around a chip, as its margin.
        return s
    }
}

/// A code block with Copy (AiMarkdown.tsx CodeBlock).
struct AiCodeBlock: View {
    let code: String
    let language: String?
    @State private var copied = false
    @State private var over = false
    @Environment(\.colorScheme) private var scheme
    @Environment(\.aiPhone) private var phone

    var body: some View {
        let look = AiLook(scheme: scheme, phone: phone)
        ScrollView(.horizontal) {
            Text(code)
                .font(WebFont.font(.mono, size: 13))
                .foregroundStyle(look.ink)
                .lineSpacing(4)
                .textSelection(.enabled)
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 10).fill(look.glassHover))
        .overlay(alignment: .topTrailing) {
            Button {
                AiPasteboard.copy(code)
                copied = true
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { copied = false }
            } label: {
                HStack(spacing: 4) {
                    WebIconView(copied ? .check : .copy, size: 12)
                    if let language, !language.isEmpty, language != "plaintext" { Text(language).font(WebFont.font(.mono, size: 11)) }
                    Text(copied ? "Copied" : "Copy").webText(.role(.footnote)).lineLimit(1)
                }
                .padding(.horizontal, 8)
                .frame(height: 28)
                .foregroundStyle(look.muted)
                .background(RoundedRectangle(cornerRadius: 6).fill(look.glassActive))
            }
            .buttonStyle(.plain)
            .opacity(over || copied ? 1 : 0)
            .padding(6)
            .accessibilityLabel(copied ? "Copied" : "Copy code")
        }
        .onHover { over = $0 }
    }
}
/// The web's citation chip in an answer (`a.fb-link[href^="#cite"]`): a 12.84 pt pill on the glass with a hairline,
/// the number in 9.52 pt semibold, 1 pt either side; its bottom just under the baseline, as the web sets it.
@MainActor
enum AiCiteChip {
    #if os(macOS)
    private static var cache: [String: NSImage] = [:]
    #else
    private static var cache: [String: UIImage] = [:]
    #endif

    static func image(_ n: Int, scheme: ColorScheme, phone: Bool = false) -> Image {
        let key = "\(n)-\(scheme == .dark ? "d" : "l")-\(phone ? "p" : "w")"
        #if os(macOS)
        if let hit = cache[key] { return Image(nsImage: hit) }
        #else
        if let hit = cache[key] { return Image(uiImage: hit) }
        #endif
        let s = AiLook(scheme: scheme, phone: phone).s("ai.answer.cite")
        let label = "\(n)" as NSString
        #if os(macOS)
        let font = WebFont.nsFont(.sans, size: s.fontSize, weight: s.fontWeight)
        let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: NSColor(s.color.color)]
        #else
        let ct = WebTextStyle(size: s.fontSize, leading: s.height, weight: s.fontWeight).ctFont
        let font = UIFont(name: CTFontCopyPostScriptName(ct) as String, size: s.fontSize) ?? .systemFont(ofSize: s.fontSize)
        let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: UIColor(s.color.color)]
        #endif
        let textSize = label.size(withAttributes: attrs)
        let w = max(s.height, textSize.width + s.padding.left + s.padding.right)
        let margin = s.margin.left
        let size = CGSize(width: w + margin * 2, height: s.height)
        let radius = min(s.radius, s.height / 2)
        let ring = s.shadows.first { $0.inset && $0.color.a > 0 }
        #if os(macOS)
        let fill = NSColor(s.background.color)
        let img = NSImage(size: size, flipped: false) { _ in
            let r = NSRect(x: margin, y: 0, width: w, height: s.height)
            fill.setFill()
            NSBezierPath(roundedRect: r, xRadius: radius, yRadius: radius).fill()
            if let ring {
                let inner = NSBezierPath(roundedRect: r.insetBy(dx: 0.5, dy: 0.5), xRadius: radius - 0.5, yRadius: radius - 0.5)
                inner.lineWidth = 1
                NSColor(ring.color.color).setStroke()
                inner.stroke()
            }
            label.draw(at: NSPoint(x: margin + (w - textSize.width) / 2, y: (s.height - textSize.height) / 2), withAttributes: attrs)
            return true
        }
        cache[key] = img
        return Image(nsImage: img)
        #else
        let format = UIGraphicsImageRendererFormat.preferred()
        let img = UIGraphicsImageRenderer(size: size, format: format).image { _ in
            let r = CGRect(x: margin, y: 0, width: w, height: s.height)
            UIColor(s.background.color).setFill()
            UIBezierPath(roundedRect: r, cornerRadius: radius).fill()
            if let ring {
                let inner = UIBezierPath(roundedRect: r.insetBy(dx: 0.5, dy: 0.5), cornerRadius: radius - 0.5)
                inner.lineWidth = 1
                UIColor(ring.color.color).setStroke()
                inner.stroke()
            }
            label.draw(at: CGPoint(x: margin + (w - textSize.width) / 2, y: (s.height - textSize.height) / 2), withAttributes: attrs)
        }
        cache[key] = img
        return Image(uiImage: img)
        #endif
    }

    /// Where the chip sits against the baseline: its top at the web's offset into the line box.
    static func baselineOffset(size: CGFloat, phone: Bool = false) -> CGFloat {
        let p = AiLook(scheme: .light, phone: phone).pair("ai.answer.p").light
        let cite = AiLook(scheme: .light, phone: phone).pair("ai.answer.cite").light
        let font = WebTextStyle(size: size, leading: p.lineHeight ?? 21.7, weight: 400, letterSpacing: 0).ctFont
        let ascent = CTFontGetAscent(font), descent = CTFontGetDescent(font)
        let leading = p.lineHeight ?? 21.7
        let baseline = (leading - ascent - descent) / 2 + ascent
        // (Measured on whichever line the chip fell: its place within that line.)
        let top = (cite.y - (p.y + p.padding.top)).truncatingRemainder(dividingBy: leading)
        return baseline - (top + cite.height)
    }
}

/// Keeps a paragraph whole lines tall: a citation chip (an image in the text) makes AppKit's line a little taller
/// than the CSS line box, which would push everything under it down.
struct AiLineSnap: Layout {
    var leading: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        guard let v = subviews.first else { return .zero }
        let s = v.sizeThatFits(proposal)
        let lines = max(1, (s.height / leading).rounded(.down))
        return CGSize(width: s.width, height: lines * leading)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        subviews.first?.place(at: bounds.origin, proposal: ProposedViewSize(width: bounds.width, height: nil))
    }
}

/// An answer's paragraph broken where the iPhone's WebKit breaks it (`text-wrap: pretty`; two lines evened too):
/// the lines are worked out on its plain text (bold as bold, a citation as its number in brackets, about the chip's
/// width), then the breaks go back into the Markdown at the same characters.
enum AiPrettyBreaks {
    @MainActor private static var cache: [String: String] = [:]

    @MainActor
    static func source(_ source: String, style: WebTextStyle, width: CGFloat) -> String {
        let key = "\(Int(width * 4))|\(source)"
        if let hit = cache[key] { return hit }
        // The plain text in runs (bold toggled by `**`), and where each plain character sits in the source.
        var runs: [WebRun] = []
        var map: [String.Index] = []
        var bold = false
        var text = ""
        var i = source.startIndex
        while i < source.endIndex {
            if source[i...].hasPrefix("**") {
                if !text.isEmpty { runs.append(WebRun(text, weight: bold ? 700 : nil)) }
                text = ""
                bold.toggle()
                i = source.index(i, offsetBy: 2)
                continue
            }
            text.append(source[i])
            map.append(i)
            i = source.index(after: i)
        }
        if !text.isEmpty { runs.append(WebRun(text, weight: bold ? 700 : nil)) }
        let lines = WebLineBreaker.lines(runs, style: style, width: width, wrap: .prettyAllLastWeighted(0.3))
        guard lines.count > 1 else {
            cache[key] = source
            return source
        }
        var out = source
        var at = 0
        var cuts: [(String.Index, Bool)] = []
        for line in lines.dropLast() {
            let n = line.reduce(0) { $0 + $1.text.count }
            at += n
            guard at > 0, at <= map.count else { break }
            let last = map[at - 1]
            // A line that ends on a space: the space becomes the break; after a hyphen, the break goes in after it.
            let next = source.index(after: last)
            if source[last] == " " {
                cuts.append((last, true))
            } else if next < source.endIndex, source[next] == " " {
                // (The line ended before its space: the space becomes the break.)
                cuts.append((next, true))
            } else {
                cuts.append((next, false))
            }
        }
        for (idx, replace) in cuts.reversed() {
            if replace { out.replaceSubrange(idx...idx, with: "\n") } else { out.insert("\n", at: idx) }
        }
        cache[key] = out
        return out
    }
}
