import AppKit
import SwiftUI
import UniformTypeIdentifiers

/// Text styles per block type, derived from the document style and editor zoom.
enum BlockStyles {
    static func paragraph(style: DocumentStyle, scale: CGFloat) -> BlockTextStyle {
        BlockTextStyle(font: FoleviType.editorFont(size: 16, design: style.font, scale: scale), color: .foleviInk, lineSpacing: 3,
                       placeholder: String(localized: "Type '/' for commands"))
    }

    static func title(style: DocumentStyle, scale: CGFloat) -> BlockTextStyle {
        let design: DocumentFont = style.font == .mono ? .mono : .serif
        return BlockTextStyle(font: FoleviType.editorFont(size: 36, weight: .semibold, design: design, scale: scale), color: .foleviInk,
                              lineSpacing: 2, placeholder: String(localized: "Untitled"))
    }

    static func style(for block: Block, document: DocumentStyle, scale: CGFloat) -> BlockTextStyle {
        let headingDesign: DocumentFont = document.font == .mono ? .mono : .serif
        var s = paragraph(style: document, scale: scale)
        switch block.content {
        case .heading(let h):
            let size: CGFloat = h.level == .level1 ? 28 : h.level == .level2 ? 22 : 18.5
            s.font = FoleviType.editorFont(size: size, weight: .semibold, design: headingDesign, scale: scale)
            s.placeholder = String(localized: "Heading \(h.level.rawValue)")
            s.lineSpacing = 1
        case .todo(let p):
            s.placeholder = String(localized: "To-do")
            if p.checked {
                s.color = .foleviInkMuted
                s.strikethrough = true
            }
        case .bulleted, .numbered:
            s.placeholder = String(localized: "List")
        case .toggle:
            s.placeholder = String(localized: "Toggle")
        case .quote:
            s.font = FoleviType.editorFont(size: 17, design: document.font == .sans ? .serif : document.font, scale: scale)
            s.color = .foleviInkMuted
            s.placeholder = String(localized: "Quote")
        case .callout:
            s.placeholder = String(localized: "Callout")
        case .code:
            s.font = FoleviType.mono(size: 13.5, scale: scale)
            s.lineSpacing = 2
            s.placeholder = String(localized: "Code")
        default:
            break
        }
        return s
    }

    static func lineHeight(_ style: BlockTextStyle) -> CGFloat {
        NSLayoutManager().defaultLineHeight(for: style.font) + style.lineSpacing
    }

