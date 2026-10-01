import SwiftUI

// MARK: - Canvas

/// `canvas` plus two very large, very soft radial glows, peach top-right, rose bottom-left
/// (`.ui-canvas` on the web). Flat under Reduce Transparency.
struct CanvasBackground: View {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            ZStack {
                FoleviColor.canvas
                if !reduceTransparency {
                    glow(FoleviColor.glowPeach, strength: colorScheme == .dark ? 0.55 : 0.42)
                        .frame(width: w * 1.3, height: h * 1.05)
                        .position(x: w, y: -0.05 * h)
                    glow(FoleviColor.glowRose, strength: colorScheme == .dark ? 0.5 : 0.38)
                        .frame(width: w * 1.2, height: h * 1.15)
                        .position(x: -0.05 * w, y: 1.05 * h)
                }
            }
            .frame(width: w, height: h)
            .clipped()
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private func glow(_ color: Color, strength: Double) -> some View {
        EllipticalGradient(gradient: Gradient(stops: [
            .init(color: color.opacity(strength), location: 0),
            .init(color: color.opacity(strength * 0.45), location: 0.35),
            .init(color: color.opacity(0), location: 0.72),
        ]), center: .center, startRadiusFraction: 0, endRadiusFraction: 0.5)
    }
}

/// Behind an open note: its style artwork, heavily blurred and saturated under a veil, so the note lights
/// the chrome around it (the web's Shell ambient layer). The neutral canvas otherwise.
struct AmbientBackground: View {
    var cover: DocumentCover?
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    var body: some View {
        ZStack {
            CanvasBackground()
            if !reduceTransparency, cover?.kind == .art, let image = CoverArt.thumbnail(cover?.value) {
                GeometryReader { geo in
                    Image(nsImage: image)
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                        .frame(width: geo.size.width + 192, height: geo.size.height + 192)
                        .offset(x: -96, y: -96)
                        .blur(radius: 56)
                        .saturation(1.4)
                }
                .clipped()
                FoleviGlass.veil
            }
        }
        .animation(.easeInOut(duration: 0.5), value: cover?.value)
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

// MARK: - Buttons

enum FoleviButtonKind { case primary, secondary, ghost, quiet, danger }
/// The web's Button sizes: sm 32pt / 13pt, md 36pt / 14pt (large is for full-width calls to action).
enum FoleviButtonSize {
    case small, medium, large
    var height: CGFloat { switch self { case .small: return 32; case .medium: return 36; case .large: return 40 } }
    var font: CGFloat { switch self { case .small: return 13; case .medium: return 14; case .large: return 14 } }
    var padding: CGFloat { switch self { case .small: return 14; case .medium: return 16; case .large: return 20 } }
}

/// The web's `.ui-btn`: radius 6. Primary (accent, inset highlight, soft drop), secondary (raised glass with
/// the glass edge), ghost, quiet (muted; glass hover), danger.
struct FoleviButtonStyle: ButtonStyle {
    var kind: FoleviButtonKind = .secondary
    var size: FoleviButtonSize = .medium
    var fullWidth = false

    func makeBody(configuration: Configuration) -> some View {
        FoleviButtonBody(configuration: configuration, kind: kind, size: size, fullWidth: fullWidth)
    }
}

private struct FoleviButtonBody: View {
    let configuration: ButtonStyle.Configuration
    let kind: FoleviButtonKind
    let size: FoleviButtonSize
    let fullWidth: Bool
    @State private var hovering = false
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let pressed = configuration.isPressed && isEnabled
        configuration.label
            .font(.ui(size.font, .semibold))
            .tracking(-0.005 * size.font)
            .lineLimit(1)
            .foregroundStyle(foreground)
            .padding(.horizontal, size.padding)
            .frame(minHeight: size.height)
            .frame(maxWidth: fullWidth ? .infinity : nil)
            .background { background(pressed: pressed) }
            .contentShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
            .opacity(isEnabled ? 1 : 0.5)
            .onHover { hovering = $0 && isEnabled }
            .animation(reduceMotion ? nil : .easeOut(duration: FoleviMotion.fast), value: hovering)
    }

    private var foreground: Color {
        switch kind {
        case .primary: return FoleviColor.accentInk
        case .danger: return .white
        case .secondary, .ghost: return hovering ? FoleviColor.heading : FoleviColor.ink
        case .quiet: return hovering ? FoleviColor.heading : FoleviColor.inkMuted
        }
    }

    /// `.ui-btn-primary`: inset white/14% top line, 0 1px 2px black/12%, 0 4px 12px -4px black/25%.
    private static let primaryShadow: [FoleviShadowLayer] = [
        FoleviShadowLayer(x: 0, y: 1, blur: 0, spread: 0, color: .white.opacity(0.14), inset: true),
        FoleviShadowLayer(x: 0, y: 1, blur: 2, spread: 0, color: .black.opacity(0.12), inset: false),
        FoleviShadowLayer(x: 0, y: 4, blur: 12, spread: -4, color: .black.opacity(0.25), inset: false),
    ]

    @ViewBuilder private func background(pressed: Bool) -> some View {
        let shape = SurfaceShape.rounded(6)
        switch kind {
        case .primary:
            // Hover brightens by 5%, pressed darkens by 4%.
            let fill = pressed ? FoleviColor.accent.mix(with: .black, by: 0.04) : hovering ? FoleviColor.accent.mix(with: .white, by: 0.05) : FoleviColor.accent
            Color.clear.foleviSurface(.color(fill), shape: shape, shadow: Self.primaryShadow)
        case .danger:
            let base = pressed ? FoleviColor.destructive.mix(with: .black, by: 0.04) : FoleviColor.destructive
            Color.clear.foleviSurface(.gradient([base.mix(with: .white, by: hovering ? 0.08 : 0.04), base]), shape: shape, shadow: FoleviShadow.primary)
        case .secondary:
            let fill = pressed ? FoleviColor.surfaceSunken : hovering ? FoleviColor.surfaceRaised : FoleviColor.surfaceRaised.opacity(0.72)
            Color.clear.foleviSurface(.color(fill), shape: shape,
                                      shadow: FoleviGlassDepth.edge + [FoleviShadowLayer(x: 0, y: 1, blur: 2, spread: 0, color: .black.opacity(0.06), inset: false)])
        case .ghost, .quiet:
            RoundedRectangle(cornerRadius: 6, style: .continuous).fill(hovering || pressed ? FoleviGlass.hover : Color.clear)
        }
    }
}

extension ButtonStyle where Self == FoleviButtonStyle {
    static var foleviPrimary: FoleviButtonStyle { FoleviButtonStyle(kind: .primary) }
    static var foleviSecondary: FoleviButtonStyle { FoleviButtonStyle(kind: .secondary) }
    static var foleviGhost: FoleviButtonStyle { FoleviButtonStyle(kind: .ghost) }
    static func folevi(_ kind: FoleviButtonKind, _ size: FoleviButtonSize = .medium, fullWidth: Bool = false) -> FoleviButtonStyle {
        FoleviButtonStyle(kind: kind, size: size, fullWidth: fullWidth)
    }
}

/// The web's IconButton: a quiet square (radius 6), 32pt by default. Always labelled; the tooltip carries
/// the shortcut.
struct IconButton: View {
    var systemImage: String
    var label: LocalizedStringKey
    var shortcutHint: String?
    var size: CGFloat = 32
    var isActive = false
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: size * 0.45, weight: .medium))
                .frame(width: size, height: size)
        }
        .buttonStyle(IconButtonStyle(isActive: isActive))
        .help(shortcutHint.map { Text(label) + Text(" (\($0))") } ?? Text(label))
        .accessibilityLabel(Text(label))
    }
}

