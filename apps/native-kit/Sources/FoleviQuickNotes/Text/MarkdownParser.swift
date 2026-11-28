import Foundation

/// Parses the Markdown subset Notlet supports into line-oriented blocks.
///
/// Notes are line-based, so every source line becomes exactly one block (blank lines included);
/// this is what makes Markdown ⇄ rich text round-trips exact. Supported: `#`–`###` headings,
/// `-`/`*`/`+` bullets, `1.` numbers, `- [ ]` tasks (nesting by indentation), `---` dividers,
/// `**bold**`, `*italic*`, `~~strike~~`, `<u>underline</u>`, `` `code` ``, `[links](url)`,
/// autolinks and bare URLs, images stored as Notlet attachments, and backslash escapes.
/// Inline emphasis follows CommonMark's delimiter-run rules.
enum MarkdownParser {
    static func parse(_ markdown: String) -> [MDBlock] {
        let normalized = markdown.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        let lines = normalized.components(separatedBy: "\n")
        let unit = indentUnit(lines)
        var blocks: [MDBlock] = []
        blocks.reserveCapacity(lines.count)
        var inFence = false
        for line in lines {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("```") || trimmed.hasPrefix("~~~") {
                inFence.toggle()
                continue
            }
            if inFence {
                blocks.append(MDBlock(kind: .paragraph, spans: line.isEmpty ? [] : [.text(line, .code)]))
                continue
            }
            blocks.append(parseLine(line, indentUnit: unit))
        }
        return blocks
    }

    /// The indentation step used by nested list items in this document (2, 3 or 4 columns).
    static func indentUnit(_ lines: [String]) -> Int {
        var smallest = Int.max
        for line in lines {
            let width = indentWidth(line)
            guard width > 0, width < smallest else { continue }
            if SmartBullets.plainPrefix(line: line) != nil { smallest = width }
        }
        return (2...4).contains(smallest) ? smallest : 4
    }

    private static func indentWidth(_ line: String) -> Int {
        var w = 0
        for c in line {
            if c == " " { w += 1 } else if c == "\t" { w += 4 } else { break }
        }
        return w
    }

    static func parseLine(_ line: String, indentUnit: Int = 4) -> MDBlock {
        let width = indentWidth(line)
        let body = line.drop(while: { $0 == " " || $0 == "\t" })
        let level = min(SmartBullets.maxLevel, (width + indentUnit / 2) / max(indentUnit, 1))

        // Divider: three or more of the same -, * or _ (spaces allowed), nothing else.
        if width <= 3, isDivider(body) {
            return MDBlock(kind: .divider(.thin))
        }
        // Heading.
        if width <= 3, body.hasPrefix("#") {
            let hashes = body.prefix(while: { $0 == "#" }).count
            let rest = body.dropFirst(hashes)
            if hashes <= 6, rest.isEmpty || rest.hasPrefix(" ") {
                var content = String(rest.drop(while: { $0 == " " }))
                // Optional closing sequence.
                if let range = content.range(of: #"\s+#+\s*$"#, options: .regularExpression) { content.removeSubrange(range) }
                return MDBlock(kind: .heading(min(hashes, 3)), spans: parseInline(content))
            }
        }
        // Lists.
        if let first = body.first, "-*+•".contains(first), body.dropFirst().first == " " {
            let afterBullet = body.dropFirst(2)
            if afterBullet.count >= 3, afterBullet.first == "[",
               let mark = afterBullet.dropFirst().first, " xX".contains(mark),
               afterBullet.dropFirst(2).first == "]" {
                let tail = afterBullet.dropFirst(3)
                if tail.isEmpty || tail.first == " " {
                    let content = String(tail.dropFirst())
                    return MDBlock(kind: .list(.checkbox(checked: mark != " ")), level: level, spans: parseInline(content))
                }
            }
            return MDBlock(kind: .list(.bullet("•")), level: level, spans: parseInline(String(afterBullet)))
        }
        if let first = body.first, first.isASCII, first.isNumber {
            let digits = body.prefix(while: { $0.isASCII && $0.isNumber })
            let after = body.dropFirst(digits.count)
            if digits.count <= 9, let delim = after.first, delim == "." || delim == ")", after.dropFirst().first == " ",
               let n = Int(digits) {
                return MDBlock(kind: .list(.number(n, delimiter: delim)), level: level, spans: parseInline(String(after.dropFirst(2))))
            }
        }
        return MDBlock(kind: .paragraph, spans: parseInline(line))
    }

    private static func isDivider(_ body: Substring) -> Bool {
        let chars = body.filter { $0 != " " && $0 != "\t" }
        guard chars.count >= 3, let c = chars.first, "-*_".contains(c) else { return false }
        return chars.allSatisfy { $0 == c }
    }

    static func parseInline(_ text: String) -> [MDSpan] {
        guard !text.isEmpty else { return [] }
        var parser = InlineParser(chars: Array(text))
        let nodes = parser.parse(0..<parser.chars.count)
        var spans: [MDSpan] = []
        for node in nodes {
            if let image = node.image {
                spans.append(MDSpan(content: .image(id: image.id, alt: image.alt), style: node.style, link: nil))
            } else if !node.text.isEmpty {
                spans.append(.text(node.text, node.style, link: node.link))
            }
        }
        return linkify(MDBlock.normalized(spans))
    }

    /// Built once: the parser runs per line, and creating a data detector is far costlier than matching.
    private static let linkDetector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)

