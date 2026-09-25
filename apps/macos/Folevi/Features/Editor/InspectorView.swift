import SwiftUI

/// Inspector card: segmented header (Insert · Style · Outline · Info · Comments) over the tab content.
struct InspectorView: View {
    @Bindable var model: EditorModel
    @Bindable var nav: NavigationModel
    var openDocument: (String, Bool) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            FoleviSegmented(selection: $nav.inspectorTab,
                            items: InspectorTab.allCases.map { .init(value: $0, title: $0.title, systemImage: $0.systemImage) },
                            showTitles: false, height: 30, fontSize: 13.5, accessibilityLabel: "Inspector")
                .padding(.horizontal, 12)
                .padding(.top, 12)
            HStack {
                Text(nav.inspectorTab.title)
                    .font(.ui(15, .semibold))
                    .foregroundStyle(FoleviColor.heading)
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                IconButton(systemImage: "xmark", label: "Close Inspector", shortcutHint: "⌥⌘I", size: 26) {
                    withSidebarAnimation { nav.showInspector = false }
                }
            }
            .padding(.leading, 16)
            .padding(.trailing, 10)
            .padding(.top, 12)
            ScrollView {
                Group {
                    switch nav.inspectorTab {
                    case .insert: InsertInspector(model: model)
                    case .format: FormatInspector(model: model)
                    case .style: StyleInspector(model: model)
                    case .outline: OutlineInspector(model: model)
                    case .info: InfoInspector(model: model, nav: nav, openDocument: openDocument)
                    case .comments: CommentsInspector(model: model)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.top, 10)
                .padding(.bottom, 16)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .scrollIndicators(.automatic)
        }
    }
}

private struct SectionTitle: View {
    var title: LocalizedStringKey
    var body: some View {
        Text(title).foleviCapsLabel().accessibilityAddTraits(.isHeader)
    }
}

// MARK: - Insert

/// One Insert tile: a raised rounded card with a family-tinted icon badge and the label.
struct InsertTile: View {
    var item: SlashItem
    var disabled: Bool
    var onInsert: () -> Void
    var onDragBegan: (CGPoint) -> Void
    @State private var hovering = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let tone = Self.tone(for: item.id)
        VStack(spacing: 7) {
            Self.glyph(for: item)
                .foregroundStyle(tone.ink)
                .frame(width: 30, height: 30)
                .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(tone.fill))
            Text(Self.label(for: item))
                .font(.ui(11, .medium))
                .foregroundStyle(hovering ? FoleviColor.heading : FoleviColor.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
        }
        .frame(maxWidth: .infinity)
        .frame(height: 72)
        .foleviSurface(.color(hovering ? FoleviColor.surfaceRaised.mix(with: FoleviColor.accentSoft, by: 0.35) : FoleviColor.surfaceRaised),
                       shape: .rounded(14), shadow: FoleviShadow.control)
        .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .animation(reduceMotion ? nil : .easeOut(duration: FoleviMotion.fast), value: hovering)
        .opacity(disabled ? 0.45 : 1)
        .overlay {
            if !disabled {
                PointerDragSource(cursor: .pointingHand, help: String(localized: "Click to add below the cursor, or drag into the page"),
                                  onHover: { hovering = $0 }, onClick: onInsert) { _, current in
                    onDragBegan(current)
                }
            }
        }
        .help(Text("Click to add below the cursor, or drag into the page"))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(item.title))
        .accessibilityHint(Text("Inserts below the current block"))
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { if !disabled { onInsert() } }
    }

    static func label(for item: SlashItem) -> String {
        switch item.id {
        case "bulleted": return String(localized: "Bullets")
        case "numbered": return String(localized: "Numbers")
        case "pagelink": return String(localized: "Page Link")
        case "date": return String(localized: "Date")
        default: return item.plainTitle
        }
    }

    @ViewBuilder static func glyph(for item: SlashItem) -> some View {
        switch item.id {
        case "heading1", "heading2", "heading3":
            HStack(alignment: .lastTextBaseline, spacing: 0) {
                Text("H").font(.ui(13, .semibold))
                Text(item.id.suffix(1)).font(.ui(8.5, .semibold))
            }
        case "paragraph":
            Image(systemName: "text.alignleft").font(.system(size: 13, weight: .medium))
        default:
            Image(systemName: item.systemImage).font(.system(size: 13, weight: .medium))
        }
    }

    /// Badge colors per block family (mirrors the web Insert panel).
    static func tone(for id: String) -> (fill: Color, ink: Color) {
        switch id {
        case "paragraph": return (FoleviColor.surfaceSunken, FoleviColor.heading)
        case "heading1", "heading2", "heading3": return (FoleviColor.emberSoft, FoleviColor.emberInk)
        case "todo", "bulleted", "numbered", "toggle": return (FoleviColor.mossSoft, FoleviColor.mossInk)
        case "quote", "callout": return (FoleviColor.plumSoft, FoleviColor.plumInk)
        case "code", "table": return (FoleviColor.marigoldSoft, FoleviColor.marigoldInk)
        case "image", "file", "bookmark", "date": return (FoleviColor.accentSoft, FoleviColor.accentSoftInk)
        default: return (FoleviColor.coralSoft, FoleviColor.coralInk)
        }
    }

    /// Icon tint (slash menu).
    static func tint(for id: String) -> Color { tone(for: id).ink }
}

