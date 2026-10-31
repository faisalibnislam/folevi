// The note's Style tool on the iPhone, drawn natively (apps/web/src/components/doc/Inspector.tsx StylePanel in the
// iPhone layout, editor-phone.css `.iphone-style-*`): a preview of the page on its background, the note themes
// side by side (and All themes), Blur background when there's a background, the document and text colours as rows
// that open their swatches, then Separator style, Font and Page width as segmented controls. What it shows comes
// from the engine's `note.style`; each choice goes back as `note.style.set` or `note.theme.set`.
import SwiftUI

/// The Style tool's state (the engine's `note.style`, in plain values).
public struct PhoneStyleState: Equatable, Sendable {
    public struct Theme: Equatable, Sendable, Identifiable {
        public var id: String
        public var name: String
        /// A web address for its picture, or nil for the app's own covers/<id>-thumb.webp.
        public var thumb: String?
        public var locked: Bool
        public init(id: String, name: String, thumb: String? = nil, locked: Bool = false) {
            self.id = id
            self.name = name
            self.thumb = thumb
            self.locked = locked
        }
    }

    public struct Choice: Equatable, Sendable, Identifiable {
        public var id: String
        public var name: String
        /// CSS hex for a colour (empty for a font or separator).
        public var color: String
        public init(id: String, name: String, color: String = "") {
            self.id = id
            self.name = name
            self.color = color
        }
    }

    public var canEdit = true
    public var current = "plain"
    public var styleName = "Plain"
    public var themeId: String?
    public var ownImage = false
    public var themes: [Theme] = []
    public var hasBackdrop = false
    public var blur = false
    public var sheet: String?
    public var text: String?
    public var sheetColor = "#ffffff"
    public var textColor = "#1c1c1f"
    public var autoPaper: String?
    public var autoInk: String?
    public var font = "serif"
    public var separator = "line"
    public var width = "default"
    public var sheets: [Choice] = []
    public var texts: [Choice] = []
    public var fonts: [Choice] = []
    public var separators: [Choice] = []

    public init() {}
}

/// What a Style control does.
public enum PhoneStyleAction: Equatable, Sendable {
    case theme(String)
    case allThemes
    case blur(Bool)
    case sheet(String?)
    case text(String?)
    case font(String)
    case separator(String)
    case width(String)
}

public extension RGBA {
    /// A CSS hex colour ("#fbf8f2", "#fff"); black when it isn't one.
    init(css: String) {
        var h = css.trimmingCharacters(in: .whitespaces)
        if h.hasPrefix("#") { h.removeFirst() }
        if h.count == 3 { h = h.map { "\($0)\($0)" }.joined() }
        let v = UInt32(h.prefix(6), radix: 16) ?? 0
        self.init(Double((v >> 16) & 0xff), Double((v >> 8) & 0xff), Double(v & 0xff))
    }
}

/// The Style sheet's content (inside a PhoneSheetPanel titled "Style").
public struct PhoneStyleSheetContent: View {
    let state: PhoneStyleState
    let run: (PhoneStyleAction) -> Void
    @State private var open: String?
    @Environment(\.colorScheme) private var scheme
    @Environment(\.webSnapshot) private var snapshot
    @Environment(\.coverArt) private var art

    public init(state: PhoneStyleState, open: String? = nil, run: @escaping (PhoneStyleAction) -> Void) {
        self.state = state
        self.run = run
        _open = State(initialValue: open)
    }

    /// The Plain style's light grey (PLAIN_CSS).
    static let plain = RGBA(241, 241, 243)

    private var ink: Color { FoleviTokens.Chrome.ink.resolve(scheme).color }
    private var heading: Color { FoleviTokens.Chrome.heading.resolve(scheme).color }
    private var solid: Color { PhoneSurface.solid.resolve(scheme).color }
    private var off: Bool { !state.canEdit }

