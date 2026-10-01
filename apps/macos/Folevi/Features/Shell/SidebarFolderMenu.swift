import AppKit
import SwiftUI

/// A folder as the menus need it (sidebar rows and folder cards).
struct MenuFolder: Hashable, Identifiable {
    var id: String
    var name: String
    var parentFolderId: String?
    var color: String?

    init(_ f: FolderInfo) {
        id = f.id
        name = f.name
        parentFolderId = f.parentFolderId
        color = f.color
    }

    init(_ f: OrganizationIndex.Folder) {
        id = f.id
        name = f.name
        parentFolderId = f.parentFolderId
        color = f.color
    }
}

/// The "…" menu for a folder (the web's FolderMenu): new note in it, rename, change colour, move a subfolder to
/// the top level, ask AI about it, copy its link, invite people to the team workspace, and delete.
struct FolderMenu<Trigger: View>: View {
    var folder: MenuFolder
    /// Opens a note the menu created.
    var openDocument: (String) -> Void
    @ViewBuilder var trigger: (_ open: Bool) -> Trigger
    @Environment(AppModel.self) private var app
    @State private var renaming = false
    @State private var coloring = false
    @State private var deleting = false
    @State private var inviting = false

    var body: some View {
        FoleviMenuButton(label: String(localized: "Folder options for \(folder.name)"), entries: entries, trigger: trigger)
            .sheet(isPresented: $renaming) {
                FoleviPromptDialog(title: String(localized: "Rename folder"), label: String(localized: "Folder name"), initial: folder.name) { name in
                    let id = folder.id
                    OrganizationActions.run(app, success: String(localized: "Renamed")) { try await $0.renameFolder(id, name: name) }
                }
            }
            .sheet(isPresented: $coloring) { FolderColorDialog(folder: folder).environment(app) }
            .sheet(isPresented: $deleting) {
                FoleviDialog(title: String(localized: "Delete “\(folder.name)”?"),
                             message: String(localized: "The folder is removed. Its documents are kept and move to Drafts."),
                             confirmTitle: String(localized: "Delete folder")) {
                    deleting = false
                    let id = folder.id
                    OrganizationActions.run(app, success: String(localized: "Folder deleted")) { try await $0.deleteFolder(id) }
                }
            }
            .sheet(isPresented: $inviting) {
                if let w = app.workspace { InviteDialog(workspace: w).environment(app) }
            }
    }

    private func entries() -> [FoleviMenuEntry] {
        var out: [FoleviMenuEntry] = []
        let canEdit = app.canEditHere
        if canEdit {
            out.append(.item(FoleviMenuItem(String(localized: "New note in folder"), systemImage: "doc.badge.plus") {
                let id = folder.id
                Task { if let doc = await app.createDocument(folderId: id) { openDocument(doc) } }
            }))
            out.append(.separator)
            out.append(.item(FoleviMenuItem(String(localized: "Rename…"), systemImage: "pencil.line") { renaming = true }))
            out.append(.item(FoleviMenuItem(String(localized: "Change color…"), systemImage: "paintpalette") { coloring = true }))
            if folder.parentFolderId != nil {
                out.append(.item(FoleviMenuItem(String(localized: "Move to top level"), systemImage: "arrow.uturn.backward") {
                    let id = folder.id
                    OrganizationActions.run(app, success: String(localized: "Moved")) { try await $0.moveFolder(id, parentFolderId: nil) }
                }))
            }
        }
        if app.aiAvailable {
            out.append(.item(FoleviMenuItem(String(localized: "Ask AI about this folder…"), icon: AiIcon(size: 14)) {
                app.askAi(folder: (folder.id, folder.name))
            }))
        }
        out.append(.item(FoleviMenuItem(String(localized: "Copy link"), systemImage: "link") { copyLink() }))
        if app.workspace?.canManage == true {
            out.append(.item(FoleviMenuItem(String(localized: "Invite people…"), systemImage: "person.badge.plus") { inviting = true }))
        }
        if canEdit {
            out.append(.separator)
            out.append(.item(FoleviMenuItem(String(localized: "Delete folder…"), systemImage: "trash", danger: true) { deleting = true }))
        }
        return out
    }

