import SwiftUI
import UniformTypeIdentifiers

// Settings → Security (two-step verification and password on the web; deleting the account here) and
// Import & export (for Personal, or a workspace's owners and admins).

struct SecuritySettings: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        SettingsPage {
            SettingsCard(title: String(localized: "Two-step verification"),
                         description: String(localized: "Optional. When it's on, signing in on a new device needs a code from your authenticator app as well as your password, so a stolen password isn't enough.")) {
                HStack {
                    Text("Turning it on, backup codes and moving to a new authenticator app happen on the web.")
                        .font(.ui(13)).foregroundStyle(FoleviColor.inkMuted)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 12)
                    Button("Open on the web") { openWebApp("settings/security", config: app.config) }
                        .buttonStyle(.folevi(.secondary, .small))
                }
            }
            SettingsCard(title: String(localized: "Password"), description: String(localized: "Changing your password signs you out on every other device.")) {
                Button("Change password on the web") { openWebApp("settings/security", config: app.config) }
                    .buttonStyle(.folevi(.secondary, .small))
            }
            DeleteAccountCard()
        }
    }
}

/// Delete account: scheduled with a 7-day grace period, cancelable. Workspaces other people use must be
/// handed on or deleted first (the server refuses otherwise).
struct DeleteAccountCard: View {
    @Environment(AppModel.self) private var app
    @State private var blockers: DeletionBlockers?
    @State private var confirming = false
    @State private var typed = ""
    @State private var busy = false

    private var pending: Bool { app.profile?.status == "pending_deletion" }

    var body: some View {
        SettingsCard(title: String(localized: "Delete account"),
                     description: String(localized: "Deletes your account, your Personal and everything in it after a 7-day grace period, along with workspaces you own that nobody else is in. Export your data first if you want to keep it.")) {
            if pending {
                HStack(spacing: 12) {
                    Text(app.profile?.deletionScheduledFor.map { String(localized: "Scheduled for \(Date(timeIntervalSince1970: $0 / 1000).formatted(date: .long, time: .shortened)).") }
                         ?? String(localized: "Scheduled for soon."))
                        .font(.ui(13))
                    Button("Cancel deletion") { cancel() }.buttonStyle(.folevi(.secondary, .small))
                }
            } else if let blockers, !blockers.workspaces.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text(blockers.workspaces.count == 1
                         ? String(localized: "You own a workspace other people use. Your account can’t be deleted until you make another member the owner (Members → Make owner) or delete it (General → Delete workspace):")
                         : String(localized: "You own workspaces other people use. Your account can’t be deleted until you make another member the owner (Members → Make owner) or delete them (General → Delete workspace):"))
                        .font(.ui(13)).fixedSize(horizontal: false, vertical: true)
                    ForEach(blockers.workspaces) { w in
                        let n = Int(w.otherMembers)
                        Text("• \(w.name) · \(n) other \(n == 1 ? String(localized: "member") : String(localized: "members"))")
                            .font(.ui(13)).foregroundStyle(FoleviColor.inkMuted)
                    }
                }
            } else {
                Button("Delete my account…") {
                    typed = ""
                    confirming = true
                }
                .buttonStyle(.folevi(.danger, .small))
                .disabled(!app.sync.isOnline)
            }
        }
        .task(id: pending) { await load() }
        .sheet(isPresented: $confirming) {
            FoleviDialog(title: String(localized: "Delete your account?"),
                         message: String(localized: "You can cancel within 7 days by signing in. After that, deletion is permanent and cannot be undone. We'll email you a confirmation."),
                         confirmTitle: String(localized: "Schedule deletion"),
                         cancelTitle: String(localized: "Keep my account"),
                         confirmDisabled: typed.trimmingCharacters(in: .whitespaces).lowercased() != (app.profile?.email ?? "").lowercased(),
                         busy: busy, onConfirm: request) {
                TypeToConfirmField(expected: app.profile?.email ?? "", text: $typed)
            }
            .environment(app)
        }
    }

    private func load() async {
        guard !pending, let session = app.session, app.sync.isOnline else { return }
        blockers = try? await session.account.deletionBlockers()
    }

    private func request() {
        guard let session = app.session else { return }
        let email = typed
        busy = true
        Task {
            defer { busy = false }
            do {
                let r = try await session.account.requestAccountDeletion(confirmEmail: email)
                app.profile?.status = "pending_deletion"
                app.profile?.deletionScheduledFor = r.scheduledFor
                confirming = false
                app.showToast(String(localized: "Account deletion scheduled"))
            } catch {
                app.showToast(ConvexService.mapError(error).localizedDescription)
            }
        }
    }

    private func cancel() {
        guard let session = app.session else { return }
        Task {
            do {
                try await session.account.cancelAccountDeletion()
                app.profile?.status = "active"
                app.profile?.deletionScheduledFor = nil
                app.showToast(String(localized: "Deletion canceled"))
            } catch {
                app.showToast(ConvexService.mapError(error).localizedDescription)
            }
        }
    }
}

