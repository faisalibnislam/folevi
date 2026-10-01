import SwiftUI
import UserNotifications

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
                .frame(maxWidth: 420)
                .accessibilityElement(children: .contain)
                .accessibilityLabel(Text("Theme"))
                .accessibilityIdentifier("settings.appearance")
            }
            SettingsCard(title: String(localized: "Editor text size")) {
                HStack(spacing: 12) {
                    Text("Smaller").font(.ui(13))
                    Slider(value: $app.editorScale, in: 0.8...1.6, step: 0.1)
                        .tint(FoleviColor.heading)
                        .accessibilityLabel(Text("Editor text size"))
                        .accessibilityValue(Text("\(Int(app.editorScale * 100))%"))
                    Text("Larger").font(.ui(13))
                    Text("\(Int(app.editorScale * 100))%").font(.ui(12).monospacedDigit()).foregroundStyle(FoleviColor.inkMuted).frame(width: 40)
                }
                .frame(maxWidth: 420)
            }
        }
    }

    private func tile(_ value: AppearancePreference, _ label: String, _ icon: String) -> some View {
        let on = app.appearance == value
        return Button {
            app.appearance = value
            if app.sync.isOnline, let session = app.session {
                Task { try? await session.account.updateProfile(appearance: value.rawValue) }
            }
        } label: {
            VStack(spacing: 8) {
                Image(systemName: icon).font(.system(size: 17, weight: .medium))
                Text(label).font(.ui(13))
            }
            .foregroundStyle(on ? FoleviColor.heading : FoleviColor.ink)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(on ? FoleviColor.accentSoft : FoleviColor.surface))
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(on ? FoleviColor.heading : FoleviColor.line, lineWidth: on ? 1.5 : 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

// MARK: - Notifications

struct NotificationSettings: View {
    @Environment(AppModel.self) private var app
    @State private var status: UNAuthorizationStatus = .notDetermined

    private static let fallback = NotificationPrefs(mentions: true, comments: true, shares: true, invites: true, digest: "off", productEmail: false)

    private var prefs: NotificationPrefs { app.profile?.notificationPrefs ?? Self.fallback }

    var body: some View {
        SettingsPage {
            SettingsCard(title: String(localized: "Notifications"),
                         description: String(localized: "Choose what reaches you in the app (the bell) and by email. Emails say who did what and where, with a link. They never include your notes or comment text. Security emails (new sign-ins, account deletion) can't be turned off.")) {
                VStack(spacing: 0) {
                    HStack {
                        Text("Notify me about").frame(maxWidth: .infinity, alignment: .leading)
                        Text("In app").frame(width: 72)
                        Text("Email").frame(width: 72)
                    }
                    .font(.ui(12, .medium))
                    .foregroundStyle(FoleviColor.inkMuted)
                    .padding(.bottom, 8)
                    FoleviColor.line.frame(height: 1)
                    ForEach(Array(NotificationTopic.allCases.enumerated()), id: \.element) { i, topic in
                        if i > 0 { FoleviColor.line.opacity(0.7).frame(height: 1) }
                        HStack {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(topic.label).font(.ui(13.5)).foregroundStyle(FoleviColor.ink)
                                Text(topic.hint).font(.ui(12)).foregroundStyle(FoleviColor.inkMuted)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            SettingsSwitch(label: String(localized: "\(topic.label) in the app"),
                                           isOn: Binding(get: { prefs.inAppOn(topic) }, set: { save(prefs.settingInApp(topic, $0)) }))
                                .frame(width: 72)
                            SettingsSwitch(label: String(localized: "\(topic.label) by email"),
                                           isOn: Binding(get: { prefs.email(topic) }, set: { save(prefs.settingEmail(topic, $0)) }))
                                .frame(width: 72)
                        }
                        .padding(.vertical, 10)
                    }
                }
                .frame(maxWidth: 560)
                .disabled(!app.sync.isOnline)
            }
            SettingsCard(title: String(localized: "Email delivery"),
                         description: String(localized: "How comment, reply and mention emails arrive. Shares, invitations and access changes are always sent as they happen.")) {
                HStack(spacing: 16) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Send comment emails").font(.ui(13.5))
                        Text("The daily digest lists what you haven’t read yet, by page title only, once a day.").font(.ui(12)).foregroundStyle(FoleviColor.inkMuted)
                    }
                    Spacer(minLength: 8)
                    FoleviSelect(selection: Binding(get: { prefs.digest }, set: { var p = prefs; p.digest = $0; save(p) }),
                                 options: [.init(value: "off", title: String(localized: "As they happen")), .init(value: "daily", title: String(localized: "In a daily digest"))],
                                 accessibilityLabel: String(localized: "Send comment emails"), width: 176)
                }
                .frame(maxWidth: 560)
                .disabled(!app.sync.isOnline)
            }
            SettingsCard(title: String(localized: "Muted notes"),
                         description: String(localized: "To stop hearing about comments on one note, open its … menu and choose Mute comment notifications. You’ll still hear when someone @mentions you there. Follow a note the same way to hear about every comment on it.")) {
                Text("Nobody is ever notified about their own actions, or about pages they can’t open.").font(.ui(12)).foregroundStyle(FoleviColor.inkMuted)
            }
            SettingsCard(title: String(localized: "Task reminders"), description: String(localized: "Reminders for tasks with a reminder time, from this Mac.")) {
                reminders
            }
        }
        .task { await refresh() }
    }

    @ViewBuilder private var reminders: some View {
        switch status {
        case .authorized, .provisional, .ephemeral:
            VStack(alignment: .leading, spacing: 10) {
                Label("Folevi will remind you about tasks with a reminder time.", systemImage: "checkmark.circle").font(.ui(13))
                Button("Reschedule Reminders Now") { Task { await ReminderScheduler.shared.reschedule(app: app) } }
                    .buttonStyle(.folevi(.secondary, .small))
            }
        case .denied:
            VStack(alignment: .leading, spacing: 10) {
                Text("Notifications are turned off for Folevi. Reminders still appear in Tasks and Calendar. You can enable notifications in System Settings › Notifications.")
                    .font(.ui(13)).fixedSize(horizontal: false, vertical: true)
                Button("Open Notification Settings") {
                    if let url = URL(string: "x-apple.systempreferences:com.apple.Notifications-Settings.extension") { NSWorkspace.shared.open(url) }
                }
                .buttonStyle(.folevi(.secondary, .small))
            }
        default:
            VStack(alignment: .leading, spacing: 10) {
                Text("Allow notifications to get a reminder when a task is due. Folevi works fully without them.")
                    .font(.ui(13)).fixedSize(horizontal: false, vertical: true)
                Button("Allow Notifications…") {
                    Task {
                        _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])
                        await refresh()
                        await ReminderScheduler.shared.reschedule(app: app)
                    }
                }
                .buttonStyle(.folevi(.secondary, .small))
            }
        }
    }

    private func save(_ next: NotificationPrefs) {
        let before = app.profile?.notificationPrefs
        app.profile?.notificationPrefs = next
        guard let session = app.session, app.sync.isOnline else { return }
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

    private func refresh() async {
        status = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }
}

