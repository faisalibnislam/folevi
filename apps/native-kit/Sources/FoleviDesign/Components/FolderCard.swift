// The folder card (web views/FolderCardArt.tsx): a real folder, portrait (820:912). A tinted back with its tab,
// up to three of the notes inside (fanned, faint), and a frosted front cover in the folder's colour that the
// notes show through. The page count sits top left of the front, the last update top right, and the name
// bottom left in large serif: always visible, wrapping between words, at most 2 lines, ending in "…".
import SwiftUI

public struct FolderCardModel: Hashable, Sendable, Identifiable {
    public struct Note: Hashable, Sendable {
        public var title: String
        public var excerpt: String
        public var cover: NoteCover
        public init(title: String, excerpt: String = "", cover: NoteCover = .plain) {
            self.title = title
            self.excerpt = excerpt
            self.cover = cover
        }
    }

    public var id: String
    public var name: String
    public var colorId: String?
    public var count: Int
    /// "2 days ago" (`AgeText`).
    public var ageText: String
    /// Up to three notes inside, most recently edited first.
    public var notes: [Note]
    /// "in Projects" for nested folders shown outside their parent.
    public var parentName: String?

    public init(id: String, name: String, colorId: String? = nil, count: Int, ageText: String, notes: [Note] = [], parentName: String? = nil) {
        self.id = id
        self.name = name
        self.colorId = colorId
        self.count = count
        self.ageText = ageText
        self.notes = notes
        self.parentName = parentName
    }

    public var accessibilityText: String {
        "\(name)\(parentName.map { ", in \($0)" } ?? ""), \(count == 1 ? "1 page" : "\(count.formatted()) pages"), updated \(ageText)"
    }
}

public struct FolderCardView: View {
    public static let aspectRatio: CGFloat = 820.0 / 912.0
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    let model: FolderCardModel

    public init(_ model: FolderCardModel) { self.model = model }

    public var body: some View {
        GeometryReader { proxy in
            drawing(width: proxy.size.width, height: proxy.size.height)
        }
        .aspectRatio(Self.aspectRatio, contentMode: .fit)
        .shadow(color: RGBA(20, 20, 30, 0.1).color, radius: 7, y: 8)
        .shadow(color: RGBA(20, 20, 30, 0.06).color, radius: 1, y: 1)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(model.accessibilityText)
        .accessibilityAddTraits(.isButton)
    }

