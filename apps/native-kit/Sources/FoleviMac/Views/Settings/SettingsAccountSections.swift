// Settings' account sections on the Mac, drawn as the web's views/settings/*: Account (AccountSection.tsx), AI
// (AiSection.tsx), Notifications (NotificationsSection.tsx), Security (SecuritySection.tsx, SignInMethods.tsx,
// DeleteAccountCard.tsx), Devices (DevicesSection.tsx) and Offline & sync (SyncSection.tsx, the device's copy).
#if os(macOS) || os(iOS)
#if os(macOS)
import AppKit
#else
import UIKit
#endif
import SwiftUI
import FoleviDesign
import FoleviEngine

/// A row with a title, a muted sentence and a switch (AiSection.tsx PrefRow).
struct SettingsPrefRow: View {
    let label: String
    let body_: String
    let isOn: Bool
    var disabled = false
    let onChange: (Bool) -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 24) {
            VStack(alignment: .leading, spacing: 2) {
                SText(label, "ai.title")
                SText(body_, "ai.text")
            }
            .frame(maxWidth: 560, alignment: .leading)
            Spacer(minLength: 0)
            SettingsSwitch(isOn: isOn, label: label, disabled: disabled, onChange: onChange).padding(.top, 2)
        }
    }
}

/// A labelled field (`label.text-subheadline > span.mb-1.font-medium`) with an optional hint under it.
struct SettingsLabelled<Content: View>: View {
    let label: String
    var hint: String?
    @ViewBuilder let content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            SText(label, "field.label").padding(.bottom, 4)
            content
            if let hint { SText(hint, "row.hint").padding(.top, 4) }
        }
    }
}

// MARK: Account

struct AccountSettingsView: View {
    let model: MacSettingsModel
    @State private var name: String?
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let a = model.account.value
        VStack(alignment: .leading, spacing: 20) {
            SettingsCard("Profile") {
                VStack(alignment: .leading, spacing: 0) {
                    SText("Profile picture", "field.label").padding(.bottom, 8)
                    HStack(spacing: 16) {
                        avatar(a)
                        WebButton(a?.avatarUrl == nil ? "Upload…" : "Change…") { pickAvatar() }
                        if a?.avatarUrl != nil { WebButton("Remove", variant: .ghost) { Task { await model.perform(.settingsRemoveAvatar, done: "Removed") } } }
                    }
                    .padding(.bottom, 20)
                    VStack(alignment: .leading, spacing: 16) {
                        SettingsLabelled(label: "Name") { SettingsField(placeholder: "", text: Binding(get: { name ?? a?.name ?? "" }, set: { name = $0 })) { save() } }
                        SettingsLabelled(label: "Email", hint: "Your sign-in address. Contact support to change it.") {
                            Text(a?.email ?? "").webText(SettingsStyle.pair("input").resolve(scheme).text).foregroundStyle(SettingsColor.v("color-ink-muted", scheme))
                                .padding(.horizontal, 12).frame(maxWidth: .infinity, minHeight: 28, alignment: .leading)
                                .webBox(WebStyles.named("frame.sidebar.search"))
                        }
                        SettingsLabelled(label: "Time zone", hint: "Used for Today, the calendar and reminders.") {
                            SettingsSelect(options: TimeZone.knownTimeZoneIdentifiers.map { .init(value: $0, label: $0) }, value: a?.timeZone ?? TimeZone.current.identifier) { z in
                                Task { await model.perform(.settingsUpdate(timeZone: z), done: "Saved") }
                            }
                        }
                        WebButton("Save", variant: .primary) { save() }
                    }
                    .frame(maxWidth: 448, alignment: .leading)
                }
            }
            AiSettingCard(model: model)
        }
    }

    private func avatar(_ a: AccountSettings?) -> some View {
        ZStack {
            Circle().fill(SettingsColor.v("glass-hover", scheme))
            if let url = a?.avatarUrl.flatMap(URL.init(string:)) {
                AsyncImage(url: url) { $0.resizable().scaledToFill() } placeholder: { Color.clear }.clipShape(Circle())
            } else {
                Text(String((a?.name ?? "?").prefix(1)).uppercased()).webText(.role(.title3)).foregroundStyle(SettingsColor.v("color-heading", scheme))
            }
        }
        .frame(width: 56, height: 56)
    }

    private func save() {
        guard let n = name?.trimmingCharacters(in: .whitespaces), !n.isEmpty else { return }
        Task { await model.perform(.settingsUpdate(name: n), done: "Saved") }
    }

    private func pickAvatar() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.jpeg, .png, .webP, .gif]
        guard panel.runModal() == .OK, let url = panel.url, let data = try? Data(contentsOf: url) else { return }
        let types = ["jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp", "gif": "image/gif"]
        Task { await model.perform(.settingsSetAvatar(data: data.base64EncodedString(), mimeType: types[url.pathExtension.lowercased()] ?? "image/jpeg", name: url.lastPathComponent), done: "Saved") }
    }
}