    /// Adds links to bare URLs in unlinked, non-code text.
    static func linkify(_ spans: [MDSpan]) -> [MDSpan] {
        guard let detector = linkDetector else { return spans }
        var out: [MDSpan] = []
        for span in spans {
            guard span.link == nil, !span.style.contains(.code), let text = span.text,
                  text.contains(".") || text.contains(":") else { out.append(span); continue }
            let ns = text as NSString
            var cursor = 0
            for match in detector.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
                guard let url = match.url, ["http", "https", "mailto"].contains(url.scheme?.lowercased() ?? "") else { continue }
                let matched = ns.substring(with: match.range)
                // Only literal URLs (not "example.com" guesses) to keep round-trips exact.
                guard matched.lowercased().hasPrefix("http://") || matched.lowercased().hasPrefix("https://") || matched.lowercased().hasPrefix("mailto:") else { continue }
                if match.range.location > cursor {
                    out.append(.text(ns.substring(with: NSRange(location: cursor, length: match.range.location - cursor)), span.style))
                }
                out.append(.text(matched, span.style, link: matched))
                cursor = match.range.location + match.range.length
            }
            if cursor == 0 { out.append(span); continue }
            if cursor < ns.length { out.append(.text(ns.substring(from: cursor), span.style)) }
        }
        return MDBlock.normalized(out)
    }
}

// MARK: - Inline parser (CommonMark delimiter algorithm, simplified)

private struct InlineNode {
    var text: String
    var style: InlineStyle = []
    var link: String?
    var image: (id: UUID, alt: String)?
    var delimiter: Int?
}

private struct Delimiter {
    var char: Character
    var count: Int
    var origCount: Int
    var canOpen: Bool
    var canClose: Bool
    var node: Int
    var active = true
}

private struct InlineParser {
    let chars: [Character]

    init(chars: [Character]) { self.chars = chars }

    private static let tagStyles: [(String, InlineStyle)] = [
        ("u", .underline), ("b", .bold), ("strong", .bold), ("i", .italic), ("em", .italic),
        ("s", .strike), ("del", .strike), ("strike", .strike), ("code", .code),
    ]

    func isWS(_ c: Character) -> Bool { c.isWhitespace }
    func isPunct(_ c: Character) -> Bool { c.isPunctuation || c.isSymbol }

