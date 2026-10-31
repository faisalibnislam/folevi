// Settings' sections a library has (local mode), drawn as the web's: Library (views/settings/LibrarySection.tsx),
// AI on the device (LocalAiSection.tsx, AiMemory.tsx), Appearance (AppearanceSection.tsx), Desktop app
// (DesktopSection.tsx). Their words come from the engine (viewsSettings.ts), as the web words them.
#if os(macOS) || os(iOS)
#if os(macOS)
import AppKit
#else
import UIKit
#endif
import SwiftUI
import FoleviDesign
import FoleviEngine

// MARK: shapes from settings.query

struct LibraryData: Decodable {
    struct Connection: Decodable {
        var provider: String, name: String, state: String, text: String, account: String, offline: String?, connectLabel: String, canConnect: Bool, canSignOut: Bool, signInWait: String
    }
    struct Choice: Decodable, Identifiable { var kind: String, title: String, detail: String; var id: String { kind } }
    struct Place: Decodable {
        var kind: String, path: String, status: String, problem: String?, canSync: Bool, canMove: Bool, connection: Connection?, moveChoices: [Choice]
    }
    struct Device: Decodable, Identifiable { var id: String, phone: Bool, name: String, here: String?, detail: String, when: String }
    struct HealthItem: Decodable, Identifiable { var path: String, title: String?, since: String, detail: String?; var id: String { path } }
    struct HealthGroup: Decodable, Identifiable { var key: String, title: String, icon: String, why: String, count: Int, items: [HealthItem], more: String?; var id: String { key } }
    struct Health: Decodable { var description: String, clean: Bool, groups: [HealthGroup] }
    struct Passphrase: Decodable { var encrypted: Bool, description: String, min: Int }
    struct LockChoice: Decodable { var value: Int, label: String }
    struct Lock: Decodable { var on: Bool, unavailable: Bool, label: String, description: String, after: Int, afterLabel: String, choices: [LockChoice] }
    struct Ai: Decodable { var description: String, keysWhere: String }
    struct Forget: Decodable { var title: String, description: String, button: String, dialogTitle: String, dialogDescription: String }
    var local: Bool
    var place: Place
    var devices: [Device]?
    var health: Health?
    var passphrase: Passphrase?
    var lock: Lock?
    var ai: Ai
    var forget: Forget?
}

struct LocalAiData: Decodable {
    struct OnDevice: Decodable { var title: String, status: String, name: String, text: String, more: String? }
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
    var hosted: Bool, loaded: Bool, on: Bool, history: Bool, onText: String, checking: String
    var onDevice: OnDevice
    var keysDescription: String
    var keys: [Key]
    var model: ModelInfo
    var historyText: String
    var memory: Bool
}

struct DesktopData: Decodable {
    struct Settings: Decodable { var quickAddShortcut: String, shortcutLabel: String, defaultShortcut: String, defaultLabel: String, error: String?, openAtLogin: Bool, menuBarIcon: Bool, notifications: Bool }
    var bridge: Bool, loaded: Bool
    var settings: Settings?
}

extension ValueStore where Value == SettingsQueryValue {
    func data<T: Decodable>(_ t: T.Type) -> T? { value?.data.decoded(T.self) }
}

// MARK: Library

