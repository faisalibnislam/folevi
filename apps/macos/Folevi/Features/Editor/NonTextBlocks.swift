import AppKit
import QuickLookUI
import SwiftUI
import UniformTypeIdentifiers

// MARK: - Code

/// A code block (editor.css `pre.fb-code`): the code background with a hairline, 6pt corners, 13.5pt mono
/// at 1.65, and the language in small lowercase letters at the top right. `flat`: a Mermaid card's source
/// (13pt, 12 × 16 padding, square, inside the card).
struct CodeBlockView: View {
    let block: Block
    let props: CodeProps
    @Bindable var model: EditorModel
    var focusRequest: FocusRequest?
    var flat = false
    @Environment(AppModel.self) private var app

    private var scale: CGFloat { CGFloat(app.editorScale) }
    /// `--color-code-bg`: on a note style palette, the style's accent 6% into the page.
    private var codeBackground: Color { model.sheetPalette?.notePalette.map { Color($0.codeBackground) } ?? FoleviColor.codeBg }

    private var style: TextRenderStyle {
        var s = BlockStyles.style(for: block, document: model.style, scale: scale, palette: model.sheetPalette)
        if flat {
            s.font = FoleviType.mono(size: 13, scale: scale)
            s.lineSpacing = BlockStyles.spacing(for: s.font, lineHeight: 1.65)
        }
        return s
    }

    var body: some View {
        let editor = BlockTextEditor(blockId: block.id, text: props.code.isEmpty ? [] : [.text(text: props.code, marks: nil)],
                                     style: style, isEditable: !model.isReadOnly, accessibilityLabel: String(localized: "Code"), model: model,
                                     focusRequest: focusRequest, isCode: true)
        if flat {
            editor
                .padding(.horizontal, 16 * scale)
                .padding(.vertical, 12 * scale)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(codeBackground)
        } else {
            editor
                .padding(.horizontal, 13.5 * scale)
                .padding(.vertical, 0.85 * 13.5 * scale)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(codeBackground))
                .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(FoleviColor.heading.opacity(0.08), lineWidth: 1))
                .overlay(alignment: .topTrailing) {
                    Text(verbatim: props.language.lowercased())
                        .font(.ui(11 * scale, .medium))
                        .foregroundStyle(FoleviColor.inkFaint)
                        .padding(.top, 6)
                        .padding(.trailing, 10)
                        .allowsHitTesting(false)
                        .accessibilityLabel(Text("Language \(props.language)"))
                }
                .richAtomOutline(model.selectedBlockIds.contains(block.id), accent: model.documentAccent)
        }
    }
}

// MARK: - To-do metadata (due date, time, priority)

/// The task chip after a to-do's text (editor.css `.fb-due-chip`): "Oct 5 · 14:00 · !!!", shown when the
/// task has a due date or a priority. A click opens the task details.
struct TodoMetaView: View {
    let blockId: String
    let props: TodoProps
    @Bindable var model: EditorModel
    @State private var hovering = false

    var body: some View {
        let text = Self.chip(date: props.dueDate, time: props.dueTime, priority: props.priority)
        let open = Binding(get: { model.taskDetailsFor == blockId }, set: { if !$0, model.taskDetailsFor == blockId { model.taskDetailsFor = nil } })
        Group {
            if !text.isEmpty {
                let high = props.priority == .high
                Button { model.taskDetailsFor = blockId } label: {
                    Text(verbatim: text)
                        .font(.ui(12, .semibold))
                        .foregroundStyle(high ? FoleviColor.coralInk : hovering ? FoleviColor.ink : FoleviColor.inkMuted)
                        .padding(.horizontal, 9)
                        .frame(minHeight: 24)
                        .background(RoundedRectangle(cornerRadius: 4, style: .continuous).fill(high ? FoleviColor.coralSoft : FoleviColor.surfaceSunken))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .onHover { hovering = $0 }
                .padding(.top, 2.4)
                .accessibilityLabel(Text("Task details: \(Self.spoken(props))"))
            } else {
                Color.clear.frame(width: 0, height: 24)
            }
        }
        .foleviPopover(isPresented: open, arrowEdge: .bottom) {
            TaskDetailsPopover(blockId: blockId, model: model)
        }
    }

    /// The web's `formatChip`.
    static func chip(date: String?, time: String?, priority: TaskPriority?) -> String {
        var s = ""
        if let date, let d = TaskLogic.parseLocalDate(date) {
            s = d.formatted(.dateTime.month(.abbreviated).day())
            if let time, !time.isEmpty { s += " · \(time)" }
        }
        if let priority, priority != .none {
            s += (s.isEmpty ? "" : " · ") + (priority == .high ? "!!!" : priority == .medium ? "!!" : "!")
        }
        return s
    }

    static func spoken(_ p: TodoProps) -> String {
        var parts: [String] = []
        if let d = p.dueDate { parts.append(d + (p.dueTime.map { " \($0)" } ?? "")) }
        if let pr = p.priority, pr != .none { parts.append("\(pr.rawValue) priority") }
        return parts.joined(separator: ", ")
    }
}

/// Due date, time, priority, assignee and reminder for a task (EditorMenus.tsx `TaskDetails`). Every
/// change applies at once; Done (or Return) closes, Clear all empties the fields.
struct TaskDetailsPopover: View {
    let blockId: String
    @Bindable var model: EditorModel
    @Environment(AppModel.self) private var app
    @State private var showDue = false
    @State private var showReminder = false
    @State private var members: [WorkspaceMembers.Member] = []

