// A note as a Markdown file for dragging out of Core (Finder, Mail, other apps): the page writes the Markdown and
// the note's attachments (the same "noteFile" request today's app uses, with the token "native"), Core writes them
// to a file named after the note, with the attachments in a "<title> files" folder beside it.
import AppKit
import UniformTypeIdentifiers

@MainActor
final class NoteFiles {
    static let shared = NoteFiles()
    static let markdown = UTType("net.daringfireball.markdown") ?? .plainText

    private var replies: [String: CheckedContinuation<[String: Any]?, Never>] = [:]

    /// The page's answer: { request, text, files: [{ path, data }] } or { request, error }.
    func reply(_ o: [String: Any]) {
        guard let id = o["request"] as? String, let cont = replies.removeValue(forKey: id) else { return }
        cont.resume(returning: o)
    }

    /// Asks the engine page for a note's Markdown and attachments.
    func ask(id: String, folder: String) async -> (text: String, files: [(String, Data)])? {
        guard let view = PagePool.shared.engine?.view else { return nil }
        let request = UUID().uuidString.lowercased()
        let answer: [String: Any]? = await withCheckedContinuation { cont in
            replies[request] = cont
            view.events.emit("FoleviDesktop", "noteFile", ["request": request, "token": "native", "id": id, "folder": folder])
            Task { @MainActor in
                try? await Task.sleep(for: .seconds(60))
                self.replies.removeValue(forKey: request)?.resume(returning: nil)
            }
        }
        guard let answer, let text = answer["text"] as? String else { return nil }
        let files = (answer["files"] as? [[String: Any]] ?? []).compactMap { f -> (String, Data)? in
            guard let path = f["path"] as? String, let b64 = f["data"] as? String, let data = Data(base64Encoded: b64) else { return nil }
            return (path, data)
        }
        return (text, files)
    }

    /// A file name from a note's title (no slashes or colons, not empty, not too long).
    nonisolated static func fileName(_ title: String, ext: String = "md") -> String {
        var base = title.replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ":", with: "-").trimmingCharacters(in: .whitespacesAndNewlines)
        if base.isEmpty || base.hasPrefix(".") { base = "Untitled" + base }
        base = String(base.prefix(120))
        return ext.isEmpty ? base : base + "." + ext
    }

    /// Writes the note into a fresh temporary folder (the file the drop copies), its attachments beside it.
    func file(id: String, title: String) async throws -> URL {
        let folder = Self.fileName(title, ext: "") + " files"
        guard let note = await ask(id: id, folder: folder) else { throw CocoaError(.fileWriteUnknown) }
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("folevi-drag-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent(Self.fileName(title))
        try Data(note.text.utf8).write(to: url, options: .atomic)
        for (path, data) in note.files.prefix(500) {
            let parts = path.split(separator: "/").map(String.init)
            guard !parts.isEmpty, parts.count <= 8, !path.hasPrefix("/"), !parts.contains(".."), !parts.contains(".") else { continue }
            let target = parts.reduce(dir) { $0.appendingPathComponent($1) }
            try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: target, options: .atomic)
        }
        return url
    }
}