struct InsertInspector: View {
    @Bindable var model: EditorModel
    @State private var query = ""

    private static let sections: [(LocalizedStringKey, [String])] = [
        ("Basics", ["paragraph", "heading1", "heading2", "heading3"]),
        ("Lists", ["todo", "bulleted", "numbered", "toggle"]),
        ("Blocks", ["quote", "callout", "code", "table"]),
        ("Media", ["image", "file", "bookmark", "date"]),
        ("Structure", ["divider", "page", "pagelink"]),
    ]

    var body: some View {
        let all = SlashItem.all
        let matches = model.slashItems(for: query)
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").font(.system(size: 12.5, weight: .medium)).foregroundStyle(FoleviColor.inkMuted).accessibilityHidden(true)
                TextField("Search blocks", text: $query)
                    .textFieldStyle(.plain)
                    .font(.ui(13.5))
                    .accessibilityLabel(Text("Search blocks"))
                if !query.isEmpty {
                    Button { query = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(FoleviColor.inkFaint) }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text("Clear search"))
                }
            }
            .padding(.horizontal, 12)
            .frame(height: 34)
            .foleviWell()
            Text("Drag a block into the page, or click to add it below the cursor.")
                .font(.ui(12))
                .foregroundStyle(FoleviColor.inkMuted)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 2)
                .padding(.top, -4)
            ForEach(Array(Self.sections.enumerated()), id: \.offset) { _, section in
                let items = section.1.compactMap { id in all.first { $0.id == id } }.filter { item in matches.contains { $0.id == item.id } }
                if !items.isEmpty {
                    VStack(alignment: .leading, spacing: 9) {
                        SectionTitle(title: section.0).padding(.horizontal, 2)
                        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), alignment: .leading, spacing: 8) {
                            ForEach(items) { item in
                                InsertTile(item: item, disabled: model.isReadOnly) {
                                    model.insertBlock(type: item.id)
                                } onDragBegan: { point in
                                    model.drag.beginInsertDrag(type: item.id, title: item.plainTitle, systemImage: item.systemImage, at: point)
                                }
                            }
                        }
                    }
                }
            }
            if matches.isEmpty {
                Text("No blocks match “\(query)”.").font(.ui(12.5)).foregroundStyle(FoleviColor.inkMuted)
            }
        }
    }
}

// MARK: - Format (turn into, marks, callout tone, code language)

struct FormatInspector: View {
    @Bindable var model: EditorModel

