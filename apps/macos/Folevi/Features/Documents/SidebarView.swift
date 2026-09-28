import SwiftUI

/// Drag payload for documents (browser cards → sidebar folders).
struct DocumentDragPayload: Codable, Transferable {
    var documentId: String
    static var transferRepresentation: some TransferRepresentation {
        CodableRepresentation(contentType: .foleviDocument)
    }
}

/// The sidebar, as on the web: the Folevi logo, a search well with ⌘K, Home / Starred / Drafts /
/// All notes / Tasks / Shared with Me / Templates, Folders and Tags (collapsible, remembered; Tags starts
/// collapsed), Archive and Trash, and the account row with Help and Settings.
struct SidebarView: View {
    @Bindable var nav: NavigationModel
    /// The open note: the sidebar then shows its tools (NoteSidebarContent) instead of navigation, as on the web.
    var editor: EditorModel? = nil
    @Environment(AppModel.self) private var app
    @Environment(\.openSettings) private var openSettings
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @State private var newFolderName = ""
    @State private var showNewFolder = false
    @State private var dropTargetFolder: String?
    // Remembered on this Mac; Tags starts collapsed, as on the web.
    @AppStorage("sidebar.section.folders") private var foldersOpen = true
    @AppStorage("sidebar.section.tags") private var tagsOpen = false
    @State private var todayTasks = 0
    @FocusState private var listFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // The 52pt title bar band: traffic lights on the left, hide-sidebar on the right.
            HStack {
                Spacer()
                IconButton(systemImage: "sidebar.left", label: "Hide Sidebar", shortcutHint: "⌃⌘S", size: 28) { withSidebarAnimation { nav.toggleSidebar() } }
            }
            .frame(height: FoleviLayout.toolbarHeight)
            .padding(.horizontal, 10)
            .titlebarDragArea()

            workspaceHeader
                .padding(.horizontal, 10)
                .padding(.bottom, 10)

            if let editor {
                NoteSidebarContent(model: editor, nav: nav)
                    .frame(maxHeight: .infinity, alignment: .top)
            } else {
                searchPill
                    .padding(.horizontal, 10)

                ScrollView {
                    VStack(alignment: .leading, spacing: 2) {
                        row(.all)
                        row(.starred)
                        row(.drafts, count: draftCount)
                        row(.notes)
                        row(.tasks, count: todayTaskCount)
                        row(.shared)
                        row(.templates)

                        section("Folders", isOpen: $foldersOpen, action: folderAction) {
                            let roots = app.sidebar.folders.filter { $0.parentFolderId == nil }
                            if roots.isEmpty {
                                Text("No folders yet").font(.ui(12)).foregroundStyle(FoleviColor.inkFaint).padding(.horizontal, 10).padding(.vertical, 4)
                            }
                            ForEach(roots) { folder in
                                folderRow(folder)
                                ForEach(app.sidebar.folders.filter { $0.parentFolderId == folder.id }) { child in
                                    folderRow(child).padding(.leading, 18)
                                }
                            }
                        }

                        if !app.sidebar.tags.isEmpty {
                            section("Tags", isOpen: $tagsOpen) {
                                ForEach(app.sidebar.tags) { tag in
                                    SidebarRow(title: Text(tag.name), isActive: nav.selection == .tag(tag.id)) {
                                        Image(systemName: "number").foregroundStyle(Color.folevi(tag: tag.color))
                                    } action: {
                                        nav.selection = .tag(tag.id)
                                    }
                                    .accessibilityIdentifier(SidebarItem.tag(tag.id).accessibilityId)
                                }
                            }
                        }

                        Spacer().frame(height: 14)
                        row(.archive)
                        row(.trash)
                    }
                    .padding(.horizontal, 10)
                    .padding(.top, 12)
                    .padding(.bottom, 16)
                }
                .scrollIndicators(.never)
                .focusable()
                .focused($listFocused)
                .focusEffectDisabled()
                .onKeyPress(.upArrow) { step(-1) }
                .onKeyPress(.downArrow) { step(1) }
            }

