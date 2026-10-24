// Foli AI's Markdown for answers that stream (plan 5.9; web AiMarkdown.tsx): headings, paragraphs, bullet,
// numbered and task lists, quotes, fenced code, tables and rules, with inline bold, italic, code, links and
// numbered citations ("[1]") turned into tappable markers.
//
// Streaming without re-laying out the whole answer per word: `IncrementalMarkdown` keeps the blocks before the
// last blank line outside a code fence as settled (parsed once, never touched again) and re-parses only the
// tail after it. Block ids are their positions, and `MDBlock` compares by its source, so SwiftUI redraws only
// the block that's still growing.
import Foundation

/// One block of an answer.
public struct MDBlock: Identifiable, Equatable, Sendable {
    public enum Kind: Equatable, Sendable {
        case paragraph
        case heading(level: Int)
        /// A list item: its marker ("•", "1.", or nil for a task), nesting level and, for a task, whether done.
        case listItem(marker: String?, level: Int, task: Bool?)
        case quote
        case code(language: String?, closed: Bool)
        case table(header: [String], rows: [[String]])
        case rule
    }

    public var id: Int
    public var kind: Kind
    /// The block's Markdown (without list markers, quote marks or fences): what's compared.
    public var source: String

    public static func == (a: MDBlock, b: MDBlock) -> Bool { a.id == b.id && a.kind == b.kind && a.source == b.source }
}

/// Parses Markdown into blocks, line by line (enough of CommonMark for what the model writes).
public enum MarkdownBlocks {
    public static func parse(_ text: Substring, firstId: Int = 0) -> [MDBlock] {
        var out: [MDBlock] = []
        var paragraph: [Substring] = []
        var quote: [Substring] = []
        var id = firstId
        func add(_ kind: MDBlock.Kind, _ source: String) {
            out.append(MDBlock(id: id, kind: kind, source: source))
            id += 1
        }
        func flushParagraph() {
            guard !paragraph.isEmpty else { return }
            add(.paragraph, paragraph.map { $0.trimmingCharacters(in: .whitespaces) }.joined(separator: "\n"))
            paragraph.removeAll()
        }
        func flushQuote() {
            guard !quote.isEmpty else { return }
            add(.quote, quote.joined(separator: "\n"))
            quote.removeAll()
        }
        let lines = text.split(separator: "\n", omittingEmptySubsequences: false)
        var i = 0
        while i < lines.count {
            let line = lines[i]
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            // Fenced code: everything up to the closing fence (or the end, while it streams).
            if trimmed.hasPrefix("```") || trimmed.hasPrefix("~~~") {
                flushParagraph(); flushQuote()
                let fence = String(trimmed.prefix(3))
                let lang = trimmed.dropFirst(3).trimmingCharacters(in: .whitespaces)
                var body: [Substring] = []
                var closed = false
                i += 1
                while i < lines.count {
                    if lines[i].trimmingCharacters(in: .whitespaces).hasPrefix(fence) { closed = true; break }
                    body.append(lines[i])
                    i += 1
                }
                add(.code(language: lang.isEmpty ? nil : lang, closed: closed), body.joined(separator: "\n"))
                i += 1
                continue
            }
            if trimmed.isEmpty {
                flushParagraph(); flushQuote()
                i += 1
                continue
            }
            if trimmed.hasPrefix(">") {
                flushParagraph()
                quote.append(trimmed.dropFirst().drop(while: { $0 == " " }))
                i += 1
                continue
            }
            flushQuote()
            if let level = headingLevel(trimmed) {
                flushParagraph()
                add(.heading(level: level), String(trimmed.dropFirst(level).trimmingCharacters(in: .whitespaces)).trimmingCharacters(in: CharacterSet(charactersIn: "#").union(.whitespaces)))
                i += 1
                continue
            }
            if paragraph.isEmpty, isRule(trimmed) {
                add(.rule, "")
                i += 1
                continue
            }
            // A table: a row of cells followed by the |---| line.
            if trimmed.contains("|"), i + 1 < lines.count, isTableSeparator(lines[i + 1]) {
                flushParagraph()
                let header = cells(trimmed)
                var rows: [[String]] = []
                i += 2
                while i < lines.count {
                    let row = lines[i].trimmingCharacters(in: .whitespaces)
                    guard !row.isEmpty, row.contains("|") else { break }
                    var c = cells(row)
                    if c.count < header.count { c += Array(repeating: "", count: header.count - c.count) }
                    rows.append(Array(c.prefix(header.count)))
                    i += 1
                }
                add(.table(header: header, rows: rows), lines[(i - rows.count - 2)..<i].joined(separator: "\n"))
                continue
            }
            if let item = listItem(line) {
                flushParagraph()
                var body = item.text
                // Indented lines that follow belong to the item.
                while i + 1 < lines.count, lines[i + 1].hasPrefix("  "), listItem(lines[i + 1]) == nil, !lines[i + 1].trimmingCharacters(in: .whitespaces).isEmpty {
                    i += 1
                    body += "\n" + lines[i].trimmingCharacters(in: .whitespaces)
                }
                add(.listItem(marker: item.marker, level: item.level, task: item.task), body)
                i += 1
                continue
            }
            paragraph.append(line)
            i += 1
        }
        flushParagraph(); flushQuote()
        return out
    }

