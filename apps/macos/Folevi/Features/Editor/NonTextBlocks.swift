import AppKit
import QuickLookUI
import SwiftUI
import UniformTypeIdentifiers

// MARK: - Code

struct CodeBlockView: View {
    let block: Block
    let props: CodeProps
    @Bindable var model: EditorModel
    var focusRequest: FocusRequest?
    @Environment(AppModel.self) private var app

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Menu(props.language == "plaintext" ? String(localized: "Plain Text") : props.language) {
                    ForEach(foleviCodeLanguages, id: \.self) { lang in
                        Button(lang == "plaintext" ? String(localized: "Plain Text") : lang) {
                            model.update(block.id, actionName: String(localized: "Code Language")) { b in
                                if case .code(var p) = b.content {
                                    p.language = lang
                                    b.content = .code(p)
                                }
                            }
                        }
                    }
                }
                .menuStyle(.borderlessButton)
                .fixedSize()
                .font(.ui(11.5))
                .disabled(model.isReadOnly)
                .accessibilityLabel(Text("Code language"))
                Spacer()
                IconButton(systemImage: "doc.on.doc", label: "Copy Code") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(props.code, forType: .string)
                }
            }
            BlockTextEditor(blockId: block.id, text: props.code.isEmpty ? [] : [.text(text: props.code, marks: nil)],
                            style: BlockStyles.style(for: block, document: model.style, scale: CGFloat(app.editorScale)),
                            isEditable: !model.isReadOnly, accessibilityLabel: String(localized: "Code"), model: model,
                            focusRequest: focusRequest, isCode: true)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .foleviSurface(.color(FoleviColor.codeBg), shape: .rounded(12),
                       shadow: [FoleviShadowLayer(x: 0, y: 0, blur: 0, spread: 1, color: FoleviColor.line, inset: true)])
    }
}

// MARK: - To-do metadata (due date, priority)

struct TodoMetaView: View {
    let blockId: String
    let props: TodoProps
    @Bindable var model: EditorModel
    /// The "set a date" affordance only shows while the row is hovered.
    var rowHovering = true
    @State private var showPicker = false
    @State private var date = Date()

    var body: some View {
        HStack(spacing: 4) {
            if let priority = props.priority, priority != .none {
                Chip(text: priority.rawValue.capitalized, systemImage: "flag.fill",
                     tint: priority == .high ? FoleviColor.coral : priority == .medium ? FoleviColor.marigold : FoleviColor.inkMuted)
            }
            Button {
                if let d = props.dueDate.flatMap(TaskLogic.parseLocalDate) { date = d }
                showPicker = true
            } label: {
                if let due = props.dueDate {
                    Chip(text: dueLabel(due), systemImage: "calendar",
                         tint: TaskLogic.isOverdue(status: props.checked ? .done : .open, dueDate: due, today: TaskLogic.localDate()) ? FoleviColor.destructive : FoleviColor.accent)
                } else {
                    Image(systemName: "calendar.badge.plus").foregroundStyle(FoleviColor.inkFaint).font(.system(size: 12))
                        .opacity(rowHovering || showPicker ? 1 : 0)
                }
            }
            .buttonStyle(.plain)
            .disabled(model.isReadOnly)
            .accessibilityLabel(Text(props.dueDate.map { "Due \($0)" } ?? "Set due date"))
            .popover(isPresented: $showPicker) {
                VStack(alignment: .leading, spacing: 10) {
                    DatePicker("Due", selection: $date, displayedComponents: .date).datePickerStyle(.graphical).labelsHidden()
                    Picker("Priority", selection: Binding(get: { props.priority ?? .none }, set: { setPriority($0) })) {
                        ForEach(TaskPriority.allCases, id: \.self) { p in Text(p.rawValue.capitalized).tag(p) }
                    }
                    HStack {
                        Button("Clear") { setDue(nil) }
                        Spacer()
                        Button("Set Date") { setDue(TaskLogic.localDate(date)) }.keyboardShortcut(.defaultAction)
                    }
                }
                .padding(14)
                .frame(width: 260)
            }
        }
        .padding(.top, 2)
    }