    private var focusedBlock: Block? {
        let id = model.focusedBlockId ?? model.orderedByRows(Array(model.selectedBlockIds)).first
        return id.flatMap { model.blocks[$0] }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            if focusedBlock == nil {
                Text("Place the cursor in a block to format it.").font(.ui(12.5)).foregroundStyle(FoleviColor.inkMuted)
            }
            group("Turn Into") {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 8) {
                    ForEach(["paragraph", "heading1", "heading2", "heading3", "todo", "bulleted", "numbered", "toggle", "quote", "callout", "code"], id: \.self) { id in
                        if let item = SlashItem.all.first(where: { $0.id == id }) {
                            FormatTile(item: item, isCurrent: isCurrent(id)) { model.turnInto(id) }
                        }
                    }
                }
            }
            group("Text") {
                HStack(spacing: 6) {
                    markButton("bold", "bold", "Bold") { model.toggleMark(.bold) }
                    markButton("italic", "italic", "Italic") { model.toggleMark(.italic) }
                    markButton("underline", "underline", "Underline") { model.toggleMark(.underline) }
                    markButton("strike", "strikethrough", "Strikethrough") { model.toggleMark(.strike) }
                    markButton("code", "chevron.left.forwardslash.chevron.right", "Inline Code") { model.toggleMark(.code) }
                    markButton("link", "link", "Link") { model.beginLink() }
                }
            }
            group("Color") {
                HStack(spacing: 8) {
                    swatch(FoleviColor.ink, "Default color") { model.setColor(nil) }
                    ForEach(TextColor.allCases, id: \.self) { c in
                        swatch(Color(nsColor: .folevi(text: c)), LocalizedStringKey(c.rawValue.capitalized)) { model.setColor(c) }
                    }
                }
            }
            group("Highlight") {
                HStack(spacing: 8) {
                    swatch(FoleviColor.surfaceSunken, "No highlight", slash: true) { model.setHighlight(nil) }
                    ForEach(HighlightColor.allCases, id: \.self) { c in
                        swatch(Color(nsColor: .folevi(highlight: c)), LocalizedStringKey(c.rawValue.capitalized)) { model.setHighlight(c) }
                    }
                    Spacer()
                    Button("Clear") { model.clearFormatting() }
                        .buttonStyle(.folevi(.quiet, .small))
                        .help(Text("Clear Formatting (⌘\\)"))
                }
            }
            if let block = focusedBlock, case .callout(let p) = block.content {
                group("Callout Tone") {
                    FlowChips(values: CalloutTone.allCases.map { $0 }, isSelected: { $0 == p.tone }, title: { $0.rawValue.capitalized }) { tone in
                        model.update(block.id, actionName: String(localized: "Callout Style")) { b in
                            if case .callout(var cp) = b.content {
                                cp.tone = tone
                                b.content = .callout(cp)
                            }
                        }
                    }
                }
            }
            if let block = focusedBlock, case .code(let p) = block.content {
                group("Code Language") {
                    Menu {
                        ForEach(foleviCodeLanguages, id: \.self) { lang in
                            Button(lang == "plaintext" ? String(localized: "Plain Text") : lang) {
                                model.update(block.id, actionName: String(localized: "Code Language")) { b in
                                    if case .code(var cp) = b.content {
                                        cp.language = lang
                                        b.content = .code(cp)
                                    }
                                }
                            }
                        }
                    } label: {
                        Text(p.language == "plaintext" ? String(localized: "Plain Text") : p.language)
                    }
                    .menuStyle(.button)
                    .buttonStyle(.folevi(.secondary, .small))
                    .fixedSize()
                }
            }
            Text("Shortcuts: ⌥⌘0–9 turn into, ⌘B ⌘I ⌘U marks, Tab / ⇧Tab to nest, ⌥⇧↑↓ to move.")
                .font(.ui(11.5)).foregroundStyle(FoleviColor.inkFaint).fixedSize(horizontal: false, vertical: true)
        }
        .disabled(model.isReadOnly)
    }

    private func isCurrent(_ id: String) -> Bool {
        guard let b = focusedBlock else { return false }
        if case .heading(let h) = b.content { return id == "heading\(h.level.rawValue)" }
        return b.typeName == id
    }

    private func group<C: View>(_ title: LocalizedStringKey, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            SectionTitle(title: title).padding(.horizontal, 2)
            content()
        }
    }

    private func markButton(_ key: String, _ icon: String, _ label: LocalizedStringKey, action: @escaping () -> Void) -> some View {
        let active = model.activeMarks.contains(key)
        return Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 12.5, weight: .semibold))
                .foregroundStyle(active ? FoleviColor.emberInk : FoleviColor.ink)
                .frame(maxWidth: .infinity)
                .frame(height: 34)
                .foleviSurface(.color(active ? FoleviColor.emberSoft : FoleviColor.surfaceRaised), shape: .rounded(10),
                               shadow: active ? FoleviDepth.well : FoleviShadow.control)
        }
        .buttonStyle(.plain)
        .help(Text(label))
        .accessibilityLabel(Text(label))
        .accessibilityAddTraits(active ? .isSelected : [])
    }

    private func swatch(_ color: Color, _ label: LocalizedStringKey, slash: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Circle().fill(color)
                .frame(width: 24, height: 24)
                .overlay(Circle().strokeBorder(FoleviColor.heading.opacity(0.12)))
                .overlay { if slash { Rectangle().fill(FoleviColor.coral).frame(width: 1.5, height: 22).rotationEffect(.degrees(45)) } }
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .help(Text(label))
        .accessibilityLabel(Text(label))
    }
}

