// Tasks on the Mac, drawn as the web's (views/TasksView.tsx in the Mac app's frame): the view's facts and its
// actions in a row (Calendar, Add task), the views as a segmented control with counts (Inbox, Today, Upcoming,
// All, Completed, My Tasks), the filter, then the tasks in a card (Upcoming by day). The data is TasksModel's
// (the engine's `tasks.list` and `tasks.counts`), in the web's order. Command-N adds a task, Command-F filters,
// Command-1 to Command-6 pick a view.
#if os(macOS)
import AppKit
import SwiftUI
import FoleviDesign
import FoleviEngine
import FoleviScreens

/// The web's views in its order, with their words.
enum WebTaskView {
    static let all: [(TaskViewName, String)] = [(.inbox, "Inbox"), (.today, "Today"), (.upcoming, "Upcoming"), (.all, "All"), (.completed, "Completed"), (.mine, "My Tasks")]

    static func label(_ v: TaskViewName) -> String { all.first { $0.0 == v }?.1 ?? "Tasks" }

    static func empty(_ v: TaskViewName, personal: Bool) -> (String, String?) {
        switch v {
        case .inbox: return ("No undated tasks", "Tasks without a due date land here.")
        case .today: return ("Nothing due today", "Enjoy the quiet.")
        case .upcoming: return ("Nothing scheduled ahead", nil)
        case .all: return ("No open tasks", nil)
        case .completed: return ("Nothing completed yet", "Completed and canceled tasks appear here.")
        case .mine: return personal ? ("No open tasks", "In Personal every unassigned task is yours.") : ("Nothing is assigned to you", nil)
        }
    }
}

struct WebTasksScreen: View {
    @Bindable var model: TasksModel
    let frame: FrameModel
    @State private var tasks: PlannerTasks
    @FocusState private var filterFocused: Bool
    @Environment(\.colorScheme) private var scheme

    init(model: TasksModel, frame: FrameModel) {
        self.model = model
        self.frame = frame
        _tasks = State(initialValue: PlannerTasks(frame: frame, host: model))
    }

    /// The rows in the web's order (convex/tasks.ts list: by due date, then time, newest change first;
    /// Completed as it comes), with changes made here, without those that left.
    var rows: [TaskRow] {
        guard let v = model.list.value, v.view == model.view else { return [] }
        let all = v.groups.flatMap(\.tasks).filter { !model.edits.isGone($0.id) }
        let sorted = model.view == .completed ? all : all.sorted { a, b in
            let ad = a.dueDate ?? "9999", bd = b.dueDate ?? "9999"
            if ad != bd { return ad < bd }
            let at = a.dueTime ?? "99", bt = b.dueTime ?? "99"
            if at != bt { return at < bt }
            return a.updatedAt > b.updatedAt
        }
        let needle = model.filter.lowercased()
        return sorted.filter { needle.isEmpty || $0.title.lowercased().contains(needle) || $0.noteTitle.lowercased().contains(needle) }
    }

