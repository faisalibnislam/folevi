// Tasks (plan 5.8; web iphone/Tasks.tsx on the phone, views/TasksView.tsx wider): the view chips with counts, a
// filter, Quick Add, then the tasks grouped by note (Upcoming by day) under headers that fold. The box checks a
// task off (a success haptic, the tick, then it leaves with Undo); swipe right completes, left moves it to tomorrow
// or opens its date; a tap opens its details. The frame draws the bars and reads `TasksScreen.title`; frames
// without a title bar (the Mac's content area) pass `showsHeader: true`.
import SwiftUI
import FoleviDesign
import FoleviEngine

public struct TasksScreen: View {
    public static let title = "Tasks"

    @Bindable var model: TasksModel
    let showsHeader: Bool
    @FocusState private var addFocused: Bool
    @State private var width: CGFloat = 390
    private let send = IntentSender()

    public init(model: TasksModel, showsHeader: Bool = false) {
        self.model = model
        self.showsHeader = showsHeader
    }

    private var wide: Bool { width >= 700 }

    public var body: some View {
        let sections = model.sections
        let today = model.today
        List {
            Group {
                if showsHeader {
                    Text(Self.title).foleviFont(.largeTitle).foregroundStyle(Folevi.color.heading)
                        .padding(.horizontal, 20).padding(.top, 14)
                }
                TaskChipsRow(model: model).padding(.top, 2)
                SearchField(text: $model.filter, prompt: "Filter by task or note").padding(.horizontal, 16)
                if model.canEdit && model.view != .completed {
                    QuickAddTaskField(model: model, focused: $addFocused).padding(.horizontal, 16).padding(.top, 4)
                }
            }
            .listRowInsets(EdgeInsets())
            .listRowSeparator(.hidden)
            .listRowBackground(Folevi.color.canvas)

            if !model.pending.isEmpty {
                Section {
                    ForEach(model.pending) { item in
                        PendingTaskRow(item: item, onRetry: { Task { await model.retry(item.id) } }, onDiscard: { model.discard(item.id) })
                            .listRowInsets(EdgeInsets())
                            .listRowBackground(Folevi.color.canvas)
                    }
                }
            }

            if model.isLoading {
                loadingRows
            } else if sections.isEmpty {
                empty
            } else {
                ForEach(sections) { section in
                    Section {
                        ForEach(section.tasks, id: \.id) { task in row(task, today: today) }
                    } header: {
                        TaskSectionHeader(
                            section: section,
                            onOpenNote: section.kind == .note ? { send(.openNote(id: section.id, blockId: nil)) } : nil,
                            onFold: { withAnimation(.folevi()) { model.toggleFold(section.id) } }
                        )
                        .listRowInsets(EdgeInsets())
                        .background(Folevi.color.canvas)
                    }
                }
            }
            Color.clear.frame(height: 100).listRowBackground(Folevi.color.canvas).listRowSeparator(.hidden)
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .environment(\.defaultMinListRowHeight, 1)
        .frame(maxWidth: wide ? 820 : .infinity)
        .frame(maxWidth: .infinity)
        .background(Folevi.color.canvas)
        .scrollDismissesKeyboard(.immediately)
        .refreshable { await model.refresh() }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        .onChange(of: model.list.value) { _, _ in model.reconcile() }
        .onAppear { model.setVisible(true) }
        .onDisappear { model.setVisible(false) }
        .sheet(isPresented: Binding(get: { model.detail != nil }, set: { if !$0 { model.detail = nil } })) {
            if let task = model.detail { TaskDetailSheet(model: model, taskId: task.id, initial: task) }
        }
        .background {
            // Command-N adds a task (iPad keyboards and the Mac); Command-F filters.
            Button("New task") { addFocused = true }.keyboardShortcut("n", modifiers: .command).hidden()
        }
        .accessibilityIdentifier("tasks-screen")
    }

    @ViewBuilder
    private func row(_ task: TaskRow, today: String) -> some View {
        TaskLineView(
            task: task,
            today: today,
            showNote: model.view == .upcoming,
            onDay: model.view == .today || model.view == .upcoming,
            onToggle: { model.toggle(task) },
            onOpen: { model.open(task) }
        )
        .listRowInsets(EdgeInsets())
        .listRowBackground(Folevi.color.canvas)
        .listRowSeparatorTint(Folevi.color.line)
        .alignmentGuide(.listRowSeparatorLeading) { _ in 53 }
        .swipeActions(edge: .leading, allowsFullSwipe: true) {
            if task.status == "open" {
                Button { model.toggle(task) } label: { Label("Done", systemImage: "checkmark") }.tint(Folevi.color.moss)
            } else {
                Button { model.toggle(task) } label: { Label("Reopen", systemImage: "arrow.uturn.backward") }.tint(Folevi.color.inkMuted)
            }
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            if task.status == "open" && model.canEdit {
                Button { model.open(task) } label: { Label("Date", systemImage: "calendar.badge.clock") }.tint(Color(red: 0.36, green: 0.42, blue: 0.82))
                Button { Task { await model.moveToTomorrow(task) } } label: { Label("Tomorrow", systemImage: "sun.max") }.tint(Folevi.color.marigold)
            }
        }
        .contextMenu {
            Button { model.toggle(task) } label: {
                task.status == "open" ? Label("Mark as done", systemImage: "checkmark.circle") : Label("Reopen", systemImage: "arrow.uturn.backward")
            }
            if task.status == "open" && model.canEdit {
                Button { Task { await model.moveToTomorrow(task) } } label: { Label("Move to tomorrow", systemImage: "sun.max") }
                Button { model.open(task) } label: { Label("Details…", systemImage: "info.circle") }
            }
            Divider()
            Button { send(.openNote(id: task.noteId, blockId: task.id)) } label: { Label("Open in note", systemImage: "doc.text") }
        }
        .accessibilityActions {
            Button(task.status == "open" ? "Mark as done" : "Reopen") { model.toggle(task) }
            if task.status == "open" { Button("Move to tomorrow") { Task { await model.moveToTomorrow(task) } } }
            Button("Open in note") { send(.openNote(id: task.noteId, blockId: task.id)) }
        }
    }

    private var loadingRows: some View {
        ForEach(0..<5, id: \.self) { i in
            HStack(spacing: 12) {
                RoundedRectangle(cornerRadius: FoleviTokens.Radius.chip).fill(Folevi.color.surfaceSunken).frame(width: 22, height: 22)
                RoundedRectangle(cornerRadius: FoleviTokens.Radius.chip).fill(Folevi.color.surfaceSunken).frame(height: 16).frame(maxWidth: CGFloat(260 - i * 28))
                Spacer()
            }
            .padding(.leading, 20)
            .frame(height: 52)
            .listRowInsets(EdgeInsets())
            .listRowSeparator(.hidden)
            .listRowBackground(Folevi.color.canvas)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading tasks")
    }

    private var empty: some View {
        let text = model.emptyText
        return EmptyState(systemImage: model.view == .today ? "sun.max" : "checkmark.circle", title: text.title, message: text.message)
            .frame(maxWidth: .infinity)
            .padding(.top, 60)
            .listRowInsets(EdgeInsets())
            .listRowSeparator(.hidden)
            .listRowBackground(Folevi.color.canvas)
    }
}

/// Bar items the frame puts beside the title: More (Calendar, Completed tasks).
public struct TasksTrailingMenu: View {
    let model: TasksModel
    private let send = IntentSender()
    public init(model: TasksModel) { self.model = model }
    public var body: some View {
        Menu {
            Button { send(.openCalendar(date: nil)) } label: { Label("Calendar", systemImage: "calendar") }
            Button { model.select(.completed) } label: { Label("Completed tasks", systemImage: "checkmark.circle") }
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
        .accessibilityIdentifier("tasks-more")
    }
}
