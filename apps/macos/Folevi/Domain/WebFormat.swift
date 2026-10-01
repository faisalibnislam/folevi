import Foundation

/// The web's date helpers (apps/web/src/lib/format.ts), so dates read the same on both.
enum WebFormat {
    /// `formatRelative`: "now", "5 minutes ago", "in 3 hours", "yesterday"; past 6 days, "Oct 1" (with the
    /// year when it isn't this year).
    static func relative(_ ms: Double, now: Date = Date()) -> String {
        let diff = ms - now.timeIntervalSince1970 * 1000
        let abs = Swift.abs(diff)
        let f = RelativeDateTimeFormatter()
        f.dateTimeStyle = .named
        f.unitsStyle = .full
        if abs < 45_000 { return f.localizedString(from: DateComponents(second: 0)) }
        if abs < 45 * 60_000 { return f.localizedString(from: DateComponents(minute: Int((diff / 60_000).rounded()))) }
        if abs < 22 * 3_600_000 { return f.localizedString(from: DateComponents(hour: Int((diff / 3_600_000).rounded()))) }
        if abs < 6 * 86_400_000 { return f.localizedString(from: DateComponents(day: Int((diff / 86_400_000).rounded()))) }
        let date = Date(timeIntervalSince1970: ms / 1000)
        let sameYear = Calendar.current.component(.year, from: date) == Calendar.current.component(.year, from: now)
        let d = DateFormatter()
        d.setLocalizedDateFormatFromTemplate(sameYear ? "MMMd" : "yMMMd")
        return d.string(from: date)
    }

    /// `formatDateTime`: medium date and short time, "Oct 1, 2026, 3:04 PM".
    static func dateTime(_ ms: Double) -> String {
        let d = DateFormatter()
        d.setLocalizedDateFormatFromTemplate("yMMMdjmm")
        return d.string(from: Date(timeIntervalSince1970: ms / 1000))
    }

    /// `formatBytes` (lib/format.ts): "512 B", "12 KB", "1.5 MB", "2.00 GB".
    static func bytes(_ n: Double) -> String {
        if n < 1024 { return "\(Int(n)) B" }
        if n < 1024 * 1024 { return String(format: "%.0f KB", n / 1024) }
        if n < 1024 * 1024 * 1024 { return String(format: "%.1f MB", n / 1024 / 1024) }
        return String(format: "%.2f GB", n / 1024 / 1024 / 1024)
    }
}
