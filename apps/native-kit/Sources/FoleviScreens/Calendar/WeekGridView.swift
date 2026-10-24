// The week (web views/CalendarWeek.tsx): an all-day row for tasks with a date and no time and all-day events,
// and an hour grid where tasks with a time sit as 30-minute blocks and events at their times, side by side when
// they overlap, with a line at the current time. Drop a task on a day's all-day cell to give it that date, or on
// the hour grid to set the date and the time (30-minute steps). Narrow widths show three days.
import SwiftUI
import FoleviDesign
import FoleviEngine

struct WeekGridView: View {
    let model: CalendarModel
    let days: [String]
    let tasks: [String: [TaskRow]]
    let events: [String: [PlacedEvent]]
    let onOpenEvent: (CalendarEvent) -> Void
    private let gutter: CGFloat = 46
    private let hour = CalendarMath.hourHeight

    var body: some View {
        let today = model.today
        VStack(spacing: 0) {
            header(today: today)
            allDayRow
            Rectangle().fill(Folevi.color.line).frame(height: 1)
            ScrollViewReader { proxy in
                ScrollView {
                    ZStack(alignment: .topLeading) {
                        hourLines
                        HStack(spacing: 0) {
                            Color.clear.frame(width: gutter)
                            ForEach(days, id: \.self) { day in dayColumn(day, today: today) }
                        }
                    }
                    .frame(height: hour * 24)
                    .id("grid")
                    .overlay(alignment: .topLeading) {
                        Color.clear.frame(height: 1).offset(y: CalendarMath.y(minutes: CalendarMath.firstVisibleHour * 60)).id("start")
                    }
                }
                .onAppear { proxy.scrollTo("start", anchor: .top) }
            }
        }
        .accessibilityIdentifier("calendar-week")
    }

    private func header(today: String) -> some View {
        HStack(spacing: 0) {
            Color.clear.frame(width: gutter)
            ForEach(days, id: \.self) { d in
                VStack(spacing: 1) {
                    Text(TaskDates.format(d, "EEE")).foleviFont(.caps).foregroundStyle(Folevi.color.inkFaint)
                    Text(String(Int(d.suffix(2)) ?? 0))
                        .foleviFont(.headline).monospacedDigit()
                        .foregroundStyle(d == today ? Folevi.color.canvas : Folevi.color.ink)
                        .frame(width: 30, height: 30)
                        .background { if d == today { RoundedRectangle(cornerRadius: FoleviTokens.Radius.small).fill(Folevi.color.heading) } }
                }
                .frame(maxWidth: .infinity)
                .contentShape(Rectangle())
                .onTapGesture { model.select(d) }
                .accessibilityElement(children: .combine)
                .accessibilityAddTraits(.isHeader)
            }
        }
        .padding(.vertical, 6)
    }

    private var allDayRow: some View {
        HStack(alignment: .top, spacing: 0) {
            Text("All day").foleviFont(.caption).foregroundStyle(Folevi.color.inkFaint).frame(width: gutter, alignment: .leading).padding(.leading, 4)
            ForEach(days, id: \.self) { day in
                VStack(alignment: .leading, spacing: 2) {
                    ForEach((events[day] ?? []).filter(\.allDay)) { p in eventChip(p.event) }
                    ForEach((tasks[day] ?? []).filter { $0.dueTime == nil }, id: \.id) { t in taskChip(t) }
                }
                .padding(2)
                .frame(maxWidth: .infinity, minHeight: 30, alignment: .topLeading)
                .overlay(alignment: .leading) { Rectangle().fill(Folevi.color.line).frame(width: 1) }
                .contentShape(Rectangle())
                .dropDestination(for: String.self) { ids, _ in
                    guard let id = ids.first, let t = model.task(id: id) else { return false }
                    Task { await model.reschedule(t, to: day, time: .clear) }
                    return true
                }
            }
        }
    }

    private var hourLines: some View {
        VStack(spacing: 0) {
            ForEach(0..<24, id: \.self) { h in
                HStack(alignment: .top, spacing: 4) {
                    Text(h == 0 ? "" : TaskDates.timeLabel(TaskDates.time(h * 60)))
                        .foleviFont(.caption).foregroundStyle(Folevi.color.inkFaint)
                        .frame(width: gutter - 6, alignment: .trailing)
                        .offset(y: -7)
                    Rectangle().fill(Folevi.color.line).frame(height: 1)
                }
                .frame(height: hour, alignment: .top)
            }
        }
        .accessibilityHidden(true)
    }

