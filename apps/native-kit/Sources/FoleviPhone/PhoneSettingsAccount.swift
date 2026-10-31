// Settings' sections an account has, on the iPhone: Account, AI, Plan & billing (the plan only: no buying in the
// app), Security, Privacy, Devices, Connected apps, Notifications, Offline & sync, and the open workspace's General,
// Members, Privacy, Guests, Plan & billing. Drawn with the iPhone's Settings kit from the engine's settings views and
// the Convex allowlist (viewsSettings.ts), in the words the web's sections use.
#if os(iOS)
import SwiftUI
import FoleviDesign
import FoleviEngine
import FoleviScreens

/// A JSON value read by path (`settings.query`'s Convex answers).
struct JV {
    let v: JSONValue?
    init(_ v: JSONValue?) { self.v = v }
    subscript(_ k: String) -> JV { if case .object(let o)? = v { return JV(o[k]) } else { return JV(nil) } }
    var string: String? { if case .string(let s)? = v { return s } else { return nil } }
    var number: Double? { if case .number(let n)? = v { return n } else { return nil } }
    var bool: Bool? { if case .bool(let b)? = v { return b } else { return nil } }
    var array: [JV] { if case .array(let a)? = v { return a.map(JV.init) } else { return [] } }
}

private struct JRow: Identifiable {
    let id: String
    let j: JV
}

private func jrows(_ list: [JV], key: String = "id") -> [JRow] { list.enumerated().map { JRow(id: $0.element[key].string ?? "\($0.offset)", j: $0.element) } }
private func bytes(_ n: Double?) -> String { n.map { ByteCountFormatter.string(fromByteCount: Int64($0), countStyle: .file) } ?? "…" }
private func ago(_ ms: Double?) -> String {
    guard let ms else { return "" }
    return RelativeDateTimeFormatter().localizedString(for: Date(timeIntervalSince1970: ms / 1000), relativeTo: ScreenClock.now())
}
private func tier(_ t: String) -> String {
    switch t {
    case "free", "core": "Core"
    case "pro": "Pro"
    case "proAi", "pro_ai": "Pro AI"
    default: t.capitalized
    }
}

struct PhoneAccountSettings: View {
    let model: PhoneSettingsModel
    let host: PhoneSettingsHost
    let section: PhoneSettingsSection
    let screen: String?
    @State private var draft = ""
    @State private var zoneFilter = ""
    @State private var invite = ""
    @Environment(\.colorScheme) private var scheme

    /// A pushed screen's title in these sections.
    static func title(_ section: PhoneSettingsSection, screen: String) -> String? {
        switch screen {
        case "name": "Name"
        case "time-zone": "Time zone"
        case "digest": "Comment emails"
        case "workspace-name": "Name"
        case "invite": "Invite people"
        default: nil
        }
    }

    var body: some View {
        switch section {
        case .account: account
        case .ai: ai
        case .billing: billing
        case .security: security
        case .privacy: privacy(workspace: nil)
        case .workspacePrivacy: privacy(workspace: model.workspace)
        case .devices: devices
        case .connectedApps: connectedApps
        case .notifications: notifications
        case .sync: sync
        case .workspace: workspaceGeneral
        case .members, .workspaceGuests: members(guests: section == .workspaceGuests)
        case .workspaceBilling: workspaceBilling
        default: EmptyView()
        }
    }

    private func go(_ screen: String) { model.open("/settings/\(section.rawValue)?screen=\(screen)") }

    // MARK: Account

