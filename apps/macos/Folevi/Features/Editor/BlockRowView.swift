import AppKit
import SwiftUI
import UniformTypeIdentifiers

/// Editor geometry shared by rows, the header and drag and drop.
enum BlockMetrics {
    /// The hover gutter (+ and grip) left of the text column.
    static let gutter: CGFloat = 52
    /// One nesting level: 1.6em of the 16px body, as the web's `--depth` padding.
    static func indent(_ scale: CGFloat) -> CGFloat { 25.6 * scale }
}

/// Text styles per block type, derived from the document style and editor zoom (the web's editor.css).
enum BlockStyles {
    /// Body size per document family (web: sans 16, serif 17.5, mono 15).
    static func bodySize(_ font: DocumentFont) -> CGFloat {
        switch font {
        case .sans, .rounded: return FoleviFontSize.body
        case .serif: return 17.5
        case .mono: return 15
        }
    }

    /// Body line height (web: 1.65, serif 1.62).
    static func bodyLineHeight(_ font: DocumentFont) -> CGFloat { font == .serif ? 1.62 : 1.65 }

    /// Line spacing that gives `lineHeight` x size lines.
    static func spacing(for font: NSFont, lineHeight: CGFloat) -> CGFloat {
        max(0, (font.pointSize * lineHeight - NSLayoutManager().defaultLineHeight(for: font)).rounded())
    }

    /// The empty-line hint (web: Placeholder in editorExtensions.ts). The page's only line says more.
    static func paragraphPlaceholder(lone: Bool, ai: Bool) -> String {
        if lone {
            return ai ? String(localized: "Start writing, or type / for blocks, ⌘J for AI") : String(localized: "Start writing, or type / for blocks")
        }
        return ai ? String(localized: "Type / for blocks, ⌘J for AI, [[ to link a page") : String(localized: "Type / for blocks, [[ to link a page")
    }

    static func paragraph(style: DocumentStyle, scale: CGFloat, palette: SheetPalette? = nil) -> TextRenderStyle {
        let font = FoleviType.editorFont(size: bodySize(style.font), design: style.font, scale: scale)
        let tracking: CGFloat = style.font == .serif ? 0 : FoleviTracking.normal
        return TextRenderStyle(font: font, color: palette.map { NSColor($0.ink) } ?? .foleviInk, lineSpacing: spacing(for: font, lineHeight: bodyLineHeight(style.font)),
                              placeholder: paragraphPlaceholder(lone: false, ai: false),
                              kern: tracking * font.pointSize)
    }

    /// Page title, as on the web: 40pt semibold Spectral (the document's own family when it's mono or
    /// rounded; mono 34), -0.012em tracking (-0.02em mono/rounded). `color` overrides the heading colour
    /// (a title set on the style's artwork).
    static func title(style: DocumentStyle, scale: CGFloat, palette: SheetPalette? = nil, color: NSColor? = nil) -> TextRenderStyle {
        let size: CGFloat = style.font == .mono ? 34 : 40
        let design: DocumentFont = style.font == .mono || style.font == .rounded ? style.font : .serif
        let font = FoleviType.editorFont(size: size, weight: .semibold, design: design, scale: scale)
        let tracking: CGFloat = design == .serif ? -0.012 : -0.02
        return TextRenderStyle(font: font, color: color ?? palette.map { NSColor($0.heading) } ?? .foleviHeading, lineSpacing: spacing(for: font, lineHeight: 1.12),
                              placeholder: String(localized: "Untitled"), kern: tracking * font.pointSize)
    }

    /// Heading size as a multiple of the body (web: h1 1.8em, serif 1.95em; h2 1.42em; h3 1.16em).
    static func headingFactor(_ level: HeadingLevel, font: DocumentFont) -> CGFloat {
        switch level {
        case .level1: return font == .serif ? 1.95 : 1.8
        case .level2: return 1.42
        case .level3: return 1.16
        }
    }

    static func style(for block: Block, document: DocumentStyle, scale: CGFloat, palette: SheetPalette? = nil) -> TextRenderStyle {
        var s = paragraph(style: document, scale: scale, palette: palette)
        let heading: NSColor = palette.map { NSColor($0.heading) } ?? .foleviHeading
        let muted: NSColor = palette.map { NSColor($0.muted) } ?? .foleviInkMuted
        let body = bodySize(document.font)
        switch block.content {
        case .heading(let h):
            let size = body * headingFactor(h.level, font: document.font)
            s.font = FoleviType.editorFont(size: size, weight: .semibold, design: document.font, scale: scale)
            s.color = heading
            s.lineSpacing = spacing(for: s.font, lineHeight: 1.22)
            let tracking: CGFloat = document.font == .serif ? -0.012 : h.level == .level1 ? -0.022 : h.level == .level2 ? -0.018 : -0.012
            s.kern = tracking * s.font.pointSize
            s.placeholder = String(localized: "Heading \(h.level.rawValue)")
        case .todo(let p):
            s.placeholder = String(localized: "To-do")
            if p.checked {
                s.color = muted
                s.strikethrough = true
            }
        case .bulleted, .numbered:
            // The web draws no hint in list items (only paragraphs, headings, to-dos, toggles and callouts).
            s.placeholder = ""
        case .toggle:
            s.font = FoleviFont.nsFont(FoleviFont.Family(document.font), size: s.font.pointSize, weight: FoleviFont.Face.medium)
            s.placeholder = String(localized: "List")
        case .quote:
            s.font = FoleviFont.nsFont(FoleviFont.Family(document.font), size: s.font.pointSize * (document.font == .serif ? 1.08 : 1), italic: true)
            // color-mix(heading 80%, ink)
            s.color = NSColor((palette?.heading ?? FoleviColor.heading).mix(with: palette?.ink ?? FoleviColor.ink, by: 0.2))
            s.placeholder = ""
        case .callout:
            s.placeholder = String(localized: "List")
        case .code:
            s.font = FoleviType.mono(size: 13.5, scale: scale)
            s.color = NSColor(FoleviColor.codeInk)
            s.lineSpacing = spacing(for: s.font, lineHeight: 1.65)
            s.kern = 0
            s.placeholder = ""
        default:
            break
        }
        return BlockStyles.applyLook(BlockLook(block.content), to: s, document: document, palette: palette)
    }

