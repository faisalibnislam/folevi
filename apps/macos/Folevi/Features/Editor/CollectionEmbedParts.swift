import AppKit
import SwiftUI

// The pieces of the collection embed (CollectionBlock.swift) that mirror the web's CollectionEmbed.tsx
// helpers: the payload, mutations, the custom Select, inputs, the View settings dialog, filters and the
// relation picker.

// MARK: - Data

/// `collections:get`, plus where the collection lives (for linking pages from its scope).
struct CollectionPayload: Decodable, Sendable, Equatable {
    var snapshot: CollectionSnapshot
    /// The team workspace it's in; nil in Personal.
    var workspaceId: String?
    /// In the collection's scope: its Personal's owner, or a member of its workspace.
    var isMember: Bool

    enum CodingKeys: String, CodingKey { case workspaceId, isMember }

    init(from decoder: Decoder) throws {
        snapshot = try CollectionSnapshot(from: decoder)
        let c = try decoder.container(keyedBy: CodingKeys.self)
        workspaceId = try? c.decodeIfPresent(String.self, forKey: .workspaceId)
        isMember = (try? c.decodeIfPresent(Bool.self, forKey: .isMember)) ?? false
    }

    /// Where the relation picker searches (the web's documentScope), only for members.
    var linkScope: Scope? {
        guard isMember else { return nil }
        return workspaceId.map { .workspace($0) } ?? .personal
    }
}

/// Runs the collection's mutations, showing failures as a toast (the web's toast.show(errorMessage(e))).
@MainActor
struct CollectionEditor {
    let collectionId: String
    let app: AppModel

    func run(_ name: String, _ args: [String: JSONValue], then: (@MainActor (JSONValue) -> Void)? = nil) {
        Task { @MainActor in
            if let result = await perform(name, args) { then?(result) }
        }
    }

    /// The mutation's result, or nil when it failed (already shown).
    func perform(_ name: String, _ args: [String: JSONValue]) async -> JSONValue? {
        guard let session = app.session else { return nil }
        var full = args
        full["collectionId"] = .string(collectionId)
        do {
            let result: JSONValue = try await session.convex.mutation(name, full)
            return result
        } catch {
            app.showToast(ConvexService.mapError(error).localizedDescription)
            return nil
        }
    }
}

/// What the embed's parts can change. Edits the web applies optimistically are applied here first too.
@MainActor
struct CollectionActions {
    var editor: CollectionEditor
    var setValue: (_ rowId: String, _ propertyId: String, _ value: JSONValue?) -> Void
    var renameRow: (_ rowId: String, _ title: String) -> Void
    var updateView: (_ viewId: String, _ config: CollectionSnapshot.ViewConfig?, _ name: String?) -> Void
    var addRow: (_ values: [String: JSONValue]?) -> Void
    var selectView: (_ viewId: String) -> Void
}

/// The web's TYPE_LABELS, in its order.
enum CollectionTypes {
    static let order = ["text", "number", "checkbox", "date", "select", "multiSelect", "url", "person", "relation"]
    static func label(_ type: String) -> String {
        switch type {
        case "text": return String(localized: "Text")
        case "number": return String(localized: "Number")
        case "checkbox": return String(localized: "Checkbox")
        case "date": return String(localized: "Date")
        case "select": return String(localized: "Single select")
        case "multiSelect": return String(localized: "Multi-select")
        case "url": return String(localized: "URL")
        case "person": return String(localized: "Person")
        case "relation": return String(localized: "Relation")
        default: return type
        }
    }
}

/// The web's collectionView.ts filter vocabulary: what can be filtered, and how each condition reads.
enum CollectionFilters {
    struct Target: Identifiable {
        var id: String
        var name: String
        /// title, or a property type
        var type: String
        var options: [CollectionSnapshot.Option]
    }

    static let ops: [String: [String]] = [
        "title": ["contains", "is", "isNot", "isEmpty", "isNotEmpty"],
        "text": ["contains", "is", "isNot", "isEmpty", "isNotEmpty"],
        "url": ["contains", "is", "isNot", "isEmpty", "isNotEmpty"],
        "number": ["is", "isNot", "gt", "lt", "isEmpty", "isNotEmpty"],
        "checkbox": ["checked", "unchecked"],
        "date": ["is", "lt", "gt", "isEmpty", "isNotEmpty"],
        "select": ["is", "isNot", "isEmpty", "isNotEmpty"],
        "multiSelect": ["is", "isNot", "isEmpty", "isNotEmpty"],
        "person": ["is", "isNot", "isEmpty", "isNotEmpty"],
        "relation": ["isNotEmpty", "isEmpty"],
    ]

    static let noValueOps: Set<String> = ["isEmpty", "isNotEmpty", "checked", "unchecked"]

    static func targets(_ props: [CollectionSnapshot.Property]) -> [Target] {
        [Target(id: CollectionLogic.titleId, name: String(localized: "Name"), type: "title", options: [])]
            + props.map { Target(id: $0.id, name: $0.name, type: $0.type, options: $0.options) }
    }

