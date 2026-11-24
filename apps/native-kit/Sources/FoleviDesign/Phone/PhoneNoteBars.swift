// A note's bars on the iPhone, as the web draws them (apps/web/src/components/iphone/NoteBars.tsx, NoteChrome.tsx
// and Screen.tsx's bar): at the top Back, the note's place in the middle (its parent page, folder or Drafts) and
// Share and "…" in a glass pill, Done in their place while writing; at the bottom Comments, Style and Format on the
// left and Foli AI and Insert on the right, each in a glass capsule; while writing, one bar riding on the keyboard
// instead (Insert, Format, Foli AI, To-do, Indent, Outdent, Link, Mention, Image, Undo, Redo, and the key that puts
// the keyboard away). The note itself is the web page under them.
import SwiftUI

/// A note's tools (the web's InspectorTab), each opened as a sheet.
public enum PhoneNoteTool: String, Sendable, CaseIterable {
    case comments, style, format, ai, insert
}

/// Where a note lives, for the chip in its bar.
public enum PhoneNotePlace: Sendable, Equatable {
    case parent(title: String)
    case folder(name: String, colorId: String?)
    case drafts
    case shared

    var label: String {
        switch self {
        case .parent(let t): t.isEmpty ? "Untitled" : t
        case .folder(let n, _): n
        case .drafts: "Drafts"
        case .shared: "Shared with Me"
        }
    }
}

/// NotePlaceChip: glass, 44 tall like the bar's other controls, its icon, the place in Subheadline 500 and a small
/// chevron; it shrinks a little while pressed.
public struct PhoneNotePlaceChip: View {
    let place: PhoneNotePlace
    let action: () -> Void
    @Environment(\.colorScheme) private var scheme

    public init(_ place: PhoneNotePlace, action: @escaping () -> Void) {
        self.place = place
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Group {
                    switch place {
                    case .parent: WebIconView(.fileText, size: 14).foregroundStyle(FoleviTokens.Chrome.inkMuted.resolve(scheme).color)
                    case .folder(_, let color): FolderGlyph(colorId: color, size: 15)
                    // (Drafts' tray, as Home's Drafts row: a folder glyph with no colour read as a stray swatch.)
                    case .drafts: WebIconView(.inbox, size: 14).foregroundStyle(FoleviTokens.Chrome.inkMuted.resolve(scheme).color)
                    case .shared: WebIconView(.users, size: 14).foregroundStyle(FoleviTokens.Chrome.inkMuted.resolve(scheme).color)
                    }
                }
                .accessibilityHidden(true)
                Text(place.label)
                    .webText(WebTextStyle(size: WebTypeRole.subheadline.metrics.size, leading: WebTypeRole.subheadline.metrics.leading, weight: FoleviTokens.FontWeight.medium))
                    .lineLimit(1)
                    .foregroundStyle(FoleviTokens.Chrome.heading.resolve(scheme).color)
                WebIconView(.chevronRight, size: 13, strokeWidth: 2.4)
                    .foregroundStyle(FoleviTokens.Chrome.inkFaint.resolve(scheme).color)
                    .accessibilityHidden(true)
            }
            // As tall as the bar's other controls, 44 pt (the owner, 2026-11-23: the Mac's one control height in a bar).
            .padding(.leading, 14)
            .padding(.trailing, 12)
            .frame(height: 44)
            .liquidGlass()
            .padding(.horizontal, 4)
            .contentShape(Rectangle())
        }
        .buttonStyle(ChipPressStyle())
        .accessibilityLabel("In \(place.label)")
    }
}

private struct ChipPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.pressDip(configuration.isPressed, scale: 0.97)
    }
}

/// The note's page where it meets the top bar, as the page paints it there (RebuildNote measures it): its colour, and
/// whether it reads dark. The bar takes both: its edge is frosted in the page's colour, and the status bar's text and
/// the glass buttons follow the page's brightness, not the phone's appearance (a light note on a phone in dark mode
/// keeps a dark clock and light glass).
public struct PhoneNotePage: Equatable, Sendable {
    public var color: RGBA
    public var dark: Bool

    public init(color: RGBA) {
        self.color = RGBA(color.r, color.g, color.b, 1)
        dark = Self.readsDark(color)
    }

