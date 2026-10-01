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
        content.sheet(item: $dialog) { d in
            Group {
                switch d {
                case .rename(let f):
                    PromptSheet(title: String(localized: "Rename folder"), label: String(localized: "Folder name"), initial: f.name) { name in
                        FolderActions.run(app, String(localized: "Renamed")) { try await $0.organization.renameFolder(f.id, name: name) }
                    }
                case .color(let f):
                    FolderColorSheet(folder: f)
                case .delete(let f):
                    FoleviDialog(title: String(localized: "Delete “\(f.name)”?"),
                                 message: String(localized: "The folder is removed. Its documents are kept and move to Drafts."),
                                 confirmTitle: String(localized: "Delete folder")) {
                        dialog = nil
                        FolderActions.run(app, String(localized: "Folder deleted")) { try await $0.organization.deleteFolder(f.id) }
                    }
                case .invite:
                    InvitePeopleSheet()
                }
            }
            .environment(app)
        }
    }
}

/// Pick a folder colour (the web's FolderColorDialog): the note styles' light page colours, by name.
struct FolderColorSheet: View {
    let folder: FolderInfo
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let current = folder.color ?? "blue-haze"
        VStack(alignment: .leading, spacing: 16) {
            Text("Color for “\(folder.name)”")
                .font(FoleviType.display(20))
                .tracking(FoleviType.displayTracking(20))
                .foregroundStyle(FoleviColor.heading)
                .accessibilityAddTraits(.isHeader)
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 5), spacing: 10) {
                ForEach(FolderColors.all) { c in
                    let on = current == c.id
                    Button {
                        dismiss()
                        FolderActions.run(app, nil) { try await $0.organization.setFolderColor(folder.id, color: c.id) }
                    } label: {
                        RoundedRectangle(cornerRadius: 6, style: .continuous)
                            .fill(Color(hex: c.hex) ?? .gray)
                            .aspectRatio(1, contentMode: .fit)
                            .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(Color.black.opacity(0.08)))
                            .overlay {
                                if on { Image(systemName: "checkmark").font(.system(size: 16, weight: .bold)).foregroundStyle(Color(red: 0.09, green: 0.09, blue: 0.1)) }
                            }
                            .padding(on ? 0 : 0)
                            .overlay {
                                if on { RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(FoleviColor.heading, lineWidth: 2).padding(-4) }
                            }
                    }
                    .buttonStyle(.plain)
                    .help(Text(c.name))
                    .accessibilityLabel(Text(c.name))
                    .accessibilityAddTraits(on ? [.isSelected] : [])
                }
            }
            .padding(4)
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }.buttonStyle(.folevi(.quiet, .medium)).keyboardShortcut(.cancelAction)
            }
        }
        .padding(24)
        .frame(width: 420)
        .background(FoleviColor.surface)
    }
}

/// "Invite people to …" (the web's InviteDialog), from a folder's menu in a team workspace.
struct InvitePeopleSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Invite people to \(app.workspace?.name ?? "")")
                .font(FoleviType.display(20))
                .tracking(FoleviType.displayTracking(20))
                .foregroundStyle(FoleviColor.heading)
                .accessibilityAddTraits(.isHeader)
            Text("Members work on the notes and folders in this workspace. To share just one page, use Share on that page instead: guests are never billed. Invitations are tied to the email address you enter and expire after 7 days.")
                .font(.ui(13))
                .foregroundStyle(FoleviColor.inkMuted)
                .fixedSize(horizontal: false, vertical: true)
            if let w = app.workspace {
                InviteForm(workspaceId: w.id, isOwner: w.role == "owner", seats: nil)
            }
            HStack {
                Spacer()
                Button("Done") { dismiss() }.buttonStyle(.folevi(.quiet, .medium)).keyboardShortcut(.cancelAction)
            }
        }
        .padding(24)
        .frame(width: 520)
        .background(FoleviColor.surface)
    }
}
