import SwiftUI
import UniformTypeIdentifiers

/// The document page: cover/icon/title header, conflict banner, block rows, find bar.
struct EditorView: View {
    @Bindable var model: EditorModel
    var openDocument: (String, Bool) -> Void
    @Environment(AppModel.self) private var app
    @Environment(\.undoManager) private var undoManager
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @FocusState private var containerFocused: Bool
    @FocusState private var findFocused: Bool
    var showFind: Binding<Bool>

    private var scale: CGFloat { CGFloat(app.editorScale) }

    private var pageWidth: CGFloat {
        switch model.style.width {
        case .narrow: return FoleviLayout.editorWidthNarrow
        case .default: return FoleviLayout.editorWidthDefault
        case .wide: return FoleviLayout.editorWidthWide
        }
    }

    var body: some View {
        ZStack(alignment: .top) {
            pageBackground.ignoresSafeArea()
            switch model.loadState {
            case .loading:
                ProgressView().controlSize(.small).frame(maxWidth: .infinity, maxHeight: .infinity)
            case .unavailable(let message):
                EmptyStateView(systemImage: "icloud.slash", title: "Not available offline", message: LocalizedStringKey(message))
            case .ready:
                content
            }
        }
        .overlay(alignment: .topTrailing) {
            if showFind.wrappedValue { findBar.padding(12) }
        }
        .onAppear {
            model.undoManager = undoManager
            model.openDocumentHandler = openDocument
        }
        .onChange(of: undoManager) { _, new in model.undoManager = new }
        .onChange(of: app.remoteRevision[model.documentId]) { _, _ in model.scheduleReload() }
        .onChange(of: app.blockRevision[model.documentId]) { _, _ in model.scheduleReload() }
        .onChange(of: app.documentsRevision) { _, _ in model.documentChanged() }
        .onChange(of: model.containerFocusToken) { _, _ in containerFocused = true }
        .sheet(isPresented: $model.showLinkPrompt) {
            LinkPromptView(initial: model.linkDraft) { model.applyLink($0) } onCancel: { model.showLinkPrompt = false }
        }
    }

