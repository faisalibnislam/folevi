// A dot as a Folevi note: its first line the title (Markdown marks taken off), the rest the body, and its images
// renamed to refs the page uploads (`quick-note-image-1`). Pure, so the tests read it directly.
import Foundation

enum QuickNoteExport {
    /// A first line longer than this is a paragraph, not a title (as Services' "New note with text" decides).
    static let titleLimit = 120

    struct Split: Equatable {
        var title: String
        var body: String
    }

    /// The title and body of `markdown`. An image-only or empty first line gives no title ("Untitled").
    static func split(_ markdown: String) -> Split {
        let text = markdown.replacingOccurrences(of: "\r\n", with: "\n")
        var lines = text.components(separatedBy: "\n")
        while let first = lines.first, first.trimmingCharacters(in: .whitespaces).isEmpty { lines.removeFirst() }
        guard let first = lines.first else { return Split(title: "", body: "") }
        let title = plainTitle(first)
        if title.isEmpty || title.count > titleLimit { return Split(title: "", body: lines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)) }
        lines.removeFirst()
        return Split(title: title, body: lines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines))
    }

    /// A Markdown line as plain title text: no heading, list, checkbox or quote mark, no emphasis or code marks,
    /// links as their text, images left out.
    static func plainTitle(_ line: String) -> String {
        var s = line.trimmingCharacters(in: .whitespaces)
        if s.range(of: #"^!\[[^\]]*\]\([^)]*\)$"#, options: .regularExpression) != nil { return "" }
        for pattern in [#"^#{1,6}\s+"#, #"^>\s*"#, #"^[-*+]\s+\[[ xX]\]\s+"#, #"^[-*+]\s+"#, #"^\d+[.)]\s+"#, #"^[☐☑]\s*"#] {
            if let r = s.range(of: pattern, options: .regularExpression) { s.removeSubrange(r); break }
        }
        s = s.replacingOccurrences(of: #"!\[[^\]]*\]\([^)]*\)"#, with: "", options: .regularExpression)
        s = s.replacingOccurrences(of: #"\[([^\]]*)\]\([^)]*\)"#, with: "$1", options: .regularExpression)
        s = s.replacingOccurrences(of: #"(\*\*|__|~~|\*|_|`)"#, with: "", options: .regularExpression)
        s = s.replacingOccurrences(of: #"\\([\\`*_\[\]#+\-.!~>])"#, with: "$1", options: .regularExpression)
        return s.trimmingCharacters(in: .whitespaces)
    }

    /// The body with each quick note image link (`folevi-quicknote-image:<id>`) renamed `quick-note-image-<n>`, and the
    /// ids in that order (each once).
    static func renameImages(_ markdown: String) -> (markdown: String, ids: [(ref: String, id: UUID)]) {
        var out = markdown
        var ids: [(String, UUID)] = []
        for id in NoteStore.attachmentIDs(inMarkdown: markdown) where !ids.contains(where: { $0.1 == id }) {
            let ref = "quick-note-image-\(ids.count + 1)"
            out = out.replacingOccurrences(of: QuickNoteLink.attachmentURL(id), with: ref)
            ids.append((ref, id))
        }
        return (out, ids)
    }
}
