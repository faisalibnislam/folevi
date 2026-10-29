// The small dialogs the frame opens from the sidebar and list screens, as the web draws them on the Mac:
// a name prompt (ui/PromptDialog.tsx: New folder, Rename folder), a folder's colour (app/FolderColorDialog.tsx,
// the palette's 25) and the folder picker (views/MoveToFolderDialog.tsx: Move to folder, Move folder).
#if os(macOS)
import AppKit
import SwiftUI
import FoleviDesign
import FoleviEngine
import FoleviScreens

@MainActor
public enum FrameDialogs {
    /// A name: `onSubmit` gets it trimmed (never empty).
    public static func prompt(_ frame: FrameModel, title: String, label: String, initial: String = "", confirm: String = "Save", onSubmit: @escaping @MainActor (String) -> Void) {
        FrameSheets.present(frame) { close in
            PromptSheet(title: title, label: label, initial: initial, confirm: confirm, close: close, onSubmit: onSubmit)
        }
    }

    /// The sidebar's New folder (or a folder's New folder inside…).
    public static func newFolder(_ frame: FrameModel, parent: FolderNode? = nil) {
        prompt(frame, title: parent.map { "New folder in “\($0.name)”" } ?? "New folder", label: "Folder name", confirm: "Create folder") { name in
            frame.newFolder(name: name, parent: parent?.id)
        }
    }

    public static func renameFolder(_ frame: FrameModel, _ folder: FolderNode) {
        prompt(frame, title: "Rename folder", label: "Folder name", initial: folder.name) { name in
            frame.perform {
                _ = try await frame.client.command(.folderRename(id: folder.id, name: name))
                frame.toast("Renamed", tone: .success)
            }
        }
    }

    public static func folderColor(_ frame: FrameModel, _ folder: FolderNode) {
        FrameSheets.present(frame) { close in
            FolderColorSheet(folder: folder, close: close) { id in
                frame.perform { _ = try await frame.client.command(.folderSetColor(id: folder.id, color: id)) }
            }
        }
    }

    public static func moveFolder(_ frame: FrameModel, _ folder: FolderNode) {
        FrameSheets.present(frame) { close in
            WebSheetDialog(title: "Move “\(folder.name)”", description: "Choose a folder to put it in, or move it to the top level. Its notes and subfolders go with it.", close: close) {
                FolderPickerView(folders: frame.folders.value?.folders ?? [], current: .some(folder.parentId), moving: folder) { target in
                    close()
                    frame.perform {
                        _ = try await frame.client.command(.folderMove(id: folder.id, parentId: target.id))
                        frame.toast(target.id == nil ? "Moved to the top level" : "Moved to “\(target.name)”", tone: .success)
                    }
                }
            }
        }
    }

    /// Move to folder for notes (one or many): Drafts or a folder.
    public static func moveNotes(_ frame: FrameModel, ids: [String], title: String?, currentFolderId: String??) {
        let what = ids.count == 1 ? "“\((title ?? "").trimmingCharacters(in: .whitespaces).isEmpty ? "Untitled" : title!)”" : "\(ids.count.formatted()) notes"
        FrameSheets.present(frame) { close in
            WebSheetDialog(title: "Move to folder", description: "Choose where \(what) should live.", close: close) {
                FolderPickerView(folders: frame.folders.value?.folders ?? [], current: currentFolderId, moving: nil) { target in
                    close()
                    frame.perform {
                        _ = try await frame.client.command(.noteMove(ids: ids, folderId: target.id))
                        frame.toast("Moved to \(target.id == nil ? "Drafts" : "“\(target.name)”")", tone: .success)
                    }
                }
            }
        }
    }
}

/// The name prompt: a label, a field and Cancel / the confirming button (disabled while the field is empty).
struct PromptSheet: View {
    let title: String
    let label: String
    let confirm: String
    let close: @MainActor () -> Void
    let onSubmit: @MainActor (String) -> Void
    @State private var value: String
    @FocusState private var focused: Bool
    @Environment(\.colorScheme) private var scheme

    init(title: String, label: String, initial: String, confirm: String, close: @escaping @MainActor () -> Void, onSubmit: @escaping @MainActor (String) -> Void) {
        self.title = title
        self.label = label
        self.confirm = confirm
        self.close = close
        self.onSubmit = onSubmit
        _value = State(initialValue: initial)
    }

