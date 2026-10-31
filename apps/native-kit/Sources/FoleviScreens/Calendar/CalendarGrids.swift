// The Calendar's Week and Month grids for a host that draws its own frame around them (the iPhone's rebuild frame:
// its Calendar shows the agenda natively and these two from its "…" menu, as the web's iPhone layout does).
import SwiftUI
import FoleviDesign
import FoleviEngine

/// The month grid (compact): a day picked selects it, + on a day adds a task there.
public struct CalendarMonthGrid: View {
    let model: CalendarModel

    public init(model: CalendarModel) { self.model = model }

    public var body: some View {
        MonthGridView(model: model, compact: true, tasks: model.tasksByDay, events: model.eventsByDay, onAdd: { model.addingOn = $0 })
    }
}

/// Three days from the picked one on the hour grid (it scrolls itself).
public struct CalendarWeekGrid: View {
    let model: CalendarModel

    public init(model: CalendarModel) { self.model = model }

    public var body: some View {
        WeekGridView(model: model, days: (0..<3).map { TaskDates.add(model.selected, days: $0) }, tasks: model.tasksByDay, events: model.eventsByDay, onOpenEvent: { model.openEvent = $0 })
    }
}
