import AppKit
import SwiftUI

/*
 * The live preview beside onboarding (the web's components/app/onboarding/OnboardingPreview.tsx): a
 * miniature of the person's own Folevi (the app's glass chrome, the page sidebar, the tab strip, Home or
 * their Welcome page, the page tools dock), drawn at a fixed size and scaled to fit, so it follows the
 * theme and updates as they choose. An illustration only: nothing in it is a control, and VoiceOver reads
 * it as one image with a description.
 */

enum PreviewScene: Equatable { case deck, home, note }
enum PreviewHighlight: Equatable { case style, ai }

struct OnboardingPreview: View {
    var scene: PreviewScene
    /// The Welcome page's style (nil: Plain).
    var styleId: String?
    /// Colour behind everything on the stage (a use case being picked, or the Welcome page's style).
    var ambientId: String?
    var pages: [OnboardingChoices.StarterPage]
    var ai: Bool
    var highlight: PreviewHighlight?
    var finished: Bool
    var name: String
    var compact = false
    var label: String

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    fileprivate static let deck: [(id: String, x: CGFloat, y: CGFloat, r: Double)] = [
        ("art-39", -250, 36, -13),
        ("art-30", -126, 10, -6.5),
        ("art-01", 126, 10, 6.5),
        ("art-49", 250, 36, 13),
        ("art-03", 0, -4, 0),
    ]
    fileprivate static let seedPages = ["Field Notes: A Quiet Morning", "Project Atlas Brief", "Trip Sketch: Coastal Weekend", "Reading Shelf"]

    var body: some View {
        let winBase = compact ? CGSize(width: 640, height: 470) : CGSize(width: 920, height: 740)
        ZStack {
            StageBackground(ambientId: ambientId)
            FitToSize(base: CGSize(width: 720, height: 470), pad: compact ? 4 : 30) {
                DeckScene(active: scene == .deck)
            }
            .modifier(SceneVisibility(on: scene == .deck, isDeck: true))
            FitToSize(base: winBase, pad: compact ? 10 : 36) {
                PreviewWindow(scene: scene, styleId: styleId, pages: pages, ai: ai, highlight: highlight, finished: finished,
                              name: name, compact: compact, base: winBase)
            }
            .modifier(SceneVisibility(on: scene != .deck, isDeck: false))
        }
        // Rounded like the web's stage (22 pt beside the form, 16 pt above it), with a soft inner hairline.
        .clipShape(RoundedRectangle(cornerRadius: compact ? 16 : 22, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: compact ? 16 : 22, style: .continuous).strokeBorder(FoleviColor.line.opacity(0.7), lineWidth: 1)
        }
        .allowsHitTesting(false)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(label))
        .accessibilityAddTraits(.isImage)
    }
}

// MARK: - Stage

/// The stage: the app canvas's neutral ambient light, the artwork of the moment heavily blurred behind
/// everything (cross-fading as it changes), and the glass veil over it.
private struct StageBackground: View {
    var ambientId: String?

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            ZStack {
                FoleviGlass.canvas
                RadialLight(color: FoleviGlass.lightA).frame(width: w * 1.4, height: h * 1.2).position(x: w * 0.85, y: -0.1 * h)
                RadialLight(color: FoleviGlass.lightB).frame(width: w * 1.2, height: h * 1.4).position(x: -0.1 * w, y: 1.1 * h)
                ZStack {
                    if let id = ambientId, let image = CoverArt.thumbnail(id) {
                        Image(nsImage: image)
                            .resizable()
                            .aspectRatio(contentMode: .fill)
                            .frame(width: w + 160, height: h + 160)
                            .blur(radius: 60)
                            .saturation(1.35)
                            .opacity(0.95)
                            .position(x: w / 2, y: h / 2)
                            .id(id)
                            .transition(.asymmetric(insertion: .opacity.combined(with: .scale(scale: 1.08)), removal: .opacity))
                    }
                }
                .animation(OnboardingMotion.ease(0.9), value: ambientId)
                FoleviGlass.veil
            }
            .frame(width: w, height: h)
            .clipped()
        }
    }
}

/// `radial-gradient(… , color, transparent 70%)` filling its frame.
private struct RadialLight: View {
    var color: Color
    var body: some View {
        EllipticalGradient(gradient: Gradient(stops: [.init(color: color, location: 0), .init(color: color.opacity(0), location: 0.7)]),
                           center: .center, startRadiusFraction: 0, endRadiusFraction: 0.5)
    }
}

/// Scales a fixed-size drawing to fit its container, kept crisp (the drawing is laid out at full size):
/// the web's useFit.
private struct FitToSize<Content: View>: View {
    var base: CGSize
    var pad: CGFloat
    @ViewBuilder var content: Content

    var body: some View {
        GeometryReader { geo in
            let scale = max(0.2, min((geo.size.width - pad * 2) / base.width, (geo.size.height - pad * 2) / base.height, 1.1))
            content
                .frame(width: base.width, height: base.height)
                .scaleEffect(scale)
                .position(x: geo.size.width / 2, y: geo.size.height / 2)
        }
    }
}

