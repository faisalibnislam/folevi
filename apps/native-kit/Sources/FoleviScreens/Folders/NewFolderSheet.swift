// New folder (web iphone/NewFolderSheet.tsx): a name with the folder glyph in its colour, the colour swatches
// (a random one to start, as the web does), and where it goes (the top level, or inside another folder; the
// folder it was opened from to start). Create makes it and opens it.
import SwiftUI
import FoleviDesign
import FoleviEngine

public struct NewFolderSheet: View {
    let parent: MenuFolder?
    let tree: [FolderNode]
    let onCreate: (_ name: String, _ color: String?, _ parentId: String?) -> Void
    let onCancel: () -> Void
    @State private var name = ""
    @State private var color: String = FoleviTokens.folderColors.randomElement()?.id ?? FolderColor.defaultId
    @State private var parentId: String?
    @FocusState private var focused: Bool

    public init(parent: MenuFolder?, tree: [FolderNode], onCreate: @escaping (String, String?, String?) -> Void, onCancel: @escaping () -> Void) {
        self.parent = parent
        self.tree = tree
        self.onCreate = onCreate
        self.onCancel = onCancel
        _parentId = State(initialValue: parent?.id)
    }

    /// Folders a new one may go inside (not past the deepest level).
    var parents: [FolderNode] {
        let links = FolderRules.links(tree)
        return tree.filter { FolderRules.canNest(links, in: $0.id) }
    }

    private var trimmed: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

    public var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack(spacing: 12) {
                        FolderGlyph(colorId: color, size: 24)
                        TextField("Folder name", text: $name)
                            .foleviFont(.body)
                            .focused($focused)
                            .submitLabel(.done)
                            .onSubmit(create)
                            .accessibilityIdentifier("new-folder-name")
                    }
                }
                Section("Color") {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 4) {
                            ForEach(FoleviTokens.folderColors) { c in
                                Button { color = c.id } label: {
                                    FolderGlyph(colorId: c.id, size: 30)
                                        .padding(6)
                                        .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.small, style: .continuous).fill(color == c.id ? Folevi.color.accentSoft : .clear))
                                        .overlay(RoundedRectangle(cornerRadius: FoleviTokens.Radius.small, style: .continuous).strokeBorder(color == c.id ? Folevi.color.lineStrong : .clear, lineWidth: 1.5))
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel(c.name)
                                .accessibilityAddTraits(color == c.id ? [.isButton, .isSelected] : .isButton)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                }
                if !tree.isEmpty {
                    Section {
                        Picker("In", selection: $parentId) {
                            Text("Top level").tag(String?.none)
                            ForEach(parents, id: \.id) { f in
                                Text(String(repeating: "   ", count: f.depth) + f.name).tag(String?.some(f.id))
                            }
                        }
                    }
                }
            }
            .navigationTitle("New folder")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel", action: onCancel) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create", action: create).disabled(trimmed.isEmpty).accessibilityIdentifier("new-folder-create")
                }
            }
            .onAppear { focused = true }
        }
        .frame(minWidth: 380, minHeight: 360)
        .presentationDetents([.medium, .large])
    }

    private func create() {
        guard !trimmed.isEmpty else { return }
        onCreate(trimmed, color == FolderColor.defaultId ? nil : color, parentId)
    }
}
