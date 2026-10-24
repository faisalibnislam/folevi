// Home's "Your week" card (web ai/CatchUp.tsx): while Foli AI reads the week, shimmering lines; then the brief
// (Markdown), the notes it cites as numbered chips that open them, and Refresh and Close.
import SwiftUI
import FoleviDesign
import FoleviEngine

public struct CatchUpCardView: View {
    public enum Phase: Equatable { case running, ready(CatchUpBrief) }
    let phase: Phase
    let onRefresh: () -> Void
    let onClose: () -> Void
    let onSource: (String) -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shimmer = false

    public init(phase: Phase, onRefresh: @escaping () -> Void, onClose: @escaping () -> Void, onSource: @escaping (String) -> Void) {
        self.phase = phase
        self.onRefresh = onRefresh
        self.onClose = onClose
        self.onSource = onSource
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                FoliSpark(size: 15)
                Text("Your week").foleviFont(.title3).foregroundStyle(Folevi.color.heading).accessibilityAddTraits(.isHeader)
                Spacer()
                if case .ready = phase {
                    IconButton("arrow.counterclockwise", label: "Refresh brief", action: onRefresh)
                    IconButton("xmark", label: "Close brief", action: onClose)
                }
            }
            switch phase {
            case .running:
                VStack(alignment: .leading, spacing: 9) {
                    Text("Reading this week’s notes…").foleviFont(.footnote).foregroundStyle(Folevi.color.inkMuted)
                    ForEach([0.9, 0.75, 0.82, 0.6], id: \.self) { w in
                        GeometryReader { proxy in
                            RoundedRectangle(cornerRadius: FoleviTokens.Radius.chip, style: .continuous)
                                .fill(LinearGradient(colors: [RGBA(139, 124, 246, 0.22).color, RGBA(245, 138, 184, 0.18).color], startPoint: .leading, endPoint: .trailing))
                                .frame(width: proxy.size.width * w)
                                .opacity(shimmer ? 0.5 : 1)
                        }
                        .frame(height: 12)
                    }
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Reading this week’s notes")
                .onAppear {
                    guard !reduceMotion else { return }
                    withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) { shimmer = true }
                }
            case .ready(let brief):
                Text(Self.markdown(brief.text))
                    .foleviFont(.callout)
                    .foregroundStyle(Folevi.color.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
                if !brief.sources.isEmpty {
                    FlowLayout(spacing: 6) {
                        ForEach(Array(brief.sources.enumerated()), id: \.element.id) { i, source in
                            Button { onSource(source.id) } label: {
                                HStack(spacing: 5) {
                                    Text("\(i + 1)").fontWeight(.semibold).foregroundStyle(Folevi.color.inkMuted)
                                    Image(systemName: "doc.text").font(.system(size: 10)).foregroundStyle(Folevi.color.inkMuted)
                                    Text(source.title.isEmpty ? "Untitled" : source.title).lineLimit(1)
                                }
                                .foleviFont(.caption)
                                .foregroundStyle(Folevi.color.ink)
                                .padding(.horizontal, 9)
                                .frame(minHeight: 26)
                                .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.chip, style: .continuous).fill(Folevi.color.accentSoft))
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Source \(i + 1), \(source.title.isEmpty ? "Untitled" : source.title)")
                        }
                    }
                }
            }
        }
        .padding(18)
        .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.container, style: .continuous).fill(Folevi.color.surfaceRaised))
        .foleviShadow(.card, radius: FoleviTokens.Radius.container)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("catch-up-card")
    }

    /// Inline Markdown (bold, italics, links) with list lines drawn as bullets and headings as plain lines.
    static func markdown(_ text: String) -> AttributedString {
        let lines = text.split(separator: "\n", omittingEmptySubsequences: false).map { line -> String in
            let trimmed = line.drop { $0 == " " }
            if trimmed.hasPrefix("- ") || trimmed.hasPrefix("* ") { return "• " + trimmed.dropFirst(2) }
            if trimmed.hasPrefix("#") { return String(trimmed.drop { $0 == "#" }.drop { $0 == " " }) }
            return String(line)
        }
        let joined = lines.joined(separator: "\n")
        return (try? AttributedString(markdown: joined, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(joined)
    }
}

/// Lays chips out in lines, wrapping to the next when one doesn't fit.
struct FlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, line: CGFloat = 0, widest: CGFloat = 0
        for s in subviews {
            let size = s.sizeThatFits(ProposedViewSize(width: maxWidth, height: nil))
            if x > 0 && x + size.width > maxWidth {
                y += line + spacing
                x = 0
                line = 0
            }
            x += min(size.width, maxWidth) + spacing
            line = max(line, size.height)
            widest = max(widest, x - spacing)
        }
        return CGSize(width: proposal.width ?? widest, height: y + line)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, line: CGFloat = 0
        for s in subviews {
            let size = s.sizeThatFits(ProposedViewSize(width: bounds.width, height: nil))
            if x > bounds.minX && x + size.width > bounds.maxX {
                y += line + spacing
                x = bounds.minX
                line = 0
            }
            s.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(width: min(size.width, bounds.width), height: size.height))
            x += min(size.width, bounds.width) + spacing
            line = max(line, size.height)
        }
    }
}
