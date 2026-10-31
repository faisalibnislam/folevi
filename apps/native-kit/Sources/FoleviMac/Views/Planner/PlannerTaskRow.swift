// A task as the web's TaskItem draws it (views/TasksView.tsx): the box, the title, its page and facts under it,
// priority, repeat and due date on the right, and Edit on hover; a right click opens the web's task menu (Mark as
// done, Edit task, Move to, Open note, Open in new tab). What the rows do (tick with Undo, edit, move) is shared
// by Tasks and the Calendar through `PlannerTasks`.
#if os(macOS) || os(iOS)
#if os(macOS)
import AppKit
#else
import UIKit
#endif
import SwiftUI
import FoleviDesign
import FoleviEngine
import FoleviScreens

/// What a task row can do, for the screen it's on (Tasks or the Calendar).
@MainActor
final class PlannerTasks {
    let frame: FrameModel
    let host: any TaskSheetHost
    let anchor = PlannerAnchor()

    init(frame: FrameModel, host: any TaskSheetHost) {
        self.frame = frame
        self.host = host
    }

    var edits: TaskEdits { host.edits }
    var today: String { host.today }
    var window: NSWindow? { anchor.view?.window ?? NSApp.keyWindow }

    /// useToggleTask: an open task is completed, a done one reopened, a canceled one reopened; each with Undo.
    func toggle(_ raw: TaskRow) {
        let t = edits.shown(raw)
        let edits = self.edits
        let frame = self.frame
        if t.status == "canceled" {
            Task {
                if await edits.update(t, TaskPatchArgs(id: t.id, canceled: false)) {
                    frame.toast("Task reopened", actionTitle: "Undo") { Task { _ = await edits.update(t, TaskPatchArgs(id: t.id, canceled: true)) } }
                }
            }
            return
        }
        let checked = t.status != "done"
        Task {
            if await edits.update(t, TaskPatchArgs(id: t.id, checked: checked)) {
                frame.toast(checked ? "Task completed" : "Task reopened", actionTitle: "Undo") {
                    Task { _ = await edits.update(t, TaskPatchArgs(id: t.id, checked: !checked)) }
                }
            }
        }
    }

    /// Edit task (TaskEditDialog).
    func edit(_ t: TaskRow) {
        guard let window else { return }
        let task = edits.shown(t)
        PlannerPanel.dialog(in: window) { close in
            TaskEditDialog(tasks: self, task: task, close: close)
        }
    }

    /// Move to… (MoveTaskDialog).
    func move(_ t: TaskRow) {
        guard let window else { return }
        PlannerPanel.dialog(in: window) { close in
            MoveTaskDialog(tasks: self, task: t, close: close)
        }
    }

    func openNote(_ t: TaskRow) { frame.open(.note(t.noteId)) }

    /// Gives a task a date (and a time: nil keeps it, "" clears it), with "Moved to Oct 30" and Undo.
    func reschedule(_ t: TaskRow, to date: String, time: String?? = .none) {
        let cur = edits.shown(t)
        if cur.dueDate == date, time == nil || time! == cur.dueTime { return }
        var when = PlannerDates.format(date, "MMMd")
        let field: PatchField<String>
        switch time {
        case .none: field = .keep
        case .some(.none): field = .clear
        case .some(.some(let v)):
            field = .set(v)
            when += ", \(v)"
        }
        let edits = self.edits
        let frame = self.frame
        Task {
            let before = cur
            if await edits.update(cur, TaskPatchArgs(id: cur.id, dueDate: .set(date), dueTime: field)) {
                frame.toast("Moved to \(when)", actionTitle: "Undo") {
                    Task {
                        _ = await edits.update(before, TaskPatchArgs(id: before.id, dueDate: before.dueDate.map { .set($0) } ?? .clear, dueTime: before.dueDate != nil ? (before.dueTime.map { .set($0) } ?? .clear) : .clear))
                    }
                }
            }
        }
    }

    func menu(_ t: TaskRow, canEdit: Bool = true) -> [WebMenuEntry] {
        let task = edits.shown(t)
        var out: [WebMenuEntry] = []
        if task.status == "open" {
            out.append(WebMenuEntry(.item("Mark as done", icon: .check)) { self.toggle(task) })
        } else {
            out.append(WebMenuEntry(.item(task.status == "canceled" ? "Reopen" : "Mark as not done", icon: .rotateCcw)) { self.toggle(task) })
        }
        if canEdit { out.append(WebMenuEntry(.item("Edit task…", icon: .slidersHorizontal)) { self.edit(task) }) }
        out.append(WebMenuEntry(.item("Move to…", icon: .arrowRightLeft)) { self.move(task) })
        out.append(.separator())
        out.append(WebMenuEntry(.item("Open note", icon: .fileText)) { self.openNote(task) })
        out.append(WebMenuEntry(.item("Open in new tab", icon: .externalLink)) { self.frame.open(.note(task.noteId), .newTab) })
        return out
    }
}

