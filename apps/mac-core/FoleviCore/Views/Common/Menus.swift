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
        // Out of Core (Finder, Mail): the note as a Markdown file, written when it's dropped.
        FileRepresentation(exportedContentType: NoteFiles.markdown) { d in
            SentTransferredFile(try await NoteFiles.shared.file(id: d.id, title: d.title), allowAccessingOriginalFile: false)
        }
        ProxyRepresentation { (d: NoteDrag) in d.title.isEmpty ? "Untitled" : d.title }
    }
}

/// What a note's context menu offers (lists, Home, search results).
struct NoteMenu: View {
    let row: NoteRow
    let window: WindowModel
    /// Manual order: move the note up or down one place (nil where it can't move).
    var moveUp: (() -> Void)? = nil
    var moveDown: (() -> Void)? = nil
    private var app: AppModel { .shared }
    @Environment(\.openWindow) private var openWindow
    var inTrash: Bool { row.inTrash }

    var body: some View {
        if inTrash {
            Button("Restore") { app.perform { _ = try await $0.command(Commands.NoteRestore(NoteIdsArgs(ids: [row.id]))) } }
            Divider()
            Button("Delete Immediately…", role: .destructive) { NoteActions.deleteForever([row.id], app: app) }
        } else {
            if row.kind == "template" {
                Button("New Note from Template") { NoteActions.newNote(app: app, window: window, template: row.id) }
                Button("Edit Template") { window.go(.note(row.id)) }
                Divider()
            }
            Button("Open") { window.go(.note(row.id)) }
            Button("Open in New Tab") { app.open(.note(row.id), newTab: true) }
            Button("Open in Background Tab") { app.open(.note(row.id), newTab: true, background: true) }
            Button("Open in New Window") { openWindow(id: "main", value: WindowSeed(start: .note(row.id), asTab: false)) }
            Divider()
            Button(row.starred ? "Remove Star" : "Star") {
                app.perform { _ = try await $0.command(Commands.NoteStar(NoteStarArgs(ids: [row.id], starred: !row.starred))) }
            }
            Menu("Move To") { MoveTargets(ids: [row.id]) }
            Button("Move To Folder…") { window.pickFolder(.moveNotes, [row.id]) }
            Button("Copy To…") { window.pickFolder(.copyNotes, [row.id]) }
            if (app.places.value?.places.count ?? 0) > 1 { Button("Move to Another Place…") { window.placeMove = PlaceMoveTarget(notes: [row.id]) } }
            Button("Duplicate") { app.perform { _ = try await $0.command(Commands.NoteDuplicate(NoteIdArgs(id: row.id))) } }
            if moveUp != nil || moveDown != nil {
                Button("Move Up") { moveUp?() }.disabled(moveUp == nil)
                Button("Move Down") { moveDown?() }.disabled(moveDown == nil)
            }
            Divider()
            Button("Copy Link") { NoteActions.copyLink(row.id, title: row.title) }
            ShareLink(item: NoteActions.webURL(row.id)) { Text("Share…") }
            Divider()
            if row.archived {
                Button("Unarchive") { app.perform { _ = try await $0.command(Commands.NoteArchive(NoteArchiveArgs(ids: [row.id], archived: false))) } }
            } else {
                Button("Archive") { app.perform { _ = try await $0.command(Commands.NoteArchive(NoteArchiveArgs(ids: [row.id], archived: true))) } }
            }
            Button("Move to Trash", role: .destructive) { app.trash([row.id]) }
        }
    }
}

/// The folders a note can move to (Drafts, then every folder by its path).
struct MoveTargets: View {
    let ids: [String]
    private var app: AppModel { .shared }

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
    private var app: AppModel { .shared }

