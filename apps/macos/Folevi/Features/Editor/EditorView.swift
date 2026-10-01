import SwiftUI
import UniformTypeIdentifiers

/// The document page (the web's DocumentView): the note floats on its backdrop in a rounded panel; the
/// sheet holds the header (cover and title), a conflict banner and the blocks; "Linked from" follows the
/// sheet. The find bar floats at the top right, the dock and its panels at the bottom (MainWindowView).
struct EditorView: View {
    @Bindable var model: EditorModel
    var openDocument: (String, Bool) -> Void
    @Environment(AppModel.self) private var app
    @Environment(\.undoManager) private var undoManager
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorScheme) private var colorScheme
    @FocusState private var containerFocused: Bool
    var showFind: Binding<Bool>
    /// The window's navigation (breadcrumbs, the open panel); nil in previews.
    var nav: NavigationModel? = nil
    @State private var viewportHeight: CGFloat = 800

    private var pageWidth: CGFloat {
        switch model.style.width {
        case .narrow: return FoleviLayout.editorWidthNarrow
        case .default: return FoleviLayout.editorWidthDefault
        case .wide: return FoleviLayout.editorWidthWide
        }
    }

    /// The page's side padding inside the sheet (px-16); the hover gutter lives inside it.
    static let sheetPadding: CGFloat = 64

    var body: some View {
        VStack(spacing: 0) {
            PageChromeBar(model: model, nav: nav)
            ZStack(alignment: .top) {
                switch model.loadState {
                case .unavailable(let message):
                    UnavailablePage(message: message, nav: nav)
                default:
                    content
                }
            }
            .overlay(alignment: .topTrailing) {
                if showFind.wrappedValue, model.loadState == .ready {
                    FindReplaceBar(model: model, showFind: showFind)
                        .padding(.top, 12)
                        .padding(.trailing, 20)
                        .padding(.leading, 20)
                        .transition(.offset(y: -6).combined(with: .opacity))
                }
            }
        }
        .task(id: model.documentId) { model.comments.start() }
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
        .onChange(of: PaletteKey(style: model.style, cover: model.document?.cover, dark: colorScheme == .dark), initial: true) { _, key in
            let palette = key.cover.flatMap { SheetPalette.resolve(style: key.style, cover: $0, dark: key.dark) }
                ?? (key.style.sheet != nil ? SheetPalette.resolve(style: key.style, cover: DocumentCover(kind: .none, value: nil), dark: key.dark) : nil)
            if model.sheetPalette != palette { model.sheetPalette = palette }
        }
        .onChange(of: app.editorScale, initial: true) { _, s in model.drag.indentStep = BlockMetrics.indent(CGFloat(s)) }
        .sheet(item: $model.recordingTarget) { _ in AudioRecorderSheet(model: model).environment(app) }
        .sheet(isPresented: Binding(get: { model.unsplashAnchor != nil }, set: { if !$0 { model.unsplashAnchor = nil } })) {
            if let anchor = model.unsplashAnchor { UnsplashSheet(model: model, anchor: anchor).environment(app) }
        }
        .sheet(isPresented: $model.showLinkPrompt) {
            LinkPromptView(initial: model.linkDraft) { model.applyLink($0) } onCancel: { model.showLinkPrompt = false }
        }
    }

    // MARK: Page panel

    private var inspectorOpen: Bool { nav?.showInspector == true }

    private var content: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 0) {
                    sheet
                        .frame(maxWidth: pageWidth + Self.sheetPadding * 2)
                        .frame(maxWidth: .infinity)
                    if model.loadState == .ready {
                        BacklinksSection(model: model, nav: nav, openDocument: openDocument)
                            .frame(maxWidth: pageWidth + Self.sheetPadding * 2)
                            .frame(maxWidth: .infinity)
                    }
                }
                .padding(.horizontal, 32)
                .padding(.top, 32)
                // Room for the dock, or for the panel floating over the note.
                .padding(.bottom, inspectorOpen ? min(700, viewportHeight * 0.7) : 112)
            }
            .scrollContentBackground(.hidden)
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { viewportHeight = $0 }
            .background { panelBackground }
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(FoleviGlass.border))
            .shadow(color: .black.opacity(0.04), radius: 1, y: 1)
            .shadow(color: Color(red: 20 / 255, green: 20 / 255, blue: 40 / 255).opacity(0.14), radius: 16, y: 12)
            .padding(.horizontal, 8)
            .padding(.bottom, 8)
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
                withAnimation(reduceMotion ? nil : .easeOut(duration: FoleviMotion.base)) { proxy.scrollTo(id, anchor: .center) }
            }
            .onChange(of: model.page.scrollTopToken) { _, _ in
                withAnimation(reduceMotion ? nil : .easeOut(duration: FoleviMotion.base)) { proxy.scrollTo("page.top", anchor: .top) }
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

    /// The panel behind the page: the note's backdrop (blurred when the note asks), or the sunken surface.
    @ViewBuilder private var panelBackground: some View {
        if let backdrop = model.pageBackdrop {
            PageBackdropView(backdrop: backdrop, blur: model.style.blur == true && !reduceTransparency)
                .transition(.opacity)
        } else {
            FoleviColor.surfaceSunken
        }
    }

    private var sheet: some View {
        VStack(alignment: .leading, spacing: 0) {
            Color.clear.frame(height: 0).id("page.top")
            DocumentHeaderView(model: model, openDocument: openDocument, sidePadding: Self.sheetPadding)
            if !model.conflicts.isEmpty {
                ConflictBanner(model: model)
                    .padding(.horizontal, Self.sheetPadding)
                    .padding(.bottom, 20)
            }
            if model.loadState == .ready {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(model.rows) { row in
                        BlockRowView(row: row, model: model, openDocument: openDocument)
                            .blockComments(model: model, row: row)
                            .id(row.id)
                            .zIndex(model.popup?.blockId == row.id || model.datePick?.blockId == row.id || model.comments.openBlockId == row.id ? 10 : 0)
                    }
                    // Clicking below the last block continues writing (the editor's 30vh of room below).
                    Color.clear
                        .frame(height: max(120, viewportHeight * 0.3))
                        .contentShape(Rectangle())
                        .onTapGesture { continueWriting() }
                        .accessibilityHidden(true)
                }
                .coordinateSpace(.named("blocks"))
                .background(BlocksAnchor(controller: model.drag))
                .padding(.leading, Self.sheetPadding - BlockMetrics.gutter)
                .padding(.trailing, Self.sheetPadding)
            } else {
                LoadingBlocks()
                    .padding(.horizontal, Self.sheetPadding)
                    .padding(.bottom, max(120, viewportHeight * 0.3))
            }
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

    /// The page sheet (fb-sheet ui-sheet): the note's page colour (SheetPalette) or the surface per page
    /// background, radius 10, the sheet shadow.
    private var sheetBackground: some View {
        let accentSoft = Color.folevi(accentSoft: model.style.accent)
        let fill: SurfaceFill
        if let palette = model.sheetPalette {
            fill = .color(palette.surface)
        } else {
            switch model.style.background {
            case .plain: fill = .color(FoleviColor.surfaceRaised)
            case .tinted: fill = .color(accentSoft.mix(with: FoleviColor.surface, by: 0.55))
            case .paper: fill = .gradient([FoleviColor.surface, FoleviColor.surface.mix(with: FoleviColor.glowPeach, by: 0.03)])
            default: fill = .color(FoleviColor.surface)
            }
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
}

/// The page's skeleton while its blocks load.
private struct LoadingBlocks: View {
    @State private var pulse = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        GeometryReader { geo in
            VStack(alignment: .leading, spacing: 12) {
                ForEach(Array([0.8, 0.95, 0.6, 0.88].enumerated()), id: \.offset) { _, w in
                    RoundedRectangle(cornerRadius: 4, style: .continuous)
                        .fill(FoleviColor.surfaceSunken)
                        .frame(width: geo.size.width * w, height: 16)
                }
            }
            .padding(.vertical, 24)
        }
        .frame(height: 136)
        .opacity(pulse ? 0.5 : 1)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 1).repeatForever(autoreverses: true)) { pulse = true }
        }
        .accessibilityElement()
        .accessibilityLabel(Text("Loading document"))
    }
}

