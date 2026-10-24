// View model tests for Tasks, the Calendar, Search, Notifications and Places (N10, N11) on the scripted engine fed by
// the contract's fixtures, with a fixed clock (2026-10-24 in Asia/Dhaka, the session fixture's today).
import Foundation
import Testing
@testable import FoleviDesign
@testable import FoleviEngine
@testable import FoleviScreens

/// The revision 5 to 7 views these screens watch, from the contract's own fixtures.
@MainActor
func featureValues(_ engine: FakeEngine) {
    for (view, file) in [
        ("tasks.list", "view.tasks.list.json"), ("tasks.counts", "view.tasks.counts.json"), ("tasks.range", "view.tasks.range.json"),
        ("calendars.events", "view.calendars.events.json"), ("calendars.list", "view.calendars.list.json"), ("members", "view.members.json"),
        ("notifications.list", "view.notifications.list.json"), ("account.details", "view.account.details.json"),
    ] {
        engine.values[view] = Fixtures.value(file)
    }
    engine.resolve = { name, args in
        if name == "tasks.list", args["view"]?.string == "upcoming" { return Fixtures.value("view.tasks.list.upcoming.json") }
        return nil
    }
}

@MainActor
func featureEngine() -> FakeEngine {
    let e = FakeEngine()
    featureValues(e)
    return e
}

func testDefaults() -> UserDefaults { UserDefaults(suiteName: "folevi.feature.\(UUID().uuidString)")! }

let okResult: JSONValue = .object(["ok": .bool(true)])

/// The engine answering task and notification commands the way the fixtures say.
@MainActor
func answerCommands(_ engine: FakeEngine, failing: Set<String> = []) {
    engine.onCommand = { name, args in
        if failing.contains(name) { throw EngineFailure.engine(EngineError(code: "failed", message: "That didn't work.")) }
        switch name {
        case "task.create": return .object(["id": .string("blk_new"), "noteId": .string("doc_inbox"), "where": .string("Inbox")])
        case "pageInvite.accept": return .object(["noteId": .string("doc_shared")])
        case "calendar.add": return .object(["id": .string("cal_new")])
        case "space.switch": return .object(["space": args["space"] ?? .null])
        default: return okResult
        }
    }
}

// MARK: - Dates and routes

@Suite("Task dates and feature routes")
struct TaskDatesTests {
    let en = Locale(identifier: "en_US")

    @Test func words() {
        #expect(TaskDates.dueLabel("2026-10-24", today: "2026-10-24", locale: en) == "Today")
        #expect(TaskDates.dueLabel("2026-10-25", today: "2026-10-24", locale: en) == "Tomorrow")
        #expect(TaskDates.dueLabel("2026-10-23", today: "2026-10-24", locale: en) == "Yesterday")
        #expect(TaskDates.dueLabel("2026-10-28", today: "2026-10-24", locale: en) == "Wednesday")
        #expect(TaskDates.dueLabel("2026-10-22", today: "2026-10-24", locale: en) == "Oct 22")
        #expect(TaskDates.dueLabel("2027-01-02", today: "2026-10-24", locale: en) == "Jan 2, 2027")
        let h = TaskDates.dayHeading("2026-10-25", today: "2026-10-24", locale: en)
        #expect(h.name == "Tomorrow" && h.date == "Sunday, Oct 25")
        #expect(TaskDates.monthTitle("2026-10-01", today: "2026-10-24", locale: en) == "October")
        #expect(TaskDates.monthTitle("2027-01-01", today: "2026-10-24", locale: en) == "January 2027")
    }

    @Test func weeksStartOnMonday() {
        #expect(TaskDates.startOfWeek("2026-10-24") == "2026-10-19")
        #expect(TaskDates.weekdayIndex("2026-10-19") == 0)
        #expect(TaskDates.nextWeek("2026-10-24") == "2026-10-26")
        #expect(TaskDates.week(of: "2026-10-24").count == 7)
        let rows = TaskDates.monthRows("2026-10-24")
        #expect(rows.count == 5)
        #expect(rows.first?.first == "2026-09-28")
        #expect(rows.last?.last == "2026-11-01")
        #expect(TaskDates.add("2026-12-31", days: 1) == "2027-01-01")
        #expect(TaskDates.addMonths("2026-01-31", 1) == "2026-02-28")
        #expect(TaskDates.between("2026-10-24", "2026-11-24") == 31)
    }

