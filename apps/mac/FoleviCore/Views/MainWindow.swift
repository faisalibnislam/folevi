// A Folevi window, in the owner's main-window profile (docs/design/macloving-mac-ui.md, 23 November 2026): a
// hidden title bar over one translucent surface (the sidebar and the margins, no divider), and one opaque rounded
// card holding the screen. The card's top bar (Views/Common/ScreenBar.swift) has Back and Forward, the title, the
// screen's actions, New Note and its search; the inspector (Foli AI and the note's info) is a flat rounded panel
// inside the card. Toasts at the foot, the engine's gates and the app lock over everything. Window tabs are
// macOS's own (⌘T, Show All Tabs).
import AppKit
import FoleviDesign
import FoleviEngine
import SwiftUI

struct MainWindow: View {
    let seed: WindowSeed?
    private var app: AppModel { .shared }
    @State private var window: WindowModel
    @Environment(\.openWindow) private var openWindow
    @Environment(\.openSettings) private var openSettings
    /// Where this window was, kept by macOS with the window (state restoration).
    @SceneStorage("core.path") private var restoredPath = ""
    @SceneStorage("core.listStyle") private var restoredStyle = ""
    @SceneStorage("core.back") private var restoredBack = ""
    @SceneStorage("core.forward") private var restoredForward = ""

    init(seed: WindowSeed?) {
        self.seed = seed
        _window = State(initialValue: WindowModel(start: seed?.start ?? .home))
    }

    var body: some View {
        @Bindable var window = window
        Group {
            if let gate = app.gate, gate.gate != "loading" {
                // A gate is the whole window: no sidebar, no toolbar items until the engine is ready.
                GateScreen(gate: gate)
                    .onAppear { window.window?.title = "Folevi" }
                    .background(.background)
                    .transition(.opacity)
            } else if app.gate?.gate == "loading" || (!app.ready && app.session.value == nil) {
                StartingScreen()
            } else {
                GeometryReader { geo in
                    HStack(spacing: 0) {
                        // The owner's rule: the sidebar is always there, with no hide button (Focus Mode on a note
                        // still gives the page the whole card).
                        Sidebar(window: window)
                            .frame(width: WindowMetrics.sidebarWidth)
                        WindowCard(window: window)
                    }
                    // The content runs under the hidden title bar; with two tabs or more, macOS draws its tab bar
                    // there, so everything starts below it (the safe area holds the title bar and the tab bar).
                    .padding(.top, window.tabBarVisible ? geo.safeAreaInsets.top : 0)
                    .environment(\.windowTabBarVisible, window.tabBarVisible)
                    .ignoresSafeArea()
                }
                .overlay(alignment: .bottom) { ToastStack().padding(.bottom, window.current.isNote ? 78 : 0) }
                .overlay(alignment: .bottomTrailing) {
                    // A view that stays carries the animation, so every way of opening or closing it (⌘J, Esc, the
                    // button, a menu) animates alike.
                    GlassEffectContainer { ZStack(alignment: .bottomTrailing) { AskOverlay(window: window) } }
                        .coreAnimation(Motion.panel, value: window.askShown)
                }
                .overlay {
                    ZStack { if window.paletteShown { CommandPalette(window: window) } }
                        .coreAnimation(Motion.panel, value: window.paletteShown)
                }
                .sheet(item: $window.folderPick) { FolderPickerSheet(target: $0) }
                .sheet(item: $window.placeMove) { PlaceMoveSheet(notes: $0.notes, folders: $0.folders) }
                .sheet(item: $window.colorPick) { FolderColorSheet(target: $0) }
                .sheet(isPresented: $window.newWorkspaceShown) { NewWorkspaceSheet() }
                // One control size (the owner's polish pass: the system's large, none small).
                .controlSize(.large)
                .sheet(isPresented: $window.quickAddShown) { QuickAddView(close: { window.quickAddShown = false }, inWindow: true) }
            }
        }
        .overlay { if MacAppLock.shared.isCovered { LockCover() } }
        .coreAnimation(Motion.fade, value: app.gate?.gate)
        .tint(.foleviInk)
        .focusedSceneValue(\.window, window)
        .background(WindowAccessor(model: window, asTab: seed?.asTab == true, keepsOpener: seed?.asTab == true && seed?.start.isNote == true, background: seed?.background == true))
        .environment(window)
        .onAppear {
            window.start()
            app.openHelp = { openWindow(id: "help") }
            app.openWindow = { dest, asTab, background in openWindow(id: "main", value: WindowSeed(start: dest ?? .home, asTab: asTab, background: background)) }
            SettingsRouter.shared.openSettings = { openSettings() }
            // A restored window goes back where it was (a fresh window opens where its seed says).
            if seed?.start == .home, !restoredPath.isEmpty, let d = Destination(path: restoredPath), d != .home { window.replace(with: d) }
            if let s = WindowModel.ListStyleChoice(rawValue: restoredStyle) { window.listStyle = s }
            if seed?.start == .home, !restoredPath.isEmpty {
                window.restoreHistory(back: restoredBack.split(separator: "\n").map(String.init), forward: restoredForward.split(separator: "\n").map(String.init))
            }
            FloatingNotes.restoreOnce(openWindow)
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(300))
                app.restoreWindows(into: window)
            }
        }
        .onChange(of: window.current) {
            restoredPath = window.current.path
            restoredBack = window.backPaths.joined(separator: "\n")
            restoredForward = window.forwardPaths.joined(separator: "\n")
            app.saveWindowsSoon()
        }
        .onChange(of: window.listStyle) { restoredStyle = window.listStyle.rawValue }
        .frame(minWidth: 860, minHeight: 480)
        .containerBackground(for: .window) { WindowMaterial() }
        .onChange(of: app.currentSpaceKey, initial: true) {
            // Each space keeps its own tabs (only the front window acts, once).
            if app.front == nil || app.front === window { app.spaceMaybeChanged() }
        }
        .onChange(of: app.session.value?.appearance, initial: true) {
            // Folevi's own Light / Dark / System setting decides the windows' look, as on the web.
            switch app.session.value?.appearance.rawValue {
            case "light": NSApp.appearance = NSAppearance(named: .aqua)
            case "dark": NSApp.appearance = NSAppearance(named: .darkAqua)
            default: NSApp.appearance = nil
            }
        }
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
        case .catchUp: CatchUpScreen(window: window)
        case .graph: WebScreen(window: window, page: .graph)
        case .note(let id):
            NoteScreen(window: window, id: id)
                .screenLeading { NoteBarChip(window: window) }
                .screenActions { NoteBarActions(window: window) }
        case .invite(let kind, let token): InviteScreen(window: window, kind: kind, token: token)
        }
    }
}

