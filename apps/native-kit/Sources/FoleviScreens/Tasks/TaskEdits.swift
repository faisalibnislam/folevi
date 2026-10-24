// Changes to tasks shared by Tasks and the Calendar: the box ticks at once and the task leaves a moment later with
// Undo, dates move with Undo, the details sheet saves each change as it's made. What's shown changes before the
// engine confirms (`shown`), and goes back when the engine refuses; `reconcile` drops what the engine now agrees with.
import Foundation
import Observation
import FoleviEngine

@MainActor
@Observable
public final class TaskEdits {
    let client: EngineClient
    let feedback: ScreenFeedback
    /// Statuses shown before the engine has them (a box ticked a moment ago).
    public private(set) var status: [String: String] = [:]
    /// Due dates shown before the engine has them.
    public private(set) var due: [String: (date: String?, time: String?)] = [:]
    /// Tasks that left the list (checked, moved out of the view) before the engine's update says so.
    public private(set) var gone: Set<String> = []

    /// How long a checked task stays, ticked, before it goes (as in Reminders; web CHECK_HOLD_MS).
    @ObservationIgnored public var checkHold: Duration = .milliseconds(420)
    @ObservationIgnored var today: () -> String = { TaskDates.today() }
    @ObservationIgnored private var holds: [String: Task<Void, Never>] = [:]

    init(client: EngineClient, feedback: ScreenFeedback) {
        self.client = client
        self.feedback = feedback
    }

    /// A task as it is now: a status or date changed here shows before the engine confirms it.
    public func shown(_ t: TaskRow) -> TaskRow {
        var t = t
        if let s = status[t.id] { t.status = s }
        if let d = due[t.id] {
            t.dueDate = d.date
            t.dueTime = d.time
        }
        t.overdue = t.status == "open" && (t.dueDate.map { $0 < today() } ?? false)
        return t
    }

    public func isGone(_ id: String) -> Bool { gone.contains(id) }

    // MARK: Checking off

    /// The box: an open task ticks at once and is completed after `checkHold` (with Undo); a done or canceled one
    /// reopens. `leaves` says whether the task leaves the list it's in once its status changes.
    public func toggle(_ task: TaskRow, leaves: @escaping (String) -> Bool) {
        let t = shown(task)
        if holds[t.id] != nil { return }
        if t.status == "open" {
            status[t.id] = "done"
            feedback.haptic(.success)
            holds[t.id] = Task { [weak self] in
                guard let self else { return }
                try? await Task.sleep(for: self.checkHold)
                self.holds[t.id] = nil
                await self.complete(t, leaves: leaves("done"))
            }
        } else {
            status[t.id] = "open"
            feedback.haptic(.impactLight)
            Task { await self.reopen(t, leaves: leaves("open")) }
        }
    }

    func complete(_ t: TaskRow, leaves: Bool) async {
        if leaves { gone.insert(t.id) }
        do {
            try await client.command(.taskPatch(TaskPatchArgs(id: t.id, checked: true)))
            feedback.toast(ScreenToast("Done", tone: .success, actionTitle: "Undo") { [weak self] in
                guard let self else { return }
                Task { await self.undoComplete(t) }
            })
        } catch {
            gone.remove(t.id)
            status[t.id] = nil
            fail(error)
        }
    }

    func undoComplete(_ t: TaskRow) async {
        gone.remove(t.id)
        status[t.id] = t.status == "canceled" ? "canceled" : "open"
        let args = t.status == "canceled" ? TaskPatchArgs(id: t.id, canceled: true) : TaskPatchArgs(id: t.id, checked: false)
        do { try await client.command(.taskPatch(args)) } catch {
            status[t.id] = "done"
            fail(error)
        }
    }

    func reopen(_ t: TaskRow, leaves: Bool) async {
        if leaves { gone.insert(t.id) }
        let args = t.status == "canceled" ? TaskPatchArgs(id: t.id, canceled: false) : TaskPatchArgs(id: t.id, checked: false)
        do { try await client.command(.taskPatch(args)) } catch {
            gone.remove(t.id)
            status[t.id] = nil
            fail(error)
        }
    }

