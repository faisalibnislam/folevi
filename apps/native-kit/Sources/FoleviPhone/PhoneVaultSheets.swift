// The Vault's dialogs on the iPhone, as iOS sheets with the web's sheet look (FoleviDesign's phoneSheet): a new
// folder or note, adding and editing an item, earlier versions, sharing, a vault note, a file's preview and changing
// the passcode; emptying the Trash is iOS's own confirmation. Previews are decrypted by the engine into memory and
// drawn by iOS: images, PDFKit, AVKit (read from memory, never a file), text and CSV, and Quick Look for the rest
// (a file in this app's temporary folder, protected while the device is locked and removed when the preview closes).
#if os(iOS)
import AVKit
import PDFKit
import QuickLook
import SwiftUI
import UniformTypeIdentifiers
import FoleviDesign
import FoleviEngine
import FoleviScreens

extension View {
    func phoneVaultDialogs(model: VaultModel, state: PhoneVaultState, menus: PhoneMenus) -> some View {
        modifier(PhoneVaultDialogs(model: model, menus: menus))
    }
}

private struct PhoneVaultDialogs: ViewModifier {
    @Bindable var model: VaultModel
    let menus: PhoneMenus

    private var sheetOpen: Binding<Bool> {
        Binding(get: {
            guard let d = model.dialog else { return false }
            if case .emptyTrash = d { return false }
            return true
        }, set: { if !$0 { model.dialog = nil } })
    }

    private var size: PhoneSheetSize {
        switch model.dialog {
        case .newFolder?, .newNote?, .changePasscode?: return .fit
        case .history?: return .medium
        default: return .large
        }
    }

    func body(content: Content) -> some View {
        content
            .phoneSheet(isPresented: sheetOpen, size: size) {
                if let dialog = model.dialog {
                    sheet(dialog).id(dialog.id)
                }
            }
            .alert("Empty the Trash?", isPresented: Binding(get: { if case .emptyTrash? = model.dialog { return true }; return false }, set: { if !$0 { model.dialog = nil } })) {
                Button("Delete for good", role: .destructive) {
                    guard let vaultId = model.vaultId else { return }
                    model.dialog = nil
                    model.run {
                        let r = try await model.client.command(.vaultTrashEmpty(vaultId: vaultId))
                        model.toast("Deleted \(r.removed) for good")
                    }
                }
                Button("Cancel", role: .cancel) { model.dialog = nil }
            } message: {
                Text("Everything in the Trash goes for good, for everyone in the Vault. The log keeps a record that it happened.")
            }
    }

    @ViewBuilder private func sheet(_ dialog: VaultDialog) -> some View {
        switch dialog {
        case .newFolder: PhoneVaultPrompt(model: model, title: "New folder", label: "Folder name", folder: true)
        case .newNote: PhoneVaultPrompt(model: model, title: "New note", label: "Title", folder: false)
        case .addItem: PhoneVaultItemSheet(model: model, menus: menus, existing: nil)
        case .editItem(let item): PhoneVaultItemSheet(model: model, menus: menus, existing: item)
        case .history(let id, let canChange): PhoneVaultHistory(model: model, itemId: id, canChange: canChange)
        case .share(let id, let title, let note): PhoneVaultShare(model: model, menus: menus, itemId: id, title: title, note: note)
        case .note(let row): PhoneVaultNote(model: model, row: row)
        case .preview(let files, let index): PhoneVaultPreview(model: model, files: files, index: index)
        case .changePasscode: PhoneVaultChangePasscode(model: model)
        case .emptyTrash: EmptyView()
        }
    }
}

/// A labelled field in a sheet (`label > span + input.ui-input`).
private struct PhoneVaultField: View {
    let label: String
    @Binding var text: String
    var mono = false
    var multiline = false
    var autoFocus = false
    @FocusState private var focused: Bool
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let l = PV.style("gate.label", scheme)
        let input = PV.style("gate.input", scheme)
        VStack(alignment: .leading, spacing: l.margin.bottom) {
            Text(label).webText(l.text).foregroundStyle(l.color.color)
            Group {
                if multiline {
                    TextEditor(text: $text)
                        .scrollContentBackground(.hidden)
                        .padding(6)
                        .frame(height: 96)
                } else {
                    TextField("", text: $text)
                        .padding(input.padding.edgeInsets)
                        .frame(height: input.height)
                }
            }
            .font(mono ? .system(size: input.fontSize, design: .monospaced) : .custom("Instrument Sans", size: input.fontSize))
            .autocorrectionDisabled(mono)
            .textInputAutocapitalization(mono ? .never : .sentences)
            .focused($focused)
            .foregroundStyle(input.color.color)
            .webBox(PV.pair("gate.input"))
            .accessibilityLabel(label)
        }
        .onAppear { if autoFocus { focused = true } }
    }
}

