import SwiftUI

// The open team workspace's settings (the web's WorkspaceSection, MembersSection and GuestsSection).
// Owners and admins change things; members read them. The server checks every action again.

/// "Owner" / "Admin" / "Member".
func workspaceRoleLabel(_ role: String) -> String {
    role == "owner" ? String(localized: "Owner") : role == "admin" ? String(localized: "Admin") : String(localized: "Member")
}

/// Links inside settings text (`folevi-settings://<section>`), opened in Settings itself.
@MainActor
var settingsLinkHandler: OpenURLAction {
    OpenURLAction { url in
        guard url.scheme == "folevi-settings", let section = url.host().flatMap(SettingsSection.init(rawValue:)) else { return .systemAction }
        SettingsRouter.shared.section = section
        return .handled
    }
}

// MARK: - General

struct WorkspaceGeneralSettings: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        if let w = app.workspace {
            // Re-made per workspace so the rename field never shows the previous workspace's name.
            WorkspaceGeneralPage(workspace: w).id(w.id)
        }
    }
}

private struct WorkspaceGeneralPage: View {
    let workspace: WorkspaceInfo
    @Environment(AppModel.self) private var app
    @State private var name = ""
    @State private var confirmLeave = false
    @State private var confirmDelete = false
    @State private var typed = ""
    @State private var busy = false

    private var w: WorkspaceInfo { app.workspace?.id == workspace.id ? (app.workspace ?? workspace) : workspace }

