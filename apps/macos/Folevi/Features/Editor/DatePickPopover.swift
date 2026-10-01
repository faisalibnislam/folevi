import SwiftUI

/// "Date…" (slash menu, Insert → Date): pick a day and insert it as a date mention. The web's date popover
/// (a date, Today / Tomorrow / Next week, Insert), with a month grid for the date field.
struct DatePickPopover: View {
    var today: String
    var onPick: (String) -> Void
    var onCancel: () -> Void
    @State private var value = ""
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Date").font(.ui(12)).foregroundStyle(FoleviColor.inkMuted)
                MonthPicker(selection: $value, today: today)
            }
            HStack(spacing: 6) {
                ForEach(quick, id: \.0) { label, date in
                    FilterChip(title: label, isActive: value == date) { value = date }
                }
            }
            HStack {
                Spacer()
                Button("Insert") { onPick(value) }
                    .buttonStyle(.folevi(.primary, .small))
            }
        }
        .padding(10)
        .frame(width: 260)
        .foleviPop()
        .focusable()
        .focused($focused)
        .focusEffectDisabled()
        .onAppear {
            if value.isEmpty { value = today }
            focused = true
        }
        .onExitCommand(perform: onCancel)
        .onKeyPress(.return) {
            onPick(value)
            return .handled
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Insert a date"))
    }

    private var quick: [(String, String)] {
        [(String(localized: "Today"), today), (String(localized: "Tomorrow"), TaskLogic.addDays(today, 1)), (String(localized: "Next week"), TaskLogic.addDays(today, 7))]
    }
}

/// A month grid of days (custom, not the system date picker): arrows change the month, a click picks a day.
struct MonthPicker: View {
    @Binding var selection: String
    var today: String
    @State private var shown: (year: Int, month: Int)?

    private var month: (year: Int, month: Int) {
        shown ?? MonthGrid.month(of: selection) ?? MonthGrid.month(of: today) ?? (2026, 1)
    }

    var body: some View {
        let m = month
        let cal = Calendar.current
        let first = cal.firstWeekday
        let symbols = cal.veryShortStandaloneWeekdaySymbols
        VStack(spacing: 4) {
            HStack {
                Text(monthTitle(m)).font(.ui(13, .semibold)).foregroundStyle(FoleviColor.heading)
                Spacer()
                IconButton(systemImage: "chevron.left", label: "Previous Month", size: 24) { shown = MonthGrid.adding(-1, to: m) }
                IconButton(systemImage: "chevron.right", label: "Next Month", size: 24) { shown = MonthGrid.adding(1, to: m) }
            }
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 2), count: 7), spacing: 2) {
                ForEach(0..<7, id: \.self) { i in
                    Text(symbols[(first - 1 + i) % 7]).font(.ui(10.5, .medium)).foregroundStyle(FoleviColor.inkFaint)
                        .frame(height: 18)
                }
                ForEach(Array(MonthGrid.cells(year: m.year, month: m.month, firstWeekday: first).enumerated()), id: \.offset) { _, day in
                    if let day {
                        let on = day == selection
                        Button { selection = day } label: {
                            Text(String(Int(day.suffix(2)) ?? 0))
                                .font(.ui(12, on || day == today ? .semibold : .regular))
                                .monospacedDigit()
                                .foregroundStyle(on ? .white : day == today ? FoleviColor.emberInk : FoleviColor.ink)
                                .frame(maxWidth: .infinity, minHeight: 26)
                                .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(on ? FoleviColor.ember : .clear))
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text(TaskLogic.parseLocalDate(day)?.formatted(date: .complete, time: .omitted) ?? day))
                        .accessibilityAddTraits(on ? .isSelected : [])
                    } else {
                        Color.clear.frame(height: 26)
                    }
                }
            }
        }
        .padding(8)
        .foleviWell(shape: .rounded(10))
    }

    private func monthTitle(_ m: (year: Int, month: Int)) -> String {
        guard let d = Calendar.current.date(from: DateComponents(year: m.year, month: m.month, day: 1)) else { return "" }
        return d.formatted(.dateTime.month(.wide).year())
    }
}
