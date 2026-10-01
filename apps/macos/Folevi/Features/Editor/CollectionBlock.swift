import AppKit
import SwiftUI

/// A collection embedded in a page, as on the web (CollectionEmbed.tsx): typed properties with table,
/// board (kanban) and gallery views. Live from the server (`collections:get`); edits go straight to its
/// mutations: rename, add / rename / delete rows, set values, move cards between columns, add views and
/// change what a view shows.
struct CollectionBlockView: View {
    let props: CollectionProps
    var isEditable: Bool
    var openDocument: (String, Bool) -> Void
    @Environment(AppModel.self) private var app
    @State private var data: CollectionSnapshot?
    @State private var failed = false
    @State private var viewId: String?
    @State private var showSettings = false
    @State private var showAddView = false

    private var storedViewKey: String { "folevi:collection-view:\(props.collectionId)" }

    var body: some View {
        Group {
            if let data, let view = data.view(preferred: viewId, fallback: props.viewId) {
                content(data, view)
            } else if failed {
                Text(app.sync.isOnline ? "This collection is unavailable." : "Connect to the internet to load this collection.")
                    .font(.ui(13)).foregroundStyle(FoleviColor.inkMuted)
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(FoleviColor.line, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
            } else {
                RoundedRectangle(cornerRadius: 8, style: .continuous).fill(FoleviColor.surfaceSunken).frame(height: 160)
                    .overlay { ProgressView().controlSize(.small) }
            }
        }
        .task(id: props.collectionId) { await subscribe() }
        .onAppear { viewId = UserDefaults.standard.string(forKey: storedViewKey) }
    }

    // MARK: Data

    private func subscribe() async {
        guard let session = app.session else { failed = true; return }
        let stream: AsyncThrowingStream<CollectionSnapshot, Error> = session.convex.subscribe("collections:get", ["collectionId": .string(props.collectionId)])
        do {
            for try await snapshot in stream {
                data = snapshot
                failed = false
            }
        } catch {
            if data == nil { failed = true }
        }
    }

    private var canEdit: Bool { isEditable && (data?.canEdit ?? false) }

    /// Runs a mutation, showing its error as a toast.
    private func run(_ name: String, _ args: [String: JSONValue], then: (@MainActor (JSONValue) -> Void)? = nil) {
        guard let session = app.session else { return }
        var full = args
        full["collectionId"] = .string(props.collectionId)
        let toast = app
        Task { @MainActor in
            do {
                let result: JSONValue = try await session.convex.mutation(name, full)
                then?(result)
            } catch {
                toast.showToast(ConvexService.mapError(error).localizedDescription)
            }
        }
    }

    private func setViewId(_ id: String) {
        viewId = id
        UserDefaults.standard.set(id, forKey: storedViewKey)
    }

    // MARK: Card

    private func content(_ data: CollectionSnapshot, _ view: CollectionSnapshot.View) -> some View {
        let rows = CollectionLogic.apply(data.rows, view.config, data.properties)
        let visible = data.properties.filter { view.config.visibleProperties.contains($0.id) }
        return VStack(alignment: .leading, spacing: 0) {
            header(data, view)
            FoleviColor.line.frame(height: 1)
            switch view.type {
            case "board":
                CollectionBoard(data: data, view: view, rows: rows, visible: visible, canEdit: canEdit, openDocument: openDocument,
                                move: { rowId, column, after, groupId in
                                    optimisticMove(rowId, to: column, groupId: groupId)
                                    var args: [String: JSONValue] = ["rowId": .string(rowId), "afterRowId": after.map(JSONValue.string) ?? .null,
                                                                     "groupPropertyId": .string(groupId)]
                                    args["groupValue"] = column.map(JSONValue.string) ?? .null
                                    run("collections:moveRow", args)
                                },
                                add: { values in addRow(values) })
            case "gallery":
                CollectionGallery(data: data, view: view, rows: rows, visible: visible, openDocument: openDocument)
            default:
                CollectionTable(data: data, rows: rows, visible: visible, canEdit: canEdit, openDocument: openDocument,
                                setValue: { row, prop, value in setValue(row, prop, value) },
                                rename: { row, title in
                                    optimistic { d in if let i = d.rows.firstIndex(where: { $0.id == row }) { d.rows[i].title = title } }
                                    run("collections:renameRow", ["rowId": .string(row), "title": .string(title)])
                                },
                                delete: { row in
                                    optimistic { d in d.rows.removeAll { $0.id == row } }
                                    run("collections:deleteRow", ["rowId": .string(row)]) { _ in app.showToast(String(localized: "Row moved to Trash.")) }
                                })
            }
            if canEdit && view.type != "board" {
                FoleviColor.line.frame(height: 1)
                Button { addRow(nil) } label: {
                    Label("New row", systemImage: "plus")
                        .font(.ui(12))
                        .foregroundStyle(FoleviColor.inkMuted)
                        .padding(.horizontal, 12)
                        .frame(maxWidth: .infinity, minHeight: 32, alignment: .leading)
                        .contentShape(Rectangle())
                }
                .buttonStyle(HoverRowStyle())
            }
        }
        .foleviSurface(.color(FoleviColor.surfaceRaised), shape: .rounded(8), shadow: FoleviShadow.card)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Collection \(data.name)"))
    }

    private func header(_ data: CollectionSnapshot, _ view: CollectionSnapshot.View) -> some View {
        HStack(spacing: 4) {
            if canEdit {
                InlineTextField(value: data.name, placeholder: String(localized: "Collection"), font: .ui(14, .semibold), maxLength: 80) { name in
                    let next = name.isEmpty ? String(localized: "Collection") : name
                    optimistic { $0.name = next }
                    run("collections:rename", ["name": .string(next)])
                }
                .frame(width: 176)
                .accessibilityLabel(Text("Collection name"))
            } else {
                Text(data.name).font(.ui(14, .semibold)).foregroundStyle(FoleviColor.heading).padding(.trailing, 8)
            }
            ForEach(data.views) { v in
                let on = v.id == view.id
                Button { setViewId(v.id) } label: {
                    Label(v.name, systemImage: Self.icon(v.type))
                        .font(.ui(12, on ? .semibold : .regular))
                        .foregroundStyle(on ? FoleviColor.accentSoftInk : FoleviColor.inkMuted)
                        .padding(.horizontal, 10)
                        .frame(height: 28)
                        .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(on ? FoleviColor.accentSoft : .clear))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
            Spacer(minLength: 8)
            if !view.config.filters.isEmpty {
                Chip(text: view.config.filters.count == 1 ? String(localized: "1 filter") : String(localized: "\(view.config.filters.count) filters"),
                     systemImage: "line.3.horizontal.decrease", tint: FoleviColor.accentSoftInk, fill: FoleviColor.accentSoft)
            }
            if canEdit {
                Button { showSettings = true } label: {
                    Label("View", systemImage: "slider.horizontal.3").font(.ui(12)).foregroundStyle(FoleviColor.inkMuted)
                        .padding(.horizontal, 10).frame(height: 28).contentShape(Rectangle())
                }
                .buttonStyle(HoverRowStyle(radius: 6))
                .accessibilityLabel(Text("View settings: filter, sort, group, properties"))
                .foleviPopover(isPresented: $showSettings, arrowEdge: .bottom) {
                    CollectionViewSettings(data: data, view: view) { config, name in
                        optimistic { d in if let i = d.views.firstIndex(where: { $0.id == view.id }) { d.views[i].config = config; if let name { d.views[i].name = name } } }
                        var args: [String: JSONValue] = ["viewId": .string(view.id), "config": config.json]
                        if let name { args["name"] = .string(name) }
                        run("collections:updateView", args)
                    }
                }
                Button { showAddView = true } label: {
                    Text("+ View").font(.ui(12)).foregroundStyle(FoleviColor.inkMuted)
                        .padding(.horizontal, 10).frame(height: 28)
                        .foleviSurface(.color(FoleviColor.surface), shape: .rounded(6), shadow: FoleviShadow.control)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Add view"))
                .foleviPopover(isPresented: $showAddView, arrowEdge: .bottom) {
                    VStack(alignment: .leading, spacing: 2) {
                        ForEach([("table", "Table"), ("board", "Board"), ("gallery", "Gallery")], id: \.0) { type, name in
                            Button {
                                showAddView = false
                                run("collections:addViewToCollection", ["name": .string(name), "type": .string(type)]) { result in
                                    if let id = result["id"]?.stringValue { setViewId(id) }
                                }
                            } label: {
                                Label(LocalizedStringKey(name), systemImage: Self.icon(type))
                                    .font(.ui(13))
                                    .foregroundStyle(FoleviColor.ink)
                                    .padding(.horizontal, 10)
                                    .frame(width: 150, height: 30, alignment: .leading)
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(HoverRowStyle(radius: 6))
                        }
                    }
                    .padding(6)
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    static func icon(_ type: String) -> String {
        type == "board" ? "rectangle.split.3x1" : type == "gallery" ? "square.grid.2x2" : "tablecells"
    }

    // MARK: Edits

    private func optimistic(_ change: (inout CollectionSnapshot) -> Void) {
        guard var d = data else { return }
        change(&d)
        data = d
    }

    private func optimisticMove(_ rowId: String, to column: String?, groupId: String) {
        optimistic { d in
            guard let i = d.rows.firstIndex(where: { $0.id == rowId }) else { return }
            if let column { d.rows[i].values[groupId] = .string(column) } else { d.rows[i].values[groupId] = nil }
            let row = d.rows.remove(at: i)
            d.rows.append(row)
        }
    }

    private func setValue(_ rowId: String, _ prop: String, _ value: JSONValue?) {
        optimistic { d in
            guard let i = d.rows.firstIndex(where: { $0.id == rowId }) else { return }
            if CollectionLogic.isEmpty(value) { d.rows[i].values[prop] = nil } else { d.rows[i].values[prop] = value }
        }
        run("collections:setValue", ["rowId": .string(rowId), "propertyId": .string(prop), "value": value ?? .null])
    }

    private func addRow(_ values: [String: JSONValue]?) {
        var args: [String: JSONValue] = ["title": .string("")]
        if let values { args["values"] = .object(values) }
        run("collections:addRow", args)
    }
}

// MARK: - Table

private struct CollectionTable: View {
    var data: CollectionSnapshot
    var rows: [CollectionSnapshot.Row]
    var visible: [CollectionSnapshot.Property]
    var canEdit: Bool
    var openDocument: (String, Bool) -> Void
    var setValue: (String, String, JSONValue?) -> Void
    var rename: (String, String) -> Void
    var delete: (String) -> Void
    @State private var confirm: CollectionSnapshot.Row?

    static let typeLabels = ["text": "Text", "number": "Number", "checkbox": "Checkbox", "date": "Date", "select": "Single select",
                             "multiSelect": "Multi-select", "url": "URL", "person": "Person", "relation": "Relation"]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: true) {
            Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
                GridRow {
                    headerCell("Name", width: 220)
                    ForEach(visible) { p in headerCell(p.name, width: 160).help(Text(Self.typeLabels[p.type] ?? p.type)) }
                    if canEdit { headerCell("", width: 32) }
                }
                ForEach(rows) { row in
                    TableRowView(data: data, row: row, visible: visible, canEdit: canEdit, openDocument: openDocument,
                                 setValue: setValue, rename: rename) { confirm = row }
                }
                if rows.isEmpty {
                    GridRow {
                        Text(data.rows.isEmpty ? "No rows yet." : "No rows match this view.")
                            .font(.ui(13)).foregroundStyle(FoleviColor.inkMuted)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 22)
                            .gridCellColumns(visible.count + (canEdit ? 2 : 1))
                    }
                }
            }
        }
        .alert(Text("Delete “\(confirm?.title.isEmpty == false ? confirm!.title : String(localized: "Untitled"))”?"), isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } })) {
            Button("Cancel", role: .cancel) { confirm = nil }
            Button("Delete row", role: .destructive) {
                if let row = confirm { delete(row.id) }
                confirm = nil
            }
        } message: {
            Text("The row’s page moves to Trash with its values. You can restore it from Trash for 30 days.")
        }
    }

    private func headerCell(_ title: String, width: CGFloat) -> some View {
        Text(title)
            .font(.ui(12, .medium))
            .foregroundStyle(FoleviColor.inkMuted)
            .lineLimit(1)
            .padding(.horizontal, 12)
            .frame(width: width, height: 32, alignment: .leading)
            .overlay(alignment: .bottom) { FoleviColor.line.frame(height: 1) }
            .overlay(alignment: .leading) { if title != "Name" && !title.isEmpty { FoleviColor.line.frame(width: 1) } }
    }
}

private struct TableRowView: View {
    var data: CollectionSnapshot
    var row: CollectionSnapshot.Row
    var visible: [CollectionSnapshot.Property]
    var canEdit: Bool
    var openDocument: (String, Bool) -> Void
    var setValue: (String, String, JSONValue?) -> Void
    var rename: (String, String) -> Void
    var onDelete: () -> Void
    @State private var hovering = false

