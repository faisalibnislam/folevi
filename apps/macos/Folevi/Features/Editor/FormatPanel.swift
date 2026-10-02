import SwiftUI

extension EditorModel {
    /// The blocks the Format panel works on: the selected blocks, or the one with the cursor.
    var formatTargets: [Block] { commandTargets.compactMap { blocks[$0] } }

    /// The block with the cursor (or the first selected one).
    var formatBlock: Block? { formatTargets.first }

    /// The styling every target shares (selectedBlockFormat): a field is nil unless all agree.
    var sharedLook: BlockLook {
        let looks = formatTargets.filter { BlockLook.formattable.contains($0.typeName) }.map { BlockLook($0.content) }
        guard let first = looks.first else { return BlockLook() }
        func same<T: Equatable>(_ k: KeyPath<BlockLook, T?>) -> T? { looks.allSatisfy { $0[keyPath: k] == first[keyPath: k] } ? first[keyPath: k] : nil }
        return BlockLook(textStyle: same(\.textStyle), decoration: same(\.decoration), color: same(\.color), align: same(\.align),
                         font: same(\.font), group: same(\.group))
    }

    /// Changes the targets' styling (setBlockFormat), keeping everything else.
    func setBlockFormat(_ change: (inout BlockLook) -> Void) {
        guard !isReadOnly else { return }
        var upserts: [Block] = []
        for var b in formatTargets where BlockLook.formattable.contains(b.typeName) {
            var look = BlockLook(b.content)
            change(&look)
            let next = look.applied(to: b.content)
            if next != b.content {
                b.content = next
                upserts.append(b)
            }
        }
        guard !upserts.isEmpty else { return }
        commit(upserts: upserts, focus: refocusRequest, actionName: String(localized: "Format"))
    }

    /// Turns the targets into another kind of text block, keeping their styling when both kinds carry one
    /// (turnInto in commands.ts). `configure` sets the new kind's own fields (heading level, text style…).
    func formatTurnInto(_ type: String, configure: ((inout BlockContent) -> Void)? = nil) {
        guard !isReadOnly else { return }
        if type == "code" || formatTargets.contains(where: { if case .code = $0.content { return true } else { return false } }) {
            turnInto(type)
            return
        }
        var upserts: [Block] = []
        for var b in formatTargets where b.content.carriesText {
            let kept = BlockLook.formattable.contains(b.typeName) ? BlockLook(b.content) : BlockLook()
            let wasParagraph = b.typeName == "paragraph"
            var next = BlockContent.defaultContent(for: type)
            if b.typeName == next.typeName, type != "heading1", type != "heading2", type != "heading3" { next = b.content }
            if case .heading = b.content, case .heading = next { next = b.content }
            var look = kept
            if !(wasParagraph && next.typeName == "paragraph") { look.textStyle = nil }
            if BlockLook.formattable.contains(next.typeName) { next = look.applied(to: next) }
            if case .heading(var h) = next, case .heading(let target) = BlockContent.defaultContent(for: type) {
                h.level = target.level
                next = .heading(h)
            }
            configure?(&next)
            if next != b.content {
                b.content = next
                upserts.append(b)
            }
        }
        guard !upserts.isEmpty else { return }
        commit(upserts: upserts, focus: refocusRequest, actionName: String(localized: "Turn Into"))
    }

    private var refocusRequest: FocusRequest? {
        focusedBlockId.flatMap { id in blocks[id].map { _ in FocusRequest(blockId: id, caret: .offset(textView(id)?.selectedRange().location ?? 0)) } }
    }

    /// The link field's address: links the selected words, or inserts the address as a link at the cursor.
    /// False when it isn't a web address.
    func linkSelection(to raw: String) -> Bool {
        guard let id = focusedBlockId, let tv = textView(id), !isReadOnly else { return false }
        guard let href = RichText.sanitizeHref(raw.trimmingCharacters(in: .whitespaces)) else { return false }
        let style = currentTextStyle(for: id)
        var sel = tv.selectedRange()
        if sel.length == 0 && tv.linkAtSelection() == nil {
            tv.replace(range: sel, with: [.text(text: raw.trimmingCharacters(in: .whitespaces), marks: nil)], style: style)
            let length = (raw.trimmingCharacters(in: .whitespaces) as NSString).length
            sel = NSRange(location: sel.location, length: length)
            tv.setSelectedRange(sel)
        }
        tv.toggle(mark: .link(href: href), style: style)
        activeMarks = tv.activeMarks()
        return true
    }

