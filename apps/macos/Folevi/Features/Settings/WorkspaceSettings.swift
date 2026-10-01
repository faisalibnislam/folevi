import SwiftUI

// The open team workspace's settings (the web's WorkspaceSection, MembersSection and GuestsSection).
// Owners and admins change things; members read them. The server checks every action again.

/// "Owner" / "Admin" / "Member".
func workspaceRoleLabel(_ role: String) -> String {
    role == "owner" ? String(localized: "Owner") : role == "admin" ? String(localized: "Admin") : String(localized: "Member")
}

// MARK: - General

struct WorkspaceGeneralSettings: View {
    @Environment(AppModel.self) private var app
    @State private var name = ""
    @State private var confirmLeave = false
    @State private var confirmDelete = false
    @State private var typed = ""
    @State private var busy = false

    var body: some View {
        if let w = app.workspace {
            let scheduled = w.deletionScheduledFor
            let canAdmin = w.canManage && scheduled == nil
            SettingsPage {
                if let at = scheduled { scheduledCard(w, at: at) }
                SettingsCard(title: String(localized: "Workspace"), description: youAre(w)) {
                    if canAdmin {
                        HStack(spacing: 8) {
                            TextField("Workspace name", text: $name)
                                .textFieldStyle(.folevi)
                                .onSubmit { rename(w) }
                                .accessibilityLabel(Text("Workspace name"))
                            Button("Rename") { rename(w) }
                                .buttonStyle(.folevi(.secondary, .medium))
                                .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || name.trimmingCharacters(in: .whitespaces) == w.name)
                        }
                        .frame(maxWidth: 440)
                    } else {
                        (Text("Name: ").foregroundStyle(FoleviColor.inkMuted) + Text(w.name) + Text("  (owners and admins can rename it)").font(.ui(12)).foregroundStyle(FoleviColor.inkFaint))
                            .font(.ui(13))
                    }
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(spacing: 4) {
                            Text("Plan:").foregroundStyle(FoleviColor.inkMuted)
                            Text(w.plan?.name ?? PlanTier.name(w.plan?.tier ?? "free"))
                            if w.canManageBilling == true {
                                Text("·").foregroundStyle(FoleviColor.inkMuted)
                                Button("Plan & billing") { SettingsRouter.shared.section = .workspaceBilling }
                                    .buttonStyle(.plain).underline().foregroundStyle(FoleviColor.heading)
                            }
                        }
                        Text("\(storageLabel(w)): \(bytes(w.storageUsedBytes)) of \(bytes(w.storageQuotaBytes)) used")
                            .foregroundStyle(FoleviColor.inkMuted)
                        ProgressView(value: w.storageQuotaBytes > 0 ? min(1, w.storageUsedBytes / w.storageQuotaBytes) : 0)
                            .tint(FoleviColor.heading)
                            .frame(maxWidth: 440)
                        if w.storageUsedBytes > w.storageQuotaBytes, w.storageQuotaBytes > 0 {
                            Text(w.canManageBilling == true
                                 ? String(localized: "Over the storage limit. Everything already stored stays available; new uploads are paused until space is freed or the plan is upgraded.")
                                 : String(localized: "Over the storage limit. Everything already stored stays available; new uploads are paused until space is freed."))
                                .foregroundStyle(FoleviColor.destructive)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        Text("Your role: \(workspaceRoleLabel(w.role))\(w.role == "member" && w.memberAccess != nil && w.memberAccess != "edit" ? " · " + (w.memberAccess == "comment" ? String(localized: "can comment") : String(localized: "view only")) : "")")
                            .font(.ui(12)).foregroundStyle(FoleviColor.inkMuted)
                            .padding(.top, 4)
                    }
                    .font(.ui(13))
                    .padding(.top, 16)
                }
                if w.role != "owner" {
                    SettingsCard(title: String(localized: "Leave workspace"),
                                 description: String(localized: "You’ll lose access to its pages, folders and tasks. Pages you wrote stay in the workspace. Your Personal isn’t affected.")) {
                        Button("Leave \(w.name)") { confirmLeave = true }.buttonStyle(.folevi(.danger, .small))
                    }
                } else if scheduled == nil {
                    SettingsCard(title: String(localized: "Leave workspace"),
                                 description: String(localized: "You own this workspace, so you can’t leave it. Make another member the owner first (Members → Make owner), or delete the workspace below.")) {
                        Button("Go to Members") { SettingsRouter.shared.section = .members }
                            .buttonStyle(.plain).underline().font(.ui(13, .medium)).foregroundStyle(FoleviColor.heading)
                    }
                    SettingsCard(title: String(localized: "Delete workspace"),
                                 description: String(localized: "Deletes this workspace and everything in it (pages, folders, tasks, files and comments) for everyone, after a 7-day grace period. Export it first if you want to keep a copy. Nobody’s Personal is affected.")) {
                        Button("Delete \(w.name)…") {
                            typed = ""
                            confirmDelete = true
                        }
                        .buttonStyle(.folevi(.danger, .small))
                    }
                }
            }
            .onAppear { name = w.name }
            .sheet(isPresented: $confirmLeave) {
                FoleviDialog(title: String(localized: "Leave \(w.name)?"), message: String(localized: "To come back, an owner or admin has to invite you again."),
                             confirmTitle: String(localized: "Leave workspace"), busy: busy) { leave(w) }
            }
            .sheet(isPresented: $confirmDelete) {
                FoleviDialog(title: String(localized: "Delete \(w.name)?"),
                             message: String(localized: "Members and guests lose access right away and are told. You can cancel within 7 days; after that it’s gone for good. A paid plan ends with its current period."),
                             confirmTitle: String(localized: "Schedule deletion"), cancelTitle: String(localized: "Keep workspace"),
                             confirmDisabled: typed.trimmingCharacters(in: .whitespaces) != w.name.trimmingCharacters(in: .whitespaces),
                             busy: busy, onConfirm: { scheduleDeletion(w) }) {
                    TypeToConfirmField(expected: w.name, text: $typed)
                }
            }
        }
    }

    private func youAre(_ w: WorkspaceInfo) -> String {
        switch w.role {
        case "owner": return String(localized: "You're the owner of this workspace.")
        case "admin": return String(localized: "You're an admin of this workspace.")
        default:
            switch w.memberAccess {
            case "comment": return String(localized: "You're a member who can comment of this workspace.")
            case "view": return String(localized: "You're a member with view-only access of this workspace.")
            default: return String(localized: "You're a member of this workspace.")
            }
        }
    }

    private func storageLabel(_ w: WorkspaceInfo) -> String {
        switch w.storageRule {
        case "shared_free": return w.role == "owner" ? String(localized: "Your free storage, shared with the free workspaces you own") : String(localized: "The owner’s free storage")
        case "per_person": return String(localized: "Your storage here")
        default: return String(localized: "Workspace storage")
        }
    }

    private func bytes(_ n: Double) -> String { ByteCountFormatter.string(fromByteCount: Int64(n), countStyle: .file) }

    private func scheduledCard(_ w: WorkspaceInfo, at: Double) -> some View {
        SettingsCard(title: String(localized: "Scheduled for deletion"),
                     description: String(localized: "\(w.name) will be deleted on \(Date(timeIntervalSince1970: at / 1000).formatted(date: .long, time: .shortened)). Until then it’s read-only for you and hidden from members and guests.")) {
            Button("Cancel deletion") {
                let id = w.id
                let name = w.name
                app.settingsAction(nil) { session in
                    try await session.workspacesRepo.cancelDeletion(id)
                    await MainActor.run { app.showToast(String(localized: "\(name) won’t be deleted. If it had a paid plan, resume it in Plan & billing.")) }
                    await app.refreshWorkspaces()
                }
            }
            .buttonStyle(.folevi(.secondary, .small))
        }
    }

    private func rename(_ w: WorkspaceInfo) {
        let next = name.trimmingCharacters(in: .whitespaces)
        guard !next.isEmpty, next != w.name else { return }
        let id = w.id
        app.settingsAction(String(localized: "Renamed")) { session in
            try await session.workspacesRepo.rename(id, name: next)
            await app.refreshWorkspaces()
        }
    }

    private func leave(_ w: WorkspaceInfo) {
        guard let session = app.session, let me = app.profile?.id else { return }
        busy = true
        Task {
            defer { busy = false }
            do {
                try await session.workspacesRepo.removeMember(w.id, profileId: me)
                confirmLeave = false
                // Back to Personal: it's always there.
                await app.switchScope(.personal)
                await app.refreshWorkspaces()
                SettingsRouter.shared.section = .account
                app.showToast(String(localized: "You left \(w.name)"))
            } catch {
                app.showToast(ConvexService.mapError(error).localizedDescription)
            }
        }
    }

    private func scheduleDeletion(_ w: WorkspaceInfo) {
        guard let session = app.session else { return }
        let confirm = typed
        busy = true
        Task {
            defer { busy = false }
            do {
                try await session.workspacesRepo.scheduleDeletion(w.id, confirmName: confirm)
                confirmDelete = false
                await app.refreshWorkspaces()
                app.showToast(String(localized: "\(w.name) is scheduled for deletion"))
            } catch {
                app.showToast(ConvexService.mapError(error).localizedDescription)
            }
        }
    }
}

