import AppKit
import UniformTypeIdentifiers

/// A page's exports from its "…" menu, as the web's doc/export.ts: Markdown and HTML download as one file,
/// or as a ZIP with an `assets/` folder when the page has attachments; PDF goes through the print dialog
/// ("Save as PDF"). Attachments that can't be fetched are named in the message, never dropped silently.
@MainActor
extension ExportService {
    static func pageFileName(_ name: String) -> String { PageExportText.fileName(name) }

    /// Every attachment the page refers to (images, files, audio).
    static func pageFileRefs(_ blocks: [WireBlock]) -> [(id: String, name: String)] {
        blocks.compactMap { b in
            guard let id = b.props["fileId"]?.stringValue, !id.isEmpty else { return nil }
            let name = b.props["name"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 }
                ?? b.props["alt"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 }
                ?? (b.type == "image" ? "image" : "file")
            return (id, name)
        }
    }

    static func exportPage(_ format: Format, editor: EditorModel) {
        let app = editor.app
        let title = editor.document?.title ?? ""
        let blocks = editor.exportBlocks()
        let label: String = switch format {
        case .markdown: String(localized: "Markdown")
        case .html: String(localized: "HTML")
        case .pdf: String(localized: "PDF")
        }
        Task {
            do {
                let missing: [String]
                switch format {
                case .pdf: missing = try await printPage(title: title, blocks: blocks, app: app)
                default: missing = try await savePage(format, title: title, blocks: blocks, app: app)
                }
                app.showToast(PageExportText.message(label, missing: missing))
            } catch is CancellationError {
                return
            } catch {
                app.showToast(ConvexService.mapError(error).localizedDescription)
            }
        }
    }

    /// Fetches the attachments (from this Mac's cache, or downloaded), named under `assets/`.
    private static func fetchAssets(_ blocks: [WireBlock], app: AppModel) async -> (assets: [String: (path: String, data: Data)], missing: [String]) {
        var assets: [String: (path: String, data: Data)] = [:]
        var missing: [String] = []
        for ref in pageFileRefs(blocks) where assets[ref.id] == nil {
            guard let local = try? await app.session?.files.localFile(fileId: ref.id), let data = try? Data(contentsOf: local) else {
                missing.append(ref.name)
                continue
            }
            // Cached files are stored as "<id>-<name>".
            var filename = local.lastPathComponent
            if filename.hasPrefix(ref.id + "-") { filename = String(filename.dropFirst(ref.id.count + 1)) }
            assets[ref.id] = ("assets/\(ref.id)-\(pageFileName(filename))", data)
        }
        return (assets, missing)
    }

    private static func savePage(_ format: Format, title: String, blocks: [WireBlock], app: AppModel) async throws -> [String] {
        let (assets, missing) = await fetchAssets(blocks, app: app)
        let name = pageFileName(title)
        let origin = app.config.appOrigin
        let resolveDocument: (String) -> String? = { id in origin.map { $0.appending(path: "d/\(id)").absoluteString } }
        let main: (filename: String, text: String)
        switch format {
        case .markdown:
            let md = MarkdownCodec.blocksToMarkdown(blocks, .init(resolveFile: { assets[$0]?.path }, resolveDocument: resolveDocument,
                                                                  title: title.isEmpty ? "Untitled" : title))
            main = ("\(name).md", md)
        default:
            let html = HTMLExport.blocksToHTML(blocks, .init(title: title.isEmpty ? "Untitled" : title, resolveFile: { assets[$0]?.path },
                                                             resolveDocument: resolveDocument))
            main = ("\(name).html", html)
        }
        let zipName = format == .markdown ? "\(name).zip" : "\(name)-html.zip"
        let filename = assets.isEmpty ? main.filename : zipName
        guard let url = await chooseDestination(filename) else { throw CancellationError() }
        let accessed = url.startAccessingSecurityScopedResource()
        defer { if accessed { url.stopAccessingSecurityScopedResource() } }
        if assets.isEmpty {
            try Data(main.text.utf8).write(to: url, options: .atomic)
        } else {
            var entries: [(String, Data)] = [(main.filename, Data(main.text.utf8))]
            for a in assets.values.sorted(by: { $0.path < $1.path }) { entries.append((a.path, a.data)) }
            try ZipWriter.archive(entries).write(to: url, options: .atomic)
        }
        return missing
    }

    private static func chooseDestination(_ filename: String) async -> URL? {
        let panel = NSSavePanel()
        panel.canCreateDirectories = true
        panel.nameFieldStringValue = filename
        if let type = UTType(filenameExtension: (filename as NSString).pathExtension) { panel.allowedContentTypes = [type] }
        return await withCheckedContinuation { cont in
            panel.begin { response in cont.resume(returning: response == .OK ? panel.url : nil) }
        }
    }

    /// The print dialog for the page's HTML (its PDF button saves it as a PDF).
    private static func printPage(title: String, blocks: [WireBlock], app: AppModel) async throws -> [String] {
        let refs = pageFileRefs(blocks)
        var missing: [String] = []
        for ref in refs where (try? await app.session?.files.localFile(fileId: ref.id)) == nil { missing.append(ref.name) }
        let html = await htmlString(title: title.isEmpty ? String(localized: "Untitled") : title, blocks: blocks, app: app, embedImages: true)
        guard let data = html.data(using: .utf8),
              let attributed = NSAttributedString(html: data, options: [.characterEncoding: String.Encoding.utf8.rawValue], documentAttributes: nil) else {
            throw FoleviError.invalidResponse("html")
        }
        let printInfo = NSPrintInfo()
        printInfo.topMargin = 54
        printInfo.bottomMargin = 54
        printInfo.leftMargin = 60
        printInfo.rightMargin = 60
        printInfo.jobDisposition = .spool
        let width = printInfo.paperSize.width - printInfo.leftMargin - printInfo.rightMargin
        let textView = NSTextView(frame: NSRect(x: 0, y: 0, width: width, height: 10))
        textView.textStorage?.setAttributedString(attributed)
        textView.isVerticallyResizable = true
        textView.sizeToFit()
        let op = NSPrintOperation(view: textView, printInfo: printInfo)
        op.jobTitle = title.isEmpty ? String(localized: "Untitled") : title
        op.showsPrintPanel = true
        op.showsProgressPanel = true
        if let window = NSApp.keyWindow {
            op.runModal(for: window, delegate: nil, didRun: nil, contextInfo: nil)
        } else {
            op.run()
        }
        return missing
    }
}