    private var props: TodoProps? {
        if case .todo(let p) = model.blocks[blockId]?.content { return p }
        return nil
    }

    var body: some View {
        let p = props ?? TodoProps(checked: false)
        VStack(alignment: .leading, spacing: 12) {
            field("Due date") {
                DateFieldButton(date: p.dueDate, placeholder: String(localized: "No date"), open: $showDue) { value in
                    set { $0.dueDate = value; if value == nil { $0.dueTime = nil } }
                }
            }
            field("Time (leave empty for all day)") {
                TimeTextField(value: p.dueTime) { value in set { $0.dueTime = value } }
                    .disabled(p.dueDate == nil)
                    .opacity(p.dueDate == nil ? 0.5 : 1)
            }
            field("Priority") {
                FoleviSelect(selection: Binding(get: { p.priority ?? .none }, set: { v in set { $0.priority = v == .none ? nil : v } }),
                             options: [.init(value: .none, title: String(localized: "None")), .init(value: .low, title: String(localized: "Low")),
                                       .init(value: .medium, title: String(localized: "Medium")), .init(value: .high, title: String(localized: "High"))],
                             accessibilityLabel: String(localized: "Priority"), height: 32)
            }
            if members.count > 1 {
                field("Assignee") {
                    FoleviSelect(selection: Binding(get: { p.assigneeId ?? "" }, set: { v in set { $0.assigneeId = v.isEmpty ? nil : v } }),
                                 options: [.init(value: "", title: String(localized: "Unassigned"))]
                                    + members.map { .init(value: $0.profileId, title: $0.displayName + ($0.isYou ? String(localized: " (you)") : "")) },
                                 accessibilityLabel: String(localized: "Assignee"), height: 32)
                }
            }
            field("Reminder") {
                ReminderField(value: p.reminderAt, open: $showReminder) { value in set { $0.reminderAt = value } }
            }
            HStack {
                Button("Clear all") {
                    set { $0.dueDate = nil; $0.dueTime = nil; $0.priority = nil; $0.reminderAt = nil; $0.assigneeId = nil }
                }
                .buttonStyle(.plain)
                .font(.ui(12))
                .foregroundStyle(FoleviColor.inkMuted)
                Spacer()
                Button("Done") { close() }
                    .buttonStyle(.folevi(.primary, .small))
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(8)
        .padding(6)
        .frame(width: 300)
        .onExitCommand { close() }
        .task { await loadMembers() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Task details"))
    }

    private func field<Content: View>(_ label: LocalizedStringKey, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.ui(12)).foregroundStyle(FoleviColor.inkMuted)
            content()
        }
    }

    /// Always patches the latest props, so quick successive changes don't overwrite each other.
    private func set(_ change: (inout TodoProps) -> Void) {
        model.update(blockId, actionName: String(localized: "Task Details")) { b in
            guard case .todo(var p) = b.content else { return }
            change(&p)
            b.content = .todo(p)
        }
    }

    private func close() {
        model.taskDetailsFor = nil
        model.focus = FocusRequest(blockId: blockId, caret: .end)
    }

    private func loadMembers() async {
        guard let session = app.session, let workspaceId = model.document?.workspaceId else { return }
        if let m = try? await WorkspacesRepository(convex: session.convex).members(workspaceId) { members = m.members }
    }
}

/// A date field: the date (or a placeholder) in an input, opening a month grid below it.
private struct DateFieldButton: View {
    var date: String?
    var placeholder: String
    @Binding var open: Bool
    var onChange: (String?) -> Void
    @State private var draft = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Button { open.toggle() } label: {
                    HStack {
                        Text(verbatim: date.flatMap(TaskLogic.parseLocalDate).map { $0.formatted(date: .abbreviated, time: .omitted) } ?? placeholder)
                            .font(.ui(13))
                            .foregroundStyle(date == nil ? FoleviColor.inkFaint : FoleviColor.ink)
                        Spacer()
                        Image(systemName: "calendar").font(.system(size: 12)).foregroundStyle(FoleviColor.inkMuted)
                    }
                    .padding(.horizontal, 12)
                    .frame(height: 32)
                    .foleviInput()
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                if date != nil {
                    IconButton(systemImage: "xmark", label: "Clear date", size: 28) { onChange(nil) }
                }
            }
            if open {
                MonthPicker(selection: Binding(get: { date ?? TaskLogic.localDate() }, set: { v in
                    onChange(v)
                    open = false
                }), today: TaskLogic.localDate())
            }
        }
    }
}

