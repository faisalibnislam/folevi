import SwiftUI

// The task forms' fields (Edit task and Quick add): a date with a month grid, an optional time, labelled as on
// the web ("Due date", "Time (optional)", "Priority", "Assignee"). Custom controls, never the system pickers.

/// A small muted label above a field.
struct FieldLabel<Content: View>: View {
    var title: String
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.ui(13)).foregroundStyle(FoleviColor.inkMuted)
                .uiLineHeight(13 * 1.4286, size: 13) // text-sm label
            content
        }
    }
}

/// A YYYY-MM-DD date ("" for none): shows the date and opens a month grid.
struct DateField: View {
    @Binding var date: String
    var accessibilityLabel: String
    @State private var open = false

    var body: some View {
        Button { open.toggle() } label: {
            HStack(spacing: 8) {
                Text(date.isEmpty ? String(localized: "No date") : BrowseFormat.calendarDate(date, .weekdayMonthDay))
                    .font(.ui(13))
                    .foregroundStyle(date.isEmpty ? FoleviColor.inkFaint : FoleviColor.ink)
                    .lineLimit(1)
                Image(systemName: "calendar").font(.system(size: 12)).foregroundStyle(FoleviColor.inkMuted).accessibilityHidden(true)
            }
            .padding(.horizontal, 10)
            .frame(height: 36)
            .foleviWell(shape: .rounded(6))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(accessibilityLabel))
        .accessibilityValue(Text(date.isEmpty ? String(localized: "No date") : BrowseFormat.calendarDate(date, .weekdayMonthDay)))
        .foleviPopover(isPresented: $open, arrowEdge: .bottom) {
            VStack(alignment: .leading, spacing: 10) {
                MonthPicker(selection: Binding(get: { date }, set: { date = $0; open = false }), today: TaskLogic.localDate())
                HStack(spacing: 6) {
                    FilterChip(title: String(localized: "Today"), isActive: date == TaskLogic.localDate()) {
                        date = TaskLogic.localDate()
                        open = false
                    }
                    FilterChip(title: String(localized: "Tomorrow"), isActive: date == TaskLogic.addDays(TaskLogic.localDate(), 1)) {
                        date = TaskLogic.addDays(TaskLogic.localDate(), 1)
                        open = false
                    }
                }
            }
            .padding(10)
            .frame(width: 260)
        }
    }
}

/// An HH:MM time ("" for none), typed: "9:30", "9:30 pm" and "21:30" all work.
struct TimeField: View {
    @Binding var time: String
    var accessibilityLabel: String
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        TextField("--:--", text: $text)
            .textFieldStyle(.plain)
            .font(.ui(13))
            .monospacedDigit()
            .focused($focused)
            .onSubmit(commit)
            .onChange(of: focused) { _, on in if !on { commit() } }
            .onAppear { text = time }
            .onChange(of: time) { _, t in if !focused { text = t } }
            .padding(.horizontal, 10)
            .frame(width: 96, height: 36)
            .foleviWell(shape: .rounded(6))
            .accessibilityLabel(Text(accessibilityLabel))
    }

    private func commit() {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        if trimmed.isEmpty {
            time = ""
        } else if let t = BrowseFormat.parseTime(trimmed) {
            time = t
            text = t
        } else {
            text = time
        }
    }
}

/// "None", "Low", "Medium", "High".
@MainActor
enum PriorityChoice {
    static var options: [FoleviSelect<TaskPriority>.Option] { [
        .init(value: .none, title: String(localized: "None")),
        .init(value: .low, title: String(localized: "Low")),
        .init(value: .medium, title: String(localized: "Medium")),
        .init(value: .high, title: String(localized: "High")),
    ] }

    static func label(_ p: TaskPriority) -> String {
        switch p {
        case .none: return String(localized: "None")
        case .low: return String(localized: "Low")
        case .medium: return String(localized: "Medium")
        case .high: return String(localized: "High")
        }
    }
}
