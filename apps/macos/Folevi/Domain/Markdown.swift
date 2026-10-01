import Foundation

/// Port of packages/editor-schema/src/markdown.ts (export and import).
public enum MarkdownCodec {
    public struct ExportOptions {
        /// Resolves an uploaded file id to a relative path inside the export (e.g. `assets/photo.png`).
        public var resolveFile: ((String) -> String?)?
        /// Resolves a document id to a relative link target (e.g. `Project Atlas.md`).
        public var resolveDocument: ((String) -> String?)?
        public var title: String?
        public var frontMatter: [(String, String)] = []

        public init(resolveFile: ((String) -> String?)? = nil, resolveDocument: ((String) -> String?)? = nil,
                    title: String? = nil, frontMatter: [(String, String)] = []) {
            self.resolveFile = resolveFile
            self.resolveDocument = resolveDocument
            self.title = title
            self.frontMatter = frontMatter
        }
    }

    static let escapeSet: Set<Character> = ["\\", "`", "*", "_", "[", "]", "#", "<", ">", "|"]

    static func escapeMd(_ value: String) -> String {
        var out = ""
        for ch in value {
            if escapeSet.contains(ch) { out.append("\\") }
            out.append(ch)
        }
        return out
    }

    /// JavaScript `encodeURI`.
    static func encodeURI(_ value: String) -> String {
        var allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789")
        allowed.insert(charactersIn: ";,/?:@&=+$-_.!~*'()#")
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
    }

    static func isJSWhitespace(_ ch: Character) -> Bool {
        ch.unicodeScalars.allSatisfy { CharacterSet.whitespacesAndNewlines.contains($0) || $0 == "\u{FEFF}" }
    }

    public static func inlineToMarkdown(_ nodes: [InlineNode], _ opts: ExportOptions = ExportOptions()) -> String {
        nodes.map { node -> String in
            switch node {
            case .mention(_, let label):
                return "@\(escapeMd(label))"
            case .date(let date):
                return date
            case .pageLink(let documentId, let label):
                if let target = opts.resolveDocument?(documentId) {
                    return "[\(escapeMd(label))](\(encodeURI(target)))"
                }
                return "[[\(label)]]"
            case .text(let text, let marksOpt):
                let marks = marksOpt ?? []
                if marks.contains(.code) {
                    let fence = text.contains("`") ? "``" : "`"
                    return "\(fence)\(text)\(fence)"
                }
                let s = escapeMd(text)
                let chars = Array(s)
                var leadCount = 0
                while leadCount < chars.count && isJSWhitespace(chars[leadCount]) { leadCount += 1 }
                var trailCount = 0
                while trailCount < chars.count && isJSWhitespace(chars[chars.count - 1 - trailCount]) { trailCount += 1 }
                if leadCount + trailCount >= chars.count { return s }
                let lead = String(chars[0..<leadCount])
                let trail = String(chars[(chars.count - trailCount)...])
                var core = String(chars[leadCount..<(chars.count - trailCount)])
                if marks.contains(.strike) { core = "~~\(core)~~" }
                if marks.contains(.italic) { core = "_\(core)_" }
                if marks.contains(.bold) { core = "**\(core)**" }
                for m in marks {
                    if case .link(let href) = m {
                        core = "[\(core)](\(href))"
                        break
                    }
                }
                return lead + core + trail
            }
        }.joined()
    }

    static func string(_ v: JSONValue?) -> String {
        guard let v else { return "undefined" }
        switch v {
        case .string(let s): return s
        case .number(let n): return JSONValue.formatNumber(n)
        case .bool(let b): return b ? "true" : "false"
        case .null: return "null"
        default: return v.canonicalString
        }
    }

    /// Forces a page break in Markdown viewers that render HTML (and in PDF exports).
    public static let pageBreakHTML = "<div style=\"page-break-after: always\"></div>"

