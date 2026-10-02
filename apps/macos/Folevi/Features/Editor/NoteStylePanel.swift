import UniformTypeIdentifiers
import SwiftUI

// MARK: - Backdrop

/// The page's backdrop, drawn natively: the artwork (aspect fill), a colour backdrop's gradient or the
/// cover's glow. Blurred (the Style panel's "Blur background"): drawn larger than the box and softened,
/// so the blur has no soft edge.
struct PageBackdropView: View {
    var backdrop: PageBackdrop
    var blur: Bool
    /// The full-size artwork for a page; the thumbnail for small previews.
    var thumbnail = false
    var blurRadius: CGFloat = 32
    @Environment(AppModel.self) private var app

    var body: some View {
        GeometryReader { geo in
            let inset: CGFloat = blur ? blurRadius * 2 : 0
            fill
                .frame(width: geo.size.width + inset * 2, height: geo.size.height + inset * 2)
                .offset(x: -inset, y: -inset)
                .blur(radius: blur ? blurRadius : 0)
        }
        .clipped()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    @ViewBuilder private var fill: some View {
        switch backdrop {
        case .art(let id):
            if let image = thumbnail ? CoverArt.thumbnail(id) : (CoverArt.image(id) ?? CoverArt.thumbnail(id)) {
                ArtCoverImage(image: image)
            } else {
                FoleviColor.surfaceSunken
            }
        case .colors(_, let stops):
            LinearGradient(stops: stops.map { Gradient.Stop(color: Color(hex: $0.hex) ?? .clear, location: $0.at) }, startPoint: .top, endPoint: .bottom)
        case .cover(let kind, let accent):
            CoverGlow(accent: Color.folevi(accent: accent), soft: Color.folevi(accentSoft: accent), intensity: kind == .color ? 0.7 : 1)
        case .image(let fileId):
            if let image = CoverImages.shared.image(fileId, app: app) {
                ArtCoverImage(image: image)
            } else {
                FoleviColor.surfaceSunken
            }
        }
    }
}

extension EditorModel {
    /// The page's backdrop (nil: none).
    var pageBackdrop: PageBackdrop? {
        guard let cover = document?.cover else { return nil }
        return PageBackdrop.resolve(style: style, cover: cover) { CoverArt.entry($0) != nil }
    }

    /// Choosing a note style also resets the page's backdrop: it goes back to following the style.
    func setNoteStyle(_ cover: DocumentCover) {
        guard !isReadOnly else { return }
        var s = style
        s.backdrop = nil
        document?.cover = cover
        document?.style = s
        Task { await app.updateDocument(documentId, patch: WireDocumentPatch(cover: cover, style: s)) }
    }
}

// MARK: - Style panel

/// Inspector → Style, as on the web (doc/Inspector.tsx StylePanel): a preview, Note Style (Plain or an
/// artwork, the cover and page background) with Blur background, Document and Text colour, Separator
/// style, Font and Page width.
struct StyleInspector: View {
    @Bindable var model: EditorModel
    @State private var open: String?
    @State private var uploading = false
    @Environment(\.colorScheme) private var colorScheme
    @Environment(AppModel.self) private var app

    static let plainSwatch = Color(hex: "#F1F1F3")!
    static let sheets: [(DocumentSheet, String, String)] = [
        (.white, "White", "#ffffff"), (.paper, "Paper", "#fbf8f2"), (.ivory, "Ivory", "#f4ecdb"), (.mist, "Mist", "#edf1f6"),
        (.sage, "Sage", "#ecf2ea"), (.blush, "Blush", "#f8ecec"), (.night, "Night", "#161618"),
    ]
    static let texts: [(DocumentText, String, String)] = [
        (.ink, "Ink", "#1c1c1f"), (.slate, "Slate", "#3a4758"), (.navy, "Navy", "#23406f"), (.forest, "Forest", "#25543a"),
        (.plum, "Plum", "#5a2d66"), (.brown, "Brown", "#5b3b23"), (.white, "White", "#f2f2f4"),
    ]

