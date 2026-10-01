import Foundation

/// Find and replace inside a note (the web's findReplace.ts): matches are found in each block's text, and a
/// replacement keeps the marks of the text it replaces (the first matched character's). Inline atoms
/// (mentions, dates, page links) are never matched across or changed. Matching ignores case and accents,
/// as the Mac's find does.
public enum FindReplace {
    static let options: String.CompareOptions = [.caseInsensitive, .diacriticInsensitive]

    /// UTF-16 ranges of every non-overlapping occurrence of `query` in `text`.
    public static func ranges(of query: String, in text: String) -> [NSRange] {
        guard !query.isEmpty, !text.isEmpty else { return [] }
        let ns = text as NSString
        var out: [NSRange] = []
        var start = 0
        while start < ns.length {
            let r = ns.range(of: query, options: options, range: NSRange(location: start, length: ns.length - start))
            if r.location == NSNotFound || r.length == 0 { break }
            out.append(r)
            start = r.location + r.length
        }
        return out
    }

    /// How many times `query` occurs in the block's own editable text (inline text, or a code block's code).
    public static func count(of query: String, in block: Block) -> Int {
        if case .code(let p) = block.content { return ranges(of: query, in: p.code).count }
        guard block.content.carriesText else { return 0 }
        return segments(block.text).reduce(0) { $0 + ranges(of: query, in: $1.text).count }
    }

    /// Replaces occurrences of `query` with `replacement` in inline text: all of them, or only the first
    /// `limit`. Returns the new text (normalized) and how many were replaced.
    public static func replace(in nodes: [InlineNode], query: String, with replacement: String, limit: Int? = nil) -> (nodes: [InlineNode], count: Int) {
        guard !query.isEmpty else { return (nodes, 0) }
        var out: [InlineNode] = []
        var replaced = 0
        for segment in segments(nodes) {
            guard let runs = segment.runs else {
                out.append(contentsOf: segment.atoms)
                continue
            }
            let remaining = limit.map { max(0, $0 - replaced) }
            var matches = ranges(of: query, in: segment.text)
            if let remaining { matches = Array(matches.prefix(remaining)) }
            if matches.isEmpty {
                out.append(contentsOf: runs.map { .text(text: $0.text, marks: $0.marks) })
                continue
            }
            replaced += matches.count
            out.append(contentsOf: rewrite(runs: runs, text: segment.text, matches: matches, replacement: replacement))
        }
        return (RichText.normalizeInline(out), replaced)
    }

    /// The block with occurrences replaced (all, or the first `limit`), or nil when nothing changed.
    public static func replace(in block: Block, query: String, with replacement: String, limit: Int? = nil) -> (block: Block, count: Int)? {
        var b = block
        if case .code(var p) = block.content {
            var matches = ranges(of: query, in: p.code)
            if let limit { matches = Array(matches.prefix(limit)) }
            guard !matches.isEmpty else { return nil }
            let ns = NSMutableString(string: p.code)
            for r in matches.reversed() { ns.replaceCharacters(in: r, with: replacement) }
            p.code = ns as String
            b.content = .code(p)
            return (b, matches.count)
        }
        guard block.content.carriesText else { return nil }
        let result = replace(in: block.text, query: query, with: replacement, limit: limit)
        guard result.count > 0 else { return nil }
        b.text = result.nodes
        return (b, result.count)
    }

    // MARK: Segments

    struct Run { var text: String; var marks: [Mark]? }

    /// Consecutive text runs (matchable together) or inline atoms (kept as they are).
    struct Segment {
        var runs: [Run]?
        var atoms: [InlineNode] = []
        var text: String { runs?.map(\.text).joined() ?? "" }
    }

    static func segments(_ nodes: [InlineNode]) -> [Segment] {
        var out: [Segment] = []
        for node in nodes {
            if case .text(let text, let marks) = node {
                if out.last?.runs != nil {
                    out[out.count - 1].runs?.append(Run(text: text, marks: marks))
                } else {
                    out.append(Segment(runs: [Run(text: text, marks: marks)]))
                }
            } else {
                out.append(Segment(runs: nil, atoms: [node]))
            }
        }
        return out
    }

    /// Rebuilds a segment's runs with each match swapped for `replacement` (carrying the marks of the run
    /// the match starts in).
    static func rewrite(runs: [Run], text: String, matches: [NSRange], replacement: String) -> [InlineNode] {
        let ns = text as NSString
        // Where each run starts and ends, in UTF-16 offsets.
        var bounds: [(start: Int, end: Int, marks: [Mark]?)] = []
        var offset = 0
        for run in runs {
            let length = (run.text as NSString).length
            bounds.append((offset, offset + length, run.marks))
            offset += length
        }
        func marks(at position: Int) -> [Mark]? {
            bounds.first { position >= $0.start && position < $0.end }?.marks ?? bounds.last?.marks
        }
        var out: [InlineNode] = []
        // Copies [from, to) keeping each run's marks.
        func copy(_ from: Int, _ to: Int) {
            guard from < to else { return }
            for b in bounds where b.end > from && b.start < to {
                let s = max(from, b.start), e = min(to, b.end)
                out.append(.text(text: ns.substring(with: NSRange(location: s, length: e - s)), marks: b.marks))
            }
        }
        var cursor = 0
        for m in matches {
            copy(cursor, m.location)
            if !replacement.isEmpty { out.append(.text(text: replacement, marks: marks(at: m.location))) }
            cursor = m.location + m.length
        }
        copy(cursor, ns.length)
        return out
    }
}