    static func lineHeight(_ style: TextRenderStyle) -> CGFloat {
        NSLayoutManager().defaultLineHeight(for: style.font) + style.lineSpacing
    }

    /// Space above and below a block (editor.css: 3px block padding, heading and quote margins, the
    /// margins of callouts, code and the atoms' frames), at the editor zoom.
    static func verticalPadding(for block: Block, document: DocumentStyle = defaultDocumentStyle, scale: CGFloat = 1) -> (top: CGFloat, bottom: CGFloat) {
        let body = bodySize(document.font)
        let pad: (CGFloat, CGFloat)
        switch block.content {
        case .heading(let h):
            let size = body * headingFactor(h.level, font: document.font)
            // margin-top 1.1em + padding-top 0.1em (h1), 0.95em (h2), 0.75em (h3), of the heading's size.
            let top: CGFloat = h.level == .level1 ? size * 1.2 : h.level == .level2 ? size * 0.95 : size * 0.75
            pad = (3 + top, 3)
        case .divider: pad = (0, 0)
        case .quote: pad = (3 + body * 0.35, 3 + body * 0.35)
        case .callout: pad = (body * 0.5, body * 0.5)
        case .code: pad = (13.5 * 0.5, 13.5 * 0.5)
        case .file: pad = (3 + 6, 3 + 6)
        case .page(let p): pad = p.display == .card ? (3 + 8, 3 + 8) : (3 + 2, 3 + 2)
        case .collection: pad = (3 + 12, 3 + 12)
        case .image, .table, .bookmark, .unknown: pad = (3 + 8, 3 + 8)
        default: pad = (3, 3)
        }
        return (pad.0 * scale, pad.1 * scale)
    }

    static func accessibilityName(_ block: Block) -> String {
        switch block.content {
        case .paragraph: return String(localized: "Text")
        case .heading(let h): return String(localized: "Heading \(h.level.rawValue)")
        case .bulleted: return String(localized: "Bulleted list item")
        case .numbered: return String(localized: "Numbered list item")
        case .todo(let p): return p.checked ? String(localized: "Completed to-do") : String(localized: "To-do")
        case .toggle: return String(localized: "Toggle")
        case .quote: return String(localized: "Quote")
        case .callout: return String(localized: "Callout")
        case .code: return String(localized: "Code")
        default: return block.typeName
        }
    }
}

extension UTType {
    static let foleviBlocks = UTType(exportedAs: "com.folevi.mac.blocks")
    static let foleviDocument = UTType(exportedAs: "com.folevi.mac.document-ref")
}

struct BlockRowView: View {
    let row: EditorRow
    @Bindable var model: EditorModel
    var openDocument: (String, Bool) -> Void
    @Environment(AppModel.self) private var app
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var hovering = false
    @State private var glowOpacity: Double = 0
    /// The pointer is on the grip (its AppKit tracker reports hover; keeps the gutter visible).
    @State private var gripHovering = false

    private var block: Block { row.block }
    private var scale: CGFloat { CGFloat(app.editorScale) }
    private var textStyle: TextRenderStyle {
        var s = BlockStyles.style(for: block, document: model.style, scale: scale, palette: model.sheetPalette)
        if case .paragraph = block.content {
            s.placeholder = BlockStyles.paragraphPlaceholder(lone: isLoneEmptyBlock, ai: model.aiWritable)
        }
        return s
    }
    private var isSelected: Bool { model.selectedBlockIds.contains(block.id) }
    private var isDragged: Bool { model.drag.draggedIds.contains(block.id) }
    private var indent: CGFloat { CGFloat(row.depth) * BlockMetrics.indent(scale) }
    private var docAccent: Color { Color.folevi(accent: model.style.accent) }
    /// 1em of the page's body text at this zoom (the web sizes markers in em).
    private var em: CGFloat { BlockStyles.bodySize(model.style.font) * scale }
    /// The height of one line of glyphs (markers centre on it, as on the web).
    private var glyphLine: CGFloat { NSLayoutManager().defaultLineHeight(for: textStyle.font) }

