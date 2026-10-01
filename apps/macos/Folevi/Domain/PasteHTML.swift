import Foundation

/// Paste normalization (the web's paste.ts): HTML from web pages, Google Docs, Word or other editors
/// becomes canonical blocks. Only structure and safe inline formatting survive; scripts, styles and unknown
/// markup are dropped.
public enum PasteHTML {
    struct Draft {
        var type: String
        var depth: Int
        var text: [InlineNode]
        var props: [String: JSONValue]
    }

    static let blockTags: Set<String> = ["P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "BLOCKQUOTE", "PRE", "HR", "UL", "OL", "TABLE",
                                         "IMG", "FIGURE", "SECTION", "ARTICLE", "HEADER", "FOOTER", "ASIDE", "DETAILS"]
    static let skip: Set<String> = ["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "IFRAME", "OBJECT", "EMBED", "SVG", "CANVAS", "BUTTON", "INPUT",
                                    "SELECT", "TEXTAREA", "META", "LINK", "HEAD", "TITLE"]

    /// The blocks for an HTML fragment, with fresh ids, parents and ranks.
    public static func blocks(_ html: String, newId: () -> String = { ULID.make() }) -> [WireBlock] {
        guard let data = html.data(using: .utf8),
              let doc = try? XMLDocument(data: data, options: [.documentTidyHTML]) else { return [] }
        let body = (try? doc.nodes(forXPath: "//body").first) ?? doc.rootElement()
        guard let body = body as? XMLElement else { return [] }
        var drafts: [Draft] = []
        walk(body, depth: 0, out: &drafts, listType: nil)
        return assemble(drafts, newId: newId)
    }

    static func tag(_ n: XMLNode) -> String { (n.name ?? "").uppercased() }

    static func attr(_ e: XMLElement, _ name: String) -> String? {
        e.attribute(forName: name)?.stringValue
    }

