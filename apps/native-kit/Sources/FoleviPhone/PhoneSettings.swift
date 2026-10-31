// Settings on the iPhone, as the web's phone layout draws it (apps/web/src/components/views/SettingsView.tsx): the
// list of sections (You, the open workspace's, Support, the version), and each section a screen of its own with its
// pushed screens (`?screen=`). This file has the list and the sections a library has (local mode): Library, AI on the
// device, Appearance, Import & export, This device; PhoneSettingsAccount.swift has the account's.
#if os(iOS)
import SwiftUI
import UniformTypeIdentifiers
import FoleviDesign
import FoleviEngine
import FoleviScreens

private func C(_ pair: ColorPair, _ scheme: ColorScheme) -> Color { pair.resolve(scheme).color }

/// The web's Settings sections (SettingsView.tsx `Section`).
public enum PhoneSettingsSection: String, CaseIterable, Sendable {
    case account, ai, billing, security, privacy, devices, connectedApps = "connected-apps", appearance, notifications, sync, library, data, desktop
    case thisDevice = "this-device"
    case workspace, members, workspacePrivacy = "workspace-privacy", workspaceGuests = "workspace-guests", workspaceBilling = "workspace-billing", workspaceData = "workspace-data"

    public var label: String {
        switch self {
        case .account: "Account"
        case .ai: "AI"
        case .billing, .workspaceBilling: "Plan & billing"
        case .security: "Security"
        case .privacy, .workspacePrivacy: "Privacy"
        case .devices: "Devices"
        case .connectedApps: "Connected apps"
        case .appearance: "Appearance"
        case .notifications: "Notifications"
        case .sync: "Offline & sync"
        case .library: "Library"
        case .data, .workspaceData: "Import & export"
        case .desktop: "Desktop app"
        case .thisDevice: "This device"
        case .workspace: "General"
        case .members: "Members"
        case .workspaceGuests: "Guests"
        }
    }

    /// The section's large title (the workspace's General and Privacy say so).
    public var heading: String {
        switch self {
        case .workspace: "Workspace"
        case .workspacePrivacy: "Workspace privacy"
        default: label
        }
    }

    var icon: WebIcon {
        switch self {
        case .account: .userRound
        case .ai: .sparkles
        case .billing, .workspaceBilling: .creditCard
        case .security: .shieldCheck
        case .privacy, .workspacePrivacy: .lockKeyhole
        case .devices: .monitorSmartphone
        case .connectedApps: .plug
        case .appearance: .palette
        case .notifications: .bell
        case .sync: .refreshCw
        case .library: .libraryBig
        case .data, .workspaceData: .arrowDownUp
        case .desktop: .appWindowMac
        case .thisDevice: .smartphone
        case .workspace: .buildingComplex
        case .members: .users
        case .workspaceGuests: .userRoundPlus
        }
    }

    public var isWorkspace: Bool { [.workspace, .members, .workspacePrivacy, .workspaceGuests, .workspaceBilling, .workspaceData].contains(self) }

    /// A section and its pushed screen from a path: `/settings/library?screen=library-move`.
    public static func parse(_ path: String) -> (section: PhoneSettingsSection?, screen: String?) {
        let parts = path.split(separator: "?", maxSplits: 1)
        let segments = parts.first?.split(separator: "/") ?? []
        let section = segments.count >= 2 ? PhoneSettingsSection(rawValue: String(segments[1])) : nil
        var screen: String?
        if parts.count == 2 {
            for item in parts[1].split(separator: "&") where item.hasPrefix("screen=") {
                screen = String(item.dropFirst(7)).removingPercentEncoding
            }
        }
        return (section, screen)
    }
}

/// What Settings asks the app for: the device's own settings and the account's ways in and out.
public struct PhoneSettingsHost {
    /// This device's lock: on, after how long, and how it unlocks ("faceID", "touchID", "passcode", "none").
    public var lock: @MainActor () -> (on: Bool, after: Int, method: String)
    /// Turns the lock on or off (on asks to unlock once first); the settings as they are after.
    public var setLock: @MainActor (Bool) async -> Void
    public var setLockAfter: @MainActor (Int) -> Void
    /// Sign in to Folevi (from a library).
    public var signIn: @MainActor () -> Void
    /// Contact support (the account's form, or an email from a library).
    public var contactSupport: @MainActor () -> Void
    public var openURL: @MainActor (URL) -> Void

    public init(lock: @escaping @MainActor () -> (on: Bool, after: Int, method: String), setLock: @escaping @MainActor (Bool) async -> Void, setLockAfter: @escaping @MainActor (Int) -> Void, signIn: @escaping @MainActor () -> Void, contactSupport: @escaping @MainActor () -> Void, openURL: @escaping @MainActor (URL) -> Void) {
        self.lock = lock
        self.setLock = setLock
        self.setLockAfter = setLockAfter
        self.signIn = signIn
        self.contactSupport = contactSupport
        self.openURL = openURL
    }
}