    private var trimmed: String { value.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        let l = moreStyle("more.prompt.label", scheme)
        let input = focused ? webFocused(WebStyles.named("more.prompt.input")) : WebStyles.named("more.prompt.input")
        let i = input.resolve(scheme)
        let actions = moreStyle("more.prompt.actions", scheme)
        WebSheetDialog(title: title, close: close) {
            VStack(alignment: .leading, spacing: 0) {
                Text(verbatim: label).webText(l.text).lineLimit(1).foregroundStyle(l.color.color)
                TextField("", text: $value)
                    .textFieldStyle(.plain)
                    .webText(i.text)
                    .lineLimit(1)
                    .offset(x: -1.125, y: 1.035)
                    .focused($focused)
                    .tint(i.color.color)
                    .onSubmit(submit)
                    .onChange(of: value) { _, v in if v.count > 80 { value = String(v.prefix(80)) } }
                    .padding(i.padding.edgeInsets)
                    .frame(height: i.height)
                    .foregroundStyle(i.color.color)
                    .webBox(input)
                    .padding(.top, i.margin.top)
                    .accessibilityLabel(label)
                HStack(spacing: actions.gap) {
                    Spacer(minLength: 0)
                    WebSheetButton(title: "Cancel", action: close)
                    WebSheetButton(title: confirm, primary: true, enabled: !trimmed.isEmpty, action: submit)
                }
                .padding(.top, actions.margin.top)
            }
        }
        .task {
            try? await Task.sleep(for: .milliseconds(60))
            focused = true
        }
    }

    private func submit() {
        guard !trimmed.isEmpty else { return }
        let v = trimmed
        close()
        onSubmit(v)
    }
}

/// A folder's colour: the 25 in a 5 x 5 grid, the current one ringed and checked.
struct FolderColorSheet: View {
    let folder: FolderNode
    let close: @MainActor () -> Void
    let pick: @MainActor (String) -> Void
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let current = FolderColor.resolve(folder.color).id
        let columns = Array(repeating: GridItem(.flexible(), spacing: 10), count: 5)
        WebSheetDialog(title: "Color for “\(folder.name)”", close: close) {
            LazyVGrid(columns: columns, spacing: 10) {
                ForEach(FoleviTokens.folderColors) { c in
                    let on = c.id == current
                    Button {
                        close()
                        pick(c.id)
                    } label: {
                        RoundedRectangle(cornerRadius: 6, style: .circular)
                            .fill(c.color.color)
                            .overlay(RoundedRectangle(cornerRadius: 6, style: .circular).strokeBorder(Color.black.opacity(0.08), lineWidth: 1))
                            .aspectRatio(1, contentMode: .fit)
                            .overlay {
                                if on { WebIconView(.check, size: 18, strokeWidth: 2.5).foregroundStyle(Color(red: 0x17 / 255, green: 0x17 / 255, blue: 0x1a / 255)) }
                            }
                            .padding(on ? 0 : 0)
                            .overlay {
                                if on {
                                    RoundedRectangle(cornerRadius: 8, style: .circular).strokeBorder(moreVar("color-heading", scheme), lineWidth: 2).padding(-4)
                                }
                            }
                    }
                    .buttonStyle(.plain)
                    .foleviTooltip(c.name)
                    .accessibilityLabel(c.name)
                    .accessibilityAddTraits(on ? .isSelected : [])
                }
            }
        }
    }
}

struct FolderTarget {
    let id: String?
    let name: String
}

/// The folder search and list (FolderPicker): Drafts or the top level first, then the tree; while searching
/// each match says where it is. ↑/↓ choose, Return picks; the current folder can't be picked.
struct FolderPickerView: View {
    let folders: [FolderNode]
    /// Where the notes are now: .some(nil) Drafts, nil unknown.
    let current: String??
    let moving: FolderNode?
    let pick: @MainActor (FolderTarget) -> Void
    @State private var query = ""
    @State private var active = 0
    @FocusState private var focused: Bool
    @Environment(\.colorScheme) private var scheme

    struct Option: Identifiable {
        let id: String?
        let name: String
        let color: String?
        let path: String?
        let depth: Int
        let blocked: Bool
        var key: String { id ?? "none" }
    }

