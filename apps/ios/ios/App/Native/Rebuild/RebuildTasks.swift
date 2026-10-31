// Tasks and Calendar in the rebuild frame (docs/IOS_REBUILD_PLAN.md, I4): the web's iPhone Tasks and Agenda drawn
// natively (FoleviPhone's PhoneTasksHeader and PhoneTasksContent, PhoneWeekStrip and PhoneAgendaContent) under the
// root bar: the place's avatar, the pill (notifications when signed in, and More), the large title. A task opens
// its sheet (PhoneTaskSheet). Each tab keeps one model while its first screen changes address (another view,
// another day).
import SwiftUI
import UIKit
import FoleviDesign
import FoleviEngine
import FoleviPhone
import FoleviScreens

/// Toasts (with Undo) and haptics for the kit's models, played by the frame.
enum RebuildFeedback {
    static func make(_ phone: PhoneModel) -> ScreenFeedback {
        ScreenFeedback(toast: { [weak phone] t in
            phone?.toast(t.message, tone: t.tone == .error ? .error : t.tone == .success ? .success : .info, actionTitle: t.actionTitle, action: t.action)
        }, haptic: { h in
            switch h {
            case .selection: UISelectionFeedbackGenerator().selectionChanged()
            case .success: UINotificationFeedbackGenerator().notificationOccurred(.success)
            case .warning: UINotificationFeedbackGenerator().notificationOccurred(.warning)
            case .error: UINotificationFeedbackGenerator().notificationOccurred(.error)
            case .impactLight: UIImpactFeedbackGenerator(style: .light).impactOccurred()
            }
        })
    }
}

/// The root screens' leading control: the place's avatar (account and places).
struct RebuildRootAvatar: View {
    let home: HomeModel
    let open: () -> Void

    var body: some View {
        Button(action: open) {
            PhonePlaceMarkView(mark: .avatar(name: home.profileName.isEmpty ? "You" : home.profileName, url: home.session.value?.profile.avatarUrl.flatMap(URL.init(string:))), size: 34)
                .frame(width: 44, height: 44)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(home.spaceName): account and places")
    }
}

/// RootPill: the bell (signed in) and More, whose menu the screen gives.
struct RebuildRootPill: View {
    let home: HomeModel
    let menus: PhoneMenus
    let openNotifications: () -> Void
    let more: () -> [PhoneMenuEntry]
    @State private var moreFrame: CGRect = .zero

    var body: some View {
        WebGlassPill {
            if home.session.value?.mode == .account {
                WebPillButton("Notifications", action: openNotifications) {
                    WebIconView(.bell, size: 21, strokeWidth: 1.9)
                }
            }
            // (A moment after the press: opened in the same update as the pill's own press, the menu was lost.)
            WebPillButton("More", action: { DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { menus.show(more(), from: moreFrame, side: .bottom, align: .end) } }) {
                WebIconView(.ellipsis, size: 24, strokeWidth: 2.2)
            }
            .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { moreFrame = $0 }
        }
    }
}

struct RebuildTasksScreen: View {
    @MainActor static var openedAtLaunch = false
    let view: TaskViewName
    let frame: PhoneFrameModel
    let menus: PhoneMenus
    let home: HomeModel
    let phone: PhoneModel
    let openAccount: () -> Void
    let openNotifications: () -> Void
    @State private var model: TasksModel

    init(view: TaskViewName, frame: PhoneFrameModel, menus: PhoneMenus, home: HomeModel, phone: PhoneModel, openAccount: @escaping () -> Void, openNotifications: @escaping () -> Void) {
        self.view = view
        self.frame = frame
        self.menus = menus
        self.home = home
        self.phone = phone
        self.openAccount = openAccount
        self.openNotifications = openNotifications
        let feedback = RebuildFeedback.make(phone)
        _model = State(initialValue: TasksModel(client: phone.client, view: view, feedback: feedback))
    }

    /// FOLEVI_REBUILD_TASK=<title>: that task's sheet at launch (for checking it headlessly).
    private func openLaunchTask() {
        guard let title = ProcessInfo.processInfo.environment["FOLEVI_REBUILD_TASK"], !Self.openedAtLaunch,
              let t = model.list.value?.groups.lazy.flatMap(\.tasks).first(where: { $0.title == title }) else { return }
        Self.openedAtLaunch = true
        model.open(t)
    }

    private var actions: PhoneTasksActions {
        PhoneTasksActions(select: { frame.open(.tasks($0)) }, openNote: { phone.router?.openNote($0, source: nil, focus: false) })
    }