    static func label(_ type: String, _ op: String) -> String {
        if type == "date" {
            switch op {
            case "is": return String(localized: "is on")
            case "isNot": return String(localized: "is not on")
            case "lt": return String(localized: "is before")
            case "gt": return String(localized: "is after")
            case "isEmpty": return String(localized: "is empty")
            case "isNotEmpty": return String(localized: "is not empty")
            default: return op
            }
        }
        if type == "multiSelect" {
            switch op {
            case "is": return String(localized: "has")
            case "isNot": return String(localized: "doesn’t have")
            case "isEmpty": return String(localized: "is empty")
            case "isNotEmpty": return String(localized: "is not empty")
            default: return op
            }
        }
        if type == "number" {
            switch op {
            case "is": return "="
            case "isNot": return "≠"
            case "gt": return ">"
            case "lt": return "<"
            case "isEmpty": return String(localized: "is empty")
            case "isNotEmpty": return String(localized: "is not empty")
            default: return op
            }
        }
        switch op {
        case "is": return String(localized: "is")
        case "isNot": return String(localized: "is not")
        case "contains": return String(localized: "contains")
        case "isEmpty": return String(localized: "is empty")
        case "isNotEmpty": return String(localized: "is not empty")
        case "checked": return String(localized: "is checked")
        case "unchecked": return String(localized: "is unchecked")
        case "gt": return String(localized: "is greater than")
        case "lt": return String(localized: "is less than")
        default: return op
        }
    }

    /// Select filters store an option id; older views stored the option's name (the web's resolveOption).
    static func resolveOption(_ target: Target, _ value: JSONValue?) -> JSONValue? {
        guard target.type == "select" || target.type == "multiSelect", let s = value?.stringValue else { return value }
        if target.options.contains(where: { $0.id == s }) { return value }
        let wanted = s.trimmingCharacters(in: .whitespaces).lowercased()
        return target.options.first { $0.name.lowercased() == wanted }.map { .string($0.id) } ?? value
    }
}

// MARK: - Inputs

extension View {
    /// The web's `.ui-input`: a white field with a hairline ring and a faint inner shadow; open or focused, a
    /// soft heading-tinted outline.
    func collectionInput(active: Bool = false, radius: CGFloat = 6) -> some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        return background(shape.fill(FoleviColor.surface.shadow(.inner(color: FoleviColor.heading.opacity(active ? 0 : 0.08), radius: 1, y: 1))))
            .overlay(shape.strokeBorder(active ? FoleviColor.heading.opacity(0.165) : FoleviColor.line, lineWidth: active ? 1.5 : 1))
            .shadow(color: .black.opacity(active ? 0.08 : 0), radius: 1.5, y: 1)
    }
}

/// The web's Select (components/ui/Select.tsx) as the embed styles it: the chosen option's label and a
/// chevron, opening a list with a check on the chosen row. Never the OS pop-up button.
struct CollectionSelect<Value: Hashable>: View {
    enum Look {
        /// `h-8 ui-input rounded-[6px] px-3` (and `h-7 … text-xs` for "+ View").
        case input
        /// `bg-transparent`: just the label and the chevron.
        case plain
    }

    var selection: Value
    var options: [(value: Value, title: String)]
    var label: String
    var look: Look = .input
    var font: Font = .ui(13)
    var color: Color = FoleviColor.ink
    var width: CGFloat?
    var height: CGFloat = 32
    /// `w-full`: label left, chevron right.
    var fill = false
    var onPick: (Value) -> Void
    @State private var open = false
    @State private var triggerWidth: CGFloat = 0

    private var current: String {
        (options.first { $0.value == selection } ?? options.first)?.title ?? ""
    }

    var body: some View {
        Button { open.toggle() } label: {
            HStack(spacing: 6) {
                Text(current).lineLimit(1).truncationMode(.tail)
                if fill || width != nil { Spacer(minLength: 0) }
                Image(systemName: "chevron.down")
                    .font(.system(size: 10, weight: .semibold))
                    .opacity(0.6)
                    .rotationEffect(.degrees(open ? 180 : 0))
                    .animation(.easeOut(duration: 0.15), value: open)
                    .accessibilityHidden(true)
            }
            .font(font)
            .foregroundStyle(color)
            .padding(.horizontal, look == .input ? 12 : 0)
            .frame(width: width, height: look == .input ? height : nil, alignment: .leading)
            .frame(maxWidth: fill ? .infinity : nil, alignment: .leading)
            .modifier(InputLook(on: look == .input, active: open))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { triggerWidth = $0 }
        .accessibilityLabel(Text(label))
        .accessibilityValue(Text(current))
        .foleviPopover(isPresented: $open, arrowEdge: .bottom) {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(options.enumerated()), id: \.offset) { _, o in
                        CollectionSelectRow(title: o.title, checked: o.value == selection) {
                            open = false
                            if o.value != selection { onPick(o.value) }
                        }
                    }
                }
                .padding(6)
            }
            .frame(width: min(420, max(180, triggerWidth)))
            .frame(maxHeight: 320)
            .fixedSize(horizontal: false, vertical: true)
        }
    }

    private struct InputLook: ViewModifier {
        var on: Bool
        var active: Bool
        func body(content: Content) -> some View {
            if on { content.collectionInput(active: active) } else { content }
        }
    }
}