struct IconButtonStyle: ButtonStyle {
    var isActive = false
    func makeBody(configuration: Configuration) -> some View {
        IconButtonBody(configuration: configuration, isActive: isActive)
    }
}

/// Quiet: muted, glass hover; pressed (active) shows the accent-soft fill, as `.ui-btn-quiet[aria-pressed]`.
private struct IconButtonBody: View {
    let configuration: ButtonStyle.Configuration
    let isActive: Bool
    @State private var hovering = false
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 6, style: .continuous)
        configuration.label
            .foregroundStyle(isActive || hovering ? FoleviColor.heading : FoleviColor.inkMuted)
            .background(shape.fill(isActive ? FoleviColor.accentSoft : hovering || configuration.isPressed ? FoleviGlass.hover : .clear))
            .contentShape(shape)
            .opacity(isEnabled ? 1 : 0.4)
            .onHover { hovering = $0 && isEnabled }
    }
}

// MARK: - Segmented control

/// Sunken pill track with a raised thumb that slides (180ms) under the active item.
struct FoleviSegmented<Value: Hashable>: View {
    struct Item: Identifiable {
        var value: Value
        var title: LocalizedStringKey
        var systemImage: String?
        var id: Value { value }
    }

    @Binding var selection: Value
    var items: [Item]
    var showTitles = true
    var height: CGFloat = 28
    var fontSize: CGFloat = 12.5
    var accessibilityLabel: LocalizedStringKey
    /// Icon above a small label (the inspector header).
    var stacked = false
    @Namespace private var namespace
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        HStack(spacing: 2) {
            ForEach(items) { item in
                let active = item.value == selection
                Button {
                    withAnimation(reduceMotion ? nil : .timingCurve(0.2, 0.7, 0.2, 1, duration: FoleviMotion.base)) { selection = item.value }
                } label: {
                    let stack = stacked ? AnyLayout(VStackLayout(spacing: 3)) : AnyLayout(HStackLayout(spacing: 5))
                    stack {
                        if let icon = item.systemImage {
                            Image(systemName: icon)
                                .font(.system(size: stacked ? 13 : fontSize, weight: active ? .semibold : .medium))
                                .foregroundStyle(active && stacked ? FoleviColor.ember : active ? FoleviColor.heading : FoleviColor.inkMuted)
                                .accessibilityHidden(true)
                        }
                        if showTitles || item.systemImage == nil {
                            Text(item.title).lineLimit(1).minimumScaleFactor(0.8)
                        }
                    }
                    .font(.ui(fontSize, active ? .semibold : .medium))
                    .foregroundStyle(active ? FoleviColor.heading : FoleviColor.inkMuted)
                    .padding(.horizontal, stacked ? 2 : showTitles ? 9 : 6)
                    .frame(maxWidth: .infinity, minHeight: height)
                    .background {
                        if active {
                            Color.clear
                                .foleviSurface(.color(FoleviColor.surfaceRaised), shape: .capsule, shadow: FoleviShadow.control)
                                .matchedGeometryEffect(id: "thumb", in: namespace)
                        }
                    }
                    .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .help(Text(item.title))
                .accessibilityLabel(Text(item.title))
                .accessibilityAddTraits(active ? [.isSelected] : [])
            }
        }
        .padding(3)
        .foleviWell()
        .opacity(isEnabled ? 1 : 0.5)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(accessibilityLabel))
    }
}