/// "HH:MM" (24-hour), empty for none. Applies on Return or when the field loses focus.
private struct TimeTextField: View {
    var value: String?
    var onChange: (String?) -> Void
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        TextField("--:--", text: $text)
            .textFieldStyle(.plain)
            .font(.ui(13).monospacedDigit())
            .padding(.horizontal, 12)
            .frame(height: 32)
            .foleviInput()
            .focused($focused)
            .onAppear { text = value ?? "" }
            .onChange(of: value) { _, v in if !focused { text = v ?? "" } }
            .onChange(of: focused) { _, f in if !f { apply() } }
            .onSubmit { apply() }
            .accessibilityLabel(Text("Time"))
    }

    private func apply() {
        let t = text.trimmingCharacters(in: .whitespaces)
        if t.isEmpty { onChange(nil); return }
        let parts = t.split(separator: ":").map { Int($0) }
        if parts.count == 2, let h = parts[0], let m = parts[1], (0..<24).contains(h), (0..<60).contains(m) {
            let v = String(format: "%02d:%02d", h, m)
            text = v
            onChange(v)
        } else {
            text = value ?? ""
        }
    }
}

/// A reminder: a day and a time (the web's datetime-local field), stored as a timestamp.
private struct ReminderField: View {
    var value: Double?
    @Binding var open: Bool
    var onChange: (Double?) -> Void

    private var date: Date? { value.map { Date(timeIntervalSince1970: $0 / 1000) } }
    private var day: String? { date.map { TaskLogic.localDate($0) } }
    private var time: String? {
        guard let date else { return nil }
        let c = Calendar.current.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", c.hour ?? 9, c.minute ?? 0)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                DateFieldButton(date: day, placeholder: String(localized: "No reminder"), open: $open) { d in
                    guard let d else { onChange(nil); return }
                    onChange(stamp(day: d, time: time ?? "09:00"))
                }
                TimeTextField(value: time) { t in
                    guard let day else { return }
                    onChange(stamp(day: day, time: t ?? "09:00"))
                }
                .frame(width: 84)
                .disabled(day == nil)
                .opacity(day == nil ? 0.5 : 1)
            }
        }
    }

    private func stamp(day: String, time: String) -> Double? {
        guard let d = TaskLogic.parseLocalDate(day) else { return nil }
        let parts = time.split(separator: ":").compactMap { Int($0) }
        var c = Calendar.current.dateComponents([.year, .month, .day], from: d)
        c.hour = parts.first ?? 9
        c.minute = parts.count > 1 ? parts[1] : 0
        return Calendar.current.date(from: c).map { ($0.timeIntervalSince1970 * 1000).rounded() }
    }
}

extension View {
    /// The web's `ui-input`: the surface, 6pt corners, a faint inner shadow and a hairline.
    func foleviInput() -> some View {
        background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(FoleviColor.surface))
            .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(FoleviColor.line, lineWidth: 1))
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

/// Lays its content out at a fraction of the offered width (the web's `figure` at `width × 100%`).
struct FractionalWidth: Layout {
    var fraction: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let full = proposal.width ?? 600
        let inner = subviews.first?.sizeThatFits(ProposedViewSize(width: full * fraction, height: nil)) ?? .zero
        return CGSize(width: full, height: inner.height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        subviews.first?.place(at: bounds.origin, proposal: ProposedViewSize(width: bounds.width * fraction, height: bounds.height))
    }
}

/// An image (NodeViews.tsx `ImageView`): the picture at its width (50, 75 or 100% of the column) with a
/// hairline and 6pt corners, the upload status, and a centred caption. Selected, it offers the alt text and
/// the width.
struct ImageBlockView: View {
    let block: Block
    let props: ImageProps
    @Bindable var model: EditorModel
    var selected = false
    @Environment(AppModel.self) private var app
    @State private var image: NSImage?
    @State private var localURL: URL?
    @State private var failed = false