struct LibrarySettings: View {
    let model: MacSettingsModel
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let store = model.query(.library)
        if let d = store.data(LibraryData.self) {
            VStack(alignment: .leading, spacing: SettingsStyle.pair("card").light.margin.bottom) {
                placeCard(d)
                if let devices = d.devices { devicesCard(devices) }
                if let h = d.health { healthCard(h) }
                if let p = d.passphrase { passphraseCard(p) }
                if let l = d.lock { lockCard(l) }
                SettingsCard("Foli AI", description: d.ai.description) {
                    (Text("Choose the model and add your keys in ")
                        + Text("Settings, under AI").foregroundColor(SettingsColor.v("color-ink", scheme)).underline()
                        + Text(d.ai.keysWhere))
                        .webText(SettingsStyle.pair("link.text").resolve(scheme).text)
                        .foregroundStyle(SettingsStyle.pair("link.text").resolve(scheme).color.color)
                        .fixedSize(horizontal: false, vertical: true)
                        .onTapGesture { model.frame.open(.web("/settings/ai")) }
                        .accessibilityAddTraits(.isLink)
                }
                SettingsCard("Folevi account", description: "Sign in to Folevi to share notes and work on them with other people. Your library comes with you into the account.") {
                    WebButton("Sign in to Folevi…") { model.frame.host?.frameSignInAnotherAccount() }
                }
                if let f = d.forget { forgetCard(f) }
            }
        } else {
            SMuted("Loading…")
        }
    }

    private func placeCard(_ d: LibraryData) -> some View {
        SettingsCard("Where your library is", description: "Folevi keeps your notes as files in one folder. Other devices that use the same place share the library.") {
            VStack(alignment: .leading, spacing: 0) {
                SettingsTerms(rows: [("Syncs with", d.place.kind, nil), ("Location", d.place.path, nil), ("Status", d.place.status, nil)] + (d.place.problem.map { [("Last problem", $0, SettingsColor.v("color-danger", scheme))] } ?? []))
                if let c = d.place.connection { connection(c) }
                SettingsButtons {
                    WebButton(model.busy.contains("library.syncNow") ? "Syncing…" : "Sync now") { Task { await model.run(.librarySyncNow, tone: .info) } }
                        .disabled(!d.place.canSync || model.busy.contains("library.syncNow"))
                    WebButton("Move library…") { move(d) }.disabled(!d.place.canMove)
                }
                .padding(.top, SettingsStyle.pair("buttons").light.margin.top)
            }
        }
    }

    private func connection(_ c: LibraryData.Connection) -> some View {
        let line = SettingsColor.v("color-line", scheme)
        return VStack(alignment: .leading, spacing: 12) {
            if model.busy.contains("library.cloudConnect") {
                HStack(spacing: 12) {
                    ProgressView().controlSize(.small)
                    SText(c.signInWait, "dd").frame(maxWidth: .infinity, alignment: .leading)
                    WebButton("Cancel", size: .sm) { Task { await model.run(.libraryCloudCancel, quiet: true) } }
                }
            } else {
                if c.state == "connected" || c.state == "offline" {
                    (Text("Connected as ") + Text(c.account).foregroundColor(SettingsColor.v("color-heading", scheme)) + Text(c.offline ?? "").foregroundColor(SettingsColor.v("color-ink-muted", scheme)))
                        .webText(SettingsStyle.pair("dd").resolve(scheme).text).fixedSize(horizontal: false, vertical: true)
                } else {
                    SText(c.text, c.state == "reconnect" ? "dd" : "muted")
                }
                HStack(spacing: 8) {
                    if c.canConnect { WebButton(c.connectLabel, variant: .primary, size: .sm) { Task { await model.run(.libraryCloudConnect, ["provider": .string(c.provider)]) } } }
                    if c.canSignOut {
                        WebButton("Sign out of \(c.name)…", size: .sm) {
                            settingsConfirm("Sign out of \(c.name)?", message: "Folevi stops syncing with \(c.name). Your notes stay on this Mac and in \(c.name). To sync again, connect again or move the library somewhere else.", confirm: "Sign out", in: NSApp.keyWindow) {
                                Task { await model.run(.libraryCloudSignOut, tone: .info) }
                            }
                        }
                    }
                }
            }
        }
        .padding(EdgeInsets(top: 12, leading: 16, bottom: 12, trailing: 16))
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(line, lineWidth: 1))
        .padding(.top, 16)
    }

    private func move(_ d: LibraryData) {
        guard let window = NSApp.keyWindow else { return }
        SettingsDialogWindow.show(over: window) {
            MoveLibraryDialog(model: model, choices: d.place.moveChoices)
        }
    }

    private func devicesCard(_ devices: [LibraryData.Device]) -> some View {
        SettingsCard("Devices", description: "Every device that opens this library, and when each last synced with it.") {
            if devices.isEmpty {
                SMuted("No device has synced yet.")
            } else {
                SettingsDivided(devices, gap: 10, line: "key.row") { d in DeviceRow(device: d) }
            }
        }
    }

    private func healthCard(_ h: LibraryData.Health) -> some View {
        SettingsCard("Library health", description: h.description) {
            VStack(alignment: .leading, spacing: 16) {
                if h.clean { SMuted("Nothing to fix.") }
                ForEach(h.groups) { g in
                    VStack(alignment: .leading, spacing: 0) {
                        HStack(spacing: 8) {
                            WebIconView(g.icon == "triangleAlert" ? .triangleAlert : g.icon == "cloudDownload" ? .cloudDownload : .hourglass, size: 15)
                                .foregroundStyle(g.icon == "triangleAlert" ? SettingsColor.v("color-danger", scheme) : SettingsColor.v("color-ink-muted", scheme))
                            SText(g.title, "dd", weight: 600, color: SettingsColor.v("color-heading", scheme))
                            SText("\(g.count)", "muted")
                        }
                        SText(g.why, "muted").frame(maxWidth: 576, alignment: .leading).padding(.top, 4)
                        VStack(alignment: .leading, spacing: 4) {
                            ForEach(g.items) { i in
                                HStack(alignment: .firstTextBaseline, spacing: 8) {
                                    SText(i.title ?? i.path, "dd", weight: 500)
                                    if i.title != nil { Text(i.path).font(WebFont.font(.mono, size: 12)).foregroundStyle(SettingsColor.v("color-ink-faint", scheme)).lineLimit(1) }
                                    SText(i.since, "muted")
                                }
                                if let detail = i.detail { SMuted(detail) }
                            }
                            if let more = g.more { SMuted(more) }
                        }
                        .padding(.top, 8)
                    }
                }
            }
        }
    }

    private func passphraseCard(_ p: LibraryData.Passphrase) -> some View {
        SettingsCard("Passphrase", description: p.description) {
            SettingsButtons {
                if p.encrypted {
                    WebButton("Change passphrase…") { passphrase(.change, min: p.min) }
                    Button { passphrase(.remove, min: p.min) } label: {
                        Text("Remove passphrase…").webText(WebStyles.named("button.quiet.md").resolve(scheme).text)
                            .foregroundStyle(SettingsColor.v("color-danger", scheme))
                            .webElement(WebStyles.named("button.quiet.md"))
                    }
                    .buttonStyle(.plain)
                } else {
                    WebButton("Encrypt with a passphrase…") { passphrase(.set, min: p.min) }
                }
            }
        }
    }

    private func passphrase(_ kind: PassphraseDialog.Kind, min: Int) {
        guard let window = NSApp.keyWindow else { return }
        SettingsDialogWindow.show(over: window) { PassphraseDialog(model: model, kind: kind, min: min) }
    }

    private func lockCard(_ l: LibraryData.Lock) -> some View {
        SettingsCard("App lock", description: l.description) {
            VStack(alignment: .leading, spacing: SettingsStyle.pair("lock.row").light.gap) {
                HStack {
                    SText(l.label, "lock.label")
                    Spacer(minLength: 16)
                    SettingsSwitch(isOn: l.on, label: l.label, disabled: l.unavailable || model.busy.contains("library.lock")) { on in
                        Task { await model.run(.libraryLock, ["lock": .bool(on)], quiet: false) }
                    }
                }
                .frame(height: SettingsStyle.pair("lock.row").light.height)
                if l.on {
                    HStack {
                        SText("Ask again when you come back", "lock.label")
                        Spacer(minLength: 12)
                        SettingsSelect(options: l.choices.map { .init(value: String($0.value), label: $0.label) }, value: String(l.after), width: 192) { v in
                            Task { await model.run(.libraryLock, ["lockAfter": .number(Double(v) ?? 0)]) }
                        }
                    }
                }
            }
        }
    }

    private func forgetCard(_ f: LibraryData.Forget) -> some View {
        SettingsCard(f.title, description: f.description) {
            WebButton(f.button, variant: .danger) {
                settingsConfirm(f.dialogTitle, message: f.dialogDescription, confirm: "Remove", in: NSApp.keyWindow) {
                    Task { await model.run(.libraryForget) }
                }
            }
            .disabled(model.busy.contains("library.forget"))
        }
    }
}

