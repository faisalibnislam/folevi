// Draws `MDBlock`s in Folevi's type (web AiMarkdown.tsx): Instrument Sans body at 17/24 (iPhone) or 16, Spectral
// headings, JetBrains Mono code in a sunken box that scrolls sideways, tables in a grid that scrolls sideways,
// citations as small numbered markers that open the note. Each block view is Equatable on its block, so a
// streaming answer redraws only the block still growing.
import SwiftUI
import FoleviDesign

/// Inline Markdown (bold, italic, code, links, citations) as an AttributedString, cached by source.
enum InlineMarkdown {
    nonisolated(unsafe) private static let cache: NSCache<NSString, Box> = {
        let c = NSCache<NSString, Box>()
        c.countLimit = 2000
        return c
    }()
    final class Box { let value: AttributedString; init(_ v: AttributedString) { value = v } }

    static func render(_ source: String) -> AttributedString {
        if let hit = cache.object(forKey: source as NSString) { return hit.value }
        let value = make(source)
        cache.setObject(Box(value), forKey: source as NSString)
        return value
    }

    /// How many blocks were turned into attributed text (cache misses): the performance test's measure of
    /// "only the growing block is redone".
    nonisolated(unsafe) static var makes = 0

    /// "[3]" becomes a link to `folevi-cite://3`, drawn as a small raised number.
    static func make(_ source: String) -> AttributedString {
        makes += 1
        let marked = source.replacingOccurrences(of: #"\[(\d{1,3})\](?!\()"#, with: "[$1](folevi-cite://$1)", options: .regularExpression)
        var s = (try? AttributedString(markdown: marked, options: .init(allowsExtendedAttributes: false, interpretedSyntax: .inlineOnlyPreservingWhitespace, failurePolicy: .returnPartiallyParsedIfPossible))) ?? AttributedString(source)
        for run in s.runs {
            if let url = run.link, url.scheme == "folevi-cite" {
                s[run.range].font = FoleviFonts.font(.ui, size: 11, weight: .semibold)
                s[run.range].baselineOffset = 5
                s[run.range].foregroundColor = Folevi.color.accentStrong
                s[run.range].underlineStyle = nil
            } else if run.link != nil {
                s[run.range].foregroundColor = Folevi.color.accentStrong
                s[run.range].underlineStyle = .single
            }
            if let intent = run.inlinePresentationIntent, intent.contains(.code) {
                s[run.range].font = FoleviFonts.font(.mono, size: 14.5, weight: .regular)
                s[run.range].backgroundColor = Folevi.color.surfaceSunken
            }
        }
        return s
    }
}

/// Answer type sizes: iPhone reads at 17/24 (Craft's way), the larger screens at 16.
struct AnswerMetrics {
    var bodySize: CGFloat
    var lineSpacing: CGFloat
    static func current(_ compact: Bool) -> AnswerMetrics { compact ? AnswerMetrics(bodySize: 17, lineSpacing: 5) : AnswerMetrics(bodySize: 16, lineSpacing: 5) }
}

struct MDBlockView: View, Equatable {
    let block: MDBlock
    let metrics: AnswerMetrics

    nonisolated static func == (a: MDBlockView, b: MDBlockView) -> Bool { a.block == b.block && a.metrics.bodySize == b.metrics.bodySize }