    private func drawing(width w: CGFloat, height h: CGFloat) -> some View {
        let cq = w / 100
        let base = FolderColor.resolve(model.colorId).color
        let grey = RGBA(142, 148, 163)
        let back = base.mix(grey, 0.8)
        let edge = Color.black.opacity(0.08)
        let panel = FoleviTokens.Radius.panel
        let frontHeight = h * 0.54
        return ZStack(alignment: .topLeading) {
            // The back, with its tab.
            UnevenRoundedRectangle(topLeadingRadius: FoleviTokens.Radius.control, topTrailingRadius: FoleviTokens.Radius.control, style: .continuous)
                .fill(back.color)
                .overlay(UnevenRoundedRectangle(topLeadingRadius: FoleviTokens.Radius.control, topTrailingRadius: FoleviTokens.Radius.control, style: .continuous).strokeBorder(edge, lineWidth: 1))
                .frame(width: w * 0.44, height: h * 0.09)
            UnevenRoundedRectangle(topLeadingRadius: 0, bottomLeadingRadius: panel, bottomTrailingRadius: panel, topTrailingRadius: panel, style: .continuous)
                .fill(back.color)
                .overlay(UnevenRoundedRectangle(topLeadingRadius: 0, bottomLeadingRadius: panel, bottomTrailingRadius: panel, topTrailingRadius: panel, style: .continuous).strokeBorder(edge, lineWidth: 1))
                .frame(width: w, height: h * 0.95)
                .offset(y: h * 0.05)
            // The notes inside, faint and fanned.
            if model.notes.isEmpty {
                RoundedRectangle(cornerRadius: FoleviTokens.Radius.chip, style: .continuous)
                    .fill(Color.white.opacity(0.6))
                    .frame(width: w * 0.76, height: h * 0.6)
                    .offset(x: w * 0.12, y: h * 0.12)
            } else {
                ForEach(Array(model.notes.prefix(3).enumerated().reversed()), id: \.offset) { index, note in
                    FolderNoteView(note: note, cq: cq)
                        .frame(width: w * 0.78, height: h * 0.7)
                        .rotationEffect(.degrees([-4, 3, -1][index]))
                        .offset(x: w * [0.09, 0.14, 0.11][index], y: h * [0.08, 0.10, 0.125][index])
                }
            }
            // The frosted front cover, with the count, last update and name on it.
            let front = RoundedRectangle(cornerRadius: panel, style: .continuous)
            ZStack(alignment: .topLeading) {
                Text(model.count.formatted())
                    .font(FoleviFonts.font(.display, size: min(22, max(12, 5.4 * cq)), weight: .semibold))
                    .monospacedDigit()
                    .foregroundStyle(RGBA(17, 17, 20).color)
                    .padding(.horizontal, 2.2 * cq)
                    .padding(.vertical, 1.3 * cq)
                    .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.tiny, style: .continuous).fill(base.mix(grey, 0.55).color))
                    .offset(x: w * 0.07, y: frontHeight * 0.0926)
                Text(model.ageText)
                    .font(FoleviFonts.font(.display, size: min(24, max(11, 5.6 * cq))))
                    .foregroundStyle(base.mix(RGBA(60, 66, 80), 0.25).color)
                    .lineLimit(1)
                    .frame(maxWidth: w * 0.55, alignment: .trailing)
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    .padding(.trailing, w * 0.07)
                    .offset(y: frontHeight * 0.1037)
                let nameSize = min(40, max(16, 9.4 * cq))
                WordWrappedText(model.name, family: .display, size: nameSize, weight: .regular, maxLines: 2, lineHeight: 1.12, trackingEm: -0.01, width: w * 0.86)
                    .foregroundStyle(RGBA(13, 13, 16).color)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
                    .padding(.leading, w * 0.07)
                    .padding(.bottom, frontHeight * 0.1148)
            }
            .frame(width: w, height: frontHeight)
            .background {
                ZStack {
                    if !reduceTransparency { front.fill(.ultraThinMaterial) }
                    front.fill(LinearGradient(colors: [base.opacity(reduceTransparency ? 1 : 0.62).color, base.opacity(reduceTransparency ? 1 : 0.86).color], startPoint: .top, endPoint: .bottom))
                }
                .environment(\.colorScheme, .light)
            }
            .overlay(front.strokeBorder(edge, lineWidth: 1))
            .overlay(alignment: .top) {
                front.stroke(LinearGradient(colors: [Color.white.opacity(0.75), .clear], startPoint: .top, endPoint: UnitPoint(x: 0.5, y: 0.04)), lineWidth: 1).allowsHitTesting(false)
            }
            .shadow(color: .black.opacity(0.12), radius: 8, y: -3)
            .offset(y: h * 0.46)
        }
        .frame(width: w, height: h, alignment: .topLeading)
    }
}

/// One note inside a folder, drawn small: its page colour, theme down the spine, title and opening text.
private struct FolderNoteView: View {
    @Environment(\.colorScheme) private var scheme
    let note: FolderCardModel.Note
    let cq: CGFloat

    var body: some View {
        let theme = note.cover.theme
        let paper = theme?.paper ?? RGBA(255, 255, 255)
        let ink = theme?.ink ?? RGBA(28, 28, 31)
        GeometryReader { proxy in
            HStack(spacing: 0) {
                if case .plain = note.cover {
                    Color.clear.frame(width: proxy.size.width * 0.07)
                } else {
                    CoverFill(note.cover).frame(width: proxy.size.width * 0.07).clipped()
                }
                VStack(alignment: .leading, spacing: 2 * cq) {
                    WordWrappedText(note.title.isEmpty ? "Untitled" : note.title, family: .display, size: 5.4 * cq, weight: .medium, maxLines: 2, lineHeight: 1.2, width: proxy.size.width * 0.8)
                        .foregroundStyle(ink.color)
                    Text(note.excerpt)
                        .font(FoleviFonts.font(.ui, size: 3.2 * cq))
                        .foregroundStyle(ink.mix(paper, 0.82).color)
                        .lineSpacing(3.2 * cq * 0.25)
                }
                .padding(.leading, proxy.size.width * 0.06)
                .padding(.trailing, proxy.size.width * 0.07)
                .padding(.top, proxy.size.height * 0.07)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
        }
        .background(paper.color)
        .clipShape(RoundedRectangle(cornerRadius: FoleviTokens.Radius.chip, style: .continuous))
        .shadow(color: .black.opacity(0.12), radius: 1, y: 1)
        .shadow(color: .black.opacity(0.18), radius: 6, y: 5)
    }
}