    func unlinkSelection() {
        guard let id = focusedBlockId, let tv = textView(id), !isReadOnly else { return }
        tv.removeMark(.foleviLink, style: currentTextStyle(for: id))
        activeMarks = tv.activeMarks()
    }

    func setCodeLanguage(_ language: String) {
        guard let b = formatBlock, case .code = b.content else { return }
        update(b.id, actionName: String(localized: "Code Language")) { block in
            if case .code(var p) = block.content {
                p.language = language
                block.content = .code(p)
            }
        }
    }

    func setCalloutTone(_ tone: CalloutTone) {
        guard let b = formatBlock, case .callout = b.content else { return }
        update(b.id, actionName: String(localized: "Callout Style")) { block in
            if case .callout(var p) = block.content {
                p.tone = tone
                block.content = .callout(p)
            }
        }
    }
}

/// The page tools' Format panel (the web's FormatPanel): text style, page or card group, marks, lists,
/// indent and alignment, decorations, the block's font, then (under More) quote / callout / code, underline,
/// highlight, clear, the link field, text colour and highlight, a callout's tone and a code block's language.
struct FormatInspector: View {
    @Bindable var model: EditorModel
    @State private var href = ""
    @State private var linkError: String?
    @State private var moreOpen = false
    @FocusState private var linkFocused: Bool