    private var content: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    DocumentHeaderView(model: model, openDocument: openDocument)
                    if !model.conflicts.isEmpty {
                        ConflictBanner(model: model)
                            .padding(.bottom, 16)
                    }
                    if model.isReadOnly, model.document?.deletedAt == nil {
                        Label("You can view this document but not edit it.", systemImage: "lock")
                            .font(.callout)
                            .foregroundStyle(FoleviColor.inkMuted)
                            .padding(.bottom, 12)
                    }
                    ForEach(model.rows) { row in
                        BlockRowView(row: row, model: model, openDocument: openDocument)
                            .id(row.id)
                            .zIndex(model.popup?.blockId == row.id ? 10 : 0)
                    }
                    // Clicking below the last block continues writing.
                    Color.clear
                        .frame(height: 160)
                        .contentShape(Rectangle())
                        .onTapGesture { continueWriting() }
                        .accessibilityHidden(true)
                }
                .frame(maxWidth: pageWidth, alignment: .leading)
                .padding(.horizontal, 56)
                .padding(.top, 8)
                .background(sheetBackground)
                .frame(maxWidth: .infinity)
                .padding(.vertical, model.style.background == .paper ? 24 : 0)
            }
            .scrollContentBackground(.hidden)
            .focusable()
            .focused($containerFocused)
            .focusEffectDisabled()
            .onKeyPress(phases: .down) { press in handleSelectionKey(press) }
            .onChange(of: model.focus) { _, request in
                if let id = request?.blockId, id != "__title__" {
                    withAnimation(reduceMotion ? nil : .easeOut(duration: FoleviMotion.fast)) { proxy.scrollTo(id) }
                }
            }
            .onChange(of: model.revealBlockId) { _, id in
                guard let id else { return }
                model.revealBlockId = nil
                proxy.scrollTo(id)
            }
            .onChange(of: model.selectedBlockIds) { _, ids in
                if let first = model.orderedByRows(Array(ids)).first { proxy.scrollTo(first) }
            }
            .dropDestination(for: URL.self) { urls, _ in
                let files = urls.filter { $0.isFileURL }
                guard !files.isEmpty, !model.isReadOnly else { return false }
                model.insertFiles(files, after: model.focusedBlockId ?? model.rows.last?.id)
                return true
            }
        }
    }

    private func continueWriting() {
        guard !model.isReadOnly else { return }
        if let last = model.rows.last, last.block.content.carriesText, RichText.plainText(last.block.text).isEmpty {
            model.focus = FocusRequest(blockId: last.id, caret: .end)
            return
        }
        let lastRoot = model.rows.last { $0.block.parentId == nil }
        let rank = Rank.betweenOrAfter(lastRoot?.block.rank, nil)
        let b = Block(id: ULID.make(), parentId: nil, rank: rank, content: .paragraph(ParagraphProps()))
        model.commit(upserts: [b], focus: FocusRequest(blockId: b.id, caret: .start), actionName: String(localized: "New Block"))
    }

    private func handleSelectionKey(_ press: KeyPress) -> KeyPress.Result {
        guard !model.selectedBlockIds.isEmpty else { return .ignored }
        let shift = press.modifiers.contains(.shift)
        switch press.key {
        case .upArrow:
            if press.modifiers.contains(.option) && shift { model.move(model.commandTargets, up: true) } else if shift { model.extendSelection(up: true) } else { model.moveSelection(up: true) }
            return .handled
        case .downArrow:
            if press.modifiers.contains(.option) && shift { model.move(model.commandTargets, up: false) } else if shift { model.extendSelection(up: false) } else { model.moveSelection(up: false) }
            return .handled
        case .delete, .deleteForward:
            if !model.isReadOnly { model.delete(model.commandTargets) }
            return .handled
        case .return:
            model.editSelected()
            return .handled
        case .escape:
            model.clearSelection()
            return .handled
        case .space:
            if let id = model.commandTargets.first, let block = model.blocks[id] {
                QuickLookCoordinator.shared.preview(block: block, app: app)
                return .handled
            }
            return .ignored
        case .tab:
            if shift { model.outdent(model.commandTargets) } else { model.indent(model.commandTargets) }
            return .handled
        default:
            return .ignored
        }
    }

    @ViewBuilder private var pageBackground: some View {
        switch model.style.background {
        case .tinted: Color.folevi(accent: model.style.accent).opacity(0.06).background(FoleviColor.canvas)
        case .plain: FoleviColor.surface
        default: FoleviColor.canvas
        }
    }

    @ViewBuilder private var sheetBackground: some View {
        if model.style.background == .paper {
            RoundedRectangle(cornerRadius: FoleviRadius.sheet, style: .continuous)
                .fill(FoleviColor.surface)
                .shadow(color: .black.opacity(0.04), radius: 12, y: 2)
                .overlay(RoundedRectangle(cornerRadius: FoleviRadius.sheet, style: .continuous).strokeBorder(FoleviColor.line.opacity(0.7)))
                .padding(.horizontal, 16)
        } else if model.style.background == .grid {
            GridPaper().opacity(0.5)
        }
    }

    private var findBar: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").foregroundStyle(FoleviColor.inkMuted).accessibilityHidden(true)
            TextField("Find in document", text: $model.findQuery)
                .textFieldStyle(.plain)
                .frame(width: 200)
                .focused($findFocused)
                .onSubmit { model.findNext() }
                .accessibilityIdentifier("findField")
            if !model.findQuery.isEmpty {
                Text(model.findMatches.isEmpty ? String(localized: "No matches") : String(localized: "\(model.findIndex + 1) of \(model.findMatches.count)"))
                    .font(.caption)
                    .foregroundStyle(FoleviColor.inkMuted)
                    .monospacedDigit()
            }
            IconButton(systemImage: "chevron.up", label: "Previous Match") { model.findNext(backwards: true) }
            IconButton(systemImage: "chevron.down", label: "Next Match") { model.findNext() }
            IconButton(systemImage: "xmark", label: "Close Find") {
                model.findQuery = ""
                showFind.wrappedValue = false
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .foleviChrome()
        .onAppear { findFocused = true }
        .onExitCommand {
            model.findQuery = ""
            showFind.wrappedValue = false
        }
    }
}

