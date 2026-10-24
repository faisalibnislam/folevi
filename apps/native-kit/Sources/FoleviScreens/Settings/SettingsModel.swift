// Settings (plan 5.10, work package N13; owner decision Q1): the common sections are native, from the engine's
// revision 6 views (`account.details`, `settings.account`, `.general`, `.appearance`, `.notifications`, `.ai`,
// `.security`) and their commands; Connected apps (API tokens, webhooks, MCP), AI export, Data and a workspace's
// Data open as in-app web pages (`web.show`). No in-app buying on iOS: the plan's name and storage only, no prices,
// buttons or links (App Store rule 3.1.1, lib/nativeApp.ts `canPurchaseHere`); the Mac follows today's Mac app,
// whose Settings window has no billing section either.
//
// Each section's view starts when the section is first shown and stays live while the model lives.
import Foundation
import Observation
import FoleviEngine

/// The sections, in the order the web's Settings lists them.
public enum SettingsSection: String, CaseIterable, Identifiable, Hashable, Sendable {
    case account, general, appearance, notifications, ai, security, privacy, thisDevice, connectedApps, data, aiExport, workspaceData, help, about

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .account: "Account"
        case .general: "General"
        case .appearance: "Appearance"
        case .notifications: "Notifications"
        case .ai: "Foli AI"
        case .security: "Security"
        case .privacy: "Privacy"
        case .thisDevice: "This device"
        case .connectedApps: "Connected apps"
        case .data: "Import & Export"
        case .aiExport: "Export Foli AI data"
        case .workspaceData: "Workspace data"
        case .help: "Help"
        case .about: "About"
        }
    }

    public var symbol: String {
        switch self {
        case .account: "person.crop.circle"
        case .general: "gearshape"
        case .appearance: "paintpalette"
        case .notifications: "bell"
        case .ai: "sparkles"
        case .security: "lock.shield"
        case .privacy: "hand.raised"
        case .thisDevice: "internaldrive"
        case .connectedApps: "app.connected.to.app.below.fill"
        case .data: "arrow.up.arrow.down"
        case .aiExport: "square.and.arrow.up"
        case .workspaceData: "building.2"
        case .help: "questionmark.circle"
        case .about: "info.circle"
        }
    }

    /// The web page a technical section opens (owner decision Q1), or nil for a native section.
    public var webPage: WebPage? {
        switch self {
        case .connectedApps: .settingsConnectedApps
        case .data: .settingsData
        case .aiExport: .settingsAiExport
        case .workspaceData: .settingsWorkspaceData
        default: nil
        }
    }

    /// The Mac's Settings window sections this one stands for (SettingsWindow.swift ids).
    public init?(macId: String) {
        switch macId {
        case "account": self = .account
        case "desktop", "general": self = .general
        case "appearance": self = .appearance
        case "notifications": self = .notifications
        case "ai": self = .ai
        case "security", "devices": self = .security
        case "privacy": self = .privacy
        case "sync", "library", "thisDevice": self = .thisDevice
        case "data": self = .data
        default: return nil
        }
    }
}

/// What Settings asks of the app around it (the frame on iOS, the Settings window on the Mac).
public struct SettingsHost {
    /// "1.0.03" (CFBundleShortVersionString). Shown as "Folevi 1.0.03": the unified version, no build number.
    public var version: String
    /// Opens a link outside the app (help pages, the privacy policy).
    public var openURL: @MainActor (URL) -> Void
    /// Opens a technical section as an in-app web page; the default asks the engine (`web.show`).
    public var showWeb: (@MainActor (WebPage) -> Void)?
    /// Signs this account out on this device (ShellAuth, then the page reloads).
    public var signOut: (@MainActor () -> Void)?
    /// The Face ID / Touch ID lock (AppLock.swift, MacAppLock.swift), when this device can have one.
    public var appLock: (any AppLockSettings)?
    /// Picks a profile picture: its bytes and type ("image/jpeg"), or nil when cancelled. Nil hides "Change".
    public var pickAvatar: (@MainActor () async -> (data: Data, mimeType: String)?)?