/// Small tile for Turn Into.
private struct FormatTile: View {
    var item: SlashItem
    var isCurrent: Bool
    var action: () -> Void
    @State private var hovering = false

    var body: some View {
        let tone = InsertTile.tone(for: item.id)
        Button(action: action) {
            VStack(spacing: 5) {
                InsertTile.glyph(for: item)
                    .foregroundStyle(tone.ink)
                    .frame(width: 26, height: 26)
                    .background(RoundedRectangle(cornerRadius: 7, style: .continuous).fill(tone.fill))
                Text(InsertTile.label(for: item)).font(.ui(10.5, .medium)).foregroundStyle(FoleviColor.ink).lineLimit(1).minimumScaleFactor(0.75)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 60)
            .foleviSurface(.color(hovering ? FoleviColor.surfaceRaised.mix(with: FoleviColor.accentSoft, by: 0.35) : FoleviColor.surfaceRaised),
                           shape: .rounded(12), shadow: FoleviShadow.control, ring: isCurrent ? FoleviColor.ember : nil)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .accessibilityLabel(Text(item.title))
        .accessibilityAddTraits(isCurrent ? .isSelected : [])
    }
}

/// Pill chips that wrap.
private struct FlowChips<T: Hashable>: View {
    var values: [T]
    var isSelected: (T) -> Bool
    var title: (T) -> String
    var action: (T) -> Void

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 70), spacing: 6)], alignment: .leading, spacing: 6) {
            ForEach(values, id: \.self) { v in
                FilterChip(title: title(v), isActive: isSelected(v)) { action(v) }
            }
        }
    }
}

// MARK: - Style (text + page)

struct StyleInspector: View {
    @Bindable var model: EditorModel

    var body: some View {
        let style = model.style
        VStack(alignment: .leading, spacing: 20) {
            group("Font") {
                FoleviSegmented(selection: binding(\.font, style), items: [
                    .init(value: .sans, title: "Sans"), .init(value: .serif, title: "Serif"), .init(value: .mono, title: "Mono"),
                ], height: 32, fontSize: 13, accessibilityLabel: "Page Font")
            }
            group("Width") {
                FoleviSegmented(selection: binding(\.width, style), items: [
                    .init(value: .narrow, title: "Narrow"), .init(value: .default, title: "Regular"), .init(value: .wide, title: "Wide"),
                ], height: 32, fontSize: 13, accessibilityLabel: "Page Width")
            }
            group("Page") {
                FoleviSegmented(selection: binding(\.background, style), items: [
                    .init(value: .paper, title: "Paper"), .init(value: .plain, title: "Plain"), .init(value: .tinted, title: "Tinted"), .init(value: .grid, title: "Grid"),
                ], height: 32, fontSize: 13, accessibilityLabel: "Page Background")
            }
            group("Card in Lists") {
                FoleviSegmented(selection: binding(\.card, style), items: [
                    .init(value: .folio, title: "Folio"), .init(value: .plain, title: "Plain"), .init(value: .tinted, title: "Tinted"), .init(value: .outline, title: "Outline"),
                ], height: 32, fontSize: 13, accessibilityLabel: "Card Style")
            }
            group("Accent") {
                HStack(spacing: 10) {
                    ForEach(DocumentAccent.allCases, id: \.self) { accent in
                        Button { set(\.accent, accent) } label: {
                            Circle().fill(Color.folevi(accent: accent))
                                .frame(width: 30, height: 30)
                                .overlay(Circle().strokeBorder(.white.opacity(0.35), lineWidth: 1))
                                .padding(3)
                                .overlay(Circle().strokeBorder(style.accent == accent ? FoleviColor.heading : .clear, lineWidth: 2))
                                .contentShape(Circle())
                        }
                        .buttonStyle(.plain)
                        .help(Text(accentName(accent)))
                        .accessibilityLabel(Text(accentName(accent)))
                        .accessibilityAddTraits(style.accent == accent ? .isSelected : [])
                    }
                }
            }
            group("Cover") {
                FoleviSegmented(selection: Binding(get: { model.document?.cover.kind == .image ? .none : (model.document?.cover.kind ?? .none) }, set: { kind in
                    if kind == .art {
                        let current = model.document?.cover
                        model.setCover(DocumentCover(kind: .art, value: current?.kind == .art ? current?.value : CoverArt.all.first?.id))
                    } else {
                        model.setCover(DocumentCover(kind: kind))
                    }
                }), items: [
                    .init(value: CoverKind.none, title: "None"), .init(value: .color, title: "Color"), .init(value: .gradient, title: "Gradient"), .init(value: .art, title: "Art"),
                ], height: 32, fontSize: 13, accessibilityLabel: "Cover")
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 8) {
                    ForEach(CoverArt.all) { art in
                        ArtThumb(art: art, isSelected: model.document?.cover.kind == .art && model.document?.cover.value == art.id) {
                            model.setCover(DocumentCover(kind: .art, value: art.id))
                        }
                    }
                }
                .padding(.top, 4)
                Text(coverHint)
                    .font(.ui(11.5)).foregroundStyle(FoleviColor.inkFaint).fixedSize(horizontal: false, vertical: true)
            }
        }
        .disabled(model.isReadOnly)
    }

    /// Same wording as the web inspector.
    private var coverHint: String {
        if let cover = model.document?.cover, cover.kind == .art {
            let name = CoverArt.all.first(where: { $0.id == cover.value })?.name ?? String(localized: "Artwork")
            return String(localized: "\(name) — pick any artwork above.")
        }
        return String(localized: "Color and gradient covers follow the page accent; artwork covers are fixed illustrations.")
    }

    private func group<C: View>(_ title: LocalizedStringKey, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionTitle(title: title)
            content()
        }
    }




    private func accentName(_ a: DocumentAccent) -> LocalizedStringKey {
        a == .accent ? "Ember" : LocalizedStringKey(a.rawValue.capitalized)
    }

    private func set<T>(_ path: WritableKeyPath<DocumentStyle, T>, _ value: T) {
        var s = model.style
        s[keyPath: path] = value
        model.setStyle(s)
    }

    private func binding<T>(_ path: WritableKeyPath<DocumentStyle, T>, _ style: DocumentStyle) -> Binding<T> {
        Binding(get: { style[keyPath: path] }, set: { value in
            var s = style
            s[keyPath: path] = value
            model.setStyle(s)
        })
    }
}