    private var style: DocumentStyle { model.style }
    private var cover: DocumentCover { model.document?.cover ?? defaultDocumentCover }
    private var art: CoverArt.Entry? { cover.kind == .art ? CoverArt.entry(cover.value) : nil }
    private var styleName: String {
        PageBackdrop.styleName(cover: cover) { CoverArt.entry($0)?.name }
    }
    private var backdrop: PageBackdrop? { model.pageBackdrop }

    /// Auto colours: the artwork's page and ink (light or dark appearance).
    private var autoPaper: Color? {
        guard let art else { return nil }
        return (colorScheme == .dark ? art.paperDark : art.paper).flatMap(Color.init(hex:))
    }
    private var autoInk: Color? {
        guard let art else { return nil }
        return (colorScheme == .dark ? art.inkDark : art.ink).flatMap(Color.init(hex:))
    }
    private var sheetColor: Color {
        Self.sheets.first { $0.0 == style.sheet }.flatMap { Color(hex: $0.2) } ?? autoPaper ?? FoleviColor.surface
    }
    private var textColor: Color {
        Self.texts.first { $0.0 == style.text }.flatMap { Color(hex: $0.2) } ?? autoInk ?? FoleviColor.ink
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            preview
            VStack(alignment: .leading, spacing: 4) {
                legend("Note Style")
                StyleRow(label: styleName, isOpen: open == "artwork", toggle: { toggle("artwork") }) {
                    ColorDot { noteStyleSwatch }
                } content: {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 8) {
                        Choice(label: "Plain", isOn: cover.kind != .art && !ownImage) { model.setNoteStyle(DocumentCover(kind: .none)) } content: {
                            Text("Plain").font(.ui(11)).foregroundStyle(FoleviColor.inkMuted)
                                .frame(maxWidth: .infinity, maxHeight: .infinity).background(Self.plainSwatch)
                        }
                        if ownImage {
                            Choice(label: "Note style: Your image", isOn: true) {} content: { ownImageSwatch }
                        }
                        ForEach(CoverArt.all) { a in
                            Choice(label: "Note style: \(a.name)", isOn: art?.id == a.id) { model.setNoteStyle(DocumentCover(kind: .art, value: a.id)) } content: {
                                if let image = CoverArt.thumbnail(a.id) { ArtCoverImage(image: image) } else { FoleviColor.surfaceSunken }
                            }
                        }
                    }
                    Button {
                        chooseImage()
                    } label: {
                        HStack(spacing: 8) {
                            if uploading { ProgressView().controlSize(.small) } else { Image(systemName: "photo.badge.plus").font(.system(size: 13)) }
                            Text(uploading ? "Uploading…" : ownImage ? "Replace your image…" : "Upload your own image…").font(.ui(13, .medium))
                        }
                        .foregroundStyle(FoleviColor.heading)
                        .frame(maxWidth: .infinity)
                        .frame(height: 36)
                        .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous)
                            .strokeBorder(FoleviColor.ink.opacity(0.22), style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(model.isReadOnly || uploading)
                    .padding(.top, 10)
                    Text(Self.imageHint)
                        .font(.ui(11.5)).foregroundStyle(FoleviColor.inkFaint)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 2)
                        .padding(.top, 6)
                    Text(art.map { "\($0.name): the cover and page background. Auto colours come from it." }
                         ?? (cover.kind == .image ? String(localized: "Your image: the cover and page background. Auto colours are picked from it.")
                             : String(localized: "Plain: a very light grey page background, no cover.")))
                        .font(.ui(12)).foregroundStyle(FoleviColor.inkMuted)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 8)
                }
                if backdrop != nil {
                    HStack {
                        Text("Blur background").font(.ui(13)).foregroundStyle(FoleviColor.heading).accessibilityHidden(true)
                        Spacer()
                        FoleviSwitch(isOn: Binding(get: { style.blur == true }, set: { on in set { $0.blur = on ? true : nil } }), label: "Blur background")
                    }
                    .padding(.horizontal, 4)
                    .padding(.top, 8)
                }
            }
            // The legend sits 4pt above the rows; the two rows touch, as on the web.
            VStack(alignment: .leading, spacing: 0) {
                legend("Color").padding(.bottom, 4)
                StyleRow(label: "Document color", isOpen: open == "sheet", toggle: { toggle("sheet") }) {
                    ColorDot { sheetColor }
                } content: {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 8) {
                        Choice(label: "Auto (from the note style)", isOn: style.sheet == nil) { set { $0.sheet = nil } } content: {
                            Text("Auto").font(.ui(11)).foregroundStyle(FoleviColor.inkMuted)
                                .frame(maxWidth: .infinity, maxHeight: .infinity).background(autoPaper ?? FoleviColor.surface)
                        }
                        ForEach(Self.sheets, id: \.0) { sheet, name, hex in
                            Choice(label: "Document color: \(name)", isOn: style.sheet == sheet) {
                                set { s in
                                    s.sheet = sheet
                                    if sheet == .night, s.text == nil || s.text == .ink { s.text = .white }
                                    if sheet != .night, s.text == .white { s.text = .ink }
                                }
                            } content: { Color(hex: hex) ?? .clear }
                        }
                    }
                }
                StyleRow(label: "Text color", isOpen: open == "text", toggle: { toggle("text") }) {
                    ColorDot { textColor }
                } content: {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 8) {
                        Choice(label: "Auto (from the note style)", isOn: style.text == nil) { set { $0.text = nil } } content: {
                            Text("Auto").font(.ui(11, .semibold)).foregroundStyle(autoInk ?? FoleviColor.ink)
                                .frame(maxWidth: .infinity, maxHeight: .infinity).background(autoPaper ?? FoleviColor.surface)
                        }
                        ForEach(Self.texts, id: \.0) { text, name, hex in
                            Choice(label: "Text color: \(name)", isOn: style.text == text) { set { $0.text = text } } content: {
                                Text("A").font(.ui(15, .semibold)).foregroundStyle(Color(hex: hex) ?? .primary)
                                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                                    .background(text == .white ? Color(hex: "#1c1c1f")! : .white)
                            }
                        }
                    }
                }
            }
            VStack(alignment: .leading, spacing: 8) {
                legend("Separator style")
                PageSegmented(selection: Binding(get: { style.separator ?? .line }, set: { v in set { $0.separator = v == .line ? nil : v } }), items: [
                    .init(value: SeparatorStyle.line, title: String(localized: "Line"), systemImage: "equal", accessibilityLabel: String(localized: "Separator: Line")),
                    .init(value: .dots, title: String(localized: "Dots"), systemImage: "circle.grid.3x3", accessibilityLabel: String(localized: "Separator: Dots")),
                    .init(value: .doodle, title: String(localized: "Doodle"), systemImage: "scribble", accessibilityLabel: String(localized: "Separator: Doodle")),
                ], label: String(localized: "Separator style"))
            }
            VStack(alignment: .leading, spacing: 8) {
                legend("Font")
                PageSegmented(selection: Binding(get: { style.font }, set: { v in set { $0.font = v } }), items: [
                    .init(value: DocumentFont.sans, title: String(localized: "System"), font: .document(.sans, 12.5, .semibold), accessibilityLabel: String(localized: "Font: System")),
                    .init(value: .serif, title: String(localized: "Serif"), font: .document(.serif, 12.5, .semibold), accessibilityLabel: String(localized: "Font: Serif")),
                    .init(value: .mono, title: String(localized: "Mono"), font: .document(.mono, 12.5, .semibold), accessibilityLabel: String(localized: "Font: Mono")),
                    .init(value: .rounded, title: String(localized: "Rounded"), font: .document(.rounded, 12.5, .semibold), accessibilityLabel: String(localized: "Font: Rounded")),
                ], label: String(localized: "Font"))
            }
            VStack(alignment: .leading, spacing: 8) {
                legend("Page width")
                PageSegmented(selection: Binding(get: { style.width == .wide ? DocumentWidth.wide : .default }, set: { v in set { $0.width = v } }), items: [
                    .init(value: DocumentWidth.default, title: String(localized: "Narrow")), .init(value: .wide, title: String(localized: "Wide")),
                ], label: String(localized: "Page width"))
            }
        }
        .disabled(model.isReadOnly)
    }

    @ViewBuilder private var noteStyleSwatch: some View {
        if let art, let image = CoverArt.thumbnail(art.id) {
            ArtCoverImage(image: image)
        } else if ownImage {
            ownImageSwatch
        } else {
            Self.plainSwatch
        }
    }

    private var ownImage: Bool { cover.kind == .image && cover.value != nil }

    @ViewBuilder private var ownImageSwatch: some View {
        if let id = cover.value, let image = CoverImages.shared.image(id, app: app) {
            ArtCoverImage(image: image)
        } else {
            FoleviColor.surfaceSunken
        }
    }

    static let imageHint = String(localized: "Best at 2400 × 1500 px (16:10, landscape). PNG, JPEG, WebP or GIF, up to 20 MB.")
    static let imageTypes = ["png", "jpg", "jpeg", "webp", "gif"]

    /// A friendly reason the file can't be used (checked before uploading; the server enforces the same).
    static func imageProblem(ext: String, size: Int) -> String? {
        if !imageTypes.contains(ext.lowercased()) { return String(localized: "Choose a PNG, JPEG, WebP or GIF image.") }
        if size > 20 * 1024 * 1024 { return String(localized: "Images can be up to 20 MB.") }
        if size == 0 { return String(localized: "That file is empty.") }
        return nil
    }

    /// Your own image: checked, uploaded into this note (online only), then used as its style.
    private func chooseImage() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = Self.imageTypes.compactMap { UTType(filenameExtension: $0) }
        panel.allowsMultipleSelection = false
        panel.begin { response in
            guard response == .OK, let url = panel.url else { return }
            MainActor.assumeIsolated { upload(url) }
        }
    }

    private func upload(_ url: URL) {
        let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        if let problem = Self.imageProblem(ext: url.pathExtension, size: size) { return app.showToast(problem) }
        guard app.sync.isOnline, let session = app.session else { return app.showToast(String(localized: "Connect to the internet to upload an image.")) }
        uploading = true
        let scope = model.document?.homeScope ?? session.scope
        let id = model.documentId
        Task {
            defer { uploading = false }
            let accessed = url.startAccessingSecurityScopedResource()
            defer { if accessed { url.stopAccessingSecurityScopedResource() } }
            do {
                let result = try await session.files.upload(fileURL: url, scope: scope, documentId: id, kind: "cover")
                model.setNoteStyle(DocumentCover(kind: .image, value: result.fileId))
            } catch {
                app.showToast(ConvexService.mapError(error).localizedDescription)
            }
        }
    }

    // MARK: Preview

    private var preview: some View {
        ZStack(alignment: .top) {
            if let backdrop {
                PageBackdropView(backdrop: backdrop, blur: style.blur == true, thumbnail: true, blurRadius: 14)
            } else {
                LinearGradient(colors: [FoleviColor.surfaceSunken, FoleviColor.canvas], startPoint: .top, endPoint: .bottom)
            }
            GeometryReader { geo in
                VStack(alignment: .leading, spacing: 0) {
                    Text(styleName)
                        .font(.document(style.font, 10.5, .semibold))
                        .foregroundStyle(textColor)
                        .lineLimit(1)
                    Capsule().fill(textColor.opacity(0.25)).frame(width: geo.size.width * 0.38 * 0.8 - 16, height: 4).padding(.top, 6)
                    Capsule().fill(textColor.opacity(0.25)).frame(width: geo.size.width * 0.38 * 0.6 - 16, height: 4).padding(.top, 4)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 8)
                .padding(.top, 8)
                .frame(width: geo.size.width * 0.38, height: geo.size.height - 12, alignment: .topLeading)
                .background(UnevenRoundedRectangle(topLeadingRadius: 6, topTrailingRadius: 6, style: .continuous).fill(sheetColor)
                    .shadow(color: .black.opacity(0.35), radius: 9, y: 6))
                .position(x: geo.size.width / 2, y: 12 + (geo.size.height - 12) / 2)
            }
        }
        .frame(height: 128)
        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        .shadow(color: .black.opacity(0.08), radius: 2, y: 1)
        .accessibilityHidden(true)
    }

    // MARK: Helpers

    private func legend(_ title: LocalizedStringKey) -> some View {
        Text(title).foleviCapsLabel().padding(.horizontal, 4).accessibilityAddTraits(.isHeader)
    }

    private func toggle(_ key: String) { open = open == key ? nil : key }

    private func set(_ change: (inout DocumentStyle) -> Void) {
        var s = model.style
        change(&s)
        model.setStyle(s)
    }
}