/// The sheet's foot: its actions at the end (Cancel and the main one), 20 pt in.
private struct PhoneVaultSheetActions<Content: View>: View {
    @ViewBuilder let content: Content
    var body: some View {
        HStack(spacing: 8) {
            Spacer(minLength: 0)
            content
        }
        .padding(.top, 4)
    }
}

private struct PhoneVaultPrompt: View {
    @Bindable var model: VaultModel
    let title: String
    let label: String
    let folder: Bool
    @State private var name = ""

    var body: some View {
        PhoneSheetPanel(title: title, close: { model.dialog = nil }) {
            VStack(alignment: .leading, spacing: 16) {
                PhoneVaultField(label: label, text: $name, autoFocus: true)
                    .onSubmit(create)
                PhoneVaultSheetActions {
                    WebButton("Cancel") { model.dialog = nil }
                    WebButton("Create", variant: .primary) { create() }.disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 20)
        }
    }

    private func create() {
        guard let vaultId = model.vaultId, !name.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        let parent = model.folderId
        let n = name
        model.dialog = nil
        model.run {
            if folder { _ = try await model.client.command(.vaultFolderCreate(vaultId: vaultId, parentId: parent, name: n)) }
            else { _ = try await model.client.command(.vaultNoteCreate(vaultId: vaultId, folderId: parent, title: n)) }
        }
    }
}

/// Adding and editing a password item (Passwords.tsx ItemDialog): the kind's fields, a generator, strength.
private struct PhoneVaultItemSheet: View {
    @Bindable var model: VaultModel
    let menus: PhoneMenus
    let existing: VaultItemValue?
    @State private var kind = "login"
    @State private var title = ""
    @State private var values: [String: String] = [:]
    @State private var notes = ""
    @State private var strength: VaultStrengthResult?
    @State private var busy = false
    @Environment(\.colorScheme) private var scheme

    private var kinds: [VaultKindDef] {
        (model.store("passwords") { .vaultItems(vaultId: model.vaultId ?? "", section: .passwords) }).value?.kinds ?? []
    }

