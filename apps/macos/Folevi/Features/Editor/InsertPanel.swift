import SwiftUI

/// Inspector → Insert, as on the web (doc/InsertPanel.tsx): a searchable list of everything that can go
/// into a page. Every row inserts below the current block on click, or where it's dropped when dragged
/// into the page. Below the list: divider styles, a page break and a table-size picker.
struct InsertInspector: View {
    @Bindable var model: EditorModel
    @State private var query = ""

    struct Item: Identifiable {
        var id: String
        var label: String
        var systemImage: String
        var keywords: String
    }

    static let main: [Item] = [
        Item(id: "paragraph", label: "Text", systemImage: "text.alignleft", keywords: "paragraph plain"),
        Item(id: "page", label: "Page", systemImage: "doc.text", keywords: "nested subpage child link"),
        Item(id: "card", label: "Card", systemImage: "rectangle.stack", keywords: "page nested subpage child"),
        Item(id: "file", label: "File Attachment", systemImage: "paperclip", keywords: "file attachment upload pdf document"),
        Item(id: "image", label: "Image", systemImage: "photo", keywords: "picture photo upload"),
        Item(id: "record", label: "Audio Recording", systemImage: "mic", keywords: "audio record recording voice memo microphone mic sound"),
        Item(id: "unsplash", label: "Image from Unsplash", systemImage: "photo.badge.plus", keywords: "picture photo stock unsplash search"),
        Item(id: "code", label: "Code Block", systemImage: "chevron.left.forwardslash.chevron.right", keywords: "code snippet programming"),
        Item(id: "formula", label: "TeX Formula", systemImage: "sum", keywords: "formula math latex tex equation katex"),
        Item(id: "mermaid", label: "Mermaid Diagram", systemImage: "point.3.connected.trianglepath.dotted", keywords: "mermaid diagram flowchart chart graph"),
        Item(id: "flowchart", label: "Flowchart", systemImage: "rectangle.connected.to.line.below", keywords: "flowchart diagram process flow chart shapes boxes arrows whimsical miro"),
        Item(id: "whiteboard", label: "Whiteboard", systemImage: "pencil.tip", keywords: "drawing sketch draw pen canvas"),
    ]

    static let collections: [Item] = [
        Item(id: "collection", label: "Table", systemImage: "tablecells", keywords: "collection database table rows"),
        Item(id: "gallery", label: "Gallery", systemImage: "square.grid.2x2", keywords: "collection database cards grid"),
        Item(id: "board", label: "Kanban", systemImage: "rectangle.split.3x1", keywords: "collection database board columns"),
    ]

    static let more: [Item] = [
        Item(id: "heading1", label: "Heading 1", systemImage: "textformat.size.larger", keywords: "title h1"),
        Item(id: "heading2", label: "Heading 2", systemImage: "textformat.size", keywords: "subtitle h2"),
        Item(id: "heading3", label: "Heading 3", systemImage: "textformat.size.smaller", keywords: "h3"),
        Item(id: "todo", label: "To-do", systemImage: "checkmark.square", keywords: "task checkbox checklist"),
        Item(id: "bulleted", label: "Bulleted List", systemImage: "list.bullet", keywords: "bullets unordered"),
        Item(id: "numbered", label: "Numbered List", systemImage: "list.number", keywords: "numbers ordered"),
        Item(id: "toggle", label: "Toggle", systemImage: "chevron.right.square", keywords: "collapse disclosure details"),
        Item(id: "quote", label: "Quote", systemImage: "text.quote", keywords: "blockquote citation"),
        Item(id: "callout", label: "Callout", systemImage: "note.text", keywords: "note tip info warning"),
        Item(id: "bookmark", label: "Bookmark", systemImage: "bookmark", keywords: "web link url embed"),
        Item(id: "pickdate", label: "Date", systemImage: "calendar", keywords: "day calendar mention today"),
    ]

    private var q: String { query.trimmingCharacters(in: .whitespaces).lowercased() }
    private func matches(_ text: String) -> Bool { q.isEmpty || text.lowercased().contains(q) }
    private func filter(_ items: [Item]) -> [Item] { items.filter { matches("\($0.label) \($0.keywords)") } }

