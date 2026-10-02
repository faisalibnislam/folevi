import AppKit
import SwiftUI

/// A collection embedded in a page, as on the web (CollectionEmbed.tsx): typed properties with table,
/// board (kanban) and gallery views. Live from the server (`collections:get`); edits go straight to its
/// mutations: rename, add / rename / delete rows, set values, link pages, move cards between columns, add
/// and delete views, filters, sorts, grouping, cards and properties.
struct CollectionBlockView: View {
    let props: CollectionProps
    var isEditable: Bool
    var openDocument: (String, Bool) -> Void
    @Environment(AppModel.self) private var app
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var payload: CollectionPayload?
    @State private var unavailable = false
    @State private var viewId: String?
    @State private var showSettings = false
    @State private var pulse = false

    private var storedViewKey: String { "folevi:collection-view:\(props.collectionId)" }

    var body: some View {
        Group {
            if let payload, let view = payload.snapshot.view(preferred: viewId, fallback: props.viewId) {
                content(payload, view)
            } else if unavailable || payload != nil {
                Text(app.sync.isOnline ? "This collection is unavailable." : "Connect to the internet to load this collection.")
                    .font(.ui(13)).foregroundStyle(FoleviColor.inkMuted)
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(FoleviColor.line, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
            } else {
                // `h-40 animate-pulse ui-card rounded-[8px]`
                Color.clear
                    .frame(height: 160)
                    .foleviSurface(.color(FoleviColor.surface), shape: .rounded(8), shadow: FoleviShadow.card)
                    .opacity(pulse ? 0.5 : 1)
                    .onAppear {
                        guard !reduceMotion else { return }
                        withAnimation(.easeInOut(duration: 1).repeatForever(autoreverses: true)) { pulse = true }
                    }
                    .accessibilityLabel(Text("Loading collection"))
            }
        }
        .task(id: props.collectionId) { await subscribe() }
        .onAppear { viewId = UserDefaults.standard.string(forKey: storedViewKey) }
    }

    // MARK: Data

    private func subscribe() async {
        guard let session = app.session else { unavailable = true; return }
        let stream: AsyncThrowingStream<CollectionPayload?, Error> = session.convex.subscribe("collections:get", ["collectionId": .string(props.collectionId)])
        do {
            for try await next in stream {
                payload = next
                unavailable = next == nil
            }
        } catch {
            if payload == nil { unavailable = true }
        }
    }

    private var canEdit: Bool { isEditable && (payload?.snapshot.canEdit ?? false) }

    private var editor: CollectionEditor { CollectionEditor(collectionId: props.collectionId, app: app) }

    private var actions: CollectionActions {
        CollectionActions(
            editor: editor,
            setValue: { rowId, prop, value in
                optimistic { d in
                    guard let i = d.rows.firstIndex(where: { $0.id == rowId }) else { return }
                    d.rows[i].values[prop] = CollectionLogic.isEmpty(value) ? nil : value
                }
                editor.run("collections:setValue", ["rowId": .string(rowId), "propertyId": .string(prop), "value": value ?? .null])
            },
            renameRow: { rowId, title in
                optimistic { d in if let i = d.rows.firstIndex(where: { $0.id == rowId }) { d.rows[i].title = title } }
                editor.run("collections:renameRow", ["rowId": .string(rowId), "title": .string(title)])
            },
            updateView: { id, config, name in
                optimistic { d in
                    guard let i = d.views.firstIndex(where: { $0.id == id }) else { return }
                    if let config { d.views[i].config = config }
                    if let name { d.views[i].name = name }
                }
                var args: [String: JSONValue] = ["viewId": .string(id)]
                if let config { args["config"] = config.json }
                if let name { args["name"] = .string(name) }
                editor.run("collections:updateView", args)
            },
            addRow: { values in
                var args: [String: JSONValue] = ["title": .string("")]
                if let values { args["values"] = .object(values) }
                editor.run("collections:addRow", args)
            },
            selectView: { id in setViewId(id) })
    }

    private func setViewId(_ id: String) {
        viewId = id
        UserDefaults.standard.set(id, forKey: storedViewKey)
    }

    private func optimistic(_ change: (inout CollectionSnapshot) -> Void) {
        guard var p = payload else { return }
        change(&p.snapshot)
        payload = p
    }

    // MARK: Card

    private func content(_ data: CollectionPayload, _ view: CollectionSnapshot.View) -> some View {
        let snapshot = data.snapshot
        let rows = CollectionLogic.apply(snapshot.rows, view.config, snapshot.properties)
        let visible = snapshot.properties.filter { view.config.visibleProperties.contains($0.id) }
        return VStack(alignment: .leading, spacing: 0) {
            header(snapshot, view)
            FoleviColor.line.frame(height: 1)
            switch view.type {
            case "board":
                CollectionBoard(data: data, view: view, rows: rows, visible: visible, canEdit: canEdit, openDocument: openDocument,
                                actions: actions, move: move)
            case "gallery":
                CollectionGallery(data: data, view: view, rows: rows, visible: visible, openDocument: openDocument)
            default:
                CollectionTable(data: data, rows: rows, visible: visible, canEdit: canEdit, openDocument: openDocument, actions: actions)
            }
            if canEdit && view.type != "board" {
                FoleviColor.line.frame(height: 1)
                Button { actions.addRow(nil) } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "plus").font(.system(size: 11, weight: .medium)).accessibilityHidden(true)
                        Text("New row")
                    }
                    .font(.ui(12))
                    .padding(.horizontal, 12)
                    .frame(maxWidth: .infinity, minHeight: 32, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(HoverRowStyle())
            }
        }
        .foleviSurface(.color(FoleviColor.surface), shape: .rounded(8), shadow: FoleviShadow.card)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Collection \(snapshot.name)"))
        .onChange(of: rows.count) { _, shown in
            let total = snapshot.rows.count
            let message = total == 1 ? String(localized: "\(shown) of 1 row shown") : String(localized: "\(shown) of \(total) rows shown")
            AccessibilityNotification.Announcement(message).post()
        }
        .sheet(isPresented: $showSettings) {
            if let live = payload, let liveView = live.snapshot.view(preferred: viewId, fallback: props.viewId) {
                CollectionViewSettings(data: live, view: liveView, actions: actions) { showSettings = false }
                    .environment(app)
            }
        }
    }