    var body: some View {
        GridRow {
            HStack(spacing: 6) {
                Image(systemName: "doc.text").font(.system(size: 12)).foregroundStyle(FoleviColor.inkMuted).accessibilityHidden(true)
                if canEdit {
                    InlineTextField(value: row.title, placeholder: String(localized: "Untitled"), font: .ui(13, .medium), maxLength: 300) { rename(row.id, $0) }
                        .accessibilityLabel(Text("Row name"))
                    IconButton(systemImage: "arrow.up.right", label: "Open page", size: 22) {
                        openDocument(row.documentId, NSEvent.modifierFlags.contains(.option))
                    }
                } else {
                    Button { openDocument(row.documentId, NSEvent.modifierFlags.contains(.option)) } label: {
                        Text(row.title.isEmpty ? String(localized: "Untitled") : row.title).font(.ui(13, .medium)).foregroundStyle(FoleviColor.ink)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 12)
            .frame(width: 220, height: 34, alignment: .leading)
            .overlay(alignment: .bottom) { FoleviColor.line.frame(height: 1) }
            ForEach(visible) { p in
                CollectionCellEditor(data: data, row: row, prop: p, canEdit: canEdit) { setValue(row.id, p.id, $0) }
                    .padding(.horizontal, 12)
                    .frame(width: 160, height: 34, alignment: .leading)
                    .overlay(alignment: .bottom) { FoleviColor.line.frame(height: 1) }
                    .overlay(alignment: .leading) { FoleviColor.line.frame(width: 1) }
            }
            if canEdit {
                Button(action: onDelete) {
                    Image(systemName: "trash").font(.system(size: 12)).foregroundStyle(FoleviColor.inkFaint)
                        .frame(width: 32, height: 34).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .opacity(hovering ? 1 : 0.001)
                .help(Text("Delete \(row.title.isEmpty ? String(localized: "row") : row.title)"))
                .accessibilityLabel(Text("Delete \(row.title.isEmpty ? String(localized: "row") : row.title)"))
                .overlay(alignment: .bottom) { FoleviColor.line.frame(height: 1) }
            }
        }
        .onHover { hovering = $0 }
    }
}

// MARK: - Board

private struct CollectionBoard: View {
    var data: CollectionSnapshot
    var view: CollectionSnapshot.View
    var rows: [CollectionSnapshot.Row]
    var visible: [CollectionSnapshot.Property]
    var canEdit: Bool
    var openDocument: (String, Bool) -> Void
    /// rowId, column (nil = none), afterRowId, group property id.
    var move: (String, String?, String?, String) -> Void
    var add: ([String: JSONValue]?) -> Void
    @State private var targeted: String?

    var body: some View {
        if let board = data.boardColumns(for: view) {
            ScrollView(.horizontal, showsIndicators: true) {
                HStack(alignment: .top, spacing: 12) {
                    ForEach(Array(board.columns.enumerated()), id: \.offset) { _, col in
                        column(col, group: board.property, all: board.columns)
                    }
                }
                .padding(12)
            }
        } else {
            Text("Choose a single-select property to group this board by (View settings).")
                .font(.ui(13)).foregroundStyle(FoleviColor.inkMuted).padding(16)
        }
    }

    private func column(_ col: (id: String?, name: String, color: String), group: CollectionSnapshot.Property,
                        all: [(id: String?, name: String, color: String)]) -> some View {
        let items = CollectionLogic.rows(rows, inColumn: col.id, groupBy: group.id)
        let key = col.id ?? "__none__"
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                OptionPill(name: col.name, color: col.color)
                Text("\(items.count)").font(.ui(12, .semibold)).foregroundStyle(FoleviColor.inkFaint).monospacedDigit()
            }
            .padding(.horizontal, 4)
            ForEach(items) { row in
                BoardCard(data: data, row: row, group: group, visible: visible.filter { $0.id != group.id }, column: col.id,
                          columns: all, canEdit: canEdit, openDocument: openDocument) { to in
                    move(row.id, to, nil, group.id)
                }
                .draggable(row.id)
            }
            if canEdit {
                Button { add(col.id.map { [group.id: .string($0)] }) } label: {
                    Label("New", systemImage: "plus").font(.ui(12)).foregroundStyle(FoleviColor.inkMuted)
                        .padding(.horizontal, 8).frame(height: 26).contentShape(Rectangle())
                }
                .buttonStyle(HoverRowStyle(radius: 6))
            }
        }
        .padding(8)
        .frame(width: 256, alignment: .topLeading)
        .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(FoleviColor.surfaceSunken))
        .overlay {
            if targeted == key { RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(FoleviColor.accent, lineWidth: 2) }
        }
        .dropDestination(for: String.self) { ids, _ in
            guard canEdit, let id = ids.first, rows.contains(where: { $0.id == id }) else { return false }
            move(id, col.id, items.last(where: { $0.id != id })?.id, group.id)
            return true
        } isTargeted: { on in
            if on { targeted = key } else if targeted == key { targeted = nil }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("\(col.name), \(items.count) cards"))
    }
}

private struct BoardCard: View {
    var data: CollectionSnapshot
    var row: CollectionSnapshot.Row
    var group: CollectionSnapshot.Property
    var visible: [CollectionSnapshot.Property]
    var column: String?
    var columns: [(id: String?, name: String, color: String)]
    var canEdit: Bool
    var openDocument: (String, Bool) -> Void
    var moveTo: (String?) -> Void
    @State private var showMove = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Button { openDocument(row.documentId, NSEvent.modifierFlags.contains(.option)) } label: {
                Text(row.title.isEmpty ? String(localized: "Untitled") : row.title)
                    .font(.ui(13, .medium)).foregroundStyle(FoleviColor.ink).multilineTextAlignment(.leading)
            }
            .buttonStyle(.plain)
            ForEach(visible) { p in
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text("\(p.name):").foregroundStyle(FoleviColor.inkFaint)
                    CollectionCellDisplay(prop: p, value: row.values[p.id], people: data.people)
                }
                .font(.ui(12))
                .foregroundStyle(FoleviColor.inkMuted)
            }
            if canEdit {
                Button { showMove = true } label: {
                    HStack(spacing: 3) {
                        Text(columns.first { $0.id == column }?.name ?? "")
                        Image(systemName: "chevron.down").font(.system(size: 8, weight: .semibold))
                    }
                    .font(.ui(11)).foregroundStyle(FoleviColor.inkFaint).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .padding(.top, 2)
                .accessibilityLabel(Text("Move \(row.title.isEmpty ? String(localized: "card") : row.title) to"))
                .foleviPopover(isPresented: $showMove, arrowEdge: .bottom) {
                    OptionList(options: columns.map { ($0.id, $0.name, $0.color) }, selected: column) { id in
                        showMove = false
                        if id != column { moveTo(id) }
                    }
                }
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(FoleviColor.surfaceRaised))
        .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(FoleviColor.line, lineWidth: 1))
    }
}

