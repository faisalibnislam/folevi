// Pieces the Settings panes share: Settings search (an index of every row's words), the time zone picker with
// search and UTC offsets, Foli AI's memory card, the appearance tiles, and Manage Billing.
import AppKit
import FoleviDesign
import FoleviEngine
import SwiftUI

// MARK: search

/// What Settings search looks through: each section's rows, in the words they show. `local` true means only
/// in a library on this Mac, false only with an account, nil both.
enum SettingsIndex {
    struct Entry: Identifiable, Hashable {
        let section: SettingsSection
        let label: String
        let local: Bool?
        var id: String { section.rawValue + "/" + label }
    }

    static let entries: [Entry] = {
        func e(_ s: SettingsSection, _ local: Bool?, _ labels: [String]) -> [Entry] { labels.map { Entry(section: s, label: $0, local: local) } }
        return e(.general, nil, ["Time zone", "Review edits from connected apps"])
            + e(.account, false, ["Name", "Email", "Profile picture", "Plan", "Storage", "Devices", "Spaces", "Sign out", "Delete account", "Foli AI"])
            + e(.ai, nil, ["Foli AI", "Keep conversations", "Chat history", "Memory", "Remember things", "Suggest follow-ups", "Attachments", "Research the web", "Weekly digests", "Read text in images", "On-device text recognition", "Model", "Provider", "Your own keys", "OpenAI", "Anthropic", "Google", "Apple Intelligence"])
            + e(.billing, false, ["Plan", "Manage billing", "Upgrade", "Invoices"])
            + e(.security, false, ["Password", "Two-factor authentication", "Passkeys", "Sign-in methods", "End-to-end encryption", "Recovery key"])
            + e(.privacy, false, ["Privacy", "Data", "Analytics"])
            + e(.notifications, false, ["Notifications", "Mentions", "Comments", "Email", "Daily digest", "News about Folevi"])
            + e(.appearance, nil, ["Appearance", "Light", "Dark", "Match System", "Note text size", "Zoom"])
            + e(.appLock, nil, ["App Lock", "Touch ID", "Lock after"])
            + e(.offline, false, ["Offline", "Keep every note on this Mac", "Download everything", "Sync now", "Space used", "Remove this Mac's copy"])
            + e(.devices, false, ["Signed-in devices", "Sign out of a device"])
            + e(.connectedApps, false, ["Connected apps", "API tokens", "Webhooks", "MCP"])
            + e(.data, nil, ["Import", "Export", "Markdown", "Notion", "Evernote", "Apple Notes", "Takeout"])
            + e(.mac, nil, ["Quick Add shortcut", "Menu bar icon", "Open at login", "Mac notifications", "Spotlight"])
            + e(.updates, nil, ["Check for updates", "Version", "Automatic updates"])
            + e(.library, true, ["Where your library is", "Location", "Move library", "iCloud", "Dropbox", "Google Drive", "Devices", "Library health", "Passphrase", "Encrypt", "Lock library", "Sign in to Folevi", "Remove this library"])
            + e(.about, nil, ["About", "Version", "Privacy policy", "Terms of service", "AI policy", "What's new"])
    }()

    static func search(_ q: String, local: Bool, sections: [SettingsSection]) -> [(SettingsSection, [Entry])] {
        let words = q.trimmingCharacters(in: .whitespaces)
        guard !words.isEmpty else { return [] }
        let hits = entries.filter { e in
            sections.contains(e.section) && (e.local == nil || e.local == local)
                && (e.label.localizedCaseInsensitiveContains(words) || e.section.title.localizedCaseInsensitiveContains(words))
        }
        return sections.compactMap { s in
            let h = hits.filter { $0.section == s }
            return h.isEmpty ? nil : (s, h)
        }
    }
}

// MARK: time zone

/// A time zone as "City, Region UTC+5:30", with a popover that searches by city, region, offset or id.
struct TimeZonePicker: View {
    let value: String
    let set: (String) -> Void
    @State private var shown = false
    @State private var query = ""
    @State private var picked: String?

    static func name(_ id: String) -> String {
        let parts = id.split(separator: "/").map { $0.replacingOccurrences(of: "_", with: " ") }
        guard let city = parts.last else { return id }
        return parts.count > 1 ? "\(city), \(parts.first!)" : city
    }

    static func offset(_ id: String) -> String {
        guard let tz = TimeZone(identifier: id) else { return "" }
        let s = tz.secondsFromGMT()
        let h = abs(s) / 3600, m = abs(s) % 3600 / 60
        return "UTC" + (s < 0 ? "−" : "+") + (m == 0 ? "\(h)" : String(format: "%d:%02d", h, m))
    }