// MARK: - Import & export

/// Import Markdown and text files into Personal or a workspace, and export all of it as a ZIP (the web's
/// DataSection). A workspace's owners and admins see it for their workspace.
struct DataSettings: View {
    var scope: Scope
    var name: String
    @Environment(AppModel.self) private var app
    @State private var results: [ImportOutcome] = []
    @State private var importing = false
    @State private var progress = ""
    @State private var exporting = false
    @State private var exportNote: String?

    struct ImportOutcome: Identifiable {
        var id = UUID()
        var name: String
        var documentId: String?
        var warnings: [String]
        var error: String?
    }

    private static let maxDocs = 50

    var body: some View {
        SettingsPage {
            SettingsCard(title: String(localized: "Import into \(name)"),
                         description: String(localized: "Markdown (.md) and plain text (.txt) files. Headings, lists, checklists, links, code, quotes, tables and the front-matter title are kept. Anything we can’t convert is kept as text and listed below.")) {
                HStack(spacing: 10) {
                    Button { chooseFiles() } label: {
                        Label(importing ? String(localized: "Importing…") : String(localized: "Choose files…"), systemImage: "square.and.arrow.down")
                    }
                    .buttonStyle(.folevi(.secondary, .small))
                    .disabled(importing || exporting || !app.sync.isOnline)
                    if !progress.isEmpty { Text(progress).font(.ui(12)).foregroundStyle(FoleviColor.inkMuted) }
                }
                if !results.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(results) { r in outcome(r) }
                    }
                    .padding(.top, 12)
                }
            }
            SettingsCard(title: String(localized: "Export \(name)"),
                         description: String(localized: "A ZIP with every document in \(name) as Markdown (in folders matching your sidebar), all attachments in an assets folder, and a manifest.json describing folders, documents and files. Single pages can be exported from File › Export as Markdown, HTML or PDF.")) {
                Button(exporting ? String(localized: "Preparing…") : String(localized: "Export \(name) (.zip)")) { export() }
                    .buttonStyle(.folevi(.primary, .small))
                    .disabled(exporting || importing || !app.sync.isOnline)
                if let exportNote {
                    Text(exportNote).font(.ui(12)).foregroundStyle(FoleviColor.inkMuted).padding(.top, 8)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            if !app.sync.isOnline { OfflineNote(text: String(localized: "Import and export need a connection.")) }
        }
    }