    private var key: String { props.fileId ?? props.url ?? block.id }
    private var isUploading: Bool { props.fileId == nil && props.url == nil }
    private var width: Double { props.width ?? 1 }
    private var editable: Bool { !model.isReadOnly }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            FractionalWidth(fraction: CGFloat(min(1, max(0.1, width)))) {
                VStack(spacing: 0) {
                    picture
                        .contentShape(Rectangle())
                        .onTapGesture { model.select(block.id, extend: NSEvent.modifierFlags.contains(.shift)) }
                        .onDrag {
                            if let localURL, let provider = NSItemProvider(contentsOf: localURL) { return provider }
                            return NSItemProvider()
                        }
                    if isUploading {
                        Text(app.sync.isOnline ? "Uploading…" : "Waiting to upload (offline)")
                            .font(.ui(12))
                            .foregroundStyle(FoleviColor.inkMuted)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.top, 4)
                            .accessibilityAddTraits(.updatesFrequently)
                    }
                    caption.padding(.top, 6)
                }
            }
            .richAtomOutline(selected, accent: model.documentAccent)
            if selected && editable { tools.padding(.top, 8).padding(.bottom, 8) }
        }
        .task(id: key) { await load() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Image"))
    }

    @ViewBuilder private var picture: some View {
        let shape = RoundedRectangle(cornerRadius: 6, style: .continuous)
        if let image {
            Image(nsImage: image)
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(maxWidth: .infinity)
                .background(FoleviColor.surfaceSunken)
                .clipShape(shape)
                .overlay(shape.strokeBorder(FoleviColor.line, lineWidth: 1))
                .accessibilityLabel(Text(props.alt.isEmpty ? String(localized: "Image") : props.alt))
        } else {
            shape
                .strokeBorder(FoleviColor.lineStrong, style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
                .frame(height: 160)
                .frame(maxWidth: .infinity)
                .overlay {
                    if failed || (props.fileId == nil && !isUploading) {
                        Label("Image unavailable", systemImage: "photo.badge.exclamationmark")
                            .font(.ui(13))
                            .foregroundStyle(FoleviColor.inkMuted)
                    } else {
                        Text("Loading image…").font(.ui(13)).foregroundStyle(FoleviColor.inkMuted)
                    }
                }
        }
    }

    @ViewBuilder private var caption: some View {
        if editable {
            TextField("Add a caption", text: Binding(get: { props.caption }, set: { value in
                model.update(block.id, undoable: false) { b in
                    if case .image(var p) = b.content {
                        p.caption = value
                        b.content = .image(p)
                    }
                }
            }))
            .textFieldStyle(.plain)
            .multilineTextAlignment(.center)
            .font(.ui(13))
            .foregroundStyle(FoleviColor.inkMuted)
            .accessibilityLabel(Text("Image caption"))
        } else if !props.caption.isEmpty {
            Text(props.caption).font(.ui(13)).foregroundStyle(FoleviColor.inkMuted).frame(maxWidth: .infinity)
                .multilineTextAlignment(.center)
        }
    }

    private var tools: some View {
        HStack(spacing: 8) {
            Text("Alt text")
            TextField("Describe the image", text: Binding(get: { props.alt }, set: { value in
                model.update(block.id, undoable: false) { b in
                    if case .image(var p) = b.content {
                        p.alt = value
                        b.content = .image(p)
                    }
                }
            }))
            .textFieldStyle(.plain)
            .font(.ui(12))
            .foregroundStyle(FoleviColor.ink)
            .padding(.horizontal, 8)
            .frame(width: 224, height: 28)
            .foleviInput()
            Text("Width")
            ForEach([0.5, 0.75, 1.0], id: \.self) { w in
                let on = abs(width - w) < 0.001
                Button {
                    model.update(block.id, actionName: String(localized: "Image Width")) { b in
                        if case .image(var p) = b.content {
                            p.width = w == 1 ? nil : w
                            b.content = .image(p)
                        }
                    }
                } label: {
                    Text(verbatim: "\(Int(w * 100))%")
                        .font(.ui(12))
                        .foregroundStyle(on ? FoleviColor.accent : FoleviColor.inkMuted)
                        .padding(.horizontal, 8)
                        .frame(height: 28)
                        .background(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(on ? FoleviColor.accent : FoleviColor.line, lineWidth: 1))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .font(.ui(12))
        .foregroundStyle(FoleviColor.inkMuted)
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

/// An attachment (NodeViews.tsx `FileView`): a card with a document icon, the name, the size and the upload
/// state, and Download once it's uploaded.
struct FileBlockView: View {
    let block: Block
    let props: FileProps
    @Bindable var model: EditorModel
    @Environment(AppModel.self) private var app
    @State private var localURL: URL?
    @State private var loading = false
    @State private var downloadHover = false

    private var meta: String {
        var s = props.size > 0 ? Self.formatBytes(props.size) : ""
        if props.fileId.isEmpty { s += String(localized: " · Uploading…") }
        return s
    }

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "doc.text").font(.system(size: 18)).foregroundStyle(FoleviColor.inkMuted).frame(width: 20)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 0) {
                Text(props.name.isEmpty ? String(localized: "Attachment") : props.name).font(.ui(13, .medium)).lineLimit(1).truncationMode(.middle)
                Text(verbatim: meta).font(.ui(12)).foregroundStyle(FoleviColor.inkMuted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if !props.fileId.isEmpty {
                Button { Task { await withFile(saveAs) } } label: {
                    HStack(spacing: 6) {
                        if loading { ProgressView().controlSize(.mini) } else { Image(systemName: "arrow.down.to.line").font(.system(size: 12)) }
                        Text("Download")
                    }
                    .font(.ui(12))
                    .foregroundStyle(FoleviColor.ink)
                    .padding(.horizontal, 10)
                    .frame(height: 32)
                    .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(downloadHover ? FoleviColor.surface : .clear))
                    .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(FoleviColor.line, lineWidth: 1))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .onHover { downloadHover = $0 }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .foleviCard(radius: 8)
        .contentShape(Rectangle())
        .onTapGesture { model.select(block.id, extend: NSEvent.modifierFlags.contains(.shift)) }
        .onDrag {
            if let localURL, let provider = NSItemProvider(contentsOf: localURL) { return provider }
            return NSItemProvider()
        }
        .richAtomOutline(model.selectedBlockIds.contains(block.id), accent: model.documentAccent)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Attachment \(props.name)"))
    }

    /// The web's `formatBytes`.
    static func formatBytes(_ n: Double) -> String {
        if n < 1024 { return "\(Int(n)) B" }
        if n < 1024 * 1024 { return String(format: "%.0f KB", n / 1024) }
        if n < 1024 * 1024 * 1024 { return String(format: "%.1f MB", n / 1024 / 1024) }
        return String(format: "%.2f GB", n / 1024 / 1024 / 1024)
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

/// A table (NodeViews.tsx `TableView`): a full-width grid of plain-text cells (the first row bold as a
/// header). While it's selected or a cell is being edited, each column gets move left / right / delete above
/// it and each row move up / down / delete after it; "+ Row", "+ Column" and "Header row" sit below.
struct TableBlockView: View {
    let block: Block
    let props: TableProps
    @Bindable var model: EditorModel
    var selected = false
    @FocusState private var focusedCell: CellID?

    struct CellID: Hashable { var r: Int; var c: Int }

    private var width: Int { props.rows.first?.count ?? 1 }
    private var editable: Bool { !model.isReadOnly }
    private var tools: Bool { editable && (selected || focusedCell != nil) }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Grid(horizontalSpacing: 0, verticalSpacing: 0) {
                if tools {
                    GridRow {
                        ForEach(0..<width, id: \.self) { c in
                            HStack(spacing: 2) {
                                TableIconTool(systemImage: "arrow.left", label: "Move column \(c + 1) left", help: "Move column left") { moveCol(c, -1) }
                                    .disabled(c == 0)
                                TableIconTool(systemImage: "arrow.right", label: "Move column \(c + 1) right", help: "Move column right") { moveCol(c, 1) }
                                    .disabled(c == width - 1)
                                TableIconTool(systemImage: "trash", label: "Delete column \(c + 1)", help: "Delete column", danger: true) { removeCol(c) }
                                    .disabled(width <= 1)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.bottom, 4)
                        }
                        Color.clear.frame(width: 1, height: 1).gridCellUnsizedAxes([.horizontal, .vertical])
                    }
                }
                ForEach(Array(props.rows.enumerated()), id: \.offset) { r, row in
                    GridRow {
                        ForEach(Array(row.enumerated()), id: \.offset) { c, cell in
                            TableCellField(text: RichText.plainText(cell), isHeader: props.headerRow && r == 0, isEditable: editable,
                                           label: String(localized: "Row \(r + 1), column \(c + 1)")) { value in
                                setCell(r, c, value)
                            }
                            .focused($focusedCell, equals: CellID(r: r, c: c))
                        }
                        if tools {
                            HStack(spacing: 2) {
                                TableIconTool(systemImage: "arrow.up", label: "Move row \(r + 1) up", help: "Move row up") { moveRow(r, -1) }
                                    .disabled(r == 0)
                                TableIconTool(systemImage: "arrow.down", label: "Move row \(r + 1) down", help: "Move row down") { moveRow(r, 1) }
                                    .disabled(r == props.rows.count - 1)
                                TableIconTool(systemImage: "minus", label: "Delete row \(r + 1)", help: "Delete row", danger: true) { removeRow(r) }
                                    .disabled(props.rows.count <= 1)
                            }
                            .padding(.leading, 4)
                            .frame(width: 88, alignment: .leading)
                        }
                    }
                }
            }
            .contentShape(Rectangle())
            .onTapGesture { model.select(block.id, extend: NSEvent.modifierFlags.contains(.shift)) }
            if editable {
                HStack(spacing: 8) {
                    TableToolButton(systemImage: "plus", title: String(localized: "Row")) {
                        mutate { p in p.rows.append(Array(repeating: [], count: max(1, p.rows.first?.count ?? 1))) }
                    }
                    .disabled(props.rows.count >= FoleviLimits.maxTableRows)
                    TableToolButton(systemImage: "plus", title: String(localized: "Column")) { mutate { p in p.rows = p.rows.map { $0 + [[]] } } }
                        .disabled(width >= min(20, FoleviLimits.maxTableColumns))
                    if tools {
                        Toggle(isOn: Binding(get: { props.headerRow }, set: { v in mutate { $0.headerRow = v } })) {
                            Text("Header row").font(.ui(12)).foregroundStyle(FoleviColor.inkMuted)
                        }
                        .toggleStyle(FoleviCheckboxStyle())
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                    }
                }
            }
        }
        .richAtomOutline(selected, accent: model.documentAccent)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Table"))
    }

    private func setCell(_ r: Int, _ c: Int, _ value: String) {
        model.update(block.id, undoable: false) { b in
            guard case .table(var p) = b.content, p.rows.indices.contains(r), p.rows[r].indices.contains(c) else { return }
            p.rows[r][c] = value.isEmpty ? [] : [.text(text: value, marks: nil)]
            b.content = .table(p)
        }
    }

    private func moveRow(_ i: Int, _ dir: Int) {
        mutate { p in
            let j = i + dir
            guard p.rows.indices.contains(i), p.rows.indices.contains(j) else { return }
            p.rows.swapAt(i, j)
        }
    }

    private func moveCol(_ i: Int, _ dir: Int) {
        mutate { p in
            let j = i + dir
            p.rows = p.rows.map { row in
                var r = row
                if r.indices.contains(i), r.indices.contains(j) { r.swapAt(i, j) }
                return r
            }
        }
    }

    private func removeRow(_ i: Int) {
        mutate { p in if p.rows.count > 1, p.rows.indices.contains(i) { p.rows.remove(at: i) } }
    }

    private func removeCol(_ i: Int) {
        mutate { p in
            guard (p.rows.first?.count ?? 0) > 1 else { return }
            p.rows = p.rows.map { row in
                var r = row
                if r.indices.contains(i) { r.remove(at: i) }
                return r
            }
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

/// One cell: plain text, 14pt, 10 × 6 padding, at least 96 wide, a hairline grid; a soft accent while edited.
struct TableCellField: View {
    var text: String
    var isHeader: Bool
    var isEditable: Bool
    var label: String
    var onCommit: (String) -> Void
    @State private var draft = ""
    @FocusState private var focused: Bool

    var body: some View {
        Group {
            if isEditable {
                TextField("", text: $draft, axis: .vertical)
                    .textFieldStyle(.plain)
                    .focused($focused)
                    .onAppear { draft = text }
                    .onChange(of: text) { _, v in if !focused || v != draft { if !focused { draft = v } } }
                    .onChange(of: draft) { _, v in if v != text { onCommit(v) } }
            } else {
                Text(text).frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .font(.ui(13, isHeader ? .semibold : .regular))
        .foregroundStyle(FoleviColor.ink)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .frame(minWidth: 96, maxWidth: .infinity, alignment: .leading)
        .background(focused ? FoleviColor.accentSoft.opacity(0.4) : Color.clear)
        .overlay(Rectangle().strokeBorder(FoleviColor.line, lineWidth: 0.5).padding(-0.25))
        .accessibilityLabel(Text(label))
    }
}

/// A 24pt square tool in the faint colour (the web's table tools).
private struct TableIconTool: View {
    var systemImage: String
    var label: LocalizedStringKey
    var help: LocalizedStringKey
    var danger = false
    var action: () -> Void
    @State private var hover = false
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 10.5, weight: .medium))
                .foregroundStyle(hover && isEnabled ? (danger ? FoleviColor.destructive : FoleviColor.heading) : FoleviColor.inkFaint)
                .frame(width: 24, height: 24)
                .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(hover && isEnabled ? FoleviColor.accentSoft : .clear))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .opacity(isEnabled ? 1 : 0.3)
        .onHover { hover = $0 }
        .help(Text(help))
        .accessibilityLabel(Text(label))
    }
}

/// A small square checkbox (the web's native checkbox in the table tools).
struct FoleviCheckboxStyle: ToggleStyle {
    func makeBody(configuration: Configuration) -> some View {
        Button { configuration.isOn.toggle() } label: {
            HStack(spacing: 6) {
                ZStack {
                    RoundedRectangle(cornerRadius: 3, style: .continuous)
                        .fill(configuration.isOn ? FoleviColor.accent : FoleviColor.surface)
                    RoundedRectangle(cornerRadius: 3, style: .continuous)
                        .strokeBorder(configuration.isOn ? FoleviColor.accent : FoleviColor.lineStrong, lineWidth: 1)
                    if configuration.isOn {
                        Image(systemName: "checkmark").font(.system(size: 8, weight: .bold)).foregroundStyle(.white)
                    }
                }
                .frame(width: 13, height: 13)
                configuration.label
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(configuration.isOn ? .isSelected : [])
    }
}

// MARK: - Page link / card

/// A nested page (NodeViews.tsx `PageView`). As a link: a document icon and the title, underlined. As a
/// card: an 8pt card with the icon, the title and two lines of its text ("Nested page" when empty), an
/// arrow on hover, lifting slightly.
struct PageBlockView: View {
    let props: PageProps
    var openDocument: (String, Bool) -> Void
    @Environment(AppModel.self) private var app
    @State private var hovering = false

    var body: some View {
        let doc = app.document(props.documentId)
        let title = (doc?.title).flatMap { $0.isEmpty ? nil : $0 } ?? props.titleCache ?? String(localized: "Untitled")
        let missing = doc == nil && props.titleCache == nil
        Button {
            openDocument(props.documentId, NSEvent.modifierFlags.contains(.option) || NSEvent.modifierFlags.contains(.command))
        } label: {
            if props.display == .card {
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: "doc.text").font(.system(size: 18)).foregroundStyle(FoleviColor.inkMuted).frame(width: 20).padding(.top, 2)
                    VStack(alignment: .leading, spacing: 0) {
                        Text(title).font(.ui(16, .semibold)).foregroundStyle(FoleviColor.ink).lineLimit(1)
                        Text(missing ? String(localized: "This page is unavailable or you no longer have access.")
                             : (doc?.excerpt).flatMap { $0.isEmpty ? nil : $0 } ?? String(localized: "Nested page"))
                            .font(.ui(13))
                            .foregroundStyle(FoleviColor.inkMuted)
                            .lineLimit(2)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    Image(systemName: "arrow.up.right.square").font(.system(size: 12)).foregroundStyle(FoleviColor.inkFaint)
                        .padding(.top, 4).opacity(hovering ? 1 : 0).accessibilityHidden(true)
                }
                .padding(16)
                .foleviSurface(.color(FoleviColor.surface), shape: .rounded(8), shadow: hovering ? FoleviShadow.pop : FoleviShadow.card)
                .offset(y: hovering ? -1 : 0)
                .animation(.easeOut(duration: 0.15), value: hovering)
                .contentShape(Rectangle())
            } else {
                HStack(spacing: 8) {
                    Image(systemName: "doc.text").font(.system(size: 13)).foregroundStyle(FoleviColor.inkMuted)
                    Text(title).font(.ui(16, .medium)).foregroundStyle(FoleviColor.ink)
                        .underline(true, color: hovering ? FoleviColor.accent : FoleviColor.lineStrong)
                }
                .padding(.horizontal, 4)
                .padding(.vertical, 2)
                .contentShape(Rectangle())
            }
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .help(Text("Open page (Option-click opens a new window)"))
        .accessibilityLabel(Text("Page \(title)"))
    }
}

// MARK: - Bookmark

/// A web bookmark (NodeViews.tsx `BookmarkView`): an 8pt card with a link icon, the title (or host), the
/// description and "site · host"; selected, its title and description can be edited.
struct BookmarkBlockView: View {
    let block: Block
    let props: BookmarkProps
    @Bindable var model: EditorModel
    var selected = false
    @State private var draft = ""

    private var href: String { RichText.sanitizeHref(props.url) ?? "" }
    private var host: String { URL(string: href)?.host() ?? props.url }

    var body: some View {
        if props.url.isEmpty {
            HStack {
                Image(systemName: "link").foregroundStyle(FoleviColor.inkMuted).accessibilityHidden(true)
                TextField("https://", text: $draft)
                    .textFieldStyle(.folevi)
                    .onSubmit { save() }
                Button("Add bookmark") { save() }.buttonStyle(.folevi(.primary, .small))
            }
            .disabled(model.isReadOnly)
        } else {
            VStack(alignment: .leading, spacing: 12) {
                Button {
                    if let url = URL(string: href) { NSWorkspace.shared.open(url) }
                } label: {
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: "link").font(.system(size: 15)).foregroundStyle(FoleviColor.inkMuted).padding(.top, 2)
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 0) {
                            Text((props.title?.isEmpty == false ? props.title : nil) ?? host)
                                .font(.ui(16, .semibold)).foregroundStyle(FoleviColor.ink).lineLimit(1)
                            if let d = props.description, !d.isEmpty {
                                Text(d).font(.ui(13)).foregroundStyle(FoleviColor.inkMuted).lineLimit(2)
                            }
                            Text(verbatim: (props.siteName.map { "\($0) · " } ?? "") + host)
                                .font(.ui(12)).foregroundStyle(FoleviColor.inkFaint).lineLimit(1)
                        }
                        Spacer(minLength: 0)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help(Text(verbatim: href))
                if selected && !model.isReadOnly {
                    VStack(alignment: .leading, spacing: 8) {
                        labelled("Title", field: \.title)
                        labelled("Description", field: \.description)
                    }
                }
            }
            .padding(16)
            .foleviCard(radius: 8)
            .richAtomOutline(selected, accent: model.documentAccent)
            .contentShape(Rectangle())
            .onTapGesture { model.select(block.id, extend: NSEvent.modifierFlags.contains(.shift)) }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text("Bookmark \(props.title ?? host)"))
        }
    }

    private func labelled(_ title: LocalizedStringKey, field: WritableKeyPath<BookmarkProps, String?>) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.ui(12)).foregroundStyle(FoleviColor.ink)
            TextField("", text: Binding(get: { props[keyPath: field] ?? "" }, set: { v in set { $0[keyPath: field] = v.isEmpty ? nil : v } }))
                .textFieldStyle(.plain)
                .font(.ui(13))
                .padding(.horizontal, 8)
                .frame(height: 32)
                .foleviInput()
        }
    }

    private func set(_ change: (inout BookmarkProps) -> Void) {
        model.update(block.id, undoable: false) { b in
            guard case .bookmark(var p) = b.content else { return }
            change(&p)
            b.content = .bookmark(p)
        }
    }

    private func save() {
        guard let href = RichText.sanitizeHref(draft) else { return }
        model.update(block.id, actionName: String(localized: "Bookmark")) { b in
            b.content = .bookmark(BookmarkProps(url: href, title: URL(string: href)?.host(), description: nil, siteName: nil))
        }
    }
}

/// "Add a bookmark" (EditorMenus.tsx `BookmarkPrompt`): a web address starting with http(s)://.
struct BookmarkPrompt: View {
    var onSubmit: (String) -> Void
    var onCancel: () -> Void
    @State private var value = "https://"
    @State private var error: String?
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Add a bookmark").font(FoleviType.sectionTitle).foregroundStyle(FoleviColor.heading).padding(.bottom, 16)
            Text("Web address").font(.ui(13, .medium))
            TextField("", text: $value)
                .textFieldStyle(.plain)
                .font(.ui(16))
                .padding(.horizontal, 16)
                .frame(height: 40)
                .foleviInput()
                .padding(.top, 8)
                .focused($focused)
                .onSubmit(submit)
                .onChange(of: value) { _, _ in error = nil }
                .accessibilityLabel(Text("Web address"))
            if let error {
                Text(error).font(.ui(12)).foregroundStyle(FoleviColor.destructive).padding(.top, 4)
            }
            HStack {
                Spacer()
                Button("Cancel", action: onCancel).buttonStyle(.folevi(.quiet)).keyboardShortcut(.cancelAction)
                Button("Add bookmark", action: submit).buttonStyle(.folevi(.primary)).keyboardShortcut(.defaultAction)
            }
            .padding(.top, 20)
        }
        .padding(24)
        .frame(width: 420)
        .onAppear { focused = true }
    }

    private func submit() {
        guard let href = RichText.sanitizeHref(value), href.range(of: "^https?://", options: [.regularExpression, .caseInsensitive]) != nil else {
            error = String(localized: "Enter a web address starting with http:// or https://")
            return
        }
        onSubmit(href)
    }
}