    @ViewBuilder private var account: some View {
        let a = model.account.value
        switch screen {
        case "name":
            PhoneSettingsGroup(footer: "How your name shows to people you share with.") {
                TextField("Your name", text: $draft)
                    .font(Font(PhoneType.body().ctFont))
                    .submitLabel(.done)
                    .onSubmit(saveName)
                    .padding(.horizontal, 16)
                    .frame(minHeight: 52)
                    .onAppear { draft = a?.name ?? "" }
            }
            PhoneSettingsGroup { PhoneSettingsRow("Save", disabled: draft.trimmingCharacters(in: .whitespaces).isEmpty, action: saveName) }
        case "time-zone":
            let zones = TimeZone.knownTimeZoneIdentifiers.filter { zoneFilter.isEmpty || $0.localizedCaseInsensitiveContains(zoneFilter) }
            PhoneSearchField("Search", text: $zoneFilter)
            PhoneSettingsChoiceList(label: "Time zone", value: a?.timeZone ?? "", choices: zones.prefix(200).map { PhoneSettingsChoice(value: $0, label: $0.replacingOccurrences(of: "_", with: " ")) }) { z in
                Task { await model.perform(.settingsUpdate(timeZone: z), done: "Saved") }
            }
        default:
            PhoneSettingsGroup("Profile") {
                PhoneSettingsRow("Name", value: a?.name ?? "…", chevron: true, action: { go("name") })
                PhoneSettingsRow("Email", value: a?.email ?? "…")
                PhoneSettingsRow("Time zone", value: (a?.timeZone ?? "…").replacingOccurrences(of: "_", with: " "), chevron: true, action: { go("time-zone") })
            }
            PhoneSettingsGroup(footer: "Deletes your account, your Personal and everything in it after a 7-day grace period, along with workspaces you own. Sign in during those 7 days to cancel.") {
                PhoneSettingsDestructiveRow(label: "Delete account", confirm: "Delete account", message: "Your account and everything in it are deleted after 7 days.") {
                    Task { await model.mutate("users.requestAccountDeletion", done: "Deletion scheduled") }
                }
            }
        }
    }

    private func saveName() {
        let n = draft.trimmingCharacters(in: .whitespaces)
        guard !n.isEmpty else { return }
        Task { await model.perform(.settingsUpdate(name: n), done: "Saved") }
    }

    // MARK: AI

    private struct Pref { var key: AiPrefKey, label: String, body: String, on: String, off: String }
    private static let prefs: [Pref] = [
        Pref(key: .memory, label: "Memory", body: "Let Foli AI remember things you approve, like the tone you like or words you use.", on: "Memory turned on", off: "Memory turned off"),
        Pref(key: .suggestions, label: "Suggestions", body: "Quiet hints at the end of a note, such as related notes, possible duplicates, open questions and action items. They're found without sending anything to AI.", on: "Suggestions turned on", off: "Suggestions turned off"),
        Pref(key: .attachments, label: "Read attachments", body: "Let Foli AI read files you add to a question, such as PDFs, images, text and spreadsheets. Files are only read when you send them.", on: "Attachments turned on", off: "Attachments turned off"),
        Pref(key: .webResearch, label: "Web research", body: "Let Foli AI search the web and read pages you link when you ask it to, with links to what it found.", on: "Web research turned on", off: "Web research turned off"),
        Pref(key: .digests, label: "Digests", body: "A daily or weekly summary of what changed in your notes, saved as a note in your Inbox. It uses your AI credits and is never emailed.", on: "Digests turned on", off: "Digests turned off"),
        Pref(key: .deviceText, label: "Read text on your devices", body: "The words in your images and handwriting are read on the device, so search finds them. Nothing is sent anywhere.", on: "Turned on", off: "Turned off"),
    ]

    private func pref(_ ai: AiSettings, _ k: AiPrefKey) -> Bool {
        switch k {
        case .history: ai.history
        case .memory: ai.memory
        case .suggestions: ai.suggestions
        case .attachments: ai.attachments
        case .webResearch: ai.webResearch
        case .digests: ai.digests
        case .readImages: ai.readImages
        case .deviceText: ai.deviceText
        }
    }

