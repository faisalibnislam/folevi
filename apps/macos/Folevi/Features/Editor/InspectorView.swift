import SwiftUI

/// Inspector column: Insert, Format, Style, Info and Comments.
struct InspectorView: View {
    @Bindable var model: EditorModel
    @Bindable var nav: NavigationModel
    var openDocument: (String, Bool) -> Void

    var body: some View {
        VStack(spacing: 0) {
            Picker("Inspector", selection: $nav.inspectorTab) {
                ForEach(InspectorTab.allCases) { tab in
                    Image(systemName: tab.systemImage)
                        .help(Text(tab.title))
                        .accessibilityLabel(Text(tab.title))
                        .tag(tab)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .padding(12)
            Divider()
            ScrollView {
                Group {
                    switch nav.inspectorTab {
                    case .insert: InsertInspector(model: model)
                    case .format: FormatInspector(model: model)
                    case .style: StyleInspector(model: model)
                    case .info: InfoInspector(model: model, nav: nav, openDocument: openDocument)
                    case .comments: CommentsInspector(model: model)
                    }
                }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .background(FoleviColor.surface)
    }
}

private struct SectionTitle: View {
    var title: LocalizedStringKey
    var body: some View {
        Text(title).font(.system(size: 11, weight: .semibold)).foregroundStyle(FoleviColor.inkMuted).textCase(.uppercase)
            .accessibilityAddTraits(.isHeader)
    }
}

struct InsertInspector: View {
    @Bindable var model: EditorModel

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionTitle(title: "Insert")
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                ForEach(SlashItem.all.filter { $0.id != "pagelink" }) { item in
                    Button {
                        model.insertBlock(type: item.id)
                    } label: {
                        VStack(spacing: 6) {
                            Image(systemName: item.systemImage).font(.system(size: 16))
                            Text(item.title).font(.system(size: 11)).lineLimit(1)
                        }
                        .frame(maxWidth: .infinity, minHeight: 56)
                        .background(RoundedRectangle(cornerRadius: 8).fill(FoleviColor.surfaceRaised))
                        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(FoleviColor.line))
                    }
                    .buttonStyle(.plain)
                    .disabled(model.isReadOnly)
                }
            }
        }
    }
}

struct FormatInspector: View {
    @Bindable var model: EditorModel

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionTitle(title: "Text")
            HStack(spacing: 6) {
                markButton("bold", "bold", "Bold") { model.toggleMark(.bold) }
                markButton("italic", "italic", "Italic") { model.toggleMark(.italic) }
                markButton("underline", "underline", "Underline") { model.toggleMark(.underline) }
                markButton("strike", "strikethrough", "Strikethrough") { model.toggleMark(.strike) }
                markButton("code", "chevron.left.forwardslash.chevron.right", "Inline Code") { model.toggleMark(.code) }
                markButton("link", "link", "Link") { model.beginLink() }
            }
            SectionTitle(title: "Color")
            HStack(spacing: 8) {
                swatch(nil, FoleviColor.ink, "Default color") { model.setColor(nil) }
                ForEach(TextColor.allCases, id: \.self) { c in
                    swatch(c.rawValue, Color(nsColor: .folevi(text: c)), LocalizedStringKey(c.rawValue.capitalized)) { model.setColor(c) }
                }
            }
            SectionTitle(title: "Highlight")
            HStack(spacing: 8) {
                swatch(nil, FoleviColor.surfaceSunken, "No highlight") { model.setHighlight(nil) }
                ForEach(HighlightColor.allCases, id: \.self) { c in
                    swatch(c.rawValue, Color(nsColor: .folevi(highlight: c)), LocalizedStringKey(c.rawValue.capitalized)) { model.setHighlight(c) }
                }
            }
            Button("Clear Formatting") { model.clearFormatting() }
            SectionTitle(title: "Turn Into")
            VStack(alignment: .leading, spacing: 2) {
                ForEach(TurnIntoOption.all) { option in
                    Button {
                        model.turnInto(option.id)
                    } label: {
                        HStack {
                            Text(option.title)
                            Spacer()
                            Text("⌥⌘\(String(option.shortcut.character))").font(.caption.monospaced()).foregroundStyle(FoleviColor.inkFaint)
                        }
                        .contentShape(Rectangle())
                        .padding(.vertical, 3)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .disabled(model.isReadOnly)
    }

    private func markButton(_ key: String, _ icon: String, _ label: LocalizedStringKey, action: @escaping () -> Void) -> some View {
        let active = model.activeMarks.contains(key)
        return Button(action: action) {
            Image(systemName: icon)
                .frame(width: 30, height: 26)
                .background(RoundedRectangle(cornerRadius: 6).fill(active ? FoleviColor.accentSoft : FoleviColor.surfaceRaised))
                .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(FoleviColor.line))
        }
        .buttonStyle(.plain)
        .help(Text(label))
        .accessibilityLabel(Text(label))
        .accessibilityAddTraits(active ? .isSelected : [])
    }

    private func swatch(_ id: String?, _ color: Color, _ label: LocalizedStringKey, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Circle().fill(color).frame(width: 20, height: 20).overlay(Circle().strokeBorder(FoleviColor.lineStrong))
        }
        .buttonStyle(.plain)
        .help(Text(label))
        .accessibilityLabel(Text(label))
    }
}