// MARK: The list

/// The list of sections: You (and the open workspace's), Support, the version.
public struct PhoneSettingsList: View {
    let model: PhoneSettingsModel
    let host: PhoneSettingsHost

    public init(model: PhoneSettingsModel, host: PhoneSettingsHost) {
        self.model = model
        self.host = host
    }

    /// The sections in their groups, as SettingsView.tsx lists them on the iPhone for this mode and role.
    public static func groups(_ model: PhoneSettingsModel) -> [(label: String, items: [PhoneSettingsSection])] {
        let you: [PhoneSettingsSection] = model.isLocal
            ? [.library, .ai, .appearance, .data, .thisDevice]
            : [.account, .ai, .billing, .security, .privacy, .devices, .connectedApps, .appearance, .notifications, .sync, .data, .thisDevice]
        var out: [(String, [PhoneSettingsSection])] = [("You", you)]
        if let w = model.workspace, !model.isLocal {
            var items: [PhoneSettingsSection] = [.workspace, .members, .workspacePrivacy]
            if w.canManage { items.append(.workspaceGuests) }
            if w.role == "owner" { items.append(.workspaceBilling) }
            if w.canManage { items.append(.workspaceData) }
            out.append((w.name, items))
        }
        return out
    }

    public var body: some View {
        PhoneSettingsPage {
            ForEach(Self.groups(model), id: \.label) { g in
                PhoneSettingsGroup(g.label) {
                    ForEach(g.items, id: \.self) { s in
                        PhoneSettingsRow(s.label, chevron: true, action: { model.open("/settings/\(s.rawValue)") }) { PhoneRowIcon(s.icon) }
                    }
                }
            }
            if model.workspace == nil && !model.isLocal {
                PhoneSettingsGroup(footer: "Share folders and notes with your team, each in its own workspace.") {
                    PhoneSettingsRow("Create a workspace", action: { model.open("/workspaces/new") }) { PhoneRowIcon(.buildingComplex) }
                }
            }
            PhoneSettingsGroup("Support") {
                PhoneSettingsRow("Help", chevron: true, action: { model.open("/help") }) { PhoneRowIcon(.circleQuestionMark) }
                PhoneSettingsRow("Contact support", action: host.contactSupport) { PhoneRowIcon(.lifeBuoy) }
            }
            PhoneSettingsVersion(version: model.version)
        }
    }
}

// MARK: A section

/// A section's screen content, or one of its pushed screens (`screen`).
public struct PhoneSettingsSectionView: View {
    let model: PhoneSettingsModel
    let host: PhoneSettingsHost
    let section: PhoneSettingsSection
    let screen: String?

    public init(model: PhoneSettingsModel, host: PhoneSettingsHost, section: PhoneSettingsSection, screen: String?) {
        self.model = model
        self.host = host
        self.section = section
        self.screen = screen
    }

    /// A pushed screen's title (`Subscreen title`), or the section's own.
    public static func title(_ section: PhoneSettingsSection, screen: String?) -> String {
        guard let screen else { return section.heading }
        switch screen {
        case "library-location": return "Location"
        case "library-move": return "Move library"
        case "library-lock-after", "lock-after": return "Ask again"
        case "theme": return "Theme"
        case "editor-text-size": return "Editor text size"
        case "ai-provider": return "Provider"
        case "ai-model": return "Model"
        case "import-results": return "Import results"
        default:
            if screen.hasPrefix("ai-key-") { return "\(PhoneLocalAi.providerLabel(String(screen.dropFirst(7)))) key" }
            if screen.hasPrefix("library-health-") { return PhoneLibrarySettings.healthTitle(String(screen.dropFirst(15))) }
            return PhoneAccountSettings.title(section, screen: screen) ?? section.heading
        }
    }

    public var body: some View {
        PhoneSettingsPage {
            switch section {
            case .library: PhoneLibrarySettings(model: model, host: host, screen: screen)
            case .ai:
                if model.isLocal { PhoneLocalAi(model: model, screen: screen) } else { PhoneAccountSettings(model: model, host: host, section: section, screen: screen) }
            case .appearance: PhoneAppearanceSettings(model: model, screen: screen)
            case .data, .workspaceData: PhoneDataSettings(model: model, workspace: section == .workspaceData ? model.workspace : nil, screen: screen)
            case .thisDevice: PhoneThisDeviceSettings(model: model, host: host, screen: screen)
            default: PhoneAccountSettings(model: model, host: host, section: section, screen: screen)
            }
        }
    }
}

// MARK: Library