    var body: some View {
        let pad = BlockStyles.verticalPadding(for: block, document: model.style, scale: scale)
        HStack(alignment: .top, spacing: 0) {
            Color.clear.frame(width: indent, height: 1)
            hoverGutter
                .frame(width: BlockMetrics.gutter, alignment: .trailing)
            if lookPadding.leading > 0 { Color.clear.frame(width: lookPadding.leading, height: 1) }
            marker
            content
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, look.isPlain ? 0 : lookPadding.vertical)
        .padding(.top, pad.top)
        .padding(.bottom, pad.bottom)
        .padding(.trailing, 2)
        .background(alignment: .leading) { rowBackground }
        .overlay(alignment: .bottomLeading) {
            // A zero-height anchor on the row's bottom edge; the menu hangs below it. (An alignment-guide
            // trick placed it above the line instead, over the text and under the top bar.)
            Color.clear.frame(height: 0).overlay(alignment: .topLeading) {
                if let popup = model.popup, popup.blockId == block.id, popup.origin == nil {
                    popupView(popup)
                        .padding(.top, 6)
                        .padding(.leading, BlockMetrics.gutter + indent)
                        .fixedSize()
                } else if let request = model.datePick, request.blockId == block.id {
                    DatePickPopover(today: TaskLogic.localDate(), initial: request.editing?.date, editing: request.editing != nil) { date in
                        model.insertDate(date, for: request)
                    } onRemove: {
                        model.removeDate(for: request)
                    } onCancel: {
                        model.datePick = nil
                        model.focus = FocusRequest(blockId: request.blockId, caret: .offset(request.location))
                    }
                    .padding(.top, 6)
                    .padding(.leading, BlockMetrics.gutter + indent)
                    .fixedSize()
                }
            }
        }
        .overlay(alignment: .topLeading) {
            // The "/", "[[" and "@" lists hang 6pt below the character that opened them (the web's Popover).
            if let popup = model.popup, popup.blockId == block.id, let origin = popup.origin {
                popupView(popup)
                    .fixedSize()
                    .offset(x: max(0, origin.x), y: origin.y + 6)
            }
        }
        .overlay(alignment: .topLeading) {
            if let bubble = model.bubble, bubble.blockId == block.id, !model.isReadOnly {
                SelectionBubble(model: model, state: bubble)
                    .fixedSize()
                    .alignmentGuide(.leading) { d in d.width / 2 - bubble.rect.midX }
                    .alignmentGuide(.top) { d in d.height + 8 - bubble.rect.minY }
            }
        }
        .opacity(isDragged ? 0.35 : 1)
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
        .simultaneousGesture(TapGesture().modifiers(.shift).onEnded { model.select(block.id, extend: true) })
        .onGeometryChange(for: CGRect.self) { $0.frame(in: .named("blocks")) } action: { frame in
            model.drag.rowFrames[block.id] = frame
        }
        .onChange(of: model.drag.glow?.token) { _, _ in
            guard let glow = model.drag.glow, glow.id == block.id else { return }
            if reduceMotion {
                glowOpacity = 1
                Task { @MainActor in
                    try? await Task.sleep(for: .milliseconds(700))
                    glowOpacity = 0
                }
            } else {
                glowOpacity = 1
                withAnimation(.easeOut(duration: 0.7)) { glowOpacity = 0 }
            }
        }
        .contextMenu { contextMenu }
        .background(alignment: .bottomLeading) {
            // The audio recorder hangs below the line it was asked for (the web's 320pt popover).
            Color.clear.frame(width: 1, height: 1)
                .padding(.leading, BlockMetrics.gutter + indent)
                .foleviPopover(isPresented: Binding(get: { model.recordingTarget?.blockId == block.id },
                                                    set: { if !$0, model.recordingTarget?.blockId == block.id { model.recordingTarget = nil } }),
                               arrowEdge: .bottom) {
                    AudioRecorderSheet(model: model).environment(app)
                }
        }
        .sheet(isPresented: Binding(get: { model.bookmarkPrompt == block.id }, set: { if !$0, model.bookmarkPrompt == block.id { model.bookmarkPrompt = nil } })) {
            BookmarkPrompt { url in
                model.bookmarkPrompt = nil
                model.insertAfterCurrent(.bookmark(BookmarkProps(url: url, title: URL(string: url)?.host())), anchor: block.id)
            } onCancel: {
                model.bookmarkPrompt = nil
                if block.content.carriesText { model.focus = FocusRequest(blockId: block.id, caret: .end) }
            }
        }
        .accessibilityElement(children: .contain)
        .modifier(HeadingAccessibility(block: block))
    }

    /// The block's own styling (decoration, colour, card group…).
    private var look: BlockLook { BlockLook(block.content) }

    private var lookPadding: (vertical: CGFloat, leading: CGFloat) {
        if look.group == .card { return (4, 14) }
        if look.decoration != nil { return (4, 12) }
        return (0, 0)
    }

    /// Whether this block opens / closes a run of card-grouped blocks.
    private var cardEdges: (first: Bool, last: Bool) {
        guard look.group == .card, let i = model.rows.firstIndex(where: { $0.id == block.id }) else { return (true, true) }
        let grouped: (Int) -> Bool = { j in model.rows.indices.contains(j) && BlockLook(model.rows[j].block.content).group == .card }
        return (!grouped(i - 1), !grouped(i + 1))
    }

    /// The selected-block highlight covers the whole block (editor.css `.fb-selected`: the selection colour,
    /// 6px corners and, while blocks are selected, a hairline in the accent).
    @ViewBuilder private var rowBackground: some View {
        let shape = RoundedRectangle(cornerRadius: 6, style: .continuous)
        ZStack {
            if !look.isPlain {
                BlockLookBackground(look: look, edges: cardEdges, document: model.style, palette: model.sheetPalette)
                    .padding(.vertical, look.group == .card ? 0 : 2)
                    .padding(.leading, indent - 4)
            }
            if isSelected {
                shape.fill(FoleviColor.selection)
                shape.strokeBorder(FoleviColor.accent.opacity(0.35), lineWidth: 1)
            }
            shape.fill(FoleviColor.emberSoft).opacity(glowOpacity)
        }
        .padding(.leading, BlockMetrics.gutter - 2)
    }

    // MARK: Hover gutter (+ and grip in a small raised pill)

    private var hoverGutter: some View {
        let visible = (hovering || gripHovering || model.blockMenu?.anchorId == block.id) && !model.isReadOnly && !model.drag.isActive
        return HStack(spacing: 1) {
            Button {
                addBelow()
            } label: {
                Image(systemName: "plus")
                    .font(.system(size: 12, weight: .medium))
                    .frame(width: 24, height: 24)
                    .contentShape(Rectangle())
            }
            .buttonStyle(GutterButtonStyle())
            .help(Text("Insert block below"))
            .accessibilityLabel(Text("Insert block below"))
            grip(visible: visible)
        }
        .padding(2)
        .foleviSurface(.color(FoleviColor.surfaceRaised), shape: .rounded(8), shadow: FoleviShadow.control)
        .padding(.trailing, 6)
        .frame(height: max(28, glyphLine), alignment: .center)
        // Nearly invisible rather than 0, so the grip still takes the press that starts a drag.
        .opacity(visible ? 0.9 : 0.001)
        .animation(reduceMotion ? nil : .easeOut(duration: FoleviMotion.fast), value: visible)
        .allowsHitTesting(!model.isReadOnly)
        .foleviPopover(isPresented: Binding(get: { model.blockMenu?.anchorId == block.id },
                                            set: { if !$0, model.blockMenu?.anchorId == block.id { model.closeBlockMenu() } }),
                       arrowEdge: .leading) {
            if let menu = model.blockMenu { BlockOptionsMenu(model: model, menu: menu) }
        }
    }

    private func grip(visible: Bool) -> some View {
        GripDots(highlighted: gripHovering)
            .frame(width: 20, height: 24)
            .overlay {
                PointerDragSource(cursor: visible || gripHovering ? .openHand : .arrow,
                                  help: String(localized: "Drag to move, click for block options, Shift-click to select several blocks"),
                                  onHover: { gripHovering = $0 }, onClick: { openOptions() }) { start, current in
                    if !model.drag.isActive { model.drag.beginBlockDrag(blockId: block.id, start: start, current: current) }
                }
            }
            .accessibilityElement()
            .accessibilityLabel(Text("Drag to move, click for block options, Shift-click to select several blocks"))
            .accessibilityAddTraits(.isButton)
            .accessibilityAction { openOptions() }
            .accessibilityAction(named: Text("Move up")) { model.move([block.id], up: true) }
            .accessibilityAction(named: Text("Move down")) { model.move([block.id], up: false) }
            .accessibilityAction(named: Text("Delete block")) { model.delete([block.id]) }
    }