struct StyleInspector: View {
    @Bindable var model: EditorModel

    var body: some View {
        let style = model.style
        VStack(alignment: .leading, spacing: 14) {
            SectionTitle(title: "Typeface")
            Picker("Typeface", selection: binding(\.font, style)) {
                Text("Sans").tag(DocumentFont.sans)
                Text("Serif").tag(DocumentFont.serif)
                Text("Mono").tag(DocumentFont.mono)
            }
            .pickerStyle(.segmented).labelsHidden()
            SectionTitle(title: "Page Width")
            Picker("Page Width", selection: binding(\.width, style)) {
                Text("Narrow").tag(DocumentWidth.narrow)
                Text("Default").tag(DocumentWidth.default)
                Text("Wide").tag(DocumentWidth.wide)
            }
            .pickerStyle(.segmented).labelsHidden()
            SectionTitle(title: "Background")
            Picker("Background", selection: binding(\.background, style)) {
                Text("Paper").tag(DocumentBackground.paper)
                Text("Plain").tag(DocumentBackground.plain)
                Text("Tinted").tag(DocumentBackground.tinted)
                Text("Grid").tag(DocumentBackground.grid)
            }
            .pickerStyle(.segmented).labelsHidden()
            SectionTitle(title: "Accent")
            HStack(spacing: 10) {
                ForEach(DocumentAccent.allCases, id: \.self) { accent in
                    Button {
                        var s = style
                        s.accent = accent
                        model.setStyle(s)
                    } label: {
                        Circle().fill(Color.folevi(accent: accent)).frame(width: 22, height: 22)
                            .overlay(Circle().strokeBorder(style.accent == accent ? FoleviColor.ink : .clear, lineWidth: 2))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text(accent.rawValue.capitalized))
                    .accessibilityAddTraits(style.accent == accent ? .isSelected : [])
                }
            }
            SectionTitle(title: "Card Style")
            Picker("Card Style", selection: binding(\.card, style)) {
                Text("Folio").tag(CardStyle.folio)
                Text("Plain").tag(CardStyle.plain)
                Text("Tinted").tag(CardStyle.tinted)
                Text("Outline").tag(CardStyle.outline)
            }
            .labelsHidden()
            SectionTitle(title: "Cover")
            Picker("Cover", selection: Binding(get: { model.document?.cover.kind ?? .none }, set: { model.setCover(DocumentCover(kind: $0)) })) {
                Text("None").tag(CoverKind.none)
                Text("Color").tag(CoverKind.color)
                Text("Gradient").tag(CoverKind.gradient)
            }
            .pickerStyle(.segmented).labelsHidden()
        }
        .disabled(model.isReadOnly)
    }

