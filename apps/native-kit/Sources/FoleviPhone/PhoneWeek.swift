// The Calendar's Week on the iPhone: under the week strip (which picks the day), the picked day and the two after
// it on an hour grid. Each column is headed by its weekday and date on the same column the blocks use; times sit
// in a gutter as "9 AM", one line each, centred on their hour's line; all-day tasks and events get a row of their
// own only when there are some; tasks with a time are 30-minute blocks and events sit at their times, side by side
// when they overlap; today has a line at the current time. It opens at the morning (or the current hour on
// today), and holding a task drags it to another time or day.
#if os(iOS)
import SwiftUI
import FoleviDesign
import FoleviEngine
import FoleviScreens

public struct PhoneWeekGrid: View {
    let model: CalendarModel
    let openEvent: (CalendarEvent) -> Void
    @Environment(\.colorScheme) private var scheme
    @State private var position = ScrollPosition(edge: .top)

    /// Days shown side by side.
    static let dayCount = 3
    static let gutter: CGFloat = 52
    static let hour: CGFloat = 56

    public init(model: CalendarModel, openEvent: @escaping (CalendarEvent) -> Void) {
        self.model = model
        self.openEvent = openEvent
    }

    private func c(_ pair: ColorPair) -> Color { pair.resolve(scheme).color }

    private var days: [String] { (0..<Self.dayCount).map { TaskDates.add(model.selected, days: $0) } }

    public var body: some View {
        let tasks = model.tasksByDay, events = model.eventsByDay
        let today = model.today
        let allDay = days.map { d in ((events[d] ?? []).filter(\.allDay), (tasks[d] ?? []).filter { $0.dueTime == nil }) }
        let hasAllDay = allDay.contains { !$0.0.isEmpty || !$0.1.isEmpty }
        VStack(spacing: 0) {
            header(today: today)
            if hasAllDay {
                allDayRow(allDay)
            }
            c(FoleviTokens.Chrome.line).frame(height: 1)
            ScrollView {
                ZStack(alignment: .topLeading) {
                    hourLines(hiding: days.contains(today) ? nowMinutes() : nil)
                    HStack(spacing: 0) {
                        Color.clear.frame(width: Self.gutter)
                        ForEach(days, id: \.self) { d in column(d, today: today, tasks: tasks[d] ?? [], events: events[d] ?? []) }
                    }
                    if days.contains(today) { nowMark(column: days.firstIndex(of: today) ?? 0) }
                }
                .frame(height: Self.hour * 24 + 16)
                .padding(.top, 8)
            }
            .scrollIndicators(.hidden)
            .scrollPosition($position)
            // Clear of the floating tab bar at the end of the day.
            .contentMargins(.bottom, 96, for: .scrollContent)
            .onAppear { position.scrollTo(y: Self.hour * CGFloat(startHour(today: today))) }
            .onChange(of: model.selected) { withAnimation(FoleviSpring.slide) { position.scrollTo(y: Self.hour * CGFloat(startHour(today: today))) } }
            // The screen under the title and the strip: the grid scrolls in what's left above the tab bar.
            .frame(height: max(360, PhoneWeekGrid.viewport))
        }
        .accessibilityIdentifier("calendar-week")
    }

    /// Where the grid opens: an hour before now on today, the morning otherwise.
    private func startHour(today: String) -> Int {
        days.contains(today) ? max(0, min(16, nowMinutes() / 60 - 1)) : 7
    }

    /// The height left for the hours: the screen less the bar, title, strip and tab bar.
    static var viewport: CGFloat {
        let h = UIScreen.main.bounds.height
        return h - 360
    }

    // MARK: Header and all day