private struct DeviceRow: View {
    let device: LibraryData.Device
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let icon = SettingsStyle.pair("device.icon")
        let row = SettingsStyle.pair("device.row").light
        HStack(spacing: row.gap) {
            WebIconView(device.phone ? .smartphone : .laptop, size: 16)
                .frame(width: icon.light.width, height: icon.light.height)
                .foregroundStyle(icon.resolve(scheme).color.color)
                .webBox(icon)
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: SettingsStyle.pair("device.here").light.margin.left) {
                    SText(device.name, "device.name", lines: 1)
                    if let here = device.here { SText(here, "device.here", lines: 1) }
                }
                SText(device.detail, "device.sub", lines: 1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            SText(device.when, "device.when", lines: 1)
        }
    }
}

/// Move library: the places, then library.move (the provider's sign-in first, when it's one).
private struct MoveLibraryDialog: View {
    let model: MacSettingsModel
    let choices: [LibraryData.Choice]
    @State private var busy: String?
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        SettingsDialogView(title: "Move your library", description: "Folevi copies every file to the new place, checks each one arrived, then uses it. Keep Folevi open until it's done. Other devices need to be moved too.", width: 512, close: { SettingsDialogWindow.closeCurrent() }) {
            VStack(spacing: 10) {
                ForEach(choices) { c in
                    Button {
                        busy = c.kind
                        Task {
                            let r = await model.run(.libraryMove, ["kind": .string(c.kind)])
                            busy = nil
                            if case .object(let o)? = r, o["moved"] == .bool(true) { SettingsDialogWindow.closeCurrent() }
                        }
                    } label: {
                        HStack(alignment: .top, spacing: 12) {
                            WebIconView(c.kind == "icloud" ? .cloud : c.kind == "folder" ? .folder : .hardDrive, size: 20)
                            VStack(alignment: .leading, spacing: 2) {
                                SText(c.title, "dd", weight: 600, color: SettingsColor.v("color-heading", scheme))
                                SMuted(c.detail)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            if busy == c.kind { ProgressView().controlSize(.small) }
                        }
                        .padding(14)
                        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(SettingsColor.v("color-line", scheme)))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(busy != nil)
                }
            }
        } footer: { EmptyView() }
    }
}

/// Encrypt with a passphrase, Change passphrase, Remove the passphrase (LibrarySection.tsx's dialogs).
private struct PassphraseDialog: View {
    enum Kind { case set, change, remove }
    let model: MacSettingsModel
    let kind: Kind
    let min: Int
    @State private var current = ""
    @State private var passphrase = ""
    @State private var confirm = ""
    @State private var understood = false
    @State private var problem: String?
    @State private var busy = false
    @Environment(\.colorScheme) private var scheme

    private var title: String { kind == .set ? "Encrypt with a passphrase" : kind == .change ? "Change passphrase" : "Remove the passphrase?" }
    private var description: String {
        switch kind {
        case .set: "Folevi rewrites every file in the library, encrypted. A large library takes a few minutes; keep Folevi open. Other devices ask for the passphrase once."
        case .change: "Your other devices ask for the new passphrase the next time they sync."
        case .remove: "Folevi rewrites every file without encryption. Anyone who can open the folder, or your account with the sync service, can then read your notes."
        }
    }