    var body: some View {
        let def = kinds.first { $0.kind == kind }
        let body = PV.style("health.body", scheme)
        PhoneSheetPanel(title: existing.map { "Edit \($0.title)" } ?? "Add to the Vault", close: { model.dialog = nil }) {
            VStack(alignment: .leading, spacing: 12) {
                if existing == nil {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Kind").webText(PV.style("gate.label", scheme).text).foregroundStyle(PV.style("gate.label", scheme).color.color)
                        PhoneVaultSelect(style: "pw.kind", label: def?.label ?? "Login", options: kinds.map { ($0.kind, $0.label) }, selected: kind, menus: menus) { kind = $0 }
                    }
                }
                PhoneVaultField(label: "Title", text: $title, autoFocus: existing == nil)
                ForEach(def?.fields ?? [], id: \.key) { f in
                    VStack(alignment: .leading, spacing: 4) {
                        PhoneVaultField(label: f.label, text: binding(f.key), mono: f.type == "secret" || f.type == "totp" || f.type == "multiline", multiline: f.type == "multiline")
                            .overlay(alignment: .topTrailing) {
                                if f.key == "password" {
                                    HStack(spacing: 4) {
                                        WebButton("Generate", icon: .refreshCw, iconSize: 12, variant: .quiet, size: .sm) { generate(.password) }
                                        WebButton("Memorable", variant: .quiet, size: .sm) { generate(.passphrase) }
                                    }
                                    .offset(y: -10)
                                }
                            }
                        if f.key == "password", let strength, !(values["password"] ?? "").isEmpty {
                            Text(strength.label).webText(body.text)
                                .foregroundStyle(strength.score >= 3 ? PV.color("success", scheme) : strength.score == 2 ? body.color.color : PV.color("warning", scheme))
                        }
                    }
                }
                PhoneVaultField(label: "Notes", text: $notes, multiline: true)
                PhoneVaultSheetActions {
                    WebButton("Cancel") { model.dialog = nil }
                    WebButton(busy ? "Saving…" : "Save", variant: .primary) { save() }.disabled(busy || title.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 24)
        }
        .onAppear {
            guard let existing else { return }
            kind = existing.kind
            title = existing.title
            notes = existing.notes
            for f in existing.fields where !f.key.hasPrefix("custom:") { values[f.key] = f.value }
            rate()
        }
    }

    private func binding(_ key: String) -> Binding<String> {
        Binding(get: { values[key] ?? "" }, set: { values[key] = $0; if key == "password" { rate() } })
    }

    private func rate() {
        let pw = values["password"] ?? ""
        Task { strength = try? await model.client.command(.vaultStrength(password: pw)) }
    }

    private func generate(_ k: VaultGenerateArgs.Kind) {
        Task {
            if let r = try? await model.client.command(.vaultGenerate(kind: k)) {
                values["password"] = r.value
                rate()
            }
        }
    }

    private func save() {
        guard let vaultId = model.vaultId else { return }
        busy = true
        Task { @MainActor in
            do {
                let r = try await model.client.command(.vaultItemSave(vaultId: vaultId, itemId: existing?.id, kind: kind, title: title, values: values, notes: notes))
                model.toast(existing == nil ? "Added to the Vault" : "Saved", tone: existing == nil ? .success : .info)
                model.selected = r.id
                model.dialog = nil
            } catch { model.toast(VaultModel.message(error), tone: .error) }
            busy = false
        }
    }
}

private struct PhoneVaultHistory: View {
    @Bindable var model: VaultModel
    let itemId: String
    let canChange: Bool
    @State private var versions: [VaultVersion]?
    @State private var shown: Int?
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        PhoneSheetPanel(title: "Earlier versions", close: { model.dialog = nil }) {
            Group {
                if let versions {
                    if versions.isEmpty {
                        PhoneVaultEmpty(icon: .rotateCcwClock, title: "No earlier versions", message: "Each time the item is changed, the version before is kept here.")
                    } else {
                        PhoneVaultList {
                            ForEach(versions, id: \.revision) { v in row(v) }
                        }
                    }
                } else {
                    RoundedRectangle(cornerRadius: FoleviTokens.Radius.chip).fill(FoleviTokens.Chrome.surface.resolve(scheme).color).frame(height: 96)
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 20)
        }
        .task {
            guard let vaultId = model.vaultId else { return }
            do { versions = try await model.client.command(.vaultItemHistory(vaultId: vaultId, itemId: itemId)).versions } catch { model.toast(VaultModel.message(error), tone: .error) }
            model.record("history.view", itemId: itemId)
        }
    }

    private func row(_ v: VaultVersion) -> some View {
        let t = PV.style("row.title", scheme)
        let d = PV.style("row.detail", scheme)
        return VStack(alignment: .leading, spacing: 8) {
            Text(v.title).webText(t.text).lineLimit(1).foregroundStyle(t.color.color)
            Text("Version \(v.revision) · \(v.editedBy) · \(VaultTime.dateTime(v.editedAt))").webText(d.text).foregroundStyle(d.color.color)
            HStack(spacing: 8) {
                WebButton(shown == v.revision ? "Hide" : "Show", variant: .quiet, size: .sm) { shown = shown == v.revision ? nil : v.revision }
                    .disabled(v.fields.isEmpty)
                if canChange {
                    WebButton("Bring back", icon: .rotateCcw, size: .sm) {
                        guard let vaultId = model.vaultId else { return }
                        model.run {
                            _ = try await model.client.command(.vaultItemRestoreVersion(vaultId: vaultId, itemId: itemId, revision: v.revision))
                            model.toast("Brought back version \(v.revision)")
                            model.dialog = nil
                        }
                    }
                }
            }
            if shown == v.revision {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(v.fields, id: \.key) { f in
                        HStack(alignment: .top, spacing: 8) {
                            Text(f.label).webText(d.text).foregroundStyle(d.color.color).frame(width: 104, alignment: .leading)
                            Text(f.value).font(.system(size: 13, design: f.type == "secret" ? .monospaced : .default)).textSelection(.enabled)
                        }
                    }
                }
                .padding(8)
                .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.chip).fill(FoleviTokens.Chrome.surface.resolve(scheme).color))
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Sharing an item (ShareDialog.tsx): with a person, or by a one-time link. A library's Vault shows the one "Sign
/// in to share" note instead (people and sharing need an account).
private struct PhoneVaultShare: View {
    @Bindable var model: VaultModel
    let menus: PhoneMenus
    let itemId: String
    let title: String
    let note: Bool
    @State private var email = ""
    @State private var days = 30
    @State private var canEdit = false
    @State private var views = 1
    @State private var lasts = 86_400_000
    @State private var password = ""
    @State private var made: String?
    @State private var busy = false
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        PhoneSheetPanel(title: "Share \(title)", close: { model.dialog = nil }) {
            Group {
                if model.value?.local == true {
                    PhoneVaultEmpty(icon: .users, title: "Sign in to Folevi to share and collaborate", message: "Your notes are kept on your devices. Sharing, comments and workspaces need a Folevi account.")
                } else {
                    account
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 24)
        }
    }