    @ViewBuilder private var ai: some View {
        if let a = model.ai.value {
            let core = !a.included
            PhoneSettingsGroup(footer: core ? "Foli AI comes with Pro AI." : "Foli AI helps you write, answers from your notes and sums them up. Nothing is sent while it's off.") {
                PhoneSettingsSwitchRow("Foli AI", on: a.enabled && !core, disabled: core, change: { on in
                    Task { await model.perform(.settingsUpdate(aiEnabled: on), done: on ? "Foli AI turned on" : "Foli AI turned off") }
                }) { PhoneRowIcon(.sparkles) }
            }
            PhoneSettingsGroup(footer: "Your AI conversations are saved so you can come back to them, rename, pin and search them. When this is off, a conversation is deleted as soon as you close it.") {
                PhoneSettingsSwitchRow("Keep conversations", on: a.history, change: { on in
                    Task { await model.perform(.settingsSetAiPref(key: .history, on: on), done: on ? "Conversations are kept" : "New conversations aren't kept") }
                }) { PhoneRowIcon(.messagesSquare) }
            }
            PhoneSettingsGroup("How Foli AI works for you") {
                ForEach(Self.prefs, id: \.key) { p in
                    PhoneSettingsRow(p.label, description: p.body) {
                        EmptyView()
                    } trailing: {
                        PhoneSettingsSwitch(label: p.label, on: pref(a, p.key), disabled: core && p.key != .deviceText) { on in
                            Task { await model.perform(.settingsSetAiPref(key: p.key, on: on), done: on ? p.on : p.off) }
                        }
                    }
                }
            }
        }
    }

    // MARK: Plan & billing (the plan as it is: no prices or upgrade links in the app)

    @ViewBuilder private var billing: some View {
        let d = model.details.value
        let b = JV(model.convex("billing.mine").value?.data)
        PhoneSettingsGroup("Your plan", footer: "Plans are changed on the web, at folevi.com.") {
            PhoneSettingsRow("Plan", value: d?.plan.map { $0.trialing ? "Free trial of \(tier($0.tier))" : tier($0.tier) } ?? "…")
            PhoneSettingsRow("Storage", value: "\(bytes(b["storageUsedBytes"].number)) of \(b["storageLimitBytes"].number.map { bytes($0) } ?? "unlimited")")
            PhoneSettingsRow("Devices", value: d?.devicesActive.map { n in d?.deviceLimit.map { "\(n) of \($0)" } ?? "\(n)" } ?? "…")
        }
    }

    @ViewBuilder private var workspaceBilling: some View {
        if let w = model.workspace {
            let s = JV(model.convex("workspaceBilling.summary", ["workspaceId": .string(w.id)]).value?.data)
            PhoneSettingsGroup("Workspace plan", footer: "Plans are changed on the web, at folevi.com.") {
                PhoneSettingsRow("Plan", value: s["planName"].string ?? s["plan"]["name"].string ?? "…")
                PhoneSettingsRow("Members", value: s["seats"]["billable"].number.map { "\(Int($0)) billable seats" } ?? "…")
            }
        }
    }

    // MARK: Security

    private static func methodName(_ m: String) -> String {
        switch m {
        case "password", "email": "Email and password"
        case "apple": "Apple"
        case "google": "Google"
        case "passkey": "Passkey"
        default: m.capitalized
        }
    }

    @ViewBuilder private var security: some View {
        let s = model.security.value
        PhoneSettingsGroup("Sign-in methods", footer: "The ways you can sign in to Folevi.") {
            ForEach(s?.methods ?? [], id: \.self) { m in PhoneSettingsRow(Self.methodName(m)) }
        }
        PhoneSettingsGroup(footer: "A code from an authenticator app when you sign in with your password.") {
            PhoneSettingsRow("Two-step verification", value: s?.twoFactor == true ? "On" : "Off", chevron: true, action: { host.openURL(URL(string: "https://app.folevi.com/settings/security")!) })
        }
        PhoneSettingsGroup("Passkeys", footer: "Sign in with Face ID or your device's lock instead of a password.") {
            if (s?.passkeys ?? []).isEmpty { PhoneSettingsText(text: "No passkeys yet.", muted: true) }
            ForEach(s?.passkeys ?? [], id: \.id) { p in
                PhoneSettingsRow(p.name, description: p.lastUsedAt.map { "Last used \(ago($0))" }) { PhoneRowIcon(.keyRound) }
            }
        }
    }

