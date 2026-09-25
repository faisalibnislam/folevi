import SwiftUI
import UserNotifications

struct SettingsView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        TabView {
            AccountSettings().tabItem { Label("Account", systemImage: "person.crop.circle") }
            AppearanceSettings().tabItem { Label("Appearance", systemImage: "paintbrush") }
            NotificationSettings().tabItem { Label("Notifications", systemImage: "bell") }
            SyncSettings().tabItem { Label("Offline & Sync", systemImage: "arrow.triangle.2.circlepath") }
            AboutSettings().tabItem { Label("About", systemImage: "info.circle") }
        }
        .frame(width: 560, height: 420)
        .environment(app)
    }
}

struct AccountSettings: View {
    @Environment(AppModel.self) private var app
    @State private var name = ""
    @State private var sessions: [SessionInfo] = []
    @State private var loading = false
    @State private var confirmSignOut = false

    var body: some View {
        Form {
            if let profile = app.profile {
                Section("Profile") {
                    TextField("Name", text: $name)
                        .onSubmit { save() }
                    LabeledContent("Email", value: profile.email)
                    LabeledContent("Workspace", value: app.workspace?.name ?? "")
                    HStack {
                        Spacer()
                        Button("Save Name") { save() }.disabled(name.isEmpty || name == profile.displayName || !app.sync.isOnline)
                    }
                }
                Section("Sessions") {
                    if !app.sync.isOnline {
                        Text("Session management is available when you're online.").foregroundStyle(FoleviColor.inkMuted)
                    } else if loading {
                        ProgressView().controlSize(.small)
                    }
                    ForEach(sessions) { s in
                        HStack {
                            Image(systemName: s.client == "mac" ? "laptopcomputer" : "globe").accessibilityHidden(true)
                            VStack(alignment: .leading) {
                                Text(s.current ? String(localized: "\(s.label) (this Mac)") : s.label)
                                Text("Last active \(Date(timeIntervalSince1970: s.lastSeenAt / 1000).formatted(.relative(presentation: .named)))")
                                    .font(.caption).foregroundStyle(FoleviColor.inkMuted)
                            }
                            Spacer()
                            if s.revokedAt != nil {
                                Text("Signed out").font(.caption).foregroundStyle(FoleviColor.inkFaint)
                            } else if !s.current {
                                Button("Sign Out") { revoke(s.id) }
                            }
                        }
                    }
                }
                Section {
                    Button("Sign Out of Folevi…", role: .destructive) { confirmSignOut = true }
                }
            } else {
                Text("You're not signed in.")
            }
        }
        .formStyle(.grouped)
        .onAppear { name = app.profile?.displayName ?? "" }
        .task { await loadSessions() }
        .confirmationDialog("Sign out of Folevi?", isPresented: $confirmSignOut) {
            Button("Sign Out", role: .destructive) { Task { await app.signOut() } }
        } message: {
            Text(app.sync.pendingCount > 0
                 ? "\(app.sync.pendingCount) changes haven't synced yet. They stay on this Mac and sync the next time you sign in."
                 : "Your documents stay safely in your account.")
        }
    }

    private func save() {
        let n = name.trimmingCharacters(in: .whitespaces)
        guard !n.isEmpty else { return }
        app.perform(String(localized: "Updating your name")) { try await $0.account.updateProfile(displayName: n) }
        app.profile?.displayName = n
    }

    private func loadSessions() async {
        guard let session = app.session, app.sync.isOnline else { return }
        loading = true
        defer { loading = false }
        sessions = (try? await session.account.sessions()) ?? []
    }

    private func revoke(_ id: String) {
        app.perform(String(localized: "Signing out a session")) { try await $0.account.revokeSession(id) }
        Task {
            try? await Task.sleep(for: .milliseconds(600))
            await loadSessions()
        }
    }
}

struct AppearanceSettings: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        @Bindable var app = app
        Form {
            Section("Appearance") {
                Picker("Appearance", selection: $app.appearance) {
                    ForEach(AppearancePreference.allCases) { p in Text(p.title).tag(p) }
                }
                .pickerStyle(.radioGroup)
                .accessibilityIdentifier("settings.appearance")
                .onChange(of: app.appearance) { _, value in
                    if app.sync.isOnline, let session = app.session {
                        Task { try? await session.account.updateProfile(appearance: value.rawValue) }
                    }
                }
            }
            Section("Editor") {
                LabeledContent("Text size") {
                    HStack {
                        Button("Smaller") { app.zoomOut() }
                        Text("\(Int(app.editorScale * 100))%").monospacedDigit().frame(width: 48)
                        Button("Larger") { app.zoomIn() }
                        Button("Reset") { app.zoomReset() }
                    }
                }
            }
        }
        .formStyle(.grouped)
    }
}

struct NotificationSettings: View {
    @Environment(AppModel.self) private var app
    @State private var status: UNAuthorizationStatus = .notDetermined

