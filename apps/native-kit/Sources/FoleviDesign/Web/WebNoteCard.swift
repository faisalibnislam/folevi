// The note and folder cards as the web draws them (views/DocumentCard.tsx NoteCardFace and NOTE_CARD_LINK,
// FolderCardArt.tsx, DocumentCardPreview), from the live app's computed styles (WebStyles "notes.card.*",
// "notes.folder.*", app-styles/notes.json): every size is the web's `cqw` value, so a card reads the same at any
// width (Home's 250 pt carousel, the lists' auto-filled grid, a folder page's 152 pt subfolders). Also the empty
// state (ui/EmptyState.tsx) and Foli AI's flower mark (ai/AiIcon.tsx), which the note screens share.
import CoreText
import SwiftUI

// MARK: colour mixing

public extension RGBA {
    /// CSS `color-mix(in oklab, self p, other)`: the web's tones for folder backs, chips and covers.
    func oklabMix(_ other: RGBA, _ p: Double) -> RGBA {
        let a = oklab, b = other.oklab
        // color-mix premultiplies by alpha before mixing (CSS Color 5).
        let alpha = self.a * p + other.a * (1 - p)
        guard alpha > 0 else { return RGBA(0, 0, 0, 0) }
        let mixed = (0..<3).map { i in (a[i] * self.a * p + b[i] * other.a * (1 - p)) / alpha }
        return RGBA.fromOklab(mixed[0], mixed[1], mixed[2], alpha)
    }

    private var oklab: [Double] {
        func lin(_ c: Double) -> Double { let v = c / 255; return v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4) }
        let (r, g, b) = (lin(self.r), lin(self.g), lin(self.b))
        let l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
        let m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
        let s = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
        return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s]
    }

    private static func fromOklab(_ L: Double, _ A: Double, _ B: Double, _ alpha: Double) -> RGBA {
        let l = pow(L + 0.3963377774 * A + 0.2158037573 * B, 3)
        let m = pow(L - 0.1055613458 * A - 0.0638541728 * B, 3)
        let s = pow(L - 0.0894841775 * A - 1.2914855480 * B, 3)
        func srgb(_ c: Double) -> Double { max(0, min(255, (c <= 0.0031308 ? 12.92 * c : 1.055 * pow(c, 1 / 2.4) - 0.055) * 255)) }
        return RGBA(srgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), srgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), srgb(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s), alpha)
    }
}

// MARK: boxes of any rounded shape

/// A rounded rectangle with its own radius at each corner (`rounded-l-tiny rounded-r-panel`), grown or shrunk
/// by `outset` as a CSS shadow's spread grows the border box.
public struct WebCornersShape: Shape {
    public var topLeft: CGFloat, topRight: CGFloat, bottomRight: CGFloat, bottomLeft: CGFloat
    public var outset: CGFloat = 0

    public init(topLeft: CGFloat, topRight: CGFloat, bottomRight: CGFloat, bottomLeft: CGFloat, outset: CGFloat = 0) {
        self.topLeft = topLeft
        self.topRight = topRight
        self.bottomRight = bottomRight
        self.bottomLeft = bottomLeft
        self.outset = outset
    }

    /// The note card's outline: square-ish at the spine, rounded on the open edge.
    public static let noteCard = WebCornersShape(topLeft: FoleviTokens.Radius.tiny, topRight: FoleviTokens.Radius.panel, bottomRight: FoleviTokens.Radius.panel, bottomLeft: FoleviTokens.Radius.tiny)

    public func grown(_ d: CGFloat) -> WebCornersShape {
        var s = self
        s.outset += d
        return s
    }

    public func path(in rect: CGRect) -> Path {
        let r = rect.insetBy(dx: -outset, dy: -outset)
        guard r.width > 0, r.height > 0 else { return Path() }
        // CSS spread changes each radius by the spread (never below zero).
        func rad(_ v: CGFloat) -> CGFloat { v == 0 ? 0 : max(0, v + outset) }
        return Path(roundedRect: r, cornerRadii: RectangleCornerRadii(topLeading: rad(topLeft), bottomLeading: rad(bottomLeft), bottomTrailing: rad(bottomRight), topTrailing: rad(topRight)), style: .circular)
    }
}

extension View {
    /// Drawn once into one picture (SwiftUI's drawingGroup), with room round it for its shadows: a card's blurred
    /// shadows were composited again on every frame while a screen scrolled, and the
    /// window server missed most frames (Instruments: nearly every frame a hitch). The picture looks the same; it's
    /// drawn again only when the card changes (its hover too).
    func flattened(margin: CGFloat = 48) -> some View {
        padding(margin).drawingGroup().padding(-margin)
    }
}

/// A web box on any `WebCornersShape`: its background, then every `box-shadow` layer as CSS paints them (outer
/// shadows only outside the shape, inset ones only inside).
struct WebShapeBox: View {
    let shape: WebCornersShape
    let fill: Color?
    let shadows: [ShadowLayer]

