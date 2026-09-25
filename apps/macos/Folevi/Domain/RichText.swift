import Foundation

/// Port of packages/editor-schema/src/richtext.ts.
public enum RichText {
    /// Canonical mark order (matches `MarkTypes` in the generated TS schema).
    static let markOrder: [String] = ["bold", "italic", "underline", "strike", "code", "link", "color", "highlight"]

    static func markType(_ m: Mark) -> String {
        switch m {
        case .bold: return "bold"
        case .italic: return "italic"
        case .underline: return "underline"
        case .strike: return "strike"
        case .code: return "code"
        case .link: return "link"
        case .color: return "color"
        case .highlight: return "highlight"
        }
    }

    static func markKey(_ m: Mark) -> String {
        switch m {
        case .link(let href): return "link:\(href)"
        case .color(let v): return "color:\(v.rawValue)"
        case .highlight(let v): return "highlight:\(v.rawValue)"
        default: return markType(m)
        }
    }

    /// Canonical mark order, one mark per type (the last wins for valued marks).
    public static func normalizeMarks(_ marks: [Mark]?) -> [Mark]? {
        guard let marks, !marks.isEmpty else { return nil }
        var byType: [String: Mark] = [:]
        var firstSeen: [String] = []
        for m in marks {
            let t = markType(m)
            if byType[t] == nil { firstSeen.append(t) }
            byType[t] = m
        }
        let ordered = firstSeen.sorted { (markOrder.firstIndex(of: $0) ?? 99) < (markOrder.firstIndex(of: $1) ?? 99) }
        let out = ordered.compactMap { byType[$0] }
        return out.isEmpty ? nil : out
    }

    static func sameMarks(_ a: [Mark]?, _ b: [Mark]?) -> Bool {
        (a ?? []).map(markKey).joined(separator: "|") == (b ?? []).map(markKey).joined(separator: "|")
    }

    /// Merges adjacent text runs with identical marks, drops empty runs, canonicalizes marks.
    public static func normalizeInline(_ nodes: [InlineNode]) -> [InlineNode] {
        var out: [InlineNode] = []
        for node in nodes {
            if case .text(let text, let marks) = node {
                if text.isEmpty { continue }
                let norm = normalizeMarks(marks)
                if case .text(let prevText, let prevMarks)? = out.last, sameMarks(prevMarks, norm) {
                    out[out.count - 1] = .text(text: prevText + text, marks: norm)
                    continue
                }
                out.append(.text(text: text, marks: norm))
            } else {
                out.append(node)
            }
        }
        return out
    }

    public static func plainText(_ nodes: [InlineNode]) -> String {
        nodes.map { node -> String in
            switch node {
            case .text(let text, _): return text
            case .mention(_, let label): return "@\(label)"
            case .date(let date): return date
            case .pageLink(_, let label): return label
            }
        }.joined()
    }

    public static func textLength(_ nodes: [InlineNode]) -> Int {
        plainText(nodes).utf16.count
    }

    public static func text(_ value: String, marks: [Mark]? = nil) -> [InlineNode] {
        if value.isEmpty { return [] }
        if let marks, !marks.isEmpty { return [.text(text: value, marks: marks)] }
        return [.text(text: value, marks: nil)]
    }

    static let safeProtocols: Set<String> = ["http:", "https:", "mailto:", "folevi:"]

    /// Returns a safe href or nil. Relative paths and fragments are allowed; javascript:, data: etc. are not.
    public static func sanitizeHref(_ raw: String) -> String? {
        let href = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if href.isEmpty || href.utf16.count > 2048 { return nil }
        if href.hasPrefix("/") || href.hasPrefix("#") { return href.hasPrefix("//") ? nil : href }
        // Strip control characters and whitespace that browsers ignore inside schemes ("java\tscript:").
        let compact = String(String.UnicodeScalarView(href.unicodeScalars.filter { s in
            !(s.value <= 0x1F || s.value == 0x7F || CharacterSet.whitespacesAndNewlines.contains(s))
        }))
        guard let colon = compact.firstIndex(of: ":") else { return "https://\(compact)" }
        let scheme = compact[..<colon]
        let schemeValid: Bool = {
            guard let first = scheme.unicodeScalars.first, CharacterSet.letters.contains(first), first.isASCII else { return false }
            return scheme.unicodeScalars.allSatisfy { s in
                s.isASCII && (CharacterSet.alphanumerics.contains(s) || s == "+" || s == "." || s == "-")
            }
        }()
        if !schemeValid { return "https://\(compact)" }
        let proto = scheme.lowercased() + ":"
        return safeProtocols.contains(proto) ? compact : nil
    }

    /// Unicode-aware word count (letters/numbers followed by word characters, apostrophes, dashes).
    public static func wordCount(_ value: String) -> Int {
        var count = 0
        var inWord = false
        for scalar in value.unicodeScalars {
            let isAlnum = CharacterSet.letters.contains(scalar) || CharacterSet.decimalDigits.contains(scalar)
                || scalar.properties.numericType != nil
            if inWord {
                if isAlnum || scalar == "'" || scalar == "\u{2019}" || scalar == "_" || scalar == "-" || CharacterSet.nonBaseCharacters.contains(scalar) {
                    continue
                }
                inWord = false
            } else if isAlnum {
                inWord = true
                count += 1
            }
        }
        return count
    }
}
