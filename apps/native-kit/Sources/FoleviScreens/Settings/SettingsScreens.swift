// Settings' screens (SettingsModel): the list of sections (iPhone and iPad: a pushed screen in the frame's stack;
// the Mac: the toolbar of the Settings window picks the section, SettingsSectionScreen draws it) and each native
// section, built the way the web's SettingsKit models iOS Settings: grouped rows, pushed choice screens, switches.
import SwiftUI
import FoleviDesign
import FoleviEngine

/// Settings with its own navigation (iPhone and iPad, or anywhere a host doesn't push sections itself).
public struct SettingsScreen: View {
    let model: SettingsModel

    public init(model: SettingsModel) { self.model = model }

    public var body: some View {
        NavigationStack {
            SettingsList(model: model, open: nil)
                .navigationDestination(for: SettingsSection.self) { s in SettingsSectionScreen(model: model, section: s) }
        }
    }
}

/// The list of sections: the profile at the top, then the groups. `open`: the host pushes a section itself (UIKit
/// navigation); nil uses SwiftUI's NavigationLink inside a NavigationStack.
public struct SettingsList: View {
    let model: SettingsModel
    let open: (@MainActor (SettingsSection) -> Void)?

    public init(model: SettingsModel, open: (@MainActor (SettingsSection) -> Void)?) {
        self.model = model
        self.open = open
    }

    public var body: some View {
        Form {
            if !model.isLocal {
                Section {
                    row(.account) {
                        HStack(spacing: 12) {
                            ProfileAvatar(name: model.profileName, url: model.avatarURL, size: 48)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(model.profileName.isEmpty ? "Account" : model.profileName).foleviFont(.headline).foregroundStyle(Folevi.color.heading)
                                Text(model.email).foleviFont(.footnote).foregroundStyle(Folevi.color.inkMuted)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                }
            }
            ForEach(Array(model.groups.enumerated()), id: \.offset) { _, group in
                let rows = group.filter { $0 != .account }
                if !rows.isEmpty {
                    Section {
                        ForEach(rows) { s in
                            row(s) { SettingsRowLabel(title: s.title, symbol: s.symbol, value: summary(s), web: s.webPage != nil) }
                        }
                    }
                }
            }
        }
        .formStyle(.grouped)
        .settingsBackground()
        .navigationTitle("Settings")
        .accessibilityIdentifier("settings-list")
    }

    private func summary(_ s: SettingsSection) -> String? {
        switch s {
        case .appearance: Self.appearanceName(model.currentAppearance)
        case .about: SettingsModel.displayVersion(model.host.version)
        default: nil
        }
    }

    static func appearanceName(_ a: AppearanceSettings.Appearance) -> String {
        switch a {
        case .system: "System"
        case .light: "Light"
        case .dark: "Dark"
        }
    }

    @ViewBuilder private func row<Label: View>(_ s: SettingsSection, @ViewBuilder label: () -> Label) -> some View {
        if s.webPage != nil {
            Button { model.showWeb(s) } label: { label().contentShape(Rectangle()) }
                .buttonStyle(.plain)
                .accessibilityIdentifier("settings-row-\(s.rawValue)")
        } else if let open {
            Button { open(s) } label: {
                HStack { label(); Spacer(); Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(Folevi.color.inkFaint) }
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("settings-row-\(s.rawValue)")
        } else {
            NavigationLink(value: s) { label() }
                .accessibilityIdentifier("settings-row-\(s.rawValue)")
        }
    }
}

/// A section's row: icon tile, title, value; web sections show an arrow out.
struct SettingsRowLabel: View {
    let title: String
    let symbol: String
    let value: String?
    let web: Bool

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: symbol)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(Folevi.color.heading)
                .frame(width: 28, height: 28)
                .background(RoundedRectangle(cornerRadius: Folevi.radius.small, style: .continuous).fill(Folevi.color.surfaceSunken))
            Text(title).foleviFont(.body).foregroundStyle(Folevi.color.ink)
            Spacer(minLength: 8)
            if let value { Text(value).foleviFont(.callout).foregroundStyle(Folevi.color.inkMuted) }
            if web { Image(systemName: "arrow.up.forward").font(.system(size: 12, weight: .semibold)).foregroundStyle(Folevi.color.inkFaint) }
        }
        .frame(minHeight: 36)
        .accessibilityElement(children: .combine)
    }
}

/// The person's picture, or their initial on a tile (6 radius: nothing fully round outside the iPhone glass).
struct ProfileAvatar: View {
    let name: String
    let url: URL?
    let size: CGFloat

