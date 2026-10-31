// The dialogs over the Vault (components/vault/*: PromptDialog, ItemDialog, HistoryDialog, ShareDialog, NoteDialog,
// FilePreview, Empty the Trash, Change passcode), solid as the web draws them over the inverted Vault. A file is
// decrypted by the engine for its preview (logged) and shown from memory only: PDFKit for PDFs, AVKit for audio
// and video, an image view, text and code as text, CSV as a table; anything else gets a card with Download.
#if os(macOS)
import AppKit
import AVKit
import PDFKit
import SwiftUI
import FoleviDesign
import FoleviEngine

struct VaultDialogHost: View {
    @Bindable var model: VaultModel
    let dialog: VaultDialog
    @Environment(\.colorScheme) private var scheme

    /// Presented by the frame as every dialog is (FrameSheets: centred on the window under the bar, the page not
    /// dimmed, a click outside or Escape closes it), in the Vault's inverted theme.
    var body: some View {
        content
            .shadow(color: .black.opacity(0.25), radius: 24, y: 12)
            .uiInvert()
    }

    @ViewBuilder private var content: some View {
        switch dialog {
        case .newFolder: PromptDialog(model: model, title: "New folder", label: "Folder name", folder: true)
        case .newNote: PromptDialog(model: model, title: "New note", label: "Title", folder: false)
        case .addItem: ItemDialog(model: model, existing: nil)
        case .editItem(let item): ItemDialog(model: model, existing: item)
        case .history(let id, let canChange): HistoryDialog(model: model, itemId: id, canChange: canChange)
        case .share(let id, let title, let note): ShareDialog(model: model, itemId: id, title: title, note: note)
        case .note(let row): NoteDialog(model: model, row: row)
        case .preview(let files, let index): PreviewDialog(model: model, files: files, index: index)
        case .emptyTrash: EmptyTrashDialog(model: model)
        case .changePasscode: ChangePasscodeDialog(model: model)
        }
    }
}

/// A labelled text field in a dialog (`label > span + input.ui-input`).
private struct DialogField: View {
    let label: String
    @Binding var text: String
    var mono = false
    var multiline = false
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let l = VS.style("vault.gate.label", scheme)
        VStack(alignment: .leading, spacing: 4) {
            Text(label).webText(l.text).foregroundStyle(l.color.color)
            if multiline {
                TextEditor(text: $text)
                    .font(mono ? .system(size: 13, design: .monospaced) : .custom("Instrument Sans", size: 13))
                    .scrollContentBackground(.hidden)
                    .padding(6)
                    .frame(height: 84)
                    .webBox(VS.pair("vault.gate.input"))
            } else if mono {
                TextField("", text: $text).textFieldStyle(.plain).font(.system(size: 13, design: .monospaced))
                    .padding(.horizontal, 12).frame(height: 36).webBox(VS.pair("vault.gate.input"))
            } else {
                WebTextField(text: $text)
            }
        }
    }
}

private struct PromptDialog: View {
    @Bindable var model: VaultModel
    let title: String
    let label: String
    let folder: Bool
    @State private var name = ""

    var body: some View {
        WebDialog(title, width: 384) {
            DialogField(label: label, text: $name)
        } footer: {
            WebButton("Cancel") { model.dialog = nil }
            WebButton("Create", variant: .primary) { create() }.disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
        }
    }

    private func create() {
        guard let vaultId = model.vaultId else { return }
        let parent = model.folderId
        let n = name
        model.dialog = nil
        model.run {
            if folder { _ = try await model.frame.client.command(.vaultFolderCreate(vaultId: vaultId, parentId: parent, name: n)) }
            else { _ = try await model.frame.client.command(.vaultNoteCreate(vaultId: vaultId, folderId: parent, title: n)) }
        }
    }
}