    /// The web's "+": a new line below with "/" typed, so the block menu opens there.
    private func addBelow() {
        model.insertSlashLine(after: block.id)
    }

    /// Click on the grip: Shift extends the block selection; otherwise the block menu opens for this block
    /// (or for every selected block when this one is among them).
    private func openOptions() {
        if NSEvent.modifierFlags.contains(.shift) {
            model.select(block.id, extend: true)
            return
        }
        let targets = isSelected ? model.orderedByRows(Array(model.selectedBlockIds)) : [block.id]
        if !isSelected { model.clearSelection() }
        model.openBlockMenu(targets, anchor: block.id)
    }

    // MARK: Markers (bullets, numbers, checkboxes, disclosure, quote bar)

    @ViewBuilder private var marker: some View {
        let line = glyphLine
        switch block.content {
        case .bulleted:
            // editor.css: a 0.36em dot at 0.55em, in the accent mixed with the heading colour; rings at
            // depths 1 and 4, small squares at 2 and 5. The text starts at 1.6em.
            let d = 0.36 * em
            let color = docAccent.mix(with: model.sheetPalette?.heading ?? FoleviColor.heading, by: 0.15)
            Group {
                switch row.depth % 3 {
                case 0: Circle().fill(color)
                case 1: Circle().strokeBorder(color, lineWidth: 1.5)
                default: RoundedRectangle(cornerRadius: 1).fill(color)
                }
            }
            .frame(width: d, height: d)
            .padding(.leading, 0.55 * em)
            .frame(width: 1.6 * em, height: line, alignment: .leading)
            .accessibilityHidden(true)
        case .numbered:
            Text(verbatim: "\(row.number ?? 1).")
                .font(Font(FoleviFont.nsFont(FoleviFont.Family(model.style.font), size: em, weight: FoleviFont.Face.medium)).monospacedDigit())
                .foregroundStyle(model.sheetPalette?.muted ?? FoleviColor.inkMuted)
                .lineLimit(1)
                .fixedSize()
                .frame(width: 1.35 * em, alignment: .trailing)
                .frame(width: 1.6 * em, height: line, alignment: .leading)
                .accessibilityHidden(true)
        case .todo(let p):
            TodoCheck(checked: p.checked, scale: scale) { model.toggleTodo(block.id) }
                .offset(x: -4 * scale)
                .frame(width: 1.6 * em, height: line, alignment: .leading)
                .disabled(model.isReadOnly)
                .accessibilityLabel(Text(p.checked ? "Mark as not done" : "Mark as done"))
                .accessibilityValue(Text(p.checked ? "Done" : "Not done"))
                .accessibilityIdentifier("todo.checkbox.\(block.id)")
        case .toggle(let p):
            DisclosureButton(collapsed: p.collapsed, em: em, scale: scale) { model.toggleCollapsed(block.id) }
                .offset(x: -4 * scale)
                .frame(width: 18 * scale + 0.35 * em, height: line, alignment: .leading)
                .accessibilityLabel(Text(p.collapsed ? "Expand" : "Collapse"))
                .accessibilityValue(Text(p.collapsed ? "Collapsed" : "Expanded"))
        case .quote:
            // A 3px bar in the accent; the text starts at 1.05em.
            Capsule()
                .fill(docAccent)
                .frame(width: 3)
                .padding(.vertical, -1.8 * scale)
                .frame(width: 1.05 * em, alignment: .leading)
                .accessibilityHidden(true)
        default:
            EmptyView()
        }
    }

    // MARK: Content

