// Settings > Import & export (views/settings/DataSection.tsx, TakeoutCard.tsx): import files or a folder into
// Personal or the workspace (the engine runs the web's own import, lib/import/run.ts), a takeout file, and the
// space's export as a ZIP.
#if os(macOS)
import AppKit
import SwiftUI
import UniformTypeIdentifiers
import FoleviDesign
import FoleviEngine

struct DataSettings: View {
    let model: MacSettingsModel
    let workspace: SpaceInfo?
    @State private var progress = ""
    @State private var results: [Result] = []
    @State private var importing = false
    @State private var takeoutStatus: String?
    @State private var takeoutBusy = false
    @State private var exporting = false
    @State private var exportNote: String?
    @Environment(\.colorScheme) private var scheme

    struct Result: Decodable, Identifiable {
        struct Warning: Decodable { var line: Int?; var message: String }
        var name: String, id: String?, warnings: [Warning], error: String?, images: Int?
        var key: String { "\(name)|\(id ?? "")|\(error ?? "")" }
    }

    private var whereName: String { workspace?.name ?? "Personal" }

    var body: some View {
        VStack(alignment: .leading, spacing: SettingsStyle.pair("card").light.margin.bottom) {
            SettingsCard("Import into \(whereName)", description: "Markdown and text files, a folder or a ZIP (an Obsidian vault works), a Notion export (Export → Markdown & CSV, as a ZIP), an Evernote export (.enex), Word documents (.docx), HTML and CSV files. Pages keep their headings, lists, to-dos, links, code, quotes, tables and images; Notion pages stay nested and linked, a folder or ZIP keeps its subfolders, and Evernote notes go into a folder named after the notebook. Anything we can’t convert is kept as text and listed below.") {
                VStack(alignment: .leading, spacing: 0) {
                    SettingsButtons {
                        WebButton(importing ? "Importing…" : "Choose files…", icon: .upload) { pick(folder: false) }.disabled(importing)
                        WebButton("Import a folder…", icon: .folderUp) { pick(folder: true) }.disabled(importing)
                    }
                    Group { if progress.isEmpty { Color.clear.frame(height: 0) } else { SText(progress, "progress") } }.padding(.top, SettingsStyle.pair("progress").light.margin.top)
                    if !results.isEmpty { resultList.padding(.top, 12) }
                }
            }
            if workspace == nil {
                SettingsCard("Takeout", description: model.isLocal ? "Import a takeout file from a Folevi account: everything in it comes into this library, in a folder of its own." : "One file with everything in your account: notes, files, history, folders and tags, and the workspaces you manage. Another account or a library on your Mac, iPhone, iPad or phone can import it.") {
                    VStack(alignment: .leading, spacing: 0) {
                        SettingsButtons {
                            WebButton("Import a takeout file…") { pickTakeout() }.disabled(takeoutBusy)
                        }
                        if let takeoutStatus { SText(takeoutStatus, "progress").padding(.top, 8) }
                    }
                }
            }
            SettingsCard("Export \(whereName)", description: "A ZIP with every document in \(whereName) as Markdown (in folders matching your sidebar), all attachments in an assets folder, and a manifest.json describing folders, documents and files. Single pages can be exported from their ••• menu as Markdown, HTML or PDF.") {
                VStack(alignment: .leading, spacing: 0) {
                    WebButton(exporting ? "Preparing…" : "Export \(whereName) (.zip)", variant: .primary) { export() }.disabled(exporting)
                    if let exportNote { SText(exportNote, "progress").padding(.top, 8) }
                }
            }
        }
    }