/// "This page isn’t available" (deleted, no access), or why it can't open offline.
private struct UnavailablePage: View {
    var message: String
    var nav: NavigationModel?
    @Environment(AppModel.self) private var app

    var body: some View {
        VStack(spacing: 0) {
            Text(app.sync.isOnline ? String(localized: "This page isn’t available") : String(localized: "Not available offline"))
                .font(FoleviType.display(36))
                .tracking(FoleviType.displayTracking(36))
                .foregroundStyle(FoleviColor.heading)
                .multilineTextAlignment(.center)
                .accessibilityAddTraits(.isHeader)
            Text(app.sync.isOnline
                 ? String(localized: "It may have been deleted, or you don’t have access. If someone shared it with you, ask them to check the sharing settings.")
                 : message)
                .font(.ui(16))
                .foregroundStyle(FoleviColor.inkMuted)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 12)
            if let nav {
                Button {
                    nav.selection = .all
                    nav.closeDocument()
                } label: {
                    Text("Back to Home").underline().foregroundStyle(FoleviColor.accent)
                }
                .buttonStyle(.plain)
                .font(.ui(16))
                .padding(.top, 24)
            }
        }
        .frame(maxWidth: 512)
        .padding(.horizontal, 24)
        .padding(.vertical, 96)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
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

/// The page header, as on the web: with a style, the artwork band (at least 192pt) with a soft shade and the
/// serif title on it, white on deep artwork and the style's ink on light artwork; without one, the title on
/// the page. Pages have no icon (as on the web). An untitled note with some writing offers "Suggest a title".
struct DocumentHeaderView: View {
    @Bindable var model: EditorModel
    var openDocument: (String, Bool) -> Void
    var sidePadding: CGFloat = 64
    @Environment(AppModel.self) private var app
    @State private var suggesting = false