    @ViewBuilder private var content: some View {
        switch block.content {
        case .paragraph, .heading, .bulleted, .numbered, .toggle, .quote:
            textEditor
        case .todo(let p):
            HStack(alignment: .top, spacing: 6) {
                textEditor
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .layoutPriority(1)
                TodoMetaView(blockId: block.id, props: p, model: model)
                    .fixedSize()
            }
        case .callout(let p):
            let tone = CalloutLook(tone: p.tone)
            HStack(alignment: .top, spacing: 0.6 * em) {
                // The tone's mark (a text symbol, never an emoji), bold, 1.4em wide.
                Text(verbatim: p.icon.flatMap { $0.isEmpty ? nil : $0 } ?? CalloutLook.symbol(p.tone)) // the stored icon first, as the web
                    .font(Font(FoleviFont.nsFont(FoleviFont.Family(model.style.font), size: em, weight: FoleviFont.Face.bold)))
                    .foregroundStyle(tone.ink)
                    .frame(width: 1.4 * em, height: glyphLine)
                    .accessibilityHidden(true)
                textEditor
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, em)
            .padding(.vertical, 0.8 * em)
            .foleviSurface(.color(tone.bg), shape: .rounded(8), shadow: FoleviDepth.calloutRim)
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text("Callout"))
        case .code(let p) where p.language == "mermaid":
            MermaidBlockView(block: block, props: p, model: model, focusRequest: focusRequest)
        case .code(let p):
            CodeBlockView(block: block, props: p, model: model, focusRequest: focusRequest)
        case .divider(let p):
            DividerLineView(style: p.style, separator: model.style.separator, palette: model.sheetPalette,
                            selected: isSelected, accent: docAccent)
                .padding(.vertical, 0.7 * em - 11)
                .contentShape(Rectangle().inset(by: -8))
                .onTapGesture { model.select(block.id, extend: false) }
        case .pageBreak:
            PageBreakBlockView(palette: model.sheetPalette)
                .contentShape(Rectangle())
                .onTapGesture { model.select(block.id, extend: false) }
        case .formula(let p):
            FormulaBlockView(block: block, props: p, model: model)
        case .whiteboard(let p):
            WhiteboardBlockView(block: block, props: p, model: model)
        case .image(let p):
            ImageBlockView(block: block, props: p, model: model, selected: isSelected)
        case .file(let p):
            FileBlockView(block: block, props: p, model: model)
        case .table(let p):
            TableBlockView(block: block, props: p, model: model, selected: isSelected)
        case .page(let p):
            PageBlockView(props: p, openDocument: openDocument)
        case .bookmark(let p):
            BookmarkBlockView(block: block, props: p, model: model, selected: isSelected)
        case .collection(let p):
            CollectionBlockView(props: p, isEditable: !model.isReadOnly, openDocument: openDocument)
        case .unknown(AudioProps.type, let props):
            if let p = AudioProps(props) {
                AudioBlockView(block: block, props: p, model: model)
            } else {
                UnknownBlockView(type: AudioProps.type, onRemove: model.isReadOnly ? nil : { model.delete([block.id]) })
                    .onTapGesture { model.select(block.id, extend: false) }
            }
        case .unknown(FlowchartProps.type, let props):
            if let p = FlowchartProps(props) {
                FlowchartBlockView(block: block, props: p, model: model)
            } else {
                UnknownBlockView(type: FlowchartProps.type, onRemove: model.isReadOnly ? nil : { model.delete([block.id]) })
                    .onTapGesture { model.select(block.id, extend: false) }
            }
        case .unknown(let type, _):
            UnknownBlockView(type: type, onRemove: model.isReadOnly ? nil : { model.delete([block.id]) })
                .onTapGesture { model.select(block.id, extend: false) }
        }
    }

    /// An empty document's only block shows its placeholder even when unfocused.
    private var isLoneEmptyBlock: Bool {
        model.rows.count == 1 && block.text.isEmpty && !model.isReadOnly
    }

    private var focusRequest: FocusRequest? {
        model.focus?.blockId == block.id ? model.focus : nil
    }

    private var textEditor: some View {
        BlockTextEditor(blockId: block.id, text: block.text, style: textStyle, isEditable: !model.isReadOnly,
                        accessibilityLabel: BlockStyles.accessibilityName(block), model: model, focusRequest: focusRequest,
                        alwaysShowPlaceholder: isLoneEmptyBlock)
    }

    // MARK: Popups

    @ViewBuilder private func popupView(_ popup: PopupState) -> some View {
        switch popup.kind {
        case .slash:
            SuggestionMenuView(items: model.slashItems(for: popup.query).map(SuggestionRow.init(slash:)), selected: popup.selectedIndex,
                               emptyLabel: String(localized: "No matches"), label: String(localized: "Insert block")) { idx in model.commitPopup(index: idx) }
        case .pageLink:
            SuggestionMenuView(items: model.pageChoices(for: popup.query).map(SuggestionRow.init(page:)), selected: popup.selectedIndex,
                               emptyLabel: String(localized: "Type to search pages"), label: String(localized: "Link to page")) { idx in model.commitPopup(index: idx) }
        case .mention:
            SuggestionMenuView(items: model.mentionChoices(for: popup.query).map(SuggestionRow.init(mention:)), selected: popup.selectedIndex,
                               emptyLabel: String(localized: "No matches"), label: String(localized: "Mention a person or date")) { idx in model.commitPopup(index: idx) }
        }
    }

    // MARK: Context menu (the block menu's commands)

    @ViewBuilder private var contextMenu: some View {
        let targets = model.selectedBlockIds.contains(block.id) ? model.orderedByRows(Array(model.selectedBlockIds)) : [block.id]
        let anyText = targets.contains { model.blocks[$0].map { $0.content.carriesText || $0.typeName == "code" } ?? false }
        if anyText {
            Menu("Turn into") {
                ForEach(TurnIntoOption.all) { option in
                    Button(option.title) { model.turnInto(option.id, ids: targets) }
                }
            }
            .disabled(model.isReadOnly)
            Divider()
        }
        Button("Duplicate") { model.duplicate(targets) }.disabled(model.isReadOnly)
        Button("Move up") { model.move(targets, up: true) }.disabled(model.isReadOnly)
        Button("Move down") { model.move(targets, up: false) }.disabled(model.isReadOnly)
        Button("Indent") { model.indent(targets) }.disabled(model.isReadOnly)
        Button("Outdent") { model.outdent(targets) }.disabled(model.isReadOnly)
        if targets.count == 1 {
            Button("Comment") { model.comments.openBlock(block.id) }.disabled(model.comments.data?.canComment != true)
            Button("Copy link to block") { model.copyLink(toBlock: block.id) }
        }
        Divider()
        Button(targets.count > 1 ? "Delete \(targets.count) blocks" : "Delete", role: .destructive) { model.delete(targets) }.disabled(model.isReadOnly)
    }
}

/// A callout's tone (editor.css `.fb-tone-*`): the background and the colour of its mark.
struct CalloutLook {
    var bg: Color
    var ink: Color

    init(tone: CalloutTone) {
        switch tone {
        case .note: (bg, ink) = (FoleviColor.emberSoft, FoleviColor.emberInk)
        case .info: (bg, ink) = (FoleviColor.accentSoft, FoleviColor.accentSoftInk)
        case .success: (bg, ink) = (FoleviColor.mossSoft, FoleviColor.mossInk)
        case .warning: (bg, ink) = (FoleviColor.marigoldSoft, FoleviColor.marigoldInk)
        case .danger: (bg, ink) = (FoleviColor.coralSoft, FoleviColor.coralInk)
        }
    }

    /// The web's `calloutIcon`: text symbols (with the text presentation selector), not emoji.
    static func symbol(_ tone: CalloutTone) -> String {
        switch tone {
        case .info: return "\u{2139}\u{FE0E}"
        case .success: return "\u{2713}"
        case .warning: return "!"
        case .danger: return "\u{203C}\u{FE0E}"
        case .note: return "\u{2733}\u{FE0E}"
        }
    }
}

