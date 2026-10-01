import Foundation

/// What the slash menu and the Insert panel can add, as on the web (components/editor/insertCatalog.ts,
/// EditorMenus.tsx `slashItems`, doc/InsertPanel.tsx). Pure: the block a plain insert id makes, the
/// divider styles, the Mermaid starter and the slash menu's ranking.
public enum InsertCatalog {
    /// The four divider looks, in the web's order and wording.
    public static let dividerStyles: [(style: DividerStyle, label: String)] = [
        (.extralight, "Extra light"),
        (.light, "Light"),
        (.regular, "Regular"),
        (.strong, "Strong"),
    ]

    /// Starter diagram for a new Mermaid block (web MERMAID_SAMPLE).
    public static let mermaidSample = [
        "flowchart TD",
        "  A[Idea] --> B{Worth doing?}",
        "  B -- Yes --> C[Plan it]",
        "  B -- Not yet --> D[Park it]",
        "  C --> E[Ship]",
    ].joined(separator: "\n")

    /// A new whiteboard's height (WHITEBOARD_DEFAULT_HEIGHT).
    public static let whiteboardHeight = Double(Whiteboard.defaultHeight)

    /// An empty table of `rows` × `cols` (emptyTableRows).
    public static func emptyTableRows(_ rows: Int, _ cols: Int) -> [[[InlineNode]]] {
        Array(repeating: Array(repeating: [], count: max(1, cols)), count: max(1, rows))
    }

    /// The block a plain insert id makes, or nil for ids that need a flow (a picker, the server…).
    ///
    /// - `divider-<style>`: a divider with that look
    /// - `pagebreak`, `formula`, `whiteboard`
    /// - `mermaid`: a code block in Mermaid with the starter diagram
    /// - `table`: 3 × 3 with a header row; `table-<rows>x<cols>`: that size (Insert → table picker)
    public static func content(for id: String) -> BlockContent? {
        if id.hasPrefix("divider-"), let style = DividerStyle(rawValue: String(id.dropFirst("divider-".count))) {
            return .divider(DividerProps(style: style))
        }
        if id.hasPrefix("table-") {
            let dims = id.dropFirst("table-".count).split(separator: "x").compactMap { Int($0) }
            guard dims.count == 2 else { return nil }
            let r = min(max(dims[0], 1), FoleviLimits.maxTableRows), c = min(max(dims[1], 1), FoleviLimits.maxTableColumns)
            return .table(TableProps(rows: emptyTableRows(r, c), headerRow: true))
        }
        switch id {
        case "pagebreak": return .pageBreak(PageBreakProps())
        case "formula": return .formula(FormulaProps(latex: ""))
        case "whiteboard": return .whiteboard(WhiteboardProps(data: "", height: whiteboardHeight))
        case "mermaid": return .code(CodeProps(language: "mermaid", code: mermaidSample))
        case "table": return .table(TableProps(rows: emptyTableRows(3, 3), headerRow: true))
        default: return nil
        }
    }

    // MARK: Slash menu search

    /// Whether an item shows for a query: its label or keywords contain it (case-insensitive label).
    public static func matches(label: String, keywords: String, query: String) -> Bool {
        let q = query.lowercased()
        return q.isEmpty || label.lowercased().contains(q) || keywords.contains(q)
    }

    /// Label matches first (those starting with the query before the rest), then keyword-only matches,
    /// so "/flowchart" picks Flowchart rather than a block that merely lists it as a keyword.
    public static func rank(label: String, query: String) -> Int {
        let l = label.lowercased(), q = query.lowercased()
        return l.hasPrefix(q) ? 0 : l.contains(q) ? 1 : 2
    }

    /// The items for a query, in the web's order: filtered, then (with a query) stably ranked.
    public static func filter<T>(_ items: [T], query: String, label: (T) -> String, keywords: (T) -> String) -> [T] {
        let q = query.lowercased().trimmingCharacters(in: .whitespaces)
        let kept = items.enumerated().filter { matches(label: label($0.element), keywords: keywords($0.element), query: q) }
        guard !q.isEmpty else { return kept.map(\.element) }
        return kept.sorted { a, b in
            let ra = rank(label: label(a.element), query: q), rb = rank(label: label(b.element), query: q)
            return ra != rb ? ra < rb : a.offset < b.offset
        }.map(\.element)
    }
}
