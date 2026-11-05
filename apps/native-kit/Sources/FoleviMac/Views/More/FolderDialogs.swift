// The small dialogs the frame opens from the sidebar and list screens, as the web draws them on the Mac:
// a name prompt (ui/PromptDialog.tsx: New folder, Rename folder, New workspace), a folder's colour (app/FolderColorDialog.tsx,
// the palette's 25) and the folder picker (views/MoveToFolderDialog.tsx: Move to folder, Move folder).
#if os(macOS) || os(iOS)
#if os(macOS)
import AppKit
#else
import UIKit
#endif
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

    /// The sidebar's New folder (or a folder's New folder inside…). `open`: the new folder opens (the Folders
    /// page's New folder, as on the web).
    public static func newFolder(_ frame: FrameModel, parent: FolderNode? = nil, open: Bool = false) {
        prompt(frame, title: parent.map { "New folder in “\($0.name)”" } ?? "New folder", label: "Folder name", confirm: "Create folder") { name in
            frame.newFolder(name: name, parent: parent?.id, open: open)
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

    /// The account menu's New workspace…: its name, then the team workspace is made and shown
    /// (app/NewWorkspaceDialog.tsx, `workspace.create`).
    public static func newWorkspace(_ frame: FrameModel) {
        prompt(frame, title: "New workspace", label: "Workspace name", confirm: "Create workspace") { name in
            frame.perform {
                _ = try await frame.client.command(.workspaceCreate(name: name))
                frame.toast("Created \(name)", tone: .success)
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

    /// Move to folder for notes (one or many): Drafts, a folder, or a new folder made here (the web's
    /// MoveToFolderDialog, its last row).
    public static func moveNotes(_ frame: FrameModel, ids: [String], title: String?, currentFolderId: String??) {
        let what = ids.count == 1 ? "“\((title ?? "").trimmingCharacters(in: .whitespaces).isEmpty ? "Untitled" : title!)”" : "\(ids.count.formatted()) notes"
        FrameSheets.present(frame) { close in
            WebSheetDialog(title: "Move to folder", description: "Choose where \(what) should live.", close: close) {
                FolderPickerView(folders: frame.folders.value?.folders ?? [], current: currentFolderId, moving: nil, pick: { target in
                    close()
                    frame.perform {
                        _ = try await frame.client.command(.noteMove(ids: ids, folderId: target.id))
                        frame.toast("Moved to \(target.id == nil ? "Drafts" : "“\(target.name)”")", tone: .success)
                    }
                }, create: { name in
                    close()
                    frame.perform {
                        let made = try await frame.client.command(.folderCreate(name: name))
                        _ = try await frame.client.command(.noteMove(ids: ids, folderId: made.id))
                        frame.toast("Moved to “\(name)”", tone: .success)
                    }
                })
            }
        }
    }

    /// Copy to (the web's CopyToDialog): another space, chosen in Folevi's own select, then its Drafts or one
    /// of its folders. `copy` makes the copies.
    public static func copyNotes(_ frame: FrameModel, ids: [String], spaces: [SpaceInfo], copy: @escaping @MainActor (SpaceInfo, FoleviScreens.FolderTarget) async -> Void) {
        guard !spaces.isEmpty else { return }
        let what = ids.count == 1 ? "this note" : "\(ids.count.formatted()) notes"
        let target = CopyTargetModel(client: frame.client, space: spaces.first)
        FrameSheets.present(frame) { close in
            WebSheetDialog(title: ids.count == 1 ? "Copy note to" : "Copy \(ids.count.formatted()) notes to", description: "Choose the space and folder for a copy of \(what). The original stays where it is.", close: close) {
                CopyPickerView(model: target, spaces: spaces) { space, folder in
                    close()
                    Task { await copy(space, folder) }
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
                    .buttonStyle(.webPlain)
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
    /// Makes a folder of this name (at the top level) and picks it: the list's last row offers it.
    var create: (@MainActor (String) -> Void)? = nil
    @State private var query = ""
    @State private var active = 0
    /// Naming a new folder: the field is its name, and Return makes it.
    @State private var naming = false
    @FocusState private var focused: Bool
    @Environment(\.colorScheme) private var scheme

    struct Option: Identifiable {
        let id: String?
        let name: String
        let color: String?
        let path: String?
        let depth: Int
        let blocked: Bool
        /// The row that makes a folder: `path` is the name to give it (the search), nil to ask for one.
        var isNew = false
        var key: String { isNew ? "new" : (id ?? "none") }
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
        let shown = needle.isEmpty ? all : all.filter { $0.name.lowercased().contains(needle) || ($0.id == nil && (moving == nil ? "drafts" : "top level").contains(needle)) }
        guard create != nil else { return shown }
        // A search for a name no folder has offers to make it.
        let named = !needle.isEmpty && !folders.contains { $0.name.trimmingCharacters(in: .whitespaces).lowercased() == needle } ? query.trimmingCharacters(in: .whitespaces) : nil
        return shown + [Option(id: nil, name: named.map { "New folder “\($0)”" } ?? "New folder…", color: nil, path: named, depth: 0, blocked: false, isNew: true)]
    }

    private func isCurrent(_ o: Option) -> Bool { if !o.isNew, let c = current { return o.id == c } else { return false } }
    private func unavailable(_ o: Option) -> Bool { isCurrent(o) || o.blocked }

    var body: some View {
        let input = focused ? webFocused(WebStyles.named("more.prompt.input")) : WebStyles.named("more.prompt.input")
        let i = input.resolve(scheme)
        let opts = options
        let cur = min(active, max(0, opts.count - 1))
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                WebIconView(naming ? .folderPlus : .search, size: 14).foregroundStyle(moreVar("color-ink-faint", scheme))
                ZStack(alignment: .leading) {
                    // (No placeholder colour of its own: WebKit's, the text colour at half strength.)
                    if query.isEmpty { Text(verbatim: naming ? "Name the new folder" : "Search folders").webText(i.text).lineLimit(1).foregroundStyle(i.color.color.opacity(0.5)) }
                    TextField("", text: $query)
                        .textFieldStyle(.plain).webText(i.text).lineLimit(1).offset(x: -1.125, y: 1.035)
                        .focused($focused)
                    .tint(i.color.color)
                        .onChange(of: query) { _, _ in active = 0 }
                        .onKeyPress(.downArrow) { if naming { return .ignored }; active = (cur + 1) % max(1, opts.count); return .handled }
                        .onKeyPress(.upArrow) { if naming { return .ignored }; active = (cur - 1 + opts.count) % max(1, opts.count); return .handled }
                        .onSubmit {
                            if naming { make(query) } else if opts.indices.contains(cur) { choose(opts[cur]) }
                        }
                        .accessibilityLabel(naming ? "New folder name" : "Search folders")
                }
            }
            .padding(.horizontal, 10)
            .frame(height: i.height)
            .foregroundStyle(i.color.color)
            .webBox(input)
            if naming {
                HStack(spacing: 12) {
                    let name = query.trimmingCharacters(in: .whitespaces)
                    Text(verbatim: name.isEmpty ? "Type a name, then press Return." : "Press Return to make “\(name)” and move there.")
                        .webText(.role(.subheadline)).foregroundStyle(moreVar("color-ink-muted", scheme))
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Button { naming = false; query = ""; focused = true } label: {
                        Text(verbatim: "Back to folders").webText(.role(.subheadline)).foregroundStyle(moreVar("color-heading", scheme))
                            .padding(.horizontal, 8).padding(.vertical, 4).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 8).padding(.vertical, 8)
            } else {
            ScrollView {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(Array(opts.enumerated()), id: \.element.key) { n, o in
                        row(o, highlighted: n == cur).onHover { if $0 { active = n } }.onTapGesture { choose(o) }
                    }
                    if !opts.contains(where: { !$0.isNew }) {
                        Text(verbatim: "No folders match “\(query.trimmingCharacters(in: .whitespaces))”.").webText(.role(.subheadline)).foregroundStyle(moreVar("color-ink-muted", scheme)).padding(.horizontal, 8).padding(.vertical, 12)
                    }
                }
            }
            .frame(maxHeight: 360)
            .fixedSize(horizontal: false, vertical: true)
            }
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
            if o.isNew {
                WebIconView(.folderPlus, size: 15).foregroundStyle(moreVar("color-ink-muted", scheme))
            } else if o.id != nil {
                FolderGlyph(colorId: o.color, size: 17)
            } else {
                WebIconView(moving == nil ? .inbox : .cornerLeftUp, size: 15).foregroundStyle(moreVar("color-ink-muted", scheme))
            }
            (Text(verbatim: o.name) + (searching && o.path != nil && !o.isNew ? Text(verbatim: "  in \(o.path!)").font(WebFont.font(.sans, size: 12)).foregroundColor(moreVar("color-ink-faint", scheme)) : Text(verbatim: "")))
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

    private func make(_ name: String) {
        let clean = name.trimmingCharacters(in: .whitespaces)
        guard !clean.isEmpty, let create else { return }
        create(clean)
    }

    private func choose(_ o: Option) {
        guard !unavailable(o) else { return }
        if o.isNew {
            if let name = o.path { make(name) } else { naming = true; query = ""; focused = true }
            return
        }
        pick(FolderTarget(id: o.id, name: o.id == nil ? (moving == nil ? "Drafts" : "the top level") : o.name))
    }
}
/// Copy to's body: the space in Folevi's own select (never the system's), then that space's folders in the
/// folder picker.
struct CopyPickerView: View {
    let model: CopyTargetModel
    let spaces: [SpaceInfo]
    let pick: @MainActor (SpaceInfo, FoleviScreens.FolderTarget) -> Void
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if spaces.count > 1 {
                HStack(spacing: 12) {
                    Text(verbatim: "Copy into").webText(.role(.callout, weight: 500)).foregroundStyle(moreVar("color-heading", scheme))
                    Spacer(minLength: 0)
                    SettingsSelect(options: spaces.map { .init(value: $0.id, label: $0.name) }, value: model.space?.id ?? "", width: 220) { id in
                        model.space = spaces.first { $0.id == id }
                    }
                }
            }
            if model.loading {
                Text(verbatim: "Loading folders…").webText(.role(.subheadline)).foregroundStyle(moreVar("color-ink-muted", scheme)).padding(.vertical, 12)
            } else if let space = model.space {
                FolderPickerView(folders: model.folders, current: nil, moving: nil, pick: { t in
                    pick(space, t.id.map { FoleviScreens.FolderTarget(id: $0, name: t.name) } ?? .drafts)
                })
                .id(space.id)
            }
        }
    }
}
#endif