/// Foli AI on or off for this person (AccountSection.tsx AiSettingCard).
struct AiSettingCard: View {
    let model: MacSettingsModel
    var body: some View {
        let ai = model.ai.value
        let core = ai.map { !$0.included } ?? false
        SettingsCard("Foli AI") {
            HStack(alignment: .top, spacing: 24) {
                SText(core ? "Not included in Core. Your notes stay yours: nothing is sent to an AI model. Pro and Pro AI include Foli AI." : "Foli AI answers from your notes, helps you write and sums notes up, powered by Google Gemini. When you use it, your request and the notes it needs are sent to Google; nothing is sent while it's off, and Foli AI's buttons are hidden.", "toggle.text")
                    .frame(maxWidth: 560, alignment: .leading)
                Spacer(minLength: 0)
                SettingsSwitch(isOn: (ai?.enabled ?? false) && !core, label: "Foli AI", disabled: core) { on in
                    Task { await model.perform(.settingsUpdate(aiEnabled: on), done: on ? "Foli AI turned on" : "Foli AI turned off") }
                }
            }
        }
    }
}

// MARK: AI (account)

struct AccountAiSettings: View {
    let model: MacSettingsModel

    private struct Pref: Identifiable { var key: AiPrefKey, label: String, body: String, on: String, off: String; var id: String { key.rawValue } }
    private static let settings: [Pref] = [
        Pref(key: .memory, label: "Memory", body: "Let Foli AI remember things you approve, like the tone you like or words you use. You'll see and edit everything it remembers below.", on: "Memory turned on", off: "Memory turned off"),
        Pref(key: .suggestions, label: "Suggestions", body: "Quiet hints at the end of a note, such as related notes, possible duplicates, open questions and action items. They're found without sending anything to AI.", on: "Suggestions turned on", off: "Suggestions turned off"),
        Pref(key: .attachments, label: "Read attachments", body: "Let Foli AI read files you add to a question, such as PDFs, images, text and spreadsheets, and transcribe recordings when you ask. Files are only read when you send them.", on: "Attachments turned on", off: "Attachments turned off"),
        Pref(key: .webResearch, label: "Web research", body: "Let Foli AI search the web and read pages you link when you ask it to, with links to what it found. This also turns on Research. Searches go through Google Search.", on: "Web research turned on", off: "Web research turned off"),
        Pref(key: .digests, label: "Digests", body: "A daily or weekly summary of what changed in your notes, saved as a note in your Inbox. It uses your AI credits and is never emailed.", on: "Digests turned on", off: "Digests turned off"),
    ]
    private static let images: [Pref] = [
        Pref(key: .deviceText, label: "Read text on your devices", body: "In the iPhone, iPad and Mac apps, the words in your images and handwriting are read on the device, so search finds them. Nothing is sent anywhere. The words in PDFs are always searchable.", on: "Images are read on your devices", off: "Images aren't read on your devices"),
        Pref(key: .readImages, label: "Read images with Foli AI", body: "In a browser, Foli AI reads the words in images you add, so search finds them. Each image uses a few AI credits. When this is off, choose Make text in images searchable in a note's menu whenever you want it.", on: "Foli AI reads images you add", off: "Foli AI doesn't read images you add"),
    ]