private struct CollectionSelectRow: View {
    var title: String
    var checked: Bool
    var action: () -> Void
    @State private var hover = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Text(title.isEmpty ? " " : title)
                    .font(.ui(13.5, checked ? .semibold : .regular))
                    .foregroundStyle(checked || hover ? FoleviColor.heading : FoleviColor.ink)
                    .lineLimit(1)
                Spacer(minLength: 8)
                Image(systemName: "checkmark")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(FoleviColor.heading)
                    .opacity(checked ? 1 : 0)
                    .frame(width: 14)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(hover ? FoleviGlass.hover : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
        .accessibilityAddTraits(checked ? .isSelected : [])
    }
}

/// A text input with the `.ui-input` look (`h-8 … px-3 text-sm`).
struct CollectionField: View {
    var placeholder: String = ""
    @Binding var text: String
    var width: CGFloat?
    var height: CGFloat = 32
    var onSubmit: () -> Void = {}
    var onBlur: () -> Void = {}
    @FocusState private var focused: Bool

    var body: some View {
        TextField(placeholder, text: $text)
            .textFieldStyle(.plain)
            .font(.ui(13))
            .foregroundStyle(FoleviColor.ink)
            .focused($focused)
            .onSubmit { onSubmit() }
            .onChange(of: focused) { _, now in if !now { onBlur() } }
            .padding(.horizontal, 12)
            .frame(width: width, height: height)
            .frame(maxWidth: width == nil ? .infinity : nil)
            .collectionInput(active: focused)
    }
}

/// The web's InlineText: edits in place, commits on Return or when it loses focus (Escape cancels).
struct InlineTextField: View {
    enum Chrome {
        /// Transparent; a hairline on hover, a stronger one and the surface while editing.
        case inline
        /// `.ui-input` (the View name field).
        case input
        /// A bare input (table cells).
        case none
    }

    var value: String
    var placeholder: String
    var font: Font
    var maxLength: Int
    var color: Color = FoleviColor.ink
    var chrome: Chrome = .inline
    var height: CGFloat?
    var onCommit: (String) -> Void
    @State private var draft: String?
    @FocusState private var focused: Bool
    @State private var hovering = false

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 6, style: .continuous)
        TextField(placeholder, text: Binding(get: { draft ?? value }, set: { draft = String($0.prefix(maxLength)) }))
            .textFieldStyle(.plain)
            .font(font)
            .foregroundStyle(color)
            .padding(.horizontal, chrome == .input ? 12 : chrome == .inline ? 4 : 0)
            .padding(.vertical, height == nil && chrome != .none ? 2 : 0)
            .frame(height: height)
            .background {
                if chrome == .inline { shape.fill(focused ? FoleviColor.surface : .clear) }
            }
            .overlay {
                if chrome == .inline {
                    shape.strokeBorder(focused ? FoleviColor.lineStrong : hovering ? FoleviColor.line : .clear, lineWidth: 1)
                }
            }
            .modifier(InputChrome(on: chrome == .input, active: focused))
            .focused($focused)
            .onHover { hovering = $0 }
            .onSubmit { focused = false; commit() }
            .onExitCommand {
                draft = nil
                focused = false
            }
            .onChange(of: focused) { _, now in
                if now { draft = value } else { commit() }
            }
    }

    private struct InputChrome: ViewModifier {
        var on: Bool
        var active: Bool
        func body(content: Content) -> some View {
            if on { content.collectionInput(active: active) } else { content }
        }
    }

    private func commit() {
        guard let d = draft else { return }
        draft = nil
        let next = d.trimmingCharacters(in: .whitespaces)
        if next != value.trimmingCharacters(in: .whitespaces) { onCommit(next) }
    }
}

/// The web's `<input type="checkbox">` in the accent colour (16pt square).
struct CollectionCheckbox: View {
    var checked: Bool
    var label: String
    var toggle: () -> Void

    var body: some View {
        Button(action: toggle) {
            RoundedRectangle(cornerRadius: 4, style: .continuous)
                .fill(checked ? FoleviColor.accent : FoleviColor.surface)
                .overlay {
                    if checked {
                        Image(systemName: "checkmark").font(.system(size: 9.5, weight: .bold)).foregroundStyle(FoleviColor.accentInk)
                    } else {
                        RoundedRectangle(cornerRadius: 4, style: .continuous).strokeBorder(FoleviColor.lineStrong, lineWidth: 1)
                    }
                }
                .frame(width: 16, height: 16)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(label))
        .accessibilityValue(Text(checked ? String(localized: "On") : String(localized: "Off")))
        .accessibilityAddTraits(.isToggle)
    }
}

/// A quiet button with a fill on hover (`hover:bg-…`).
struct HoverRowStyle: ButtonStyle {
    var radius: CGFloat = 0
    var fill: Color = FoleviColor.surface
    var hoverInk: Color?
    func makeBody(configuration: Configuration) -> some View { HoverRowBody(configuration: configuration, radius: radius, fill: fill, hoverInk: hoverInk) }