    @Test func times() {
        #expect(TaskDates.minutes("15:30") == 930)
        #expect(TaskDates.minutes("25:00") == nil)
        #expect(TaskDates.time(930) == "15:30")
        let dhaka = TimeZone(identifier: "Asia/Dhaka")!
        let d = TaskDates.pickerDate(day: "2026-10-24", time: "09:15", timeZone: dhaka)
        let back = TaskDates.fromPicker(d, timeZone: dhaka)
        #expect(back.day == "2026-10-24" && back.time == "09:15")
        #expect(TaskDates.day(ms: TaskDates.ms(day: "2026-10-24", timeZone: dhaka), timeZone: dhaka) == "2026-10-24")
    }

    @Test func overlaps() {
        let placed = CalendarMath.layoutOverlaps([
            .init(id: "a", start: 540, end: 600), .init(id: "b", start: 570, end: 630), .init(id: "c", start: 600, end: 660), .init(id: "d", start: 700, end: 730),
        ])
        let by = Dictionary(uniqueKeysWithValues: placed.map { ($0.id, $0) })
        #expect(by["a"]?.col == 0 && by["b"]?.col == 1 && by["c"]?.col == 0)
        #expect(by["a"]?.cols == 2 && by["c"]?.cols == 2)
        #expect(by["d"]?.cols == 1)
        #expect(CalendarMath.slot(atY: CalendarMath.hourHeight * 9.6) == 9 * 60 + 30)
        #expect(CalendarMath.slot(atY: 99_999) == 23 * 60 + 30)
    }

    @Test func routes() {
        #expect(FeatureRoute(webRoute: "/tasks/upcoming") == .tasks(.upcoming))
        #expect(FeatureRoute(webRoute: "/tasks") == .tasks(.today))
        #expect(FeatureRoute(webRoute: "/calendar?date=2026-11-02") == .calendar(date: "2026-11-02"))
        #expect(FeatureRoute(webRoute: "/calendar") == .calendar(date: nil))
        #expect(FeatureRoute(webRoute: "/search?q=kyoto%20trip") == .search(text: "kyoto trip"))
        #expect(FeatureRoute(webRoute: "/d/doc_1#block-blk_9") == .noteBlock(id: "doc_1", blockId: "blk_9"))
        #expect(FeatureRoute(webRoute: "/d/doc_1") == nil)
        #expect(FeatureRoute(webRoute: "/notes") == nil)
        #expect(ScreenIntent.openNote(id: "doc_1", blockId: "blk_9").webPath == "/d/doc_1#block-blk_9")
        #expect(ScreenIntent.openTasks(.today).fallbackRoute == .web("/tasks/today"))
        #expect(ScreenIntent.openNote(id: "doc_1", blockId: nil).fallbackRoute == .note(id: "doc_1"))
    }

    @Test func patchEncodesClearedFieldsAsNull() throws {
        let args = TaskPatchArgs(id: "t1", dueDate: .clear, dueTime: .set("09:00"), assigneeId: .keep)
        let json = try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(args))
        #expect(json["dueDate"] == .null)
        #expect(json["dueTime"] == .string("09:00"))
        #expect(json["assigneeId"] == nil)
        #expect(json["checked"] == nil)
        let back = try JSONDecoder().decode(TaskPatchArgs.self, from: JSONEncoder().encode(args))
        #expect(back == args)
    }
}

// MARK: - Tasks

@Suite("Tasks model", .serialized) @MainActor
struct TasksModelTests {
    init() { ScreenClock.fixed = fixedNow }

    func make(_ engine: FakeEngine, view: TaskViewName = .today) -> TasksModel {
        let m = TasksModel(client: engine.client(), view: view, feedback: FeedbackLog().feedback, defaults: testDefaults())
        m.edits.checkHold = .zero
        m.parseDelay = .zero
        return m
    }

    @Test func groupsByNoteWithCounts() async {
        let engine = featureEngine()
        let model = make(engine)
        await eventually("tasks") { !model.sections.isEmpty && model.counts.value != nil && model.session.value != nil }
        #expect(model.sections.map(\.title) == ["Kyoto in November", "Q4 planning"])
        #expect(model.sections.first?.tasks.map(\.title) == ["Book the ryokan", "Rail pass"])
        #expect(model.count(for: .today) == 2)
        #expect(model.count(for: .completed) == nil)
        #expect(model.today == "2026-10-24")
        let overdue = model.sections[0].tasks[0]
        #expect(TaskFacts.line(overdue, today: model.today, showNote: false, onDay: true).hasPrefix("Overdue · "))
        let plan = model.sections[1].tasks[0]
        let facts = TaskFacts.line(plan, today: model.today, showNote: false, onDay: true)
        #expect(facts.contains("Maya") && facts.contains("High priority"))
    }