    private func dueLabel(_ due: String) -> String {
        let today = TaskLogic.localDate()
        if due == today { return String(localized: "Today") }
        if due == TaskLogic.addDays(today, 1) { return String(localized: "Tomorrow") }
        guard let d = TaskLogic.parseLocalDate(due) else { return due }
        return d.formatted(.dateTime.month(.abbreviated).day())
    }

    private func setDue(_ value: String?) {
        showPicker = false
        model.update(blockId, actionName: String(localized: "Due Date")) { b in
            guard case .todo(var p) = b.content else { return }
            p.dueDate = value
            if value == nil { p.dueTime = nil }
            b.content = .todo(p)
        }
    }

    private func setPriority(_ value: TaskPriority) {
        model.update(blockId, actionName: String(localized: "Priority")) { b in
            guard case .todo(var p) = b.content else { return }
            p.priority = value == .none ? nil : value
            b.content = .todo(p)
        }
    }
}

// MARK: - Image

@MainActor
final class AttachmentLoader {
    static let shared = AttachmentLoader()
    private var images: [String: NSImage] = [:]

    func image(forKey key: String) -> NSImage? { images[key] }
    func store(_ image: NSImage, forKey key: String) { images[key] = image }

    /// Local file for an attachment block: cached download, pending upload source, or nil.
    func localURL(block: Block, app: AppModel) async -> URL? {
        guard let session = app.session else { return nil }
        var fileId: String?
        switch block.content {
        case .image(let p): fileId = p.fileId
        case .file(let p): fileId = p.fileId.isEmpty ? nil : p.fileId
        case .unknown(AudioProps.type, let props): fileId = AudioProps(props).flatMap { $0.fileId.isEmpty ? nil : $0.fileId }
        default: break
        }
        if let fileId {
            if let url = try? await session.files.localFile(fileId: fileId) { return url }
        }
        if let pending = await session.engine.localUploadPath(blockId: block.id) { return URL(fileURLWithPath: pending) }
        return nil
    }
}

struct ImageBlockView: View {
    let block: Block
    let props: ImageProps
    @Bindable var model: EditorModel
    @Environment(AppModel.self) private var app
    @State private var image: NSImage?
    @State private var localURL: URL?
    @State private var failed = false

    private var key: String { props.fileId ?? props.url ?? block.id }
    private var isUploading: Bool { props.fileId == nil && props.url == nil }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ZStack {
                if let image {
                    Image(nsImage: image)
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .frame(maxWidth: .infinity)
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                        .accessibilityLabel(Text(props.alt.isEmpty ? String(localized: "Image") : props.alt))
                } else {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(FoleviColor.surfaceSunken)
                        .frame(height: 180)
                        .overlay {
                            if failed {
                                Label("Image unavailable offline", systemImage: "photo").foregroundStyle(FoleviColor.inkMuted)
                            } else {
                                ProgressView().controlSize(.small)
                            }
                        }
                }
                if isUploading {
                    VStack {
                        Spacer()
                        HStack {
                            ProgressView().controlSize(.mini)
                            Text(app.sync.isOnline ? "Uploading…" : "Waiting to upload")
                        }
                        .font(.ui(11.5))
                        .padding(6)
                        .background(Capsule().fill(.regularMaterial))
                        .padding(8)
                    }
                }
            }
            .frame(maxWidth: props.width.map { CGFloat($0) * 760 } ?? .infinity)
            .onTapGesture { model.select(block.id, extend: NSEvent.modifierFlags.contains(.shift)) }
            .onDrag {
                if let localURL, let provider = NSItemProvider(contentsOf: localURL) { return provider }
                return NSItemProvider()
            }
            TextField("Add a caption", text: Binding(get: { props.caption }, set: { value in
                model.update(block.id, undoable: false) { b in
                    if case .image(var p) = b.content {
                        p.caption = value
                        b.content = .image(p)
                    }
                }
            }))
            .textFieldStyle(.plain)
            .font(.ui(12))
            .foregroundStyle(FoleviColor.inkMuted)
            .disabled(model.isReadOnly)
        }
        .task(id: key) { await load() }
    }

    private func load() async {
        if let cached = AttachmentLoader.shared.image(forKey: key) {
            image = cached
        }
        if let url = await AttachmentLoader.shared.localURL(block: block, app: app) {
            localURL = url
            if image == nil, let img = NSImage(contentsOf: url) {
                image = img
                AttachmentLoader.shared.store(img, forKey: key)
            }
            return
        }
        if let urlString = props.url, let url = URL(string: urlString), url.scheme == "https" || url.scheme == "http" {
            if let (data, _) = try? await URLSession.shared.data(from: url), let img = NSImage(data: data) {
                image = img
                AttachmentLoader.shared.store(img, forKey: key)
                return
            }
        }
        failed = image == nil && !isUploading
    }
}

