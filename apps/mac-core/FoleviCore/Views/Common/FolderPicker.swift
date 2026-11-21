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
    var title: String {
        switch action {
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
    @State private var picked: String? = "top"
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
                Label { Text(target.action == .moveFolder ? "Top Level" : "Drafts") } icon: { (target.action == .moveFolder ? WebIcon.folderTree : WebIcon.penLine).image(size: 15) }
                    .tag("top")
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
        .onAppear { searching = true }
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
    func pickFolder(_ action: FolderPickTarget.Action, _ ids: [String]) {
        folderPick = FolderPickTarget(action: action, ids: ids)
    }
}