    var body: some View {
        ZStack {
            ForEach(Array(shadows.enumerated().filter { !$0.element.inset && $0.element.color.a > 0 }.reversed()), id: \.offset) { item in
                let l = item.element
                let reach = abs(l.x) + abs(l.y) + abs(l.spread) + l.blur * 1.5 + 4
                GeometryReader { geo in
                    let w = geo.size.width, h = geo.size.height
                    ZStack {
                        shape.grown(l.spread)
                            .fill(l.color.color)
                            .frame(width: w, height: h)
                            .offset(x: l.x, y: l.y)
                            .blur(radius: l.blur / 2, opaque: false)
                    }
                    .frame(width: w + reach * 2, height: h + reach * 2)
                    .mask {
                        OutsideOf(shape: shape, reach: reach).fill(style: FillStyle(eoFill: true))
                    }
                    .position(x: w / 2, y: h / 2)
                }
            }
            if let fill { shape.fill(fill) }
            ForEach(Array(shadows.enumerated().filter { $0.element.inset && $0.element.color.a > 0 }.reversed()), id: \.offset) { item in
                let l = item.element
                InsetRing(shape: shape, layer: l)
                    .fill(l.color.color, style: FillStyle(eoFill: true))
                    .blur(radius: l.blur / 2, opaque: false)
                    .clipShape(shape)
            }
        }
        .allowsHitTesting(false)
    }

    /// The frame grown by `reach`, minus the shape: where an outer shadow shows. `reach` animates with the frame it
    /// cuts, so the hole stays the shape while a shadow changes (a card's hover): fixed, it jumped to the new reach
    /// while the frame was still on its way, and left a pale band between a card and its shadow.
    struct OutsideOf: Shape {
        let shape: WebCornersShape
        var reach: CGFloat
        var animatableData: CGFloat {
            get { reach }
            set { reach = newValue }
        }
        func path(in rect: CGRect) -> Path {
            var p = Path(rect)
            p.addPath(shape.path(in: rect.insetBy(dx: reach, dy: reach)))
            return p
        }
    }

    /// Everything around the shape shrunk by the spread and moved: an inset shadow's caster.
    struct InsetRing: Shape {
        let shape: WebCornersShape
        let layer: ShadowLayer
        func path(in rect: CGRect) -> Path {
            var p = Path(rect.insetBy(dx: -60, dy: -60))
            p.addPath(shape.grown(-layer.spread).path(in: rect).offsetBy(dx: layer.x, dy: layer.y))
            return p
        }
    }
}

extension WebComputedStyle {
    /// The shadow layers that paint something (the computed list starts with Tailwind's empty ring layers).
    var visibleShadows: [ShadowLayer] { shadows.filter { $0.color.a > 0 } }
}

// MARK: the note card

/// What a note card shows. `NoteCardModel` (FoleviDesign Components) carries the same, from the engine's rows.
public struct WebNoteCard: View {
    let model: NoteCardModel
    /// "Waiting to sync" before the time (the web's UnsyncedMarker).
    let unsynced: Bool
    let hovered: Bool
    @Environment(\.colorScheme) private var scheme

    public static let aspect: CGFloat = 25.0 / 27.0

    public init(_ model: NoteCardModel, unsynced: Bool = false, hovered: Bool = false) {
        self.model = model
        self.unsynced = unsynced
        self.hovered = hovered
    }

    private func s(_ id: String) -> WebComputedStyle { WebStyles.named("notes.card.\(id)").resolve(scheme) }

    /// The page and text colours: the note's own, its theme's, or the app's surface and ink.
    private var palette: (paper: RGBA, heading: RGBA, faint: RGBA, muted: RGBA, chip: RGBA)? {
        let paper: RGBA, ink: RGBA
        if let p = model.paper?.resolve(scheme), let i = model.ink?.resolve(scheme) {
            paper = p
            ink = i
        } else if let theme = model.cover.theme {
            paper = theme.paper(scheme)
            ink = theme.ink(scheme)
        } else {
            return nil
        }
        return (paper, ink, ink.oklabMix(paper, 0.62), ink.oklabMix(paper, 0.74), ink.oklabMix(paper, 0.12).opacity(0.75))
    }

    public var body: some View {
        GeometryReader { geo in
            face(width: geo.size.width, height: geo.size.height).flattened()
        }
        .aspectRatio(Self.aspect, contentMode: .fit)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(model.accessibilityText)
        .accessibilityAddTraits(.isLink)
    }

    private func face(width w: CGFloat, height h: CGFloat) -> some View {
        let cq = w / 100
        let link = s("link")
        let sheetStyle = s("sheet")
        let pal = palette
        let heading = pal?.heading ?? s("title").color
        let faint = pal?.faint ?? s("created").color
        let muted = pal?.muted ?? s("time").color
        let chip = pal?.chip ?? s("chip").background
        let shape = WebCornersShape.noteCard
        let sheetW = w - cq, sheetH = h - cq
        let shadows = hovered ? Self.hoverShadows : link.visibleShadows
        return ZStack(alignment: .topLeading) {
            WebShapeBox(shape: shape, fill: nil, shadows: shadows)
                .frame(width: w, height: h)
            // The page block, peeking out past the cover's open edge and bottom.
            shape.fill(s("page").background.color)
                .frame(width: w, height: h * (1 - 0.014))
                .offset(y: h * 0.014)
            // The cover.
            HStack(spacing: 0) {
                spine
                    .frame(width: sheetW * 0.06)
                    .overlay(alignment: .trailing) { Rectangle().fill(Color.black.opacity(0.06)).frame(width: 1) }
                content(cq: cq, titleWidth: sheetW * 0.94 - 20 * cq, heading: heading, faint: faint, muted: muted, chip: chip)
            }
            .frame(width: sheetW, height: sheetH)
            .background((pal?.paper ?? sheetStyle.background).color)
            // The star's tab (DocumentCard.tsx: absolute right-0 top-0, 12cqw square, rounded-bl-chip): flush with
            // the cover's top and right, only its bottom-left corner rounded; the cover's own rounded corner clips
            // its top-right, as the web card's overflow-hidden does (it was clipped to a card shape of its own
            // size before, so it sat in the corner as a rounded blob, 2026-10-28).
            .overlay(alignment: .topTrailing) {
                if model.starred {
                    ZStack {
                        UnevenRoundedRectangle(bottomLeadingRadius: FoleviTokens.Radius.chip, style: .circular).fill(chip.color)
                        WebIconShape(icon: .star)
                            .fill(heading.color)
                            .overlay(WebIconView(.star, size: 5.6 * cq).foregroundStyle(heading.color))
                            .frame(width: 5.6 * cq, height: 5.6 * cq)
                    }
                    .frame(width: 12 * cq, height: 12 * cq)
                    .accessibilityLabel("Starred")
                }
            }
            .clipShape(shape)
            .overlay(WebShapeBox(shape: shape, fill: nil, shadows: s("edge").visibleShadows))
        }
        .frame(width: w, height: h, alignment: .topLeading)
    }