    var body: some View {
        let shown = rows
        let loading = model.list.value?.view != model.view
        let content = PS("tasks.content").resolve(scheme)
        ScrollView {
            VStack(spacing: 0) {
                header(count: loading ? nil : shown.count)
                VStack(alignment: .leading, spacing: 0) {
                    seg
                    PlannerField(placeholder: "Filter by task or page", text: $model.filter, style: "tasks.filter", focused: $filterFocused)
                        .padding(.top, 16)
                        .accessibilityLabel("Filter tasks")
                    if loading {
                        VStack(spacing: 8) {
                            ForEach(0..<3, id: \.self) { _ in
                                RoundedRectangle(cornerRadius: 6, style: .circular).fill(PV("color-surface").c(scheme)).frame(height: 48)
                            }
                        }
                        .padding(.top, 24)
                    } else if shown.isEmpty {
                        let e = WebTaskView.empty(model.view, personal: !model.inWorkspace)
                        let filtered = !model.filter.isEmpty
                        PlannerEmpty(icon: .squareCheckBig, title: filtered ? "No tasks match that filter" : e.0, message: filtered ? nil : e.1)
                    } else if model.view == .upcoming {
                        ForEach(groups(shown), id: \.0) { key, label, items in
                            VStack(alignment: .leading, spacing: 0) {
                                let g = PS("tasks.group.title").resolve(scheme)
                                Text(label.uppercased()).webText(g.text).lineLimit(1).foregroundStyle(g.color.color).padding(.bottom, g.margin.bottom)
                                card(items)
                            }
                            .padding(.top, 24)
                        }
                    } else {
                        card(shown).padding(.top, 24)
                    }
                }
                .padding(content.padding.edgeInsets)
                .frame(maxWidth: content.width)
                .frame(maxWidth: .infinity)
            }
        }
        .scrollIndicators(.automatic)
        .background(TasksKeys(model: model, open: { frame.showQuickAdd(in: tasks.window) }, filter: { filterFocused = true }))
        .plannerAnchor(tasks.anchor)
        .onChange(of: model.list.value) { _, _ in model.reconcile() }
        // Scripts open the dialogs (the Debug app's `frame {"do":"post"}`): "quick", "edit" (the first task).
        .onReceive(NotificationCenter.default.publisher(for: .init("folevi.planner.show"))) { n in
            switch n.object as? String {
            case "quick": frame.showQuickAdd(in: tasks.window)
            case "edit": if let t = rows.first { tasks.edit(t) }
            case "menu": if let t = rows.first, let w = tasks.window { WebMenuWindow.show(tasks.menu(t), at: NSPoint(x: 600, y: 520), in: w) }
            default: break
            }
        }
        .onAppear { model.setVisible(true) }
        .onDisappear { model.setVisible(false) }
        .accessibilityIdentifier("tasks-screen")
    }

    private func header(count: Int?) -> some View {
        let h = PS("header").resolve(scheme)
        let label = WebTaskView.label(model.view)
        return HStack(spacing: h.gap) {
            StyledText(count.map { "\(label) · \($0) \(model.view == .completed ? "done" : "open")" } ?? label, "header.subtitle")
                .accessibilityAddTraits(.updatesFrequently)
            Spacer(minLength: 0)
            HStack(spacing: 6) {
                PlannerButton("Calendar", icon: .calendarDays, style: "header.calendar") { frame.open(.calendar(nil)) }
                PlannerButton("Add task", icon: .plus, style: "header.add", hover: nil) { frame.showQuickAdd(in: tasks.window) }
                    .foleviTooltip("(⌘N)")
            }
        }
        .padding(h.padding.edgeInsets)
        .frame(height: h.height)
        .padding(h.margin.edgeInsets)
    }

    private var seg: some View {
        WebSeg(
            items: WebTaskView.all.map { v, title in SegItem(id: v.rawValue, title: title, count: model.count(for: v)) },
            selected: model.view.rawValue,
            base: "tasks.seg",
            countStyle: "tasks.seg.count"
        ) { id in
            if let v = TaskViewName(rawValue: id) { frame.open(.tasks(v), .replace) }
        }
        .foleviTooltip("Every task lives in a note. Open its page to see the context it was written in.")
    }

    private func card(_ items: [TaskRow]) -> some View {
        TaskCard {
            ForEach(items, id: \.id) { t in PlannerTaskRow(raw: t, tasks: tasks) }
        }
    }

    /// Upcoming by day, in the list's order ("No date" for tasks without one).
    private func groups(_ items: [TaskRow]) -> [(String, String, [TaskRow])] {
        var order: [String] = []
        var by: [String: [TaskRow]] = [:]
        for t in items {
            let k = t.dueDate ?? "none"
            if by[k] == nil { order.append(k) }
            by[k, default: []].append(t)
        }
        return order.map { k in (k, k == "none" ? "No date" : PlannerDates.long(k), by[k] ?? []) }
    }
}

/// The screen's keys: Command-N adds a task, Command-F filters, Command-1 to 6 pick a view.
private struct TasksKeys: View {
    let model: TasksModel
    let open: () -> Void
    let filter: () -> Void

    var body: some View {
        ZStack {
            Button("Add task", action: open).keyboardShortcut("n", modifiers: .command)
            Button("Filter", action: filter).keyboardShortcut("f", modifiers: .command)
            ForEach(Array(WebTaskView.all.enumerated()), id: \.offset) { i, v in
                Button(v.1) { model.select(v.0) }.keyboardShortcut(KeyEquivalent(Character("\(i + 1)")), modifiers: .command)
            }
        }
        .opacity(0)
        .frame(width: 0, height: 0)
        .accessibilityHidden(true)
    }
}
#endif
