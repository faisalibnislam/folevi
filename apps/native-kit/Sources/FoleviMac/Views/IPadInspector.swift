// The iPad note's tools in the system inspector (the owner, 2026-11-24: "native like the Mac", whose window shows
// its inspector on the right): Style, Format, Insert and Foli AI, picked with the system's segmented control at its
// top. The panels are the iPhone's own native ones (FoleviDesign/Phone: PhoneStyleSheetContent,
// PhoneFormatSheetContent, PhoneInsertSheetContent) and the window's Foli AI chat (AiThreadView), fed from the
// page's editor state and sent to the page as editor commands, so the page no longer draws its own tools panel on
// the iPad: a panel the page opens (its bar's Style, Format, Insert or Foli AI) opens here instead (IPadFrameView).
#if os(iOS)
import SwiftUI
import UIKit
import FoleviDesign
import FoleviEngine
import FoleviScreens

/// The inspector's tools, in the page bar's order.
enum IPadNoteTool: String, CaseIterable, Identifiable {
    case style, format, insert, ai
    var id: String { rawValue }

    var title: String {
        switch self {
        case .style: "Style"
        case .format: "Format"
        case .insert: "Insert"
        case .ai: "Foli AI"
        }
    }

    /// The tool for a panel the page asked for (nil: one the page keeps drawing itself, such as comments).
    init?(_ panel: EditorPanel) {
        switch panel {
        case .style: self = .style
        case .format: self = .format
        case .insert: self = .insert
        case .ai: self = .ai
        default: return nil
        }
    }
}

@MainActor
struct IPadNoteInspector: View {
    @Bindable var model: FrameModel
    @Binding var tool: IPadNoteTool
    let askAi: AiAskState
    @State private var style: ValueStore<NoteStyleValue>?
    @State private var styleFor: String?
    @State private var gallery = false
    @State private var askingLink = false
    @State private var linkText = ""