    @Test func filterMatchesTaskOrNote() async {
        let engine = featureEngine()
        let model = make(engine)
        await eventually("tasks") { !model.sections.isEmpty }
        model.filter = "rail"
        #expect(model.sections.flatMap(\.tasks).map(\.title) == ["Rail pass"])
        model.filter = "q4"
        #expect(model.sections.map(\.title) == ["Q4 planning"])
        model.filter = "nothing like this"
        #expect(model.isEmpty)
        #expect(model.emptyText.title == "No tasks match that filter")
    }

    @Test func checkOffLeavesWithUndo() async throws {
        let engine = featureEngine()
        answerCommands(engine)
        let log = FeedbackLog()
        let model = TasksModel(client: engine.client(), view: .today, feedback: log.feedback, defaults: testDefaults())
        model.edits.checkHold = .zero
        await eventually("tasks") { !model.sections.isEmpty }
        let task = model.sections[0].tasks[1]
        model.toggle(task)
        #expect(model.shown(task).status == "done", "the box ticks at once")
        #expect(log.haptics.contains(.success))
        await eventually("completed") { engine.commands(named: "task.update").count == 1 }
        #expect(engine.commands(named: "task.update")[0] == .object(["id": .string("blk_t3"), "checked": .bool(true)]))
        #expect(!model.sections.flatMap(\.tasks).contains { $0.id == "blk_t3" }, "the task left Today")
        await eventually("toast") { log.toasts.contains { $0.message == "Done" } }
        let undo = try #require(log.toasts.last { $0.message == "Done" }?.action)
        undo()
        await eventually("undone") { engine.commands(named: "task.update").count == 2 }
        #expect(engine.commands(named: "task.update")[1]["checked"] == .bool(false))
        #expect(model.sections.flatMap(\.tasks).contains { $0.id == "blk_t3" && $0.status == "open" })
    }

    @Test func refusedCheckOffComesBack() async {
        let engine = featureEngine()
        answerCommands(engine, failing: ["task.update"])
        let log = FeedbackLog()
        let model = TasksModel(client: engine.client(), view: .today, feedback: log.feedback, defaults: testDefaults())
        model.edits.checkHold = .zero
        await eventually("tasks") { !model.sections.isEmpty }
        let task = model.sections[0].tasks[0]
        model.toggle(task)
        await eventually("error toast") { log.toasts.contains { $0.tone == .error } }
        #expect(model.shown(task).status == "open")
        #expect(model.sections.flatMap(\.tasks).contains { $0.id == task.id })
        #expect(log.haptics.contains(.error))
    }

    @Test func tomorrowWithUndoRestoresNoTime() async throws {
        let engine = featureEngine()
        answerCommands(engine)
        let log = FeedbackLog()
        let model = TasksModel(client: engine.client(), view: .today, feedback: log.feedback, defaults: testDefaults())
        await eventually("tasks") { !model.sections.isEmpty }
        let task = model.sections[0].tasks[0]
        await model.moveToTomorrow(task)
        let first = engine.commands(named: "task.update")[0]
        #expect(first["dueDate"] == .string("2026-10-25"))
        #expect(first["dueTime"] == nil, "the time is kept")
        #expect(!model.sections.flatMap(\.tasks).contains { $0.id == task.id }, "tomorrow isn't Today")
        let undo = try #require(log.toasts.last { $0.message == "Moved to tomorrow" }?.action)
        undo()
        await eventually("undone") { engine.commands(named: "task.update").count == 2 }
        let back = engine.commands(named: "task.update")[1]
        #expect(back["dueDate"] == .string("2026-10-22"))
        #expect(back["dueTime"] == .null, "no time goes as null")
    }

    @Test func detailsChangesShowAtOnce() async {
        let engine = featureEngine()
        answerCommands(engine)
        let model = make(engine)
        await eventually("tasks") { !model.sections.isEmpty }
        let task = model.sections[1].tasks[0]
        #expect(await model.edits.update(task, TaskPatchArgs(id: task.id, dueDate: .clear, dueTime: .clear)))
        #expect(model.shown(task).dueDate == nil && model.shown(task).dueTime == nil)
        #expect(engine.commands(named: "task.update").last?["dueDate"] == .null)
        #expect(await model.edits.update(task, TaskPatchArgs(id: task.id, priority: TaskUpdateArgs.Priority.none, assigneeId: .clear)))
        #expect(engine.commands(named: "task.update").last?["assigneeId"] == .null)
        #expect(engine.commands(named: "task.update").last?["priority"] == .string("none"))
    }