struct LibraryData: Decodable {
    struct Choice: Decodable, Identifiable { var kind: String, title: String, detail: String; var id: String { kind } }
    struct Connection: Decodable { var provider: String, name: String, state: String, text: String, account: String, connectLabel: String, canConnect: Bool, canSignOut: Bool, signInWait: String }
    struct Place: Decodable { var kind: String, path: String, status: String, problem: String?, canSync: Bool, canMove: Bool, connection: Connection?, moveChoices: [Choice] }
    struct HealthItem: Decodable, Identifiable { var path: String, title: String?, since: String, detail: String?; var id: String { path } }
    struct HealthGroup: Decodable, Identifiable { var key: String, title: String, why: String, count: Int, items: [HealthItem], more: String?; var id: String { key } }
    struct Health: Decodable { var description: String, clean: Bool, groups: [HealthGroup] }
    struct Passphrase: Decodable { var encrypted: Bool, description: String, min: Int }
    struct LockChoice: Decodable { var value: Int, label: String }
    struct Lock: Decodable { var on: Bool, unavailable: Bool, label: String, description: String, after: Int, afterLabel: String, choices: [LockChoice] }
    struct Forget: Decodable { var title: String, description: String, button: String, dialogTitle: String, dialogDescription: String }
    struct PhoneDevice: Decodable, Identifiable { var id: String, phone: Bool, name: String, description: String, value: String }
    struct Phone: Decodable { var status: String, problem: String?, locationFooter: String, devices: [PhoneDevice]?, lockLabel: String, aiFooter: String }
    var local: Bool
    var place: Place
    var health: Health?
    var passphrase: Passphrase?
    var lock: Lock?
    var forget: Forget?
    var phone: Phone
}

struct PhoneLibrarySettings: View {
    let model: PhoneSettingsModel
    let host: PhoneSettingsHost
    let screen: String?
    @State private var passphrase: PassphrasePrompt?
    @Environment(\.colorScheme) private var scheme

    enum PassphrasePrompt: Identifiable { case set, change, remove; var id: Self { self } }

    static func healthTitle(_ key: String) -> String {
        switch key {
        case "unreadable": "Can't be read"
        case "downloading": "Still downloading"
        default: "Waiting for another device"
        }
    }

    var body: some View {
        if let d = model.query(.library).data(LibraryData.self) {
            switch screen {
            case "library-location":
                PhoneSettingsGroup(footer: d.phone.locationFooter) { PhoneSettingsText(text: d.place.path) }
            case "library-move":
                move(d)
            case "library-lock-after":
                if let l = d.lock {
                    PhoneSettingsChoiceList(label: "Ask again", value: String(l.after), choices: l.choices.map { PhoneSettingsChoice(value: String($0.value), label: $0.label) }, footer: "When you come back after Folevi has been in the background this long.") { v in
                        Task { await model.run(.libraryLock, ["lockAfter": .number(Double(v) ?? 0)]) }
                    }
                }
            case let s? where s.hasPrefix("library-health-"):
                if let g = d.health?.groups.first(where: { "library-health-\($0.key)" == s }) {
                    PhoneSettingsGroup(footer: g.why) {
                        ForEach(g.items) { item in
                            PhoneSettingsRow(item.title ?? item.path, description: [item.title != nil ? item.path : nil, item.since, item.detail].compactMap { $0 }.joined(separator: " · "))
                        }
                        if let more = g.more { PhoneSettingsText(text: more, muted: true) }
                    }
                }
            default:
                main(d)
            }
        }
    }

