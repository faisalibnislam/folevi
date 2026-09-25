import SwiftUI

/// Drag payload for documents (browser cards → sidebar folders).
struct DocumentDragPayload: Codable, Transferable {
    var documentId: String
    static var transferRepresentation: some TransferRepresentation {
        CodableRepresentation(contentType: .foleviDocument)
    }
}

struct SidebarView: View {
    @Bindable var nav: NavigationModel
    @Environment(AppModel.self) private var app
    @Environment(\.openSettings) private var openSettings
    @State private var newFolderName = ""
    @State private var showNewFolder = false
    @State private var dropTargetFolder: String?

    private var selection: Binding<SidebarItem?> {
        Binding(get: { nav.selection }, set: { if let v = $0 { nav.selection = v } })
    }

    var body: some View {
        List(selection: selection) {
            Section {
                Button {
                    Task { await newDocument() }
                } label: {
                    Label("New Document", systemImage: "square.and.pencil")
                        .foregroundStyle(FoleviColor.accent)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("sidebar.newDocument")
            }
            Section("Library") {
                row(.all, count: libraryCount)
                row(.tasks, count: openTaskCount)
                row(.calendar)
                row(.daily)
                row(.shared)
                row(.templates)
                row(.starred)
            }
            Section {
                ForEach(app.sidebar.folders.filter { $0.parentFolderId == nil }) { folder in
                    folderRow(folder)
                    ForEach(app.sidebar.folders.filter { $0.parentFolderId == folder.id }) { child in
                        folderRow(child).padding(.leading, 14)
                    }
                }
                Button {
                    showNewFolder = true
                } label: {
                    Label("New Folder", systemImage: "folder.badge.plus").foregroundStyle(FoleviColor.inkMuted)
                }
                .buttonStyle(.plain)
                .disabled(!app.sync.isOnline)
                .help(app.sync.isOnline ? Text("New Folder") : Text("Creating folders needs a connection."))
            } header: {
                Text("Folders")
            }
            if !app.sidebar.tags.isEmpty {
                Section("Tags") {
                    ForEach(app.sidebar.tags) { tag in
                        Label {
                            Text(tag.name)
                        } icon: {
                            Circle().fill(Color.folevi(tag: tag.color)).frame(width: 8, height: 8)
                        }
                        .tag(SidebarItem.tag(tag.id))
                        .accessibilityIdentifier(SidebarItem.tag(tag.id).accessibilityId)
                    }
                }
            }
            Section {
                row(.archive)
                row(.trash, count: trashCount)
            }
        }
        .listStyle(.sidebar)
        .navigationSplitViewColumnWidth(min: FoleviLayout.sidebarMin, ideal: FoleviLayout.sidebarDefault, max: FoleviLayout.sidebarMax)
        .safeAreaInset(edge: .bottom) { footer }
        .safeAreaInset(edge: .top) { header }
        .alert("New Folder", isPresented: $showNewFolder) {
            TextField("Name", text: $newFolderName)
            Button("Create") { createFolder() }
            Button("Cancel", role: .cancel) { newFolderName = "" }
        }
    }

    private var header: some View {
        HStack(spacing: 8) {
            FoleviMark(size: 18).foregroundStyle(FoleviColor.ink)
            Text(app.workspace?.name ?? "Folevi")
                .font(.system(size: 13, weight: .semibold))
                .lineLimit(1)
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 6)
    }

    private var footer: some View {
        HStack(spacing: 4) {
            Button {
                openSettings()
            } label: {
                Label("Settings", systemImage: "gearshape")
            }
            .accessibilityIdentifier("sidebar.settings")
            Spacer()
            Button {
                app.showHelp = true
            } label: {
                Label("Help", systemImage: "questionmark.circle")
            }
            .accessibilityIdentifier("sidebar.help")
        }
        .buttonStyle(.borderless)
        .labelStyle(.titleAndIcon)
        .font(.system(size: 12))
        .foregroundStyle(FoleviColor.inkMuted)
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    private func row(_ item: SidebarItem, count: Int? = nil) -> some View {
        Label(item.title, systemImage: item.systemImage)
            .badge(count.map { $0 > 0 ? $0 : 0 } ?? 0)
            .tag(item)
            .accessibilityIdentifier(item.accessibilityId)
    }

    private func folderRow(_ folder: FolderInfo) -> some View {
        Label {
            Text(folder.name)
        } icon: {
            if let icon = folder.icon, !icon.isEmpty { Text(icon) } else { Image(systemName: "folder") }
        }
        .tag(SidebarItem.folder(folder.id))
        .listRowBackground(dropTargetFolder == folder.id ? RoundedRectangle(cornerRadius: 6).fill(FoleviColor.accentSoft) : nil)
        .dropDestination(for: DocumentDragPayload.self) { items, _ in
            for item in items {
                Task { await app.updateDocument(item.documentId, patch: WireDocumentPatch(folderId: .some(folder.id))) }
            }
            app.showToast(String(localized: "Moved to \(folder.name)"))
            return !items.isEmpty
        } isTargeted: { targeted in
            dropTargetFolder = targeted ? folder.id : (dropTargetFolder == folder.id ? nil : dropTargetFolder)
        }
        .accessibilityIdentifier(SidebarItem.folder(folder.id).accessibilityId)
    }

    private var libraryCount: Int {
        app.documents.filter { $0.kind == .document && $0.deletedAt == nil && $0.archivedAt == nil && $0.parentDocumentId == nil }.count
    }

    private var trashCount: Int {
        app.documents.filter { $0.deletedAt != nil }.count
    }

    private var openTaskCount: Int? {
        nil
    }

    private func newDocument() async {
        var folderId: String?
        if case .folder(let id) = nav.selection { folderId = id }
        if let id = await app.createDocument(folderId: folderId) { nav.open(id) }
    }

    private func createFolder() {
        let name = newFolderName.trimmingCharacters(in: .whitespaces)
        newFolderName = ""
        guard !name.isEmpty, let workspaceId = app.session?.workspaceId else { return }
        app.perform(String(localized: "Creating a folder")) { session in
            try await session.organization.createFolder(workspaceId: workspaceId, name: name)
        }
    }
}
