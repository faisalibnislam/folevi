// Settings for a library on this Mac (where it's kept and how it syncs, the devices that open it, its health, its
// passphrase, a Folevi account), the About pane, and the local Foli AI rows (on or off, the model, keeping
// conversations). All of it reads the engine's `settings.query` values and writes through `settings.run`.
import AppKit
import FoleviDesign
import FoleviEngine
import SwiftUI

/// A settings value's JSON, read by key path.
struct SettingsJSON {
    let value: JSONValue?
    init(_ v: JSONValue?) { value = v }
    subscript(_ key: String) -> SettingsJSON {
        if case .object(let o)? = value { return SettingsJSON(o[key]) }
        return SettingsJSON(nil)
    }
    var string: String? { value?.string }
    var bool: Bool? { value?.bool }
    var number: Double? { if case .number(let n)? = value { n } else { nil } }
    var array: [SettingsJSON] { if case .array(let a)? = value { a.map(SettingsJSON.init) } else { [] } }
    var exists: Bool { if case .null? = value { false } else { value != nil } }
}

@MainActor
enum SettingsActions {
    static func run(_ key: SettingsRunKey, _ args: [String: JSONValue]? = nil, then: (() async -> Void)? = nil) {
        AppModel.shared.perform { client in
            let r = try await client.command(Commands.SettingsRun(SettingsRunArgs(key: key, args: args)))
            if case .object(let o) = r.data, let m = o["message"]?.string { AppModel.shared.toast(m) }
            await then?()
        }
    }

    static func updateProfile(_ args: [String: JSONValue], then: (() async -> Void)? = nil) {
        run(.convexMutation, ["fn": .string("users.updateProfile"), "args": .object(args)], then: then)
    }

    static func openHelp() { NSWorkspace.shared.open(URL(string: "https://folevi.com/help")!) }

    static func contactSupport() {
        if AppModel.shared.session.value?.mode == .local {
            NSWorkspace.shared.open(URL(string: "mailto:support@folevi.com")!)
        } else {
            SupportWindow.show()
        }
    }
}

/// Library (a library on this Mac): where it's kept, syncing, moving it, the devices that open it, its health,
/// its passphrase, locking it, and the Folevi account.
struct LibraryPane: View {
    private var app: AppModel { .shared }
    @State private var info = SettingsJSON(nil)
    @State private var passphrase: PassphraseSheet.Mode?