    var body: some View {
        let scheduled = w.deletionScheduledFor
        // Owners and admins change settings; members read them. Nothing changes while deletion is scheduled.
        let canAdmin = w.canManage && scheduled == nil
        SettingsPage {
            if let at = scheduled { scheduledCard(at: at) }
            SettingsCard(title: String(localized: "Workspace"), description: youAre) {
                VStack(alignment: .leading, spacing: 0) {
                    if canAdmin {
                        HStack(spacing: 8) {
                            TextField("", text: $name)
                                .textFieldStyle(WebFieldStyle())
                                .onSubmit(rename)
                                .onChange(of: name) { _, v in if v.count > 80 { name = String(v.prefix(80)) } }
                                .accessibilityLabel(Text("Workspace name"))
                            Button("Rename", action: rename)
                                .buttonStyle(.folevi(.secondary, .medium))
                                .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || name.trimmingCharacters(in: .whitespaces) == w.name)
                        }
                        .frame(maxWidth: 448)
                    } else {
                        (Text("Name:").foregroundStyle(FoleviColor.inkMuted) + Text(" \(w.name) ").foregroundStyle(FoleviColor.ink)
                         + Text("(owners and admins can rename it)").font(.ui(12)).foregroundStyle(FoleviColor.inkFaint))
                            .font(.ui(14))
                    }
                    Text("Logo").font(.ui(14, .medium)).foregroundStyle(FoleviColor.ink).padding(.top, 20).padding(.bottom, 8)
                    if canAdmin {
                        IdentityImageField(label: String(localized: "Workspace logo"), shape: .square, url: w.logoUrl, initial: w.name,
                                           onUpload: { data, filename, mime in
                                               guard let convex = app.convex else { return }
                                               let fileId = try await IdentityImage.upload(data, filename: filename, mimeType: mime, kind: "logo", workspaceId: w.id, convex: convex)
                                               try await convex.mutationVoid("workspaces:setLogo", ["workspaceId": .string(w.id), "fileId": .string(fileId)])
                                               await app.refreshWorkspaces()
                                           },
                                           onRemove: {
                                               try await app.convex?.mutationVoid("workspaces:removeLogo", ["workspaceId": .string(w.id)])
                                               await app.refreshWorkspaces()
                                           })
                    } else {
                        Text("Owners and admins can change the logo.").font(.ui(14)).foregroundStyle(FoleviColor.inkMuted)
                    }
                    // A workspace has its own plan and storage, separate from anyone's Personal plan.
                    planLine.padding(.top, 16)
                    Text("\(storageLabel): \(WebFormat.bytes(w.storageUsedBytes)) of \(WebFormat.bytes(w.storageQuotaBytes)) used")
                        .font(.ui(14)).foregroundStyle(FoleviColor.inkMuted)
                        .padding(.top, 4)
                    StorageBar(fraction: w.storageQuotaBytes > 0 ? w.storageUsedBytes / w.storageQuotaBytes : 0)
                        .frame(maxWidth: 448)
                        .padding(.top, 8)
                    if w.storageUsedBytes > w.storageQuotaBytes {
                        Text(w.canManageBilling == true
                             ? String(localized: "Over the storage limit. Everything already stored stays available; new uploads are paused until space is freed or the plan is upgraded.")
                             : String(localized: "Over the storage limit. Everything already stored stays available; new uploads are paused until space is freed."))
                            .font(.ui(14)).foregroundStyle(FoleviColor.destructive)
                            .frame(maxWidth: 448, alignment: .leading)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.top, 8)
                    }
                    Text("Your role: \(workspaceRoleLabel(w.role))\(w.role == "member" && w.memberAccess != nil && w.memberAccess != "edit" ? " · " + (w.memberAccess == "comment" ? String(localized: "can comment") : String(localized: "view only")) : "")")
                        .font(.ui(12)).foregroundStyle(FoleviColor.inkMuted)
                        .padding(.top, 12)
                }
            }
            if w.role != "owner" {
                SettingsCard(title: String(localized: "Leave workspace"),
                             description: String(localized: "You’ll lose access to its pages, folders and tasks. Pages you wrote stay in the workspace. Your Personal isn’t affected.")) {
                    Button("Leave \(w.name)") { confirmLeave = true }.buttonStyle(.folevi(.danger, .medium))
                }
            } else if scheduled == nil {
                SettingsCard(title: String(localized: "Leave workspace"),
                             description: String(localized: "You own this workspace, so you can’t leave it. Make another member the owner first (Members → Make owner), or delete the workspace below.")) {
                    TextLinkButton(title: String(localized: "Go to Members"), size: 14) { SettingsRouter.shared.section = .members }
                }
                SettingsCard(title: String(localized: "Delete workspace"),
                             description: String(localized: "Deletes this workspace and everything in it (pages, folders, tasks, files and comments) for everyone, after a 7-day grace period. Export it first if you want to keep a copy. Nobody’s Personal is affected.")) {
                    Button("Delete \(w.name)…") {
                        typed = ""
                        confirmDelete = true
                    }
                    .buttonStyle(.folevi(.danger, .medium))
                }
            }
        }
        .onAppear { name = w.name }
        .sheet(isPresented: $confirmLeave) {
            WebConfirmDialog(title: String(localized: "Leave \(w.name)?"), description: String(localized: "To come back, an owner or admin has to invite you again."),
                             confirmTitle: String(localized: "Leave workspace"), busy: busy, onCancel: { confirmLeave = false }, onConfirm: leave)
        }
        .sheet(isPresented: $confirmDelete) {
            WebConfirmDialog(title: String(localized: "Delete \(w.name)?"),
                             description: String(localized: "Members and guests lose access right away and are told. You can cancel within 7 days; after that it’s gone for good. A paid plan ends with its current period."),
                             cancelTitle: String(localized: "Keep workspace"), confirmTitle: String(localized: "Schedule deletion"),
                             confirmDisabled: typed.trimmingCharacters(in: .whitespaces) != w.name.trimmingCharacters(in: .whitespaces),
                             busy: busy, onCancel: { confirmDelete = false }, onConfirm: scheduleDeletion) {
                ConfirmByTyping(expected: w.name, text: $typed)
            }
        }
    }

    private var youAre: String {
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

    private var planLine: some View {
        HStack(spacing: 0) {
            Text("Plan: ").foregroundStyle(FoleviColor.inkMuted)
            Text(w.plan?.name ?? PlanTier.name(w.plan?.tier ?? "free")).foregroundStyle(FoleviColor.ink)
            if w.canManageBilling == true {
                Text(" · ").foregroundStyle(FoleviColor.inkMuted)
                TextLinkButton(title: String(localized: "Plan & billing"), size: 14) { SettingsRouter.shared.section = .workspaceBilling }
            }
        }
        .font(.ui(14))
    }

    /// Your view of storage here: the owner's free pool, or your own quota on a paid plan.
    private var storageLabel: String {
        switch w.storageRule {
        case "shared_free": return w.role == "owner" ? String(localized: "Your free storage, shared with the free workspaces you own") : String(localized: "The owner’s free storage")
        case "per_person": return String(localized: "Your storage here")
        default: return String(localized: "Workspace storage")
        }
    }

    private func scheduledCard(at: Double) -> some View {
        SettingsCard(title: String(localized: "Scheduled for deletion"),
                     description: String(localized: "\(w.name) will be deleted on \(WebFormat.dateTime(at)). Until then it’s read-only for you and hidden from members and guests.")) {
            Button("Cancel deletion") {
                let id = w.id
                let name = w.name
                app.settingsAction(nil) { session in
                    try await session.workspacesRepo.cancelDeletion(id)
                    await MainActor.run { app.showToast(String(localized: "\(name) won’t be deleted. If it had a paid plan, resume it in Plan & billing.")) }
                    await app.refreshWorkspaces()
                }
            }
            .buttonStyle(.folevi(.secondary, .medium))
        }
    }

    private func rename() {
        let next = name.trimmingCharacters(in: .whitespaces)
        guard !next.isEmpty, next != w.name else { return }
        let id = w.id
        app.settingsAction(String(localized: "Renamed")) { session in
            try await session.workspacesRepo.rename(id, name: next)
            await app.refreshWorkspaces()
        }
    }

    private func leave() {
        guard let session = app.session, let me = app.profile?.id else { return }
        let left = w
        busy = true
        Task {
            defer { busy = false }
            do {
                try await session.workspacesRepo.removeMember(left.id, profileId: me)
                confirmLeave = false
                // Back to Personal: it's always there.
                await app.switchScope(.personal)
                await app.refreshWorkspaces()
                // The web stays on this page, which now says you're in Personal.
                SettingsRouter.shared.stayInSettings(.workspace)
                app.showToast(String(localized: "You left \(left.name)"))
            } catch {
                app.showToast(ConvexService.mapError(error).localizedDescription)
            }
        }
    }

    private func scheduleDeletion() {
        guard let session = app.session else { return }
        let confirm = typed
        let target = w
        busy = true
        Task {
            defer { busy = false }
            do {
                try await session.workspacesRepo.scheduleDeletion(target.id, confirmName: confirm)
                confirmDelete = false
                await app.refreshWorkspaces()
                app.showToast(String(localized: "\(target.name) is scheduled for deletion"))
            } catch {
                app.showToast(ConvexService.mapError(error).localizedDescription)
            }
        }
    }
}