    var body: some View {
        Button("Open in New Tab") { app.open(.folder(folder.id), newTab: true) }
        Button("New Note in Folder") { NoteActions.newNote(app: app, window: window, folder: folder.id) }
        // Folders nest five levels at most.
        if folder.depth < 4 { Button("New Subfolder…") { newSubfolder(folder) } }
        Button("Move Folder…") { window.pickFolder(.moveFolder, [folder.id]) }
        if (app.places.value?.places.count ?? 0) > 1 { Button("Move to Another Place…") { window.placeMove = PlaceMoveTarget(folders: [folder.id]) } }
        if folder.parentId != nil {
            Button("Move to Top Level") {
                app.perform { client in
                    _ = try await client.command(Commands.FolderMove(FolderMoveArgs(id: folder.id, parentId: nil)))
                    app.toast("“\(folder.name)” moved to the top level")
                }
            }
        }
        Divider()
        Button("Rename…") { rename(folder) }
        Menu("Colour") {
            ForEach(FolderColors.all, id: \.id) { c in
                Button(c.name) { app.perform { _ = try await $0.command(Commands.FolderSetColor(FolderSetColorArgs(id: folder.id, color: c.id))) } }
            }
        }
        if app.session.value?.mode != .local, app.currentSpace?.encrypted == true || app.currentSpace?.canLock == true {
            Button(folder.locked ? "Stop Fully Encrypting…" : "Always Fully Encrypt…") { FolderActions.lock(folder, app: app) }
        }
        if app.session.value?.mode != .local {
            Button("Share Folder…") { window.go(.folder(folder.id)); window.sharingFolder = folder.id }
        }
        Divider()
        Button("Copy Folder Link") { FolderActions.copyLink(folder) }
        if app.session.value?.capabilities.ai != false {
            Button("Ask Foli AI About This Folder") {
                window.go(.folder(folder.id))
                withAnimation(.snappy) { window.askShown = true }
            }
        }
        Divider()
        Button("Delete Folder…", role: .destructive) { NoteActions.deleteFolder(folder, app: app) }
    }
}

