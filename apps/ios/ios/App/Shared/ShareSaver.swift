// Saving what was shared to Folevi from another app (the share extension's Save): straight to the Inbox
// through the REST API when it can, else kept in the App Group for the app (ShareQueue). Images and PDFs
// always go through the app, which uploads them with the web app's share flow. Whatever happens, the share
// is either on Folevi's servers or written to the queue before this returns.
import Foundation

/// What was shared, tidied the way the web app's share page tidies it (lib/share/payload.ts normaliseShare):
/// the link found once (in the link or the text), the title from the page or the first line.
struct ShareContent: Equatable {
    var title: String
    var text: String
    var url: String?

    static func tidy(title: String?, text: String?, url: String?) -> ShareContent {
        var title = (title ?? "").replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression).trimmingCharacters(in: .whitespacesAndNewlines)
        var text = (text ?? "").replacingOccurrences(of: "\r\n", with: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        var link = webLink(url)
        if link == nil, let found = text.range(of: #"https?://[^\s<>"'`]+"#, options: [.regularExpression, .caseInsensitive]) {
            link = webLink(String(text[found]))
        }
        if let link {
            for form in Set([link, link.hasSuffix("/") ? String(link.dropLast()) : link, (url ?? "").trimmingCharacters(in: .whitespaces)]) where !form.isEmpty {
                text = text.replacingOccurrences(of: form, with: "")
            }
            text = text.replacingOccurrences(of: #"[ \t]+\n"#, with: "\n", options: .regularExpression).replacingOccurrences(of: #"\n{3,}"#, with: "\n\n", options: .regularExpression).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        if text == title { text = "" }
        if let link, title == link || webLink(title) == link { title = "" }
        if title.isEmpty {
            if let first = text.split(separator: "\n").first { title = String(first.prefix(120)).trimmingCharacters(in: .whitespaces) } else if let link { title = linkName(link) }
        }
        return ShareContent(title: String(title.prefix(200)), text: String(text.prefix(20_000)), url: link)
    }

    /// The note's Markdown: the link, then the text.
    var markdown: String {
        [url.map { "<\($0)>" }, text.isEmpty ? nil : Self.paragraphs(text)].compactMap { $0 }.joined(separator: "\n\n")
    }

    /// Text as Markdown with a paragraph per line, the way the web app's share flow makes a note of it
    /// (lib/share/payload.ts shareBlocks): Markdown would run single lines together.
    static func paragraphs(_ text: String) -> String {
        text.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.joined(separator: "\n\n")
    }

    /// An http(s) address, trailing punctuation from prose dropped; nil for anything else.
    static func webLink(_ raw: String?) -> String? {
        let value = (raw ?? "").trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: #"[).,;:!?\]]+$"#, with: "", options: .regularExpression)
        guard !value.isEmpty, value.count <= 2048, let u = URL(string: value), let scheme = u.scheme?.lowercased(), scheme == "http" || scheme == "https", u.host != nil else { return nil }
        return u.absoluteString
    }

    /// "example.com/path": a link's host without www, and its path.
    static func linkName(_ link: String) -> String {
        guard let u = URL(string: link), let host = u.host else { return String(link.prefix(120)) }
        let path = u.path.hasSuffix("/") ? String(u.path.dropLast()) : u.path
        return String((host.replacingOccurrences(of: #"^www\."#, with: "", options: .regularExpression) + path).prefix(120))
    }
}

struct ShareSaver {
    enum Outcome: Equatable {
        /// In the Inbox now.
        case sent(noteId: String)
        /// Kept for the app; it reaches the Inbox when Folevi next opens.
        case queued
    }

    var queue: ShareQueue = .shared
    var api: FoleviAPI? = SharedAccount.api()
    var accountId: String? = SharedAccount.accountId

    /// Saves the share in `place` ("personal" or a workspace's id).
    func save(_ content: ShareContent, place: String?, files: [(name: String, type: String, data: Data)]) async throws -> Outcome {
        if files.isEmpty, let api {
            do {
                let note = try await api.createNote(title: content.title.isEmpty ? "Untitled" : content.title, markdown: content.markdown, place: place)
                return .sent(noteId: note.id)
            } catch {
                // Offline, signed out, rate limited, or the place went (a workspace left since): kept for
                // the app, which saves it through the web app (to Personal's Inbox if the place is gone).
            }
        }
        try queue.add(title: content.title, text: content.text, url: content.url ?? "", place: place, accountId: accountId, files: files)
        return .queued
    }
}