    private var cover: DocumentCover? { model.document?.cover }

    private var ownImage: NSImage? {
        guard cover?.kind == .image, let id = cover?.value else { return nil }
        return CoverImages.shared.image(id, app: app)
    }

    private var onCover: Bool {
        switch cover?.kind {
        case .color, .gradient, .art: return true
        case .image: return cover?.value != nil
        default: return false
        }
    }

    private var art: CoverArt.Entry? { cover?.kind == .art ? CoverArt.entry(cover?.value) : nil }

    /// Whether the band behind the title reads light or deep (a person's image: deep until known).
    private var tone: String? {
        if let art { return art.tone ?? "deep" }
        if cover?.kind == .image { return "deep" }
        return nil
    }

    /// The title's colour on the artwork (nil: the page's heading colour).
    private var titleColor: NSColor? {
        guard onCover, let tone else { return nil }
        if tone == "light", let ink = art?.ink.flatMap(Color.init(hex:)) { return NSColor(ink) }
        return tone == "deep" ? .white : nil
    }

    private var title: some View {
        BlockTextEditor(blockId: "__title__",
                        text: model.titleDraft.isEmpty ? [] : [.text(text: model.titleDraft, marks: nil)],
                        // The title keeps its size at any editor zoom, as on the web.
                        style: BlockStyles.title(style: model.style, scale: 1, palette: model.sheetPalette, color: titleColor),
                        isEditable: !model.isReadOnly,
                        accessibilityLabel: String(localized: "Title"),
                        model: model,
                        focusRequest: model.focus?.blockId == "__title__" ? model.focus : nil,
                        isPlain: true,
                        alwaysShowPlaceholder: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityAddTraits(.isHeader)
            .accessibilityHint(model.isReadOnly ? Text("This document is read-only for you.") : Text(""))
            .accessibilityIdentifier("documentTitle")
            // The title's AI ("Edit with AI" on selected words, ⌘J) floats under it (Features/AI/EditorAiOverlay.swift).
    }

    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: 0) {
            title
            if model.aiWritable, !(model.document?.excerpt ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
               model.titleDraft.trimmingCharacters(in: .whitespaces).isEmpty {
                suggestButton.padding(.top, 8)
            }
        }
    }

    private var suggestButton: some View {
        Button {
            suggest()
        } label: {
            HStack(spacing: 6) {
                AiIcon(size: 13).opacity(suggesting ? 0.5 : 1)
                Text(suggesting ? "Thinking of a title…" : "Suggest a title").font(.ui(12.5, .medium))
            }
            .foregroundStyle(titleColor != nil ? .white : FoleviColor.ink)
            .padding(.horizontal, 12)
            .padding(.vertical, 4)
            .background(titleColor != nil ? Color.black.opacity(0.2) : FoleviGlass.hover, in: Capsule())
            .background(.ultraThinMaterial, in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(suggesting)
        .opacity(suggesting ? 0.6 : 1)
    }

    private func suggest() {
        guard let session = app.session else { return }
        suggesting = true
        let id = model.documentId
        Task {
            defer { suggesting = false }
            do {
                let args: [String: JSONValue] = ["scope": session.scope.arg, "task": "title", "documentId": .string(id)]
                let out: AiWritten = try await session.convex.action("ai:write", args, timeout: 90)
                let text = out.text.trimmingCharacters(in: .whitespacesAndNewlines)
                if !text.isEmpty, model.titleDraft.trimmingCharacters(in: .whitespaces).isEmpty { model.setTitle(text) }
            } catch {
                app.showToast(ConvexService.mapError(error).localizedDescription)
            }
        }
    }

    var body: some View {
        if onCover {
            ZStack(alignment: .bottomLeading) {
                Group {
                    if let image = ownImage {
                        ArtCoverImage(image: image)
                    } else if cover?.kind == .image {
                        FoleviColor.surfaceSunken
                    } else {
                        CoverView(cover: cover, style: model.style)
                    }
                }
                .accessibilityHidden(true)
                if let tone {
                    LinearGradient(stops: [
                        .init(color: .clear, location: 0.35),
                        .init(color: tone == "light" ? .white.opacity(0.45) : .black.opacity(0.4), location: 1),
                    ], startPoint: .top, endPoint: .bottom)
                    .accessibilityHidden(true)
                }
                titleBlock
                    .shadow(color: titleColor == .white ? .black.opacity(0.4) : .white.opacity(0.5), radius: titleColor == nil ? 0 : 7, y: 1)
                    .padding(.horizontal, sidePadding)
                    .padding(.top, 56)
                    .padding(.bottom, 24)
            }
            .frame(minHeight: 192)
            .clipShape(UnevenRoundedRectangle(topLeadingRadius: 6, topTrailingRadius: 6, style: .continuous))
            .overlay(alignment: .bottom) { FoleviColor.line.opacity(0.6).frame(height: 1) }
            .padding(.bottom, 16)
        } else {
            titleBlock
                .padding(.horizontal, sidePadding)
                .padding(.top, 40 + 16)
                .padding(.bottom, 16)
        }
    }
}

/// What the page's colours depend on.
struct PaletteKey: Equatable {
    var style: DocumentStyle
    var cover: DocumentCover?
    var dark: Bool
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
                Button("Remove link") { onSubmit("") }
                Spacer()
                Button("Cancel", role: .cancel, action: onCancel).keyboardShortcut(.cancelAction)
                Button("Apply") { onSubmit(initial) }.keyboardShortcut(.defaultAction)
            }
        }
        .padding(20)
    }
}

