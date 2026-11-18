// Settings > Appearance > Theme in the Mac's native look (the owner, 2026-11-18: "show thumbnails/previews, full
// width"): three tiles across the card, each a small picture of Folevi's window in that theme (the sidebar on the
// window's material, a tab, the card with a note in it), as System Settings shows its own appearances. System is
// the two halves side by side. The chosen tile wears a ring in the accent and a checked mark by its name; the
// others show a quiet ring under the pointer.
#if os(macOS)
import SwiftUI
import FoleviDesign

/// One choice of theme: the value the engine stores, its name and a few words on what it does.
struct ThemeChoice: Identifiable, Equatable {
    let id: String
    let name: String
    let caption: String

    static let all = [
        ThemeChoice(id: "light", name: "Light", caption: "Always light"),
        ThemeChoice(id: "dark", name: "Dark", caption: "Always dark"),
        ThemeChoice(id: "system", name: "System", caption: "Matches macOS"),
    ]
}

/// The three tiles, sharing the card's width equally.
struct ThemeTiles: View {
    let selected: String
    let choose: (String) -> Void

    static let gap: CGFloat = MacLook.Space.m

    var body: some View {
        HStack(alignment: .top, spacing: Self.gap) {
            ForEach(ThemeChoice.all) { choice in
                Button { choose(choice.id) } label: {
                    ThemeTile(choice: choice, selected: choice.id == selected)
                }
                // (hover: ThemeTileStyle draws the tile's ring under the pointer)
                .buttonStyle(ThemeTileStyle(selected: choice.id == selected))
                .accessibilityLabel(choice.name)
                .accessibilityHint(choice.caption)
                .accessibilityAddTraits(choice.id == selected ? [.isSelected] : [])
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Theme")
    }
}

/// A tile: its picture, then the mark, the name and the caption.
private struct ThemeTile: View {
    let choice: ThemeChoice
    let selected: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: MacLook.Space.s) {
            ThemeThumbnail(theme: choice.id)
                .aspectRatio(ThemeThumbnail.design.width / ThemeThumbnail.design.height, contentMode: .fit)
                .frame(maxWidth: .infinity)
            HStack(alignment: .top, spacing: 7) {
                ZStack {
                    Circle().fill(selected ? MacLook.Colors.accent : Color.clear)
                    Circle().strokeBorder(selected ? Color.clear : MacLook.Colors.secondary.opacity(0.55), lineWidth: 1)
                    if selected { WebIconView(.check, size: 9, strokeWidth: 3).foregroundStyle(MacLook.Colors.onAccent) }
                }
                .frame(width: 15, height: 15)
                .padding(.top, 1)
                VStack(alignment: .leading, spacing: 1) {
                    Text(choice.name).font(selected ? MacLook.Text.body.weight(.semibold) : MacLook.Text.body)
                        .foregroundStyle(MacLook.Colors.label)
                    Text(choice.caption).font(MacLook.Text.small).foregroundStyle(MacLook.Colors.secondary)
                }
                .lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The tile as a button: a ring round the whole tile (the accent on the chosen one, a quiet one under the pointer),
/// 4 pt clear of the picture, always given its room so nothing moves; a press darkens it a touch.
private struct ThemeTileStyle: ButtonStyle {
    let selected: Bool
    @State private var hovering = false

    static let inset: CGFloat = 6
    static let radius: CGFloat = ThemeThumbnail.radius + inset

    func makeBody(configuration: Configuration) -> some View {
        let shape = RoundedRectangle(cornerRadius: Self.radius, style: .continuous)
        configuration.label
            .padding(Self.inset)
            .background(shape.fill(hovering && !selected ? MacLook.Colors.hover.opacity(0.35) : Color.clear))
            .overlay(shape.strokeBorder(selected ? MacLook.Colors.accent : hovering ? MacLook.Colors.secondary.opacity(0.45) : Color.clear, lineWidth: selected ? 2 : 1))
            .opacity(configuration.isPressed ? 0.85 : 1)
            .contentShape(shape)
            .onHover { hovering = $0 }
            .animation(.easeOut(duration: 0.12), value: hovering)
            .animation(.easeOut(duration: 0.15), value: selected)
    }
}

/// A small picture of Folevi's window in a theme, drawn in a 160 x 100 space and scaled to its place. The colours
/// are the theme's own, whatever theme the Settings window is in.
struct ThemeThumbnail: View {
    /// "light", "dark" or "system" (light on the left half, dark on the right).
    let theme: String

    static let design = CGSize(width: 160, height: 100)
    static let radius: CGFloat = 8

    struct Palette {
        var window: Color, card: Color, ink: Color, row: Color, track: Color, tab: Color, edge: Color

        static let light = Palette(window: Color(red: 0.898, green: 0.898, blue: 0.902), card: .white, ink: Color(red: 0.122, green: 0.122, blue: 0.133),
                                   row: Color.black.opacity(0.10), track: Color.black.opacity(0.07), tab: .white, edge: Color.black.opacity(0.14))
        static let dark = Palette(window: Color(red: 0.165, green: 0.165, blue: 0.173), card: Color(red: 0.118, green: 0.118, blue: 0.118), ink: Color(red: 0.949, green: 0.949, blue: 0.953),
                                  row: Color.white.opacity(0.13), track: Color.white.opacity(0.09), tab: Color.white.opacity(0.20), edge: Color.white.opacity(0.16))
    }

    var body: some View {
        Canvas { context, size in
            let scale = size.width / Self.design.width
            context.scaleBy(x: scale, y: scale)
            switch theme {
            case "dark": Self.draw(&context, .dark)
            case "system":
                Self.draw(&context, .light)
                var right = context
                right.clip(to: Path(CGRect(x: Self.design.width / 2, y: 0, width: Self.design.width / 2, height: Self.design.height)))
                Self.draw(&right, .dark)
            default: Self.draw(&context, .light)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: Self.radius, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Self.radius, style: .continuous).strokeBorder(Color.primary.opacity(0.14), lineWidth: 1))
        .accessibilityHidden(true)
    }

    /// The window: traffic lights, the sidebar's account and rows (one chosen), the tab in its track, and the card
    /// with a note (its title, three lines, two to-dos) and the note's bar.
    static func draw(_ c: inout GraphicsContext, _ p: Palette) {
        func bar(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ color: Color, r: CGFloat? = nil) {
            c.fill(Path(roundedRect: CGRect(x: x, y: y, width: w, height: h), cornerRadius: r ?? h / 2, style: .continuous), with: .color(color))
        }
        c.fill(Path(CGRect(origin: .zero, size: design)), with: .color(p.window))
        // The traffic lights.
        for (i, light) in [Color(red: 1, green: 0.373, blue: 0.341), Color(red: 0.996, green: 0.737, blue: 0.18), Color(red: 0.157, green: 0.784, blue: 0.251)].enumerated() {
            c.fill(Path(ellipseIn: CGRect(x: 7 + CGFloat(i) * 7, y: 6.5, width: 4.4, height: 4.4)), with: .color(light))
        }
        // The sidebar: the account, then rows, the second one chosen.
        bar(8, 20, 7, 7, p.ink, r: 2)
        bar(19, 22, 16, 3, p.ink.opacity(0.7))
        bar(4.5, 43.5, 40, 10, p.row, r: 3)
        for (i, width) in [20.0, 25.0, 17.0, 22.0, 14.0].enumerated() {
            let y = 36 + CGFloat(i) * 10
            let chosen = i == 1
            bar(8, y, 5, 5, p.ink.opacity(chosen ? 0.85 : 0.38), r: 1.4)
            bar(17, y + 1, width, 3, p.ink.opacity(chosen ? 0.85 : 0.38))
        }
        // The title bar's tabs: a track, the open tab raised in it.
        bar(52, 4.5, 74, 9, p.track)
        bar(53.2, 5.7, 30, 6.6, p.tab)
        bar(58, 7.8, 16, 2.4, p.ink.opacity(0.75))
        bar(91, 7.8, 14, 2.4, p.ink.opacity(0.32))
        bar(111, 7.8, 10, 2.4, p.ink.opacity(0.32))
        // The card and the note in it.
        bar(50, 17, 105, 78.5, p.card, r: 6)
        bar(63, 29, 44, 6.5, p.ink, r: 1.6)
        for (i, width) in [78.0, 70.0, 52.0].enumerated() {
            bar(63, 43 + CGFloat(i) * 6.5, width, 2.6, p.ink.opacity(0.3))
        }
        // Two to-dos: one open, one done.
        c.stroke(Path(roundedRect: CGRect(x: 63.5, y: 65.5, width: 5, height: 5), cornerRadius: 1.4, style: .continuous), with: .color(p.ink.opacity(0.5)), lineWidth: 1)
        bar(72, 66.7, 36, 2.6, p.ink.opacity(0.3))
        bar(63, 74, 6, 6, p.ink, r: 1.7)
        bar(72, 75.7, 28, 2.6, p.ink.opacity(0.18))
        // The note's bar.
        bar(84, 84.5, 37, 7.5, p.ink.opacity(0.07))
        for i in 0..<4 { bar(89 + CGFloat(i) * 7.5, 87, 4.5, 2.6, p.ink.opacity(i == 0 ? 0.7 : 0.35)) }
    }
}
#endif