    mutating func parse(_ range: Range<Int>) -> [InlineNode] {
        var nodes: [InlineNode] = []
        var delims: [Delimiter] = []
        var buffer = ""
        func flush() {
            if !buffer.isEmpty { nodes.append(InlineNode(text: buffer)); buffer = "" }
        }
        var i = range.lowerBound
        let end = range.upperBound
        while i < end {
            let c = chars[i]
            switch c {
            case "\\":
                if i + 1 < end, chars[i + 1].isASCII, isPunct(chars[i + 1]) {
                    buffer.append(chars[i + 1]); i += 2
                } else {
                    buffer.append(c); i += 1
                }
            case "`":
                let n = runLength(at: i, of: "`", end: end)
                if let close = findBacktickRun(length: n, from: i + n, end: end) {
                    flush()
                    var content = String(chars[(i + n)..<close])
                    if content.count >= 2, content.first == " ", content.last == " ", content.contains(where: { $0 != " " }) {
                        content = String(content.dropFirst().dropLast())
                    }
                    nodes.append(InlineNode(text: content, style: .code))
                    i = close + n
                } else {
                    buffer.append(String(repeating: "`", count: n)); i += n
                }
            case "<":
                if let (inner, style, next) = matchTag(at: i, end: end) {
                    flush()
                    var sub = InlineParser(chars: chars)
                    for var node in sub.parse(inner) { node.style.insert(style); nodes.append(node) }
                    i = next
                } else if let (url, next) = matchAutolink(at: i, end: end) {
                    flush()
                    nodes.append(InlineNode(text: url, link: url))
                    i = next
                } else {
                    buffer.append(c); i += 1
                }
            case "!":
                if i + 1 < end, chars[i + 1] == "[", let (textRange, dest, next) = matchLink(at: i + 1, end: end),
                   let id = QuickNoteLink.attachmentID(from: dest) {
                    flush()
                    nodes.append(InlineNode(text: "", image: (id, String(chars[textRange]))))
                    i = next
                } else {
                    buffer.append(c); i += 1
                }
            case "[":
                if let (textRange, dest, next) = matchLink(at: i, end: end) {
                    flush()
                    var sub = InlineParser(chars: chars)
                    for var node in sub.parse(textRange) {
                        if node.link == nil { node.link = dest }
                        nodes.append(node)
                    }
                    i = next
                } else {
                    buffer.append(c); i += 1
                }
            case "*", "_", "~":
                let n = runLength(at: i, of: c, end: end)
                if c == "~" && n != 2 {
                    buffer.append(String(repeating: "~", count: n)); i += n
                    continue
                }
                flush()
                let prev: Character = i > 0 ? chars[i - 1] : " "
                let next: Character = i + n < chars.count ? chars[i + n] : " "
                let left = !isWS(next) && (!isPunct(next) || isWS(prev) || isPunct(prev))
                let right = !isWS(prev) && (!isPunct(prev) || isWS(next) || isPunct(next))
                var canOpen = left, canClose = right
                if c == "_" {
                    canOpen = left && (!right || isPunct(prev))
                    canClose = right && (!left || isPunct(next))
                }
                delims.append(Delimiter(char: c, count: n, origCount: n, canOpen: canOpen, canClose: canClose, node: nodes.count))
                nodes.append(InlineNode(text: String(repeating: c, count: n), delimiter: delims.count - 1))
                i += n
            default:
                buffer.append(c); i += 1
            }
        }
        flush()
        processEmphasis(&nodes, &delims)
        return nodes
    }

    private func processEmphasis(_ nodes: inout [InlineNode], _ delims: inout [Delimiter]) {
        var ci = 0
        while ci < delims.count {
            let closer = delims[ci]
            guard closer.canClose, closer.count > 0, closer.active else { ci += 1; continue }
            var found: Int?
            var oi = ci - 1
            while oi >= 0 {
                let o = delims[oi]
                if o.char == closer.char, o.canOpen, o.count > 0, o.active {
                    let ruleOf3 = (o.canClose || closer.canOpen) && (o.origCount + closer.origCount) % 3 == 0
                        && !(o.origCount % 3 == 0 && closer.origCount % 3 == 0)
                    let strikeOK = closer.char != "~" || (o.count >= 2 && closer.count >= 2)
                    if !ruleOf3 && strikeOK { found = oi; break }
                }
                oi -= 1
            }
            guard let opener = found else {
                if !closer.canOpen { delims[ci].active = false }
                ci += 1
                continue
            }
            let use: Int
            let style: InlineStyle
            if closer.char == "~" {
                use = 2; style = .strike
            } else if delims[opener].count >= 2 && closer.count >= 2 {
                use = 2; style = .bold
            } else {
                use = 1; style = .italic
            }
            let from = delims[opener].node + 1
            let to = closer.node
            if from < to { for n in from..<to { nodes[n].style.insert(style) } }
            delims[opener].count -= use
            delims[ci].count -= use
            for k in (opener + 1)..<ci { delims[k].active = false }
            if delims[opener].count == 0 { delims[opener].active = false }
            if delims[ci].count == 0 { delims[ci].active = false; ci += 1 }
        }
        // Unmatched delimiter characters stay as literal text.
        for d in delims {
            nodes[d.node].text = String(repeating: d.char, count: d.count)
        }
    }

