import SwiftUI
import UniformTypeIdentifiers

// Settings → Import & export (the web's DataSection), for Personal or, under a workspace's own settings,
// for that workspace (its owners and admins).

/// Import Markdown and text files, a folder, or a ZIP (with the images they reference) into Personal or a
/// workspace, and export all of it as a ZIP.
struct DataSettings: View {
    var scope: Scope
    var name: String
    @Environment(AppModel.self) private var app
    @State private var results: [ImportOutcome] = []
    @State private var busy = false
    @State private var progress = ""
    @State private var exportNote: String?

    struct ImportOutcome: Identifiable {
        var id = UUID()
        var name: String
        var documentId: String?
        var warnings: [String]
        var error: String?
        var images = 0
    }

    var body: some View {
        SettingsPage {
            SettingsCard(title: String(localized: "Import into \(name)"),
                         description: String(localized: "Markdown (.md) and plain text (.txt) files, a folder, or a ZIP. Images referenced by relative paths inside a folder or ZIP are uploaded with the page. Headings, lists, checklists, links, code, quotes, tables and the front-matter title are kept. Anything we can’t convert is kept as text and listed below.")) {
                HStack(spacing: 8) {
                    Button { chooseFiles() } label: {
                        Label(busy ? String(localized: "Importing…") : String(localized: "Choose files…"), systemImage: "square.and.arrow.up")
                    }
                    Button { chooseFolder() } label: {
                        Label("Import a folder…", systemImage: "folder.badge.plus")
                    }
                }
                .buttonStyle(.folevi(.secondary, .medium))
                .disabled(busy)
                Text(progress)
                    .font(.ui(12)).foregroundStyle(FoleviColor.inkMuted)
                    .frame(minHeight: 16, alignment: .leading)
                    .padding(.top, 8)
                    .accessibilityAddTraits(.updatesFrequently)
                if !results.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(results) { r in outcome(r) }
                    }
                    .padding(.top, 12)
                    .accessibilityElement(children: .contain)
                    .accessibilityLabel(Text("Import results"))
                }
            }
            SettingsCard(title: String(localized: "Export \(name)"),
                         description: String(localized: "A ZIP with every document in \(name) as Markdown (in folders matching your sidebar), all attachments in an assets folder, and a manifest.json describing folders, documents and files. Single pages can be exported from their ••• menu as Markdown, HTML or PDF.")) {
                Button(busy ? String(localized: "Preparing…") : String(localized: "Export \(name) (.zip)")) { export() }
                    .buttonStyle(.folevi(.primary, .medium))
                    .disabled(busy)
                if let exportNote {
                    Text(exportNote).font(.ui(12)).foregroundStyle(FoleviColor.inkMuted).padding(.top, 8)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    private func outcome(_ r: ImportOutcome) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                if let id = r.documentId {
                    ImportedLink(title: r.name) { open(id) }
                } else {
                    Text(r.name).font(.ui(14, .medium)).foregroundStyle(FoleviColor.ink)
                }
                if let error = r.error { Text(error).font(.ui(14)).foregroundStyle(FoleviColor.destructive) }
            }
            if r.images > 0 {
                Text(r.images == 1 ? String(localized: "1 image uploaded") : String(localized: "\(r.images) images uploaded"))
                    .font(.ui(12)).foregroundStyle(FoleviColor.inkMuted)
            }
            if !r.warnings.isEmpty {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(Array(r.warnings.enumerated()), id: \.offset) { _, w in
                        Text("•  \(w)").font(.ui(12)).foregroundStyle(FoleviColor.inkMuted).fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(.leading, 8)
            } else if r.documentId != nil {
                Text("Imported without changes.").font(.ui(12)).foregroundStyle(FoleviColor.inkMuted)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .foleviCard(radius: 8)
    }

    private func open(_ id: String) {
        // A page in another scope would open nowhere; it's in the open one when the target is.
        guard scope == app.scope else { return }
        app.pendingOpenDocumentId = id
    }

    private func chooseFiles() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [UTType(filenameExtension: "md"), UTType(filenameExtension: "markdown"), .plainText, .zip, .png, .jpeg, .gif, .webP]
            .compactMap { $0 }
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        panel.begin { response in
            guard response == .OK else { return }
            let urls = panel.urls
            MainActor.assumeIsolated { runImport(urls, folder: nil) }
        }
    }

    private func chooseFolder() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = String(localized: "Import")
        panel.begin { response in
            guard response == .OK, let folder = panel.url else { return }
            MainActor.assumeIsolated {
                let accessed = folder.startAccessingSecurityScopedResource()
                defer { if accessed { folder.stopAccessingSecurityScopedResource() } }
                var files: [URL] = []
                if let walker = FileManager.default.enumerator(at: folder, includingPropertiesForKeys: [.isRegularFileKey]) {
                    for case let url as URL in walker where (try? url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true {
                        files.append(url)
                    }
                }
                runImport(files, folder: folder)
            }
        }
    }

    private func runImport(_ urls: [URL], folder: URL?) {
        guard let session = app.session, !urls.isEmpty else { return }
        guard app.sync.isOnline else {
            app.showToast(String(localized: "This needs a connection. Try again when you're back online."))
            return
        }
        let target = scope
        busy = true
        results = []
        progress = String(localized: "Reading files…")
        let bundle = ImportBundle.entries(files: urls, folder: folder)
        Task {
            var out: [ImportOutcome] = bundle.errors.map { ImportOutcome(name: $0.name, warnings: [], error: $0.message) }
            let map = ImportBundle.entryMap(bundle.entries)
            let docs = bundle.entries.filter { ImportBundle.isText($0.path) }
            if docs.isEmpty && bundle.errors.isEmpty {
                out.append(ImportOutcome(name: urls.count == 1 ? urls[0].lastPathComponent : String(localized: "\(urls.count) files"), warnings: [],
                                         error: String(localized: "No Markdown (.md) or text (.txt) files found.")))
            }
            if docs.count > ImportBundle.maxDocs {
                app.showToast(String(localized: "Importing the first \(ImportBundle.maxDocs) of \(docs.count) documents. Import the rest in another batch."))
            }
            // An image used by several documents is uploaded once.
            var uploaded: [String: String] = [:]
            let list = Array(docs.prefix(ImportBundle.maxDocs))
            for (i, doc) in list.enumerated() {
                let fileName = doc.path.split(separator: "/").last.map(String.init) ?? doc.path
                progress = String(localized: "Importing \(i + 1) of \(list.count): \(fileName)")
                let content = String(decoding: doc.data, as: UTF8.self)
                let markdown = !ImportBundle.isPlainText(doc.path)
                var imageMap: [String: String] = [:]
                var warnings: [String] = []
                var images = 0
                if markdown {
                    for src in ImportBundle.imageSources(content) {
                        guard let entry = ImportBundle.resolveImage(map, all: bundle.entries, from: doc.path, src: src) else { continue }
                        guard let mime = ImportBundle.imageMime(entry.path) else {
                            warnings.append(String(localized: "Image “\(src)” isn’t a PNG, JPEG, GIF or WebP and was kept as a link"))
                            continue
                        }
                        do {
                            if let id = uploaded[entry.path] {
                                imageMap[src] = id
                            } else {
                                let id = try await uploadImage(entry, mime: mime, scope: target, session: session)
                                uploaded[entry.path] = id
                                imageMap[src] = id
                            }
                            images += 1
                        } catch {
                            warnings.append(String(localized: "Image “\(src)” couldn’t be uploaded: \(ConvexService.mapError(error).localizedDescription)"))
                        }
                    }
                }
                do {
                    let r = try await session.documents.importText(scope: target, filename: fileName, content: content, markdown: markdown, imageMap: imageMap)
                    let serverWarnings = r.warnings.map { $0.line > 0 ? String(localized: "Line \(Int($0.line)): \($0.message)") : $0.message }
                    out.append(ImportOutcome(name: doc.path, documentId: r.document.id, warnings: warnings + serverWarnings, images: images))
                } catch {
                    out.append(ImportOutcome(name: doc.path, warnings: [], error: ConvexService.mapError(error).localizedDescription))
                }
                results = out
            }
            results = out
            busy = false
            progress = ""
            await session.engine.syncNow()
            let ok = out.filter { $0.documentId != nil }.count
            app.showToast(String(localized: "Imported \(ok) of \(out.count) \(out.count == 1 ? String(localized: "file") : String(localized: "files"))"))
        }
    }

    private func uploadImage(_ entry: ImportBundle.Entry, mime: String, scope: Scope, session: SessionContext) async throws -> String {
        let name = entry.path.split(separator: "/").last.map(String.init) ?? "image"
        let ticket: UploadTicket = try await session.convex.mutation("files:generateUploadUrl", [
            "scope": scope.arg, "filename": .string(name), "size": .number(Double(entry.data.count)),
            "mimeType": .string(mime), "kind": .string("image"),
        ])
        return try await SettingsUploads.send(entry.data, mimeType: mime, ticket: ticket, convex: session.convex)
    }

    private func export() {
        guard let session = app.session else { return }
        guard app.sync.isOnline else {
            app.showToast(String(localized: "This needs a connection. Try again when you're back online."))
            return
        }
        let target = scope
        busy = true
        exportNote = nil
        Task {
            defer { busy = false }
            do {
                let r = try await session.account.exportScope(target)
                guard let remote = URL(string: r.url) else { throw FoleviError.invalidResponse("export url") }
                let (tmp, response) = try await URLSession.shared.download(from: remote)
                guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                    throw FoleviError.server(code: "download_failed", message: String(localized: "The export couldn't be downloaded. Try again."))
                }
                // Like a browser download: into Downloads, shown in Finder.
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

/// An imported page's name, underlined on hover (`hover:underline`), opening the page.
private struct ImportedLink: View {
    var title: String
    var action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Text(title).font(.ui(14, .medium)).foregroundStyle(FoleviColor.ink).underline(hovering)
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .accessibilityAddTraits(.isLink)
    }
}