    var body: some View {
        let ai = model.ai.value
        let core = ai.map { !$0.included } ?? false
        VStack(alignment: .leading, spacing: 20) {
            AiSettingCard(model: model)
            SettingsCard("Conversations") {
                SettingsPrefRow(label: "Keep conversations", body_: "Your AI conversations are saved so you can come back to them, rename, pin and search them. Only you can see them, unless you share one with your workspace. When this is off, a conversation is deleted as soon as you close it. Conversations you already have stay until you delete them.", isOn: ai?.history ?? true, disabled: core) { set(.history, $0, "Conversations are kept", "New conversations aren't kept") }
            }
            SettingsCard("How Foli AI works for you", description: "The server checks each of these wherever the feature runs.") {
                SettingsDivided(Self.settings, gap: 14) { p in
                    SettingsPrefRow(label: p.label, body_: p.body, isOn: value(ai, p.key), disabled: core) { set(p.key, $0, p.on, p.off) }
                }
            }
            SettingsCard("Search in images", description: "So search finds the words in your images and handwriting, like the words in your PDFs.") {
                SettingsDivided(Self.images, gap: 14) { p in
                    SettingsPrefRow(label: p.label, body_: p.body, isOn: value(ai, p.key), disabled: p.key == .readImages && core) { set(p.key, $0, p.on, p.off) }
                }
            }
            MemoryCard(model: model)
        }
    }

    private func value(_ ai: AiSettings?, _ k: AiPrefKey) -> Bool {
        guard let ai else { return false }
        switch k {
        case .history: return ai.history
        case .memory: return ai.memory
        case .suggestions: return ai.suggestions
        case .attachments: return ai.attachments
        case .webResearch: return ai.webResearch
        case .digests: return ai.digests
        case .readImages: return ai.readImages
        case .deviceText: return ai.deviceText
        }
    }

    private func set(_ k: AiPrefKey, _ on: Bool, _ yes: String, _ no: String) {
        Task { await model.perform(.settingsSetAiPref(key: k, on: on), done: on ? yes : no) }
    }
}

// MARK: Notifications