    private var block: Block? { model.formatBlock }
    private var type: String? { block?.typeName }
    private var level: Int? { if case .heading(let h)? = block?.content { return h.level == .level1 ? 1 : h.level == .level2 ? 2 : 3 } else { return nil } }
    private var inCode: Bool { type == "code" }
    private var d: Bool { model.isReadOnly }
    private var marksOff: Bool { d || inCode }
    private var look: BlockLook { model.sharedLook }
    private var formattable: Bool { type.map { BlockLook.formattable.contains($0) } ?? false }
    private var blockOff: Bool { d || !formattable }
    private var textStyle: String? { type == "paragraph" ? (look.textStyle?.rawValue ?? "body") : nil }
    private var marks: Set<String> { model.activeMarks }
    private var linkActive: Bool { marks.contains("link") }
    private var currentHref: String { marks.first { $0.hasPrefix("href.") }.map { String($0.dropFirst(5)) } ?? "" }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            section("Text") {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 3), spacing: 6) {
                    styleButton("Title", on: type == "heading" && level == 1, font: .ui(15, .bold)) { model.formatTurnInto("heading1") }
                    styleButton("Subtitle", on: type == "heading" && level == 2, font: .ui(14, .semibold)) { model.formatTurnInto("heading2") }
                    styleButton("Heading", on: type == "heading" && level == 3, font: .ui(13.5, .semibold)) { model.formatTurnInto("heading3") }
                    styleButton("Strong", on: textStyle == "strong", font: .ui(16, .semibold)) { setParagraph(.strong) }
                    styleButton("Body", on: textStyle == "body", font: .ui(16)) { setParagraph(nil) }
                    styleButton("Caption", on: textStyle == "caption", font: .ui(12), muted: true) { setParagraph(.caption) }
                }
                .disabled(d || inCode)
                .accessibilityElement(children: .contain)
                .accessibilityLabel(Text("Text style"))
            }
            section("Groups") {
                HStack(spacing: 6) {
                    groupButton(on: look.group != .card, inverted: false) {
                        Image(systemName: "doc.text").font(.system(size: 13))
                        Text("Page")
                    } action: { model.setBlockFormat { $0.group = nil } }
                    groupButton(on: look.group == .card, inverted: true) {
                        Text("Card")
                        Image(systemName: "rectangle.topthird.inset.filled").font(.system(size: 13))
                    } action: { model.setBlockFormat { $0.group = $0.group == .card ? nil : .card } }
                }
                .disabled(blockOff)
            }
            VStack(spacing: 6) {
                segment(label: "Text marks") {
                    segButton("bold", "Bold", on: marks.contains("bold"), disabled: marksOff) { model.toggleMark(.bold) }
                    segButton("italic", "Italic", on: marks.contains("italic"), disabled: marksOff) { model.toggleMark(.italic) }
                    segButton("strikethrough", "Strikethrough", on: marks.contains("strike"), disabled: marksOff) { model.toggleMark(.strike) }
                    segButton("chevron.left.forwardslash.chevron.right", "Inline code", on: marks.contains("code"), disabled: marksOff) { model.toggleMark(.code) }
                }
                segment(label: "Lists") {
                    segButton("checkmark.square", "To-do", on: type == "todo", disabled: d || inCode) { toggleList("todo") }
                    segButton("play.fill", "Toggle", on: type == "toggle", disabled: d || inCode, iconSize: 11) { toggleList("toggle") }
                    segButton("list.bullet", "Bullets", on: type == "bulleted", disabled: d || inCode) { toggleList("bulleted") }
                    segButton("list.number", "Numbers", on: type == "numbered", disabled: d || inCode) { toggleList("numbered") }
                }
                HStack(spacing: 6) {
                    segment(label: "Indent") {
                        segButton("decrease.indent", "Outdent", help: "Outdent (⇧Tab)", on: false, disabled: d) { model.outdent(model.commandTargets) }
                        segButton("increase.indent", "Indent", help: "Indent (Tab)", on: false, disabled: d) { model.indent(model.commandTargets) }
                    }
                    .frame(width: 128)
                    segment(label: "Alignment") {
                        alignButton(.left, "text.alignleft", "Align left")
                        alignButton(.center, "text.aligncenter", "Align center")
                        alignButton(.right, "text.alignright", "Align right")
                        alignButton(.justify, "text.justify", "Justify")
                    }
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text("Text and block formatting"))
            section("Decorations") {
                HStack(spacing: 6) {
                    decorationButton(on: look.decoration == .focus) {
                        Capsule().fill(.primary).frame(width: 3, height: 16)
                        Text("Focus")
                    } action: { model.setBlockFormat { $0.decoration = $0.decoration == .focus ? nil : .focus } }
                    decorationButton(on: look.decoration == .block) {
                        Text("Block").padding(.horizontal, 12).padding(.vertical, 4)
                            .background(FoleviColor.line.opacity(0.8), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                    } action: { model.setBlockFormat { $0.decoration = $0.decoration == .block ? nil : .block } }
                }
                .disabled(blockOff)
            }
            section("Font") {
                PageSegmented(selection: Binding(get: { look.font }, set: { f in model.setBlockFormat { $0.font = $0.font == f ? nil : f } }), items: [
                    .init(value: Optional(BlockFont.system), title: String(localized: "System"), font: .document(.sans, 12.5, .semibold), accessibilityLabel: String(localized: "Font: System")),
                    .init(value: .serif, title: String(localized: "Serif"), font: .document(.serif, 12.5, .semibold), accessibilityLabel: String(localized: "Font: Serif")),
                    .init(value: .mono, title: String(localized: "Mono"), font: .document(.mono, 12.5, .semibold), accessibilityLabel: String(localized: "Font: Mono")),
                    .init(value: .rounded, title: String(localized: "Rounded"), font: .document(.rounded, 12.5, .semibold), accessibilityLabel: String(localized: "Font: Rounded")),
                ], label: String(localized: "Block font"))
                .disabled(blockOff)
            }
            more
            Text("Shortcuts: ⌘⌥0–3 headings, ⌘⇧7/8/9 lists and to-dos, Tab / ⇧Tab to nest, ⌥⇧↑↓ to move, ⌘⇧K link, ⌥F10 formatting toolbar, Esc then ⇧↑↓ to select blocks, ⌘. for block options.")
                .font(.ui(12)).foregroundStyle(FoleviColor.inkMuted).fixedSize(horizontal: false, vertical: true)
        }
        .onChange(of: currentHref, initial: true) { _, h in
            href = h
            linkError = nil
        }
    }

    // MARK: More

    private var more: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                moreOpen.toggle()
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).rotationEffect(.degrees(moreOpen ? 90 : 0))
                    Text("More: quote, callout, code, links, highlight").font(.ui(13, .medium))
                }
                .foregroundStyle(FoleviColor.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityValue(Text(moreOpen ? "Expanded" : "Collapsed"))
            if moreOpen {
                VStack(alignment: .leading, spacing: 20) {
                    section("Blocks") {
                        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 8) {
                            FormatTile(label: "Quote", icon: "text.quote", pressed: type == "quote", disabled: d) { model.formatTurnInto("quote") }
                            FormatTile(label: "Callout", icon: "note.text", pressed: type == "callout", disabled: d) { model.formatTurnInto("callout") }
                            FormatTile(label: "Code block", icon: "chevron.left.forwardslash.chevron.right", pressed: inCode, disabled: d) { model.turnInto("code") }
                            FormatTile(label: "Underline", icon: "underline", pressed: marks.contains("underline"), disabled: marksOff) { model.toggleMark(.underline) }
                            FormatTile(label: "Highlight", icon: "highlighter", pressed: marks.contains { $0.hasPrefix("highlight.") }, disabled: marksOff) {
                                if marks.contains(where: { $0.hasPrefix("highlight.") }) { model.setHighlight(nil) } else { model.setHighlight(.yellow) }
                            }
                            FormatTile(label: "Clear", icon: "eraser", pressed: false, disabled: marksOff) { model.clearFormatting() }
                        }
                    }
                    linkSection
                    section("Text color") {
                        FlowLayout(spacing: 6) {
                            DefaultChip(on: !marks.contains { $0.hasPrefix("color.") }) { model.setColor(nil) }.disabled(marksOff)
                            ForEach(TextColor.allCases, id: \.self) { c in
                                SwatchButton(label: String(localized: "Text color: \(Self.colorName(c.rawValue))"), on: marks.contains("color.\(c.rawValue)")) {
                                    Text("A").font(.ui(13, .semibold)).foregroundStyle(Self.textColor(c))
                                } action: { model.setColor(c) }
                                .disabled(marksOff)
                            }
                        }
                    }
                    section("Highlight") {
                        FlowLayout(spacing: 6) {
                            DefaultChip(on: !marks.contains { $0.hasPrefix("highlight.") }) { model.setHighlight(nil) }.disabled(marksOff)
                            ForEach(HighlightColor.allCases, id: \.self) { h in
                                SwatchButton(label: String(localized: "Highlight: \(Self.colorName(h.rawValue))"), on: marks.contains("highlight.\(h.rawValue)")) {
                                    RoundedRectangle(cornerRadius: 4, style: .continuous).fill(Color(nsColor: .folevi(highlight: h))).frame(width: 16, height: 16)
                                } action: { model.setHighlight(h) }
                                .disabled(marksOff)
                            }
                        }
                    }
                    if case .callout(let p)? = block?.content {
                        section("Callout tone") {
                            FlowLayout(spacing: 8) {
                                ForEach(CalloutTone.allCases, id: \.self) { tone in
                                    ToneChip(title: tone.rawValue.capitalized, on: p.tone == tone) { model.setCalloutTone(tone) }.disabled(d)
                                }
                            }
                        }
                    }
                    if case .code(let p)? = block?.content {
                        section("Language") {
                            FoleviSelect(selection: Binding(get: { p.language }, set: { model.setCodeLanguage($0) }),
                                         options: foleviCodeLanguages.map { .init(value: $0, title: $0) }, accessibilityLabel: String(localized: "Language"))
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .disabled(d)
                        }
                    }
                }
                .padding(.top, 12)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(FoleviColor.surfaceSunken.opacity(0.5), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
    }

    private var linkSection: some View {
        section("Link") {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    TextField(!marks.contains("selection") && !linkActive ? "Address to insert as a link" : "Paste or type a link", text: $href)
                        .textFieldStyle(.plain)
                        .font(.ui(13))
                        .focused($linkFocused)
                        .onSubmit { submitLink() }
                        .onChange(of: href) { _, _ in linkError = nil }
                        .padding(.horizontal, 12)
                        .frame(height: 32)
                        .pageInput(focused: linkFocused)
                        .disabled(marksOff)
                        .accessibilityLabel(Text("Link"))
                    Button(linkActive ? "Update" : "Link") { submitLink() }
                        .buttonStyle(.page(.secondary, .sm))
                        .disabled(marksOff || href.trimmingCharacters(in: .whitespaces).isEmpty)
                    if linkActive {
                        Button("Remove") { model.unlinkSelection() }.buttonStyle(.page(.quiet, .sm)).disabled(marksOff)
                    }
                }
                Text(linkError ?? String(localized: "Links the selected text. Shortcut: ⌘⇧K."))
                    .font(.ui(12))
                    .foregroundStyle(linkError == nil ? FoleviColor.inkMuted : FoleviColor.destructive)
                    .padding(.horizontal, 4)
            }
        }
    }

    private func submitLink() {
        guard !href.trimmingCharacters(in: .whitespaces).isEmpty else {
            if linkActive { model.unlinkSelection() }
            return
        }
        if !model.linkSelection(to: href) { linkError = String(localized: "That doesn’t look like a web address.") }
    }

    // MARK: Helpers

    private func setParagraph(_ style: BlockTextStyle?) {
        if type == "paragraph" {
            model.setBlockFormat { $0.textStyle = style }
        } else {
            model.formatTurnInto("paragraph") { content in
                if case .paragraph(var p) = content {
                    p.textStyle = style
                    content = .paragraph(p)
                }
            }
        }
    }

    private func toggleList(_ t: String) {
        model.formatTurnInto(type == t ? "paragraph" : t)
    }

    static func colorName(_ id: String) -> String {
        switch id {
        case "muted": return String(localized: "Gray")
        case "accent": return String(localized: "Ember")
        case "moss": return String(localized: "Moss")
        case "marigold": return String(localized: "Marigold")
        case "plum": return String(localized: "Plum")
        case "coral": return String(localized: "Coral")
        case "yellow": return String(localized: "Yellow")
        case "green": return String(localized: "Green")
        case "blue": return String(localized: "Blue")
        case "pink": return String(localized: "Pink")
        default: return id
        }
    }

    static func textColor(_ c: TextColor) -> Color {
        switch c {
        case .muted: return FoleviColor.inkMuted
        case .accent: return FoleviColor.emberInk
        case .moss: return FoleviColor.mossInk
        case .marigold: return FoleviColor.marigoldInk
        case .plum: return FoleviColor.plumInk
        case .coral: return FoleviColor.coralInk
        }
    }

    private func section<C: View>(_ title: LocalizedStringKey, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).pageCaps().padding(.horizontal, 4).accessibilityAddTraits(.isHeader)
            content()
        }
    }

    private func styleButton(_ label: LocalizedStringKey, on: Bool, font: Font, muted: Bool = false, action: @escaping () -> Void) -> some View {
        FormatChoice(on: on, height: 40, action: action) {
            Text(label).font(font).foregroundStyle(muted && !on ? FoleviColor.inkMuted : on ? FoleviColor.heading : FoleviColor.ink)
        }
    }

    private func groupButton<C: View>(on: Bool, inverted: Bool, @ViewBuilder label: () -> C, action: @escaping () -> Void) -> some View {
        let content = label()
        return FormatChoice(on: on, inverted: inverted, height: 44, action: action) {
            HStack(spacing: 8) { content }.font(.ui(13.5, on ? .semibold : .regular))
        }
    }

    private func decorationButton<C: View>(on: Bool, @ViewBuilder label: () -> C, action: @escaping () -> Void) -> some View {
        let content = label()
        return FormatChoice(on: on, height: 40, action: action) {
            HStack(spacing: 8) { content }.font(.ui(13.5, on ? .semibold : .regular))
        }
    }

    private func segment<C: View>(label: LocalizedStringKey, @ViewBuilder content: () -> C) -> some View {
        HStack(spacing: 0) { content() }
            .padding(2)
            .background(FoleviColor.surfaceSunken.opacity(0.8), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text(label))
    }

    private func segButton(_ icon: String, _ label: String, help: String? = nil, on: Bool, disabled: Bool, iconSize: CGFloat = 13.5,
                           action: @escaping () -> Void) -> some View {
        SegButton(icon: icon, label: label, help: help ?? label, on: on, iconSize: iconSize, action: action).disabled(disabled)
    }

    private func alignButton(_ value: BlockAlign, _ icon: String, _ label: String) -> some View {
        let on = (look.align ?? .left) == value
        return segButton(icon, label, on: on, disabled: blockOff) { model.setBlockFormat { $0.align = value == .left ? nil : value } }
    }
}

