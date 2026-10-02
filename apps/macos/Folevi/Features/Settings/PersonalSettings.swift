import SwiftUI

// Settings about you: Appearance, Notifications, Offline & sync and Devices (the web's sections).

struct AppearanceSettings: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        @Bindable var app = app
        SettingsPage {
            SettingsCard(title: String(localized: "Theme"), description: String(localized: "Dark mode is designed, not inverted: document colors are softened and code stays readable.")) {
                HStack(spacing: 12) {
                    tile(.light, String(localized: "Light"), "sun.max")
                    tile(.dark, String(localized: "Dark"), "moon")
                    tile(.system, String(localized: "System"), "desktopcomputer")
                }
                .frame(maxWidth: 448)
                .accessibilityElement(children: .contain)
                .accessibilityLabel(Text("Theme"))
                .accessibilityIdentifier("settings.appearance")
            }
            SettingsCard(title: String(localized: "Editor text size")) {
                HStack(spacing: 12) {
                    Text("Smaller").font(.ui(13))
                    Slider(value: $app.editorScale, in: 0.85...1.35, step: 0.05)
                        .tint(FoleviColor.accent)
                        .accessibilityLabel(Text("Editor text size"))
                        .accessibilityValue(Text("\(Int((app.editorScale * 100).rounded()))%"))
                    Text("Larger").font(.ui(13))
                }
                .foregroundStyle(FoleviColor.ink)
                .frame(maxWidth: 448)
            }
        }
    }

    /// A radio tile: icon above the label, 16 pt padding, 8 pt corners; the chosen one in accent soft.
    private func tile(_ value: AppearancePreference, _ label: String, _ icon: String) -> some View {
        let on = app.appearance == value
        let shape = RoundedRectangle(cornerRadius: 8, style: .continuous)
        return Button {
            app.appearance = value
            if let session = app.session {
                Task { try? await session.account.updateProfile(appearance: value.rawValue) }
            }
        } label: {
            VStack(spacing: 8) {
                Image(systemName: icon).font(.system(size: 17, weight: .regular))
                Text(label).font(.ui(13))
            }
            .foregroundStyle(on ? FoleviColor.accentSoftInk : FoleviColor.ink)
            .frame(maxWidth: .infinity)
            .padding(16)
            .background(shape.fill(on ? FoleviColor.accentSoft : FoleviColor.surface))
            .overlay(shape.strokeBorder(on ? FoleviColor.accent : FoleviColor.line))
            .contentShape(shape)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(label))
        .accessibilityAddTraits(on ? [.isSelected, .isButton] : .isButton)
    }
}

// MARK: - Notifications

struct NotificationSettings: View {
    @Environment(AppModel.self) private var app

    private static let fallback = NotificationPrefs(mentions: true, comments: true, shares: true, invites: true, digest: "off", productEmail: false)

    private var prefs: NotificationPrefs { app.profile?.notificationPrefs ?? Self.fallback }

