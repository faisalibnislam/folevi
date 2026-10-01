import SwiftUI
import UserNotifications

struct SettingsView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        SettingsRoot()
            .environment(app)
            .overlay(alignment: .bottom) { ToastView() }
    }
}

struct AccountSettings: View {
    @Environment(AppModel.self) private var app
    @State private var name = ""
    @State private var confirmSignOut = false

    var body: some View {
        Form {
            if let profile = app.profile {
                Section("Profile") {
                    TextField("Name", text: $name)
                        .onSubmit { save() }
                    LabeledContent("Email") {
                        VStack(alignment: .trailing, spacing: 2) {
                            Text(profile.email)
                            Text("Your sign-in address. Contact support to change it.").font(.ui(11.5)).foregroundStyle(FoleviColor.inkMuted)
                        }
                    }
                    LabeledContent("Space", value: app.scopeName)
                    HStack {
                        Spacer()
                        Button("Save Name") { save() }.disabled(name.isEmpty || name == profile.displayName || !app.sync.isOnline)
                    }
                }
                Section("AI Assistant") {
                    Toggle(isOn: Binding(get: { profile.aiEnabled != false }, set: { setAi($0) })) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Show the AI Assistant")
                            Text(profile.aiEntitled
                                 ? "Ask AI, Catch me up and the note's AI. Turning it off hides them everywhere, on every device."
                                 : "Comes with Pro. Turning it off hides AI entry points everywhere, on every device.")
                                .font(.ui(11.5)).foregroundStyle(FoleviColor.inkMuted)
                        }
                    }
                    .disabled(!app.sync.isOnline)
                }
                Section {
                    Button("Sign Out of Folevi…", role: .destructive) { confirmSignOut = true }
                }
            } else {
                Text("You're not signed in.")
            }
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
        .background(CanvasBackground())
        .onAppear { name = app.profile?.displayName ?? "" }
        .confirmationDialog("Sign out of Folevi?", isPresented: $confirmSignOut) {
            Button("Sign Out", role: .destructive) { Task { await app.signOut() } }
        } message: {
            Text(app.sync.pendingCount > 0
                 ? "\(app.sync.pendingCount) changes haven't synced yet. They stay on this Mac and sync the next time you sign in."
                 : "Your documents stay safely in your account.")
        }
    }

    private func setAi(_ on: Bool) {
        app.profile?.aiEnabled = on
        app.perform(String(localized: "Updating the AI Assistant setting")) { try await $0.account.updateProfile(aiEnabled: on) }
    }

    private func save() {
        let n = name.trimmingCharacters(in: .whitespaces)
        guard !n.isEmpty else { return }
        app.perform(String(localized: "Updating your name")) { try await $0.account.updateProfile(displayName: n) }
        app.profile?.displayName = n
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