    private func move(_ rowId: String, _ column: String?, _ after: String?, _ groupId: String) {
        optimistic { d in
            guard let i = d.rows.firstIndex(where: { $0.id == rowId }) else { return }
            d.rows[i].values[groupId] = column.map(JSONValue.string)
            let row = d.rows.remove(at: i)
            if let after, let j = d.rows.firstIndex(where: { $0.id == after }) { d.rows.insert(row, at: j + 1) } else { d.rows.append(row) }
        }
        editor.run("collections:moveRow", ["rowId": .string(rowId), "afterRowId": after.map(JSONValue.string) ?? .null,
                                           "groupPropertyId": .string(groupId), "groupValue": column.map(JSONValue.string) ?? .null])
    }

    private func header(_ data: CollectionSnapshot, _ view: CollectionSnapshot.View) -> some View {
        HStack(spacing: 4) {
            if canEdit {
                InlineTextField(value: data.name, placeholder: "", font: .ui(13, .semibold), maxLength: 80, color: FoleviColor.heading) { name in
                    let next = name.isEmpty ? String(localized: "Collection") : name
                    optimistic { $0.name = next }
                    editor.run("collections:rename", ["name": .string(next)])
                }
                .frame(width: 176)
                .padding(.trailing, 8)
                .accessibilityLabel(Text("Collection name"))
            } else {
                Text(data.name).font(.ui(13, .semibold)).foregroundStyle(FoleviColor.heading).padding(.trailing, 8)
                    .accessibilityAddTraits(.isHeader)
            }
            FlowLayout(spacing: 4) {
                ForEach(data.views) { v in
                    ViewTab(title: v.name, systemImage: Self.icon(v.type), selected: v.id == view.id) { setViewId(v.id) }
                }
            }
            .layoutPriority(1)
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text("Views"))
            Spacer(minLength: 8)
            HStack(spacing: 4) {
                if !view.config.filters.isEmpty {
                    let n = view.config.filters.count
                    HStack(spacing: 5) {
                        Image(systemName: "line.3.horizontal.decrease").font(.system(size: 10.5, weight: .semibold)).accessibilityHidden(true)
                        Text(n == 1 ? String(localized: "1 filter") : String(localized: "\(n) filters"))
                    }
                    .font(.ui(12.5, .semibold))
                    .foregroundStyle(FoleviColor.accentSoftInk)
                    .padding(.horizontal, 10)
                    .frame(height: 25)
                    .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(FoleviColor.accentSoft))
                }
                if canEdit {
                    Button { showSettings = true } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "slider.horizontal.3").font(.system(size: 11, weight: .medium)).accessibilityHidden(true)
                            Text("View")
                        }
                        .font(.ui(12))
                        .padding(.horizontal, 10)
                        .frame(height: 28)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(HoverRowStyle(radius: 6))
                    .accessibilityLabel(Text("View settings: filter, sort, group, properties"))
                    CollectionSelect(selection: "",
                                     options: [("", String(localized: "+ View")), ("table", String(localized: "Table")),
                                               ("board", String(localized: "Board")), ("gallery", String(localized: "Gallery"))],
                                     label: String(localized: "Add view"), font: .ui(12), color: FoleviColor.inkMuted, height: 28) { type in
                        guard !type.isEmpty else { return }
                        let name = type == "table" ? String(localized: "Table") : type == "board" ? String(localized: "Board") : String(localized: "Gallery")
                        editor.run("collections:addViewToCollection", ["name": .string(name), "type": .string(type)]) { result in
                            if let id = result["id"]?.stringValue { setViewId(id) }
                        }
                    }
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    static func icon(_ type: String) -> String {
        type == "board" ? "rectangle.split.3x1" : type == "gallery" ? "square.grid.2x2" : "tablecells"
    }
}