    @ViewBuilder private var spine: some View {
        if case .plain = model.cover {
            s("spine").background.color
        } else {
            CoverFill(model.cover).clipped()
        }
    }

    private func content(cq: CGFloat, titleWidth: CGFloat, heading: RGBA, faint: RGBA, muted: RGBA, chip: RGBA) -> some View {
        let titleStyle = WebTextStyle(family: .display, size: 6.6 * cq, leading: 6.6 * cq * 1.22, weight: 500, letterSpacing: 0.005 * 6.6 * cq)
        let createdStyle = WebTextStyle(size: 4.5 * cq, leading: 4.5 * cq * 1.3)
        let bodyStyle = WebTextStyle(size: 3.6 * cq, leading: 5 * cq)
        let text = NoteCardView.previewText(model.preview, excerpt: model.excerpt)
        return VStack(alignment: .leading, spacing: 0) {
            WebClampedText(model.title.isEmpty ? "Untitled" : model.title, style: titleStyle, maxLines: 2, width: titleWidth)
                .foregroundStyle(heading.color)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text(model.createdText)
                .webText(createdStyle)
                .lineLimit(1)
                .foregroundStyle(faint.color)
                .padding(.top, cq)
                .frame(maxWidth: .infinity, alignment: .leading)
            GeometryReader { geo in
                // (A card not laid out yet has no width, so no line height: one line until it has.)
                let fit = bodyStyle.leading > 0 ? ((geo.size.height + 1) / bodyStyle.leading).rounded(.down) : 1
                let lines = fit.isFinite ? max(1, Int(min(fit, 1000))) : 1
                Group {
                    if text.isEmpty {
                        Text("Empty page").italic().webText(bodyStyle).lineLimit(lines)
                    } else {
                        // The <p>'s own lines (`text-wrap: pretty`, breaks after spaces and hyphens), clamped: the
                        // last line shown runs on into the next and ends in "…" (-webkit-line-clamp).
                        let all = Self.previewLines(text, style: bodyStyle, width: geo.size.width)
                        VStack(alignment: .leading, spacing: 0) {
                            ForEach(Array(all.prefix(lines).enumerated()), id: \.offset) { i, line in
                                let more = i == lines - 1 && all.count > lines
                                Text(verbatim: more ? line + " " + all[lines...].joined(separator: " ") : (line.isEmpty ? " " : line))
                                    .webText(bodyStyle)
                                    .lineLimit(1)
                                    .truncationMode(.tail)
                            }
                        }
                    }
                }
                .foregroundStyle(faint.color)
                .frame(width: geo.size.width, alignment: .topLeading)
            }
            .padding(.top, 4.6 * cq)
            .frame(maxHeight: .infinity)
            .clipped()
            footer(cq: cq, heading: heading, muted: muted, chip: chip)
                .padding(.top, 3.5 * cq)
        }
        .padding(EdgeInsets(top: 8 * cq, leading: 7 * cq, bottom: 6 * cq, trailing: 6 * cq))
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func footer(cq: CGFloat, heading: RGBA, muted: RGBA, chip: RGBA) -> some View {
        let footStyle = WebTextStyle(size: 3.8 * cq, leading: 3.8 * cq * 1.55)
        return HStack(spacing: 2 * cq) {
            if unsynced {
                HStack(spacing: 4) {
                    Circle().fill(heading.color).frame(width: 6, height: 6)
                    Text("Waiting to sync").webText(WebTextStyle.role(.footnote, weight: 500)).lineLimit(1)
                }
                .foregroundStyle(heading.color)
                .fixedSize()
            }
            Text(model.timeText)
                .webText(footStyle)
                .lineLimit(1)
                .foregroundStyle(muted.color)
                .frame(maxWidth: .infinity, alignment: .leading)
            if model.showsFolder {
                HStack(spacing: 1.8 * cq) {
                    if let name = model.folderName {
                        FolderGlyph(colorId: model.folderColorId, size: 4.4 * cq)
                        Text(name).webText(footStyle.weight(600)).lineLimit(1)
                    } else {
                        WebIconView(.pencilLine, size: 3.8 * cq)
                        Text("Draft").webText(footStyle.weight(600)).lineLimit(1)
                    }
                }
                .foregroundStyle(heading.color)
                .padding(.horizontal, 3 * cq)
                .frame(height: 8.6 * cq)
                .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.tiny, style: .circular).fill(chip.color))
                .frame(maxWidth: (100 - 13) * cq * 0.62 * 0.94, alignment: .trailing)
                .fixedSize(horizontal: true, vertical: false)
            }
        }
        .frame(height: 8.6 * cq)
    }

    /// `white-space: pre-line`: runs of spaces become one, line breaks stay.
    /// A preview's lines as the card's <p> sets them (white-space: pre-line, text-wrap: pretty).
    static func previewLines(_ text: String, style: WebTextStyle, width: CGFloat) -> [String] {
        guard width > 0 else { return [text] }
        return preLine(text).split(separator: "\n", omittingEmptySubsequences: false).flatMap { p in
            p.isEmpty ? [""] : WebPrettyWrap.lines(String(p), style: style, width: width)
        }
    }

    static func preLine(_ s: String) -> String {
        s.split(separator: "\n", omittingEmptySubsequences: false).map { line in
            line.split(separator: " ", omittingEmptySubsequences: true).joined(separator: " ")
        }.joined(separator: "\n")
    }

    /// NOTE_CARD_LINK's hover shadow.
    static let hoverShadows: [ShadowLayer] = [
        ShadowLayer(x: -3, y: 12, blur: 16, spread: -8, color: RGBA(20, 20, 30, 0.18)),
        ShadowLayer(x: -5, y: 24, blur: 36, spread: -18, color: RGBA(20, 20, 30, 0.18)),
        ShadowLayer(x: 0, y: 3, blur: 8, spread: 0, color: RGBA(20, 20, 30, 0.04)),
    ]
}