// MARK: - File

struct FileBlockView: View {
    let block: Block
    let props: FileProps
    @Bindable var model: EditorModel
    @Environment(AppModel.self) private var app
    @State private var localURL: URL?
    @State private var loading = false

    var body: some View {
        HStack(spacing: 12) {
            Image(nsImage: NSWorkspace.shared.icon(for: UTTypeHelper.type(forMIME: props.mimeType)))
                .resizable()
                .frame(width: 32, height: 32)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(props.name).font(.ui(13, .medium)).lineLimit(1)
                Text(props.fileId.isEmpty ? String(localized: "Waiting to upload") : ByteCountFormatter.string(fromByteCount: Int64(props.size), countStyle: .file))
                    .font(.ui(11.5)).foregroundStyle(FoleviColor.inkMuted)
            }
            Spacer()
            if loading { ProgressView().controlSize(.small) }
            IconButton(systemImage: "eye", label: "Quick Look") { Task { await withFile { QuickLookCoordinator.shared.show(url: $0) } } }
            IconButton(systemImage: "folder", label: "Reveal in Finder") { Task { await withFile { NSWorkspace.shared.activateFileViewerSelecting([$0]) } } }
            IconButton(systemImage: "square.and.arrow.down", label: "Save As…") { Task { await withFile(saveAs) } }
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(FoleviColor.line))
        .contentShape(Rectangle())
        .onTapGesture { model.select(block.id, extend: false) }
        .onDrag {
            if let localURL, let provider = NSItemProvider(contentsOf: localURL) { return provider }
            return NSItemProvider()
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("File \(props.name)"))
    }

    private func withFile(_ action: @escaping (URL) -> Void) async {
        loading = true
        defer { loading = false }
        if let url = await AttachmentLoader.shared.localURL(block: block, app: app) {
            localURL = url
            action(url)
        } else {
            app.showToast(String(localized: "This file isn't on this Mac yet. Connect to download it."))
        }
    }

    private func saveAs(_ url: URL) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = props.name
        panel.begin { response in
            guard response == .OK, let dest = panel.url else { return }
            try? FileManager.default.removeItem(at: dest)
            try? FileManager.default.copyItem(at: url, to: dest)
        }
    }
}

// MARK: - Table

struct TableBlockView: View {
    let block: Block
    let props: TableProps
    @Bindable var model: EditorModel

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Grid(horizontalSpacing: 0, verticalSpacing: 0) {
                ForEach(Array(props.rows.enumerated()), id: \.offset) { r, row in
                    GridRow {
                        ForEach(Array(row.enumerated()), id: \.offset) { c, cell in
                            TableCellField(text: RichText.plainText(cell), isHeader: props.headerRow && r == 0, isEditable: !model.isReadOnly) { value in
                                setCell(r, c, value)
                            }
                        }
                    }
                }
            }
            .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(FoleviColor.line))
            .clipShape(RoundedRectangle(cornerRadius: 6))
            if !model.isReadOnly {
                HStack(spacing: 10) {
                    Button("Add Row") { mutate { p in p.rows.append(Array(repeating: [], count: max(1, p.rows.first?.count ?? 1))) } }
                        .disabled(props.rows.count >= FoleviLimits.maxTableRows)
                    Button("Add Column") { mutate { p in p.rows = p.rows.map { $0 + [[]] } } }
                        .disabled((props.rows.first?.count ?? 0) >= FoleviLimits.maxTableColumns)
                    Button("Remove Row") { mutate { p in if p.rows.count > 1 { p.rows.removeLast() } } }
                    Button("Remove Column") { mutate { p in if (p.rows.first?.count ?? 0) > 1 { p.rows = p.rows.map { Array($0.dropLast()) } } } }
                    Toggle("Header Row", isOn: Binding(get: { props.headerRow }, set: { v in mutate { $0.headerRow = v } }))
                        .toggleStyle(.checkbox)
                }
                .buttonStyle(.link)
                .font(.ui(11.5))
            }
        }
    }

    private func setCell(_ r: Int, _ c: Int, _ value: String) {
        model.update(block.id, undoable: false) { b in
            guard case .table(var p) = b.content, p.rows.indices.contains(r), p.rows[r].indices.contains(c) else { return }
            p.rows[r][c] = RichText.text(value)
            b.content = .table(p)
        }
    }

    private func mutate(_ change: (inout TableProps) -> Void) {
        model.update(block.id, actionName: String(localized: "Edit Table")) { b in
            guard case .table(var p) = b.content else { return }
            change(&p)
            b.content = .table(p)
        }
    }
}