    private struct HoverRowBody: View {
        let configuration: ButtonStyle.Configuration
        let radius: CGFloat
        let fill: Color
        let hoverInk: Color?
        @State private var hovering = false
        var body: some View {
            configuration.label
                .foregroundStyle(hovering ? (hoverInk ?? FoleviColor.inkMuted) : FoleviColor.inkMuted)
                .background(RoundedRectangle(cornerRadius: radius, style: .continuous).fill(hovering || configuration.isPressed ? fill : .clear))
                .onHover { hovering = $0 }
        }
    }
}

/// A small square icon button (`grid h-7 w-7 place-items-center rounded-[6px] text-faint hover:bg-sunken`),
/// red on hover for deletes.
struct CollectionIconButton: View {
    var systemImage: String
    var label: String
    var size: CGFloat = 28
    var iconSize: CGFloat = 12
    var danger = true
    var action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: iconSize, weight: .medium))
                .foregroundStyle(hovering ? (danger ? FoleviColor.destructive : FoleviColor.ink) : FoleviColor.inkFaint)
                .frame(width: size, height: size)
                .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(hovering ? FoleviColor.surfaceSunken : .clear))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .help(Text(label))
        .accessibilityLabel(Text(label))
    }
}

// MARK: - Dialog frame

/// The web's Dialog (components/ui/Dialog.tsx): a serif title, an optional description, a close button,
/// and the content below.
struct CollectionDialogFrame<Content: View>: View {
    var title: String
    var description: String?
    var width: CGFloat
    var close: () -> Void
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(FoleviType.display(21))
                        .tracking(FoleviType.displayTracking(21))
                        .foregroundStyle(FoleviColor.heading)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isHeader)
                    if let description {
                        Text(description)
                            .font(.ui(13))
                            .foregroundStyle(FoleviColor.inkMuted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                IconButton(systemImage: "xmark", label: "Close", size: 30, action: close)
                    .keyboardShortcut(.cancelAction)
            }
            .padding(.horizontal, 24)
            .padding(.top, 20)
            .padding(.bottom, 8)
            content
                .padding(.horizontal, 24)
                .padding(.vertical, 16)
        }
        .frame(width: width)
        .background(FoleviColor.surface)
    }
}

/// The web's ConfirmDialog: Cancel and a red action that stays busy while the change is saved.
struct CollectionConfirm: View {
    var title: String
    var message: String
    var confirmTitle: String
    var onCancel: () -> Void
    var onConfirm: @MainActor () async -> Void
    @State private var busy = false

    var body: some View {
        FoleviDialog(title: title, message: message, confirmTitle: confirmTitle, busy: busy, onCancel: onCancel) {
            guard !busy else { return }
            busy = true
            Task { @MainActor in
                await onConfirm()
                busy = false
            }
        } content: { EmptyView() }
    }
}

// MARK: - View settings

/// The web's ViewSettings dialog: the view's name, filters, sorts, grouping (boards), cards (galleries),
/// and the collection's properties (show, rename, delete, options, add), and deleting the view.
struct CollectionViewSettings: View {
    var data: CollectionPayload
    var view: CollectionSnapshot.View
    var actions: CollectionActions
    var close: () -> Void
    @State private var newName = ""
    @State private var newType = "text"
    @State private var confirmProperty: CollectionSnapshot.Property?
    @State private var confirmView = false

    private var snapshot: CollectionSnapshot { data.snapshot }
    private var config: CollectionSnapshot.ViewConfig { view.config }
    private var editor: CollectionEditor { actions.editor }

    var body: some View {
        CollectionDialogFrame(title: String(localized: "\(view.name) settings"),
                              description: String(localized: "Filters, sorting, grouping and visible properties are saved with this view for everyone."),
                              width: 768, close: close) {
            ScrollView {
                HStack(alignment: .top, spacing: 24) {
                    left.frame(maxWidth: .infinity, alignment: .topLeading)
                    right.frame(maxWidth: .infinity, alignment: .topLeading)
                }
            }
            .frame(minHeight: 320, idealHeight: 560, maxHeight: 640)
        }
        .foleviDialog(item: $confirmProperty) { p in
            CollectionConfirm(title: String(localized: "Delete “\(p.name)”?"),
                              message: String(localized: "Its values disappear from every row and view of this collection."),
                              confirmTitle: String(localized: "Delete property"),
                              onCancel: { confirmProperty = nil }) {
                if await editor.perform("collections:deleteProperty", ["propertyId": .string(p.id)]) != nil {
                    editor.app.showToast(String(localized: "Deleted “\(p.name)”."))
                    confirmProperty = nil
                }
            }
        }
        .foleviDialog(isPresented: $confirmView) {
            CollectionConfirm(title: String(localized: "Delete the “\(view.name)” view?"),
                              message: String(localized: "Rows and properties stay; only this view’s filters, sorting and layout are removed."),
                              confirmTitle: String(localized: "Delete view"),
                              onCancel: { confirmView = false }) {
                if await editor.perform("collections:deleteView", ["viewId": .string(view.id)]) != nil {
                    confirmView = false
                    close()
                }
            }
        }
    }