    var body: some View {
        SettingsDialogView(title: title, description: description, width: kind == .remove ? 384 : 512, close: { if !busy { SettingsDialogWindow.closeCurrent() } }) {
            VStack(alignment: .leading, spacing: 12) {
                if kind != .set { labelled(kind == .change ? "Current passphrase" : "Passphrase") { SettingsField(placeholder: "", text: $current, secure: true, height: 40) } }
                if kind != .remove {
                    HStack(alignment: .top, spacing: 10) {
                        WebIconView(.shieldAlert, size: 18).foregroundStyle(SettingsColor.v("color-danger", scheme))
                        (Text("If you lose this passphrase, nobody can open the synced copy of your notes.").bold() + Text(" Folevi can't reset it or recover it. Write it down and keep it somewhere safe."))
                            .webText(.role(.body)).foregroundStyle(SettingsColor.v("color-ink", scheme)).fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(EdgeInsets(top: 12, leading: 14, bottom: 12, trailing: 14))
                    .background(RoundedRectangle(cornerRadius: 10).fill(SettingsColor.v("color-danger", scheme).opacity(0.09)))
                    labelled(kind == .change ? "New passphrase" : "Passphrase") { SettingsField(placeholder: "", text: $passphrase, secure: true, height: 40) }
                    labelled("Type it again") { SettingsField(placeholder: "", text: $confirm, secure: true, height: 40) }
                    SMuted("Use at least \(min) characters. A few unrelated words are easy to remember and hard to guess.")
                    Toggle("I understand Folevi can't recover a lost passphrase", isOn: $understood).checkboxStyle()
                        .webText(.role(.body))
                }
                if let problem { Text(problem).webText(.role(.body)).foregroundStyle(SettingsColor.v("color-danger", scheme)) }
            }
            .onChange(of: current) { problem = nil }
            .onChange(of: passphrase) { problem = nil }
            .onChange(of: confirm) { problem = nil }
        } footer: {
            WebButton("Cancel") { SettingsDialogWindow.closeCurrent() }.disabled(busy)
            WebButton(kind == .set ? (busy ? "Encrypting…" : "Encrypt") : kind == .change ? "Change passphrase" : (busy ? "Removing…" : "Remove passphrase"), variant: kind == .remove ? .danger : .primary) { submit() }.disabled(busy)
        }
    }

    private func labelled<C: View>(_ label: String, @ViewBuilder _ field: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            SMuted(label)
            field()
        }
    }

    private func submit() {
        if kind != .set, current.isEmpty { problem = kind == .change ? "Enter the current passphrase." : "Enter the passphrase to confirm."; return }
        if kind != .remove {
            if passphrase.count < min { problem = "Use at least \(min) characters."; return }
            if passphrase != confirm { problem = "The two passphrases don't match."; return }
            if !understood { problem = "Tick the box to say you understand a lost passphrase can't be recovered."; return }
        }
        busy = true
        Task {
            let key: SettingsRunKey = kind == .set ? .librarySetPassphrase : kind == .change ? .libraryChangePassphrase : .libraryRemovePassphrase
            var args: [String: JSONValue] = [:]
            if kind != .set { args["current"] = .string(current) }
            if kind != .remove { args["passphrase"] = .string(passphrase) }
            do {
                let r = try await model.client.command(.settingsRun(key: key, args: args))
                if case .object(let o) = r.data, case .string(let m)? = o["message"] { model.frame.toast(m, tone: kind == .remove ? .info : .success) }
                SettingsDialogWindow.closeCurrent()
            } catch {
                problem = MacSettingsModel.message(error)
            }
            busy = false
        }
    }
}

// MARK: AI on the device