// MARK: - Gallery

private struct CollectionGallery: View {
    var data: CollectionSnapshot
    var view: CollectionSnapshot.View
    var rows: [CollectionSnapshot.Row]
    var visible: [CollectionSnapshot.Property]
    var openDocument: (String, Bool) -> Void

    var body: some View {
        let minWidth: CGFloat = view.config.cardSize == "small" ? 150 : view.config.cardSize == "large" ? 300 : 200
        LazyVGrid(columns: [GridItem(.adaptive(minimum: minWidth), spacing: 12)], alignment: .leading, spacing: 12) {
            ForEach(rows) { row in
                GalleryCard(data: data, row: row, preview: view.config.cardPreview, visible: visible) {
                    openDocument(row.documentId, NSEvent.modifierFlags.contains(.option))
                }
            }
        }
        .padding(12)
        if rows.isEmpty {
            Text(data.rows.isEmpty ? "No rows yet." : "No rows match this view.")
                .font(.ui(13)).foregroundStyle(FoleviColor.inkMuted)
                .frame(maxWidth: .infinity).padding(.bottom, 16)
        }
    }
}

private struct GalleryCard: View {
    var data: CollectionSnapshot
    var row: CollectionSnapshot.Row
    var preview: String
    var visible: [CollectionSnapshot.Property]
    var open: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: open) {
            VStack(alignment: .leading, spacing: 0) {
                if preview != "none" {
                    ZStack {
                        GalleryCover(cover: row.cover)
                        if preview == "content" {
                            Text(row.excerpt ?? "")
                                .font(.ui(12)).foregroundStyle(FoleviColor.inkMuted)
                                .lineLimit(4)
                                .padding(12)
                                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                        } else if row.cover == nil || row.cover?.kind == CoverKind.none {
                            Image(systemName: "doc.text").font(.system(size: 26)).foregroundStyle(FoleviColor.inkFaint)
                        }
                    }
                    .frame(height: 96)
                    .clipped()
                    .overlay(alignment: .bottom) { FoleviColor.line.frame(height: 1) }
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text(row.title.isEmpty ? String(localized: "Untitled") : row.title)
                        .font(.ui(13.5, .medium)).foregroundStyle(FoleviColor.ink).lineLimit(2)
                    ForEach(visible) { p in
                        CollectionCellDisplay(prop: p, value: row.values[p.id], people: data.people)
                            .font(.ui(12)).foregroundStyle(FoleviColor.inkMuted)
                    }
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .foleviSurface(.color(FoleviColor.surface), shape: .rounded(8), shadow: hovering ? FoleviShadow.pop : FoleviShadow.card)
            .offset(y: hovering ? -1 : 0)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .animation(.easeOut(duration: FoleviMotion.fast), value: hovering)
        .accessibilityLabel(Text(row.title.isEmpty ? String(localized: "Untitled") : row.title))
    }
}

/// A gallery card's cover: the row's note style artwork, a soft accent glow, or the plain surface.
private struct GalleryCover: View {
    var cover: DocumentCover?
    var body: some View {
        if cover?.kind == .art, let image = CoverArt.thumbnail(cover?.value) {
            ArtCoverImage(image: image)
        } else if cover?.kind == .color || cover?.kind == .gradient {
            CoverView(cover: cover, style: DocumentStyle(font: .sans, width: .default, background: .paper, accent: .plum, card: .folio))
        } else {
            FoleviColor.surface
        }
    }
}

// MARK: - Cells

/// The read-only form of a value.
struct CollectionCellDisplay: View {
    var prop: CollectionSnapshot.Property
    var value: JSONValue?
    var people: [CollectionSnapshot.Person]

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
                HStack(spacing: 4) {
                    ForEach(value?.arrayValue?.compactMap(\.stringValue) ?? [], id: \.self) { id in
                        if let o = prop.options.first(where: { $0.id == id }) { OptionPill(name: o.name, color: o.color) }
                    }
                }
            case "person":
                Text(people.first { $0.id == value?.stringValue }?.name ?? String(localized: "Former member"))
            case "date":
                Text(value?.stringValue.flatMap(TaskLogic.parseLocalDate)?.formatted(.dateTime.month(.abbreviated).day().year()) ?? value?.stringValue ?? "")
            case "url":
                Text((value?.stringValue ?? "").replacingOccurrences(of: "^https?://", with: "", options: .regularExpression))
                    .foregroundStyle(FoleviColor.accent)
            case "relation":
                let n = value?.arrayValue?.count ?? 0
                Text(n == 1 ? String(localized: "1 linked page") : String(localized: "\(n) linked pages"))
            case "number":
                Text(value?.doubleValue.map(JSONValue.formatNumber) ?? "")
            default:
                Text(value?.stringValue ?? "")
            }
        }
    }
}