/// A scene fades and settles in, and steps back as it leaves (`.ob-scene`).
private struct SceneVisibility: ViewModifier {
    var on: Bool
    var isDeck: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        let still = on || reduceMotion
        content
            .animation(on ? OnboardingMotion.ease(0.82) : OnboardingMotion.ease(0.62)) {
                $0.scaleEffect(still ? 1 : isDeck ? 1.06 : 0.94).offset(y: still || isDeck ? 0 : 12)
            }
            .animation(on ? OnboardingMotion.ease(0.62) : OnboardingMotion.ease(0.42)) {
                $0.opacity(on ? 1 : 0)
            }
    }
}

// MARK: - Deck

/// The intro: five note styles fanned out like cards, dealt in, then floating gently.
private struct DeckScene: View {
    var active: Bool
    @State private var dealt = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 30, paused: !active || reduceMotion)) { context in
            let t = context.date.timeIntervalSinceReferenceDate
            ZStack {
                ForEach(Array(OnboardingPreview.deck.enumerated()), id: \.element.id) { i, card in
                    let on = dealt || reduceMotion
                    DeckCard(id: card.id, trailing: card.x > 0)
                        .scaleEffect(on ? 1 : 0.9)
                        .rotationEffect(.degrees(on ? card.r : 0))
                        .offset(x: on ? card.x : 0, y: on ? card.y : 60)
                        .opacity(on ? 1 : 0)
                        .animation(reduceMotion ? nil : OnboardingMotion.ease(0.9).delay(Double(i) * 0.09 + 0.12), value: dealt)
                        .offset(y: active && !reduceMotion ? float(t, i) : 0)
                        .zIndex(i == 4 ? 5 : i < 2 ? Double(i) : Double(4 - i))
                }
            }
            .frame(width: 720, height: 470)
        }
        .task { dealt = true }
    }

    /// `ob-float`: up 8 pt and back over 7 s (ease-in-out, alternate), each card 1.3 s ahead of the last.
    private func float(_ t: TimeInterval, _ i: Int) -> CGFloat {
        let phase = ((t + Double(i) * 1.3) / 7).truncatingRemainder(dividingBy: 2)
        let p = phase < 1 ? phase : 2 - phase
        return CGFloat(-8 * (1 - cos(.pi * p)) / 2)
    }
}

private struct DeckCard: View {
    var id: String
    var trailing: Bool

    var body: some View {
        let art = CoverArt.entry(id)
        let shape = RoundedRectangle(cornerRadius: 14, style: .continuous)
        VStack(spacing: 0) {
            PreviewArt(id: id, large: false)
            VStack(alignment: trailing ? .trailing : .leading, spacing: 1) {
                Text(art?.name ?? "").font(FoleviType.display(19)).tracking(FoleviType.displayTracking(19)).lineLimit(1)
                Text("Note style").font(.ui(11.5)).opacity(0.7)
            }
            .foregroundStyle(art?.ink.flatMap { Color(hex: $0) } ?? FoleviColor.ink)
            .padding(.horizontal, 16)
            .frame(maxWidth: .infinity, alignment: trailing ? .trailing : .leading)
            .frame(height: 64)
            .background(art?.paper.flatMap { Color(hex: $0) } ?? FoleviColor.surface)
        }
        .frame(width: 200, height: 270)
        .background(FoleviColor.surface)
        .clipShape(shape)
        .previewSurface(.clear, radius: 14, shadows: [
            .ring(.black.opacity(0.06)),
            PreviewShadow(y: 30, blur: 60, spread: -24, color: .black.opacity(0.45)),
            PreviewShadow(y: 10, blur: 20, spread: -10, color: .black.opacity(0.2)),
        ])
    }
}

/// A note style's artwork filling its frame (the thumbnail, or the 1600 px page for large areas).
private struct PreviewArt: View {
    var id: String
    var large: Bool

    var body: some View {
        if let image = large ? (CoverArt.image(id) ?? CoverArt.thumbnail(id)) : CoverArt.thumbnail(id) {
            Image(nsImage: image)
                .resizable()
                .interpolation(.high)
                .aspectRatio(contentMode: .fill)
                .frame(minWidth: 0, maxWidth: .infinity, minHeight: 0, maxHeight: .infinity)
                .clipped()
        } else {
            FoleviColor.surfaceSunken
        }
    }
}

// MARK: - Window