    private func save(_ change: (inout CollectionSnapshot.ViewConfig) -> Void) {
        var next = config
        change(&next)
        actions.updateView(view.id, next, nil)
    }

    // MARK: Left: name, filters, sort, group, cards

    private var left: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 4) {
                Text("View name").font(.ui(13, .semibold)).foregroundStyle(FoleviColor.ink)
                InlineTextField(value: view.name, placeholder: "", font: .ui(13), maxLength: 40, chrome: .input, height: 32) { name in
                    actions.updateView(view.id, nil, name.isEmpty ? view.name : name)
                }
                .accessibilityLabel(Text("View name"))
            }
            .padding(.bottom, 16)

            sectionTitle("Filters", systemImage: "line.3.horizontal.decrease")
            let targets = CollectionFilters.targets(snapshot.properties)
            ForEach(Array(config.filters.enumerated()), id: \.offset) { i, f in
                filterRow(i, f, targets: targets)
            }
            Button {
                save { c in
                    let first = snapshot.properties.first
                    c.filters.append(.init(propertyId: first?.id ?? CollectionLogic.titleId,
                                           op: first.flatMap { CollectionFilters.ops[$0.type]?.first } ?? "contains"))
                }
            } label: { Label("Add filter", systemImage: "plus") }
                .buttonStyle(.folevi(.secondary, .small))

            sectionTitle("Sort", systemImage: "arrow.up.arrow.down").padding(.top, 24)
            ForEach(Array(config.sorts.enumerated()), id: \.offset) { i, s in
                HStack(spacing: 6) {
                    CollectionSelect(selection: s.propertyId,
                                     options: [(CollectionLogic.titleId, String(localized: "Name"))] + snapshot.properties.map { ($0.id, $0.name) },
                                     label: String(localized: "Sort property")) { id in
                        save { c in if c.sorts.indices.contains(i) { c.sorts[i].propertyId = id } }
                    }
                    CollectionSelect(selection: s.direction,
                                     options: [("asc", String(localized: "Ascending")), ("desc", String(localized: "Descending"))],
                                     label: String(localized: "Direction")) { dir in
                        save { c in if c.sorts.indices.contains(i) { c.sorts[i].direction = dir } }
                    }
                    CollectionIconButton(systemImage: "trash", label: String(localized: "Remove sort")) {
                        save { c in if c.sorts.indices.contains(i) { c.sorts.remove(at: i) } }
                    }
                }
                .padding(.bottom, 8)
            }
            Button {
                save { $0.sorts.append(.init(propertyId: CollectionLogic.titleId, direction: "asc")) }
            } label: { Label("Add sort", systemImage: "plus") }
                .buttonStyle(.folevi(.secondary, .small))

            if view.type == "board" {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Group by").font(.ui(13, .semibold)).foregroundStyle(FoleviColor.ink)
                    CollectionSelect(selection: config.groupBy ?? "",
                                     options: snapshot.properties.filter { $0.type == "select" }.map { ($0.id, $0.name) },
                                     label: String(localized: "Group by")) { id in
                        save { $0.groupBy = id.isEmpty ? nil : id }
                    }
                }
                .padding(.top, 24)
            }
            if view.type == "gallery" {
                HStack(alignment: .top, spacing: 16) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Card preview").font(.ui(13, .semibold)).foregroundStyle(FoleviColor.ink)
                        CollectionSelect(selection: config.cardPreview,
                                         options: [("none", String(localized: "None")), ("cover", String(localized: "Cover")), ("content", String(localized: "Page content"))],
                                         label: String(localized: "Card preview")) { v in save { $0.cardPreview = v } }
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Card size").font(.ui(13, .semibold)).foregroundStyle(FoleviColor.ink)
                        CollectionSelect(selection: config.cardSize,
                                         options: [("small", String(localized: "Small")), ("medium", String(localized: "Medium")), ("large", String(localized: "Large"))],
                                         label: String(localized: "Card size")) { v in save { $0.cardSize = v } }
                    }
                }
                .padding(.top, 24)
            }
        }
    }

    private func sectionTitle(_ title: LocalizedStringKey, systemImage: String? = nil) -> some View {
        HStack(spacing: 6) {
            if let systemImage { Image(systemName: systemImage).font(.system(size: 12, weight: .medium)).accessibilityHidden(true) }
            Text(title)
        }
        .font(.ui(13, .semibold))
        .foregroundStyle(FoleviColor.ink)
        .padding(.bottom, 8)
        .accessibilityAddTraits(.isHeader)
    }

    private func filterRow(_ i: Int, _ f: CollectionSnapshot.Filter, targets: [CollectionFilters.Target]) -> some View {
        let target = targets.first { $0.id == f.propertyId }
        let ops = target.flatMap { CollectionFilters.ops[$0.type] } ?? [f.op]
        var propertyOptions: [(value: String, title: String)] = targets.map { ($0.id, $0.name) }
        if target == nil { propertyOptions.insert((f.propertyId, String(localized: "Deleted property")), at: 0) }
        return FlowLayout(spacing: 6) {
            CollectionSelect(selection: f.propertyId, options: propertyOptions, label: String(localized: "Property")) { id in
                let valid = targets.first { $0.id == id }.flatMap { CollectionFilters.ops[$0.type] } ?? []
                save { c in
                    guard c.filters.indices.contains(i) else { return }
                    c.filters[i] = .init(propertyId: id, op: valid.contains(f.op) ? f.op : (valid.first ?? "isNotEmpty"), value: nil)
                }
            }
            CollectionSelect(selection: f.op,
                             options: ops.map { op in (op, target.map { t in CollectionFilters.label(t.type, op) } ?? op) },
                             label: String(localized: "Condition")) { op in
                save { c in if c.filters.indices.contains(i) { c.filters[i].op = op } }
            }
            if let target, !CollectionFilters.noValueOps.contains(f.op) {
                FilterValueEditor(target: target, filter: f, people: snapshot.people) { value in
                    save { c in if c.filters.indices.contains(i) { c.filters[i].value = value } }
                }
            }
            CollectionIconButton(systemImage: "trash", label: String(localized: "Remove filter")) {
                save { c in if c.filters.indices.contains(i) { c.filters.remove(at: i) } }
            }
        }
        .padding(.bottom, 8)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Filter \(i + 1)"))
    }

    // MARK: Right: properties

    private var right: some View {
        VStack(alignment: .leading, spacing: 0) {
            sectionTitle("Properties")
            VStack(alignment: .leading, spacing: 6) {
                ForEach(snapshot.properties) { p in
                    let on = config.visibleProperties.contains(p.id)
                    HStack(spacing: 8) {
                        CollectionCheckbox(checked: on, label: String(localized: "Show \(p.name)")) {
                            save { c in
                                let rest = c.visibleProperties.filter { $0 != p.id }
                                c.visibleProperties = on ? rest : rest + [p.id]
                            }
                        }
                        InlineTextField(value: p.name, placeholder: "", font: .ui(13), maxLength: 60, height: 28) { name in
                            guard !name.isEmpty else { return }
                            editor.run("collections:updateProperty", ["propertyId": .string(p.id), "name": .string(name)])
                        }
                        .frame(maxWidth: .infinity)
                        .accessibilityLabel(Text("Name of property \(p.name)"))
                        Text(CollectionTypes.label(p.type)).font(.ui(12)).foregroundStyle(FoleviColor.inkFaint)
                        CollectionIconButton(systemImage: "trash", label: String(localized: "Delete property \(p.name)")) { confirmProperty = p }
                    }
                }
            }
            ForEach(snapshot.properties.filter { $0.type == "select" || $0.type == "multiSelect" }) { p in
                OptionsField(property: p) { options in
                    editor.run("collections:updateProperty", ["propertyId": .string(p.id), "options": .array(options)])
                }
                .padding(.top, 12)
            }
            HStack(alignment: .bottom, spacing: 8) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("New property").font(.ui(12)).foregroundStyle(FoleviColor.ink)
                    CollectionField(text: $newName, onSubmit: addProperty)
                        .accessibilityLabel(Text("New property"))
                }
                .frame(maxWidth: .infinity)
                CollectionSelect(selection: newType, options: CollectionTypes.order.map { ($0, CollectionTypes.label($0)) },
                                 label: String(localized: "Property type")) { newType = $0 }
                Button("Add", action: addProperty)
                    .buttonStyle(.folevi(.secondary, .small))
                    .disabled(newName.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .padding(.top, 16)
            if snapshot.views.count > 1 {
                Button { confirmView = true } label: {
                    Label("Delete this view", systemImage: "trash").foregroundStyle(FoleviColor.destructive)
                }
                .buttonStyle(.folevi(.quiet, .small))
                .padding(.top, 24)
            }
        }
    }

    private func addProperty() {
        let name = newName.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { return }
        let type = newType
        editor.run("collections:addProperty", ["name": .string(newName), "type": .string(type)]) { _ in
            newName = ""
            newType = "text"
        }
    }
}