    // MARK: Dates

    /// Sets the due date (and time); a nil date clears both. With a toast and Undo when `message` is given.
    public func setDue(_ task: TaskRow, date: String?, time: PatchField<String> = .keep, message: String? = nil, leaves: Bool = false) async {
        let before = shown(task)
        var newTime: String? = before.dueTime
        switch time {
        case .keep: break
        case .clear: newTime = nil
        case .set(let v): newTime = v
        }
        if date == nil { newTime = nil }
        due[task.id] = (date, newTime)
        if leaves { gone.insert(task.id) }
        let args = TaskPatchArgs(id: task.id, dueDate: date.map { .set($0) } ?? .clear, dueTime: date == nil ? .clear : time)
        do {
            try await client.command(.taskPatch(args))
            feedback.haptic(.selection)
            if let message {
                feedback.toast(ScreenToast(message, actionTitle: "Undo") { [weak self] in
                    guard let self else { return }
                    Task { await self.restoreDue(before) }
                })
            }
        } catch {
            due[task.id] = nil
            gone.remove(task.id)
            fail(error)
        }
    }

    func restoreDue(_ before: TaskRow) async {
        gone.remove(before.id)
        due[before.id] = (before.dueDate, before.dueDate == nil ? nil : before.dueTime)
        let args = TaskPatchArgs(id: before.id, dueDate: before.dueDate.map { .set($0) } ?? .clear, dueTime: before.dueDate == nil ? .clear : (before.dueTime.map { .set($0) } ?? .clear))
        do { try await client.command(.taskPatch(args)) } catch { fail(error) }
    }

    // MARK: Details

    /// Changes a task from its details; shows the change at once and puts it back when the engine refuses.
    public func update(_ task: TaskRow, _ patch: TaskPatchArgs) async -> Bool {
        let before = (status[task.id], due[task.id])
        if patch.checked == true || patch.canceled == true { status[task.id] = patch.canceled == true ? "canceled" : "done" }
        if patch.checked == false || patch.canceled == false { status[task.id] = "open" }
        if !patch.dueDate.isKept || !patch.dueTime.isKept {
            let cur = shown(task)
            var date = cur.dueDate, time = cur.dueTime
            if case .set(let d) = patch.dueDate { date = d }
            if case .clear = patch.dueDate { date = nil; time = nil }
            if case .set(let t) = patch.dueTime { time = t }
            if case .clear = patch.dueTime { time = nil }
            due[task.id] = (date, time)
        }
        do {
            try await client.command(.taskPatch(patch))
            return true
        } catch {
            status[task.id] = before.0
            due[task.id] = before.1
            fail(error)
            return false
        }
    }

    // MARK: Reconciling

    /// The engine's value replaced what was shown: drop overrides it now agrees with, and tasks it no longer lists.
    public func reconcile<S: Sequence>(_ tasks: S) where S.Element == TaskRow {
        var seen: [String: TaskRow] = [:]
        for t in tasks { seen[t.id] = t }
        for (id, s) in status where holds[id] == nil && seen[id]?.status == s { status[id] = nil }
        for (id, d) in due where seen[id].map({ $0.dueDate == d.date && $0.dueTime == d.time }) ?? false { due[id] = nil }
        gone = gone.filter { seen[$0] != nil }
    }

    func fail(_ error: any Error) {
        feedback.haptic(.error)
        feedback.toast(ScreenToast(ScreenErrors.message(error), tone: .error))
    }
}

/// What the task details sheet needs from the screen that opened it (Tasks or the Calendar).
@MainActor
public protocol TaskSheetHost: AnyObject {
    var edits: TaskEdits { get }
    var today: String { get }
    var timeZone: TimeZone { get }
    var canEdit: Bool { get }
    var inWorkspace: Bool { get }
    var assignees: [MemberRow] { get }
    /// The engine's latest row for a task, when the screen has it.
    func latest(_ id: String) -> TaskRow?
}