// MARK: - Conflicts

/// "This block was changed in two places": both versions side by side, and Keep mine / theirs / both (the
/// web's ConflictBanner). Nothing is lost until you choose.
struct ConflictBanner: View {
    @Bindable var model: EditorModel
    @State private var openId: String?

    var body: some View {
        let conflicts = model.conflicts
        if let c = conflicts.first(where: { $0.id == openId }) ?? conflicts.first {
            VStack(alignment: .leading, spacing: 0) {
                Text(conflicts.count == 1 ? String(localized: "This block was changed in two places")
                     : String(localized: "\(conflicts.count) blocks were changed in two places"))
                    .font(.ui(14, .semibold))
                    .foregroundStyle(FoleviColor.plumInk)
                    .accessibilityAddTraits(.isHeader)
                Text("Both versions are kept. Nothing is lost until you choose.")
                    .font(.ui(14)).foregroundStyle(FoleviColor.ink).padding(.top, 4)
                HStack(alignment: .top, spacing: 12) {
                    version(c.reason == .deleted ? String(localized: "Deleted elsewhere") : String(localized: "Version from elsewhere"),
                            c.reason == .deleted ? String(localized: "Someone deleted this block.") : Self.text(c.server), mine: false)
                    version(String(localized: "Your version"), Self.text(c.client), mine: true)
                }
                .padding(.top, 12)
                HStack(spacing: 8) {
                    Button("Keep mine") { model.resolve(c, .mine) }.buttonStyle(.page(.primary, .sm))
                    Button("Keep theirs") { model.resolve(c, .theirs) }.buttonStyle(.page(.secondary, .sm))
                    if c.reason != .deleted {
                        Button("Keep both") { model.resolve(c, .both) }.buttonStyle(.page(.secondary, .sm))
                    }
                    Spacer()
                    if conflicts.count > 1 {
                        FoleviSelect(selection: Binding(get: { c.id }, set: { openId = $0 }),
                                     options: conflicts.enumerated().map { .init(value: $0.element.id, title: String(localized: "Conflict \($0.offset + 1)")) },
                                     accessibilityLabel: String(localized: "Choose conflict"), height: 32)
                    }
                }
                .padding(.top, 12)
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(FoleviColor.plumSoft, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(FoleviColor.plum.opacity(0.3)))
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("conflictBanner")
        }
    }

    private func version(_ label: String, _ text: String, mine: Bool) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).pageCaps()
            Text(text).font(.ui(14)).foregroundStyle(FoleviColor.ink).fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .foleviCard(radius: 8)
        .overlay { if mine { RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(FoleviColor.ember.opacity(0.45), lineWidth: 2) } }
    }

    /// A block's words for the comparison ("(deleted)" when gone, "(code block)" when it has none).
    static func text(_ b: WireBlock?) -> String {
        guard let b else { return String(localized: "(deleted)") }
        let nodes = b.inlineText
        if nodes.isEmpty { return "(\(b.type) block)" }
        return nodes.map { n -> String in
            switch n {
            case .text(let t, _): return t
            case .mention(_, let label): return "@\(label)"
            case .date(let d): return d
            case .pageLink(_, let label): return label
            }
        }.joined()
    }
}