/// The workspace storage bar: 6 pt, sunken, filled in accent.
private struct StorageBar: View {
    var fraction: Double
    var body: some View {
        let shown = min(1, max(0, fraction.isFinite ? fraction : 0))
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(FoleviColor.surfaceSunken)
                Rectangle().fill(FoleviColor.accent).frame(width: geo.size.width * shown)
            }
            .clipShape(Capsule())
        }
        .frame(height: 6)
        .accessibilityElement()
        .accessibilityLabel(Text("\(Int((shown * 100).rounded()))% of storage used"))
    }
}

// MARK: - Members

struct MembersSettings: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        if let w = app.workspace { MembersPage(workspace: w).id(w.id) }
    }
}

private struct MembersPage: View {
    let workspace: WorkspaceInfo
    @Environment(AppModel.self) private var app
    @State private var data: WorkspaceMembers?
    @State private var failure: String?
    @State private var confirm: Confirm?
    @State private var busy = false

    struct Confirm: Identifiable {
        enum Kind { case remove, owner, guest }
        var kind: Kind
        var profileId: String
        var name: String
        var id: String { "\(kind)-\(profileId)" }
    }

    private var w: WorkspaceInfo { workspace }
    private var canAdmin: Bool { data?.canManage == true }
    private var isOwner: Bool { data?.yourRole == "owner" }