/// One cover artwork in the Style tab: rounded 10pt, ember ring + check when selected.
private struct ArtThumb: View {
    var art: CoverArt.Entry
    var isSelected: Bool
    var action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Group {
                if let image = CoverArt.image(art.id) {
                    ArtCoverImage(image: image)
                } else {
                    FoleviColor.surfaceSunken
                }
            }
            .frame(height: 42)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .strokeBorder(isSelected ? FoleviColor.ember : FoleviColor.heading.opacity(hovering ? 0.25 : 0.08), lineWidth: isSelected ? 2 : 1)
            }
            .overlay(alignment: .topTrailing) {
                if isSelected {
                    Image(systemName: "checkmark")
                        .font(.system(size: 8, weight: .heavy))
                        .foregroundStyle(.white)
                        .frame(width: 16, height: 16)
                        .background(Circle().fill(FoleviColor.ember))
                        .padding(4)
                }
            }
            .contentShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .help(Text(art.name))
        .accessibilityLabel(Text("Cover: \(art.name)"))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}


// MARK: - Outline

struct OutlineInspector: View {
    @Bindable var model: EditorModel

    private var headings: [EditorRow] {
        model.rows.filter { if case .heading = $0.block.content { return true } else { return false } }
    }

    /// The heading whose section holds the caret (or the selection).
    private var currentId: String? {
        let anchor = model.focusedBlockId ?? model.orderedByRows(Array(model.selectedBlockIds)).first
        guard let anchor, let idx = model.rows.firstIndex(where: { $0.id == anchor }) else { return nil }
        return model.rows[...idx].last { if case .heading = $0.block.content { return true } else { return false } }?.id
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionTitle(title: "Outline")
            if headings.isEmpty {
                Text("Headings you add appear here. Type # and a space to start one.")
                    .font(.ui(12.5)).foregroundStyle(FoleviColor.inkMuted).fixedSize(horizontal: false, vertical: true)
            }
            VStack(alignment: .leading, spacing: 2) {
                ForEach(headings) { row in
                    OutlineRow(row: row, isCurrent: row.id == currentId) {
                        model.focus = FocusRequest(blockId: row.id, caret: .end)
                        model.requestReveal(row.id)
                    }
                }
            }
        }
    }
}

private struct OutlineRow: View {
    var row: EditorRow
    var isCurrent: Bool
    var action: () -> Void
    @State private var hovering = false