/// The compact card (Compact layout, DocumentCardPreview): title and folder in a short tile.
public struct WebCompactNoteCard: View {
    let model: NoteCardModel
    let hovered: Bool
    @Environment(\.colorScheme) private var scheme

    public init(_ model: NoteCardModel, hovered: Bool = false) {
        self.model = model
        self.hovered = hovered
    }

    public var body: some View {
        let link = WebStyles.named("notes.compact.link").resolve(scheme)
        let card = WebStyles.named("notes.compact.card").resolve(scheme)
        let title = WebStyles.named("notes.compact.title").resolve(scheme)
        let footer = WebStyles.named("notes.compact.footer").resolve(scheme)
        let shape = WebCornersShape(topLeft: link.radius, topRight: link.radius, bottomRight: link.radius, bottomLeft: link.radius)
        ZStack(alignment: .topLeading) {
            WebShapeBox(shape: shape, fill: card.background.color, shadows: link.visibleShadows)
            Text(model.title.isEmpty ? "Untitled" : model.title)
                .webText(title.text)
                .lineLimit(2)
                .foregroundStyle(title.color.color)
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
            if model.showsFolder {
                HStack(spacing: 8) {
                    Spacer(minLength: 0)
                    WebFolderBadge(name: model.folderName, colorId: model.folderColorId)
                }
                .webText(footer.text)
                .foregroundStyle(footer.color.color)
                .padding(.horizontal, 16)
                .frame(maxHeight: .infinity, alignment: .bottom)
                .padding(.bottom, 14)
            }
            WebShapeBox(shape: shape, fill: nil, shadows: [ShadowLayer(x: 0, y: 0, blur: 0, spread: 1, color: RGBA(0, 0, 0, 0.05), inset: true)])
        }
        .frame(height: link.height)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(model.accessibilityText)
    }
}

/// A note's folder in a list row (views/FolderBadge.tsx): the folder glyph and name, or "Draft".
public struct WebFolderBadge: View {
    let name: String?
    let colorId: String?
    @Environment(\.colorScheme) private var scheme

    public init(name: String?, colorId: String?) {
        self.name = name
        self.colorId = colorId
    }

    public var body: some View {
        let s = WebStyles.named(name == nil ? "notes.list.badge" : "notes.list.badge.folder").resolve(scheme)
        HStack(spacing: s.gap) {
            if let name {
                WebIconView(.check, size: 11, strokeWidth: 2.5)
                FolderGlyph(colorId: colorId, size: 13)
                Text(name).webText(s.text).lineLimit(1)
            } else {
                WebIconView(.pencilLine, size: 11)
                Text("Draft").webText(s.text).lineLimit(1)
            }
        }
        .foregroundStyle(s.color.color)
        .padding(s.padding.edgeInsets)
        .frame(height: s.height)
        .background(RoundedRectangle(cornerRadius: s.radius, style: .circular).fill(s.background.color))
        .fixedSize()
    }
}

// MARK: the folder card

public struct WebFolderCard: View {
    let model: FolderCardModel
    /// `--fc-text`: the cover's labels at a bigger card's size (a folder page's 152 pt subfolders).
    let labelScale: CGFloat
    let hovered: Bool
    @Environment(\.colorScheme) private var scheme

    public static let aspect: CGFloat = 820.0 / 912.0

    public init(_ model: FolderCardModel, labelScale: CGFloat = 1, hovered: Bool = false) {
        self.model = model
        self.labelScale = labelScale
        self.hovered = hovered
    }