    var body: some View {
        Form {
            if !info.exists {
                ProgressView()
            } else {
                place
                connection
                if !info["devices"].array.isEmpty {
                    Section("Devices") {
                        ForEach(Array(info["devices"].array.enumerated()), id: \.offset) { _, d in
                            HStack {
                                Image(systemName: d["phone"].bool == true ? "iphone" : "laptopcomputer").foregroundStyle(.secondary)
                                VStack(alignment: .leading) {
                                    Text(d["name"].string ?? "").fontWeight(d["here"].exists ? .semibold : .regular)
                                    Text(d["detail"].string ?? "").font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Text(d["when"].string ?? "").font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                health
                passphraseSection
                Section("Folevi Account") {
                    Button("Sign In to Folevi…") { AccountActions.addAccount() }
                    Text("Your library stays on this Mac. An account adds sharing, workspaces and Folevi's own sync.").font(.caption).foregroundStyle(.secondary)
                    Button("Remove This Library from This Mac…", role: .destructive, action: forget)
                }
            }
        }
        .formStyle(.grouped)
        .task { await load() }
        .sheet(item: $passphrase) { mode in
            PassphraseSheet(mode: mode, minimum: Int(info["passphrase"]["min"].number ?? 8)) { await load() }
        }
    }

    @ViewBuilder private var place: some View {
        let p = info["place"]
        Section {
            LabeledContent("Syncs with", value: p["kind"].string ?? "…")
            LabeledContent("Location") {
                HStack {
                    Text(p["path"].string ?? "…").lineLimit(1).truncationMode(.middle).textSelection(.enabled)
                    if let path = p["path"].string, path.hasPrefix("/") || path.hasPrefix("~") {
                        Button { NSWorkspace.shared.selectFile(nil, inFileViewerRootedAtPath: (path as NSString).expandingTildeInPath) } label: { Image(systemName: "arrow.right.circle") }
                            .buttonStyle(.borderless).help("Show in Finder")
                    }
                }
            }
            LabeledContent("Status", value: p["status"].string ?? "…")
            if let problem = p["problem"].string { LabeledContent("Last problem") { Text(problem).foregroundStyle(.orange) } }
            HStack {
                if p["canSync"].bool == true { Button("Sync Now") { SettingsActions.run(.librarySyncNow) { await load() } } }
                if p["canMove"].bool == true, !p["moveChoices"].array.isEmpty {
                    Menu("Move Library…") {
                        ForEach(Array(p["moveChoices"].array.enumerated()), id: \.offset) { _, c in
                            if let kind = c["kind"].string {
                                Button(c["title"].string ?? kind) { move(kind, title: c["title"].string ?? kind, detail: c["detail"].string) }
                            }
                        }
                    }
                    .fixedSize()
                }
            }
        } header: {
            Text("Where Your Library Is")
        }
    }

    @ViewBuilder private var connection: some View {
        let c = info["place"]["connection"]
        if c.exists {
            Section(c["name"].string ?? "Cloud") {
                if let t = c["text"].string { Text(t + (c["offline"].string ?? "")).font(.callout) }
                HStack {
                    if c["state"].string == "signingIn" || c["state"].string == "waiting" {
                        ProgressView().controlSize(.small)
                        Text(c["signInWait"].string ?? "").font(.caption).foregroundStyle(.secondary)
                        Button("Cancel") { SettingsActions.run(.libraryCloudCancel) { await load() } }
                    } else if c["canConnect"].bool == true, let provider = info["place"]["kind"].string {
                        Button(c["connectLabel"].string ?? "Connect") {
                            SettingsActions.run(.libraryCloudConnect, ["provider": .string(provider.lowercased().contains("google") ? "googleDrive" : "dropbox")]) { await load() }
                        }
                    }
                    if c["canSignOut"].bool == true {
                        Button("Sign Out of \(c["name"].string ?? "It")…", role: .destructive) {
                            guard confirm("Sign out of \(c["name"].string ?? "this service")?", "The library stays on this Mac and stops syncing until you connect again.", "Sign Out") else { return }
                            SettingsActions.run(.libraryCloudSignOut) { await load() }
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder private var health: some View {
        let h = info["health"]
        if h.exists {
            Section("Library Health") {
                Label(h["description"].string ?? "", systemImage: h["clean"].bool == true ? "checkmark.seal" : "exclamationmark.triangle")
                ForEach(Array(h["groups"].array.enumerated()), id: \.offset) { _, g in
                    DisclosureGroup {
                        if let why = g["why"].string { Text(why).font(.caption).foregroundStyle(.secondary) }
                        ForEach(Array(g["items"].array.enumerated()), id: \.offset) { _, i in
                            VStack(alignment: .leading) {
                                Text(i["title"].string ?? i["path"].string ?? "")
                                Text([i["path"].string, i["since"].string, i["detail"].string].compactMap { $0 }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        if let more = g["more"].string { Text(more).font(.caption).foregroundStyle(.secondary) }
                    } label: {
                        LabeledContent(g["title"].string ?? "", value: Int(g["count"].number ?? 0).formatted())
                    }
                }
            }
        }
    }

    @ViewBuilder private var passphraseSection: some View {
        let p = info["passphrase"]
        if p.exists {
            Section("Passphrase") {
                Text(p["description"].string ?? "").font(.callout).foregroundStyle(.secondary)
                if p["encrypted"].bool == true {
                    HStack {
                        Button("Change Passphrase…") { passphrase = .change }
                        Button("Remove Passphrase…", role: .destructive) { passphrase = .remove }
                        Spacer()
                        Button("Lock Library") { SettingsActions.run(.libraryLock) }
                    }
                } else {
                    Button("Encrypt with a Passphrase…") { passphrase = .set }
                }
            }
        }
    }

    private func move(_ kind: String, title: String, detail: String?) {
        guard confirm("\(title)?", (detail.map { $0 + " " } ?? "") + "Folevi copies the library there and keeps using it from the new place.", "Move") else { return }
        SettingsActions.run(.libraryMove, ["kind": .string(kind)]) { await load() }
    }

    private func forget() {
        guard confirm("Remove this library from this Mac?", "Folevi stops opening it here. Its files stay where they are, so you can open the library again later.", "Remove", destructive: true) else { return }
        SettingsActions.run(.libraryForget)
    }

    private func confirm(_ title: String, _ text: String, _ action: String, destructive: Bool = false) -> Bool {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = text
        alert.addButton(withTitle: action)
        alert.addButton(withTitle: "Cancel")
        if destructive {
            alert.alertStyle = .warning
            alert.buttons.first?.hasDestructiveAction = true
            AppAlerts.cancelIsDefault(alert)
        }
        return alert.runModal() == .alertFirstButtonReturn
    }

    private func load() async {
        if let v = try? await app.client?.query(Views.SettingsQuery(SettingsQueryArgs(key: .library, args: nil))) { info = SettingsJSON(v.data) }
    }
}

/// Encrypt the library with a passphrase, change it, or remove it.
struct PassphraseSheet: View {
    enum Mode: String, Identifiable { case set, change, remove; var id: String { rawValue } }
    let mode: Mode
    let minimum: Int
    let done: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var current = ""
    @State private var next = ""
    @State private var again = ""
    @State private var understood = false
    @State private var working = false
    @State private var problem: String?

    private var title: String {
        switch mode {
        case .set: "Encrypt with a Passphrase"
        case .change: "Change the Passphrase"
        case .remove: "Remove the Passphrase"
        }
    }

    private var ready: Bool {
        switch mode {
        case .set: next.count >= minimum && next == again && understood
        case .change: !current.isEmpty && next.count >= minimum && next == again
        case .remove: !current.isEmpty
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(title).font(.headline)
            Form {
                if mode != .set { SecureField("Current passphrase", text: $current) }
                if mode != .remove {
                    SecureField("New passphrase", text: $next)
                    SecureField("Type it again", text: $again)
                    if !next.isEmpty && next.count < minimum { Text("At least \(minimum) characters.").font(.caption).foregroundStyle(.secondary) }
                    if !again.isEmpty && next != again { Text("The two don't match.").font(.caption).foregroundStyle(.orange) }
                }
                if mode == .set {
                    Toggle("I understand that if I lose the passphrase, the synced copy can't be recovered", isOn: $understood).toggleStyle(.checkbox)
                }
                if mode == .remove { Text("The library's files are decrypted where they're synced.").font(.caption).foregroundStyle(.secondary) }
                if let problem { Text(problem).font(.caption).foregroundStyle(.red) }
            }
            .formStyle(.columns)
            HStack {
                Spacer()
                Button("Cancel", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
                Button(mode == .remove ? "Remove" : mode == .change ? "Change" : "Encrypt", action: save)
                    .buttonStyle(InkPillStyle())
                    .keyboardShortcut(.defaultAction)
                    .disabled(!ready || working)
            }
        }
        .padding(20)
        .frame(width: 420)
    }

    private func save() {
        working = true
        problem = nil
        let args: (SettingsRunKey, [String: JSONValue]) = switch mode {
        case .set: (.librarySetPassphrase, ["passphrase": .string(next)])
        case .change: (.libraryChangePassphrase, ["current": .string(current), "passphrase": .string(next)])
        case .remove: (.libraryRemovePassphrase, ["current": .string(current)])
        }
        Task { @MainActor in
            defer { working = false }
            do {
                guard let client = AppModel.shared.client else { return }
                _ = try await client.command(Commands.SettingsRun(SettingsRunArgs(key: args.0, args: args.1)))
                await done()
                dismiss()
            } catch let f as EngineFailure {
                problem = f.message
            } catch {
                problem = "Something went wrong. Try again."
            }
        }
    }
}

/// About: the version and Folevi's pages.
struct AboutPane: View {
    private var version: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "" }

    var body: some View {
        Form {
            Section {
                HStack(spacing: 14) {
                    Image(nsImage: NSApp.applicationIconImage).resizable().frame(width: 56, height: 56)
                    VStack(alignment: .leading) {
                        Text("Folevi \(version)").font(.title3.weight(.semibold))
                        Text("A native Mac app for Folevi.").foregroundStyle(.secondary)
                    }
                }
            }
            Section {
                Link("What's New", destination: URL(string: "https://folevi.com/changelog")!)
                Link("Privacy Policy", destination: URL(string: "https://folevi.com/privacy")!)
                Link("Terms of Service", destination: URL(string: "https://folevi.com/terms")!)
                Link("AI Policy", destination: URL(string: "https://folevi.com/ai-policy")!)
            }
        }
        .formStyle(.grouped)
    }
}

/// Foli AI in a library on this Mac: on or off, which model answers, keeping conversations.
struct LocalAITopSections: View {
    let value: SettingsJSON
    let reload: () async -> Void

    var body: some View {
        Section {
            Toggle("Foli AI", isOn: Binding(get: { value["on"].bool ?? true }, set: { v in SettingsActions.updateProfile(["aiEnabled": .bool(v)], then: reload) }))
            Text(value["onText"].string ?? "").font(.caption).foregroundStyle(.secondary)
        }
        let m = value["model"]
        Section("Model") {
            if let missing = m["missing"].string {
                Text(missing).foregroundStyle(.secondary)
            } else {
                if let d = m["description"].string { Text(d).font(.caption).foregroundStyle(.secondary) }
                Picker("Provider", selection: Binding(get: { m["provider"].string ?? "auto" }, set: { p in
                    SettingsActions.run(.localAiSetChoice, p == "auto" ? [:] : ["provider": .string(p)], then: reload)
                })) {
                    ForEach(Array(m["providers"].array.enumerated()), id: \.offset) { _, o in Text(o["label"].string ?? "").tag(o["value"].string ?? "") }
                }
                if !m["models"].array.isEmpty, let provider = m["provider"].string, provider != "auto" {
                    Picker(m["modelLabel"].string ?? "Model", selection: Binding(get: { m["model"].string ?? "" }, set: { model in
                        SettingsActions.run(.localAiSetChoice, ["provider": .string(provider), "model": .string(model)], then: reload)
                    })) {
                        ForEach(Array(m["models"].array.enumerated()), id: \.offset) { _, o in Text(o["label"].string ?? "").tag(o["value"].string ?? "") }
                    }
                    if let note = m["note"].string, !note.isEmpty { Text(note).font(.caption).foregroundStyle(.secondary) }
                }
                if let a = m["answering"].string { Text(a).font(.caption).foregroundStyle(.secondary) }
            }
        }
        Section("Conversations") {
            Toggle("Keep conversations", isOn: Binding(get: { value["history"].bool ?? true }, set: { v in SettingsActions.updateProfile(["aiPrefs": .object(["history": .bool(v)])], then: reload) }))
            Text(value["historyText"].string ?? "").font(.caption).foregroundStyle(.secondary)
        }
    }
}