    public var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            preview
            VStack(alignment: .leading, spacing: 0) {
                caps("Note theme")
                themes
                if state.hasBackdrop {
                    list {
                        HStack(spacing: 12) {
                            Text("Blur background").webText(PhoneType.body()).foregroundStyle(ink).frame(maxWidth: .infinity, alignment: .leading)
                            Toggle("Blur background", isOn: Binding(get: { state.blur }, set: { run(.blur($0)) }))
                                .labelsHidden()
                                .tint(heading)
                                .disabled(off)
                        }
                        .padding(.horizontal, 16)
                        .frame(minHeight: 52)
                    }
                    .padding(.top, 12)
                }
            }
            VStack(alignment: .leading, spacing: 0) {
                caps("Color")
                list {
                    colorRow("Document color", key: "sheet", swatch: RGBA(css: state.sheetColor)) {
                        choice("Auto (from the note theme)", on: state.sheet == nil, .sheet(nil)) {
                            autoTile(paper: state.autoPaper, ink: state.autoInk ?? "", inkFallback: FoleviTokens.Chrome.inkMuted, weight: FoleviTokens.FontWeight.regular)
                        }
                        ForEach(state.sheets) { s in
                            choice("Document color: \(s.name)", on: state.sheet == s.id, .sheet(s.id)) { RGBA(css: s.color).color }
                        }
                    }
                    colorRow("Text color", key: "text", swatch: RGBA(css: state.textColor)) {
                        choice("Auto (from the note theme)", on: state.text == nil, .text(nil)) {
                            autoTile(paper: state.autoPaper, ink: state.autoInk ?? "", inkFallback: FoleviTokens.Chrome.ink, weight: FoleviTokens.FontWeight.semibold)
                        }
                        ForEach(state.texts) { t in
                            choice("Text color: \(t.name)", on: state.text == t.id, .text(t.id)) {
                                Text("A")
                                    .webText(WebTextStyle(size: WebTypeRole.headline.metrics.size, leading: WebTypeRole.headline.metrics.leading, weight: FoleviTokens.FontWeight.semibold))
                                    .foregroundStyle(RGBA(css: t.color).color)
                                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                                    .background(t.id == "white" ? RGBA(css: "#1c1c1f").color : .white)
                            }
                        }
                    }
                }
            }
            if !state.separators.isEmpty {
            segmented("Separator style", state.separators, selected: state.separator) { s in
                HStack(spacing: 6) {
                    separatorIcon(s.id)
                    Text(s.name)
                }
            } pick: { run(.separator($0)) }
            }
            if !state.fonts.isEmpty {
            segmented("Font", state.fonts, selected: state.font) { f in
                Text(f.name).font(FoleviFonts.font(Self.family(f.id), size: WebTypeRole.callout.metrics.size, weight: .semibold))
            } pick: { run(.font($0)) }
            }
            segmented("Page width", [PhoneStyleState.Choice(id: "default", name: "Narrow"), PhoneStyleState.Choice(id: "wide", name: "Wide")], selected: state.width == "wide" ? "wide" : "default") { w in
                Text(w.name)
            } pick: { run(.width($0)) }
        }
        .padding(.horizontal, 16)
        .padding(.top, 4)
        .padding(.bottom, 16)
    }

    /// A font type's standard face (the theme's own typefaces aren't drawn here yet).
    static func family(_ id: String) -> FoleviFonts.Family {
        switch id {
        case "sans": .modern
        case "mono": .mono
        case "rounded": .rounded
        default: .display
        }
    }

    // MARK: Preview

    /// The page on its background: 128 tall, the chip radius, the card's shadow; the page in the middle, 38% wide,
    /// its colours and font, the style's name and two lines.
    private var preview: some View {
        let sheet = RGBA(css: state.sheetColor).color
        let text = RGBA(css: state.textColor).color
        return GeometryReader { geo in
            ZStack(alignment: .top) {
                backdrop
                    .blur(radius: state.blur && state.hasBackdrop ? 12 : 0)
                    .frame(width: geo.size.width, height: geo.size.height)
                    .clipped()
                VStack(alignment: .leading, spacing: 0) {
                    // text-footnote font-semibold leading-tight (1.25).
                    Text(state.styleName)
                        .font(FoleviFonts.font(Self.family(state.font), size: WebTypeRole.footnote.metrics.size, weight: .semibold))
                        .lineLimit(1)
                        .frame(height: WebTypeRole.footnote.metrics.size * 1.25)
                        .foregroundStyle(text)
                    RoundedRectangle(cornerRadius: FoleviTokens.Radius.tiny).fill(text.opacity(0.25)).frame(width: geo.size.width * 0.38 * 0.8 - 16 * 0.8, height: 4).padding(.top, 6)
                    RoundedRectangle(cornerRadius: FoleviTokens.Radius.tiny).fill(text.opacity(0.25)).frame(width: geo.size.width * 0.38 * 0.6 - 16 * 0.6, height: 4).padding(.top, 4)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 8)
                .padding(.top, 8)
                .frame(width: geo.size.width * 0.38, height: geo.size.height - 12, alignment: .topLeading)
                .background(WebShapeBox(shape: WebCornersShape(topLeft: FoleviTokens.Radius.chip, topRight: FoleviTokens.Radius.chip, bottomRight: 0, bottomLeft: 0), fill: sheet, shadows: [ShadowLayer(x: 0, y: 6, blur: 18, spread: -6, color: RGBA(0, 0, 0, 0.35))]))
                .padding(.top, 12)
            }
        }
        .frame(height: 128)
        .clipShape(RoundedRectangle(cornerRadius: FoleviTokens.Radius.chip, style: .circular))
        .background(WebShapeBox(shape: WebCornersShape(topLeft: FoleviTokens.Radius.chip, topRight: FoleviTokens.Radius.chip, bottomRight: FoleviTokens.Radius.chip, bottomLeft: FoleviTokens.Radius.chip), fill: nil, shadows: FoleviTokens.Shadow.card.resolve(scheme)))
        .accessibilityHidden(true)
    }

    /// Behind the preview: the theme's picture, or the plain gradient (sunken to canvas) without a background.
    @ViewBuilder
    private var backdrop: some View {
        if state.hasBackdrop, let id = state.themeId {
            ThemePicture(id: id, thumb: state.themes.first { $0.id == id }?.thumb)
        } else if state.hasBackdrop, state.ownImage {
            FoleviTokens.Chrome.surfaceSunken.resolve(scheme).color
        } else {
            LinearGradient(colors: [FoleviTokens.Chrome.surfaceSunken.resolve(scheme).color, FoleviTokens.Chrome.canvas.resolve(scheme).color], startPoint: .top, endPoint: .bottom)
        }
    }

    // MARK: Themes

    /// Plain, the person's image, the themes and All themes, 64 wide and 12 apart, scrolling past the edges.
    private var themes: some View {
        let row = HStack(alignment: .top, spacing: 12) {
            ThemeChip(label: "Plain", on: state.current == "plain", locked: false) { Self.plain.color } pick: { run(.theme("plain")) }
            if state.ownImage {
                ThemeChip(label: "Your image", on: true, locked: false) { FoleviTokens.Chrome.surfaceSunken.resolve(scheme).color } pick: { run(.allThemes) }
            }
            ForEach(state.themes) { t in
                ThemeChip(label: t.name, on: state.current == t.id, locked: t.locked) { ThemePicture(id: t.id, thumb: t.thumb) } pick: { run(.theme(t.id)) }
            }
            Button { run(.allThemes) } label: {
                VStack(spacing: 6) {
                    WebIconView(.chevronRight, size: 20, strokeWidth: 2.2)
                        .foregroundStyle(heading)
                        .frame(width: 64, height: 80)
                        .background(ink.opacity(0.055), in: RoundedRectangle(cornerRadius: FoleviTokens.Radius.panel, style: .circular))
                    Text("All themes").webText(WebTextStyle(size: WebTypeRole.subheadline.metrics.size, leading: 16)).lineLimit(1).foregroundStyle(ink).frame(width: 64)
                }
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 4)
        return Group {
            if snapshot {
                Color.clear.frame(height: 80 + 6 + 16 + 8).overlay(alignment: .topLeading) { row.fixedSize() }.clipped()
            } else {
                ScrollView(.horizontal, showsIndicators: false) { row }
            }
        }
        .padding(.horizontal, -16)
        .disabled(off)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Note theme")
    }

    // MARK: Colours

    private func colorRow<C: View>(_ label: String, key: String, swatch: RGBA, @ViewBuilder choices: () -> C) -> some View {
        let isOpen = open == key
        return VStack(spacing: 0) {
            Button {
                withAnimation(.easeOut(duration: 0.2)) { open = isOpen ? nil : key }
            } label: {
                HStack(spacing: 12) {
                    Text(label).webText(PhoneType.body()).lineLimit(1).foregroundStyle(ink).frame(maxWidth: .infinity, alignment: .leading)
                    Circle().fill(swatch.color)
                        .overlay(Circle().strokeBorder(.black.opacity(0.16), lineWidth: 0.5))
                        .frame(width: 28, height: 28)
                    WebIconView(.chevronRight, size: 15, strokeWidth: 2.4)
                        .foregroundStyle(FoleviTokens.Chrome.inkFaint.resolve(scheme).color)
                        .rotationEffect(.degrees(isOpen ? 90 : 0))
                }
                .padding(.horizontal, 16)
                .frame(minHeight: 52)
                .contentShape(Rectangle())
            }
            .buttonStyle(StyleRowPress())
            .disabled(off)
            .opacity(off ? 0.4 : 1)
            .accessibilityAddTraits(isOpen ? .isSelected : [])
            if isOpen {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 0), count: 5), spacing: 12) { choices() }
                    .padding(.horizontal, 16)
                    .padding(.top, 4)
                    .padding(.bottom, 16)
            }
        }
        .phoneSeparatorInset(16)
    }

    /// A swatch: 44 round, a hairline edge; chosen, a 2 pt ring in the heading colour 2 pt out.
    private func choice<C: View>(_ label: String, on: Bool, _ action: PhoneStyleAction, @ViewBuilder fill: () -> C) -> some View {
        Button { run(action) } label: {
            fill()
                .frame(width: 44, height: 44)
                .clipShape(Circle())
                .padding(4)
                .overlay { if on { Circle().strokeBorder(heading, lineWidth: 2) } }
                .padding(-4)
        }
        .buttonStyle(SwatchPress())
        .accessibilityLabel(label)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private func autoTile(paper: String?, ink: String, inkFallback: ColorPair, weight: CGFloat) -> some View {
        Text("Auto")
            .webText(WebTextStyle(size: WebTypeRole.footnote.metrics.size, leading: WebTypeRole.footnote.metrics.leading, weight: weight))
            .foregroundStyle(ink.isEmpty ? inkFallback.resolve(scheme).color : RGBA(css: ink).color)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(paper.map { RGBA(css: $0).color } ?? FoleviTokens.Chrome.surface.resolve(scheme).color)
    }

    // MARK: Parts

    private func caps(_ title: String) -> some View {
        Text(title.uppercased())
            .webText(PhoneType.captionCaps)
            .foregroundStyle(FoleviTokens.Chrome.inkMuted.resolve(scheme).color)
            .padding(.horizontal, 4)
            .padding(.bottom, 8)
    }

    /// `.iphone-style-list`: rows on the ink at 5.5%, the container radius, hairlines 16 pt in.
    private func list<C: View>(@ViewBuilder content: () -> C) -> some View {
        VStack(spacing: 0) {
            Group(subviews: content()) { rows in
                ForEach(Array(rows.enumerated()), id: \.element.id) { i, row in
                    row.overlay(alignment: .top) {
                        if i > 0 { PhoneSurface.separator.resolve(scheme).color.frame(height: 0.5).padding(.leading, 16) }
                    }
                }
            }
        }
        .background(ink.opacity(0.055))
        .clipShape(RoundedRectangle(cornerRadius: FoleviTokens.Radius.container, style: .circular))
    }

    /// `.ui-seg.ui-well`: buttons sharing the width, 4 pt in, 32 tall, Callout 550 in the muted ink; the chosen one
    /// on --glass-active with the glass edge.
    private func segmented<L: View>(_ title: String, _ options: [PhoneStyleState.Choice], selected: String, @ViewBuilder label: @escaping (PhoneStyleState.Choice) -> L, pick: @escaping (String) -> Void) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            caps(title)
            HStack(spacing: 2) {
                ForEach(options) { o in
                    let on = o.id == selected
                    Button { pick(o.id) } label: {
                        label(o)
                            .webText(WebTextStyle(size: WebTypeRole.callout.metrics.size, leading: WebTypeRole.callout.metrics.leading, weight: 550))
                            .lineLimit(1)
                            .foregroundStyle((on ? FoleviTokens.Chrome.heading : FoleviTokens.Chrome.inkMuted).resolve(scheme).color)
                            .padding(.horizontal, 9.6)
                            .frame(maxWidth: .infinity, minHeight: 32)
                            .background {
                                if on {
                                    WebShapeBox(shape: WebCornersShape(topLeft: FoleviTokens.Radius.chip, topRight: FoleviTokens.Radius.chip, bottomRight: FoleviTokens.Radius.chip, bottomLeft: FoleviTokens.Radius.chip), fill: FoleviTokens.Glass.active.resolve(scheme).color, shadows: Self.glassEdge(scheme) + [ShadowLayer(x: 0, y: 1, blur: 3, spread: 0, color: RGBA(0, 0, 0, 0.08))])
                                }
                            }
                    }
                    .buttonStyle(.plain)
                    .disabled(off)
                    .accessibilityLabel("\(title): \(o.name)")
                    .accessibilityAddTraits(on ? .isSelected : [])
                }
            }
            .padding(4)
            .background(FoleviTokens.Glass.hover.resolve(scheme).color, in: RoundedRectangle(cornerRadius: FoleviTokens.Radius.control, style: .circular))
            .overlay(RoundedRectangle(cornerRadius: FoleviTokens.Radius.control, style: .circular).strokeBorder(FoleviTokens.Glass.border.resolve(scheme).color, lineWidth: 1))
            .opacity(off ? 0.5 : 1)
        }
    }

    /// --glass-edge: a light inner line and a faint outer one.
    static func glassEdge(_ scheme: ColorScheme) -> [ShadowLayer] {
        scheme == .dark
            ? [ShadowLayer(x: 0, y: 0, blur: 0, spread: 1, color: RGBA(255, 255, 255, 0.08), inset: true), ShadowLayer(x: 0, y: 0, blur: 0, spread: 1, color: RGBA(0, 0, 0, 0.4))]
            : [ShadowLayer(x: 0, y: 0, blur: 0, spread: 1, color: RGBA(255, 255, 255, 0.6), inset: true), ShadowLayer(x: 0, y: 0, blur: 0, spread: 1, color: RGBA(0, 0, 0, 0.06))]
    }

    @ViewBuilder
    private func separatorIcon(_ id: String) -> some View {
        switch id {
        case "dots": WebIconView(.grip, size: 15)
        case "doodle":
            Path { p in
                p.move(to: CGPoint(x: 1, y: 9))
                p.addQuadCurve(to: CGPoint(x: 7, y: 8), control: CGPoint(x: 4, y: 3))
                p.addQuadCurve(to: CGPoint(x: 13, y: 7), control: CGPoint(x: 10, y: 13))
                p.addQuadCurve(to: CGPoint(x: 15, y: 6), control: CGPoint(x: 14, y: 6.5))
            }
            .stroke(style: StrokeStyle(lineWidth: 1.7, lineCap: .round))
            .frame(width: 16, height: 16)
        default: WebIconView(.equal, size: 15)
        }
    }
}