    private var level: Int {
        if case .heading(let h) = row.block.content { return h.level == .level1 ? 1 : h.level == .level2 ? 2 : 3 }
        return 1
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Capsule().fill(isCurrent ? FoleviColor.ember : .clear).frame(width: 3, height: 18)
                Text(RichText.plainText(row.block.text).isEmpty ? String(localized: "Untitled heading") : RichText.plainText(row.block.text))
                    .font(.ui(level == 1 ? 13.5 : 13, level == 1 || isCurrent ? .semibold : .regular))
                    .foregroundStyle(isCurrent || hovering ? FoleviColor.heading : level == 3 ? FoleviColor.inkMuted : FoleviColor.ink)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                    .padding(.leading, CGFloat(level - 1) * 14)
                Spacer(minLength: 0)
            }
            .padding(.vertical, 5)
            .padding(.trailing, 8)
            .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(hovering ? FoleviColor.accentSoft.opacity(0.75) : .clear))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .accessibilityLabel(Text(RichText.plainText(row.block.text)))
        .accessibilityValue(Text("Heading level \(level)"))
        .accessibilityAddTraits(isCurrent ? .isSelected : [])
    }
}

// MARK: - Info

struct InfoInspector: View {
    @Bindable var model: EditorModel
    @Bindable var nav: NavigationModel
    var openDocument: (String, Bool) -> Void
    @Environment(AppModel.self) private var app
    @State private var info: DocumentInfo?
    @State private var backlinks: Backlinks?

    private var localWords: Int {
        model.blocks.values.reduce(0) { $0 + RichText.wordCount(SearchText.blockText($1.wire)) }
    }

    private var localChars: Int {
        model.blocks.values.reduce(0) { $0 + SearchText.blockText($1.wire).count }
    }

