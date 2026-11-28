import Foundation

/// Writes blocks as clean Markdown. Inverse of `MarkdownParser` for the supported subset:
/// `parse(serialize(blocks)) == blocks` (see `MarkdownRoundTripTests`).
enum MarkdownSerializer {
    static let indentUnit = "    "

    static func serialize(_ blocks: [MDBlock]) -> String {
        blocks.map(line(for:)).joined(separator: "\n")
    }

    static func line(for block: MDBlock) -> String {
        switch block.kind {
        case .divider:
            return "---"
        case .heading(let level):
            return String(repeating: "#", count: max(1, min(level, 3))) + " " + inline(block.spans, lineStart: false)
        case .list(let marker):
            let indent = String(repeating: indentUnit, count: block.level)
            let prefix: String = switch marker {
            case .bullet: "- "
            case .number(let n, let d): "\(n)\(d) "
            case .checkbox(let checked): checked ? "- [x] " : "- [ ] "
            }
            return indent + prefix + inline(block.spans, lineStart: false)
        case .paragraph:
            return inline(block.spans, lineStart: true)
        }
    }

    // MARK: Inline

    private enum Piece {
        case text(String)           // already escaped
        case open(InlineStyle, Int) // style bit, pair id
        case close(InlineStyle, Int)
        case raw(String)            // code spans, links, images: atomic, treated as punctuation-bounded
    }

    /// Canonical nesting order (outermost first).
    private static let order: [InlineStyle] = [.bold, .italic, .strike, .underline]

    static func inline(_ spans: [MDSpan], lineStart: Bool) -> String {
        let spans = MDBlock.normalized(spans)
        var pieces: [Piece] = []
        var i = 0
        var isFirst = true
        while i < spans.count {
            if let link = spans[i].link {
                var j = i
                while j < spans.count, spans[j].link == link { j += 1 }
                let group = spans[i..<j].map { var s = $0; s.link = nil; return s }
                pieces.append(.raw(linkMarkdown(group, link: link)))
                i = j
            } else {
                var j = i
                while j < spans.count, spans[j].link == nil { j += 1 }
                pieces.append(contentsOf: styledPieces(Array(spans[i..<j]), lineStart: lineStart && isFirst))
                i = j
            }
            isFirst = false
        }
        return render(pieces)
    }

    private static func linkMarkdown(_ spans: [MDSpan], link: String) -> String {
        let text = spans.compactMap(\.text).joined()
        let plain = spans.allSatisfy { $0.style.isEmpty && $0.text != nil }
        let lower = link.lowercased()
        if plain, text == link, lower.hasPrefix("http://") || lower.hasPrefix("https://") || lower.hasPrefix("mailto:") {
            return "<\(link)>"
        }
        let inner = render(styledPieces(spans, lineStart: false))
        return "[\(inner)](\(escapeDestination(link)))"
    }

    private static func styledPieces(_ spans: [MDSpan], lineStart: Bool) -> [Piece] {
        var pieces: [Piece] = []
        var stack: [(InlineStyle, Int)] = []
        var nextPair = 0
        var pendingWS = ""
        var atStart = lineStart

        for span in spans {
            let content: String
            switch span.content {
            case .image(let id, let alt):
                content = ""
                closeAll(&stack, &pieces, &pendingWS)
                pieces.append(.raw("![\(escapeAlt(alt))](\(QuickNoteLink.attachmentURL(id)))"))
                atStart = false
                continue
            case .text(let t):
                content = t
            }
            let isCode = span.style.contains(.code)
            if !isCode, content.allSatisfy(\.isWhitespace) {
                pendingWS += content
                continue
            }
            let lead = isCode ? "" : String(content.prefix(while: \.isWhitespace))
            let trail = isCode ? "" : String(content.reversed().prefix(while: \.isWhitespace).reversed())
            let core = isCode ? content : String(content.dropFirst(lead.count).dropLast(trail.count))
            let target = order.filter { span.style.contains($0) }

            // Close everything above the first stack entry that the new run does not keep.
            if let k = stack.firstIndex(where: { !target.contains($0.0) }) {
                while stack.count > k {
                    let (s, id) = stack.removeLast()
                    pieces.append(.close(s, id))
                }
            }
            if !pendingWS.isEmpty || !lead.isEmpty {
                pieces.append(.text(pendingWS + lead)); pendingWS = ""
            }
            for s in target where !stack.contains(where: { $0.0 == s }) {
                stack.append((s, nextPair))
                pieces.append(.open(s, nextPair))
                nextPair += 1
            }
            if isCode {
                pieces.append(.raw(codeSpan(core)))
            } else {
                pieces.append(.text(escape(core, lineStart: atStart)))
            }
            atStart = false
            pendingWS = trail
        }
        closeAll(&stack, &pieces, &pendingWS)
        if !pendingWS.isEmpty { pieces.append(.text(pendingWS)) }
        return pieces
    }

    private static func closeAll(_ stack: inout [(InlineStyle, Int)], _ pieces: inout [Piece], _ pendingWS: inout String) {
        while let (s, id) = stack.popLast() { pieces.append(.close(s, id)) }
        if !pendingWS.isEmpty { pieces.append(.text(pendingWS)); pendingWS = "" }
    }

    private static func delimiter(_ s: InlineStyle) -> String? {
        switch s {
        case .bold: "**"
        case .italic: "*"
        case .strike: "~~"
        default: nil
        }
    }

    private static func tags(_ s: InlineStyle) -> (String, String) {
        switch s {
        case .bold: ("<b>", "</b>")
        case .italic: ("<i>", "</i>")
        case .strike: ("<s>", "</s>")
        default: ("<u>", "</u>")
        }
    }