    private func copyLink() {
        guard let origin = app.config.appOrigin else {
            app.showToast(String(localized: "Couldn’t copy the link"), tone: .error)
            return
        }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(origin.appending(path: "folders/\(folder.id)").absoluteString, forType: .string)
        app.showToast(String(localized: "Link copied"))
    }
}

extension FolderMenu where Trigger == FoleviMenuTrigger {
    /// The default "…" trigger (14pt icon in a 32pt square).
    init(folder: MenuFolder, openDocument: @escaping (String) -> Void) {
        self.init(folder: folder, openDocument: openDocument) { open in FoleviMenuTrigger(systemImage: "ellipsis", size: 32, open: open) }
    }
}

/// Folder and tag changes are online-only: a toast on success (when given) or with the error.
@MainActor
enum OrganizationActions {
    static func run(_ app: AppModel, success: String? = nil, _ op: @escaping @Sendable (OrganizationRepository) async throws -> Void) {
        guard let session = app.session else { return }
        guard app.sync.isOnline else {
            app.showToast(String(localized: "This needs a connection. Try again when you're back online."), tone: .error)
            return
        }
        Task {
            do {
                try await op(session.organization)
                if let success { app.showToast(success, tone: .success) }
                await app.refreshSidebar()
                await session.engine.syncNow()
            } catch {
                app.showToast(ConvexService.mapError(error).localizedDescription, tone: .error)
            }
        }
    }
}

/// Pick a folder colour (the web's FolderColorDialog): the note styles' light page colours, named after their style.
struct FolderColorDialog: View {
    var folder: MenuFolder
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let current = folder.color ?? "blue-haze"
        FoleviDialogShell(title: String(localized: "Color for “\(folder.name)”"), size: .sm, onClose: { dismiss() }) {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 5), spacing: 10) {
                ForEach(FolderColors.all) { c in
                    ColorSwatch(entry: c, on: current == c.id) {
                        let id = folder.id
                        dismiss()
                        OrganizationActions.run(app) { try await $0.setFolderColor(id, color: c.id) }
                    }
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text("Folder color"))
        }
    }

    private struct ColorSwatch: View {
        var entry: FolderColors.Entry
        var on: Bool
        var pick: () -> Void
        @State private var hover = false

        var body: some View {
            Button(action: pick) {
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(Color(hex: entry.hex) ?? .gray)
                    .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(.black.opacity(0.08), lineWidth: 1))
                    .aspectRatio(1, contentMode: .fit)
                    .overlay {
                        if on {
                            Image(systemName: "checkmark").font(.system(size: 15, weight: .bold))
                                .foregroundStyle(Color(red: 0.09, green: 0.09, blue: 0.1))
                        }
                    }
                    .padding(on ? 0 : 0)
                    .background {
                        if on {
                            RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(FoleviColor.heading, lineWidth: 2).padding(-4)
                        }
                    }
                    .scaleEffect(hover ? 1.05 : 1)
                    .animation(.easeOut(duration: FoleviMotion.fast), value: hover)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .onHover { hover = $0 }
            .help(Text(entry.name))
            .accessibilityLabel(Text(entry.name))
            .accessibilityAddTraits(on ? .isSelected : [])
        }
    }
}

/// "Invite people…" as a dialog (the web's InviteDialog): people join the whole workspace.
struct InviteDialog: View {
    var workspace: WorkspaceInfo
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var members: WorkspaceMembers?

    var body: some View {
        FoleviDialogShell(title: String(localized: "Invite people to \(workspace.name)"),
                          description: String(localized: "Members work on the notes and folders in this workspace. To share just one page, use Share on that page instead: guests are never billed. Invitations are tied to the email address you enter and expire after 7 days."),
                          size: .md, onClose: { dismiss() }) {
            InviteForm(workspaceId: workspace.id, isOwner: (members?.yourRole ?? workspace.role) == "owner", seats: members?.seats)
        }
        .task {
            guard let session = app.session else { return }
            members = try? await session.workspacesRepo.members(workspace.id)
        }
    }
}