/// Adding and editing a password item (Passwords.tsx ItemDialog): the kind's fields, a generator, strength.
private struct ItemDialog: View {
    @Bindable var model: VaultModel
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
        WebDialog(existing.map { "Edit \($0.title)" } ?? "Add to the Vault", width: 512) {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if existing == nil {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Kind").webText(VS.style("vault.gate.label", scheme).text)
                            VaultSelect(style: "vault.pw.kind", label: def?.label ?? "Login", options: kinds.map { ($0.kind, $0.label) }, selected: kind) { kind = $0 }
                        }
                    }
                    DialogField(label: "Title", text: $title)
                    ForEach(def?.fields ?? [], id: \.key) { f in
                        VStack(alignment: .leading, spacing: 4) {
                            DialogField(label: f.label, text: binding(f.key), mono: f.type == "secret" || f.type == "totp" || f.type == "multiline", multiline: f.type == "multiline")
                                .overlay(alignment: .topTrailing) {
                                    if f.key == "password" {
                                        HStack(spacing: 4) {
                                            WebButton("Generate", icon: .refreshCw, variant: .quiet, size: .sm) { generate(.password) }
                                            WebButton("Memorable", variant: .quiet, size: .sm) { generate(.passphrase) }
                                        }
                                        .offset(y: -6)
                                    }
                                }
                            if f.key == "password", let strength, !(values["password"] ?? "").isEmpty {
                                Text(strength.label).webText(VS.style("vault.health.body", scheme).text)
                                    .foregroundStyle(strength.score >= 3 ? VS.color("success", scheme) : strength.score == 2 ? VS.style("vault.health.body", scheme).color.color : VS.color("warning", scheme))
                            }
                        }
                    }
                    DialogField(label: "Notes", text: $notes, multiline: true)
                }
                .padding(.bottom, 8)
            }
            .frame(maxHeight: 460)
        } footer: {
            WebButton("Cancel") { model.dialog = nil }
            WebButton(busy ? "Saving…" : "Save", variant: .primary) { save() }.disabled(busy || title.trimmingCharacters(in: .whitespaces).isEmpty)
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
        Task { strength = try? await model.frame.client.command(.vaultStrength(password: pw)) }
    }

    private func generate(_ k: VaultGenerateArgs.Kind) {
        Task {
            if let r = try? await model.frame.client.command(.vaultGenerate(kind: k)) {
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
                let r = try await model.frame.client.command(.vaultItemSave(vaultId: vaultId, itemId: existing?.id, kind: kind, title: title, values: values, notes: notes))
                model.toast(existing == nil ? "Added to the Vault" : "Saved", tone: existing == nil ? .success : .info)
                model.selected = r.id
                model.dialog = nil
            } catch { model.toast(VaultModel.message(error), tone: .error) }
            busy = false
        }
    }
}

private struct HistoryDialog: View {
    @Bindable var model: VaultModel
    let itemId: String
    let canChange: Bool
    @State private var versions: [VaultVersion]?
    @State private var shown: Int?
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        WebDialog("Earlier versions", width: 512) {
            if let versions {
                if versions.isEmpty {
                    VaultEmpty(icon: .rotateCcwClock, title: "No earlier versions", message: "Each time the item is changed, the version before is kept here.")
                } else {
                    ScrollView {
                        VaultList {
                            ForEach(versions, id: \.revision) { v in row(v) }
                        }
                    }
                    .frame(maxHeight: 420)
                }
            } else {
                RoundedRectangle(cornerRadius: 6).fill(VS.color("surface", scheme)).frame(height: 96)
            }
        } footer: {
            WebButton("Close") { model.dialog = nil }
        }
        .task {
            guard let vaultId = model.vaultId else { return }
            do { versions = try await model.frame.client.command(.vaultItemHistory(vaultId: vaultId, itemId: itemId)).versions } catch { model.toast(VaultModel.message(error), tone: .error) }
        }
    }

    private func row(_ v: VaultVersion) -> some View {
        let t = VS.style("vault.row.title", scheme)
        let d = VS.style("vault.row.detail", scheme)
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                VStack(alignment: .leading, spacing: 0) {
                    Text(v.title).webText(t.text).lineLimit(1).foregroundStyle(t.color.color)
                    Text("Version \(v.revision) · \(v.editedBy) · \(VaultTime.dateTime(v.editedAt))").webText(d.text).foregroundStyle(d.color.color)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                WebButton(shown == v.revision ? "Hide" : "Show", variant: .quiet, size: .sm) { shown = shown == v.revision ? nil : v.revision }
                    .disabled(v.fields.isEmpty)
                if canChange {
                    WebButton("Bring back", icon: .rotateCcw, size: .sm) {
                        guard let vaultId = model.vaultId else { return }
                        model.run {
                            _ = try await model.frame.client.command(.vaultItemRestoreVersion(vaultId: vaultId, itemId: itemId, revision: v.revision))
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
                            Text(f.label).webText(d.text).foregroundStyle(d.color.color).frame(width: 112, alignment: .leading)
                            Text(f.value).font(.system(size: 12, design: f.type == "secret" ? .monospaced : .default)).textSelection(.enabled)
                        }
                    }
                }
                .padding(8)
                .background(RoundedRectangle(cornerRadius: 6).fill(VS.color("surface", scheme)))
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .onAppear { model.record("history.view", itemId: itemId) }
    }
}