/// The opaque rounded card: the top bar (from what the screen says), the screen, and the inspector panel.
struct WindowCard: View {
    let window: WindowModel

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: WindowMetrics.containerRadius, style: .continuous)
        VStack(spacing: 0) {
            // The bar's place: the bar itself is drawn over it from the screen's preference (below).
            Color.clear.frame(height: WindowMetrics.barHeight)
            HStack(spacing: 12) {
                ScreenView(window: window)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .dropDestination(for: URL.self) { urls, _ in
                        guard !window.current.isNote, urls.contains(where: FileImport.accepts) else { return false }
                        FileImport.importFiles(urls, window: window)
                        return true
                    }
                    .userActivity("com.folevi.note", isActive: window.current.isNote) { activity in
                        // Handoff and the system's "continue" on another Mac: the note.
                        guard let id = window.current.noteId else { return }
                        activity.title = window.title
                        activity.userInfo = ["id": id]
                        activity.webpageURL = NoteActions.webURL(id)
                        activity.isEligibleForHandoff = true
                    }
                if window.inspectorShown {
                    // The inspector: a flat rounded panel inside the card (no glass, no shadow), its width reserved
                    // in the layout so it never covers the screen.
                    Inspector(window: window)
                        .frame(width: WindowMetrics.inspectorWidth)
                        .frame(maxHeight: .infinity)
                        .background(Color(nsColor: .quaternaryLabelColor).opacity(0.6), in: RoundedRectangle(cornerRadius: WindowMetrics.inspectorRadius, style: .continuous))
                        .clipShape(RoundedRectangle(cornerRadius: WindowMetrics.inspectorRadius, style: .continuous))
                        .padding([.trailing, .bottom], 12)
                        .transition(.move(edge: .trailing).combined(with: .opacity))
                }
            }
        }
        .coreAnimation(Motion.panel, value: window.inspectorShown)
        .overlayPreferenceValue(ScreenBarKey.self, alignment: .top) { spec in
            ScreenTopBar(window: window, spec: spec)
        }
        .background(Color(nsColor: .controlBackgroundColor), in: shape)
        .clipShape(shape)
        .shadow(color: .black.opacity(0.02), radius: 5, y: 1)
        .padding([.top, .trailing, .bottom], WindowMetrics.containerMargin)
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
            Text("Folevi is locked").font(.title2.weight(.semibold))
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
    private var app: AppModel { .shared }

    var body: some View {
        // One glass container (so each toast materializes), with no merge distance: stacked toasts stay apart.
        GlassEffectContainer(spacing: 0) {
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
                .glassArrival(from: .bottom)
            }
        }
        }
        .padding(.bottom, 18)
        .coreAnimation(Motion.bar, value: app.toasts)
    }
}