    @Test func quickAddReadsDates() async {
        let engine = featureEngine()
        answerCommands(engine)
        engine.queryAnswers["task.parse"] = { _ in Fixtures.value("view.task.parse.json") }
        let log = FeedbackLog()
        let model = TasksModel(client: engine.client(), view: .today, feedback: log.feedback, defaults: testDefaults())
        model.parseDelay = .zero
        await eventually("session") { model.session.value != nil }
        model.quickText = "water the plants tomorrow 9am every monday"
        await eventually("parsed") { model.parsed != nil }
        #expect(model.parsedDueLabel?.hasPrefix("Due tomorrow") == true)
        #expect(model.parsedRepeatLabel == "Every Monday")
        await model.add()
        let args = engine.commands(named: "task.create").first
        #expect(args?["text"] == .string("water the plants tomorrow 9am every monday"))
        #expect(args?["dueDate"] == nil, "the engine reads the date from the words")
        #expect(model.pending.isEmpty)
        #expect(model.quickText.isEmpty)
        #expect(log.toasts.contains { $0.message == "Task added to Inbox" })

        // Keeping the words as text on Today: due today, with keepText.
        model.quickText = "read chapter tomorrow"
        await eventually("parsed again") { model.parsed != nil }
        model.keepText = true
        #expect(model.parsedDueLabel == nil)
        await model.add()
        let second = engine.commands(named: "task.create").last
        #expect(second?["keepText"] == .bool(true))
        #expect(second?["dueDate"] == .string("2026-10-24"))
    }

    @Test func quickAddWaitsForTheEngine() async {
        let engine = featureEngine()
        var notReady = true
        engine.onCommand = { name, _ in
            if name == "task.create" && notReady { throw EngineFailure.notReady }
            return .object(["id": .string("blk_new"), "noteId": .string("doc_inbox"), "where": .string("Inbox")])
        }
        let model = make(engine, view: .inbox)
        model.quickText = "call the bank"
        await model.add()
        #expect(model.pending.count == 1)
        #expect(model.pending.first?.state == .waiting)
        notReady = false
        await model.retry()
        #expect(model.pending.isEmpty)
    }

    @Test func viewsAndFolding() async {
        let engine = featureEngine()
        let d = testDefaults()
        let model = TasksModel(client: engine.client(), view: .today, defaults: d)
        await eventually("tasks") { !model.sections.isEmpty }
        model.toggleFold("doc_00001")
        #expect(model.sections[0].folded && model.sections[0].tasks.isEmpty && model.sections[0].count == 2)
        #expect(d.stringArray(forKey: TasksModel.foldKey) == ["today:doc_00001"])
        let again = TasksModel(client: model.client, view: .today, defaults: d)
        #expect(again.isFolded("doc_00001"), "folds are remembered on this device")
        model.select(.upcoming)
        #expect(model.isLoading || model.value?.view == .upcoming)
        await eventually("upcoming") { model.value?.view == .upcoming }
        #expect(model.sections.first?.kind == .day)
        #expect(model.sections.first?.title == "Tomorrow")
        #expect(model.sections.first?.detail?.isEmpty == false)
    }

    @Test func longListsStayQuick() async {
        let engine = featureEngine()
        engine.values["tasks.list"] = longTasksValue(5000)
        let model = make(engine, view: .all)
        await eventually("5,000 tasks", timeout: .seconds(10)) { model.total == 5000 }
        let clock = ContinuousClock()
        var built = 0
        let t = clock.measure { for _ in 0..<10 { built += model.sections.count } }
        let ms = Double(t.components.attoseconds) / 1e15 / 10 + Double(t.components.seconds) * 100
        print("PERF \(hostPlatform) tasks sections over 5,000 tasks: \(String(format: "%.2f", ms)) ms")
        #expect(built == 2000)
        #expect(ms < 60, "building the sections takes \(ms) ms")
        model.filter = "task 49"
        let f = clock.measure { _ = model.sections }
        #expect(f < .milliseconds(120), "filtering takes \(f)")
    }
}