    private var account: some View {
        let heading = PV.style("files.title", scheme)
        let hint = PV.style("health.body", scheme)
        let shares = model.store("shares:\(itemId)") { .vaultShares(vaultId: model.vaultId ?? "", itemId: itemId) }
        return VStack(alignment: .leading, spacing: 24) {
            VStack(alignment: .leading, spacing: 8) {
                Text("With a person").webText(heading.text).foregroundStyle(heading.color.color)
                Text("They open just this item, from Shared with Me. Someone outside the workspace has it until the end date.").webText(hint.text).foregroundStyle(hint.color.color).fixedSize(horizontal: false, vertical: true)
                PhoneVaultField(label: "Email", text: $email)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                PhoneVaultFlow(gap: 8, rowGap: 8, pushAfterFirst: false) {
                    PhoneVaultSelect(style: "pw.kind", label: daysLabel(days) + " if outside", options: [1, 7, 30, 90, 365].map { ("\($0)", daysLabel($0) + " if outside") }, selected: "\(days)", menus: menus) { days = Int($0) ?? 30 }
                    if note {
                        PhoneVaultSelect(style: "pw.kind", label: canEdit ? "Can edit" : "Can view", options: [("view", "Can view"), ("edit", "Can edit")], selected: canEdit ? "edit" : "view", menus: menus) { canEdit = $0 == "edit" }
                    }
                    WebButton("Share", icon: .userPlus, iconSize: 14, variant: .primary) { share() }.disabled(busy || email.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                ForEach(shares.value?.people ?? [], id: \.id) { p in
                    PhoneVaultRow(title: p.name, detail: [p.email, p.canEdit ? "can edit" : nil, p.expired ? "ended" : p.expiresAt.map { "until \(VaultTime.dateTime($0))" } ?? "no end date"].compactMap { $0 }.joined(separator: " · ")) {
                        WebButton("Stop", icon: .x, iconSize: 13, variant: .quiet, size: .sm) {
                            guard let vaultId = model.vaultId else { return }
                            model.run {
                                _ = try await model.client.command(.vaultShareStop(vaultId: vaultId, itemId: itemId, shareId: p.id))
                                model.toast("Stopped sharing with \(p.name)")
                            }
                        }
                    }
                }
            }
            VStack(alignment: .leading, spacing: 8) {
                Text("One-time link").webText(heading.text).foregroundStyle(heading.color.color)
                Text("For someone without Folevi. The key is in the link itself, never on Folevi's servers. Each opening is logged, and it stops working once used up or expired.").webText(hint.text).foregroundStyle(hint.color.color).fixedSize(horizontal: false, vertical: true)
                PhoneVaultFlow(gap: 8, rowGap: 8, pushAfterFirst: false) {
                    PhoneVaultSelect(style: "pw.kind", label: views == 1 ? "Works once" : "Works \(views) times", options: [1, 2, 3, 5, 10].map { ("\($0)", $0 == 1 ? "Works once" : "Works \($0) times") }, selected: "\(views)", menus: menus) { views = Int($0) ?? 1 }
                    PhoneVaultSelect(style: "pw.kind", label: lastsLabel(lasts), options: [3_600_000, 86_400_000, 7 * 86_400_000, 30 * 86_400_000].map { ("\($0)", lastsLabel($0)) }, selected: "\(lasts)", menus: menus) { lasts = Int($0) ?? 86_400_000 }
                }
                PhoneVaultField(label: "Password (optional)", text: $password)
                WebButton("Make link", icon: .link2, iconSize: 14) { makeLink() }.disabled(busy || (!password.isEmpty && password.count < 5))
                if let made {
                    HStack(spacing: 8) {
                        Text(made).font(.system(size: 13, design: .monospaced)).lineLimit(1).truncationMode(.middle).textSelection(.enabled)
                        Spacer(minLength: 0)
                        WebButton("Copy", icon: .copy, size: .sm) {
                            VaultModel.copySecret(made)
                            model.toast("Link copied. It's shown only now.")
                        }
                    }
                    .padding(8)
                    .overlay(RoundedRectangle(cornerRadius: FoleviTokens.Radius.chip).stroke(FoleviTokens.Chrome.line.resolve(scheme).color))
                }
                ForEach(shares.value?.links ?? [], id: \.id) { l in
                    PhoneVaultRow(title: "Opened \(l.views) of \(l.maxViews)", detail: "until \(VaultTime.dateTime(l.expiresAt))\(l.hasPassword ? " · password" : "")") {
                        WebButton("End", variant: .quiet, size: .sm) {
                            guard let vaultId = model.vaultId else { return }
                            model.run {
                                _ = try await model.client.command(.vaultLinkRevoke(vaultId: vaultId, linkId: l.id))
                                model.toast("Link ended")
                            }
                        }
                    }
                }
            }
        }
    }

    private func daysLabel(_ d: Int) -> String { d == 1 ? "1 day" : d == 365 ? "1 year" : "\(d) days" }
    private func lastsLabel(_ ms: Int) -> String { ms == 3_600_000 ? "for 1 hour" : ms == 86_400_000 ? "for 1 day" : "for \(ms / 86_400_000) days" }

    private func share() {
        guard let vaultId = model.vaultId else { return }
        busy = true
        let to = email
        Task { @MainActor in
            do {
                let r = try await model.client.command(.vaultSharePerson(vaultId: vaultId, itemId: itemId, email: to, days: days, canEdit: canEdit))
                model.toast(r.message, tone: r.status == "shared" ? .success : r.status == "inVault" ? .info : .error)
                if r.status == "shared" { email = "" }
            } catch { model.toast(VaultModel.message(error), tone: .error) }
            busy = false
        }
    }

    private func makeLink() {
        guard let vaultId = model.vaultId else { return }
        busy = true
        let pw = password
        Task { @MainActor in
            do {
                made = try await model.client.command(.vaultLinkCreate(vaultId: vaultId, itemId: itemId, maxViews: views, lastsMs: lasts, password: pw.isEmpty ? nil : pw)).url
                password = ""
            } catch { model.toast(VaultModel.message(error), tone: .error) }
            busy = false
        }
    }
}

/// A vault note (Files.tsx NoteDialog): its text, editable by who may change it, each save keeping the version before.
private struct PhoneVaultNote: View {
    @Bindable var model: VaultModel
    let row: VaultItemRow
    @State private var note: VaultNoteValue?
    @State private var text = ""
    @State private var busy = false
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        PhoneSheetPanel(title: row.title, close: { model.dialog = nil }, scrolls: false) {
            VStack(alignment: .leading, spacing: 12) {
                if note != nil {
                    TextEditor(text: $text)
                        .font(.custom("Instrument Sans", size: 17))
                        .foregroundStyle(FoleviTokens.Chrome.ink.resolve(scheme).color)
                        .scrollContentBackground(.hidden)
                        .disabled(note?.canChange != true)
                        .frame(maxHeight: .infinity)
                } else {
                    RoundedRectangle(cornerRadius: FoleviTokens.Radius.chip).fill(FoleviTokens.Chrome.surface.resolve(scheme).color).frame(height: 160)
                    Spacer(minLength: 0)
                }
                if note?.canChange == true {
                    HStack(spacing: 8) {
                        WebButton("Share", icon: .share2) { model.dialog = .share(itemId: row.id, title: row.title, note: true) }
                        Spacer(minLength: 0)
                        WebButton(busy ? "Saving…" : "Save", variant: .primary) { save() }.disabled(busy || text == note?.text)
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 20)
        }
        .task {
            guard let vaultId = model.vaultId else { return }
            do {
                let n = try await model.client.command(.vaultNoteOpen(vaultId: vaultId, itemId: row.id))
                note = n
                text = n.text
            } catch { model.toast(VaultModel.message(error), tone: .error) }
        }
    }

    private func save() {
        guard let vaultId = model.vaultId, let n = note else { return }
        busy = true
        let body = text
        Task { @MainActor in
            do {
                let r = try await model.client.command(.vaultNoteSave(vaultId: vaultId, itemId: row.id, revision: n.revision, text: body))
                note = VaultNoteValue(id: n.id, title: n.title, text: body, canChange: n.canChange, revision: r.revision)
                model.toast("Saved")
            } catch { model.toast(VaultModel.message(error), tone: .error) }
            busy = false
        }
    }
}

private struct PhoneVaultChangePasscode: View {
    @Bindable var model: VaultModel
    @State private var current = ""
    @State private var next: String?
    @State private var busy = false
    @State private var error: String?
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        PhoneSheetPanel(title: "Change passcode", close: { model.dialog = nil }) {
            VStack(alignment: .leading, spacing: 16) {
                PhonePasscodeInput(label: "Current passcode", value: $current, autoFocus: true)
                PhoneNewPasscode(label: "New passcode", lengths: model.value?.passcodeLengths ?? [6, 8, 12], pin: $next)
                if let error { Text(error).foregroundStyle(PV.color("danger", scheme)).webText(PV.style("health.body", scheme).text) }
                PhoneVaultSheetActions {
                    WebButton("Cancel") { model.dialog = nil }
                    WebButton(busy ? "Saving…" : "Change passcode", variant: .primary) { save() }.disabled(current.isEmpty || next == nil || busy)
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 20)
        }
    }

    private func save() {
        guard let vaultId = model.vaultId, let next else { return }
        busy = true
        error = nil
        let cur = current
        Task { @MainActor in
            do {
                let r = try await model.client.command(.vaultChangePasscode(vaultId: vaultId, current: cur, next: next))
                if r.status == "ok" {
                    // Face ID keeps opening it: the kept passcode follows the change.
                    if VaultBiometrics.isOn(vaultId: vaultId) { _ = await VaultBiometrics.turnOn(vaultId: vaultId, passcode: next) }
                    model.toast("Passcode changed", tone: .success)
                    model.dialog = nil
                } else { error = r.message }
            } catch { self.error = VaultModel.message(error) }
            busy = false
        }
    }
}

// MARK: file previews (FilePreview.tsx)

/// A file previewed: the engine decrypts it (and logs the preview); swipe or the arrows move through the folder;
/// Share hands it to iOS (Save to Files, AirDrop…), Quick Look opens what Folevi doesn't draw itself.
private struct PhoneVaultPreview: View {
    @Bindable var model: VaultModel
    let files: [VaultItemRow]
    @State var index: Int
    @State private var file: VaultFileValue?
    @State private var bytes: Data?
    @State private var error: String?
    @State private var shared: VaultTempFile?
    @State private var looking: VaultTempFile?
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let current = files[index]
        let d = PV.style("row.detail", scheme)
        PhoneSheetPanel(title: current.title, close: { model.dialog = nil }, scrolls: false) {
            VStack(alignment: .leading, spacing: 12) {
                Text("\(current.detail) · \(VaultTime.relative(current.updatedAt, now: ScreenClock.now()))\(files.count > 1 ? " · \(index + 1) of \(files.count)" : "")")
                    .webText(d.text).foregroundStyle(d.color.color)
                Group {
                    if let error {
                        Text(error).webText(PV.style("health.body", scheme).text).foregroundStyle(PV.color("danger", scheme)).frame(maxWidth: .infinity, minHeight: 192)
                    } else if let file, let bytes {
                        PhoneVaultFileBody(kind: file.kind, name: file.name, bytes: bytes) { quickLook(file, bytes) }
                    } else {
                        RoundedRectangle(cornerRadius: 10).fill(FoleviTokens.Chrome.surface.resolve(scheme).color).frame(height: 192).accessibilityLabel("Decrypting")
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .gesture(DragGesture(minimumDistance: 30).onEnded { g in
                    if g.translation.width < -60 { move(1) } else if g.translation.width > 60 { move(-1) }
                })
                HStack(spacing: 8) {
                    if files.count > 1 {
                        WebIconButton(.chevronLeft, label: "Previous file") { move(-1) }.disabled(index == 0)
                        WebIconButton(.chevronRight, label: "Next file") { move(1) }.disabled(index == files.count - 1)
                    }
                    Spacer(minLength: 0)
                    WebButton("Share", icon: .share2, variant: .primary) { share(current) }.disabled(file == nil)
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 20)
        }
        .task(id: current.id) { await load(current) }
        .sheet(item: $shared, onDismiss: { shared?.remove() }) { f in
            VaultShareSheet(url: f.url).presentationDetents([.medium, .large])
        }
        .fullScreenCover(item: $looking, onDismiss: { looking?.remove() }) { f in
            VaultQuickLook(url: f.url) { looking = nil }.ignoresSafeArea()
        }
        .onDisappear {
            shared?.remove()
            looking?.remove()
        }
    }

    private func move(_ d: Int) { index = min(max(index + d, 0), files.count - 1) }

    private func load(_ f: VaultItemRow) async {
        file = nil
        bytes = nil
        error = nil
        guard let vaultId = model.vaultId else { return }
        do {
            let v = try await model.client.command(.vaultFileOpen(vaultId: vaultId, itemId: f.id, purpose: .preview))
            bytes = Data(base64Encoded: v.data)
            file = v
        } catch { self.error = VaultModel.message(error) }
    }

    /// Download on the web: here the decrypted file goes to iOS's share sheet (logged as a download).
    private func share(_ f: VaultItemRow) {
        guard let vaultId = model.vaultId else { return }
        model.run {
            let v = try await model.client.command(.vaultFileOpen(vaultId: vaultId, itemId: f.id, purpose: .download))
            guard let data = Data(base64Encoded: v.data) else { return }
            shared = try VaultTempFile(name: v.name, data: data)
        }
    }

    private func quickLook(_ f: VaultFileValue, _ data: Data) {
        looking = try? VaultTempFile(name: f.name, data: data)
    }
}

/// A decrypted file drawn from memory.
private struct PhoneVaultFileBody: View {
    let kind: String
    let name: String
    let bytes: Data
    let quickLook: () -> Void
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        switch kind {
        case "image":
            if let image = UIImage(data: bytes) {
                Image(uiImage: image).resizable().scaledToFit().frame(maxWidth: .infinity, maxHeight: .infinity).clipShape(RoundedRectangle(cornerRadius: 4))
                    .accessibilityLabel(name)
            } else { other }
        case "pdf": VaultPDFView(data: bytes).clipShape(RoundedRectangle(cornerRadius: 10))
        case "audio", "video": VaultMediaView(data: bytes, name: name).frame(maxHeight: kind == "audio" ? 120 : .infinity).clipShape(RoundedRectangle(cornerRadius: 10))
        case "csv": csv
        case "text":
            ScrollView {
                Text(String(decoding: bytes.prefix(800_000), as: UTF8.self) + (bytes.count > 800_000 ? "\n\n… Share it for the rest." : ""))
                    .font(.system(size: 13, design: .monospaced))
                    .foregroundStyle(FoleviTokens.Chrome.ink.resolve(scheme).color)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(16)
            }
            .background(RoundedRectangle(cornerRadius: 10).fill(FoleviTokens.Chrome.surface.resolve(scheme).color))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(FoleviTokens.Chrome.line.resolve(scheme).color))
        default: other
        }
    }

    private var csv: some View {
        let rows = VaultCSV.parse(String(decoding: bytes.prefix(800_000), as: UTF8.self))
        let head = rows.first ?? []
        let rest = Array(rows.dropFirst().prefix(500))
        return ScrollView([.vertical, .horizontal]) {
            Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
                GridRow {
                    ForEach(Array(head.enumerated()), id: \.offset) { _, h in
                        Text(h).fontWeight(.semibold).padding(.horizontal, 12).padding(.vertical, 8)
                    }
                }
                .background(FoleviTokens.Chrome.surface.resolve(scheme).color)
                ForEach(Array(rest.enumerated()), id: \.offset) { _, r in
                    Divider()
                    GridRow {
                        ForEach(Array(r.enumerated()), id: \.offset) { _, c in
                            Text(c).padding(.horizontal, 12).padding(.vertical, 6)
                        }
                    }
                }
            }
            .font(.custom("Instrument Sans", size: 13))
            .foregroundStyle(FoleviTokens.Chrome.ink.resolve(scheme).color)
            .textSelection(.enabled)
        }
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(FoleviTokens.Chrome.line.resolve(scheme).color))
    }

    /// What Folevi doesn't draw itself: Quick Look (Office files, Keynote, Numbers, ZIPs' lists, 3D…).
    private var other: some View {
        let t = PV.style("row.title", scheme)
        let d = PV.style("row.detail", scheme)
        return VStack(spacing: 8) {
            WebIconView(.file, size: 24).frame(width: 56, height: 56).background(RoundedRectangle(cornerRadius: 10).fill(FoleviTokens.Chrome.surfaceSunken.resolve(scheme).color))
            Text(name).webText(t.text).foregroundStyle(t.color.color)
            Text("Folevi doesn't draw this kind of file itself. Quick Look may open it on this device.").webText(d.text).foregroundStyle(d.color.color).multilineTextAlignment(.center)
            WebButton("Open in Quick Look", icon: .eye) { quickLook() }.padding(.top, 8)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.vertical, 40)
    }
}

/// PDFKit, from the bytes in memory (no file written).
private struct VaultPDFView: UIViewRepresentable {
    let data: Data
    func makeUIView(context: Context) -> PDFView {
        let v = PDFView()
        v.autoScales = true
        v.displayMode = .singlePageContinuous
        v.displayDirection = .vertical
        v.document = PDFDocument(data: data)
        return v
    }
    func updateUIView(_ v: PDFView, context: Context) {}
}

/// AVKit over the bytes in memory: an asset read through a resource loader, never a file on disk.
private struct VaultMediaView: UIViewControllerRepresentable {
    let data: Data
    let name: String