private struct PreviewWindow: View {
    var scene: PreviewScene
    var styleId: String?
    var pages: [OnboardingChoices.StarterPage]
    var ai: Bool
    var highlight: PreviewHighlight?
    var finished: Bool
    var name: String
    var compact: Bool
    var base: CGSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let note = scene == .note
        let shape = RoundedRectangle(cornerRadius: 18, style: .continuous)
        let lifted = finished && !reduceMotion
        ZStack {
            FoleviGlass.canvas
            // The note's artwork lights the window while the note is open (`.ob-win-ambient`).
            ZStack {
                if note, let id = styleId, let image = CoverArt.thumbnail(id) {
                    Image(nsImage: image)
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                        .frame(width: base.width + 192, height: base.height + 192)
                        .blur(radius: 56)
                        .saturation(1.4)
                        .id(id)
                        .transition(.opacity)
                }
            }
            .animation(OnboardingMotion.ease(0.8), value: note ? styleId : nil)
            FoleviGlass.veil
            HStack(spacing: 8) {
                if !compact {
                    PreviewSidebar(pages: pages, note: note, name: name)
                }
                VStack(spacing: 8) {
                    PreviewTabs(note: note, compact: compact)
                    ZStack {
                        PreviewHome(pages: pages, art: styleId, ai: ai, compact: compact)
                            .modifier(ViewVisibility(on: !note))
                        PreviewNotePage(styleId: styleId, ai: ai, highlight: highlight, compact: compact)
                            .modifier(ViewVisibility(on: note))
                    }
                }
            }
            .padding(8)
            if finished && !reduceMotion {
                Sheen()
            }
        }
        .frame(width: base.width, height: base.height)
        .clipShape(shape)
        .font(.ui(13))
        .foregroundStyle(FoleviColor.ink)
        .previewSurface(.clear, radius: 18, shadows: PreviewShadow.from(FoleviShadow.lift) + [PreviewShadow(y: 50, blur: 100, spread: -40, color: .black.opacity(0.35))])
        .scaleEffect(lifted ? 1.015 : 1)
        .offset(y: lifted ? -6 : 0)
        .animation(OnboardingMotion.ease(0.7), value: lifted)
    }
}

/// Home and the note cross-fade inside the window (`.ob-view`).
private struct ViewVisibility: ViewModifier {
    var on: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .animation(OnboardingMotion.ease(0.62)) { $0.scaleEffect(on || reduceMotion ? 1 : 0.985) }
            .animation(OnboardingMotion.ease(0.48)) { $0.opacity(on ? 1 : 0) }
    }
}

/// A light sweep across the finished preview, once.
private struct Sheen: View {
    @State private var x: CGFloat = -1.2

    var body: some View {
        GeometryReader { geo in
            LinearGradient(stops: [
                .init(color: .white.opacity(0), location: 0.35),
                .init(color: .white.opacity(0.28), location: 0.5),
                .init(color: .white.opacity(0), location: 0.65),
            ], startPoint: UnitPoint(x: 0.017, y: 0.371), endPoint: UnitPoint(x: 0.983, y: 0.629))
            .offset(x: x * geo.size.width)
        }
        .onAppear {
            withAnimation(OnboardingMotion.ease(1.4).delay(0.5)) { x = 1.2 }
        }
    }
}

// MARK: - Sidebar

private struct PreviewSidebar: View {
    var pages: [OnboardingChoices.StarterPage]
    var note: Bool
    var name: String

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 4) {
                FoleviLogo(height: 22).foregroundStyle(FoleviColor.heading)
                Spacer(minLength: 0)
                Image(systemName: "bell").font(.system(size: 13)).foregroundStyle(FoleviColor.inkMuted).frame(width: 28, height: 28)
                Image(systemName: "sidebar.left").font(.system(size: 13)).foregroundStyle(FoleviColor.inkMuted).frame(width: 28, height: 28)
            }
            .padding(.horizontal, 8)
            .frame(height: 40)

            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").font(.system(size: 11.5))
                Text("Search or jump to…").lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                Text("⌘K")
                    .font(.ui(10, .semibold))
                    .padding(.horizontal, 4)
                    .frame(height: 18)
                    .background(FoleviColor.surfaceRaised, in: RoundedRectangle(cornerRadius: 5, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 5, style: .continuous).strokeBorder(FoleviColor.line, lineWidth: 1))
            }
            .font(.ui(12))
            .foregroundStyle(FoleviColor.inkMuted)
            .padding(.leading, 10)
            .padding(.trailing, 6)
            .frame(height: 32)
            .background(FoleviGlass.hover, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(FoleviGlass.border, lineWidth: 1))
            .padding(.horizontal, 4)
            .padding(.top, 4)

            VStack(spacing: 2) {
                row(icon: "house", label: String(localized: "Home"), on: !note)
                row(icon: "star", label: String(localized: "Starred"))
                row(icon: "doc.on.doc", label: String(localized: "All notes"))
                row(icon: "checklist", label: String(localized: "Tasks"))
                row(icon: "square.on.square.dashed", label: String(localized: "Templates"))
            }
            .padding(.horizontal, 4)
            .padding(.top, 12)

            PreviewCaps(text: String(localized: "Pages")).padding(.horizontal, 14).padding(.top, 16)

            VStack(spacing: 2) {
                row(icon: "doc.text", label: OnboardingChoices.welcomeTitle, on: note, iconSize: 12.5)
                ForEach(Array(pages.enumerated()), id: \.element.template) { i, page in
                    HStack(spacing: 10) {
                        TemplateTile(name: page.icon, size: 18, iconSize: 10, cornerRadius: 5)
                        Text(page.title).lineLimit(1)
                        Spacer(minLength: 0)
                    }
                    .font(.ui(12.5))
                    .padding(.horizontal, 10)
                    .frame(height: 32)
                    .onboardingArrive(i % 2)
                }
                ForEach(OnboardingPreview.seedPages, id: \.self) { title in
                    row(icon: "doc.text", label: title, iconSize: 12.5)
                }
            }
            .padding(.horizontal, 4)
            .padding(.top, 4)
            .frame(maxHeight: .infinity, alignment: .top)
            .clipped()
            .mask(LinearGradient(stops: [.init(color: .black, location: 0), .init(color: .black, location: 0.78), .init(color: .clear, location: 1)],
                                 startPoint: .top, endPoint: .bottom))

            row(icon: "archivebox", label: String(localized: "Archive"))
                .padding(.horizontal, 4)
                .padding(.top, 8)

            HStack(spacing: 10) {
                Text(initial)
                    .font(.ui(11, .semibold))
                    .foregroundStyle(FoleviColor.canvas)
                    .frame(width: 28, height: 28)
                    .background(Circle().fill(FoleviColor.heading))
                VStack(alignment: .leading, spacing: 0) {
                    Text(name).font(.ui(12.5, .semibold)).foregroundStyle(FoleviColor.heading).lineLimit(1)
                    Text("Personal").font(.ui(11)).foregroundStyle(FoleviColor.inkMuted).lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 8)
            .padding(.top, 8)
            .padding(.bottom, 4)
        }
        .frame(width: 228)
    }

    private var initial: String {
        name.trimmingCharacters(in: .whitespacesAndNewlines).first.map { String($0).uppercased() } ?? "F"
    }

    private func row(icon: String, label: String, on: Bool = false, iconSize: CGFloat = 13) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon).font(.system(size: iconSize)).foregroundStyle(on ? FoleviColor.heading : FoleviColor.inkMuted).frame(width: 15)
            Text(label).lineLimit(1)
            Spacer(minLength: 0)
        }
        .font(.ui(12.5, on ? .semibold : .regular))
        .foregroundStyle(on ? FoleviColor.heading : FoleviColor.ink)
        .padding(.horizontal, 10)
        .frame(height: 32)
        .background {
            if on {
                Color.clear.previewSurface(FoleviGlass.active, radius: 6, inner: PreviewRecipe.edgeInner,
                                           shadows: [.ring(PreviewRecipe.edgeRing), PreviewShadow(y: 1, blur: 3, color: .black.opacity(0.06))])
            }
        }
    }
}