// MARK: - Members

struct MembersSettings: View {
    @Environment(AppModel.self) private var app
    @State private var data: WorkspaceMembers?
    @State private var failure: String?
    @State private var confirm: Confirm?

    struct Confirm: Identifiable {
        enum Kind { case remove, owner, guest }
        var kind: Kind
        var profileId: String
        var name: String
        var id: String { "\(kind)-\(profileId)" }
    }

    var body: some View {
        if let w = app.workspace {
            SettingsPage {
                if !app.sync.isOnline && data == nil {
                    OfflineNote(text: String(localized: "Members are shown when you're online."))
                } else if let failure, data == nil {
                    OfflineNote(text: failure)
                } else if let data {
                    if data.canManage {
                        SettingsCard(title: String(localized: "Invite people"),
                                     description: String(localized: "Members can open everything in this workspace that isn't restricted. Invitations are tied to the email address you enter and expire after 7 days.")) {
                            InviteForm(workspaceId: w.id, isOwner: data.yourRole == "owner", seats: data.seats)
                        }
                    }
                    SettingsCard(title: String(localized: "Members"), description: membersDescription(data)) {
                        SettingsList {
                            ForEach(data.members) { m in memberRow(m, data: data, workspace: w) }
                        }
                        if data.guests != nil {
                            Button("Guests: \(Int(data.guests ?? 0)) · Not billed") { SettingsRouter.shared.section = .workspaceGuests }
                                .buttonStyle(.plain).underline().font(.ui(12.5, .medium)).foregroundStyle(FoleviColor.heading)
                                .padding(.top, 10)
                        }
                        if !data.invites.isEmpty {
                            Text("Pending invitations").font(.ui(13, .semibold)).padding(.top, 18).padding(.bottom, 8)
                            SettingsList {
                                ForEach(data.invites) { i in inviteRow(i) }
                            }
                        }
                        if !data.canManage {
                            Text("Only owners and admins can invite people or change roles.").font(.ui(13)).foregroundStyle(FoleviColor.inkMuted).padding(.top, 12)
                        }
                    }
                } else {
                    ProgressView().controlSize(.small)
                }
            }
            .task(id: w.id) { await watch(w.id) }
            .sheet(item: $confirm) { c in confirmSheet(c, workspace: w) }
        }
    }