/// Sharing an item (ShareDialog.tsx): with a person, or by a one-time link. A library's Vault shows the one
/// "Sign in to share" note instead (People and sharing need an account).
private struct ShareDialog: View {
    @Bindable var model: VaultModel
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
        WebDialog("Share \(title)", width: 512) {
            if model.value?.local == true {
                VaultEmpty(icon: .users, title: "Sign in to Folevi to share and collaborate", message: "Your notes are kept on your devices. Sharing, comments and workspaces need a Folevi account.")
            } else {
                account
            }
        } footer: {
            WebButton("Done") { model.dialog = nil }
        }
    }

    private var account: some View {
        let heading = VS.style("vault.files.title", scheme)
        let hint = VS.style("vault.health.body", scheme)
        let shares = model.store("shares:\(itemId)") { .vaultShares(vaultId: model.vaultId ?? "", itemId: itemId) }
        return VStack(alignment: .leading, spacing: 24) {
            VStack(alignment: .leading, spacing: 8) {
                Text("With a person").webText(heading.text)
                Text("They open just this item, from Shared with Me. Someone outside the workspace has it until the end date.").webText(hint.text).foregroundStyle(hint.color.color)
                HStack(alignment: .bottom, spacing: 8) {
                    DialogField(label: "Email", text: $email)
                    VaultSelect(style: "vault.pw.kind", label: daysLabel(days) + " if outside", options: [1, 7, 30, 90, 365].map { ("\($0)", daysLabel($0) + " if outside") }, selected: "\(days)") { days = Int($0) ?? 30 }
                    if note {
                        VaultSelect(style: "vault.pw.kind", label: canEdit ? "Can edit" : "Can view", options: [("view", "Can view"), ("edit", "Can edit")], selected: canEdit ? "edit" : "view") { canEdit = $0 == "edit" }
                    }
                    WebButton("Share", icon: .userPlus, variant: .primary) { share() }.disabled(busy || email.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                ForEach(shares.value?.people ?? [], id: \.id) { p in
                    VaultRow(title: p.name, detail: [p.email, p.canEdit ? "can edit" : nil, p.expired ? "ended" : p.expiresAt.map { "until \(VaultTime.dateTime($0))" } ?? "no end date"].compactMap { $0 }.joined(separator: " · ")) {
                        WebButton("Stop", icon: .x, variant: .quiet, size: .sm) {
                            guard let vaultId = model.vaultId else { return }
                            model.run {
                                _ = try await model.frame.client.command(.vaultShareStop(vaultId: vaultId, itemId: itemId, shareId: p.id))
                                model.toast("Stopped sharing with \(p.name)")
                            }
                        }
                    }
                }
            }
            VStack(alignment: .leading, spacing: 8) {
                Text("One-time link").webText(heading.text)
                Text("For someone without Folevi. The key is in the link itself, never on Folevi's servers. Each opening is logged, and it stops working once used up or expired.").webText(hint.text).foregroundStyle(hint.color.color)
                HStack(alignment: .bottom, spacing: 8) {
                    VaultSelect(style: "vault.pw.kind", label: views == 1 ? "Works once" : "Works \(views) times", options: [1, 2, 3, 5, 10].map { ("\($0)", $0 == 1 ? "Works once" : "Works \($0) times") }, selected: "\(views)") { views = Int($0) ?? 1 }
                    VaultSelect(style: "vault.pw.kind", label: lastsLabel(lasts), options: [3_600_000, 86_400_000, 7 * 86_400_000, 30 * 86_400_000].map { ("\($0)", lastsLabel($0)) }, selected: "\(lasts)") { lasts = Int($0) ?? 86_400_000 }
                    DialogField(label: "Password (optional)", text: $password)
                    WebButton("Make link", icon: .link2) { makeLink() }.disabled(busy || (!password.isEmpty && password.count < 5))
                }
                if let made {
                    HStack(spacing: 8) {
                        Text(made).font(.system(size: 12, design: .monospaced)).lineLimit(1).truncationMode(.middle).textSelection(.enabled)
                        Spacer(minLength: 0)
                        WebButton("Copy", icon: .copy, size: .sm) {
                            NSPasteboard.general.clearContents()
                            NSPasteboard.general.setString(made, forType: .string)
                            model.toast("Link copied. It's shown only now.")
                        }
                    }
                    .padding(8)
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(VS.color("line", scheme)))
                }
                ForEach(shares.value?.links ?? [], id: \.id) { l in
                    VaultRow(title: "Opened \(l.views) of \(l.maxViews)", detail: "until \(VaultTime.dateTime(l.expiresAt))\(l.hasPassword ? " · password" : "")") {
                        WebButton("End", variant: .quiet, size: .sm) {
                            guard let vaultId = model.vaultId else { return }
                            model.run {
                                _ = try await model.frame.client.command(.vaultLinkRevoke(vaultId: vaultId, linkId: l.id))
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
                let r = try await model.frame.client.command(.vaultSharePerson(vaultId: vaultId, itemId: itemId, email: to, days: days, canEdit: canEdit))
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
                made = try await model.frame.client.command(.vaultLinkCreate(vaultId: vaultId, itemId: itemId, maxViews: views, lastsMs: lasts, password: pw.isEmpty ? nil : pw)).url
                password = ""
            } catch { model.toast(VaultModel.message(error), tone: .error) }
            busy = false
        }
    }
}

/// A vault note (Files.tsx NoteDialog): its text, editable by who may change it, each save keeping the version before.
private struct NoteDialog: View {
    @Bindable var model: VaultModel
    let row: VaultItemRow
    @State private var note: VaultNoteValue?
    @State private var text = ""
    @State private var busy = false
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        WebDialog(row.title, width: 640) {
            if note != nil {
                TextEditor(text: $text)
                    .font(.custom("Instrument Sans", size: 15))
                    .scrollContentBackground(.hidden)
                    .disabled(note?.canChange != true)
                    .frame(minHeight: 260, maxHeight: 420)
            } else {
                RoundedRectangle(cornerRadius: 6).fill(VS.color("surface", scheme)).frame(height: 160)
            }
        } footer: {
            if note?.canChange == true {
                WebButton("Share") { model.dialog = .share(itemId: row.id, title: row.title, note: true) }
            }
            WebButton("Close") { model.dialog = nil }
            if note?.canChange == true {
                WebButton("Save", variant: .primary) { save() }.disabled(busy || text == note?.text)
            }
        }
        .task {
            guard let vaultId = model.vaultId else { return }
            do {
                let n = try await model.frame.client.command(.vaultNoteOpen(vaultId: vaultId, itemId: row.id))
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
                let r = try await model.frame.client.command(.vaultNoteSave(vaultId: vaultId, itemId: row.id, revision: n.revision, text: body))
                note = VaultNoteValue(id: n.id, title: n.title, text: body, canChange: n.canChange, revision: r.revision)
                model.toast("Saved")
            } catch { model.toast(VaultModel.message(error), tone: .error) }
            busy = false
        }
    }
}

/// A file previewed (FilePreview.tsx): the engine decrypts it (and logs the preview); ← and → move through the folder.
private struct PreviewDialog: View {
    @Bindable var model: VaultModel
    let files: [VaultItemRow]
    @State var index: Int
    @State private var file: VaultFileValue?
    @State private var bytes: Data?
    @State private var error: String?
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let current = files[index]
        WebDialog(current.title, description: "\(current.detail) · \(VaultTime.relative(current.updatedAt))\(files.count > 1 ? " · \(index + 1) of \(files.count)" : "")", width: 880) {
            Group {
                if let error {
                    Text(error).foregroundStyle(VS.color("danger", scheme)).frame(maxWidth: .infinity, minHeight: 192)
                } else if let file, let bytes {
                    VaultFileBody(kind: file.kind, name: file.name, bytes: bytes)
                } else {
                    RoundedRectangle(cornerRadius: 10).fill(VS.color("surface", scheme)).frame(height: 192).accessibilityLabel("Decrypting")
                }
            }
            .frame(minHeight: 192)
        } footer: {
            if files.count > 1 {
                WebIconButton(.chevronLeft, label: "Previous file") { move(-1) }.disabled(index == 0)
                WebIconButton(.chevronRight, label: "Next file") { move(1) }.disabled(index == files.count - 1)
                Spacer(minLength: 0)
            }
            WebButton("Close") { model.dialog = nil }
            WebButton("Download", icon: .download, variant: .primary) { download(current) }
        }
        .task(id: current.id) { await load(current) }
        .onKeyPress(.leftArrow) { move(-1); return .handled }
        .onKeyPress(.rightArrow) { move(1); return .handled }
    }

    private func move(_ d: Int) { index = min(max(index + d, 0), files.count - 1) }

    private func load(_ f: VaultItemRow) async {
        file = nil
        bytes = nil
        error = nil
        guard let vaultId = model.vaultId else { return }
        do {
            let v = try await model.frame.client.command(.vaultFileOpen(vaultId: vaultId, itemId: f.id, purpose: .preview))
            bytes = Data(base64Encoded: v.data)
            file = v
        } catch { self.error = VaultModel.message(error) }
    }

    private func download(_ f: VaultItemRow) {
        guard let vaultId = model.vaultId else { return }
        model.run {
            let v = try await model.frame.client.command(.vaultFileOpen(vaultId: vaultId, itemId: f.id, purpose: .download))
            let panel = NSSavePanel()
            panel.nameFieldStringValue = v.name
            guard panel.runModal() == .OK, let url = panel.url, let data = Data(base64Encoded: v.data) else { return }
            try data.write(to: url)
        }
    }
}

/// A decrypted file drawn from memory.
private struct VaultFileBody: View {
    let kind: String
    let name: String
    let bytes: Data
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        switch kind {
        case "image":
            if let image = NSImage(data: bytes) {
                Image(nsImage: image).resizable().scaledToFit().frame(maxHeight: 540).clipShape(RoundedRectangle(cornerRadius: 4))
            } else { other }
        case "pdf": PDFPreview(data: bytes).frame(height: 540)
        case "audio", "video": MediaPreview(data: bytes, name: name).frame(height: kind == "audio" ? 64 : 480)
        case "csv": CSVPreview(text: String(decoding: bytes.prefix(800_000), as: UTF8.self))
        case "text":
            ScrollView {
                Text(String(decoding: bytes.prefix(800_000), as: UTF8.self) + (bytes.count > 800_000 ? "\n\n… Download it for the rest." : ""))
                    .font(.system(size: 12, design: .monospaced))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(16)
            }
            .frame(maxHeight: 540)
            .background(RoundedRectangle(cornerRadius: 10).fill(VS.color("surface", scheme)))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(VS.color("line", scheme)))
        default: other
        }
    }

    private var other: some View {
        VStack(spacing: 8) {
            WebIconView(.file, size: 24).frame(width: 56, height: 56).background(RoundedRectangle(cornerRadius: 10).fill(VS.color("glass-hover", scheme)))
            Text(name).webText(VS.style("vault.row.title", scheme).text)
            Text("This kind of file can't be shown here. Download it to open it on this device.").webText(VS.style("vault.row.detail", scheme).text).foregroundStyle(VS.style("vault.row.detail", scheme).color.color)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
    }
}

/// PDFKit, from the bytes in memory (no file written). Links and forms aren't followed: the view only draws pages.
private struct PDFPreview: NSViewRepresentable {
    let data: Data
    func makeNSView(context: Context) -> PDFView {
        let v = PDFView()
        v.autoScales = true
        v.displayMode = .singlePageContinuous
        v.document = PDFDocument(data: data)
        return v
    }
    func updateNSView(_ v: PDFView, context: Context) {}
}

/// AVKit over the bytes in memory: an asset read through a resource loader, never a file on disk.
private struct MediaPreview: NSViewRepresentable {
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

    func makeNSView(context: Context) -> AVPlayerView {
        let v = AVPlayerView()
        v.controlsStyle = .inline
        let asset = AVURLAsset(url: URL(string: "folevi-vault-memory://file/\(name.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? "file")")!)
        asset.resourceLoader.setDelegate(context.coordinator, queue: .main)
        v.player = AVPlayer(playerItem: AVPlayerItem(asset: asset))
        return v
    }

    func updateNSView(_ v: AVPlayerView, context: Context) {}
    static func dismantleNSView(_ v: AVPlayerView, coordinator: Loader) { v.player?.pause() }
}

/// CSV as a table (FilePreview.tsx parseCsv: quotes, doubled quotes, commas and line breaks inside quotes).
private struct CSVPreview: View {
    let text: String
    @Environment(\.colorScheme) private var scheme

    static func parse(_ text: String, max: Int = 501) -> [[String]] {
        var rows: [[String]] = []
        var row: [String] = []
        var field = ""
        var quoted = false
        var it = Array(text)
        var i = 0
        while i < it.count && rows.count < max {
            let c = it[i]
            if quoted {
                if c == "\"" && i + 1 < it.count && it[i + 1] == "\"" { field.append("\""); i += 1 }
                else if c == "\"" { quoted = false }
                else { field.append(c) }
            } else if c == "\"" { quoted = true }
            else if c == "," { row.append(field); field = "" }
            else if c == "\n" || c == "\r" || c == "\r\n" {
                row.append(field)
                rows.append(row)
                row = []
                field = ""
            } else { field.append(c) }
            i += 1
        }
        if (!field.isEmpty || !row.isEmpty) && rows.count < max { rows.append(row + [field]) }
        it.removeAll()
        return rows
    }

    var body: some View {
        let rows = Self.parse(text)
        let head = rows.first ?? []
        let rest = Array(rows.dropFirst().prefix(500))
        ScrollView([.vertical, .horizontal]) {
            Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
                GridRow {
                    ForEach(Array(head.enumerated()), id: \.offset) { _, h in
                        Text(h).fontWeight(.semibold).padding(.horizontal, 12).padding(.vertical, 8)
                    }
                }
                .background(VS.color("surface", scheme))
                ForEach(Array(rest.enumerated()), id: \.offset) { _, r in
                    Divider()
                    GridRow {
                        ForEach(Array(r.enumerated()), id: \.offset) { _, c in
                            Text(c).padding(.horizontal, 12).padding(.vertical, 6)
                        }
                    }
                }
            }
            .font(.custom("Instrument Sans", size: 12))
            .textSelection(.enabled)
        }
        .frame(maxHeight: 540)
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(VS.color("line", scheme)))
    }
}