// MARK: - Chips, keycaps, labels

/// Small pill for due dates, tags and priorities: soft fill + ink.
struct Chip: View {
    var text: String
    var systemImage: String?
    var tint: Color = FoleviColor.inkMuted
    var fill: Color?

    var body: some View {
        HStack(spacing: 4) {
            if let systemImage { Image(systemName: systemImage).font(.ui(10, .semibold)).accessibilityHidden(true) }
            Text(text).monospacedDigit()
        }
        .font(.ui(11.5, .semibold))
        .foregroundStyle(tint)
        .padding(.horizontal, 8)
        .frame(height: 22)
        .background(Capsule().fill(fill ?? tint.opacity(0.12)))
    }
}

/// Filter chip (Tasks, Calendar…): quiet pill; the active one is a raised white pill.
struct FilterChip: View {
    var title: String
    var count: Int?
    var isActive: Bool
    var action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Text(title)
                if let count, count > 0 {
                    Text("\(count)")
                        .font(.ui(11, .semibold))
                        .monospacedDigit()
                        .padding(.horizontal, 6)
                        .frame(minWidth: 20, minHeight: 18)
                        .background(Capsule().fill(isActive ? FoleviColor.emberSoft : FoleviColor.ink.opacity(0.07)))
                        .foregroundStyle(isActive ? FoleviColor.emberInk : FoleviColor.inkMuted)
                }
            }
            .font(.ui(13, isActive ? .semibold : .medium))
            .foregroundStyle(isActive || hovering ? FoleviColor.heading : FoleviColor.inkMuted)
            .padding(.horizontal, 13)
            .frame(height: 30)
            .background {
                if isActive {
                    Color.clear.foleviSurface(.color(FoleviColor.surfaceRaised), shape: .capsule, shadow: FoleviShadow.control)
                } else {
                    Capsule().fill(hovering ? FoleviColor.accentSoft.opacity(0.8) : .clear)
                }
            }
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .accessibilityAddTraits(isActive ? .isSelected : [])
    }
}

