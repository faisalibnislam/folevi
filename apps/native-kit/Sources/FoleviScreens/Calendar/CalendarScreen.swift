// The Calendar (plan 5.8, owner decision D4; web iphone/Agenda.tsx, views/CalendarView.tsx). Compact (iPhone,
// narrow iPad): the month as the title, the week strip under it (pull down for the month), then the picked day and
// the days after it, each with its tasks and events; empty days are left out except the picked one, overdue tasks
// come first on today. Wide (iPad, Mac): Month, Week or Agenda with the picked day's list beside the month. The
// frame draws the bars: it reads `model.title` and puts `CalendarToolbarItems` beside it; frames without a title
// bar (the Mac's content area) pass `showsHeader: true`.
import SwiftUI
import FoleviDesign
import FoleviEngine

public struct CalendarScreen: View {
    @Bindable var model: CalendarModel
    let showsHeader: Bool
    @State private var width: CGFloat = 390
    @State private var monthOpen = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(model: CalendarModel, showsHeader: Bool = false) {
        self.model = model
        self.showsHeader = showsHeader
    }

    private var compact: Bool { width < 700 }

    public var body: some View {
        let layout = model.layout(compact: compact)
        let tasks = model.tasksByDay
        let events = model.eventsByDay
        VStack(spacing: 0) {
            if showsHeader || !compact { header(layout) }
            if compact {
                WeekStripView(model: model, marked: { model.marked($0, tasks: tasks, events: events) }, monthOpen: $monthOpen)
                    .background(Folevi.color.canvas)
                Rectangle().fill(Folevi.color.line).frame(height: 1)
            }
            switch layout {
            case .agenda:
                AgendaList(model: model)
            case .month:
                if compact {
                    AgendaList(model: model)
                } else {
                    HStack(spacing: 0) {
                        MonthGridView(model: model, compact: false, tasks: tasks, events: events, onAdd: { model.addingOn = $0 })
                            .padding(.horizontal, 12)
                        Rectangle().fill(Folevi.color.line).frame(width: 1)
                        AgendaList(model: model, onlySelected: true).frame(width: min(360, width * 0.32))
                    }
                }
            case .week:
                WeekGridView(model: model, days: compact ? (0..<3).map { TaskDates.add(model.selected, days: $0) } : TaskDates.week(of: model.selected), tasks: tasks, events: events, onOpenEvent: { model.openEvent = $0 })
            }
        }
        .background(Folevi.color.canvas)
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        .onChange(of: model.tasks.value) { _, _ in model.reconcile() }
        .onAppear { model.setVisible(true) }
        .onDisappear { model.setVisible(false) }
        .sheet(isPresented: Binding(get: { model.detail != nil }, set: { if !$0 { model.detail = nil } })) {
            if let task = model.detail { TaskDetailSheet(model: model, taskId: task.id, initial: task) }
        }
        .sheet(isPresented: Binding(get: { model.openEvent != nil }, set: { if !$0 { model.openEvent = nil } })) {
            if let e = model.openEvent { EventDetailSheet(event: e, timeZone: model.timeZone) }
        }
        .sheet(isPresented: Binding(get: { model.addingOn != nil }, set: { if !$0 { model.addingOn = nil } })) {
            if let day = model.addingOn { AddTaskOnDaySheet(model: model, day: day) }
        }
        .sheet(isPresented: $model.showsCalendars) { CalendarsSheet(model: model) }
        .background { keyboardCommands(layout) }
        .accessibilityIdentifier("calendar-screen")
    }

    /// The title row of wide layouts and the Mac: the month, back and forward, Today, the layouts, Calendars.
    private func header(_ layout: CalendarLayout) -> some View {
        HStack(spacing: 10) {
            Text(model.title).foleviFont(compact ? .title : .largeTitle).foregroundStyle(Folevi.color.heading).lineLimit(1)
            Spacer(minLength: 8)
            if !compact {
                Button { model.page(-1, layout: layout) } label: { Image(systemName: "chevron.left").frame(width: 32, height: 32) }
                    .buttonStyle(.plain).accessibilityLabel("Previous")
                Button("Today") { model.goToday() }.buttonStyle(.folevi(.secondary, size: .small)).disabled(model.selected == model.today)
                Button { model.page(1, layout: layout) } label: { Image(systemName: "chevron.right").frame(width: 32, height: 32) }
                    .buttonStyle(.plain).accessibilityLabel("Next")
                SegmentedControl(selection: Binding(get: { layout }, set: { model.choose($0) }), options: CalendarLayout.allCases.map { ($0, $0.title) })
                    .frame(width: 240)
                    .accessibilityIdentifier("calendar-layout")
            }
            CalendarToolbarItems(model: model, compact: compact)
        }
        .foregroundStyle(Folevi.color.ink)
        .padding(.horizontal, compact ? 16 : 24)
        .padding(.top, compact ? 8 : 16)
        .padding(.bottom, 8)
    }

    @ViewBuilder
    private func keyboardCommands(_ layout: CalendarLayout) -> some View {
        Group {
            Button("Today") { model.goToday() }.keyboardShortcut("t", modifiers: .command)
            Button("Previous") { model.page(-1, layout: layout) }.keyboardShortcut(.leftArrow, modifiers: .command)
            Button("Next") { model.page(1, layout: layout) }.keyboardShortcut(.rightArrow, modifiers: .command)
            Button("New task") { if model.canEdit { model.addingOn = model.selected } }.keyboardShortcut("n", modifiers: .command)
        }
        .hidden()
    }
}