    private var matches: [String] {
        let q = query.trimmingCharacters(in: .whitespaces)
        let all = TimeZone.knownTimeZoneIdentifiers
        guard !q.isEmpty else { return all }
        return all.filter { id in
            id.localizedCaseInsensitiveContains(q) || Self.name(id).localizedCaseInsensitiveContains(q) || Self.offset(id).contains(q.replacingOccurrences(of: "-", with: "−"))
        }
    }

    var body: some View {
        Button { shown = true } label: {
            HStack {
                Text(Self.name(value))
                Text(Self.offset(value)).foregroundStyle(.secondary)
                Image(systemName: "chevron.up.chevron.down").font(.caption2).foregroundStyle(.secondary)
            }
        }
        .popover(isPresented: $shown, arrowEdge: .bottom) {
            VStack(spacing: 8) {
                TextField("Search time zones", text: $query)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit { if let p = picked ?? matches.first { choose(p) } }
                    .onKeyPress(.downArrow) { move(1); return .handled }
                    .onKeyPress(.upArrow) { move(-1); return .handled }
                ScrollViewReader { proxy in
                    List(matches, id: \.self, selection: $picked) { id in
                        HStack {
                            Text(Self.name(id))
                            Spacer()
                            Text(Self.offset(id)).foregroundStyle(.secondary).monospacedDigit()
                            if id == value { Image(systemName: "checkmark") }
                        }
                        .tag(id)
                        .contentShape(Rectangle())
                        .onTapGesture { choose(id) }
                    }
                    .listStyle(.plain)
                    .onAppear { proxy.scrollTo(value, anchor: .center) }
                    .onChange(of: picked) { if let picked { proxy.scrollTo(picked) } }
                }
                if matches.isEmpty { Text("No time zone matches “\(query)”.").foregroundStyle(.secondary) }
            }
            .padding(10)
            .frame(width: 340, height: 380)
        }
    }

    private func move(_ d: Int) {
        let m = matches
        guard !m.isEmpty else { return }
        let i = picked.flatMap { m.firstIndex(of: $0) } ?? -1
        picked = m[min(max(i + d, 0), m.count - 1)]
    }

    private func choose(_ id: String) {
        set(id)
        shown = false
        query = ""
    }
}

// MARK: memory

/// What Foli AI remembers about how you like answers: add, edit, delete, clear (aiMemory.*).
struct MemoryCard: View {
    private var app: AppModel { .shared }
    @State private var data = SettingsJSON(nil)
    @State private var kind = "instruction"
    @State private var text = ""
    @State private var editing: String?
    @State private var editKind = "instruction"
    @State private var editText = ""

    static let kinds: [(String, String)] = [("tone", "Tone"), ("language", "Language"), ("length", "Length"), ("term", "Term"), ("instruction", "Instruction")]
    static let placeholders = ["tone": "Friendly and direct", "language": "Use British spelling", "length": "Keep answers short", "term": "Atlas is our spring launch", "instruction": "Use metric units"]