/// "Options for X (comma-separated)": renames, adds and removes a select's options, keeping the ids and
/// colours of the ones that stay.
private struct OptionsField: View {
    var property: CollectionSnapshot.Property
    var commit: ([JSONValue]) -> Void
    @State private var text = ""

    private var joined: String { property.options.map(\.name).joined(separator: ", ") }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Options for \(property.name) (comma-separated)").font(.ui(12)).foregroundStyle(FoleviColor.ink)
            CollectionField(text: $text, onSubmit: save, onBlur: save)
                .accessibilityLabel(Text("Options for \(property.name) (comma-separated)"))
        }
        .onAppear { text = joined }
        .onChange(of: joined) { _, now in text = now }
    }

    private func save() {
        let names = text.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        if names.joined(separator: ",") == property.options.map(\.name).joined(separator: ",") { return }
        commit(names.map { name in
            var o: [String: JSONValue] = ["name": .string(name)]
            if let existing = property.options.first(where: { $0.name == name }) {
                o["id"] = .string(existing.id)
                o["color"] = .string(existing.color)
            }
            return .object(o)
        })
    }
}

/// A filter's value: an option, a person, a date, a number or text (`h-8 w-36 ui-input`).
private struct FilterValueEditor: View {
    var target: CollectionFilters.Target
    var filter: CollectionSnapshot.Filter
    var people: [CollectionSnapshot.Person]
    var onChange: (JSONValue?) -> Void
    @State private var text = ""
    @State private var showDate = false

