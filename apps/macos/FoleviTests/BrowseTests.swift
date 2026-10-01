import XCTest

/// The browse views' logic, against the web (lib/format.ts, DocumentCard.tsx, OrganizeIndex.tsx, TasksView.tsx,
/// CalendarView.tsx, useCardSelection.ts) and the server (convex/tasks.ts update, documents.ts sorter).
final class BrowseTests: XCTestCase {
    private let en = Locale(identifier: "en_US")
    private let now = Date(timeIntervalSince1970: 1_790_000_000) // fixed "now"
    private func ago(minutes: Double) -> Double { (now.timeIntervalSince1970 - minutes * 60) * 1000 }

    func testAgeTextMatchesTheWeb() {
        XCTAssertEqual(BrowseFormat.ageText(ago(minutes: 0.2), now: now), "Just now")
        XCTAssertEqual(BrowseFormat.ageText(ago(minutes: 1), now: now), "1 min ago")
        XCTAssertEqual(BrowseFormat.ageText(ago(minutes: 23), now: now), "23 mins ago")
        XCTAssertEqual(BrowseFormat.ageText(ago(minutes: 60), now: now), "1 hour ago")
        XCTAssertEqual(BrowseFormat.ageText(ago(minutes: 60 * 24 * 12), now: now), "12 days ago")
        XCTAssertEqual(BrowseFormat.ageText(ago(minutes: 60 * 24 * 90), now: now), "3 months ago")
        XCTAssertEqual(BrowseFormat.ageText(ago(minutes: 60 * 24 * 365 * 2), now: now), "2 years ago")
        XCTAssertEqual(BrowseFormat.ageText(ago(minutes: 60 * 24 * 12), title: true, now: now), "12 Days Ago")
        XCTAssertEqual(BrowseFormat.ageText(ago(minutes: 0), title: true, now: now), "Just Now")
        // A clock slightly ahead never says "in".
        XCTAssertEqual(BrowseFormat.ageText(ago(minutes: -5), now: now), "Just now")
    }

    func testShortAgeOnFolderCovers() {
        XCTAssertEqual(BrowseFormat.shortAge(ago(minutes: 0.4), now: now), "just now")
        XCTAssertEqual(BrowseFormat.shortAge(ago(minutes: 1), now: now), "1 min ago")
        XCTAssertEqual(BrowseFormat.shortAge(ago(minutes: 120), now: now), "2 hours ago")
        XCTAssertEqual(BrowseFormat.shortAge(ago(minutes: 60 * 24 * 3), now: now), "3 days ago")
        XCTAssertFalse(BrowseFormat.shortAge(ago(minutes: 60 * 24 * 30), now: now, locale: en).contains("ago"))
    }

    func testDueLabels() {
        let today = "2026-10-01" // a Thursday
        XCTAssertEqual(BrowseFormat.dueLabel("2026-10-01", today: today, locale: en), "Today")
        XCTAssertEqual(BrowseFormat.dueLabel("2026-10-02", today: today, locale: en), "Tomorrow")
        XCTAssertEqual(BrowseFormat.dueLabel("2026-09-30", today: today, locale: en), "Yesterday")
        XCTAssertEqual(BrowseFormat.dueLabel("2026-10-05", today: today, locale: en), "Monday")
        XCTAssertEqual(BrowseFormat.dueLabel("2026-10-12", today: today, locale: en), "Oct 12")
        XCTAssertEqual(BrowseFormat.dueLabel("2026-09-20", today: today, locale: en), "Sep 20")
    }

    func testCalendarDates() {
        XCTAssertEqual(BrowseFormat.calendarDate("2026-10-02", .weekdayMonthDay, locale: en), "Friday, October 2")
        XCTAssertEqual(BrowseFormat.calendarDate("2026-10-01", .monthYear, locale: en), "October 2026")
        XCTAssertEqual(BrowseFormat.calendarDate("2024-01-01", .weekdayShort, locale: en), "Mon")
        XCTAssertEqual(CalendarMonth.movedMessage("2026-10-03", locale: en), "Moved to Oct 3")
        XCTAssertEqual(CalendarMonth.dayLabel("2026-10-03", count: 0, locale: en), "Saturday, October 3, no tasks")
        XCTAssertEqual(CalendarMonth.dayLabel("2026-10-03", count: 2, locale: en), "Saturday, October 3, 2 tasks")
        XCTAssertEqual(CalendarMonth.moreUnscheduled(1), "1 more undated task in Tasks")
        XCTAssertEqual(CalendarMonth.moreUnscheduled(4), "4 more undated tasks in Tasks")
    }