private struct EmptyTrashDialog: View {
    @Bindable var model: VaultModel

    var body: some View {
        WebDialog("Empty the Trash?", width: 384) {
            Text("Everything in the Trash goes for good, for everyone in the Vault. The log keeps a record that it happened.")
        } footer: {
            WebButton("Cancel") { model.dialog = nil }
            WebButton("Delete for good", variant: .danger) {
                guard let vaultId = model.vaultId else { return }
                model.dialog = nil
                model.run {
                    let r = try await model.frame.client.command(.vaultTrashEmpty(vaultId: vaultId))
                    model.toast("Deleted \(r.removed) for good")
                }
            }
        }
    }
}

private struct ChangePasscodeDialog: View {
    @Bindable var model: VaultModel
    @State private var current = ""
    @State private var next: String?
    @State private var busy = false
    @State private var error: String?
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        WebDialog("Change passcode", width: 448) {
            VStack(alignment: .leading, spacing: 16) {
                PasscodeInput(label: "Current passcode", value: $current, autoFocus: true)
                NewPasscodeFields(label: "New passcode", lengths: model.value?.passcodeLengths ?? [6, 8, 12], pin: $next)
                if let error { Text(error).foregroundStyle(VS.color("danger", scheme)).webText(VS.style("vault.health.body", scheme).text) }
            }
        } footer: {
            WebButton("Cancel") { model.dialog = nil }
            WebButton(busy ? "Saving…" : "Change passcode", variant: .primary) { save() }.disabled(current.isEmpty || next == nil || busy)
        }
    }

    private func save() {
        guard let vaultId = model.vaultId, let next else { return }
        busy = true
        error = nil
        let cur = current
        Task { @MainActor in
            do {
                let r = try await model.frame.client.command(.vaultChangePasscode(vaultId: vaultId, current: cur, next: next))
                if r.status == "ok" {
                    model.toast("Passcode changed", tone: .success)
                    model.dialog = nil
                } else { error = r.message }
            } catch { self.error = VaultModel.message(error) }
            busy = false
        }
    }
}
#endif