    var body: some View {
        let main = filter(Self.main), collections = filter(Self.collections), more = filter(Self.more)
        let showLines = matches("insert line divider separator rule extra light regular strong")
        let showBreak = matches("insert page break print pdf")
        let showTable = matches("insert table grid rows columns")
        let nothing = main.isEmpty && collections.isEmpty && more.isEmpty && !showLines && !showBreak && !showTable
        VStack(alignment: .leading, spacing: 0) {
            Text("Drag and drop any item to the document")
                .font(.ui(12.5)).foregroundStyle(FoleviColor.inkMuted)
                .uiLineHeight(12.5 * 1.55, size: 12.5)
                .padding(.horizontal, 4).padding(.bottom, 8)
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").font(.system(size: 12.5, weight: .medium)).foregroundStyle(FoleviColor.inkMuted).accessibilityHidden(true)
                TextField("Search", text: $query)
                    .textFieldStyle(.plain)
                    .font(.ui(13))
                    .accessibilityLabel(Text("Search blocks"))
                if !query.isEmpty {
                    Button { query = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(FoleviColor.inkFaint) }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text("Clear search"))
                }
            }
            .padding(.horizontal, 12)
            .frame(height: 36)
            .foleviWell(shape: .rounded(6))
            if !main.isEmpty { section(nil) { list(main) } }
            if !collections.isEmpty { section("Collections") { list(collections) } }
            if showLines {
                section("Insert Line") {
                    LazyVGrid(columns: [GridItem(.flexible(), spacing: 6), GridItem(.flexible(), spacing: 6)], spacing: 6) {
                        ForEach(InsertCatalog.dividerStyles, id: \.style) { d in
                            InsertDragTile(model: model, type: "divider-\(d.style.rawValue)", title: String(localized: "Divider, \(d.label.lowercased())"),
                                           systemImage: "minus", help: String(localized: "\(d.label) line"), height: 44) {
                                DividerPreview(style: d.style).padding(.horizontal, 14)
                            }
                        }
                    }
                }
            }
            if showBreak {
                section("Insert Page Break") {
                    InsertDragTile(model: model, type: "pagebreak", title: String(localized: "Page break"), systemImage: "rectangle.split.1x2",
                                   help: String(localized: "Page break: starts a new page when printed"), height: 64) {
                        PageBreakPreview().frame(maxWidth: .infinity).padding(.horizontal, 30)
                    }
                }
            }
            if showTable {
                section("Insert Table") { TableSizePicker(model: model) }
            }
            if !more.isEmpty { section("Text & Blocks") { list(more) } }
            if nothing {
                Text("No blocks match “\(query)”.")
                    .font(.ui(13)).foregroundStyle(FoleviColor.inkMuted)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 24)
            }
        }
        .disabled(model.isReadOnly)
    }

    private func section<C: View>(_ title: LocalizedStringKey?, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if let title {
                Text(title).font(.ui(13.5, .semibold)).foregroundStyle(FoleviColor.heading).padding(.horizontal, 4)
                    .uiLineHeight(13.5 * 1.55, size: 13.5, weight: .semibold)
                    .accessibilityAddTraits(.isHeader)
            }
            content()
        }
        // mt-5 (its `first:mt-3` never applies: the hint and search come first).
        .padding(.top, 20)
    }

    private func list(_ items: [Item]) -> some View {
        VStack(spacing: 6) {
            ForEach(items) { item in InsertRow(model: model, item: item) }
        }
    }
}

/// One Insert row (fb-insert-row): icon, label and a grip; click inserts, press-and-move drags it in.
private struct InsertRow: View {
    @Bindable var model: EditorModel
    var item: InsertInspector.Item
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 10) {
            Group {
                if item.id.hasPrefix("heading") {
                    // Lucide's Heading1–3: an H with its level.
                    HStack(alignment: .lastTextBaseline, spacing: 0) {
                        Text("H").font(.ui(13, .semibold))
                        Text(item.id.suffix(1)).font(.ui(9, .semibold))
                    }
                } else {
                    Image(systemName: item.systemImage).font(.system(size: 13, weight: .medium))
                }
            }
            .foregroundStyle(FoleviColor.inkMuted)
            .frame(width: 18)
            Text(item.label).font(.ui(13.5, .medium)).foregroundStyle(FoleviColor.ink).lineLimit(1)
            Spacer(minLength: 4)
            GripDots(highlighted: false).frame(width: 14, height: 18).opacity(hovering ? 1 : 0.75)
        }
        .padding(.leading, 12)
        .padding(.trailing, 8)
        .frame(height: 40)
        .foleviSurface(.color(hovering ? FoleviColor.surfaceSunken.mix(with: FoleviColor.surfaceRaised, by: 0.45) : FoleviColor.surfaceRaised),
                       shape: .rounded(12), shadow: FoleviShadow.control)
        .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay {
            if !model.isReadOnly {
                PointerDragSource(cursor: .openHand, help: String(localized: "\(item.label): click to insert below the current block, or drag into the page"),
                                  onHover: { hovering = $0 }, onClick: { model.insertBlock(type: item.id) }) { _, current in
                    model.drag.beginInsertDrag(type: item.id, title: item.label, systemImage: item.systemImage, at: current)
                }
            }
        }
        .opacity(model.isReadOnly ? 0.45 : 1)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(item.label))
        .accessibilityHint(Text("Inserts below the current block"))
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { if !model.isReadOnly { model.insertBlock(type: item.id) } }
    }
}

/// A tile (divider looks, page break) that inserts on click or drags into the page.
private struct InsertDragTile<Content: View>: View {
    @Bindable var model: EditorModel
    var type: String
    var title: String
    var systemImage: String
    var help: String
    var height: CGFloat
    @ViewBuilder var content: () -> Content
    @State private var hovering = false

