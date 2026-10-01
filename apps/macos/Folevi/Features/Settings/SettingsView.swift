import SwiftUI

// Settings → Account (the web's AccountSection): the profile card (picture, name, email, time zone, Save)
// and the AI Assistant card.

struct AccountSettings: View {
    @Environment(AppModel.self) private var app
    @State private var name = ""
    @State private var loaded = false

    /// Every time zone the system knows, like `Intl.supportedValuesOf("timeZone")`.
    private static let zones: [String] = TimeZone.knownTimeZoneIdentifiers.sorted()

    var body: some View {
        SettingsPage {
            if let profile = app.profile {
                SettingsCard(title: String(localized: "Profile")) {
                    VStack(alignment: .leading, spacing: 0) {
                        Text("Profile picture").font(.ui(14, .medium)).foregroundStyle(FoleviColor.ink).padding(.bottom, 8)
                        IdentityImageField(label: String(localized: "Profile picture"), shape: .circle, url: profile.avatarUrl, initial: profile.displayName,
                                           onUpload: { data, filename, mime in
                                               // The server keeps it in your Personal, whichever context is open.
                                               guard let convex = app.convex else { return }
                                               let fileId = try await IdentityImage.upload(data, filename: filename, mimeType: mime, kind: "avatar", workspaceId: nil, convex: convex)
                                               try await convex.mutationVoid("users:setAvatar", ["fileId": .string(fileId)])
                                           },
                                           onRemove: {
                                               try await app.convex?.mutationVoid("users:removeAvatar")
                                           })
                            .padding(.bottom, 20)
                        form(profile)
                    }
                }
                AiSettingCard()
            }
        }
        .onAppear {
            guard !loaded else { return }
            loaded = true
            name = app.profile?.displayName ?? ""
        }
    }

    private func form(_ profile: Profile) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            LabeledField(label: String(localized: "Name")) {
                TextField("", text: $name)
                    .textFieldStyle(WebFieldStyle())
                    .textContentType(.name)
                    .onSubmit { save() }
                    .onChange(of: name) { _, v in if v.count > 80 { name = String(v.prefix(80)) } }
                    .accessibilityLabel(Text("Name"))
            }
            LabeledField(label: String(localized: "Email"), hint: String(localized: "Your sign-in address. Contact support to change it.")) {
                TextField("", text: .constant(profile.email))
                    .textFieldStyle(WebFieldStyle(readOnly: true))
                    .disabled(true)
                    .accessibilityLabel(Text("Email"))
                    .accessibilityValue(Text(profile.email))
            }
            LabeledField(label: String(localized: "Time zone"), hint: String(localized: "Used for Today, the calendar and reminders.")) {
                WebSelect(selection: Binding(get: { profile.timeZone }, set: { setTimeZone($0) }),
                          options: Self.zones.map { .init(value: $0, title: $0) },
                          accessibilityLabel: String(localized: "Time zone"))
            }
            Button("Save") { save() }
                .buttonStyle(.folevi(.primary, .medium))
        }
        .frame(maxWidth: 448, alignment: .leading)
    }

    private func save() {
        let next = name
        app.settingsAction(String(localized: "Saved")) { session in
            try await session.account.updateProfile(displayName: next)
            await MainActor.run { app.profile?.displayName = next.trimmingCharacters(in: .whitespaces) }
        }
    }

    private func setTimeZone(_ zone: String) {
        app.profile?.timeZone = zone
        app.settingsAction(nil) { try await $0.account.updateProfile(timeZone: zone) }
    }
}

/// Turns the AI Assistant on or off for this person (the server enforces it). Core has no AI.
private struct AiSettingCard: View {
    @Environment(AppModel.self) private var app

    private var core: Bool { app.profile?.entitlements?.plan == "core" }
    private var on: Bool { app.profile?.aiEnabled != false }

    var body: some View {
        SettingsCard(title: String(localized: "AI Assistant")) {
            HStack(alignment: .top, spacing: 24) {
                description
                    .frame(maxWidth: .infinity, alignment: .leading)
                SettingsSwitch(label: String(localized: "AI Assistant"), hint: hint,
                               isOn: Binding(get: { on && !core }, set: { set($0) }))
                    .disabled(core)
            }
            .frame(maxWidth: 576, alignment: .leading)
        }
    }

    private var hint: String {
        core ? String(localized: "Not included in Core. Your notes stay yours: nothing is sent to an AI model. Pro and Pro AI include the AI Assistant.")
            : String(localized: "Ask AI, writing help and note summaries, powered by Google Gemini. When you use it, your request and the notes it needs are sent to Google; nothing is sent while it's off, and all AI buttons are hidden.")
    }

    @ViewBuilder private var description: some View {
        if core {
            VStack(alignment: .leading, spacing: 4) {
                (Text("Not included in Core.").fontWeight(.medium).foregroundStyle(FoleviColor.heading)
                 + Text(" Your notes stay yours: nothing is sent to an AI model. Pro and Pro AI include the AI Assistant.").foregroundStyle(FoleviColor.inkMuted))
                    .font(.ui(14))
                    .fixedSize(horizontal: false, vertical: true)
                TextLinkButton(title: String(localized: "See plans"), size: 14) { SettingsRouter.shared.section = .billing }
            }
        } else {
            Text("Ask AI, writing help and note summaries, powered by Google Gemini. When you use it, your request and the notes it needs are sent to Google; nothing is sent while it's off, and all AI buttons are hidden.")
                .font(.ui(14))
                .foregroundStyle(FoleviColor.inkMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func set(_ next: Bool) {
        let before = app.profile?.aiEnabled
        app.profile?.aiEnabled = next
        guard let session = app.session, app.sync.isOnline else {
            app.profile?.aiEnabled = before
            app.showToast(String(localized: "This needs a connection. Try again when you're back online."))
            return
        }
        Task {
            do {
                try await session.account.updateProfile(aiEnabled: next)
                app.showToast(next ? String(localized: "AI Assistant turned on") : String(localized: "AI Assistant turned off"))
            } catch {
                app.profile?.aiEnabled = before
                app.showToast(ConvexService.mapError(error).localizedDescription)
            }
        }
    }
}