    // MARK: Privacy

    @ViewBuilder private func privacy(workspace: SpaceInfo?) -> some View {
        let space = workspace ?? model.session.value?.spaces.first { $0.kind == .personal }
        PhoneSettingsGroup("End-to-end encryption", footer: space?.encrypted == true ? "This space is end-to-end encrypted: its notes are locked on your devices, and Folevi's servers can't read them." : "Notes here are encrypted in transit and at rest. Lock a folder to encrypt it end to end.") {
            PhoneSettingsRow("Level", value: space?.encrypted == true ? "End-to-end encrypted" : "Standard")
            PhoneSettingsRow("Status", value: space?.locked == true ? "Locked on this iPhone" : "Open on this iPhone")
        }
        PhoneSettingsText(text: workspace == nil ? "Choose how much of your Personal space Folevi's servers can read. Workspaces have their own setting, chosen by their admins." : "Choose how much of \(workspace!.name) Folevi's servers can read. Owners and admins change it.", muted: true)
    }

    // MARK: Devices

    @ViewBuilder private var devices: some View {
        let d = model.details.value
        let sessions = model.security.value?.sessions ?? []
        PhoneSettingsGroup("Connected devices") {
            PhoneSettingsRow("Devices connected", value: d?.devicesActive.map { n in d?.deviceLimit.map { "\(n) of \($0)" } ?? "\(n)" } ?? "…")
        }
        PhoneSettingsGroup("Signed in", footer: "Browsers and apps signed in to your account. Signing a device out ends its session right away.") {
            ForEach(sessions, id: \.id) { s in
                if s.current {
                    PhoneSettingsRow(s.label, description: "This device · \(s.client)") { PhoneRowIcon(.smartphone) }
                } else {
                    PhoneSettingsRow(s.label, description: "\(s.client) · Last active \(ago(s.lastSeenAt))") {
                        PhoneRowIcon(.monitorSmartphone)
                    } trailing: {
                        Button("Sign out") { Task { await model.perform(.sessionRevoke(id: s.id), done: "Signed out") } }
                            .webText(PhoneType.body())
                            .foregroundStyle(FoleviTokens.Chrome.destructive.resolve(scheme).color)
                    }
                }
            }
        }
    }

    // MARK: Connected apps

    @ViewBuilder private var connectedApps: some View {
        let grants = JV(model.convex("mcp.listGrants").value?.data)
        let tokens = JV(model.convex("apiTokens.list").value?.data)
        let hooks = JV(model.convex("webhooks.list").value?.data)
        PhoneSettingsGroup("Connected apps", footer: "Disconnecting stops an app at once; it has to ask again to come back.") {
            if grants.array.isEmpty { PhoneSettingsText(text: "No apps connected.", muted: true) }
            ForEach(jrows(grants.array)) { r in
                PhoneSettingsDestructiveRow(label: "Disconnect \(r.j["clientName"].string ?? r.j["name"].string ?? "app")", confirm: "Disconnect") {
                    Task { await model.mutate("mcp.revokeGrant", ["grantId": .string(r.id)], done: "Disconnected") }
                }
            }
        }
        PhoneSettingsGroup("API tokens", footer: "Tokens let your own scripts and tools use Folevi's API as you. Make them on the web.") {
            if tokens.array.isEmpty { PhoneSettingsText(text: "No tokens.", muted: true) }
            ForEach(jrows(tokens.array)) { r in
                PhoneSettingsRow(r.j["name"].string ?? "Token", description: r.j["lastUsedAt"].number.map { "Last used \(ago($0))" })
            }
        }
        PhoneSettingsGroup("Webhooks", footer: "Folevi posts to your address when notes or tasks change.") {
            if hooks.array.isEmpty { PhoneSettingsText(text: "No webhooks.", muted: true) }
            ForEach(jrows(hooks.array)) { r in
                PhoneSettingsRow(r.j["url"].string ?? "Webhook") {
                    EmptyView()
                } trailing: {
                    PhoneSettingsSwitch(label: "Enabled", on: r.j["enabled"].bool ?? true) { on in
                        Task { await model.mutate("webhooks.setEnabled", ["webhookId": .string(r.id), "enabled": .bool(on)], done: "Saved") }
                    }
                }
            }
        }
    }