    var body: some View {
        SettingsPage {
            if canAdmin {
                SettingsCard(title: String(localized: "Invite people"),
                             description: String(localized: "Members can open everything in this workspace that isn't restricted. Invitations are tied to the email address you enter and expire after 7 days.")) {
                    InviteForm(workspaceId: w.id, isOwner: isOwner, seats: data?.seats)
                }
            }
            SettingsCard(title: String(localized: "Members"), descriptionText: description) {
                VStack(alignment: .leading, spacing: 0) {
                    if !app.sync.isOnline && data == nil {
                        OfflineNote(text: String(localized: "Members are shown when you're online."))
                    } else if let failure, data == nil {
                        OfflineNote(text: failure)
                    } else {
                        SettingsList {
                            ForEach(data?.members ?? []) { m in memberRow(m) }
                        }
                        .frame(minHeight: data == nil ? 2 : nil)
                        if let data, !data.invites.isEmpty {
                            Text("Pending invitations").font(.ui(14, .semibold)).foregroundStyle(FoleviColor.ink).padding(.top, 20).padding(.bottom, 8)
                            SettingsList {
                                ForEach(data.invites) { i in inviteRow(i) }
                            }
                        }
                        if data != nil && !canAdmin {
                            Text("Only owners and admins can invite people or change roles.").font(.ui(14)).foregroundStyle(FoleviColor.inkMuted).padding(.top, 12)
                        }
                    }
                }
            }
            .environment(\.openURL, settingsLinkHandler)
        }
        .task(id: w.id) { await watch() }
        .sheet(item: $confirm) { c in confirmSheet(c) }
    }

    /// Billable seats, then "Guests: N · Not billed" linking to Guests (owners and admins).
    private var description: Text? {
        var seatLine: String?
        if let s = data?.seats {
            if s.paid, let interval = s.interval, let cents = s.seatPriceCents {
                let per = interval == "year" ? String(localized: "year") : String(localized: "month")
                seatLine = String(localized: "Billable seats: \(Int(s.billable)) × \(PlanPrice.format(cents: cents)) per \(per) on \(s.planName). Owners, admins and members each take a seat; guests and pending invitations are free.")
            } else {
                seatLine = String(localized: "Billable seats: \(Int(s.billable)) (the \(s.planName) plan is free). Guests and pending invitations never take a seat.")
            }
        }
        let guests = data?.guests
        guard seatLine != nil || guests != nil else { return nil }
        var text = Text(seatLine ?? "")
        if let guests {
            var link = AttributedString(String(localized: "Guests: \(Int(guests)) · Not billed"))
            link.link = URL(string: "folevi-settings://workspaceGuests")
            link.foregroundColor = FoleviColor.heading
            link.underlineStyle = .single
            link.font = .ui(14, .medium)
            text = text + Text(seatLine == nil ? "" : " ") + Text(link)
        }
        return text
    }