/// An editable value in the table (custom controls, no system pop-ups).
private struct CollectionCellEditor: View {
    var data: CollectionSnapshot
    var row: CollectionSnapshot.Row
    var prop: CollectionSnapshot.Property
    var canEdit: Bool
    var save: (JSONValue?) -> Void
    @State private var showPicker = false

    private var value: JSONValue? { row.values[prop.id] }

    var body: some View {
        if !canEdit {
            CollectionCellDisplay(prop: prop, value: value, people: data.people).font(.ui(13))
        } else {
            switch prop.type {
            case "checkbox":
                TodoCheck(checked: value?.boolValue == true, scale: 0.9) { save(.bool(!(value?.boolValue == true))) }
                    .accessibilityLabel(Text("\(prop.name) for \(rowName)"))
            case "number":
                InlineTextField(value: value?.doubleValue.map(JSONValue.formatNumber) ?? "", placeholder: "", font: .ui(13), maxLength: 40) { text in
                    let trimmed = text.trimmingCharacters(in: .whitespaces)
                    save(trimmed.isEmpty ? nil : Double(trimmed).map(JSONValue.number))
                }
                .accessibilityLabel(Text("\(prop.name) for \(rowName)"))
            case "date":
                pickerButton { CollectionCellDisplay(prop: prop, value: value, people: data.people) } popover: {
                    VStack(alignment: .leading, spacing: 8) {
                        MonthPicker(selection: Binding(get: { value?.stringValue ?? TaskLogic.localDate() }, set: { d in
                            showPicker = false
                            save(.string(d))
                        }), today: TaskLogic.localDate())
                        Button("Clear") { showPicker = false; save(nil) }.buttonStyle(.folevi(.quiet, .small))
                    }
                    .padding(10)
                    .frame(width: 250)
                }
            case "select":
                pickerButton { CollectionCellDisplay(prop: prop, value: value, people: data.people) } popover: {
                    OptionList(options: [(nil, String(localized: "None"), "muted")] + prop.options.map { ($0.id, $0.name, $0.color) }, selected: value?.stringValue) { id in
                        showPicker = false
                        save(id.map(JSONValue.string))
                    }
                }
            case "multiSelect":
                let selected = value?.arrayValue?.compactMap(\.stringValue) ?? []
                HStack(spacing: 4) {
                    ForEach(prop.options) { o in
                        let on = selected.contains(o.id)
                        Button {
                            let next = on ? selected.filter { $0 != o.id } : selected + [o.id]
                            save(.array(next.map(JSONValue.string)))
                        } label: { OptionPill(name: o.name, color: o.color).opacity(on ? 1 : 0.4) }
                            .buttonStyle(.plain)
                            .accessibilityAddTraits(on ? .isSelected : [])
                    }
                    if prop.options.isEmpty { Text("No options yet (View settings)").font(.ui(11.5)).foregroundStyle(FoleviColor.inkFaint) }
                }
            case "person":
                pickerButton { CollectionCellDisplay(prop: prop, value: value, people: data.people) } popover: {
                    OptionList(options: [(nil, String(localized: "None"), "")] + data.people.map { ($0.id, $0.name, "") }, selected: value?.stringValue) { id in
                        showPicker = false
                        save(id.map(JSONValue.string))
                    }
                }
            case "relation":
                CollectionCellDisplay(prop: prop, value: value, people: data.people).font(.ui(13))
            default:
                InlineTextField(value: value?.stringValue ?? "", placeholder: prop.type == "url" ? "https://" : "", font: .ui(13), maxLength: 2000) { text in
                    let trimmed = text.trimmingCharacters(in: .whitespaces)
                    save(trimmed.isEmpty ? nil : .string(trimmed))
                }
                .accessibilityLabel(Text("\(prop.name) for \(rowName)"))
            }
        }
    }