    func testCardPreviewText() {
        let lines = [
            PreviewLine(t: "paragraph", x: "Intro"),
            PreviewLine(t: "bulleted", x: "one"),
            PreviewLine(t: "bulleted", x: "two"),
            PreviewLine(t: "numbered", x: "first"),
            PreviewLine(t: "numbered", x: "second"),
            PreviewLine(t: "todo", x: "done", c: true),
            PreviewLine(t: "todo", x: "open"),
            PreviewLine(t: "paragraph", x: "   "),
            PreviewLine(t: "table", x: "", rows: [["a", "", "b"], ["", ""]]),
        ]
        XCTAssertEqual(BrowseFormat.previewText(lines, excerpt: "x"), "Intro\n\n• one\n• two\n1. first\n2. second\n☑ done\n☐ open\n\na  b")
        XCTAssertEqual(BrowseFormat.previewText(nil, excerpt: "From excerpt"), "From excerpt")
        XCTAssertEqual(BrowseFormat.previewText([PreviewLine(t: "paragraph", x: " ")], excerpt: "Fallback"), "Fallback")
    }

    func testSummaryDecodesPreview() throws {
        let json = #"{"id":"d1","title":"T","kind":"document","createdAt":1,"updatedAt":2,"preview":[{"t":"todo","x":"Buy","c":true},{"t":"numbered","x":"a","l":1.0}]}"#
        let doc = try JSONDecoder().decode(DocumentSummary.self, from: Data(json.utf8))
        XCTAssertEqual(doc.preview?.count, 2)
        XCTAssertEqual(doc.preview?.first?.c, true)
        let roundTrip = try JSONDecoder().decode(DocumentSummary.self, from: JSONEncoder().encode(doc))
        XCTAssertEqual(roundTrip.preview, doc.preview)
    }

    func testListStatus() {
        XCTAssertEqual(BrowseFormat.listStatus(count: 1, templates: false), "1 note")
        XCTAssertEqual(BrowseFormat.listStatus(count: 12, templates: false, arranging: true), "12 notes · drag to arrange")
        XCTAssertEqual(BrowseFormat.listStatus(count: 48, more: true, templates: false, savedOnDevice: true), "48+ notes · saved on this device")
        XCTAssertEqual(BrowseFormat.listStatus(count: 1, templates: true), "1 template")
        XCTAssertEqual(BrowseFormat.pages(1), "1 page")
        XCTAssertEqual(BrowseFormat.pages(3), "3 pages")
    }

    func testParseTime() {
        XCTAssertEqual(BrowseFormat.parseTime("9:30"), "09:30")
        XCTAssertEqual(BrowseFormat.parseTime("21:05"), "21:05")
        XCTAssertEqual(BrowseFormat.parseTime("9:30 pm"), "21:30")
        XCTAssertEqual(BrowseFormat.parseTime("12:00am"), "00:00")
        XCTAssertEqual(BrowseFormat.parseTime("12 pm"), "12:00")
        XCTAssertEqual(BrowseFormat.parseTime("7"), "07:00")
        XCTAssertNil(BrowseFormat.parseTime("25:00"))
        XCTAssertNil(BrowseFormat.parseTime("9:7"))
        XCTAssertNil(BrowseFormat.parseTime("13 pm"))
        XCTAssertNil(BrowseFormat.parseTime(""))
    }

