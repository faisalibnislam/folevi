// Settings (⌘,): a macOS 26 settings window with its sections in a sidebar, as System Settings. Every row is
// native (SF Pro, grouped forms) and writes through the engine; the few sections that are mostly web tables
// (connected apps, workspace data, exports, deleting the account) open in the window's page. Sections are named
// for what they hold (the owner's rule).
import FoleviDesign
import FoleviEngine
import ServiceManagement
import Sparkle
import SwiftUI

enum SettingsSection: String, CaseIterable, Identifiable, Hashable {
    case account, general, appearance, notifications, ai, security, privacy, appLock, offline, devices, workspace, connectedApps, data, billing, mac, updates, library, about
    var id: String { rawValue }

    var title: String {
        switch self {
        case .account: "Account"
        case .general: "General"
        case .appearance: "Appearance"
        case .notifications: "Notifications"
        case .ai: "Foli AI"
        case .security: "Security"
        case .privacy: "Privacy"
        case .appLock: "App Lock"
        case .offline: "Offline & Sync"
        case .devices: "Signed-in Devices"
        case .workspace: "Workspace"
        case .connectedApps: "Connected Apps"
        case .data: "Import & Export"
        case .billing: "Plan & Billing"
        case .mac: "This Mac"
        case .updates: "Updates"
        case .library: "Library"
        case .about: "About"
        }
    }

    var symbol: String {
        switch self {
        case .account: "person.crop.circle"
        case .general: "gearshape"
        case .appearance: "paintpalette"
        case .notifications: "bell.badge"
        case .ai: "sparkles"
        case .security: "lock"
        case .privacy: "hand.raised"
        case .appLock: "touchid"
        case .offline: "arrow.triangle.2.circlepath"
        case .devices: "laptopcomputer.and.iphone"
        case .workspace: "person.3"
        case .connectedApps: "app.connected.to.app.below.fill"
        case .data: "square.and.arrow.up.on.square"
        case .billing: "creditcard"
        case .mac: "desktopcomputer"
        case .updates: "arrow.down.circle"
        case .library: "externaldrive"
        case .about: "info.circle"
        }
    }

    /// The main app's icon for the section.
    var webIcon: WebIcon {
        switch self {
        case .account: .userRound
        case .general: .settings
        case .appearance: .palette
        case .notifications: .bell
        case .ai: .sparkles
        case .security: .lockKeyhole
        case .privacy: .shield
        case .appLock: .lock
        case .offline: .refreshCw
        case .devices: .monitorSmartphone
        case .workspace: .users
        case .connectedApps: .plug
        case .data: .fileUp
        case .billing: .creditCard
        case .mac: .laptop
        case .updates: .download
        case .library: .hardDrive
        case .about: .info
        }
    }

    /// A settings path's section ("/settings/ai" -> .ai).
    init?(path: String) {
        switch path {
        case "account", "profile": self = .account
        case "general": self = .general
        case "appearance": self = .appearance
        case "notifications": self = .notifications
        case "ai": self = .ai
        case "security": self = .security
        case "privacy": self = .privacy
        case "devices": self = .devices
        case "workspace", "members", "workspace-guests": self = .workspace
        case "connected-apps": self = .connectedApps
        case "data", "export", "import": self = .data
        case "billing": self = .billing
        case "offline", "sync": self = .offline
        case "lock", "app-lock": self = .appLock
        case "desktop", "mac": self = .mac
        case "updates": self = .updates
        case "library": self = .library
        case "about": self = .about
        default: return nil
        }
    }
}

/// Opens Settings at a section (links to /settings/..., Foli AI's "turn this on", menus).
@MainActor
@Observable
final class SettingsRouter {
    static let shared = SettingsRouter()
    /// The section shown, remembered between launches (General the first time).
    var section: SettingsSection = SettingsSection(rawValue: UserDefaults.standard.string(forKey: "settings.section") ?? "") ?? .general {
        didSet { UserDefaults.standard.set(section.rawValue, forKey: "settings.section") }
    }
    @ObservationIgnored var openSettings: (() -> Void)?

    func open(_ path: String?) {
        if let path, let s = SettingsSection(path: path) { section = s }
        if let openSettings { openSettings() } else { NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil) }
        NSApp.activate()
    }
}

struct SettingsView: View {
    private var app: AppModel { .shared }
    @Bindable private var router = SettingsRouter.shared

    private var local: Bool { app.session.value?.mode == .local }

    /// Today's order: General first, then the account's sections; a library on this Mac has fewer.
    private var sections: [SettingsSection] {
        local
            ? [.general, .library, .ai, .appearance, .data, .appLock, .mac, .updates]
            : [.general, .mac, .account, .ai, .billing, .security, .privacy, .notifications, .appearance, .appLock, .offline, .devices, .connectedApps, .data, .updates]
    }

    private var workspaceName: String? {
        guard !local, let s = app.currentSpace, s.kind == .workspace else { return nil }
        return s.name
    }

    /// The section asked for, or Library (a library on this Mac) or the first one when this mode lacks it.
    private var shown: SettingsSection {
        let all = sections + (workspaceName == nil ? [] : [.workspace]) + [.about]
        if all.contains(router.section) { return router.section }
        return local ? .library : sections[0]
    }