@MainActor
enum FolderActions {
    /// Why a folder can't go into another (itself, one of its own subfolders, or deeper than five levels), or nil.
    static func refusal(moving id: String, into target: String) -> String? {
        let all = AppModel.shared.tree.value?.folders ?? []
        let byId = Dictionary(all.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        if id == target { return "A folder can't go inside itself." }
        var p: String? = target
        while let x = p { if x == id { return "A folder can't go inside one of its own folders." }; p = byId[x]?.parentId }
        func height(_ f: String) -> Int { 1 + (all.filter { $0.parentId == f }.map { height($0.id) }.max() ?? 0) }
        if (byId[target]?.depth ?? 0) + 1 + height(id) > 5 { return "Folders nest up to 5 levels." }
        return nil
    }

    /// Moves a folder into another, or says why it can't.
    static func move(_ id: String, into target: String) -> Bool {
        if let why = refusal(moving: id, into: target) { AppModel.shared.toast(why, tone: .error); return false }
        AppModel.shared.perform { _ = try await $0.command(Commands.FolderMove(FolderMoveArgs(id: id, parentId: target))) }
        return true
    }

    static func webURL(_ id: String) -> URL { Paths.serviceURL.appendingPathComponent("folders").appendingPathComponent(id) }

    static func copyLink(_ folder: FolderNode) {
        let pb = NSPasteboard.general
        pb.clearContents()
        pb.setString(webURL(folder.id).absoluteString, forType: .string)
        AppModel.shared.toast("Link copied")
    }

    /// Always fully encrypted: explains what changes before turning it on or off.
    static func lock(_ folder: FolderNode, app: AppModel) {
        let alert = NSAlert()
        if folder.locked {
            alert.messageText = "Stop fully encrypting “\(folder.name)”?"
            alert.informativeText = "Its notes go back to the space's own encryption. Search, previews and Foli AI can read them again."
            alert.addButton(withTitle: "Stop Encrypting")
        } else {
            alert.messageText = "Always fully encrypt “\(folder.name)”?"
            alert.informativeText = "Its notes are encrypted on your devices before they sync. Only people with the key can read them, so search, previews and Foli AI skip them."
            alert.addButton(withTitle: "Encrypt")
        }
        alert.addButton(withTitle: "Cancel")
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        app.perform { _ = try await $0.command(Commands.FolderLock(FolderLockArgs(id: folder.id, locked: !folder.locked))) }
    }

    /// Several folders: delete them all (notes go to Drafts, subfolders up a level).
    static func delete(_ ids: [String], app: AppModel) {
        let alert = NSAlert()
        alert.messageText = ids.count == 1 ? "Delete this folder?" : "Delete \(ids.count) folders?"
        alert.informativeText = "Their notes move to Drafts, and their subfolders move up a level."
        alert.alertStyle = .warning
        alert.addButton(withTitle: "Delete")
        alert.addButton(withTitle: "Cancel")
        alert.buttons.first?.hasDestructiveAction = true
        CoreAlerts.cancelIsDefault(alert)
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        app.perform { client in
            for id in ids { _ = try await client.command(Commands.FolderDelete(FolderIdArgs(id: id))) }
            app.toast(ids.count == 1 ? "Folder deleted" : "\(ids.count) folders deleted")
        }
    }
}

/// Edit a tag: its name (40 characters at most) and one of the six tag colours.
struct TagEditSheet: View {
    let id: String
    let initialName: String
    let initialColor: String?
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var color: String?
    @State private var saving = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Edit Tag").font(.headline)
            TextField("Name", text: $name).textFieldStyle(.roundedBorder)
                .onChange(of: name) { if name.count > 40 { name = String(name.prefix(40)) } }
            HStack(spacing: 10) {
                ForEach(TagColors.all, id: \.id) { c in
                    Button { color = c.id } label: {
                        Circle().fill(Color.folevi(c.id)).frame(width: 20, height: 20)
                            .overlay { if color == c.id { Circle().strokeBorder(Color.primary, lineWidth: 2).padding(-3) } }
                    }
                    .buttonStyle(.plain)
                    .help(c.name)
                    .accessibilityLabel(c.name)
                    .accessibilityAddTraits(color == c.id ? .isSelected : [])
                }
            }
            HStack {
                Spacer()
                Button("Cancel", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
                Button(saving ? "Saving…" : "Save") {
                    saving = true
                    let n = name.trimmingCharacters(in: .whitespaces)
                    AppModel.shared.perform { client in
                        _ = try await client.command(Commands.TagUpdate(TagUpdateArgs(id: id, name: n == initialName ? nil : n, color: color == initialColor ? nil : color)))
                        AppModel.shared.toast("Tag updated")
                    }
                    dismiss()
                }
                .buttonStyle(InkPillStyle())
                .keyboardShortcut(.defaultAction)
                .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || saving)
            }
        }
        .padding(20)
        .frame(width: 340)
        .onAppear { name = initialName; color = initialColor }
    }
}

@MainActor
enum TagActions {
    /// Asks first; leaves the tag's page if it's on screen.
    static func delete(id: String, name: String, window: WindowModel?) {
        let alert = NSAlert()
        alert.messageText = "Delete #\(name)?"
        alert.informativeText = "The tag is removed from every note that has it. The notes stay."
        alert.alertStyle = .warning
        alert.addButton(withTitle: "Delete")
        alert.addButton(withTitle: "Cancel")
        alert.buttons.first?.hasDestructiveAction = true
        CoreAlerts.cancelIsDefault(alert)
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        if window?.current == .tag(id) { window?.go(.home) }
        AppModel.shared.perform { client in
            _ = try await client.command(Commands.TagDelete(TagIdArgs(id: id)))
            AppModel.shared.toast("Deleted #\(name)")
        }
    }
}

/// Folevi's folder colours (the design tokens) and tag colours (the web's six), by id and name.
enum FolderColors {
    static var all: [(id: String, name: String)] { FoleviTokens.folderColors.map { ($0.id, $0.name) } }
}

enum TagColors {
    static let all: [(id: String, name: String)] = [("accent", "Cocoa"), ("moss", "Moss"), ("marigold", "Marigold"), ("plum", "Plum"), ("coral", "Coral"), ("muted", "Muted")]
}