/// A row that opens a choice grid under it (StyleRow): label left, swatch right.
private struct StyleRow<Swatch: View, Content: View>: View {
    var label: String
    var isOpen: Bool
    var toggle: () -> Void
    @ViewBuilder var swatch: () -> Swatch
    @ViewBuilder var content: () -> Content
    @State private var hovering = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button(action: toggle) {
                HStack {
                    Text(label).font(.ui(13.5)).foregroundStyle(FoleviColor.ink)
                    Spacer()
                    swatch()
                }
                .padding(.horizontal, 4)
                .frame(height: 40)
                .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(hovering ? FoleviColor.accentSoft.opacity(0.6) : .clear))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .onHover { hovering = $0 }
            .accessibilityValue(Text(isOpen ? "Expanded" : "Collapsed"))
            if isOpen {
                VStack(alignment: .leading, spacing: 0) { content() }
                    .padding(10)
                    .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(FoleviColor.surfaceSunken.opacity(0.7)))
                    .padding(.top, 4)
                    .padding(.bottom, 8)
            }
        }
    }
}

/// The 36 × 28 swatch at the end of a style row.
private struct ColorDot<Fill: View>: View {
    @ViewBuilder var fill: () -> Fill
    var body: some View {
        fill()
            .frame(width: 36, height: 28)
            .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(.black.opacity(0.08), lineWidth: 1))
            .accessibilityHidden(true)
    }
}