    var body: some View {
        Form {
            Section("Task Reminders") {
                switch status {
                case .authorized, .provisional, .ephemeral:
                    Label("Folevi will remind you about tasks with a reminder time.", systemImage: "checkmark.circle")
                    Button("Reschedule Reminders Now") { Task { await ReminderScheduler.shared.reschedule(app: app) } }
                case .denied:
                    Text("Notifications are turned off for Folevi. Reminders still appear in Tasks and Calendar. You can enable notifications in System Settings › Notifications.")
                        .fixedSize(horizontal: false, vertical: true)
                    Button("Open Notification Settings") {
                        if let url = URL(string: "x-apple.systempreferences:com.apple.Notifications-Settings.extension") { NSWorkspace.shared.open(url) }
                    }
                default:
                    Text("Allow notifications to get a reminder when a task is due. Folevi works fully without them.")
                        .fixedSize(horizontal: false, vertical: true)
                    Button("Allow Notifications…") {
                        Task {
                            _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])
                            await refresh()
                            await ReminderScheduler.shared.reschedule(app: app)
                        }
                    }
                }
            }
            if let prefs = app.profile?.notificationPrefs {
                Section("Email") {
                    LabeledContent("Mentions", value: prefs.mentions ? String(localized: "On") : String(localized: "Off"))
                    LabeledContent("Comments", value: prefs.comments ? String(localized: "On") : String(localized: "Off"))
                    Text("Email preferences are managed on folevi.com.").font(.caption).foregroundStyle(FoleviColor.inkMuted)
                }
            }
        }
        .formStyle(.grouped)
        .task { await refresh() }
    }

    private func refresh() async {
        status = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }
}

struct SyncSettings: View {
    @Environment(AppModel.self) private var app
    @State private var confirmReset = false
    @State private var forcedOffline = false

    var body: some View {
        Form {
            Section("Status") {
                LabeledContent("Connection", value: app.sync.isOnline ? String(localized: "Online") : String(localized: "Offline"))
                LabeledContent("Changes waiting to sync", value: "\(app.sync.pendingCount)")
                    .accessibilityIdentifier("settings.pendingCount")
                if let last = app.sync.lastSyncedAt {
                    LabeledContent("Last synced") { Text(last, style: .relative) }
                }
                HStack {
                    Spacer()
                    Button("Sync Now") { Task { await app.session?.engine.syncNow() } }.disabled(!app.sync.isOnline)
                }
            }
            Section {
                Toggle("Work offline", isOn: $forcedOffline)
                    .onChange(of: forcedOffline) { _, v in Task { await app.setForcedOffline(v) } }
                    .accessibilityIdentifier("settings.workOffline")
                Text("Keeps all edits on this Mac without contacting Folevi. Turn it off to sync.")
                    .font(.caption).foregroundStyle(FoleviColor.inkMuted)
            }
            Section("Local Cache") {
                Text("Folevi keeps a copy of your workspace on this Mac so you can keep writing offline.")
                    .fixedSize(horizontal: false, vertical: true)
                Button("Reset Local Cache…", role: .destructive) { confirmReset = true }
            }
        }
        .formStyle(.grouped)
        .onAppear { forcedOffline = app.sync.forcedOffline }
        .confirmationDialog("Reset the local cache?", isPresented: $confirmReset) {
            Button("Reset", role: .destructive) {
                Task {
                    await app.session?.engine.resetLocalCache()
                    await app.reloadDocuments()
                }
            }
        } message: {
            Text(app.sync.pendingCount > 0
                 ? "\(app.sync.pendingCount) changes haven't synced yet and will be lost. Folevi will download your workspace again."
                 : "Folevi will download your workspace again.")
        }
    }
}

struct AboutSettings: View {
    var body: some View {
        VStack(spacing: 12) {
            FoleviMark(size: 56).foregroundStyle(FoleviColor.accent)
            Text("Folevi").font(FoleviType.display(28))
            Text("Version \(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0") (\(Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"))")
                .foregroundStyle(FoleviColor.inkMuted)
            Text("A calm place for notes, plans and everything in between.").foregroundStyle(FoleviColor.inkMuted)
            Link("folevi.com", destination: URL(string: "https://folevi.com") ?? URL(fileURLWithPath: "/"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// Schedules local notifications for tasks with a reminder time (only after explicit permission).
@MainActor
final class ReminderScheduler {
    static let shared = ReminderScheduler()

    func reschedule(app: AppModel) async {
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else { return }
        let tasks = await TaskStore.load(app: app)
        center.removeAllPendingNotificationRequests()
        let now = Date()
        for task in tasks where !task.checked {
            guard let props = try? task.wire.props.decode(TodoProps.self), let reminderAt = props.reminderAt else { continue }
            let date = Date(timeIntervalSince1970: reminderAt / 1000)
            guard date > now else { continue }
            let content = UNMutableNotificationContent()
            content.title = task.title.isEmpty ? String(localized: "Task reminder") : task.title
            content.body = String(localized: "From \(task.documentTitle)")
            content.userInfo = ["documentId": task.documentId]
            let comps = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: date)
            let request = UNNotificationRequest(identifier: task.blockId, content: content,
                                                trigger: UNCalendarNotificationTrigger(dateMatching: comps, repeats: false))
            try? await center.add(request)
        }
    }
}