    var body: some View {
        PhoneScreen(PhoneScreenOptions(title: "Tasks"), root: true, scrollToTop: frame.scrollToTop) {
            RebuildRootAvatar(home: home, open: openAccount)
        } trailing: {
            RebuildRootPill(home: home, menus: menus, openNotifications: openNotifications) {
                [
                    PhoneMenuEntry(.item("Calendar", icon: .calendarDays)) { frame.open(.calendar(nil)) },
                    PhoneMenuEntry(.item("Completed tasks", icon: .circleCheckBig)) { frame.open(.tasks(.completed)) },
                ]
            }
        } header: {
            PhoneTasksHeader(model: model, actions: actions)
        } content: {
            PhoneTasksContent(model: model, actions: actions)
        }
        .onChange(of: view) { _, v in model.select(v) }
        .onChange(of: model.list.value) { _, v in
            guard let v else { return }
            model.edits.reconcile(v.groups.lazy.flatMap(\.tasks))
            openLaunchTask()
        }
        .task {
            try? await Task.sleep(for: .seconds(1.5))
            openLaunchTask()
        }
        .phoneSheet(isPresented: Binding(get: { model.detail != nil }, set: { if !$0 { model.detail = nil } }), size: .fit) {
            if let task = model.detail {
                PhoneTaskSheet(host: model, task: task, close: { model.detail = nil }, openNote: { t in phone.router?.openNote(t.noteId, source: nil, focus: false) })
            }
        }
    }
}

struct RebuildCalendarScreen: View {
    let date: String?
    let frame: PhoneFrameModel
    let menus: PhoneMenus
    let home: HomeModel
    let phone: PhoneModel
    let openAccount: () -> Void
    let openNotifications: () -> Void
    @State private var model: CalendarModel

    init(date: String?, frame: PhoneFrameModel, menus: PhoneMenus, home: HomeModel, phone: PhoneModel, openAccount: @escaping () -> Void, openNotifications: @escaping () -> Void) {
        self.date = date
        self.frame = frame
        self.menus = menus
        self.home = home
        self.phone = phone
        self.openAccount = openAccount
        self.openNotifications = openNotifications
        let feedback = RebuildFeedback.make(phone)
        _model = State(initialValue: CalendarModel(client: phone.client, date: date, feedback: feedback))
    }

    /// The iPhone shows the agenda unless Week or Month was picked from "…" (its own key, as the web keeps one).
    private var layout: CalendarLayout { model.layout(compact: true) }

    var body: some View {
        let tasks = model.tasksByDay, events = model.eventsByDay
        PhoneScreen(PhoneScreenOptions(title: model.title), root: true, scrollToTop: frame.scrollToTop) {
            RebuildRootAvatar(home: home, open: openAccount)
        } trailing: {
            if model.selected != model.today {
                WebGlassTextButton("Today") { model.goToday() }
            }
            RebuildRootPill(home: home, menus: menus, openNotifications: openNotifications) { menu }
        } header: {
            if layout != .week {
                PhoneWeekStrip(today: model.today, selected: model.selected, startsOpen: ProcessInfo.processInfo.environment["FOLEVI_REBUILD_MONTH"] == "1", marked: { model.marked($0, tasks: tasks, events: events) }, select: { model.select($0) }, feel: { model.feedback.haptic(.selection) })
            }
        } content: {
            switch layout {
            case .agenda:
                PhoneAgendaContent(model: model, actions: PhoneAgendaActions(add: { model.addingOn = $0 }, openEvent: { model.openEvent = $0 }))
            case .month:
                CalendarMonthGrid(model: model).padding(.horizontal, 12).padding(.top, 8)
            case .week:
                CalendarWeekGrid(model: model).frame(height: 640)
            }
        }
        .onChange(of: date) { _, d in if let d { model.select(d) } }
        .onChange(of: model.tasks.value) { _, _ in model.reconcile() }
        .onAppear { model.setVisible(true) }
        .onDisappear { model.setVisible(false) }
        .phoneSheet(isPresented: Binding(get: { model.detail != nil }, set: { if !$0 { model.detail = nil } }), size: .fit) {
            if let task = model.detail {
                PhoneTaskSheet(host: model, task: task, close: { model.detail = nil }, openNote: { t in phone.router?.openNote(t.noteId, source: nil, focus: false) })
            }
        }
        .alert("New task", isPresented: Binding(get: { model.addingOn != nil }, set: { if !$0 { model.addingOn = nil } })) {
            AddOnDayField(model: model)
        } message: {
            if let day = model.addingOn { Text(TaskDates.dayHeading(day, today: model.today).date) }
        }
        .alert(model.openEvent?.title ?? "", isPresented: Binding(get: { model.openEvent != nil }, set: { if !$0 { model.openEvent = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            if let e = model.openEvent {
                Text([CalendarMath.eventWhen(e, timeZone: model.timeZone), e.calendarName, e.location].filter { !$0.isEmpty }.joined(separator: "\n"))
            }
        }
    }

    /// The Calendar's "…" (Agenda.tsx calendarMenu): the layouts, and subscribing to a calendar.
    private var menu: [PhoneMenuEntry] {
        var entries = [
            PhoneMenuEntry(.heading("Show")),
            PhoneMenuEntry(.item("Agenda", icon: .rows3, checked: layout == .agenda)) { model.choose(.agenda) },
            PhoneMenuEntry(.item("Week", icon: .calendarRange, checked: layout == .week)) { model.choose(.week) },
            PhoneMenuEntry(.item("Month", icon: .calendarDays, checked: layout == .month)) { model.choose(.month) },
        ]
        if home.session.value?.mode == .account {
            entries.append(PhoneMenuEntry(.separator()))
            entries.append(PhoneMenuEntry(.item("Subscribe to a calendar", icon: .rss)) { model.openCalendars() })
        }
        return entries
    }
}

/// A day's +: the task's words, added on that day.
private struct AddOnDayField: View {
    let model: CalendarModel
    @State private var text = ""

    var body: some View {
        TextField("What needs doing?", text: $text)
        Button("Add") {
            guard let day = model.addingOn else { return }
            let words = text
            Task { _ = await model.addTask(words, on: day) }
        }
        Button("Cancel", role: .cancel) {}
    }
}