    private var options: [Option] {
        var all = [Option(id: nil, name: moving == nil ? "No folder (Drafts)" : "Top level", color: nil, path: nil, depth: 0, blocked: false)]
        let byId = Dictionary(folders.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        func ancestors(_ f: FolderNode) -> [String] {
            var out: [String] = []
            var p = f.parentId
            while let id = p, let a = byId[id] { out.insert(a.name, at: 0); p = a.parentId }
            return out
        }
        func inside(_ f: FolderNode, _ m: FolderNode) -> Bool {
            var p: String? = f.id
            while let id = p { if id == m.id { return true }; p = byId[id]?.parentId }
            return false
        }
        func walk(_ parent: String?, _ d: Int) {
            for f in folders where f.parentId == parent {
                let a = ancestors(f)
                all.append(Option(id: f.id, name: f.name, color: f.color, path: a.isEmpty ? nil : a.joined(separator: " / "), depth: d, blocked: moving.map { inside(f, $0) } ?? false))
                walk(f.id, d + 1)
            }
        }
        walk(nil, 0)
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !needle.isEmpty else { return all }
        return all.filter { $0.name.lowercased().contains(needle) || ($0.id == nil && (moving == nil ? "drafts" : "top level").contains(needle)) }
    }

    private func isCurrent(_ o: Option) -> Bool { if let c = current { return o.id == c } else { return false } }
    private func unavailable(_ o: Option) -> Bool { isCurrent(o) || o.blocked }

    var body: some View {
        let input = focused ? webFocused(WebStyles.named("more.prompt.input")) : WebStyles.named("more.prompt.input")
        let i = input.resolve(scheme)
        let opts = options
        let cur = min(active, max(0, opts.count - 1))
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                WebIconView(.search, size: 14).foregroundStyle(moreVar("color-ink-faint", scheme))
                ZStack(alignment: .leading) {
                    // (No placeholder colour of its own: WebKit's, the text colour at half strength.)
                    if query.isEmpty { Text(verbatim: "Search folders").webText(i.text).lineLimit(1).foregroundStyle(i.color.color.opacity(0.5)) }
                    TextField("", text: $query)
                        .textFieldStyle(.plain).webText(i.text).lineLimit(1).offset(x: -1.125, y: 1.035)
                        .focused($focused)
                    .tint(i.color.color)
                        .onChange(of: query) { _, _ in active = 0 }
                        .onKeyPress(.downArrow) { active = (cur + 1) % max(1, opts.count); return .handled }
                        .onKeyPress(.upArrow) { active = (cur - 1 + opts.count) % max(1, opts.count); return .handled }
                        .onSubmit { if opts.indices.contains(cur) { choose(opts[cur]) } }
                        .accessibilityLabel("Search folders")
                }
            }
            .padding(.horizontal, 10)
            .frame(height: i.height)
            .foregroundStyle(i.color.color)
            .webBox(input)
            ScrollView {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(Array(opts.enumerated()), id: \.element.key) { n, o in
                        row(o, highlighted: n == cur).onHover { if $0 { active = n } }.onTapGesture { choose(o) }
                    }
                    if opts.isEmpty {
                        Text(verbatim: "No folders match “\(query.trimmingCharacters(in: .whitespaces))”.").webText(.role(.subheadline)).foregroundStyle(moreVar("color-ink-muted", scheme)).padding(.horizontal, 8).padding(.vertical, 12)
                    }
                }
            }
            .frame(maxHeight: 360)
            .fixedSize(horizontal: false, vertical: true)
        }
        .task {
            try? await Task.sleep(for: .milliseconds(60))
            focused = true
        }
    }

    private func row(_ o: Option, highlighted: Bool) -> some View {
        let style = WebStyles.named(highlighted ? "menu.item.highlighted" : "menu.item")
        let s = style.resolve(scheme)
        let searching = !query.trimmingCharacters(in: .whitespaces).isEmpty
        return HStack(spacing: s.gap) {
            if o.id != nil {
                FolderGlyph(colorId: o.color, size: 17)
            } else {
                WebIconView(moving == nil ? .inbox : .cornerLeftUp, size: 15).foregroundStyle(moreVar("color-ink-muted", scheme))
            }
            (Text(verbatim: o.name) + (searching && o.path != nil ? Text(verbatim: "  in \(o.path!)").font(WebFont.font(.sans, size: 12)).foregroundColor(moreVar("color-ink-faint", scheme)) : Text(verbatim: "")))
                .webText(s.text).lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
            if isCurrent(o) {
                HStack(spacing: 4) {
                    WebIconView(.check, size: 13, strokeWidth: 2.5)
                    Text(verbatim: "Current").webText(.role(.footnote)).lineLimit(1)
                }
                .foregroundStyle(moreVar("color-ink-muted", scheme))
            }
        }
        .padding(s.padding.edgeInsets)
        .padding(.leading, o.depth > 0 && !searching ? CGFloat(o.depth) * 20 : 0)
        .frame(maxWidth: .infinity, minHeight: s.height, alignment: .leading)
        .foregroundStyle(s.color.color)
        .webBox(style)
        .opacity(unavailable(o) ? 0.6 : 1)
        .contentShape(Rectangle())
    }

    private func choose(_ o: Option) {
        guard !unavailable(o) else { return }
        pick(FolderTarget(id: o.id, name: o.id == nil ? (moving == nil ? "Drafts" : "the top level") : o.name))
    }
}
#endif