    @ViewBuilder private func main(_ d: LibraryData) -> some View {
        PhoneSettingsGroup("Where your library is", footer: [d.phone.problem, "Folevi keeps your notes as files in one folder. Other devices that use the same place share the library."].compactMap { $0 }.joined(separator: "\n")) {
            PhoneSettingsRow("Syncs with", value: d.place.kind)
            PhoneSettingsRow("Location", value: d.place.path, chevron: true, action: { model.open("/settings/library?screen=library-location") })
            PhoneSettingsRow("Status", value: d.phone.status)
            PhoneSettingsRow(model.busy.contains("library.syncNow") ? "Syncing…" : "Sync now", disabled: !d.place.canSync || model.busy.contains("library.syncNow"), action: { Task { await model.run(.librarySyncNow) } })
            PhoneSettingsRow("Move library", chevron: true, disabled: !d.place.canMove, action: { model.open("/settings/library?screen=library-move") })
        }
        if let c = d.place.connection { connection(c) }
        if let devices = d.phone.devices {
            PhoneSettingsGroup("Devices", footer: "Every device that opens this library, and when each last synced with it.") {
                if devices.isEmpty { PhoneSettingsText(text: "No device has synced yet.", muted: true) }
                ForEach(devices) { dev in
                    PhoneSettingsRow(dev.name, description: dev.description, value: dev.value) { PhoneRowIcon(dev.phone ? .smartphone : .laptop) }
                }
            }
        }
        if let h = d.health {
            PhoneSettingsGroup("Library health", footer: h.description) {
                if h.clean { PhoneSettingsRow("Nothing to fix") }
                ForEach(h.groups) { g in
                    PhoneSettingsRow(g.title, value: String(g.count), chevron: true, action: { model.open("/settings/library?screen=library-health-\(g.key)") })
                }
            }
        }
        if let p = d.passphrase {
            PhoneSettingsGroup("Passphrase", footer: p.description) {
                if p.encrypted {
                    PhoneSettingsRow("Change passphrase", action: { passphrase = .change }) { PhoneRowIcon(.keyRound) }
                    PhoneSettingsRow("Remove passphrase", danger: true, action: { passphrase = .remove })
                } else {
                    PhoneSettingsRow("Encrypt with a passphrase", action: { passphrase = .set }) { PhoneRowIcon(.keyRound) }
                }
            }
            .sheet(item: $passphrase) { kind in PassphraseSheet(model: model, kind: kind, min: p.min) }
        }
        if let l = d.lock {
            PhoneSettingsGroup("App lock", footer: l.description) {
                PhoneSettingsSwitchRow(d.phone.lockLabel, on: l.on, disabled: l.unavailable || model.busy.contains("library.lock"), change: { on in Task { await model.run(.libraryLock, ["lock": .bool(on)]) } }) { PhoneRowIcon(.lockKeyhole) }
                if l.on {
                    PhoneSettingsRow("Ask again", value: l.afterLabel, chevron: true, action: { model.open("/settings/library?screen=library-lock-after") })
                }
            }
        }
        PhoneSettingsGroup("Foli AI", footer: d.phone.aiFooter) {
            PhoneSettingsRow("Model and keys", chevron: true, action: { model.open("/settings/ai") }) { PhoneRowIcon(.sparkles) }
        }
        PhoneSettingsGroup("Folevi account", footer: "Sign in to Folevi to share notes and work on them with other people. Your library comes with you into the account.") {
            PhoneSettingsRow("Sign in to Folevi", action: host.signIn) { PhoneRowIcon(.userRound) }
        }
        if let f = d.forget {
            PhoneSettingsGroup(footer: f.description) {
                PhoneSettingsDestructiveRow(label: f.title, confirm: f.title, message: f.dialogDescription) { Task { await model.run(.libraryForget) } }
            }
        }
    }

    private func connection(_ c: LibraryData.Connection) -> some View {
        let connected = c.state == "connected" || c.state == "offline"
        let waiting = model.busy.contains("library.cloudConnect")
        return PhoneSettingsGroup(c.name, footer: waiting ? c.signInWait : connected ? (c.state == "offline" ? nil : nil) : c.text) {
            if connected { PhoneSettingsRow("Connected as", value: c.account) { PhoneRowIcon(.userRound) } }
            if waiting {
                PhoneSettingsRow("Cancel signing in", action: { Task { await model.run(.libraryCloudCancel, quiet: true) } })
            } else if c.canConnect {
                PhoneSettingsRow(c.connectLabel, action: { Task { await model.run(.libraryCloudConnect, ["provider": .string(c.provider)]) } })
            }
            if c.canSignOut && !waiting {
                PhoneSettingsDestructiveRow(label: "Sign out of \(c.name)", confirm: "Sign out", message: "Folevi stops syncing with \(c.name). Your notes stay on this device and in \(c.name). To sync again, connect again or move the library somewhere else.") {
                    Task { await model.run(.libraryCloudSignOut) }
                }
            }
        }
    }

    @ViewBuilder private func move(_ d: LibraryData) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Folevi copies every file to the new place, checks each one arrived, then uses it. Keep Folevi open until it's done. Other devices need to be moved too.")
                .webText(PhoneType.subheadline(leading: 18))
                .foregroundStyle(C(FoleviTokens.Chrome.inkMuted, scheme))
                .padding(.horizontal, 16)
            PhoneSettingsGroup {
                ForEach(d.place.moveChoices) { c in
                    PhoneSettingsRow(c.title, description: c.detail, chevron: true, disabled: model.busy.contains("library.move"), action: {
                        Task { await model.run(.libraryMove, ["kind": .string(c.kind)]) }
                    })
                }
            }
        }
    }
}

/// Encrypt, change or remove the library's passphrase: secure fields and one button.
private struct PassphraseSheet: View {
    let model: PhoneSettingsModel
    let kind: PhoneLibrarySettings.PassphrasePrompt
    let min: Int
    @State private var current = ""
    @State private var next = ""
    @State private var again = ""
    @Environment(\.dismiss) private var dismiss

    private var title: String {
        switch kind {
        case .set: "Encrypt the library"
        case .change: "Change passphrase"
        case .remove: "Remove passphrase"
        }
    }

    private var ready: Bool {
        switch kind {
        case .set: next.count >= min && next == again
        case .change: !current.isEmpty && next.count >= min && next == again
        case .remove: !current.isEmpty
        }
    }