struct NotificationSettingsView: View {
    let model: MacSettingsModel
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let n = model.notifications.value
        VStack(alignment: .leading, spacing: 20) {
            SettingsCard("Notifications", description: "Choose what reaches you in the app (the bell) and by email. Emails say who did what and where, with a link. They never include your notes or comment text; a reminder shows only its own to-do line. Security emails (new sign-ins, account deletion) can't be turned off.") {
                VStack(spacing: 0) {
                    HStack(alignment: .bottom, spacing: 8) {
                        SText("Notify me about", "row.hint", weight: 500).frame(maxWidth: .infinity, alignment: .leading)
                        SText("In app", "row.hint", weight: 500).frame(width: 72)
                        SText("Email", "row.hint", weight: 500).frame(width: 72)
                    }
                    .padding(.bottom, 8)
                    Rectangle().fill(SettingsColor.v("color-line", scheme)).frame(height: 1)
                    SettingsDivided(n?.topics ?? [], gap: 12, line: "row") { t in
                        HStack(spacing: 8) {
                            VStack(alignment: .leading, spacing: 0) {
                                SText(t.label, "row.label")
                                SText(t.hint, "row.hint")
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            SettingsSwitch(isOn: t.inApp, label: "\(t.label) in the app") { on in Task { await model.perform(.settingsSetNotificationTopic(topic: t.id, inApp: on), done: "Saved") } }.frame(width: 72)
                            SettingsSwitch(isOn: t.email, label: "\(t.label) by email") { on in Task { await model.perform(.settingsSetNotificationTopic(topic: t.id, email: on), done: "Saved") } }.frame(width: 72)
                        }
                    }
                    .padding(.top, 12)
                }
                .settingsRowWidth(576, alignment: .center)
            }
            SettingsCard("Notifications on this Mac", description: "Reminders and mentions show up here even when Folevi isn’t open, following the In app choices above. A reminder shows its to-do line; a mention says only who and where.") {
                WebButton("Open Desktop app settings") { model.frame.open(.web("/settings/desktop")) }
            }
            SettingsCard("Email delivery", description: "How comment, reply and mention emails arrive. Shares, invitations and access changes are always sent as they happen.") {
                HStack(spacing: 16) {
                    VStack(alignment: .leading, spacing: 0) {
                        SText("Send comment emails", "row.label")
                        SText("The daily digest lists what you haven’t read yet, by page title only, once a day.", "row.hint")
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    SettingsSelect(options: [.init(value: "off", label: "As they happen"), .init(value: "daily", label: "In a daily digest")], value: n?.digest ?? "off", width: 176) { v in
                        Task { await model.perform(.settingsSetNotificationEmails(digest: NotificationEmailsArgs.Digest(rawValue: v)), done: "Saved") }
                    }
                }
                .settingsRowWidth(576, alignment: .center)
            }
        }
    }
}

extension NotificationTopicSetting: Identifiable {}

// MARK: Security

struct SecuritySettingsView: View {
    let model: MacSettingsModel
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let s = model.security.value
        VStack(alignment: .leading, spacing: 20) {
            SettingsCard("Sign-in methods", description: "The ways you can sign in to Folevi.") {
                SettingsTerms(rows: [("Sign-in methods", (s?.methods ?? []).map(Self.methodName).joined(separator: ", "), nil)])
            }
            SettingsCard("Two-step verification") {
                VStack(alignment: .leading, spacing: 12) {
                    SettingsTerms(rows: [("Status", s?.twoFactor == true ? "On" : s?.twoFactor == false ? "Off" : "…", nil)])
                    WebButton(s?.twoFactor == true ? "Manage two-step verification…" : "Turn on two-step verification…") { model.frame.toast("Two-step verification opens in your browser.") ; open("/settings/security") }
                }
            }
            SettingsCard("Passkeys", description: "Sign in with Touch ID or your device's lock instead of a password.") {
                VStack(alignment: .leading, spacing: 12) {
                    if let keys = s?.passkeys, !keys.isEmpty {
                        SettingsDivided(keys, gap: 10, line: "row") { k in
                            HStack {
                                SText(k.name, "row.label").frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }
                    } else {
                        SMuted("No passkeys yet.")
                    }
                }
            }
            DeleteAccountCard(model: model)
        }
    }

    private func open(_ path: String) {
        if let url = URL(string: "https://folevi.com\(path)") { model.frame.host?.frameOpenExternal(url) }
    }