    @State private var query = ""
    @FocusState private var searching: Bool

    var body: some View {
        NavigationSplitView {
            List(selection: Binding(get: { shown }, set: { if let s = $0 { router.section = s } })) {
                if !query.trimmingCharacters(in: .whitespaces).isEmpty {
                    let hits = SettingsIndex.search(query, local: local, sections: sections + (workspaceName == nil ? [] : [.workspace]) + [.about])
                    if hits.isEmpty { Text("No settings match “\(query)”.").foregroundStyle(.secondary) }
                    ForEach(hits, id: \.0) { section, entries in
                        Section {
                            label(section)
                            ForEach(entries) { e in
                                Text(e.label).padding(.leading, 26).foregroundStyle(.secondary).tag(section)
                            }
                        }
                    }
                } else {
                Section { ForEach(sections) { label($0) } }
                if let workspaceName {
                    Section(workspaceName) { label(.workspace) }
                }
                Section("Support") {
                    Button { SettingsActions.openHelp() } label: { Label { Text("Help") } icon: { WebIcon.circleQuestionMark.image(size: 16) } }
                        .buttonStyle(.hoverPlain)
                    Button { SettingsActions.contactSupport() } label: { Label { Text("Contact Support…") } icon: { WebIcon.lifeBuoy.image(size: 16) } }
                        .buttonStyle(.hoverPlain)
                    label(.about)
                }
                }
            }
            .safeAreaInset(edge: .top, spacing: 0) {
                HStack(spacing: 6) {
                    Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                    TextField("Search", text: $query).textFieldStyle(.plain).focused($searching)
                        .onSubmit {
                            if let first = SettingsIndex.search(query, local: local, sections: sections + [.about]).first { router.section = first.0 }
                        }
                        .onKeyPress(.escape) { if query.isEmpty { return .ignored }; query = ""; return .handled }
                    if !query.isEmpty { Button { query = "" } label: { Image(systemName: "xmark.circle.fill") }.buttonStyle(.plain).foregroundStyle(.tertiary).help("Clear") }
                }
                .padding(.horizontal, 8).padding(.vertical, 5)
                .background(.fill.tertiary, in: .rect(cornerRadius: 7))
                .padding(.horizontal, 10).padding(.bottom, 6)
            }
            .toolbar(removing: .sidebarToggle)
            .navigationSplitViewColumnWidth(210)
        } detail: {
            Group {
                switch shown {
                case .account: AccountSettingsPane()
                case .general: GeneralSettingsPane()
                case .appearance: AppearanceSettingsPane()
                case .notifications: NotificationSettingsPane()
                case .ai: if local { LocalAISettingsPane() } else { AISettingsPane() }
                case .security: SecuritySettingsPane()
                case .privacy: WebSettingsPane(page: .settingsPrivacy)
                case .appLock: AppLockPane()
                case .offline: OfflinePane()
                case .devices: DevicesPane()
                case .workspace: WebSettingsPane(page: .settingsWorkspace)
                case .connectedApps: WebSettingsPane(page: .settingsConnectedApps)
                case .data: DataPane()
                case .billing: BillingPane()
                case .mac: MacPane()
                case .updates: UpdatesPane()
                case .library: LibraryPane()
                case .about: AboutPane()
                }
            }
            .navigationTitle(shown == .workspace ? "Workspace" : shown.title)
        }
        .frame(minWidth: 720, minHeight: 500)
        .tint(.foleviInk)
        .background { Button("") { searching = true }.keyboardShortcut("f").hidden() }
    }

    private func label(_ s: SettingsSection) -> some View {
        Label {
            Text(s.title)
        } icon: {
            Group { if s == .ai { AiMarkGlyph(size: 14) } else { s.webIcon.image(size: 14) } }.frame(width: 18)
        }
        .tag(s)
    }
}

// MARK: panes

struct AccountSettingsPane: View {
    private var app: AppModel { .shared }
    @State private var account = Live<Views.SettingsAccount>()
    @State private var details = Live<Views.AccountDetails>()
    @State private var name = ""