/// The toggle's disclosure: a small triangle (right when collapsed, down when open) in a round 24pt target.
struct DisclosureButton: View {
    var collapsed: Bool
    var em: CGFloat
    var scale: CGFloat
    var action: () -> Void
    @State private var hovering = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Button(action: action) {
            Triangle()
                .fill(hovering ? FoleviColor.ink : FoleviColor.inkMuted)
                .frame(width: 0.42 * em, height: 0.6 * em)
                .rotationEffect(.degrees(collapsed ? 0 : 90))
                .animation(reduceMotion ? nil : .easeOut(duration: 0.16), value: collapsed)
                .frame(width: 24 * scale, height: 24 * scale)
                .background(Circle().fill(hovering ? FoleviColor.surfaceSunken : .clear))
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
    }

    private struct Triangle: Shape {
        func path(in rect: CGRect) -> Path {
            var p = Path()
            p.move(to: CGPoint(x: rect.minX, y: rect.minY))
            p.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
            p.addLine(to: CGPoint(x: rect.minX, y: rect.maxY))
            p.closeSubpath()
            return p
        }
    }
}

/// The 6-dot grip.
struct GripDots: View {
    var highlighted = false
    var body: some View {
        let hovering = highlighted
        Canvas { ctx, size in
            let d: CGFloat = 2.6, gx: CGFloat = 4.2, gy: CGFloat = 4.4
            let ox = (size.width - (d + gx)) / 2, oy = (size.height - (d + 2 * gy)) / 2
            for c in 0..<2 {
                for r in 0..<3 {
                    ctx.fill(Path(ellipseIn: CGRect(x: ox + CGFloat(c) * gx, y: oy + CGFloat(r) * gy, width: d, height: d)),
                             with: .color(hovering ? FoleviColor.heading : FoleviColor.inkMuted))
                }
            }
        }
        .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(hovering ? FoleviColor.accentSoft : .clear))
        .accessibilityHidden(true)
    }
}

/// The to-do checkbox (editor.css `.fb-check`): an 18pt box with 4pt corners in a 24pt target. Unchecked:
/// a raised fill and a strong hairline (moss on hover). Checked: a moss gradient and a white check.
struct TodoCheck: View {
    var checked: Bool
    var scale: CGFloat
    var action: () -> Void
    @State private var hovering = false
    @State private var pressed = false

    var body: some View {
        Button(action: action) {
            ZStack {
                let box = RoundedRectangle(cornerRadius: 4 * scale, style: .continuous)
                if checked {
                    box.fill(LinearGradient(colors: [FoleviColor.moss.mix(with: .white, by: 0.18), FoleviColor.moss], startPoint: .top, endPoint: .bottom))
                        .overlay(box.strokeBorder(LinearGradient(colors: [.white.opacity(0.35), .clear], startPoint: .top, endPoint: .center), lineWidth: 1))
                        .shadow(color: FoleviColor.moss.opacity(0.45), radius: 1, y: 1)
                    CheckMark()
                        .stroke(.white, style: StrokeStyle(lineWidth: 2 * scale, lineCap: .square, lineJoin: .miter))
                        .frame(width: 18 * scale, height: 18 * scale)
                } else {
                    box.fill(LinearGradient(colors: [FoleviColor.surfaceRaised, FoleviColor.surfaceRaised.mix(with: FoleviColor.surfaceSunken, by: 0.08)], startPoint: .top, endPoint: .bottom))
                        .overlay(box.strokeBorder(hovering ? FoleviColor.moss : FoleviColor.lineStrong, lineWidth: 1.5))
                        .shadow(color: FoleviColor.heading.opacity(0.08), radius: 0.5, y: 1)
                }
            }
            .frame(width: 18 * scale, height: 18 * scale)
            .scaleEffect(pressed ? 0.92 : 1)
            .frame(width: 24 * scale, height: 24 * scale)
            .contentShape(Rectangle())
        }
        .buttonStyle(PressReportingStyle(pressed: $pressed))
        .onHover { hovering = $0 }
        .animation(.easeOut(duration: 0.14), value: checked)
        .animation(.easeOut(duration: 0.12), value: pressed)
    }

    /// The CSS check: a 5x9 "L" (2pt strokes) turned 45 degrees, nudged up 2pt.
    private struct CheckMark: Shape {
        func path(in rect: CGRect) -> Path {
            let u = rect.width / 18
            var p = Path()
            p.move(to: CGPoint(x: 5.6 * u, y: 9.0 * u))
            p.addLine(to: CGPoint(x: 8.0 * u, y: 11.6 * u))
            p.addLine(to: CGPoint(x: 12.6 * u, y: 5.6 * u))
            return p
        }
    }

    private struct PressReportingStyle: ButtonStyle {
        @Binding var pressed: Bool
        func makeBody(configuration: Configuration) -> some View {
            configuration.label
                .onChange(of: configuration.isPressed) { _, v in pressed = v }
        }
    }
}

/// Quiet square hover for gutter controls.
struct GutterButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        GutterButtonBody(configuration: configuration)
    }

    private struct GutterButtonBody: View {
        let configuration: ButtonStyle.Configuration
        @State private var hovering = false
        var body: some View {
            configuration.label
                .foregroundStyle(hovering ? FoleviColor.heading : FoleviColor.inkMuted)
                .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(hovering || configuration.isPressed ? FoleviColor.accentSoft : .clear))
                .onHover { hovering = $0 }
        }
    }
}

struct HeadingAccessibility: ViewModifier {
    let block: Block
    func body(content: Content) -> some View {
        if case .heading(let h) = block.content {
            content
                .accessibilityAddTraits(.isHeader)
                .accessibilityHeading(h.level == .level1 ? .h1 : h.level == .level2 ? .h2 : .h3)
        } else {
            content
        }
    }
}

/// The block menu's "Turn into" choices, in the web's order (EditorMenus.tsx `TURN_INTO`), with the web's
/// keyboard shortcuts (⌘⌥0 to ⌘⌥3, ⌘⇧7 numbered, ⌘⇧8 bulleted, ⌘⇧9 to-do).
struct TurnIntoOption: Identifiable {
    var id: String
    var title: LocalizedStringKey
    var shortcut: KeyEquivalent?
    var modifiers: EventModifiers = [.command, .option]

    var plainTitle: String {
        switch id {
        case "paragraph": return String(localized: "Text")
        case "heading1": return String(localized: "Heading 1")
        case "heading2": return String(localized: "Heading 2")
        case "heading3": return String(localized: "Heading 3")
        case "todo": return String(localized: "To-do")
        case "bulleted": return String(localized: "Bulleted")
        case "numbered": return String(localized: "Numbered")
        case "toggle": return String(localized: "Toggle")
        case "code": return String(localized: "Code")
        case "quote": return String(localized: "Quote")
        default: return String(localized: "Callout")
        }
    }

