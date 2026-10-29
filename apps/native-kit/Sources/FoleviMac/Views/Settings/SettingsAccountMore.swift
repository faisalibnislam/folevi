// The account sections that read the server through Settings' Convex allowlist (viewsSettings.ts QUERIES and
// MUTATIONS), drawn as the web's: Privacy (PrivacySection.tsx), Plan & billing (BillingSection.tsx, the plan and
// billing as the web shows them on the Mac; buying goes to the web's checkout page), Connected apps
// (ConnectedAppsSection.tsx, ApiTokens.tsx, Webhooks.tsx), and the workspace's General, Members, Guests, Plan
// & billing and Privacy.
#if os(macOS)
import AppKit
import SwiftUI
import FoleviDesign
import FoleviEngine

/// A read-only path into a JSON value (the server's answers, as the web's components read them).
struct J {
    let v: JSONValue?
    init(_ v: JSONValue?) { self.v = v }
    subscript(_ k: String) -> J { if case .object(let o)? = v { return J(o[k]) } else { return J(nil) } }
    var string: String? { if case .string(let s)? = v { return s } else { return nil } }
    var number: Double? { if case .number(let n)? = v { return n } else { return nil } }
    var bool: Bool? { if case .bool(let b)? = v { return b } else { return nil } }
    var array: [J] { if case .array(let a)? = v { return a.map(J.init) } else { return [] } }
    var exists: Bool { if case .null? = v { return false } else { return v != nil } }
}

private struct Row: Identifiable { var id: String; var j: J }
private func rows(_ list: [J], key: String = "id") -> [Row] { list.enumerated().map { Row(id: $0.element[key].string ?? "\($0.offset)", j: $0.element) } }

private func bytes(_ n: Double?) -> String { n.map { ByteCountFormatter.string(fromByteCount: Int64($0), countStyle: .file) } ?? "…" }
private func when(_ ms: Double?) -> String {
    guard let ms else { return "Never" }
    return RelativeDateTimeFormatter().localizedString(for: Date(timeIntervalSince1970: ms / 1000), relativeTo: Date())
}

struct AccountMoreSettings: View {
    let model: MacSettingsModel
    let section: MacSettingsSection

    var body: some View {
        switch section {
        case .privacy: PrivacySettings(model: model, workspace: nil)
        case .workspacePrivacy: PrivacySettings(model: model, workspace: model.workspace)
        case .billing: BillingSettings(model: model)
        case .workspaceBilling: WorkspaceBillingSettings(model: model)
        case .connectedApps: ConnectedAppsSettings(model: model)
        case .workspace: WorkspaceGeneralSettings(model: model)
        case .members: MembersSettings(model: model)
        case .workspaceGuests: GuestsSettings(model: model)
        default: EmptyView()
        }
    }
}

// MARK: Privacy

private struct PrivacySettings: View {
    let model: MacSettingsModel
    let workspace: SpaceInfo?
    var body: some View {
        let space = workspace ?? model.session?.spaces.first { $0.kind == .personal }
        VStack(alignment: .leading, spacing: 20) {
            SMuted(workspace == nil ? "Choose how much of your Personal space Folevi's servers can read. Workspaces have their own setting, chosen by their admins." : "Choose how much of \(workspace!.name) Folevi's servers can read. Owners and admins change it; members see it here.")
                .frame(maxWidth: 560, alignment: .leading)
            SettingsCard("End-to-end encryption", description: space?.encrypted == true ? "This space is end-to-end encrypted: its notes are locked on your devices, and Folevi's servers can't read them." : "Notes here are encrypted in transit and at rest. Turn on end-to-end encryption so only your devices can read them.") {
                VStack(alignment: .leading, spacing: 12) {
                    SettingsTerms(rows: [("Level", space?.encrypted == true ? "End-to-end encrypted" : "Standard", nil), ("Status", space?.locked == true ? "Locked on this Mac" : "Open on this Mac", nil)])
                    if space?.canLock == true || workspace == nil {
                        WebButton(space?.encrypted == true ? "Lock a folder…" : "Turn on end-to-end encryption…") { model.frame.open(.web(workspace == nil ? "/settings/privacy" : "/settings/workspace-privacy")); model.frame.toast("Choose a folder and Lock it from its menu, or set encryption up when Folevi asks.") }
                    }
                }
            }
        }
    }
}