struct TableCellField: View {
    @State var text: String
    var isHeader: Bool
    var isEditable: Bool
    var onCommit: (String) -> Void

    init(text: String, isHeader: Bool, isEditable: Bool, onCommit: @escaping (String) -> Void) {
        _text = State(initialValue: text)
        self.isHeader = isHeader
        self.isEditable = isEditable
        self.onCommit = onCommit
    }

    var body: some View {
        TextField("", text: $text, axis: .vertical)
            .textFieldStyle(.plain)
            .font(.ui(13, isHeader ? .semibold : .regular))
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .frame(minWidth: 90, maxWidth: .infinity, alignment: .leading)
            .background(isHeader ? FoleviColor.surfaceSunken : Color.clear)
            .overlay(Rectangle().strokeBorder(FoleviColor.line.opacity(0.7), lineWidth: 0.5))
            .disabled(!isEditable)
            .onChange(of: text) { _, v in onCommit(v) }
            .accessibilityLabel(Text(isHeader ? "Header cell" : "Cell"))
    }
}

// MARK: - Page link / card

struct PageBlockView: View {
    let props: PageProps
    var openDocument: (String, Bool) -> Void
    @Environment(AppModel.self) private var app

    var body: some View {
        let doc = app.document(props.documentId)
        let title = doc?.displayTitle ?? props.titleCache ?? String(localized: "Untitled")
        let icon = doc?.icon ?? props.iconCache ?? "📄"
        Button {
            openDocument(props.documentId, NSEvent.modifierFlags.contains(.option))
        } label: {
            if props.display == .card {
                HStack(spacing: 12) {
                    Text(icon).font(.ui(22))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(title).font(FoleviType.cardTitle).foregroundStyle(FoleviColor.ink)
                        if let excerpt = doc?.excerpt, !excerpt.isEmpty {
                            Text(excerpt).font(.ui(11.5)).foregroundStyle(FoleviColor.inkMuted).lineLimit(1)
                        }
                    }
                    Spacer()
                    Image(systemName: "arrow.up.right").foregroundStyle(FoleviColor.inkFaint).accessibilityHidden(true)
                }
                .padding(12)
                .background(RoundedRectangle(cornerRadius: FoleviRadius.card, style: .continuous).fill(FoleviColor.surfaceRaised))
                .overlay(RoundedRectangle(cornerRadius: FoleviRadius.card, style: .continuous).strokeBorder(FoleviColor.line))
            } else {
                HStack(spacing: 6) {
                    Text(icon)
                    Text(title).underline().foregroundStyle(FoleviColor.accent)
                }
            }
        }
        .buttonStyle(.plain)
        .help(Text("Open. Option-click opens a new window."))
        .accessibilityLabel(Text("Page \(title)"))
        .accessibilityHint(Text("Option-click opens in a new window"))
    }
}

// MARK: - Bookmark

struct BookmarkBlockView: View {
    let block: Block
    let props: BookmarkProps
    @Bindable var model: EditorModel
    @State private var draft = ""

