import Foundation

/// A list marker at the start of a paragraph in rich text.
enum ListMarker: Equatable, Sendable {
    case bullet(Character)
    case number(Int, delimiter: Character)
    case checkbox(checked: Bool)

    var isCheckbox: Bool { if case .checkbox = self { true } else { false } }
}

struct ListPrefix: Equatable, Sendable {
    var marker: ListMarker
    /// Length of the marker including its trailing space, in UTF-16 units.
    var length: Int
}

/// The smart-bullet state machine. Pure functions over paragraph text so they can be unit-tested
/// without a text view; `QuickNoteTextView` applies the results as undoable edits.
enum SmartBullets {
    /// Glyphs recognized as bullets when reading text (includes every Settings choice).
    static let bulletGlyphs: Set<Character> = ["•", "◦", "▪", "‣", "–", "→", "○", "■", "✱"]
    /// Glyphs offered in Settings ▸ Editor.
    static let glyphChoices: [String] = ["•", "◦", "▪", "–", "‣", "→"]
    static let maxLevel = 8

    // MARK: Rich text

    /// Detects a list marker at the start of `paragraph`. `checkbox` is the state of a checkbox
    /// attachment when the paragraph's first character is one (the attachment is `\u{FFFC}`).
    static func detect(paragraph: String, checkbox: Bool?) -> ListPrefix? {
        guard let first = paragraph.first else { return nil }
        let chars = Array(paragraph.prefix(12))
        if let checked = checkbox, first == AttachmentChar.character {
            return ListPrefix(marker: .checkbox(checked: checked), length: chars.count > 1 && chars[1] == " " ? 2 : 1)
        }
        if bulletGlyphs.contains(first), chars.count > 1, chars[1] == " " {
            return ListPrefix(marker: .bullet(first), length: first.utf16.count + 1)
        }
        if first.isASCII, first.isNumber {
            var digits = ""
            var i = 0
            while i < chars.count, chars[i].isASCII, chars[i].isNumber, digits.count < 9 { digits.append(chars[i]); i += 1 }
            if i + 1 < chars.count, chars[i] == "." || chars[i] == ")", chars[i + 1] == " ", let n = Int(digits) {
                return ListPrefix(marker: .number(n, delimiter: chars[i]), length: digits.count + 2)
            }
        }
        return nil
    }

    /// When the user types a space, decides whether the text from paragraph start to the caret
    /// (including that space) should become a list marker.
    static func trigger(typedPrefix: String) -> ListMarker? {
        switch typedPrefix {
        case "- ", "* ", "+ ", "• ": return .bullet("•")
        case "[ ] ", "[] ", "- [ ] ", "* [ ] ": return .checkbox(checked: false)
        case "[x] ", "[X] ", "- [x] ", "- [X] ": return .checkbox(checked: true)
        default: break
        }
        // "1. " / "1) ", any number starts a numbered list.
        let body = typedPrefix.dropLast()
        guard typedPrefix.hasSuffix(" "), let delim = body.last, delim == "." || delim == ")" else { return nil }
        let digits = body.dropLast()
        guard !digits.isEmpty, digits.count <= 9, digits.allSatisfy({ $0.isASCII && $0.isNumber }), let n = Int(digits) else { return nil }
        return .number(n, delimiter: delim)
    }

    /// The marker that a Return inside a list item inserts on the new line.
    static func continuation(after marker: ListMarker) -> ListMarker {
        switch marker {
        case .bullet(let g): .bullet(g)
        case .number(let n, let d): .number(n + 1, delimiter: d)
        case .checkbox: .checkbox(checked: false)
        }
    }

    /// Text for bullet and number markers (checkboxes are attachments).
    static func markerText(_ marker: ListMarker, glyph: String) -> String {
        switch marker {
        case .bullet: "\(glyph) "
        case .number(let n, let d): "\(n)\(d) "
        case .checkbox: AttachmentChar.string + " "
        }
    }

    enum ReturnAction: Equatable {
        /// Not a list item: insert a normal newline.
        case plainNewline
        /// Insert a newline followed by this marker.
        case continueList(ListMarker)
        /// The item is empty: remove its marker (ends the list).
        case endList
        /// The item is empty and nested: move it one level out.
        case outdent
    }

    static func returnAction(prefix: ListPrefix?, paragraph: String, level: Int) -> ReturnAction {
        guard let prefix else { return .plainNewline }
        let ns = paragraph as NSString
        let content = ns.substring(from: min(prefix.length, ns.length))
        let isEmpty = content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        if isEmpty { return level > 0 ? .outdent : .endList }
        return .continueList(continuation(after: prefix.marker))
    }

    // MARK: Plain (Markdown source) mode

    struct PlainPrefix: Equatable {
        var indent: String
        var marker: String      // "- ", "* ", "12. ", "- [ ] "
        var number: Int?
        var isTask: Bool
        var totalLength: Int { indent.utf16.count + marker.utf16.count }
    }

    static func plainPrefix(line: String) -> PlainPrefix? {
        let indent = String(line.prefix(while: { $0 == " " || $0 == "\t" }))
        let rest = line.dropFirst(indent.count)
        for bullet in ["- ", "* ", "+ "] where rest.hasPrefix(bullet) {
            let afterBullet = rest.dropFirst(2)
            for task in ["[ ] ", "[x] ", "[X] "] where afterBullet.hasPrefix(task) {
                return PlainPrefix(indent: indent, marker: bullet + task, number: nil, isTask: true)
            }
            return PlainPrefix(indent: indent, marker: bullet, number: nil, isTask: false)
        }
        let digits = rest.prefix(while: { $0.isASCII && $0.isNumber })
        if !digits.isEmpty, digits.count <= 9 {
            let after = rest.dropFirst(digits.count)
            if after.hasPrefix(". ") || after.hasPrefix(") ") {
                return PlainPrefix(indent: indent, marker: String(digits) + String(after.prefix(2)), number: Int(digits), isTask: false)
            }
        }
        return nil
    }

    /// Prefix for the next line after Return in plain mode, or `nil` for "end the list".
    static func plainContinuation(of prefix: PlainPrefix) -> String {
        if let n = prefix.number {
            let delim = prefix.marker.last(where: { $0 == "." || $0 == ")" }) ?? "."
            return prefix.indent + "\(n + 1)\(delim) "
        }
        if prefix.isTask { return prefix.indent + String(prefix.marker.prefix(2)) + "[ ] " }
        return prefix.indent + prefix.marker
    }

    static func plainIsEmptyItem(line: String, prefix: PlainPrefix) -> Bool {
        line.dropFirst(prefix.indent.count + prefix.marker.count).trimmingCharacters(in: .whitespaces).isEmpty
    }
}
