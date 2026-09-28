import SwiftUI

/// Folder colours: the note styles' light page colours (packages/design-tokens/covers/folder-colors.json,
/// the same list the web and the server use). A folder stores the colour's id.
@MainActor
enum FolderColors {
    struct Entry: Decodable, Hashable, Identifiable {
        var id: String
        var name: String
        var hex: String
    }

    static let all: [Entry] = {
        guard let url = Bundle.main.url(forResource: "folder-colors", withExtension: "json", subdirectory: "Covers"),
              let data = try? Data(contentsOf: url),
              let entries = try? JSONDecoder().decode([Entry].self, from: data) else { return [] }
        return entries
    }()

    /// Folders without a colour (older ones) show Blue haze, as on the web.
    static func color(_ id: String?) -> Color {
        let entry = all.first { $0.id == id } ?? all.first { $0.id == "blue-haze" } ?? all.first
        return entry.flatMap { Color(hex: $0.hex) } ?? Color(red: 0.9, green: 0.92, blue: 0.96)
    }
}

/// A folder in its colour, drawn upright like the folder cards: a lighter back cover offset to the right
/// and a filled front cover with the stepped tab at its top-right (the web's FolderGlyph). `size` is the height.
struct FolderGlyph: View {
    var color: String?
    var size: CGFloat = 18

    var body: some View {
        let base = FolderColors.color(color)
        Canvas { ctx, canvas in
            let k = canvas.height / 112
            func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x * k, y: y * k) }
            let edge = GraphicsContext.Shading.color(.black.opacity(0.16))
            let back = Path(roundedRect: CGRect(x: 9 * k, y: 4 * k, width: 69 * k, height: 106 * k), cornerRadius: 7 * k)
            ctx.fill(back, with: .color(base.mix(with: Color(red: 0.933, green: 0.941, blue: 0.953), by: 0.3)))
            ctx.stroke(back, with: edge, lineWidth: 2.5 * k)
            var front = Path()
            front.move(to: p(9, 2))
            front.addLine(to: p(68, 2))
            front.addQuadCurve(to: p(76, 10), control: p(76, 2))
            front.addLine(to: p(76, 23))
            front.addQuadCurve(to: p(72.5, 29), control: p(76, 27))
            front.addLine(to: p(70.5, 30.2))
            front.addQuadCurve(to: p(67, 36.2), control: p(67, 32.2))
            front.addLine(to: p(67, 102))
            front.addQuadCurve(to: p(59, 110), control: p(67, 110))
            front.addLine(to: p(9, 110))
            front.addQuadCurve(to: p(2, 103), control: p(2, 110))
            front.addLine(to: p(2, 9))
            front.addQuadCurve(to: p(9, 2), control: p(2, 2))
            front.closeSubpath()
            ctx.fill(front, with: .color(base))
            ctx.stroke(front, with: edge, lineWidth: 2.5 * k)
        }
        .frame(width: size * 80 / 112, height: size)
        .accessibilityHidden(true)
    }
}

/// A folder card (the web's FolderCard): a tinted back with a tab, a frosted front cover in the folder's
/// colour, the page count and last update on the front, and the name at the bottom. Scales with its width.
struct FolderCard: View {
    var folder: FolderInfo
    var documentCount: Int
    var updatedAt: Double?
    var parentName: String?
    /// Up to three of the notes inside (most recent first), fanned behind the front cover.
    var previews: [DocumentSummary] = []
    @State private var hovering = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    static let aspect: CGFloat = 820 / 912