    private func membersDescription(_ data: WorkspaceMembers) -> String? {
        guard let s = data.seats else { return nil }
        if s.paid, let interval = s.interval, let cents = s.seatPriceCents {
            let per = interval == "year" ? String(localized: "year") : String(localized: "month")
            return String(localized: "Billable seats: \(Int(s.billable)) × \(PlanPrice.format(cents: cents)) per \(per) on \(s.planName). Owners, admins and members each take a seat; guests and pending invitations are free.")
        }
        return String(localized: "Billable seats: \(Int(s.billable)) (the \(s.planName) plan is free). Guests and pending invitations never take a seat.")
    }

    private func memberRow(_ m: WorkspaceMembers.Member, data: WorkspaceMembers, workspace w: WorkspaceInfo) -> some View {
        let isOwner = data.yourRole == "owner"
        return HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    Text(m.displayName).font(.ui(13.5, .medium)).foregroundStyle(FoleviColor.heading).lineLimit(1)
                    if m.isYou { Text("(you)").font(.ui(12)).foregroundStyle(FoleviColor.inkMuted) }
                }
                Text(m.email).font(.ui(12)).foregroundStyle(FoleviColor.inkMuted).lineLimit(1).truncationMode(.middle)
                if isOwner && m.role == "admin" {
                    HStack(spacing: 6) {
                        SettingsSwitch(label: String(localized: "\(m.displayName) can manage billing"),
                                       isOn: Binding(get: { m.canManageBilling }, set: { setBilling(m, $0, w.id) }))
                        Text("Can manage billing").font(.ui(12)).foregroundStyle(FoleviColor.inkMuted).fixedSize()
                    }
                    .padding(.top, 4)
                } else if m.role == "admin" && m.canManageBilling {
                    Text("Can manage billing").font(.ui(12)).foregroundStyle(FoleviColor.inkMuted)
                }
                // The other actions sit under the name, so the row never squeezes them.
                if m.canManage {
                    HStack(spacing: 2) {
                        if isOwner {
                            Button("Make owner") { confirm = Confirm(kind: .owner, profileId: m.profileId, name: m.displayName) }
                                .buttonStyle(.folevi(.quiet, .small))
                        }
                        Button("Convert to guest") { confirm = Confirm(kind: .guest, profileId: m.profileId, name: m.displayName) }
                            .buttonStyle(.folevi(.quiet, .small))
                        Button("Remove") { confirm = Confirm(kind: .remove, profileId: m.profileId, name: m.displayName) }
                            .buttonStyle(.folevi(.quiet, .small))
                            .foregroundStyle(FoleviColor.destructive)
                    }
                    .padding(.leading, -12)
                    .padding(.top, 2)
                }
            }
            .layoutPriority(1)
            Spacer(minLength: 8)
            if m.canManage {
                FoleviSelect(selection: Binding(get: { MemberRoleChoice(role: m.role, access: m.memberAccess) }, set: { setChoice(m, $0, w.id) }),
                             options: MemberRoleChoice.allCases.filter { $0 != .admin || isOwner }.map { .init(value: $0, title: $0.title) },
                             accessibilityLabel: String(localized: "Role for \(m.displayName)"), height: 28)
                    .fixedSize()
            } else {
                HStack(spacing: 6) {
                    Text(workspaceRoleLabel(m.role)).font(.ui(13)).foregroundStyle(FoleviColor.inkMuted)
                    if m.role == "member", m.memberAccess != .edit {
                        SettingsChip(text: m.memberAccess == .comment ? String(localized: "Can comment") : String(localized: "View only"))
                    }
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
    }

    private func inviteRow(_ i: WorkspaceMembers.Invite) -> some View {
        let access = i.role == "member" && i.memberAccess != .edit
            ? " · " + (i.memberAccess == .comment ? String(localized: "can comment") : String(localized: "view only")) : ""
        let when = i.expired ? String(localized: "expired") : String(localized: "expires \(Date(timeIntervalSince1970: i.expiresAt / 1000).formatted(.relative(presentation: .named)))")
        return HStack(spacing: 10) {
            Text(i.email).font(.ui(13)).lineLimit(1)
            Spacer(minLength: 8)
            Text("\(workspaceRoleLabel(i.role))\(access) · \(when)").font(.ui(12)).foregroundStyle(FoleviColor.inkMuted)
            Button("Revoke") {
                let id = i.id
                app.settingsAction(String(localized: "Invitation revoked")) { try await $0.workspacesRepo.revokeInvite(id) }
            }
            .buttonStyle(.folevi(.quiet, .small))
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
    }

    private func confirmSheet(_ c: Confirm, workspace w: WorkspaceInfo) -> some View {
        let title: String
        let message: String
        let action: String
        switch c.kind {
        case .owner:
            title = String(localized: "Make \(c.name) the owner?")
            message = String(localized: "\(c.name) will own \(w.name), and be the only one who can manage admins, billing, or hand it on again. You’ll stay on as an admin. The workspace’s plan stays with the workspace.")
            action = String(localized: "Transfer ownership")
        case .guest:
            title = String(localized: "Make \(c.name) a guest?")
            message = String(localized: "\(c.name) leaves the workspace's members (one seat less) and keeps access only to pages they created or were given, except restricted ones. They won't see anything else here.")
            action = String(localized: "Convert to guest")
        case .remove:
            title = String(localized: "Remove \(c.name)?")
            message = String(localized: "\(c.name) will lose access to \(w.name) and any pages shared with them here. Their pages stay in the workspace, and their Personal isn’t affected.")
            action = String(localized: "Remove")
        }
        return FoleviDialog(title: title, message: message, confirmTitle: action, confirmKind: c.kind == .owner ? .primary : .danger) {
            let wid = w.id
            let wname = w.name
            confirm = nil
            app.settingsAction(nil) { session in
                switch c.kind {
                case .owner:
                    try await session.workspacesRepo.transferOwnership(wid, profileId: c.profileId)
                    await MainActor.run { app.showToast(String(localized: "\(c.name) now owns \(wname)")) }
                    await app.refreshWorkspaces()
                case .guest:
                    try await session.workspacesRepo.convertMemberToGuest(wid, profileId: c.profileId)
                    await MainActor.run { app.showToast(String(localized: "\(c.name) is now a guest")) }
                case .remove:
                    try await session.workspacesRepo.removeMember(wid, profileId: c.profileId)
                    await MainActor.run { app.showToast(String(localized: "Removed \(c.name)")) }
                }
            }
        }
    }

    private func setChoice(_ m: WorkspaceMembers.Member, _ choice: MemberRoleChoice, _ workspaceId: String) {
        app.settingsAction(String(localized: "\(m.displayName) is now \(choice.phrase)")) {
            try await $0.workspacesRepo.changeRole(workspaceId, profileId: m.profileId, to: choice)
        }
    }

    private func setBilling(_ m: WorkspaceMembers.Member, _ allowed: Bool, _ workspaceId: String) {
        app.settingsAction(allowed ? String(localized: "\(m.displayName) can manage billing") : String(localized: "\(m.displayName) can no longer manage billing")) {
            try await $0.workspacesRepo.setBillingManager(workspaceId, profileId: m.profileId, allowed: allowed)
        }
    }

    private func watch(_ workspaceId: String) async {
        guard let session = app.session, app.sync.isOnline else { return }
        do {
            for try await value in session.workspacesRepo.membersUpdates(workspaceId) { data = value }
        } catch {
            failure = ConvexService.mapError(error).localizedDescription
        }
    }
}

/// Invite someone by email, with a role (the web's InviteForm). Admin is the owner's to offer.
struct InviteForm: View {
    var workspaceId: String
    var isOwner: Bool
    var seats: WorkspaceMembers.Seats?
    @Environment(AppModel.self) private var app
    @State private var email = ""
    @State private var choice: MemberRoleChoice = .memberEdit
    @State private var error: String?
    @State private var sending = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                TextField("name@example.com", text: $email)
                    .textFieldStyle(.folevi)
                    .onSubmit { send() }
                    .onChange(of: email) { _, _ in error = nil }
                    .accessibilityLabel(Text("Email"))
                FoleviSelect(selection: $choice, options: MemberRoleChoice.allCases.filter { $0 != .admin || isOwner }.map { .init(value: $0, title: $0.title) },
                             accessibilityLabel: String(localized: "Role"), height: 34)
                Button(sending ? String(localized: "Sending…") : String(localized: "Invite")) { send() }
                    .buttonStyle(.folevi(.primary, .medium))
                    .disabled(sending || !email.contains("@"))
            }
            if let error { Text(error).font(.ui(12.5)).foregroundStyle(FoleviColor.destructive) }
            if let s = seats, s.paid, let interval = s.interval, let cents = s.seatPriceCents {
                Text("Adds a seat when they accept: +\(PlanPrice.format(cents: cents))/\(interval == "year" ? String(localized: "year") : String(localized: "month")) on \(s.planName).")
                    .font(.ui(12.5)).foregroundStyle(FoleviColor.inkMuted)
            }
        }
    }

    private func send() {
        let address = email.trimmingCharacters(in: .whitespaces)
        guard let session = app.session, !address.isEmpty, !sending else { return }
        guard app.sync.isOnline else {
            error = String(localized: "This needs a connection. Try again when you're back online.")
            return
        }
        sending = true
        let picked = choice
        Task {
            defer { sending = false }
            do {
                try await session.workspacesRepo.invite(workspaceId, email: address, as: picked)
                app.showToast(String(localized: "Invitation sent to \(address)"))
                email = ""
            } catch {
                self.error = ConvexService.mapError(error).localizedDescription
            }
        }
    }
}