// MARK: Plan & billing

private struct BillingSettings: View {
    let model: MacSettingsModel
    var body: some View {
        let d = model.details.value
        let b = J(model.convex("billing.mine").value?.data)
        VStack(alignment: .leading, spacing: 20) {
            SettingsCard("Your plan") {
                VStack(alignment: .leading, spacing: 16) {
                    SettingsTerms(rows: [
                        ("Plan", d?.plan.map { $0.trialing ? "Free trial of \(MacSettingsModel.tier($0.tier))" : MacSettingsModel.tier($0.tier) } ?? "…", nil),
                        ("Storage", "\(bytes(b["storageUsedBytes"].number)) of \(b["storageLimitBytes"].number.map { bytes($0) } ?? "unlimited")", nil),
                        ("Devices", d?.devicesActive.map { n in d?.deviceLimit.map { "\(n) of \($0)" } ?? "\(n)" } ?? "…", nil),
                    ])
                    SettingsButtons {
                        if d?.plan?.paid == true { WebButton("Manage billing…") { Task { await openURL("billing.portal") } } }
                        WebButton("See plans…", variant: d?.plan?.paid == true ? .secondary : .primary) { if let u = URL(string: "https://folevi.com/settings/billing") { model.frame.host?.frameOpenExternal(u) } }
                    }
                }
            }
            if !b["payments"].array.isEmpty {
                SettingsCard("Billing history") {
                    SettingsDivided(rows(b["payments"].array), gap: 10, line: "row") { r in
                        HStack {
                            SText(r.j["description"].string ?? r.j["label"].string ?? "Payment", "row.label").frame(maxWidth: .infinity, alignment: .leading)
                            SText(when(r.j["at"].number ?? r.j["createdAt"].number), "row.hint")
                        }
                    }
                }
            }
        }
    }

    private func openURL(_ fn: String) async {
        if let r = await model.mutate(fn, [:], action: true), let s = J(r)["url"].string, let u = URL(string: s) { NSWorkspace.shared.open(u) }
    }
}

extension MacSettingsModel {
    static func tier(_ t: String) -> String {
        switch t {
        case "free", "core": "Core"
        case "pro": "Pro"
        case "proAi", "pro_ai": "Pro AI"
        default: t.capitalized
        }
    }
}

private struct WorkspaceBillingSettings: View {
    let model: MacSettingsModel
    var body: some View {
        if let w = model.workspace {
            let s = J(model.convex("workspaceBilling.summary", ["workspaceId": .string(w.id)]).value?.data)
            SettingsCard("Workspace plan") {
                VStack(alignment: .leading, spacing: 16) {
                    SettingsTerms(rows: [("Plan", s["planName"].string ?? s["plan"]["name"].string ?? "…", nil), ("Members", s["seats"]["billable"].number.map { "\(Int($0)) billable seats" } ?? "…", nil)])
                    WebButton("Manage billing…") {
                        Task { if let r = await model.mutate("workspaceBilling.portal", ["workspaceId": .string(w.id)], action: true), let u = J(r)["url"].string.flatMap(URL.init(string:)) { NSWorkspace.shared.open(u) } }
                    }
                }
            }
        }
    }
}

// MARK: Connected apps

