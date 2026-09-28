import SwiftUI

/// Drag payload for documents (browser cards → sidebar folders).
struct DocumentDragPayload: Codable, Transferable {
    var documentId: String
    static var transferRepresentation: some TransferRepresentation {
        CodableRepresentation(contentType: .foleviDocument)
    }
}

/// Warm Folio sidebar: sidebar tint, 32pt rows (radius 10), hover accentSoft, the active row a raised
/// white pill with heading text and an ember icon; caps section labels; a sunken search pill with a
/// ⌘K keycap and a secondary "New Page" pill; account, help and settings in a raised footer.
struct SidebarView: View {
    @Bindable var nav: NavigationModel
    @Environment(AppModel.self) private var app
    @Environment(\.openSettings) private var openSettings
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @State private var newFolderName = ""
    @State private var showNewFolder = false
    @State private var dropTargetFolder: String?
    @State private var foldersOpen = true
    @State private var tagsOpen = true
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

            VStack(spacing: 8) {
                searchPill
                newPagePill
            }
            .padding(.horizontal, 10)

            ScrollView {
                VStack(alignment: .leading, spacing: 2) {
                    row(.all, count: libraryCount)
                    row(.tasks, count: todayTaskCount)
                    row(.calendar)
                    row(.shared)
                    row(.templates)

                    section("Starred") { row(.starred) }

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
                                    Circle().fill(Color.folevi(tag: tag.color)).frame(width: 8, height: 8)
                                } action: {
                                    nav.selection = .tag(tag.id)
                                }
                                .accessibilityIdentifier(SidebarItem.tag(tag.id).accessibilityId)
                            }
                        }
                    }

                    Spacer().frame(height: 14)
                    row(.archive)
                    row(.trash, count: trashCount)
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

            footer
                .padding(.horizontal, 10)
                .padding(.bottom, 10)
        }
        .frame(width: FoleviLayout.sidebarDefault)
        .background {
            FoleviColor.sidebar.opacity(reduceTransparency ? 1 : 0.84)
                .overlay(alignment: .trailing) { FoleviColor.line.frame(width: 1) }
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

    private var workspaceHeader: some View {
        HStack(spacing: 10) {
            FoleviMark(size: 28)
            Text(app.workspace?.name ?? "Folevi")
                .font(.ui(14, .semibold))
                .tracking(-0.01 * 14)
                .foregroundStyle(FoleviColor.heading)
                .lineLimit(1)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 4)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text("Workspace \(app.workspace?.name ?? "Folevi")"))
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

    private var newPagePill: some View {
        Button {
            Task { await newDocument() }
        } label: {
            HStack(spacing: 9) {
                Image(systemName: "plus")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 20, height: 20)
                    .background(Circle().fill(FoleviColor.ember))
                    .accessibilityHidden(true)
                Text("New Document")
                Spacer(minLength: 4)
                Text("⌘N").font(.ui(11)).foregroundStyle(FoleviColor.inkFaint)
            }
            .padding(.leading, -6)
        }
        .buttonStyle(.folevi(.secondary, .medium, fullWidth: true))
        .accessibilityLabel(Text("New Document"))
        .accessibilityIdentifier("sidebar.newDocument")
    }

    // MARK: Footer

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
                        .background(Circle().fill(LinearGradient(colors: [FoleviColor.glowPeach, FoleviColor.emberSoft], startPoint: .topLeading, endPoint: .bottomTrailing)))
                        .overlay(Circle().strokeBorder(.white.opacity(0.6), lineWidth: 1))
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
        .foleviSurface(.color(FoleviColor.surfaceRaised), shape: .rounded(14), shadow: FoleviShadow.control)
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
            if let icon = folder.icon, !icon.isEmpty { Text(icon).font(.system(size: 13)) } else { Image(systemName: "folder") }
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
        var items: [SidebarItem] = [.all, .tasks, .calendar, .shared, .templates, .starred]
        items += app.sidebar.folders.map { .folder($0.id) }
        items += app.sidebar.tags.map { .tag($0.id) }
        items += [.archive, .trash]
        let current = items.firstIndex(of: nav.selection) ?? 0
        let next = max(0, min(items.count - 1, current + delta))
        nav.selection = items[next]
        return .handled
    }

    private var libraryCount: Int {
        app.documents.filter { ($0.kind == .document || $0.kind == .daily) && $0.deletedAt == nil && $0.archivedAt == nil && $0.parentDocumentId == nil }.count
    }

    private var trashCount: Int {
        app.documents.filter { $0.deletedAt != nil }.count
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

/// One sidebar row: 32pt, radius 10. Hover = accentSoft; active = raised white pill, heading
/// semibold text, ember icon; counts in a small pill.
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
                    .foregroundStyle(isActive ? FoleviColor.ember : hovering ? FoleviColor.heading : FoleviColor.inkMuted)
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
                        .foregroundStyle(isActive ? FoleviColor.emberInk : FoleviColor.inkMuted)
                        .padding(.horizontal, 6)
                        .frame(minWidth: 20, minHeight: 20)
                        .background(Capsule().fill(isActive ? FoleviColor.emberSoft : FoleviColor.ink.opacity(0.07)))
                }
            }
            .padding(.horizontal, 10)
            .frame(height: 32)
            .background {
                if isActive {
                    Color.clear.foleviSurface(.color(FoleviColor.surfaceRaised), shape: .rounded(FoleviRadius.control), shadow: FoleviShadow.control)
                } else {
                    RoundedRectangle(cornerRadius: FoleviRadius.control, style: .continuous)
                        .fill(hovering ? FoleviColor.accentSoft.opacity(0.75) : .clear)
                }
            }
            .overlay {
                if isDropTarget {
                    RoundedRectangle(cornerRadius: FoleviRadius.control, style: .continuous).strokeBorder(FoleviColor.ember, lineWidth: 2)
                }
            }
            .contentShape(RoundedRectangle(cornerRadius: FoleviRadius.control, style: .continuous))
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