    private func s(_ id: String) -> WebComputedStyle { WebStyles.named("notes.folder.\(id)").resolve(scheme) }

    public var body: some View {
        GeometryReader { geo in
            drawing(w: geo.size.width, h: geo.size.height)
        }
        .aspectRatio(Self.aspect, contentMode: .fit)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(model.accessibilityText)
        .accessibilityAddTraits(.isLink)
    }

    static let grey = RGBA(142, 148, 163)

    private func drawing(w: CGFloat, h: CGFloat) -> some View {
        let cq = w / 100
        let base = FolderColor.resolve(model.colorId).color
        let backTone = base.oklabMix(Self.grey, 0.8)
        let back = s("back")
        let tabShape = WebCornersShape(topLeft: FoleviTokens.Radius.control, topRight: FoleviTokens.Radius.control, bottomRight: 0, bottomLeft: 0)
        let bodyShape = WebCornersShape(topLeft: 0, topRight: FoleviTokens.Radius.panel, bottomRight: FoleviTokens.Radius.panel, bottomLeft: FoleviTokens.Radius.panel)
        let frontH = h * 0.54
        let backLayer = ZStack(alignment: .topLeading) {
            WebShapeBox(shape: tabShape, fill: backTone.color, shadows: back.visibleShadows)
                .frame(width: w * 0.44, height: h * 0.09)
            WebShapeBox(shape: bodyShape, fill: backTone.color, shadows: back.visibleShadows)
                .frame(width: w, height: h * 0.95)
                .offset(y: h * 0.05)
        }
        // The back and the papers flattened (their shadows are the costly part), and the whole card again below:
        // the card's picture is drawn again as it moves while a list scrolls, and these keep that cheap (taking them
        // out made Home's p95 frame 8 ms to 24 ms).
        .flattened()
        let notes = notesLayer(w: w, h: h, cq: cq).flattened()
        return ZStack(alignment: .topLeading) {
            backLayer
            notes
            front(w: w, h: h, frontH: frontH, cq: cq, base: base) {
                // backdrop-filter: blur(9px) saturate(1.3): what's behind the front cover, blurred.
                ZStack(alignment: .topLeading) {
                    backLayer
                    notes
                }
                .frame(width: w, height: h, alignment: .topLeading)
                .saturation(1.3)
                .blur(radius: 9, opaque: false)
                .offset(y: -h * 0.46)
                .frame(width: w, height: frontH, alignment: .topLeading)
            }
            .offset(y: h * 0.46)
        }
        .frame(width: w, height: h, alignment: .topLeading)
        // The whole card in one picture too: the front's frosted backdrop (a second copy of the back and the papers,
        // saturated and blurred) and its shadows were blurred again on every frame while Home or Folders scrolled
        // (2026-10-31: Folders' p95 frame 33 to 19 ms, Home's 30 to 8 ms). Real window captures, light and dark, show
        // the front as the web draws it; the app's own snapshots (screens.mjs) never drew the live blur at all, which
        // is why flattening the front once looked like a change.
        .flattened()
        .offset(y: hovered ? -4 : 0)
        .animation(.timingCurve(0.2, 0.8, 0.2, 1, duration: 0.2), value: hovered)
    }

    private func notesLayer(w: CGFloat, h: CGFloat, cq: CGFloat) -> some View {
        let shown = Array(model.notes.prefix(3))
        let places: [(x: CGFloat, y: CGFloat, rot: Double, lift: CGFloat)] = [(0.09, 0.08, -4, 0.05), (0.14, 0.10, 3, 0.035), (0.11, 0.125, -1, 0.02)]
        return ZStack(alignment: .topLeading) {
            if shown.isEmpty {
                RoundedRectangle(cornerRadius: FoleviTokens.Radius.chip, style: .circular)
                    .fill(Color.white.opacity(0.6))
                    .frame(width: w * 0.76, height: h * 0.6)
                    .offset(x: w * 0.12, y: h * 0.12)
            } else {
                ForEach(Array(shown.enumerated().reversed()), id: \.offset) { i, note in
                    let p = places[i]
                    WebFolderNote(note: note, cq: cq, labelScale: 1)
                        .frame(width: w * 0.78, height: h * 0.7)
                        .rotationEffect(.degrees(p.rot))
                        .offset(x: w * p.x, y: h * p.y - (hovered ? h * 0.7 * p.lift : 0))
                        .animation(.timingCurve(0.2, 0.8, 0.2, 1, duration: 0.3), value: hovered)
                }
            }
        }
        .frame(width: w, height: h, alignment: .topLeading)
    }

