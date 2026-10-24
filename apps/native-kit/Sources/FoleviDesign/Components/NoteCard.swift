// The note card (docs/DESIGN_SYSTEM.md "Note cards", web views/DocumentCard.tsx NoteCardFace): a portrait
// notebook (25:27), nearly square at the spine and rounded on the open edge, a grey page block peeking past
// the right edge and the bottom, a soft shadow falling down and a little left. A spine (6% of the width)
// carries the note's style; the cover uses the note's own page and text colours: serif title (2 lines,
// wrapping between words), created age, the opening blocks drawn natively from the preview lines, and a footer
// with the last edit and the folder chip (or "Draft"). Starred notes get a corner tab. Everything scales with
// the card's width, so the card reads as one drawing at any size.
import SwiftUI

/// One line of a note's preview (the bridge's `PreviewLine`: block type, text, level, checked, table rows).
public struct CardPreviewLine: Hashable, Sendable {
    public enum Kind: String, Sendable {
        case paragraph, heading, bulleted, numbered, todo, quote, code, table, other
    }
    public var kind: Kind
    public var text: String
    public var level: Int?
    public var checked: Bool?
    public var rows: [[String]]?

    public init(kind: Kind, text: String, level: Int? = nil, checked: Bool? = nil, rows: [[String]]? = nil) {
        self.kind = kind
        self.text = text
        self.level = level
        self.checked = checked
        self.rows = rows
    }

    /// From the web's block type names ("heading", "bulleted", "todo", "table", ...).
    public init(type: String, text: String, level: Int? = nil, checked: Bool? = nil, rows: [[String]]? = nil) {
        self.init(kind: Kind(rawValue: type) ?? (type.hasPrefix("heading") ? .heading : type == "paragraph" || type == "text" ? .paragraph : .other), text: text, level: level, checked: checked, rows: rows)
    }
}

public struct NoteCardModel: Hashable, Sendable, Identifiable {
    public var id: String
    public var title: String
    public var excerpt: String
    public var preview: [CardPreviewLine]
    public var cover: NoteCover
    public var fontType: NoteFontType
    /// "10 hours ago", "Sep 10" (the web's `ageText`, see `AgeText`).
    public var createdText: String
    /// The footer time: "1 hour ago", "Deleted 2 days ago".
    public var timeText: String
    public var starred: Bool
    /// The folder chip's name and colour; no name shows "Draft".
    public var folderName: String?
    public var folderColorId: String?
    public var showsFolder: Bool
    /// An explicit document colour (the note's Style > Document color); nil = Auto (from the theme, else surface).
    public var paper: ColorPair?
    public var ink: ColorPair?

    public init(id: String, title: String, excerpt: String = "", preview: [CardPreviewLine] = [], cover: NoteCover = .plain, fontType: NoteFontType = .system, createdText: String, timeText: String, starred: Bool = false, folderName: String? = nil, folderColorId: String? = nil, showsFolder: Bool = true, paper: ColorPair? = nil, ink: ColorPair? = nil) {
        self.id = id
        self.title = title
        self.excerpt = excerpt
        self.preview = preview
        self.cover = cover
        self.fontType = fontType
        self.createdText = createdText
        self.timeText = timeText
        self.starred = starred
        self.folderName = folderName
        self.folderColorId = folderColorId
        self.showsFolder = showsFolder
        self.paper = paper
        self.ink = ink
    }

    public static func == (a: NoteCardModel, b: NoteCardModel) -> Bool {
        a.id == b.id && a.title == b.title && a.excerpt == b.excerpt && a.preview == b.preview && a.cover == b.cover && a.fontType == b.fontType
            && a.createdText == b.createdText && a.timeText == b.timeText && a.starred == b.starred && a.folderName == b.folderName
            && a.folderColorId == b.folderColorId && a.showsFolder == b.showsFolder && a.paper == b.paper && a.ink == b.ink
    }

    public func hash(into h: inout Hasher) { h.combine(id) }

    /// What VoiceOver reads: title, place, edited time, the first line of the preview (plan section 7).
    public var accessibilityText: String {
        var parts = [title.isEmpty ? "Untitled" : title]
        if showsFolder { parts.append(folderName.map { "in \($0)" } ?? "Draft") }
        parts.append("edited \(timeText)")
        if let first = NoteCardView.previewText(preview, excerpt: excerpt).split(separator: "\n").first { parts.append(String(first)) }
        if starred { parts.append("starred") }
        return parts.joined(separator: ", ")
    }
}