            planPill
                .padding(.horizontal, 10)
                .padding(.bottom, 6)
            footer
                .padding(.horizontal, 10)
                .padding(.bottom, 10)
        }
        .frame(width: FoleviLayout.sidebarDefault)
        .background {
            // Glass, as on the web: a note's artwork (AmbientBackground) shows through faintly.
            Group {
                if reduceTransparency {
                    FoleviColor.sidebar
                } else {
                    FoleviGlass.sidebar.background(.ultraThinMaterial)
                }
            }
            .overlay(alignment: .trailing) { FoleviGlass.border.frame(width: 1) }
            .ignoresSafeArea()
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Sidebar"))
        .task(id: app.documentsRevision) { await refreshTaskCount() }
        .onChange(of: app.blockRevision) { _, _ in Task { await refreshTaskCount() } }
        .alert("New Folder", isPresented: $showNewFolder) {
            TextField("Name", text: $newFolderName)
            Button("Create") { createFolder() }
            Button("Cancel", role: .cancel) { newFolderName = "" }
        }
    }

    // MARK: Header

    /// The Folevi logo (goes Home), as at the top of the web's sidebar.
    private var workspaceHeader: some View {
        Button {
            nav.selection = .all
            nav.closeDocument()
        } label: {
            HStack {
                FoleviLogo(height: 26).foregroundStyle(FoleviColor.heading)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 4)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(Text("Go to Home"))
        .accessibilityLabel(Text("Folevi, go to Home"))
    }

    private var searchPill: some View {
        Button {
            app.showCommandPalette = true
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").font(.system(size: 12.5, weight: .medium)).accessibilityHidden(true)
                Text("Search or jump to…").font(.ui(13))
                Spacer(minLength: 4)
                Keycap(text: "⌘K")
            }
            .foregroundStyle(FoleviColor.inkMuted)
            .padding(.leading, 12)
            .padding(.trailing, 7)
            .frame(height: 34)
            .foleviWell()
            .contentShape(Capsule())
        }
        .buttonStyle(HoverTint())
        .help(Text("Search or jump to… (⌘K)"))
        .accessibilityLabel(Text("Search"))
        .accessibilityIdentifier("toolbar.search")
    }

    // MARK: Footer

    /// Trial days left, or an upgrade nudge on Free; nothing once they're paying (the web's sidebar pill).
    @ViewBuilder private var planPill: some View {
        if let e = app.profile?.entitlements, e.trialing || e.paidPlan == "free" {
            Button {
                openWebApp("settings/billing", config: app.config)
            } label: {
                HStack(spacing: 8) {
                    AiIcon(size: 13).foregroundStyle(FoleviColor.heading)
                    Text(e.trialing ? String(localized: "Pro trial · \(e.trialDaysLeft) days left") : String(localized: "Upgrade to Pro"))
                        .font(.ui(12.5, .medium))
                        .foregroundStyle(FoleviColor.heading)
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    Text(e.trialing ? "Choose plan" : "See plans").font(.ui(11.5)).foregroundStyle(FoleviColor.inkMuted)
                }
                .padding(.horizontal, 10)
                .frame(height: 34)
                .background(FoleviGlass.hover, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help(Text("Plans open in your browser"))
        }
    }

    private var footer: some View {
        HStack(spacing: 4) {
            Button {
                openSettings()
            } label: {
                HStack(spacing: 8) {
                    Text(String((app.profile?.displayName ?? "F").prefix(1)).uppercased())
                        .font(.ui(12, .semibold))
                        .foregroundStyle(FoleviColor.heading)
                        .frame(width: 28, height: 28)
                        .background(Circle().fill(FoleviGlass.hover))
                        .overlay(Circle().strokeBorder(FoleviGlass.border, lineWidth: 1))
                        .accessibilityHidden(true)
                    Text(app.profile?.displayName ?? "")
                        .font(.ui(13, .medium))
                        .foregroundStyle(FoleviColor.ink)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                }
                .padding(.leading, 4)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("Account settings"))
            IconButton(systemImage: "questionmark.circle", label: "Help", shortcutHint: "⌘?", size: 30) { app.showHelp = true }
                .accessibilityIdentifier("sidebar.help")
            IconButton(systemImage: "gearshape", label: "Settings", shortcutHint: "⌘,", size: 30) { openSettings() }
                .accessibilityIdentifier("sidebar.settings")
        }
        .padding(6)
    }

    // MARK: Rows

    private func row(_ item: SidebarItem, count: Int? = nil) -> some View {
        SidebarRow(title: Text(item.title), count: count, isActive: nav.selection == item && nav.openDocumentId == nil) {
            Image(systemName: item.systemImage)
        } action: {
            if nav.selection == item { nav.closeDocument() } else { nav.selection = item }
        }
        .accessibilityIdentifier(item.accessibilityId)
    }

    private func folderRow(_ folder: FolderInfo) -> some View {
        SidebarRow(title: Text(folder.name), isActive: nav.selection == .folder(folder.id) && nav.openDocumentId == nil,
                   isDropTarget: dropTargetFolder == folder.id) {
            FolderGlyph(color: folder.color, size: 17)
        } action: {
            nav.selection = .folder(folder.id)
        }
        .dropDestination(for: DocumentDragPayload.self) { items, _ in
            for item in items {
                Task { await app.updateDocument(item.documentId, patch: WireDocumentPatch(folderId: .some(folder.id))) }
            }
            app.showToast(String(localized: "Moved to \(folder.name)"))
            return !items.isEmpty
        } isTargeted: { targeted in
            dropTargetFolder = targeted ? folder.id : (dropTargetFolder == folder.id ? nil : dropTargetFolder)
        }
        .accessibilityIdentifier(SidebarItem.folder(folder.id).accessibilityId)
    }

    private var folderAction: (icon: String, label: LocalizedStringKey, run: () -> Void, enabled: Bool) {
        ("plus", app.sync.isOnline ? "New Folder" : "Creating folders needs a connection", { showNewFolder = true }, app.sync.isOnline)
    }

    private func section<Content: View>(_ title: LocalizedStringKey, isOpen: Binding<Bool>? = nil,
                                        action: (icon: String, label: LocalizedStringKey, run: () -> Void, enabled: Bool)? = nil,
                                        @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
                if let isOpen {
                    Button {
                        withAnimation(.easeOut(duration: FoleviMotion.fast)) { isOpen.wrappedValue.toggle() }
                    } label: {
                        HStack(spacing: 4) {
                            Text(title).foleviCapsLabel()
                            Image(systemName: "chevron.down")
                                .font(.system(size: 8, weight: .bold))
                                .foregroundStyle(FoleviColor.inkFaint)
                                .rotationEffect(.degrees(isOpen.wrappedValue ? 0 : -90))
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text(title))
                    .accessibilityValue(Text(isOpen.wrappedValue ? "Expanded" : "Collapsed"))
                } else {
                    Text(title).foleviCapsLabel()
                }
                Spacer()
                if let action {
                    IconButton(systemImage: action.icon, label: action.label, size: 22, action: action.run)
                        .disabled(!action.enabled)
                }
            }
            .frame(height: 26)
            .padding(.horizontal, 10)
            .accessibilityAddTraits(.isHeader)
            if isOpen?.wrappedValue ?? true {
                content()
            }
        }
        .padding(.top, 16)
    }

    /// ↑/↓ move through the fixed items when the list has keyboard focus.
    private func step(_ delta: Int) -> KeyPress.Result {
        var items: [SidebarItem] = [.all, .starred, .drafts, .notes, .tasks, .shared, .templates]
        items += app.sidebar.folders.map { .folder($0.id) }
        items += app.sidebar.tags.map { .tag($0.id) }
        items += [.archive, .trash]
        let current = items.firstIndex(of: nav.selection) ?? 0
        let next = max(0, min(items.count - 1, current + delta))
        nav.selection = items[next]
        return .handled
    }

    /// Notes that aren't in a folder yet.
    private var draftCount: Int {
        app.documents.filter { $0.folderId == nil && ($0.kind == .document || $0.kind == .daily) && $0.deletedAt == nil && $0.archivedAt == nil && $0.parentDocumentId == nil }.count
    }

    private var todayTaskCount: Int? { todayTasks }

    private func refreshTaskCount() async {
        let today = TaskLogic.localDate()
        let viewer = app.profile?.id ?? ""
        todayTasks = await TaskStore.load(app: app).filter {
            TaskLogic.views(status: $0.checked ? .done : .open, dueDate: $0.dueDate, assigneeId: $0.assigneeId, today: today, viewerId: viewer).contains(.today)
        }.count
    }

    private func newDocument() async {
        var folderId: String?
        if case .folder(let id) = nav.selection { folderId = id }
        if let id = await app.createDocument(folderId: folderId) { nav.open(id) }
    }

    private func createFolder() {
        let name = newFolderName.trimmingCharacters(in: .whitespaces)
        newFolderName = ""
        guard !name.isEmpty, let workspaceId = app.session?.workspaceId else { return }
        app.perform(String(localized: "Creating a folder")) { session in
            try await session.organization.createFolder(workspaceId: workspaceId, name: name)
        }
    }
}