    var body: some View {
        switch block.kind {
        case .paragraph:
            inline(block.source)
        case .heading(let level):
            Text(InlineMarkdown.render(block.source))
                .font(FoleviFonts.font(.display, size: level <= 1 ? 24 : level == 2 ? 21 : 18.5, weight: .semibold, relativeTo: level <= 2 ? .title2 : .title3))
                .foregroundStyle(Folevi.color.heading)
                .padding(.top, level <= 2 ? 10 : 6)
                .accessibilityAddTraits(.isHeader)
                .frame(maxWidth: .infinity, alignment: .leading)
        case .listItem(let marker, let level, let task):
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Group {
                    if let task {
                        Image(systemName: task ? "checkmark.square.fill" : "square")
                            .font(.system(size: metrics.bodySize - 2))
                            .foregroundStyle(task ? Folevi.color.accentStrong : Folevi.color.inkMuted)
                            .accessibilityLabel(task ? "Done" : "Not done")
                    } else {
                        Text(marker ?? "•")
                            .font(FoleviFonts.font(.ui, size: metrics.bodySize, weight: marker == "•" ? .bold : .medium, relativeTo: .body))
                            .foregroundStyle(Folevi.color.inkMuted)
                            .monospacedDigit()
                    }
                }
                .frame(minWidth: marker == "•" || task != nil ? 12 : 22, alignment: .trailing)
                inline(block.source)
            }
            .padding(.leading, CGFloat(level) * 20)
        case .quote:
            HStack(spacing: 12) {
                RoundedRectangle(cornerRadius: 1.5).fill(Folevi.color.lineStrong).frame(width: 3)
                inline(block.source).foregroundStyle(Folevi.color.inkMuted)
            }
            .fixedSize(horizontal: false, vertical: true)
        case .code(let language, _):
            CodeBlockView(code: block.source, language: language)
        case .table(let header, let rows):
            TableBlockView(header: header, rows: rows, metrics: metrics)
        case .rule:
            Rectangle().fill(Folevi.color.line).frame(height: 1).padding(.vertical, 6)
        }
    }

    func inline(_ source: String) -> some View {
        Text(InlineMarkdown.render(source))
            .font(FoleviFonts.font(.ui, size: metrics.bodySize, weight: .regular, relativeTo: .body))
            .lineSpacing(metrics.lineSpacing)
            .foregroundStyle(Folevi.color.ink)
            .frame(maxWidth: .infinity, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
    }
}

struct CodeBlockView: View {
    let code: String
    let language: String?
    @Environment(\.screenFeedback) private var feedback

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(language ?? "Code").foleviFont(.caption).foregroundStyle(Folevi.color.inkFaint)
                Spacer()
                Button {
                    feedback.copy(code)
                    feedback.toast(ScreenToast("Code copied.", tone: .success))
                } label: {
                    Label("Copy", systemImage: "doc.on.doc").labelStyle(.iconOnly).font(.system(size: 13, weight: .medium))
                        .frame(width: 32, height: 28).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(Folevi.color.inkMuted)
                .accessibilityLabel("Copy code")
            }
            .padding(.leading, 12).padding(.trailing, 4).padding(.top, 4)
            ScrollView(.horizontal, showsIndicators: false) {
                Text(code)
                    .font(FoleviFonts.font(.mono, size: 13.5, weight: .regular, relativeTo: .callout))
                    .foregroundStyle(Folevi.color.ink)
                    .lineSpacing(3)
                    .fixedSize(horizontal: true, vertical: true)
                    .padding(.horizontal, 12).padding(.bottom, 12).padding(.top, 2)
                    .textSelection(.enabled)
            }
        }
        .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.control, style: .continuous).fill(Folevi.color.surfaceSunken))
        .padding(.vertical, 2)
    }
}

struct TableBlockView: View {
    let header: [String]
    let rows: [[String]]
    let metrics: AnswerMetrics

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
                GridRow {
                    ForEach(header.indices, id: \.self) { i in cell(header[i], head: true) }
                }
                .background(Folevi.color.surfaceSunken)
                ForEach(rows.indices, id: \.self) { r in
                    Divider().overlay(Folevi.color.line)
                    GridRow {
                        ForEach(rows[r].indices, id: \.self) { i in cell(rows[r][i], head: false) }
                    }
                }
            }
            .overlay(RoundedRectangle(cornerRadius: FoleviTokens.Radius.small, style: .continuous).stroke(Folevi.color.line, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: FoleviTokens.Radius.small, style: .continuous))
        }
        .padding(.vertical, 2)
    }

    func cell(_ s: String, head: Bool) -> some View {
        Text(InlineMarkdown.render(s))
            .font(FoleviFonts.font(.ui, size: metrics.bodySize - 2, weight: head ? .semibold : .regular, relativeTo: .callout))
            .foregroundStyle(head ? Folevi.color.heading : Folevi.color.ink)
            .frame(minWidth: 72, maxWidth: 260, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 10).padding(.vertical, 7)
    }
}