    private func binding<T>(_ path: WritableKeyPath<DocumentStyle, T>, _ style: DocumentStyle) -> Binding<T> {
        Binding(get: { style[keyPath: path] }, set: { value in
            var s = style
            s[keyPath: path] = value
            model.setStyle(s)
        })
    }
}

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

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionTitle(title: "Document")
            Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 6) {
                row("Words", "\(localWords)")
                row("Characters", "\(localChars)")
                row("Blocks", "\(model.blocks.count)")
                if let d = model.document {
                    row("Created", Date(timeIntervalSince1970: d.createdAt / 1000).formatted(date: .abbreviated, time: .shortened))
                    row("Edited", Date(timeIntervalSince1970: d.updatedAt / 1000).formatted(date: .abbreviated, time: .shortened))
                }
                if let info {
                    row("Created by", info.createdBy)
                    row("Last edited by", info.lastEditedBy)
                }
            }
            .font(.system(size: 12))
            Button("Version History…") { nav.showHistory = true }
            SectionTitle(title: "Backlinks")
            if let backlinks {
                if backlinks.linked.isEmpty && backlinks.unlinked.isEmpty {
                    Text("No other documents link here yet.").font(.callout).foregroundStyle(FoleviColor.inkMuted)
                }
                ForEach(backlinks.linked) { link in linkRow(link) }
                if !backlinks.unlinked.isEmpty {
                    Text("Unlinked mentions").font(.caption).foregroundStyle(FoleviColor.inkMuted)
                    ForEach(backlinks.unlinked) { link in linkRow(link) }
                }
            } else {
                Text(app.sync.isOnline ? "Loading…" : "Backlinks are available when you're online.")
                    .font(.callout).foregroundStyle(FoleviColor.inkMuted)
            }
            if let activity = info?.activity, !activity.isEmpty {
                SectionTitle(title: "Recent Activity")
                ForEach(activity, id: \.self) { a in
                    HStack {
                        Text(a.by).font(.system(size: 12, weight: .medium))
                        Text(reasonText(a.reason)).font(.system(size: 12)).foregroundStyle(FoleviColor.inkMuted)
                        Spacer()
                        Text(Date(timeIntervalSince1970: a.at / 1000), format: .relative(presentation: .named)).font(.caption).foregroundStyle(FoleviColor.inkFaint)
                    }
                }
            }
        }
        .task(id: model.documentId) { await load() }
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
            Text(value).monospacedDigit()
        }
    }

    private func linkRow(_ link: LinkRef) -> some View {
        Button {
            openDocument(link.id, NSEvent.modifierFlags.contains(.option))
        } label: {
            VStack(alignment: .leading, spacing: 2) {
                Text("\(link.icon ?? "📄") \(link.title.isEmpty ? String(localized: "Untitled") : link.title)").font(.system(size: 12, weight: .medium))
                if !link.excerpt.isEmpty { Text(link.excerpt).font(.caption).foregroundStyle(FoleviColor.inkMuted).lineLimit(2) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

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
                Text("Comments are available when you're online.").font(.callout).foregroundStyle(FoleviColor.inkMuted)
            } else if let threads {
                if threads.threads.isEmpty {
                    Text("No comments yet.").font(.callout).foregroundStyle(FoleviColor.inkMuted)
                }
                ForEach(threads.threads) { thread in
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(thread.comments) { c in
                            VStack(alignment: .leading, spacing: 2) {
                                HStack {
                                    Text(c.authorName).font(.system(size: 12, weight: .semibold))
                                    Spacer()
                                    Text(Date(timeIntervalSince1970: c.createdAt / 1000), format: .relative(presentation: .named))
                                        .font(.caption2).foregroundStyle(FoleviColor.inkFaint)
                                }
                                Text(c.deleted ? String(localized: "Comment deleted") : RichText.plainText(c.body)).font(.system(size: 12))
                            }
                        }
                        if thread.status == "resolved" { Label("Resolved", systemImage: "checkmark").font(.caption).foregroundStyle(FoleviColor.success) }
                    }
                    .padding(10)
                    .background(RoundedRectangle(cornerRadius: 8).fill(FoleviColor.surfaceRaised))
                }
                if threads.canComment {
                    TextField("Add a comment", text: $draft, axis: .vertical)
                        .textFieldStyle(.roundedBorder)
                    Button("Comment") { Task { await send() } }
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
                Text("Version History").font(FoleviType.sectionTitle)
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
                        Text(Date(timeIntervalSince1970: snap.createdAt / 1000).formatted(date: .abbreviated, time: .shortened)).font(.system(size: 12, weight: .medium))
                        Text("\(snap.createdBy) · \(Int(snap.blockCount)) blocks").font(.caption).foregroundStyle(FoleviColor.inkMuted)
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
                                .font(entry.block.type == "heading" ? .system(size: 15, weight: .semibold, design: .serif) : .system(size: 13))
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
        guard let content = try? await session.documents.snapshotContent(snap.id), let raw = content?.content,
              let json = try? JSONValue(jsonString: raw) else {
            preview = []
            return
        }
        preview = (json["blocks"]?.arrayValue ?? []).compactMap { try? WireBlock(json: $0) }
    }
}