    final class Loader: NSObject, AVAssetResourceLoaderDelegate {
        let data: Data
        let type: String
        init(data: Data, type: String) { self.data = data; self.type = type }
        func resourceLoader(_ resourceLoader: AVAssetResourceLoader, shouldWaitForLoadingOfRequestedResource request: AVAssetResourceLoadingRequest) -> Bool {
            if let info = request.contentInformationRequest {
                info.contentType = type
                info.contentLength = Int64(data.count)
                info.isByteRangeAccessSupported = true
            }
            if let d = request.dataRequest {
                let start = Int(d.requestedOffset)
                let end = min(data.count, start + d.requestedLength)
                if start < end { d.respond(with: data.subdata(in: start..<end)) }
            }
            request.finishLoading()
            return true
        }
    }

    func makeCoordinator() -> Loader {
        let ext = (name as NSString).pathExtension.lowercased()
        return Loader(data: data, type: UTType(filenameExtension: ext)?.identifier ?? "public.movie")
    }

    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let c = AVPlayerViewController()
        let asset = AVURLAsset(url: URL(string: "folevi-vault-memory://file/\(name.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? "file")")!)
        asset.resourceLoader.setDelegate(context.coordinator, queue: .main)
        c.player = AVPlayer(playerItem: AVPlayerItem(asset: asset))
        c.allowsPictureInPicturePlayback = false
        c.updatesNowPlayingInfoCenter = false
        return c
    }

