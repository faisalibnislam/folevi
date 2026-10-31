// The note's Format tool on the iPhone, drawn natively (apps/web/src/components/doc/FormatPanel.tsx in the iPhone
// layout, editor-phone.css `.iphone-fmt-*`): the text styles as a row of preview tiles; capsules of 44 pt buttons
// for marks, lists, indent, Page or Card, and alignment (the chosen one filled in the heading colour); the text
// colours and highlights (the chosen one on a raised thumb); then rows for Quote, Callout, Code block, Focus line,
// Block background, Link and Clear formatting; a callout's tones and a code block's language when the line is one.
import SwiftUI

/// The line at the caret, as the Format sheet shows it (the engine's `editor.state` and its `format`).
public struct PhoneFormatState: Equatable, Sendable {
    public var canEdit = true
    /// The block's type ("paragraph", "heading2", "todo", "codeBlock", "callout", ...).
    public var block = "paragraph"
    public var marks: Set<String> = []
    public var link = false
    public var textStyle: String?
    public var textColor: String?
    public var highlight: String?
    public var align = "left"
    public var group = "page"
    public var decoration: String?
    public var calloutTone: String?
    public var codeLanguage: String?
    public var blockTools = true

    public init() {}
}

/// What a Format control does.
public enum PhoneFormatAction: Equatable, Sendable {
    case textStyle(String)
    case mark(String)
    case block(String)
    case indent, outdent
    case group(String)
    case align(String)
    case textColor(String?)
    case highlight(String?)
    case decoration(String?)
    case link, removeLink, clear
    case calloutTone(String)
    case codeLanguage(String)
}

/// The Format sheet's content (inside a PhoneSheetPanel titled "Format").
public struct PhoneFormatSheetContent: View {
    let state: PhoneFormatState
    let run: (PhoneFormatAction) -> Void
    @Environment(\.colorScheme) private var scheme
    @Environment(\.webSnapshot) private var snapshot

    public init(state: PhoneFormatState, run: @escaping (PhoneFormatAction) -> Void) {
        self.state = state
        self.run = run
    }

    static let textColors = ["muted", "accent", "moss", "marigold", "plum", "coral"]
    static let highlights = ["yellow", "green", "blue", "pink"]
    static let tones = ["note", "info", "success", "warning", "danger"]
    static let languages = ["plaintext", "bash", "c", "cpp", "csharp", "css", "diff", "go", "graphql", "html", "java", "javascript", "json", "kotlin", "latex", "markdown", "mermaid", "php", "python", "ruby", "rust", "sql", "swift", "toml", "typescript", "xml", "yaml"]

    private var off: Bool { !state.canEdit }
    private var inCode: Bool { state.block == "codeBlock" }
    private var marksOff: Bool { off || inCode }
    private var blockOff: Bool { off || !state.blockTools }