struct Keycap: View {
    var text: String
    var body: some View {
        Text(text)
            .font(.ui(10.5, .semibold))
            .foregroundStyle(FoleviColor.inkMuted)
            .padding(.horizontal, 5)
            .frame(minWidth: 22, minHeight: 20)
            .foleviSurface(.color(FoleviColor.surfaceRaised), shape: .rounded(6), shadow: FoleviDepth.keycap)
            .accessibilityHidden(true)
    }
}

/// Caps section label.
struct CapsLabel: View {
    var title: LocalizedStringKey
    var body: some View {
        Text(title).foleviCapsLabel().accessibilityAddTraits(.isHeader)
    }
}

extension View {
    /// Menus, popovers, the palette: surfaceRaised, radius 14, pop shadow.
    func foleviPop(radius: CGFloat = 14) -> some View {
        foleviSurface(.color(FoleviColor.surfaceRaised), shape: .rounded(radius), shadow: FoleviShadow.pop)
    }

    /// Cards: surface, radius 16, card shadow.
    func foleviCard(radius: CGFloat = FoleviRadius.card, fill: Color = FoleviColor.surface) -> some View {
        foleviSurface(.color(fill), shape: .rounded(radius), shadow: FoleviShadow.card)
    }

    /// Large view title (All Documents, Tasks, Calendar…): 38pt semibold heading, tight tracking.
    func foleviViewTitle(size: CGFloat = 34) -> some View {
        self.font(.ui(size, .semibold))
            .tracking(FoleviTracking.tight * size)
            .foregroundStyle(FoleviColor.heading)
            .lineLimit(1)
            .accessibilityAddTraits(.isHeader)
    }
}

// MARK: - Note card

/// A note in the grid, drawn as a notebook (the web's NoteCardFace): a spine down the left carries the
/// note's style (its artwork thumbnail, or a light grey for plain notes), and the cover shows the title
/// (serif), when it was created, its opening text, and a footer with the last edit and its folder (or
/// Draft). Starred notes get a corner tab. Everything scales with the card's width, as on the web.
struct NoteCard: View {
    var document: DocumentSummary
    var folder: FolderInfo?
    /// The footer time, e.g. "1 hour ago" (edited) or "Deleted 2 days ago"; the last edit by default.
    var time: String? = nil
    /// Templates don't show where they live.
    var showFolder = true
    /// Edits on this Mac the server hasn't confirmed yet.
    var unsynced = false
    @State private var hovering = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var colorScheme