    var body: some View {
        Group {
            if let url {
                AsyncImage(url: url) { phase in
                    if let image = phase.image { image.resizable().scaledToFill() } else { Avatar(name: name, size: size) }
                }
            } else {
                Avatar(name: name, size: size)
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: Folevi.radius.chip, style: .continuous))
        .accessibilityHidden(true)
    }
}

/// One native section.
public struct SettingsSectionScreen: View {
    let model: SettingsModel
    let section: SettingsSection

    public init(model: SettingsModel, section: SettingsSection) {
        self.model = model
        self.section = section
    }

    public var body: some View {
        Form { content }
            .formStyle(.grouped)
            .settingsBackground()
            .navigationTitle(section.title)
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .onAppear { model.open(section) }
            .accessibilityIdentifier("settings-\(section.rawValue)")
    }

    @ViewBuilder private var content: some View {
        switch section {
        case .account: AccountSettingsSection(model: model)
        case .general: GeneralSettingsSection(model: model)
        case .appearance: AppearanceSettingsSection(model: model)
        case .notifications: NotificationSettingsSection(model: model)
        case .ai: AiSettingsSection(model: model)
        case .security: SecuritySettingsSection(model: model)
        case .privacy: PrivacySettingsSection(model: model)
        case .help: HelpSettingsSection(model: model)
        case .about: AboutSettingsSection(model: model)
        case .thisDevice:
            Section { Text("Storage on this device comes to Settings with the next update.").foleviFont(.callout).foregroundStyle(Folevi.color.inkMuted) }
        case .connectedApps, .data, .aiExport, .workspaceData:
            Section {
                Button("Open \(section.title)") { model.showWeb(section) }
                    .accessibilityIdentifier("settings-open-web")
            }
        }
    }
}

// MARK: Sections

/// A row's title in the app's type.
@MainActor private func label(_ text: String) -> some View {
    Text(text).foleviFont(.body).foregroundStyle(Folevi.color.ink)
}

@MainActor private func footnote(_ text: String) -> some View {
    Text(text).foleviFont(.footnote).foregroundStyle(Folevi.color.inkMuted)
}

struct AccountSettingsSection: View {
    let model: SettingsModel
    @State private var name = ""
    @State private var editing = false
    @FocusState private var nameFocused: Bool

    var body: some View {
        Section {
            HStack(spacing: 14) {
                ProfileAvatar(name: model.profileName, url: model.avatarURL, size: 64)
                VStack(alignment: .leading, spacing: 8) {
                    footnote("Profile picture")
                    HStack(spacing: 8) {
                        if model.host.pickAvatar != nil {
                            Button(model.isRunning("avatar") ? "Saving…" : "Change") { Task { await model.changeAvatar() } }
                                .buttonStyle(FoleviButtonStyle(.secondary, size: .small))
                                .accessibilityIdentifier("settings-avatar-change")
                        }
                        if model.avatarURL != nil {
                            Button("Remove") { Task { await model.removeAvatar() } }
                                .buttonStyle(FoleviButtonStyle(.ghost, size: .small))
                                .accessibilityIdentifier("settings-avatar-remove")
                        }
                    }
                    .disabled(model.isRunning("avatar"))
                }
            }
            .padding(.vertical, 4)
            TextField(text: $name, prompt: Text("Your name")) { label("Name") }
                .foleviFont(.body)
                .focused($nameFocused)
                .onSubmit { Task { await model.rename(name) } }
                .onChange(of: nameFocused) { _, focused in if !focused { Task { await model.rename(name) } } }
                .accessibilityIdentifier("settings-name")
            LabeledContent { Text(model.email).foleviFont(.body).foregroundStyle(Folevi.color.inkMuted) } label: { label("Email") }
            Picker(selection: Binding(get: { model.timeZone }, set: { z in Task { await model.setTimeZone(z) } })) {
                ForEach(SettingsModel.zoneChoices(model.timeZone), id: \.self) { z in Text(z.replacingOccurrences(of: "_", with: " ")).tag(z) }
            } label: { label("Time zone") }
            #if os(iOS)
            .pickerStyle(.navigationLink)
            #endif
            .accessibilityIdentifier("settings-time-zone")
        }
        .onAppear { name = model.profileName }
        .onChange(of: model.profileName) { _, n in if !nameFocused { name = n } }

        Section {
            if let plan = model.planName {
                LabeledContent { Text(plan).foleviFont(.body).foregroundStyle(Folevi.color.inkMuted) } label: { label("Plan") }
                    .accessibilityIdentifier("settings-plan")
            }
            if let storage = model.storageText {
                VStack(alignment: .leading, spacing: 6) {
                    LabeledContent { Text(storage).foleviFont(.callout).foregroundStyle(Folevi.color.inkMuted) } label: { label("Storage") }
                    if let f = model.storageFraction { ProgressView(value: f).tint(f > 0.9 ? Folevi.color.destructive : Folevi.color.heading) }
                }
                .accessibilityElement(children: .combine)
            }
            if let devices = model.devicesText {
                LabeledContent { Text(devices).foleviFont(.callout).foregroundStyle(Folevi.color.inkMuted) } label: { label("Devices") }
            }
        } header: {
            Text("Plan").foleviFont(.caps)
        }

        if let signOut = model.host.signOut {
            Section {
                Button(role: .destructive) { signOut() } label: { Text("Sign out").foleviFont(.body) }
                    .accessibilityIdentifier("settings-sign-out")
            }
        }
    }
}

