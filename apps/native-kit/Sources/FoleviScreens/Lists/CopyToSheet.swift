// Copy to (web views/CopyToDialog.tsx): copies notes into another space (Personal or a team workspace), into
// its Drafts or one of its folders. The space's folders come from `folders.tree { space }`.
import SwiftUI
import FoleviDesign
import FoleviEngine

@MainActor
@Observable
final class CopyTargetModel {
    let client: EngineClient
    var space: SpaceInfo? {
        didSet { if space?.id != oldValue?.id { watch() } }
    }
    private(set) var tree: ValueStore<FoldersTreeValue>?

    init(client: EngineClient, space: SpaceInfo?) {
        self.client = client
        self.space = space
        watch()
    }

    private func watch() {
        tree = space.map { client.watch(.foldersTree(space: $0.id)) }
    }

    var folders: [FolderNode] { tree?.value?.folders ?? [] }
    var loading: Bool { tree != nil && tree?.value == nil && tree?.error == nil }
}

struct CopyToSheet: View {
    let spaces: [SpaceInfo]
    let count: Int
    let onPick: (SpaceInfo, FolderTarget) -> Void
    let onCancel: () -> Void
    @State private var model: CopyTargetModel

    init(client: EngineClient, spaces: [SpaceInfo], count: Int, onPick: @escaping (SpaceInfo, FolderTarget) -> Void, onCancel: @escaping () -> Void) {
        self.spaces = spaces
        self.count = count
        self.onPick = onPick
        self.onCancel = onCancel
        _model = State(initialValue: CopyTargetModel(client: client, space: spaces.first))
    }

    var body: some View {
        NavigationStack {
            List {
                if spaces.count > 1 {
                    Section("Copy into") {
                        Picker("Space", selection: Binding(get: { model.space?.id ?? "" }, set: { id in model.space = spaces.first { $0.id == id } })) {
                            ForEach(spaces, id: \.id) { Text($0.name).tag($0.id) }
                        }
                        #if os(iOS)
                        .pickerStyle(.menu)
                        #endif
                    }
                }
                Section(model.space?.name ?? "") {
                    if let space = model.space {
                        Button { onPick(space, .drafts) } label: {
                            Label("Drafts", systemImage: "tray").foregroundStyle(Folevi.color.ink)
                        }
                        if model.loading {
                            ProgressView().frame(maxWidth: .infinity)
                        }
                        ForEach(model.folders, id: \.id) { node in
                            Button { onPick(space, FolderTarget(id: node.id, name: node.name)) } label: {
                                HStack(spacing: 10) {
                                    FolderGlyph(colorId: node.color, size: 20)
                                    Text(node.name).foleviFont(.body).foregroundStyle(Folevi.color.ink)
                                }
                                .padding(.leading, CGFloat(node.depth) * 18)
                            }
                        }
                    }
                }
            }
            .navigationTitle(count == 1 ? "Copy note to" : "Copy \(notesText(count)) to")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel", action: onCancel) } }
        }
        .frame(minWidth: 360, minHeight: 420)
        .presentationDetents([.medium, .large])
        .accessibilityIdentifier("copy-to-sheet")
    }
}
