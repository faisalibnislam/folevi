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
            if showFind.wrappedValue { findBar.padding(.top, 10).padding(.trailing, 24) }
        }
        .onAppear {
            model.undoManager = undoManager
            model.openDocumentHandler = openDocument
            model.drag.model = model
        }
        .onChange(of: undoManager) { _, new in model.undoManager = new }
        .onChange(of: app.remoteRevision[model.documentId]) { _, _ in model.scheduleReload() }
        .onChange(of: app.blockRevision[model.documentId]) { _, _ in model.scheduleReload() }
        .onChange(of: app.documentsRevision) { _, _ in model.documentChanged() }
        .onChange(of: model.containerFocusToken) { _, _ in containerFocused = true }
        .onChange(of: app.editorScale, initial: true) { _, s in model.drag.indentStep = BlockMetrics.indent(CGFloat(s)) }
        .sheet(isPresented: $model.showLinkPrompt) {
            LinkPromptView(initial: model.linkDraft) { model.applyLink($0) } onCancel: { model.showLinkPrompt = false }
        }
    }

    /// Sheet side padding (64 each side); the hover gutter lives inside the left padding.
    private static let sheetPadding: CGFloat = 64

    private var content: some View {
        ScrollViewReader { proxy in
            ScrollView {
                sheet
                    .frame(maxWidth: pageWidth + Self.sheetPadding * 2)
                    .padding(.horizontal, 28)
                    .padding(.top, 10)
                    .padding(.bottom, 56)
                    .frame(maxWidth: .infinity)
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

    private var sheet: some View {
        VStack(alignment: .leading, spacing: 0) {
            DocumentHeaderView(model: model, openDocument: openDocument, sidePadding: Self.sheetPadding)
            VStack(alignment: .leading, spacing: 0) {
                if !model.conflicts.isEmpty {
                    ConflictBanner(model: model)
                        .padding(.leading, BlockMetrics.gutter)
                        .padding(.bottom, 16)
                }
                if model.isReadOnly, model.document?.deletedAt == nil {
                    Label("You can view this document but not edit it.", systemImage: "lock")
                        .font(.ui(12.5, .medium))
                        .foregroundStyle(FoleviColor.inkMuted)
                        .padding(.horizontal, 10)
                        .frame(height: 26)
                        .background(Capsule().fill(FoleviColor.surfaceSunken))
                        .padding(.leading, BlockMetrics.gutter)
                        .padding(.bottom, 12)
                }
                ForEach(model.rows) { row in
                    BlockRowView(row: row, model: model, openDocument: openDocument)
                        .id(row.id)
                        .zIndex(model.popup?.blockId == row.id ? 10 : 0)
                }
                // Clicking below the last block continues writing.
                Color.clear
                    .frame(height: 120)
                    .contentShape(Rectangle())
                    .onTapGesture { continueWriting() }
                    .accessibilityHidden(true)
            }
            .coordinateSpace(.named("blocks"))
            .background(BlocksAnchor(controller: model.drag))
            .padding(.leading, Self.sheetPadding - BlockMetrics.gutter)
            .padding(.trailing, Self.sheetPadding)
            .padding(.bottom, 40)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background { sheetBackground }
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

    /// The page sheet: surface (per page background), radius 22, sheet shadow.
    private var sheetBackground: some View {
        let accentSoft = Color.folevi(accentSoft: model.style.accent)
        let fill: SurfaceFill
        switch model.style.background {
        case .plain: fill = .color(FoleviColor.surfaceRaised)
        case .tinted: fill = .color(accentSoft.mix(with: FoleviColor.surface, by: 0.55))
        case .grid: fill = .color(FoleviColor.surface)
        default: fill = .gradient([FoleviColor.surface, FoleviColor.surface.mix(with: FoleviColor.glowPeach, by: 0.04)])
        }
        return Color.clear
            .foleviSurface(fill, shape: .rounded(FoleviRadius.sheet), shadow: FoleviShadow.sheet)
            .overlay {
                if model.style.background == .grid {
                    GridPaper()
                        .clipShape(RoundedRectangle(cornerRadius: FoleviRadius.sheet, style: .continuous))
                }
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
                    .font(.ui(11.5))
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
            var x: CGFloat = step
            while x < size.width {
                path.addRect(CGRect(x: x, y: 0, width: 1, height: size.height))
                x += step
            }
            var y: CGFloat = step
            while y < size.height {
                path.addRect(CGRect(x: 0, y: y, width: size.width, height: 1))
                y += step
            }
            ctx.fill(path, with: .color(FoleviColor.line.opacity(0.45)))
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

// MARK: - Header

struct DocumentHeaderView: View {
    @Bindable var model: EditorModel
    var openDocument: (String, Bool) -> Void
    var sidePadding: CGFloat = 64
    @Environment(AppModel.self) private var app
    @State private var showIconPicker = false
    @State private var hovering = false

    private var hasCover: Bool {
        let kind = model.document?.cover.kind
        return kind == .color || kind == .gradient || kind == .art
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if hasCover {
                CoverView(cover: model.document?.cover, style: model.style)
                    .frame(height: 168)
                    .clipShape(UnevenRoundedRectangle(topLeadingRadius: FoleviRadius.sheet, topTrailingRadius: FoleviRadius.sheet, style: .continuous))
                    .overlay(alignment: .bottom) { FoleviColor.line.opacity(0.6).frame(height: 1) }
                    .accessibilityHidden(true)
            } else {
                Color.clear.frame(height: 48)
            }
            VStack(alignment: .leading, spacing: 0) {
                iconButton
                    .padding(.top, hasCover ? -38 : 0)
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
                    .padding(.top, 18)
                    .padding(.bottom, 18)
            }
            .padding(.horizontal, sidePadding)
        }
        .onHover { hovering = $0 }
    }

    @ViewBuilder private var iconButton: some View {
        let icon = model.document?.icon.flatMap { $0.isEmpty ? nil : $0 }
        if icon != nil || !model.isReadOnly {
            Button {
                if !model.isReadOnly { showIconPicker = true }
            } label: {
                if let icon {
                    Text(icon)
                        .font(.system(size: 42 * CGFloat(app.editorScale)))
                        .frame(width: 76, height: 76)
                        .foleviSurface(.color(FoleviColor.surfaceRaised), shape: .rounded(20), shadow: FoleviShadow.control)
                } else {
                    Label("Add Icon", systemImage: "face.smiling")
                        .font(.ui(12.5, .semibold))
                        .foregroundStyle(FoleviColor.inkMuted)
                        .padding(.horizontal, 12)
                        .frame(height: 28)
                        .foleviSurface(.color(FoleviColor.surfaceRaised), shape: .capsule, shadow: FoleviShadow.control)
                        .opacity(hovering || hasCover ? 1 : 0)
                        .padding(.top, hasCover ? 48 : 0)
                }
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(icon.map { "Page icon \($0). Change icon" } ?? "Add page icon"))
            .popover(isPresented: $showIconPicker) { IconPicker { icon in model.setIcon(icon); showIconPicker = false } }
        }
    }
}

/// The cover band inside the sheet top (a cover's own color wins; "accent" is ember).
struct CoverView: View {
    var cover: DocumentCover?
    var style: DocumentStyle

    var body: some View {
        let key = cover?.value.flatMap(DocumentAccent.init(rawValue:)) ?? style.accent
        if cover?.kind == .art, let image = CoverArt.image(cover?.value) {
            ArtCoverImage(image: image)
        } else {
            // Unknown art ids fall back to the gradient cover.
            CoverGlow(accent: Color.folevi(accent: key), soft: Color.folevi(accentSoft: key), intensity: cover?.kind == .color ? 0.7 : 1)
        }
    }
}

/// Soft multi-glow: the accent glowing in from the top right, rose from the bottom left, over
/// accent-soft → surface.
struct CoverGlow: View {
    var accent: Color
    var soft: Color
    var intensity: Double = 1

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            ZStack {
                LinearGradient(colors: [soft.opacity(0.35 + 0.65 * intensity), FoleviColor.surface], startPoint: .top, endPoint: .bottom)
                EllipticalGradient(gradient: Gradient(stops: [.init(color: accent.opacity(0.5 * intensity), location: 0), .init(color: accent.opacity(0), location: 1)]),
                                   center: .center, startRadiusFraction: 0, endRadiusFraction: 0.5)
                    .frame(width: max(w * 1.1, 320), height: h * 2.2)
                    .position(x: w, y: 0)
                EllipticalGradient(gradient: Gradient(stops: [.init(color: FoleviColor.glowRose.opacity(0.55 * intensity), location: 0), .init(color: FoleviColor.glowRose.opacity(0), location: 1)]),
                                   center: .center, startRadiusFraction: 0, endRadiusFraction: 0.5)
                    .frame(width: max(w * 0.8, 240), height: h * 1.6)
                    .position(x: 0, y: h)
            }
            .frame(width: w, height: h)
            .clipped()
        }
        .accessibilityHidden(true)
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
                        .font(.ui(22))
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
            Text("Link").font(.ui(14, .semibold))
            TextField("https://", text: $initial)
                .textFieldStyle(.folevi)
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
                            .font(.ui(12.5, .medium))
                        Text(RichText.plainText(conflict.client.inlineText).prefix(120))
                            .font(.ui(11.5))
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
            Text("Resolve Conflict").font(FoleviType.sectionTitle).foregroundStyle(FoleviColor.heading)
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
            Text(title).font(.ui(11.5, .semibold)).foregroundStyle(FoleviColor.inkMuted)
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