    private func runLength(at i: Int, of c: Character, end: Int) -> Int {
        var n = 0
        while i + n < end, chars[i + n] == c { n += 1 }
        return n
    }

    private func findBacktickRun(length: Int, from start: Int, end: Int) -> Int? {
        var j = start
        while j < end {
            if chars[j] == "`" {
                let n = runLength(at: j, of: "`", end: end)
                if n == length { return j }
                j += n
            } else {
                j += 1
            }
        }
        return nil
    }

    /// `<u>…</u>`-style tags (also b/strong/i/em/s/del/strike/code), with nesting of the same tag.
    private func matchTag(at i: Int, end: Int) -> (Range<Int>, InlineStyle, Int)? {
        for (name, style) in Self.tagStyles {
            let open = Array("<\(name)>")
            guard hasPrefix(open, at: i, end: end) else { continue }
            let close = Array("</\(name)>")
            var depth = 1
            var j = i + open.count
            while j < end {
                if hasPrefix(open, at: j, end: end) { depth += 1; j += open.count; continue }
                if hasPrefix(close, at: j, end: end) {
                    depth -= 1
                    if depth == 0 { return ((i + open.count)..<j, style, j + close.count) }
                    j += close.count
                    continue
                }
                j += 1
            }
            return nil
        }
        return nil
    }

    private func hasPrefix(_ p: [Character], at i: Int, end: Int) -> Bool {
        guard i + p.count <= end else { return false }
        for k in 0..<p.count where chars[i + k].lowercased() != p[k].lowercased() { return false }
        return true
    }

    private func matchAutolink(at i: Int, end: Int) -> (String, Int)? {
        var j = i + 1
        while j < end, chars[j] != ">", !chars[j].isWhitespace, chars[j] != "<" { j += 1 }
        guard j < end, chars[j] == ">" else { return nil }
        let url = String(chars[(i + 1)..<j])
        let lower = url.lowercased()
        guard lower.hasPrefix("http://") || lower.hasPrefix("https://") || lower.hasPrefix("mailto:") else { return nil }
        return (url, j + 1)
    }

    /// `[text](destination "optional title")` starting at the `[` at `i`.
    private func matchLink(at i: Int, end: Int) -> (Range<Int>, String, Int)? {
        var depth = 0
        var j = i
        var closeBracket: Int?
        while j < end {
            let c = chars[j]
            if c == "\\" { j += 2; continue }
            if c == "`" {
                let n = runLength(at: j, of: "`", end: end)
                if let close = findBacktickRun(length: n, from: j + n, end: end) { j = close + n; continue }
                j += n; continue
            }
            if c == "[" { depth += 1 }
            if c == "]" {
                depth -= 1
                if depth == 0 { closeBracket = j; break }
            }
            j += 1
        }
        guard let cb = closeBracket, cb + 1 < end, chars[cb + 1] == "(" else { return nil }
        var k = cb + 2
        while k < end, chars[k] == " " { k += 1 }
        var dest = ""
        if k < end, chars[k] == "<" {
            k += 1
            while k < end, chars[k] != ">" { dest.append(chars[k]); k += 1 }
            guard k < end else { return nil }
            k += 1
        } else {
            var parens = 0
            while k < end {
                let c = chars[k]
                if c == "\\", k + 1 < end { dest.append(chars[k + 1]); k += 2; continue }
                if c.isWhitespace { break }
                if c == "(" { parens += 1 }
                if c == ")" { if parens == 0 { break }; parens -= 1 }
                dest.append(c); k += 1
            }
        }
        while k < end, chars[k] == " " { k += 1 }
        if k < end, chars[k] == "\"" || chars[k] == "'" {
            let q = chars[k]; k += 1
            while k < end, chars[k] != q { k += 1 }
            k += 1
            while k < end, chars[k] == " " { k += 1 }
        }
        guard k < end, chars[k] == ")" else { return nil }
        return ((i + 1)..<cb, dest, k + 1)
    }
}
