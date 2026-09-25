import AppKit
import CoreTransferable
import SwiftUI
import UniformTypeIdentifiers

/// Export as Markdown (with an assets folder when there are attachments), HTML (self-contained) or PDF,
/// and Import Markdown. Files are written only to locations the person picks (security-scoped).
@MainActor
enum ExportService {
    enum Format: String, CaseIterable, Identifiable {
        case markdown, html, pdf
        var id: String { rawValue }
        var title: LocalizedStringKey {
            switch self {
            case .markdown: return "Markdown"
            case .html: return "HTML"
            case .pdf: return "PDF"
            }
        }
    }

    static func safeFilename(_ title: String) -> String {
        let cleaned = title.replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ":", with: "-").trimmingCharacters(in: .whitespacesAndNewlines)
        return cleaned.isEmpty ? String(localized: "Untitled") : String(cleaned.prefix(120))
    }

    static func fileIds(in blocks: [WireBlock]) -> [String] {
        blocks.compactMap { b -> String? in
            guard b.type == "image" || b.type == "file", let id = b.props["fileId"]?.stringValue, !id.isEmpty else { return nil }
            return id
        }
    }

    static func export(_ format: Format, title: String, blocks: [WireBlock], app: AppModel) {
        let name = safeFilename(title)
        let panel = NSSavePanel()
        panel.canCreateDirectories = true
        let hasAssets = !fileIds(in: blocks).isEmpty
        switch format {
        case .markdown:
            if hasAssets {
                panel.nameFieldStringValue = name
                panel.message = String(localized: "Folevi will create a folder with the Markdown file and its attachments.")
            } else {
                panel.nameFieldStringValue = name + ".md"
                panel.allowedContentTypes = [UTType(filenameExtension: "md") ?? .plainText]
            }
        case .html:
            panel.nameFieldStringValue = name + ".html"
            panel.allowedContentTypes = [.html]
        case .pdf:
            panel.nameFieldStringValue = name + ".pdf"
            panel.allowedContentTypes = [.pdf]
        }
        panel.begin { response in
            guard response == .OK, let url = panel.url else { return }
            MainActor.assumeIsolated {
                Task {
                    do {
                        let written = try await write(format, to: url, title: title, blocks: blocks, app: app, asFolder: format == .markdown && hasAssets)
                        NSWorkspace.shared.activateFileViewerSelecting([written])
                    } catch {
                        app.showToast(String(localized: "Export failed: \(error.localizedDescription)"))
                    }
                }
            }
        }
    }

    static func write(_ format: Format, to url: URL, title: String, blocks: [WireBlock], app: AppModel, asFolder: Bool) async throws -> URL {
        let accessed = url.startAccessingSecurityScopedResource()
        defer { if accessed { url.stopAccessingSecurityScopedResource() } }
        let docTitles = Dictionary(app.documents.map { ($0.id, $0.displayTitle) }, uniquingKeysWith: { a, _ in a })
        switch format {
        case .markdown:
            var fileMap: [String: String] = [:]
            var target = url
            if asFolder {
                try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
                let assets = url.appendingPathComponent("assets", isDirectory: true)
                try FileManager.default.createDirectory(at: assets, withIntermediateDirectories: true)
                for id in fileIds(in: blocks) {
                    guard let local = try? await app.session?.files.localFile(fileId: id) else { continue }
                    let dest = assets.appendingPathComponent(local.lastPathComponent)
                    try? FileManager.default.removeItem(at: dest)
                    try FileManager.default.copyItem(at: local, to: dest)
                    fileMap[id] = "assets/" + local.lastPathComponent
                }
                target = url.appendingPathComponent(safeFilename(title) + ".md")
            }
            let md = MarkdownCodec.blocksToMarkdown(blocks, .init(resolveFile: { fileMap[$0] },
                                                                  resolveDocument: { docTitles[$0].map { safeFilename($0) + ".md" } },
                                                                  title: title))
            try md.write(to: target, atomically: true, encoding: .utf8)
            return asFolder ? url : target
        case .html:
            let html = await htmlString(title: title, blocks: blocks, app: app, embedImages: true)
            try html.write(to: url, atomically: true, encoding: .utf8)
            return url
        case .pdf:
            let html = await htmlString(title: title, blocks: blocks, app: app, embedImages: true)
            try pdfData(fromHTML: html).write(to: url)
            return url
        }
    }

    static func htmlString(title: String, blocks: [WireBlock], app: AppModel, embedImages: Bool) async -> String {
        var dataURIs: [String: String] = [:]
        if embedImages {
            for id in fileIds(in: blocks) {
                if let local = try? await app.session?.files.localFile(fileId: id), let data = try? Data(contentsOf: local) {
                    let mime = FilesRepository.mimeType(for: local)
                    dataURIs[id] = "data:\(mime);base64,\(data.base64EncodedString())"
                }
            }
        }
        return HTMLExport.blocksToHTML(blocks, .init(title: title, resolveFile: { dataURIs[$0] }))
    }

    /// Renders HTML into a paginated PDF with AppKit's text system (no web view).
    static func pdfData(fromHTML html: String) throws -> Data {
        guard let data = html.data(using: .utf8),
              let attributed = NSAttributedString(html: data, options: [.characterEncoding: String.Encoding.utf8.rawValue], documentAttributes: nil) else {
            throw FoleviError.invalidResponse("html")
        }
        let printInfo = NSPrintInfo()
        printInfo.paperSize = NSSize(width: 612, height: 792)
        printInfo.topMargin = 54
        printInfo.bottomMargin = 54
        printInfo.leftMargin = 60
        printInfo.rightMargin = 60
        let width = printInfo.paperSize.width - printInfo.leftMargin - printInfo.rightMargin
        let textView = NSTextView(frame: NSRect(x: 0, y: 0, width: width, height: 10))
        textView.textStorage?.setAttributedString(attributed)
        textView.isVerticallyResizable = true
        textView.sizeToFit()
        textView.layoutManager?.ensureLayout(for: textView.textContainer ?? NSTextContainer())
        let height = max(textView.layoutManager?.usedRect(for: textView.textContainer ?? NSTextContainer()).height ?? 100, 100)
        textView.frame = NSRect(x: 0, y: 0, width: width, height: height)
        let output = NSMutableData()
        let op = NSPrintOperation.pdfOperation(with: textView, inside: textView.bounds, to: output, printInfo: printInfo)
        op.showsPrintPanel = false
        op.showsProgressPanel = false
        guard op.run() else { throw FoleviError.invalidResponse("pdf") }
        return output as Data
    }

    // MARK: Import

    static func importMarkdown(app: AppModel, completion: @escaping (String?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [UTType(filenameExtension: "md") ?? .plainText, UTType(filenameExtension: "markdown") ?? .plainText, .plainText]
        panel.allowsMultipleSelection = false
        panel.begin { response in
            guard response == .OK, let url = panel.url else { return }
            MainActor.assumeIsolated {
                let accessed = url.startAccessingSecurityScopedResource()
                defer { if accessed { url.stopAccessingSecurityScopedResource() } }
                guard let text = try? String(contentsOf: url, encoding: .utf8) else {
                    app.showToast(String(localized: "That file couldn't be read as text."))
                    return
                }
                let isMarkdown = ["md", "markdown"].contains(url.pathExtension.lowercased())
                let base = url.deletingPathExtension().lastPathComponent
                let blocks: [WireBlock]
                var title = base
                var warnings = 0
                if isMarkdown {
                    let result = MarkdownCodec.markdownToBlocks(text)
                    blocks = result.blocks
                    title = result.title ?? base
                    warnings = result.warnings.count
                } else {
                    blocks = MarkdownCodec.plainTextToBlocks(text)
                }
                guard blocks.count <= FoleviLimits.maxBlocksPerDocument else {
                    app.showToast(String(localized: "That file has too many blocks to import."))
                    return
                }
                Task {
                    let id = await app.createDocument(title: title, blocks: blocks.isEmpty ? nil : blocks)
                    if warnings > 0 { app.showToast(String(localized: "Imported with \(warnings) notes: some Markdown was kept as plain text.")) }
                    completion(id)
                }
            }
        }
    }
}

/// Share sheet item: a Markdown export written to a temporary file on demand.
struct MarkdownShareItem: Transferable {
    var title: String
    var markdown: String

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(exportedContentType: UTType(filenameExtension: "md") ?? .plainText) { item in
            let dir = FileManager.default.temporaryDirectory.appendingPathComponent("FoleviShare", isDirectory: true)
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let name = item.title.replacingOccurrences(of: "/", with: "-")
            let url = dir.appendingPathComponent((name.isEmpty ? "Untitled" : name) + ".md")
            try item.markdown.write(to: url, atomically: true, encoding: .utf8)
            return SentTransferredFile(url)
        }
    }
}
