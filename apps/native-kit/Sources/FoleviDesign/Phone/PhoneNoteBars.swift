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

/// NotePlaceChip: glass, 32 tall, 10 pt in at the start and 8 at the end, its icon, the place in Footnote 500 and a
/// small chevron; it shrinks a little while pressed.
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
                    case .drafts: FolderGlyph(colorId: nil, size: 15)
                    case .shared: WebIconView(.users, size: 14).foregroundStyle(FoleviTokens.Chrome.inkMuted.resolve(scheme).color)
                    }
                }
                .accessibilityHidden(true)
                Text(place.label)
                    .webText(WebTextStyle(size: WebTypeRole.footnote.metrics.size, leading: WebTypeRole.footnote.metrics.leading, weight: FoleviTokens.FontWeight.medium))
                    .lineLimit(1)
                    .foregroundStyle(FoleviTokens.Chrome.heading.resolve(scheme).color)
                WebIconView(.chevronRight, size: 13, strokeWidth: 2.4)
                    .foregroundStyle(FoleviTokens.Chrome.inkFaint.resolve(scheme).color)
                    .accessibilityHidden(true)
            }
            .padding(.leading, 10)
            .padding(.trailing, 8)
            .frame(height: 32)
            .liquidGlass()
        }
        .buttonStyle(ChipPressStyle())
        .accessibilityLabel("In \(place.label)")
    }
}

private struct ChipPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.scaleEffect(configuration.isPressed ? 0.97 : 1).animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}

/// The note's top bar (Screen.tsx's header with NoteTrailing): Back, the place chip in the middle until the small
/// title takes its place, Share and "…" (Done while writing). Over a solid fade with a hairline once the note has
/// scrolled 4 pt.
public struct PhoneNoteTopBar: View {
    let title: String
    let place: PhoneNotePlace?
    let writing: Bool
    let canShare: Bool
    let shared: Bool
    /// How far the note has scrolled (points), for the bar's fade and the small title.
    let scrolled: CGFloat
    /// Where the note's title ends under the bar: the small title fades in over its last 12 pt.
    let titleFoot: CGFloat
    let back: () -> Void
    let openPlace: () -> Void
    let share: () -> Void
    let more: (CGRect) -> Void
    let done: () -> Void
    @Environment(\.colorScheme) private var scheme
    @State private var moreFrame: CGRect = .zero

    public init(title: String, place: PhoneNotePlace?, writing: Bool, canShare: Bool, shared: Bool, scrolled: CGFloat, titleFoot: CGFloat = 72, back: @escaping () -> Void, openPlace: @escaping () -> Void, share: @escaping () -> Void, more: @escaping (CGRect) -> Void, done: @escaping () -> Void) {
        self.title = title
        self.place = place
        self.writing = writing
        self.canShare = canShare
        self.shared = shared
        self.scrolled = scrolled
        self.titleFoot = titleFoot
        self.back = back
        self.openPlace = openPlace
        self.share = share
        self.more = more
        self.done = done
    }

    public var body: some View {
        GeometryReader { geo in
            let top = geo.safeAreaInsets.top
            let titleIn = min(1, max(0, (scrolled - (titleFoot - 12)) / 12))
            ZStack(alignment: .top) {
                FoleviTokens.Chrome.canvas.resolve(scheme).color
                    .frame(height: top + 52)
                    .overlay(alignment: .bottom) { PhoneSurface.separator.resolve(scheme).color.frame(height: 0.5) }
                    .opacity(scrolled > 4 ? 1 : 0)
                    .animation(.easeOut(duration: 0.12), value: scrolled > 4)
                    .allowsHitTesting(false)
                ZStack {
                    Text(title.isEmpty ? "Untitled" : title)
                        .webText(.role(.headline, weight: FoleviTokens.FontWeight.semibold))
                        .lineLimit(1)
                        .foregroundStyle(FoleviTokens.Chrome.heading.resolve(scheme).color)
                        .frame(maxWidth: 220)
                        .opacity(titleIn)
                        .offset(y: (1 - titleIn) * 4)
                        .accessibilityHidden(titleIn < 0.5)
                    HStack(spacing: 8) {
                        WebGlassCircle("Back", action: back) {
                            WebIconView(.chevronLeft, size: 24, strokeWidth: 2.2).offset(x: -2)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        Group {
                            if let place {
                                PhoneNotePlaceChip(place, action: openPlace)
                                    .opacity(titleIn > 0 ? 0 : 1)
                                    .offset(y: titleIn > 0 ? -4 : 0)
                                    .animation(.easeOut(duration: 0.2), value: titleIn > 0)
                                    .allowsHitTesting(titleIn == 0)
                            }
                        }
                        .frame(maxWidth: geo.size.width * 0.56)
                        .fixedSize(horizontal: true, vertical: false)
                        HStack(spacing: 8) {
                            if writing {
                                WebGlassTextButton("Done", semibold: true, action: done)
                            } else {
                                WebGlassPill {
                                    if canShare {
                                        WebPillButton(shared ? "Shared: sharing settings" : "Share", action: share) {
                                            WebIconView(.share, size: 20, strokeWidth: 1.9)
                                                .offset(y: -2)
                                                .overlay(alignment: .topTrailing) {
                                                    if shared {
                                                        Circle().fill(FoleviTokens.Chrome.heading.resolve(scheme).color).frame(width: 8, height: 8).offset(x: 2, y: -2)
                                                    }
                                                }
                                        }
                                    }
                                    WebPillButton("Document actions", action: { more(moreFrame) }) {
                                        WebIconView(.ellipsis, size: 24, strokeWidth: 2.2)
                                    }
                                    .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { moreFrame = $0 }
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
/// keyboard's top; its keys (44 pt) scroll sideways, then a hairline and the key that puts the keyboard away.
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
            if snapshot {
                Color.clear.frame(height: 44).overlay(alignment: .leading) { keys.fixedSize() }.clipped()
            } else {
                ScrollView(.horizontal, showsIndicators: false) { keys }
                    .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
            }
            PhoneSurface.separator.resolve(scheme).color
                .frame(width: 1, height: 24)
                .padding(.horizontal, 2)
                .accessibilityHidden(true)
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