    var body: some View {
        if props.url.isEmpty {
            HStack {
                Image(systemName: "bookmark").accessibilityHidden(true)
                TextField("Paste a link and press Return", text: $draft)
                    .textFieldStyle(.folevi)
                    .onSubmit { save() }
                Button("Add") { save() }
            }
            .disabled(model.isReadOnly)
        } else {
            Link(destination: URL(string: RichText.sanitizeHref(props.url) ?? "https://folevi.com") ?? URL(fileURLWithPath: "/")) {
                HStack(alignment: .top, spacing: 12) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(props.title ?? props.url).font(.ui(13, .semibold)).foregroundStyle(FoleviColor.ink).lineLimit(1)
                        if let d = props.description { Text(d).font(.ui(11.5)).foregroundStyle(FoleviColor.inkMuted).lineLimit(2) }
                        Text(props.siteName ?? URL(string: props.url)?.host() ?? props.url).font(.ui(11.5)).foregroundStyle(FoleviColor.accent)
                    }
                    Spacer()
                    Image(systemName: "safari").foregroundStyle(FoleviColor.inkFaint).accessibilityHidden(true)
                }
                .padding(12)
                .background(RoundedRectangle(cornerRadius: FoleviRadius.card, style: .continuous).strokeBorder(FoleviColor.line))
            }
            .buttonStyle(.plain)
        }
    }

    private func save() {
        guard let href = RichText.sanitizeHref(draft) else { return }
        model.update(block.id, actionName: String(localized: "Bookmark")) { b in
            b.content = .bookmark(BookmarkProps(url: href, title: nil, description: nil, siteName: URL(string: href)?.host()))
        }
    }
}

// MARK: - Collection (read-only table view of rows)

struct CollectionBlockView: View {
    let props: CollectionProps
    var openDocument: (String, Bool) -> Void
    @Environment(AppModel.self) private var app
    @State private var data: CollectionData?
    @State private var failed = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "tablecells").accessibilityHidden(true)
                Text(data?.name ?? String(localized: "Collection")).font(.ui(14, .semibold))
                Spacer()
                Text("Editing the collection's properties is available on the web.")
                    .font(.ui(11.5)).foregroundStyle(FoleviColor.inkFaint)
            }
            if let data {
                ScrollView(.horizontal) {
                    Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
                        GridRow {
                            header(String(localized: "Name"))
                            ForEach(data.properties) { p in header(p.name) }
                        }
                        ForEach(data.rows) { row in
                            GridRow {
                                Button {
                                    openDocument(row.documentId, NSEvent.modifierFlags.contains(.option))
                                } label: {
                                    Text("\(row.icon ?? "📄") \(row.title.isEmpty ? String(localized: "Untitled") : row.title)")
                                        .lineLimit(1)
                                        .foregroundStyle(FoleviColor.ink)
                                }
                                .buttonStyle(.plain)
                                .modifier(CellStyle())
                                ForEach(data.properties) { p in
                                    Text(display(row.values[p.id], property: p)).lineLimit(1).modifier(CellStyle())
                                }
                            }
                        }
                    }
                    .font(.ui(12))
                    .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(FoleviColor.line))
                }
            } else if failed {
                Text("Connect to the internet to load this collection.").font(.ui(12.5)).foregroundStyle(FoleviColor.inkMuted)
            } else {
                ProgressView().controlSize(.small)
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: FoleviRadius.card, style: .continuous).fill(FoleviColor.surfaceRaised))
        .task(id: props.collectionId) { await load() }
    }

    private func header(_ text: String) -> some View {
        Text(text).font(.ui(11, .semibold)).foregroundStyle(FoleviColor.inkMuted)
            .modifier(CellStyle()).background(FoleviColor.surfaceSunken)
    }

    private func load() async {
        guard let session = app.session else { return }
        do {
            data = try await session.documents.collection(props.collectionId)
        } catch {
            failed = data == nil
        }
    }

    private func display(_ value: JSONValue?, property: CollectionData.Property) -> String {
        guard let value else { return "" }
        switch value {
        case .string(let s):
            if let options = property.options?.arrayValue,
               let match = options.first(where: { $0["id"]?.stringValue == s }) { return match["name"]?.stringValue ?? s }
            return s
        case .number(let n): return JSONValue.formatNumber(n)
        case .bool(let b): return b ? "✓" : ""
        case .array(let items):
            return items.compactMap { item -> String? in
                if let s = item.stringValue, let options = property.options?.arrayValue,
                   let match = options.first(where: { $0["id"]?.stringValue == s }) { return match["name"]?.stringValue }
                return item.stringValue
            }.joined(separator: ", ")
        default: return ""
        }
    }
}

