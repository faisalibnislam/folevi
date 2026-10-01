import AppKit
import SwiftUI

/// "Share" for the open note: a button that opens the Share panel in a popover (the web's ShareDialog).
struct ShareNoteButton: View {
    var editor: EditorModel
    /// The dock's quiet icon, or the toolbar's pill.
    var style: Style = .pill
    @Environment(AppModel.self) private var app
    @State private var open = false
    @State private var hover = false

    enum Style { case pill, dock }

    var body: some View {
        Group {
            switch style {
            case .pill:
                Button { open.toggle() } label: { Label("Share", systemImage: "square.and.arrow.up") }
                    .buttonStyle(.folevi(.secondary, .medium))
            case .dock:
                Button { open.toggle() } label: {
                    Image(systemName: "square.and.arrow.up").font(.system(size: 13.5, weight: .medium))
                        .foregroundStyle(FoleviColor.heading)
                        .padding(.horizontal, 9)
                        .frame(height: 34)
                        .background(open ? FoleviGlass.active : hover ? FoleviGlass.hover : .clear, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .onHover { hover = $0 }
            }
        }
        .help(Text("Share"))
        .accessibilityLabel(Text("Share"))
        .popover(isPresented: $open, arrowEdge: style == .dock ? .top : .bottom) {
            SharePanel(documentId: editor.documentId, title: editor.document?.displayTitle ?? String(localized: "Untitled"),
                       personal: (editor.document?.workspaceId ?? "").isEmpty)
                .environment(app)
        }
    }
}

/// Who can open the note and how: access mode, people and email invitations, public links. What you can
/// change follows the server: managers (access mode, links, anyone's grants), members who can edit (add
/// people up to Can edit, change what they added), guests (nothing).
struct SharePanel: View {
    var documentId: String
    var title: String
    /// The page is in someone's Personal, which has no members.
    var personal: Bool
    @Environment(AppModel.self) private var app
    @State private var data: ShareInfo?
    @State private var failed: String?
    @State private var email = ""
    @State private var role: ShareRole = .viewer
    @State private var sending = false
    @State private var freshLink: String?
    @State private var expires: Date?
    @State private var password = ""

    private var repo: CollaborationRepository? { app.session.map { CollaborationRepository(convex: $0.convex) } }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Share \u{201C}\(title)\u{201D}")
                .font(FoleviType.display(19)).foregroundStyle(FoleviColor.heading).lineLimit(1)
                .accessibilityAddTraits(.isHeader)
                .padding(.horizontal, 20).padding(.top, 18).padding(.bottom, 12)
            ScrollView {
                Group {
                    if let data {
                        content(data)
                    } else if let failed {
                        Text(failed).font(.ui(13)).foregroundStyle(FoleviColor.inkMuted)
                    } else {
                        Text("Loading…").font(.ui(13)).foregroundStyle(FoleviColor.inkMuted)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 20)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .fixedSize(horizontal: false, vertical: true)
        }
        .frame(width: 480)
        .frame(maxHeight: 640)
        .task { await watch() }
    }

    private func watch() async {
        guard app.sync.isOnline else {
            failed = String(localized: "Sharing is available when you're online.")
            return
        }
        while !Task.isCancelled {
            if let repo {
                do {
                    for try await value in repo.shareUpdates(documentId) {
                        data = value
                        if !value.assignableRoles.contains(role), let first = value.assignableRoles.first { role = first }
                    }
                } catch {
                    if data == nil { failed = ConvexService.mapError(error).localizedDescription }
                }
            }
            try? await Task.sleep(for: .seconds(5))
        }
    }

    private func run(_ ok: String? = nil, _ call: @escaping @Sendable (CollaborationRepository) async throws -> Void) {
        guard let repo else { return }
        Task {
            do {
                try await call(repo)
                if let ok { app.showToast(ok) }
            } catch {
                app.showToast(ConvexService.mapError(error).localizedDescription)
            }
        }
    }

    @ViewBuilder private func content(_ d: ShareInfo) -> some View {
        VStack(alignment: .leading, spacing: 22) {
            access(d)
            people(d)
            if d.canManage { publicLinks(d) }
        }
    }

    // MARK: Who has access

    private func access(_ d: ShareInfo) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            heading("Who has access")
            if personal {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "lock").font(.system(size: 13)).foregroundStyle(FoleviColor.inkMuted).padding(.top, 1)
                    Text("This page is in a Personal space: only its owner and the people added below can open it.")
                        .font(.ui(12.5)).foregroundStyle(FoleviColor.inkMuted).fixedSize(horizontal: false, vertical: true)
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(FoleviColor.line))
            } else {
                HStack(spacing: 8) {
                    modeCard(d, mode: "workspace", title: String(localized: "Workspace"),
                             detail: String(localized: "Everyone in this workspace, by their role"), icon: "person.2")
                    modeCard(d, mode: "restricted", title: String(localized: "Only invited people"),
                             detail: String(localized: "Owners, admins, the creator and people added below"), icon: "lock")
                }
                .accessibilityElement(children: .contain)
                .accessibilityLabel(Text("Access"))
            }
        }
    }

    private func modeCard(_ d: ShareInfo, mode: String, title: String, detail: String, icon: String) -> some View {
        let on = d.accessMode == mode
        return Button {
            guard !on else { return }
            let documentId = self.documentId
            run { try await $0.setAccessMode(documentId, mode: mode) }
        } label: {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: icon).font(.system(size: 13)).foregroundStyle(FoleviColor.inkMuted).padding(.top, 1)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.ui(13, .medium)).foregroundStyle(FoleviColor.heading)
                    Text(detail).font(.ui(11.5)).foregroundStyle(FoleviColor.inkMuted).fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
            .padding(12)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(on ? FoleviColor.accentSoft : .clear, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(on ? FoleviColor.accent : FoleviColor.line))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!d.canManage)
        .opacity(d.canManage ? 1 : 0.6)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    // MARK: People

    private func people(_ d: ShareInfo) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            heading("People")
            if d.youAreGuest {
                Text(guestNote(d)).font(.ui(11.5)).foregroundStyle(FoleviColor.inkMuted).fixedSize(horizontal: false, vertical: true)
            }
            if d.canShare { inviteForm(d) }
            VStack(spacing: 0) {
                if d.people.isEmpty {
                    Text(d.youAreGuest ? "It was shared with you through a page above it." : "No one has been added directly.")
                        .font(.ui(12.5)).foregroundStyle(FoleviColor.inkMuted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 12).padding(.vertical, 10)
                }
                ForEach(Array(d.people.enumerated()), id: \.element.id) { i, p in
                    if i > 0 { FoleviColor.line.frame(height: 1) }
                    personRow(p, d)
                }
            }
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(FoleviColor.line))
            if !d.pendingInvites.isEmpty {
                Text("Invited by email").foleviCapsLabel().padding(.top, 6)
                VStack(spacing: 0) {
                    ForEach(Array(d.pendingInvites.enumerated()), id: \.element.id) { i, invite in
                        if i > 0 { FoleviColor.line.frame(height: 1) }
                        HStack(spacing: 10) {
                            Text(invite.email).font(.ui(13)).foregroundStyle(FoleviColor.ink).lineLimit(1).truncationMode(.middle)
                            Spacer(minLength: 6)
                            Text("\(ShareRole.label(invite.role)) · \(invite.expired ? String(localized: "expired") : String(localized: "waiting to accept"))")
                                .font(.ui(11.5)).foregroundStyle(FoleviColor.inkMuted).lineLimit(1)
                            Button("Revoke") {
                                let id = invite.id
                                run(String(localized: "Invitation revoked")) { try await $0.revokePageInvite(id) }
                            }
                            .buttonStyle(.folevi(.quiet, .small))
                        }
                        .padding(.horizontal, 12).padding(.vertical, 6)
                    }
                }
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(FoleviColor.line))
            }
        }
    }

    private func guestNote(_ d: ShareInfo) -> String {
        var s = String(localized: "You’re a guest on this page")
        if let by = d.sharedBy { s += ", " + String(localized: "shared with you by \(by)") }
        s += ". "
        if let owner = d.ownerName { s += String(localized: "It belongs to \(owner).") + " " }
        s += String(localized: "Only its owner and the workspace’s members can share it.")
        return s
    }

    private func inviteForm(_ d: ShareInfo) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                TextField("name@example.com", text: $email)
                    .textFieldStyle(FoleviFieldStyle(height: 34))
                    .onSubmit(share)
                    .accessibilityLabel(Text("Email address"))
                CollabChoiceButton(options: d.assignableRoles.map { ($0, $0.label) }, selection: $role, accessibilityLabel: "Role", height: 34)
                Button("Share", action: share)
                    .buttonStyle(.folevi(.primary, .medium))
                    .disabled(sending || email.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            Text(personal
                 ? "Anyone with an email address: people without a Folevi account get an invitation by email."
                 : "People outside the workspace join as guests on this page only and aren’t billed. People without a Folevi account get an invitation by email.")
                .font(.ui(11.5)).foregroundStyle(FoleviColor.inkMuted).fixedSize(horizontal: false, vertical: true)
        }
    }

    private func share() {
        let to = email.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !to.isEmpty, !sending, let repo else { return }
        sending = true
        let documentId = self.documentId, role = self.role
        Task {
            defer { sending = false }
            do {
                let r = try await repo.grant(documentId, email: to, role: role)
                app.showToast(r.status == "invited"
                              ? String(localized: "Invitation sent to \(to). They get access once they sign up and accept.")
                              : String(localized: "Shared"))
                email = ""
            } catch {
                app.showToast(ConvexService.mapError(error).localizedDescription)
            }
        }
    }

    private func personRow(_ p: ShareInfo.Person, _ d: ShareInfo) -> some View {
        HStack(spacing: 10) {
            CollabAvatar(name: p.displayName, size: 26)
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 6) {
                    Text(p.displayName).font(.ui(13, .medium)).foregroundStyle(FoleviColor.heading).lineLimit(1)
                    if p.isYou { Text("(you)").font(.ui(11.5)).foregroundStyle(FoleviColor.inkMuted) }
                    if p.guest {
                        Text("Guest").font(.ui(11, .medium)).foregroundStyle(FoleviColor.inkMuted)
                            .padding(.horizontal, 6).padding(.vertical, 1)
                            .overlay(Capsule().strokeBorder(FoleviColor.line))
                    }
                }
                if let email = p.email { Text(email).font(.ui(11.5)).foregroundStyle(FoleviColor.inkMuted).lineLimit(1) }
            }
            Spacer(minLength: 6)
            if p.canChange, let email = p.email, !d.assignableRoles.isEmpty {
                // Changing a role shares again at the new level (sharing:grant updates the grant).
                CollabChoiceButton(options: d.assignableRoles.map { ($0.rawValue, $0.label) }, selection: Binding(get: { p.role }, set: { newRole in
                    guard newRole != p.role, let r = ShareRole(rawValue: newRole) else { return }
                    let documentId = self.documentId
                    run { _ = try await $0.grant(documentId, email: email, role: r) }
                }), accessibilityLabel: "Role for \(p.displayName)", height: 28)
            } else {
                Text(ShareRole.label(p.role)).font(.ui(11.5)).foregroundStyle(FoleviColor.inkMuted)
            }
            if p.canChange {
                IconButton(systemImage: "trash", label: "Remove \(p.displayName)", size: 26) {
                    let documentId = self.documentId, profileId = p.profileId
                    run { try await $0.revoke(documentId, profileId: profileId) }
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    // MARK: Public link

    private func publicLinks(_ d: ShareInfo) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Image(systemName: "globe").font(.system(size: 13, weight: .medium)).foregroundStyle(FoleviColor.heading)
                heading("Public link")
            }
            Text("Off by default. Anyone with the link can read this page (not its comments or nested pages). Links aren’t indexed by search engines and can be revoked instantly.")
                .font(.ui(11.5)).foregroundStyle(FoleviColor.inkMuted).fixedSize(horizontal: false, vertical: true)
            if !d.publicLinksAvailable {
                Text("Public links are temporarily turned off for Folevi.").font(.ui(11.5)).foregroundStyle(FoleviColor.warning)
            }
            if let freshLink {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Copy this link now. For your security, it isn’t shown again.").font(.ui(11.5, .medium)).foregroundStyle(FoleviColor.ink)
                    HStack(spacing: 8) {
                        Text(freshLink).font(.mono(11.5)).foregroundStyle(FoleviColor.ink).lineLimit(1).truncationMode(.middle)
                            .textSelection(.enabled)
                            .padding(.horizontal, 10).frame(maxWidth: .infinity, minHeight: 30, alignment: .leading)
                            .foleviWell(shape: .rounded(6))
                        Button {
                            NSPasteboard.general.clearContents()
                            NSPasteboard.general.setString(freshLink, forType: .string)
                            app.showToast(String(localized: "Link copied"))
                        } label: { Label("Copy", systemImage: "doc.on.doc") }
                        .buttonStyle(.folevi(.secondary, .small))
                    }
                }
                .padding(12)
                .background(FoleviColor.successSoft, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(FoleviColor.success.opacity(0.4)))
            }
            ForEach(d.links) { l in
                HStack(spacing: 10) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("…/s/\(l.tokenHint)••••••••").font(.mono(11.5)).foregroundStyle(FoleviColor.ink)
                        Text(linkDetail(l)).font(.ui(11.5)).foregroundStyle(FoleviColor.inkMuted)
                    }
                    Spacer(minLength: 6)
                    Button("Revoke") {
                        let id = l.id
                        run(String(localized: "Link revoked")) { try await $0.revokePublicLink(id) }
                    }
                    .buttonStyle(.folevi(.quiet, .small))
                    .foregroundStyle(FoleviColor.destructive)
                }
                .padding(.horizontal, 12).padding(.vertical, 8)
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(FoleviColor.line))
            }
            if d.publicLinksAvailable { linkForm }
        }
    }

    private func linkDetail(_ l: ShareInfo.Link) -> String {
        var s = l.expired ? String(localized: "Expired")
            : l.expiresAt.map { String(localized: "Expires \(Date(timeIntervalSince1970: $0 / 1000).formatted(date: .abbreviated, time: .shortened))") }
            ?? String(localized: "No expiry")
        if l.hasPassword { s += " · " + String(localized: "Password protected") }
        s += " · " + (l.viewCount == 1 ? String(localized: "1 view") : String(localized: "\(l.viewCount) views"))
        return s
    }

    private var linkForm: some View {
        HStack(alignment: .bottom, spacing: 8) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Expires (optional)").font(.ui(11.5)).foregroundStyle(FoleviColor.ink)
                if let expires {
                    HStack(spacing: 2) {
                        DatePicker("Expires", selection: Binding(get: { expires }, set: { self.expires = $0 }), in: Date()...,
                                   displayedComponents: [.date, .hourAndMinute])
                            .labelsHidden()
                            .datePickerStyle(.field)
                            .font(.ui(12))
                        IconButton(systemImage: "xmark", label: "No expiry", size: 22) { self.expires = nil }
                    }
                    .frame(height: 34)
                } else {
                    Button("Add expiry") { expires = Date().addingTimeInterval(7 * 86_400) }
                        .buttonStyle(.folevi(.quiet, .small))
                        .frame(height: 34)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            VStack(alignment: .leading, spacing: 4) {
                Text("Password (optional, 8+ characters)").font(.ui(11.5)).foregroundStyle(FoleviColor.ink).lineLimit(1)
                SecureField("", text: $password)
                    .textFieldStyle(FoleviFieldStyle(height: 34))
                    .accessibilityLabel(Text("Password (optional, 8+ characters)"))
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Button("Create link", action: createLink).buttonStyle(.folevi(.secondary, .medium))
        }
    }

    private func createLink() {
        guard let repo else { return }
        if !password.isEmpty && password.count < 8 {
            app.showToast(String(localized: "Use a password of at least 8 characters."))
            return
        }
        let documentId = self.documentId, expires = self.expires, password = self.password
        Task {
            do {
                let r = try await repo.createPublicLink(documentId, expiresAt: expires, password: password.isEmpty ? nil : password)
                if let origin = app.config.appOrigin { freshLink = origin.appending(path: "s/\(r.token)").absoluteString }
                self.expires = nil
                self.password = ""
            } catch {
                app.showToast(ConvexService.mapError(error).localizedDescription)
            }
        }
    }

    private func heading(_ text: LocalizedStringKey) -> some View {
        Text(text).font(.ui(13.5, .semibold)).foregroundStyle(FoleviColor.heading).accessibilityAddTraits(.isHeader)
    }
}