/// A list of `count` open tasks in notes of 25.
@MainActor
func longTasksValue(_ count: Int) -> JSONValue {
    guard case .object(let template)? = Fixtures.value("view.tasks.list.json")["groups"]?.elements?.first?["tasks"]?.elements?.first else { fatalError("no task template") }
    var groups: [JSONValue] = []
    var i = 0
    while i < count {
        let note = "doc_l\(groups.count)"
        var tasks: [JSONValue] = []
        for _ in 0..<min(25, count - i) {
            var t = template
            t["id"] = .string("blk_l\(i)")
            t["noteId"] = .string(note)
            t["noteTitle"] = .string("Project \(groups.count)")
            t["title"] = .string("Task \(i) to do")
            t["dueDate"] = i % 3 == 0 ? .null : .string(TaskDates.add("2026-10-20", days: i % 40))
            t["overdue"] = .bool(false)
            tasks.append(.object(t))
            i += 1
        }
        groups.append(.object(["id": .string(note), "kind": .string("note"), "title": .string("Project \(groups.count)"), "icon": .null, "tasks": .array(tasks)]))
    }
    return .object(["view": .string("all"), "groups": .array(groups), "total": .number(Double(count))])
}

// MARK: - Calendar

@Suite("Calendar model", .serialized) @MainActor
struct CalendarModelTests {
    init() { ScreenClock.fixed = fixedNow }

    @Test func agendaWithOverdueFirstAndEvents() async {
        let engine = featureEngine()
        let model = CalendarModel(client: engine.client(), feedback: FeedbackLog().feedback, defaults: testDefaults())
        await eventually("calendar") { model.tasks.value != nil && model.events.value != nil && model.todayList.value != nil && model.session.value != nil }
        #expect(model.today == "2026-10-24")
        #expect(model.selected == "2026-10-24")
        #expect(model.title == TaskDates.monthTitle("2026-10-24", today: "2026-10-24"))
        let first = model.agenda[0]
        #expect(first.day == "2026-10-24")
        #expect(first.overdue.map(\.id) == ["blk_t1"], "overdue tasks lead today")
        #expect(first.tasks.contains { $0.id == "blk_t2" })
        let events = model.eventsByDay
        #expect(events["2026-10-21"]?.first?.event.title == "Durga Puja")
        #expect(events["2026-10-21"]?.first?.allDay == true)
        let standupDay = TaskDates.day(ms: 1_792_810_800_000, timeZone: model.timeZone)
        #expect(events[standupDay]?.contains { $0.event.title == "Standup" && !$0.allDay } == true)
        #expect(model.marked("2026-10-21", tasks: model.tasksByDay, events: events))
        #expect(!model.agenda.dropFirst().contains { $0.isEmpty }, "empty days are left out")
    }

    @Test func pagingRefetchesTheRange() async {
        let engine = featureEngine()
        let model = CalendarModel(client: engine.client(), defaults: testDefaults())
        await eventually("tasks") { model.tasks.value != nil }
        #expect(model.range.from == "2026-09-28")
        model.page(2, layout: .month)
        #expect(model.selected == "2026-12-24")
        #expect(model.range.from == TaskDates.monthRows("2026-12-24").first?.first)
        await eventually("new range watched") { engine.watches.values.contains { $0["name"]?.string == "tasks.range" && $0["args"]?["from"]?.string == model.range.from } }
        model.goToday()
        #expect(model.selected == "2026-10-24")
    }

    @Test func rescheduleAndAdd() async throws {
        let engine = featureEngine()
        answerCommands(engine)
        let log = FeedbackLog()
        let model = CalendarModel(client: engine.client(), feedback: log.feedback, defaults: testDefaults())
        await eventually("tasks") { model.tasks.value != nil }
        let task = try #require(model.task(id: "blk_t2"))
        await model.reschedule(task, to: "2026-10-27", time: .set("10:30"))
        let args = engine.commands(named: "task.update")[0]
        #expect(args["dueDate"] == .string("2026-10-27") && args["dueTime"] == .string("10:30"))
        #expect(model.tasksByDay["2026-10-27"]?.contains { $0.id == "blk_t2" } == true, "the move shows at once")
        #expect(log.toasts.contains { $0.message.hasPrefix("Moved to") && $0.actionTitle == "Undo" })
        #expect(await model.addTask("Pick up the tickets", on: "2026-10-30"))
        let created = engine.commands(named: "task.create")[0]
        #expect(created["dueDate"] == .string("2026-10-30") && created["text"] == .string("Pick up the tickets"))
    }