func withSidebarAnimation(_ body: () -> Void) {
    if NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
        body()
    } else {
        withAnimation(.timingCurve(0.2, 0.7, 0.2, 1, duration: FoleviMotion.slow), body)
    }
}

/// One sidebar row, as the web's NavItem: 32pt, radius 6. Hover = glass hover; active = the glass
/// "active" fill with its edge, heading semibold text and icon; counts in a small pill (inverted when active).
struct SidebarRow<Icon: View>: View {
    var title: Text
    var count: Int?
    var isActive: Bool
    var isDropTarget = false
    @ViewBuilder var icon: Icon
    var action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                icon
                    .font(.system(size: 13.5, weight: .medium))
                    .foregroundStyle(isActive || hovering ? FoleviColor.heading : FoleviColor.inkMuted)
                    .frame(width: 18)
                    .accessibilityHidden(true)
                title
                    .font(.ui(13.5, isActive ? .semibold : .regular))
                    .foregroundStyle(isActive || hovering ? FoleviColor.heading : FoleviColor.ink.opacity(0.9))
                    .lineLimit(1)
                    .truncationMode(.tail)
                Spacer(minLength: 4)
                if let count, count > 0 {
                    Text("\(count)")
                        .font(.ui(11, .semibold))
                        .monospacedDigit()
                        .foregroundStyle(isActive ? FoleviColor.canvas : FoleviColor.inkMuted)
                        .padding(.horizontal, 6)
                        .frame(minWidth: 20, minHeight: 20)
                        .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(isActive ? FoleviColor.heading : FoleviGlass.hover))
                }
            }
            .padding(.horizontal, 10)
            .frame(height: 32)
            .background {
                let shape = RoundedRectangle(cornerRadius: 6, style: .continuous)
                if isActive {
                    shape.fill(FoleviGlass.active)
                        .overlay(shape.strokeBorder(Color.black.opacity(0.06), lineWidth: 1))
                        .shadow(color: .black.opacity(0.06), radius: 1.5, y: 1)
                } else {
                    shape.fill(hovering ? FoleviGlass.hover : .clear)
                }
            }
            .overlay {
                if isDropTarget {
                    RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(FoleviColor.heading, lineWidth: 2)
                }
            }
            .contentShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .accessibilityAddTraits(isActive ? [.isSelected] : [])
        .accessibilityValue(count.map { $0 > 0 ? Text("\($0)") : Text("") } ?? Text(""))
    }
}

/// Plain button that brightens its label on hover.
struct HoverTint: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        HoverTintBody(configuration: configuration)
    }

    private struct HoverTintBody: View {
        let configuration: ButtonStyle.Configuration
        @State private var hovering = false
        var body: some View {
            configuration.label
                .brightness(hovering ? -0.02 : 0)
                .opacity(configuration.isPressed ? 0.85 : 1)
                .onHover { hovering = $0 }
        }
    }
}