    /// The note's page colours (the card is its cover), or the app's.
    private var palette: SheetPalette? {
        SheetPalette.resolve(style: document.style, cover: document.cover, dark: colorScheme == .dark)
    }
    private var heading: Color { palette?.heading ?? FoleviColor.heading }
    private var faint: Color { palette?.faint ?? FoleviColor.inkFaint }
    private var muted: Color { palette?.muted ?? FoleviColor.inkMuted }

    /// Portrait notebook proportions (25 : 27).
    static let aspect: CGFloat = 25 / 27
    /// rgb(20 20 30), the web's card shadow colour.
    static let shadowInk = Color(red: 20 / 255, green: 20 / 255, blue: 30 / 255)

    var body: some View {
        GeometryReader { geo in
            let u = geo.size.width / 100 // the web's cqw
            let shape = UnevenRoundedRectangle(topLeadingRadius: 0.8 * u, bottomLeadingRadius: 0.8 * u, bottomTrailingRadius: 4.6 * u, topTrailingRadius: 4.6 * u, style: .continuous)
            ZStack(alignment: .topLeading) {
                // The page block, peeking out past the cover's open edge and bottom.
                shape.fill(FoleviColor.heading.mix(with: FoleviColor.canvas, by: 0.87))
                    .padding(.leading, geo.size.width * 0.01)
                    .padding(.top, geo.size.height * 0.014)
                cover(u: u, shape: shape)
                    .padding(.trailing, u)
                    .padding(.bottom, u)
            }
        }
        .aspectRatio(Self.aspect, contentMode: .fit)
        // The web's -4px 18px 30px -18px rgb(20 20 30 / 0.2) (-5px 24px 36px -18px / 0.24 on hover). SwiftUI
        // has no shadow spread, so a shape 18pt smaller on every side casts it: only a soft fall shows under
        // the bottom edge. (A full-size shadow on the card's two layers came out far too dark.)
        .background {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(Color.white)
                .padding(18)
                .shadow(color: Self.shadowInk.opacity(hovering ? 0.24 : 0.2), radius: hovering ? 18 : 15, x: hovering ? -5 : -4, y: hovering ? 24 : 18)
        }
        // 0 2px 5px rgb(20 20 30 / 0.03), the contact shadow, cast once by the card's own outline (a white
        // rectangle behind it showed at the rounded corners).
        .compositingGroup()
        .shadow(color: Self.shadowInk.opacity(hovering ? 0.04 : 0.03), radius: hovering ? 4 : 2.5, y: hovering ? 3 : 2)
        .offset(y: hovering && !reduceMotion ? -2 : 0)
        .animation(reduceMotion ? nil : .timingCurve(0.2, 0.7, 0.2, 1, duration: FoleviMotion.base), value: hovering)
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(document.displayTitle))
        .accessibilityHint(Text("Opens the note"))
    }

    private func cover(u: CGFloat, shape: UnevenRoundedRectangle) -> some View {
        let text = BrowseFormat.previewText(document.preview, excerpt: document.excerpt)
        return HStack(spacing: 0) {
            spine
                .frame(width: 6 * u)
                .overlay(alignment: .trailing) { Color.black.opacity(0.06).frame(width: 1) }
            VStack(alignment: .leading, spacing: 0) {
                Text(document.displayTitle)
                    .font(.serif(6.6 * u, .medium))
                    .tracking(0.005 * 6.6 * u)
                    .foregroundStyle(heading)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.trailing, 7 * u)
                Text(BrowseFormat.ageText(document.createdAt, title: true))
                    .font(.ui(4.5 * u))
                    .foregroundStyle(faint)
                    .lineLimit(1)
                    .padding(.top, u)
                    .accessibilityLabel(Text("Created \(BrowseFormat.ageText(document.createdAt))"))
                Text(text.isEmpty ? String(localized: "Empty page") : text)
                    .font(.ui(3.6 * u))
                    .italic(text.isEmpty)
                    .lineSpacing(1.4 * u)
                    .foregroundStyle(faint)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .padding(.top, 4.6 * u)
                    .clipped()
                footer(u: u)
                    .frame(height: 8.6 * u)
                    .padding(.top, 3.5 * u)
            }
            .padding(EdgeInsets(top: 8 * u, leading: 7 * u, bottom: 6 * u, trailing: 6 * u))
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .background(palette?.surface ?? FoleviColor.surface)
        .clipShape(shape)
        .overlay(shape.strokeBorder(Color.black.opacity(0.05), lineWidth: 1))
        .overlay(alignment: .topTrailing) {
            if document.starred == true {
                Image(systemName: "star.fill")
                    .font(.system(size: 5.6 * u))
                    .foregroundStyle(heading)
                    .frame(width: 12 * u, height: 12 * u)
                    .background(chip, in: UnevenRoundedRectangle(bottomLeadingRadius: 2 * u, style: .continuous))
                    .clipShape(shape)
                    .accessibilityLabel(Text("Starred"))
            }
        }
    }

    /// The spine: a built-in style's thumbnail, else the page's backdrop or cover, or a very light grey for
    /// plain notes (the web's strip).
    @ViewBuilder private var spine: some View {
        if document.cover.kind == .art, document.style.backdrop == nil, let image = CoverArt.thumbnail(document.cover.value) {
            ArtCoverImage(image: image)
        } else if let backdrop = PageBackdrop.resolve(style: document.style, cover: document.cover, artExists: { CoverArt.entry($0) != nil }) {
            PageBackdropView(backdrop: backdrop, blur: false, thumbnail: true)
        } else {
            FoleviColor.heading.mix(with: FoleviColor.canvas, by: 0.93)
        }
    }

    private var chip: Color { (palette?.line ?? FoleviColor.line).opacity(palette == nil ? 0.75 : 0.9) }

    private func footer(u: CGFloat) -> some View {
        HStack(spacing: 2 * u) {
            if unsynced { UnsyncedMarker(size: 3.8 * u) }
            Text(time ?? BrowseFormat.ageText(document.updatedAt))
                .foregroundStyle(muted)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
            if showFolder {
                HStack(spacing: 1.8 * u) {
                    if let folder {
                        FolderGlyph(color: folder.color, size: 4.4 * u)
                    } else {
                        Image(systemName: "pencil.line")
                            .font(.system(size: 3.8 * u, weight: .semibold))
                            .foregroundStyle(heading)
                    }
                    Text(folder?.name ?? String(localized: "Draft"))
                        .fontWeight(.semibold)
                        .foregroundStyle(heading)
                        .lineLimit(1)
                        .accessibilityLabel(Text(folder.map { "In folder \($0.name)" } ?? String(localized: "Draft")))
                }
                .padding(.horizontal, 3 * u)
                .frame(maxHeight: .infinity)
                .background(chip, in: RoundedRectangle(cornerRadius: 1.5 * u, style: .continuous))
                .frame(maxWidth: 55 * u, alignment: .trailing)
                .fixedSize(horizontal: true, vertical: false)
            }
        }
        .font(.ui(3.8 * u))
    }
}