    static var all: [TurnIntoOption] { [
        TurnIntoOption(id: "paragraph", title: "Text", shortcut: "0"),
        TurnIntoOption(id: "heading1", title: "Heading 1", shortcut: "1"),
        TurnIntoOption(id: "heading2", title: "Heading 2", shortcut: "2"),
        TurnIntoOption(id: "heading3", title: "Heading 3", shortcut: "3"),
        TurnIntoOption(id: "todo", title: "To-do", shortcut: "9", modifiers: [.command, .shift]),
        TurnIntoOption(id: "bulleted", title: "Bulleted", shortcut: "8", modifiers: [.command, .shift]),
        TurnIntoOption(id: "numbered", title: "Numbered", shortcut: "7", modifiers: [.command, .shift]),
        TurnIntoOption(id: "toggle", title: "Toggle", shortcut: nil),
        TurnIntoOption(id: "quote", title: "Quote", shortcut: nil),
        TurnIntoOption(id: "callout", title: "Callout", shortcut: nil),
        TurnIntoOption(id: "code", title: "Code", shortcut: nil),
    ] }
}

extension View {
    /// A menu command's shortcut, when it has one.
    @ViewBuilder func optionalShortcut(_ key: KeyEquivalent?, modifiers: EventModifiers) -> some View {
        if let key { keyboardShortcut(key, modifiers: modifiers) } else { self }
    }
}

// MARK: - Suggestion menus ("/", "[[", "@")

/// One row of a suggestion menu: an icon tile, a label and a hint.
struct SuggestionRow: Identifiable {
    enum Icon { case symbol(String), ai, letter(String) }
    var id: String
    var label: String
    var hint: String?
    var icon: Icon

    init(slash item: SlashItem) {
        id = item.id
        label = item.plainTitle
        hint = item.shortcut
        icon = item.systemImage == SlashItem.aiSymbol ? .ai : .symbol(item.systemImage)
    }

    init(page choice: PageChoice) {
        id = choice.id
        label = choice.isCreate ? String(localized: "Create page “\(choice.title)”") : choice.title
        hint = nil
        icon = .symbol(choice.isCreate ? "plus" : "doc.text")
    }

    init(mention choice: MentionChoice) {
        id = choice.id
        label = choice.label
        hint = choice.hint
        switch choice.kind {
        case .person: icon = .letter(String(choice.label.prefix(1)))
        case .date, .pickDate: icon = .symbol("calendar")
        }
    }
}

/// The web's suggestion list (EditorMenus.tsx `Popover` + `ListMenu`): a 300pt raised card, rows with a
/// 28pt icon tile, the label and a faint hint; the active row in the soft accent.
struct SuggestionMenuView: View {
    var items: [SuggestionRow]
    var selected: Int
    var emptyLabel: String
    var label: String
    var onChoose: (Int) -> Void
    @State private var hovered: Int?

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if items.isEmpty {
                        Text(emptyLabel).font(.ui(14)).foregroundStyle(FoleviColor.inkMuted)
                            .padding(.horizontal, 12).padding(.vertical, 8)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    ForEach(Array(items.enumerated()), id: \.element.id) { idx, item in
                        let active = idx == selected
                        Button { onChoose(idx) } label: {
                            HStack(spacing: 10) {
                                iconTile(item.icon)
                                Text(item.label).font(.ui(14)).foregroundStyle(active ? FoleviColor.heading : FoleviColor.ink)
                                    .lineLimit(1).truncationMode(.tail)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                if let hint = item.hint, !hint.isEmpty {
                                    Text(verbatim: hint).font(.ui(12)).foregroundStyle(FoleviColor.inkFaint)
                                }
                            }
                            .padding(.horizontal, 8)
                            .padding(.vertical, 6)
                            .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(active ? FoleviColor.accentSoft : Color.clear))
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .id(idx)
                        .accessibilityAddTraits(active ? .isSelected : [])
                    }
                }
                .padding(6)
            }
            .scrollIndicators(.automatic)
            .onChange(of: selected) { _, s in proxy.scrollTo(s) }
        }
        .frame(width: 300, height: min(412, CGFloat(max(items.count, 1)) * 40 + 12))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .foleviPop()
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(label))
        .accessibilityValue(Text(items.count == 1 ? String(localized: "1 suggestion") : String(localized: "\(items.count) suggestions")))
        .accessibilityIdentifier("slashMenu")
    }

    @ViewBuilder private func iconTile(_ icon: SuggestionRow.Icon) -> some View {
        Group {
            switch icon {
            case .ai: AiIcon(size: 15)
            case .symbol(let name): Image(systemName: name).font(.system(size: 13, weight: .medium)).foregroundStyle(FoleviColor.heading)
            case .letter(let l): Text(verbatim: l).font(.ui(12, .semibold)).foregroundStyle(FoleviColor.heading)
            }
        }
        .frame(width: 28, height: 28)
        .foleviSurface(.color(FoleviColor.surface), shape: .rounded(6), shadow: FoleviShadow.control)
        .accessibilityHidden(true)
    }
}

// MARK: - Block menu (the grip's options)

/// Which blocks the block menu acts on, and the grip it hangs from.
struct BlockMenuRequest: Equatable {
    var ids: [String]
    var anchorId: String
}

/// The web's block menu (EditorMenus.tsx `BlockHandle`): "N blocks selected", Turn into (two columns),
/// then Ask AI, Duplicate, Move up / down, Indent, Outdent, Comment, Copy link to block and Delete, each
/// with its shortcut. ↑/↓ move between items, Return runs one, Escape closes.
struct BlockOptionsMenu: View {
    @Bindable var model: EditorModel
    var menu: BlockMenuRequest
    @State private var active: Int?
    @FocusState private var focused: Bool

    private struct Item: Identifiable {
        var id: String
        var label: String
        var hint: String
        var icon: String?
        var ai = false
        var danger = false
        var run: () -> Void
    }