    private var value: JSONValue? { CollectionFilters.resolveOption(target, filter.value) }

    var body: some View {
        switch target.type {
        case "select", "multiSelect":
            CollectionSelect(selection: value?.stringValue ?? "",
                             options: [("", String(localized: "Choose…"))] + target.options.map { ($0.id, $0.name) },
                             label: String(localized: "Value"), width: 144) { id in onChange(id.isEmpty ? nil : .string(id)) }
        case "person":
            CollectionSelect(selection: value?.stringValue ?? "",
                             options: [("", String(localized: "Choose…"))] + people.map { ($0.id, $0.name) },
                             label: String(localized: "Value"), width: 144) { id in onChange(id.isEmpty ? nil : .string(id)) }
        case "date":
            Button { showDate = true } label: {
                Text(value?.stringValue.map(CollectionCellDisplay.formatDate) ?? String(localized: "Choose…"))
                    .font(.ui(13))
                    .foregroundStyle(value == nil ? FoleviColor.inkMuted : FoleviColor.ink)
                    .lineLimit(1)
                    .padding(.horizontal, 8)
                    .frame(width: 144, height: 32, alignment: .leading)
                    .collectionInput(active: showDate)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("Value"))
            .foleviPopover(isPresented: $showDate, arrowEdge: .bottom) {
                VStack(alignment: .leading, spacing: 8) {
                    MonthPicker(selection: Binding(get: { value?.stringValue ?? TaskLogic.localDate() }, set: { d in
                        showDate = false
                        onChange(.string(d))
                    }), today: TaskLogic.localDate())
                    Button("Clear") { showDate = false; onChange(nil) }.buttonStyle(.folevi(.quiet, .small))
                }
                .padding(10)
                .frame(width: 250)
            }
        default:
            CollectionField(text: $text, width: 144, onSubmit: commit, onBlur: commit)
                .accessibilityLabel(Text("Value"))
                .onAppear { text = shown }
                .onChange(of: shown) { _, now in text = now }
        }
    }

    private var shown: String {
        guard let value else { return "" }
        if let n = value.doubleValue, case .number = value { return JSONValue.formatNumber(n) }
        return value.stringValue ?? value.canonicalString
    }

    private func commit() {
        let t = text.trimmingCharacters(in: .whitespaces)
        if target.type == "number" {
            if t.isEmpty { if filter.value != nil { onChange(nil) }; return }
            guard let n = Double(t) else { text = shown; return }
            if value?.doubleValue != n { onChange(.number(n)) }
        } else {
            if text == shown { return }
            onChange(text.isEmpty ? nil : .string(text))
        }
    }
}

// MARK: - Relations

/// The titles of linked pages (`documents:titles`), live.
struct RelationTitles<Content: View>: View {
    var ids: [String]
    @ViewBuilder var content: ([String: String]) -> Content
    @Environment(AppModel.self) private var app
    @State private var titles: [String: String] = [:]

    private struct Entry: Decodable, Sendable { var title: String }

    var body: some View {
        content(titles)
            .task(id: ids) {
                guard !ids.isEmpty, let session = app.session else { return }
                let stream: AsyncThrowingStream<[String: Entry], Error> = session.convex.subscribe("documents:titles", ["documentIds": .array(ids.map(JSONValue.string))])
                do {
                    for try await result in stream { titles = result.mapValues(\.title) }
                } catch {}
            }
    }
}

/// Linked pages with a searchable picker (the web's RelationEditor).
struct RelationEditor: View {
    var label: String
    var scope: Scope?
    var value: [String]
    var openDocument: (String, Bool) -> Void
    var onChange: ([String]) -> Void
    @State private var picking = false