    var body: some View {
        Form {
            if let a = account.value {
                Section {
                    HStack(spacing: 14) {
                        PlaceAvatar(size: 56)
                        VStack(alignment: .leading) {
                            Text(a.name).font(.title3.weight(.semibold))
                            Text(a.email).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button("Change Picture…") { pickAvatar() }
                        if a.avatarUrl != nil { Button("Remove") { app.perform { _ = try await $0.command(Commands.SettingsRemoveAvatar()) } } }
                    }
                }
                Section("Profile") {
                    HStack {
                        TextField("Name", text: $name).onSubmit { save() }
                        if name.trimmingCharacters(in: .whitespaces) != a.name, !name.trimmingCharacters(in: .whitespaces).isEmpty {
                            Button("Save", action: save).buttonStyle(InkPillStyle())
                        }
                    }
                    LabeledContent("Email", value: a.email)
                    LabeledContent("Time Zone") {
                        TimeZonePicker(value: a.timeZone) { tz in app.perform { _ = try await $0.command(Commands.SettingsUpdate(SettingsUpdateArgs(name: nil, appearance: nil, timeZone: tz, reviewAppEdits: nil, aiEnabled: nil, editorZoom: nil))) } }
                    }
                }
                AccountAICard()
            }
            if let d = details.value {
                if let plan = d.plan {
                    Section("Your Plan") {
                        LabeledContent("Plan", value: (plan.trialing ? "Free trial of " : "") + Self.tierName(plan.tier))
                        if let active = d.devicesActive { LabeledContent("Devices", value: d.deviceLimit.map { "\(active) of \($0)" } ?? "\(active)") }
                        if plan.paid { Button("Manage Billing…") { BillingActions.openPortal() } }
                    }
                }
                if let s = d.storage {
                    Section("Storage") {
                        LabeledContent("Used", value: ByteCountFormatter.string(fromByteCount: Int64(s.usedBytes), countStyle: .file) + (s.limitBytes.map { " of " + ByteCountFormatter.string(fromByteCount: Int64($0), countStyle: .file) } ?? ""))
                        if let limit = s.limitBytes, limit > 0 { ProgressView(value: Double(s.usedBytes), total: Double(limit)) }
                    }
                }
                Section("Spaces") {
                    ForEach(d.spaces, id: \.id) { s in LabeledContent(s.name, value: s.role.capitalized) }
                }
            }
            Section {
                Button("Sign Out of This Account…", role: .destructive) { signOut() }
                Button("Delete Account…", role: .destructive) { SettingsWeb.open(.settingsDeleteAccount) }
            }
        }
        .formStyle(.grouped)
        .task(id: app.client.map(ObjectIdentifier.init)) {
            account.bind(app.client, Views.SettingsAccount())
            details.bind(app.client, Views.AccountDetails())
        }
        .onChange(of: account.value?.name) { name = account.value?.name ?? "" }
    }

    static func tierName(_ t: String) -> String {
        switch t.lowercased() {
        case "core", "free": "Core"
        case "pro": "Pro"
        case "pro_ai", "proai", "pro-ai": "Pro AI"
        default: t.capitalized
        }
    }

    private func save() {
        let n = name.trimmingCharacters(in: .whitespaces)
        guard !n.isEmpty, n != account.value?.name else { return }
        app.perform { _ = try await $0.command(Commands.SettingsUpdate(SettingsUpdateArgs(name: n, appearance: nil, timeZone: nil, reviewAppEdits: nil, aiEnabled: nil, editorZoom: nil))) }
    }

    private func pickAvatar() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.image]
        guard panel.runModal() == .OK, let url = panel.url, let data = try? Data(contentsOf: url), data.count < 8_000_000 else { return }
        let mime = url.pathExtension.lowercased() == "png" ? "image/png" : "image/jpeg"
        app.perform { _ = try await $0.command(Commands.SettingsSetAvatar(AvatarArgs(data: data.base64EncodedString(), mimeType: mime, name: url.lastPathComponent))) }
    }

    private func signOut() {
        let alert = NSAlert()
        alert.messageText = "Sign out of \(account.value?.email ?? "this account")?"
        alert.informativeText = "Notes waiting to sync stay on this Mac until you sign in again."
        alert.addButton(withTitle: "Sign Out")
        alert.addButton(withTitle: "Cancel")
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        app.perform { _ = try await $0.command(Commands.AccountSignOut()) }
    }
}

struct GeneralSettingsPane: View {
    private var app: AppModel { .shared }
    @State private var general = Live<Views.SettingsGeneral>()

    var body: some View {
        Form {
            if let g = general.value {
                Section {
                    LabeledContent("Time Zone") {
                        TimeZonePicker(value: g.timeZone) { tz in app.perform { _ = try await $0.command(Commands.SettingsUpdate(SettingsUpdateArgs(name: nil, appearance: nil, timeZone: tz, reviewAppEdits: nil, aiEnabled: nil, editorZoom: nil))) } }
                    }
                    Toggle("Review edits from connected apps before they're saved", isOn: Binding(get: { g.reviewAppEdits }, set: { v in app.perform { _ = try await $0.command(Commands.SettingsUpdate(SettingsUpdateArgs(name: nil, appearance: nil, timeZone: nil, reviewAppEdits: v, aiEnabled: nil, editorZoom: nil))) } }))
                }
            } else {
                ProgressView()
            }
        }
        .formStyle(.grouped)
        .task(id: app.client.map(ObjectIdentifier.init)) { general.bind(app.client, Views.SettingsGeneral()) }
    }
}

struct AppearanceSettingsPane: View {
    private var app: AppModel { .shared }
    @State private var appearance = Live<Views.SettingsAppearance>()