    private var count: Int { menu.ids.count }
    private var anyText: Bool { menu.ids.contains { model.blocks[$0].map { $0.content.carriesText || $0.typeName == "code" } ?? false } }
    private var single: String? { count == 1 ? menu.ids.first : nil }

    private var turnInto: [Item] {
        TurnIntoOption.all.map { option in
            Item(id: "turn-\(option.id)", label: option.plainTitle, hint: "", icon: nil) { act { model.turnInto(option.id, ids: menu.ids) } }
        }
    }

    private var actions: [Item] {
        var out: [Item] = []
        if model.aiWritable && anyText {
            out.append(Item(id: "ai", label: String(localized: "Ask AI…"), hint: "⌘J", icon: nil, ai: true) {
                model.closeBlockMenu()
                model.selectedBlockIds = Set(menu.ids)
                model.focusedBlockId = nil
                model.openInlineAi()
            })
        }
        out.append(Item(id: "duplicate", label: String(localized: "Duplicate"), hint: "⌘D", icon: "doc.on.doc") { act { model.duplicate(menu.ids) } })
        out.append(Item(id: "up", label: String(localized: "Move up"), hint: "⌥⇧↑", icon: "arrow.up") { act { model.move(menu.ids, up: true) } })
        out.append(Item(id: "down", label: String(localized: "Move down"), hint: "⌥⇧↓", icon: "arrow.down") { act { model.move(menu.ids, up: false) } })
        out.append(Item(id: "indent", label: String(localized: "Indent"), hint: "Tab", icon: "increase.indent") { act { model.indent(menu.ids) } })
        out.append(Item(id: "outdent", label: String(localized: "Outdent"), hint: "⇧Tab", icon: "decrease.indent") { act { model.outdent(menu.ids) } })
        if let single, model.comments.data?.canComment == true {
            out.append(Item(id: "comment", label: String(localized: "Comment"), hint: "⌘⌥M", icon: "text.bubble") {
                model.closeBlockMenu()
                model.comments.openBlock(single)
            })
        }
        if let single {
            out.append(Item(id: "link", label: String(localized: "Copy link to block"), hint: "", icon: "link") {
                model.closeBlockMenu()
                model.copyLink(toBlock: single)
            })
        }
        out.append(Item(id: "delete", label: count > 1 ? String(localized: "Delete \(count) blocks") : String(localized: "Delete"), hint: "⌘⇧⌫", icon: "trash", danger: true) {
            model.closeBlockMenu()
            model.delete(menu.ids)
        })
        return out
    }

    private var all: [Item] { (anyText ? turnInto : []) + actions }

    private func act(_ fn: () -> Void) {
        model.closeBlockMenu()
        fn()
    }

    var body: some View {
        let items = all
        let editable = !model.isReadOnly
        VStack(alignment: .leading, spacing: 0) {
            if count > 1 {
                Text("\(count) blocks selected").font(.ui(12)).foregroundStyle(FoleviColor.inkMuted)
                    .padding(.horizontal, 8).padding(.top, 2).padding(.bottom, 4)
            }
            if anyText {
                Text("Turn into").foleviCapsLabel().padding(.horizontal, 8).padding(.top, 4).padding(.bottom, 6)
                    .accessibilityHidden(true)
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 2), GridItem(.flexible(), spacing: 2)], spacing: 2) {
                    ForEach(Array(turnInto.enumerated()), id: \.element.id) { i, item in
                        row(item, index: i, active: active == i)
                    }
                }
                .accessibilityElement(children: .contain)
                .accessibilityLabel(Text("Turn into"))
                Rectangle().fill(FoleviColor.line).frame(height: 1).padding(.horizontal, 8).padding(.vertical, 6)
            }
            let offset = anyText ? turnInto.count : 0
            ForEach(Array(actions.enumerated()), id: \.element.id) { i, item in
                row(item, index: offset + i, active: active == offset + i)
            }
        }
        .padding(4)
        .padding(6)
        .frame(width: 240)
        .disabled(!editable)
        .focusable()
        .focused($focused)
        .focusEffectDisabled()
        .onAppear { focused = true }
        .onKeyPress(.downArrow) { active = ((active ?? -1) + 1) % max(1, items.count); return .handled }
        .onKeyPress(.upArrow) { active = ((active ?? items.count) - 1 + items.count) % max(1, items.count); return .handled }
        .onKeyPress(.rightArrow) { active = ((active ?? -1) + 1) % max(1, items.count); return .handled }
        .onKeyPress(.leftArrow) { active = ((active ?? items.count) - 1 + items.count) % max(1, items.count); return .handled }
        .onKeyPress(.home) { active = 0; return .handled }
        .onKeyPress(.end) { active = items.count - 1; return .handled }
        .onKeyPress(.return) {
            if let a = active, items.indices.contains(a) { items[a].run() }
            return .handled
        }
        .onKeyPress(.tab) { model.closeBlockMenu(); return .handled }
        .onExitCommand { model.closeBlockMenu() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(count > 1 ? "Options for \(count) blocks" : "Block options"))
    }

    private func row(_ item: Item, index: Int, active isActive: Bool) -> some View {
        BlockMenuRow(label: item.label, hint: item.hint, icon: item.icon, ai: item.ai, danger: item.danger, active: isActive,
                     compact: item.icon == nil && !item.ai, action: item.run) { hovering in
            if hovering { active = index }
        }
    }
}

private struct BlockMenuRow: View {
    var label: String
    var hint: String
    var icon: String?
    var ai: Bool
    var danger: Bool
    var active: Bool
    var compact: Bool
    var action: () -> Void
    var onHover: (Bool) -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if ai {
                    AiIcon(size: 14).frame(width: 16)
                } else if let icon {
                    Image(systemName: icon).font(.system(size: 12.5)).foregroundStyle(FoleviColor.inkMuted).frame(width: 16)
                }
                Text(label).font(.ui(14)).lineLimit(1)
                    .foregroundStyle(danger ? FoleviColor.destructive : active ? FoleviColor.heading : FoleviColor.ink)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if !compact, !hint.isEmpty {
                    Text(verbatim: hint).font(.ui(12)).foregroundStyle(FoleviColor.inkFaint)
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(active ? FoleviColor.accentSoft : .clear))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover(perform: onHover)
    }
}