public struct NoteCardView: View {
    public static let aspectRatio: CGFloat = 25.0 / 27.0
    @Environment(\.colorScheme) private var scheme
    let model: NoteCardModel

    public init(_ model: NoteCardModel) { self.model = model }

    public var body: some View {
        GeometryReader { proxy in
            let w = proxy.size.width
            let cq = w / 100
            face(cq: cq, width: w, height: proxy.size.height)
        }
        .aspectRatio(Self.aspectRatio, contentMode: .fit)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(model.accessibilityText)
        .accessibilityAddTraits(.isButton)
    }

    private var colors: (paper: RGBA, ink: RGBA) {
        if let paper = model.paper?.resolve(scheme), let ink = model.ink?.resolve(scheme) { return (paper, ink) }
        if let theme = model.cover.theme { return (theme.paper(scheme), theme.ink(scheme)) }
        return (FoleviTokens.Chrome.surface.resolve(scheme), FoleviTokens.Chrome.heading.resolve(scheme))
    }

    private func face(cq: CGFloat, width: CGFloat, height: CGFloat) -> some View {
        let (paper, ink) = colors
        let faint = ink.mix(paper, 0.62)
        let muted = ink.mix(paper, 0.74)
        let canvas = FoleviTokens.Chrome.canvas.resolve(scheme)
        let heading = FoleviTokens.Chrome.heading.resolve(scheme)
        let chip = FoleviTokens.Chrome.line.resolve(scheme).opacity(0.75)
        let shape = UnevenRoundedRectangle(topLeadingRadius: 4, bottomLeadingRadius: 4, bottomTrailingRadius: FoleviTokens.Radius.panel, topTrailingRadius: FoleviTokens.Radius.panel, style: .continuous)
        let faceWidth = width * 0.94 - cq - 13 * cq
        return ZStack(alignment: .topLeading) {
            // The page block, peeking out past the cover's open edge and bottom.
            shape.fill(heading.mix(canvas, 0.13).color)
                .padding(.top, height * 0.014)
            // The cover.
            HStack(spacing: 0) {
                CoverFill(model.cover)
                    .frame(width: width * 0.06)
                    .clipped()
                    .overlay(alignment: .trailing) { Rectangle().fill(Color.black.opacity(0.06)).frame(width: 1) }
                VStack(alignment: .leading, spacing: 0) {
                    WordWrappedText(model.title.isEmpty ? "Untitled" : model.title, family: .display, size: 6.6 * cq, weight: .medium, maxLines: 2, lineHeight: 1.22, trackingEm: 0.005, width: faceWidth - 7 * cq)
                        .foregroundStyle(ink.color)
                    Text(model.createdText)
                        .font(FoleviFonts.font(.ui, size: 4.5 * cq))
                        .foregroundStyle(faint.color)
                        .lineLimit(1)
                        .padding(.top, cq)
                    preview(cq: cq, faint: faint)
                        .padding(.top, 4.6 * cq)
                        .frame(maxHeight: .infinity, alignment: .topLeading)
                        .clipped()
                    footer(cq: cq, muted: muted, heading: ink, chip: chip)
                        .padding(.top, 3.5 * cq)
                }
                .padding(EdgeInsets(top: 8 * cq, leading: 7 * cq, bottom: 6 * cq, trailing: 6 * cq))
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
            .background(paper.color)
            .clipShape(shape)
            .overlay(shape.strokeBorder(Color.black.opacity(0.05), lineWidth: 1))
            .overlay(alignment: .topTrailing) {
                if model.starred {
                    Image(systemName: "star.fill")
                        .font(.system(size: 5.6 * cq))
                        .foregroundStyle(ink.color)
                        .frame(width: 12 * cq, height: 12 * cq)
                        .background(UnevenRoundedRectangle(bottomLeadingRadius: FoleviTokens.Radius.chip, style: .continuous).fill(chip.color))
                        .clipShape(UnevenRoundedRectangle(topTrailingRadius: FoleviTokens.Radius.panel, style: .continuous))
                }
            }
            .padding(.trailing, cq)
            .padding(.bottom, cq)
        }
        .shadow(color: RGBA(20, 20, 30, 0.16).color, radius: 7, x: -3, y: 6)
        .shadow(color: RGBA(20, 20, 30, 0.10).color, radius: 14, x: -4, y: 12)
        .shadow(color: RGBA(20, 20, 30, 0.03).color, radius: 2.5, x: 0, y: 2)
    }

    @ViewBuilder private func preview(cq: CGFloat, faint: RGBA) -> some View {
        let text = Self.previewText(model.preview, excerpt: model.excerpt)
        if text.isEmpty {
            Text("Empty page").italic().font(FoleviFonts.font(model.fontType.family, size: 3.6 * cq)).foregroundStyle(faint.color)
        } else {
            Text(Self.previewAttributed(model.preview, excerpt: model.excerpt, family: model.fontType.family, size: 3.6 * cq))
                .lineSpacing(5 * cq - 3.6 * cq * 1.2)
                .foregroundStyle(faint.color)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func footer(cq: CGFloat, muted: RGBA, heading: RGBA, chip: RGBA) -> some View {
        HStack(spacing: 2 * cq) {
            Text(model.timeText)
                .font(FoleviFonts.font(.ui, size: 3.8 * cq))
                .foregroundStyle(muted.color)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
            if model.showsFolder {
                HStack(spacing: 1.8 * cq) {
                    if let name = model.folderName {
                        FolderGlyph(colorId: model.folderColorId, size: 4.4 * cq)
                        Text(name).lineLimit(1)
                    } else {
                        Image(systemName: "pencil.line").font(.system(size: 3.6 * cq, weight: .semibold))
                        Text("Draft")
                    }
                }
                .font(FoleviFonts.font(.ui, size: 3.8 * cq, weight: .semibold))
                .foregroundStyle(heading.color)
                .padding(.horizontal, 3 * cq)
                .frame(height: 8.6 * cq)
                .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.tiny, style: .continuous).fill(chip.color))
                .frame(maxWidth: 62 * cq * 0.87, alignment: .trailing)
                .fixedSize(horizontal: true, vertical: false)
            }
        }
        .frame(height: 8.6 * cq)
    }

    /// The page's first blocks as plain text (web `previewText`): paragraphs apart, list items on their own lines.
    nonisolated public static func previewText(_ lines: [CardPreviewLine], excerpt: String) -> String {
        let text = previewParts(lines).map(\.text).joined()
        return text.isEmpty ? excerpt : text
    }

    struct Part { var text: String; var kind: CardPreviewLine.Kind }

    nonisolated static func previewParts(_ lines: [CardPreviewLine]) -> [Part] {
        let list: Set<CardPreviewLine.Kind> = [.bulleted, .numbered, .todo]
        var parts: [Part] = []
        var n = 0
        var prev: CardPreviewLine.Kind?
        for l in lines {
            n = l.kind == .numbered ? n + 1 : 0
            var x: String
            switch l.kind {
            case .table: x = (l.rows ?? []).map { $0.filter { !$0.isEmpty }.joined(separator: "  ") }.filter { !$0.isEmpty }.joined(separator: "\n")
            case .bulleted: x = "• \(l.text)"
            case .numbered: x = "\(n). \(l.text)"
            case .todo: x = "\(l.checked == true ? "☑" : "☐") \(l.text)"
            default: x = l.text
            }
            x = x.trimmingCharacters(in: .whitespacesAndNewlines)
            if x.isEmpty { continue }
            if !parts.isEmpty { parts.append(Part(text: prev.map { list.contains($0) && list.contains(l.kind) } == true ? "\n" : "\n\n", kind: .other)) }
            parts.append(Part(text: x, kind: l.kind))
            prev = l.kind
        }
        return parts
    }

    /// The preview with headings in semibold and checked to-dos struck through, in the note's font type.
    nonisolated static func previewAttributed(_ lines: [CardPreviewLine], excerpt: String, family: FoleviFonts.Family, size: CGFloat) -> AttributedString {
        let parts = previewParts(lines)
        guard !parts.isEmpty else {
            var a = AttributedString(excerpt)
            a.font = FoleviFonts.font(family, size: size)
            return a
        }
        var out = AttributedString()
        for p in parts {
            var a = AttributedString(p.text)
            a.font = FoleviFonts.font(family, size: size, weight: p.kind == .heading ? .semibold : .regular)
            out += a
        }
        return out
    }
}
