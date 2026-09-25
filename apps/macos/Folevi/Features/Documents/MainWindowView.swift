import SwiftUI

/// The main window: sidebar / content (browser, tasks, calendar or editor) / inspector.
struct MainWindowView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.openWindow) private var openWindow
    @State private var nav = NavigationModel()
    @State private var editor: EditorModel?

    var body: some View {
        NavigationSplitView(columnVisibility: $nav.columnVisibility) {
            SidebarView(nav: nav)
        } detail: {
            detail
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .safeAreaInset(edge: .top, spacing: 0) { StatusBanners() }
                .navigationTitle(windowTitle)
        }
        .inspector(isPresented: $nav.showInspector) {
            Group {
                if let editor {
                    InspectorView(model: editor, nav: nav, openDocument: open)
                } else {
                    EmptyStateView(systemImage: "sidebar.right", title: "No document", message: "Open a document to see its details.")
                }
            }
            .inspectorColumnWidth(min: FoleviLayout.inspectorMin, ideal: FoleviLayout.inspectorDefault, max: FoleviLayout.inspectorMax)
        }
        .toolbar { toolbar }
        .focusedSceneValue(\.navigation, nav)
        .focusedSceneValue(\.editor, editor)
        .onChange(of: nav.openDocumentId) { _, id in switchEditor(to: id) }
        .onChange(of: app.pendingOpenDocumentId, initial: true) { _, id in
            guard let id else { return }
            app.pendingOpenDocumentId = nil
            nav.open(id)
        }
        .onChange(of: app.documentsRevision, initial: true) { _, _ in openFromLaunchArgument() }
        .sheet(isPresented: $nav.showHistory) {
            if let id = nav.openDocumentId { VersionHistorySheet(documentId: id).environment(app) }
        }
        .onReceive(NotificationCenter.default.publisher(for: .foleviOpenDocument)) { note in
            guard let id = note.userInfo?["documentId"] as? String, NSApp.keyWindow?.isMainWindow == true || editor == nil else { return }
            nav.open(id)
        }
        .overlay { CommandPaletteHost(nav: nav, openDocument: open) }
        .overlay(alignment: .bottom) { ToastView() }
    }

    private var windowTitle: String {
        if let editor { return editor.document?.displayTitle ?? String(localized: "Untitled") }
        return app.workspace?.name ?? "Folevi"
    }

    @ViewBuilder private var detail: some View {
        if let editor, nav.openDocumentId == editor.documentId {
            EditorView(model: editor, openDocument: open, showFind: $nav.showFind)
                .id(editor.documentId)
        } else {
            switch nav.selection {
            case .tasks: TasksView(openDocument: open)
            case .calendar: CalendarView(openDocument: open)
            case .shared: SharedWithMeView(openDocument: open)
            default: BrowserView(nav: nav, openDocument: open)
            }
        }
    }

    @State private var launchArgumentHandled = false

    /// DEBUG automation: `-FoleviOpenDocument <id or exact title>` and `-FoleviSidebar <item>`.
    private func openFromLaunchArgument() {
        #if DEBUG
        guard !launchArgumentHandled else { return }
        if let item = LaunchOptions.value(after: "-FoleviSidebar") {
            switch item {
            case "tasks": nav.selection = .tasks
            case "calendar": nav.selection = .calendar
            case "daily": nav.selection = .daily
            case "trash": nav.selection = .trash
            default: break
            }
        }
        guard let target = LaunchOptions.value(after: "-FoleviOpenDocument") else {
            launchArgumentHandled = true
            return
        }
        if let doc = app.documents.first(where: { $0.id == target || $0.title == target }) {
            launchArgumentHandled = true
            nav.open(doc.id)
        }
        #endif
    }

    private func open(_ id: String, _ newWindow: Bool) {
        if newWindow {
            openWindow(id: "document", value: id)
        } else {
            nav.open(id)
        }
    }

    private func switchEditor(to id: String?) {
        editor?.close()
        guard let id else {
            editor = nil
            return
        }
        let model = EditorModel(documentId: id, app: app)
        editor = model
        Task {
            await model.load()
            #if DEBUG
            if launchArgumentHandled, Automation.scenario != nil, LaunchOptions.value(after: "-FoleviOpenDocument") != nil {
                await Automation.run(editor: model, app: app)
            }
            #endif
        }
    }

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        ToolbarItemGroup(placement: .navigation) {
            Button { nav.goBack() } label: { Label("Back", systemImage: "chevron.left") }
                .disabled(!nav.canGoBack)
                .help(Text("Back"))
                .accessibilityIdentifier("toolbar.back")
            Button { nav.goForward() } label: { Label("Forward", systemImage: "chevron.right") }
                .disabled(!nav.canGoForward)
                .help(Text("Forward"))
        }
        ToolbarItemGroup(placement: .primaryAction) {
            Button {
                app.showCommandPalette = true
            } label: {
                Label("Search", systemImage: "magnifyingglass")
            }
            .help(Text("Search or jump to… (⌘K)"))
            .accessibilityIdentifier("toolbar.search")
            Button {
                Task {
                    var folderId: String?
                    if case .folder(let fid) = nav.selection { folderId = fid }
                    if let id = await app.createDocument(folderId: folderId) { nav.open(id) }
                }
            } label: { Label("New Document", systemImage: "square.and.pencil") }
                .help(Text("New Document (⌘N)"))
                .accessibilityIdentifier("toolbar.newDocument")
            if let editor {
                ShareLink(item: MarkdownShareItem(title: editor.document?.displayTitle ?? "Untitled",
                                                  markdown: MarkdownCodec.blocksToMarkdown(editor.exportBlocks(), .init(title: editor.document?.displayTitle))),
                          preview: SharePreview(editor.document?.displayTitle ?? "Untitled")) {
                    Label("Share", systemImage: "square.and.arrow.up")
                }
                .help(Text("Share as Markdown"))
            }
            SyncStatusPill(snapshot: app.sync)
            Button { nav.showInspector.toggle() } label: { Label("Inspector", systemImage: "sidebar.right") }
                .help(Text("Toggle Inspector (⌥⌘I)"))
                .accessibilityIdentifier("toolbar.inspector")
        }
    }
}

