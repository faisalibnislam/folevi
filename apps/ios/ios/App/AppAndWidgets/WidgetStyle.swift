// The widgets' parts of Folevi's look (Shared/Palette.swift has the colours and type): the background, the
// signed-out state, and how a due day reads.
import SwiftUI
import WidgetKit

extension View {
    /// The widget's background: the app's canvas (the system tints it on a tinted Home Screen).
    func foleviBackground() -> some View {
        containerBackground(for: .widget) { Palette.canvas }
    }
}

/// "Open Folevi to sign in": what every widget shows without a token.
struct SignedOutView: View {
    var compact = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Image("WidgetMark")
                .resizable()
                .frame(width: 22, height: 22)
                .foregroundStyle(Palette.heading)
            Spacer(minLength: 0)
            Text("Open Folevi to sign in")
                .font(Typeface.title(compact ? 15 : 17))
                .foregroundStyle(Palette.heading)
                .fixedSize(horizontal: false, vertical: true)
            if !compact {
                Text("Your tasks and notes show up here.")
                    .font(Typeface.rowSmall)
                    .foregroundStyle(Palette.muted)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

/// A day as widgets say it: "Today", "Yesterday", or "12 Oct".
enum DueLabel {
    static func text(for due: String?, time: String?, today: String) -> String? {
        guard let due else { return time }
        if due == today { return time }
        guard let date = parse(due), let now = parse(today) else { return due }
        let days = Calendar.current.dateComponents([.day], from: date, to: now).day ?? 0
        if days == 1 { return "Yesterday" }
        return date.formatted(.dateTime.day().month(.abbreviated))
    }

    private static func parse(_ day: String) -> Date? {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.dateFormat = "yyyy-MM-dd"
        return f.date(from: day)
    }
}