/// `.ui-caps` at the preview's size.
private struct PreviewCaps: View {
    var text: String
    var body: some View {
        Text(text)
            .font(.ui(10.5, .semibold))
            .textCase(.uppercase)
            .tracking(FoleviTracking.caps * 10.5)
            .foregroundStyle(FoleviColor.inkFaint)
    }
}

// MARK: - Tabs

private struct PreviewTabs: View {
    var note: Bool
    var compact: Bool
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: compact ? "sidebar.left" : "arrow.up")
                .font(.system(size: 13))
                .foregroundStyle(FoleviColor.inkMuted)
                .frame(width: 32, height: 32)
            FoleviColor.lineStrong.opacity(0.6).frame(width: 1, height: 20)
            tab(on: !note) {
                Image(systemName: "house").font(.system(size: 11.5))
                Text("Home")
            }
            .fixedSize()
            tab(on: note) {
                Image(systemName: "doc.text").font(.system(size: 11.5)).opacity(0.7)
                Text(OnboardingChoices.welcomeTitle).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: "xmark").font(.system(size: 9, weight: .semibold)).foregroundStyle(FoleviColor.inkFaint)
            }
            .frame(maxWidth: 220)
            Spacer(minLength: 0)
            HStack(spacing: 6) {
                Image(systemName: "plus").font(.system(size: 12, weight: .semibold))
                Text("New note")
            }
            .font(.ui(12.5, .semibold))
            .foregroundStyle(FoleviColor.accentInk)
            .padding(.horizontal, 12)
            .frame(height: 32)
            .previewSurface(FoleviColor.accent, radius: 16, shadows: PreviewShadow.from(FoleviShadow.primary))
        }
        .padding(.horizontal, 6)
        .frame(height: 44)
        .previewSurface(reduceTransparency ? FoleviColor.surfaceRaised : FoleviGlass.sidebar, radius: 12, inner: PreviewRecipe.edgeInner,
                        shadows: [.ring(PreviewRecipe.edgeRing)] + PreviewRecipe.glassShadow)
    }

    private func tab<Content: View>(on: Bool, @ViewBuilder content: () -> Content) -> some View {
        HStack(spacing: 8) { content() }
            .font(.ui(12.5, on ? .semibold : .regular))
            .foregroundStyle(on ? FoleviColor.heading : FoleviColor.inkMuted)
            .padding(.horizontal, 10)
            .frame(height: 30)
            .background {
                let shape = RoundedRectangle(cornerRadius: 6, style: .continuous)
                if on {
                    shape.fill(FoleviColor.surfaceRaised)
                        .overlay(shape.strokeBorder(FoleviColor.heading.opacity(0.165), lineWidth: 1.5))
                        .shadow(color: .black.opacity(0.1), radius: 1.5, y: 1)
                } else {
                    shape.fill(FoleviGlass.hover)
                }
            }
    }
}