    private func outcome(_ r: ImportOutcome) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                if let id = r.documentId {
                    Button(r.name) { open(id) }.buttonStyle(.plain).font(.ui(13, .medium)).foregroundStyle(FoleviColor.heading)
                } else {
                    Text(r.name).font(.ui(13, .medium))
                }
                if let error = r.error { Text(error).font(.ui(12.5)).foregroundStyle(FoleviColor.destructive) }
            }
            if !r.warnings.isEmpty {
                ForEach(Array(r.warnings.enumerated()), id: \.offset) { _, w in
                    Text("• \(w)").font(.ui(12)).foregroundStyle(FoleviColor.inkMuted)
                }
            } else if r.documentId != nil {
                Text("Imported without changes.").font(.ui(12)).foregroundStyle(FoleviColor.inkMuted)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(FoleviColor.line))
    }

    private func open(_ id: String) {
        // Opening a page from another scope would land nowhere; it's in the open one when the target is.
        guard scope == app.scope else { return }
        OpenWindowBridge.shared.openDocument?(id)
    }

    private func chooseFiles() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [UTType(filenameExtension: "md") ?? .plainText, UTType(filenameExtension: "markdown") ?? .plainText, .plainText]
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        panel.begin { response in
            guard response == .OK else { return }
            let urls = panel.urls
            MainActor.assumeIsolated { runImport(urls) }
        }
    }

    private func runImport(_ urls: [URL]) {
        guard let session = app.session, !urls.isEmpty else { return }
        if urls.count > Self.maxDocs {
            app.showToast(String(localized: "Importing the first \(Self.maxDocs) of \(urls.count) documents. Import the rest in another batch."))
        }
        let list = Array(urls.prefix(Self.maxDocs))
        let target = scope
        importing = true
        results = []
        Task {
            var out: [ImportOutcome] = []
            for (i, url) in list.enumerated() {
                progress = String(localized: "Importing \(i + 1) of \(list.count): \(url.lastPathComponent)")
                let accessed = url.startAccessingSecurityScopedResource()
                defer { if accessed { url.stopAccessingSecurityScopedResource() } }
                guard let text = try? String(contentsOf: url, encoding: .utf8) else {
                    out.append(ImportOutcome(name: url.lastPathComponent, warnings: [], error: String(localized: "That file couldn't be read as text.")))
                    results = out
                    continue
                }
                let markdown = !["txt", "text"].contains(url.pathExtension.lowercased())
                do {
                    let r = try await session.documents.importText(scope: target, filename: url.lastPathComponent, content: text, markdown: markdown)
                    out.append(ImportOutcome(name: url.lastPathComponent, documentId: r.document.id,
                                             warnings: r.warnings.map { $0.line > 0 ? String(localized: "Line \(Int($0.line)): \($0.message)") : $0.message }))
                } catch {
                    out.append(ImportOutcome(name: url.lastPathComponent, warnings: [], error: ConvexService.mapError(error).localizedDescription))
                }
                results = out
            }
            importing = false
            progress = ""
            await session.engine.syncNow()
            let ok = out.filter { $0.documentId != nil }.count
            app.showToast(String(localized: "Imported \(ok) of \(out.count) \(out.count == 1 ? String(localized: "file") : String(localized: "files"))"))
        }
    }

    private func export() {
        guard let session = app.session else { return }
        let target = scope
        exporting = true
        exportNote = nil
        Task {
            defer { exporting = false }
            do {
                let r = try await session.account.exportScope(target)
                guard let remote = URL(string: r.url) else { throw FoleviError.invalidResponse("export url") }
                let (tmp, response) = try await URLSession.shared.download(from: remote)
                guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                    throw FoleviError.server(code: "download_failed", message: String(localized: "The export couldn't be downloaded. Try again."))
                }
                let dest = Self.uniqueDownloadURL(r.filename)
                try FileManager.default.moveItem(at: tmp, to: dest)
                NSWorkspace.shared.activateFileViewerSelecting([dest])
                if r.skippedAssets.isEmpty {
                    app.showToast(String(localized: "Exported \(Int(r.documents)) documents and \(Int(r.assets)) attachments"))
                } else {
                    let n = r.skippedAssets.count
                    let reason = r.skippedReason == "size" ? String(localized: "the export reached its 400 MB size limit") : String(localized: "they couldn’t be read")
                    let names = r.skippedAssets.prefix(5).joined(separator: ", ") + (n > 5 ? "…" : "")
                    exportNote = n == 1
                        ? String(localized: "1 attachment was left out because \(reason): \(names). They’re listed in manifest.json.")
                        : String(localized: "\(n) attachments were left out because \(reason): \(names). They’re listed in manifest.json.")
                    app.showToast(String(localized: "Exported \(Int(r.documents)) documents; \(n) attachments were left out"))
                }
            } catch {
                app.showToast(ConvexService.mapError(error).localizedDescription)
            }
        }
    }

    /// ~/Downloads/<name>, numbered when it's taken (as a browser saves a download).
    static func uniqueDownloadURL(_ filename: String) -> URL {
        let dir = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first ?? FileManager.default.temporaryDirectory
        let safe = filename.replacingOccurrences(of: "/", with: "-")
        var url = dir.appendingPathComponent(safe)
        let base = url.deletingPathExtension().lastPathComponent
        let ext = url.pathExtension
        var n = 2
        while FileManager.default.fileExists(atPath: url.path) {
            url = dir.appendingPathComponent("\(base) \(n)").appendingPathExtension(ext)
            n += 1
        }
        return url
    }
}