    var body: some View {
        PhoneSheetPanel(title: title, close: { dismiss() }) {
            PhoneSettingsPage {
                PhoneSettingsGroup(footer: kind == .remove ? "The library's files are written again without encryption." : "At least \(min) characters. If it's lost, the synced copy can't be recovered.") {
                    if kind != .set { field("Current", $current) }
                    if kind != .remove {
                        field("New", $next)
                        field("Again", $again)
                    }
                }
                PhoneSettingsGroup {
                    PhoneSettingsRow(title, danger: kind == .remove, disabled: !ready, action: save)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func field(_ label: String, _ text: Binding<String>) -> some View {
        HStack(spacing: 12) {
            Text(label).webText(PhoneType.body()).lineLimit(1)
            SecureField("Passphrase", text: text).font(Font(PhoneType.body().ctFont)).multilineTextAlignment(.trailing)
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 52)
        .phoneSeparatorInset(16)
    }

    private func save() {
        Task {
            let r: JSONValue?
            switch kind {
            case .set: r = await model.run(.librarySetPassphrase, ["passphrase": .string(next)])
            case .change: r = await model.run(.libraryChangePassphrase, ["current": .string(current), "passphrase": .string(next)])
            case .remove: r = await model.run(.libraryRemovePassphrase, ["current": .string(current)])
            }
            if r != nil { dismiss() }
        }
    }
}

// MARK: AI on the device

struct LocalAiData: Decodable {
    struct Key: Decodable, Identifiable { var provider: String, label: String, stored: Bool, status: String, canTest: Bool, canAdd: Bool, keyUrl: String?; var id: String { provider } }
    struct Option: Decodable { var value: String, label: String }
    struct ModelInfo: Decodable {
        var missing: String?
        var description: String?
        var providers: [Option]
        var provider: String
        var modelLabel: String?
        var models: [Option]
        var model: String?
        var note: String
        var answering: String?
    }
    struct OnDevice: Decodable { var title: String, status: String, name: String, text: String }
    struct Phone: Decodable { var onText: String, onDeviceValue: String, onDeviceFooter: String, historyText: String, noHost: String, phoneDevice: Bool }
    var hosted: Bool, loaded: Bool, on: Bool, history: Bool
    var onDevice: OnDevice
    var keysDescription: String
    var keys: [Key]
    var model: ModelInfo
    var phone: Phone
}

struct PhoneLocalAi: View {
    let model: PhoneSettingsModel
    let screen: String?
    @State private var keyText = ""

    static func providerLabel(_ p: String) -> String {
        switch p {
        case "openai": "OpenAI"
        case "anthropic": "Anthropic"
        case "google": "Google"
        default: p.capitalized
        }
    }

    var body: some View {
        if let d = model.query(.localAi).data(LocalAiData.self) {
            switch screen {
            case "ai-provider":
                PhoneSettingsChoiceList(label: "Provider", value: d.model.provider, choices: d.model.providers.map { PhoneSettingsChoice(value: $0.value, label: $0.label) }) { v in
                    Task { await model.run(.localAiSetChoice, ["provider": .string(v)]) }
                }
            case "ai-model":
                PhoneSettingsChoiceList(label: "Model", value: d.model.model ?? "", choices: d.model.models.map { PhoneSettingsChoice(value: $0.value, label: $0.label) }) { v in
                    Task { await model.run(.localAiSetChoice, ["provider": .string(d.model.provider), "model": .string(v)]) }
                }
            case let s? where s.hasPrefix("ai-key-"):
                if let key = d.keys.first(where: { "ai-key-\($0.provider)" == s }) { keyScreen(key) }
            default:
                main(d)
            }
        }
    }

    @ViewBuilder private func main(_ d: LocalAiData) -> some View {
        PhoneSettingsGroup(footer: d.phone.onText) {
            PhoneSettingsSwitchRow("Foli AI", on: d.on, change: { on in Task { await model.perform(.settingsUpdate(aiEnabled: on), done: on ? "Foli AI turned on" : "Foli AI turned off") } }) { PhoneRowIcon(.sparkles) }
        }
        if !d.hosted {
            PhoneSettingsGroup(d.onDevice.title) { PhoneSettingsText(text: d.phone.noHost, muted: true) }
        } else {
            PhoneSettingsGroup(d.onDevice.title, footer: d.phone.onDeviceFooter) {
                PhoneSettingsRow(d.onDevice.name == "Apple Intelligence" || d.onDevice.status == "available" ? d.onDevice.name : d.onDevice.name, value: d.phone.onDeviceValue) { PhoneRowIcon(d.phone.phoneDevice ? .smartphone : .laptop) }
            }
            PhoneSettingsGroup("Your own keys", footer: d.keysDescription) {
                ForEach(d.keys) { k in
                    PhoneSettingsRow(k.label, value: k.stored ? "Added" : "Not added", chevron: true, disabled: !k.canAdd && !k.stored, action: { model.open("/settings/ai?screen=ai-key-\(k.provider)") }) { PhoneRowIcon(.keyRound) }
                }
            }
            if let missing = d.model.missing {
                PhoneSettingsGroup("Model") { PhoneSettingsText(text: missing, muted: true) }
            } else {
                PhoneSettingsGroup("Model", footer: [d.model.description, d.model.answering].compactMap { $0 }.joined(separator: "\n")) {
                    PhoneSettingsRow("Provider", value: d.model.providers.first { $0.value == d.model.provider }?.label ?? "", chevron: true, action: { model.open("/settings/ai?screen=ai-provider") })
                    if !d.model.models.isEmpty {
                        PhoneSettingsRow("Model", value: d.model.models.first { $0.value == d.model.model }?.label ?? d.model.model ?? "", chevron: true, action: { model.open("/settings/ai?screen=ai-model") })
                    }
                }
            }
        }
        PhoneSettingsGroup(footer: d.phone.historyText) {
            PhoneSettingsSwitchRow("Keep conversations", on: d.history, change: { on in
                Task { await model.mutate("users.updateProfile", ["aiPrefs": .object(["history": .bool(on)])], done: on ? "Conversations are kept" : "New conversations aren't kept") }
            }) { PhoneRowIcon(.messagesSquare) }
        }
    }

    @ViewBuilder private func keyScreen(_ k: LocalAiData.Key) -> some View {
        if k.stored {
            PhoneSettingsGroup(footer: k.status) {
                if k.canTest {
                    PhoneSettingsRow("Test key", disabled: model.busy.contains("localAi.testKey"), action: {
                        Task {
                            if let r = await model.run(.localAiTestKey, ["provider": .string(k.provider)], quiet: true), let t = r["text"]?.string { model.toast(t, false) }
                        }
                    })
                }
                PhoneSettingsDestructiveRow(label: "Remove key", confirm: "Remove the \(k.label) key") { Task { await model.run(.localAiRemoveKey, ["provider": .string(k.provider)]) } }
            }
        } else {
            PhoneSettingsGroup(footer: "Paste the key from your \(k.label) account.") {
                HStack(spacing: 12) {
                    Text("Key").webText(PhoneType.body()).lineLimit(1)
                    SecureField("Paste your \(k.label) key", text: $keyText).font(Font(PhoneType.body().ctFont)).multilineTextAlignment(.trailing)
                }
                .padding(.horizontal, 16)
                .frame(minHeight: 52)
            }
            PhoneSettingsGroup {
                PhoneSettingsRow("Save", disabled: keyText.trimmingCharacters(in: .whitespaces).isEmpty, action: {
                    Task {
                        if await model.run(.localAiSetKey, ["provider": .string(k.provider), "key": .string(keyText)]) != nil { keyText = "" }
                    }
                })
                if let url = k.keyUrl.flatMap(URL.init(string:)) {
                    Link(destination: url) { PhoneSettingsRow("Get a key from \(k.label)", chevron: true) }
                }
            }
        }
    }
}

// MARK: Appearance

struct PhoneAppearanceSettings: View {
    let model: PhoneSettingsModel
    let screen: String?

    /// AppearanceSettings.editorZooms (editorZoom.ts EDITOR_ZOOMS).
    static let zooms: [Double] = [0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.15, 1.2, 1.25, 1.3, 1.35]

    private static func pct(_ v: Double) -> String { "\(Int((v * 100).rounded()))%" }

    var body: some View {
        let a = model.appearance.value
        let theme = a?.appearance.rawValue ?? model.session.value?.appearance.rawValue ?? "system"
        let zoom = a?.editorZoom ?? 1
        let closest = Self.zooms.min { abs($0 - zoom) < abs($1 - zoom) } ?? 1
        let themes = [
            PhoneSettingsChoice(value: "light", label: "Light", icon: .sun),
            PhoneSettingsChoice(value: "dark", label: "Dark", icon: .moon),
            PhoneSettingsChoice(value: "system", label: "System", description: "Follows this device's Light or Dark appearance", icon: .monitor),
        ]
        switch screen {
        case "theme":
            PhoneSettingsChoiceList(label: "Theme", value: theme, choices: themes) { v in
                Task { await model.perform(.settingsUpdate(appearance: SettingsUpdateArgs.Appearance(rawValue: v))) }
            }
        case "editor-text-size":
            PhoneSettingsChoiceList(label: "Editor text size", value: String(closest), choices: Self.zooms.map { PhoneSettingsChoice(value: String($0), label: $0 == 1 ? "\(Self.pct($0)) (default)" : Self.pct($0)) }) { v in
                Task { await model.perform(.settingsUpdate(editorZoom: Double(v))) }
            }
        default:
            PhoneSettingsGroup(footer: "Dark mode is designed, not inverted: note colours are softened and code stays readable.") {
                PhoneSettingsRow("Theme", value: themes.first { $0.value == theme }?.label ?? "System", chevron: true, action: { model.open("/settings/appearance?screen=theme") }) {
                    PhoneRowIcon(theme == "dark" ? .moon : theme == "light" ? .sun : .monitor)
                }
            }
            PhoneSettingsGroup(footer: "The size of a note's text in the editor, on this device. iOS's own text size changes everything else.") {
                PhoneSettingsRow("Editor text size", value: Self.pct(closest), chevron: true, action: { model.open("/settings/appearance?screen=editor-text-size") }) { PhoneRowIcon(.type) }
            }
        }
    }
}

// MARK: Import & export

struct PhoneDataSettings: View {
    let model: PhoneSettingsModel
    let workspace: SpaceInfo?
    let screen: String?
    @State private var picking: Picking?
    @State private var progress = ""
    @State private var importing = false
    @State private var exporting = false
    @State private var exportNote: String?
    @State private var results: [Result] = []

    enum Picking: Identifiable { case files, folder; var id: Self { self } }

    struct Result: Decodable, Identifiable {
        struct Warning: Decodable { var line: Int?; var message: String }
        var name: String, id: String?, warnings: [Warning], error: String?, images: Int?
        var key: String { "\(name)|\(id ?? "")|\(error ?? "")" }
        var identity: String { key }
    }

    private var whereName: String { workspace?.name ?? "Personal" }

    static let importHelp = "Markdown and text files, a folder or a ZIP (an Obsidian vault works), a Notion export (Export, Markdown & CSV, as a ZIP), an Evernote export (.enex), Word documents (.docx), HTML and CSV files. Pages keep their headings, lists, to-dos, links, code, quotes, tables and images; Notion pages stay nested and linked, a folder or ZIP keeps its subfolders, and Evernote notes go into a folder named after the notebook. Anything we can't convert is kept as text and listed in the results."

    var body: some View {
        if screen == "import-results" {
            PhoneSettingsGroup {
                ForEach(results, id: \.key) { r in
                    let detail = r.error ?? ([r.images.map { $0 == 1 ? "1 image uploaded" : "\($0) images uploaded" }].compactMap { $0 } + r.warnings.map { "\($0.line.map { "Line \($0): " } ?? "")\($0.message)" }).joined(separator: " · ")
                    PhoneSettingsRow(r.name, description: detail.isEmpty ? "Imported without changes." : detail, chevron: r.id != nil, action: r.id.map { id in { model.open("/d/\(id)") } })
                }
            }
        } else {
            PhoneSettingsGroup("Import into \(whereName)", footer: Self.importHelp) {
                PhoneSettingsRow(importing ? "Importing…" : "Choose files", disabled: importing, action: { picking = .files }) { PhoneRowIcon(.upload) }
                PhoneSettingsRow("Import a folder", disabled: importing, action: { picking = .folder }) { PhoneRowIcon(.folderUp) }
                if !progress.isEmpty { PhoneSettingsText(text: progress, muted: true) }
                if !results.isEmpty {
                    let failed = results.filter { $0.error != nil }.count
                    PhoneSettingsRow("Results", value: failed > 0 ? "\(results.count - failed) imported, \(failed) failed" : "\(results.count) imported", chevron: true, action: { model.open("/settings/\(workspace == nil ? "data" : "workspace-data")?screen=import-results") })
                }
            }
            .fileImporter(isPresented: Binding(get: { picking != nil }, set: { if !$0 { picking = nil } }), allowedContentTypes: picking == .folder ? [.folder] : ["md", "markdown", "txt", "zip", "enex", "docx", "html", "htm", "csv", "png", "jpg", "jpeg", "gif", "webp"].compactMap { UTType(filenameExtension: $0) }, allowsMultipleSelection: picking != .folder) { result in
                let folder = picking == .folder
                guard case .success(let urls) = result else { return }
                run(folder ? urls.first.map(Self.files(inFolder:)) ?? [] : urls.map { ($0, "") })
            }
            PhoneSettingsGroup("Export \(whereName)", footer: exportNote ?? "A ZIP with every note in \(whereName) as Markdown (in folders matching your sidebar), all attachments in an assets folder, and a manifest.json describing folders, notes and files. One note can be exported from its … menu as Markdown, HTML or PDF.") {
                PhoneSettingsRow(exporting ? "Preparing…" : "Export \(whereName) (.zip)", disabled: exporting, action: export)
            }
        }
    }

    static func files(inFolder root: URL) -> [(URL, String)] {
        let scoped = root.startAccessingSecurityScopedResource()
        defer { if scoped { root.stopAccessingSecurityScopedResource() } }
        let base = root.deletingLastPathComponent().path
        let e = FileManager.default.enumerator(at: root, includingPropertiesForKeys: [.isRegularFileKey], options: [.skipsHiddenFiles])
        var out: [(URL, String)] = []
        while let u = e?.nextObject() as? URL {
            guard (try? u.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true else { continue }
            out.append((u, String(u.path.dropFirst(base.count + 1))))
        }
        return out
    }

    private static func payload(_ files: [(URL, String)]) -> JSONValue {
        .array(files.compactMap { url, path in
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            guard let data = try? Data(contentsOf: url) else { return nil }
            let type = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? ""
            return .object(["name": .string(url.lastPathComponent), "path": .string(path), "type": .string(type), "data": .string(data.base64EncodedString())])
        })
    }

    private func run(_ files: [(URL, String)]) {
        guard !files.isEmpty else { return }
        importing = true
        results = []
        progress = "Reading files…"
        Task {
            var args: [String: JSONValue] = ["files": Self.payload(files)]
            if let w = workspace { args["workspaceId"] = .string(w.id) }
            progress = files.count == 1 ? "Importing \(files[0].0.lastPathComponent)…" : "Importing \(files.count) files…"
            let r = await model.run(.dataImport, args, quiet: true)
            progress = ""
            importing = false
            guard case .object(let o)? = r else { return }
            if case .array(let notes)? = o["notes"] { for case .string(let n) in notes { model.toast(n, false) } }
            results = o["results"]?.decoded([Result].self) ?? []
            if case .string(let m)? = o["message"] { model.toast(m, o["allOk"] != .bool(true)) }
        }
    }

    private func export() {
        exporting = true
        exportNote = nil
        Task {
            let scope: JSONValue = workspace.map { .object(["kind": .string("workspace"), "workspaceId": .string($0.id)]) } ?? .object(["kind": .string("personal")])
            let r = await model.mutate("exports.exportScope", ["scope": scope], action: true)
            exporting = false
            guard case .object(let o)? = r else { return }
            if case .string(let s)? = o["url"], let url = URL(string: s), url.scheme?.hasPrefix("http") == true { await UIApplication.shared.open(url) }
            let docs = o["documents"].flatMap { if case .number(let n) = $0 { Int(n) } else { nil } } ?? 0
            let assets = o["assets"].flatMap { if case .number(let n) = $0 { Int(n) } else { nil } } ?? 0
            if case .array(let skipped)? = o["skippedAssets"], !skipped.isEmpty {
                let names = skipped.prefix(5).compactMap { if case .string(let s) = $0 { s } else { nil } }.joined(separator: ", ")
                let why = o["skippedReason"] == .string("size") ? "the export reached its 400 MB size limit" : "they couldn’t be read"
                exportNote = "\(skipped.count == 1 ? "1 attachment was" : "\(skipped.count) attachments were") left out because \(why): \(names)\(skipped.count > 5 ? "…" : ""). They’re listed in manifest.json."
                model.toast("Exported \(docs) documents; \(skipped.count) attachments were left out", true)
            } else {
                model.toast("Exported \(docs) documents and \(assets) attachments", false)
            }
        }
    }
}

// MARK: This device

struct PhoneThisDeviceSettings: View {
    let model: PhoneSettingsModel
    let host: PhoneSettingsHost
    let screen: String?
    @State private var lock: (on: Bool, after: Int, method: String)?
    @State private var busy = false

    static let after: [(Int, String)] = [(0, "Immediately"), (60, "After 1 minute"), (300, "After 5 minutes"), (900, "After 15 minutes")]

    private func methodName(_ m: String) -> String {
        switch m {
        case "touchID": "Touch ID"
        case "opticID": "Optic ID"
        case "passcode": "your passcode"
        default: "Face ID"
        }
    }

    var body: some View {
        let l = lock ?? host.lock()
        Group {
            if screen == "lock-after" {
                PhoneSettingsChoiceList(label: "Ask again", value: String(l.after), choices: Self.after.map { PhoneSettingsChoice(value: String($0.0), label: $0.1) }, footer: "When you come back after Folevi has been in the background this long.") { v in
                    host.setLockAfter(Int(v) ?? 0)
                    lock = host.lock()
                }
            } else {
                let method = methodName(l.method)
                let label = l.method == "passcode" ? "Lock with passcode" : "Lock with \(method)"
                PhoneSettingsGroup("Lock", footer: "Folevi asks for \(method) when it opens, and hides your notes in the app switcher. This is kept on this device only. \(l.method == "none" ? "Set a passcode for this device in the Settings app first." : "Turning it on asks for \(method) once.")") {
                    PhoneSettingsSwitchRow(label, on: l.on, disabled: busy || (l.method == "none" && !l.on), change: { on in
                        busy = true
                        Task {
                            await host.setLock(on)
                            lock = host.lock()
                            busy = false
                        }
                    }) { PhoneRowIcon(.lockKeyhole) }
                    if l.on {
                        PhoneSettingsRow("Ask again", value: Self.after.first { $0.0 == l.after }?.1 ?? "", chevron: true, disabled: busy, action: { model.open("/settings/this-device?screen=lock-after") })
                    }
                }
            }
        }
        .onAppear { lock = host.lock() }
    }
}
#endif