    private var readingTime: String {
        let minutes = max(1, Int((Double(localWords) / 220).rounded(.up)))
        return String(localized: "\(minutes) min")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
                stat("Words", localWords.formatted())
                stat("Characters", localChars.formatted())
                stat("Reading time", readingTime)
                stat("Blocks", model.blocks.count.formatted())
            }
            VStack(alignment: .leading, spacing: 8) {
                SectionTitle(title: "Details")
                Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 7) {
                    if let d = model.document {
                        row("Created", Date(timeIntervalSince1970: d.createdAt / 1000).formatted(date: .abbreviated, time: .shortened))
                        row("Updated", Date(timeIntervalSince1970: d.updatedAt / 1000).formatted(date: .abbreviated, time: .shortened))
                    }
                    if let info {
                        row("Created by", info.createdBy)
                        row("Last edited by", info.lastEditedBy)
                    }
                }
                .font(.ui(12.5))
            }
            Button {
                nav.showHistory = true
            } label: {
                Label("Version History…", systemImage: "clock.arrow.circlepath")
            }
            .buttonStyle(.folevi(.secondary, .small))
            VStack(alignment: .leading, spacing: 8) {
                SectionTitle(title: "Backlinks")
                if let backlinks {
                    if backlinks.linked.isEmpty && backlinks.unlinked.isEmpty {
                        Text("No other documents link here yet.").font(.ui(12.5)).foregroundStyle(FoleviColor.inkMuted)
                    }
                    ForEach(backlinks.linked) { link in linkRow(link) }
                    if !backlinks.unlinked.isEmpty {
                        Text("Unlinked mentions").foleviCapsLabel().padding(.top, 6)
                        ForEach(backlinks.unlinked) { link in linkRow(link) }
                    }
                } else {
                    Text(app.sync.isOnline ? "Loading…" : "Backlinks are available when you're online.")
                        .font(.ui(12.5)).foregroundStyle(FoleviColor.inkMuted)
                }
            }
            if let activity = info?.activity, !activity.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    SectionTitle(title: "Recent Activity")
                    ForEach(activity, id: \.self) { a in
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            Circle().fill(FoleviColor.ember.opacity(0.7)).frame(width: 5, height: 5)
                            Text(a.by).font(.ui(12, .semibold)).foregroundStyle(FoleviColor.ink)
                            Text(reasonText(a.reason)).font(.ui(12)).foregroundStyle(FoleviColor.inkMuted)
                            Spacer(minLength: 4)
                            Text(Date(timeIntervalSince1970: a.at / 1000), format: .relative(presentation: .named)).font(.ui(11)).foregroundStyle(FoleviColor.inkFaint)
                        }
                    }
                }
            }
        }
        .task(id: model.documentId) { await load() }
    }

    private func stat(_ label: LocalizedStringKey, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.ui(18, .semibold)).monospacedDigit().foregroundStyle(FoleviColor.heading).lineLimit(1).minimumScaleFactor(0.7)
            Text(label).font(.ui(11, .medium)).foregroundStyle(FoleviColor.inkMuted)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .foleviSurface(.color(FoleviColor.surfaceRaised), shape: .rounded(12), shadow: FoleviShadow.control)
        .accessibilityElement(children: .combine)
    }

    private func reasonText(_ reason: String) -> String {
        switch reason {
        case "idle", "close": return String(localized: "saved a version")
        case "manual": return String(localized: "saved a named version")
        case "before_restore": return String(localized: "restored a version")
        default: return reason
        }
    }

    private func load() async {
        guard let session = app.session, app.sync.isOnline else { return }
        info = try? await session.documents.info(model.documentId)
        backlinks = try? await session.documents.backlinks(model.documentId)
    }

    private func row(_ label: LocalizedStringKey, _ value: String) -> some View {
        GridRow {
            Text(label).foregroundStyle(FoleviColor.inkMuted)
            Text(value).monospacedDigit().foregroundStyle(FoleviColor.ink).lineLimit(1)
        }
    }

    private func linkRow(_ link: LinkRef) -> some View {
        Button {
            openDocument(link.id, NSEvent.modifierFlags.contains(.option))
        } label: {
            VStack(alignment: .leading, spacing: 2) {
                Text("\(link.icon ?? "📄") \(link.title.isEmpty ? String(localized: "Untitled") : link.title)").font(.ui(12.5, .semibold)).foregroundStyle(FoleviColor.heading)
                if !link.excerpt.isEmpty { Text(link.excerpt).font(.ui(11.5)).foregroundStyle(FoleviColor.inkMuted).lineLimit(2) }
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .foleviSurface(.color(FoleviColor.surfaceRaised), shape: .rounded(10), shadow: FoleviShadow.hairline)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Comments

struct CommentsInspector: View {
    @Bindable var model: EditorModel
    @Environment(AppModel.self) private var app
    @State private var threads: CommentThreadList?
    @State private var draft = ""
    @State private var sending = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionTitle(title: "Comments")
            if !app.sync.isOnline {
                Text("Comments are available when you're online.").font(.ui(12.5)).foregroundStyle(FoleviColor.inkMuted)
            } else if let threads {
                if threads.threads.isEmpty {
                    Text("No comments yet.").font(.ui(12.5)).foregroundStyle(FoleviColor.inkMuted)
                }
                ForEach(threads.threads) { thread in
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(thread.comments) { c in
                            VStack(alignment: .leading, spacing: 3) {
                                HStack(spacing: 6) {
                                    Text(String(c.authorName.prefix(1)).uppercased())
                                        .font(.ui(10, .semibold))
                                        .foregroundStyle(FoleviColor.heading)
                                        .frame(width: 20, height: 20)
                                        .background(Circle().fill(LinearGradient(colors: [FoleviColor.glowPeach, FoleviColor.emberSoft], startPoint: .topLeading, endPoint: .bottomTrailing)))
                                        .accessibilityHidden(true)
                                    Text(c.authorName).font(.ui(12, .semibold)).foregroundStyle(FoleviColor.heading)
                                    Spacer()
                                    Text(Date(timeIntervalSince1970: c.createdAt / 1000), format: .relative(presentation: .named))
                                        .font(.ui(10.5)).foregroundStyle(FoleviColor.inkFaint)
                                }
                                Text(c.deleted ? String(localized: "Comment deleted") : RichText.plainText(c.body))
                                    .font(.ui(12.5))
                                    .foregroundStyle(c.deleted ? FoleviColor.inkFaint : FoleviColor.ink)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        if thread.status == "resolved" {
                            Label("Resolved", systemImage: "checkmark").font(.ui(11.5, .semibold)).foregroundStyle(FoleviColor.mossInk)
                        }
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .foleviSurface(.color(FoleviColor.surfaceRaised), shape: .rounded(12), shadow: FoleviShadow.control)
                }
                if threads.canComment {
                    TextField("Add a comment", text: $draft, axis: .vertical)
                        .textFieldStyle(.plain)
                        .font(.ui(13))
                        .lineLimit(1...5)
                        .padding(10)
                        .foleviWell(shape: .rounded(12))
                    Button("Comment") { Task { await send() } }
                        .buttonStyle(.folevi(.primary, .small))
                        .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || sending)
                }
            } else {
                ProgressView().controlSize(.small)
            }
        }
        .task(id: model.documentId) { await load() }
    }

    private func load() async {
        guard let session = app.session, app.sync.isOnline else { return }
        threads = try? await session.documents.comments(model.documentId)
    }

    private func send() async {
        guard let session = app.session else { return }
        sending = true
        defer { sending = false }
        do {
            try await session.documents.addComment(documentId: model.documentId, blockId: model.focusedBlockId == "__title__" ? nil : model.focusedBlockId, text: draft)
            draft = ""
            await load()
        } catch {
            app.showToast(ConvexService.mapError(error).localizedDescription)
        }
    }
}

// MARK: - Version history

struct VersionHistorySheet: View {
    let documentId: String
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var snapshots: [SnapshotInfo] = []
    @State private var selected: SnapshotInfo?
    @State private var preview: [WireBlock] = []
    @State private var loading = true
    @State private var confirmRestore = false

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Version History").font(FoleviType.sectionTitle).foregroundStyle(FoleviColor.heading)
                Spacer()
                Button("Save Version Now") {
                    Task {
                        try? await app.session?.documents.createSnapshot(documentId, reason: "manual")
                        await load()
                    }
                }
                .disabled(!app.sync.isOnline)
            }
            .padding(20)
            Divider()
            HSplitView {
                List(snapshots, selection: Binding(get: { selected?.id }, set: { id in selected = snapshots.first { $0.id == id } })) { snap in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(Date(timeIntervalSince1970: snap.createdAt / 1000).formatted(date: .abbreviated, time: .shortened)).font(.ui(12, .medium))
                        Text("\(snap.createdBy) · \(Int(snap.blockCount)) blocks").font(.ui(11.5)).foregroundStyle(FoleviColor.inkMuted)
                    }
                    .tag(snap.id)
                }
                .frame(minWidth: 220, maxWidth: 260)
                ScrollView {
                    VStack(alignment: .leading, spacing: 6) {
                        if loading { ProgressView() }
                        if !app.sync.isOnline { Text("Version history is available when you're online.").foregroundStyle(FoleviColor.inkMuted) }
                        ForEach(Tree.flatten(preview), id: \.block.id) { entry in
                            Text(String(repeating: "    ", count: entry.depth) + previewLine(entry.block))
                                .font(entry.block.type == "heading" ? .serif(15, .semibold) : .ui(13))
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    .padding(20)
                    .textSelection(.enabled)
                }
                .frame(minWidth: 360)
            }
            Divider()
            HStack {
                Spacer()
                Button("Close") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Restore This Version…") { confirmRestore = true }
                    .disabled(selected == nil || !app.sync.isOnline)
                    .keyboardShortcut(.defaultAction)
            }
            .padding(16)
        }
        .frame(width: 760, height: 540)
        .task { await load() }
        .onChange(of: selected) { _, snap in Task { await loadPreview(snap) } }
        .confirmationDialog("Restore this version?", isPresented: $confirmRestore) {
            Button("Restore") {
                guard let selected else { return }
                Task {
                    do {
                        try await app.session?.documents.restoreSnapshot(selected.id)
                        await app.session?.engine.syncNow()
                        dismiss()
                    } catch {
                        app.showToast(ConvexService.mapError(error).localizedDescription)
                    }
                }
            }
        } message: {
            Text("The current version is saved first, so you can always go back.")
        }
    }

    private func previewLine(_ b: WireBlock) -> String {
        let text = SearchText.blockText(b)
        switch b.type {
        case "bulleted": return "• " + text
        case "todo": return ((b.props["checked"]?.boolValue ?? false) ? "☑ " : "☐ ") + text
        case "divider": return "———"
        default: return text
        }
    }

    private func load() async {
        loading = true
        defer { loading = false }
        guard let session = app.session, app.sync.isOnline else { return }
        snapshots = (try? await session.documents.snapshots(documentId)) ?? []
        if selected == nil { selected = snapshots.first }
    }

    private func loadPreview(_ snap: SnapshotInfo?) async {
        guard let snap, let session = app.session else { return }
        guard let fetched = try? await session.documents.snapshotContent(snap.id), let raw = fetched.content,
              let json = try? JSONValue(jsonString: raw) else {
            preview = []
            return
        }
        preview = (json["blocks"]?.arrayValue ?? []).compactMap { try? WireBlock(json: $0) }
    }
}