    private var rowName: String { row.title.isEmpty ? String(localized: "Untitled") : row.title }

    private func pickerButton<Label: View, Pop: View>(@ViewBuilder label: () -> Label, @ViewBuilder popover: @escaping () -> Pop) -> some View {
        Button { showPicker = true } label: {
            label().font(.ui(13)).frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("\(prop.name) for \(rowName)"))
        .foleviPopover(isPresented: $showPicker, arrowEdge: .bottom) { popover() }
    }
}

// MARK: - View settings

/// The web's View settings, for what a view shows: its name, properties, the board's grouping and the
/// gallery's cards. (Filters and sorts set on the web still apply.)
private struct CollectionViewSettings: View {
    var data: CollectionSnapshot
    var view: CollectionSnapshot.View
    var apply: (CollectionSnapshot.ViewConfig, String?) -> Void
    @State private var name = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                Text("View name").foleviCapsLabel()
                TextField("View", text: $name)
                    .textFieldStyle(.folevi)
                    .onSubmit { if !name.trimmingCharacters(in: .whitespaces).isEmpty { apply(view.config, name) } }
            }
            VStack(alignment: .leading, spacing: 6) {
                Text("Properties").foleviCapsLabel()
                ForEach(data.properties) { p in
                    let on = view.config.visibleProperties.contains(p.id)
                    Button {
                        var c = view.config
                        c.visibleProperties = on ? c.visibleProperties.filter { $0 != p.id } : c.visibleProperties + [p.id]
                        apply(c, nil)
                    } label: {
                        HStack {
                            Image(systemName: on ? "eye" : "eye.slash").frame(width: 18).foregroundStyle(on ? FoleviColor.ink : FoleviColor.inkFaint)
                            Text(p.name).foregroundStyle(on ? FoleviColor.ink : FoleviColor.inkMuted)
                            Spacer()
                            Text(CollectionTable.typeLabels[p.type] ?? p.type).font(.ui(11.5)).foregroundStyle(FoleviColor.inkFaint)
                        }
                        .font(.ui(13))
                        .padding(.horizontal, 6)
                        .frame(height: 28)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(HoverRowStyle(radius: 6))
                    .accessibilityAddTraits(on ? .isSelected : [])
                }
            }
            if view.type == "board" {
                let selects = data.properties.filter { $0.type == "select" }
                VStack(alignment: .leading, spacing: 6) {
                    Text("Group by").foleviCapsLabel()
                    FlowPills(items: selects.map { ($0.id, $0.name) }, selected: view.config.groupBy) { id in
                        var c = view.config
                        c.groupBy = id
                        apply(c, nil)
                    }
                }
            }
            if view.type == "gallery" {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Card preview").foleviCapsLabel()
                    FlowPills(items: [("none", String(localized: "None")), ("cover", String(localized: "Cover")), ("content", String(localized: "Content"))],
                              selected: view.config.cardPreview) { id in
                        var c = view.config
                        c.cardPreview = id
                        apply(c, nil)
                    }
                    Text("Card size").foleviCapsLabel().padding(.top, 6)
                    FlowPills(items: [("small", String(localized: "Small")), ("medium", String(localized: "Medium")), ("large", String(localized: "Large"))],
                              selected: view.config.cardSize) { id in
                        var c = view.config
                        c.cardSize = id
                        apply(c, nil)
                    }
                }
            }
        }
        .padding(14)
        .frame(width: 300)
        .onAppear { name = view.name }
    }
}