    // MARK: Notifications

    @ViewBuilder private var notifications: some View {
        let n = model.notifications.value
        if screen == "digest" {
            PhoneSettingsChoiceList(label: "Comment emails", value: n?.digest ?? "off", choices: [PhoneSettingsChoice(value: "off", label: "As they happen"), PhoneSettingsChoice(value: "daily", label: "In a daily digest")], footer: "The daily digest lists what you haven't read yet, by page title only, once a day.") { v in
                Task { await model.perform(.settingsSetNotificationEmails(digest: NotificationEmailsArgs.Digest(rawValue: v)), done: "Saved") }
            }
        } else {
            ForEach(n?.topics ?? [], id: \.id) { t in
                PhoneSettingsGroup(t.label, footer: t.hint) {
                    PhoneSettingsSwitchRow("In the app", on: t.inApp, change: { on in Task { await model.perform(.settingsSetNotificationTopic(topic: t.id, inApp: on), done: "Saved") } }) { EmptyView() }
                    PhoneSettingsSwitchRow("By email", on: t.email, change: { on in Task { await model.perform(.settingsSetNotificationTopic(topic: t.id, email: on), done: "Saved") } }) { EmptyView() }
                }
            }
            PhoneSettingsGroup("Email delivery", footer: "Shares, invitations and access changes are always sent as they happen.") {
                PhoneSettingsRow("Comment emails", value: n?.digest == "daily" ? "In a daily digest" : "As they happen", chevron: true, action: { go("digest") })
            }
        }
    }

    // MARK: Offline & sync

    @ViewBuilder private var sync: some View {
        let s = model.devices
        PhoneSettingsGroup("This iPhone", footer: "Folevi keeps your recent notes and every unsent change on this iPhone, so you can keep writing offline and nothing is lost.") {
            PhoneSettingsRow("Connection", value: model.session.value?.online == false ? "Offline" : "Online")
            PhoneSettingsRow("Changes waiting to sync", value: "\(s.value?.waiting ?? 0)")
            PhoneSettingsRow("Notes kept", value: s.value?.notesKept.map(String.init) ?? "…")
            PhoneSettingsRow("Space used", value: s.value?.usedBytes.map { bytes(Double($0)) } ?? "…")
        }
        PhoneSettingsGroup(footer: "Every note and its attachments stay on this iPhone, so all of them open offline.") {
            PhoneSettingsSwitchRow("Keep all notes on this iPhone", on: s.value?.keepAll ?? false, disabled: s.value?.available == false, change: { on in
                Task { await model.perform(.deviceKeepAll(on: on), done: "Saved") }
            }) { PhoneRowIcon(.download) }
            PhoneSettingsRow("Download everything now", action: { Task { await model.perform(.deviceDownload) } })
            PhoneSettingsDestructiveRow(label: "Remove this iPhone's copy", confirm: "Remove", message: "Notes stay in your account. They download again when you open them.") {
                Task { await model.perform(.deviceRemoveCopy(force: true), done: "Removed") }
            }
        }
    }

