// The menus and small sheets the screens share: a note's and a folder's context menus, the place and space
// menu at the top of the sidebar, the name sheet, and the drag item for notes.
import CoreTransferable
import FoleviDesign
import FoleviEngine
import SwiftUI
import UniformTypeIdentifiers

/// A note dragged within Core (onto a folder, Trash, another window) and out as a link.
struct NoteDrag: Codable, Transferable {
    var id: String
    var title: String

    static let type = UTType(exportedAs: "app.folevicore.note-drag")

    static var transferRepresentation: some TransferRepresentation {
        CodableRepresentation(contentType: type)
        ProxyRepresentation { (d: NoteDrag) in d.title.isEmpty ? "Untitled" : d.title }
    }
}

/// What a note's context menu offers (lists, Home, search results).
struct NoteMenu: View {
    let row: NoteRow
    let window: WindowModel
    @Environment(AppModel.self) private var app
    @Environment(\.openWindow) private var openWindow
    var inTrash: Bool { row.inTrash }

    var body: some View {
        if inTrash {
            Button("Restore") { app.perform { _ = try await $0.command(Commands.NoteRestore(NoteIdsArgs(ids: [row.id]))) } }
            Divider()
            Button("Delete Immediately…", role: .destructive) { NoteActions.deleteForever([row.id], app: app) }
        } else {
            Button("Open") { window.go(.note(row.id)) }
            Button("Open in New Tab") { app.open(.note(row.id), newTab: true) }
            Button("Open in New Window") { openWindow(id: "main", value: WindowSeed(start: .note(row.id), asTab: false)) }
            Divider()
            Button(row.starred ? "Remove Star" : "Star") {
                app.perform { _ = try await $0.command(Commands.NoteStar(NoteStarArgs(ids: [row.id], starred: !row.starred))) }
            }
            Menu("Move To") { MoveTargets(ids: [row.id]) }
            Button("Duplicate") { app.perform { _ = try await $0.command(Commands.NoteDuplicate(NoteIdArgs(id: row.id))) } }
            Divider()
            Button("Copy Link") { NoteActions.copyLink(row.id, title: row.title) }
            ShareLink(item: NoteActions.webURL(row.id)) { Text("Share…") }
            Divider()
            if row.archived {
                Button("Unarchive") { app.perform { _ = try await $0.command(Commands.NoteArchive(NoteArchiveArgs(ids: [row.id], archived: false))) } }
            } else {
                Button("Archive") { app.perform { _ = try await $0.command(Commands.NoteArchive(NoteArchiveArgs(ids: [row.id], archived: true))) } }
            }
            Button("Move to Trash", role: .destructive) { app.perform { _ = try await $0.command(Commands.NoteTrash(NoteIdsArgs(ids: [row.id]))) } }
        }
    }
}

/// The folders a note can move to (Drafts, then every folder by its path).
struct MoveTargets: View {
    let ids: [String]
    @Environment(AppModel.self) private var app

    var body: some View {
        Button("Drafts") { move(to: nil) }
        Divider()
        ForEach(ordered, id: \.0.id) { folder, depth in
            Button {
                move(to: folder.id)
            } label: {
                Text(String(repeating: "    ", count: depth) + folder.name)
            }
        }
    }

    private var ordered: [(FolderNode, Int)] {
        let all = app.tree.value?.folders ?? []
        var out: [(FolderNode, Int)] = []
        func walk(_ parent: String?, _ depth: Int) {
            for f in all.filter({ $0.parentId == parent }).sorted(by: { $0.rank < $1.rank }) {
                out.append((f, depth))
                walk(f.id, depth + 1)
            }
        }
        walk(nil, 0)
        return out
    }

    private func move(to folder: String?) {
        app.perform { _ = try await $0.command(Commands.NoteMove(NoteMoveArgs(ids: ids, folderId: folder))) }
    }
}

/// A folder's context menu (sidebar, folder cards).
struct FolderMenu: View {
    let folder: FolderNode
    let window: WindowModel
    let rename: (FolderNode) -> Void
    let newSubfolder: (FolderNode) -> Void
    @Environment(AppModel.self) private var app