    private func memberRow(_ m: WorkspaceMembers.Member) -> some View {
        WrapHStack(spacing: 12, lineSpacing: 8) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 4) {
                    Text(m.displayName).font(.ui(14, .medium)).foregroundStyle(FoleviColor.ink).lineLimit(1)
                    if m.isYou { Text("(you)").font(.ui(12)).foregroundStyle(FoleviColor.inkMuted) }
                }
                Text(m.email).font(.ui(12)).foregroundStyle(FoleviColor.inkMuted).lineLimit(1).truncationMode(.middle)
                // The owner decides which admins may manage the plan and billing.
                if isOwner && m.role == "admin" {
                    HStack(spacing: 8) {
                        SettingsSwitch(label: String(localized: "\(m.displayName) can manage billing"),
                                       isOn: Binding(get: { m.canManageBilling }, set: { setBilling(m, $0) }))
                        Text("Can manage billing").font(.ui(12)).foregroundStyle(FoleviColor.inkMuted)
                    }
                    .padding(.top, 6)
                } else if m.role == "admin" && m.canManageBilling {
                    Text("Can manage billing").font(.ui(12)).foregroundStyle(FoleviColor.inkMuted).padding(.top, 2)
                }
            }
            if m.canManage {
                WebSelect(selection: Binding(get: { MemberRoleChoice(role: m.role, access: m.memberAccess) }, set: { setChoice(m, $0) }),
                          options: MemberRoleChoice.allCases.filter { $0 != .admin || isOwner }.map { .init(value: $0, title: $0.title) },
                          accessibilityLabel: String(localized: "Role for \(m.displayName)"), height: 32, fill: false)
                if isOwner {
                    Button("Make owner") { confirm = Confirm(kind: .owner, profileId: m.profileId, name: m.displayName) }
                        .buttonStyle(.folevi(.quiet, .small))
                }
                Button("Convert to guest") { confirm = Confirm(kind: .guest, profileId: m.profileId, name: m.displayName) }
                    .buttonStyle(.folevi(.quiet, .small))
                Button("Remove") { confirm = Confirm(kind: .remove, profileId: m.profileId, name: m.displayName) }
                    .buttonStyle(.folevi(.quiet, .small))
                    .foregroundStyle(FoleviColor.destructive)
            } else {
                HStack(spacing: 6) {
                    Text(workspaceRoleLabel(m.role)).font(.ui(14)).foregroundStyle(FoleviColor.inkMuted)
                    if m.role == "member", m.memberAccess != .edit {
                        SettingsChip(text: m.memberAccess == .comment ? String(localized: "Can comment") : String(localized: "View only"))
                    }
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    private func inviteRow(_ i: WorkspaceMembers.Invite) -> some View {
        let access = i.role == "member" && i.memberAccess != .edit
            ? " · " + (i.memberAccess == .comment ? String(localized: "can comment") : String(localized: "view only")) : ""
        let when = i.expired ? String(localized: "expired") : String(localized: "expires \(WebFormat.relative(i.expiresAt))")
        return HStack(spacing: 12) {
            Text(i.email).font(.ui(14)).foregroundStyle(FoleviColor.ink).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
            Text("\(workspaceRoleLabel(i.role))\(access) · \(when)").font(.ui(12)).foregroundStyle(FoleviColor.inkMuted)
            Button("Revoke") {
                let id = i.id
                app.settingsAction(String(localized: "Invitation revoked")) { try await $0.workspacesRepo.revokeInvite(id) }
            }
            .buttonStyle(.folevi(.quiet, .small))
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    private func confirmSheet(_ c: Confirm) -> some View {
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
        return WebConfirmDialog(title: title, description: message, confirmTitle: action, confirmKind: c.kind == .owner ? .primary : .danger,
                                busy: busy, onCancel: { confirm = nil }) { run(c) }
    }

    private func run(_ c: Confirm) {
        guard let session = app.session else { return }
        let wid = w.id
        let wname = w.name
        busy = true
        Task {
            defer { busy = false }
            do {
                switch c.kind {
                case .owner:
                    try await session.workspacesRepo.transferOwnership(wid, profileId: c.profileId)
                    app.showToast(String(localized: "\(c.name) now owns \(wname)"))
                    await app.refreshWorkspaces()
                case .guest:
                    try await session.workspacesRepo.convertMemberToGuest(wid, profileId: c.profileId)
                    app.showToast(String(localized: "\(c.name) is now a guest"))
                case .remove:
                    try await session.workspacesRepo.removeMember(wid, profileId: c.profileId)
                    app.showToast(String(localized: "Removed \(c.name)"))
                }
                confirm = nil
            } catch {
                app.showToast(ConvexService.mapError(error).localizedDescription)
            }
        }
    }

    private func setChoice(_ m: WorkspaceMembers.Member, _ choice: MemberRoleChoice) {
        let wid = w.id
        app.settingsAction(String(localized: "\(m.displayName) is now \(choice.phrase)")) {
            try await $0.workspacesRepo.changeRole(wid, profileId: m.profileId, to: choice)
        }
    }

    private func setBilling(_ m: WorkspaceMembers.Member, _ allowed: Bool) {
        let wid = w.id
        app.settingsAction(allowed ? String(localized: "\(m.displayName) can manage billing") : String(localized: "\(m.displayName) can no longer manage billing")) {
            try await $0.workspacesRepo.setBillingManager(wid, profileId: m.profileId, allowed: allowed)
        }
    }

    private func watch() async {
        guard let session = app.session, app.sync.isOnline else { return }
        do {
            for try await value in session.workspacesRepo.membersUpdates(w.id) { data = value }
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
    var onSent: (() -> Void)? = nil
    @Environment(AppModel.self) private var app
    @State private var email = ""
    @State private var choice: MemberRoleChoice = .memberEdit
    @State private var error: String?
    @State private var sending = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            WrapHStack(spacing: 8) {
                TextField("name@example.com", text: $email)
                    .textFieldStyle(WebFieldStyle(invalid: error != nil))
                    .textContentType(.emailAddress)
                    .onSubmit(send)
                    .onChange(of: email) { _, _ in error = nil }
                    .frame(minWidth: 200)
                    .accessibilityLabel(Text("Email"))
                WebSelect(selection: $choice, options: MemberRoleChoice.allCases.filter { $0 != .admin || isOwner }.map { .init(value: $0, title: $0.title) },
                          accessibilityLabel: String(localized: "Role"), fill: false)
                Button(sending ? String(localized: "Sending…") : String(localized: "Invite"), action: send)
                    .buttonStyle(.folevi(.primary, .medium))
            }
            if let error { Text(error).font(.ui(14)).foregroundStyle(FoleviColor.destructive) }
            // On a paid plan, what one more member costs (the server bills it once they accept).
            if let s = seats, s.paid, let interval = s.interval, let cents = s.seatPriceCents {
                Text("Adds a seat when they accept: +\(PlanPrice.format(cents: cents))/\(interval == "year" ? String(localized: "year") : String(localized: "month")) on \(s.planName).")
                    .font(.ui(12.5)).foregroundStyle(FoleviColor.inkMuted)
            }
        }
    }

    private func send() {
        let address = email.trimmingCharacters(in: .whitespaces)
        guard let session = app.session, !sending else { return }
        guard !address.isEmpty else { return }
        guard app.sync.isOnline else {
            error = String(localized: "This needs a connection. Try again when you're back online.")
            return
        }
        sending = true
        error = nil
        let picked = choice
        Task {
            defer { sending = false }
            do {
                try await session.workspacesRepo.invite(workspaceId, email: address, as: picked)
                app.showToast(String(localized: "Invitation sent to \(address)"))
                email = ""
                onSent?()
            } catch {
                self.error = ConvexService.mapError(error).localizedDescription
            }
        }
    }
}

// MARK: - Guests

struct GuestsSettings: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        if let w = app.workspace { GuestsPage(workspace: w).id(w.id) }
    }
}

private struct GuestsPage: View {
    let workspace: WorkspaceInfo
    @Environment(AppModel.self) private var app
    @State private var data: WorkspaceGuests?
    @State private var failure: String?
    @State private var confirm: Confirm?
    @State private var busy = false

    struct Confirm: Identifiable {
        var member: Bool
        var profileId: String
        var name: String
        var id: String { "\(member)-\(profileId)" }
    }

    private var w: WorkspaceInfo { workspace }

    var body: some View {
        SettingsPage {
            SettingsCard(title: String(localized: "Guests"),
                         description: String(localized: "People outside \(w.name) who were given access to single pages (and the pages inside them). Guests don't see anything else here, and they're never billed.")) {
                VStack(alignment: .leading, spacing: 0) {
                    if !app.sync.isOnline && data == nil {
                        OfflineNote(text: String(localized: "Guests are shown when you're online."))
                    } else if let failure, data == nil {
                        OfflineNote(text: failure)
                    } else if let data {
                        if data.guests.isEmpty {
                            Text("No guests. Share a page with someone from its Share button to add one.").font(.ui(14)).foregroundStyle(FoleviColor.inkMuted)
                        } else {
                            SettingsList {
                                ForEach(data.guests) { g in guestRow(g) }
                            }
                        }
                        if !data.pendingInvites.isEmpty {
                            Text("Waiting to accept").font(.ui(14, .semibold)).foregroundStyle(FoleviColor.ink).padding(.top, 20).padding(.bottom, 8)
                            Text("Pages shared with addresses that don’t have a Folevi account yet. Nothing is shared until they sign up and accept.")
                                .font(.ui(12)).foregroundStyle(FoleviColor.inkMuted).padding(.bottom, 8)
                                .fixedSize(horizontal: false, vertical: true)
                            SettingsList {
                                ForEach(data.pendingInvites) { i in pendingRow(i) }
                            }
                        }
                    } else {
                        Text("Loading…").font(.ui(14)).foregroundStyle(FoleviColor.inkMuted)
                    }
                }
            }
        }
        .task(id: w.id) { await watch() }
        .sheet(item: $confirm) { c in
            WebConfirmDialog(title: c.member ? String(localized: "Invite \(c.name) to become a member?") : String(localized: "Remove \(c.name) from \(w.name)?"),
                             description: c.member
                                ? String(localized: "They get an invitation. Once they accept, they're a member of \(w.name) (one billable seat on a paid plan) and keep the pages they already have.")
                                : String(localized: "\(c.name) will lose access to every page of \(w.name) that was shared with them."),
                             confirmTitle: c.member ? String(localized: "Send invitation") : String(localized: "Remove"),
                             confirmKind: c.member ? .primary : .danger, busy: busy, onCancel: { confirm = nil }) { run(c) }
        }
    }

    private func guestRow(_ g: WorkspaceGuests.Guest) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            WrapHStack(spacing: 12, lineSpacing: 8) {
                VStack(alignment: .leading, spacing: 0) {
                    Text(g.displayName).font(.ui(14, .medium)).foregroundStyle(FoleviColor.ink).lineLimit(1)
                    Text(g.email).font(.ui(12)).foregroundStyle(FoleviColor.inkMuted).lineLimit(1)
                }
                Button("Convert to member") { confirm = Confirm(member: true, profileId: g.profileId, name: g.displayName) }
                    .buttonStyle(.folevi(.quiet, .small))
                Button("Remove") { confirm = Confirm(member: false, profileId: g.profileId, name: g.displayName) }
                    .buttonStyle(.folevi(.quiet, .small))
                    .foregroundStyle(FoleviColor.destructive)
            }
            VStack(alignment: .leading, spacing: 6) {
                ForEach(g.pages) { p in
                    HStack(spacing: 8) {
                        GuestPageLink(title: p.title, inTrash: p.inTrash) { app.pendingOpenDocumentId = p.documentId }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        WebSelect(selection: Binding(get: { ShareRole(rawValue: p.role) ?? .viewer }, set: { role in setAccess(g, p, role) }),
                                  options: ShareRole.allCases.map { .init(value: $0, title: $0.label) },
                                  accessibilityLabel: String(localized: "\(g.displayName)'s access to \(p.title)"), height: 32, fill: false)
                    }
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text("Pages \(g.displayName) can open"))
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    private func pendingRow(_ i: WorkspaceGuests.PendingInvite) -> some View {
        let when = i.expired ? String(localized: "expired") : String(localized: "expires \(WebFormat.relative(i.expiresAt))")
        return HStack(spacing: 12) {
            (Text(i.email).foregroundStyle(FoleviColor.ink) + Text(" · \(i.title)").foregroundStyle(FoleviColor.inkMuted))
                .font(.ui(14)).lineLimit(1).truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text("\(ShareRole.label(i.role)) · \(when)").font(.ui(12)).foregroundStyle(FoleviColor.inkMuted)
            Button("Revoke") {
                let id = i.id
                app.settingsAction(String(localized: "Invitation revoked")) { try await $0.workspacesRepo.revokePageInvite(id) }
            }
            .buttonStyle(.folevi(.quiet, .small))
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    private func setAccess(_ g: WorkspaceGuests.Guest, _ p: WorkspaceGuests.Page, _ role: ShareRole) {
        let wid = w.id
        app.settingsAction(String(localized: "\(g.displayName): \(role.label) on \(p.title)")) {
            try await $0.workspacesRepo.setGuestAccess(wid, profileId: g.profileId, documentId: p.documentId, role: role)
        }
    }

    private func run(_ c: Confirm) {
        guard let session = app.session else { return }
        let wid = w.id
        busy = true
        Task {
            defer { busy = false }
            do {
                if c.member {
                    try await session.workspacesRepo.convertGuestToMember(wid, profileId: c.profileId)
                    app.showToast(String(localized: "Invitation sent to \(c.name)"))
                } else {
                    try await session.workspacesRepo.removeGuest(wid, profileId: c.profileId)
                    app.showToast(String(localized: "Removed \(c.name)"))
                }
                confirm = nil
            } catch {
                app.showToast(ConvexService.mapError(error).localizedDescription)
            }
        }
    }

    private func watch() async {
        guard let session = app.session, app.sync.isOnline else { return }
        do {
            for try await value in session.workspacesRepo.guestsUpdates(w.id) { data = value }
        } catch {
            failure = ConvexService.mapError(error).localizedDescription
        }
    }
}

/// A page a guest can open: its title (underlined on hover) and "(in Trash)".
private struct GuestPageLink: View {
    var title: String
    var inTrash: Bool
    var action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Text(title).font(.ui(14)).foregroundStyle(FoleviColor.ink).underline(hovering).lineLimit(1)
                if inTrash { Text("(in Trash)").font(.ui(12)).foregroundStyle(FoleviColor.inkFaint) }
            }
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .accessibilityAddTraits(.isLink)
    }
}