// MARK: - Offline & sync

struct SyncSettings: View {
    @Environment(AppModel.self) private var app
    @State private var confirmReset = false
    @State private var forcedOffline = false

    var body: some View {
        SettingsPage {
            SettingsCard(title: String(localized: "This device"),
                         description: String(localized: "Folevi keeps a copy of your notes on this Mac, with every unsent change, so you can keep writing offline and nothing is lost.")) {
                Grid(alignment: .leading, horizontalSpacing: 24, verticalSpacing: 8) {
                    row(String(localized: "Connection"), app.sync.isOnline ? String(localized: "Online") : String(localized: "Offline"))
                    row(String(localized: "Changes waiting to sync"), "\(app.sync.pendingCount)")
                        .accessibilityIdentifier("settings.pendingCount")
                    row(String(localized: "Uploads waiting"), "\(app.sync.uploadCount)")
                    row(String(localized: "Unresolved conflicts"), "\(app.sync.conflicts.count)")
                    if let last = app.sync.lastSyncedAt {
                        GridRow {
                            Text("Last synced").foregroundStyle(FoleviColor.inkMuted)
                            Text(last, style: .relative)
                        }
                    }
                    GridRow {
                        Text("Device id").foregroundStyle(FoleviColor.inkMuted)
                        Text(DeviceIdentity.deviceId).font(.system(size: 11.5, design: .monospaced)).lineLimit(1).truncationMode(.middle)
                    }
                }
                .font(.ui(13))
                HStack(spacing: 8) {
                    Button("Sync now") { Task { await app.session?.engine.syncNow() } }
                        .buttonStyle(.folevi(.secondary, .small))
                        .disabled(!app.sync.isOnline)
                    Button("Clear data on this Mac…") { confirmReset = true }
                        .buttonStyle(.folevi(.quiet, .small))
                        .foregroundStyle(FoleviColor.destructive)
                }
                .padding(.top, 14)
            }
            SettingsCard(title: String(localized: "Work offline"), description: String(localized: "Keeps all edits on this Mac without contacting Folevi. Turn it off to sync.")) {
                HStack {
                    Text("Work offline").font(.ui(13.5))
                    Spacer()
                    SettingsSwitch(label: String(localized: "Work offline"), isOn: $forcedOffline)
                        .accessibilityIdentifier("settings.workOffline")
                }
                .frame(maxWidth: 420)
            }
        }
        .onAppear { forcedOffline = app.sync.forcedOffline }
        .onChange(of: forcedOffline) { _, v in
            guard v != app.sync.forcedOffline else { return }
            Task { await app.setForcedOffline(v) }
        }
        .sheet(isPresented: $confirmReset) {
            FoleviDialog(title: String(localized: "Clear local data?"),
                         message: app.sync.pendingCount > 0
                            ? String(localized: "\(app.sync.pendingCount) changes haven't synced yet and will be lost. Folevi will download your notes again.")
                            : String(localized: "Your documents stay in your account. This Mac will download them again."),
                         confirmTitle: String(localized: "Clear")) {
                confirmReset = false
                Task {
                    await app.session?.engine.resetLocalCache()
                    await app.reloadDocuments()
                    app.showToast(String(localized: "Local data cleared"))
                }
            }
        }
    }

