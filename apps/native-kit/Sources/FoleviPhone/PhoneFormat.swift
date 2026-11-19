// The iPhone's shared formatters: one of each, made once (the Mac's 2026-11-19 performance pass: a formatter made
// for every row of a list costs more than the row; docs/MAC_PERFORMANCE_2026-11-19.md).
import Foundation
import FoleviScreens

enum PhoneFormat {
    /// "2 minutes ago", in full words.
    // (Formatters format from any thread; these are set up once and never changed.)
    nonisolated(unsafe) private static let relativeFull: RelativeDateTimeFormatter = {
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .full
        return f
    }()

    /// The system's own relative style ("2 min. ago").
    nonisolated(unsafe) private static let relativePlain = RelativeDateTimeFormatter()

    /// When `ms` (milliseconds since 1970) was, from now, in full words.
    static func relative(_ ms: Double) -> String {
        relativeFull.localizedString(for: Date(timeIntervalSince1970: ms / 1000), relativeTo: ScreenClock.now())
    }

    /// When `ms` was, from now, in the system's default style.
    static func relativeShort(_ ms: Double) -> String {
        relativePlain.localizedString(for: Date(timeIntervalSince1970: ms / 1000), relativeTo: ScreenClock.now())
    }
}