    var body: some View {
        GeometryReader { geo in
            let u = geo.size.width / 100
            let h = geo.size.height
            let base = FolderColors.color(folder.color)
            let backTone = base.mix(with: Color(red: 0.557, green: 0.580, blue: 0.639), by: 0.2)
            let outline = Color.black.opacity(0.08)
            ZStack(alignment: .topLeading) {
                // Back, with its tab.
                UnevenRoundedRectangle(topLeadingRadius: 3.5 * u, topTrailingRadius: 3.5 * u, style: .continuous)
                    .fill(backTone)
                    .overlay(UnevenRoundedRectangle(topLeadingRadius: 3.5 * u, topTrailingRadius: 3.5 * u, style: .continuous).strokeBorder(outline))
                    .frame(width: geo.size.width * 0.44, height: h * 0.09)
                UnevenRoundedRectangle(bottomLeadingRadius: 4 * u, bottomTrailingRadius: 4 * u, topTrailingRadius: 4 * u, style: .continuous)
                    .fill(backTone)
                    .overlay(UnevenRoundedRectangle(bottomLeadingRadius: 4 * u, bottomTrailingRadius: 4 * u, topTrailingRadius: 4 * u, style: .continuous).strokeBorder(outline))
                    .padding(.top, h * 0.05)
                // The notes inside (or a blank sheet), fanned and rising a little on hover.
                if previews.isEmpty {
                    RoundedRectangle(cornerRadius: 2.4 * u, style: .continuous)
                        .fill(Color.white.opacity(0.6))
                        .frame(width: geo.size.width * 0.76, height: h * 0.6)
                        .offset(x: geo.size.width * 0.12, y: h * (hovering && !reduceMotion ? 0.09 : 0.12))
                } else {
                    ForEach(Array(previews.prefix(3).enumerated().reversed()), id: \.element.id) { index, note in
                        FolderNoteSheet(note: note, unit: u)
                            .frame(width: geo.size.width * 0.78, height: h * 0.7)
                            .rotationEffect(.degrees([-4, 3, -1][index]))
                            .offset(x: geo.size.width * [0.09, 0.14, 0.11][index],
                                    y: h * [0.08, 0.10, 0.125][index] - (hovering && !reduceMotion ? h * [0.05, 0.035, 0.02][index] : 0))
                    }
                }
                // Frosted front cover.
                RoundedRectangle(cornerRadius: 4 * u, style: .continuous)
                    .fill(LinearGradient(colors: [base.opacity(0.62), base.opacity(0.86)], startPoint: .top, endPoint: .bottom))
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 4 * u, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 4 * u, style: .continuous).strokeBorder(outline))
                    .shadow(color: .black.opacity(0.12), radius: 8, y: -4)
                    .padding(.top, h * 0.46)
                // Count and last update.
                HStack(alignment: .firstTextBaseline) {
                    Text(documentCount.formatted())
                        .font(.serif(min(22, max(12, 5.4 * u)), .semibold))
                        .monospacedDigit()
                        .foregroundStyle(Color(red: 0.067, green: 0.067, blue: 0.078))
                        .padding(.horizontal, 2.2 * u)
                        .padding(.vertical, 1.3 * u)
                        .background(base.mix(with: Color(red: 0.557, green: 0.580, blue: 0.639), by: 0.45), in: RoundedRectangle(cornerRadius: 1.4 * u, style: .continuous))
                    Spacer(minLength: 4)
                    if let updatedAt {
                        Text(Date(timeIntervalSince1970: updatedAt / 1000), format: .relative(presentation: .named))
                            .font(.serif(min(24, max(11, 5.6 * u))))
                            .foregroundStyle(base.mix(with: Color(red: 0.235, green: 0.259, blue: 0.314), by: 0.75))
                            .lineLimit(1)
                    }
                }
                .padding(.horizontal, 7 * u)
                .offset(y: h * 0.51)
                // Name.
                VStack {
                    Spacer()
                    Text(folder.name)
                        .font(.serif(min(40, max(16, 9.4 * u))))
                        .tracking(-0.01 * 9.4 * u)
                        .foregroundStyle(Color(red: 0.051, green: 0.051, blue: 0.063))
                        .lineLimit(2)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 7 * u)
                        .padding(.bottom, h * 0.062)
                }
            }
        }
        .aspectRatio(Self.aspect, contentMode: .fit)
        .shadow(color: Color(red: 0.08, green: 0.08, blue: 0.12).opacity(0.1), radius: 7, y: 8)
        .offset(y: hovering && !reduceMotion ? -4 : 0)
        .animation(reduceMotion ? nil : .timingCurve(0.2, 0.7, 0.2, 1, duration: FoleviMotion.base), value: hovering)
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("\(folder.name)\(parentName.map { ", in \($0)" } ?? ""), \(documentCount) pages"))
        .accessibilityAddTraits(.isButton)
    }
}

/// One note inside a folder card (the web's FolderNote): its page colour, a thin spine of its style,
/// the serif title and a few lines of its text.
private struct FolderNoteSheet: View {
    var note: DocumentSummary
    var unit: CGFloat

    var body: some View {
        let u = unit
        let art = note.cover.kind == .art ? CoverArt.entry(note.cover.value) : nil
        let paper = art?.paper.flatMap(Color.init(hex:)) ?? .white
        let ink = art?.ink.flatMap(Color.init(hex:)) ?? Color(red: 0.11, green: 0.11, blue: 0.12)
        GeometryReader { geo in
            ZStack(alignment: .topLeading) {
                paper
                if note.cover.kind == .art, let image = CoverArt.thumbnail(note.cover.value) {
                    Image(nsImage: image).resizable().aspectRatio(contentMode: .fill)
                        .frame(width: geo.size.width * 0.07, height: geo.size.height).clipped()
                }
                VStack(alignment: .leading, spacing: 2 * u) {
                    Text(note.displayTitle)
                        .font(.serif(5.4 * u, .medium))
                        .foregroundStyle(ink)
                        .lineLimit(2)
                    Text(note.excerpt)
                        .font(.ui(3.2 * u))
                        .foregroundStyle(ink.mix(with: paper, by: 0.18))
                }
                .padding(.leading, geo.size.width * 0.13)
                .padding(.trailing, geo.size.width * 0.07)
                .padding(.top, geo.size.height * 0.07)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 2.4 * u, style: .continuous))
        .shadow(color: .black.opacity(0.12), radius: 1, y: 1)
        .shadow(color: .black.opacity(0.25), radius: 7, y: 6)
        .accessibilityHidden(true)
    }
}