/// The checkbox (role=checkbox): open, done (the moss gradient and a tick), or canceled (a dash).
struct TaskBox: View {
    let status: String
    let toggle: () -> Void
    @Environment(\.colorScheme) private var scheme
    @State private var over = false

    var body: some View {
        let done = status == "done"
        let style = PS(done ? "tasks.check.done" : "tasks.check")
        let s = style.resolve(scheme)
        Button(action: toggle) {
            ZStack {
                if status == "canceled" {
                    RoundedRectangle(cornerRadius: s.radius, style: .circular).fill(PV("color-surface-sunken").c(scheme))
                    RoundedRectangle(cornerRadius: s.radius, style: .circular).strokeBorder(PV("color-line-strong").c(scheme), lineWidth: s.borderWidth)
                    Text("–").webText(.role(.footnote)).foregroundStyle(PV("color-ink-faint").c(scheme))
                } else {
                    Color.clear.webBox(style)
                    if done {
                        Text("✓").webText(WebTextStyle(size: 12, leading: 12)).foregroundStyle(s.color.color)
                            .transition(.scale(scale: 0.6).combined(with: .opacity))
                    } else if over {
                        RoundedRectangle(cornerRadius: s.radius, style: .circular).strokeBorder(PV("color-moss").c(scheme), lineWidth: s.borderWidth)
                    }
                }
            }
            .frame(width: s.width, height: s.height)
            .contentShape(Rectangle())
            // Done: the fill eases in and the tick settles (the web's `transition-colors`, 150 ms).
            .animation(WebMotion.reduced ? nil : .easeOut(duration: 0.15), value: status)
        }
        .buttonStyle(PlainPress())
        .onHover { over = $0 }
        .accessibilityAddTraits(.isToggle)
        .accessibilityValue(done ? "checked" : "unchecked")
    }
}

/// One task (TaskItem). `action` goes under the facts (the Calendar's "Schedule for today").
struct PlannerTaskRow<Action: View>: View {
    let raw: TaskRow
    let tasks: PlannerTasks
    var editable = true
    @ViewBuilder var action: () -> Action
    @Environment(\.colorScheme) private var scheme
    @State private var over = false
    @State private var overLink = false

