import Foundation

/// Whether the thread follows the answer as it streams (MAC-30). Only you scrolling up stops it: an answer that
/// grows by a tall chunk in one go (a table, a code block) moves the end away without anyone scrolling, and that
/// must not. Reaching the end again follows again.
public enum AiScrollFollow {
    public struct Reading: Equatable {
        public var offset: CGFloat
        public var atEnd: Bool

        public init(offset: CGFloat, atEnd: Bool) { self.offset = offset; self.atEnd = atEnd }
    }

    public static func following(_ was: Bool, old: Reading, new: Reading) -> Bool {
        if new.atEnd { return true }
        if new.offset < old.offset - 1 { return false }
        return was
    }
}