    var body: some View {
        Button("Open in New Tab") { app.open(.folder(folder.id), newTab: true) }
        Button("New Note in Folder") { NoteActions.newNote(app: app, window: window, folder: folder.id) }
        Button("New Subfolder…") { newSubfolder(folder) }
        Divider()
        Button("Rename…") { rename(folder) }
        Menu("Colour") {
            ForEach(FolderColors.all, id: \.self) { id in
                Button(id.capitalized) { app.perform { _ = try await $0.command(Commands.FolderSetColor(FolderSetColorArgs(id: folder.id, color: id))) } }
            }
        }
        if app.session.value?.mode != .local, app.currentSpace?.encrypted == true || app.currentSpace?.canLock == true {
            Button(folder.locked ? "Unlock Folder" : "Lock Folder…") {
                app.perform { _ = try await $0.command(Commands.FolderLock(FolderLockArgs(id: folder.id, locked: !folder.locked))) }
            }
        }
        if app.session.value?.mode != .local {
            Button("Share Folder…") { window.go(.folder(folder.id)); window.sharingFolder = folder.id }
        }
        Divider()
        Button("Delete Folder…", role: .destructive) { NoteActions.deleteFolder(folder, app: app) }
    }
}

enum FolderColors {
    static let all = ["gray", "red", "orange", "yellow", "green", "teal", "blue", "purple", "pink", "brown"]
}

/// The place and space menu at the top of the sidebar: the account or library, its spaces, the other places on
/// this Mac, adding an account, and Settings.
struct PlaceMenu: View {
    @Environment(AppModel.self) private var app
    @Environment(\.openSettings) private var openSettings