// MARK: - Home

private struct PreviewHome: View {
    var pages: [OnboardingChoices.StarterPage]
    var art: String?
    var ai: Bool
    var compact: Bool
    @Environment(\.colorScheme) private var colorScheme

    private enum Card: Identifiable {
        case page(OnboardingChoices.StarterPage, Int)
        case welcome
        case seed(String)
        var id: String {
            switch self {
            case .page(let p, _): return "page:" + p.template
            case .welcome: return "welcome"
            case .seed(let t): return "seed:" + t
            }
        }
    }

    /// Up to two rows: the newest starter pages, the Welcome page, then the seed pages that still fit.
    private var cards: [Card] {
        let cols = compact ? 2 : 3
        var cards: [Card] = []
        for (i, page) in pages.prefix(cols * 2 - 1).enumerated() { cards.append(.page(page, i)) }
        cards.append(.welcome)
        for title in OnboardingPreview.seedPages.prefix(max(0, cols * 2 - 1 - pages.count)) { cards.append(.seed(title)) }
        return cards
    }

    var body: some View {
        let cols = compact ? 2 : 3
        VStack(alignment: .leading, spacing: 0) {
            Text("Home")
                .font(FoleviType.display(30))
                .tracking(FoleviType.displayTracking(30))
                .foregroundStyle(FoleviColor.heading)
            HStack(spacing: 8) {
                AiIcon(size: 14)
                Text("Catch me up")
            }
            .font(.ui(12.5, .semibold))
            .foregroundStyle(FoleviColor.heading)
            .padding(.horizontal, 14)
            .frame(height: 36)
            .previewSurface(FoleviGlass.active, radius: 8, inner: PreviewRecipe.edgeInner,
                            shadows: [.ring(PreviewRecipe.edgeRing), PreviewShadow(y: 1, blur: 3, color: .black.opacity(0.06))])
            .opacity(ai ? 1 : 0)
            .animation(OnboardingMotion.ease(0.5), value: ai)
            .padding(.top, 16)
            PreviewCaps(text: String(localized: "Recent notes")).padding(.top, 24)
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: cols), spacing: 12) {
                ForEach(cards) { card in
                    switch card {
                    case .page(let page, let i): pageCard(page).onboardingArrive(i % 2)
                    case .welcome: welcomeCard
                    case .seed(let title): seedCard(title)
                    }
                }
            }
            .padding(.top, 10)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 32)
        .padding(.top, 28)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .previewSurface(FoleviGlass.content, radius: 14, inner: PreviewRecipe.edgeInner, shadows: [.ring(PreviewRecipe.edgeRing)] + PreviewRecipe.glassShadow)
    }

    private var plain: NoteColors { NoteColors(art: nil, dark: colorScheme == .dark) }

    private func pageCard(_ page: OnboardingChoices.StarterPage) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                TemplateTile(name: page.icon, size: 24, iconSize: 12, cornerRadius: 6)
                Text("Just now").font(.ui(11)).foregroundStyle(FoleviColor.inkMuted)
            }
            Text(page.title).font(FoleviType.display(16)).tracking(-0.01 * 16).foregroundStyle(plain.heading).lineLimit(1).padding(.top, 10)
            Bar(fraction: 0.8).padding(.top, 10)
            Bar(fraction: 0.6).padding(.top, 6)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(height: 132)
        .previewSurface(plain.paper, radius: 8, inner: nil, shadows: PreviewShadow.from(FoleviShadow.card))
    }

    private var welcomeCard: some View {
        let colors = NoteColors(art: art, dark: colorScheme == .dark)
        return HStack(spacing: 0) {
            ZStack {
                FoleviColor.surfaceSunken
                if let art {
                    PreviewArt(id: art, large: false).id(art).transition(.opacity)
                }
            }
            .frame(width: 14)
            .clipped()
            VStack(alignment: .leading, spacing: 0) {
                Text(OnboardingChoices.welcomeTitle).font(FoleviType.display(16)).tracking(-0.01 * 16).foregroundStyle(colors.heading).lineLimit(1)
                Text(OnboardingChoices.styleName(art)).font(.ui(11)).foregroundStyle(colors.muted).padding(.top, 2)
                Text("A quiet place for ideas that keep growing.").font(.ui(11.5)).lineSpacing(2).foregroundStyle(colors.ink).lineLimit(2).padding(.top, 8)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(height: 132)
        .background(colors.paper)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .previewSurface(.clear, radius: 8, shadows: PreviewShadow.from(FoleviShadow.card))
        .animation(OnboardingMotion.ease(0.5), value: art)
    }

    private func seedCard(_ title: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title).font(FoleviType.display(16)).tracking(-0.01 * 16).foregroundStyle(plain.heading).lineLimit(2).lineSpacing(1)
            Spacer(minLength: 0)
            Bar(fraction: 0.8)
            Bar(fraction: 0.6).padding(.top, 6)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(height: 132)
        .previewSurface(plain.paper, radius: 8, shadows: PreviewShadow.from(FoleviShadow.card))
    }
}

