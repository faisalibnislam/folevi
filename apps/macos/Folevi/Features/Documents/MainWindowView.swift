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
    @State private var router = SettingsRouter.shared

    var body: some View {
        // As the web's Shell: the sidebar sits on the canvas; beside it, 8pt in, the content panel (rounded
        // glass) with the tab strip at its top. A note brings its own page, so it sits straight on the canvas.
        HStack(spacing: 8) {
            if nav.sidebarVisible {
                SidebarView(nav: nav, editor: editorIfOpen, openDocument: { nav.open($0, newTab: true) })
                    .zIndex(2)
                    .transition(.move(edge: .leading).combined(with: .opacity))
            }
            VStack(spacing: 0) {
                MainToolbar(nav: nav, editor: editorIfOpen, crumbs: crumbs, openDocument: { nav.open($0) })
                    // In front of the page: the page's scroll view reaches up under the bar and took its clicks.
                    .zIndex(1)
                StatusBanners()
                detail
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .clipped()
                    // As on the web, views start 60pt below the panel's top (the 52pt tab bar plus 8): a note's
                    // rounded page sat flush against the bar and every view started 8pt high.
                    .padding(.top, 8)
                    .overlay(alignment: .bottom) {
                        if let editor = editorIfOpen {
                            // The page tools: the dock at the bottom of the note, its panel floating just above it.
                            GeometryReader { geo in
                                VStack(spacing: 12) {
                                    Spacer(minLength: 0)
                                    // The note's AI panel (the web's AiPanel in the dock's floating panel).
                                    if noteAiOpen && app.aiAvailable {
                                        NoteAiPanel(editor: editor, close: { noteAiOpen = false },
                                                    openAsk: { askChat.open(question: $0) }, openDocument: { nav.open($0) })
                                            .transition(.scale(scale: 0.96, anchor: .bottom).combined(with: .opacity))
                                    } else if nav.showInspector {
                                        FloatingInspector(availableHeight: geo.size.height) {
                                            InspectorView(model: editor, nav: nav, openDocument: open)
                                        }
                                        .transition(.offset(y: 8).combined(with: .opacity))
                                    }
                                    NoteDock(nav: nav, aiOpen: $noteAiOpen, aiAvailable: app.aiAvailable, editor: editor)
                                }
                                .frame(maxWidth: .infinity)
                                .padding(.bottom, 20)
                            }
                            .animation(.timingCurve(0.2, 0.7, 0.2, 1, duration: FoleviMotion.base), value: noteAiOpen)
                            .animation(.timingCurve(0.2, 0.7, 0.2, 1, duration: FoleviMotion.base), value: nav.showInspector)
                        }
                    }
                    // The inline AI composer and the title's AI, floating at the text they're about.
                    .overlay {
                        if let editor = editorIfOpen { EditorAiOverlay(editor: editor) }
                    }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background { if editorIfOpen == nil { ContentPanel() } }
            .padding(.top, 8)
            .padding(.bottom, 8)
            .padding(.trailing, 8)
            .padding(.leading, nav.sidebarVisible ? 0 : 8)
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
        .onChange(of: app.askAiRequest) { _, request in
            // The palette's "Ask AI", a folder's "Ask AI about this folder…": open the assistant with it.
            guard let request, NSApp.keyWindow?.isMainWindow == true || editor == nil, app.aiAvailable else { return }
            let folder = request.folderId.map { AskFolder(id: $0, name: request.folderName ?? "") }
            askChat.open(question: request.question, folder: folder)
            app.askAiRequest = nil
        }
        .sheet(isPresented: Binding(get: { app.showQuickAdd && (NSApp.keyWindow?.isMainWindow ?? true) }, set: { app.showQuickAdd = $0 })) {
            QuickAddTaskDialog(documentId: editorIfOpen?.documentId) { id in nav.open(id) }
                .environment(app)
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
        // ⌘, and Help (and every "Settings" or "Help" button) show those pages here, as on the web.
        .onChange(of: router.pending, initial: true) { _, route in
            guard let route, app.phase == .ready else { return }
            router.pending = nil
            switch route {
            case .settings: nav.selection = .settings
            case .help: nav.selection = .help
            case .invite(let token): nav.selection = .invite(token)
            case .shareInvite(let token): nav.selection = .shareInvite(token)
            }
            nav.closeDocument()
        }
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
            EditorView(model: editor, openDocument: open, showFind: $nav.showFind, nav: nav)
                .id(editor.documentId)
        } else {
            switch nav.selection {
            case .all: HomeDashboardView(nav: nav, openDocument: open)
            case .folders: FoldersIndexView(nav: nav)
            case .tags: TagsIndexView(nav: nav)
            case .tasks: TasksView(openDocument: open, openCalendar: { nav.selection = .calendar })
            case .calendar: CalendarView(openDocument: open, openTasks: { nav.selection = .tasks })
            case .shared: SharedWithMeView(openDocument: open)
            case .settings: SettingsRoot()
            case .help: HelpPage()
            case .invite(let token): InviteView(token: token, nav: nav)
            case .shareInvite(let token): ShareInviteView(token: token, nav: nav, openDocument: { nav.open($0) })
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
    @State private var windowAiOpen = false

    var body: some View {
        VStack(spacing: 0) {
            MainToolbar(nav: nav, editor: editor, crumbs: crumbs, showsHistory: false, hasSidebar: false)
                .zIndex(1)
            StatusBanners()
            Group {
                if app.phase != .ready {
                    EmptyStateView(systemImage: "lock", title: "Sign in to open this document", message: "Your documents appear here after you sign in.")
                } else if let editor {
                    EditorView(model: editor, openDocument: { id, _ in openWindow(id: "document", value: id) }, showFind: $nav.showFind, nav: nav)
                } else {
                    ProgressView().controlSize(.small).frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .clipped()
            .overlay(alignment: .bottom) {
                if let editor {
                    GeometryReader { geo in
                        VStack(spacing: 12) {
                            Spacer(minLength: 0)
                            if windowAiOpen && app.aiAvailable {
                                NoteAiPanel(editor: editor, close: { windowAiOpen = false }, openAsk: { _ in },
                                            openDocument: { openWindow(id: "document", value: $0) })
                                    .transition(.scale(scale: 0.96, anchor: .bottom).combined(with: .opacity))
                            } else if nav.showInspector {
                                FloatingInspector(availableHeight: geo.size.height) {
                                    InspectorView(model: editor, nav: nav, openDocument: { id, _ in openWindow(id: "document", value: id) })
                                }
                                .transition(.offset(y: 8).combined(with: .opacity))
                            }
                            NoteDock(nav: nav, aiOpen: $windowAiOpen, aiAvailable: app.aiAvailable, editor: editor)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.bottom, 20)
                    }
                    .animation(.timingCurve(0.2, 0.7, 0.2, 1, duration: FoleviMotion.base), value: nav.showInspector)
                    .animation(.timingCurve(0.2, 0.7, 0.2, 1, duration: FoleviMotion.base), value: windowAiOpen)
                }
            }
        }
        .ignoresSafeArea(.container, edges: .top)
        .background(CanvasBackground())
        .background(WindowChrome())
        .toolbar(removing: .title)
        .toolbarBackgroundVisibility(.hidden, for: .windowToolbar)
        .overlay { BlockDragOverlay(controller: editor?.drag) }
        // The inline AI composer and the title's AI, floating at the text they're about.
        .overlay { if let editor { EditorAiOverlay(editor: editor) } }
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

/// The maintenance banner (the web's Shell banner): the admin's message on the warning tint, centred, with
/// a note when Folevi is read-only. Connection state is never a banner: the sidebar's sync icon shows it.
struct StatusBanners: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        if let message = app.bannerMessage {
            Text(app.readOnlyMode ? message + String(localized: " Folevi is read-only right now; your edits are kept on this device.") : message)
                .font(.ui(14))
                .foregroundStyle(FoleviColor.ink)
                .multilineTextAlignment(.center)
                // No fixedSize here: the window's minimum size is measured at zero width.
                .lineLimit(3)
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .frame(maxWidth: .infinity)
                .background(FoleviColor.warningSoft)
                .overlay(alignment: .bottom) { FoleviColor.line.frame(height: 1) }
                .accessibilityAddTraits(.updatesFrequently)
        }
    }
}

/// The content panel beside the sidebar (the web's `.ui-content`): nearly opaque glass, radius 14, the glass
/// edge and shadow. Solid when Reduce Transparency is on.
struct ContentPanel: View {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 14, style: .continuous)
        Color.clear
            .foleviSurface(.color(reduceTransparency ? FoleviColor.surfaceRaised : FoleviGlass.content), shape: .rounded(14),
                           shadow: FoleviGlassDepth.edge + FoleviGlassDepth.shadow)
            .background { if !reduceTransparency { shape.fill(.ultraThinMaterial) } }
    }
}

/// Toasts at the bottom centre (the web's ToastProvider): up to four, newest last. Neutral ones are the
/// accent bar; success and error use soft tints. An action (Undo, Open) and a dismiss button on each.
struct ToastView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        VStack(spacing: 8) {
            ForEach(app.toasts) { toast in
                ToastRow(toast: toast) { app.dismissToast(toast.id) }
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 16)
        .animation(.timingCurve(0.2, 0.7, 0.2, 1, duration: FoleviMotion.base), value: app.toasts.map(\.id))
    }
}

private struct ToastRow: View {
    var toast: ToastItem
    var dismiss: () -> Void

    private var fill: Color {
        switch toast.tone {
        case .error: return FoleviColor.destructiveSoft
        case .success: return FoleviColor.successSoft
        case .neutral: return FoleviColor.accentStrong
        }
    }

    private var ink: Color { toast.tone == .neutral ? FoleviColor.accentInk : FoleviColor.ink }

    var body: some View {
        HStack(spacing: 12) {
            Text(toast.message).font(.ui(14, .medium)).fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let action = toast.action {
                Button {
                    action.run()
                    dismiss()
                } label: {
                    Text(action.title).font(.ui(14, .semibold))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 4)
                        .background(ink.opacity(0.14), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            Button(action: dismiss) {
                Image(systemName: "xmark").font(.system(size: 11, weight: .semibold)).opacity(0.7)
                    .frame(width: 18, height: 18)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("Dismiss"))
        }
        .foregroundStyle(ink)
        .padding(.leading, 20)
        .padding(.trailing, 10)
        .padding(.vertical, 8)
        .frame(maxWidth: 448)
        .fixedSize(horizontal: true, vertical: false)
        .foleviSurface(.color(fill), shape: .rounded(6), shadow: FoleviShadow.pop)
        .accessibilityElement(children: .contain)
        .onAppear { AccessibilityNotification.Announcement(toast.message).post() }
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
