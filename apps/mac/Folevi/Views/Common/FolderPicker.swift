// The folder picker: where notes move or copy to, or where a folder moves. A sheet with a search field, the
// space's folders as a tree (Drafts or the top level first), New Folder in place, arrow keys and Return. Copy To
// can pick another space; Move To Another Place moves to another account or the library on this Mac.
import FoleviDesign
import FoleviEngine
import SwiftUI

struct FolderPickTarget: Identifiable {
    enum Action { case moveNotes, copyNotes, moveFolder }
    let id = UUID()
    let action: Action
    let ids: [String]
    /// Folders moving along with the notes (a mixed selection).
    var folders: [String] = []
    var mixed: Bool { action == .moveNotes && !folders.isEmpty }
    var title: String {
        switch action {
        case .moveNotes where mixed: "Move \(ids.count + folders.count) Items"
        case .moveNotes: ids.count == 1 ? "Move Note" : "Move \(ids.count) Notes"
        case .copyNotes: ids.count == 1 ? "Copy Note To" : "Copy \(ids.count) Notes To"
        case .moveFolder: "Move Folder"
        }
    }
}

struct FolderPickerSheet: View {
    let target: FolderPickTarget
    private var app: AppModel { .shared }
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var picked: String? = nil
    @State private var space: String?
    @State private var newFolder = false
    @FocusState private var searching: Bool

    private struct Row: Identifiable, Hashable { let id: String; let name: String; let color: String?; let depth: Int }

    private var rows: [Row] {
        let all = app.tree.value?.folders ?? []
        var out: [Row] = []
        func walk(_ parent: String?, _ depth: Int) {
            for f in all.filter({ $0.parentId == parent }).sorted(by: { $0.rank < $1.rank }) {
                // A folder can't move into itself or its own subfolders.
                if target.action == .moveFolder, target.ids.contains(f.id) { continue }
                if target.folders.contains(f.id) { continue }
                out.append(Row(id: f.id, name: f.name, color: f.color, depth: depth))
                walk(f.id, depth + 1)
            }
        }
        walk(nil, 0)
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        return q.isEmpty ? out : out.filter { $0.name.lowercased().contains(q) }.map { Row(id: $0.id, name: $0.name, color: $0.color, depth: 0) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(target.title).font(.headline).padding([.horizontal, .top], 16)
            HStack {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("Find a folder", text: $query).textFieldStyle(.plain).focused($searching).onSubmit(commit)
            }
            .padding(8)
            .background(.fill.quinary, in: .rect(cornerRadius: 8))
            .padding(16)
            if target.action == .copyNotes, let spaces = app.session.value?.spaces, spaces.count > 1 {
                Picker("Space", selection: Binding(get: { space ?? app.session.value?.space ?? "" }, set: { space = $0 })) {
                    ForEach(spaces, id: \.id) { Text($0.name).tag($0.id) }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 8)
            }
            List(selection: $picked) {
                // A mix of notes and folders needs a folder: neither Drafts nor the top level takes both.
                if !target.mixed {
                    Label { Text(target.action == .moveFolder ? "Top Level" : "Drafts") } icon: { (target.action == .moveFolder ? WebIcon.folderTree : WebIcon.penLine).image(size: 15) }
                        .tag("top")
                }
                ForEach(rows) { r in
                    Label { Text(r.name) } icon: { FolderMark(colorId: r.color, size: 14) }
                        .padding(.leading, CGFloat(r.depth) * 16)
                        .tag(r.id)
                }
            }
            .listStyle(.inset)
            .frame(height: 300)
            .onKeyPress(.return) { commit(); return .handled }
            HStack {
                Button("New Folder…") { newFolder = true }
                Spacer()
                Button("Cancel", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
                Button(target.action == .copyNotes ? "Copy" : "Move", action: commit)
                    .buttonStyle(InkPillStyle())
                    .keyboardShortcut(.defaultAction)
                    .disabled(picked == nil)
            }
            .padding(16)
        }
        .frame(width: 420)
        .onAppear { searching = true; if !target.mixed { picked = "top" } }
        .sheet(isPresented: $newFolder) {
            NameSheet(title: "New Folder", initial: query, action: "Create") { name in
                let parent = picked == "top" ? nil : picked
                app.perform { _ = try await $0.command(Commands.FolderCreate(FolderCreateArgs(space: nil, name: name, parentId: parent))) }
            }
        }
    }

    private func commit() {
        guard let picked else { return }
        let folder = picked == "top" ? nil : picked
        let ids = target.ids
        switch target.action {
        case .moveNotes where target.mixed:
            guard let folder else { return }
            var refused = 0
            for f in target.folders { if FolderActions.refusal(moving: f, into: folder) != nil { refused += 1 } }
            let moving = target.folders.filter { FolderActions.refusal(moving: $0, into: folder) == nil }
            app.perform { client in
                _ = try await client.command(Commands.NoteMove(NoteMoveArgs(ids: ids, folderId: folder)))
                for f in moving { _ = try await client.command(Commands.FolderMove(FolderMoveArgs(id: f, parentId: folder))) }
                let name = app.tree.value?.folders.first { $0.id == folder }?.name ?? "the folder"
                app.toast("Moved \(ids.count + moving.count) to \(name)" + (refused > 0 ? ". \(refused) couldn't move." : ""))
            }
        case .moveNotes:
            app.perform { _ = try await $0.command(Commands.NoteMove(NoteMoveArgs(ids: ids, folderId: folder))) }
        case .copyNotes:
            let to = space ?? app.session.value?.space ?? ""
            app.perform { client in
                let r = try await client.command(Commands.NoteCopyTo(NoteCopyToArgs(ids: ids, space: to, folderId: folder)))
                app.toast(r.done.count == 1 ? "Copied" : "Copied \(r.done.count) notes", tone: .success)
            }
        case .moveFolder:
            for id in ids { app.perform { _ = try await $0.command(Commands.FolderMove(FolderMoveArgs(id: id, parentId: folder))) } }
        }
        dismiss()
    }
}

extension WindowModel {
    /// Opens the folder picker for notes or a folder.
    func pickFolder(_ action: FolderPickTarget.Action, _ ids: [String], folders: [String] = []) {
        folderPick = FolderPickTarget(action: action, ids: ids, folders: folders)
    }
}

/// Move or copy notes or folders to another place or space (an account, a workspace, the library on this Mac):
/// where to, Move or Copy, what goes and whether it fits, then places.move.
struct PlaceMoveSheet: View {
    let notes: [String]
    let folders: [String]
    private var app: AppModel { .shared }
    @Environment(\.dismiss) private var dismiss
    @State private var preview: PlaceMovePreview?
    @State private var to: String?
    @State private var copy = false
    @State private var working = false
    @State private var problem: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(copy ? "Copy to Another Place" : "Move to Another Place").font(.headline)
            if let p = preview {
                Picker("To", selection: Binding(get: { to ?? p.to?.value ?? "" }, set: { to = $0; load() })) {
                    ForEach(p.destinations, id: \.value) { d in Text(d.label).tag(d.value) }
                }
                Picker("", selection: $copy) { Text("Move").tag(false); Text("Copy").tag(true) }
                    .pickerStyle(.segmented).labelsHidden().fixedSize()
                Text(summary(p)).foregroundStyle(.secondary)
                if p.fits == false { Label("It doesn't fit in the storage left there.", appSymbol: "exclamationmark.triangle").foregroundStyle(.orange) }
                if p.to?.switches == true { Text("Folevi switches to that place when it's done.").font(.caption).foregroundStyle(.secondary) }
            } else if let problem {
                Text(problem).foregroundStyle(.red)
            } else {
                ProgressView()
            }
            HStack {
                Spacer()
                Button("Cancel", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
                Button(copy ? "Copy" : "Move", action: run)
                    .buttonStyle(InkPillStyle())
                    .keyboardShortcut(.defaultAction)
                    .disabled(working || preview == nil || (to ?? preview?.to?.value) == nil || preview?.fits == false)
            }
        }
        .padding(20)
        .frame(width: 420)
        .task { load() }
    }