    var body: some View {
        SettingsPage {
            SettingsCard(title: String(localized: "Notifications"),
                         description: String(localized: "Choose what reaches you in the app (the bell) and by email. Emails say who did what and where, with a link. They never include your notes or comment text. Security emails (new sign-ins, account deletion) can't be turned off.")) {
                VStack(spacing: 0) {
                    HStack(alignment: .bottom, spacing: 8) {
                        Text("Notify me about").frame(maxWidth: .infinity, alignment: .leading)
                        Text("In app").frame(width: 72)
                        Text("Email").frame(width: 72)
                    }
                    .font(.ui(12, .medium))
                    .foregroundStyle(FoleviColor.inkMuted)
                    .padding(.bottom, 8)
                    .accessibilityHidden(true)
                    FoleviColor.line.frame(height: 1)
                    ForEach(Array(NotificationTopic.allCases.enumerated()), id: \.element) { i, topic in
                        if i > 0 { FoleviColor.line.opacity(0.7).frame(height: 1) }
                        HStack(spacing: 8) {
                            VStack(alignment: .leading, spacing: 0) {
                                Text(topic.label).font(.ui(13)).foregroundStyle(FoleviColor.ink)
                                Text(topic.hint).font(.ui(12)).foregroundStyle(FoleviColor.inkMuted)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            SettingsSwitch(label: String(localized: "\(topic.label) in the app"), hint: topic.hint,
                                           isOn: Binding(get: { prefs.inAppOn(topic) }, set: { save(prefs.settingInApp(topic, $0)) }))
                                .frame(width: 72)
                            SettingsSwitch(label: String(localized: "\(topic.label) by email"), hint: topic.hint,
                                           isOn: Binding(get: { prefs.email(topic) }, set: { save(prefs.settingEmail(topic, $0)) }))
                                .frame(width: 72)
                        }
                        .padding(.vertical, 12)
                    }
                }
                .frame(maxWidth: 576)
                .accessibilityElement(children: .contain)
                .accessibilityLabel(Text("Notification preferences"))
            }
            SettingsCard(title: String(localized: "Email delivery"),
                         description: String(localized: "How comment, reply and mention emails arrive. Shares, invitations and access changes are always sent as they happen.")) {
                HStack(spacing: 16) {
                    VStack(alignment: .leading, spacing: 0) {
                        Text("Send comment emails").font(.ui(13)).foregroundStyle(FoleviColor.ink)
                        Text("The daily digest lists what you haven’t read yet, by page title only, once a day.").font(.ui(12)).foregroundStyle(FoleviColor.inkMuted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    WebSelect(selection: Binding(get: { prefs.digest }, set: { var p = prefs; p.digest = $0; save(p) }),
                              options: [.init(value: "off", title: String(localized: "As they happen")), .init(value: "daily", title: String(localized: "In a daily digest"))],
                              accessibilityLabel: String(localized: "Send comment emails"))
                        .frame(width: 176)
                }
                .frame(maxWidth: 576)
            }
            SettingsCard(title: String(localized: "Muted notes"),
                         description: String(localized: "To stop hearing about comments on one note, open its … menu and choose Mute comment notifications. You’ll still hear when someone @mentions you there. Follow a note the same way to hear about every comment on it.")) {
                Text("Nobody is ever notified about their own actions, or about pages they can’t open.").font(.ui(12)).foregroundStyle(FoleviColor.inkMuted)
            }
        }
    }

    private func save(_ next: NotificationPrefs) {
        let before = app.profile?.notificationPrefs
        app.profile?.notificationPrefs = next
        guard let session = app.session, app.sync.isOnline else {
            app.profile?.notificationPrefs = before
            app.showToast(String(localized: "This needs a connection. Try again when you're back online."))
            return
        }
        Task {
            do {
                try await session.account.updateProfile(notificationPrefs: next)
                app.showToast(String(localized: "Saved"))
            } catch {
                app.profile?.notificationPrefs = before
                app.showToast(ConvexService.mapError(error).localizedDescription)
            }
        }
    }
}

// MARK: - Offline & sync

struct SyncSettings: View {
    @Environment(AppModel.self) private var app
    @State private var confirmReset = false

    private var unsent: Int { app.sync.pendingCount }

    var body: some View {
        SettingsPage {
            SettingsCard(title: String(localized: "This device"),
                         description: String(localized: "Folevi keeps your recent documents and every unsent change on this Mac, so you can keep writing offline and nothing is lost if Folevi closes.")) {
                Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 8) {
                    row(String(localized: "Connection")) { Text(app.sync.isOnline ? String(localized: "Online") : String(localized: "Offline")) }
                    row(String(localized: "Changes waiting to sync")) {
                        (Text("\(unsent) ").monospacedDigit() + Text("(Personal, workspaces and shared pages)").font(.ui(12)).foregroundStyle(FoleviColor.inkFaint))
                            .accessibilityIdentifier("settings.pendingCount")
                    }
                    row(String(localized: "Uploads waiting")) { Text("\(app.sync.uploadCount)").monospacedDigit() }
                    row(String(localized: "Unresolved conflicts")) { Text("\(app.sync.conflicts.count)").monospacedDigit() }
                    row(String(localized: "Device id")) {
                        Text(DeviceIdentity.deviceId).font(.system(size: 12, design: .monospaced)).lineLimit(1).truncationMode(.tail)
                    }
                }
                .font(.ui(13))
                .foregroundStyle(FoleviColor.ink)
                .frame(maxWidth: 448, alignment: .leading)
                HStack(spacing: 8) {
                    Button("Sync now") { Task { await app.session?.engine.syncNow() } }
                        .buttonStyle(.folevi(.secondary, .medium))
                    Button("Clear data on this device…") { confirmReset = true }
                        .buttonStyle(.folevi(.quiet, .medium))
                        .foregroundStyle(FoleviColor.destructive)
                }
                .padding(.top, 16)
            }
        }
        .sheet(isPresented: $confirmReset) {
            WebConfirmDialog(title: String(localized: "Clear local data?"),
                             description: unsent > 0
                                ? (unsent == 1
                                   ? String(localized: "1 change hasn’t synced yet and will be lost. Reconnect first if you want to keep it.")
                                   : String(localized: "\(unsent) changes haven’t synced yet and will be lost. Reconnect first if you want to keep them."))
                                : String(localized: "Your documents stay in your account. This Mac will download them again."),
                             confirmTitle: String(localized: "Clear"),
                             onCancel: { confirmReset = false }) {
                confirmReset = false
                Task {
                    await app.session?.engine.resetLocalCache()
                    await app.reloadDocuments()
                    app.showToast(String(localized: "Local data cleared"))
                }
            }
        }
    }

    /// A `dt`/`dd` pair: the label muted in the first half, the value beside it.
    private func row<V: View>(_ label: String, @ViewBuilder value: () -> V) -> some View {
        GridRow {
            Text(label).foregroundStyle(FoleviColor.inkMuted).frame(width: 224, alignment: .leading)
            value().frame(maxWidth: 224, alignment: .leading)
        }
    }
}

// MARK: - Devices

/// Every browser and app signed in to the account, with the plan's device limit (the web's Devices).
struct DevicesSection: View {
    @Environment(AppModel.self) private var app
    @State private var sessions: [SessionInfo]?
    @State private var confirmAll = false

    private var limit: Int? { app.profile?.entitlements?.deviceLimit }
    private var others: Int { (sessions ?? []).filter { !$0.current }.count }

    static func plural(_ n: Int) -> String { n == 1 ? String(localized: "device") : String(localized: "devices") }

    var body: some View {
        SettingsPage {
            SettingsCard(title: String(localized: "Connected devices")) { summary }
            SettingsCard(title: String(localized: "Signed in"),
                         description: String(localized: "Browsers and apps signed in to your account. Signing a device out ends its session right away; it asks for your password and code to sign in again.")) {
                VStack(alignment: .leading, spacing: 0) {
                    if let sessions {
                        ForEach(Array(sessions.enumerated()), id: \.element.id) { i, s in
                            if i > 0 { FoleviColor.line.frame(height: 1) }
                            sessionRow(s)
                        }
                    } else {
                        Text(app.sync.isOnline ? String(localized: "Loading…") : String(localized: "Devices are shown when you're online."))
                            .font(.ui(13)).foregroundStyle(FoleviColor.inkMuted)
                            .padding(.horizontal, 16).padding(.vertical, 12)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .foleviCard(radius: 8)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                Button("Sign out of all other devices") { confirmAll = true }
                    .buttonStyle(.folevi(.secondary, .medium))
                    .disabled(others == 0)
                    .padding(.top, 12)
            }
        }
        .task(id: app.sync.isOnline) { await watch() }
        .sheet(isPresented: $confirmAll) {
            WebConfirmDialog(title: String(localized: "Sign out everywhere else?"),
                             description: String(localized: "\(others) other \(Self.plural(others)) will be signed out right away. This device stays signed in."),
                             confirmTitle: String(localized: "Sign out others"), confirmKind: .primary,
                             onCancel: { confirmAll = false }) {
                confirmAll = false
                app.settingsAction(nil) { session in
                    let ended = try await session.account.signOutOtherDevices()
                    await MainActor.run {
                        app.showToast(ended == 1 ? String(localized: "Signed out 1 other device") : String(localized: "Signed out \(ended) other devices"))
                    }
                }
            }
        }
    }

    private var summary: some View {
        let count = sessions?.count
        return HStack(spacing: 16) {
            Image(systemName: "laptopcomputer.and.iphone")
                .font(.system(size: 18))
                .foregroundStyle(FoleviColor.heading)
                .frame(width: 44, height: 44)
                .background {
                    let shape = RoundedRectangle(cornerRadius: 10, style: .continuous)
                    shape.fill(FoleviGlass.active)
                        .overlay(shape.strokeBorder(Color.black.opacity(0.06)))
                        .shadow(color: .black.opacity(0.06), radius: 1.5, y: 1)
                }
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(count == nil ? "…" : limit.map { String(localized: "\(count ?? 0) of \($0) \(Self.plural($0)) connected") } ?? String(localized: "\(count ?? 0) \(Self.plural(count ?? 0)) connected"))
                    .font(.ui(15, .semibold)).foregroundStyle(FoleviColor.heading)
                Text(limit.map { String(localized: "Your personal plan works on \($0) \(Self.plural($0)) at a time, in Personal and every workspace. A new device beyond that asks you to sign one out first.") }
                     ?? (app.profile?.entitlements?.trialing == true ? String(localized: "Unlimited devices during your Pro AI trial.") : String(localized: "Your personal plan includes unlimited devices.")))
                    .font(.ui(13)).foregroundStyle(FoleviColor.inkMuted)
                    .fixedSize(horizontal: false, vertical: true)
                if let limit {
                    DeviceMeter(count: count ?? 0, limit: limit)
                        .frame(maxWidth: 384)
                        .padding(.top, 8)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if limit != nil {
                Button("Get unlimited devices") { SettingsRouter.shared.section = .billing }
                    .buttonStyle(.folevi(.secondary, .medium))
            }
        }
        .padding(16)
        .background(FoleviGlass.hover, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private func sessionRow(_ s: SessionInfo) -> some View {
        HStack(spacing: 12) {
            DeviceGlyph(client: s.client, label: s.label, size: 36)
            VStack(alignment: .leading, spacing: 0) {
                Text(s.label).font(.ui(13, .medium)).foregroundStyle(FoleviColor.heading).lineLimit(1)
                Text("Signed in \(WebFormat.dateTime(s.createdAt)) · active \(WebFormat.relative(s.lastSeenAt))")
                    .font(.ui(12)).foregroundStyle(FoleviColor.inkMuted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if s.current {
                SettingsChip(text: String(localized: "This device"), tone: .moss)
            } else {
                Button("Sign out") {
                    app.settingsAction(String(localized: "Device signed out")) { try await $0.account.revokeSession(s.id) }
                }
                .buttonStyle(.folevi(.secondary, .small))
                .accessibilityLabel(Text("Sign out \(s.label)"))
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    private func watch() async {
        guard let session = app.session, app.sync.isOnline else { return }
        let stream: AsyncThrowingStream<[SessionInfo], Error> = session.convex.subscribe("users:listSessions")
        do {
            for try await value in stream { sessions = value.filter { $0.revokedAt == nil } }
        } catch {
            if sessions == nil { sessions = (try? await session.account.sessions())?.filter { $0.revokedAt == nil } }
        }
    }
}

/// The device's kind as the web draws it: a laptop for the Mac app, a tablet, a phone, or a monitor.
struct DeviceGlyph: View {
    var client: String
    var label: String
    var size: CGFloat = 36

    private var symbol: String {
        if client == "mac" { return "laptopcomputer" }
        if label.contains("iPad") { return "ipad" }
        if label.contains("iPhone") || label.contains("iOS") || label.contains("Android") { return "iphone" }
        return "display"
    }

    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: size * 0.44))
            .foregroundStyle(FoleviColor.heading)
            .frame(width: size, height: size)
            .background(FoleviGlass.hover, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .accessibilityHidden(true)
    }
}

/// Devices in use against the plan's limit: a 6 pt bar, red when over.
struct DeviceMeter: View {
    var count: Int
    var limit: Int

    var body: some View {
        let pct = min(1, Double(count) / Double(max(1, limit)))
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(FoleviColor.ink.opacity(0.12))
                Capsule().fill(count > limit ? FoleviColor.destructive : FoleviColor.heading)
                    .frame(width: geo.size.width * max(pct, 0.04))
            }
        }
        .frame(height: 6)
        .accessibilityElement()
        .accessibilityLabel(Text("Devices connected"))
        .accessibilityValue(Text("\(count) of \(limit)"))
    }
}
