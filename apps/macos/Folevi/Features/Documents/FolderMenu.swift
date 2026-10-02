import AppKit
import SwiftUI

/// A dialog a folder's menu asks its view to show.
enum FolderDialog: Identifiable {
    case rename(FolderInfo)
    case color(FolderInfo)
    case delete(FolderInfo)
    case invite

    var id: String {
        switch self {
        case .rename(let f): return "rename." + f.id
        case .color(let f): return "color." + f.id
        case .delete(let f): return "delete." + f.id
        case .invite: return "invite"
        }
    }
}

/// The "…" menu for a folder (folder cards and rows), as the web's FolderMenu: New note in folder, Rename…,
/// Change color…, Move to top level (a subfolder), Copy link, Invite people… (team workspaces) and Delete folder….
struct FolderMenuItems: View {
    let folder: FolderInfo
    var openDocument: (String) -> Void
    var present: (FolderDialog) -> Void
    @Environment(AppModel.self) private var app

    private var canEdit: Bool { app.canEditHere }
    private var canManage: Bool { app.workspace?.canManage == true }

    var body: some View {
        if canEdit {
            Button {
                Task { if let id = await app.createDocument(folderId: folder.id) { openDocument(id) } }
            } label: { Label("New note in folder", systemImage: "doc.badge.plus") }
            Divider()
            Button { present(.rename(folder)) } label: { Label("Rename…", systemImage: "pencil.line") }
            Button { present(.color(folder)) } label: { Label("Change color…", systemImage: "paintpalette") }
            if folder.parentFolderId != nil {
                Button {
                    FolderActions.run(app, String(localized: "Moved")) { try await $0.organization.moveFolder(folder.id, parentFolderId: nil) }
                } label: { Label("Move to top level", systemImage: "arrow.uturn.backward") }
            }
        }
        Button { copyLink() } label: { Label("Copy link", systemImage: "link") }
        if canManage {
            Button { present(.invite) } label: { Label("Invite people…", systemImage: "person.badge.plus") }
        }
        if canEdit {
            Divider()
            Button(role: .destructive) { present(.delete(folder)) } label: { Label("Delete folder…", systemImage: "trash") }
        }
    }

    private func copyLink() {
        guard let origin = app.config.appOrigin else {
            app.showToast(String(localized: "Couldn’t copy the link"))
            return
        }
        NSPasteboard.general.clearContents()
        if NSPasteboard.general.setString(origin.appending(path: "folders/\(folder.id)").absoluteString, forType: .string) {
            app.showToast(String(localized: "Link copied"))
        } else {
            app.showToast(String(localized: "Couldn’t copy the link"))
        }
    }
}

/// Folder changes go to the server (they need a connection); each reports with a short toast.
@MainActor
enum FolderActions {
    static func run(_ app: AppModel, _ message: String?, _ action: @escaping @Sendable (SessionContext) async throws -> Void) {
        guard let session = app.session else { return }
        guard app.sync.isOnline else {
            app.showToast(String(localized: "This needs a connection. Try again when you're back online."))
            return
        }
        Task {
            do {
                try await action(session)
                if let message { app.showToast(message) }
                OrganizationIndexStore.shared.invalidate()
            } catch {
                app.showToast(ConvexService.mapError(error).localizedDescription)
            }
        }
    }
}

extension View {
    /// Presents the dialogs a folder menu asks for.
    func folderDialogs(_ dialog: Binding<FolderDialog?>) -> some View {
        modifier(FolderDialogsModifier(dialog: dialog))
    }
}

private struct FolderDialogsModifier: ViewModifier {
    @Binding var dialog: FolderDialog?
    @Environment(AppModel.self) private var app

    func body(content: Content) -> some View {
        content.foleviDialog(item: $dialog) { d in
            Group {
                switch d {
                case .rename(let f):
                    PromptSheet(title: String(localized: "Rename folder"), label: String(localized: "Folder name"), initial: f.name) { name in
                        FolderActions.run(app, String(localized: "Renamed")) { try await $0.organization.renameFolder(f.id, name: name) }
                    }
                case .color(let f):
                    FolderColorDialog(folder: MenuFolder(f))
                case .delete(let f):
                    FoleviDialog(title: String(localized: "Delete “\(f.name)”?"),
                                 message: String(localized: "The folder is removed. Its documents are kept and move to Drafts."),
                                 confirmTitle: String(localized: "Delete folder")) {
                        dialog = nil
                        FolderActions.run(app, String(localized: "Folder deleted")) { try await $0.organization.deleteFolder(f.id) }
                    }
                case .invite:
                    if let w = app.workspace { InviteDialog(workspace: w) }
                }
            }
            .environment(app)
        }
    }
}