    public var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            styles
            // (A grid with 8 pt gaps: marks, lists, indent beside Page or Card, alignment.)
            VStack(spacing: 8) {
            group("Text marks") {
                key("Bold", on: state.marks.contains("bold"), off: marksOff, .mark("bold")) { WebIconView(.bold, size: 20, strokeWidth: 2.4) }
                key("Italic", on: state.marks.contains("italic"), off: marksOff, .mark("italic")) { WebIconView(.italic, size: 20) }
                key("Underline", on: state.marks.contains("underline"), off: marksOff, .mark("underline")) { WebIconView(.underline, size: 20) }
                key("Strikethrough", on: state.marks.contains("strike"), off: marksOff, .mark("strike")) { WebIconView(.strikethrough, size: 20) }
                key("Inline code", on: state.marks.contains("code"), off: marksOff, .mark("code")) { WebIconView(.codeXml, size: 20) }
            }
            group("Lists") {
                key("To-do", on: state.block == "todo", off: off || inCode, .block("todo")) { WebIconView(.squareCheck, size: 20) }
                key("Toggle", on: state.block == "toggle", off: off || inCode, .block("toggle")) { PlayGlyph() }
                key("Bullets", on: state.block == "bulleted", off: off || inCode, .block("bulleted")) { WebIconView(.list, size: 20) }
                key("Numbers", on: state.block == "numbered", off: off || inCode, .block("numbered")) { WebIconView(.listOrdered, size: 20) }
            }
            HStack(spacing: 8) {
                group("Indent") {
                    key("Outdent", on: false, off: off, .outdent) { WebIconView(.listIndentDecrease, size: 20) }
                    key("Indent", on: false, off: off, .indent) { WebIconView(.listIndentIncrease, size: 20) }
                }
                group("Group") {
                    key("Page", on: state.group != "card", off: blockOff, .group("page")) { labelled("Page", .fileText) }
                    key("Card", on: state.group == "card", off: blockOff, .group(state.group == "card" ? "page" : "card")) { labelled("Card", .panelTop) }
                }
            }
            group("Alignment") {
                key("Align left", on: state.align == "left", off: blockOff, .align("left")) { WebIconView(.textAlignStart, size: 20) }
                key("Align center", on: state.align == "center", off: blockOff, .align("center")) { WebIconView(.textAlignCenter, size: 20) }
                key("Align right", on: state.align == "right", off: blockOff, .align("right")) { WebIconView(.textAlignEnd, size: 20) }
                key("Justify", on: state.align == "justify", off: blockOff, .align("justify")) { WebIconView(.textAlignJustify, size: 20) }
            }
            }
            group("Text color") {
                key("Default text color", on: state.textColor == nil, off: marksOff, swatch: true, .textColor(nil)) { colorA(FoleviTokens.Chrome.heading) }
                ForEach(Self.textColors, id: \.self) { c in
                    key("Text color: \(Self.colorName(c))", on: state.textColor == c, off: marksOff, swatch: true, .textColor(c)) { colorA(Self.textInk(c)) }
                }
            }
            group("Highlight") {
                key("No highlight", on: state.highlight == nil, off: marksOff, swatch: true, .highlight(nil)) {
                    Circle().strokeBorder(FoleviTokens.Chrome.inkFaint.resolve(scheme).color, lineWidth: 1.5).frame(width: 18, height: 18)
                }
                ForEach(Self.highlights, id: \.self) { h in
                    key("Highlight: \(Self.colorName(h))", on: state.highlight == h, off: marksOff, swatch: true, .highlight(h)) {
                        // .fb-swatch: a 1 pt ring of the ink at 18% inside.
                        Circle().fill(Self.highlightFill(h).resolve(scheme).color)
                            .overlay(Circle().strokeBorder(FoleviTokens.Chrome.ink.resolve(scheme).color.opacity(0.18), lineWidth: 1))
                            .frame(width: 18, height: 18)
                    }
                }
            }
            rows
            if state.block == "callout" {
                group("Callout tone") {
                    ForEach(Self.tones, id: \.self) { t in
                        key(t.capitalized, on: state.calloutTone == t, off: off, .calloutTone(t)) {
                            Text(t.capitalized).webText(PhoneType.subheadline(leading: 20)).lineLimit(1).minimumScaleFactor(0.8)
                        }
                    }
                }
            }
            if inCode {
                VStack(alignment: .leading, spacing: 6) {
                    Text("LANGUAGE").webText(PhoneType.captionCaps).foregroundStyle(FoleviTokens.Chrome.inkMuted.resolve(scheme).color).padding(.horizontal, 4)
                    Menu {
                        ForEach(Self.languages, id: \.self) { l in
                            Button(l) { run(.codeLanguage(l)) }
                        }
                    } label: {
                        HStack {
                            Text(state.codeLanguage ?? "plaintext").webText(PhoneType.body()).foregroundStyle(FoleviTokens.Chrome.ink.resolve(scheme).color)
                            Spacer()
                            WebIconView(.chevronsUpDown, size: 16).foregroundStyle(FoleviTokens.Chrome.inkMuted.resolve(scheme).color)
                        }
                        .padding(.horizontal, 12)
                        .frame(height: 44)
                        .background(wash, in: RoundedRectangle(cornerRadius: FoleviTokens.Radius.control, style: .circular))
                    }
                    .disabled(off)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 4)
        .padding(.bottom, 24)
    }

    /// --fmt-wash: the ink at 5.5%.
    private var wash: Color { FoleviTokens.Chrome.ink.resolve(scheme).color.opacity(0.055) }