    @Test func layoutsAndSubscriptions() async {
        let engine = featureEngine()
        answerCommands(engine)
        let d = testDefaults()
        let model = CalendarModel(client: engine.client(), defaults: d)
        #expect(model.layout(compact: true) == .agenda)
        #expect(model.layout(compact: false) == .month)
        model.choose(.week)
        #expect(CalendarModel(client: model.client, defaults: d).layout(compact: false) == .week)
        model.openCalendars()
        await eventually("calendars") { model.calendars?.value?.calendars.count == 2 }
        #expect(await model.addCalendar(url: "not a link", name: nil, color: "moss") != nil)
        #expect(await model.addCalendar(url: "webcal://cal.example.com/team.ics", name: "Team", color: "moss") == nil)
        let add = engine.commands(named: "calendar.add")[0]
        #expect(add["url"] == .string("https://cal.example.com/team.ics"))
        #expect(add["name"] == .string("Team") && add["color"] == .string("moss"))
        await model.updateCalendar("cal2", visible: true)
        #expect(engine.commands(named: "calendar.update")[0] == .object(["id": .string("cal2"), "visible": .bool(true)]))
        await model.refreshCalendar("cal1")
        #expect(engine.commands(named: "calendar.refresh").count == 1)
        await model.removeCalendar(model.calendars!.value!.calendars[1])
        #expect(engine.commands(named: "calendar.remove")[0]["id"] == .string("cal2"))
    }

    @Test func eventWords() {
        let utc = TimeZone(identifier: "UTC")!
        let e = CalendarEvent(id: "e", calendarId: "c", calendarName: "Work", color: "accent", title: "Review", location: "", description: "", start: 1_792_836_000_000, end: 1_792_839_600_000, allDay: false)
        let words = CalendarMath.eventWhen(e, timeZone: utc, locale: Locale(identifier: "en_GB"))
        #expect(words.contains(" to "))
        let allDay = CalendarEvent(id: "a", calendarId: "c", calendarName: "Holidays", color: "moss", title: "Puja", location: "", description: "", start: 1_792_540_800_000, end: 1_792_627_200_000, allDay: true)
        #expect(CalendarMath.eventWhen(allDay, timeZone: utc, locale: Locale(identifier: "en_US")).hasSuffix("all day"))
    }
}

// MARK: - Search

@Suite("Search model", .serialized) @MainActor
struct SearchModelTests {
    init() { ScreenClock.fixed = fixedNow }

    func make(_ engine: FakeEngine, defaults: UserDefaults = testDefaults()) -> SearchModel {
        let m = SearchModel(client: engine.client(), defaults: defaults)
        m.debounce = .zero
        return m
    }