/// One of the Format panel's choices: a sunken tile; chosen, an accent-soft tile with an accent ring (or,
/// inverted, the heading colour).
private struct FormatChoice<Label: View>: View {
    var on: Bool
    var inverted = false
    var height: CGFloat
    var action: () -> Void
    @ViewBuilder var label: () -> Label
    @State private var hovering = false
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 6, style: .continuous)
        Button(action: action) {
            label()
                .foregroundStyle(on && inverted ? FoleviColor.canvas : on ? FoleviColor.heading : FoleviColor.ink)
                .frame(maxWidth: .infinity)
                .frame(height: height)
                .background(fill, in: shape)
                .overlay { if on && !inverted { shape.strokeBorder(FoleviColor.accent.opacity(0.35), lineWidth: 1.5) } }
                .contentShape(shape)
        }
        .buttonStyle(.plain)
        .opacity(isEnabled ? 1 : 0.4)
        .onHover { hovering = $0 && isEnabled }
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private var fill: Color {
        if on { return inverted ? FoleviColor.heading : FoleviColor.accentSoft }
        return hovering ? FoleviColor.accentSoft.opacity(0.7) : FoleviColor.surfaceSunken.opacity(0.8)
    }
}

private struct SegButton: View {
    var icon: String
    var label: String
    var help: String
    var on: Bool
    var iconSize: CGFloat
    var action: () -> Void
    @State private var hovering = false
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 6, style: .continuous)
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: iconSize, weight: on ? .semibold : .medium))
                .foregroundStyle(on ? FoleviColor.heading : FoleviColor.ink)
                .frame(maxWidth: .infinity)
                .frame(height: 36)
                .background(on ? FoleviColor.accentSoft : hovering ? FoleviColor.surface : .clear, in: shape)
                .overlay { if on { shape.strokeBorder(FoleviColor.accent.opacity(0.35), lineWidth: 1.5) } }
                .contentShape(shape)
        }
        .buttonStyle(.plain)
        .opacity(isEnabled ? 1 : 0.4)
        .onHover { hovering = $0 && isEnabled }
        .help(Text(help))
        .accessibilityLabel(Text(label))
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// A "More" tile: an icon in a sunken square over its label.
private struct FormatTile: View {
    var label: LocalizedStringKey
    var icon: String
    var pressed: Bool
    var disabled: Bool
    var action: () -> Void
    @State private var hovering = false

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 6, style: .continuous)
        Button(action: action) {
            VStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(FoleviColor.heading)
                    .frame(width: 28, height: 28)
                    .background(FoleviColor.surfaceSunken, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                Text(label).font(.ui(11.5, .medium)).foregroundStyle(pressed ? FoleviColor.heading : FoleviColor.ink)
                    .lineLimit(1).minimumScaleFactor(0.8)
            }
            .padding(.horizontal, 4)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity)
            .background {
                if pressed {
                    shape.fill(FoleviColor.accentSoft).overlay(shape.strokeBorder(FoleviColor.accent.opacity(0.45), lineWidth: 1.5))
                } else {
                    Color.clear.foleviSurface(.color(FoleviColor.surfaceRaised), shape: .rounded(6), shadow: hovering ? FoleviShadow.card : FoleviShadow.control)
                }
            }
            .offset(y: hovering && !pressed ? -1 : 0)
            .contentShape(shape)
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .opacity(disabled ? 0.4 : 1)
        .onHover { hovering = $0 && !disabled }
        .accessibilityAddTraits(pressed ? .isSelected : [])
    }
}