/// One choice in a style grid: ringed when chosen.
private struct Choice<Content: View>: View {
    var label: String
    var isOn: Bool
    var pick: () -> Void
    @ViewBuilder var content: () -> Content
    @State private var hovering = false

    var body: some View {
        Button(action: pick) {
            content()
                .frame(maxWidth: .infinity)
                .frame(height: 36)
                .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(.black.opacity(isOn ? 0 : 0.08), lineWidth: 1))
                .padding(isOn ? 2 : 0)
                .overlay { if isOn { RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(FoleviColor.heading, lineWidth: 2) } }
                .offset(y: hovering ? -1 : 0)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .animation(.easeOut(duration: FoleviMotion.fast), value: hovering)
        .help(Text(label))
        .accessibilityLabel(Text(label))
        .accessibilityAddTraits(isOn ? [.isSelected] : [])
    }
}

/// A small on/off switch drawn in the app's style (the web's Switch).
struct FoleviSwitch: View {
    @Binding var isOn: Bool
    var label: String
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Button {
            withAnimation(reduceMotion ? nil : .easeOut(duration: FoleviMotion.fast)) { isOn.toggle() }
        } label: {
            Capsule()
                .fill(isOn ? FoleviColor.ember : FoleviColor.lineStrong)
                .frame(width: 36, height: 20)
                .overlay(alignment: isOn ? .trailing : .leading) {
                    Circle().fill(.white).frame(width: 16, height: 16).padding(2)
                        .shadow(color: .black.opacity(0.2), radius: 1, y: 1)
                }
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .opacity(isEnabled ? 1 : 0.5)
        .accessibilityLabel(Text(label))
        .accessibilityValue(Text(isOn ? "On" : "Off"))
        .accessibilityAddTraits(.isToggle)
    }
}