/// A line of placeholder text.
private struct Bar: View {
    var fraction: CGFloat
    var body: some View {
        GeometryReader { geo in
            Capsule().fill(FoleviColor.ink.opacity(0.12)).frame(width: geo.size.width * fraction)
        }
        .frame(height: 6)
    }
}

// MARK: - The Welcome note

/// A note's colours for a style, like the editor (`.ob-note`: paper, ink, accent, highlight; the heading and
/// muted colours mixed from them). Plain uses the theme's surface and ink.
private struct NoteColors {
    var paper: Color
    var ink: Color
    var accent: Color
    var highlight: Color
    var heading: Color
    var muted: Color

    @MainActor
    init(art id: String?, dark: Bool) {
        let art = id.flatMap { CoverArt.entry($0) }
        let hex: (String?) -> Color? = { $0.flatMap { Color(hex: $0) } }
        paper = hex(dark ? art?.paperDark : art?.paper) ?? FoleviColor.surface
        ink = hex(dark ? art?.inkDark : art?.ink) ?? FoleviColor.ink
        accent = hex(dark ? art?.accentDark : art?.accent) ?? FoleviColor.heading
        highlight = hex(dark ? art?.highlightDark?[safe: 2] : art?.highlight?[safe: 2]) ?? FoleviColor.highlightBlue
        heading = dark ? ink.mix(with: .white, by: 0.2) : ink.mix(with: .black, by: 0.12)
        muted = ink.mix(with: paper, by: dark ? 0.28 : 0.3)
    }
}

private extension Array {
    subscript(safe index: Int) -> Element? { indices.contains(index) ? self[index] : nil }
}

private struct PreviewNotePage: View {
    var styleId: String?
    var ai: Bool
    var highlight: PreviewHighlight?
    var compact: Bool
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        GeometryReader { geo in
            let colors = NoteColors(art: styleId, dark: colorScheme == .dark)
            ZStack(alignment: .top) {
                // The page behind the note: its artwork, cross-fading.
                ZStack {
                    if let id = styleId {
                        PreviewArt(id: id, large: true).id(id).transition(.opacity)
                    }
                }
                .frame(width: geo.size.width, height: geo.size.height)
                .animation(OnboardingMotion.ease(0.7), value: styleId)

                article(colors)
                    .frame(width: compact ? geo.size.width * 0.88 : 620, height: geo.size.height - 20 + 16, alignment: .top)
                    .offset(y: 20)

                AskPanel(on: ai && highlight == .ai, compact: compact)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: compact ? .bottom : .bottomTrailing)
                    .padding(.bottom, 64)
                    .padding(.horizontal, compact ? 16 : 24)
                PreviewDock(ai: ai, highlight: highlight, compact: compact)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                    .padding(.bottom, 16)
            }
            .frame(width: geo.size.width, height: geo.size.height, alignment: .top)
        }
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .previewSurface(FoleviGlass.content, radius: 14, inner: PreviewRecipe.edgeInner, shadows: [.ring(PreviewRecipe.edgeRing)] + PreviewRecipe.glassShadow)
    }

    private func article(_ c: NoteColors) -> some View {
        let shape = RoundedRectangle(cornerRadius: 12, style: .continuous)
        let size: CGFloat = 13.5
        return VStack(alignment: .leading, spacing: 0) {
            ZStack {
                if let id = styleId, let image = CoverArt.image(id) ?? CoverArt.thumbnail(id) {
                    ArtCoverImage(image: image)
                        .id(id)
                        .transition(.asymmetric(insertion: .opacity.combined(with: .scale(scale: 1.04)), removal: .opacity))
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: styleId == nil ? 0 : compact ? 110 : 150)
            .clipped()

            VStack(alignment: .leading, spacing: 0) {
                Text(OnboardingChoices.welcomeTitle)
                    .font(FoleviType.display(compact ? 26 : 34))
                    .tracking(-0.012 * (compact ? 26 : 34))
                    .foregroundStyle(c.heading)
                Text("Folevi is a quiet place for ideas that keep growing. Start with a loose thought, give it shape when you are ready, and find it again when you need it.")
                    .padding(.top, 12)
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: "asterisk").font(.system(size: 11, weight: .semibold)).foregroundStyle(c.accent).padding(.top, 4)
                    Text("Everything you type here is saved as you go.")
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(c.highlight.mix(with: c.paper, by: 0.3), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .padding(.top, 12)
                heading("Capture in three seconds", c).padding(.top, 16)
                bullet(Text("Type ") + Text("/").font(.ui(size, .semibold)).foregroundStyle(c.accent) + Text(" on an empty line for headings, checklists and tables."), c)
                    .padding(.top, 6)
                bullet(Text("Type ") + Text("[[").font(.ui(size, .semibold)).foregroundStyle(c.accent) + Text(" to link to another page."), c)
                    .padding(.top, 4)
                heading("Try these", c).padding(.top, 16)
                HStack(spacing: 10) {
                    RoundedRectangle(cornerRadius: 4, style: .continuous)
                        .strokeBorder(c.ink.mix(with: c.paper, by: 0.6), lineWidth: 1.5)
                        .frame(width: 15, height: 15)
                    Text("Add a task with Quick Add")
                }
                .padding(.top, 6)
                HStack(spacing: 10) {
                    OnboardingCheckShape()
                        .stroke(c.paper, style: StrokeStyle(lineWidth: 1.5, lineCap: .round, lineJoin: .round))
                        .frame(width: 10, height: 10)
                        .frame(width: 15, height: 15)
                        .background(c.accent, in: RoundedRectangle(cornerRadius: 4, style: .continuous))
                    Text("Open Folevi for the first time").strikethrough().foregroundStyle(c.muted)
                }
                .padding(.top, 4)
            }
            .font(.serif(size))
            .lineSpacing(size * 0.4)
            .foregroundStyle(c.ink)
            .padding(.horizontal, compact ? 24 : 48)
            .padding(.top, styleId == nil ? 36 : 20)
            .padding(.bottom, 96)
            .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .background(c.paper)
        .clipShape(shape)
        .previewSurface(.clear, radius: 12, shadows: PreviewShadow.from(FoleviShadow.sheet))
        .animation(OnboardingMotion.ease(0.6), value: styleId)
    }

    private func heading(_ text: LocalizedStringKey, _ c: NoteColors) -> some View {
        Text(text).font(FoleviType.display(19)).tracking(-0.01 * 19).foregroundStyle(c.heading)
    }

    private func bullet(_ text: Text, _ c: NoteColors) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text("•").foregroundStyle(c.accent)
            text
        }
    }
}