    private func header(today: String) -> some View {
        HStack(spacing: 0) {
            Color.clear.frame(width: Self.gutter)
            ForEach(days, id: \.self) { d in
                let isToday = d == today
                let isSelected = d == model.selected
                Button { model.select(d) } label: {
                    HStack(spacing: 6) {
                        Text(TaskDates.format(d, "EEE").uppercased())
                            .webText(WebTextStyle(size: 12, leading: 16, weight: FoleviTokens.FontWeight.semibold, letterSpacing: 0.4))
                            .foregroundStyle(c(isToday ? FoleviTokens.Chrome.heading : FoleviTokens.Chrome.inkMuted))
                        Text("\(Int(d.suffix(2)) ?? 0)")
                            .webText(WebTextStyle(size: 15, leading: 20, weight: isToday || isSelected ? FoleviTokens.FontWeight.semibold : FoleviTokens.FontWeight.regular))
                            .monospacedDigit()
                            .foregroundStyle(c(isToday ? FoleviTokens.Chrome.canvas : FoleviTokens.Chrome.ink))
                            .frame(minWidth: 26, minHeight: 26)
                            .background {
                                if isToday { RoundedRectangle(cornerRadius: FoleviTokens.Radius.chip, style: .continuous).fill(c(FoleviTokens.Chrome.heading)) }
                            }
                    }
                    .frame(maxWidth: .infinity, minHeight: 40)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(isToday ? "Today, " : "")\(TaskDates.format(d, "EEEEMMMMd"))")
                .accessibilityAddTraits(.isHeader)
            }
        }
        .padding(.top, 4)
    }

    private func allDayRow(_ items: [([PlacedEvent], [TaskRow])]) -> some View {
        HStack(alignment: .top, spacing: 0) {
            Text("all-day")
                .webText(WebTextStyle(size: 11, leading: 14, weight: FoleviTokens.FontWeight.medium))
                .foregroundStyle(c(FoleviTokens.Chrome.inkFaint))
                .frame(width: Self.gutter - 8, alignment: .trailing)
                .padding(.trailing, 8)
                .padding(.top, 6)
            ForEach(Array(zip(days, items)), id: \.0) { day, item in
                VStack(alignment: .leading, spacing: 3) {
                    ForEach(item.0) { p in eventBlock(p.event, compact: true) }
                    ForEach(item.1, id: \.id) { t in taskBlock(t, compact: true) }
                }
                .padding(3)
                .frame(maxWidth: .infinity, minHeight: 32, alignment: .topLeading)
                .overlay(alignment: .leading) { c(FoleviTokens.Chrome.line).frame(width: 1) }
                .contentShape(Rectangle())
                .dropDestination(for: String.self) { ids, _ in
                    guard let id = ids.first, let t = model.task(id: id) else { return false }
                    Task { await model.reschedule(t, to: day, time: .clear) }
                    return true
                }
            }
        }
        .padding(.bottom, 4)
    }

    // MARK: The hours

    /// The hours' lines and labels; a label within 20 minutes of now (`hiding`) gives way to now's time.
    private func hourLines(hiding now: Int?) -> some View {
        VStack(spacing: 0) {
            ForEach(0..<24, id: \.self) { h in
                ZStack(alignment: .topLeading) {
                    c(FoleviTokens.Chrome.line).frame(height: 1).padding(.leading, Self.gutter)
                    if h > 0, now.map({ abs($0 - h * 60) >= 20 }) ?? true {
                        Text(Self.hourLabel(h))
                            .webText(WebTextStyle(size: 11, leading: 14, weight: FoleviTokens.FontWeight.medium))
                            .monospacedDigit()
                            .lineLimit(1)
                            .fixedSize()
                            .foregroundStyle(c(FoleviTokens.Chrome.inkFaint))
                            .frame(width: Self.gutter - 8, alignment: .trailing)
                            .offset(y: -7)
                    }
                }
                .frame(height: Self.hour, alignment: .top)
            }
        }
        .accessibilityHidden(true)
    }

    /// "9 AM", "12 PM", or "21" where the clock is 24-hour: short enough for one line in the gutter.
    static func hourLabel(_ h: Int) -> String {
        var parts = DateComponents()
        parts.hour = h
        guard let date = Calendar.current.date(from: parts) else { return "\(h)" }
        return date.formatted(.dateTime.hour(.defaultDigits(amPM: .abbreviated)))
    }

    private func column(_ day: String, today: String, tasks: [TaskRow], events: [PlacedEvent]) -> some View {
        let timed = tasks.filter { $0.dueTime != nil }
        let timedEvents = events.filter { !$0.allDay }
        var spans: [CalendarMath.Span] = timed.compactMap { t in
            TaskDates.minutes(t.dueTime).map { CalendarMath.Span(id: "t:\(t.id)", start: $0, end: $0 + CalendarMath.taskMinutes) }
        }
        spans += timedEvents.map { CalendarMath.Span(id: "e:\($0.id)", start: $0.startMinute, end: $0.endMinute) }
        let placed = Dictionary(uniqueKeysWithValues: CalendarMath.layoutOverlaps(spans).map { ($0.id, $0) })
        return GeometryReader { geo in
            let w = geo.size.width
            ZStack(alignment: .topLeading) {
                // Today's column a touch lighter, so it stands out.
                (day == today ? c(FoleviTokens.Chrome.ink).opacity(0.025) : Color.clear)
                c(FoleviTokens.Chrome.line).frame(width: 1).frame(maxHeight: .infinity)
                ForEach(timedEvents) { p in
                    if let pl = placed["e:\(p.id)"] {
                        place(x: w * CGFloat(pl.col) / CGFloat(pl.cols), width: w / CGFloat(pl.cols), start: pl.start, end: pl.end) {
                            eventBlock(p.event, compact: false)
                        }
                    }
                }
                ForEach(timed, id: \.id) { t in
                    if let pl = placed["t:\(t.id)"] {
                        place(x: w * CGFloat(pl.col) / CGFloat(pl.cols), width: w / CGFloat(pl.cols), start: pl.start, end: pl.end) {
                            taskBlock(t, compact: false)
                        }
                    }
                }
            }
            .contentShape(Rectangle())
            .dropDestination(for: String.self) { ids, location in
                guard let id = ids.first, let t = model.task(id: id) else { return false }
                let minutes = max(0, min(23 * 60 + 30, Int(location.y / Self.hour * 60) / 30 * 30))
                Task { await model.reschedule(t, to: day, time: .set(TaskDates.time(minutes))) }
                return true
            }
        }
        .frame(maxWidth: .infinity)
    }

    private func y(_ minutes: Int) -> CGFloat { CGFloat(minutes) / 60 * Self.hour }

    private func place<C: View>(x: CGFloat, width: CGFloat, start: Int, end: Int, @ViewBuilder content: () -> C) -> some View {
        content()
            .frame(width: max(0, width - 4), height: max(22, y(end - start) - 2), alignment: .topLeading)
            .offset(x: x + 2, y: y(start) + 1)
    }

    /// The current time: a line across today's column with a dot at its start, and the time in the gutter.
    private func nowMark(column: Int) -> some View {
        let now = nowMinutes()
        let ember = c(FoleviTokens.Chrome.ember)
        return GeometryReader { geo in
            let colWidth = (geo.size.width - Self.gutter) / CGFloat(Self.dayCount)
            let x = Self.gutter + colWidth * CGFloat(column)
            ZStack(alignment: .topLeading) {
                Text(Date.now.formatted(date: .omitted, time: .shortened))
                    .webText(WebTextStyle(size: 10, leading: 12, weight: FoleviTokens.FontWeight.semibold))
                    .lineLimit(1)
                    .fixedSize()
                    .foregroundStyle(ember)
                    .frame(width: Self.gutter - 6, alignment: .trailing)
                    .background(c(FoleviTokens.Chrome.canvas))
                    .offset(y: y(now) - 6)
                ember.frame(width: colWidth, height: 2).offset(x: x, y: y(now) - 1)
                Circle().fill(ember).frame(width: 8, height: 8).offset(x: x - 4, y: y(now) - 4)
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    // MARK: Blocks

    private func taskBlock(_ t: TaskRow, compact: Bool) -> some View {
        let done = t.status == "done"
        let tone = t.overdue ? FoleviTokens.Chrome.destructive : FoleviTokens.Chrome.heading
        return Button { model.open(t) } label: {
            HStack(alignment: .top, spacing: 5) {
                TaskBox(status: t.status, size: 12).padding(.top, 1)
                Text(t.title.isEmpty ? "Untitled task" : t.title)
                    .webText(WebTextStyle(size: 12, leading: 15, weight: FoleviTokens.FontWeight.medium))
                    .lineLimit(compact ? 1 : 3)
                    .strikethrough(done)
                    .foregroundStyle(c(done ? FoleviTokens.Chrome.inkMuted : FoleviTokens.Chrome.ink))
                Spacer(minLength: 0)
            }
            .padding(.leading, 7)
            .padding(.trailing, 4)
            .padding(.vertical, 4)
            .frame(maxWidth: .infinity, maxHeight: compact ? nil : .infinity, alignment: .topLeading)
            .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.tiny, style: .continuous).fill(c(tone).opacity(scheme == .dark ? 0.18 : 0.08)))
            .overlay(alignment: .leading) { Capsule().fill(c(tone)).frame(width: 3).padding(.vertical, 3).padding(.leading, 2) }
            .clipShape(RoundedRectangle(cornerRadius: FoleviTokens.Radius.tiny, style: .continuous))
        }
        .buttonStyle(PhoneBlockPressStyle())
        .draggable(t.id)
        .accessibilityLabel(TaskFacts.accessibility(t, today: model.today))
    }

    private func eventBlock(_ e: CalendarEvent, compact: Bool) -> some View {
        let tone = c(PhoneAgendaContent.color(e.color))
        return Button { openEvent(e) } label: {
            VStack(alignment: .leading, spacing: 1) {
                Text(e.title.isEmpty ? "Untitled event" : e.title)
                    .webText(WebTextStyle(size: 12, leading: 15, weight: FoleviTokens.FontWeight.semibold))
                    .lineLimit(compact ? 1 : 3)
                    .foregroundStyle(c(FoleviTokens.Chrome.ink))
                if !compact, !e.location.isEmpty {
                    Text(e.location).webText(WebTextStyle(size: 11, leading: 14)).lineLimit(1).foregroundStyle(c(FoleviTokens.Chrome.inkMuted))
                }
            }
            .padding(.leading, 7)
            .padding(.trailing, 4)
            .padding(.vertical, 4)
            .frame(maxWidth: .infinity, maxHeight: compact ? nil : .infinity, alignment: .topLeading)
            .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.tiny, style: .continuous).fill(tone.opacity(scheme == .dark ? 0.26 : 0.16)))
            .overlay(alignment: .leading) { Capsule().fill(tone).frame(width: 3).padding(.vertical, 3).padding(.leading, 2) }
            .clipShape(RoundedRectangle(cornerRadius: FoleviTokens.Radius.tiny, style: .continuous))
        }
        .buttonStyle(PhoneBlockPressStyle())
        .accessibilityLabel("\(e.title), \(CalendarMath.eventWhen(e, timeZone: model.timeZone)), from \(e.calendarName)")
    }

    private func nowMinutes() -> Int {
        TaskDates.minuteOfDay(ms: Int(ScreenClock.now().timeIntervalSince1970 * 1000), timeZone: model.timeZone)
    }
}

/// A block pressed dips a little, as cards do.
private struct PhoneBlockPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.pressDip(configuration.isPressed, scale: 0.97)
    }
}
#endif