struct GridPaper: View {
    var body: some View {
        Canvas { ctx, size in
            let step: CGFloat = 24
            var path = Path()
            var x: CGFloat = 0
            while x < size.width {
                var y: CGFloat = 0
                while y < size.height {
                    path.addEllipse(in: CGRect(x: x, y: y, width: 1.5, height: 1.5))
                    y += step
                }
                x += step
            }
            ctx.fill(path, with: .color(FoleviColor.lineStrong))
        }
        .accessibilityHidden(true)
    }
}

// MARK: - Header

struct DocumentHeaderView: View {
    @Bindable var model: EditorModel
    var openDocument: (String, Bool) -> Void
    @Environment(AppModel.self) private var app
    @State private var showIconPicker = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let crumbs = model.detail?.breadcrumbs, !crumbs.isEmpty {
                HStack(spacing: 4) {
                    ForEach(crumbs) { c in
                        Button {
                            openDocument(c.id, NSEvent.modifierFlags.contains(.option))
                        } label: {
                            Text("\(c.icon ?? "") \(c.title.isEmpty ? String(localized: "Untitled") : c.title)")
                        }
                        .buttonStyle(.link)
                        Image(systemName: "chevron.right").font(.system(size: 9)).foregroundStyle(FoleviColor.inkFaint).accessibilityHidden(true)
                    }
                }
                .font(.system(size: 12))
                .accessibilityElement(children: .contain)
                .accessibilityLabel(Text("Breadcrumbs"))
                .padding(.top, 20)
            }
            if model.document?.cover.kind == .color || model.document?.cover.kind == .gradient {
                LinearGradient(colors: [Color.folevi(cover: model.document?.cover, style: model.style).opacity(0.6),
                                        Color.folevi(cover: model.document?.cover, style: model.style).opacity(0.2)],
                               startPoint: .topLeading, endPoint: .bottomTrailing)
                    .frame(height: 120)
                    .clipShape(RoundedRectangle(cornerRadius: FoleviRadius.card, style: .continuous))
                    .padding(.top, 16)
                    .accessibilityHidden(true)
            }
            HStack(alignment: .top) {
                Button {
                    if !model.isReadOnly { showIconPicker = true }
                } label: {
                    if let icon = model.document?.icon, !icon.isEmpty {
                        Text(icon).font(.system(size: 44 * CGFloat(app.editorScale)))
                    } else if !model.isReadOnly {
                        Label("Add Icon", systemImage: "face.smiling").font(.caption).foregroundStyle(FoleviColor.inkFaint)
                    }
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Document icon"))
                .popover(isPresented: $showIconPicker) { IconPicker { icon in model.setIcon(icon); showIconPicker = false } }
                Spacer()
            }
            .padding(.top, model.detail?.breadcrumbs.isEmpty == false ? 4 : 40)
            BlockTextEditor(blockId: "__title__",
                            text: model.titleDraft.isEmpty ? [] : [.text(text: model.titleDraft, marks: nil)],
                            style: BlockStyles.title(style: model.style, scale: CGFloat(app.editorScale)),
                            isEditable: !model.isReadOnly,
                            accessibilityLabel: String(localized: "Title"),
                            model: model,
                            focusRequest: model.focus?.blockId == "__title__" ? model.focus : nil,
                            isPlain: true,
                            alwaysShowPlaceholder: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("documentTitle")
                .padding(.bottom, 18)
        }
        // Align with block text, which sits after the 22pt drag-handle gutter.
        .padding(.leading, 22)
    }
}