// MARK: - Dock and Ask AI

private struct PreviewDock: View {
    var ai: Bool
    var highlight: PreviewHighlight?
    var compact: Bool
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    var body: some View {
        HStack(spacing: 2) {
            item(id: .ai, label: String(localized: "AI"), hidden: !ai) {
                AiIcon(size: 14)
                    .rotationEffect(.degrees(ai ? 0 : -45))
                    .scaleEffect(ai ? 1 : 0.86)
                    .grayscale(ai ? 0 : 1)
            }
            item(id: nil, label: String(localized: "Insert")) { Image(systemName: "plus").font(.system(size: 12)) }
            item(id: nil, label: String(localized: "Format")) { Image(systemName: "textformat").font(.system(size: 12)) }
            item(id: .style, label: String(localized: "Style")) { Image(systemName: "paintbrush.pointed").font(.system(size: 12)) }
            item(id: nil, label: String(localized: "Info")) { Image(systemName: "info.circle").font(.system(size: 12)) }
            if !compact {
                FoleviColor.lineStrong.opacity(0.6).frame(width: 1, height: 20).padding(.horizontal, 4)
                icon("bubble.left")
                icon("square.and.arrow.up")
            }
            icon("ellipsis")
        }
        .padding(4)
        .fixedSize()
        .previewSurface(reduceTransparency ? FoleviColor.surfaceRaised : FoleviColor.surfaceRaised.opacity(0.94), radius: 12,
                        inner: PreviewRecipe.edgeInner, shadows: [.ring(PreviewRecipe.edgeRing)] + PreviewShadow.from(FoleviShadow.pop))
        .animation(OnboardingMotion.ease(0.5), value: ai)
        .animation(OnboardingMotion.ease(0.5), value: highlight)
    }

    private func icon(_ name: String) -> some View {
        Image(systemName: name).font(.system(size: 12)).foregroundStyle(FoleviColor.ink).frame(width: 32, height: 32)
    }

    private func item<Icon: View>(id: PreviewHighlight?, label: String, hidden: Bool = false, @ViewBuilder icon: () -> Icon) -> some View {
        let on = id != nil && highlight == id
        return HStack(spacing: 6) {
            icon()
            if !compact || on {
                Text(label)
            }
        }
        .font(.ui(12.5, .medium))
        .foregroundStyle(on ? FoleviColor.accentInk : FoleviColor.ink)
        .padding(.horizontal, hidden ? 0 : 10)
        .frame(height: 32)
        .fixedSize()
        .frame(width: hidden ? 0 : nil, alignment: .leading)
        .clipped()
        .opacity(hidden ? 0 : 1)
        .background {
            if on {
                Color.clear.previewSurface(FoleviColor.accent, radius: 8, shadows: PreviewShadow.from(FoleviShadow.primary))
            }
        }
    }
}