/// A single document in its own window (⌥-click, File ▸ Open in New Window).
struct DocumentWindowView: View {
    let documentId: String
    @Environment(AppModel.self) private var app
    @Environment(\.openWindow) private var openWindow
    @State private var nav = NavigationModel()
    @State private var editor: EditorModel?

    var body: some View {
        Group {
            if app.phase != .ready {
                EmptyStateView(systemImage: "lock", title: "Sign in to open this document", message: "Your documents appear here after you sign in.")
            } else if let editor {
                EditorView(model: editor, openDocument: { id, _ in openWindow(id: "document", value: id) }, showFind: $nav.showFind)
                    .inspector(isPresented: $nav.showInspector) {
                        InspectorView(model: editor, nav: nav, openDocument: { id, _ in openWindow(id: "document", value: id) })
                            .inspectorColumnWidth(min: FoleviLayout.inspectorMin, ideal: FoleviLayout.inspectorDefault, max: FoleviLayout.inspectorMax)
                    }
            } else {
                ProgressView()
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) { StatusBanners() }
        .navigationTitle(editor?.document?.displayTitle ?? String(localized: "Untitled"))
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                SyncStatusPill(snapshot: app.sync)
                Button { nav.showInspector.toggle() } label: { Label("Inspector", systemImage: "sidebar.right") }
            }
        }
        .focusedSceneValue(\.editor, editor)
        .focusedSceneValue(\.navigation, nav)
        .sheet(isPresented: $nav.showHistory) { VersionHistorySheet(documentId: documentId).environment(app) }
        .overlay(alignment: .bottom) { ToastView() }
        .task(id: app.phase == .ready) {
            guard app.phase == .ready, editor == nil else { return }
            let model = EditorModel(documentId: documentId, app: app)
            editor = model
            nav.openDocumentId = documentId
            await model.load()
        }
        .onDisappear { editor?.close() }
    }
}