    var body: some View {
        RelationTitles(ids: value) { titles in
            FlowLayout(spacing: 4) {
                ForEach(value, id: \.self) { id in
                    let title = titles[id].flatMap { $0.isEmpty ? nil : $0 } ?? String(localized: "Untitled")
                    HStack(spacing: 4) {
                        UnderlineOnHoverButton(title: title, font: .ui(11), color: FoleviColor.ink) {
                            openDocument(id, NSEvent.modifierFlags.contains(.option))
                        }
                        RemoveLinkButton(label: String(localized: "Remove \(titles[id].flatMap { $0.isEmpty ? nil : $0 } ?? String(localized: "page"))")) {
                            onChange(value.filter { $0 != id })
                        }
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(FoleviColor.surfaceSunken))
                }
                if scope != nil {
                    Button { picking = true } label: {
                        Text("+ Link page").font(.ui(11)).padding(.horizontal, 6).padding(.vertical, 2).contentShape(Rectangle())
                    }
                    .buttonStyle(HoverRowStyle(radius: 6, fill: FoleviColor.surfaceSunken))
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(label))
        .foleviDialog(isPresented: $picking) {
            if let scope {
                CollectionDialogFrame(title: String(localized: "Link a page"), description: label, width: 384, close: { picking = false }) {
                    PagePicker(scope: scope, exclude: value) { id in onChange(value + [id]) }
                }
            }
        }
    }
}

private struct RemoveLinkButton: View {
    var label: String
    var action: () -> Void
    @State private var hovering = false
    var body: some View {
        Button(action: action) {
            Text("×").font(.ui(11)).foregroundStyle(hovering ? FoleviColor.ink : FoleviColor.inkFaint).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .accessibilityLabel(Text(label))
    }
}

/// A text link that underlines on hover (`hover:underline`).
struct UnderlineOnHoverButton: View {
    var title: String
    var font: Font
    var color: Color
    var action: () -> Void
    @State private var hovering = false
    var body: some View {
        Button(action: action) {
            Text(title).font(font).foregroundStyle(color).underline(hovering).multilineTextAlignment(.leading).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
    }
}

/// Search the collection's scope for a page to link (the web's PagePicker): recent pages until you type.
private struct PagePicker: View {
    var scope: Scope
    var exclude: [String]
    var onPick: (String) -> Void
    @Environment(AppModel.self) private var app
    @State private var query = ""
    @State private var debounced = ""
    @State private var loaded: [Page]?
    @State private var active = 0
    @FocusState private var focused: Bool

    private struct Page: Decodable, Sendable, Identifiable {
        var id: String
        var title: String
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try c.decode(String.self, forKey: .id)
            title = (try? c.decodeIfPresent(String.self, forKey: .title)) ?? ""
        }
        enum CodingKeys: String, CodingKey { case id, title }
    }

    private var options: [Page] { (loaded ?? []).filter { !exclude.contains($0.id) } }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").font(.system(size: 13)).foregroundStyle(FoleviColor.inkFaint).accessibilityHidden(true)
                TextField(String(localized: "Search pages…"), text: $query)
                    .textFieldStyle(.plain)
                    .font(.ui(13))
                    .focused($focused)
                    .onSubmit { if options.indices.contains(active) { pick(options[active].id) } }
                    .onKeyPress(.downArrow) { active = min(active + 1, max(options.count - 1, 0)); return .handled }
                    .onKeyPress(.upArrow) { active = max(active - 1, 0); return .handled }
                    .onChange(of: query) { _, _ in active = 0 }
                    .accessibilityLabel(Text("Search pages"))
            }
            .padding(.horizontal, 12)
            .frame(height: 36)
            .collectionInput(active: focused)

            Text(debounced.isEmpty ? "Recent pages" : "Matching pages").foleviCapsLabel()
                .padding(.horizontal, 4)
                .padding(.top, 12)
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(options.enumerated()), id: \.element.id) { i, d in
                        Button { pick(d.id) } label: {
                            HStack(spacing: 10) {
                                Image(systemName: "doc.text").font(.system(size: 13)).foregroundStyle(FoleviColor.inkMuted).accessibilityHidden(true)
                                Text(d.title.isEmpty ? String(localized: "Untitled") : d.title).lineLimit(1)
                                Spacer(minLength: 0)
                            }
                            .font(.ui(13.5))
                            .foregroundStyle(i == active ? FoleviColor.heading : FoleviColor.ink)
                            .padding(.horizontal, 10)
                            .frame(minHeight: 32)
                            .background(i == active ? FoleviGlass.hover : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .onHover { if $0 { active = i } }
                        .accessibilityAddTraits(i == active ? .isSelected : [])
                    }
                    if loaded != nil && options.isEmpty {
                        Text(debounced.isEmpty ? "No recent pages" : "No matching pages")
                            .font(.ui(13)).foregroundStyle(FoleviColor.inkMuted)
                            .padding(.horizontal, 8).padding(.vertical, 8)
                    }
                }
            }
            .frame(height: 256)
            .padding(.top, 4)
        }
        .onAppear { focused = true }
        .task(id: query) {
            try? await Task.sleep(for: .milliseconds(150))
            guard !Task.isCancelled else { return }
            debounced = query.trimmingCharacters(in: .whitespaces)
        }
        .task(id: debounced) { await load(debounced) }
    }

    private func load(_ text: String) async {
        guard let session = app.session else { return }
        do {
            let pages: [Page] = text.isEmpty
                ? try await session.convex.query("documents:recent", ["scope": scope.arg, "limit": 12])
                : try await session.convex.query("search:documents", ["scope": scope.arg, "query": .string(text), "limit": 12])
            loaded = pages
        } catch {
            if !Task.isCancelled { loaded = [] }
        }
    }

    private func pick(_ id: String) {
        onPick(id)
        query = ""
        active = 0
    }
}