    var body: some View {
        Form {
            if let a = appearance.value {
                Section {
                    ThemeTiles(value: a.appearance.rawValue) { v in
                        app.perform { _ = try await $0.command(Commands.SettingsUpdate(SettingsUpdateArgs(name: nil, appearance: .init(rawValue: v), timeZone: nil, reviewAppEdits: nil, aiEnabled: nil, editorZoom: nil))) }
                    }
                    .frame(maxWidth: .infinity)
                    Picker("Note Text Size", selection: Binding(get: { a.editorZoom }, set: { z in
                        app.perform { _ = try await $0.command(Commands.SettingsUpdate(SettingsUpdateArgs(name: nil, appearance: nil, timeZone: nil, reviewAppEdits: nil, aiEnabled: nil, editorZoom: z))) }
                    })) {
                        ForEach(a.editorZooms, id: \.self) { Text("\(Int($0 * 100))%").tag($0) }
                    }
                }
            } else {
                ProgressView()
            }
        }
        .formStyle(.grouped)
        .task(id: app.client.map(ObjectIdentifier.init)) { appearance.bind(app.client, Views.SettingsAppearance()) }
    }
}

struct NotificationSettingsPane: View {
    private var app: AppModel { .shared }
    @State private var settings = Live<Views.SettingsNotifications>()

    var body: some View {
        Form {
            if let s = settings.value {
                Section("What You Hear About") {
                    ForEach(s.topics, id: \.id) { t in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(t.label)
                            if !t.hint.isEmpty { Text(t.hint).font(.caption).foregroundStyle(.secondary) }
                            HStack {
                                Toggle("In Folevi", isOn: Binding(get: { t.inApp }, set: { v in set(t.id, inApp: v, email: nil) }))
                                Toggle("Email", isOn: Binding(get: { t.email }, set: { v in set(t.id, inApp: nil, email: v) }))
                            }
                            .toggleStyle(.checkbox)
                        }
                    }
                }
                Section("Notifications on This Mac") {
                    Button("Open General Settings for This Mac") { SettingsRouter.shared.section = .mac }
                }
                Section("Email") {
                    Picker("Send comment emails", selection: Binding(get: { s.digest }, set: { d in
                        app.perform { _ = try await $0.command(Commands.SettingsSetNotificationEmails(NotificationEmailsArgs(digest: .init(rawValue: d), productEmail: nil))) }
                    })) {
                        Text("As they happen").tag("off"); Text("In a daily digest").tag("daily")
                    }
                    Toggle("News about Folevi", isOn: Binding(get: { s.productEmail }, set: { v in
                        app.perform { _ = try await $0.command(Commands.SettingsSetNotificationEmails(NotificationEmailsArgs(digest: nil, productEmail: v))) }
                    }))
                }
            } else {
                ProgressView()
            }
        }
        .formStyle(.grouped)
        .task(id: app.client.map(ObjectIdentifier.init)) { settings.bind(app.client, Views.SettingsNotifications()) }
    }

    private func set(_ topic: String, inApp: Bool?, email: Bool?) {
        app.perform { _ = try await $0.command(Commands.SettingsSetNotificationTopic(NotificationTopicArgs(topic: topic, inApp: inApp, email: email))) }
    }
}

struct AISettingsPane: View {
    private var app: AppModel { .shared }
    @State private var ai = Live<Views.SettingsAi>()

    var body: some View {
        Form {
            if let a = ai.value {
                Section {
                    Toggle("Foli AI", isOn: Binding(get: { a.enabled }, set: { v in app.perform { _ = try await $0.command(Commands.SettingsUpdate(SettingsUpdateArgs(name: nil, appearance: nil, timeZone: nil, reviewAppEdits: nil, aiEnabled: v, editorZoom: nil))) } }))
                    if !a.included { Text("Foli AI comes with Pro AI, or as a trial.").font(.caption).foregroundStyle(.secondary) }
                }
                Section("What Foli AI May Do") {
                    Toggle("Keep chat history", isOn: pref(.history, a.history))
                    Toggle("Remember things you ask it to", isOn: pref(.memory, a.memory))
                    Toggle("Suggest follow-ups", isOn: pref(.suggestions, a.suggestions))
                    Toggle("Read attachments", isOn: pref(.attachments, a.attachments))
                    Toggle("Research the web", isOn: pref(.webResearch, a.webResearch))
                    Toggle("Weekly digests", isOn: pref(.digests, a.digests))
                    Toggle("Read text in images", isOn: pref(.readImages, a.readImages))
                }
                .disabled(!a.enabled)
                Section("Search in Images") {
                    // On-device text recognition works without Foli AI and whatever the plan.
                    Toggle("Read text on your devices", isOn: pref(.deviceText, a.deviceText))
                }
                if a.enabled { MemoryCard() }
                Section { Button("Export Foli AI Data…") { SettingsWeb.open(.settingsAiExport) } }
            } else {
                ProgressView()
            }
        }
        .formStyle(.grouped)
        .task(id: app.client.map(ObjectIdentifier.init)) { ai.bind(app.client, Views.SettingsAi()) }
    }

    private func pref(_ key: AiPrefKey, _ value: Bool) -> Binding<Bool> {
        Binding(get: { value }, set: { v in app.perform { _ = try await $0.command(Commands.SettingsSetAiPref(AiPrefArgs(key: key, on: v))) } })
    }
}

struct SecuritySettingsPane: View {
    private var app: AppModel { .shared }
    @State private var security = Live<Views.SettingsSecurity>()