// MARK: - Guests

struct GuestsSettings: View {
    @Environment(AppModel.self) private var app
    @State private var data: WorkspaceGuests?
    @State private var failure: String?
    @State private var confirm: Confirm?

    struct Confirm: Identifiable {
        var member: Bool
        var profileId: String
        var name: String
        var id: String { "\(member)-\(profileId)" }
    }

    var body: some View {
        if let w = app.workspace {
            SettingsPage {
                SettingsCard(title: String(localized: "Guests"),
                             description: String(localized: "People outside \(w.name) who were given access to single pages (and the pages inside them). Guests don't see anything else here, and they're never billed.")) {
                    if !app.sync.isOnline && data == nil {
                        OfflineNote(text: String(localized: "Guests are shown when you're online."))
                    } else if let failure, data == nil {
                        OfflineNote(text: failure)
                    } else if let data {
                        if data.guests.isEmpty {
                            Text("No guests. Share a page with someone from its Share button to add one.").font(.ui(13)).foregroundStyle(FoleviColor.inkMuted)
                        } else {
                            SettingsList {
                                ForEach(data.guests) { g in guestRow(g, workspaceId: w.id) }
                            }
                        }
                        if !data.pendingInvites.isEmpty {
                            Text("Waiting to accept").font(.ui(13, .semibold)).padding(.top, 18)
                            Text("Pages shared with addresses that don’t have a Folevi account yet. Nothing is shared until they sign up and accept.")
                                .font(.ui(12)).foregroundStyle(FoleviColor.inkMuted).padding(.bottom, 8)
                            SettingsList {
                                ForEach(data.pendingInvites) { i in pendingRow(i) }
                            }
                        }
                    } else {
                        ProgressView().controlSize(.small)
                    }
                }
            }
            .task(id: w.id) { await watch(w.id) }
            .sheet(item: $confirm) { c in
                FoleviDialog(title: c.member ? String(localized: "Invite \(c.name) to become a member?") : String(localized: "Remove \(c.name) from \(w.name)?"),
                             message: c.member
                                ? String(localized: "They get an invitation. Once they accept, they're a member of \(w.name) (one billable seat on a paid plan) and keep the pages they already have.")
                                : String(localized: "\(c.name) will lose access to every page of \(w.name) that was shared with them."),
                             confirmTitle: c.member ? String(localized: "Send invitation") : String(localized: "Remove"),
                             confirmKind: c.member ? .primary : .danger) {
                    let wid = w.id
                    confirm = nil
                    if c.member {
                        app.settingsAction(String(localized: "Invitation sent to \(c.name)")) { try await $0.workspacesRepo.convertGuestToMember(wid, profileId: c.profileId) }
                    } else {
                        app.settingsAction(String(localized: "Removed \(c.name)")) { try await $0.workspacesRepo.removeGuest(wid, profileId: c.profileId) }
                    }
                }
            }
        }
    }

