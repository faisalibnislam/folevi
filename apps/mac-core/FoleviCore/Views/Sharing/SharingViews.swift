// Sharing a note or a folder: the people who have it and their roles, invitations by email, who in the workspace
// may open it, and public links (with a theme, a password, an end date). A native sheet in the window.
import FoleviDesign
import FoleviEngine
import SwiftUI

enum ShareRole: String, CaseIterable, Identifiable {
    case editor, commenter, viewer
    var id: String { rawValue }
    var title: String { rawValue == "editor" ? "Can Edit" : rawValue == "commenter" ? "Can Comment" : "Can View" }
}

struct NoteSharingSheet: View {
    let noteId: String
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var sharing = Live<Views.SharingGet>()
    @State private var email = ""
    @State private var role: ShareRole = .editor
    @State private var newLink: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Share").font(.title2.weight(.semibold)).padding([.horizontal, .top], 20)
            Form {
                if let s = sharing.value {
                    if s.canShare {
                        Section("Invite") {
                            HStack {
                                TextField("Email address", text: $email).onSubmit(invite)
                                Picker("", selection: $role) { ForEach(ShareRole.allCases) { Text($0.title).tag($0) } }.labelsHidden().fixedSize()
                                Button("Invite", action: invite).disabled(!email.contains("@"))
                            }
                        }
                    }
                    Section("People") {
                        LabeledContent(s.ownerName, value: "Owner")
                        ForEach(s.people, id: \.profileId) { p in
                            HStack {
                                VStack(alignment: .leading) {
                                    Text(p.name + (p.isYou ? " (you)" : "") + (p.guest ? " · Guest" : ""))
                                    if let e = p.email { Text(e).font(.caption).foregroundStyle(.secondary) }
                                }
                                Spacer()
                                if p.canChange && s.canManage {
                                    Picker("", selection: Binding(get: { ShareRole(rawValue: p.role) ?? .viewer }, set: { r in
                                        app.perform { _ = try await $0.command(Commands.SharingSetRole(ShareRoleArgs(noteId: noteId, profileId: p.profileId, role: .init(rawValue: r.rawValue) ?? .viewer))) }
                                    })) { ForEach(ShareRole.allCases) { Text($0.title).tag($0) } }
                                    .labelsHidden().fixedSize()
                                    Button { app.perform { _ = try await $0.command(Commands.SharingRevoke(ShareRevokeArgs(noteId: noteId, profileId: p.profileId))) } } label: { Image(systemName: "xmark.circle") }
                                        .buttonStyle(.borderless).help("Remove")
                                } else {
                                    Text(ShareRole(rawValue: p.role)?.title ?? p.role).foregroundStyle(.secondary)
                                }
                            }
                        }
                        ForEach(s.invites, id: \.id) { inv in
                            HStack {
                                Text(inv.email)
                                Text(inv.expired ? "Expired" : "Invited").font(.caption).foregroundStyle(.secondary)
                                Spacer()
                                Button("Cancel") { app.perform { _ = try await $0.command(Commands.SharingCancelInvite(ShareInviteIdArgs(inviteId: inv.id))) } }.buttonStyle(.borderless)
                            }
                        }
                    }
                    if s.canManage {
                        Section("Workspace") {
                            Picker("Who can open it", selection: Binding(get: { s.accessMode }, set: { m in
                                app.perform { _ = try await $0.command(Commands.SharingSetAccessMode(AccessModeArgs(noteId: noteId, mode: .init(rawValue: m) ?? .workspace))) }
                            })) {
                                Text("Everyone in the workspace").tag("workspace")
                                Text("Only people invited").tag("restricted")
                            }
                        }
                    }
                    if s.publicLinksAvailable && !s.encrypted {
                        Section("Public Link") {
                            ForEach(s.links, id: \.id) { l in
                                HStack {
                                    Image(systemName: "link")
                                    VStack(alignment: .leading) {
                                        Text("…\(l.tokenHint) · \(l.theme.capitalized)\(l.hasPassword ? " · Password" : "")")
                                        Text("\(l.viewCount) views\(l.expiresAt.map { " · ends " + CoreDates.short($0) } ?? "")").font(.caption).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Button("Stop Sharing") { app.perform { _ = try await $0.command(Commands.PublicLinkRevoke(PublicLinkIdArgs(linkId: l.id))) } }.buttonStyle(.borderless)
                                }
                            }
                            if let newLink {
                                HStack {
                                    Text(newLink).textSelection(.enabled).lineLimit(1)
                                    Button("Copy") { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(newLink, forType: .string) }
                                }
                            }
                            Button("Create Public Link") {
                                app.perform { client in
                                    let r = try await client.command(Commands.PublicLinkCreate(PublicLinkCreateArgs(noteId: noteId, expiresAt: nil, password: nil, allowIndexing: false, theme: .note, plainCopy: nil)))
                                    newLink = r.url
                                }
                            }
                        }
                    } else if s.encrypted {
                        Section { Text("This note is end to end encrypted, so it can't have a public link.").foregroundStyle(.secondary) }
                    }
                } else {
                    ProgressView()
                }
            }
            .formStyle(.grouped)
            HStack {
                Button("Copy Link") { NoteActions.copyLink(noteId, title: "") }
                Spacer()
                Button("Done") { dismiss() }.keyboardShortcut(.defaultAction)
            }
            .padding(16)
        }
        .frame(width: 520, height: 560)
        .task { sharing.bind(app.client, Views.SharingGet(NoteIdArgs(id: noteId))) }
    }

    private func invite() {
        let e = email.trimmingCharacters(in: .whitespaces)
        guard e.contains("@") else { return }
        email = ""
        let r = role
        app.perform { client in
            _ = try await client.command(Commands.SharingInvite(ShareInviteArgs(noteId: noteId, email: e, role: .init(rawValue: r.rawValue) ?? .editor)))
            app.toast("Invitation sent to \(e)", tone: .success)
        }
    }
}