    static func verticalPadding(for block: Block) -> (top: CGFloat, bottom: CGFloat) {
        switch block.content {
        case .heading(let h): return h.level == .level1 ? (22, 6) : h.level == .level2 ? (16, 4) : (12, 2)
        case .divider: return (8, 8)
        case .image, .table, .code, .callout, .page, .bookmark, .collection, .file: return (6, 6)
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

/// Payload for dragging blocks within the editor.
struct BlockDragPayload: Codable, Transferable {
    var documentId: String
    var blockIds: [String]
    static var transferRepresentation: some TransferRepresentation {
        CodableRepresentation(contentType: .foleviBlocks)
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
    @State private var hovering = false

    private var block: Block { row.block }
    private var scale: CGFloat { CGFloat(app.editorScale) }
    private var textStyle: BlockTextStyle { BlockStyles.style(for: block, document: model.style, scale: scale) }
    private var isSelected: Bool { model.selectedBlockIds.contains(block.id) }
    private var isMatch: Bool { model.findMatches.contains(block.id) }

    var body: some View {
        let pad = BlockStyles.verticalPadding(for: block)
        HStack(alignment: .top, spacing: 0) {
            handle
                .frame(width: 22)
            Color.clear.frame(width: CGFloat(row.depth) * 26 * scale)
            gutter
            content
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.top, pad.top)
        .padding(.bottom, pad.bottom)
        .padding(.trailing, 4)
        .background(
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(isSelected ? FoleviColor.selection.opacity(0.55) : (isMatch && !model.findQuery.isEmpty ? FoleviColor.highlightYellow.opacity(0.5) : Color.clear))
                .padding(.leading, 18)
        )
        .overlay(alignment: model.dropTarget?.above == true ? .top : .bottom) {
            if model.dropTarget?.id == block.id {
                Rectangle().fill(FoleviColor.accent).frame(height: 2).padding(.leading, 22 + CGFloat(row.depth) * 26 * scale)
                    .accessibilityHidden(true)
            }
        }
        .overlay(alignment: .bottomLeading) {
            if let popup = model.popup, popup.blockId == block.id {
                popupView(popup)
                    .alignmentGuide(.bottom) { d in d[.top] - 4 }
                    .padding(.leading, 22 + CGFloat(row.depth) * 26 * scale)
            }
        }
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
        .simultaneousGesture(TapGesture().modifiers(.shift).onEnded { model.select(block.id, extend: true) })
        .dropDestination(for: BlockDragPayload.self) { items, location in
            guard let payload = items.first, payload.documentId == model.documentId else { return false }
            model.drop(payload.blockIds, onto: block.id, above: location.y < 12)
            return true
        } isTargeted: { targeted in
            if targeted {
                model.dropTarget = (block.id, false)
            } else if model.dropTarget?.id == block.id {
                model.dropTarget = nil
            }
        }
        .contextMenu { contextMenu }
        .accessibilityElement(children: .contain)
        .modifier(HeadingAccessibility(block: block))
    }

    // MARK: Handle (drag + menu)

    private var handle: some View {
        Image(systemName: "line.3.horizontal")
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(FoleviColor.inkFaint)
            .frame(width: 18, height: BlockStyles.lineHeight(textStyle))
            .contentShape(Rectangle())
            .opacity(hovering && !model.isReadOnly ? 1 : 0)
            .onTapGesture { model.select(block.id, extend: NSEvent.modifierFlags.contains(.shift)) }
            .draggable(BlockDragPayload(documentId: model.documentId, blockIds: model.selectedBlockIds.contains(block.id) ? model.orderedByRows(Array(model.selectedBlockIds)) : [block.id])) {
                Text(RichText.plainText(block.text).isEmpty ? BlockStyles.accessibilityName(block) : String(RichText.plainText(block.text).prefix(60)))
                    .padding(6)
                    .background(RoundedRectangle(cornerRadius: 6).fill(FoleviColor.surfaceRaised))
            }
            .help(Text("Drag to move. Click to select."))
            .accessibilityLabel(Text("Block handle"))
            .accessibilityAction(named: Text("Move Up")) { model.move([block.id], up: true) }
            .accessibilityAction(named: Text("Move Down")) { model.move([block.id], up: false) }
            .accessibilityAction(named: Text("Delete Block")) { model.delete([block.id]) }
    }

    // MARK: Gutter (bullets, numbers, checkboxes, disclosure)

    @ViewBuilder private var gutter: some View {
        let lh = BlockStyles.lineHeight(textStyle)
        switch block.content {
        case .bulleted:
            Text(row.depth % 3 == 0 ? "•" : row.depth % 3 == 1 ? "◦" : "▪︎")
                .font(.system(size: 16 * scale))
                .foregroundStyle(FoleviColor.inkMuted)
                .frame(width: 24 * scale, height: lh)
                .accessibilityHidden(true)
        case .numbered:
            Text("\(row.number ?? 1).")
                .font(.system(size: 15 * scale).monospacedDigit())
                .foregroundStyle(FoleviColor.inkMuted)
                .frame(minWidth: 24 * scale, alignment: .trailing)
                .frame(height: lh)
                .padding(.trailing, 4)
                .accessibilityHidden(true)
        case .todo(let p):
            Button {
                model.toggleTodo(block.id)
            } label: {
                Image(systemName: p.checked ? "checkmark.square.fill" : "square")
                    .font(.system(size: 15 * scale))
                    .foregroundStyle(p.checked ? FoleviColor.accent : FoleviColor.inkMuted)
            }
            .buttonStyle(.plain)
            .frame(width: 26 * scale, height: lh)
            .disabled(model.isReadOnly)
            .accessibilityLabel(Text(p.checked ? "Mark as not done" : "Mark as done"))
            .accessibilityValue(Text(p.checked ? "Done" : "Not done"))
            .accessibilityIdentifier("todo.checkbox.\(block.id)")
        case .toggle(let p):
            Button {
                model.toggleCollapsed(block.id)
            } label: {
                Image(systemName: "chevron.right")
                    .font(.system(size: 11 * scale, weight: .semibold))
                    .rotationEffect(.degrees(p.collapsed ? 0 : 90))
                    .foregroundStyle(FoleviColor.inkMuted)
            }
            .buttonStyle(.plain)
            .frame(width: 24 * scale, height: lh)
            .accessibilityLabel(Text(p.collapsed ? "Expand" : "Collapse"))
        case .quote:
            RoundedRectangle(cornerRadius: 1.5)
                .fill(FoleviColor.lineStrong)
                .frame(width: 3)
                .padding(.trailing, 14)
                .padding(.leading, 2)
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
                TodoMetaView(blockId: block.id, props: p, model: model)
            }
        case .callout(let p):
            let tone = Color.folevi(tone: p.tone)
            HStack(alignment: .top, spacing: 10) {
                Menu {
                    ForEach(CalloutTone.allCases, id: \.self) { t in
                        Button(t.rawValue.capitalized) {
                            model.update(block.id, actionName: String(localized: "Callout Style")) { b in
                                if case .callout(var cp) = b.content {
                                    cp.tone = t
                                    b.content = .callout(cp)
                                }
                            }
                        }
                    }
                } label: {
                    if let icon = p.icon, !icon.isEmpty { Text(icon).font(.system(size: 17 * scale)) } else { Image(systemName: tone.icon).foregroundStyle(tone.ink) }
                }
                .menuStyle(.borderlessButton)
                .menuIndicator(.hidden)
                .fixedSize()
                .disabled(model.isReadOnly)
                .accessibilityLabel(Text("Callout style"))
                textEditor
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(RoundedRectangle(cornerRadius: FoleviRadius.card, style: .continuous).fill(tone.bg))
        case .code(let p):
            CodeBlockView(block: block, props: p, model: model, focusRequest: focusRequest)
        case .divider:
            Rectangle()
                .fill(FoleviColor.line)
                .frame(height: 1)
                .padding(.vertical, 10)
                .contentShape(Rectangle().inset(by: -8))
                .onTapGesture { model.select(block.id, extend: false) }
                .accessibilityLabel(Text("Divider"))
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
        case .unknown(let type, _):
            UnknownBlockView(type: type)
                .onTapGesture { model.select(block.id, extend: false) }
        }
    }

    private var focusRequest: FocusRequest? {
        model.focus?.blockId == block.id ? model.focus : nil
    }

    private var textEditor: some View {
        BlockTextEditor(blockId: block.id, text: block.text, style: textStyle, isEditable: !model.isReadOnly,
                        accessibilityLabel: BlockStyles.accessibilityName(block), model: model, focusRequest: focusRequest)
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
        Button("Copy as Markdown") {
            let wires = targets.compactMap { model.blocks[$0]?.wire }
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(MarkdownCodec.blocksToMarkdown(wires), forType: .string)
        }
        Divider()
        Button("Delete", role: .destructive) { model.delete(targets) }.disabled(model.isReadOnly)
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

    static let all: [TurnIntoOption] = [
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
    ]
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
                        Text("No matching blocks").font(.callout).foregroundStyle(FoleviColor.inkMuted).padding(10)
                    }
                    ForEach(Array(items.enumerated()), id: \.element.id) { idx, item in
                        Button { onChoose(idx) } label: {
                            HStack(spacing: 10) {
                                Image(systemName: item.systemImage)
                                    .frame(width: 26, height: 26)
                                    .background(RoundedRectangle(cornerRadius: 6).fill(FoleviColor.surfaceSunken))
                                    .accessibilityHidden(true)
                                Text(item.title).font(.system(size: 13))
                                Spacer()
                                if let s = item.shortcut { Text(s).font(.system(size: 11).monospaced()).foregroundStyle(FoleviColor.inkFaint) }
                            }
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(RoundedRectangle(cornerRadius: 6).fill(idx == selected ? FoleviColor.accentSoft : Color.clear))
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
        .frame(width: 280, height: min(320, CGFloat(max(items.count, 1)) * 36 + 12))
        .background(RoundedRectangle(cornerRadius: FoleviRadius.card, style: .continuous).fill(FoleviColor.surfaceRaised))
        .overlay(RoundedRectangle(cornerRadius: FoleviRadius.card, style: .continuous).strokeBorder(FoleviColor.line))
        .shadow(color: .black.opacity(0.14), radius: 16, y: 6)
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
            Text("Link to page").font(.caption.weight(.semibold)).foregroundStyle(FoleviColor.inkMuted).padding(.horizontal, 8).padding(.top, 4)
            if choices.isEmpty {
                Text("Type a page title").font(.callout).foregroundStyle(FoleviColor.inkMuted).padding(8)
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
                    .font(.system(size: 13))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 5)
                    .background(RoundedRectangle(cornerRadius: 6).fill(idx == selected ? FoleviColor.accentSoft : Color.clear))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(6)
        .frame(width: 300)
        .background(RoundedRectangle(cornerRadius: FoleviRadius.card, style: .continuous).fill(FoleviColor.surfaceRaised))
        .overlay(RoundedRectangle(cornerRadius: FoleviRadius.card, style: .continuous).strokeBorder(FoleviColor.line))
        .shadow(color: .black.opacity(0.14), radius: 16, y: 6)
        .accessibilityIdentifier("pageLinkPicker")
    }
}