/// The place and space menu at the top of the sidebar: the account or library, its spaces, the other places on
/// this Mac, adding an account, and Settings.
struct PlaceMenu: View {
    private var app: AppModel { .shared }
    @Environment(\.openSettings) private var openSettings
    @State private var newWorkspace = false

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
            if let current = app.places.value?.current {
                if current == "library" {
                    Button("Stop Keeping a Library on This Mac…") { AccountActions.forgetLibrary() }
                } else {
                    Button("Sign Out of This Account…") { AccountActions.signOut(current) }
                }
            }
            if app.session.value?.mode == .account {
                Button("New Workspace…") { newWorkspace = true }
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
        .sheet(isPresented: $newWorkspace) { NewWorkspaceSheet() }
        .accessibilityLabel("Spaces and accounts, \(app.spaceName)")
    }

    private func switchSpace(_ id: String) {
        app.perform { _ = try await $0.command(Commands.SpaceSwitch(SpaceSwitchArgs(space: id))) }
    }
}

/// The open place's picture: the profile's photo, or its initial on the accent colour.
struct PlaceAvatar: View {
    private var app: AppModel { .shared }
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
            .background(Circle().fill(Color.foleviInk.gradient))
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
        CoreAlerts.cancelIsDefault(alert)
        let run = { app.perform { _ = try await $0.command(Commands.NoteDeleteForever(NoteIdsArgs(ids: ids))) } }
        if let w = NSApp.keyWindow { alert.beginSheetModal(for: w) { if $0 == .alertFirstButtonReturn { run() } } } else if alert.runModal() == .alertFirstButtonReturn { run() }
    }

    static func deleteFolder(_ folder: FolderNode, app: AppModel) {
        let alert = NSAlert()
        alert.messageText = "Delete “\(folder.name)”?"
        alert.informativeText = folder.childCount > 0
            ? "The folder is removed. Its notes are kept and move to Drafts. Its \(folder.childCount == 1 ? "subfolder moves" : "subfolders move") up a level, with everything inside."
            : "The folder is removed. Its notes are kept and move to Drafts."
        alert.alertStyle = .warning
        alert.addButton(withTitle: "Delete")
        alert.addButton(withTitle: "Cancel")
        alert.buttons.first?.hasDestructiveAction = true
        CoreAlerts.cancelIsDefault(alert)
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
    static func signOut(_ place: String) {
        let alert = NSAlert()
        let waiting = AppModel.shared.places.value?.current == place ? (AppModel.shared.sync.value?.pending ?? 0) : 0
        alert.messageText = "Sign out of this account on this Mac?"
        if waiting > 0 {
            // Unsynced changes: say so plainly, and make signing out the deliberate choice.
            alert.alertStyle = .critical
            alert.informativeText = "\(waiting) \(waiting == 1 ? "change hasn't" : "changes haven't") synced yet. If you sign out now they stay on this Mac until you sign in again, and other devices won't see them."
            alert.addButton(withTitle: "Sign Out Anyway")
        } else {
            alert.informativeText = "Your notes stay in your account."
            alert.addButton(withTitle: "Sign Out")
        }
        alert.addButton(withTitle: "Cancel")
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        Task { await Places.shared.signOut(place, next: nil) }
    }

    static func forgetLibrary() {
        let alert = NSAlert()
        alert.messageText = "Stop keeping a library on this Mac?"
        alert.informativeText = "Folevi Core forgets the library. Its folder and notes stay where they are, and you can open it again later."
        alert.addButton(withTitle: "Forget Library")
        alert.addButton(withTitle: "Cancel")
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        Task { await Places.shared.forgetLibrary() }
    }

    static func addAccount(provider: String? = nil) {
        Task { @MainActor in
            guard let u = await ShellAuth.shared.signInAccount(window: NSApp.keyWindow, provider: provider), let a = Places.shared.addAccount(u) else { return }
            Places.shared.switchTo(a.id, path: "/documents")
        }
    }
}

enum CoreAlerts {
    /// A destructive alert's Return key cancels; the destructive button needs a click (HIG).
    static func cancelIsDefault(_ alert: NSAlert) {
        guard alert.buttons.count >= 2 else { return }
        alert.buttons[0].keyEquivalent = ""
        alert.buttons[1].keyEquivalent = "\r"
    }
}