struct FolderSharingSheet: View {
    let folderId: String
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var sharing = Live<Views.FolderSharingGet>()
    @State private var email = ""
    @State private var role: ShareRole = .editor

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                FolderMark(colorId: sharing.value?.color, size: 22)
                Text("Share “\(sharing.value?.name ?? "Folder")”").font(.title2.weight(.semibold))
            }
            .padding([.horizontal, .top], 20)
            Form {
                if let s = sharing.value {
                    if let blocked = s.blocked { Section { Text(blocked).foregroundStyle(.secondary) } }
                    if s.canManage {
                        Section("Invite") {
                            HStack {
                                TextField("Email address", text: $email).onSubmit(invite)
                                Picker("", selection: $role) { ForEach(ShareRole.allCases) { Text($0.title).tag($0) } }.labelsHidden().fixedSize()
                                Button("Invite", action: invite).disabled(!email.contains("@"))
                            }
                        }
                    }
                    Section("People") {
                        ForEach(s.people, id: \.profileId) { p in
                            HStack {
                                Text(p.name + (p.isYou ? " (you)" : ""))
                                Spacer()
                                if p.canChange && s.canManage {
                                    Picker("", selection: Binding(get: { ShareRole(rawValue: p.role) ?? .viewer }, set: { r in
                                        app.perform { _ = try await $0.command(Commands.FolderSharingSetRole(FolderShareRoleArgs(folderId: folderId, profileId: p.profileId, role: .init(rawValue: r.rawValue) ?? .viewer))) }
                                    })) { ForEach(ShareRole.allCases) { Text($0.title).tag($0) } }
                                    .labelsHidden().fixedSize()
                                    Button { app.perform { _ = try await $0.command(Commands.FolderSharingRevoke(FolderShareRevokeArgs(folderId: folderId, profileId: p.profileId))) } } label: { Image(systemName: "xmark.circle") }.buttonStyle(.borderless)
                                } else {
                                    Text(ShareRole(rawValue: p.role)?.title ?? p.role).foregroundStyle(.secondary)
                                }
                            }
                        }
                        ForEach(s.invites, id: \.id) { inv in
                            HStack {
                                Text(inv.email)
                                Spacer()
                                Button("Cancel") { app.perform { _ = try await $0.command(Commands.FolderSharingCancelInvite(FolderInviteIdArgs(inviteId: inv.id))) } }.buttonStyle(.borderless)
                            }
                        }
                    }
                    ForEach(s.inherited, id: \.folderId) { inh in
                        Section("From “\(inh.folderName)”") {
                            ForEach(inh.people, id: \.profileId) { p in LabeledContent(p.name, value: ShareRole(rawValue: p.role)?.title ?? p.role) }
                        }
                    }
                } else {
                    ProgressView()
                }
            }
            .formStyle(.grouped)
            HStack { Spacer(); Button("Done") { dismiss() }.keyboardShortcut(.defaultAction) }.padding(16)
        }
        .frame(width: 500, height: 520)
        .task { sharing.bind(app.client, Views.FolderSharingGet(NoteIdArgs(id: folderId))) }
    }

    private func invite() {
        let e = email.trimmingCharacters(in: .whitespaces)
        guard e.contains("@") else { return }
        email = ""
        let r = role
        app.perform { _ = try await $0.command(Commands.FolderSharingInvite(FolderShareInviteArgs(folderId: folderId, email: e, role: .init(rawValue: r.rawValue) ?? .editor))) }
    }
}