    var body: some View {
        Form {
            if let s = security.value {
                Section("Signing In") {
                    LabeledContent("Sign-in methods", value: s.methods.isEmpty ? "None" : s.methods.map { $0.capitalized }.joined(separator: ", "))
                    LabeledContent("Two-factor authentication", value: s.twoFactor == true ? "On" : "Off")
                    if s.passkeys.isEmpty {
                        LabeledContent("Passkeys", value: "No passkeys yet.")
                    } else {
                        ForEach(s.passkeys, id: \.id) { k in
                            LabeledContent(k.name, value: k.lastUsedAt.map { "Used " + CoreDates.short($0) } ?? k.createdAt.map { "Added " + CoreDates.short($0) } ?? "")
                        }
                    }
                    Button("Manage Password, Two-Factor and Passkeys…") { SettingsWeb.open(.settingsSecurity) }
                }
                Section("End-to-End Encryption") {
                    LabeledContent("Level", value: app.currentSpace?.encrypted == true ? "End-to-end encrypted" : "Standard")
                    E2eeRow()
                }
            } else {
                ProgressView()
            }
        }
        .formStyle(.grouped)
        .task(id: app.client.map(ObjectIdentifier.init)) { security.bind(app.client, Views.SettingsSecurity()) }
    }
}

struct E2eeRow: View {
    private var app: AppModel { .shared }
    @State private var state = Live<Views.E2eeState>()
    @State private var touch = (on: false, available: false)

    var body: some View {
        Group {
            if let s = state.value {
                LabeledContent("Encryption on this Mac", value: s.state == .none ? "Off" : s.state.rawValue.capitalized)
                if s.state == .locked { Text("Open a note in an encrypted space to unlock it with your passphrase or recovery key.").font(.caption).foregroundStyle(.secondary) }
                if s.state != .none, touch.available {
                    Toggle(isOn: Binding(get: { touch.on }, set: { on in
                        Task { @MainActor in if let k = try? await E2eeKeys.shared.setFaceId(on) { touch = (k.touchId, k.available) } }
                    })) {
                        Text("Unlock with Touch ID")
                        Text("This Mac asks for Touch ID instead of your passphrase before it opens your encrypted notes and the Vault's keys.")
                    }
                }
            } else {
                ProgressView().controlSize(.small)
            }
        }
        .task(id: app.client.map(ObjectIdentifier.init)) {
            state.bind(app.client, Views.E2eeState())
            let k = E2eeKeys.shared.settings()
            touch = (k.touchId, k.available)
        }
    }
}

struct DevicesPane: View {
    private var app: AppModel { .shared }
    @State private var security = Live<Views.SettingsSecurity>()
    @State private var details = Live<Views.AccountDetails>()

    var body: some View {
        Form {
            if let active = details.value?.devicesActive {
                Section { LabeledContent("Devices connected", value: details.value?.deviceLimit.map { "\(active) of \($0)" } ?? "\(active)") }
            }
            Section {
                ForEach(security.value?.sessions ?? [], id: \.id) { s in
                    HStack {
                        Image(systemName: s.client.lowercased().contains("iphone") ? "iphone" : s.client.lowercased().contains("ipad") ? "ipad" : "laptopcomputer")
                        VStack(alignment: .leading) {
                            Text(s.label + (s.current ? " (this Mac)" : ""))
                            Text("\(s.client) · \(CoreDates.relative(s.lastSeenAt))").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        if !s.current {
                            Button("Sign Out") { app.perform { _ = try await $0.command(Commands.SessionRevoke(SessionIdArgs(id: s.id))) } }
                        }
                    }
                }
            }
        }
        .formStyle(.grouped)
        .task(id: app.client.map(ObjectIdentifier.init)) {
            security.bind(app.client, Views.SettingsSecurity())
            details.bind(app.client, Views.AccountDetails())
        }
    }
}

/// The Foli AI switch in Account (off and explained when the plan doesn't include it).
struct AccountAICard: View {
    private var app: AppModel { .shared }
    @State private var ai = Live<Views.SettingsAi>()

    var body: some View {
        Section("Foli AI") {
            if let a = ai.value {
                Toggle("Foli AI", isOn: Binding(get: { a.enabled }, set: { v in app.perform { _ = try await $0.command(Commands.SettingsUpdate(SettingsUpdateArgs(name: nil, appearance: nil, timeZone: nil, reviewAppEdits: nil, aiEnabled: v, editorZoom: nil))) } }))
                    .disabled(!a.included)
                if !a.included { Text("Foli AI isn't part of the Core plan. It comes with Pro AI, or as a trial.").font(.caption).foregroundStyle(.secondary) }
            }
        }
        .task(id: app.client.map(ObjectIdentifier.init)) { ai.bind(app.client, Views.SettingsAi()) }
    }
}

struct AppLockPane: View {
    private var lock = MacAppLock.shared

