// The Calendar's pieces (web iphone/WeekStrip.tsx, iphone/Agenda.tsx, views/CalendarView.tsx): the week strip (the
// seven days, today filled, a dot under days with something on; swipe sideways for other weeks, pull down for the
// month), the month grid, day headers with a + that adds a task on that day, and event rows (read-only, the
// calendar's colour where a task has its box).
import SwiftUI
import FoleviDesign
import FoleviEngine

/// The week strip under the title (owner decision D4), with the month folded under it.
struct WeekStripView: View {
    let model: CalendarModel
    let marked: (String) -> Bool
    @Binding var monthOpen: Bool
    @State private var drag: CGSize = .zero
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let today = model.today
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                ForEach(Array(["M", "T", "W", "T", "F", "S", "S"].enumerated()), id: \.offset) { _, letter in
                    Text(letter).foleviFont(.caption).foregroundStyle(Folevi.color.inkFaint).frame(maxWidth: .infinity)
                }
            }
            .accessibilityHidden(true)
            if monthOpen {
                VStack(spacing: 0) {
                    Text(TaskDates.monthTitle(model.selected, today: today)).foleviFont(.footnote).foregroundStyle(Folevi.color.inkMuted).padding(.top, 2)
                    ForEach(TaskDates.monthRows(model.selected), id: \.self) { row in
                        weekRow(row, today: today, month: String(model.selected.prefix(7)))
                    }
                }
                .transition(.opacity.combined(with: .move(edge: .top)))
            } else {
                weekRow(TaskDates.week(of: model.selected), today: today, month: nil)
                    .offset(x: drag.width * 0.35)
            }
            Capsule()
                .fill(Folevi.color.lineStrong)
                .frame(width: 36, height: 5)
                .padding(.vertical, 6)
                .frame(maxWidth: .infinity, minHeight: 22)
                .contentShape(Rectangle())
                .onTapGesture { toggleMonth() }
                .accessibilityLabel(monthOpen ? "Hide the month" : "Show the month")
                .accessibilityAddTraits(.isButton)
                .accessibilityIdentifier("calendar-month-grabber")
        }
        .padding(.horizontal, 8)
        .contentShape(Rectangle())
        .gesture(
            DragGesture(minimumDistance: 14)
                .onChanged { drag = $0.translation }
                .onEnded { v in
                    drag = .zero
                    let dx = v.translation.width, dy = v.translation.height
                    if abs(dy) > abs(dx) {
                        if dy > 30 && !monthOpen { toggleMonth() } else if dy < -30 && monthOpen { toggleMonth() }
                    } else if abs(dx) > 50 {
                        withAnimation(reduceMotion ? nil : .folevi()) {
                            model.page(dx < 0 ? 1 : -1, layout: monthOpen ? .month : .week)
                        }
                        model.feedback.haptic(.selection)
                    }
                }
        )
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Days")
        .accessibilityAdjustableAction { dir in
            switch dir {
            case .increment: model.select(TaskDates.add(model.selected, days: 1))
            case .decrement: model.select(TaskDates.add(model.selected, days: -1))
            @unknown default: break
            }
        }
    }

    private func toggleMonth() {
        withAnimation(reduceMotion ? nil : .folevi(0.26)) { monthOpen.toggle() }
        model.feedback.haptic(.selection)
    }

    private func weekRow(_ days: [String], today: String, month: String?) -> some View {
        HStack(spacing: 0) {
            ForEach(days, id: \.self) { day in
                let isSelected = day == model.selected
                let isToday = day == today
                let outside = month.map { !day.hasPrefix($0) } ?? false
                Button {
                    model.select(day)
                    model.feedback.haptic(.selection)
                    if monthOpen { withAnimation(reduceMotion ? nil : .folevi(0.26)) { monthOpen = false } }
                } label: {
                    VStack(spacing: 3) {
                        Text(String(Int(day.suffix(2)) ?? 0))
                            .foleviFont(.body)
                            .fontWeight(isToday || isSelected ? .semibold : .regular)
                            .monospacedDigit()
                            .foregroundStyle(isToday ? Folevi.color.canvas : (isSelected ? Folevi.color.heading : (outside ? Folevi.color.inkFaint : Folevi.color.ink)))
                            .frame(width: 34, height: 34)
                            .background {
                                if isToday { Circle().fill(Folevi.color.heading) } else if isSelected { Circle().fill(Folevi.color.ink.opacity(0.09)) }
                            }
                        Circle().fill(marked(day) ? Folevi.color.inkFaint : .clear).frame(width: 5, height: 5)
                    }
                    .frame(maxWidth: .infinity, minHeight: 48)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(dayAccessibility(day, today: today))
                .accessibilityAddTraits(isSelected ? [.isSelected, .isButton] : .isButton)
                .accessibilityIdentifier("calendar-day-\(day)")
            }
        }
    }

    private func dayAccessibility(_ day: String, today: String) -> String {
        var s = TaskDates.format(day, "EEEEMMMMd")
        if day == today { s = "Today, " + s }
        if marked(day) { s += ", has items" }
        return s
    }
}

/// A day's header: "Today", "Tomorrow" or the weekday in the heading's weight, the date muted beside it, and a +
/// that adds a task on that day.
struct CalendarDayHeader: View {
    let day: String
    let today: String
    let canAdd: Bool
    let onAdd: () -> Void

    var body: some View {
        let h = TaskDates.dayHeading(day, today: today)
        HStack(spacing: 0) {
            (Text(h.name).foregroundColor(Folevi.color.heading).fontWeight(.semibold) + Text(" · \(h.date)").foregroundColor(Folevi.color.inkMuted))
                .foleviFont(.headline)
                .lineLimit(1)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 0)
            if canAdd {
                Button(action: onAdd) {
                    Image(systemName: "plus").font(.system(size: 15, weight: .semibold)).foregroundStyle(Folevi.color.inkMuted).frame(width: 44, height: 44).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Add a task on \(h.name)")
                .accessibilityIdentifier("calendar-add-\(day)")
            }
        }
        .padding(.leading, 20)
        .padding(.trailing, 6)
    }
}

