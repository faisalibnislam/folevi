// Reveals a streaming answer word by word (web useAiStream.ts `useTypewriter`): every tick the shown part
// catches up with what has arrived by a few words, more when it falls far behind (long answers never make you
// wait), always ending on a word boundary. Reduce Motion shows everything at once.
import Foundation

public struct StreamReveal: Equatable, Sendable {
    /// Everything received so far.
    public private(set) var target: String = ""
    /// How much of it is shown (UTF-8 bytes, always on a character boundary).
    public private(set) var shownBytes = 0

    public init() {}

    public var shown: Substring {
        let t = target.utf8
        return target[..<t.index(t.startIndex, offsetBy: shownBytes)]
    }

    public var caughtUp: Bool { shownBytes >= target.utf8.count }

    /// New text from the stream. A different start (a regenerated answer) starts over.
    public mutating func receive(_ text: String) {
        if !text.utf8.starts(with: target.utf8.prefix(shownBytes)) { shownBytes = 0 }
        target = text
        shownBytes = min(shownBytes, target.utf8.count)
    }

    /// One tick (about every 30 ms): shows a few more words. Returns whether anything changed.
    @discardableResult
    public mutating func tick(reduceMotion: Bool = false) -> Bool {
        let total = target.utf8.count
        guard shownBytes < total else { return false }
        if reduceMotion {
            shownBytes = total
            return true
        }
        let utf8 = target.utf8
        let behind = total - shownBytes
        // Three words' worth at least (about 18 bytes), more when far behind.
        var next = shownBytes + max(18, behind / 28)
        if next >= total {
            shownBytes = total
            return true
        }
        // Forward to the next whitespace so a word never shows half written.
        var i = utf8.index(utf8.startIndex, offsetBy: next)
        while i < utf8.endIndex, !Self.isSpace(utf8[i]) { i = utf8.index(after: i); next += 1 }
        shownBytes = min(next, total)
        return true
    }

    public mutating func showAll() { shownBytes = target.utf8.count }

    static func isSpace(_ b: UInt8) -> Bool { b == 0x20 || b == 0x0A || b == 0x09 || b == 0x0D }
}