    private var resultList: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(results, id: \.key) { r in
                VStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: 8) {
                        Button { if let id = r.id { model.frame.open(.note(id)) } } label: { SText(r.name, "dd", weight: 500) }.buttonStyle(.plain).disabled(r.id == nil)
                        if let e = r.error { SText(e, "dd", color: SettingsColor.v("color-danger", scheme)) }
                    }
                    if let n = r.images, n > 0 { SText(n == 1 ? "1 image uploaded" : "\(n) images uploaded", "progress") }
                    if !r.warnings.isEmpty {
                        ForEach(Array(r.warnings.enumerated()), id: \.offset) { _, w in SText("• \(w.line.map { "Line \($0): " } ?? "")\(w.message)", "progress") }
                    } else if r.id != nil {
                        SText("Imported without changes.", "progress")
                    }
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .webBox(SettingsStyle.pair("card"))
            }
        }
    }

    private func pick(folder: Bool) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = !folder
        panel.canChooseDirectories = folder
        panel.allowsMultipleSelection = !folder
        if !folder { panel.allowedContentTypes = ["md", "markdown", "txt", "zip", "enex", "docx", "html", "htm", "csv", "png", "jpg", "jpeg", "gif", "webp"].compactMap { UTType(filenameExtension: $0) } }
        guard panel.runModal() == .OK else { return }
        let files = folder ? panel.urls.first.map(Self.files(inFolder:)) ?? [] : panel.urls.map { ($0, "") }
        run(files)
    }

    /// Every file in a folder, with its path from the folder's own name ("Vault/Notes/a.md"), as a picked folder gives it.
    static func files(inFolder root: URL) -> [(URL, String)] {
        let base = root.deletingLastPathComponent().path
        let e = FileManager.default.enumerator(at: root, includingPropertiesForKeys: [.isRegularFileKey], options: [.skipsHiddenFiles])
        var out: [(URL, String)] = []
        while let u = e?.nextObject() as? URL {
            guard (try? u.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true else { continue }
            out.append((u, String(u.path.dropFirst(base.count + 1))))
        }
        return out
    }

    private static func payload(_ files: [(URL, String)]) -> JSONValue {
        .array(files.compactMap { url, path in
            guard let data = try? Data(contentsOf: url) else { return nil }
            let type = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? ""
            return .object(["name": .string(url.lastPathComponent), "path": .string(path), "type": .string(type), "data": .string(data.base64EncodedString())])
        })
    }

    private func run(_ files: [(URL, String)]) {
        guard !files.isEmpty else { return }
        importing = true
        results = []
        progress = "Reading files…"
        Task {
            var args: [String: JSONValue] = ["files": Self.payload(files)]
            if let w = workspace { args["workspaceId"] = .string(w.id) }
            progress = files.count == 1 ? "Importing \(files[0].0.lastPathComponent)…" : "Importing \(files.count) files…"
            let r = await model.run(.dataImport, args, quiet: true)
            progress = ""
            importing = false
            guard case .object(let o)? = r else { return }
            if case .array(let notes)? = o["notes"] { for case .string(let n) in notes { model.frame.toast(n) } }
            results = o["results"]?.decoded([Result].self) ?? []
            if case .string(let m)? = o["message"] { model.frame.toast(m, tone: o["allOk"] == .bool(true) ? .success : .error) }
        }
    }

    private func pickTakeout() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.zip]
        guard panel.runModal() == .OK, let url = panel.url else { return }
        takeoutBusy = true
        takeoutStatus = "Importing: folders and tags…"
        Task {
            let r = await model.run(.takeoutImport, ["files": Self.payload([(url, "")])])
            takeoutBusy = false
            if case .object(let o)? = r, case .string(let s)? = o["status"] { takeoutStatus = s } else { takeoutStatus = nil }
        }
    }

    private func export() {
        exporting = true
        exportNote = nil
        Task {
            let scope: JSONValue = workspace.map { .object(["kind": .string("workspace"), "workspaceId": .string($0.id)]) } ?? .object(["kind": .string("personal")])
            let r = await model.mutate("exports.exportScope", ["scope": scope], action: true)
            exporting = false
            guard case .object(let o)? = r else { return }
            if case .string(let s)? = o["url"], let url = URL(string: s) { NSWorkspace.shared.open(url) }
            let docs = o["documents"].flatMap { if case .number(let n) = $0 { Int(n) } else { nil } } ?? 0
            let assets = o["assets"].flatMap { if case .number(let n) = $0 { Int(n) } else { nil } } ?? 0
            if case .array(let skipped)? = o["skippedAssets"], !skipped.isEmpty {
                let names = skipped.prefix(5).compactMap { if case .string(let s) = $0 { s } else { nil } }.joined(separator: ", ")
                let why = o["skippedReason"] == .string("size") ? "the export reached its 400 MB size limit" : "they couldn’t be read"
                exportNote = "\(skipped.count == 1 ? "1 attachment was" : "\(skipped.count) attachments were") left out because \(why): \(names)\(skipped.count > 5 ? "…" : ""). They’re listed in manifest.json."
                model.frame.toast("Exported \(docs) documents; \(skipped.count) attachments were left out", tone: .error)
            } else {
                model.frame.toast("Exported \(docs) documents and \(assets) attachments", tone: .success)
            }
        }
    }
}
#endif