    /// The text styles: preview tiles, at least 72 by 56, scrolling sideways past the sheet's edges.
    private var styles: some View {
        let s = state.textStyle
        let tiles: [(String, String, WebTextStyle, CGFloat)] = [
            ("Title", "title", WebTextStyle(family: .display, size: WebTypeRole.title2.metrics.size, leading: WebTypeRole.title2.metrics.size, weight: FoleviTokens.FontWeight.semibold), 1),
            ("Subtitle", "subtitle", WebTextStyle(size: WebTypeRole.headline.metrics.size, leading: WebTypeRole.headline.metrics.size, weight: FoleviTokens.FontWeight.semibold), 1),
            ("Heading", "heading", WebTextStyle(size: WebTypeRole.subheadline.metrics.size, leading: WebTypeRole.subheadline.metrics.size, weight: FoleviTokens.FontWeight.semibold), 1),
            ("Strong", "strong", WebTextStyle(size: WebTypeRole.subheadline.metrics.size, leading: WebTypeRole.subheadline.metrics.size, weight: FoleviTokens.FontWeight.semibold), 1),
            ("Body", "body", WebTextStyle(size: WebTypeRole.subheadline.metrics.size, leading: WebTypeRole.subheadline.metrics.size), 1),
            ("Caption", "caption", WebTextStyle(size: WebTypeRole.footnote.metrics.size, leading: WebTypeRole.footnote.metrics.size), 0.7),
        ]
        let row = HStack(spacing: 8) {
                ForEach(tiles, id: \.1) { label, id, style, opacity in
                    let on = s == id
                    Button { run(.textStyle(id)) } label: {
                        Text(label)
                            .webText(style)
                            .lineLimit(1)
                            .opacity(opacity)
                            .foregroundStyle((on ? FoleviTokens.Chrome.canvas : FoleviTokens.Chrome.heading).resolve(scheme).color)
                            .padding(.horizontal, 12)
                            .frame(minWidth: 72, minHeight: 56)
                            .background(on ? FoleviTokens.Chrome.heading.resolve(scheme).color : wash, in: RoundedRectangle(cornerRadius: FoleviTokens.Radius.panel, style: .circular))
                    }
                    .buttonStyle(StylePressStyle())
                    .disabled(off || inCode)
                    .opacity(off || inCode ? 0.35 : 1)
                    .accessibilityAddTraits(on ? .isSelected : [])
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 4)
        return Group {
            // (A picture for the diffs can't draw a scroll view: the tiles are clipped at the sheet's edge.)
            if snapshot {
                Color.clear.frame(height: 60).overlay(alignment: .topLeading) { row.fixedSize() }.clipped()
            } else {
                ScrollView(.horizontal, showsIndicators: false) { row }
            }
        }
        .padding(.horizontal, -16)
        .accessibilityLabel("Text style")
    }

    /// `.iphone-fmt-group`: a capsule of buttons 2 pt apart, 2 pt in, on the wash.
    private func group<C: View>(_ label: String, @ViewBuilder content: () -> C) -> some View {
        HStack(spacing: 2) { content() }
            .padding(2)
            .frame(maxWidth: .infinity)
            .background(wash, in: Capsule())
            .accessibilityElement(children: .contain)
            .accessibilityLabel(label)
    }

    /// `.iphone-fmt-btn`: 44 tall, sharing the capsule's width; chosen, filled in the heading colour (a colour
    /// swatch on a raised thumb instead).
    private func key<L: View>(_ label: String, on: Bool, off: Bool, swatch: Bool = false, _ action: PhoneFormatAction, @ViewBuilder icon: () -> L) -> some View {
        Button { run(action) } label: { icon() }
            .buttonStyle(FormatKeyStyle(on: on, swatch: swatch))
            .disabled(off)
            .accessibilityLabel(label)
            .accessibilityAddTraits(on ? .isSelected : [])
    }

    private func labelled(_ title: String, _ icon: WebIcon) -> some View {
        HStack(spacing: 6) {
            WebIconView(icon, size: 17)
            Text(title).webText(PhoneType.subheadline(leading: 20))
        }
    }

    private func colorA(_ pair: ColorPair) -> some View {
        Text("A")
            .webText(WebTextStyle(size: WebTypeRole.headline.metrics.size, leading: WebTypeRole.headline.metrics.leading, weight: FoleviTokens.FontWeight.semibold))
            .foregroundStyle(pair.resolve(scheme).color)
    }

    /// The rows: Quote, Callout, Code block, Focus line, Block background, Link (and Remove link), Clear formatting.
    private var rows: some View {
        let heading = FoleviTokens.Chrome.heading.resolve(scheme).color
        return VStack(spacing: 0) {
            row("Quote", on: state.block == "quote", off: off, .block("quote")) { WebIconView(.quote, size: 20) }
            row("Callout", on: state.block == "callout", off: off, .block("callout")) { WebIconView(.stickyNote, size: 20) }
            row("Code block", on: inCode, off: off, .block("code")) { WebIconView(.codeXml, size: 20) }
            row("Focus line", on: state.decoration == "focus", off: blockOff, .decoration(state.decoration == "focus" ? nil : "focus")) {
                Capsule().fill(heading).frame(width: 3, height: 16)
            }
            row("Block background", on: state.decoration == "block", off: blockOff, .decoration(state.decoration == "block" ? nil : "block")) {
                RoundedRectangle(cornerRadius: FoleviTokens.Radius.tiny).fill(LiquidGlassLook.active.resolve(scheme).color)
                    .overlay(RoundedRectangle(cornerRadius: FoleviTokens.Radius.tiny).strokeBorder(FoleviTokens.Chrome.line.resolve(scheme).color, lineWidth: 1))
                    .frame(width: 20, height: 14)
            }
            row(state.link ? "Edit link" : "Link", on: false, off: marksOff, .link) { WebIconView(.link2, size: 20) }
            if state.link {
                row("Remove link", on: false, off: marksOff, .removeLink) { WebIconView(.unlink, size: 20) }
            }
            row("Clear formatting", on: false, off: marksOff, .clear) { WebIconView(.eraser, size: 20) }
        }
        .background(wash)
        .clipShape(RoundedRectangle(cornerRadius: FoleviTokens.Radius.container, style: .circular))
    }

    /// `.iphone-fmt-row`: 52 tall, 16 in, the icon in a 28 pt column, a dot when it's on; a hairline from 56 pt.
    private func row<I: View>(_ label: String, on: Bool, off: Bool, _ action: PhoneFormatAction, @ViewBuilder icon: () -> I) -> some View {
        let heading = FoleviTokens.Chrome.heading.resolve(scheme).color
        return Button { run(action) } label: {
            HStack(spacing: 12) {
                icon().foregroundStyle(heading).frame(width: 28)
                Text(label).webText(PhoneType.body()).lineLimit(1).foregroundStyle(FoleviTokens.Chrome.ink.resolve(scheme).color).frame(maxWidth: .infinity, alignment: .leading)
                if on { Circle().fill(heading).frame(width: 8, height: 8) }
            }
            .padding(.horizontal, 16)
            .frame(minHeight: 52)
        }
        .buttonStyle(FormatRowStyle())
        .disabled(off)
        .opacity(off ? 0.35 : 1)
        .overlay(alignment: .top) {
            if label != "Quote" { PhoneSurface.separator.resolve(scheme).color.frame(height: 0.5).padding(.leading, 56) }
        }
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    /// The text colours as the editor draws them (editor.css `.fb-color-*`).
    static func textInk(_ c: String) -> ColorPair {
        switch c {
        case "muted": FoleviTokens.Chrome.inkMuted
        case "accent": FoleviTokens.Chrome.emberInk
        case "moss": FoleviTokens.Chrome.mossInk
        case "marigold": FoleviTokens.Chrome.marigoldInk
        case "plum": FoleviTokens.Chrome.plumInk
        default: FoleviTokens.Chrome.coralInk
        }
    }

    static func highlightFill(_ h: String) -> ColorPair {
        switch h {
        case "yellow": FoleviTokens.Chrome.highlightYellow
        case "green": FoleviTokens.Chrome.highlightGreen
        case "blue": FoleviTokens.Chrome.highlightBlue
        default: FoleviTokens.Chrome.highlightPink
        }
    }

    /// A colour's name, as notePalette.ts's colorName says it without a note palette.
    static func colorName(_ c: String) -> String {
        switch c {
        case "muted": "Gray"
        case "accent": "Ember"
        default: c.capitalized
        }
    }
}

/// The Toggle key's triangle (lucide Play at 16, filled).
private struct PlayGlyph: View {
    var body: some View {
        Path(WebIcon.play.cgPath)
            .applying(CGAffineTransform(scaleX: 16 / 24, y: 16 / 24))
            .fill()
            .frame(width: 16, height: 16)
            .overlay(WebIconView(.play, size: 16))
    }
}

private struct FormatKeyStyle: ButtonStyle {
    let on: Bool
    let swatch: Bool
    @Environment(\.colorScheme) private var scheme
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        let heading = FoleviTokens.Chrome.heading.resolve(scheme).color
        let filled = on && !swatch
        configuration.label
            .foregroundStyle(filled ? FoleviTokens.Chrome.canvas.resolve(scheme).color : heading)
            .frame(maxWidth: .infinity)
            .frame(height: 44)
            .background {
                if on && swatch {
                    Capsule().fill(FoleviTokens.Chrome.surfaceRaised.resolve(scheme).color)
                        .shadow(color: .black.opacity(0.14), radius: 1.5, y: 1)
                        .overlay(Capsule().strokeBorder(.black.opacity(0.06), lineWidth: 0.5))
                } else {
                    Capsule().fill(filled ? heading : configuration.isPressed ? FoleviTokens.Chrome.ink.resolve(scheme).color.opacity(0.11) : .clear)
                }
            }
            .contentShape(Capsule())
            .opacity(enabled ? 1 : 0.35)
            .animation(.easeOut(duration: 0.15), value: on)
    }
}

private struct FormatRowStyle: ButtonStyle {
    @Environment(\.colorScheme) private var scheme

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .contentShape(Rectangle())
            .background(configuration.isPressed ? FoleviTokens.Chrome.ink.resolve(scheme).color.opacity(0.11) : .clear)
    }
}

private struct StylePressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.scaleEffect(configuration.isPressed ? 0.96 : 1).animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}