/// "Default": no colour / no highlight.
private struct DefaultChip: View {
    var on: Bool
    var action: () -> Void
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        Button(action: action) {
            Text("Default")
                .font(.ui(12.5, .semibold))
                .foregroundStyle(FoleviColor.ink)
                .padding(.horizontal, 10)
                .frame(height: 32)
                .foleviSurface(.color(FoleviColor.surfaceRaised), shape: .rounded(6), shadow: FoleviShadow.control)
                .overlay { if on { RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(FoleviColor.accent, lineWidth: 1.5) } }
        }
        .buttonStyle(.plain)
        .opacity(isEnabled ? 1 : 0.4)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// A 32pt colour or highlight choice.
private struct SwatchButton<Content: View>: View {
    var label: String
    var on: Bool
    @ViewBuilder var content: () -> Content
    var action: () -> Void
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        Button(action: action) {
            content()
                .frame(width: 32, height: 32)
                .foleviSurface(.color(FoleviColor.surfaceRaised), shape: .rounded(6), shadow: FoleviShadow.control)
                .overlay { if on { RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(FoleviColor.accent, lineWidth: 1.5) } }
        }
        .buttonStyle(.plain)
        .opacity(isEnabled ? 1 : 0.4)
        .help(Text(label))
        .accessibilityLabel(Text(label))
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

private struct ToneChip: View {
    var title: String
    var on: Bool
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.ui(12.5, .semibold))
                .foregroundStyle(on ? FoleviColor.heading : FoleviColor.ink)
                .padding(.horizontal, 10)
                .frame(height: 25.6)
                .background {
                    if on {
                        RoundedRectangle(cornerRadius: 6, style: .continuous).fill(FoleviColor.accentSoft)
                            .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(FoleviColor.accent, lineWidth: 1.5))
                    } else {
                        Color.clear.foleviSurface(.color(FoleviColor.surfaceRaised), shape: .rounded(6), shadow: FoleviShadow.control)
                    }
                }
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}