private struct FlowPills: View {
    var items: [(String, String)]
    var selected: String?
    var pick: (String) -> Void
    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 80), spacing: 6)], alignment: .leading, spacing: 6) {
            ForEach(items, id: \.0) { id, title in
                FilterChip(title: title, isActive: selected == id) { pick(id) }
            }
        }
    }
}

// MARK: - Small pieces

/// A select option as a soft coloured pill (the web's optionColor).
struct OptionPill: View {
    var name: String
    var color: String

    var body: some View {
        let c = Self.colors(color)
        Text(name)
            .font(.ui(11.5, .medium))
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

/// A list of choices in a popover (select values, people, board columns).
private struct OptionList: View {
    var options: [(String?, String, String)]
    var selected: String?
    var pick: (String?) -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 2) {
                ForEach(Array(options.enumerated()), id: \.offset) { _, option in
                    Button { pick(option.0) } label: {
                        HStack {
                            if option.2.isEmpty { Text(option.1).font(.ui(13)).foregroundStyle(FoleviColor.ink) } else { OptionPill(name: option.1, color: option.2) }
                            Spacer()
                            if option.0 == selected { Image(systemName: "checkmark").font(.system(size: 11, weight: .semibold)).foregroundStyle(FoleviColor.ember) }
                        }
                        .padding(.horizontal, 8)
                        .frame(height: 30)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(HoverRowStyle(radius: 6))
                    .accessibilityAddTraits(option.0 == selected ? .isSelected : [])
                }
            }
            .padding(6)
        }
        .frame(width: 220)
        .frame(maxHeight: 300)
        .fixedSize(horizontal: false, vertical: true)
    }
}