/// An event in a list: its calendar's colour where a task has its box, the title, and when · which calendar.
struct CalendarEventRow: View {
    let placed: PlacedEvent
    let onOpen: () -> Void

    var body: some View {
        let e = placed.event
        Button(action: onOpen) {
            HStack(alignment: .center, spacing: 12) {
                Capsule().fill(CalendarMath.color(e.color)).frame(width: 4, height: 22).frame(width: 22)
                VStack(alignment: .leading, spacing: 2) {
                    Text(e.title.isEmpty ? "Untitled event" : e.title).foleviFont(.body).foregroundStyle(Folevi.color.ink).lineLimit(1)
                    Text("\(CalendarMath.eventTimeOnDay(placed)) · \(e.calendarName)").foleviFont(.footnote).foregroundStyle(Folevi.color.inkMuted).lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            .padding(.leading, 20)
            .padding(.trailing, 16)
            .frame(minHeight: 60)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(e.title.isEmpty ? "Untitled event" : e.title), \(CalendarMath.eventTimeOnDay(placed)), from \(e.calendarName)")
        .accessibilityIdentifier("calendar-event-\(e.id)")
    }
}

/// The month grid (iPad and Mac, and the iPhone's Month layout): days with their first items; drop a task on a
/// day to give it that date.
struct MonthGridView: View {
    let model: CalendarModel
    let compact: Bool
    let tasks: [String: [TaskRow]]
    let events: [String: [PlacedEvent]]
    let onAdd: (String) -> Void

    var body: some View {
        let today = model.today
        let rows = TaskDates.monthRows(model.selected)
        let month = String(model.selected.prefix(7))
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                ForEach(TaskDates.week(of: rows.first?.first ?? model.selected), id: \.self) { d in
                    Text(TaskDates.format(d, compact ? "EEEEE" : "EEE")).foleviFont(.caps).foregroundStyle(Folevi.color.inkFaint).frame(maxWidth: .infinity)
                }
            }
            .padding(.vertical, 6)
            ForEach(rows, id: \.self) { row in
                HStack(spacing: 0) {
                    ForEach(row, id: \.self) { day in cell(day, today: today, inMonth: day.hasPrefix(month)) }
                }
                .frame(maxHeight: .infinity)
            }
        }
        .accessibilityIdentifier("calendar-month")
    }

    private func cell(_ day: String, today: String, inMonth: Bool) -> some View {
        let dayTasks = tasks[day] ?? []
        let dayEvents = events[day] ?? []
        let isToday = day == today
        let isSelected = day == model.selected
        let limit = compact ? 2 : 3
        let items = dayTasks.count + dayEvents.count
        return VStack(alignment: .leading, spacing: 2) {
            Text(String(Int(day.suffix(2)) ?? 0))
                .foleviFont(.footnote)
                .fontWeight(isToday ? .bold : .medium)
                .monospacedDigit()
                .foregroundStyle(isToday ? Folevi.color.canvas : (inMonth ? Folevi.color.ink : Folevi.color.inkFaint))
                .frame(minWidth: 22, minHeight: 22)
                .background { if isToday { RoundedRectangle(cornerRadius: FoleviTokens.Radius.chip).fill(Folevi.color.heading) } }
            if compact {
                if items > 0 { Circle().fill(Folevi.color.inkFaint).frame(width: 5, height: 5).padding(.leading, 8) }
            } else {
                ForEach(dayEvents.prefix(limit)) { p in
                    HStack(spacing: 4) {
                        Circle().fill(CalendarMath.color(p.event.color)).frame(width: 6, height: 6)
                        Text(p.event.title.isEmpty ? "Untitled event" : p.event.title).lineLimit(1)
                    }
                    .foleviFont(.caption)
                    .foregroundStyle(Folevi.color.inkMuted)
                }
                ForEach(dayTasks.prefix(max(0, limit - min(limit, dayEvents.count))), id: \.id) { t in
                    HStack(spacing: 4) {
                        TaskBox(status: t.status, size: 11)
                        Text(t.title.isEmpty ? "Untitled task" : t.title).lineLimit(1).strikethrough(t.status == "done")
                    }
                    .foleviFont(.caption)
                    .foregroundStyle(t.overdue ? Folevi.color.destructive : Folevi.color.ink)
                    .draggable(t.id)
                }
                if items > limit {
                    Text("\(items - limit) more").foleviFont(.caption).foregroundStyle(Folevi.color.inkFaint)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(4)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .frame(minHeight: compact ? 44 : 86)
        .background(isSelected ? Folevi.color.ink.opacity(0.06) : .clear)
        .overlay(alignment: .top) { Rectangle().fill(Folevi.color.line).frame(height: 1) }
        .contentShape(Rectangle())
        .onTapGesture(count: 2) { if model.canEdit { onAdd(day) } }
        .onTapGesture { model.select(day); model.feedback.haptic(.selection) }
        .dropDestination(for: String.self) { ids, _ in
            guard let id = ids.first, let t = model.task(id: id) else { return false }
            Task { await model.reschedule(t, to: day) }
            return true
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(isToday ? "Today, " : "")\(TaskDates.format(day, "EEEEMMMMd")), \(items == 0 ? "nothing planned" : "\(items) items")")
        .accessibilityAddTraits(isSelected ? [.isSelected, .isButton] : .isButton)
        .accessibilityIdentifier("calendar-cell-\(day)")
    }
}