/// A view tab: accent-soft when chosen.
private struct ViewTab: View {
    var title: String
    var systemImage: String
    var selected: Bool
    var action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: systemImage).font(.system(size: 11, weight: .medium)).accessibilityHidden(true)
                Text(title).lineLimit(1)
            }
            .font(.ui(12))
            .foregroundStyle(selected ? FoleviColor.accentSoftInk : FoleviColor.inkMuted)
            .padding(.horizontal, 10)
            .frame(height: 28)
            .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(selected ? FoleviColor.accentSoft : hovering ? FoleviColor.surface : .clear))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .accessibilityAddTraits(selected ? [.isSelected] : [])
    }
}

// MARK: - Table

private struct CollectionTable: View {
    var data: CollectionPayload
    var rows: [CollectionSnapshot.Row]
    var visible: [CollectionSnapshot.Property]
    var canEdit: Bool
    var openDocument: (String, Bool) -> Void
    var actions: CollectionActions
    @State private var confirm: CollectionSnapshot.Row?
    @State private var hovered: String?
    @State private var width: CGFloat = 0

    static let nameWidth: CGFloat = 220
    static let propertyWidth: CGFloat = 160
    static let actionsWidth: CGFloat = 32

    var body: some View {
        let natural = Self.nameWidth + Self.propertyWidth * CGFloat(visible.count) + (canEdit ? Self.actionsWidth : 0)
        ScrollView(.horizontal, showsIndicators: true) {
            Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
                GridRow {
                    headerCell(String(localized: "Name"), leadingLine: false)
                        .frame(minWidth: Self.nameWidth, maxWidth: .infinity, alignment: .leading)
                    ForEach(visible) { p in
                        headerCell(p.name, leadingLine: true)
                            .frame(minWidth: Self.propertyWidth, maxWidth: .infinity, alignment: .leading)
                            .help(Text(CollectionTypes.label(p.type)))
                    }
                    if canEdit {
                        headerCell("", leadingLine: false).frame(width: Self.actionsWidth).accessibilityLabel(Text("Row actions"))
                    }
                }
                ForEach(rows) { row in
                    tableRow(row)
                }
                if rows.isEmpty {
                    GridRow {
                        Text(data.snapshot.rows.isEmpty ? "No rows yet." : "No rows match this view.")
                            .font(.ui(13)).foregroundStyle(FoleviColor.inkMuted)
                            .frame(maxWidth: .infinity)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 24)
                            .gridCellColumns(visible.count + (canEdit ? 2 : 1))
                    }
                }
            }
            .frame(width: max(width, natural), alignment: .leading)
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        .sheet(item: $confirm) { row in
            CollectionConfirm(title: String(localized: "Delete “\(row.title.isEmpty ? String(localized: "Untitled") : row.title)”?"),
                              message: String(localized: "The row’s page moves to Trash with its values. You can restore it from Trash for 30 days."),
                              confirmTitle: String(localized: "Delete row"),
                              onCancel: { confirm = nil }) {
                if await actions.editor.perform("collections:deleteRow", ["rowId": .string(row.id)]) != nil {
                    actions.editor.app.showToast(String(localized: "Row moved to Trash."))
                    confirm = nil
                }
            }
        }
    }

    private func headerCell(_ title: String, leadingLine: Bool) -> some View {
        Text(title)
            .font(.ui(12, .medium))
            .foregroundStyle(FoleviColor.inkMuted)
            .lineLimit(1)
            .padding(.horizontal, 12)
            .frame(height: 32, alignment: .leading)
            .overlay(alignment: .bottom) { FoleviColor.line.frame(height: 1) }
            .overlay(alignment: .leading) { if leadingLine { FoleviColor.line.frame(width: 1) } }
    }

    private func track(_ row: CollectionSnapshot.Row) -> (Bool) -> Void {
        { on in if on { hovered = row.id } else if hovered == row.id { hovered = nil } }
    }

    private func tableRow(_ row: CollectionSnapshot.Row) -> some View {
        let title = row.title.isEmpty ? String(localized: "Untitled") : row.title
        return GridRow {
            HStack(spacing: 6) {
                Image(systemName: "doc.text").font(.system(size: 12.5)).foregroundStyle(FoleviColor.inkMuted).accessibilityHidden(true)
                if canEdit {
                    InlineTextField(value: row.title, placeholder: String(localized: "Untitled"), font: .ui(13, .medium), maxLength: 300) {
                        actions.renameRow(row.id, $0)
                    }
                    .frame(maxWidth: .infinity)
                    .accessibilityLabel(Text("Row name"))
                    OpenPageButton(label: String(localized: "Open \(title)")) {
                        openDocument(row.documentId, NSEvent.modifierFlags.contains(.option))
                    }
                } else {
                    UnderlineOnHoverButton(title: title, font: .ui(13, .medium), color: FoleviColor.ink) {
                        openDocument(row.documentId, NSEvent.modifierFlags.contains(.option))
                    }
                    Spacer(minLength: 0)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .frame(minWidth: Self.nameWidth, maxWidth: .infinity, minHeight: 33, maxHeight: .infinity, alignment: .leading)
            .overlay(alignment: .bottom) { FoleviColor.line.frame(height: 1) }
            .onHover(perform: track(row))
            ForEach(visible) { p in
                CollectionCellEditor(data: data, row: row, prop: p, canEdit: canEdit, openDocument: openDocument) {
                    actions.setValue(row.id, p.id, $0)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .frame(minWidth: Self.propertyWidth, maxWidth: .infinity, minHeight: 33, maxHeight: .infinity, alignment: .leading)
                .overlay(alignment: .bottom) { FoleviColor.line.frame(height: 1) }
                .overlay(alignment: .leading) { FoleviColor.line.frame(width: 1) }
                .onHover(perform: track(row))
            }
            if canEdit {
                DeleteRowButton(label: String(localized: "Delete \(row.title.isEmpty ? String(localized: "row") : row.title)"), visible: hovered == row.id) {
                    confirm = row
                }
                .frame(width: Self.actionsWidth)
                .frame(maxHeight: .infinity)
                .gridCellUnsizedAxes(.vertical)
                .overlay(alignment: .bottom) { FoleviColor.line.frame(height: 1) }
                .onHover(perform: track(row))
            }
        }
    }
}

/// `grid h-6 w-6 place-items-center rounded-[6px] text-faint hover:bg-sunken hover:text-ink` with ↗.
private struct OpenPageButton: View {
    var label: String
    var action: () -> Void
    @State private var hovering = false
    var body: some View {
        Button(action: action) {
            Image(systemName: "arrow.up.right")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(hovering ? FoleviColor.ink : FoleviColor.inkFaint)
                .frame(width: 24, height: 24)
                .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(hovering ? FoleviColor.surfaceSunken : .clear))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .help(Text("Open page"))
        .accessibilityLabel(Text(label))
    }
}

/// The row's bin: shown while the row is hovered (or focused), red on hover.
private struct DeleteRowButton: View {
    var label: String
    var visible: Bool
    var action: () -> Void
    @State private var hovering = false
    @FocusState private var focused: Bool
    var body: some View {
        Button(action: action) {
            Image(systemName: "trash")
                .font(.system(size: 11.5))
                .foregroundStyle(hovering ? FoleviColor.destructive : FoleviColor.inkFaint)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .focused($focused)
        .opacity(visible || focused || hovering ? 1 : 0.001)
        .onHover { hovering = $0 }
        .help(Text(label))
        .accessibilityLabel(Text(label))
    }
}

// MARK: - Board

private struct CollectionBoard: View {
    var data: CollectionPayload
    var view: CollectionSnapshot.View
    var rows: [CollectionSnapshot.Row]
    var visible: [CollectionSnapshot.Property]
    var canEdit: Bool
    var openDocument: (String, Bool) -> Void
    var actions: CollectionActions
    /// rowId, column (nil = none), afterRowId, group property id.
    var move: (String, String?, String?, String) -> Void
    @State private var targeted: String?

    typealias Column = (id: String?, name: String, color: String)

    var body: some View {
        if let board = data.snapshot.boardColumns(for: view) {
            ScrollView(.horizontal, showsIndicators: true) {
                HStack(alignment: .top, spacing: 12) {
                    ForEach(Array(board.columns.enumerated()), id: \.offset) { _, col in
                        column(col, group: board.property, all: board.columns)
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
                .padding(12)
            }
        } else {
            Text("Choose a single-select property to group this board by (View settings).")
                .font(.ui(13)).foregroundStyle(FoleviColor.inkMuted).padding(16)
        }
    }

    private func column(_ col: Column, group: CollectionSnapshot.Property, all: [Column]) -> some View {
        let items = CollectionLogic.rows(rows, inColumn: col.id, groupBy: group.id)
        let key = col.id ?? "__none__"
        return VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                OptionPill(name: col.name, color: col.color, size: 12, weight: .semibold)
                Text("\(items.count)").font(.ui(12, .semibold)).foregroundStyle(FoleviColor.inkFaint).monospacedDigit()
            }
            .padding(.horizontal, 4)
            .padding(.bottom, 8)
            .accessibilityAddTraits(.isHeader)
            VStack(alignment: .leading, spacing: 8) {
                ForEach(items) { row in
                    BoardCard(data: data, row: row, visible: visible.filter { $0.id != group.id }, column: col.id,
                              columns: all, canEdit: canEdit, openDocument: openDocument) { to in
                        move(row.id, to, nil, group.id)
                    }
                    .modifier(DraggableRow(id: row.id, enabled: canEdit))
                }
            }
            if canEdit {
                Button { actions.addRow(col.id.map { [group.id: .string($0)] }) } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "plus").font(.system(size: 10.5, weight: .medium)).accessibilityHidden(true)
                        Text("New")
                    }
                    .font(.ui(12))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .contentShape(Rectangle())
                }
                .buttonStyle(HoverRowStyle(radius: 6, fill: FoleviColor.surfaceRaised))
                .padding(.top, 8)
            }
        }
        .padding(8)
        .frame(width: 256, alignment: .topLeading)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(FoleviColor.surfaceSunken))
        .overlay {
            if targeted == key { RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(FoleviColor.accent, lineWidth: 2) }
        }
        .dropDestination(for: String.self) { ids, _ in
            guard canEdit, let id = ids.first, rows.contains(where: { $0.id == id }) else { return false }
            move(id, col.id, items.last(where: { $0.id != id })?.id, group.id)
            return true
        } isTargeted: { on in
            if on && canEdit { targeted = key } else if targeted == key { targeted = nil }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(items.count == 1 ? String(localized: "\(col.name), 1 card") : String(localized: "\(col.name), \(items.count) cards")))
    }
}

