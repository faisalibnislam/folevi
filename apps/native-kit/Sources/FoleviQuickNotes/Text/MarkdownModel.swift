import Foundation

/// Inline formatting flags shared by the Markdown parser, serializer and the attributed-string
/// bridge. Code is exclusive of the others in Markdown, but can sit inside bold/italic.
struct InlineStyle: OptionSet, Hashable, Sendable {
    let rawValue: Int
    static let bold = InlineStyle(rawValue: 1 << 0)
    static let italic = InlineStyle(rawValue: 1 << 1)
    static let strike = InlineStyle(rawValue: 1 << 2)
    static let underline = InlineStyle(rawValue: 1 << 3)
    static let code = InlineStyle(rawValue: 1 << 4)
}

/// A run of inline content.
struct MDSpan: Equatable, Sendable {
    enum Content: Equatable, Sendable {
        case text(String)
        /// An image stored as a Notlet attachment (`notlet-attachment:<uuid>`).
        case image(id: UUID, alt: String)
    }
    var content: Content
    var style: InlineStyle = []
    var link: String?

    static func text(_ s: String, _ style: InlineStyle = [], link: String? = nil) -> MDSpan {
        MDSpan(content: .text(s), style: style, link: link)
    }

    var text: String? { if case .text(let s) = content { s } else { nil } }
}

/// One line/paragraph of a note.
struct MDBlock: Equatable, Sendable {
    enum Kind: Equatable, Sendable {
        case paragraph
        case heading(Int)
        case divider(DividerStyle)
        case list(ListMarker)
    }
    var kind: Kind
    var level: Int = 0
    var spans: [MDSpan] = []

    /// Merges adjacent spans with identical formatting and drops empty text spans.
    static func normalized(_ spans: [MDSpan]) -> [MDSpan] {
        var out: [MDSpan] = []
        for span in spans {
            if case .text(let t) = span.content, t.isEmpty { continue }
            if let last = out.last, case .text(let a) = last.content, case .text(let b) = span.content,
               last.style == span.style, last.link == span.link {
                out[out.count - 1].content = .text(a + b)
            } else {
                out.append(span)
            }
        }
        return out
    }

    var plainText: String {
        spans.map { span in
            switch span.content {
            case .text(let t): t
            case .image: "\u{FFFC}"
            }
        }.joined()
    }
}

enum QuickNoteLink {
    static let attachment = "folevi-quicknote-image"
    static let divider = "folevi-quicknote-divider"

    static func attachmentURL(_ id: UUID) -> String { "\(attachment):\(id.uuidString)" }
    static func attachmentID(from link: String) -> UUID? {
        guard link.hasPrefix(attachment + ":") else { return nil }
        return UUID(uuidString: String(link.dropFirst(attachment.count + 1)))
    }
}