struct GeneralSettingsSection: View {
    let model: SettingsModel
    var body: some View {
        Section {
            Toggle(isOn: Binding(get: { model.reviewAppEdits }, set: { on in Task { await model.setReviewAppEdits(on) } })) {
                VStack(alignment: .leading, spacing: 2) {
                    label("Review changes from connected apps")
                    footnote("Changes connected apps make to existing notes wait in Changes until you accept them.")
                }
            }
            .accessibilityIdentifier("settings-review-app-edits")
        }
        if !model.isLocal {
            Section {
                LabeledContent { Text(model.timeZone.replacingOccurrences(of: "_", with: " ")).foleviFont(.callout).foregroundStyle(Folevi.color.inkMuted) } label: { label("Time zone") }
            } footer: {
                footnote("Due dates, reminders and the daily note follow this time zone. Change it in Account.")
            }
        }
    }
}

struct AppearanceSettingsSection: View {
    let model: SettingsModel
    var body: some View {
        Section {
            ForEach([AppearanceSettings.Appearance.light, .dark, .system], id: \.self) { a in
                Button { Task { await model.setAppearance(a) } } label: {
                    HStack(spacing: 12) {
                        Image(systemName: a == .light ? "sun.max" : (a == .dark ? "moon" : "circle.lefthalf.filled")).foregroundStyle(Folevi.color.heading).frame(width: 24)
                        VStack(alignment: .leading, spacing: 2) {
                            label(SettingsList.appearanceName(a))
                            if a == .system { footnote("Follows this device's Light or Dark appearance") }
                        }
                        Spacer()
                        if model.currentAppearance == a { Image(systemName: "checkmark").font(.system(size: 14, weight: .semibold)).foregroundStyle(Folevi.color.accent) }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(model.currentAppearance == a ? .isSelected : [])
                .accessibilityIdentifier("settings-appearance-\(a.rawValue)")
            }
        } header: {
            Text("Theme").foleviFont(.caps)
        } footer: {
            footnote("Dark mode is designed, not inverted: document colors are softened and code stays readable.")
        }
    }
}

struct NotificationSettingsSection: View {
    let model: SettingsModel
    var body: some View {
        if let value = model.notifications?.value {
            Section {
                ForEach(value.topics, id: \.id) { t in
                    NavigationLink {
                        Form {
                            Section {
                                Toggle(isOn: Binding(get: { model.topicOn(t, email: false) }, set: { on in Task { await model.setTopic(t, email: false, on: on) } })) { label("In the app") }
                                    .accessibilityIdentifier("settings-topic-\(t.id)-inApp")
                                Toggle(isOn: Binding(get: { model.topicOn(t, email: true) }, set: { on in Task { await model.setTopic(t, email: true, on: on) } })) { label("By email") }
                                    .accessibilityIdentifier("settings-topic-\(t.id)-email")
                            } footer: { footnote(t.hint) }
                        }
                        .formStyle(.grouped)
                        .navigationTitle(t.label)
                    } label: {
                        LabeledContent { Text(model.topicSummary(t)).foleviFont(.callout).foregroundStyle(Folevi.color.inkMuted) } label: { label(t.label) }
                    }
                    .accessibilityIdentifier("settings-topic-\(t.id)")
                }
            } footer: {
                footnote("Choose what reaches you in the app (the bell) and by email. Emails say who did what and where, with a link. They never include your notes or comment text.")
            }
            Section {
                Toggle(isOn: Binding(get: { model.dailyDigest }, set: { on in Task { await model.setDailyDigest(on) } })) {
                    VStack(alignment: .leading, spacing: 2) {
                        label("Daily summary email")
                        footnote("Comment, reply and mention emails arrive together once a day.")
                    }
                }
                .accessibilityIdentifier("settings-digest")
                Toggle(isOn: Binding(get: { model.productEmail }, set: { on in Task { await model.setProductEmail(on) } })) { label("News about Folevi") }
                    .accessibilityIdentifier("settings-product-email")
            } header: {
                Text("Email delivery").foleviFont(.caps)
            }
        } else {
            LoadingSection()
        }
    }
}

struct AiSettingsSection: View {
    let model: SettingsModel
    var body: some View {
        if model.ai?.value != nil {
            Section {
                Toggle(isOn: Binding(get: { model.aiEnabled }, set: { on in Task { await model.setAiEnabled(on) } })) {
                    HStack(spacing: 10) {
                        Image(systemName: "sparkles").foregroundStyle(Folevi.color.heading)
                        label("Foli AI")
                    }
                }
                .disabled(!model.aiIncluded)
                .accessibilityIdentifier("settings-ai-enabled")
            } footer: {
                footnote(model.aiIncluded ? "Ask questions about your notes, catch up on your week and get writing help." : "Foli AI isn't part of this plan.")
            }
            if model.aiEnabled && model.aiIncluded {
                Section {
                    ForEach(SettingsModel.aiPrefs, id: \.key) { p in
                        Toggle(isOn: Binding(get: { model.aiPref(p.key) }, set: { on in Task { await model.setAiPref(p.key, on) } })) {
                            VStack(alignment: .leading, spacing: 2) {
                                label(p.label)
                                footnote(p.body)
                            }
                        }
                        .accessibilityIdentifier("settings-ai-\(p.key.rawValue)")
                    }
                } header: {
                    Text("How Foli AI works for you").foleviFont(.caps)
                }
            }
        } else {
            LoadingSection()
        }
    }
}

struct SecuritySettingsSection: View {
    let model: SettingsModel
    var body: some View {
        Section {
            if model.security?.value == nil {
                ProgressView().frame(maxWidth: .infinity)
            }
            ForEach(model.sessions, id: \.id) { s in
                HStack(spacing: 12) {
                    Image(systemName: Self.symbol(s.client)).foregroundStyle(Folevi.color.inkMuted).frame(width: 24)
                    VStack(alignment: .leading, spacing: 2) {
                        label(s.label)
                        footnote(s.current ? "This device" : "Last used \(AgeText.relative(Date(timeIntervalSince1970: s.lastSeenAt / 1000), now: ScreenClock.now()))")
                    }
                    Spacer()
                    if !s.current {
                        Button(model.isRunning("session.\(s.id)") ? "Signing out…" : "Sign out") { Task { await model.revoke(s) } }
                            .buttonStyle(FoleviButtonStyle(.secondary, size: .small))
                            .disabled(model.isRunning("session.\(s.id)"))
                            .accessibilityIdentifier("settings-revoke-\(s.id)")
                    }
                }
                .accessibilityElement(children: .combine)
            }
        } header: {
            Text("Where you're signed in").foleviFont(.caps)
        } footer: {
            footnote("Signing out a device ends its session there. Its notes waiting to sync stay on it until it signs in again.")
        }
    }

    static func symbol(_ client: String) -> String {
        switch client {
        case "ios": "iphone"
        case "mac": "laptopcomputer"
        case "android": "candybarphone"
        default: "globe"
        }
    }
}

struct PrivacySettingsSection: View {
    let model: SettingsModel
    @State private var lockOn = false
    @State private var after = 0

    var body: some View {
        if let lock = model.host.appLock {
            Section {
                Toggle(isOn: Binding(get: { lockOn }, set: { on in
                    Task {
                        if await lock.setEnabled(on) { lockOn = lock.enabled }
                    }
                })) { label(AppLockWords.toggleLabel(lock.method)) }
                    .disabled(lock.method == "none")
                    .accessibilityIdentifier("settings-app-lock")
                if lockOn {
                    Picker(selection: Binding(get: { after }, set: { v in lock.setAfter(v); after = v })) {
                        ForEach(AppLockWords.afterChoices, id: \.self) { s in Text(AppLockWords.afterLabel(s)).tag(s) }
                    } label: { label("Ask") }
                        .accessibilityIdentifier("settings-app-lock-after")
                }
            } footer: {
                footnote(lock.method == "none"
                    ? "Set a passcode for this device first, in its Settings."
                    : "Folevi asks for \(AppLockWords.methodName(lock.method)) when you come back to it. This stays on this device.")
            }
            .onAppear {
                lockOn = lock.enabled
                after = lock.after
            }
        }
        Section {
            Button { if let u = URL(string: "https://folevi.com/privacy") { model.host.openURL(u) } } label: { label("Privacy policy") }
                .accessibilityIdentifier("settings-privacy-policy")
        } footer: {
            footnote("End-to-end encryption, its recovery key and encrypted devices are set up from Folevi on the web for now.")
        }
    }
}

struct HelpSettingsSection: View {
    let model: SettingsModel
    var body: some View {
        Section {
            Button { if let u = URL(string: "https://folevi.com/docs") { model.host.openURL(u) } } label: { label("Folevi guides") }
                .accessibilityIdentifier("settings-help-docs")
            Button { if let u = URL(string: "mailto:support@folevi.com") { model.host.openURL(u) } } label: { label("Email support") }
                .accessibilityIdentifier("settings-help-support")
        } footer: {
            footnote("Write to support@folevi.com. A person answers, usually within a day.")
        }
        Section {
            ForEach(Self.statuses(local: model.isLocal), id: \.0) { s in
                VStack(alignment: .leading, spacing: 2) {
                    Text(s.0).foleviFont(.bodyStrong).foregroundStyle(Folevi.color.ink)
                    footnote(s.1)
                }
            }
        } header: {
            Text("What the save status means").foleviFont(.caps)
        }
        if model.platform == .mac || DeviceKind.isPad {
            Section {
                ForEach(Self.shortcuts, id: \.0) { s in
                    LabeledContent { Text(s.1).font(FoleviFonts.font(.mono, size: 13)).foregroundStyle(Folevi.color.inkMuted) } label: { label(s.0) }
                }
            } header: {
                Text("Keyboard shortcuts").foleviFont(.caps)
            }
        }
    }

    /// HelpView.tsx's lists.
    static func statuses(local: Bool) -> [(String, String)] {
        local ? [
            ("Saved", "Every change is saved on this device. Your library's folder gets it a few seconds later."),
            ("Saving…", "Your latest changes are being saved on this device."),
            ("Syncing…", "Folevi is reading your library's folder and writing what it lacks."),
            ("Changed on another device", "The same block changed on two devices at once. The newer change shows, and the other is kept in version history, with a note on the block."),
            ("Not saved", "This device couldn't save a change. Open the status for details."),
        ] : [
            ("Saved", "Every change has been confirmed by the server."),
            ("Saving…", "Your latest changes are on their way."),
            ("Syncing…", "Waiting for the server to confirm."),
            ("Offline", "Keep writing. Changes are stored on this device and sync when you reconnect."),
            ("Conflict", "The same block changed in two places. Both versions are kept until you choose."),
            ("Not saved", "The server rejected a change, or you need to sign in again. Open the status for details."),
        ]
    }

    static let shortcuts: [(String, String)] = [
        ("Search or jump anywhere", "⌘ K"),
        ("New document", "⌘ ⌥ N"),
        ("Quick add task", "⌘ ⇧ A"),
        ("Toggle sidebar", "⌘ \\"),
        ("Bold / italic / underline", "⌘ B / ⌘ I / ⌘ U"),
        ("Undo / redo", "⌘ Z / ⌘ ⇧ Z"),
    ]
}

struct AboutSettingsSection: View {
    let model: SettingsModel
    var body: some View {
        Section {
            VStack(spacing: 10) {
                FoleviMark(size: 56)
                Text(model.versionText).foleviFont(.headline).foregroundStyle(Folevi.color.heading)
                    .accessibilityIdentifier("settings-version")
                footnote("Notes, tasks and linked pages.")
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
        }
        Section {
            Button { if let u = URL(string: "https://folevi.com/terms") { model.host.openURL(u) } } label: { label("Terms") }
            Button { if let u = URL(string: "https://folevi.com/privacy") { model.host.openURL(u) } } label: { label("Privacy policy") }
        }
    }
}

struct LoadingSection: View {
    var body: some View {
        Section { ProgressView().frame(maxWidth: .infinity).padding(.vertical, 8) }
    }
}

extension View {
    /// The Mac draws grouped rows on the window's canvas; iOS keeps the system's grouped background so the rows'
    /// groups read as cards on the white chrome.
    func settingsBackground() -> some View {
        #if os(macOS)
        return self.scrollContentBackground(.hidden).background(Folevi.color.canvas)
        #else
        return self
        #endif
    }
}