    private func summary(_ p: PlaceMovePreview) -> String {
        var parts: [String] = []
        if p.folders > 0 { parts.append(p.folders == 1 ? "1 folder" : "\(p.folders) folders") }
        if p.notes > 0 { parts.append(p.notes == 1 ? "1 note" : "\(p.notes) notes") }
        let what = parts.isEmpty ? "Nothing" : parts.joined(separator: " and ")
        return "\(what) \(copy ? "will be copied" : "will move") from \(p.from)."
    }

    private func load() {
        let args = PlaceMovePreviewArgs(to: to, folders: folders.isEmpty ? nil : folders, notes: notes.isEmpty ? nil : notes)
        Task { @MainActor in
            do {
                guard let client = app.client else { return }
                preview = try await client.query(Views.PlacesMovePreview(args))
            } catch let f as EngineFailure { problem = f.message } catch {}
        }
    }

    private func run() {
        guard let dest = to ?? preview?.to?.value else { return }
        working = true
        let args = PlaceMoveArgs(to: dest, folders: folders.isEmpty ? nil : folders, notes: notes.isEmpty ? nil : notes, copy: copy, versions: nil)
        app.perform { client in
            let r = try await client.command(Commands.PlacesMove(args))
            app.toast(r.status == "switched" ? "Moved. Here it is." : (copy ? "Copied \(r.notes) notes" : "Moved \(r.notes) notes") + (r.problems > 0 ? ", \(r.problems) couldn't go" : ""))
        }
        dismiss()
    }
}