    static func headingLevel(_ s: String) -> Int? {
        var n = 0
        for ch in s { if ch == "#" { n += 1 } else { break } }
        guard (1...6).contains(n), s.count == n || s[s.index(s.startIndex, offsetBy: n)] == " " else { return nil }
        return n
    }

    static func isRule(_ s: String) -> Bool {
        let chars = s.filter { $0 != " " }
        guard chars.count >= 3, let first = chars.first, "-*_".contains(first) else { return false }
        return chars.allSatisfy { $0 == first }
    }

    static func isTableSeparator(_ line: Substring) -> Bool {
        let s = line.trimmingCharacters(in: .whitespaces)
        guard s.contains("-"), s.contains("|") || s.hasPrefix("-") else { return false }
        return s.allSatisfy { "|-: ".contains($0) }
    }

    static func cells(_ row: String) -> [String] {
        var s = Substring(row)
        if s.hasPrefix("|") { s = s.dropFirst() }
        if s.hasSuffix("|") { s = s.dropLast() }
        return s.split(separator: "|", omittingEmptySubsequences: false).map { $0.trimmingCharacters(in: .whitespaces) }
    }

    struct Item { var marker: String?; var level: Int; var task: Bool?; var text: String }

    static func listItem(_ line: Substring) -> Item? {
        let indent = line.prefix(while: { $0 == " " || $0 == "\t" }).reduce(0) { $0 + ($1 == "\t" ? 4 : 1) }
        let rest = line.drop(while: { $0 == " " || $0 == "\t" })
        var marker: String?
        var body: Substring
        if let f = rest.first, "-*+".contains(f), rest.dropFirst().first == " " {
            marker = "•"
            body = rest.dropFirst(2)
        } else {
            let digits = rest.prefix(while: \.isNumber)
            guard !digits.isEmpty, digits.count <= 4 else { return nil }
            let after = rest.dropFirst(digits.count)
            guard let p = after.first, p == "." || p == ")", after.dropFirst().first == " " else { return nil }
            marker = "\(digits)."
            body = after.dropFirst(2)
        }
        var task: Bool?
        if marker == "•", body.hasPrefix("[ ] ") || body.hasPrefix("[x] ") || body.hasPrefix("[X] ") {
            task = body.hasPrefix("[ ]") ? false : true
            body = body.dropFirst(4)
            marker = nil
        }
        return Item(marker: marker, level: min(indent / 2, 4), task: task, text: String(body))
    }
}

/// Keeps an answer's blocks up to date as its text grows, re-parsing only the unsettled tail.
public struct IncrementalMarkdown: Sendable {
    public private(set) var blocks: [MDBlock] = []
    /// The settled part of the text (it ends after a blank line outside a code fence).
    private var settledText = ""
    private var settledBlocks: [MDBlock] = []
    /// How many characters of the settled text were parsed (for tests and the performance numbers).
    public private(set) var parsedCharacters = 0