    var body: some View {
        let t = tasks.edits.shown(raw)
        let today = tasks.today
        let row = PS("tasks.row").resolve(scheme)
        let closed = t.status != "open"
        let overdue = t.status == "open" && (t.dueDate.map { $0 < today } ?? false)
        let muted = PV("color-ink-muted").c(scheme)
        HStack(alignment: .top, spacing: row.gap) {
            TaskBox(status: t.status) { tasks.toggle(t) }
                .padding(.top, PS("tasks.check").resolve(scheme).margin.top)
                .topAligned()
                .accessibilityLabel(t.status == "done" ? "Mark “\(t.title)” as not done" : t.status == "canceled" ? "Reopen canceled task “\(t.title)”" : "Mark “\(t.title)” as done")
            VStack(alignment: .leading, spacing: 0) {
                let title = PS(closed ? "tasks.title.done" : "tasks.title").resolve(scheme)
                PrettyText(t.title.isEmpty ? "Untitled task" : t.title, title.text, strike: closed)
                    .foregroundStyle(closed ? muted : title.color.color)
                meta(t)
                    .padding(.top, PS("tasks.meta").resolve(scheme).margin.top)
                let extra = action()
                if !(extra is EmptyView) {
                    extra.padding(.top, 6)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .topAligned()
            if let p = t.priority, p != "none" { priority(p).topAligned() }
            if let r = t.repeat, !r.isEmpty {
                WebIconView(.repeat, size: 12)
                    .foregroundStyle(muted)
                    .frame(height: 16)
                    .padding(.top, 2)
                    .foleviTooltip(r)
                    .topAligned()
            }
            if let d = t.dueDate {
                let due = PS("tasks.due").resolve(scheme)
                Text("\(overdue ? "Overdue · " : "")\(PlannerDates.dueLabel(d, today: today))\(t.dueTime.map { " \($0)" } ?? "")")
                    // (Its colour and weight by name: the style read may be of an overdue task.)
                    .webText(due.text(weight: overdue ? 500 : 400))
                    .lineLimit(1)
                    .fixedSize()
                    .foregroundStyle(overdue ? PV("color-danger").c(scheme) : muted)
                    .padding(.top, due.margin.top)
                    .topAligned()
            }
            if editable { editButton(t).topAligned() }
        }
        .padding(row.padding.edgeInsets)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(over ? PV("color-surface").c(scheme) : .clear)
        .contentShape(Rectangle())
        .onHover { over = $0 }
        .webContextMenu { tasks.menu(t, canEdit: editable) }
        .onDrag { NSItemProvider(object: t.id as NSString) }
    }

    private func meta(_ t: TaskRow) -> some View {
        let m = PS("tasks.meta").resolve(scheme)
        let link = PS("tasks.meta.link").resolve(scheme)
        return HStack(spacing: m.gap) {
            Button { tasks.openNote(t) } label: {
                HStack(spacing: link.gap) {
                    WebIconView(.fileText, size: 12)
                    Text(t.noteTitle.isEmpty ? "Untitled" : t.noteTitle).webText(link.text).lineLimit(1).truncationMode(.tail).underline(overLink)
                }
                .foregroundStyle(overLink ? PV("color-ink").c(scheme) : link.color.color)
                .contentShape(Rectangle())
            }
            .buttonStyle(PlainPress())
            .onHover { overLink = $0 }
            .layoutPriority(-1)
            if let a = t.assigneeName { Text("· \(a)").webText(m.text).lineLimit(1).fixedSize() }
            if t.status == "canceled" {
                Text("Canceled").webText(WebTextStyle(size: 11, leading: 14, weight: 500)).lineLimit(1).fixedSize()
                    .padding(.horizontal, 6)
                    .background(RoundedRectangle(cornerRadius: 6, style: .circular).fill(PV("color-surface-sunken").c(scheme)))
            }
            if t.status == "done", let at = t.completedAt {
                Text("· done \(PlannerDates.relative(at))").webText(m.text).lineLimit(1).fixedSize()
            }
        }
        .foregroundStyle(m.color.color)
        .frame(height: m.height, alignment: .leading)
    }

    private func priority(_ p: String) -> some View {
        let (bg, fg): (String, String) = p == "high" ? ("color-coral-soft", "color-coral-ink") : p == "medium" ? ("color-marigold-soft", "color-marigold-ink") : ("color-surface-sunken", "color-ink-muted")
        return Text(p.prefix(1).uppercased() + p.dropFirst())
            .webText(WebTextStyle(size: 12, leading: 16, weight: 500))
            .lineLimit(1)
            .fixedSize()
            .foregroundStyle(PV(fg).c(scheme))
            .padding(.horizontal, 8)
            .background(RoundedRectangle(cornerRadius: 6, style: .circular).fill(PV(bg).c(scheme)))
            .padding(.top, 2)
    }

    private func editButton(_ t: TaskRow) -> some View {
        let e = PS("tasks.edit").resolve(scheme)
        return EditTaskButton(size: e.width, radius: e.radius, color: e.color.color, visible: over) { tasks.edit(t) }
            .padding(.vertical, e.margin.top)
            .accessibilityLabel("Edit “\(t.title.isEmpty ? "Untitled task" : t.title)”: date, priority, assignee, status")
    }
}

extension View {
    /// The view's top is its top in an HStack(alignment: .top) (a one-line .webText moves its own top guide to
    /// the CSS line box, which would shift the row).
    func topAligned() -> some View { alignmentGuide(.top) { _ in 0 } }
}

extension PlannerTaskRow where Action == EmptyView {
    init(raw: TaskRow, tasks: PlannerTasks, editable: Bool = true) {
        self.raw = raw
        self.tasks = tasks
        self.editable = editable
        self.action = { EmptyView() }
    }
}

/// The row's Edit button: hidden until the row is hovered, sunken under the pointer.
struct EditTaskButton: View {
    let size: CGFloat
    let radius: CGFloat
    let color: Color
    let visible: Bool
    let action: () -> Void
    @Environment(\.colorScheme) private var scheme
    @State private var over = false

    var body: some View {
        Button(action: action) {
            WebIconView(.slidersHorizontal, size: 14)
                .foregroundStyle(over ? PV("color-ink").c(scheme) : color)
                .frame(width: size, height: size)
                .background {
                    if over { RoundedRectangle(cornerRadius: radius, style: .circular).fill(PV("color-surface-sunken").c(scheme)) }
                }
                .contentShape(Rectangle())
        }
        .buttonStyle(PlainPress())
        .opacity(visible || over ? 1 : 0)
        .onHover { over = $0 }
        .foleviTooltip("Edit task")
    }
}

/// A list of task rows in a card with hairlines between them (`divide-y divide-line ui-card rounded-control`).
struct TaskCard<Content: View>: View {
    @ViewBuilder let content: () -> Content
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let card = PS("tasks.card")
        let r = card.resolve(scheme).radius
        _VariadicView.Tree(DividedLayout(line: PV("color-line").c(scheme))) { content() }
            .frame(maxWidth: .infinity)
            .clipShape(RoundedRectangle(cornerRadius: r, style: .circular))
            .webBox(card)
    }
}

/// Children one under another with a 1 pt line between them.
struct DividedLayout: _VariadicView_MultiViewRoot {
    let line: Color

    @ViewBuilder
    func body(children: _VariadicView.Children) -> some View {
        VStack(spacing: 0) {
            ForEach(Array(children.enumerated()), id: \.element.id) { i, child in
                child
                if i < children.count - 1 { Rectangle().fill(line).frame(height: 1) }
            }
        }
    }
}
#endif
