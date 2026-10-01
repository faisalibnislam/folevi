import SwiftUI

/// The main window: sidebar / toolbar + content (browser, tasks, calendar or editor) / floating inspector,
/// all over the Warm Folio canvas.
struct MainWindowView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.openWindow) private var openWindow
    @State private var nav = NavigationModel()
    @State private var editor: EditorModel?
    /// Ask AI's chat (kept while closed, so the conversation survives closing and reopening).
    @State private var askChat = AskAiChat()
    /// The note's AI panel (dock → AI).
    @State private var noteAiOpen = false

    var body: some View {
        HStack(spacing: 0) {
            if nav.sidebarVisible {
                SidebarView(nav: nav, editor: editorIfOpen)
                    .transition(.move(edge: .leading).combined(with: .opacity))
            }
            VStack(spacing: 0) {
                MainToolbar(nav: nav, editor: editorIfOpen, crumbs: crumbs, primary: primaryAction)
                    // In front of the page: the page's scroll view reaches up under the bar and took its clicks.
                    .zIndex(1)
                StatusBanners()
                HStack(spacing: 0) {
                    detail
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .clipped()
                        .overlay(alignment: .bottom) {
                            if let editor = editorIfOpen {
                                VStack(spacing: 12) {
                                    // The note's AI panel (the web's AiPanel in the dock's floating panel).
                                    if noteAiOpen && app.aiAvailable {
                                        NoteAiPanel(editor: editor, close: { noteAiOpen = false },
                                                    openAsk: { askChat.open(question: $0) }, openDocument: { nav.open($0) })
                                            .transition(.scale(scale: 0.96, anchor: .bottom).combined(with: .opacity))
                                    }
                                    NoteDock(nav: nav, aiOpen: $noteAiOpen, aiAvailable: app.aiAvailable, editor: editor)
                                }
                                .padding(.top, 28)
                                .padding(.bottom, 18)
                                .animation(.timingCurve(0.2, 0.7, 0.2, 1, duration: FoleviMotion.base), value: noteAiOpen)
                            }
                        }
                        // The inline AI composer and the title's AI, floating at the text they're about.
                        .overlay {
                            if let editor = editorIfOpen { EditorAiOverlay(editor: editor) }
                        }
                    if nav.showInspector {
                        InspectorCard {
                            if let editor = editorIfOpen {
                                InspectorView(model: editor, nav: nav, openDocument: open)
                            } else {
                                EmptyStateView(systemImage: "sidebar.right", title: "No document", message: "Open a document to see its details.")
                            }
                        }
                        .padding(.trailing, 12)
                        .padding(.bottom, 12)
                        .padding(.top, 4)
                        .transition(.move(edge: .trailing).combined(with: .opacity))
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .ignoresSafeArea(.container, edges: .top)
        .background(AmbientBackground(cover: editorIfOpen?.document?.cover))
        .background(WindowChrome())
        .toolbar(removing: .title)
        .toolbarBackgroundVisibility(.hidden, for: .windowToolbar)
        .overlay { BlockDragOverlay(controller: editorIfOpen?.drag) }
        .overlay(alignment: .bottomTrailing) {
            // The AI Assistant: a chat from a floating launcher in the bottom-right corner. Notes have their own
            // AI in the dock, so the launcher stays out of the way there (⌘J and the note's AI still open the chat).
            if app.aiAvailable, app.phase == .ready {
                VStack(alignment: .trailing, spacing: 20) {
                    if askChat.isOpen {
                        AskAiPanel(chat: askChat, openDocument: { id in askChat.isOpen = false; nav.open(id) }, close: { askChat.isOpen = false })
                            .transition(.scale(scale: 0.96, anchor: .bottomTrailing).combined(with: .opacity))
                    }
                    if editorIfOpen == nil {
                        AiLauncher(isOpen: Binding(get: { askChat.isOpen }, set: { $0 ? askChat.open() : (askChat.isOpen = false) }))
                    }
                }
                .padding(.top, 32)
                .padding(.trailing, 36)
                .padding(.bottom, 36)
                .animation(.timingCurve(0.2, 0.7, 0.2, 1, duration: FoleviMotion.base), value: askChat.isOpen)
            }
        }
        .navigationTitle(windowTitle)
        .focusedSceneValue(\.navigation, nav)
        .focusedSceneValue(\.editor, editor)
        .onReceive(NotificationCenter.default.publisher(for: .foleviToggleAskAi)) { _ in
            // ⌘J opens Ask AI (in a note's text, ⌘J writes there instead).
            guard NSApp.keyWindow?.isMainWindow == true || editor == nil, app.aiAvailable else { return }
            askChat.open()
        }
        .onReceive(NotificationCenter.default.publisher(for: .foleviOpenAskAi)) { note in
            guard NSApp.keyWindow?.isMainWindow == true || editor == nil, app.aiAvailable else { return }
            let info = note.userInfo ?? [:]
            let folder = (info["folderId"] as? String).map { AskFolder(id: $0, name: info["folderName"] as? String ?? "") }
            askChat.open(question: info["question"] as? String, folder: folder)
        }
        .onChange(of: nav.openDocumentId) { _, id in
            noteAiOpen = false
            switchEditor(to: id)
        }
        .onChange(of: app.pendingOpenDocumentId, initial: true) { _, id in
            guard let id else { return }
            app.pendingOpenDocumentId = nil
            nav.open(id)
        }
        .onChange(of: app.documentsRevision, initial: true) { _, _ in openFromLaunchArgument() }
        .sheet(isPresented: $nav.showHistory) {
            if let id = nav.openDocumentId { VersionHistorySheet(documentId: id).environment(app) }
        }
        .onChange(of: app.scope, initial: true) { old, new in nav.enterScope(new.key, goHome: old != new) }
        .onReceive(NotificationCenter.default.publisher(for: .foleviOpenDocument)) { note in
            guard let id = note.userInfo?["documentId"] as? String, NSApp.keyWindow?.isMainWindow == true || editor == nil else { return }
            nav.open(id)
        }
        .overlay { CommandPaletteHost(nav: nav, openDocument: open) }
        .overlay(alignment: .bottom) { ToastView() }
    }

    private var editorIfOpen: EditorModel? {
        guard let editor, nav.openDocumentId == editor.documentId else { return nil }
        return editor
    }

    private var primaryAction: (title: LocalizedStringKey, systemImage: String, action: () -> Void)? {
        // On a note, as on the web: always "New note".
        let selection: SidebarItem = editorIfOpen == nil ? nav.selection : .notes
        switch selection {
        case .tasks:
            return ("Add Task", "plus", { NotificationCenter.default.post(name: .foleviFocusQuickTask, object: nil) })
        case .calendar, .shared, .trash, .archive, .starred, .tag:
            return nil
        default:
            return ("New note", "plus", {
                Task {
                    if let id = await app.createDocument(folderId: nav.currentFolderId) { nav.open(id) }
                }
            })
        }
    }

    private var crumbs: [Crumb] {
        if let editor = editorIfOpen {
            let c = Crumbs.forDocument(editor.documentId, app: app, nav: nav) { id in nav.open(id) }
            if !c.isEmpty { return c }
            return [Crumb(id: editor.documentId, title: editor.document?.displayTitle ?? String(localized: "Untitled"), icon: .symbol("doc.text"))]
        }
        let item = nav.selection
        switch item {
        case .folder(let id):
            let folder = app.sidebar.folders.first { $0.id == id }
            return [Crumb(id: "folder", title: folder?.name ?? String(localized: "Folder"),
                          icon: .symbol("folder"))]
        case .tag(let id):
            return [Crumb(id: "tag", title: app.sidebar.tags.first { $0.id == id }.map { "#" + $0.name } ?? String(localized: "Tag"), icon: .symbol("tag"))]
        default:
            return [Crumb(id: "view", title: item.titleString, icon: .symbol(item.systemImage))]
        }
    }

    private var windowTitle: String {
        if let editor { return editor.document?.displayTitle ?? String(localized: "Untitled") }
        return app.scopeName
    }

    @ViewBuilder private var detail: some View {
        if let editor, nav.openDocumentId == editor.documentId {
            EditorView(model: editor, openDocument: open, showFind: $nav.showFind)
                .id(editor.documentId)
        } else {
            switch nav.selection {
            case .all: HomeDashboardView(nav: nav, openDocument: open)
            case .folders: FoldersIndexView(nav: nav)
            case .tags: TagsIndexView(nav: nav)
            case .tasks: TasksView(openDocument: open, openCalendar: { nav.selection = .calendar })
            case .calendar: CalendarView(openDocument: open, openTasks: { nav.selection = .tasks })
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
        if let tab = LaunchOptions.value(after: "-FoleviInspector"), let t = InspectorTab(rawValue: tab) {
            nav.inspectorTab = t
            nav.showInspector = true
        }
        if let item = LaunchOptions.value(after: "-FoleviSidebar") {
            switch item {
            case "tasks": nav.selection = .tasks
            case "calendar": nav.selection = .calendar
            case "trash": nav.selection = .trash
            case "folders": nav.selection = .folders
            case "notes": nav.selection = .notes
            case "drafts": nav.selection = .drafts
            case "templates": nav.selection = .templates
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
}

/// A single document in its own window (⌥-click, File ▸ Open in New Window).
struct DocumentWindowView: View {
    let documentId: String
    @Environment(AppModel.self) private var app
    @Environment(\.openWindow) private var openWindow
    @State private var nav = NavigationModel(persistsTabs: false)
    @State private var editor: EditorModel?

    var body: some View {
        VStack(spacing: 0) {
            MainToolbar(nav: nav, editor: editor, crumbs: crumbs, showsHistory: false, hasSidebar: false)
                .zIndex(1)
            StatusBanners()
            HStack(spacing: 0) {
                Group {
                    if app.phase != .ready {
                        EmptyStateView(systemImage: "lock", title: "Sign in to open this document", message: "Your documents appear here after you sign in.")
                    } else if let editor {
                        EditorView(model: editor, openDocument: { id, _ in openWindow(id: "document", value: id) }, showFind: $nav.showFind)
                    } else {
                        ProgressView().controlSize(.small).frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .clipped()
                // The inline AI composer and the title's AI, floating at the text they're about.
                .overlay {
                    if let editor { EditorAiOverlay(editor: editor) }
                }
                if nav.showInspector, let editor {
                    InspectorCard {
                        InspectorView(model: editor, nav: nav, openDocument: { id, _ in openWindow(id: "document", value: id) })
                    }
                    .padding([.trailing, .bottom], 12)
                    .padding(.top, 4)
                    .transition(.move(edge: .trailing).combined(with: .opacity))
                }
            }
        }
        .ignoresSafeArea(.container, edges: .top)
        .background(CanvasBackground())
        .background(WindowChrome())
        .toolbar(removing: .title)
        .toolbarBackgroundVisibility(.hidden, for: .windowToolbar)
        .overlay { BlockDragOverlay(controller: editor?.drag) }
        .onAppear { nav.columnVisibility = .all }
        .navigationTitle(editor?.document?.displayTitle ?? String(localized: "Untitled"))
        .focusedSceneValue(\.editor, editor)
        .focusedSceneValue(\.navigation, nav)
        .opensCommentsPanel(editor: editor, nav: nav)
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

    private var crumbs: [Crumb] {
        Crumbs.forDocument(documentId, app: app, nav: nil) { id in openWindow(id: "document", value: id) }
            .map { c in
                var c = c
                if c.id == "root" || c.id.hasPrefix("folder.") { c.action = nil }
                return c
            }
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
            Text(text).font(.ui(12)).lineLimit(2).truncationMode(.tail)
            Spacer()
            if app.sync.pendingCount > 0 && !app.sync.isOnline {
                Text("\(app.sync.pendingCount) waiting").font(.ui(11.5).monospacedDigit())
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
            HStack(spacing: 10) {
                Text(toast).font(.ui(12, .medium))
                if let action = app.toastAction {
                    Button(action.title) {
                        app.toast = nil
                        app.toastAction = nil
                        action.run()
                    }
                    .buttonStyle(.plain)
                    .font(.ui(12, .semibold))
                    .foregroundStyle(FoleviColor.heading)
                    .underline()
                }
            }
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

/// Pages people shared with you directly, from their Personal or any workspace (the web's SharedView).
struct SharedWithMeView: View {
    var openDocument: (String, Bool) -> Void
    @Environment(AppModel.self) private var app
    @State private var docs: [SharedDocument]?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                ViewBar(subtitle: docs.map { "\($0.count) \($0.count == 1 ? "page" : "pages") · from anyone" }) { EmptyView() }
                VStack(alignment: .leading, spacing: 0) {
                    if let docs, docs.isEmpty {
                        VStack(spacing: 8) {
                            Text("Nothing has been shared with you yet.")
                                .font(FoleviType.display(24))
                                .tracking(FoleviType.displayTracking(24))
                                .foregroundStyle(FoleviColor.inkMuted)
                            Text("Pages people share with you directly, from their Personal or from any workspace, show up here.")
                                .font(.ui(14)).foregroundStyle(FoleviColor.inkMuted)
                        }
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 64)
                    } else if let docs {
                        VStack(spacing: 0) {
                            ForEach(Array(docs.enumerated()), id: \.element.id) { idx, d in
                                SharedRow(doc: d) { openDocument(d.id, NSEvent.modifierFlags.contains(.option)) }
                                if idx < docs.count - 1 { FoleviColor.line.frame(height: 1) }
                            }
                        }
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .foleviCard(radius: 8)
                        .padding(.top, 24)
                    } else {
                        PulsePlaceholder(radius: 6, fill: FoleviColor.surface).frame(height: 96).padding(.top, 24)
                    }
                }
                .frame(maxWidth: 768, alignment: .leading)
                .padding(.horizontal, 32)
                .padding(.top, 24)
                .padding(.bottom, 96)
                .frame(maxWidth: .infinity)
            }
        }
        .scrollContentBackground(.hidden)
        .task(id: app.sync.isOnline) {
            guard let session = app.session, app.sync.isOnline else { return }
            if let fresh = try? await session.documents.sharedWithMe() { docs = fresh }
        }
    }
}

private struct SharedRow: View {
    let doc: SharedDocument
    var open: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: open) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "doc.text").font(.system(size: 14)).foregroundStyle(FoleviColor.inkMuted).frame(width: 16).padding(.top, 4)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 0) {
                    Text(doc.title.isEmpty ? String(localized: "Untitled") : doc.title).font(.ui(16, .medium)).foregroundStyle(FoleviColor.ink)
                    if !doc.excerpt.isEmpty {
                        Text(doc.excerpt).font(.ui(14)).foregroundStyle(FoleviColor.inkMuted).lineLimit(1)
                    }
                    Text(meta).font(.ui(12)).foregroundStyle(FoleviColor.inkFaint)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(hovering ? FoleviColor.surface : .clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
    }

    private var meta: String {
        let place = doc.workspaceName ?? "Personal · \(doc.ownerName ?? "someone")"
        let role = doc.role == "editor" ? "Can edit" : doc.role == "commenter" ? "Can comment" : "Can view"
        return "Shared by \(doc.sharedBy) · \(place) · \(role) · updated \(CollabTime.relative(doc.updatedAt))"
    }
}