/// Offline / maintenance banners.
struct StatusBanners: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        VStack(spacing: 0) {
            if !app.sync.isOnline {
                banner(icon: "icloud.slash", text: app.sync.forcedOffline
                       ? String(localized: "Offline mode is on. Changes are saved on this Mac and will sync when you turn it off.")
                       : String(localized: "You're offline. Changes are saved on this Mac and will sync when you reconnect."),
                       tint: FoleviColor.warning, bg: FoleviColor.warningSoft)
                    .accessibilityIdentifier("offlineBanner")
            }
            if let message = app.bannerMessage {
                banner(icon: "wrench.and.screwdriver", text: message, tint: FoleviColor.accentSoftInk, bg: FoleviColor.accentSoft)
            }
            if app.readOnlyMode {
                banner(icon: "lock", text: String(localized: "Folevi is in read-only maintenance mode. Editing will be back shortly."),
                       tint: FoleviColor.accentSoftInk, bg: FoleviColor.accentSoft)
            }
        }
    }

    private func banner(icon: String, text: String, tint: Color, bg: Color) -> some View {
        HStack(spacing: 8) {
            Image(systemName: icon).accessibilityHidden(true)
            // No fixedSize here: the window's minimum size is measured at zero width.
            Text(text).font(.system(size: 12)).lineLimit(2).truncationMode(.tail)
            Spacer()
            if app.sync.pendingCount > 0 && !app.sync.isOnline {
                Text("\(app.sync.pendingCount) waiting").font(.caption.monospacedDigit())
            }
        }
        .foregroundStyle(tint)
        .padding(.horizontal, 16)
        .padding(.vertical, 7)
        .frame(maxWidth: .infinity)
        .background(bg)
        .accessibilityElement(children: .combine)
    }
}

struct ToastView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        if let toast = app.toast {
            Text(toast)
                .font(.system(size: 12, weight: .medium))
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .foleviChrome()
                .padding(.bottom, 20)
                .transition(.opacity)
                .accessibilityAddTraits(.updatesFrequently)
                .onAppear { AccessibilityNotification.Announcement(toast).post() }
        }
    }
}

struct SharedWithMeView: View {
    var openDocument: (String, Bool) -> Void
    @Environment(AppModel.self) private var app
    @State private var docs: [SharedDocument]?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Shared with Me").font(FoleviType.display(28)).padding(.horizontal, 24).padding(.top, 20).padding(.bottom, 8)
                .accessibilityAddTraits(.isHeader)
            if let docs, !docs.isEmpty {
                List(docs) { d in
                    Button {
                        openDocument(d.id, NSEvent.modifierFlags.contains(.option))
                    } label: {
                        HStack {
                            Text(d.icon ?? "📄")
                            VStack(alignment: .leading) {
                                Text(d.title.isEmpty ? String(localized: "Untitled") : d.title).font(.system(size: 13, weight: .medium))
                                Text("\(d.sharedBy) · \(d.workspaceName)").font(.caption).foregroundStyle(FoleviColor.inkMuted)
                            }
                            Spacer()
                            Chip(text: d.role.capitalized)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
                .scrollContentBackground(.hidden)
            } else if docs == nil && app.sync.isOnline {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                EmptyStateView(systemImage: "person.2", title: "Nothing shared yet",
                               message: app.sync.isOnline ? "Documents others share with you appear here." : "Shared documents appear here when you're online.")
            }
        }
        .background(FoleviColor.canvas)
        .task {
            guard let session = app.session, app.sync.isOnline else {
                docs = []
                return
            }
            docs = (try? await session.documents.sharedWithMe()) ?? []
        }
    }
}