    var body: some View {
        Form {
            Section {
                Toggle("Lock Folevi Core with Touch ID", isOn: Binding(get: { lock.lock }, set: { v in Task { await lock.set(lock: v) } }))
                    .disabled(!MacAppLock.available)
                Picker("Ask Again After", selection: Binding(get: { lock.lockAfter }, set: { v in Task { await lock.set(after: v) } })) {
                    Text("Immediately").tag(0)
                    Text("1 minute").tag(60)
                    Text("5 minutes").tag(300)
                    Text("15 minutes").tag(900)
                    Text("1 hour").tag(3600)
                }
                .disabled(!lock.lock)
            } footer: {
                Text(MacAppLock.available ? "Your notes are hidden until you unlock with Touch ID or your Mac's password." : "This Mac has no Touch ID or password to ask for.")
            }
        }
        .formStyle(.grouped)
    }
}

struct OfflinePane: View {
    private var app: AppModel { .shared }
    @State private var storage = Live<Views.DeviceStorage>()

    var body: some View {
        Form {
            if let s = storage.value {
                Section {
                    if s.available {
                        Toggle("Keep every note on this Mac", isOn: Binding(get: { s.keepAll }, set: { v in app.perform { _ = try await $0.command(Commands.DeviceKeepAll(DeviceKeepAllArgs(on: v))) } }))
                    } else {
                        Text("Every note in this library is on this Mac, so it opens offline.").foregroundStyle(.secondary)
                    }
                    LabeledContent("Connection", value: app.sync.value?.online == false ? "Offline" : "Online")
                    LabeledContent("Notes kept", value: s.notesKept.map { $0.formatted() } ?? "…")
                    LabeledContent("Files kept", value: s.attachmentsKept.map { $0.formatted() } ?? "…")
                    LabeledContent("Space used", value: s.usedBytes.map { ByteCountFormatter.string(fromByteCount: Int64($0), countStyle: .file) } ?? "…")
                    if s.waiting > 0 { LabeledContent("Waiting to sync", value: s.waiting.formatted()) }
                }
                if !s.spaces.isEmpty {
                    Section("Spaces") {
                        ForEach(s.spaces, id: \.space) { sp in
                            LabeledContent(sp.name, value: sp.total.map { "\(sp.have.formatted()) of \($0.formatted())" } ?? sp.phase.capitalized)
                        }
                    }
                }
                Section {
                    Button("Download Everything Now") { app.perform { _ = try await $0.command(Commands.DeviceDownload()); app.toast("Downloading every note and file") } }
                    Button("Sync Now") { app.perform { _ = try await $0.command(Commands.EngineRefresh()) } }
                    Button("Remove Downloaded Files…", role: .destructive) { app.perform { _ = try await $0.command(Commands.DeviceRemoveFiles()) } }
                    Button("Remove This Mac's Copy…", role: .destructive) {
                        let alert = NSAlert()
                        alert.messageText = "Remove this Mac's copy of your notes?"
                        alert.informativeText = "Notes are downloaded again when you open them. Changes that haven't synced yet are kept until they do."
                        alert.alertStyle = .warning
                        alert.addButton(withTitle: "Remove")
                        alert.addButton(withTitle: "Cancel")
                        alert.buttons.first?.hasDestructiveAction = true
                        CoreAlerts.cancelIsDefault(alert)
                        guard alert.runModal() == .alertFirstButtonReturn else { return }
                        app.perform { _ = try await $0.command(Commands.DeviceRemoveCopy(DeviceRemoveCopyArgs(force: true))) }
                    }
                }
            } else if storage.error != nil {
                Section {
                    LabeledContent("This Mac", value: "Unavailable")
                    Button("Retry") { storage = Live<Views.DeviceStorage>(); storage.bind(app.client, Views.DeviceStorage()) }
                }
            } else {
                ProgressView()
            }
        }
        .formStyle(.grouped)
        .task(id: app.client.map(ObjectIdentifier.init)) { storage.bind(app.client, Views.DeviceStorage()) }
    }
}

struct DataPane: View {
    var body: some View {
        Form {
            Section("Import") {
                Button("Import Notes…") { SettingsWeb.open(.settingsData) }
                Text("From Markdown, Notion, Evernote, Apple Notes exports and more.").font(.caption).foregroundStyle(.secondary)
            }
            Section("Export") {
                Button("Export Everything…") { SettingsWeb.open(.settingsData) }
                Button("Workspace Data…") { SettingsWeb.open(.settingsWorkspaceData) }
            }
        }
        .formStyle(.grouped)
    }
}

struct BillingPane: View {
    private var app: AppModel { .shared }
    @State private var data = SettingsJSON(nil)
    @State private var state = Load.loading

    enum Load { case loading, loaded, unavailable }

    var body: some View {
        Form {
            let sub = data["subscription"]
            if sub.exists {
                Section("Your Plan") {
                    LabeledContent("Plan", value: (sub["plan"].string ?? "").capitalized + (sub["interval"].string.map { $0 == "year" ? ", yearly" : ", monthly" } ?? ""))
                    if let end = sub["currentPeriodEnd"].number {
                        LabeledContent(sub["cancelAtPeriodEnd"].bool == true ? "Ends" : "Renews", value: Date(timeIntervalSince1970: end / 1000).formatted(date: .long, time: .omitted))
                    }
                    Button("Manage Billing…") { BillingActions.openPortal() }
                }
            }
            // The payments (hidden in the iPhone app, shown on the Mac as today).
            Section("Billing History") {
                switch state {
                case .loading:
                    ProgressView().controlSize(.small)
                case .unavailable:
                    Text("Sign in to a Folevi account to see its payments.").foregroundStyle(.secondary)
                case .loaded:
                    let payments = data["payments"].array
                    if payments.isEmpty {
                        Text("No payments yet.").foregroundStyle(.secondary)
                    } else {
                        ForEach(Array(payments.enumerated()), id: \.offset) { _, p in
                            LabeledContent {
                                Text(Self.amount(p)).monospacedDigit()
                            } label: {
                                Text(Self.label(p))
                                Text(Self.date(p) + Self.status(p))
                            }
                        }
                    }
                }
            }
            Section {
                Link("Open Plan & Billing on folevi.com", destination: Paths.serviceURL.appendingPathComponent("settings/billing"))
            }
        }
        .formStyle(.grouped)
        .task(id: app.client.map(ObjectIdentifier.init)) { await load() }
    }