struct IconPicker: View {
    var onPick: (String?) -> Void
    private let icons = ["📄", "📝", "📚", "🗂", "🌿", "☕️", "🧭", "🗺", "✈️", "🏔", "🌊", "💡", "🎯", "📅", "✅", "🧪", "🎨", "🎵", "🍳", "🏡", "💼", "🔖", "⭐️", "🌙"]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            LazyVGrid(columns: Array(repeating: GridItem(.fixed(32)), count: 6), spacing: 6) {
                ForEach(icons, id: \.self) { icon in
                    Button(icon) { onPick(icon) }
                        .buttonStyle(.plain)
                        .font(.system(size: 22))
                        .accessibilityLabel(Text(icon))
                }
            }
            Button("Remove Icon") { onPick(nil) }
        }
        .padding(12)
    }
}

struct LinkPromptView: View {
    @State var initial: String
    var onSubmit: (String) -> Void
    var onCancel: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Link").font(.headline)
            TextField("https://", text: $initial)
                .textFieldStyle(.roundedBorder)
                .frame(width: 320)
                .onSubmit { onSubmit(initial) }
            HStack {
                Button("Remove Link") { onSubmit("") }
                Spacer()
                Button("Cancel", role: .cancel, action: onCancel).keyboardShortcut(.cancelAction)
                Button("Apply") { onSubmit(initial) }.keyboardShortcut(.defaultAction)
            }
        }
        .padding(20)
    }
}

// MARK: - Conflicts

struct ConflictBanner: View {
    @Bindable var model: EditorModel
    @State private var reviewing: ConflictRecord?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(model.conflicts) { conflict in
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: "exclamationmark.2").foregroundStyle(FoleviColor.coralInk).accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(conflict.reason == .deleted ? "A block you edited was deleted on another device." : "This block was changed on another device while you were editing.")
                            .font(.callout.weight(.medium))
                        Text(RichText.plainText(conflict.client.inlineText).prefix(120))
                            .font(.caption)
                            .foregroundStyle(FoleviColor.inkMuted)
                            .lineLimit(2)
                    }
                    Spacer()
                    Button("Review…") { reviewing = conflict }
                    Button("Keep Mine") { model.resolve(conflict, .mine) }
                    Button("Keep Theirs") { model.resolve(conflict, .theirs) }
                    Button("Keep Both") { model.resolve(conflict, .both) }
                }
                .accessibilityElement(children: .contain)
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: FoleviRadius.card, style: .continuous).fill(FoleviColor.coralSoft))
        .accessibilityIdentifier("conflictBanner")
        .sheet(item: $reviewing) { conflict in
            ConflictMergeSheet(conflict: conflict) { choice in
                model.resolve(conflict, choice)
                reviewing = nil
            }
        }
    }
}

struct ConflictMergeSheet: View {
    var conflict: ConflictRecord
    var onChoose: (ConflictChoice) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Resolve Conflict").font(FoleviType.sectionTitle)
            Text("Folevi kept both versions. Choose what this block should say.")
                .foregroundStyle(FoleviColor.inkMuted)
            HStack(alignment: .top, spacing: 16) {
                version(title: "On this Mac", text: RichText.plainText(conflict.client.inlineText))
                version(title: "On the server", text: conflict.server.map { RichText.plainText($0.inlineText) } ?? String(localized: "(deleted)"))
            }
            HStack {
                Button("Cancel", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
                Spacer()
                Button("Keep Theirs") { onChoose(.theirs) }
                Button("Keep Both") { onChoose(.both) }
                Button("Keep Mine") { onChoose(.mine) }.keyboardShortcut(.defaultAction)
            }
        }
        .padding(24)
        .frame(width: 620)
    }

    private func version(title: LocalizedStringKey, text: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.caption.weight(.semibold)).foregroundStyle(FoleviColor.inkMuted)
            ScrollView {
                Text(text).frame(maxWidth: .infinity, alignment: .leading).textSelection(.enabled)
            }
            .frame(height: 160)
            .padding(10)
            .background(RoundedRectangle(cornerRadius: 8).fill(FoleviColor.surfaceSunken))
        }
        .frame(maxWidth: .infinity)
    }
}