    func testManualOrderPlacement() {
        let ids = ["a", "b", "c", "d"]
        // Moving down: after the target.
        XCTAssertEqual(BrowseOrder.placement(dragged: "a", target: "c", in: ids)?.after, "c")
        XCTAssertEqual(BrowseOrder.placement(dragged: "a", target: "c", in: ids)?.before, "d")
        // Moving up: before the target.
        XCTAssertEqual(BrowseOrder.placement(dragged: "d", target: "b", in: ids)?.after, "a")
        XCTAssertEqual(BrowseOrder.placement(dragged: "d", target: "b", in: ids)?.before, "b")
        XCTAssertEqual(BrowseOrder.placement(dragged: "c", target: "a", in: ids)?.after, nil)
        XCTAssertEqual(BrowseOrder.placement(dragged: "a", target: "d", in: ids)?.before, nil)
        XCTAssertNil(BrowseOrder.placement(dragged: "a", target: "a", in: ids))
        XCTAssertNil(BrowseOrder.placement(dragged: "a", target: "z", in: ids))
        XCTAssertEqual(BrowseOrder.nudgeTarget("b", -1, in: ids), "a")
        XCTAssertEqual(BrowseOrder.nudgeTarget("d", 1, in: ids), nil)
    }

    func testListSorts() {
        var a = DocumentSummary(id: "a", workspaceId: "", title: "beta", rank: "m", createdAt: 1, updatedAt: 30)
        var b = DocumentSummary(id: "b", workspaceId: "", title: "Alpha", rank: "z", createdAt: 3, updatedAt: 10)
        let c = DocumentSummary(id: "c", workspaceId: "", title: "gamma", rank: "a", createdAt: 2, updatedAt: 20)
        a.title = "beta"
        b.title = "Alpha"
        XCTAssertEqual(BrowseOrder.sorted([a, b, c], by: .updated).map(\.id), ["a", "c", "b"])
        XCTAssertEqual(BrowseOrder.sorted([a, b, c], by: .created).map(\.id), ["b", "c", "a"])
        XCTAssertEqual(BrowseOrder.sorted([a, b, c], by: .title).map(\.id), ["b", "a", "c"])
        XCTAssertEqual(BrowseOrder.sorted([a, b, c], by: .manual).map(\.id), ["c", "a", "b"])
    }

    func testFoldersAndTagsPages() throws {
        let json = #"{"folders":[{"id":"f1","name":"Work","color":null,"parentFolderId":null,"rank":"a","createdAt":1,"updatedAt":50,"documentCount":3,"previews":[{"cover":{"kind":"none"},"title":"N","excerpt":"E"}]},{"id":"f2","name":"archive","color":"blue-haze","parentFolderId":"f1","rank":"b","createdAt":5,"updatedAt":10,"documentCount":3}],"tags":[{"id":"t1","name":"idea","color":"moss","createdAt":2,"documentCount":4},{"id":"t2","name":"Book","color":"muted","createdAt":9,"documentCount":1}]}"#
        let index = try JSONDecoder().decode(OrganizationIndex.self, from: Data(json.utf8))
        XCTAssertEqual(index.folders.count, 2)
        XCTAssertEqual(index.folders[0].previews?.first?.title, "N")
        XCTAssertEqual(OrganizationIndex.folders(index.folders, query: "", sort: .name).map(\.id), ["f2", "f1"])
        XCTAssertEqual(OrganizationIndex.folders(index.folders, query: "", sort: .updated).map(\.id), ["f1", "f2"])
        // Same count: by name.
        XCTAssertEqual(OrganizationIndex.folders(index.folders, query: "", sort: .count).map(\.id), ["f2", "f1"])
        XCTAssertEqual(OrganizationIndex.folders(index.folders, query: "", sort: .created).map(\.id), ["f2", "f1"])
        XCTAssertEqual(OrganizationIndex.folders(index.folders, query: " WOR ", sort: .name).map(\.id), ["f1"])
        XCTAssertEqual(OrganizationIndex.tags(index.tags, query: "#ide", sort: .name).map(\.id), ["t1"])
        XCTAssertEqual(OrganizationIndex.tags(index.tags, query: "", sort: .name).map(\.id), ["t2", "t1"])
        XCTAssertEqual(OrganizationIndex.tags(index.tags, query: "", sort: .count).map(\.id), ["t1", "t2"])
        XCTAssertEqual(OrganizationIndex.countText(shown: 1, total: 9, searching: true, noun: "folder"), "1 of 9 folders")
        XCTAssertEqual(OrganizationIndex.countText(shown: 1, total: 1, searching: false, noun: "tag"), "1 tag")
        XCTAssertEqual(OrganizationIndex.countText(shown: 4, total: 4, searching: false, noun: "folder"), "4 folders")
        // The offline cache writes the same shape back.
        let again = try JSONDecoder().decode(OrganizationIndex.self, from: JSONEncoder().encode(index))
        XCTAssertEqual(again, index)
    }