    var body: some View {
        VStack(spacing: 0) {
            Picker("Tool", selection: $tool) {
                ForEach(IPadNoteTool.allCases) { t in Text(t.title).tag(t) }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            Group {
                switch tool {
                case .style: styleTool
                case .format: ScrollView { PhoneFormatSheetContent(state: formatState) { runFormat($0) }.padding(.bottom, 16) }
                case .insert: ScrollView { PhoneInsertSheetContent(scanner: false, stockPhotos: model.session.value?.mode != .local) { insert($0) }.padding(.bottom, 16) }
                case .ai: AiThreadView(model: askAi.model, variant: .floating, host: aiHost)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        .phoneNativeChrome()
        .onChange(of: model.route.noteId, initial: true) { _, id in watchStyle(id) }
        .sheet(isPresented: $gallery) {
            NavigationStack {
                ScrollView {
                    PhoneThemeGallery(state: Self.state(style?.value)) { id in
                        gallery = false
                        runStyle(.theme(id))
                    }
                }
                .navigationTitle("All themes")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { gallery = false } } }
            }
        }
        .alert(model.editorState?.link == true ? "Edit link" : "Add link", isPresented: $askingLink) {
            TextField("Paste or type a link", text: $linkText)
                .textInputAutocapitalization(.never)
                .keyboardType(.URL)
            Button("Cancel", role: .cancel) { model.editor(.focus) }
            if model.editorState?.link == true {
                Button("Remove link", role: .destructive) { model.editor(.link(href: nil)) }
            }
            Button(model.editorState?.link == true ? "Update" : "Link") {
                let href = linkText.trimmingCharacters(in: .whitespacesAndNewlines)
                if href.isEmpty { model.editor(.focus) } else { model.editor(.link(href: href)) }
            }
        }
    }

    private var aiHost: AiHost {
        AiHost(session: model.session.value, frame: model, openSettings: { [weak model] s in model?.host?.frameOpenSettings(section: s) })
    }

    // MARK: Style

    @ViewBuilder private var styleTool: some View {
        ScrollView {
            PhoneStyleSheetContent(state: Self.state(style?.value)) { runStyle($0) }.padding(.bottom, 16)
        }
    }

    private func watchStyle(_ id: String?) {
        guard id != styleFor else { return }
        styleFor = id
        style = id.map { model.client.watch(.noteStyle(id: $0)) }
    }

    /// The note's `note.style` as the Style panel draws it (the iPhone's NoteStyleSheet does the same).
    static func state(_ v: NoteStyleValue?) -> PhoneStyleState {
        var s = PhoneStyleState()
        guard let v else { return s }
        s.canEdit = v.canEdit
        s.current = v.current
        s.styleName = v.styleName
        s.themeId = v.themeId
        s.ownImage = v.ownImage
        s.themes = v.themes.map { PhoneStyleState.Theme(id: $0.id, name: $0.name, thumb: $0.thumb, locked: $0.locked) }
        s.hasBackdrop = v.hasBackdrop
        s.blur = v.blur
        s.sheet = v.sheet
        s.text = v.text
        s.sheetColor = v.sheetColor
        s.textColor = v.textColor
        s.autoPaper = v.autoPaper
        s.autoInk = v.autoInk
        s.font = v.font
        s.separator = v.separator
        s.width = v.width
        s.sheets = v.sheets.map { PhoneStyleState.Choice(id: $0.id, name: $0.name, color: $0.color) }
        s.texts = v.texts.map { PhoneStyleState.Choice(id: $0.id, name: $0.name, color: $0.color) }
        s.fonts = v.fonts.map { PhoneStyleState.Choice(id: $0.id, name: $0.name) }
        s.separators = v.separators.map { PhoneStyleState.Choice(id: $0.id, name: $0.name) }
        return s
    }

    private func runStyle(_ action: PhoneStyleAction) {
        guard let noteId = model.route.noteId else { return }
        UISelectionFeedbackGenerator().selectionChanged()
        var a = NoteStyleSetArgs(id: noteId)
        switch action {
        case .allThemes:
            gallery = true
            return
        case .theme(let id):
            model.perform { _ = try await model.client.command(.noteThemeSet(id: noteId, theme: id)) }
            return
        case .blur(let on): a.blur = on
        case .sheet(let id): a.sheet = id.map { .set($0) } ?? .clear
        case .text(let id): a.text = id.map { .set($0) } ?? .clear
        case .font(let f): a.font = f
        case .separator(let sep): a.separator = sep
        case .width(let w): a.width = w
        }
        model.perform { _ = try await model.client.command(Commands.NoteStyleSet(a)) }
    }

    // MARK: Format

    /// The line at the caret (`editor.state` with its `format`), as the iPhone's Format sheet reads it.
    private var formatState: PhoneFormatState {
        var f = PhoneFormatState()
        guard let s = model.editorState else { return f }
        f.canEdit = s.canEdit
        f.block = s.block
        f.marks = Set(s.marks.map(\.rawValue))
        f.link = s.link
        if let fmt = s.format {
            f.textStyle = fmt.textStyle?.rawValue
            f.textColor = fmt.textColor
            f.highlight = fmt.highlight
            f.align = fmt.align.rawValue
            f.group = fmt.group.rawValue
            f.decoration = fmt.decoration
            f.calloutTone = fmt.calloutTone?.rawValue
            f.codeLanguage = fmt.codeLanguage
            f.blockTools = fmt.blockTools
        }
        return f
    }

    private func runFormat(_ action: PhoneFormatAction) {
        UISelectionFeedbackGenerator().selectionChanged()
        var a = FormatSetArgs()
        switch action {
        case .mark(let m):
            if let mark = EditorMark(rawValue: m) { model.editor(.format(mark: mark)) }
            return
        case .block(let b):
            if let block = EditorBlock(rawValue: b) { model.editor(.format(block: block)) }
            return
        case .indent: return model.editor(.indent)
        case .outdent: return model.editor(.outdent)
        case .link:
            linkText = ""
            askingLink = true
            return
        case .removeLink: return model.editor(.link(href: nil))
        case .textStyle(let t): a.textStyle = TextStyleName(rawValue: t)
        case .group(let g): a.group = FormatSetArgs.Group(rawValue: g)
        case .align(let al): a.align = BlockAlign(rawValue: al)
        case .textColor(let c): a.textColor = c.map { .set($0) } ?? .clear
        case .highlight(let h): a.highlight = h.map { .set($0) } ?? .clear
        case .decoration(let d): a.decoration = d.map { .set($0) } ?? .clear
        case .clear: a.clear = true
        case .calloutTone(let t): a.calloutTone = CalloutTone(rawValue: t)
        case .codeLanguage(let l): a.codeLanguage = l
        }
        model.editor(EditorCommands.FormatSet(a))
    }

    // MARK: Insert

    private func insert(_ kind: String) {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        model.editor(.insert(kind: kind))
    }
}
#endif
