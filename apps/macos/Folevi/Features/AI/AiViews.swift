import SwiftUI

/// Folevi's AI mark: eight petals in the brand's violet-to-coral gradient, the same image the web
/// draws (FoleviAI, rendered from packages/design-tokens/brand/source/ai-icon.svg by brand-icons.mjs).
/// It keeps its own colours, so a foreground style on it has no effect.
struct AiIcon: View {
    var size: CGFloat = 16

    var body: some View {
        Image("FoleviAI")
            .resizable()
            .interpolation(.high)
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

/// Renders an AI answer (Markdown) with the same typography as notes (the web's AiMarkdown): headings,
/// bulleted and numbered lists, to-dos, quotes, callouts, code and dividers, with bold, italic, code and
/// links inline. `streaming` adds the soft caret after the last word (the web's StreamingText).
struct AiMarkdownView: View {
    var markdown: String
    var streaming = false

    /// The note's body size (the web's editor font, 16px) and line height (1.65).
    nonisolated private static let bodySize: CGFloat = 16
    nonisolated private static let indent: CGFloat = 16 * 1.6

    var body: some View {
        let items = AiMarkdownLayout.items(markdown)
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(items.enumerated()), id: \.offset) { i, item in
                row(item, last: streaming && i == items.count - 1)
            }
            if streaming && items.isEmpty { caret }
        }
        .foregroundStyle(FoleviColor.ink)
        .textSelection(.enabled)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var caret: Text {
        Text("\u{258D}").font(.ui(Self.bodySize)).foregroundStyle(Color(red: 0.486, green: 0.424, blue: 0.941).opacity(0.7))
    }

    private func line(_ item: AiMarkdownItem, size: CGFloat, weight: Font.Weight = .regular, last: Bool) -> Text {
        let t = Text(Self.attributed(item.text, size: size, weight: weight))
        return last ? t + caret : t
    }

    @ViewBuilder private func row(_ item: AiMarkdownItem, last: Bool) -> some View {
        let lead = CGFloat(item.depth) * Self.indent
        switch item.kind {
        case .heading(let level):
            let size = Self.bodySize * (level == 1 ? 1.8 : level == 2 ? 1.42 : 1.16)
            line(item, size: size, weight: .semibold, last: last)
                .foregroundStyle(FoleviColor.heading)
                .tracking(-0.02 * size)
                .lineSpacing(size * 0.22 - 4)
                .padding(.top, size * (level == 1 ? 0.6 : level == 2 ? 0.5 : 0.4))
                .padding(.leading, lead)
                .accessibilityAddTraits(.isHeader)
        case .paragraph:
            line(item, size: Self.bodySize, last: last).lineSpacing(Self.bodySize * 0.65 - 4).padding(.leading, lead)
        case .bullet, .numbered, .todo:
            HStack(alignment: .firstTextBaseline, spacing: 0) {
                marker(item).frame(width: Self.indent, alignment: .center)
                line(item, size: Self.bodySize, last: last)
                    .lineSpacing(Self.bodySize * 0.65 - 4)
                    .strikethrough(item.kind == .todo(checked: true))
                    .foregroundStyle(item.kind == .todo(checked: true) ? FoleviColor.inkMuted : FoleviColor.ink)
            }
            .padding(.leading, lead)
        case .quote:
            line(item, size: Self.bodySize, last: last)
                .italic()
                .lineSpacing(Self.bodySize * 0.65 - 4)
                .foregroundStyle(FoleviColor.ink.mix(with: FoleviColor.inkMuted, by: 0.15))
                .padding(.leading, 14)
                .overlay(alignment: .leading) { Capsule().fill(FoleviColor.heading.opacity(0.85)).frame(width: 3) }
                .padding(.leading, lead)
        case .callout:
            line(item, size: Self.bodySize, last: last)
                .lineSpacing(Self.bodySize * 0.65 - 4)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(FoleviGlass.hover, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .padding(.leading, lead)
        case .code(let code):
            (Text(code).font(.mono(13.5)).foregroundStyle(FoleviColor.codeInk) + (last ? caret : Text("")))
                .lineSpacing(13.5 * 0.6 - 4)
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(FoleviColor.codeBg, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .padding(.leading, lead)
        case .divider:
            FoleviColor.line.frame(height: 1).padding(.vertical, 8).padding(.leading, lead)
        }
    }

    @ViewBuilder private func marker(_ item: AiMarkdownItem) -> some View {
        let ink = FoleviColor.heading.opacity(0.85)
        let size = Self.bodySize * 0.36
        switch item.kind {
        case .numbered(let n):
            Text("\(n).").font(.ui(Self.bodySize, .medium)).foregroundStyle(FoleviColor.inkMuted).monospacedDigit()
        case .todo(let checked):
            Image(systemName: checked ? "checkmark.square.fill" : "square")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(checked ? FoleviColor.heading : FoleviColor.inkMuted)
                .accessibilityLabel(Text(checked ? "Done" : "To-do"))
        default:
            Group {
                switch item.depth % 3 {
                case 1: Circle().strokeBorder(ink, lineWidth: 1.5)
                case 2: RoundedRectangle(cornerRadius: 1).fill(ink)
                default: Circle().fill(ink)
                }
            }
            .frame(width: size, height: size)
            .alignmentGuide(.firstTextBaseline) { d in d[.bottom] + Self.bodySize * 0.12 }
        }
    }

    /// A block's inline text with its marks (bold, italic, underline, strike, code, links) and @mentions.
    static func attributed(_ nodes: [InlineNode], size: CGFloat, weight: Font.Weight) -> AttributedString {
        var out = AttributedString()
        for node in nodes {
            switch node {
            case .text(let text, let marks):
                var s = AttributedString(text)
                let m = marks ?? []
                let bold = m.contains(.bold)
                let italic = m.contains(.italic)
                var font: Font = m.contains(.code) ? .mono(size * 0.9) : .ui(size, bold ? .semibold : weight)
                if italic { font = font.italic() }
                s.font = font
                if m.contains(.underline) { s.underlineStyle = .single }
                if m.contains(.strike) { s.strikethroughStyle = .single }
                if m.contains(.code) {
                    s.backgroundColor = FoleviColor.codeBg
                    s.foregroundColor = FoleviColor.codeInk
                }
                for mark in m {
                    if case .link(let href) = mark, let url = URL(string: href) {
                        s.link = url
                        s.underlineStyle = .single
                    }
                }
                out += s
            case .mention(_, let label):
                var s = AttributedString("@" + label)
                s.font = .ui(size, .medium)
                s.foregroundColor = FoleviColor.heading
                out += s
            case .pageLink(_, let label):
                var s = AttributedString(label)
                s.font = .ui(size, weight)
                s.underlineStyle = .single
                out += s
            case .date(let date):
                var s = AttributedString(date)
                s.font = .ui(size, weight)
                out += s
            }
        }
        return out
    }
}

/// The floating "AI Assistant" launcher (bottom right; hidden on note pages, as on the web).
struct AiLauncher: View {
    @Binding var isOpen: Bool
    @State private var hovering = false

    var body: some View {
        Button {
            isOpen.toggle()
        } label: {
            HStack(spacing: 10) {
                if isOpen {
                    Image(systemName: "xmark").font(.system(size: 15, weight: .medium)).frame(width: 18, height: 18)
                } else {
                    AiIcon(size: 17)
                }
                Text("AI Assistant").font(.ui(15, .medium))
            }
            .foregroundStyle(.white)
            .padding(.leading, 16)
            .padding(.trailing, 20)
            .frame(height: 48)
            .background(hovering ? Color(red: 0.11, green: 0.11, blue: 0.122) : Color.black, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Color.white.opacity(0.12)))
            .shadow(color: .black.opacity(0.1), radius: 12, y: 8)
            .shadow(color: .black.opacity(0.1), radius: 3, y: 2)
            .offset(y: hovering ? -2 : 0)
            .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .animation(.easeOut(duration: 0.2), value: hovering)
        .help(Text(isOpen ? "Close AI Assistant" : "AI Assistant (⌘J)"))
        .accessibilityLabel(Text(isOpen ? "Close AI Assistant" : "AI Assistant"))
        .accessibilityIdentifier("ai.launcher")
    }
}

// Ask AI and Catch me up: AskAiPanel.swift.

/// Lays out children left to right, wrapping onto new lines.
struct FlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, maxX: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > 0 && x + size.width > width { x = 0; y += rowHeight + spacing; rowHeight = 0 }
            x += size.width + spacing
            maxX = max(maxX, x - spacing)
            rowHeight = max(rowHeight, size.height)
        }
        return CGSize(width: min(maxX, width), height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowHeight: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > bounds.minX && x + size.width > bounds.maxX { x = bounds.minX; y += rowHeight + spacing; rowHeight = 0 }
            view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}
