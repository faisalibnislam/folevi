// An answer's Markdown as the web draws it (AiMarkdown.tsx: the note's own read-only blocks, `.fb-ai-answer`,
// 14 pt at 1.55 with no letter spacing, paragraphs 3 pt above and below), from FoleviScreens' MDBlocks (parsed
// as the answer streams, only the growing block redone). Citations ("[2]") are small numbered chips that open
// the cited note; app links stay in the app, other links open in the browser.
#if os(macOS) || os(iOS)
#if os(macOS)
import AppKit
#else
import UIKit
#endif
import SwiftUI
import FoleviDesign
import FoleviEngine
import FoleviScreens

struct AiAnswerText: View {
    let blocks: [MDBlock]
    /// The citation numbers this answer has (others stay as typed).
    var cited: Set<Int> = []
    var onCite: (Int) -> Void = { _ in }
    var onLink: (URL) -> Bool = { _ in false }
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let look = AiLook(scheme: scheme)
        VStack(alignment: .leading, spacing: 0) {
            ForEach(blocks) { b in
                block(b, look: look)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .environment(\.openURL, OpenURLAction { url in
            if url.scheme == "folevi-cite", let n = Int(url.host ?? "") {
                onCite(n)
                return .handled
            }
            if onLink(url) { return .handled }
            if url.scheme == "http" || url.scheme == "https" { NSWorkspace.shared.open(url) }
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
                paragraph(b.source, look: look, size: p.fontSize)
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
                out = out + Text(Image(platformImage: AiCiteChip.image(n, scheme: scheme))).baselineOffset(AiCiteChip.baselineOffset(size: size))
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

    var body: some View {
        let look = AiLook(scheme: scheme)
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
#endif

#if os(macOS) || os(iOS)
/// The web's citation chip in an answer (`a.fb-link[href^="#cite"]`): a 12.84 pt pill on the glass with a hairline,
/// the number in 9.52 pt semibold, 1 pt either side; its bottom just under the baseline, as the web sets it.
@MainActor
enum AiCiteChip {
    private static var cache: [String: NSImage] = [:]

    static func image(_ n: Int, scheme: ColorScheme) -> NSImage {
        let key = "\(n)-\(scheme == .dark ? "d" : "l")"
        if let hit = cache[key] { return hit }
        let s = WebStyles.named("ai.answer.cite").resolve(scheme)
        let label = "\(n)" as NSString
        #if os(macOS)
        let font = WebFont.nsFont(.sans, size: s.fontSize, weight: s.fontWeight)
        #else
        let font = WebTextStyle(size: s.fontSize, leading: s.fontSize, weight: s.fontWeight, letterSpacing: 0).ctFont as UIFont
        #endif
        let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: NSColor(s.color.color)]
        let textSize = label.size(withAttributes: attrs)
        let w = max(s.height, textSize.width + s.padding.left + s.padding.right)
        let margin = s.margin.left
        let size = NSSize(width: w + margin * 2, height: s.height)
        let fill = NSColor(s.background.color)
        let ring = s.shadows.first { $0.inset && $0.color.a > 0 }.map { NSColor($0.color.color) }
        #if os(macOS)
        let img = NSImage(size: size, flipped: false) { _ in
            let r = NSRect(x: margin, y: 0, width: w, height: s.height)
            let path = NSBezierPath(roundedRect: r, xRadius: min(s.radius, s.height / 2), yRadius: min(s.radius, s.height / 2))
            fill.setFill()
            path.fill()
            if let ring {
                let inner = NSBezierPath(roundedRect: r.insetBy(dx: 0.5, dy: 0.5), xRadius: min(s.radius, s.height / 2) - 0.5, yRadius: min(s.radius, s.height / 2) - 0.5)
                inner.lineWidth = 1
                ring.setStroke()
                inner.stroke()
            }
            label.draw(at: NSPoint(x: margin + (w - textSize.width) / 2, y: (s.height - textSize.height) / 2), withAttributes: attrs)
            return true
        }
        #else
        let img = UIGraphicsImageRenderer(size: size).image { _ in
            let r = CGRect(x: margin, y: 0, width: w, height: s.height)
            let path = UIBezierPath(roundedRect: r, cornerRadius: min(s.radius, s.height / 2))
            fill.setFill()
            path.fill()
            if let ring {
                let inner = UIBezierPath(roundedRect: r.insetBy(dx: 0.5, dy: 0.5), cornerRadius: min(s.radius, s.height / 2) - 0.5)
                inner.lineWidth = 1
                ring.setStroke()
                inner.stroke()
            }
            label.draw(at: CGPoint(x: margin + (w - textSize.width) / 2, y: (s.height - textSize.height) / 2), withAttributes: attrs)
        }
        #endif
        cache[key] = img
        return img
    }

    /// Where the chip sits against the baseline: its top at the web's offset into the line box.
    static func baselineOffset(size: CGFloat) -> CGFloat {
        let p = WebStyles.named("ai.answer.p").light
        let cite = WebStyles.named("ai.answer.cite").light
        let font = WebTextStyle(size: size, leading: p.lineHeight ?? 21.7, weight: 400, letterSpacing: 0).ctFont
        let ascent = CTFontGetAscent(font), descent = CTFontGetDescent(font)
        let leading = p.lineHeight ?? 21.7
        let baseline = (leading - ascent - descent) / 2 + ascent
        let top = cite.y - (p.y + p.padding.top)
        return baseline - (top + cite.height)
    }
}
#endif

#if os(macOS) || os(iOS)
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
#endif