struct CellStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .frame(minWidth: 110, alignment: .leading)
            .overlay(Rectangle().strokeBorder(FoleviColor.line.opacity(0.6), lineWidth: 0.5))
    }
}

// MARK: - Page break, formula, whiteboard

/// Where the page splits when printed or exported to PDF (web: a dashed rule with a small label).
struct PageBreakBlockView: View {
    var body: some View {
        HStack(spacing: 10) {
            dash
            Text("Page break").font(.ui(11, .medium)).foregroundStyle(FoleviColor.inkFaint)
            dash
        }
        .padding(.vertical, 12)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("Page break"))
    }

    private var dash: some View {
        Line().stroke(FoleviColor.line, style: StrokeStyle(lineWidth: 1, dash: [4, 3])).frame(height: 1)
    }

    private struct Line: Shape {
        func path(in rect: CGRect) -> Path {
            Path { p in p.move(to: CGPoint(x: 0, y: rect.midY)); p.addLine(to: CGPoint(x: rect.maxX, y: rect.midY)) }
        }
    }
}

/// A formula, shown as its LaTeX source until the Mac has a math renderer.
struct FormulaBlockView: View {
    let props: FormulaProps

    var body: some View {
        Text(props.latex.isEmpty ? "Empty formula" : props.latex)
            .font(.mono(14))
            .foregroundStyle(props.latex.isEmpty ? FoleviColor.inkFaint : FoleviColor.ink)
            .textSelection(.enabled)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .padding(.horizontal, 16)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(FoleviColor.codeBg))
            .accessibilityLabel(Text("Formula: \(props.latex)"))
    }
}

/// A whiteboard drawn on the web. Its drawing is kept exactly as it is.
struct WhiteboardBlockView: View {
    let props: WhiteboardProps

    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: "scribble.variable").font(.system(size: 20)).foregroundStyle(FoleviColor.inkMuted)
                .accessibilityHidden(true)
            Text("Whiteboard").font(.ui(13, .medium))
            Text("Open this page on the web to draw on it.").font(.ui(11.5)).foregroundStyle(FoleviColor.inkMuted)
        }
        .frame(maxWidth: .infinity)
        .frame(height: min(max(props.height, 120), 480))
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(FoleviColor.line, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Unknown

struct UnknownBlockView: View {
    let type: String

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "puzzlepiece.extension").accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text("Needs a newer version of Folevi").font(.ui(13, .medium))
                Text("This “\(type)” block was made with a newer version. It's kept exactly as it is.")
                    .font(.ui(11.5))
                    .foregroundStyle(FoleviColor.inkMuted)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(FoleviColor.line, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Quick Look

/// Quick Look for attachments. The panel calls its data source on the main thread.
final class QuickLookCoordinator: NSObject, QLPreviewPanelDataSource, @unchecked Sendable {
    static let shared = QuickLookCoordinator()
    private var url: URL?

    @MainActor
    func show(url: URL) {
        self.url = url
        guard let panel = QLPreviewPanel.shared() else { return }
        panel.dataSource = self
        panel.reloadData()
        panel.makeKeyAndOrderFront(nil)
    }

    @MainActor
    func preview(block: Block, app: AppModel) {
        switch block.content {
        case .image, .file:
            Task { @MainActor in
                if let url = await AttachmentLoader.shared.localURL(block: block, app: app) { self.show(url: url) }
            }
        default:
            break
        }
    }

    func numberOfPreviewItems(in panel: QLPreviewPanel!) -> Int {
        url == nil ? 0 : 1
    }

    func previewPanel(_ panel: QLPreviewPanel!, previewItemAt index: Int) -> (any QLPreviewItem)! {
        url.map { $0 as NSURL }
    }
}

extension UTTypeHelper {
    static func type(forMIME mime: String) -> UTType {
        UTType(mimeType: mime) ?? .data
    }
}