    // MARK: Workspace

    @ViewBuilder private var workspaceGeneral: some View {
        if let w = model.workspace {
            if screen == "workspace-name" {
                PhoneSettingsGroup {
                    TextField("Workspace name", text: $draft)
                        .font(Font(PhoneType.body().ctFont))
                        .padding(.horizontal, 16)
                        .frame(minHeight: 52)
                        .onAppear { draft = w.name }
                }
                PhoneSettingsGroup {
                    PhoneSettingsRow("Save", disabled: draft.trimmingCharacters(in: .whitespaces).isEmpty, action: {
                        Task { await model.mutate("workspaces.rename", ["workspaceId": .string(w.id), "name": .string(draft)], done: "Saved") }
                    })
                }
            } else {
                PhoneSettingsGroup("Workspace", footer: "You're \(w.role == "owner" ? "the owner" : w.canManage ? "an admin" : "a member") of this workspace.") {
                    PhoneSettingsRow("Name", value: w.name, chevron: w.canManage, action: w.canManage ? { go("workspace-name") } : nil)
                }
                if w.role == "owner" {
                    PhoneSettingsGroup(footer: "Deletes this workspace and everything in it for everyone, after a 7-day grace period.") {
                        PhoneSettingsDestructiveRow(label: "Delete workspace", confirm: "Delete workspace") {
                            Task { await model.mutate("workspaces.scheduleDeletion", ["workspaceId": .string(w.id)], done: "Deletion scheduled") }
                        }
                    }
                } else {
                    PhoneSettingsGroup(footer: "You'll lose access to its pages, folders and tasks. Pages you wrote stay in the workspace.") {
                        PhoneSettingsDestructiveRow(label: "Leave workspace", confirm: "Leave") {
                            Task { await model.mutate("workspaces.removeMember", ["workspaceId": .string(w.id), "profileId": .string(model.session.value?.profile.id ?? "")], done: "You left the workspace") }
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder private func members(guests: Bool) -> some View {
        if let w = model.workspace {
            let d = JV(model.convex("workspaces.members", ["workspaceId": .string(w.id)]).value?.data)
            let people = jrows(d["members"].array, key: "profileId").filter { (($0.j["role"].string ?? "") == "guest") == guests }
            if screen == "invite" {
                PhoneSettingsGroup(footer: "Invitations are tied to the email address they're sent to.") {
                    TextField("Email", text: $invite)
                        .font(Font(PhoneType.body().ctFont))
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .padding(.horizontal, 16)
                        .frame(minHeight: 52)
                }
                PhoneSettingsGroup {
                    PhoneSettingsRow("Send invitation", disabled: !invite.contains("@"), action: {
                        Task {
                            if await model.mutate("workspaces.invite", ["workspaceId": .string(w.id), "email": .string(invite), "role": .string(guests ? "guest" : "member")], done: "Invitation sent") != nil { invite = "" }
                        }
                    })
                }
            } else {
                if w.canManage {
                    PhoneSettingsGroup {
                        PhoneSettingsRow(guests ? "Invite a guest" : "Invite people", chevron: true, action: { go("invite") }) { PhoneRowIcon(.userRoundPlus) }
                    }
                }
                PhoneSettingsGroup(guests ? "Guests" : "Members") {
                    if people.isEmpty { PhoneSettingsText(text: guests ? "No guests." : "No members yet.", muted: true) }
                    ForEach(people) { r in
                        let name = r.j["displayName"].string ?? r.j["email"].string ?? "Someone"
                        PhoneSettingsRow(r.j["isYou"].bool == true ? "\(name) (you)" : name, description: r.j["email"].string, value: (r.j["role"].string ?? "member").capitalized)
                    }
                }
            }
        }
    }
}

extension PhoneSettingsModel {
    /// This device's offline copy (Offline & sync).
    var devices: ValueStore<DeviceStorageValue> { storage }
}
#endif