    func testTaskEditFollowsTheServer() {
        var p = TodoProps(checked: false, dueDate: "2026-10-01", dueTime: "09:00", priority: .high)
        TaskEdit(checked: true).apply(to: &p, now: 100)
        XCTAssertTrue(p.checked)
        XCTAssertEqual(p.completedAt, 100)
        TaskEdit(checked: false).apply(to: &p, now: 200)
        XCTAssertNil(p.completedAt)
        TaskEdit(canceled: true).apply(to: &p, now: 300)
        XCTAssertEqual(p.canceled, true)
        XCTAssertFalse(p.checked)
        XCTAssertEqual(p.completedAt, 300)
        TaskEdit(checked: true).apply(to: &p, now: 400)
        XCTAssertNil(p.canceled)
        TaskEdit(canceled: true).apply(to: &p, now: 500)
        TaskEdit(canceled: false).apply(to: &p, now: 600)
        XCTAssertNil(p.canceled)
        XCTAssertNil(p.completedAt)
        // Clearing the date clears the time too.
        TaskEdit(dueDate: .some(nil)).apply(to: &p, now: 0)
        XCTAssertNil(p.dueDate)
        XCTAssertNil(p.dueTime)
        TaskEdit(priority: TaskPriority.none).apply(to: &p, now: 0)
        XCTAssertNil(p.priority)
        TaskEdit(assigneeId: .some("u1")).apply(to: &p, now: 0)
        XCTAssertEqual(p.assigneeId, "u1")
        TaskEdit(assigneeId: .some(nil)).apply(to: &p, now: 0)
        XCTAssertNil(p.assigneeId)
        XCTAssertEqual(TaskEdit(dueDate: .some(nil), priority: .low).serverFields, ["dueDate": .null, "priority": .string("low")])
    }

    func testTaskEditFormSendsOnlyChanges() {
        let same = TaskEdit.fromForm(status: .open, dueDate: "2026-10-01", dueTime: nil, priority: .none, assigneeId: nil,
                                     status: .open, dueDate: "2026-10-01", dueTime: "", priority: .none, assigneeId: "")
        XCTAssertTrue(same.isEmpty)
        let reopen = TaskEdit.fromForm(status: .canceled, dueDate: nil, dueTime: nil, priority: .none, assigneeId: nil,
                                       status: .open, dueDate: "", dueTime: "", priority: .none, assigneeId: "")
        XCTAssertEqual(reopen, TaskEdit(canceled: false))
        let undone = TaskEdit.fromForm(status: .done, dueDate: nil, dueTime: nil, priority: .none, assigneeId: nil,
                                       status: .open, dueDate: "", dueTime: "", priority: .none, assigneeId: "")
        XCTAssertEqual(undone, TaskEdit(checked: false))
        // A time without a date isn't kept.
        let cleared = TaskEdit.fromForm(status: .open, dueDate: "2026-10-01", dueTime: "09:00", priority: .high, assigneeId: "u1",
                                        status: .open, dueDate: "", dueTime: "09:00", priority: .high, assigneeId: "")
        XCTAssertEqual(cleared, TaskEdit(dueDate: .some(nil), dueTime: .some(nil), assigneeId: .some(nil)))
    }