struct LocalAiSettings: View {
    let model: MacSettingsModel
    @State private var keyBusy = false
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let store = model.query(.localAi)
        if let d = store.data(LocalAiData.self) {
            VStack(alignment: .leading, spacing: SettingsStyle.pair("card").light.margin.bottom) {
                toggleCard("Foli AI", text: d.onText, isOn: d.on, label: "Foli AI") { on in
                    Task { await model.mutate("users.updateProfile", ["aiEnabled": .bool(on)], done: on ? "Foli AI turned on" : "Foli AI turned off") }
                }
                if !d.hosted {
                    SettingsCard("On this device") { SMuted("Foli AI in a library on your devices needs Folevi for Mac: it runs on Apple Intelligence there, or on your own key.") }
                } else {
                    if !d.loaded {
                        HStack(spacing: 8) { ProgressView().controlSize(.mini); SMuted(d.checking) }
                    }
                    onDeviceCard(d.onDevice)
                    SettingsCard("Your own keys", description: d.keysDescription) {
                        SettingsDivided(d.keys, gap: 14) { k in KeyRow(model: model, key: k, busy: $keyBusy) }
                    }
                    modelCard(d.model)
                    toggleCard("Conversations", text: d.historyText, isOn: d.history, label: "Keep conversations") { on in
                        Task { await model.mutate("users.updateProfile", ["aiPrefs": .object(["history": .bool(on)])], done: on ? "Conversations are kept" : "New conversations aren't kept") }
                    }
                    if d.memory { MemoryCard(model: model) }
                }
            }
        } else {
            SMuted("Loading…")
        }
    }

    private func toggleCard(_ title: String, text: String, isOn: Bool, label: String, onChange: @escaping (Bool) -> Void) -> some View {
        SettingsCard(title) {
            HStack(alignment: .top, spacing: SettingsStyle.pair("toggle.row").light.gap) {
                SText(text, "toggle.text").frame(maxWidth: 65 * 8.6, alignment: .leading)
                Spacer(minLength: 0)
                SettingsSwitch(isOn: isOn, label: label, onChange: onChange)
            }
        }
    }

    private func onDeviceCard(_ o: LocalAiData.OnDevice) -> some View {
        SettingsCard(o.title) {
            HStack(alignment: .top, spacing: 12) {
                let badge = SettingsStyle.pair("ai.badge")
                WebIconView(.laptop, size: 16)
                    .foregroundStyle(badge.resolve(scheme).color.color)
                    .frame(width: badge.light.width, height: badge.light.height)
                    .webBox(badge)
                    .padding(.top, badge.light.margin.top)
                VStack(alignment: .leading, spacing: 0) {
                    SText(o.name, "ai.title")
                    SText(o.text, "ai.text").padding(.top, 2)
                    if let more = o.more { SText(more, "ai.more").padding(.top, 4) }
                }
            }
        }
    }

    private func modelCard(_ m: LocalAiData.ModelInfo) -> some View {
        SettingsCard("Model", description: m.description) {
            if let none = m.missing {
                SMuted(none)
            } else {
                VStack(alignment: .leading, spacing: SettingsStyle.pair("model.grid").light.gap) {
                    field("Provider") {
                        SettingsSelect(options: m.providers.map { .init(value: $0.value, label: $0.label) }, value: m.provider) { v in
                            Task { await model.run(.localAiSetChoice, ["provider": .string(v)]) }
                        }
                    }
                    if let label = m.modelLabel, let current = m.model {
                        VStack(alignment: .leading, spacing: 4) {
                            field(label) {
                                SettingsSelect(options: m.models.map { .init(value: $0.value, label: $0.label) }, value: current) { v in
                                    Task { await model.run(.localAiSetChoice, ["provider": .string(m.provider == "auto" ? (providerOf(current, m) ?? "auto") : m.provider), "model": .string(v)]) }
                                }
                            }
                            SText(m.note, "row.hint")
                        }
                    }
                    if let a = m.answering { SText(a, "model.status") }
                }
                .frame(maxWidth: SettingsStyle.pair("model.grid").light.width, alignment: .leading)
            }
        }
    }

    private func providerOf(_ model: String, _ m: LocalAiData.ModelInfo) -> String? {
        if model.hasPrefix("gpt") { return "openai" }
        if model.hasPrefix("claude") { return "anthropic" }
        if model.hasPrefix("gemini") { return "google" }
        return nil
    }

    private func field<C: View>(_ label: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: SettingsStyle.pair("field.label").light.margin.bottom) {
            SText(label, "field.label")
            content()
        }
    }
}

private struct KeyRow: View {
    let model: MacSettingsModel
    let key: LocalAiData.Key
    @Binding var busy: Bool
    @State private var adding = false
    @State private var value = ""
    @State private var result: (ok: Bool, text: String)?
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: SettingsStyle.pair("key.name").light.gap) {
                        WebIconView(.keyRound, size: 14).foregroundStyle(SettingsStyle.pair("key.icon").resolve(scheme).color.color)
                        SText(key.label, "key.name", lines: 1)
                    }
                    SText(key.status, "key.status").padding(.top, 2)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                HStack(spacing: 8) {
                    if key.stored {
                        if key.canTest { WebButton("Test", size: .sm) { test() }.disabled(busy) }
                        WebButton("Remove", variant: .ghost, size: .sm) { remove() }.disabled(busy)
                    } else if !adding {
                        WebButton("Add key…", size: .sm) { adding = true }.disabled(busy || !key.canAdd)
                    }
                }
            }
            if adding && !key.stored {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 8) {
                        SettingsField(placeholder: "Paste your \(key.label) key", text: $value, secure: true, onSubmit: save)
                        WebButton("Save", variant: .primary, size: .sm) { save() }.disabled(busy || value.trimmingCharacters(in: .whitespaces).isEmpty)
                        WebButton("Cancel", variant: .ghost, size: .sm) { adding = false; value = ""; result = nil }
                    }
                    if let url = key.keyUrl.flatMap(URL.init(string:)) {
                        Button { NSWorkspace.shared.open(url) } label: { SText("Get a key from \(key.label)", "muted").underline() }.buttonStyle(.plain)
                    }
                }
                .padding(.top, 12)
            }
            if let result {
                HStack(spacing: 6) {
                    if result.ok { WebIconView(.check, size: 14) }
                    SText(result.text, "muted", color: result.ok ? SettingsColor.v("color-heading", scheme) : nil)
                }
                .padding(.top, 8)
            }
        }
    }

    private func save() {
        busy = true
        Task {
            do {
                let r = try await model.client.command(.settingsRun(key: .localAiSetKey, args: ["provider": .string(key.provider), "key": .string(value)]))
                value = ""
                adding = false
                result = nil
                if case .object(let o) = r.data, case .string(let m)? = o["message"] { model.frame.toast(m, tone: .success) }
            } catch {
                result = (false, MacSettingsModel.message(error))
            }
            busy = false
        }
    }

    private func remove() {
        busy = true
        Task {
            await model.run(.localAiRemoveKey, ["provider": .string(key.provider)], tone: .info)
            result = nil
            busy = false
        }
    }

    private func test() {
        busy = true
        result = nil
        Task {
            if case .object(let o)? = await model.run(.localAiTestKey, ["provider": .string(key.provider)], quiet: true), case .string(let t)? = o["text"] {
                result = (o["ok"] == .bool(true), t)
            }
            busy = false
        }
    }
}

