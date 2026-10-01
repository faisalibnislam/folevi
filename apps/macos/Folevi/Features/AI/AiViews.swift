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

/// Renders the AI's Markdown answers: "## " headings, "- " bullets and "- [ ]" to-dos, paragraphs, and
/// inline Markdown (bold, italic, code, links). Citations [n] stay as written.
struct AiMarkdownView: View {
    var markdown: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                switch block {
                case .heading(let t):
                    inline(t).font(.ui(14, .semibold)).foregroundStyle(FoleviColor.heading).padding(.top, 4)
                case .bullet(let t):
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text("•").foregroundStyle(FoleviColor.inkMuted)
                        inline(t)
                    }
                case .paragraph(let t):
                    inline(t)
                }
            }
        }
        .font(.ui(13.5))
        .foregroundStyle(FoleviColor.ink)
        .textSelection(.enabled)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private enum Block { case heading(String), bullet(String), paragraph(String) }

    private var blocks: [Block] {
        var out: [Block] = []
        var para: [String] = []
        func flush() {
            if !para.isEmpty { out.append(.paragraph(para.joined(separator: " "))); para = [] }
        }
        for raw in markdown.components(separatedBy: "\n") {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.isEmpty { flush(); continue }
            if let r = line.range(of: #"^#{1,6}\s+"#, options: .regularExpression) {
                flush(); out.append(.heading(String(line[r.upperBound...])))
            } else if let r = line.range(of: #"^([-*•]|\d+\.)\s+(\[[ xX]\]\s+)?"#, options: .regularExpression) {
                flush(); out.append(.bullet(String(line[r.upperBound...])))
            } else {
                para.append(line)
            }
        }
        flush()
        return out
    }

    private func inline(_ text: String) -> Text {
        if let attributed = try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)) {
            return Text(attributed)
        }
        return Text(text)
    }
}

/// The floating "AI Assistant" launcher (bottom right; hidden on note pages, as on the web).
struct AiLauncher: View {
    @Binding var isOpen: Bool

    var body: some View {
        Button {
            isOpen.toggle()
        } label: {
            HStack(spacing: 9) {
                AiIcon(size: 15)
                Text("AI Assistant").font(.ui(14.5, .medium))
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 18)
            .frame(height: 46)
            .background(Color.black, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .shadow(color: .black.opacity(0.1), radius: 12, y: 6)
            .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(.plain)
        .help(Text("Ask about your notes"))
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