/// The Ask AI panel, floating above the dock, with one question and its answer.
private struct AskPanel: View {
    var on: Bool
    var compact: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                AiIcon(size: 15)
                Text("Ask AI").font(.ui(13.5, .semibold)).foregroundStyle(FoleviColor.heading).frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: "xmark").font(.system(size: 11, weight: .medium)).foregroundStyle(FoleviColor.inkMuted)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .overlay(alignment: .bottom) { FoleviColor.line.frame(height: 1) }
            VStack(alignment: .leading, spacing: 8) {
                Text("What should I try first?")
                    .foregroundStyle(FoleviColor.canvas)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(FoleviColor.heading, in: UnevenRoundedRectangle(topLeadingRadius: 12, bottomLeadingRadius: 12, bottomTrailingRadius: 4, topTrailingRadius: 12, style: .continuous))
                    .frame(maxWidth: .infinity, alignment: .trailing)
                VStack(alignment: .leading, spacing: 8) {
                    Text("Start with the Try these list on your Welcome page: add a task with Quick Add, then give it a due date.")
                        .lineSpacing(3)
                        .fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: 4) {
                        Image(systemName: "doc.text").font(.system(size: 9.5))
                        Text(OnboardingChoices.welcomeTitle)
                    }
                    .font(.ui(11))
                    .foregroundStyle(FoleviColor.inkMuted)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(FoleviGlass.hover, in: Capsule())
                }
                .foregroundStyle(FoleviColor.ink)
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background {
                    let shape = UnevenRoundedRectangle(topLeadingRadius: 12, bottomLeadingRadius: 4, bottomTrailingRadius: 12, topTrailingRadius: 12, style: .continuous)
                    shape.fill(FoleviGlass.active).overlay(shape.strokeBorder(PreviewRecipe.edgeInner, lineWidth: 1))
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
        }
        .font(.ui(12.5))
        .frame(width: compact ? nil : 330)
        .frame(maxWidth: compact ? .infinity : nil)
        .previewSurface(reduceTransparency ? FoleviColor.surfaceRaised : FoleviColor.surfaceRaised.opacity(0.94), radius: 16, inner: PreviewRecipe.edgeInner, shadows: [.ring(PreviewRecipe.edgeRing)] + PreviewShadow.from(FoleviShadow.pop))
        .animation(reduceMotion ? nil : OnboardingMotion.spring(0.52)) {
            $0.scaleEffect(on || reduceMotion ? 1 : 0.96, anchor: .bottom).offset(y: on || reduceMotion ? 0 : 14)
        }
        .animation(OnboardingMotion.ease(0.42)) { $0.opacity(on ? 1 : 0) }
    }
}

// MARK: - Surfaces drawn in SwiftUI

/*
 * The preview is scaled as a whole, so its surfaces are drawn with SwiftUI shapes (FoleviSurface is a
 * layer-backed view, kept for the full-size UI). A shadow here is the CSS box-shadow: the shape grown by
 * its spread, offset and blurred, shown only outside the shape.
 */

private struct PreviewShadow {
    var x: CGFloat = 0
    var y: CGFloat = 0
    var blur: CGFloat = 0
    var spread: CGFloat = 0
    var color: Color

    /// A hairline ring (`0 0 0 1px color`).
    static func ring(_ color: Color, width: CGFloat = 1) -> PreviewShadow { PreviewShadow(spread: width, color: color) }

    /// The outer layers of a token shadow.
    static func from(_ layers: [FoleviShadowLayer]) -> [PreviewShadow] {
        layers.filter { !$0.inset }.map { PreviewShadow(x: $0.x, y: $0.y, blur: $0.blur, spread: $0.spread, color: $0.color) }
    }
}

/// The glass recipes from globals.css (`--glass-edge`, `--glass-shadow`).
private enum PreviewRecipe {
    static let edgeInner = Color(nsColor: .folevi(light: (1, 1, 1, 0.6), dark: (1, 1, 1, 0.08), name: "folevi.onboarding.edge.inner"))
    static let edgeRing = Color(nsColor: .folevi(light: (0, 0, 0, 0.06), dark: (0, 0, 0, 0.4), name: "folevi.onboarding.edge.ring"))
    static let glassShadow: [PreviewShadow] = [
        PreviewShadow(y: 1, blur: 2, color: Color(nsColor: .folevi(light: (0, 0, 0, 0.04), dark: (0, 0, 0, 0.3), name: "folevi.onboarding.glass.0"))),
        PreviewShadow(y: 14, blur: 36, spread: -13, color: Color(nsColor: .folevi(light: (0.078, 0.078, 0.157, 0.14), dark: (0, 0, 0, 0.6), name: "folevi.onboarding.glass.1"))),
    ]
}

private struct PreviewSurfaceBackground: View {
    var fill: Color
    var radius: CGFloat
    var inner: Color?
    var shadows: [PreviewShadow]

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        ZStack {
            ZStack {
                ForEach(shadows.indices, id: \.self) { i in
                    let s = shadows[i]
                    RoundedRectangle(cornerRadius: max(0, radius + s.spread), style: .continuous)
                        .fill(s.color)
                        .padding(-s.spread)
                        .blur(radius: s.blur / 2)
                        .offset(x: s.x, y: s.y)
                }
            }
            // Only outside the shape, as box-shadow draws.
            .mask {
                ZStack {
                    Rectangle().padding(-200)
                    shape.blendMode(.destinationOut)
                }
                .compositingGroup()
            }
            shape.fill(fill)
            if let inner {
                shape.strokeBorder(inner, lineWidth: 1)
            }
        }
        .allowsHitTesting(false)
    }
}

private extension View {
    func previewSurface(_ fill: Color, radius: CGFloat, inner: Color? = nil, shadows: [PreviewShadow] = []) -> some View {
        background(PreviewSurfaceBackground(fill: fill, radius: radius, inner: inner, shadows: shadows))
    }
}