    public init(version: String, openURL: @escaping @MainActor (URL) -> Void = { _ in }, showWeb: (@MainActor (WebPage) -> Void)? = nil, signOut: (@MainActor () -> Void)? = nil, appLock: (any AppLockSettings)? = nil, pickAvatar: (@MainActor () async -> (data: Data, mimeType: String)?)? = nil) {
        self.version = version
        self.openURL = openURL
        self.showWeb = showWeb
        self.signOut = signOut
        self.appLock = appLock
        self.pickAvatar = pickAvatar
    }
}

@MainActor
@Observable
public final class SettingsModel {
    public let client: EngineClient
    public let host: SettingsHost
    let feedback: ScreenFeedback
    let platform: SettingsPlatform

    public let session: ValueStore<SessionValue>
    public let details: ValueStore<AccountDetails>
    public private(set) var account: ValueStore<AccountSettings>?
    public private(set) var general: ValueStore<GeneralSettings>?
    public private(set) var appearance: ValueStore<AppearanceSettings>?
    public private(set) var notifications: ValueStore<NotificationSettings>?
    public private(set) var ai: ValueStore<AiSettings>?
    public private(set) var security: ValueStore<SecuritySettings>?

    /// Values changed here and not yet confirmed by the engine's view, by key ("ai.memory", "topic.comments.email").
    public private(set) var overrides: [String: Bool] = [:]
    public private(set) var appearanceOverride: AppearanceSettings.Appearance?
    /// Commands still running, by key.
    public private(set) var running: Set<String> = []

    public init(client: EngineClient, host: SettingsHost, feedback: ScreenFeedback = ScreenFeedback(), platform: SettingsPlatform = .current) {
        self.client = client
        self.host = host
        self.feedback = feedback
        self.platform = platform
        self.session = client.watch(.session, snapshotKey: "session.\(client.place)")
        self.details = client.watch(.accountDetails)
    }

    // MARK: Which sections

    public var isLocal: Bool { session.value?.mode == .local }
    public var aiOn: Bool { session.value?.capabilities.ai ?? true }
    /// Whether this person manages the workspace that's open (its Data page).
    public var managesWorkspace: Bool {
        guard let s = session.value, let space = s.spaces.first(where: { $0.id == s.space }) else { return false }
        return space.kind == .workspace && space.canManage
    }

    /// The sections, grouped as the list shows them.
    public var groups: [[SettingsSection]] {
        if isLocal {
            return [[.general, .appearance, .ai], [.privacy], [.data], [.help, .about]]
        }
        var tech: [SettingsSection] = [.connectedApps, .data]
        if aiOn { tech.append(.aiExport) }
        if managesWorkspace { tech.append(.workspaceData) }
        // This device (storage, "Keep all notes on this device") joins when the bridge has it (contract request R13.3).
        return [[.account], [.general, .appearance, .notifications, .ai], [.security, .privacy], tech, [.help, .about]]
    }

    public var sections: [SettingsSection] { groups.flatMap { $0 } }

    /// Starts the views a section reads (once).
    public func open(_ section: SettingsSection) {
        switch section {
        case .account: if account == nil { account = client.watch(.settingsAccount) }
        case .general: if general == nil { general = client.watch(.settingsGeneral) }
        case .appearance: if appearance == nil { appearance = client.watch(.settingsAppearance) }
        case .notifications: if notifications == nil { notifications = client.watch(.settingsNotifications) }
        case .ai: if ai == nil { ai = client.watch(.settingsAi) }
        case .security: if security == nil { security = client.watch(.settingsSecurity) }
        default: break
        }
    }

    /// A technical section: the in-app web page with native bars.
    public func showWeb(_ section: SettingsSection) {
        guard let page = section.webPage else { return }
        if let show = host.showWeb {
            show(page)
            return
        }
        Task {
            do { _ = try await client.editor(.webShow(page: page)) } catch { fail(error) }
        }
    }

    // MARK: Account