private struct DraggableRow: ViewModifier {
    var id: String
    var enabled: Bool
    func body(content: Content) -> some View {
        if enabled { content.draggable(id) } else { content }
    }
}

private struct BoardCard: View {
    var data: CollectionPayload
    var row: CollectionSnapshot.Row
    var visible: [CollectionSnapshot.Property]
    var column: String?
    var columns: [CollectionBoard.Column]
    var canEdit: Bool
    var openDocument: (String, Bool) -> Void
    var moveTo: (String?) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            UnderlineOnHoverButton(title: row.title.isEmpty ? String(localized: "Untitled") : row.title, font: .ui(13, .medium), color: FoleviColor.ink) {
                openDocument(row.documentId, NSEvent.modifierFlags.contains(.option))
            }
            if !visible.isEmpty {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(visible) { p in
                        HStack(alignment: .firstTextBaseline, spacing: 4) {
                            Text("\(p.name):").foregroundStyle(FoleviColor.inkFaint)
                            CollectionCellDisplay(prop: p, value: row.values[p.id], people: data.snapshot.people)
                        }
                    }
                }
                .font(.ui(12))
                .foregroundStyle(FoleviColor.inkMuted)
                .padding(.top, 4)
            }
            if canEdit {
                CollectionSelect(selection: column ?? "", options: columns.map { ($0.id ?? "", $0.name) },
                                 label: String(localized: "Move \(row.title.isEmpty ? String(localized: "card") : row.title) to"),
                                 look: .plain, font: .ui(11), color: FoleviColor.inkFaint) { id in
                    moveTo(id.isEmpty ? nil : id)
                }
                .padding(.top, 6)
            }
        }
        .font(.ui(13))
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(FoleviColor.surfaceRaised))
        .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(FoleviColor.line, lineWidth: 1))
        .shadow(color: FoleviColor.line, radius: 0, y: 1)
    }
}