    @Test func resultsByType() async {
        let engine = featureEngine()
        engine.queryAnswers["search"] = { _ in Fixtures.value("view.search.json") }
        let model = make(engine)
        await eventually("tree") { model.tree.value != nil && model.home.value != nil }
        let folder = model.folders.first!
        model.text = String(folder.name.prefix(3))
        await eventually("answer") { !model.searching }
        #expect(model.sections.contains { $0.id == "notes" })
        #expect(model.sections.contains { $0.id == "folders" })
        model.text = "kyoto"
        await eventually("answer") { !model.searching && model.answeredText == "kyoto" }
        let notes = model.sections.first { $0.id == "notes" }?.items ?? []
        #expect(notes.count >= 2)
        if case .note(let h) = notes[1] {
            #expect(model.action(for: notes[1]) == .intent(.openNote(id: h.id, blockId: "blk_pdf")), "a match in a file opens at its block")
        } else {
            Issue.record("second item isn't a note")
        }
        if case .note(let h) = notes[0] { #expect(model.action(for: notes[0]) == .route(.note(id: h.id))) }
        let q = engine.queries.last { $0.name == "search" }
        #expect(q?.args["text"] == .string("kyoto"))
        #expect(q?.args["scope"] == .string("place"))
    }

    @Test func scopesAndFilters() async {
        let engine = featureEngine()
        engine.queryAnswers["search"] = { _ in Fixtures.value("view.search.json") }
        let model = make(engine)
        await eventually("session") { model.session.value != nil }
        #expect(model.offersEverywhere)
        model.text = "plan"
        model.folderId = "fld_trips"
        model.updated = .week
        await eventually("answer") { engine.queries.last?.args["folderId"] == .string("fld_trips") }
        #expect(engine.queries.last?.args["updatedAfter"] != nil)
        model.scope = .everywhere
        await eventually("everywhere") { engine.queries.last?.args["scope"] == .string("everywhere") }
        #expect(engine.queries.last?.args["folderId"] == nil, "folder filters belong to one space")
        model.scope = .meaning
        await eventually("meaning") { engine.queries.last?.args["meaning"] == .bool(true) }
        model.clearFilters()
        #expect(!model.hasFilters)
    }

    @Test func answersFromTheDeviceWhenTheEngineCant() async {
        let engine = featureEngine()
        engine.queryAnswers["search"] = { _ in throw EngineFailure.notReady }
        let model = make(engine)
        await eventually("home") { model.home.value != nil }
        let recent = model.home.value!.recents.first!
        model.text = String(recent.title.prefix(4))
        await eventually("fallback") { model.offline }
        #expect(model.sections.first { $0.id == "notes" }?.items.contains(.note(SearchHit(id: recent.id, title: recent.title, icon: nil, snippet: recent.excerpt, folder: recent.folder, updatedAt: recent.updatedAt, archived: false, kind: recent.kind, space: nil, spaceName: nil, matchIn: "text", blockId: nil, page: nil))) == true)
    }

    @Test func recentSearchesAndKeyboard() async {
        let engine = featureEngine()
        engine.queryAnswers["search"] = { _ in Fixtures.value("view.search.json") }
        let d = testDefaults()
        let model = make(engine, defaults: d)
        model.text = "kyoto"
        await eventually("answer") { !model.searching && !model.flatItems.isEmpty }
        model.moveSelection(1)
        #expect(model.selection == 0)
        model.moveSelection(1)
        #expect(model.selection == 1)
        model.moveSelection(-5)
        #expect(model.selection == 0)
        model.remember()
        model.text = ""
        #expect(model.sections.first?.id == "recent-searches")
        #expect(model.action(for: .recentSearch("kyoto")) == .fill("kyoto"))
        #expect(SearchModel(client: model.client, defaults: d).recentSearches == ["kyoto"])
        model.forget("kyoto")
        #expect(model.recentSearches.isEmpty)
    }

    @Test func highlightsMatches() {
        let s = SearchModel.highlighted("The ryokan in Kyoto, kyoto again", query: "kyoto")
        let marked = s.runs.filter { $0.inlinePresentationIntent == .stronglyEmphasized }.map { String(s[$0.range].characters) }
        #expect(marked == ["Kyoto", "kyoto"])
    }
}

// MARK: - Notifications

@Suite("Notifications model", .serialized) @MainActor
struct NotificationsModelTests {
    init() { ScreenClock.fixed = fixedNow }

    @Test func readUnreadAndRemove() async {
        let engine = featureEngine()
        answerCommands(engine)
        let model = NotificationsModel(client: engine.client(), feedback: FeedbackLog().feedback)
        await eventually("rows") { !model.rows.isEmpty }
        #expect(model.unread == 2)
        let total = model.rows.count
        model.filter = .unread
        #expect(model.rows.count == 2)
        model.filter = .all
        let first = model.rows[0]
        await model.toggleRead(first)
        #expect(engine.commands(named: "notification.markRead")[0] == .object(["ids": .array([.string("n1")]), "read": .bool(true)]))
        #expect(model.unread == 1)
        await model.toggleRead(model.rows[0])
        #expect(engine.commands(named: "notification.markRead")[1]["read"] == .bool(false))
        await model.remove(model.rows[0])
        #expect(model.rows.count == total - 1)
        #expect(engine.commands(named: "notification.remove")[0]["ids"] == .array([.string("n1")]))
        await model.markAllRead()
        #expect(model.unread == 0)
        #expect(engine.commands(named: "notification.markAllRead").count == 1)
    }

    @Test func refusedRemoveComesBack() async {
        let engine = featureEngine()
        answerCommands(engine, failing: ["notification.remove"])
        let log = FeedbackLog()
        let model = NotificationsModel(client: engine.client(), feedback: log.feedback)
        await eventually("rows") { !model.rows.isEmpty }
        let total = model.rows.count
        await model.remove(model.rows[0])
        #expect(model.rows.count == total)
        #expect(log.toasts.contains { $0.tone == .error })
    }