private struct ConnectedAppsSettings: View {
    let model: MacSettingsModel
    @State private var tokenName = ""
    @State private var hookURL = ""
    @State private var shown: String?
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let grants = J(model.convex("mcp.listGrants").value?.data)
        let tokens = J(model.convex("apiTokens.list").value?.data)
        let hooks = J(model.convex("webhooks.list").value?.data)
        VStack(alignment: .leading, spacing: 20) {
            SettingsCard("Connected apps", description: "Disconnecting stops an app at once; it has to ask again to come back. Everything an app changes is in the note’s version history.") {
                let list = grants.array.isEmpty ? grants["grants"].array : grants.array
                if list.isEmpty { SMuted("No apps are connected.") } else {
                    SettingsDivided(rows(list), gap: 10, line: "row") { r in
                        HStack(spacing: 12) {
                            VStack(alignment: .leading, spacing: 0) {
                                SText(r.j["name"].string ?? "App", "row.label")
                                SText("\(r.j["canWrite"].bool == true ? "Reads and writes" : "Reads") · Connected \(when(r.j["connectedAt"].number))", "row.hint")
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            WebButton("Disconnect", size: .sm) { Task { await model.mutate("mcp.revokeGrant", ["grantId": .string(r.id)], done: "Disconnected") } }
                        }
                    }
                }
            }
            SettingsCard("API tokens", description: "Tokens let your own scripts and tools use Folevi's API as you. Treat one like a password: it's shown once.") {
                VStack(alignment: .leading, spacing: 12) {
                    let list = tokens.array.isEmpty ? tokens["tokens"].array : tokens.array
                    if !list.isEmpty {
                        SettingsDivided(rows(list), gap: 10, line: "row") { r in
                            HStack(spacing: 12) {
                                VStack(alignment: .leading, spacing: 0) {
                                    SText(r.j["name"].string ?? "Token", "row.label")
                                    SText("\(r.j["hint"].string.map { "…\($0) · " } ?? "")Last used \(when(r.j["lastUsedAt"].number).lowercased())", "row.hint")
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                WebButton("Revoke", variant: .ghost, size: .sm) {
                                    settingsConfirm("Revoke \(r.j["name"].string ?? "this token")?", message: "Anything using it stops working at once.", confirm: "Revoke", in: NSApp.keyWindow) {
                                        Task { await model.mutate("apiTokens.revoke", ["tokenId": .string(r.id)], done: "Token revoked") }
                                    }
                                }
                            }
                        }
                    }
                    HStack(spacing: 8) {
                        SettingsField(placeholder: "Token name", text: $tokenName)
                        WebButton("Create token") { createToken() }.disabled(tokenName.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                    .frame(maxWidth: 448)
                    if let shown {
                        HStack(spacing: 8) {
                            Text(shown).font(WebFont.font(.mono, size: 12)).textSelection(.enabled).lineLimit(1).truncationMode(.middle)
                            WebButton("Copy", icon: .copy, size: .sm) { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(shown, forType: .string) }
                        }
                        SText("Copy it now: it isn't shown again.", "row.hint")
                    }
                }
            }
            SettingsCard("Webhooks", description: "Folevi posts to your address when notes or tasks change, signed so you can check it's Folevi.") {
                VStack(alignment: .leading, spacing: 12) {
                    let list = hooks.array.isEmpty ? hooks["webhooks"].array : hooks.array
                    if !list.isEmpty {
                        SettingsDivided(rows(list), gap: 10, line: "row") { r in
                            HStack(spacing: 12) {
                                SText(r.j["url"].string ?? r.j["name"].string ?? "Webhook", "row.label", lines: 1).frame(maxWidth: .infinity, alignment: .leading)
                                SettingsSwitch(isOn: r.j["enabled"].bool ?? true, label: "Enabled") { on in Task { await model.mutate("webhooks.setEnabled", ["webhookId": .string(r.id), "enabled": .bool(on)], done: "Saved") } }
                                WebButton("Send test", size: .sm) { Task { await model.mutate("webhooks.sendTest", ["webhookId": .string(r.id)], done: "Test sent") } }
                                WebButton("Remove", variant: .ghost, size: .sm) { Task { await model.mutate("webhooks.remove", ["webhookId": .string(r.id)], done: "Removed") } }
                            }
                        }
                    }
                    HStack(spacing: 8) {
                        SettingsField(placeholder: "https://example.com/hooks/folevi", text: $hookURL)
                        WebButton("Add webhook") { addHook() }.disabled(!hookURL.hasPrefix("https://"))
                    }
                    .frame(maxWidth: 448)
                }
            }
        }
    }

    private func createToken() {
        let name = tokenName.trimmingCharacters(in: .whitespaces)
        Task {
            if let r = await model.mutate("apiTokens.create", ["name": .string(name), "scopes": .array([.string("notes:read"), .string("notes:write"), .string("tasks:read"), .string("tasks:write")]), "personal": .bool(true), "workspaceIds": .array([]), "expiresInDays": .null]) {
                shown = J(r)["token"].string ?? J(r)["value"].string
                tokenName = ""
            }
        }
    }

    private func addHook() {
        Task {
            if await model.mutate("webhooks.create", ["url": .string(hookURL), "events": .array([.string("note.updated"), .string("task.updated")]), "personal": .bool(true), "workspaceIds": .array([])], done: "Webhook added") != nil { hookURL = "" }
        }
    }
}

// MARK: the workspace

private struct WorkspaceGeneralSettings: View {
    let model: MacSettingsModel
    @State private var name: String?

    var body: some View {
        if let w = model.workspace {
            let role = w.role == "owner" ? "the owner" : w.role == "admin" ? "an admin" : "a member"
            VStack(alignment: .leading, spacing: 20) {
                SettingsCard("Workspace", description: "You're \(role) of this workspace.") {
                    VStack(alignment: .leading, spacing: 16) {
                        SettingsLabelled(label: "Name") {
                            SettingsField(placeholder: "", text: Binding(get: { name ?? w.name }, set: { name = $0 })).disabled(!w.canManage)
                        }
                        if w.canManage { WebButton("Save", variant: .primary) { Task { await model.mutate("workspaces.rename", ["workspaceId": .string(w.id), "name": .string((name ?? w.name).trimmingCharacters(in: .whitespaces))], done: "Saved") } } }
                    }
                    .frame(maxWidth: 448, alignment: .leading)
                }
                if w.role == "owner" {
                    SettingsCard("Leave workspace", description: "You own this workspace, so you can’t leave it. Make another member the owner first (Members → Make owner), or delete the workspace below.") { EmptyView() }
                    SettingsCard("Delete workspace", description: "Deletes this workspace and everything in it (pages, folders, tasks, files and comments) for everyone, after a 7-day grace period. Export it first if you want to keep it.") {
                        WebButton("Delete workspace…", variant: .danger) {
                            settingsConfirm("Delete \(w.name)?", message: "It's deleted for everyone after 7 days. Until then you can cancel.", confirm: "Delete workspace", in: NSApp.keyWindow) {
                                Task { await model.mutate("workspaces.scheduleDeletion", ["workspaceId": .string(w.id)], done: "Deletion scheduled") }
                            }
                        }
                    }
                } else {
                    SettingsCard("Leave workspace", description: "You’ll lose access to its pages, folders and tasks. Pages you wrote stay in the workspace. Your Personal isn’t affected.") {
                        WebButton("Leave workspace…", variant: .danger) {
                            settingsConfirm("Leave \(w.name)?", message: nil, confirm: "Leave", in: NSApp.keyWindow) {
                                Task { await model.mutate("workspaces.removeMember", ["workspaceId": .string(w.id), "profileId": .string(model.session?.profile.id ?? "")], done: "You left the workspace") }
                            }
                        }
                    }
                }
            }
        }
    }
}

private struct MembersSettings: View {
    let model: MacSettingsModel
    @State private var email = ""
    @State private var role = "member:edit"
    private static let roles: [SettingsSelect.Option] = [.init(value: "admin", label: "Admin"), .init(value: "member:edit", label: "Member"), .init(value: "member:comment", label: "Can comment"), .init(value: "member:view", label: "Can view")]

    /// "admin", or "member:<access>" as role and memberAccess (MembersSection.tsx `setChoice`).
    static func roleArgs(_ choice: String) -> [String: JSONValue] {
        choice == "admin" ? ["role": .string("admin")] : ["role": .string("member"), "memberAccess": .string(String(choice.dropFirst("member:".count)))]
    }

    var body: some View {
        if let w = model.workspace {
            let d = J(model.convex("workspaces.members", ["workspaceId": .string(w.id)]).value?.data)
            VStack(alignment: .leading, spacing: 20) {
                if w.canManage {
                    SettingsCard("Invite people", description: "Members can open everything in this workspace that isn't restricted. Invitations are tied to the email address you enter and expire after 7 days.") {
                        HStack(spacing: 8) {
                            SettingsField(placeholder: "name@example.com", text: $email) { invite(w) }
                            SettingsSelect(options: Self.roles, value: role, width: 144) { role = $0 }
                            WebButton("Invite", variant: .primary) { invite(w) }.disabled(!email.contains("@"))
                        }
                        .settingsRowWidth(576, alignment: .center)
                    }
                }
                SettingsCard("Members") {
                    SettingsDivided(rows(d["members"].array, key: "profileId"), gap: 10, line: "row") { r in
                        HStack(spacing: 12) {
                            VStack(alignment: .leading, spacing: 0) {
                                SText("\(r.j["displayName"].string ?? r.j["name"].string ?? "")\(r.j["isYou"].bool == true ? " (you)" : "")", "row.label")
                                SText(r.j["email"].string ?? "", "row.hint")
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            if w.canManage, r.j["role"].string != "owner", r.j["isYou"].bool != true {
                                SettingsSelect(options: Self.roles, value: r.j["role"].string == "admin" ? "admin" : "member:\(r.j["memberAccess"].string ?? "edit")", width: 144) { v in
                                    Task { await model.mutate("workspaces.changeRole", ["workspaceId": .string(w.id), "profileId": .string(r.id)].merging(Self.roleArgs(v)) { a, _ in a }, done: "Saved") }
                                }
                                WebButton("Remove", variant: .ghost, size: .sm) {
                                    settingsConfirm("Remove \(r.j["displayName"].string ?? "them")?", message: "They lose access to this workspace at once.", confirm: "Remove", in: NSApp.keyWindow) {
                                        Task { await model.mutate("workspaces.removeMember", ["workspaceId": .string(w.id), "profileId": .string(r.id)], done: "Removed") }
                                    }
                                }
                            } else {
                                SText((r.j["role"].string ?? "").capitalized, "row.hint")
                            }
                        }
                    }
                }
                if !d["invites"].array.isEmpty {
                    SettingsCard("Invitations") {
                        SettingsDivided(rows(d["invites"].array), gap: 10, line: "row") { r in
                            HStack {
                                SText(r.j["email"].string ?? "", "row.label").frame(maxWidth: .infinity, alignment: .leading)
                                SText(r.j["expired"].bool == true ? "Expired" : (r.j["role"].string ?? "").capitalized, "row.hint")
                                if w.canManage { WebButton("Revoke", variant: .ghost, size: .sm) { Task { await model.mutate("workspaces.revokeInvite", ["inviteId": .string(r.id)], done: "Invitation revoked") } } }
                            }
                        }
                    }
                }
            }
        }
    }

    private func invite(_ w: SpaceInfo) {
        let e = email.trimmingCharacters(in: .whitespaces)
        guard e.contains("@") else { return }
        Task { if await model.mutate("workspaces.invite", ["workspaceId": .string(w.id), "email": .string(e)].merging(Self.roleArgs(role)) { a, _ in a }, done: "Invitation sent") != nil { email = "" } }
    }
}

private struct GuestsSettings: View {
    let model: MacSettingsModel
    var body: some View {
        if let w = model.workspace {
            let d = J(model.convex("workspaces.guests", ["workspaceId": .string(w.id)]).value?.data)
            let list = d.array.isEmpty ? d["guests"].array : d.array
            SettingsCard("Guests", description: "People outside the workspace with access to some of its pages. Guests are free and never take a seat.") {
                if list.isEmpty { SMuted("No guests.") } else {
                    SettingsDivided(rows(list, key: "profileId"), gap: 10, line: "row") { r in
                        HStack(spacing: 12) {
                            VStack(alignment: .leading, spacing: 0) {
                                SText(r.j["displayName"].string ?? "", "row.label")
                                SText("\(r.j["email"].string ?? "") · \(r.j["pages"].array.count) \(r.j["pages"].array.count == 1 ? "page" : "pages")", "row.hint")
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            WebButton("Make member", size: .sm) { Task { await model.mutate("workspaces.convertGuestToMember", ["workspaceId": .string(w.id), "profileId": .string(r.id)], done: "Now a member") } }
                            WebButton("Remove", variant: .ghost, size: .sm) { Task { await model.mutate("workspaces.removeGuest", ["workspaceId": .string(w.id), "profileId": .string(r.id)], done: "Removed") } }
                        }
                    }
                }
            }
        }
    }
}
#endif