/// Edits in place and commits on Return or when it loses focus (Escape cancels).
struct InlineTextField: View {
    var value: String
    var placeholder: String
    var font: Font
    var maxLength: Int
    var onCommit: (String) -> Void
    @State private var draft: String?
    @FocusState private var focused: Bool
    @State private var hovering = false

    var body: some View {
        TextField(placeholder, text: Binding(get: { draft ?? value }, set: { draft = String($0.prefix(maxLength)) }))
            .textFieldStyle(.plain)
            .font(font)
            .foregroundStyle(FoleviColor.ink)
            .padding(.horizontal, 4)
            .padding(.vertical, 2)
            .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(focused ? FoleviColor.surface : .clear))
            .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(focused ? FoleviColor.lineStrong : hovering ? FoleviColor.line : .clear, lineWidth: 1))
            .focused($focused)
            .onHover { hovering = $0 }
            .onSubmit { commit() }
            .onExitCommand {
                draft = nil
                focused = false
            }
            .onChange(of: focused) { _, now in if !now { commit() } }
    }

    private func commit() {
        guard let d = draft else { return }
        draft = nil
        let next = d.trimmingCharacters(in: .whitespaces)
        if next != value.trimmingCharacters(in: .whitespaces) { onCommit(next) }
    }
}

/// A quiet row button: accent-soft when hovered.
struct HoverRowStyle: ButtonStyle {
    var radius: CGFloat = 0
    func makeBody(configuration: Configuration) -> some View { HoverRowBody(configuration: configuration, radius: radius) }

    private struct HoverRowBody: View {
        let configuration: ButtonStyle.Configuration
        let radius: CGFloat
        @State private var hovering = false
        var body: some View {
            configuration.label
                .background(RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .fill(configuration.isPressed ? FoleviColor.accentSoft : hovering ? FoleviColor.accentSoft.opacity(0.7) : .clear))
                .onHover { hovering = $0 }
        }
    }
}