    static func inline(_ el: XMLNode, marks: [Mark] = []) -> [InlineNode] {
        var out: [InlineNode] = []
        for child in el.children ?? [] {
            if child.kind == .text {
                let text = (child.stringValue ?? "").replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
                if !text.isEmpty { out.append(.text(text: text, marks: marks.isEmpty ? nil : marks)) }
                continue
            }
            guard child.kind == .element, let e = child as? XMLElement else { continue }
            let t = tag(e)
            if skip.contains(t) || blockTags.contains(t) { continue }
            if t == "BR" {
                out.append(.text(text: "\n", marks: nil))
                continue
            }
            var next = marks
            let style = attr(e, "style") ?? ""
            func has(_ pattern: String) -> Bool { style.range(of: pattern, options: .regularExpression) != nil }
            if t == "STRONG" || t == "B" || has(#"font-weight:\s*(bold|[6-9]00)"#) { next.append(.bold) }
            if t == "EM" || t == "I" || has(#"font-style:\s*italic"#) { next.append(.italic) }
            if t == "U" || has(#"text-decoration[^;]*underline"#) { next.append(.underline) }
            if t == "S" || t == "DEL" || t == "STRIKE" || has("line-through") { next.append(.strike) }
            if t == "CODE" || t == "KBD" || t == "SAMP" { next.append(.code) }
            if t == "MARK" { next.append(.highlight(value: .yellow)) }
            if t == "A", let href = RichText.sanitizeHref(attr(e, "href") ?? ""), !href.hasPrefix("#") { next.append(.link(href: href)) }
            out.append(contentsOf: inline(e, marks: next))
        }
        return out
    }

    /// Normalized, with the block's leading and trailing whitespace trimmed.
    static func clean(_ nodes: [InlineNode]) -> [InlineNode] {
        var n = RichText.normalizeInline(nodes)
        if case .text(let t, let m)? = n.first { n[0] = .text(text: String(t.drop { $0.isWhitespace }), marks: m) }
        if case .text(let t, let m)? = n.last {
            var s = t
            while let last = s.last, last.isWhitespace { s.removeLast() }
            n[n.count - 1] = .text(text: s, marks: m)
        }
        return RichText.normalizeInline(n)
    }

    static func walk(_ el: XMLElement, depth: Int, out: inout [Draft], listType: String?) {
        for child in el.children ?? [] {
            if child.kind == .text {
                let text = (child.stringValue ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                if !text.isEmpty { out.append(Draft(type: "paragraph", depth: depth, text: [.text(text: text, marks: nil)], props: [:])) }
                continue
            }
            guard child.kind == .element, let e = child as? XMLElement else { continue }
            let t = tag(e)
            if skip.contains(t) { continue }
            switch t {
            case "H1", "H2", "H3", "H4", "H5", "H6":
                let text = clean(inline(e))
                let level = min(3, Int(String(t.dropFirst())) ?? 1)
                if !text.isEmpty { out.append(Draft(type: "heading", depth: 0, text: text, props: ["level": .number(Double(level))])) }
            case "P":
                let text = clean(inline(e))
                if !text.isEmpty { out.append(Draft(type: "paragraph", depth: depth, text: text, props: [:])) }
            case "UL", "OL":
                walk(e, depth: listType != nil ? depth + 1 : depth, out: &out, listType: t == "OL" ? "numbered" : "bulleted")
            case "LI":
                let kids = (e.children ?? []).compactMap { $0 as? XMLElement }
                let checkbox = kids.first { tag($0) == "INPUT" && attr($0, "type") == "checkbox" }
                    ?? kids.first { tag($0) == "P" }.flatMap { p in (p.children ?? []).compactMap { $0 as? XMLElement }.first { tag($0) == "INPUT" && attr($0, "type") == "checkbox" } }
                var text = clean(inline(e))
                let nested = kids.filter { ["UL", "OL", "P"].contains(tag($0)) }
                if text.isEmpty, let p = nested.first(where: { tag($0) == "P" }) { text = clean(inline(p)) }
                let cls = attr(e, "class") ?? ""
                let isTodo = checkbox != nil || attr(e, "data-checked") != nil || cls.contains("task-list-item") || cls.contains("checklist")
                let type = isTodo ? "todo" : (listType ?? "bulleted")
                let checked = (checkbox.map { attr($0, "checked") != nil } ?? false) || attr(e, "data-checked") == "true"
                out.append(Draft(type: type, depth: depth, text: text, props: type == "todo" ? ["checked": .bool(checked)] : [:]))
                for n in nested where tag(n) != "P" {
                    walk(n, depth: depth + 1, out: &out, listType: tag(n) == "OL" ? "numbered" : "bulleted")
                }
            case "BLOCKQUOTE":
                let text = clean(inline(e))
                if !text.isEmpty { out.append(Draft(type: "quote", depth: depth, text: text, props: [:])) } else { walk(e, depth: depth, out: &out, listType: nil) }
            case "PRE":
                var code = e.stringValue ?? ""
                if code.hasSuffix("\n") { code.removeLast() }
                let cls = (e.children ?? []).compactMap { $0 as? XMLElement }.first { tag($0) == "CODE" }.flatMap { attr($0, "class") } ?? ""
                var lang = "plaintext"
                if let r = cls.range(of: #"language-(\w+)"#, options: .regularExpression) { lang = String(cls[r].dropFirst("language-".count)) }
                out.append(Draft(type: "code", depth: 0, text: [], props: ["language": .string(lang), "code": .string(code)]))
            case "HR":
                out.append(Draft(type: "divider", depth: 0, text: [], props: [:]))
            case "IMG":
                let src = attr(e, "src") ?? ""
                if src.lowercased().hasPrefix("https://") {
                    out.append(Draft(type: "image", depth: depth, text: [], props: ["url": .string(src), "alt": .string(attr(e, "alt") ?? ""), "caption": .string("")]))
                }
            case "TABLE":
                let trs = ((try? e.nodes(forXPath: ".//tr")) ?? []).prefix(200)
                let rows: [[[InlineNode]]] = trs.map { tr in
                    ((tr.children ?? []).compactMap { $0 as? XMLElement }.filter { ["TH", "TD"].contains(tag($0)) }).prefix(20).map { clean(inline($0)) }
                }
                let width = max(1, rows.map(\.count).max() ?? 1)
                if !rows.isEmpty {
                    let padded = rows.map { $0 + Array(repeating: [], count: width - $0.count) }
                    let hasHeader = ((try? e.nodes(forXPath: ".//th")) ?? []).isEmpty == false
                    let json = (try? JSONValue(encoding: padded)) ?? .array([])
                    out.append(Draft(type: "table", depth: 0, text: [], props: ["headerRow": .bool(hasHeader), "rows": json]))
                }
            default:
                if (e.children ?? []).contains(where: { $0.kind == .element && blockTags.contains(tag($0)) }) {
                    walk(e, depth: depth, out: &out, listType: listType)
                } else {
                    let text = clean(inline(e))
                    if !text.isEmpty { out.append(Draft(type: "paragraph", depth: depth, text: text, props: [:])) }
                }
            }
        }
    }

    /// Depth annotations become parents and ranks.
    static func assemble(_ drafts: [Draft], newId: () -> String) -> [WireBlock] {
        var stack: [(id: String, depth: Int)] = []
        var assigned: [(draft: Draft, id: String, parentId: String?)] = []
        var counts: [String?: Int] = [:]
        for d in drafts {
            let depth = min(d.depth, stack.last.map { $0.depth + 1 } ?? 0)
            while let last = stack.last, last.depth >= depth { stack.removeLast() }
            let parentId = depth > 0 ? stack.last?.id : nil
            let id = newId()
            assigned.append((d, id, parentId))
            counts[parentId, default: 0] += 1
            stack.append((id, depth))
        }
        var pools: [String?: [String]] = [:]
        for (parent, count) in counts { pools[parent] = (try? Rank.sequence(count)) ?? [] }
        var out: [WireBlock] = []
        for a in assigned {
            let rank = pools[a.parentId]?.isEmpty == false ? pools[a.parentId]!.removeFirst() : "V"
            out.append(WireBlock(id: a.id, type: a.draft.type, parentId: a.parentId, rank: rank,
                                 text: (try? JSONValue(encoding: a.draft.text)) ?? .array([]), props: .object(a.draft.props)))
        }
        return out
    }
}