/// A theme's picture: the app's own thumbnail, or one from the web for a theme added since.
struct ThemePicture: View {
    let id: String
    let thumb: String?
    @Environment(\.coverArt) private var art

    var body: some View {
        if let thumb, let url = URL(string: thumb) {
            AsyncImage(url: url) { phase in
                if let image = phase.image { image.resizable().scaledToFill() } else { CoverFill(.theme(id)) }
            }
        } else {
            CoverFill(.theme(id))
        }
    }
}

/// ThemeChip: the picture 64 by 80 with the panel radius, the name under it; chosen, ringed; not on the plan, a
/// small lock.
struct ThemeChip<Art: View>: View {
    let label: String
    let on: Bool
    let locked: Bool
    let art: Art
    let pick: () -> Void
    @Environment(\.colorScheme) private var scheme

    init(label: String, on: Bool, locked: Bool, @ViewBuilder art: () -> Art, pick: @escaping () -> Void) {
        self.label = label
        self.on = on
        self.locked = locked
        self.art = art()
        self.pick = pick
    }

    var body: some View {
        let heading = FoleviTokens.Chrome.heading.resolve(scheme).color
        Button(action: pick) {
            VStack(spacing: 6) {
                art
                    .frame(width: 64, height: 80)
                    .clipShape(RoundedRectangle(cornerRadius: FoleviTokens.Radius.panel, style: .circular))
                    .overlay { if !on { RoundedRectangle(cornerRadius: FoleviTokens.Radius.panel, style: .circular).strokeBorder(.black.opacity(0.16), lineWidth: 0.5) } }
                    .overlay(alignment: .topTrailing) {
                        if locked {
                            WebIconView(.lock, size: 11, strokeWidth: 2.5)
                                .foregroundStyle(.white)
                                .frame(width: 20, height: 20)
                                .background(.black.opacity(0.45), in: Circle())
                                .padding(4)
                        }
                    }
                    .padding(4)
                    .overlay { if on { RoundedRectangle(cornerRadius: FoleviTokens.Radius.panel + 4, style: .circular).strokeBorder(heading, lineWidth: 2) } }
                    .padding(-4)
                Text(label)
                    .webText(WebTextStyle(size: WebTypeRole.subheadline.metrics.size, leading: 16, weight: on ? FoleviTokens.FontWeight.semibold : FoleviTokens.FontWeight.regular))
                    .lineLimit(1)
                    .foregroundStyle((on ? FoleviTokens.Chrome.heading : FoleviTokens.Chrome.ink).resolve(scheme).color)
                    .frame(width: 64)
            }
        }
        .buttonStyle(SwatchPress())
        .accessibilityLabel(locked ? "\(label), not on this plan" : label)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

private struct SwatchPress: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.scaleEffect(configuration.isPressed ? 0.95 : 1).animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}

private struct StyleRowPress: ButtonStyle {
    @Environment(\.colorScheme) private var scheme

    func makeBody(configuration: Configuration) -> some View {
        configuration.label.background(configuration.isPressed ? FoleviTokens.Chrome.ink.resolve(scheme).color.opacity(0.06) : .clear)
    }
}

/// All themes (the web's ThemeGallery on the iPhone): Plain and every theme, four to a row, the chosen one ringed.
public struct PhoneThemeGallery: View {
    let state: PhoneStyleState
    let pick: (String) -> Void

    public init(state: PhoneStyleState, pick: @escaping (String) -> Void) {
        self.state = state
        self.pick = pick
    }

    public var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12, alignment: .top), count: 4), spacing: 16) {
            ThemeChip(label: "Plain", on: state.current == "plain", locked: false) { PhoneStyleSheetContent.plain.color } pick: { pick("plain") }
            ForEach(state.themes) { t in
                ThemeChip(label: t.name, on: state.current == t.id, locked: t.locked) { ThemePicture(id: t.id, thumb: t.thumb) } pick: { pick(t.id) }
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 24)
        .disabled(!state.canEdit)
    }
}