/// The compact card (Compact cards layout), as the web's DocumentCardPreview: the title, and a footer with
/// the folder badge. Tinted and outlined note cards keep their look.
struct CompactNoteCard: View {
    var document: DocumentSummary
    var folder: FolderInfo?
    var showFolder = true
    var unsynced = false
    @State private var hovering = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var accent: Color { Color.folevi(accent: document.style.accent) }
    private var fill: Color {
        switch document.style.card {
        case .tinted: return Color.folevi(accentSoft: document.style.accent).mix(with: FoleviColor.surface, by: 0.4)
        default: return FoleviColor.surface
        }
    }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 6, style: .continuous)
        ZStack(alignment: .topLeading) {
            fill
            Text(document.displayTitle)
                .font(.serif(16.5, .semibold))
                .foregroundStyle(FoleviColor.heading)
                .lineLimit(2)
                .lineSpacing(2)
                .padding(14)
            if unsynced || showFolder {
                HStack(spacing: 8) {
                    if unsynced { UnsyncedMarker() }
                    Spacer(minLength: 0)
                    if showFolder { FolderBadge(folder: folder) }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 14)
                .frame(maxHeight: .infinity, alignment: .bottom)
            }
        }
        .frame(height: 112)
        .frame(maxWidth: .infinity, alignment: .leading)
        .clipShape(shape)
        .overlay {
            if document.style.card == .outline { shape.strokeBorder(accent, lineWidth: 1.5) }
        }
        .overlay(shape.strokeBorder(Color.black.opacity(0.05)))
        .background(Color.clear.foleviSurface(.color(FoleviColor.surface), shape: .rounded(6), shadow: hovering ? FoleviShadow.pop : FoleviShadow.card))
        .offset(y: hovering && !reduceMotion ? -2 : 0)
        .animation(reduceMotion ? nil : .timingCurve(0.2, 0.7, 0.2, 1, duration: FoleviMotion.base), value: hovering)
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
        .accessibilityElement(children: .combine)
    }
}