    /// The appearance chrome over this page takes: dark over a dark page, light over a light one.
    public var scheme: ColorScheme { dark ? .dark : .light }

    /// Dark when white text has more contrast on it than black (WCAG relative luminance under 0.179).
    public static func readsDark(_ c: RGBA) -> Bool {
        func lin(_ v: Double) -> Double {
            let s = max(0, min(255, v)) / 255
            return s <= 0.04045 ? s / 12.92 : pow((s + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b) < 0.179
    }
}

public extension View {
    /// A note's chrome over its page (the top bar, the floating tool bars, the bar on the keyboard): its glass and ink
    /// in the page's light or dark rather than the phone's; the phone's own until the page has said (`page` nil).
    func notePageAppearance(_ page: PhoneNotePage?) -> some View {
        modifier(NotePageAppearance(page: page))
    }
}

private struct NotePageAppearance: ViewModifier {
    let page: PhoneNotePage?
    @Environment(\.colorScheme) private var scheme

    func body(content: Content) -> some View {
        content.environment(\.colorScheme, page?.scheme ?? scheme)
    }
}

/// The note's top bar (Screen.tsx's header with NoteTrailing): Back, the place chip in the middle until the small
/// title takes its place, Share and "…" (Done while writing). Once the note has scrolled 4 pt, a short frosted edge
/// in the page's own colour behind them (PhoneNoteTopEdge). Over a note the bar follows the page (`page`): its glass
/// and ink are the page's light or dark, whatever the phone's appearance.
public struct PhoneNoteTopBar: View {
    let title: String
    let place: PhoneNotePlace?
    let writing: Bool
    let canShare: Bool
    let shared: Bool
    /// How far the note has scrolled (points), for the bar's edge and the small title.
    let scrolled: CGFloat
    /// Where the note's title ends under the bar: the small title fades in over its last 12 pt.
    let titleFoot: CGFloat
    /// The page under the bar; nil until the page has said (the phone's canvas meanwhile).
    let page: PhoneNotePage?
    let back: () -> Void
    let openPlace: () -> Void
    let share: () -> Void
    let more: (CGRect) -> Void
    let done: () -> Void
    @Environment(\.colorScheme) private var scheme

    public init(title: String, place: PhoneNotePlace?, writing: Bool, canShare: Bool, shared: Bool, scrolled: CGFloat, titleFoot: CGFloat = 72, page: PhoneNotePage? = nil, back: @escaping () -> Void, openPlace: @escaping () -> Void, share: @escaping () -> Void, more: @escaping (CGRect) -> Void, done: @escaping () -> Void) {
        self.title = title
        self.place = place
        self.writing = writing
        self.canShare = canShare
        self.shared = shared
        self.scrolled = scrolled
        self.titleFoot = titleFoot
        self.page = page
        self.back = back
        self.openPlace = openPlace
        self.share = share
        self.more = more
        self.done = done
    }

    public var body: some View {
        // (A view of its own under the page's appearance, so everything in the bar reads the page's light or dark.)
        PhoneNoteTopBarContent(bar: self, pageColor: page?.color ?? FoleviTokens.Chrome.canvas.resolve(scheme))
            .notePageAppearance(page)
    }
}

private struct PhoneNoteTopBarContent: View {
    let bar: PhoneNoteTopBar
    let pageColor: RGBA
    @Environment(\.colorScheme) private var scheme
    @Environment(\.phoneMenus) private var menus
    @State private var moreFrame: CGRect = .zero

    var body: some View {
        GeometryReader { geo in
            let top = geo.safeAreaInsets.top
            let titleIn = min(1, max(0, (bar.scrolled - (bar.titleFoot - 12)) / 12))
            ZStack(alignment: .top) {
                PhoneNoteTopEdge(color: pageColor, top: top, on: bar.scrolled > 4)
                ZStack {
                    Text(bar.title.isEmpty ? "Untitled" : bar.title)
                        .webText(.role(.headline, weight: FoleviTokens.FontWeight.semibold))
                        .lineLimit(1)
                        .foregroundStyle(FoleviTokens.Chrome.heading.resolve(scheme).color)
                        // (Centred, and short of the buttons on both sides: Share and "…" take 104 pt, Done about 80.)
                        .frame(maxWidth: max(80, geo.size.width - 2 * (16 + (bar.writing ? 84 : 108) + 8)))
                        .opacity(titleIn)
                        .offset(y: WebMotion.reduced ? 0 : (1 - titleIn) * 4)
                        .accessibilityHidden(titleIn < 0.5)
                    HStack(spacing: 8) {
                        WebGlassCircle("Back", action: bar.back) {
                            WebIconView(.chevronLeft, size: 24, strokeWidth: 2.2).offset(x: -2)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        Group {
                            if let place = bar.place {
                                PhoneNotePlaceChip(place, action: bar.openPlace)
                                    .opacity(titleIn > 0 ? 0 : 1)
                                    .offset(y: titleIn > 0 && !WebMotion.reduced ? -4 : 0)
                                    .animation(.easeOut(duration: 0.2), value: titleIn > 0)
                                    .allowsHitTesting(titleIn == 0)
                            }
                        }
                        .frame(maxWidth: geo.size.width * 0.56)
                        .fixedSize(horizontal: true, vertical: false)
                        HStack(spacing: 8) {
                            if bar.writing {
                                WebGlassTextButton("Done", semibold: true, action: bar.done)
                            } else {
                                WebGlassPill {
                                    if bar.canShare {
                                        WebPillButton(bar.shared ? "Shared: sharing settings" : "Share", action: bar.share) {
                                            WebIconView(.share, size: 20, strokeWidth: 1.9)
                                                .offset(y: -2)
                                                .overlay(alignment: .topTrailing) {
                                                    if bar.shared {
                                                        Circle().fill(FoleviTokens.Chrome.heading.resolve(scheme).color).frame(width: 8, height: 8).offset(x: 2, y: -2)
                                                    }
                                                }
                                        }
                                    }
                                    if let menus {
                                        // The native look: iOS's own menu.
                                        PhoneMenuButton("Document actions", menus: menus, build: { bar.more(.zero) }) {
                                            WebIconView(.ellipsis, size: 24, strokeWidth: 2.2)
                                                .foregroundStyle(FoleviTokens.Chrome.heading.resolve(scheme).color)
                                                .frame(width: 44, height: 44)
                                                .contentShape(Rectangle())
                                        }
                                    } else {
                                        WebPillButton("Document actions", action: { bar.more(moreFrame) }) {
                                            WebIconView(.ellipsis, size: 24, strokeWidth: 2.2)
                                        }
                                        .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { moreFrame = $0 }
                                    }
                                }
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .trailing)
                    }
                    .padding(.horizontal, 16)
                }
                .frame(height: 44)
                .padding(.top, top + 4)
            }
            .ignoresSafeArea(edges: .top)
        }
        .frame(height: 0, alignment: .top)
    }
}

/// The frosted edge behind a note's top bar once the note has scrolled under it: what passes under blurs and takes
/// the page's own colour, strong through the status bar and the buttons (they end 48 under the status bar), then
/// eases out just below them over many stops, so there's no band and no edge. Reduce Transparency: the page's colour
/// alone, no blur. Increase Contrast: the colour fully opaque and the fade shorter, so the buttons sit on the page's
/// colour rather than on text.
public struct PhoneNoteTopEdge: View {
    let color: RGBA
    let top: CGFloat
    let on: Bool
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var contrast

    public init(color: RGBA, top: CGFloat, on: Bool) {
        self.color = color
        self.top = top
        self.on = on
    }

    /// Where the edge is fully on (under the status bar and down the buttons) and how far below it it eases out.
    static func extent(top: CGFloat, increaseContrast: Bool) -> (solid: CGFloat, fade: CGFloat) {
        increaseContrast ? (top + 50, 22) : (top + 40, 52)
    }

    /// The edge's opacity from its top (0) to its foot (1): fully on to `solid`, then an ease-in-out to nothing (a
    /// cosine, sampled every 1/16 of the fade: no visible step).
    public static func fadeStops(solid: CGFloat, fade: CGFloat, steps: Int = 16) -> [Gradient.Stop] {
        let height = solid + fade
        var stops: [Gradient.Stop] = [.init(color: .black, location: 0)]
        for i in 0...steps {
            let t = Double(i) / Double(steps)
            let alpha = 0.5 * (1 + cos(Double.pi * t))
            stops.append(.init(color: .black.opacity(alpha), location: (solid + fade * t) / height))
        }
        return stops
    }

    public var body: some View {
        let strong = contrast == .increased
        let (solid, fade) = Self.extent(top: top, increaseContrast: strong)
        let solidOnly = reduceTransparency || strong
        ZStack {
            if !solidOnly {
                // The blur: the lightest system material, in the page's appearance (the bar sets it).
                Rectangle().fill(.ultraThinMaterial)
            }
            Rectangle().fill(color.opacity(solidOnly ? 1 : 0.9).color)
        }
        .frame(height: solid + fade)
        .mask {
            LinearGradient(stops: Self.fadeStops(solid: solid, fade: fade), startPoint: .top, endPoint: .bottom)
        }
        .opacity(on ? 1 : 0)
        .animation(.easeOut(duration: 0.12), value: on)
        // A different page (or its colour changed) crossfades to the new colour.
        .animation(WebMotion.reduced ? nil : .easeOut(duration: 0.2), value: color)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// The floating tool bars at the bottom of a note: two glass capsules 60 tall (4 pt in), 52 pt buttons; the open
/// tool's button shows the active fill. A read-only note keeps only Comments (and Foli AI).
public struct PhoneNoteToolBars: View {
    let open: PhoneNoteTool?
    let canEdit: Bool
    let aiOn: Bool
    let pick: (PhoneNoteTool) -> Void
    @Environment(\.colorScheme) private var scheme

    public init(open: PhoneNoteTool?, canEdit: Bool, aiOn: Bool, pick: @escaping (PhoneNoteTool) -> Void) {
        self.open = open
        self.canEdit = canEdit
        self.aiOn = aiOn
        self.pick = pick
    }

    public var body: some View {
        HStack(alignment: .bottom, spacing: 12) {
            HStack(spacing: 2) {
                tool(.comments, "Comments") { WebIconView(.messageCircle, size: 23, strokeWidth: 2) }
                if canEdit {
                    tool(.style, "Style") { WebIconView(.paintbrush, size: 22, strokeWidth: 1.85) }
                    tool(.format, "Format") { WebIconView(.type, size: 24, strokeWidth: 2) }
                }
            }
            .padding(4)
            .frame(height: 60)
            .liquidGlass()
            Spacer(minLength: 0)
            if aiOn || canEdit {
                HStack(spacing: 2) {
                    if aiOn { tool(.ai, "Foli AI") { AiMarkGlyph(size: 26) } }
                    if canEdit {
                        tool(.insert, "Insert") {
                            WebIconView(.plus, size: 22, strokeWidth: 2.4)
                                .foregroundStyle(FoleviTokens.Chrome.canvas.resolve(scheme).color)
                                .frame(width: 38, height: 38)
                                .background {
                                    WebShapeBox(shape: .capsule, fill: FoleviTokens.Chrome.heading.resolve(scheme).color, shadows: [ShadowLayer(x: 0, y: 2, blur: 6, spread: 0, color: RGBA(0, 0, 0, 0.18))])
                                }
                        }
                    }
                }
                .padding(4)
                .frame(height: 60)
                .liquidGlass()
            }
        }
        .padding(.horizontal, 16)
    }

    private func tool<L: View>(_ t: PhoneNoteTool, _ label: String, @ViewBuilder icon: () -> L) -> some View {
        WebPillButton(label, pressed: open == t, action: { pick(t) }) { icon() }
            .frame(minWidth: 52, minHeight: 52, maxHeight: 52)
    }
}

/// What the keyboard bar shows: the line's kind, a link at the caret, undo and redo.
public struct PhoneKeyboardBarState: Equatable, Sendable {
    public var block: String?
    public var link: Bool
    public var undo: Bool
    public var redo: Bool

    public init(block: String? = nil, link: Bool = false, undo: Bool = false, redo: Bool = false) {
        self.block = block
        self.link = link
        self.undo = undo
        self.redo = redo
    }
}

/// A key on the keyboard bar.
public enum PhoneKeyboardKey: Sendable {
    case insert, format, ai, todo, indent, outdent, link, mention, image, undo, redo, hide
}

/// The bar over the keyboard while writing: a glass capsule 48 tall, 8 pt in from the screen's sides and the
/// keyboard's top; its keys (44 pt) scroll sideways and fade out before the key that puts the keyboard away.
public struct PhoneKeyboardBar: View {
    let state: PhoneKeyboardBarState
    let aiOn: Bool
    let run: (PhoneKeyboardKey) -> Void

    public init(state: PhoneKeyboardBarState, aiOn: Bool, run: @escaping (PhoneKeyboardKey) -> Void) {
        self.state = state
        self.aiOn = aiOn
        self.run = run
    }

    @Environment(\.colorScheme) private var scheme
    @Environment(\.webSnapshot) private var snapshot

    public var body: some View {
        HStack(spacing: 0) {
            // (A picture for the diffs can't draw a scroll view: the keys are clipped at the same place instead.)
            Group {
                if snapshot {
                    Color.clear.frame(height: 44).overlay(alignment: .leading) { keys.fixedSize() }.clipped()
                } else {
                    ScrollView(.horizontal, showsIndicators: false) { keys }
                        .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
                        // (Scrolled to the end, the last key stops clear of the fade.)
                        .contentMargins(.trailing, 20, for: .scrollContent)
                }
            }
            // The keys fade out over their last 24 pt before Hide keyboard, rather than meeting a hairline.
            .mask {
                HStack(spacing: 0) {
                    Color.black
                    LinearGradient(colors: [.black, .clear], startPoint: .leading, endPoint: .trailing).frame(width: 24)
                }
            }
            key(.hide, "Hide keyboard") { WebIconView(.chevronDown, size: 24, strokeWidth: 2.2) }
        }
        .padding(.horizontal, 2)
        .frame(height: 48)
        .liquidGlass()
        .padding(.horizontal, 8)
        .padding(.bottom, 8)
    }

    private var keys: some View {
        HStack(spacing: 0) {
            key(.insert, "Insert") { WebIconView(.plus, size: 23, strokeWidth: 2.2) }
            key(.format, "Format") {
                Text("Aa").webText(WebTextStyle(size: WebTypeRole.headline.metrics.size, leading: WebTypeRole.headline.metrics.size, weight: FoleviTokens.FontWeight.semibold, letterSpacing: -0.01 * WebTypeRole.headline.metrics.size))
            }
            if aiOn { key(.ai, "Foli AI") { AiMarkGlyph(size: 22) } }
            key(.todo, "To-do", pressed: state.block == "todo") { WebIconView(.squareCheck, size: 22) }
            key(.indent, "Indent") { WebIconView(.listIndentIncrease, size: 22) }
            key(.outdent, "Outdent") { WebIconView(.listIndentDecrease, size: 22) }
            key(.link, "Link", pressed: state.link) { WebIconView(.link2, size: 22) }
            key(.mention, "Mention a date or page") { WebIconView(.atSign, size: 22) }
            key(.image, "Image") { WebIconView(.image, size: 22) }
            key(.undo, "Undo", disabled: !state.undo) { WebIconView(.undo2, size: 22) }
            key(.redo, "Redo", disabled: !state.redo) { WebIconView(.redo2, size: 22) }
        }
    }

    private func key<L: View>(_ k: PhoneKeyboardKey, _ label: String, pressed: Bool = false, disabled: Bool = false, @ViewBuilder icon: () -> L) -> some View {
        Button { run(k) } label: { icon() }
            .buttonStyle(KeyStyle(pressed: pressed))
            .disabled(disabled)
            .accessibilityLabel(label)
            .accessibilityAddTraits(pressed ? .isSelected : [])
    }
}

/// A key: 44 pt round, the heading ink; pressed in (a to-do line, a link) it's filled in the heading colour with
/// the canvas's ink; held, the --liquid-press fill; off, at 30%.
private struct KeyStyle: ButtonStyle {
    let pressed: Bool
    @Environment(\.colorScheme) private var scheme
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        let heading = FoleviTokens.Chrome.heading.resolve(scheme).color
        configuration.label
            .foregroundStyle(pressed ? FoleviTokens.Chrome.canvas.resolve(scheme).color : heading)
            .frame(width: 44, height: 44)
            .background(Capsule().fill(pressed ? heading : configuration.isPressed ? LiquidGlassLook.press.resolve(scheme).color : .clear))
            .contentShape(Capsule())
            .opacity(enabled ? 1 : 0.3)
            .animation(.easeOut(duration: 0.15), value: pressed)
    }
}