    func testTaskViews() {
        let today = "2026-10-01"
        XCTAssertEqual(TaskBrowse.views(status: .open, dueDate: nil, assigneeId: nil, today: today, viewerId: "me", personal: true), [.all, .inbox, .mine])
        XCTAssertEqual(TaskBrowse.views(status: .open, dueDate: nil, assigneeId: nil, today: today, viewerId: "me", personal: false), [.all, .inbox])
        XCTAssertEqual(TaskBrowse.views(status: .open, dueDate: "2026-09-30", assigneeId: "me", today: today, viewerId: "me", personal: false), [.all, .today, .mine])
        XCTAssertEqual(TaskBrowse.views(status: .open, dueDate: "2026-10-09", assigneeId: "x", today: today, viewerId: "me", personal: false), [.all, .upcoming])
        XCTAssertEqual(TaskBrowse.views(status: .canceled, dueDate: nil, assigneeId: nil, today: today, viewerId: "me", personal: true), [.completed])
        XCTAssertEqual(TaskBrowse.emptyMessage(.mine, personal: true), "No open tasks. In Personal every unassigned task is yours.")
        XCTAssertEqual(TaskBrowse.emptyMessage(.today, personal: false), "Nothing due today. Enjoy the quiet.")
        XCTAssertEqual(TaskBrowse.label(.mine), "My Tasks")
    }

    func testTaskOrderAndGroups() {
        typealias T = (dueDate: String?, dueTime: String?, updatedAt: Double)
        let rows: [T] = [(nil, nil, 5), ("2026-10-02", "10:00", 1), ("2026-10-02", nil, 9), ("2026-10-01", nil, 1), ("2026-10-02", "08:00", 1)]
        let sorted = rows.sorted { TaskBrowse.openOrder($0, $1) }
        XCTAssertEqual(sorted.map { "\($0.dueDate ?? "-") \($0.dueTime ?? "-")" }, ["2026-10-01 -", "2026-10-02 08:00", "2026-10-02 10:00", "2026-10-02 -", "- -"])
        let groups = TaskBrowse.groupByDate(["2026-10-02", "2026-10-02", nil, "2026-10-05"], dueDate: { $0 }, locale: en)
        XCTAssertEqual(groups.map(\.key), ["2026-10-02", "none", "2026-10-05"])
        XCTAssertEqual(groups.map(\.label), ["Friday, October 2", "No date", "Monday, October 5"])
        XCTAssertEqual(groups[0].items.count, 2)
    }

    func testCalendarMonthGrid() {
        // October 2026 starts on a Thursday: the grid starts Monday, September 28.
        let days = CalendarMonth.days(month: "2026-10")
        XCTAssertEqual(days.count, 42)
        XCTAssertEqual(days.first, "2026-09-28")
        XCTAssertEqual(days.last, "2026-11-08")
        XCTAssertTrue(days.contains("2026-10-31"))
        // A month that starts on a Monday starts on its 1st.
        XCTAssertEqual(CalendarMonth.days(month: "2026-06").first, "2026-06-01")
        XCTAssertEqual(CalendarMonth.shift("2026-01", -1), "2025-12")
        XCTAssertEqual(CalendarMonth.shift("2026-12", 1), "2027-01")
        let moved = CalendarMonth.move("2026-10-31", by: 1, shownMonth: "2026-10")
        XCTAssertEqual(moved.date, "2026-11-01")
        XCTAssertEqual(moved.month, "2026-11")
    }

    func testSelectionRectangle() {
        let frames = ["a": CGRect(x: 0, y: 0, width: 100, height: 100), "b": CGRect(x: 150, y: 0, width: 100, height: 100), "c": CGRect(x: 0, y: 150, width: 100, height: 100)]
        let rect = Marquee.rect(from: CGPoint(x: 120, y: 120), to: CGPoint(x: 90, y: 40))
        XCTAssertEqual(rect, CGRect(x: 90, y: 40, width: 30, height: 80))
        XCTAssertEqual(Marquee.hits(rect, frames: frames), ["a"])
        // Touching an edge counts.
        XCTAssertEqual(Marquee.hits(CGRect(x: 100, y: 100, width: 50, height: 50), frames: frames), ["a", "b", "c"])
        XCTAssertEqual(Marquee.hits(CGRect(x: 110, y: 110, width: 5, height: 5), frames: frames, base: ["c"]), ["c"])
        var selection = NoteSelectionState()
        selection.setPicked(["a", "b"])
        XCTAssertEqual(selection.selectedIds(in: ["b", "c", "a"]), ["b", "a"])
    }
}