/// Foli AI's memory (AiMemory.tsx's MemoryList): add with a kind, edit, delete, clear.
struct MemoryCard: View {
    let model: MacSettingsModel
    @State private var kind = "instruction"
    @State private var text = ""
    @State private var editing: String?
    @State private var editKind = ""
    @State private var editText = ""
    @Environment(\.colorScheme) private var scheme

    static let kinds: [SettingsSelect.Option] = [.init(value: "tone", label: "Tone"), .init(value: "language", label: "Language"), .init(value: "length", label: "Length"), .init(value: "term", label: "Term"), .init(value: "instruction", label: "Instruction")]
    static let placeholder = ["tone": "Friendly and direct", "language": "Use British spelling", "length": "Keep answers short", "term": "Atlas is our spring launch", "instruction": "Use metric units"]

    struct Memory: Decodable {
        struct Item: Decodable, Identifiable { var id: String, kind: String, text: String; var workspace: Space? }
        struct Space: Decodable { var name: String }
        var on: Bool, items: [Item], max: Int
    }

    var body: some View {
        SettingsCard("Memory", description: "What Foli AI remembers about how you like it to write. It only keeps what you add here or save from a chat.") {
            if let m = model.convex("aiMemory.list").data(Memory.self) {
                VStack(alignment: .leading, spacing: SettingsStyle.pair("memory.form").light.margin.bottom) {
                    if !m.on {
                        SMuted("Memory is off. Nothing here is used, and Foli AI won't offer to remember anything. What's saved stays until you delete it.")
                            .padding(EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12))
                            .background(RoundedRectangle(cornerRadius: 10).fill(SettingsColor.v("glass-hover", scheme)))
                    } else {
                        HStack(spacing: SettingsStyle.pair("memory.form").light.gap) {
                            SettingsSelect(options: Self.kinds, value: kind, width: SettingsStyle.pair("memory.select").light.width, style: "memory.select") { kind = $0 }
                            SettingsField(placeholder: Self.placeholder[kind] ?? "", text: $text, onSubmit: add)
                            WebButton("Add") { add() }.disabled(text.trimmingCharacters(in: .whitespaces).isEmpty || m.items.count >= m.max)
                        }
                    }
                    if m.items.isEmpty {
                        VStack(spacing: 0) {
                            SText("Nothing yet", "empty.title")
                            SText("Add something here, like “Use British spelling” or “Keep answers short”, or save one when a chat or the agent offers it.", "empty.text")
                                .multilineTextAlignment(.center).padding(.top, 4)
                        }
                        .padding(SettingsStyle.pair("empty").light.padding.edgeInsets)
                        .frame(maxWidth: SettingsStyle.pair("empty").light.width)
                        .frame(maxWidth: .infinity)
                    } else {
                        SettingsDivided(m.items, gap: 8) { item in row(item) }
                        WebButton("Clear all", variant: .quiet, size: .sm) {
                            settingsConfirm("Clear memory?", message: "Everything Foli AI remembers about you is deleted, everywhere. This can't be undone.", confirm: "Clear all", in: NSApp.keyWindow) {
                                Task { await model.mutate("aiMemory.clear", done: "Memory cleared") }
                            }
                        }
                    }
                }
                .settingsRowWidth(576)
            } else {
                SMuted("Loading…")
            }
        }
    }

    @ViewBuilder private func row(_ item: Memory.Item) -> some View {
        if editing == item.id {
            HStack(spacing: 8) {
                SettingsSelect(options: Self.kinds, value: editKind, width: 144, style: "memory.select") { editKind = $0 }
                SettingsField(placeholder: "", text: $editText) { save(item) }
                WebIconButton(.check, label: "Save") { save(item) }
                WebIconButton(.x, label: "Cancel") { editing = nil }
            }
        } else {
            HStack(spacing: 12) {
                SText(Self.kinds.first { $0.value == item.kind }?.label ?? item.kind, "row.hint", weight: 500).frame(width: 96, alignment: .leading)
                HStack(spacing: 8) {
                    SText(item.text, "ai.title", weight: 400)
                    if let w = item.workspace { SText("Only in \(w.name)", "row.hint", color: SettingsColor.v("color-ink-faint", scheme)) }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                WebIconButton(.pencil, label: "Edit \"\(item.text)\"") { editing = item.id; editKind = item.kind; editText = item.text }
                WebIconButton(.trash, label: "Delete \"\(item.text)\"") { Task { await model.mutate("aiMemory.remove", ["id": .string(item.id)], done: "Memory deleted") } }
            }
        }
    }

    private func add() {
        let v = text.trimmingCharacters(in: .whitespaces)
        guard !v.isEmpty else { return }
        Task { if await model.mutate("aiMemory.add", ["kind": .string(kind), "text": .string(v)], done: "Remembered") != nil { text = "" } }
    }

    private func save(_ item: Memory.Item) {
        let v = editText.trimmingCharacters(in: .whitespaces)
        guard !v.isEmpty else { return }
        Task { if await model.mutate("aiMemory.update", ["id": .string(item.id), "kind": .string(editKind), "text": .string(v)], done: "Memory updated") != nil { editing = nil } }
    }
}