    static func methodName(_ m: String) -> String {
        switch m {
        case "password", "credential": "Password"
        case "google": "Google"
        case "apple": "Apple"
        case "passkey": "Passkey"
        default: m.capitalized
        }
    }
}

extension PasskeyRow: Identifiable {}
extension SessionRow: Identifiable {}

struct DeleteAccountCard: View {
    let model: MacSettingsModel
    var body: some View {
        SettingsCard("Delete account", description: "Deletes your account, your Personal and everything in it after a 7-day grace period, along with workspaces you own that nobody else is in. Export your data first if you want to keep it.") {
            WebButton("Delete account…", variant: .danger) {
                settingsConfirm("Delete your account?", message: "Your account, your Personal and everything in it are deleted after 7 days. Sign in before then to cancel.", confirm: "Schedule deletion", in: NSApp.keyWindow) {
                    Task { await model.mutate("users.requestAccountDeletion", done: "Deletion scheduled") }
                }
            }
        }
    }
}

// MARK: Devices

struct DevicesSettingsView: View {
    let model: MacSettingsModel
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let d = model.details.value
        let sessions = model.security.value?.sessions ?? []
        VStack(alignment: .leading, spacing: 20) {
            SettingsCard("Connected devices") {
                SettingsTerms(rows: [("Devices connected", d?.devicesActive.map { n in d?.deviceLimit.map { "\(n) of \($0)" } ?? "\(n)" } ?? "…", nil)])
            }
            SettingsCard("Signed in", description: "Browsers and apps signed in to your account. Signing a device out ends its session right away; it asks for your password and code to sign in again.") {
                VStack(alignment: .leading, spacing: 12) {
                    SettingsDivided(sessions, gap: 10, line: "row") { s in
                        HStack(spacing: 12) {
                            VStack(alignment: .leading, spacing: 0) {
                                SText(s.current ? "\(s.label) · This device" : s.label, "row.label")
                                SText("\(s.client) · Last active \(RelativeDateTimeFormatter().localizedString(for: Date(timeIntervalSince1970: s.lastSeenAt / 1000), relativeTo: Date()))", "row.hint")
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            if !s.current { WebButton("Sign out", size: .sm) { Task { await model.perform(.sessionRevoke(id: s.id), done: "Signed out") } } }
                        }
                    }
                }
            }
        }
    }
}

// MARK: Offline & sync

struct SyncSettingsView: View {
    let model: MacSettingsModel

    var body: some View {
        let s = model.storage.value
        VStack(alignment: .leading, spacing: 20) {
            SettingsCard("This device", description: "Folevi keeps your recent documents and every unsent change on this Mac, so you can keep writing offline and nothing is lost if a window closes.") {
                VStack(alignment: .leading, spacing: 16) {
                    SettingsTerms(rows: [
                        ("Connection", model.session?.online == false ? "Offline" : "Online", nil),
                        ("Changes waiting to sync", "\(s?.waiting ?? 0)", nil),
                        ("Notes kept", s?.notesKept.map(String.init) ?? "…", nil),
                        ("Space used", s?.usedBytes.map { ByteCountFormatter.string(fromByteCount: Int64($0), countStyle: .file) } ?? "…", nil),
                    ])
                    SettingsSwitchRow(label: "Keep all notes on this Mac", hint: "Every note and its attachments stay on this Mac, so all of them open offline.", isOn: s?.keepAll ?? false, disabled: s?.available == false) { on in
                        Task { await model.perform(.deviceKeepAll(on: on), done: "Saved") }
                    }
                    .settingsRowWidth(576, alignment: .center)
                    SettingsButtons {
                        WebButton("Download everything now") { Task { await model.perform(.deviceDownload) } }
                        WebButton("Remove this Mac's copy…", variant: .danger) {
                            settingsConfirm("Remove this Mac's copy?", message: "Notes stay in your account. They download again when you open them.", confirm: "Remove", in: NSApp.keyWindow) {
                                Task { await model.perform(.deviceRemoveCopy(force: true), done: "Removed") }
                            }
                        }
                    }
                }
            }
        }
    }
}

/// The account sections that read the server through the Convex allowlist (SettingsAccountMore.swift).
struct AccountOnlySettings: View {
    let model: MacSettingsModel
    let section: MacSettingsSection
    var body: some View {
        if model.isLocal {
            SettingsCard("Sign in to Folevi", description: "This needs a Folevi account. Your library stays on your devices.") {
                WebButton("Sign in to Folevi…") { model.frame.host?.frameSignInAnotherAccount() }
            }
        } else {
            AccountMoreSettings(model: model, section: section)
        }
    }
}
#endif