    @Test func invitationsAndTaps() async throws {
        let engine = featureEngine()
        answerCommands(engine)
        let model = NotificationsModel(client: engine.client(), feedback: FeedbackLog().feedback)
        await eventually("rows") { !model.rows.isEmpty }
        let invite = try #require(model.rows.first { $0.inviteId != nil })
        #expect(model.inviteKind(invite) == .workspace)
        let none = await model.accept(invite)
        #expect(none == nil)
        #expect(engine.commands(named: "invite.accept")[0] == .object(["inviteId": .string("inv_1")]))
        var page = invite
        page.id = "n_page"
        page.pageInviteId = "pinv_1"
        #expect(await model.accept(page) == .openNote(id: "doc_shared", blockId: nil))
        let comment = model.rows[0]
        #expect(await model.tap(comment) == .openRoute("/d/doc_00002#comment-th_1"))
        #expect(engine.commands(named: "notification.markRead").last?["ids"] == .array([.string("n1")]))
    }

    @Test func declineFallsBackToRemoving() async throws {
        let engine = featureEngine()
        engine.onCommand = { name, _ in
            if name == "invite.decline" { throw EngineFailure.engine(EngineError(code: "unknown_command", message: "No command invite.decline.")) }
            return okResult
        }
        let model = NotificationsModel(client: engine.client(), feedback: FeedbackLog().feedback)
        await eventually("rows") { !model.rows.isEmpty }
        let invite = try #require(model.rows.first { $0.inviteId != nil })
        await model.decline(invite)
        #expect(engine.commands(named: "invite.decline")[0] == .object(["inviteId": .string("inv_1"), "kind": .string("workspace")]))
        #expect(engine.commands(named: "notification.remove")[0]["ids"] == .array([.string(invite.id)]))
        #expect(!model.rows.contains { $0.id == invite.id })
    }
}

// MARK: - Places

@Suite("Places model", .serialized) @MainActor
struct PlacesModelTests {
    @Test func placesFirstWithPlansAndChecks() async {
        let engine = featureEngine()
        let model = PlacesModel(client: engine.client(), feedback: FeedbackLog().feedback)
        await eventually("places") { model.places.value != nil && model.session.value != nil && model.account.value != nil }
        let items = model.items
        #expect(items.map(\.id) == ["personal", "ws_studio", "acct:user_2", "library"])
        #expect(items[0].checked && items[0].detail == "Pro" && items[0].subtitle == "faisal@example.com")
        #expect(items[1].nested && !items[1].checked && items[1].detail == "Admin")
        #expect(items[2].dot, "the other account has a reminder")
        #expect(items[3].title.hasPrefix("On this ") && items[3].subtitle == "Syncs with iCloud Drive")
        #expect(model.offersMove)
        #expect(model.signOutTitle == "Sign out of Faisal")
    }

    @Test func switching() async {
        let engine = featureEngine()
        answerCommands(engine)
        let model = PlacesModel(client: engine.client(), feedback: FeedbackLog().feedback)
        await eventually("places") { model.places.value != nil && model.session.value != nil }
        let ws = model.items[1]
        #expect(await model.choose(ws) == .dismiss)
        #expect(engine.commands(named: "space.switch")[0] == .object(["space": .string("ws_studio")]))
        #expect(model.items[1].checked && !model.items[0].checked, "the check moves at once")
        let other = model.items.first { $0.id == "acct:user_2" }!
        #expect(await model.choose(other) == .switchPlace(id: "acct:user_2", workspaceId: nil))
        let lib = model.items.first { $0.id == "library" }!
        #expect(await model.choose(lib) == .switchPlace(id: "library", workspaceId: nil))
        model.settle()
        #expect(model.items[0].checked, "back to the truth until the engine says otherwise")
    }

    @Test func signOutWarnsAboutUnsyncedChanges() async {
        let engine = featureEngine()
        let model = PlacesModel(client: engine.client(), feedback: FeedbackLog().feedback)
        await eventually("sync") { model.sync.value != nil }
        #expect(model.unsynced == 0)
        #expect(model.signOutAction == "Sign out")
        engine.update(view: "sync.status", Fixtures.value("view.sync.status.offline.json"))
        await eventually("offline") { model.unsynced > 0 }
        #expect(model.signOutMessage.contains("will be lost"))
        #expect(model.signOutAction == "Sign out and lose changes")
    }
}

extension JSONValue {
    /// An array's elements (test helper).
    var elements: [JSONValue]? { if case .array(let a) = self { a } else { nil } }
}