// MARK: - Page break (formula, whiteboard, collection and Mermaid have their own files)

/// Where the page splits when printed or exported to PDF. As on the web: the page ends (a rounded edge
/// with a soft shadow), a sunken gap with a small caps label, and the next page begins.
struct PageBreakBlockView: View {
    var palette: SheetPalette?

    var body: some View {
        let surface = palette?.surface ?? FoleviColor.surface
        ZStack {
            Rectangle().fill(FoleviColor.surfaceSunken)
            VStack(spacing: 0) {
                UnevenRoundedRectangle(bottomLeadingRadius: 18, bottomTrailingRadius: 18, style: .continuous)
                    .fill(surface)
                    .frame(height: 14)
                    .shadow(color: .black.opacity(0.28), radius: 5, y: 4)
                Spacer(minLength: 0)
                UnevenRoundedRectangle(topLeadingRadius: 18, topTrailingRadius: 18, style: .continuous)
                    .fill(surface)
                    .frame(height: 14)
                    .shadow(color: .black.opacity(0.28), radius: 5, y: -4)
            }
            Text("Page break")
                .textCase(.uppercase)
                .font(.ui(10.5, .semibold))
                .tracking(10.5 * 0.06)
                .foregroundStyle(palette?.faint ?? FoleviColor.inkFaint)
        }
        .frame(height: 56)
        .clipped()
        .padding(.vertical, 10)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("Page break"))
    }
}