    private func front<B: View>(w: CGFloat, h: CGFloat, frontH: CGFloat, cq: CGFloat, base: RGBA, @ViewBuilder backdrop: () -> B) -> some View {
        let f = s("front")
        let shape = WebCornersShape(topLeft: f.radius, topRight: f.radius, bottomRight: f.radius, bottomLeft: f.radius)
        let k = labelScale
        let countSize = min(22, max(12, 5.4 * cq * k))
        let ageSize = min(24, max(11, 5.6 * cq * k))
        let nameSize = min(40, max(16, 9.4 * cq * k))
        return ZStack(alignment: .topLeading) {
            WebShapeBox(shape: shape, fill: nil, shadows: f.visibleShadows.filter { !$0.inset })
            backdrop().clipShape(shape)
            shape.fill(LinearGradient(colors: [base.opacity(0.62).color, base.opacity(0.86).color], startPoint: .top, endPoint: .bottom))
            WebShapeBox(shape: shape, fill: nil, shadows: f.visibleShadows.filter(\.inset))
            Text(model.count.formatted())
                .webText(WebTextStyle(family: .display, size: countSize, leading: countSize, weight: 600))
                .lineLimit(1)
                .monospacedDigit()
                .foregroundStyle(RGBA(17, 17, 20).color)
                .padding(.horizontal, 2.2 * cq * k)
                .padding(.vertical, 1.3 * cq * k)
                .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.tiny, style: .circular).fill(base.oklabMix(Self.grey, 0.55).color))
                .fixedSize()
                .offset(x: w * 0.07, y: frontH * 0.0926)
            Text(model.ageText)
                .webText(WebTextStyle(family: .display, size: ageSize, leading: ageSize * 1.2))
                .lineLimit(1)
                .foregroundStyle(base.oklabMix(RGBA(60, 66, 80), 0.25).color)
                .frame(maxWidth: w * 0.55, alignment: .trailing)
                .fixedSize()
                .frame(width: w * 0.93, alignment: .trailing)
                .offset(y: frontH * 0.1037 - 0.15 * ageSize)
            WebClampedText(model.name, style: WebTextStyle(family: .display, size: nameSize, leading: nameSize * 1.12, letterSpacing: -0.01 * nameSize), maxLines: 2, width: w * 0.86)
                .foregroundStyle(RGBA(13, 13, 16).color)
                .frame(width: w, height: frontH * (1 - 0.1148), alignment: .bottomLeading)
                .offset(x: w * 0.07)
        }
        .frame(width: w, height: frontH, alignment: .topLeading)
    }
}

/// One note inside a folder card, drawn small (FolderNote): its paper, its theme down the spine, title and text.
struct WebFolderNote: View {
    let note: FolderCardModel.Note
    let cq: CGFloat
    let labelScale: CGFloat
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let style = WebStyles.named("notes.folder.note").resolve(scheme)
        let theme = note.cover.theme
        let paper = theme?.paper ?? RGBA(255, 255, 255)
        let ink = theme?.ink ?? RGBA(28, 28, 31)
        let shape = WebCornersShape(topLeft: style.radius, topRight: style.radius, bottomRight: style.radius, bottomLeft: style.radius)
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            ZStack(alignment: .topLeading) {
                WebShapeBox(shape: shape, fill: paper.color, shadows: style.visibleShadows)
                ZStack(alignment: .topLeading) {
                    if theme != nil {
                        CoverFill(note.cover).frame(width: w * 0.07, height: h).clipped()
                    }
                    VStack(alignment: .leading, spacing: 0) {
                        WebClampedText(note.title.isEmpty ? "Untitled" : note.title, style: WebTextStyle(family: .display, size: 5.4 * cq, leading: 5.4 * cq * 1.2, weight: 500), maxLines: 2, width: w * 0.8)
                            .foregroundStyle(ink.color)
                        Text(WebNoteCard.preLine(note.excerpt))
                            .webText(WebTextStyle(size: 3.2 * cq, leading: 3.2 * cq * 1.45))
                            .foregroundStyle(ink.oklabMix(paper, 0.82).color)
                            .padding(.top, 2 * cq)
                            .frame(width: w * 0.53, alignment: .leading)
                    }
                    .frame(width: w * 0.8, alignment: .topLeading)
                    .padding(.top, h * 0.07)
                    .offset(x: w * 0.13)
                    .frame(width: w, height: h, alignment: .topLeading)
                    .clipped()
                }
                .clipShape(shape)
            }
        }
    }
}

// MARK: the empty state

/// ui/EmptyState.tsx: an icon in a soft tile, a heading, one line of help and an optional action. `page` fills a
/// view (a note list); inline sits in a Home section.
public struct WebEmptyState<Action: View>: View {
    let icon: WebIcon?
    let title: String
    let message: String?
    let page: Bool
    let action: Action
    @Environment(\.colorScheme) private var scheme

    public init(icon: WebIcon?, title: String, message: String?, page: Bool = true, @ViewBuilder action: () -> Action) {
        self.icon = icon
        self.title = title
        self.message = message
        self.page = page
        self.action = action()
    }

    public var body: some View {
        let box = WebStyles.named("notes.empty").resolve(scheme)
        let tile = WebStyles.named("notes.empty.icon").resolve(scheme)
        let t = WebStyles.named("notes.empty.title").resolve(scheme)
        let b = WebStyles.named("notes.empty.body").resolve(scheme)
        VStack(spacing: 0) {
            if let icon {
                WebIconView(icon, size: page ? 19 : 16, strokeWidth: 1.9)
                    .frame(width: page ? tile.width : 36, height: page ? tile.height : 36)
                    .foregroundStyle(tile.color.color)
                    .background(RoundedRectangle(cornerRadius: tile.radius, style: .circular).fill(tile.background.color))
                    .padding(.bottom, page ? tile.margin.bottom : 12)
            }
            let textWidth: CGFloat = page ? 448 - box.padding.left - box.padding.right : 448 - 32
            WebClampedText(title, style: page ? t.text : WebTextStyle.role(.body, weight: 600), maxLines: 4, width: textWidth, alignment: .center)
                .foregroundStyle(t.color.color)
            if let message {
                WebClampedText(message, style: page ? b.text : WebTextStyle.role(.subheadline).leading(17.875), maxLines: 6, width: textWidth, alignment: .center)
                    .foregroundStyle(b.color.color)
                    .padding(.top, page ? b.margin.top : 4)
            }
            action.padding(.top, page ? 24 : 16)
        }
        .padding(page ? box.padding.edgeInsets : EdgeInsets(top: 32, leading: 16, bottom: 32, trailing: 16))
        .frame(maxWidth: 448)
        .frame(maxWidth: .infinity)
    }
}

