// A Folevi Core window: a two-column split view (the sidebar and the screen), the toolbar with Back and Forward,
// the screen's own items and New Note, an inspector on notes (Foli AI and the note's info), toasts at the foot,
// and the engine's gates and the app lock over everything. Window tabs are macOS's own (⌘T, Show All Tabs).
import AppKit
import FoleviDesign
import FoleviEngine
import SwiftUI

struct MainWindow: View {
    let seed: WindowSeed?
    @Environment(AppModel.self) private var app
    @State private var window: WindowModel
    @Environment(\.openWindow) private var openWindow

    init(seed: WindowSeed?) {
        self.seed = seed
        _window = State(initialValue: WindowModel(start: seed?.start ?? .home))
    }

    var body: some View {
        @Bindable var window = window
        ZStack {
            NavigationSplitView(columnVisibility: $window.columnVisibility) {
                Sidebar(window: window)
            } detail: {
                ScreenView(window: window)
                    .navigationTitle(window.title)
                    .toolbar { WindowToolbar(window: window) }
            }
            .inspector(isPresented: $window.inspectorShown) {
                Inspector(window: window)
                    .inspectorColumnWidth(min: 280, ideal: 340, max: 520)
            }
            .overlay(alignment: .bottom) { ToastStack() }
            .overlay { if window.paletteShown { CommandPalette(window: window) } }

            if let gate = app.gate, gate.gate != "loading" {
                GateScreen(gate: gate)
                    .transition(.opacity)
            } else if app.gate?.gate == "loading" || (!app.ready && app.session.value == nil) {
                StartingScreen()
            }
            if MacAppLock.shared.isCovered { LockCover() }
        }
        .focusedSceneValue(\.window, window)
        .background(WindowAccessor(model: window, asTab: seed?.asTab == true))
        .environment(window)
        .onAppear {
            app.openWindow = { dest, asTab in openWindow(id: "main", value: WindowSeed(start: dest ?? .home, asTab: asTab)) }
        }
        .frame(minWidth: 720, minHeight: 460)
    }
}

/// The screen for where the window is.
struct ScreenView: View {
    let window: WindowModel

    var body: some View {
        switch window.current {
        case .home: HomeScreen(window: window)
        case .search(let q): SearchScreen(window: window, initial: q)
        case .foliAI(let id): FoliAIScreen(window: window, conversation: id)
        case .inbox: InboxNoteScreen(window: window)
        case .notifications: NotificationsScreen(window: window)
        case .tasks(let view): TasksScreen(window: window, view: view)
        case .calendar(let month): CalendarScreen(window: window, month: month)
        case .daily(let date): DailyNoteScreen(window: window, date: date)
        case .allNotes: NoteListScreen(window: window, kind: .all)
        case .recent: RecentScreen(window: window)
        case .starred: NoteListScreen(window: window, kind: .starred)
        case .shared: SharedScreen(window: window)
        case .sharedFolder(let id): SharedFolderScreen(window: window, id: id)
        case .drafts: NoteListScreen(window: window, kind: .unsorted)
        case .changes: ChangesScreen(window: window)
        case .templates: TemplatesScreen(window: window)
        case .folders: FoldersScreen(window: window, parent: nil)
        case .folder(let id): NoteListScreen(window: window, kind: .folder, folderId: id)
        case .tags: TagsScreen(window: window)
        case .tag(let id): NoteListScreen(window: window, kind: .tag, tagId: id)
        case .archive: NoteListScreen(window: window, kind: .archive)
        case .trash: NoteListScreen(window: window, kind: .trash)
        case .vault: VaultScreen(window: window)
        case .reviews: WebScreen(window: window, page: .reviews)
        case .graph: WebScreen(window: window, page: .graph)
        case .note(let id): NoteScreen(window: window, id: id)
        case .invite(let kind, let token): InviteScreen(window: window, kind: kind, token: token)
        }
    }
}

/// The window's toolbar: Back and Forward at the leading edge, then the screen's items; New Note at the end.
struct WindowToolbar: ToolbarContent {
    let window: WindowModel
    @Environment(AppModel.self) private var app

    var body: some ToolbarContent {
        ToolbarItemGroup(placement: .navigation) {
            ControlGroup {
                Button { window.back() } label: { Label("Back", systemImage: "chevron.backward") }
                    .disabled(!window.canGoBack)
                    .help("Back")
                Button { window.forward() } label: { Label("Forward", systemImage: "chevron.forward") }
                    .disabled(!window.canGoForward)
                    .help("Forward")
            }
            .controlGroupStyle(.navigation)
        }
        if window.current.isNote {
            NoteToolbar(window: window)
        }
        ToolbarItem(placement: .primaryAction) {
            Button {
                NoteActions.newNote(app: app, window: window)
            } label: {
                Label("New Note", systemImage: "square.and.pencil")
            }
            .help("New Note (⌘N)")
        }
    }
}