// MARK: - Gallery

private struct CollectionGallery: View {
    var data: CollectionPayload
    var view: CollectionSnapshot.View
    var rows: [CollectionSnapshot.Row]
    var visible: [CollectionSnapshot.Property]
    var openDocument: (String, Bool) -> Void

    var body: some View {
        // `sm:grid-cols-3 lg:grid-cols-4` (small), `sm:grid-cols-2` (large), else `sm:grid-cols-2 lg:grid-cols-3`.
        let count = view.config.cardSize == "small" ? 4 : view.config.cardSize == "large" ? 2 : 3
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12, alignment: .top), count: count), alignment: .leading, spacing: 12) {
            ForEach(rows) { row in
                GalleryCard(data: data, row: row, preview: view.config.cardPreview, visible: visible) {
                    openDocument(row.documentId, NSEvent.modifierFlags.contains(.option))
                }
            }
        }
        .padding(12)
    }
}

private struct GalleryCard: View {
    var data: CollectionPayload
    var row: CollectionSnapshot.Row
    var preview: String
    var visible: [CollectionSnapshot.Property]
    var open: () -> Void
    @State private var hovering = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Button(action: open) {
            VStack(alignment: .leading, spacing: 0) {
                if preview != "none" {
                    GalleryCover(cover: row.cover)
                        .overlay {
                            if preview == "content" {
                                Text(row.excerpt ?? "")
                                    .font(.ui(12)).foregroundStyle(FoleviColor.inkMuted)
                                    .lineLimit(4)
                                    .padding(12)
                                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                            } else {
                                Image(systemName: "doc.text").font(.system(size: 24)).foregroundStyle(FoleviColor.inkFaint).accessibilityHidden(true)
                            }
                        }
                        .frame(height: 96)
                        .clipped()
                        .overlay(alignment: .bottom) { FoleviColor.line.frame(height: 1) }
                }
                VStack(alignment: .leading, spacing: 0) {
                    Text(row.title.isEmpty ? String(localized: "Untitled") : row.title)
                        .font(.ui(16, .medium)).foregroundStyle(FoleviColor.ink)
                        .multilineTextAlignment(.leading)
                    if !visible.isEmpty {
                        VStack(alignment: .leading, spacing: 2) {
                            ForEach(visible) { p in
                                CollectionCellDisplay(prop: p, value: row.values[p.id], people: data.snapshot.people, inLink: true)
                            }
                        }
                        .font(.ui(12)).foregroundStyle(FoleviColor.inkMuted)
                        .padding(.top, 4)
                    }
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(FoleviColor.surface)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .foleviSurface(.color(FoleviColor.surface), shape: .rounded(8), shadow: hovering ? FoleviShadow.pop : FoleviShadow.card)
            .offset(y: hovering && !reduceMotion ? -1 : 0)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .animation(.easeOut(duration: FoleviMotion.fast), value: hovering)
        .accessibilityLabel(Text(row.title.isEmpty ? String(localized: "Untitled") : row.title))
    }
}

/// A gallery card's cover: the row's note style (built-in artwork or the person's own image), a colour or
/// gradient cover, or the plain surface (the web's coverBackground with the default style).
private struct GalleryCover: View {
    var cover: DocumentCover?
    private static let style = DocumentStyle(font: .sans, width: .default, background: .paper, accent: .plum, card: .folio)

    var body: some View {
        let accent = cover?.value.flatMap(DocumentAccent.init(rawValue:)) ?? Self.style.accent
        switch cover?.kind {
        case .image?:
            if let id = cover?.value { CoverFileImage(fileId: id) } else { FoleviColor.surface }
        case .art?:
            if let image = CoverArt.thumbnail(cover?.value) { ArtCoverImage(image: image) } else { CoverView(cover: DocumentCover(kind: .gradient), style: Self.style) }
        case .color?:
            Color.folevi(accentSoft: accent)
        case .gradient?:
            CoverView(cover: cover, style: Self.style)
        default:
            FoleviColor.surface
        }
    }
}

/// The person's own note style image, from the file cache (a quiet placeholder until it's here).
private struct CoverFileImage: View {
    var fileId: String
    @Environment(AppModel.self) private var app
    @State private var image: NSImage?

    private var key: String { "collection-cover-\(fileId)" }

    var body: some View {
        ZStack {
            FoleviColor.surfaceSunken
            if let image {
                Image(nsImage: image).resizable().aspectRatio(contentMode: .fill)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .clipped()
                    .accessibilityHidden(true)
            }
        }
        .task(id: fileId) {
            if let cached = AttachmentLoader.shared.image(forKey: key) { image = cached; return }
            guard let session = app.session, let url = try? await session.files.localFile(fileId: fileId) else { return }
            let bytes = await Task.detached { try? Data(contentsOf: url) }.value
            guard let bytes, let loaded = NSImage(data: bytes) else { return }
            AttachmentLoader.shared.store(loaded, forKey: key)
            image = loaded
        }
    }
}

// MARK: - Cells

/// The read-only form of a value. `inLink` shows a URL as text (gallery cards are links themselves).
struct CollectionCellDisplay: View {
    var prop: CollectionSnapshot.Property
    var value: JSONValue?
    var people: [CollectionSnapshot.Person]
    var inLink = false

    /// `formatCalendarDate` (dateStyle medium) for ISO dates; anything else as stored.
    static func formatDate(_ value: String) -> String {
        guard value.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil, let d = TaskLogic.parseLocalDate(value) else { return value }
        return d.formatted(date: .abbreviated, time: .omitted)
    }

    var body: some View {
        if CollectionLogic.isEmpty(value) {
            Text("-").foregroundStyle(FoleviColor.inkFaint)
        } else {
            switch prop.type {
            case "checkbox":
                Text(value?.boolValue == true ? "✓" : "")
            case "select":
                if let o = prop.options.first(where: { $0.id == value?.stringValue }) { OptionPill(name: o.name, color: o.color) }
            case "multiSelect":
                FlowLayout(spacing: 4) {
                    ForEach(value?.arrayValue?.compactMap(\.stringValue) ?? [], id: \.self) { id in
                        if let o = prop.options.first(where: { $0.id == id }) { OptionPill(name: o.name, color: o.color) }
                    }
                }
            case "person":
                Text(people.first { $0.id == value?.stringValue }?.name ?? String(localized: "Former member"))
            case "relation":
                let ids = value?.arrayValue?.compactMap(\.stringValue) ?? []
                RelationTitles(ids: ids) { titles in
                    Text(ids.map { titles[$0].flatMap { $0.isEmpty ? nil : $0 } ?? String(localized: "Untitled") }.joined(separator: ", "))
                }
            case "date":
                Text(value?.stringValue.map(Self.formatDate) ?? "")
            case "url":
                let raw = value?.stringValue ?? ""
                let shown = raw.replacingOccurrences(of: "^https?://", with: "", options: .regularExpression)
                if !inLink, let url = URL(string: raw), ["http", "https", "mailto"].contains(url.scheme?.lowercased() ?? "") {
                    Link(destination: url) { Text(shown).underline().foregroundStyle(FoleviColor.accent) }
                        .buttonStyle(.plain)
                } else if inLink {
                    Text(shown).foregroundStyle(FoleviColor.accent)
                } else {
                    Text(shown).underline().foregroundStyle(FoleviColor.accent)
                }
            case "number":
                Text(value?.doubleValue.map(JSONValue.formatNumber) ?? value?.canonicalString ?? "")
            default:
                Text(value?.stringValue ?? value?.canonicalString ?? "")
            }
        }
    }
}

/// An editable value (the web's PropertyEditor), in custom controls.
private struct CollectionCellEditor: View {
    var data: CollectionPayload
    var row: CollectionSnapshot.Row
    var prop: CollectionSnapshot.Property
    var canEdit: Bool
    var openDocument: (String, Bool) -> Void
    var save: (JSONValue?) -> Void
    @State private var showDate = false

    private var value: JSONValue? { row.values[prop.id] }
    private var label: String { String(localized: "\(prop.name) for \(row.title.isEmpty ? String(localized: "Untitled") : row.title)") }

    var body: some View {
        if !canEdit {
            CollectionCellDisplay(prop: prop, value: value, people: data.snapshot.people).font(.ui(13))
        } else {
            switch prop.type {
            case "checkbox":
                CollectionCheckbox(checked: value?.boolValue == true, label: label) { save(.bool(!(value?.boolValue == true))) }
            case "number":
                InlineTextField(value: value?.doubleValue.map(JSONValue.formatNumber) ?? "", placeholder: "", font: .ui(13), maxLength: 40, chrome: .none) { text in
                    if text.isEmpty {
                        if value?.doubleValue != nil { save(nil) }
                    } else if let n = Double(text), n.isFinite, n != value?.doubleValue {
                        save(.number(n))
                    }
                }
                .accessibilityLabel(Text(label))
            case "date":
                Button { showDate = true } label: {
                    CollectionCellDisplay(prop: prop, value: value, people: data.snapshot.people)
                        .font(.ui(13)).foregroundStyle(FoleviColor.ink)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(label))
                .foleviPopover(isPresented: $showDate, arrowEdge: .bottom) {
                    VStack(alignment: .leading, spacing: 8) {
                        MonthPicker(selection: Binding(get: { value?.stringValue ?? TaskLogic.localDate() }, set: { d in
                            showDate = false
                            save(.string(d))
                        }), today: TaskLogic.localDate())
                        Button("Clear") { showDate = false; save(nil) }.buttonStyle(.folevi(.quiet, .small))
                    }
                    .padding(10)
                    .frame(width: 250)
                }
            case "select":
                CollectionSelect(selection: value?.stringValue ?? "",
                                 options: [("", String(localized: "None"))] + prop.options.map { ($0.id, $0.name) },
                                 label: label, look: .plain, fill: true) { id in save(id.isEmpty ? nil : .string(id)) }
            case "multiSelect":
                let selected = value?.arrayValue?.compactMap(\.stringValue) ?? []
                FlowLayout(spacing: 4) {
                    ForEach(prop.options) { o in
                        let on = selected.contains(o.id)
                        Button {
                            save(.array((on ? selected.filter { $0 != o.id } : selected + [o.id]).map(JSONValue.string)))
                        } label: { OptionPill(name: o.name, color: o.color).opacity(on ? 1 : 0.4) }
                            .buttonStyle(.plain)
                            .accessibilityAddTraits(on ? [.isSelected] : [])
                    }
                    if prop.options.isEmpty { Text("No options yet (View settings)").font(.ui(12)).foregroundStyle(FoleviColor.inkFaint) }
                }
                .accessibilityElement(children: .contain)
                .accessibilityLabel(Text(label))
            case "person":
                CollectionSelect(selection: value?.stringValue ?? "",
                                 options: [("", String(localized: "None"))] + data.snapshot.people.map { ($0.id, $0.name) },
                                 label: label, look: .plain, fill: true) { id in save(id.isEmpty ? nil : .string(id)) }
            case "relation":
                RelationEditor(label: label, scope: data.linkScope, value: value?.arrayValue?.compactMap(\.stringValue) ?? [],
                               openDocument: openDocument) { ids in save(.array(ids.map(JSONValue.string))) }
            default:
                InlineTextField(value: value?.stringValue ?? "", placeholder: prop.type == "url" ? "https://" : "", font: .ui(13), maxLength: 2000, chrome: .none) { text in
                    save(text.isEmpty ? nil : .string(text))
                }
                .accessibilityLabel(Text(label))
            }
        }
    }
}

// MARK: - Small pieces

/// A select option as a soft coloured pill (the web's optionColor; `rounded-[6px] px-2 py-0.5 text-[11px]`).
struct OptionPill: View {
    var name: String
    var color: String
    var size: CGFloat = 11
    var weight: Font.Weight = .regular

    var body: some View {
        let c = Self.colors(color)
        Text(name)
            .font(.ui(size, weight))
            .foregroundStyle(c.ink)
            .lineLimit(1)
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(c.fill))
    }

    static func colors(_ color: String) -> (fill: Color, ink: Color) {
        switch color {
        case "accent": return (FoleviColor.accentSoft, FoleviColor.accentSoftInk)
        case "moss": return (FoleviColor.mossSoft, FoleviColor.mossInk)
        case "marigold": return (FoleviColor.marigoldSoft, FoleviColor.marigoldInk)
        case "plum": return (FoleviColor.plumSoft, FoleviColor.plumInk)
        case "coral": return (FoleviColor.coralSoft, FoleviColor.coralInk)
        default: return (FoleviColor.surfaceSunken, FoleviColor.ink)
        }
    }
}