    var body: some View {
        Menu {
            if let s = app.session.value {
                Section(s.mode == .local ? "On This Mac" : s.profile.email) {
                    ForEach(s.spaces, id: \.id) { space in
                        Toggle(isOn: Binding(get: { space.id == s.space }, set: { if $0 { switchSpace(space.id) } })) {
                            Label(space.name, systemImage: space.kind == .personal ? "person" : "person.3")
                        }
                    }
                }
            }
            if let places = app.places.value, places.places.count > 1 {
                Section("Places") {
                    ForEach(places.places, id: \.id) { p in
                        Toggle(isOn: Binding(get: { p.id == places.current }, set: { if $0 { Places.shared.switchTo(p.id) } })) {
                            Text(p.kind == .library ? "On This Mac" : p.name)
                            if p.unread > 0 { Text("\(p.unread) unread") }
                        }
                    }
                }
            }
            Divider()
            Button("Add Account…") { AccountActions.addAccount() }
            if app.session.value?.mode == .account {
                Button("New Workspace…") { app.toast("Create a workspace in Settings > Workspace.") ; SettingsRouter.shared.open("workspace") }
            }
            Divider()
            Button("Settings…") { openSettings() }
        } label: {
            HStack(spacing: 8) {
                PlaceAvatar()
                VStack(alignment: .leading, spacing: 0) {
                    Text(app.spaceName).font(.headline).lineLimit(1)
                    if let s = app.session.value, s.mode == .account { Text(s.profile.name).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                }
                Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.visible)
        .help("Spaces and accounts")
        .accessibilityLabel("Spaces and accounts, \(app.spaceName)")
    }

    private func switchSpace(_ id: String) {
        app.perform { _ = try await $0.command(Commands.SpaceSwitch(SpaceSwitchArgs(space: id))) }
    }
}

/// The open place's picture: the profile's photo, or its initial on the accent colour.
struct PlaceAvatar: View {
    @Environment(AppModel.self) private var app
    var size: CGFloat = 26

    var body: some View {
        let s = app.session.value
        Group {
            if s?.mode == .local {
                Image(systemName: "laptopcomputer").font(.system(size: size * 0.5)).foregroundStyle(.white)
                    .frame(width: size, height: size).background(Circle().fill(.gray.gradient))
            } else if let url = s?.profile.avatarUrl.flatMap(URL.init(string:)) {
                AsyncImage(url: url) { $0.resizable().scaledToFill() } placeholder: { initial(s) }
                    .frame(width: size, height: size).clipShape(Circle())
            } else {
                initial(s)
            }
        }
        .accessibilityHidden(true)
    }

    private func initial(_ s: SessionValue?) -> some View {
        Text(String((s?.profile.name ?? "F").prefix(1)).uppercased())
            .font(.system(size: size * 0.45, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(Circle().fill(Color.accentColor.gradient))
    }
}

/// A small sheet that asks for a name (new folder, rename).
struct NameSheet: View {
    var title: String
    var initial: String
    var action: String
    var done: (String) -> Void
    @State private var name = ""
    @Environment(\.dismiss) private var dismiss
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(title).font(.headline)
            TextField("Name", text: $name)
                .textFieldStyle(.roundedBorder)
                .focused($focused)
                .onSubmit(commit)
                .frame(width: 280)
            HStack {
                Spacer()
                Button("Cancel", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
                Button(action, action: commit).keyboardShortcut(.defaultAction).disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(20)
        .onAppear { name = initial; focused = true }
    }

    private func commit() {
        let clean = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { return }
        done(String(clean.prefix(120)))
        dismiss()
    }
}

/// Actions more than one screen runs.
@MainActor
enum NoteActions {
    /// New note: in `folder` (or the folder on screen), opened ready to type.
    static func newNote(app: AppModel, window: WindowModel?, folder: String? = nil, template: String? = nil, newTab: Bool = false) {
        let target = folder ?? { if case .folder(let id) = window?.current { return id } else { return nil } }()
        app.perform { client in
            let r = try await client.command(Commands.NoteCreate(NoteCreateArgs(space: nil, folderId: target, parentId: nil, title: nil, templateId: template, open: false, text: nil)))
            if newTab || window == nil { app.open(.note(r.id), newTab: true) } else { window?.go(.note(r.id)) }
            window?.focusNoteSoon = true
        }
    }

    static func deleteForever(_ ids: [String], app: AppModel) {
        let alert = NSAlert()
        alert.messageText = ids.count == 1 ? "Delete this note immediately?" : "Delete \(ids.count) notes immediately?"
        alert.informativeText = "You can't undo this."
        alert.alertStyle = .warning
        alert.addButton(withTitle: "Delete")
        alert.addButton(withTitle: "Cancel")
        alert.buttons.first?.hasDestructiveAction = true
        let run = { app.perform { _ = try await $0.command(Commands.NoteDeleteForever(NoteIdsArgs(ids: ids))) } }
        if let w = NSApp.keyWindow { alert.beginSheetModal(for: w) { if $0 == .alertFirstButtonReturn { run() } } } else if alert.runModal() == .alertFirstButtonReturn { run() }
    }

    static func deleteFolder(_ folder: FolderNode, app: AppModel) {
        let alert = NSAlert()
        alert.messageText = "Delete “\(folder.name)”?"
        alert.informativeText = "Its notes move to Trash. Subfolders are deleted too."
        alert.alertStyle = .warning
        alert.addButton(withTitle: "Delete")
        alert.addButton(withTitle: "Cancel")
        alert.buttons.first?.hasDestructiveAction = true
        let run = { app.perform { _ = try await $0.command(Commands.FolderDelete(FolderIdArgs(id: folder.id))) } }
        if let w = NSApp.keyWindow { alert.beginSheetModal(for: w) { if $0 == .alertFirstButtonReturn { run() } } } else if alert.runModal() == .alertFirstButtonReturn { run() }
    }

    static func webURL(_ id: String) -> URL {
        Paths.serviceURL.appendingPathComponent("d").appendingPathComponent(id)
    }

    static func copyLink(_ id: String, title: String) {
        let pb = NSPasteboard.general
        pb.clearContents()
        let url = webURL(id)
        pb.writeObjects([url as NSURL])
        pb.setString(url.absoluteString, forType: .string)
        AppModel.shared.toast("Link copied")
    }
}

/// Adding an account: Folevi's sign-in in the system's sheet; the account becomes one of this Mac's places.
@MainActor
enum AccountActions {
    static func addAccount(provider: String? = nil) {
        Task { @MainActor in
            guard let u = await ShellAuth.shared.signInAccount(window: NSApp.keyWindow, provider: provider), let a = Places.shared.addAccount(u) else { return }
            Places.shared.switchTo(a.id, path: "/documents")
        }
    }
}