    private func load() async {
        guard let client = app.client else { state = .unavailable; return }
        do {
            let v = try await client.query(Views.SettingsQuery(SettingsQueryArgs(key: .convex, args: ["fn": .string("billing.mine"), "args": .object([:])])))
            data = SettingsJSON(v.data)
            state = .loaded
        } catch {
            state = .unavailable
        }
    }

    static func label(_ p: SettingsJSON) -> String {
        if let credits = p["credits"].number { return "\(Int(credits).formatted()) Foli AI credits" }
        let plan = (p["plan"].string ?? "Plan").capitalized
        switch p["interval"].string {
        case "year": return plan + ", yearly"
        case "month": return plan + ", monthly"
        default: return plan
        }
    }

    static func amount(_ p: SettingsJSON) -> String {
        let cents = p["amountCents"].number ?? 0
        return (cents / 100).formatted(.currency(code: (p["currency"].string ?? "usd").uppercased()))
    }

    static func date(_ p: SettingsJSON) -> String {
        guard let at = p["createdAt"].number else { return "" }
        return Date(timeIntervalSince1970: at / 1000).formatted(date: .abbreviated, time: .omitted)
    }

    static func status(_ p: SettingsJSON) -> String {
        switch p["status"].string {
        case nil, "paid", "succeeded", "confirmed": return ""
        case "refunded": return " · Refunded"
        case let s?: return " · " + s.capitalized
        }
    }
}

/// This Mac's own: Quick Add's shortcut, the menu bar icon, opening at login, Mac notifications, Spotlight.
struct MacPane: View {
    @State private var settings = DesktopSettings.current

    var body: some View {
        Form {
            Section("Quick Add") {
                ShortcutRecorder(value: $settings.quickAddShortcut)
                if settings.quickAddShortcut != DesktopSettings().quickAddShortcut {
                    Button("Use \(HotKey.display(DesktopSettings().quickAddShortcut))") { settings.quickAddShortcut = DesktopSettings().quickAddShortcut }
                }
                Toggle("Show Folevi Core in the menu bar", isOn: $settings.menuBarIcon)
            }
            Section {
                Toggle("Open at login", isOn: $settings.openAtLogin)
                Toggle("Mac notifications for comments, mentions and reminders", isOn: $settings.notifications)
                Toggle("Show notes in Spotlight", isOn: $settings.spotlight)
            }
        }
        .formStyle(.grouped)
        .onChange(of: settings) { old, new in
            DesktopSettings.current = new
            DesktopHooks.onSettings?(new, old)
        }
    }
}

/// A field that records a key combination ("Option+Space").
struct ShortcutRecorder: View {
    @Binding var value: String
    @State private var recording = false
    @State private var monitor: Any?

    var body: some View {
        LabeledContent("Shortcut") {
            HStack {
                Button(recording ? "Type a shortcut…" : (value.isEmpty ? "None" : HotKey.display(value))) { recording ? stop() : start() }
                    .frame(minWidth: 140)
                if !value.isEmpty { Button("Clear") { value = "" }.buttonStyle(.borderless) }
            }
        }
    }

    private func start() {
        recording = true
        DesktopHooks.pauseShortcut?(true)
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { e in
            if e.keyCode == 53 { stop(); return nil }
            if let s = HotKey.accelerator(e), HotKey.isValidShortcut(s) { value = s; stop() }
            return nil
        }
    }

    private func stop() {
        recording = false
        DesktopHooks.pauseShortcut?(false)
        if let monitor { NSEvent.removeMonitor(monitor) }
        monitor = nil
    }
}

struct UpdatesPane: View {
    var body: some View {
        Form {
            Section {
                LabeledContent("Version", value: Paths.version)
                Button(Updater.shared.menuTitle ?? "Check for Updates…") { Updater.shared.menuAction() }
                    .disabled(!Updater.enabled)
                if !Updater.enabled { Text("Updates are off in development builds.").font(.caption).foregroundStyle(.secondary) }
            }
        }
        .formStyle(.grouped)
    }
}

/// A section the page draws (connected apps, workspace, privacy, exports), in the Settings window.
struct WebSettingsPane: View {
    let page: WebPage
    @State private var host: Page?
    private let id = UUID()