    var body: some View {
        content()
            .frame(maxWidth: .infinity)
            .frame(height: height)
            .foleviSurface(.color(hovering ? FoleviColor.surfaceSunken.mix(with: FoleviColor.surfaceRaised, by: 0.45) : FoleviColor.surfaceRaised),
                           shape: .rounded(12), shadow: FoleviShadow.control)
            .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay {
                if !model.isReadOnly {
                    PointerDragSource(cursor: .openHand, help: help, onHover: { hovering = $0 }, onClick: { model.insertBlock(type: type) }) { _, current in
                        model.drag.beginInsertDrag(type: type, title: title, systemImage: systemImage, at: current)
                    }
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(title))
            .accessibilityAddTraits(.isButton)
            .accessibilityAction { if !model.isReadOnly { model.insertBlock(type: type) } }
    }
}

/// Two stacked page edges (fb-pagebreak-preview).
private struct PageBreakPreview: View {
    var body: some View {
        VStack(spacing: 6) {
            UnevenRoundedRectangle(bottomLeadingRadius: 6, bottomTrailingRadius: 6, style: .continuous)
                .fill(FoleviColor.surface)
                .overlay(UnevenRoundedRectangle(bottomLeadingRadius: 6, bottomTrailingRadius: 6, style: .continuous).strokeBorder(FoleviColor.lineStrong, lineWidth: 1))
                .frame(height: 14)
            UnevenRoundedRectangle(topLeadingRadius: 6, topTrailingRadius: 6, style: .continuous)
                .fill(FoleviColor.surface)
                .overlay(UnevenRoundedRectangle(topLeadingRadius: 6, topTrailingRadius: 6, style: .continuous).strokeBorder(FoleviColor.lineStrong, lineWidth: 1))
                .frame(height: 14)
        }
    }
}

/// Hover (or arrow keys) highlights rows × columns from the top-left; click (or Return) inserts that table.
private struct TableSizePicker: View {
    @Bindable var model: EditorModel
    static let cols = 8, rows = 5
    @State private var hover: (r: Int, c: Int)?
    @State private var cursor = (r: 3, c: 3)
    @FocusState private var focused: Bool

    private var active: (r: Int, c: Int)? { hover ?? (focused ? cursor : nil) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Insert a table with the highlighted number of rows and columns.")
                .font(.ui(12.5)).foregroundStyle(FoleviColor.inkMuted)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 4)
            Grid(horizontalSpacing: 4, verticalSpacing: 4) {
                ForEach(1...Self.rows, id: \.self) { r in
                    GridRow {
                        ForEach(1...Self.cols, id: \.self) { c in
                            let lit = active.map { r <= $0.r && c <= $0.c } ?? false
                            RoundedRectangle(cornerRadius: 4, style: .continuous)
                                .fill(lit ? FoleviColor.accent.mix(with: FoleviColor.surfaceRaised, by: 0.84) : FoleviColor.surfaceSunken)
                                .overlay(RoundedRectangle(cornerRadius: 4, style: .continuous)
                                    .strokeBorder(lit ? FoleviColor.accent.opacity(0.55) : FoleviColor.line, lineWidth: lit ? 1.5 : 1))
                                .aspectRatio(1, contentMode: .fit)
                                .frame(minHeight: 18)
                                .contentShape(Rectangle())
                                .onHover { inside in if inside { hover = (r, c) } }
                                .onTapGesture { insert(r, c) }
                                .accessibilityElement()
                                .accessibilityLabel(Text("\(r) × \(c) table (\(r) rows, \(c) columns)"))
                                .accessibilityAddTraits(.isButton)
                                .accessibilityAction { insert(r, c) }
                        }
                    }
                }
            }
            .padding(10)
            .foleviSurface(.color(FoleviColor.surfaceRaised), shape: .rounded(12), shadow: FoleviShadow.control)
            .padding(.top, 8)
            .onHover { inside in if !inside { hover = nil } }
            .focusable()
            .focused($focused)
            .focusEffectDisabled()
            .overlay { if focused { RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(FoleviColor.focus, lineWidth: 2).padding(.top, 8) } }
            .onKeyPress(.rightArrow) { move(0, 1) }
            .onKeyPress(.leftArrow) { move(0, -1) }
            .onKeyPress(.downArrow) { move(1, 0) }
            .onKeyPress(.upArrow) { move(-1, 0) }
            .onKeyPress(.return) { insert(cursor.r, cursor.c); return .handled }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text("Table size"))
            Text(active.map { "\($0.r) × \($0.c)" } ?? " ")
                .font(.ui(12.5, .medium)).monospacedDigit()
                .foregroundStyle(FoleviColor.inkMuted)
                .frame(maxWidth: .infinity)
                .padding(.top, 6)
        }
    }

    private func move(_ dr: Int, _ dc: Int) -> KeyPress.Result {
        cursor = (max(1, min(Self.rows, cursor.r + dr)), max(1, min(Self.cols, cursor.c + dc)))
        return .handled
    }

    private func insert(_ r: Int, _ c: Int) {
        guard !model.isReadOnly else { return }
        model.insertBlock(type: "table-\(r)x\(c)")
    }
}
