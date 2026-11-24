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
    private var app: AppModel { .shared }
    @Environment(\.dismiss) private var dismiss
    @State private var sharing = Live<Views.SharingGet>()
    @State private var email = ""
    @State private var role: ShareRole = .editor
    @State private var newLink: String?
    @State private var expires = false
    @State private var expiry = Calendar.current.date(byAdding: .day, value: 30, to: Date())!
    @State private var password = ""
    @State private var look: PublicLinkCreateArgs.Theme = .note
    @State private var indexing = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Share").font(.title2.weight(.semibold)).padding([.horizontal, .top], 20)
            Form {
                if app.session.value?.mode == .local {
                    Section {
                        Text("Sign in to Folevi to share and collaborate").font(.headline)
                        Text("This library lives on this Mac. Move a note to a Folevi account to invite people or make a public link.").foregroundStyle(.secondary)
                        Button("Sign In to Folevi…") { dismiss(); AccountActions.addAccount() }
                    }
                } else if let s = sharing.value {
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
                                if p.isYou && !s.canManage {
                                    Button("Leave") {
                                        app.perform { client in
                                            _ = try await client.command(Commands.SharingRevoke(ShareRevokeArgs(noteId: noteId, profileId: p.profileId)))
                                            app.toast("You left the note")
                                        }
                                        dismiss()
                                    }
                                    .buttonStyle(.borderless)
                                }
                            }
                        }
                        if s.people.isEmpty && s.invites.isEmpty { Text("No one added directly.").foregroundStyle(.secondary) }
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
                                        Text("\(l.viewCount) views\(l.expiresAt.map { " · ends " + AppDates.short($0) } ?? "")").font(.caption).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Picker("Look", selection: Binding(get: { PublicLinkThemeArgs.Theme(rawValue: l.theme) ?? .note }, set: { t in
                                        app.perform { _ = try await $0.command(Commands.PublicLinkSetTheme(PublicLinkThemeArgs(linkId: l.id, theme: t))) }
                                    })) {
                                        ForEach(PublicLinkThemeArgs.Theme.allCases, id: \.self) { Text($0.rawValue.capitalized).tag($0) }
                                    }
                                    .labelsHidden().fixedSize().help("Look")
                                    Button("Stop Sharing") { app.perform { _ = try await $0.command(Commands.PublicLinkRevoke(PublicLinkIdArgs(linkId: l.id))) } }.buttonStyle(.borderless)
                                }
                                if l.expiresAt != nil || l.hasPassword || l.allowIndexing {
                                    Text("Link settings: " + [l.expiresAt.map { "ends " + AppDates.short($0) }, l.hasPassword ? "password" : nil, l.allowIndexing ? "search engines can find it" : nil].compactMap { $0 }.joined(separator: ", ") + ". Set when the link was made.")
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                            }
                            if let newLink {
                                HStack {
                                    Text(newLink).textSelection(.enabled).lineLimit(1)
                                    Button("Copy") { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(newLink, forType: .string) }
                                }
                            }
                            DisclosureGroup("New Link Settings") {
                                Toggle("Expires", isOn: $expires)
                                if expires { DatePicker("On", selection: $expiry, in: Date()..., displayedComponents: .date) }
                                SecureField("Password (optional)", text: $password)
                                Picker("Look", selection: $look) {
                                    Text("Note: the note's own style").tag(PublicLinkCreateArgs.Theme.note)
                                    Text("Article: serif, narrow").tag(PublicLinkCreateArgs.Theme.article)
                                    Text("Docs: wide, contents beside").tag(PublicLinkCreateArgs.Theme.docs)
                                    Text("Minimal: plain paper").tag(PublicLinkCreateArgs.Theme.minimal)
                                }
                                Toggle("Let search engines find it", isOn: $indexing).disabled(!password.isEmpty)
                            }
                            Button("Create Public Link") {
                                let args = PublicLinkCreateArgs(noteId: noteId, expiresAt: expires ? expiry.timeIntervalSince1970 * 1000 : nil, password: password.isEmpty ? nil : password, allowIndexing: indexing && password.isEmpty, theme: look, plainCopy: nil)
                                app.perform { client in
                                    let r = try await client.command(Commands.PublicLinkCreate(args))
                                    newLink = r.url
                                    password = ""
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
    private var app: AppModel { .shared }
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
                                if p.isYou && !s.canManage {
                                    Button("Leave") {
                                        app.perform { client in
                                            _ = try await client.command(Commands.FolderSharingRevoke(FolderShareRevokeArgs(folderId: folderId, profileId: p.profileId)))
                                            app.toast("You left the folder")
                                        }
                                        dismiss()
                                    }
                                    .buttonStyle(.borderless)
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
            Text("Public links are for single notes: share a note to make one.").font(.caption).foregroundStyle(.secondary).padding(.horizontal, 20)
            HStack {
                Button("Copy Link") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(FolderActions.webURL(folderId).absoluteString, forType: .string)
                    app.toast("Link copied")
                }
                Spacer()
                Button("Done") { dismiss() }.keyboardShortcut(.defaultAction)
            }
            .padding(16)
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
