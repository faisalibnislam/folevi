// What native holds of a windowed list (protocol.ts `ListDiff`, diff.ts `applyDiff`): the window's rows in
// order, at positions `start ..< start + order.count` of a list of `total` rows. Pure, so the contract tests run
// the shared fixtures through exactly the code the screens use.
import Foundation

public struct ListState<Row: EngineRow>: Equatable, Sendable {
    public private(set) var total = 0
    public private(set) var complete = false
    public private(set) var start = 0
    public private(set) var order: [String] = []
    public private(set) var rowsById: [String: Row] = [:]

    public init() {}

    /// The window's rows, in order (a hole, which a correct diff never leaves, is skipped).
    public var rows: [Row] { order.compactMap { rowsById[$0] } }

    /// The row at a position of the whole list, or nil outside the window (draw a placeholder and move the window).
    public func row(at index: Int) -> Row? {
        let i = index - start
        guard i >= 0, i < order.count else { return nil }
        return rowsById[order[i]]
    }

    /// Applies a diff as the engine expects: reset, remove, upsert, then order; rows that left the window go.
    public mutating func apply(_ diff: RowDiff<Row>) {
        if diff.reset == true {
            rowsById.removeAll(keepingCapacity: true)
            order = []
        }
        for id in diff.remove ?? [] { rowsById.removeValue(forKey: id) }
        for (id, row) in diff.upsert ?? [:] { rowsById[id] = row }
        if let newOrder = diff.order { order = newOrder }
        if rowsById.count > order.count || diff.order != nil || diff.reset == true {
            let keep = Set(order)
            rowsById = rowsById.filter { keep.contains($0.key) }
        }
        total = diff.total
        complete = diff.complete
        start = diff.start
    }
}

/// Window arithmetic: what to ask for around the visible rows, and when to move.
public struct ListWindowing: Sendable {
    public var overscan: Int
    public init(overscan: Int = EngineContract.recommendedOverscan) { self.overscan = overscan }

    /// The window for visible rows `visible`, with overscan each way, at most `maxWindowRows`.
    public func window(for visible: Range<Int>) -> ListWindow {
        let start = max(0, visible.lowerBound - overscan)
        let count = min(EngineContract.maxWindowRows, visible.count + overscan * 2)
        return ListWindow(start: start, count: count)
    }

    /// Whether the visible rows have come within a quarter of the overscan of the current window's edges.
    public func needsMove(current: ListWindow, visible: Range<Int>, total: Int, complete: Bool) -> Bool {
        let margin = max(1, overscan / 4)
        let lowEdge = current.start > 0 && visible.lowerBound < current.start + margin
        let end = current.start + current.count
        let moreBelow = end < total || !complete
        let highEdge = moreBelow && visible.upperBound > end - margin
        return lowEdge || highEdge
    }
}