    var body: some View {
        Section("Memory") {
            if data["on"].bool == false {
                Text("Memory is off, so Foli AI doesn't use these. Turn on Remember things you ask it to.").font(.callout).foregroundStyle(.secondary)
            }
            HStack {
                Picker("Kind", selection: $kind) { ForEach(Self.kinds, id: \.0) { Text($0.1).tag($0.0) } }.labelsHidden().fixedSize()
                TextField(Self.placeholders[kind] ?? "", text: $text).onSubmit(add)
                    .onChange(of: text) { if text.count > 200 { text = String(text.prefix(200)) } }
                Button("Remember", action: add).disabled(text.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            ForEach(Array(data["items"].array.enumerated()), id: \.offset) { _, item in
                let id = item["id"].string ?? ""
                if editing == id {
                    HStack {
                        Picker("Kind", selection: $editKind) { ForEach(Self.kinds, id: \.0) { Text($0.1).tag($0.0) } }.labelsHidden().fixedSize()
                        TextField("What to remember", text: $editText)
                        Button { save(id) } label: { Image(systemName: "checkmark") }.buttonStyle(.borderless).help("Save")
                        Button { editing = nil } label: { Image(systemName: "xmark") }.buttonStyle(.borderless).help("Cancel")
                    }
                } else {
                    HStack {
                        Text(Self.kinds.first { $0.0 == item["kind"].string }?.1 ?? (item["kind"].string ?? "")).font(.caption).foregroundStyle(.secondary).frame(width: 80, alignment: .leading)
                        Text(item["text"].string ?? "")
                        if let w = item["workspace"]["name"].string { Text("Only in \(w)").font(.caption).foregroundStyle(.tertiary) }
                        Spacer()
                        Button { editing = id; editKind = item["kind"].string ?? "instruction"; editText = item["text"].string ?? "" } label: { Image(systemName: "pencil") }
                            .buttonStyle(.borderless).help("Edit")
                        Button { run("aiMemory.remove", ["id": .string(id)], done: "Memory deleted") } label: { Image(systemName: "trash") }
                            .buttonStyle(.borderless).help("Delete")
                    }
                }
            }
            if !data["items"].array.isEmpty {
                Button("Clear Memory…", role: .destructive, action: clear)
            }
        }
        .task(id: app.client.map(ObjectIdentifier.init)) { await load() }
    }

    private func load() async {
        if let v = try? await app.client?.query(Views.SettingsQuery(SettingsQueryArgs(key: .convex, args: ["fn": .string("aiMemory.list"), "args": .object([:])]))) {
            data = SettingsJSON(v.data)
        }
    }

    private func run(_ fn: String, _ args: [String: JSONValue], done: String) {
        app.perform { client in
            _ = try await client.command(Commands.SettingsRun(SettingsRunArgs(key: .convexMutation, args: ["fn": .string(fn), "args": .object(args)])))
            app.toast(done)
            await load()
        }
    }

    private func add() {
        let t = text.trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty else { return }
        text = ""
        run("aiMemory.add", ["kind": .string(kind), "text": .string(t)], done: "Remembered")
    }

    private func save(_ id: String) {
        let t = editText.trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty else { return }
        editing = nil
        run("aiMemory.update", ["id": .string(id), "kind": .string(editKind), "text": .string(t)], done: "Memory updated")
    }

    private func clear() {
        let alert = NSAlert()
        alert.messageText = "Clear memory?"
        alert.informativeText = "Foli AI forgets everything here. You can't undo this."
        alert.alertStyle = .warning
        alert.addButton(withTitle: "Clear")
        alert.addButton(withTitle: "Cancel")
        alert.buttons.first?.hasDestructiveAction = true
        CoreAlerts.cancelIsDefault(alert)
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        run("aiMemory.clear", [:], done: "Memory cleared")
    }
}

// MARK: appearance

/// Light, Dark and System as tiles with a small picture of each.
struct ThemeTiles: View {
    let value: String
    let set: (String) -> Void

    var body: some View {
        HStack(spacing: 14) {
            tile("light", "Light", "Always light")
            tile("dark", "Dark", "Always dark")
            tile("system", "System", "Matches macOS")
        }
    }

    private func tile(_ id: String, _ title: String, _ caption: String) -> some View {
        Button { set(id) } label: {
            VStack(spacing: 6) {
                ZStack {
                    if id == "system" {
                        HStack(spacing: 0) { preview(dark: false); preview(dark: true) }
                    } else {
                        preview(dark: id == "dark")
                    }
                }
                .frame(width: 96, height: 62)
                .clipShape(.rect(cornerRadius: 8))
                .overlay { RoundedRectangle(cornerRadius: 8).strokeBorder(value == id ? Color.foleviInk : Color.secondary.opacity(0.3), lineWidth: value == id ? 2 : 1) }
                Text(title).font(.callout.weight(value == id ? .semibold : .regular))
                Text(caption).font(.caption).foregroundStyle(.secondary)
            }
        }
        .buttonStyle(.hoverPlain)
        .accessibilityLabel("\(title), \(caption)")
        .accessibilityAddTraits(value == id ? .isSelected : [])
    }

    private func preview(dark: Bool) -> some View {
        ZStack(alignment: .topLeading) {
            (dark ? Color(white: 0.12) : Color(white: 0.97))
            VStack(alignment: .leading, spacing: 4) {
                RoundedRectangle(cornerRadius: 2).fill(dark ? Color(white: 0.85) : Color(white: 0.2)).frame(width: 34, height: 5)
                RoundedRectangle(cornerRadius: 2).fill(dark ? Color(white: 0.4) : Color(white: 0.75)).frame(width: 50, height: 4)
                RoundedRectangle(cornerRadius: 2).fill(dark ? Color(white: 0.4) : Color(white: 0.75)).frame(width: 40, height: 4)
            }
            .padding(8)
        }
    }
}

// MARK: billing

@MainActor
enum BillingActions {
    /// The billing portal (paid plans): invoices, the payment method, cancelling.
    static func openPortal() {
        AppModel.shared.perform { client in
            let r = try await client.command(Commands.SettingsRun(SettingsRunArgs(key: .convexAction, args: ["fn": .string("billing.portal"), "args": .object([:])])))
            if case .object(let o) = r.data, let s = o["url"]?.string, let url = URL(string: s) { NSWorkspace.shared.open(url) }
        }
    }
}