/// The engine is still starting (a cold launch before the first value).
struct StartingScreen: View {
    var body: some View {
        VStack(spacing: 14) {
            Image(nsImage: NSApp.applicationIconImage).resizable().frame(width: 72, height: 72)
            ProgressView().controlSize(.small)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.background)
    }
}

/// The app lock's cover: nothing of the notes shows until Touch ID.
struct LockCover: View {
    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "lock.fill").font(.system(size: 40)).foregroundStyle(.secondary)
            Text("Folevi Core is locked").font(.title2.weight(.semibold))
            Button("Unlock with Touch ID") { Task { await MacAppLock.shared.unlock() } }
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.regularMaterial)
        .task { await MacAppLock.shared.unlock() }
    }
}

/// The window's toasts, newest at the bottom, in a glass capsule (a floating control layer).
struct ToastStack: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        VStack(spacing: 8) {
            ForEach(app.toasts) { toast in
                HStack(spacing: 12) {
                    if toast.tone == .error { Image(systemName: "exclamationmark.circle.fill").foregroundStyle(.red) }
                    if toast.tone == .success { Image(systemName: "checkmark.circle.fill").foregroundStyle(.green) }
                    Text(toast.message).lineLimit(2)
                    if let label = toast.actionLabel, let action = toast.action {
                        Button(label) {
                            action()
                            app.dismiss(toast.id)
                        }
                        .buttonStyle(.borderless)
                        .fontWeight(.semibold)
                    }
                    Button { app.dismiss(toast.id) } label: { Image(systemName: "xmark") }
                        .buttonStyle(.borderless)
                        .foregroundStyle(.secondary)
                        .accessibilityLabel("Dismiss")
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .glassEffect(.regular, in: .capsule)
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .padding(.bottom, 18)
        .animation(.snappy, value: app.toasts)
    }
}

/// Reaches the SwiftUI window's NSWindow: the window model learns it (titles, sheets), a seed that asked for a
/// tab joins the window that was in front, and visibility changes lend and return the note's page.
struct WindowAccessor: NSViewRepresentable {
    let model: WindowModel
    let asTab: Bool

    func makeNSView(context: Context) -> NSView {
        let view = AccessorView()
        view.model = model
        view.asTab = asTab
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {}

    final class AccessorView: NSView {
        weak var model: WindowModel?
        var asTab = false
        private var observers: [NSObjectProtocol] = []

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            guard let window, let model else { return }
            model.window = window
            window.tabbingMode = .preferred
            window.tabbingIdentifier = "app.folevicore.main"
            window.title = model.title
            if asTab, let front = NSApp.windows.first(where: { $0 !== window && $0.isVisible && $0.tabbingIdentifier == window.tabbingIdentifier && $0.isMainWindow }) ?? NSApp.windows.first(where: { $0 !== window && $0.isVisible && $0.tabbingIdentifier == window.tabbingIdentifier }) {
                front.addTabbedWindow(window, ordered: .above)
                window.makeKeyAndOrderFront(nil)
            }
            let center = NotificationCenter.default
            observers.forEach(center.removeObserver)
            observers = [
                center.addObserver(forName: NSWindow.didBecomeKeyNotification, object: window, queue: .main) { [weak self] _ in
                    MainActor.assumeIsolated { if let m = self?.model { AppModel.shared.becameFront(m) } }
                },
                center.addObserver(forName: NSWindow.didChangeOcclusionStateNotification, object: window, queue: .main) { [weak self] n in
                    MainActor.assumeIsolated {
                        guard let w = n.object as? NSWindow else { return }
                        self?.model?.setVisible(w.occlusionState.contains(.visible))
                    }
                },
                center.addObserver(forName: NSWindow.willCloseNotification, object: window, queue: .main) { [weak self] _ in
                    MainActor.assumeIsolated { self?.model?.closed() }
                },
            ]
            if window.isKeyWindow { AppModel.shared.becameFront(model) }
        }

        deinit { observers.forEach(NotificationCenter.default.removeObserver) }
    }
}

// MARK: focused values for the menu bar

extension FocusedValues {
    @Entry var window: WindowModel?
}