    private func guestRow(_ g: WorkspaceGuests.Guest, workspaceId: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(g.displayName).font(.ui(13.5, .medium)).foregroundStyle(FoleviColor.heading)
                    Text(g.email).font(.ui(12)).foregroundStyle(FoleviColor.inkMuted)
                }
                Spacer(minLength: 8)
                Button("Convert to member") { confirm = Confirm(member: true, profileId: g.profileId, name: g.displayName) }
                    .buttonStyle(.folevi(.quiet, .small))
                Button("Remove") { confirm = Confirm(member: false, profileId: g.profileId, name: g.displayName) }
                    .buttonStyle(.folevi(.quiet, .small))
                    .foregroundStyle(FoleviColor.destructive)
            }
            ForEach(g.pages) { p in
                HStack(spacing: 8) {
                    Button {
                        OpenWindowBridge.shared.openDocument?(p.documentId)
                    } label: {
                        HStack(spacing: 4) {
                            Text(p.title).font(.ui(13)).foregroundStyle(FoleviColor.ink).lineLimit(1)
                            if p.inTrash { Text("(in Trash)").font(.ui(12)).foregroundStyle(FoleviColor.inkFaint) }
                        }
                    }
                    .buttonStyle(.plain)
                    Spacer(minLength: 8)
                    FoleviSelect(selection: Binding(get: { ShareRole(rawValue: p.role) ?? .viewer }, set: { role in
                        app.settingsAction(String(localized: "\(g.displayName): \(role.title) on \(p.title)")) {
                            try await $0.workspacesRepo.setGuestAccess(workspaceId, profileId: g.profileId, documentId: p.documentId, role: role)
                        }
                    }), options: ShareRole.allCases.map { .init(value: $0, title: $0.title) },
                                 accessibilityLabel: String(localized: "\(g.displayName)'s access to \(p.title)"), height: 28)
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
    }

    private func pendingRow(_ i: WorkspaceGuests.PendingInvite) -> some View {
        let when = i.expired ? String(localized: "expired") : String(localized: "expires \(Date(timeIntervalSince1970: i.expiresAt / 1000).formatted(.relative(presentation: .named)))")
        return HStack(spacing: 10) {
            (Text(i.email) + Text(" · \(i.title)").foregroundStyle(FoleviColor.inkMuted)).font(.ui(13)).lineLimit(1)
            Spacer(minLength: 8)
            Text("\((ShareRole(rawValue: i.role) ?? .viewer).title) · \(when)").font(.ui(12)).foregroundStyle(FoleviColor.inkMuted)
            Button("Revoke") {
                let id = i.id
                app.settingsAction(String(localized: "Invitation revoked")) { try await $0.workspacesRepo.revokePageInvite(id) }
            }
            .buttonStyle(.folevi(.quiet, .small))
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
    }

    private func watch(_ workspaceId: String) async {
        guard let session = app.session, app.sync.isOnline else { return }
        do {
            for try await value in session.workspacesRepo.guestsUpdates(workspaceId) { data = value }
        } catch {
            failure = ConvexService.mapError(error).localizedDescription
        }
    }
}