// MARK: - Unknown

/// A block from a newer version (NodeViews.tsx `UnknownView`): a dashed, sunken note, kept as it is, with
/// a remove button.
struct UnknownBlockView: View {
    let type: String
    var onRemove: (() -> Void)?
    @State private var hoverRemove = false

    var body: some View {
        HStack(spacing: 12) {
            Text("This “\(type)” block was created by a newer version of Folevi. It’s kept safely and will appear once you update.")
                .font(.ui(13))
                .foregroundStyle(FoleviColor.inkMuted)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let onRemove {
                Button(action: onRemove) {
                    Image(systemName: "trash").font(.system(size: 12))
                        .foregroundStyle(hoverRemove ? FoleviColor.destructive : FoleviColor.inkFaint)
                }
                .buttonStyle(.plain)
                .onHover { hoverRemove = $0 }
                .accessibilityLabel(Text("Remove block"))
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(FoleviColor.surfaceSunken))
        .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(FoleviColor.lineStrong, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
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

/// A quiet table tool (muted text, soft fill on hover), like the web's "+ Row" buttons.
private struct TableToolButton: View {
    var systemImage: String
    var title: String
    var action: () -> Void
    @State private var hover = false
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Image(systemName: systemImage).font(.system(size: 10, weight: .semibold))
                Text(title).font(.ui(12))
            }
            .foregroundStyle(hover && isEnabled ? FoleviColor.heading : FoleviColor.inkMuted)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(hover && isEnabled ? FoleviColor.accentSoft : .clear))
            .contentShape(Rectangle())
        }
        .buttonStyle(.chrome)
        .opacity(isEnabled ? 1 : 0.4)
        .onHover { hover = $0 }
    }
}