    func updateUIViewController(_ c: AVPlayerViewController, context: Context) {}
    static func dismantleUIViewController(_ c: AVPlayerViewController, coordinator: Loader) { c.player?.pause() }
}

/// A decrypted file handed to iOS (Share, Quick Look): in its own folder under this app's temporary folder, with
/// complete file protection, removed when the sheet closes (and the folder is cleared at the next one).
struct VaultTempFile: Identifiable {
    let id = UUID()
    let url: URL
    private static var folder: URL { FileManager.default.temporaryDirectory.appendingPathComponent("vault-open", isDirectory: true) }

    init(name: String, data: Data) throws {
        let fm = FileManager.default
        try? fm.removeItem(at: Self.folder)
        let dir = Self.folder.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        let safe = name.replacingOccurrences(of: "/", with: "-")
        url = dir.appendingPathComponent(safe.isEmpty ? "File" : safe)
        try data.write(to: url, options: [.completeFileProtection, .atomic])
    }

    func remove() { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
}

private struct VaultShareSheet: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [url], applicationActivities: nil)
    }
    func updateUIViewController(_ c: UIActivityViewController, context: Context) {}
}

private struct VaultQuickLook: UIViewControllerRepresentable {
    let url: URL
    let close: () -> Void

    final class Source: NSObject, @preconcurrency QLPreviewControllerDataSource, @preconcurrency QLPreviewControllerDelegate {
        let url: URL
        let close: () -> Void
        init(url: URL, close: @escaping () -> Void) { self.url = url; self.close = close }
        func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }
        func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem { url as NSURL }
        func previewControllerDidDismiss(_ controller: QLPreviewController) { close() }
        // Read only: no markup saved back over the decrypted copy.
        func previewController(_ controller: QLPreviewController, editingModeFor previewItem: QLPreviewItem) -> QLPreviewItemEditingMode { .disabled }
    }

    func makeCoordinator() -> Source { Source(url: url, close: close) }

    func makeUIViewController(context: Context) -> UINavigationController {
        let q = QLPreviewController()
        q.dataSource = context.coordinator
        q.delegate = context.coordinator
        q.navigationItem.leftBarButtonItem = UIBarButtonItem(systemItem: .done, primaryAction: UIAction { _ in context.coordinator.close() })
        return UINavigationController(rootViewController: q)
    }

    func updateUIViewController(_ c: UINavigationController, context: Context) {}
}
#endif