    var body: some View {
        PageHostView(page: host)
            .task(id: page) {
                guard let p = PagePool.shared.editor(for: id) else { return }
                host = p
                await p.show(web: page)
            }
            .onDisappear { PagePool.shared.giveBack(from: id); host = nil }
    }
}

@MainActor
enum SettingsWeb {
    /// Opens a web-drawn section (from a button inside another section).
    static func open(_ page: FoleviEngine.WebPage) {
        switch page {
        case .settingsConnectedApps: SettingsRouter.shared.section = .connectedApps
        case .settingsWorkspace: SettingsRouter.shared.section = .workspace
        case .settingsPrivacy: SettingsRouter.shared.section = .privacy
        default:
            let w = SettingsWebWindow(page: page)
            w.show()
        }
    }
}

/// A web-drawn screen in a window of its own (deleting the account, an export, two-factor).
@MainActor
final class SettingsWebWindow: NSObject, NSWindowDelegate {
    private static var open: [SettingsWebWindow] = []
    let page: WebPage
    private var window: NSWindow?
    private let id = UUID()

    init(page: FoleviEngine.WebPage) { self.page = page }

    func show() {
        guard let p = PagePool.shared.editor(for: id) else { return }
        let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 720, height: 620), styleMask: [.titled, .closable, .resizable, .miniaturizable], backing: .buffered, defer: false)
        w.title = "Folevi Core"
        w.isReleasedWhenClosed = false
        w.delegate = self
        p.view.frame = w.contentView?.bounds ?? .zero
        w.contentView?.addSubview(p.view)
        w.center()
        w.makeKeyAndOrderFront(nil)
        window = w
        Self.open.append(self)
        Task { await p.show(web: page) }
    }

    func windowWillClose(_ notification: Notification) {
        PagePool.shared.giveBack(from: id)
        Self.open.removeAll { $0 === self }
    }
}

/// Foli AI in a library on this Mac: the on-device model, your own keys (OpenAI, Anthropic, Google; kept in this
/// Mac's Keychain, never sent to Folevi), and which model it uses. From the engine's `localAi` settings.
struct LocalAISettingsPane: View {
    private var app: AppModel { .shared }
    @State private var value: [String: JSONValue] = [:]
    @State private var keyDrafts: [String: String] = [:]
    @State private var testResult: [String: String] = [:]

    var body: some View {
        Form {
            if value.isEmpty {
                ProgressView()
            } else {
                LocalAITopSections(value: SettingsJSON(.object(value))) { await load() }
                if case .object(let od)? = value["onDevice"] {
                    Section(od["title"]?.string ?? "On This Mac") {
                        LabeledContent(od["name"]?.string ?? "", value: od["status"]?.string?.capitalized ?? "")
                        if let t = od["text"]?.string { Text(t).font(.caption).foregroundStyle(.secondary) }
                        if let m = od["more"]?.string { Text(m).font(.caption).foregroundStyle(.secondary) }
                    }
                }
                Section {
                    if let d = value["keysDescription"]?.string { Text(d).font(.caption).foregroundStyle(.secondary) }
                    if case .array(let keys)? = value["keys"] {
                        ForEach(Array(keys.enumerated()), id: \.offset) { _, k in
                            if case .object(let key) = k, let provider = key["provider"]?.string {
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(key["label"]?.string ?? provider).font(.headline)
                                    Text(key["status"]?.string ?? "").font(.caption).foregroundStyle(.secondary)
                                    HStack {
                                        if key["stored"]?.bool == true {
                                            if key["canTest"]?.bool == true { Button("Test Key") { test(provider) } }
                                            Button("Remove Key", role: .destructive) { run(.localAiRemoveKey, ["provider": .string(provider)]) }
                                        } else if key["canAdd"]?.bool == true {
                                            SecureField("Paste your key", text: Binding(get: { keyDrafts[provider] ?? "" }, set: { keyDrafts[provider] = $0 }))
                                            if !(keyDrafts[provider] ?? "").isEmpty {
                                                Button("Add") { run(.localAiSetKey, ["provider": .string(provider), "key": .string(keyDrafts[provider] ?? "")]); keyDrafts[provider] = "" }
                                            }
                                        }
                                    }
                                    if let r = testResult[provider] { Text(r).font(.caption) }
                                }
                                .padding(.vertical, 4)
                            }
                        }
                    }
                } header: { Text("Your Own Keys") }
            }
        }
        .formStyle(.grouped)
        .task { await load() }
    }

    private func load() async {
        if let v = try? await app.client?.query(Views.SettingsQuery(SettingsQueryArgs(key: .localAi, args: nil))), case .object(let o) = v.data { value = o }
    }

    private func run(_ key: SettingsRunKey, _ args: [String: JSONValue]) {
        app.perform { client in
            _ = try await client.command(Commands.SettingsRun(SettingsRunArgs(key: key, args: args)))
            await load()
        }
    }

    private func test(_ provider: String) {
        Task { @MainActor in
            guard let client = app.client else { return }
            let r = try? await client.command(Commands.SettingsRun(SettingsRunArgs(key: .localAiTestKey, args: ["provider": .string(provider)])))
            if case .object(let o)? = r?.data { testResult[provider] = o["text"]?.string } else { testResult[provider] = "Couldn't test the key." }
        }
    }
}