    /// Renders pieces, choosing `**`-style delimiters where CommonMark's flanking rules allow and
    /// falling back to HTML tags (which our parser also reads) where they would not.
    private static func render(_ pieces: [Piece]) -> String {
        var useTags = Set<Int>()
        // Underline is always a tag.
        for p in pieces { if case .open(let s, let id) = p, s == .underline { useTags.insert(id) } }
        for _ in 0..<3 {
            var changed = false
            for (idx, p) in pieces.enumerated() {
                switch p {
                case .open(_, let id) where !useTags.contains(id):
                    let (prev, next) = neighbors(pieces, idx, useTags)
                    let left = !next.isWhitespace && (!isPunct(next) || prev.isWhitespace || isPunct(prev))
                    if !left { useTags.insert(id); changed = true }
                case .close(_, let id) where !useTags.contains(id):
                    let (prev, next) = neighbors(pieces, idx, useTags)
                    let right = !prev.isWhitespace && (!isPunct(prev) || next.isWhitespace || isPunct(next))
                    if !right { useTags.insert(id); changed = true }
                default: break
                }
            }
            if !changed { break }
        }
        var out = ""
        for p in pieces {
            switch p {
            case .text(let t), .raw(let t): out += t
            case .open(let s, let id): out += useTags.contains(id) ? tags(s).0 : (delimiter(s) ?? tags(s).0)
            case .close(let s, let id): out += useTags.contains(id) ? tags(s).1 : (delimiter(s) ?? tags(s).1)
            }
        }
        return out
    }

    /// Nearest real characters around the delimiter run that contains `idx` (a run is a cluster of
    /// adjacent delimiter pieces). Tags count as punctuation.
    private static func neighbors(_ pieces: [Piece], _ idx: Int, _ useTags: Set<Int>) -> (Character, Character) {
        func isDelimiter(_ p: Piece) -> Bool {
            switch p {
            case .open(let s, let id), .close(let s, let id): return !useTags.contains(id) && delimiter(s) != nil
            default: return false
            }
        }
        var a = idx
        while a - 1 >= 0, isDelimiter(pieces[a - 1]) { a -= 1 }
        var b = idx
        while b + 1 < pieces.count, isDelimiter(pieces[b + 1]) { b += 1 }
        var prev: Character = " "
        if a - 1 >= 0 {
            switch pieces[a - 1] {
            case .text(let t), .raw(let t): prev = t.last ?? " "
            default: prev = ">"
            }
        }
        var next: Character = " "
        if b + 1 < pieces.count {
            switch pieces[b + 1] {
            case .text(let t), .raw(let t): next = t.first ?? " "
            default: next = "<"
            }
        }
        return (prev, next)
    }

    private static func isPunct(_ c: Character) -> Bool { c.isPunctuation || c.isSymbol }

    private static func codeSpan(_ s: String) -> String {
        var longest = 0, run = 0
        for c in s { if c == "`" { run += 1; longest = max(longest, run) } else { run = 0 } }
        let fence = String(repeating: "`", count: longest + 1)
        let pad = s.hasPrefix("`") || s.hasSuffix("`") || (s.hasPrefix(" ") && s.hasSuffix(" ") && s.contains(where: { $0 != " " }))
        return fence + (pad ? " " : "") + s + (pad ? " " : "") + fence
    }

    static func escape(_ s: String, lineStart: Bool) -> String {
        var out = ""
        out.reserveCapacity(s.count + 8)
        let chars = Array(s)
        for (i, c) in chars.enumerated() {
            let prev: Character? = i > 0 ? chars[i - 1] : nil
            let next: Character? = i + 1 < chars.count ? chars[i + 1] : nil
            switch c {
            case "\\", "`", "*", "[", "]":
                out.append("\\"); out.append(c)
            case "_":
                if let p = prev, let n = next, p.isLetter || p.isNumber, n.isLetter || n.isNumber {
                    out.append(c)
                } else {
                    out.append("\\"); out.append(c)
                }
            case "~":
                if prev == "~" || next == "~" { out.append("\\") }
                out.append(c)
            case "<":
                if let n = next, n.isLetter || n == "/" { out.append("\\") }
                out.append(c)
            default:
                out.append(c)
            }
        }
        guard lineStart else { return out }
        // Block-level triggers at the start of a paragraph.
        let body = out.drop(while: { $0 == " " || $0 == "\t" })
        let indent = out.prefix(out.count - body.count)
        if let f = body.first {
            if f == "#" {
                let hashes = body.prefix(while: { $0 == "#" })
                let rest = body.dropFirst(hashes.count)
                if hashes.count <= 6, rest.isEmpty || rest.first == " " { return indent + "\\" + body }
            }
            if "-+•".contains(f), body.dropFirst().first == " " || body.dropFirst().isEmpty {
                return indent + "\\" + body
            }
            if f == "-" || f == "_", body.filter({ $0 != " " }).allSatisfy({ $0 == f }), body.count >= 3 {
                return indent + "\\" + body
            }
            if f.isASCII, f.isNumber {
                let digits = body.prefix(while: { $0.isASCII && $0.isNumber })
                let after = body.dropFirst(digits.count)
                if let d = after.first, d == "." || d == ")", after.dropFirst().first == " " {
                    return indent + digits + "\\" + after
                }
            }
        }
        return out
    }

    private static func escapeAlt(_ s: String) -> String {
        s.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "]", with: "\\]").replacingOccurrences(of: "[", with: "\\[")
    }

    private static func escapeDestination(_ s: String) -> String {
        var out = ""
        for c in s {
            switch c {
            case " ": out += "%20"
            case "(": out += "%28"
            case ")": out += "%29"
            case "<": out += "%3C"
            case ">": out += "%3E"
            default: out.append(c)
            }
        }
        return out
    }
}