/// The agenda: the picked day and the days after it with something on (or only the picked day, beside the month).
struct AgendaList: View {
    let model: CalendarModel
    var onlySelected = false

    var body: some View {
        let today = model.today
        let days = onlySelected ? Array(model.agenda.prefix(1)) : model.agenda
        ScrollViewReader { proxy in
            List {
                ForEach(days) { day in
                    Section {
                        if day.isEmpty {
                            Text("Nothing planned")
                                .font(FoleviFonts.font(.display, size: 15, italic: true, relativeTo: .body))
                                .foregroundStyle(Folevi.color.inkFaint)
                                .padding(.horizontal, 20)
                                .frame(minHeight: 56, alignment: .leading)
                                .rowStyle()
                        }
                        ForEach(day.overdue + day.tasks, id: \.id) { t in
                            TaskLineView(task: t, today: today, showNote: true, onDay: true, onToggle: { model.toggle(t) }, onOpen: { model.open(t) })
                                .rowStyle()
                                .draggable(t.id)
                                .swipeActions(edge: .leading, allowsFullSwipe: true) {
                                    Button { model.toggle(t) } label: { Label(t.status == "open" ? "Done" : "Reopen", systemImage: t.status == "open" ? "checkmark" : "arrow.uturn.backward") }
                                        .tint(t.status == "open" ? Folevi.color.moss : Folevi.color.inkMuted)
                                }
                                .swipeActions(edge: .trailing) {
                                    if t.status == "open" && model.canEdit {
                                        Button { model.open(t) } label: { Label("Date", systemImage: "calendar.badge.clock") }.tint(Color(red: 0.36, green: 0.42, blue: 0.82))
                                        Button { Task { await model.reschedule(t, to: TaskDates.add(day.day, days: 1)) } } label: { Label("Next day", systemImage: "arrow.right") }.tint(Folevi.color.marigold)
                                    }
                                }
                        }
                        ForEach(day.events) { p in
                            CalendarEventRow(placed: p) { model.openEvent = p.event }.rowStyle()
                        }
                    } header: {
                        CalendarDayHeader(day: day.day, today: today, canAdd: model.canEdit) { model.addingOn = day.day }
                            .listRowInsets(EdgeInsets())
                            .background(Folevi.color.canvas)
                            .dropDestination(for: String.self) { ids, _ in
                                guard let id = ids.first, let t = model.task(id: id) else { return false }
                                Task { await model.reschedule(t, to: day.day) }
                                return true
                            }
                    }
                    .id(day.day)
                }
                if !onlySelected && days.count <= 1 {
                    Text("Nothing else in the next 30 days.").foleviFont(.callout).foregroundStyle(Folevi.color.inkMuted)
                        .frame(maxWidth: .infinity).padding(.top, 24).rowStyle()
                }
                Color.clear.frame(height: 100).rowStyle()
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .environment(\.defaultMinListRowHeight, 1)
            .refreshable { await model.refresh() }
            .onChange(of: model.selected) { _, d in withAnimation(.folevi()) { proxy.scrollTo(d, anchor: .top) } }
        }
        .accessibilityIdentifier("calendar-agenda")
    }
}

private extension View {
    func rowStyle() -> some View {
        listRowInsets(EdgeInsets())
            .listRowSeparator(.hidden)
            .listRowBackground(Folevi.color.canvas)
    }
}

/// Bar items beside the Calendar's title: Today (when another day is picked) and More (the layouts, Calendars,
/// Refresh). The iPhone frame puts them in its navigation bar; wide layouts draw them in their own header.
public struct CalendarToolbarItems: View {
    let model: CalendarModel
    let compact: Bool
    private let send = IntentSender()
    public init(model: CalendarModel, compact: Bool = true) {
        self.model = model
        self.compact = compact
    }

    public var body: some View {
        HStack(spacing: 4) {
            if compact && model.selected != model.today {
                Button("Today") { model.goToday() }
                    .buttonStyle(.folevi(.secondary, size: .small))
                    .accessibilityIdentifier("calendar-today")
            }
            Menu {
                if compact {
                    Picker("Layout", selection: Binding(get: { model.layout(compact: true) }, set: { model.choose($0) })) {
                        Label("Agenda", systemImage: "list.bullet").tag(CalendarLayout.agenda)
                        Label("Three days", systemImage: "calendar.day.timeline.left").tag(CalendarLayout.week)
                    }
                    .pickerStyle(.inline)
                    Divider()
                }
                if model.canEdit {
                    Button { model.addingOn = model.selected } label: { Label("New task on this day", systemImage: "plus") }
                }
                Button { model.openCalendars() } label: { Label("Calendars…", systemImage: "calendar.badge.plus") }
                Button { send(.openTasks(.upcoming)) } label: { Label("Upcoming tasks", systemImage: "checklist") }
                Divider()
                Button { Task { await model.refresh() } } label: { Label("Refresh", systemImage: "arrow.clockwise") }
            } label: {
                Image(systemName: "ellipsis").font(.system(size: 15, weight: .medium)).foregroundStyle(Folevi.color.ink).frame(width: 30, height: 30)
            }
            .menuStyle(.button)
            .buttonStyle(.plain)
            .menuIndicator(.hidden)
            .fixedSize()
            .accessibilityLabel("More")
            .accessibilityIdentifier("calendar-more")
        }
    }
}