// MARK: Appearance

struct AppearanceSettingsView: View {
    let model: MacSettingsModel
    @State private var zoom: Double?
    @Environment(\.colorScheme) private var scheme
    @Environment(\.settingsWindowed) private var windowed

    var body: some View {
        let a = model.appearance.value
        let current = a?.appearance.rawValue ?? model.session?.appearance.rawValue ?? "system"
        VStack(alignment: .leading, spacing: SettingsStyle.pair("card").light.margin.bottom) {
            SettingsCard("Theme", description: "Dark mode is designed, not inverted: document colors are softened and code stays readable.") {
                HStack(spacing: SettingsStyle.pair("theme.grid").light.gap) {
                    tile("light", "Light", .sun, current)
                    tile("dark", "Dark", .moon, current)
                    tile("system", "System", .monitor, current)
                }
                .frame(maxWidth: windowed ? .infinity : SettingsStyle.pair("theme.grid").light.width)
                .accessibilityElement(children: .contain)
                .accessibilityLabel("Theme")
            }
            SettingsCard("Editor text size") {
                let picked = Self.nearest(zoom ?? a?.editorZoom ?? 1)
                HStack(spacing: SettingsStyle.pair("theme.grid").light.gap) {
                    ForEach(Self.sizes, id: \.zoom) { size in sizeTile(size, on: size.zoom == picked) }
                }
                .frame(maxWidth: .infinity)
                .accessibilityElement(children: .contain)
                .accessibilityLabel("Editor text size")
            }
        }
    }

    /// The Mac's five editor text sizes, each one of the engine's steps (AppearanceSettings.editorZooms, 0.85 to 1.35).
    static let sizes: [(name: String, zoom: Double)] = [("Smaller", 0.85), ("Small", 0.9), ("Default", 1), ("Large", 1.15), ("Larger", 1.3)]

    /// The size a stored zoom shows as (the web's slider keeps any step, so 1.05 reads as Default).
    static func nearest(_ z: Double) -> Double {
        sizes.map(\.zoom).min { abs($0 - z) < abs($1 - z) } ?? 1
    }

    private func sizeTile(_ size: (name: String, zoom: Double), on: Bool) -> some View {
        let pair = SettingsStyle.pair(on ? "theme.tile.on" : "theme.tile")
        let s = pair.resolve(scheme)
        return Button {
            zoom = size.zoom
            Task { await model.perform(.settingsUpdate(editorZoom: size.zoom)) }
        } label: {
            VStack(spacing: s.gap) {
                // A sample at the size it gives, on one baseline across the row.
                Text("Aa").font(.system(size: 15 * size.zoom)).frame(height: 20, alignment: .bottom)
                Text(size.name).webText(s.text).lineLimit(1)
            }
            .foregroundStyle(s.color.color)
            .padding(s.padding.edgeInsets)
            .frame(maxWidth: .infinity)
            .frame(height: s.height)
            .webBox(pair)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(size.name)
        .accessibilityAddTraits(on ? [.isSelected] : [])
    }

    private func tile(_ value: String, _ label: String, _ icon: WebIcon, _ current: String) -> some View {
        let on = value == current
        let pair = SettingsStyle.pair(on ? "theme.tile.on" : "theme.tile")
        let s = pair.resolve(scheme)
        return Button {
            Task { await model.perform(.settingsUpdate(appearance: SettingsUpdateArgs.Appearance(rawValue: value))) }
        } label: {
            VStack(spacing: s.gap) {
                WebIconView(icon, size: 18)
                Text(label).webText(s.text).lineLimit(1)
            }
            .foregroundStyle(s.color.color)
            .padding(s.padding.edgeInsets)
            .frame(maxWidth: .infinity)
            .frame(height: s.height)
            .webBox(pair)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? [.isSelected] : [])
    }
}

// MARK: Desktop app

struct DesktopSettingsView: View {
    let model: MacSettingsModel
    @State private var recording = false
    @State private var hint: String?
    @State private var monitor: Any?
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let d = model.query(.desktop).data(DesktopData.self)
        if d?.bridge == false {
            SettingsCard("Folevi for Mac", description: "These settings are for the Folevi Mac app: Quick Add from any app, opening at login, the menu bar icon and Mac notifications. Open Settings in the Mac app to change them.") {
                SMuted("You're using Folevi in a browser.")
            }
        } else if let s = d?.settings {
            VStack(alignment: .leading, spacing: SettingsStyle.pair("card").light.margin.bottom) {
                SettingsCard("Quick Add", description: "Add a task from any app without switching to Folevi. Write “tomorrow 9am”, “!high” or “#page” as you type; tasks without a page go to your Inbox.") {
                    shortcut(s)
                }
                SettingsCard("On this Mac") {
                    SettingsDivided(rows(s), gap: 12, line: "row") { r in
                        SettingsSwitchRow(label: r.label, hint: r.hint, isOn: r.on) { on in set(r.id, .bool(on)) }
                    }
                    .settingsRowWidth(SettingsStyle.pair("rows").light.width)
                }
            }
        } else {
            SMuted("Loading…")
        }
    }