    public static func blocksToMarkdown(_ blocks: [WireBlock], _ opts: ExportOptions = ExportOptions()) -> String {
        var lines: [String] = []
        if !opts.frontMatter.isEmpty {
            lines.append("---")
            for (k, v) in opts.frontMatter {
                var quoted = ""
                JSONValue.writeString(v, into: &quoted)
                lines.append("\(k): \(quoted)")
            }
            lines.append("---")
            lines.append("")
        }
        let hasTitle = !(opts.title ?? "").isEmpty
        if let title = opts.title, !title.isEmpty {
            lines.append("# \(escapeMd(title))")
            lines.append("")
        }
        let flat = Tree.flatten(blocks)
        var counters: [Int?] = []
        var prevWasList = false
        for entry in flat {
            let block = entry.block
            let depth = entry.depth
            let indent = String(repeating: "  ", count: depth)
            let p = block.props.objectValue ?? [:]
            let t = inlineToMarkdown(block.inlineText, opts)
            let isList = block.type == "bulleted" || block.type == "numbered" || block.type == "todo"
            if !isList && prevWasList { lines.append("") }
            if counters.count > depth + 1 {
                counters.removeLast(counters.count - (depth + 1))
            } else {
                while counters.count < depth + 1 { counters.append(nil) }
            }
            switch block.type {
            case "paragraph":
                lines.append(indent + t)
                lines.append("")
            case "heading":
                var level = p["level"]?.doubleValue ?? 0
                if level.isNaN || level == 0 { level = 1 }
                let n = Int(min(3, level)) + (hasTitle ? 1 : 0)
                lines.append("\(String(repeating: "#", count: max(0, n))) \(t)")
                lines.append("")
            case "bulleted":
                lines.append("\(indent)- \(t)")
            case "numbered":
                counters[depth] = (counters[depth] ?? 0) + 1
                lines.append("\(indent)\(counters[depth] ?? 1). \(t)")
            case "todo":
                let checked = p["checked"]?.isTruthy ?? false
                var due = ""
                if let dueDate = p["dueDate"], dueDate.isTruthy {
                    let time = (p["dueTime"]?.isTruthy ?? false) ? " \(string(p["dueTime"]))" : ""
                    due = " (due \(string(dueDate))\(time))"
                }
                lines.append("\(indent)- [\(checked ? "x" : " ")] \(t)\(due)")
            case "toggle":
                lines.append("\(indent)<details><summary>\(t)</summary></details>")
                lines.append("")
            case "quote":
                lines.append("\(indent)> \(t)")
                lines.append("")
            case "callout":
                let tone = (p["tone"].flatMap { $0.isNull ? nil : $0 }).map { string($0) } ?? "note"
                lines.append("\(indent)> [!\(tone.uppercased())]")
                lines.append("\(indent)> \(t)")
                lines.append("")
            case "divider":
                lines.append("---")
                lines.append("")
            case "pageBreak":
                lines.append(pageBreakHTML)
                lines.append("")
            case "formula":
                let latex = (p["latex"]?.isNull == false ? string(p["latex"]) : "").trimmingCharacters(in: .whitespacesAndNewlines)
                if !latex.isEmpty { lines.append(contentsOf: ["$$", latex, "$$", ""]) }
            case "whiteboard":
                // An inline SVG image, so the drawing survives in any Markdown viewer.
                let svg = Whiteboard.svg(data: (p["data"]?.isNull == false ? string(p["data"]) : ""), height: p["height"]?.doubleValue)
                lines.append("\(indent)![Whiteboard](\(Whiteboard.dataURI(svg)))")
                lines.append("")
            case FlowchartProps.type:
                // A Mermaid diagram, so the chart stays editable and renders in most Markdown viewers.
                let fc = Flowchart.parse(p["data"]?.stringValue ?? "")
                if !fc.nodes.isEmpty { lines.append(contentsOf: ["```mermaid", FlowchartExport.mermaid(fc), "```", ""]) }
            case "code":
                let code = p["code"].flatMap { $0.isNull ? nil : $0 }.map { string($0) } ?? ""
                let fence = code.contains("```") ? "~~~~" : "```"
                let lang = p["language"]?.stringValue == "plaintext" ? "" : (p["language"].flatMap { $0.isNull ? nil : $0 }.map { string($0) } ?? "")
                lines.append("\(fence)\(lang)")
                lines.append(code)
                lines.append(fence)
                lines.append("")
            case "image":
                var src: String?
                if let fileId = p["fileId"], fileId.isTruthy {
                    src = opts.resolveFile?(string(fileId))
                } else {
                    src = p["url"]?.stringValue
                }
                let alt = p["alt"].flatMap { $0.isNull ? nil : $0 }.map { string($0) } ?? ""
                lines.append("\(indent)![\(escapeMd(alt))](\(src.map { $0.isEmpty ? "" : encodeURI($0) } ?? ""))")
                if let caption = p["caption"], caption.isTruthy {
                    lines.append("\(indent)_\(escapeMd(string(caption)))_")
                }
                lines.append("")
            case "file", "audio":
                let src = opts.resolveFile?(string(p["fileId"]))
                let name = p["name"].flatMap { $0.isNull ? nil : $0 }.map { string($0) } ?? "file"
                lines.append("\(indent)[\(escapeMd(name))](\(src.map { $0.isEmpty ? "" : encodeURI($0) } ?? ""))")
                lines.append("")
            case "table":
                let rows: [[[InlineNode]]] = (try? (p["rows"] ?? .array([])).decode([[[InlineNode]]].self)) ?? []
                if let first = rows.first {
                    let cell: ([InlineNode]) -> String = { c in
                        let s = inlineToMarkdown(c, opts).replacingOccurrences(of: "\n", with: " ")
                        return s.isEmpty ? " " : s
                    }
                    let headerRow = p["headerRow"]?.isTruthy ?? false
                    let header = headerRow ? first : first.map { _ in [InlineNode]() }
                    let body = headerRow ? Array(rows.dropFirst()) : rows
                    lines.append("| \(header.map(cell).joined(separator: " | ")) |")
                    lines.append("| \(header.map { _ in "---" }.joined(separator: " | ")) |")
                    for r in body { lines.append("| \(r.map(cell).joined(separator: " | ")) |") }
                    lines.append("")
                }
            case "page":
                let target = opts.resolveDocument?(string(p["documentId"]))
                let label = p["titleCache"].flatMap { $0.isNull ? nil : $0 }.map { string($0) } ?? "Untitled"
                lines.append("\(indent)\(target.map { "[\(escapeMd(label))](\(encodeURI($0)))" } ?? "[[\(label)]]")")
                lines.append("")
            case "bookmark":
                let url = string(p["url"])
                let title = p["title"].flatMap { $0.isNull ? nil : $0 }.map { string($0) } ?? url
                lines.append("\(indent)[\(escapeMd(title))](\(url))")
                lines.append("")
            case "collection":
                lines.append("\(indent)<!-- folevi:collection \(string(p["collectionId"])) -->")
                lines.append("")
            default:
                lines.append("\(indent)<!-- folevi:unsupported-block \(escapeMd(block.type)) -->")
                lines.append("")
            }
            prevWasList = isList
        }
        var text = lines.joined(separator: "\n")
        while text.contains("\n\n\n") {
            text = text.replacingOccurrences(of: "\n\n\n", with: "\n\n")
        }
        while let last = text.last, isJSWhitespace(last) { text.removeLast() }
        return text + "\n"
    }

    // MARK: - Import

    public struct ImportWarning: Sendable, Hashable {
        public var line: Int
        public var code: String
        public var message: String
    }

    public struct ImportResult: Sendable {
        public var title: String?
        public var blocks: [WireBlock]
        public var frontMatter: [String: String]
        public var warnings: [ImportWarning]
    }

    /// Parses inline Markdown (emphasis, strong, code, strike, links, autolinks) into inline nodes.
    public static func parseInline(_ src: String) -> [InlineNode] {
        var out: [InlineNode] = []
        func push(_ text: String, _ marks: [Mark]) {
            if text.isEmpty { return }
            out.append(.text(text: text, marks: marks.isEmpty ? nil : marks))
        }
        let escapable: Set<Character> = ["\\", "`", "*", "_", "[", "]", "#", "<", ">", "|", "~", "!", "(", ")", "-"]
        func walk(_ s: [Character], _ marks: [Mark]) {
            var buf = ""
            var i = 0
            func startsWith(_ str: String, at idx: Int) -> Bool {
                let p = Array(str)
                if idx + p.count > s.count { return false }
                for k in 0..<p.count where s[idx + k] != p[k] { return false }
                return true
            }
            func indexOf(_ str: String, from: Int) -> Int? {
                var j = max(0, from)
                let p = Array(str)
                while j + p.count <= s.count {
                    if startsWith(str, at: j) { return j }
                    j += 1
                }
                return nil
            }
            func isWS(_ c: Character?) -> Bool { c.map(isJSWhitespace) ?? false }
            func isWord(_ c: Character?) -> Bool {
                guard let c, c.isASCII else { return false }
                return c.isLetter || c.isNumber || c == "_"
            }
            while i < s.count {
                let ch = s[i]
                if ch == "\\", i + 1 < s.count, escapable.contains(s[i + 1]) {
                    buf.append(s[i + 1])
                    i += 2
                    continue
                }
                if ch == "`" {
                    var n = 0
                    while i + n < s.count && s[i + n] == "`" { n += 1 }
                    let ticks = String(repeating: "`", count: n)
                    if let end = indexOf(ticks, from: i + n) {
                        push(buf, marks)
                        buf = ""
                        var code = String(s[(i + n)..<end])
                        if code.hasPrefix(" ") && code.hasSuffix(" ") && !code.trimmingCharacters(in: .whitespaces).isEmpty && code.count >= 2 {
                            code = String(code.dropFirst().dropLast())
                        }
                        push(code, marks + [.code])
                        i = end + n
                        continue
                    }
                }
                func tryDelim(_ delim: String, _ mark: Mark) -> Bool {
                    guard startsWith(delim, at: i) else { return false }
                    let dl = delim.count
                    let after: Character? = i + dl < s.count ? s[i + dl] : nil
                    if after == nil || isWS(after) { return false }
                    var end = indexOf(delim, from: i + dl)
                    while let e = end, isWS(e - 1 >= 0 ? s[e - 1] : " ") { end = indexOf(delim, from: e + 1) }
                    guard let e = end, e != i + dl else { return false }
                    // Intra-word underscores are literal.
                    if delim.first == "_" && isWord(i - 1 >= 0 ? s[i - 1] : nil) { return false }
                    push(buf, marks)
                    buf = ""
                    walk(Array(s[(i + dl)..<e]), marks + [mark])
                    i = e + dl
                    return true
                }
                if ch == "*" || ch == "_" || ch == "~" {
                    if tryDelim("***", .bold) || tryDelim("**", .bold) || tryDelim("__", .bold) || tryDelim("~~", .strike)
                        || tryDelim("*", .italic) || tryDelim("_", .italic) {
                        continue
                    }
                }
                if ch == "[" && (i + 1 >= s.count || s[i + 1] != "[") {
                    let rest = String(s[i...])
                    if let m = Regex.match(#"^\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)"#, rest), let label = m.groups[0], let rawHref = m.groups[1] {
                        let href = RichText.sanitizeHref(rawHref)
                        push(buf, marks)
                        buf = ""
                        walk(Array(label), href.map { marks + [.link(href: $0)] } ?? marks)
                        i += m.fullLength
                        continue
                    }
                }
                if ch == "<" {
                    let rest = String(s[i...])
                    if let m = Regex.match(#"^<(https?://[^>\s]+)>"#, rest), let url = m.groups[0] {
                        push(buf, marks)
                        buf = ""
                        push(url, marks + [.link(href: url)])
                        i += m.fullLength
                        continue
                    }
                }
                if ch == "h" && (startsWith("http://", at: i) || startsWith("https://", at: i)) && !marks.contains(where: { if case .link = $0 { return true } else { return false } }) {
                    let rest = String(s[i...])
                    if let m = Regex.match(#"^https?://[^\s<>()]+[^\s<>().,;:!?'"]"#, rest) {
                        let url = String(rest.prefix(m.fullLength))
                        push(buf, marks)
                        buf = ""
                        push(url, marks + [.link(href: url)])
                        i += m.fullLength
                        continue
                    }
                }
                buf.append(ch)
                i += 1
            }
            push(buf, marks)
        }
        walk(Array(src), [])
        return RichText.normalizeInline(out)
    }

    struct Draft {
        var id: String
        var type: String
        var depth: Int
        var text: [InlineNode]
        var props: [String: JSONValue]
    }

    /// `order` lists the keys as first written (JavaScript object key order), for warnings.
    static func parseFrontMatter(_ lines: [String]) -> (data: [String: String], consumed: Int, order: [String]) {
        guard lines.first?.trimmingCharacters(in: .whitespaces) == "---" else { return ([:], 0, []) }
        var data: [String: String] = [:]
        var order: [String] = []
        for i in 1..<max(1, lines.count) {
            let line = lines[i]
            let t = line.trimmingCharacters(in: .whitespaces)
            if t == "---" || t == "..." { return (data, i + 1, order) }
            if let m = Regex.match(#"^([A-Za-z0-9_-]+):\s*(.*)$"#, line), let k = m.groups[0] {
                var v = (m.groups[1] ?? "").trimmingCharacters(in: .whitespaces)
                if v.count >= 2 && ((v.hasPrefix("\"") && v.hasSuffix("\"")) || (v.hasPrefix("'") && v.hasSuffix("'"))) {
                    v = String(v.dropFirst().dropLast())
                }
                if data[k] == nil { order.append(k) }
                data[k] = v
            }
        }
        return ([:], 0, [])
    }

    static let languageAliases: [String: String] = [
        "js": "javascript", "jsx": "javascript", "ts": "typescript", "tsx": "typescript", "sh": "bash", "shell": "bash",
        "zsh": "bash", "py": "python", "rb": "ruby", "yml": "yaml", "md": "markdown", "tex": "latex", "c++": "cpp",
        "cs": "csharp", "text": "plaintext", "txt": "plaintext", "": "plaintext",
    ]

    static func normalizeLanguage(_ lang: String) -> String {
        let l = lang.trimmingCharacters(in: .whitespaces).lowercased()
        let mapped = languageAliases[l] ?? l
        return foleviCodeLanguages.contains(mapped) ? mapped : "plaintext"
    }

    static func splitTableRow(_ line: String) -> [String] {
        var s = line.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("|") { s.removeFirst() }
        if s.hasSuffix("|") && !s.hasSuffix("\\|") { s.removeLast() }
        var cells: [String] = []
        var cur = ""
        let chars = Array(s)
        var i = 0
        while i < chars.count {
            if chars[i] == "\\" && i + 1 < chars.count && chars[i + 1] == "|" {
                cur.append("|")
                i += 2
                continue
            }
            if chars[i] == "|" {
                cells.append(cur.trimmingCharacters(in: .whitespaces))
                cur = ""
            } else {
                cur.append(chars[i])
            }
            i += 1
        }
        cells.append(cur.trimmingCharacters(in: .whitespaces))
        return cells
    }

    public static func markdownToBlocks(_ markdown: String, resolveImage: ((String) -> String?)? = nil,
                                        newId: () -> String = { ULID.make() }, titleFromHeading: Bool = true) -> ImportResult {
        var warnings: [ImportWarning] = []
        var src = markdown.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        if src.hasPrefix("\u{FEFF}") { src.removeFirst() }
        let all = src.components(separatedBy: "\n")
        let fm = parseFrontMatter(all)
        let lines = Array(all.dropFirst(fm.consumed))
        var drafts: [Draft] = []
        var title: String? = fm.data["title"]
        var paragraph: [String] = []
        let lineNo: (Int) -> Int = { $0 + fm.consumed + 1 }

        func flushParagraph() {
            guard !paragraph.isEmpty else { return }
            drafts.append(Draft(id: newId(), type: "paragraph", depth: 0, text: parseInline(paragraph.joined(separator: " ")), props: [:]))
            paragraph = []
        }
        var listStack: [Int] = []
        var i = 0
        while i < lines.count {
            defer { i += 1 }
            let line = lines[i].replacingOccurrences(of: "\t", with: "    ")
            if line.trimmingCharacters(in: .whitespaces).isEmpty {
                flushParagraph()
                continue
            }
            // Page break (the `<div style="page-break-after: always"></div>` convention).
            if Regex.match(#"^\s*<div\s+style=["']\s*(page-break-after|break-after)\s*:\s*(always|page)\s*;?\s*["']\s*>\s*</div>\s*$"#, line, caseInsensitive: true) != nil {
                flushParagraph()
                drafts.append(Draft(id: newId(), type: "pageBreak", depth: 0, text: [], props: [:]))
                continue
            }
            // Display math ($$ … $$) becomes a formula block.
            if let math = Regex.match(#"^\s*\$\$(.*)$"#, line) {
                flushParagraph()
                let startLine = i
                var body: [String] = []
                var rest = math.groups[0] ?? ""
                let trim = { (s: String) in s.trimmingCharacters(in: .whitespacesAndNewlines) }
                if let closed = Regex.match(#"^(.*?)\$\$\s*$"#, rest), !trim(rest).isEmpty {
                    body.append(trim(closed.groups[0] ?? ""))
                } else {
                    if !trim(rest).isEmpty { body.append(rest) }
                    i += 1
                    while i < lines.count && Regex.match(#"\$\$\s*$"#, lines[i]) == nil {
                        body.append(lines[i])
                        i += 1
                    }
                    if i < lines.count {
                        rest = lines[i].replacingOccurrences(of: #"\$\$\s*$"#, with: "", options: .regularExpression)
                        if !trim(rest).isEmpty { body.append(rest) }
                    }
                }
                let latex = trim(body.joined(separator: "\n"))
                if latex.utf16.count > FoleviLimits.maxFormulaLength {
                    drafts.append(Draft(id: newId(), type: "code", depth: 0, text: [],
                                        props: ["language": .string("latex"), "code": .string(latex)]))
                    warnings.append(ImportWarning(line: lineNo(startLine), code: "math", message: "A very long formula was kept as a LaTeX code block"))
                } else if !latex.isEmpty {
                    drafts.append(Draft(id: newId(), type: "formula", depth: 0, text: [], props: ["latex": .string(latex)]))
                }
                continue
            }
            // Fenced code
            if let fence = Regex.match(#"^\s*(`{3,}|~{3,})\s*([^\s`]*)"#, line), let marker = fence.groups[0] {
                flushParagraph()
                var body: [String] = []
                i += 1
                while i < lines.count && !lines[i].trimmingCharacters(in: .whitespaces).hasPrefix(marker) {
                    body.append(lines[i])
                    i += 1
                }
                let lang = fence.groups[1] ?? ""
                drafts.append(Draft(id: newId(), type: "code", depth: 0, text: [],
                                    props: ["language": .string(normalizeLanguage(lang)), "code": .string(body.joined(separator: "\n"))]))
                if !lang.isEmpty && normalizeLanguage(lang) == "plaintext" && !["text", "txt", "plaintext"].contains(lang.lowercased()) {
                    warnings.append(ImportWarning(line: lineNo(i), code: "unsupported", message: "Code language \"\(lang)\" imported as plain text"))
                }
                continue
            }
            // Heading
            if let h = Regex.match(#"^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$"#, line), let hashes = h.groups[0] {
                flushParagraph()
                let level = hashes.count
                let content = h.groups[1] ?? ""
                if level == 1 && titleFromHeading && title == nil && drafts.isEmpty {
                    title = RichText.plainText(parseInline(content))
                    continue
                }
                drafts.append(Draft(id: newId(), type: "heading", depth: 0, text: parseInline(content), props: ["level": .number(Double(min(3, level)))]))
                continue
            }
            // Divider
            if Regex.test(#"^\s{0,3}([-*_])(\s*\1){2,}\s*$"#, line) {
                flushParagraph()
                drafts.append(Draft(id: newId(), type: "divider", depth: 0, text: [], props: [:]))
                continue
            }
            // Table
            if line.contains("|"), i + 1 < lines.count, Regex.test(#"^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$"#, lines[i + 1]) {
                flushParagraph()
                let header = splitTableRow(line)
                var rows: [[[InlineNode]]] = [header.map(parseInline)]
                i += 2
                while i < lines.count && lines[i].contains("|") && !lines[i].trimmingCharacters(in: .whitespaces).isEmpty {
                    let cells = splitTableRow(lines[i])
                    rows.append(header.indices.map { c in parseInline(c < cells.count ? cells[c] : "") })
                    i += 1
                }
                i -= 1
                let rowsJSON = (try? JSONValue(encoding: rows)) ?? .array([])
                drafts.append(Draft(id: newId(), type: "table", depth: 0, text: [], props: ["rows": rowsJSON, "headerRow": true]))
                continue
            }
            // Quote / callout
            if let q = Regex.match(#"^\s{0,3}>\s?(.*)$"#, line) {
                flushParagraph()
                var body: [String] = [q.groups[0] ?? ""]
                while i + 1 < lines.count && Regex.test(#"^\s{0,3}>"#, lines[i + 1]) {
                    i += 1
                    body.append(Regex.replace(#"^\s{0,3}>\s?"#, in: lines[i], with: ""))
                }
                if body.contains(where: { Regex.test(#"^\s*>"#, $0) }) {
                    warnings.append(ImportWarning(line: lineNo(i), code: "nested_quote", message: "Nested quotes were flattened"))
                }
                if let callout = Regex.match(#"^\[!(NOTE|TIP|INFO|IMPORTANT|SUCCESS|WARNING|CAUTION|DANGER)\]\s*(.*)$"#, body[0], caseInsensitive: true),
                   let kind = callout.groups[0] {
                    let toneMap = ["NOTE": "note", "TIP": "success", "INFO": "info", "IMPORTANT": "info", "SUCCESS": "success",
                                   "WARNING": "warning", "CAUTION": "warning", "DANGER": "danger"]
                    let rest = ([callout.groups[1] ?? ""] + body.dropFirst()).filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }.joined(separator: " ")
                    drafts.append(Draft(id: newId(), type: "callout", depth: 0, text: parseInline(rest),
                                        props: ["tone": .string(toneMap[kind.uppercased()] ?? "note")]))
                } else {
                    let joined = Regex.replace(#"^\s*>\s?"#, in: body.joined(separator: " "), with: "")
                    drafts.append(Draft(id: newId(), type: "quote", depth: 0, text: parseInline(joined), props: [:]))
                }
                continue
            }
            // Lists
            if let li = Regex.match(#"^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$"#, line) {
                flushParagraph()
                let indent = (li.groups[0] ?? "").count
                while let top = listStack.last, indent < top { listStack.removeLast() }
                if listStack.isEmpty || indent > (listStack.last ?? 0) { listStack.append(indent) }
                let depth = listStack.count - 1
                var content = li.groups[2] ?? ""
                if let task = Regex.match(#"^\[([ xX])\]\s+(.*)$"#, content) {
                    content = task.groups[1] ?? ""
                    var props: [String: JSONValue] = ["checked": .bool(task.groups[0] != " ")]
                    if let due = Regex.match(#"\s*\(due (\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2}))?\)\s*$"#, content) {
                        content = String(content.prefix(due.location))
                        props["dueDate"] = due.groups[0].map { .string($0) }
                        if let time = due.groups[1] { props["dueTime"] = .string(time) }
                    }
                    drafts.append(Draft(id: newId(), type: "todo", depth: depth, text: parseInline(content), props: props))
                } else {
                    let ordered = (li.groups[1] ?? "").contains(where: \.isNumber)
                    drafts.append(Draft(id: newId(), type: ordered ? "numbered" : "bulleted", depth: depth, text: parseInline(content), props: [:]))
                }
                continue
            }
            // Continuation line of a list item (lazy)
            if !listStack.isEmpty, Regex.test(#"^\s+\S"#, line), !drafts.isEmpty, paragraph.isEmpty {
                let lastIdx = drafts.count - 1
                if ["bulleted", "numbered", "todo"].contains(drafts[lastIdx].type) {
                    drafts[lastIdx].text = RichText.normalizeInline(drafts[lastIdx].text + [.text(text: " ", marks: nil)] + parseInline(line.trimmingCharacters(in: .whitespaces)))
                    continue
                }
            }
            listStack.removeAll()
            // Images on their own line
            if let img = Regex.match(#"^\s*!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"([^"]*)")?\s*\)\s*$"#, line), let srcPath = img.groups[1] {
                flushParagraph()
                let alt = img.groups[0] ?? ""
                if let fileId = resolveImage?(srcPath) {
                    drafts.append(Draft(id: newId(), type: "image", depth: 0, text: [],
                                        props: ["fileId": .string(fileId), "alt": .string(alt), "caption": .string(img.groups[2] ?? "")]))
                } else if Regex.test(#"^https?://"#, srcPath, caseInsensitive: true) {
                    drafts.append(Draft(id: newId(), type: "image", depth: 0, text: [],
                                        props: ["url": .string(srcPath), "alt": .string(alt), "caption": .string(img.groups[2] ?? "")]))
                } else {
                    warnings.append(ImportWarning(line: lineNo(i), code: "unresolved_image", message: "Image \"\(srcPath)\" was not found and was kept as a link"))
                    drafts.append(Draft(id: newId(), type: "paragraph", depth: 0,
                                        text: [.text(text: alt.isEmpty ? srcPath : alt, marks: [.link(href: RichText.sanitizeHref(srcPath) ?? "#")])], props: [:]))
                }
                continue
            }
            if Regex.test(#"^\s*</?(div|p|span|section|article|table|iframe|script|style|img|br|hr|ul|ol|li|h[1-6]|blockquote|pre|figure|video|audio|a|center|font)\b"#, line, caseInsensitive: true) {
                flushParagraph()
                warnings.append(ImportWarning(line: lineNo(i), code: "html_block", message: "Raw HTML was imported as plain text"))
                drafts.append(Draft(id: newId(), type: "paragraph", depth: 0, text: [.text(text: line.trimmingCharacters(in: .whitespaces), marks: nil)], props: [:]))
                continue
            }
            if let details = Regex.match(#"^\s*<details>\s*<summary>(.*?)</summary>(.*?)(</details>)?\s*$"#, line) {
                flushParagraph()
                drafts.append(Draft(id: newId(), type: "toggle", depth: 0, text: parseInline(details.groups[0] ?? ""), props: ["collapsed": true]))
                continue
            }
            if Regex.test(#"^\[\^[^\]]+\]:"#, line) {
                warnings.append(ImportWarning(line: lineNo(i), code: "footnote", message: "Footnote definition imported as a paragraph"))
            } else if Regex.test(#"^\s{0,3}\[[^\]]+\]:\s+\S+"#, line) {
                warnings.append(ImportWarning(line: lineNo(i), code: "reference_link", message: "Reference-style link definition imported as text"))
            }
            if Regex.test(#"\$\$[^$]+\$\$"#, line) {
                warnings.append(ImportWarning(line: lineNo(i), code: "math", message: "Inline math ($$…$$) isn’t rendered yet; it was kept as text"))
            }
            paragraph.append(line.trimmingCharacters(in: .whitespaces))
        }
        flushParagraph()

        // Front matter: only `title` becomes part of the document; say which fields were left out.
        let dropped = fm.order.filter { $0 != "title" }
        if !dropped.isEmpty {
            warnings.insert(ImportWarning(line: 1, code: "front_matter",
                                          message: "Front matter \(dropped.count == 1 ? "field" : "fields") not imported: \(dropped.joined(separator: ", ")) (only “title” is used)"), at: 0)
        }

        // Convert depth annotations into parent/rank assignments.
        var stack: [Draft] = []
        var parentOf: [String: String?] = [:]
        for d in drafts {
            while let top = stack.last, top.depth >= d.depth { stack.removeLast() }
            let parent = stack.last
            parentOf[d.id] = (parent != nil && d.depth > 0) ? parent?.id : nil
            stack.append(d)
        }
        var order: [String?] = []
        var siblings: [String?: [String]] = [:]
        for d in drafts {
            let p = parentOf[d.id] ?? nil
            if siblings[p] == nil { order.append(p) }
            siblings[p, default: []].append(d.id)
        }
        var ranks: [String: String] = [:]
        for key in order {
            let list = siblings[key] ?? []
            let seq = (try? Rank.sequence(list.count)) ?? []
            for (idx, id) in list.enumerated() where idx < seq.count { ranks[id] = seq[idx] }
        }
        let blocks = drafts.map { d in
            WireBlock(id: d.id, type: d.type, parentId: parentOf[d.id] ?? nil, rank: ranks[d.id] ?? "V",
                      schemaVersion: foleviSchemaVersion, text: (try? JSONValue(encoding: d.text)) ?? .array([]), props: .object(d.props))
        }
        return ImportResult(title: title, blocks: blocks, frontMatter: fm.data, warnings: warnings)
    }

    /// Plain text import: one paragraph per blank-line separated chunk.
    public static func plainTextToBlocks(_ input: String, newId: () -> String = { ULID.make() }) -> [WireBlock] {
        let normalized = input.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        let chunks = Regex.split(#"\n{2,}"#, normalized).map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        let ranks = (try? Rank.sequence(chunks.count)) ?? []
        return chunks.enumerated().map { i, c in
            WireBlock(id: newId(), type: "paragraph", parentId: nil, rank: i < ranks.count ? ranks[i] : "V",
                      text: [["type": "text", "text": .string(c.replacingOccurrences(of: "\n", with: " "))]], props: .emptyObject)
        }
    }
}

/// Small NSRegularExpression helpers.
enum Regex {
    struct Match {
        var groups: [String?]
        var fullLength: Int // in Characters
        var location: Int // in Characters
    }

    nonisolated(unsafe) private static var cache: [String: NSRegularExpression] = [:]
    private static let lock = NSLock()

    static func compile(_ pattern: String, caseInsensitive: Bool) -> NSRegularExpression? {
        let key = (caseInsensitive ? "i:" : "s:") + pattern
        lock.lock()
        defer { lock.unlock() }
        if let r = cache[key] { return r }
        let r = try? NSRegularExpression(pattern: pattern, options: caseInsensitive ? [.caseInsensitive] : [])
        cache[key] = r
        return r
    }

    static func match(_ pattern: String, _ s: String, caseInsensitive: Bool = false) -> Match? {
        guard let re = compile(pattern, caseInsensitive: caseInsensitive) else { return nil }
        let ns = s as NSString
        guard let m = re.firstMatch(in: s, range: NSRange(location: 0, length: ns.length)) else { return nil }
        var groups: [String?] = []
        if m.numberOfRanges > 1 {
            for g in 1..<m.numberOfRanges {
                let r = m.range(at: g)
                groups.append(r.location == NSNotFound ? nil : ns.substring(with: r))
            }
        }
        let prefix = ns.substring(to: m.range.location)
        let full = ns.substring(with: m.range)
        return Match(groups: groups, fullLength: full.count, location: prefix.count)
    }

    static func test(_ pattern: String, _ s: String, caseInsensitive: Bool = false) -> Bool {
        match(pattern, s, caseInsensitive: caseInsensitive) != nil
    }

    static func replace(_ pattern: String, in s: String, with template: String) -> String {
        guard let re = compile(pattern, caseInsensitive: false) else { return s }
        let ns = s as NSString
        // JS String.replace without /g replaces the first match only.
        guard let m = re.firstMatch(in: s, range: NSRange(location: 0, length: ns.length)) else { return s }
        return ns.replacingCharacters(in: m.range, with: template)
    }

    static func split(_ pattern: String, _ s: String) -> [String] {
        guard let re = compile(pattern, caseInsensitive: false) else { return [s] }
        let ns = s as NSString
        var out: [String] = []
        var last = 0
        for m in re.matches(in: s, range: NSRange(location: 0, length: ns.length)) {
            out.append(ns.substring(with: NSRange(location: last, length: m.range.location - last)))
            last = m.range.location + m.range.length
        }
        out.append(ns.substring(from: last))
        return out
    }
}