/// Reaches the SwiftUI window's NSWindow: the window model learns it (titles, sheets), a seed that asked for a
/// tab joins the window that was in front, and visibility changes lend and return the note's page.
struct WindowAccessor: NSViewRepresentable {
    let model: WindowModel
    let asTab: Bool
    /// A note opened in a new tab from another: Back on its first page returns there (a fresh ⌘T tab doesn't).
    var keepsOpener = false
    var background = false

    func makeNSView(context: Context) -> NSView {
        let view = AccessorView()
        view.model = model
        view.asTab = asTab
        view.keepsOpener = keepsOpener
        view.background = background
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {}

    final class AccessorView: NSView {
        weak var model: WindowModel?
        private var tabBarWatch: NSKeyValueObservation?
        var asTab = false
        var keepsOpener = false
        var background = false
        private var observers: [NSObjectProtocol] = []

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            guard let window, let model else { return }
            model.window = window
            window.tabbingMode = .preferred
            window.tabbingIdentifier = "com.folevi.main"
            window.title = model.title
            if keepsOpener, model.opener == nil, let from = AppModel.shared.pendingOpener, from !== window {
                model.opener = from
                AppModel.shared.pendingOpener = nil
            }
            if asTab, window.tabbedWindows?.count ?? 1 <= 1, let front = NSApp.windows.first(where: { $0 !== window && $0.isVisible && $0.tabbingIdentifier == window.tabbingIdentifier && $0.isMainWindow }) ?? NSApp.windows.first(where: { $0 !== window && $0.isVisible && $0.tabbingIdentifier == window.tabbingIdentifier }) {
                front.addTabbedWindow(window, ordered: .above)
                if keepsOpener, model.opener == nil { model.opener = front }
                if background {
                    // Behind the tab in front: the tab group keeps showing the one you were in.
                    front.tabGroup?.selectedWindow = front
                    front.makeKeyAndOrderFront(nil)
                } else {
                    window.makeKeyAndOrderFront(nil)
                }
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
            watchTabBar()
        }

        /// The tab bar comes and goes with the second tab; its group changes when tabs merge or move.
        private func watchTabBar() {
            tabBarWatch = window?.tabGroup?.observe(\.isTabBarVisible, options: [.initial, .new]) { [weak self] group, _ in
                let visible = group.isTabBarVisible
                DispatchQueue.main.async { if self?.model?.tabBarVisible != visible { self?.model?.tabBarVisible = visible } }
            }
        }

        override func viewDidMoveToSuperview() {
            super.viewDidMoveToSuperview()
            watchTabBar()
        }

        deinit { observers.forEach(NotificationCenter.default.removeObserver) }
    }
}

// MARK: focused values for the menu bar

extension FocusedValues {
    @Entry var window: WindowModel?
}

/// Ask Foli AI: a floating button on every screen but a note and the Foli AI page, and the panel it opens (⌘J).
struct AskOverlay: View {
    let window: WindowModel

    var body: some View {
        if window.askShown {
            AskPanel(window: window).motionTransition(.scale(scale: 0.92, anchor: .bottomTrailing).combined(with: .opacity))
        } else if !window.current.isNote, !window.current.isFoliAI {
            Button { Motion.run(Motion.panel) { window.askShown = true } } label: { AiMarkGlyph(size: 22).padding(12) }
                .buttonStyle(.plain)
                .glassEffect(.regular.interactive(), in: .circle)
                .glassArrival()
                .help("Ask Foli AI (⌘J)")
                .accessibilityLabel("Ask Foli AI")
                .padding(20)
        }
    }
}