extension Color {
    /// `#RRGGBB`.
    init?(hex: String) {
        let s = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
        self.init(red: Double((v >> 16) & 255) / 255, green: Double((v >> 8) & 255) / 255, blue: Double(v & 255) / 255)
    }
}

// MARK: - Empty state

struct EmptyStateView: View {
    var systemImage: String
    var title: LocalizedStringKey
    var message: LocalizedStringKey
    var actionTitle: LocalizedStringKey?
    var action: (() -> Void)?

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: systemImage)
                .font(.ui(24, .medium))
                .foregroundStyle(FoleviColor.ember)
                .frame(width: 60, height: 60)
                .foleviSurface(.color(FoleviColor.surfaceRaised), shape: .rounded(18), shadow: FoleviShadow.card)
                .accessibilityHidden(true)
                .padding(.bottom, 4)
            Text(title)
                .font(.ui(FoleviFontSize.xl, .semibold))
                .tracking(FoleviTracking.snug * FoleviFontSize.xl)
                .foregroundStyle(FoleviColor.heading)
                .multilineTextAlignment(.center)
            Text(message)
                .font(.ui(14))
                .lineSpacing(3)
                .foregroundStyle(FoleviColor.inkMuted)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 360)
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .buttonStyle(.folevi(.primary))
                    .padding(.top, 6)
            }
        }
        .padding(40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Chrome background (Liquid Glass on macOS 26+, solid when Reduce Transparency is on)

struct ChromeBackground: ViewModifier {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    func body(content: Content) -> some View {
        if reduceTransparency {
            content.foleviPop(radius: FoleviRadius.round)
        } else {
            content
                .foleviSurface(.color(FoleviColor.surfaceRaised.opacity(0.78)), shape: .capsule, shadow: FoleviShadow.pop, clipShadowInside: true)
                .background(.regularMaterial, in: Capsule(style: .continuous))
        }
    }
}

extension View {
    func foleviChrome() -> some View { modifier(ChromeBackground()) }
}

// MARK: - Text fields

/// Single-line input, as the web's `.ui-input`.
struct FoleviFieldStyle: TextFieldStyle {
    var height: CGFloat = 36
    func _body(configuration: TextField<Self._Label>) -> some View {
        configuration.modifier(FoleviFieldModifier(height: height))
    }
}

private struct FoleviFieldModifier: ViewModifier {
    var height: CGFloat
    @FocusState private var focused: Bool

    func body(content: Content) -> some View {
        content
            .textFieldStyle(.plain)
            .font(.ui(13.5))
            .foregroundStyle(FoleviColor.ink)
            .focused($focused)
            .padding(.horizontal, 12)
            .frame(minHeight: height)
            // `.ui-input`: radius 6, a line ring; focused, the soft 16.5% ink outline (never a dark ring).
            .foleviInputSurface(focused: focused)
    }
}

extension TextFieldStyle where Self == FoleviFieldStyle {
    static var folevi: FoleviFieldStyle { FoleviFieldStyle() }
}