    public init() {}

    public mutating func update(_ text: String) {
        // UTF-8 offsets: O(1) to step to in a native string, so a long answer costs only its tail per update.
        if settledText.utf8.count > text.utf8.count || !text.utf8.starts(with: settledText.utf8) {
            settledText = ""
            settledBlocks = []
        }
        let tailStart = text.utf8.index(text.startIndex, offsetBy: settledText.utf8.count)
        let tail = text[tailStart...]
        if let boundary = Self.lastSettledBoundary(tail) {
            let settling = tail[..<boundary]
            settledBlocks += MarkdownBlocks.parse(settling, firstId: settledBlocks.count)
            parsedCharacters += settling.utf8.count
            settledText = String(text[..<boundary])
        }
        let rest = text[text.utf8.index(text.startIndex, offsetBy: settledText.utf8.count)...]
        parsedCharacters += rest.utf8.count
        blocks = settledBlocks + MarkdownBlocks.parse(rest, firstId: settledBlocks.count)
    }

    /// The end of the last blank line in `text` that's outside a code fence (the text before it is settled).
    static func lastSettledBoundary(_ text: Substring) -> Substring.Index? {
        var inFence = false
        var lastBoundary: Substring.Index?
        var lineStart = text.startIndex
        var previousBlank = false
        while lineStart < text.endIndex {
            guard let nl = text[lineStart...].firstIndex(of: "\n") else { break }
            let line = text[lineStart..<nl]
            let t = line.trimmingCharacters(in: .whitespaces)
            if t.hasPrefix("```") || t.hasPrefix("~~~") { inFence.toggle() }
            let blank = t.isEmpty
            let next = text.index(after: nl)
            if blank, !inFence, !previousBlank { lastBoundary = next }
            previousBlank = blank
            lineStart = next
        }
        return lastBoundary
    }
}

/// An answer's Markdown as plain text (Copy, Share): no marks, no citation numbers.
public enum MarkdownPlain {
    public static func plain(_ markdown: String) -> String {
        var lines: [String] = []
        var inFence = false
        for raw in markdown.split(separator: "\n", omittingEmptySubsequences: false) {
            var line = String(raw)
            let t = line.trimmingCharacters(in: .whitespaces)
            if t.hasPrefix("```") { inFence.toggle(); continue }
            if inFence { lines.append(line); continue }
            if MarkdownBlocks.isTableSeparator(raw) { continue }
            if let level = MarkdownBlocks.headingLevel(t) { line = String(t.dropFirst(level)).trimmingCharacters(in: .whitespaces) }
            if t.hasPrefix(">") { line = String(t.dropFirst()).trimmingCharacters(in: .whitespaces) }
            if t.contains("|"), t.hasPrefix("|") { line = MarkdownBlocks.cells(t).joined(separator: "\t") }
            if let item = MarkdownBlocks.listItem(raw) { line = String(repeating: "  ", count: item.level) + (item.task.map { $0 ? "[x] " : "[ ] " } ?? (item.marker == "•" ? "- " : "\(item.marker ?? "") ")) + item.text }
            lines.append(stripInline(line))
        }
        return lines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func stripInline(_ s: String) -> String {
        var out = s
        // [text](url) becomes text; citation markers go.
        out = out.replacingOccurrences(of: #"\[([^\]]+)\]\([^)]*\)"#, with: "$1", options: .regularExpression)
        out = out.replacingOccurrences(of: #"\s?\[\d{1,3}\](?!\()"#, with: "", options: .regularExpression)
        for mark in ["**", "__", "~~", "`"] { out = out.replacingOccurrences(of: mark, with: "") }
        out = out.replacingOccurrences(of: #"(?<![\w*])\*(?!\s)([^*]+)(?<!\s)\*(?!\w)"#, with: "$1", options: .regularExpression)
        return out
    }
}