    private func row(_ label: String, _ value: String) -> some View {
        GridRow {
            Text(label).foregroundStyle(FoleviColor.inkMuted)
            Text(value).monospacedDigit()
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
    private var active: [SessionInfo] { (sessions ?? []).filter { $0.revokedAt == nil } }
    private var others: Int { active.filter { !$0.current }.count }

    private static func devices(_ n: Int) -> String { n == 1 ? String(localized: "device") : String(localized: "devices") }

    var body: some View {
        SettingsPage {
            if !app.sync.isOnline {
                OfflineNote(text: String(localized: "Devices are shown when you're online."))
            } else {
                SettingsCard(title: String(localized: "Connected devices")) { summary }
                SettingsCard(title: String(localized: "Signed in"),
                             description: String(localized: "Browsers and apps signed in to your account. Signing a device out ends its session right away; it asks for your password and code to sign in again.")) {
                    if sessions == nil {
                        ProgressView().controlSize(.small)
                    } else {
                        SettingsList {
                            ForEach(active) { s in sessionRow(s) }
                        }
                    }
                    Button("Sign out of all other devices") { confirmAll = true }
                        .buttonStyle(.folevi(.secondary, .small))
                        .disabled(others == 0)
                        .padding(.top, 12)
                }
            }
        }
        .task { await load() }
        .sheet(isPresented: $confirmAll) {
            FoleviDialog(title: String(localized: "Sign out everywhere else?"),
                         message: String(localized: "\(others) other \(Self.devices(others)) will be signed out right away. This device stays signed in."),
                         confirmTitle: String(localized: "Sign out others"), confirmKind: .primary) {
                confirmAll = false
                app.settingsAction(nil) { session in
                    let ended = try await session.account.signOutOtherDevices()
                    await MainActor.run {
                        app.showToast(ended == 1 ? String(localized: "Signed out 1 other device") : String(localized: "Signed out \(ended) other devices"))
                    }
                }
                reload()
            }
        }
    }

    private var summary: some View {
        let count = active.count
        return HStack(spacing: 16) {
            Image(systemName: "laptopcomputer.and.iphone")
                .font(.system(size: 18))
                .foregroundStyle(FoleviColor.heading)
                .frame(width: 44, height: 44)
                .background(FoleviGlass.active, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(sessions == nil ? "…" : limit.map { String(localized: "\(count) of \($0) \(Self.devices($0)) connected") } ?? String(localized: "\(count) \(Self.devices(count)) connected"))
                    .font(.ui(15, .semibold)).foregroundStyle(FoleviColor.heading)
                Text(limit.map { String(localized: "Your personal plan works on \($0) \(Self.devices($0)) at a time, in Personal and every workspace. A new device beyond that asks you to sign one out first.") }
                     ?? (app.profile?.entitlements?.trialing == true ? String(localized: "Unlimited devices during your Pro AI trial.") : String(localized: "Your personal plan includes unlimited devices.")))
                    .font(.ui(13)).foregroundStyle(FoleviColor.inkMuted)
                    .fixedSize(horizontal: false, vertical: true)
                if let limit {
                    ProgressView(value: min(1, Double(count) / Double(max(1, limit))))
                        .tint(count > limit ? FoleviColor.destructive : FoleviColor.heading)
                        .frame(maxWidth: 280)
                }
            }
            Spacer(minLength: 0)
            if limit != nil {
                Button("Get unlimited devices") { openWebApp("settings/billing", config: app.config) }
                    .buttonStyle(.folevi(.secondary, .small))
            }
        }
        .padding(16)
        .background(FoleviGlass.hover, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private func sessionRow(_ s: SessionInfo) -> some View {
        HStack(spacing: 12) {
            Image(systemName: s.client == "mac" ? "laptopcomputer" : s.label.contains("iPhone") ? "iphone" : s.label.contains("iPad") ? "ipad" : "display")
                .font(.system(size: 15))
                .foregroundStyle(FoleviColor.heading)
                .frame(width: 36, height: 36)
                .background(FoleviGlass.hover, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(s.label).font(.ui(13.5, .medium)).foregroundStyle(FoleviColor.heading).lineLimit(1)
                Text("Signed in \(Date(timeIntervalSince1970: s.createdAt / 1000).formatted(date: .abbreviated, time: .shortened)) · active \(Date(timeIntervalSince1970: s.lastSeenAt / 1000).formatted(.relative(presentation: .named)))")
                    .font(.ui(12)).foregroundStyle(FoleviColor.inkMuted)
            }
            Spacer(minLength: 8)
            if s.current {
                SettingsChip(text: String(localized: "This device"))
            } else {
                Button("Sign out") {
                    app.settingsAction(String(localized: "Device signed out")) { try await $0.account.revokeSession(s.id) }
                    reload()
                }
                .buttonStyle(.folevi(.secondary, .small))
                .accessibilityLabel(Text("Sign out \(s.label)"))
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
    }

    private func reload() {
        Task {
            try? await Task.sleep(for: .milliseconds(700))
            await load()
        }
    }

    private func load() async {
        guard let session = app.session, app.sync.isOnline else { return }
        sessions = (try? await session.account.sessions()) ?? []
    }
}