    public var profileName: String { account?.value?.name ?? details.value?.profile.name ?? session.value?.profile.name ?? "" }
    public var email: String { account?.value?.email ?? details.value?.profile.email ?? session.value?.profile.email ?? "" }
    public var avatarURL: URL? { (account?.value?.avatarUrl ?? details.value?.profile.avatarUrl).flatMap(URL.init(string:)) }

    /// "Pro", "Pro AI", "Free trial of Pro" (the plan as it is; never a price or a way to change it on iOS).
    public var planName: String? {
        guard let plan = details.value?.plan else { return nil }
        let name = Self.tierName(plan.tier)
        return plan.trialing ? "\(name) (trial)" : name
    }

    static func tierName(_ tier: String) -> String {
        switch tier {
        case "free": "Free"
        case "core": "Core"
        case "pro": "Pro"
        case "pro_ai": "Pro AI"
        case "team": "Team"
        case "business": "Business"
        default: tier.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }

    /// "1.2 GB of 10 GB used".
    public var storageText: String? {
        guard let s = details.value?.storage else { return nil }
        let used = Self.bytes(s.usedBytes)
        return s.limitBytes.map { "\(used) of \(Self.bytes($0)) used" } ?? "\(used) used"
    }

    public var storageFraction: Double? {
        guard let s = details.value?.storage, let limit = s.limitBytes, limit > 0 else { return nil }
        return min(1, Double(s.usedBytes) / Double(limit))
    }

    /// "3 of 5 devices", "3 devices".
    public var devicesText: String? {
        guard let d = details.value, let active = d.devicesActive else { return nil }
        let word = active == 1 ? "device" : "devices"
        return d.deviceLimit.map { "\(active) of \($0) \($0 == 1 ? "device" : "devices")" } ?? "\(active) \(word)"
    }

    /// The web's formatBytes: "1 GB", "1.5 GB", "20 GB", "750 MB".
    static func bytes(_ n: Int) -> String {
        func fixed(_ v: Double, _ small: Bool) -> String {
            let s = String(format: small ? "%.1f" : "%.0f", v)
            return s.hasSuffix(".0") ? String(s.dropLast(2)) : s
        }
        let d = Double(n)
        if d < 1024 * 1024 { return "\(max(0, Int((d / 1024).rounded()))) KB" }
        if d < 1024 * 1024 * 1024 { return "\(fixed(d / 1024 / 1024, d < 10 * 1024 * 1024)) MB" }
        return "\(fixed(d / 1024 / 1024 / 1024, d < 10 * 1024 * 1024 * 1024)) GB"
    }

    public func rename(_ name: String) async {
        let trimmed = String(name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(80))
        guard !trimmed.isEmpty, trimmed != profileName else { return }
        await run("name") { _ = try await self.client.command(.settingsUpdate(name: trimmed)) }
    }

    public func setTimeZone(_ zone: String) async {
        await run("timeZone") { _ = try await self.client.command(.settingsUpdate(timeZone: zone)) }
    }

    public func removeAvatar() async {
        await run("avatar") { _ = try await self.client.command(.settingsRemoveAvatar) }
    }

    /// The web's limits: an image (JPEG, PNG, WebP, GIF) of at most 2 MB.
    public static let avatarTypes: Set<String> = ["image/jpeg", "image/png", "image/webp", "image/gif"]
    public static let avatarMaxBytes = 2 * 1024 * 1024

    public func setAvatar(_ data: Data, mimeType: String) async {
        guard Self.avatarTypes.contains(mimeType) else { return failMessage("Choose a JPEG, PNG, WebP or GIF image.") }
        guard data.count <= Self.avatarMaxBytes else { return failMessage("Choose an image under 2 MB.") }
        await run("avatar") { _ = try await self.client.command(.settingsSetAvatar(data: data.base64EncodedString(), mimeType: mimeType)) }
    }

    public func changeAvatar() async {
        guard let pick = host.pickAvatar, let picked = await pick() else { return }
        await setAvatar(picked.data, mimeType: picked.mimeType)
    }

    public var timeZone: String { general?.value?.timeZone ?? account?.value?.timeZone ?? session.value?.timeZone ?? TimeZone.current.identifier }

    // MARK: General

    public var reviewAppEdits: Bool { overrides["general.reviewAppEdits"] ?? general?.value?.reviewAppEdits ?? false }

    public func setReviewAppEdits(_ on: Bool) async {
        await toggle("general.reviewAppEdits", on) { _ = try await self.client.command(.settingsUpdate(reviewAppEdits: on)) }
    }

    // MARK: Appearance

    public var currentAppearance: AppearanceSettings.Appearance {
        appearanceOverride ?? appearance?.value?.appearance ?? session.value.map { AppearanceSettings.Appearance(rawValue: $0.appearance.rawValue) ?? .system } ?? .system
    }

    public func setAppearance(_ value: AppearanceSettings.Appearance) async {
        guard value != currentAppearance else { return }
        appearanceOverride = value
        feedback.haptic(.selection)
        do {
            _ = try await client.command(.settingsUpdate(appearance: SettingsUpdateArgs.Appearance(rawValue: value.rawValue)))
            settle { self.appearanceOverride = nil }
        } catch {
            appearanceOverride = nil
            fail(error)
        }
    }

    // MARK: Notifications

    public func topicOn(_ topic: NotificationTopicSetting, email: Bool) -> Bool {
        overrides["topic.\(topic.id).\(email ? "email" : "inApp")"] ?? (email ? topic.email : topic.inApp)
    }

    public func setTopic(_ topic: NotificationTopicSetting, email: Bool, on: Bool) async {
        let key = "topic.\(topic.id).\(email ? "email" : "inApp")"
        await toggle(key, on) {
            _ = try await self.client.command(email ? .settingsSetNotificationTopic(topic: topic.id, email: on) : .settingsSetNotificationTopic(topic: topic.id, inApp: on))
        }
    }

    /// "In app, email", "In app", "Email", "Off" (the web's row value).
    public func topicSummary(_ topic: NotificationTopicSetting) -> String {
        switch (topicOn(topic, email: false), topicOn(topic, email: true)) {
        case (true, true): "In app, email"
        case (true, false): "In app"
        case (false, true): "Email"
        case (false, false): "Off"
        }
    }

    public var dailyDigest: Bool { overrides["notif.digest"] ?? (notifications?.value?.digest == "daily") }
    public var productEmail: Bool { overrides["notif.productEmail"] ?? notifications?.value?.productEmail ?? false }

    public func setDailyDigest(_ on: Bool) async {
        await toggle("notif.digest", on) { _ = try await self.client.command(.settingsSetNotificationEmails(digest: on ? .daily : .off)) }
    }

    public func setProductEmail(_ on: Bool) async {
        await toggle("notif.productEmail", on) { _ = try await self.client.command(.settingsSetNotificationEmails(productEmail: on)) }
    }

    // MARK: Foli AI

    public var aiIncluded: Bool { ai?.value?.included ?? false }
    public var aiEnabled: Bool { overrides["ai.enabled"] ?? ai?.value?.enabled ?? false }

    public func setAiEnabled(_ on: Bool) async {
        await toggle("ai.enabled", on) { _ = try await self.client.command(.settingsUpdate(aiEnabled: on)) }
    }

    public func aiPref(_ key: AiPrefKey) -> Bool {
        if let o = overrides["ai.\(key.rawValue)"] { return o }
        guard let v = ai?.value else { return false }
        switch key {
        case .history: return v.history
        case .memory: return v.memory
        case .suggestions: return v.suggestions
        case .attachments: return v.attachments
        case .webResearch: return v.webResearch
        case .digests: return v.digests
        case .readImages: return v.readImages
        case .deviceText: return v.deviceText
        }
    }

    public func setAiPref(_ key: AiPrefKey, _ on: Bool) async {
        await toggle("ai.\(key.rawValue)", on) { _ = try await self.client.command(.settingsSetAiPref(key: key, on: on)) }
    }

    /// The web's AiSection rows (label and what it does), in its order; `readImages` is the browser's, so the apps
    /// show "Read text on your devices" in its place.
    public static let aiPrefs: [(key: AiPrefKey, label: String, body: String)] = [
        (.history, "Keep conversations", "Your AI conversations are saved so you can come back to them, rename, pin and search them. Only you can see them, unless you share one with your workspace."),
        (.memory, "Memory", "Let Foli AI remember things you approve, like the tone you like or words you use. You'll see and edit everything it remembers."),
        (.suggestions, "Suggestions", "Quiet hints at the end of a note, such as related notes, possible duplicates, open questions and action items. They're found without sending anything to AI."),
        (.attachments, "Read attachments", "Let Foli AI read files you add to a question, such as PDFs, images, text and spreadsheets, and transcribe recordings when you ask. Files are only read when you send them."),
        (.webResearch, "Web research", "Let Foli AI search the web and read pages you link when you ask it to, with links to what it found. This also turns on Research. Searches go through Google Search."),
        (.digests, "Digests", "A daily or weekly summary of what changed in your notes, saved as a note in your Inbox. It uses your AI credits and is never emailed."),
        (.deviceText, "Read text on your devices", "In the iPhone, iPad and Mac apps, the words in your images and handwriting are read on the device, so search finds them. Nothing is sent anywhere. The words in PDFs are always searchable."),
    ]

    // MARK: Security

    public var sessions: [SessionRow] {
        (security?.value?.sessions ?? []).sorted { a, b in a.current != b.current ? a.current : a.lastSeenAt > b.lastSeenAt }
    }

    public func revoke(_ session: SessionRow) async {
        guard !session.current else { return }
        await run("session.\(session.id)") {
            _ = try await self.client.command(.sessionRevoke(id: session.id))
            self.feedback.toast(ScreenToast("Signed out of \(session.label).", tone: .success))
        }
    }

    // MARK: About

    /// "Folevi 1.0.03": the unified version (#.#.##), no build number.
    public var versionText: String { "Folevi \(Self.displayVersion(host.version))" }

    /// Keeps the #.#.## form: "1.0.3" reads "1.0.03"; anything else is shown as given.
    static func displayVersion(_ v: String) -> String {
        let parts = v.split(separator: ".").map(String.init)
        guard parts.count == 3, parts.allSatisfy({ Int($0) != nil }) else { return v }
        let patch = parts[2].count == 1 ? "0\(parts[2])" : parts[2]
        return "\(parts[0]).\(parts[1]).\(patch)"
    }

    // MARK: Running commands

    public func isRunning(_ key: String) -> Bool { running.contains(key) }

    private func toggle(_ key: String, _ on: Bool, _ body: @escaping @MainActor () async throws -> Void) async {
        overrides[key] = on
        feedback.haptic(.selection)
        do {
            try await body()
            settle { self.overrides[key] = nil }
        } catch {
            overrides[key] = nil
            fail(error)
        }
    }

    private func run(_ key: String, _ body: @escaping @MainActor () async throws -> Void) async {
        guard !running.contains(key) else { return }
        running.insert(key)
        defer { running.remove(key) }
        do { try await body() } catch { fail(error) }
    }

    /// Lets the engine's view catch up before the local value goes (no flicker between the reply and the update).
    private func settle(_ clear: @escaping @MainActor () -> Void) {
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(1.5))
            clear()
        }
    }

    private func fail(_ error: any Error) {
        let message = (error as? EngineFailure)?.message ?? "That didn't save. Try again."
        failMessage(message)
    }

    private func failMessage(_ message: String) {
        feedback.toast(ScreenToast(message, tone: .error))
        feedback.haptic(.error)
    }
}

/// Which app the screens are in (what they may offer).
public enum SettingsPlatform: Sendable, Equatable {
    case iOS, mac

    public static var current: SettingsPlatform {
        #if os(macOS)
        return .mac
        #else
        return .iOS
        #endif
    }
}