public extension WebEmptyState where Action == EmptyView {
    init(icon: WebIcon?, title: String, message: String?, page: Bool = true) {
        self.init(icon: icon, title: title, message: message, page: page) { EmptyView() }
    }
}

extension WebTextStyle {
    func leading(_ l: CGFloat) -> WebTextStyle {
        var s = self
        s.leading = l
        return s
    }
}

// MARK: Foli AI's mark

/// The eight-petal AI mark (ai/AiIcon.tsx) in the brand's violet-to-coral gradient, or one colour (`mono`).
public struct WebAiMark: View {
    let size: CGFloat
    let mono: Bool

    public init(size: CGFloat = 16, mono: Bool = false) {
        self.size = size
        self.mono = mono
    }

    public var body: some View {
        Group {
            if mono {
                AiPetals().fill(.foreground)
            } else {
                // userSpaceOnUse from (73.5, 73.5) to (452.56, 339.79) in the 502-unit box.
                AiPetals().fill(LinearGradient(colors: [RGBA(124, 111, 239).color, RGBA(255, 85, 94).color], startPoint: UnitPoint(x: 73.5 / 502, y: 73.5 / 502), endPoint: UnitPoint(x: 452.56 / 502, y: 339.79 / 502)))
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }

    struct AiPetals: Shape {
        static let path: Path = {
            let p = CGMutablePath()
            SVGPath.add(Self.d, to: p)
            return Path(p)
        }()

        func path(in rect: CGRect) -> Path {
            let s = min(rect.width, rect.height) / 502
            return Self.path.applying(CGAffineTransform(scaleX: s, y: s)).offsetBy(dx: rect.minX, dy: rect.minY)
        }

        static let d = "M250.946 287.945C257.302 287.945 262.968 291.951 265.088 297.943L308.487 420.644C308.491 420.654 308.495 420.664 308.498 420.674C311.729 429.871 312.708 439.709 311.354 449.363C310.001 459.017 306.353 468.206 300.717 476.16C295.081 484.114 287.62 490.601 278.961 495.078C270.301 499.555 260.695 501.892 250.946 501.892C241.198 501.892 231.591 499.555 222.932 495.078C214.272 490.601 206.811 484.114 201.175 476.16C195.539 468.206 191.891 459.017 190.537 449.363C189.183 439.709 190.163 429.871 193.394 420.674C193.397 420.664 193.401 420.654 193.404 420.644L236.805 297.943L237.014 297.388C239.279 291.705 244.789 287.945 250.946 287.945ZM207.714 274.179C213.45 271.44 220.289 272.614 224.783 277.108C229.277 281.603 230.451 288.442 227.713 294.178L171.64 411.628C171.635 411.638 171.63 411.648 171.625 411.657C167.406 420.445 161.142 428.095 153.358 433.964C145.575 439.833 136.498 443.751 126.889 445.39C117.279 447.028 107.416 446.34 98.127 443.383C88.8381 440.425 80.3931 435.285 73.5 428.392C66.6069 421.499 61.4663 413.053 58.5088 403.765C55.5513 394.476 54.8631 384.613 56.502 375.003C58.1408 365.393 62.0587 356.316 67.9277 348.532C73.7968 340.749 81.4462 334.485 90.2344 330.267L90.2637 330.252L207.714 274.179ZM277.108 277.108C281.603 272.614 288.442 271.44 294.178 274.179L411.629 330.252L411.657 330.267C420.445 334.486 428.095 340.75 433.964 348.533C439.833 356.317 443.751 365.393 445.39 375.003C447.028 384.613 446.34 394.476 443.383 403.765C440.425 413.053 435.285 421.498 428.392 428.392C421.498 435.285 413.054 440.425 403.765 443.383C394.476 446.34 384.613 447.028 375.003 445.39C365.393 443.751 356.317 439.833 348.533 433.964C340.749 428.095 334.486 420.445 330.267 411.657C330.262 411.648 330.258 411.638 330.253 411.628L274.179 294.178C271.44 288.442 272.614 281.603 277.108 277.108ZM52.5283 190.537C61.8806 189.226 71.4055 190.104 80.3535 193.098L81.2178 193.395L81.248 193.405L203.948 236.805C209.94 238.924 213.946 244.59 213.946 250.946C213.946 257.302 209.94 262.968 203.948 265.088L81.248 308.487C81.238 308.491 81.2278 308.495 81.2178 308.498C72.0204 311.729 62.1822 312.709 52.5283 311.355C42.8744 310.002 33.6853 306.353 25.7314 300.717C17.7777 295.081 11.2904 287.62 6.81348 278.961C2.33647 270.301 0 260.695 0 250.946C0 241.198 2.33647 231.591 6.81348 222.932C11.2904 214.272 17.7777 206.812 25.7314 201.176C33.6853 195.54 42.8744 191.891 52.5283 190.537ZM420.675 193.395C429.872 190.164 439.71 189.183 449.363 190.537C459.017 191.891 468.206 195.54 476.16 201.176C484.114 206.812 490.601 214.272 495.078 222.932C499.555 231.591 501.892 241.198 501.892 250.946C501.892 260.695 499.555 270.301 495.078 278.961C490.601 287.62 484.114 295.081 476.16 300.717C468.206 306.353 459.017 310.002 449.363 311.355C439.71 312.709 429.872 311.729 420.675 308.498C420.665 308.495 420.654 308.491 420.644 308.487L297.944 265.088C291.952 262.968 287.946 257.302 287.946 250.946C287.946 244.59 291.952 238.924 297.944 236.805L420.644 193.405L420.675 193.395ZM98.127 58.5088C107.416 55.5513 117.279 54.8631 126.889 56.502C136.498 58.1408 145.576 62.0587 153.359 67.9277C160.9 73.6134 167.013 80.97 171.224 89.4141L171.625 90.2344L171.64 90.2637L227.713 207.714C230.451 213.45 229.278 220.289 224.783 224.783C220.289 229.277 213.45 230.451 207.714 227.713L90.2637 171.64C90.254 171.635 90.2441 171.63 90.2344 171.625C81.4462 167.406 73.7968 161.142 67.9277 153.358C62.0589 145.575 58.1407 136.498 56.502 126.889C54.8631 117.279 55.5513 107.416 58.5088 98.127C61.4663 88.8381 66.6069 80.3931 73.5 73.5C80.3931 66.6069 88.8381 61.4663 98.127 58.5088ZM375.003 56.502C384.613 54.8631 394.476 55.5513 403.765 58.5088C413.054 61.4663 421.498 66.6069 428.392 73.5C435.285 80.3931 440.425 88.8382 443.383 98.127C446.34 107.416 447.028 117.279 445.39 126.889C443.751 136.498 439.833 145.576 433.964 153.359C428.095 161.143 420.445 167.406 411.657 171.625C411.648 171.63 411.638 171.635 411.629 171.64L294.178 227.713C288.442 230.451 281.604 229.277 277.109 224.783C272.615 220.289 271.44 213.45 274.179 207.714L330.253 90.2637L330.267 90.2344C334.486 81.4462 340.75 73.7968 348.533 67.9277C356.317 62.0589 365.393 58.1408 375.003 56.502ZM250.946 0C260.695 3.9009e-05 270.301 2.33651 278.961 6.81348C287.62 11.2905 295.081 17.7777 300.717 25.7314C306.353 33.6853 310.001 42.8744 311.354 52.5283C312.708 62.1823 311.729 72.0203 308.498 81.2178C308.495 81.2278 308.491 81.238 308.487 81.248L265.088 203.948C262.968 209.94 257.302 213.946 250.946 213.946C244.59 213.946 238.924 209.94 236.805 203.948L193.404 81.248C193.401 81.238 193.397 81.2279 193.394 81.2178C190.163 72.0204 189.183 62.1823 190.537 52.5283C191.891 42.8744 195.539 33.6853 201.175 25.7314C206.811 17.7776 214.272 11.2905 222.932 6.81348C231.591 2.33648 241.198 0 250.946 0Z"
    }
}

// MARK: clamped lines

/// Text wrapped and clamped as CSS does it (`line-clamp-2` with a line height tighter than the font's own):
/// Core Text finds the line breaks at the width, each line is set in its exact CSS line box, and the last one
/// ends in "…" when there's more. SwiftUI's own wrapping can't lay lines closer than the font's natural height.
public struct WebClampedText: View {
    let text: String
    let style: WebTextStyle
    let maxLines: Int
    let width: CGFloat
    let alignment: HorizontalAlignment

    public init(_ text: String, style: WebTextStyle, maxLines: Int, width: CGFloat, alignment: HorizontalAlignment = .leading) {
        self.text = text
        self.style = style
        self.maxLines = maxLines
        self.width = width
        self.alignment = alignment
    }

    public var body: some View {
        let lines = Self.lines(text, style: style, width: width, max: maxLines)
        VStack(alignment: alignment, spacing: 0) {
            ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                Text(line).webText(style).lineLimit(1).truncationMode(.tail)
            }
        }
        .frame(width: width, alignment: Alignment(horizontal: alignment, vertical: .top))
    }

    /// The lines CSS would show: up to `max`, the last holding the rest of the text (cut with "…" when drawn).
    static func lines(_ text: String, style: WebTextStyle, width: CGFloat, max: Int) -> [String] {
        let s = text as NSString
        guard s.length > 0, width > 0 else { return [text] }
        let attributes: [NSAttributedString.Key: Any] = [.font: style.ctFont, .kern: style.letterSpacing]
        let attributed = NSAttributedString(string: text, attributes: attributes)
        let typesetter = CTTypesetterCreateWithAttributedString(attributed)
        var out: [String] = []
        var start = 0
        while start < s.length, out.count < max - 1 {
            let n = CTTypesetterSuggestLineBreak(typesetter, start, Double(width))
            guard n > 0 else { break }
            out.append(s.substring(with: NSRange(location: start, length: n)).trimmingCharacters(in: .whitespaces))
            start += n
        }
        if start < s.length { out.append(s.substring(from: start).trimmingCharacters(in: .whitespaces)) }
        return out
    }
}