    private func dayColumn(_ day: String, today: String) -> some View {
        let timed = (tasks[day] ?? []).filter { $0.dueTime != nil }
        let timedEvents = (events[day] ?? []).filter { !$0.allDay }
        var spans: [CalendarMath.Span] = timed.compactMap { t in
            TaskDates.minutes(t.dueTime).map { CalendarMath.Span(id: "t:\(t.id)", start: $0, end: $0 + CalendarMath.taskMinutes) }
        }
        spans += timedEvents.map { CalendarMath.Span(id: "e:\($0.id)", start: $0.startMinute, end: $0.endMinute) }
        let placed = Dictionary(uniqueKeysWithValues: CalendarMath.layoutOverlaps(spans).map { ($0.id, $0) })
        return GeometryReader { geo in
            let w = geo.size.width
            ZStack(alignment: .topLeading) {
                Rectangle().fill(Folevi.color.line).frame(width: 1).frame(maxHeight: .infinity)
                ForEach(timedEvents) { p in
                    if let pl = placed["e:\(p.id)"] {
                        block(x: w * CGFloat(pl.col) / CGFloat(pl.cols), width: w / CGFloat(pl.cols), start: pl.start, end: pl.end) {
                            eventChip(p.event)
                        }
                    }
                }
                ForEach(timed, id: \.id) { t in
                    if let pl = placed["t:\(t.id)"] {
                        block(x: w * CGFloat(pl.col) / CGFloat(pl.cols), width: w / CGFloat(pl.cols), start: pl.start, end: pl.end) {
                            taskChip(t)
                        }
                    }
                }
                if day == today {
                    let now = nowMinutes()
                    Rectangle().fill(Folevi.color.ember).frame(width: w, height: 1.5).offset(y: CalendarMath.y(minutes: now))
                        .accessibilityHidden(true)
                }
            }
            .contentShape(Rectangle())
            .dropDestination(for: String.self) { ids, location in
                guard let id = ids.first, let t = model.task(id: id) else { return false }
                let slot = CalendarMath.slot(atY: location.y)
                Task { await model.reschedule(t, to: day, time: .set(TaskDates.time(slot))) }
                return true
            }
        }
        .frame(maxWidth: .infinity)
    }

    private func block<C: View>(x: CGFloat, width: CGFloat, start: Int, end: Int, @ViewBuilder content: () -> C) -> some View {
        content()
            .frame(width: max(0, width - 3), height: max(18, CalendarMath.y(minutes: end - start) - 2), alignment: .topLeading)
            .offset(x: x + 1.5, y: CalendarMath.y(minutes: start) + 1)
    }

    private func taskChip(_ t: TaskRow) -> some View {
        Button { model.open(t) } label: {
            HStack(alignment: .top, spacing: 4) {
                TaskBox(status: t.status, size: 12).padding(.top, 2)
                Text(t.title.isEmpty ? "Untitled task" : t.title).lineLimit(2).strikethrough(t.status == "done")
                Spacer(minLength: 0)
            }
            .foleviFont(.caption)
            .foregroundStyle(Folevi.color.ink)
            .padding(.horizontal, 5)
            .padding(.vertical, 3)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.tiny, style: .continuous).fill(Folevi.color.surfaceRaised))
            .overlay(RoundedRectangle(cornerRadius: FoleviTokens.Radius.tiny, style: .continuous).strokeBorder(Folevi.color.line))
        }
        .buttonStyle(.plain)
        .draggable(t.id)
        .accessibilityLabel(TaskFacts.accessibility(t, today: model.today))
    }

    private func eventChip(_ e: CalendarEvent) -> some View {
        Button { onOpenEvent(e) } label: {
            HStack(alignment: .top, spacing: 4) {
                Capsule().fill(CalendarMath.color(e.color)).frame(width: 3)
                Text(e.title.isEmpty ? "Untitled event" : e.title).lineLimit(2)
                Spacer(minLength: 0)
            }
            .foleviFont(.caption)
            .foregroundStyle(Folevi.color.inkMuted)
            .padding(.horizontal, 4)
            .padding(.vertical, 3)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.tiny, style: .continuous).fill(CalendarMath.color(e.color).opacity(0.12)))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(e.title), \(CalendarMath.eventWhen(e, timeZone: model.timeZone)), from \(e.calendarName)")
    }

    private func nowMinutes() -> Int {
        TaskDates.minuteOfDay(ms: Int(ScreenClock.now().timeIntervalSince1970 * 1000), timeZone: model.timeZone)
    }
}
