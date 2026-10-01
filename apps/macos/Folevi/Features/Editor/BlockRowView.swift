import AppKit
import SwiftUI
import UniformTypeIdentifiers

/// Editor geometry shared by rows, the header and drag and drop.
enum BlockMetrics {
    /// The hover gutter (+ and grip) left of the text column.
    static let gutter: CGFloat = 52
    /// One nesting level (the 24pt indent grid).
    static func indent(_ scale: CGFloat) -> CGFloat { 24 * scale }
}

/// Text styles per block type, derived from the document style and editor zoom.
enum BlockStyles {
    /// Body size per document family (web: sans 16, serif 17.5, mono 15).
    static func bodySize(_ font: DocumentFont) -> CGFloat {
        switch font {
        case .sans, .rounded: return FoleviFontSize.body
        case .serif: return 17.5
        case .mono: return 15
        }
    }

    /// Line spacing that gives `lineHeight` × size lines.
    static func spacing(for font: NSFont, lineHeight: CGFloat) -> CGFloat {
        max(0, (font.pointSize * lineHeight - NSLayoutManager().defaultLineHeight(for: font)).rounded())
    }

    static func paragraph(style: DocumentStyle, scale: CGFloat, palette: SheetPalette? = nil) -> TextRenderStyle {
        let font = FoleviType.editorFont(size: bodySize(style.font), design: style.font, scale: scale)
        return TextRenderStyle(font: font, color: palette.map { NSColor($0.ink) } ?? .foleviInk, lineSpacing: spacing(for: font, lineHeight: 1.6),
                              placeholder: String(localized: "Start writing, or type '/' for commands"),
                              kern: style.font == .mono ? 0 : FoleviTracking.normal * font.pointSize)
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

    static func style(for block: Block, document: DocumentStyle, scale: CGFloat, palette: SheetPalette? = nil) -> TextRenderStyle {
        var s = paragraph(style: document, scale: scale, palette: palette)
        let heading: NSColor = palette.map { NSColor($0.heading) } ?? .foleviHeading
        let muted: NSColor = palette.map { NSColor($0.muted) } ?? .foleviInkMuted
        switch block.content {
        case .heading(let h):
            let size: CGFloat = h.level == .level1 ? FoleviFontSize.h1 : h.level == .level2 ? FoleviFontSize.h2 : FoleviFontSize.h3
            s.font = FoleviType.editorFont(size: size, weight: .semibold, design: document.font, scale: scale)
            s.color = heading
            s.lineSpacing = spacing(for: s.font, lineHeight: 1.25)
            s.kern = document.font == .mono ? 0 : FoleviTracking.tight * s.font.pointSize
            s.placeholder = String(localized: "Heading \(h.level.rawValue)")
        case .todo(let p):
            s.placeholder = String(localized: "To-do")
            if p.checked {
                s.color = muted
                s.strikethrough = true
            }
        case .bulleted, .numbered:
            s.placeholder = String(localized: "List")
        case .toggle:
            s.font = FoleviFont.nsFont(FoleviFont.Family(document.font), size: s.font.pointSize, weight: FoleviFont.Face.medium)
            s.placeholder = String(localized: "Toggle")
        case .quote:
            s.font = FoleviFont.nsFont(FoleviFont.Family(document.font), size: s.font.pointSize * (document.font == .serif ? 1.08 : 1), italic: true)
            s.color = NSColor((palette?.ink ?? FoleviColor.ink).mix(with: palette?.muted ?? FoleviColor.inkMuted, by: 0.15))
            s.placeholder = String(localized: "Quote")
        case .callout:
            s.placeholder = String(localized: "Callout")
        case .code:
            s.font = FoleviType.mono(size: 13.5, scale: scale)
            s.color = NSColor(FoleviColor.codeInk)
            s.lineSpacing = spacing(for: s.font, lineHeight: 1.6)
            s.kern = 0
            s.placeholder = String(localized: "Code")
        default:
            break
        }
        return s
    }

    static func lineHeight(_ style: TextRenderStyle) -> CGFloat {
        NSLayoutManager().defaultLineHeight(for: style.font) + style.lineSpacing
    }

    static func verticalPadding(for block: Block) -> (top: CGFloat, bottom: CGFloat) {
        switch block.content {
        case .heading(let h): return h.level == .level1 ? (26, 6) : h.level == .level2 ? (20, 4) : (14, 2)
        case .divider: return (4, 4)
        case .image, .table, .code, .callout, .page, .bookmark, .collection, .file: return (7, 7)
        case .quote: return (5, 5)
        default: return (3, 3)
        }
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
    private var textStyle: TextRenderStyle { BlockStyles.style(for: block, document: model.style, scale: scale, palette: model.sheetPalette) }
    private var isSelected: Bool { model.selectedBlockIds.contains(block.id) }
    private var isMatch: Bool { model.findMatches.contains(block.id) }
    private var isDragged: Bool { model.drag.draggedIds.contains(block.id) }
    private var indent: CGFloat { CGFloat(row.depth) * BlockMetrics.indent(scale) }
    private var docAccent: Color { Color.folevi(accent: model.style.accent) }

    var body: some View {
        let pad = BlockStyles.verticalPadding(for: block)
        HStack(alignment: .top, spacing: 0) {
            Color.clear.frame(width: indent, height: 1)
            hoverGutter
                .frame(width: BlockMetrics.gutter, alignment: .trailing)
            marker
            content
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.top, pad.top)
        .padding(.bottom, pad.bottom)
        .padding(.trailing, 2)
        .background(alignment: .leading) { rowBackground }
        .overlay(alignment: .bottomLeading) {
            if let popup = model.popup, popup.blockId == block.id {
                popupView(popup)
                    .alignmentGuide(.bottom) { d in d[.top] - 4 }
                    .padding(.leading, BlockMetrics.gutter + indent)
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
        .accessibilityElement(children: .contain)
        .modifier(HeadingAccessibility(block: block))
    }

    @ViewBuilder private var rowBackground: some View {
        let shape = RoundedRectangle(cornerRadius: 8, style: .continuous)
        ZStack {
            if isSelected {
                shape.fill(FoleviColor.selection.opacity(0.7))
            } else if isMatch && !model.findQuery.isEmpty {
                shape.fill(FoleviColor.highlightYellow.opacity(0.6))
            }
            shape.fill(FoleviColor.emberSoft).opacity(glowOpacity)
        }
        .padding(.leading, BlockMetrics.gutter + indent - 6)
        .padding(.trailing, -4)
    }

    // MARK: Hover gutter (+ and grip in a small raised pill)

    private var hoverGutter: some View {
        let lh = BlockStyles.lineHeight(textStyle)
        let visible = (hovering || gripHovering) && !model.isReadOnly && !model.drag.isActive
        return HStack(spacing: 0) {
            Button {
                addBelow()
            } label: {
                Image(systemName: "plus")
                    .font(.system(size: 11, weight: .semibold))
                    .frame(width: 20, height: 22)
                    .contentShape(Rectangle())
            }
            .buttonStyle(GutterButtonStyle())
            .help(Text("Add a block below"))
            .accessibilityLabel(Text("Add block below"))
            grip(visible: visible)
        }
        .padding(1)
        .foleviSurface(.color(FoleviColor.surfaceRaised), shape: .rounded(8), shadow: FoleviShadow.control)
        .padding(.trailing, 6)
        .frame(height: max(24, lh), alignment: .center)
        // Nearly invisible rather than 0, so the grip still takes the press that starts a drag.
        .opacity(visible ? 1 : 0.001)
        .animation(reduceMotion ? nil : .easeOut(duration: FoleviMotion.fast), value: visible)
        .allowsHitTesting(!model.isReadOnly)
    }

    private func grip(visible: Bool) -> some View {
        GripDots(highlighted: gripHovering)
            .frame(width: 18, height: 22)
            .overlay {
                PointerDragSource(cursor: visible || gripHovering ? .openHand : .arrow, help: String(localized: "Drag to move · Click for options"),
                                  onHover: { gripHovering = $0 }, onClick: { openOptions() }) { start, current in
                    if !model.drag.isActive { model.drag.beginBlockDrag(blockId: block.id, start: start, current: current) }
                }
            }
            .help(Text("Drag to move · Click for options"))
            .accessibilityElement()
            .accessibilityLabel(Text("Block handle"))
            .accessibilityHint(Text("Opens block options"))
            .accessibilityAddTraits(.isButton)
            .accessibilityAction { openOptions() }
            .accessibilityAction(named: Text("Move Up")) { model.move([block.id], up: true) }
            .accessibilityAction(named: Text("Move Down")) { model.move([block.id], up: false) }
            .accessibilityAction(named: Text("Delete Block")) { model.delete([block.id]) }
    }

    private func addBelow() {
        let b = Block(id: ULID.make(), parentId: block.parentId, rank: "V", content: .paragraph(ParagraphProps()))
        model.insert(b, after: block.id, replacing: false)
    }

    /// Click on the grip: select the block and show its options as a native menu.
    private func openOptions() {
        if !isSelected { model.select(block.id, extend: NSEvent.modifierFlags.contains(.shift)) }
        let targets = model.selectedBlockIds.contains(block.id) ? model.orderedByRows(Array(model.selectedBlockIds)) : [block.id]
        let editable = !model.isReadOnly
        let menu = NSMenu()
        let turnInto = NSMenuItem(title: String(localized: "Turn Into"), action: nil, keyEquivalent: "")
        let sub = NSMenu()
        for option in TurnIntoOption.all {
            sub.addItem(ClosureMenuItem(option.plainTitle, key: String(option.shortcut.character), modifiers: [.command, .option], enabled: editable) {
                model.turnInto(option.id, ids: targets)
            })
        }
        turnInto.submenu = sub
        turnInto.isEnabled = editable
        menu.addItem(turnInto)
        menu.addItem(ClosureMenuItem(String(localized: "Duplicate"), key: "d", modifiers: [.command], enabled: editable) { model.duplicate(targets) })
        menu.addItem(.separator())
        menu.addItem(ClosureMenuItem(String(localized: "Move Up"), key: "\u{F700}", modifiers: [.option, .shift], enabled: editable) { model.move(targets, up: true) })
        menu.addItem(ClosureMenuItem(String(localized: "Move Down"), key: "\u{F701}", modifiers: [.option, .shift], enabled: editable) { model.move(targets, up: false) })
        menu.addItem(ClosureMenuItem(String(localized: "Indent"), key: "]", modifiers: [.command], enabled: editable) { model.indent(targets) })
        menu.addItem(ClosureMenuItem(String(localized: "Outdent"), key: "[", modifiers: [.command], enabled: editable) { model.outdent(targets) })
        menu.addItem(.separator())
        menu.addItem(ClosureMenuItem(String(localized: "Comment"), key: "m", modifiers: [.command, .option],
                                     enabled: model.comments.data?.canComment == true) { model.comments.openBlock(block.id) })
        menu.addItem(ClosureMenuItem(String(localized: "Copy as Markdown")) {
            let wires = targets.compactMap { model.blocks[$0]?.wire }
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(MarkdownCodec.blocksToMarkdown(wires), forType: .string)
        })
        menu.addItem(.separator())
        menu.addItem(ClosureMenuItem(String(localized: "Delete"), key: "\u{8}", modifiers: [.command, .shift], enabled: editable) { model.delete(targets) })
        menu.popUp(positioning: nil, at: NSEvent.mouseLocation, in: nil)
    }

    // MARK: Markers (bullets, numbers, checkboxes, disclosure, quote bar)

    @ViewBuilder private var marker: some View {
        let lh = BlockStyles.lineHeight(textStyle)
        switch block.content {
        case .bulleted:
            let d = 6 * scale
            Group {
                switch row.depth % 3 {
                case 0: Circle().fill(docAccent)
                case 1: Circle().strokeBorder(docAccent, lineWidth: 1.3)
                default: RoundedRectangle(cornerRadius: 1).fill(docAccent)
                }
            }
            .frame(width: d, height: d)
            .frame(width: 24 * scale, height: lh, alignment: .center)
            .accessibilityHidden(true)
        case .numbered:
            Text("\(row.number ?? 1).")
                .font(.document(model.style.font, BlockStyles.bodySize(model.style.font) * 0.94 * scale).monospacedDigit())
                .foregroundStyle(FoleviColor.inkMuted)
                .frame(minWidth: 22 * scale, alignment: .trailing)
                .frame(height: lh)
                .padding(.trailing, 5)
                .accessibilityHidden(true)
        case .todo(let p):
            TodoCheck(checked: p.checked, scale: scale) { model.toggleTodo(block.id) }
                .frame(width: 30 * scale, height: lh, alignment: .leading)
                .disabled(model.isReadOnly)
                .accessibilityLabel(Text(p.checked ? "Mark as not done" : "Mark as done"))
                .accessibilityValue(Text(p.checked ? "Done" : "Not done"))
                .accessibilityIdentifier("todo.checkbox.\(block.id)")
        case .toggle(let p):
            Button {
                model.toggleCollapsed(block.id)
            } label: {
                Image(systemName: "arrowtriangle.right.fill")
                    .font(.system(size: 8.5 * scale))
                    .rotationEffect(.degrees(p.collapsed ? 0 : 90))
                    .foregroundStyle(FoleviColor.inkMuted)
                    .frame(width: 22 * scale, height: 22 * scale)
                    .contentShape(Rectangle())
            }
            .buttonStyle(GutterButtonStyle())
            .frame(width: 26 * scale, height: lh, alignment: .leading)
            .accessibilityLabel(Text(p.collapsed ? "Expand" : "Collapse"))
        case .quote:
            Capsule()
                .fill(docAccent)
                .frame(width: 3)
                .padding(.trailing, 14)
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
                TodoMetaView(blockId: block.id, props: p, model: model, rowHovering: hovering)
                    .fixedSize()
            }
        case .callout(let p):
            let tone = Color.folevi(tone: p.tone)
            HStack(alignment: .top, spacing: 10) {
                Button {
                    let menu = NSMenu()
                    for t in CalloutTone.allCases {
                        let item = ClosureMenuItem(t.rawValue.capitalized, enabled: !model.isReadOnly) {
                            model.update(block.id, actionName: String(localized: "Callout Style")) { b in
                                if case .callout(var cp) = b.content {
                                    cp.tone = t
                                    b.content = .callout(cp)
                                }
                            }
                        }
                        item.state = t == p.tone ? .on : .off
                        menu.addItem(item)
                    }
                    menu.popUp(positioning: nil, at: NSEvent.mouseLocation, in: nil)
                } label: {
                    Group {
                        if let icon = p.icon, !icon.isEmpty {
                            Text(icon).font(.system(size: 17 * scale))
                        } else {
                            Image(systemName: tone.icon).font(.system(size: 15 * scale, weight: .semibold)).foregroundStyle(tone.ink)
                        }
                    }
                    .frame(height: BlockStyles.lineHeight(textStyle))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(model.isReadOnly)
                .accessibilityLabel(Text("Callout style"))
                textEditor
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .foleviSurface(.color(tone.bg), shape: .rounded(14), shadow: FoleviDepth.calloutRim)
        case .code(let p):
            CodeBlockView(block: block, props: p, model: model, focusRequest: focusRequest)
        case .divider:
            Rectangle()
                .fill(FoleviColor.line)
                .frame(height: 1)
                .padding(.vertical, 12)
                .contentShape(Rectangle().inset(by: -8))
                .onTapGesture { model.select(block.id, extend: false) }
                .accessibilityLabel(Text("Divider"))
        case .pageBreak:
            PageBreakBlockView()
                .contentShape(Rectangle())
                .onTapGesture { model.select(block.id, extend: false) }
        case .formula(let p):
            FormulaBlockView(props: p)
                .onTapGesture { model.select(block.id, extend: false) }
        case .whiteboard(let p):
            WhiteboardBlockView(props: p)
                .onTapGesture { model.select(block.id, extend: false) }
        case .image(let p):
            ImageBlockView(block: block, props: p, model: model)
        case .file(let p):
            FileBlockView(block: block, props: p, model: model)
        case .table(let p):
            TableBlockView(block: block, props: p, model: model)
        case .page(let p):
            PageBlockView(props: p, openDocument: openDocument)
        case .bookmark(let p):
            BookmarkBlockView(block: block, props: p, model: model)
        case .collection(let p):
            CollectionBlockView(props: p, openDocument: openDocument)
        case .unknown(AudioProps.type, let props):
            if let p = AudioProps(props) {
                AudioBlockView(block: block, props: p, model: model)
            } else {
                UnknownBlockView(type: AudioProps.type).onTapGesture { model.select(block.id, extend: false) }
            }
        case .unknown(let type, _):
            UnknownBlockView(type: type)
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
            SlashMenuView(items: model.slashItems(for: popup.query), selected: popup.selectedIndex) { idx in model.commitPopup(index: idx) }
        case .pageLink:
            PageLinkPickerView(choices: model.pageChoices(for: popup.query), selected: popup.selectedIndex) { idx in model.commitPopup(index: idx) }
        }
    }

    // MARK: Context menu

    @ViewBuilder private var contextMenu: some View {
        let targets = model.selectedBlockIds.contains(block.id) ? model.orderedByRows(Array(model.selectedBlockIds)) : [block.id]
        Menu("Turn Into") {
            ForEach(TurnIntoOption.all) { option in
                Button(option.title) { model.turnInto(option.id, ids: targets) }
            }
        }
        .disabled(model.isReadOnly)
        Button("Duplicate") { model.duplicate(targets) }.disabled(model.isReadOnly)
        Button("Move Up") { model.move(targets, up: true) }.disabled(model.isReadOnly)
        Button("Move Down") { model.move(targets, up: false) }.disabled(model.isReadOnly)
        Divider()
        Button("Comment") { model.comments.openBlock(block.id) }.disabled(model.comments.data?.canComment != true)
        Button("Copy as Markdown") {
            let wires = targets.compactMap { model.blocks[$0]?.wire }
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(MarkdownCodec.blocksToMarkdown(wires), forType: .string)
        }
        Divider()
        Button("Delete", role: .destructive) { model.delete(targets) }.disabled(model.isReadOnly)
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

/// 18pt rounded-square check that fills with moss and a check mark.
struct TodoCheck: View {
    var checked: Bool
    var scale: CGFloat
    var action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            ZStack {
                RoundedRectangle(cornerRadius: 5 * scale, style: .continuous)
                    .fill(checked ? FoleviColor.moss : FoleviColor.surfaceRaised)
                RoundedRectangle(cornerRadius: 5 * scale, style: .continuous)
                    .strokeBorder(checked ? FoleviColor.moss : hovering ? FoleviColor.moss : FoleviColor.lineStrong, lineWidth: 1.5)
                if checked {
                    Image(systemName: "checkmark")
                        .font(.system(size: 10 * scale, weight: .heavy))
                        .foregroundStyle(.white)
                }
            }
            .frame(width: 18 * scale, height: 18 * scale)
            .frame(width: 24 * scale, height: 24 * scale)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .animation(.easeOut(duration: FoleviMotion.fast), value: checked)
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

struct TurnIntoOption: Identifiable {
    var id: String
    var title: LocalizedStringKey
    var shortcut: KeyEquivalent

    var plainTitle: String {
        switch id {
        case "paragraph": return String(localized: "Text")
        case "heading1": return String(localized: "Heading 1")
        case "heading2": return String(localized: "Heading 2")
        case "heading3": return String(localized: "Heading 3")
        case "todo": return String(localized: "To-do")
        case "bulleted": return String(localized: "Bulleted List")
        case "numbered": return String(localized: "Numbered List")
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
        TurnIntoOption(id: "todo", title: "To-do", shortcut: "4"),
        TurnIntoOption(id: "bulleted", title: "Bulleted List", shortcut: "5"),
        TurnIntoOption(id: "numbered", title: "Numbered List", shortcut: "6"),
        TurnIntoOption(id: "toggle", title: "Toggle", shortcut: "7"),
        TurnIntoOption(id: "code", title: "Code", shortcut: "8"),
        TurnIntoOption(id: "quote", title: "Quote", shortcut: "9"),
        TurnIntoOption(id: "callout", title: "Callout", shortcut: "-"),
    ] }
}

// MARK: - Popup views

struct SlashMenuView: View {
    var items: [SlashItem]
    var selected: Int
    var onChoose: (Int) -> Void

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 1) {
                    if items.isEmpty {
                        Text("No matching blocks").font(.ui(12.5)).foregroundStyle(FoleviColor.inkMuted).padding(10)
                    }
                    ForEach(Array(items.enumerated()), id: \.element.id) { idx, item in
                        Button { onChoose(idx) } label: {
                            HStack(spacing: 10) {
                                Image(systemName: item.systemImage)
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundStyle(InsertTile.tint(for: item.id))
                                    .frame(width: 26, height: 26)
                                    .foleviSurface(.color(FoleviColor.surfaceRaised), shape: .rounded(7), shadow: FoleviShadow.control)
                                    .accessibilityHidden(true)
                                Text(item.title).font(.ui(13.5)).foregroundStyle(idx == selected ? FoleviColor.heading : FoleviColor.ink)
                                Spacer()
                                if let s = item.shortcut { Text(s).font(.mono(11)).foregroundStyle(FoleviColor.inkFaint) }
                            }
                            .padding(.horizontal, 8)
                            .frame(height: 34)
                            .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(idx == selected ? FoleviColor.accentSoft : Color.clear))
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .id(idx)
                        .accessibilityAddTraits(idx == selected ? .isSelected : [])
                    }
                }
                .padding(6)
            }
            .onChange(of: selected) { _, s in proxy.scrollTo(s) }
        }
        .frame(width: 280, height: min(336, CGFloat(max(items.count, 1)) * 35 + 12))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .foleviPop()
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Insert block menu"))
        .accessibilityIdentifier("slashMenu")
    }
}

struct PageLinkPickerView: View {
    var choices: [PageChoice]
    var selected: Int
    var onChoose: (Int) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text("Link to page").foleviCapsLabel().padding(.horizontal, 8).padding(.top, 4).padding(.bottom, 2)
            if choices.isEmpty {
                Text("Type a page title").font(.ui(12.5)).foregroundStyle(FoleviColor.inkMuted).padding(8)
            }
            ForEach(Array(choices.enumerated()), id: \.element.id) { idx, choice in
                Button { onChoose(idx) } label: {
                    HStack(spacing: 8) {
                        if choice.isCreate {
                            Image(systemName: "plus").frame(width: 20).accessibilityHidden(true)
                            Text("New page “\(choice.title)”")
                        } else {
                            Text(choice.icon ?? "📄").frame(width: 20)
                            Text(choice.title).lineLimit(1)
                        }
                        Spacer()
                    }
                    .font(.ui(13.5))
                    .foregroundStyle(idx == selected ? FoleviColor.heading : FoleviColor.ink)
                    .padding(.horizontal, 8)
                    .frame(height: 32)
                    .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(idx == selected ? FoleviColor.accentSoft : Color.clear))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(6)
        .frame(width: 300)
        .foleviPop()
        .accessibilityIdentifier("pageLinkPicker")
    }
}