    private struct Row: Identifiable { var id: String, label: String, hint: String, on: Bool }

    private func rows(_ s: DesktopData.Settings) -> [Row] {
        [
            Row(id: "openAtLogin", label: "Open at login", hint: "Folevi starts quietly when you log in, so Quick Add is always ready.", on: s.openAtLogin),
            Row(id: "menuBarIcon", label: "Menu bar icon", hint: "Quick Add, a new note, recent notes and the save state from the menu bar.", on: s.menuBarIcon),
            Row(id: "notifications", label: "Mac notifications", hint: "Comments, mentions and reminders appear as Mac notifications while Folevi isn't the app in front. The Dock icon shows how many are unread.", on: s.notifications),
        ]
    }

    private func set(_ key: String, _ value: JSONValue) {
        Task { await model.run(.desktopSet, [key: value], quiet: true) }
    }

    private func shortcut(_ s: DesktopData.Settings) -> some View {
        let field = SettingsStyle.pair("shortcut")
        let f = field.resolve(scheme)
        let error = hint ?? s.error
        return VStack(alignment: .leading, spacing: 0) {
            SText("Shortcut", "shortcut.label")
            HStack(spacing: SettingsStyle.pair("shortcut.row").light.gap) {
                Button { recording ? stop() : start() } label: {
                    Text(recording ? "Press keys…" : s.shortcutLabel)
                        .webText(f.text).lineLimit(1)
                        .foregroundStyle(recording ? SettingsColor.v("color-ink-muted", scheme) : f.color.color)
                        .padding(f.padding.edgeInsets)
                        .frame(minWidth: f.width, alignment: .leading)
                        .frame(height: f.height)
                        .webBox(field)
                        .overlay(RoundedRectangle(cornerRadius: f.radius).strokeBorder(SettingsColor.v("color-focus", scheme), lineWidth: recording ? 2 : 0))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(recording ? "Press the new shortcut" : "Quick Add shortcut: \(s.shortcutLabel). Change")
                if !s.quickAddShortcut.isEmpty { WebButton("Turn off") { set("quickAddShortcut", .string("")) } }
                if s.quickAddShortcut != s.defaultShortcut { WebButton("Use \(s.defaultLabel)") { set("quickAddShortcut", .string(s.defaultShortcut)) } }
            }
            .padding(.top, SettingsStyle.pair("shortcut.row").light.margin.top)
            SText(error ?? (recording ? "Press the keys together. Esc cancels." : "Click, then press the keys you want."), "shortcut.hint", color: error != nil ? SettingsColor.v("color-danger", scheme) : nil)
                .padding(.top, SettingsStyle.pair("shortcut.hint").light.margin.top)
        }
        .onDisappear { stop() }
    }

    private func start() {
        recording = true
        hint = nil
        Task { await model.run(.desktopPauseShortcut, ["paused": .bool(true)], quiet: true) }
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { e in
            let flags = e.modifierFlags.intersection(.deviceIndependentFlagsMask)
            if e.keyCode == 53, flags.intersection([.command, .control, .option]).isEmpty {
                stop()
                return nil
            }
            guard let acc = Self.accelerator(e) else {
                hint = "Hold ⌘, ⌥ or ⌃ with the key."
                return nil
            }
            stop()
            set("quickAddShortcut", .string(acc))
            return nil
        }
    }

    private func stop() {
        guard recording || monitor != nil else { return }
        recording = false
        if let monitor { NSEvent.removeMonitor(monitor) }
        monitor = nil
        Task { await model.run(.desktopPauseShortcut, ["paused": .bool(false)], quiet: true) }
    }

    /// lib/desktop.ts `acceleratorFrom`: "Alt+Space", "Command+Shift+K"; nil without a modifier other than Shift.
    static func accelerator(_ e: NSEvent) -> String? {
        let f = e.modifierFlags
        var mods: [String] = []
        if f.contains(.command) { mods.append("Command") }
        if f.contains(.control) { mods.append("Control") }
        if f.contains(.option) { mods.append("Alt") }
        if f.contains(.shift) { mods.append("Shift") }
        guard mods.contains(where: { $0 != "Shift" }) else { return nil }
        let named: [UInt16: String] = [49: "Space", 126: "Up", 125: "Down", 123: "Left", 124: "Right", 36: "Return", 53: "Escape", 51: "Backspace", 117: "Delete", 48: "Tab", 115: "Home", 119: "End", 116: "PageUp", 121: "PageDown"]
        let fkeys: [UInt16: Int] = [122: 1, 120: 2, 99: 3, 118: 4, 96: 5, 97: 6, 98: 7, 100: 8, 101: 9, 109: 10, 103: 11, 111: 12]
        var key: String?
        if let n = named[e.keyCode] { key = n } else if let n = fkeys[e.keyCode] { key = "F\(n)" } else if let c = e.charactersIgnoringModifiers?.uppercased(), c.count == 1 {
            let ch = c.first!
            if ch.isLetter || ch.isNumber { key = String(ch) } else if "`-=[]\\;',./".contains(ch) { key = String(ch) } else if ch == "+" { key = "Plus" }
        }
        guard let key else { return nil }
        return (mods + [key]).joined(separator: "+")
    }
}
#endif
