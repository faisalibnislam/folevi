// The Mac sidebar (plan 4.5, decision M3: an NSOutlineView source list on the system's translucent sidebar
// material, so drag and drop with nesting is AppKit's proven path; polish 2.1: 264 wide, rows 28 to 32, 13.5 pt
// Instrument Sans). Top to bottom: the window buttons' band (with the sidebar toggle), the search field, the
// place and space header (its menu switches Personal and workspaces), the outline (Home, Catch me up, All notes,
// Drafts, Shared, Changes, Starred; Folders as a tree with counts; Tags; Templates, Archive, Trash), and the foot:
// the account and place button (Slack/Notion style menu), the sync status and the notifications bell.
//
// Drag and drop: folders drag within the tree to nest, un-nest (onto the Folders header) and reorder; notes
// (`com.folevi.note-ref`, from cards, rows and other windows) drop onto a folder or Drafts to move there.
#if os(macOS)
import AppKit
import SwiftUI
import FoleviDesign
import FoleviEngine
import FoleviScreens

/// An outline item (NSOutlineView compares items by identity: one object per node id, kept across reloads).
@MainActor
final class SidebarItem: NSObject {
    let id: String
    var node: SidebarNode
    var children: [SidebarItem] = []
    weak var parent: SidebarItem?
    init(_ node: SidebarNode) {
        id = node.id
        self.node = node
    }
}

@MainActor
public final class SidebarViewController: NSViewController {
    let model: FrameModel
    let outline = SidebarOutlineView()
    private let scroll = NSScrollView()
    private let search = NSSearchField()
    private let spaceButton = NSButton()
    private let toggle = NSButton()
    private let accountButton = AccountButton()
    private let syncButton = NSButton()
    private let bell = BellButton()
    private var syncHost: NSHostingView<AnyView>?
    private var roots: [SidebarItem] = []
    private var cache: [String: SidebarItem] = [:]
    private var observers: [Observer] = []
    private var popover: NSPopover?
    private var reloading = false
    static let expandedKey = "folevi.sidebar.expanded"
    static let pasteTypes: [NSPasteboard.PasteboardType] = [.init(FrameDrag.noteType), .init(FrameDrag.folderType)]

    public init(model: FrameModel) {
        self.model = model
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not from a nib") }

    public override func loadView() {
        let root = NSView()
        view = root
        // The window buttons' band moves the window.
        let band = DragBand()
        band.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(band)
        NSLayoutConstraint.activate([
            band.topAnchor.constraint(equalTo: root.topAnchor),
            band.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            band.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            band.heightAnchor.constraint(equalToConstant: 52),
        ])

        toggle.bezelStyle = .accessoryBarAction
        toggle.isBordered = false
        toggle.image = NSImage(systemSymbolName: "sidebar.left", accessibilityDescription: "Hide Sidebar")
        toggle.symbolConfiguration = .init(pointSize: 15, weight: .regular)
        toggle.contentTintColor = .secondaryLabelColor
        toggle.toolTip = "Hide Sidebar ⌘\\"
        toggle.target = self
        toggle.action = #selector(toggleSidebar)
        toggle.setAccessibilityIdentifier("sidebar.toggle")

        search.placeholderString = "Search"
        search.controlSize = .large
        search.font = FoleviFonts.nsFont(.ui, size: 13)
        search.sendsSearchStringImmediately = false
        search.sendsWholeSearchString = true
        search.target = self
        search.action = #selector(searched)
        search.setAccessibilityIdentifier("sidebar.search")

        spaceButton.isBordered = false
        spaceButton.alignment = .left
        spaceButton.imagePosition = .imageTrailing
        spaceButton.image = NSImage(systemSymbolName: "chevron.down", accessibilityDescription: nil)
        spaceButton.symbolConfiguration = .init(pointSize: 9, weight: .semibold)
        spaceButton.contentTintColor = .secondaryLabelColor
        spaceButton.target = self
        spaceButton.action = #selector(spaceMenu(_:))
        spaceButton.setAccessibilityIdentifier("sidebar.space")

        outline.style = .sourceList
        outline.headerView = nil
        outline.rowSizeStyle = .custom
        outline.rowHeight = 28
        outline.floatsGroupRows = false
        outline.indentationPerLevel = 14
        outline.autoresizesOutlineColumn = false
        let column = NSTableColumn(identifier: .init("main"))
        column.resizingMask = .autoresizingMask
        outline.addTableColumn(column)
        outline.outlineTableColumn = column
        outline.dataSource = self
        outline.delegate = self
        outline.target = self
        outline.action = #selector(clicked)
        outline.registerForDraggedTypes(Self.pasteTypes)
        outline.setDraggingSourceOperationMask(.move, forLocal: true)
        outline.draggingDestinationFeedbackStyle = .sourceList
        outline.menuProvider = { [weak self] row in self?.menu(forRow: row) }
        outline.setAccessibilityIdentifier("sidebar.outline")
        scroll.documentView = outline
        scroll.drawsBackground = false
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true
        scroll.automaticallyAdjustsContentInsets = false

        syncButton.isBordered = false
        syncButton.title = ""
        syncButton.target = self
        syncButton.action = #selector(showSync(_:))
        syncButton.setAccessibilityIdentifier("sidebar.sync")
        let syncView = NSHostingView(rootView: AnyView(SyncButtonFace(model: model)))
        syncView.translatesAutoresizingMaskIntoConstraints = false
        syncButton.addSubview(syncView)
        syncHost = syncView

        bell.target = self
        bell.action = #selector(showNotifications(_:))
        bell.setAccessibilityIdentifier("sidebar.notifications")

        accountButton.target = self
        accountButton.action = #selector(accountMenu(_:))
        accountButton.setAccessibilityIdentifier("sidebar.account")

        for v in [toggle, search, spaceButton, scroll, accountButton, syncButton, bell] as [NSView] {
            v.translatesAutoresizingMaskIntoConstraints = false
            root.addSubview(v)
        }
        let line = NSBox()
        line.boxType = .separator
        line.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(line)

        NSLayoutConstraint.activate([
            toggle.topAnchor.constraint(equalTo: root.topAnchor, constant: 14),
            toggle.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -12),
            toggle.widthAnchor.constraint(equalToConstant: 28),
            toggle.heightAnchor.constraint(equalToConstant: 24),

            search.topAnchor.constraint(equalTo: root.topAnchor, constant: 52),
            search.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: 10),
            search.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -10),

            spaceButton.topAnchor.constraint(equalTo: search.bottomAnchor, constant: 10),
            spaceButton.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: 16),
            spaceButton.trailingAnchor.constraint(lessThanOrEqualTo: root.trailingAnchor, constant: -12),
            spaceButton.heightAnchor.constraint(equalToConstant: 22),

            scroll.topAnchor.constraint(equalTo: spaceButton.bottomAnchor, constant: 4),
            scroll.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            scroll.bottomAnchor.constraint(equalTo: line.topAnchor),

            line.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: 12),
            line.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -12),
            line.bottomAnchor.constraint(equalTo: accountButton.topAnchor, constant: -6),

            accountButton.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: 8),
            accountButton.bottomAnchor.constraint(equalTo: root.bottomAnchor, constant: -8),
            accountButton.heightAnchor.constraint(equalToConstant: 44),
            accountButton.trailingAnchor.constraint(equalTo: syncButton.leadingAnchor, constant: -2),

            syncButton.centerYAnchor.constraint(equalTo: accountButton.centerYAnchor),
            syncButton.widthAnchor.constraint(equalToConstant: 28),
            syncButton.heightAnchor.constraint(equalToConstant: 28),
            syncButton.trailingAnchor.constraint(equalTo: bell.leadingAnchor, constant: -2),
            syncView.centerXAnchor.constraint(equalTo: syncButton.centerXAnchor),
            syncView.centerYAnchor.constraint(equalTo: syncButton.centerYAnchor),

            bell.centerYAnchor.constraint(equalTo: accountButton.centerYAnchor),
            bell.widthAnchor.constraint(equalToConstant: 28),
            bell.heightAnchor.constraint(equalToConstant: 28),
            bell.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -10),
        ])
    }

    public override func viewDidLoad() {
        super.viewDidLoad()
        observers.append(Observer { [weak self] in self?.reload() })
        observers.append(Observer { [weak self] in self?.updateChrome() })
        observers.append(Observer { [weak self] in
            guard let self else { return }
            _ = self.model.route
            self.syncSelection()
        })
    }

    // MARK: data

    private func reload() {
        let sections = model.sidebar
        var seen = Set<String>()
        func item(_ node: SidebarNode, parent: SidebarItem?) -> SidebarItem {
            let it = cache[node.id] ?? SidebarItem(node)
            it.node = node
            it.parent = parent
            seen.insert(node.id)
            cache[node.id] = it
            it.children = node.children.map { item($0, parent: it) }
            return it
        }
        var next: [SidebarItem] = []
        for s in sections {
            if s.id == SidebarModel.topHeader {
                next += s.children.map { item($0, parent: nil) }
            } else {
                next.append(item(s, parent: nil))
            }
        }
        cache = cache.filter { seen.contains($0.key) }
        roots = next
        reloading = true
        outline.reloadData()
        restoreExpansion()
        reloading = false
        syncSelection()
    }

    private var expandedIds: Set<String> {
        get { Set(UserDefaults.standard.stringArray(forKey: Self.expandedKey) ?? [SidebarModel.foldersHeader, SidebarModel.tagsHeader, SidebarModel.moreHeader]) }
        set { UserDefaults.standard.set(Array(newValue).sorted(), forKey: Self.expandedKey) }
    }

    private func restoreExpansion() {
        let open = expandedIds
        func walk(_ items: [SidebarItem]) {
            for it in items where !it.children.isEmpty {
                if open.contains(it.id) {
                    outline.expandItem(it)
                    walk(it.children)
                }
            }
        }
        walk(roots)
    }

    private func syncSelection() {
        guard let id = SidebarModel.selectionId(for: model.route), let item = cache[id] else {
            outline.deselectAll(nil)
            return
        }
        var p = item.parent
        while let parent = p {
            outline.expandItem(parent)
            p = parent.parent
        }
        let row = outline.row(forItem: item)
        if row >= 0, outline.selectedRow != row {
            outline.selectRowIndexes([row], byExtendingSelection: false)
            outline.scrollRowToVisible(row)
        }
    }

    private func updateChrome() {
        let title = model.spaceName
        spaceButton.attributedTitle = NSAttributedString(string: title + "  ", attributes: [.font: FoleviFonts.nsFont(.ui, size: 13, weight: .semibold), .foregroundColor: NSColor.labelColor])
        spaceButton.setAccessibilityLabel("\(title), switch space")
        let session = model.session.value
        let place = model.places.value
        let current = place?.places.first { $0.id == place?.current }
        accountButton.update(name: model.accountName.isEmpty ? (session?.mode == .local ? "On this Mac" : "Folevi") : model.accountName,
                             detail: session?.mode == .local ? (current?.syncs ?? "On this Mac") : (session?.profile.email ?? ""),
                             others: (place?.places ?? []).filter { $0.id != place?.current }.reduce(0) { $0 + $1.unread })
        bell.count = model.unreadCount
        syncButton.toolTip = model.sync.value?.headline ?? "Connecting…"
        syncButton.setAccessibilityLabel("Sync: \(model.sync.value?.headline ?? "connecting")")
        toggle.isHidden = model.sidebarCollapsed
    }

    // MARK: actions

    @objc private func toggleSidebar() { view.window?.firstResponder?.tryToPerform(#selector(NSSplitViewController.toggleSidebar(_:)), with: nil) }

    @objc private func searched() {
        let text = search.stringValue.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return }
        model.open(.search(text))
    }

    /// ⌘K / Open Quickly / Search All Notes: the sidebar's field.
    public func focusSearch() {
        if model.sidebarCollapsed { toggleSidebar() }
        view.window?.makeFirstResponder(search)
    }

    @objc private func clicked() {
        let row = outline.clickedRow >= 0 ? outline.clickedRow : outline.selectedRow
        guard row >= 0, let item = outline.item(atRow: row) as? SidebarItem, let route = item.node.route else { return }
        model.open(route, title: item.node.kind == .tag ? "#" + item.node.title : item.node.title)
    }

    @objc private func spaceMenu(_ sender: NSButton) {
        guard let s = model.session.value, s.spaces.count > 1 else { return }
        let menu = NSMenu()
        for space in s.spaces {
            let item = ClosureMenuItem(title: space.name) { [weak self] in self?.model.switchSpace(space.id) }
            item.state = space.id == s.space ? .on : .off
            item.image = NSImage(systemSymbolName: space.kind == .personal ? "person" : "person.3", accessibilityDescription: nil)
            menu.addItem(item)
        }
        menu.popUp(positioning: nil, at: NSPoint(x: 0, y: sender.bounds.height + 4), in: sender)
    }

    @objc private func accountMenu(_ sender: NSButton) {
        let menu = AccountMenu.build(model: model)
        menu.popUp(positioning: nil, at: NSPoint(x: 0, y: -4), in: sender)
    }

    @objc private func showSync(_ sender: NSButton) {
        show(AnyView(SyncPopover(model: model)), from: sender)
    }

    @objc private func showNotifications(_ sender: NSButton) {
        model.loadNotifications()
        show(AnyView(NotificationsPopover(model: model) { [weak self] in self?.popover?.close() }), from: sender)
    }

    private func show(_ content: AnyView, from view: NSView) {
        popover?.close()
        let p = NSPopover()
        p.behavior = .transient
        p.contentViewController = NSHostingController(rootView: content)
        p.show(relativeTo: view.bounds, of: view, preferredEdge: .maxY)
        popover = p
    }

    /// The popover on screen (tests, the eval hook).
    public var shownPopover: NSPopover? { popover?.isShown == true ? popover : nil }

    public func openSyncPopover() { showSync(syncButton) }
    public func openNotificationsPopover() { showNotifications(bell) }

    private func menu(forRow row: Int) -> NSMenu? {
        guard let item = outline.item(atRow: row) as? SidebarItem else { return nil }
        let menu = NSMenu()
        switch item.node.kind {
        case .folder:
            guard let id = item.node.folderId else { return nil }
            menu.addItem(ClosureMenuItem(title: "Open in New Tab") { [weak self] in self?.model.open(.folder(id), title: item.node.title) })
            menu.addItem(ClosureMenuItem(title: "Open in New Window") { [weak self] in self?.model.host?.frameOpenInNewWindow(.folder(id)) })
            menu.addItem(.separator())
            menu.addItem(ClosureMenuItem(title: "New Note Here") { [weak self] in self?.model.newNote(in: id) })
            menu.addItem(ClosureMenuItem(title: "New Folder Inside") { [weak self] in self?.model.newFolder(parent: id) })
            if item.parent?.id != SidebarModel.foldersHeader {
                menu.addItem(ClosureMenuItem(title: "Move to Top Level") { [weak self] in self?.model.move(folder: id, into: nil, after: nil) })
            }
        case .header where item.id == SidebarModel.foldersHeader:
            menu.addItem(ClosureMenuItem(title: "New Folder") { [weak self] in self?.model.newFolder() })
        case .destination(let r):
            menu.addItem(ClosureMenuItem(title: "Open in New Window") { [weak self] in self?.model.host?.frameOpenInNewWindow(r) })
        default:
            return nil
        }
        return menu
    }
}

// MARK: outline data and look

extension SidebarViewController: NSOutlineViewDataSource, NSOutlineViewDelegate {
    public func outlineView(_ outlineView: NSOutlineView, numberOfChildrenOfItem item: Any?) -> Int {
        (item as? SidebarItem)?.children.count ?? roots.count
    }

    public func outlineView(_ outlineView: NSOutlineView, child index: Int, ofItem item: Any?) -> Any {
        (item as? SidebarItem)?.children[index] ?? roots[index]
    }

    public func outlineView(_ outlineView: NSOutlineView, isItemExpandable item: Any) -> Bool {
        guard let it = item as? SidebarItem else { return false }
        return !it.children.isEmpty || it.id == SidebarModel.foldersHeader
    }

    public func outlineView(_ outlineView: NSOutlineView, isGroupItem item: Any) -> Bool {
        (item as? SidebarItem)?.node.kind == .header
    }

    public func outlineView(_ outlineView: NSOutlineView, shouldSelectItem item: Any) -> Bool {
        (item as? SidebarItem)?.node.kind != .header
    }

    public func outlineView(_ outlineView: NSOutlineView, heightOfRowByItem item: Any) -> CGFloat {
        (item as? SidebarItem)?.node.kind == .header ? 26 : 28
    }

    public func outlineView(_ outlineView: NSOutlineView, viewFor tableColumn: NSTableColumn?, item: Any) -> NSView? {
        guard let it = item as? SidebarItem else { return nil }
        if it.node.kind == .header {
            let cell = outlineView.makeView(withIdentifier: SidebarHeaderCell.id, owner: nil) as? SidebarHeaderCell ?? SidebarHeaderCell()
            cell.configure(title: it.node.title, showsAdd: it.id == SidebarModel.foldersHeader) { [weak self] in self?.model.newFolder() }
            return cell
        }
        let cell = outlineView.makeView(withIdentifier: SidebarCell.id, owner: nil) as? SidebarCell ?? SidebarCell()
        cell.configure(it.node)
        return cell
    }

    public func outlineViewItemDidExpand(_ notification: Notification) {
        guard !reloading, let it = notification.userInfo?["NSObject"] as? SidebarItem else { return }
        expandedIds.insert(it.id)
    }

    public func outlineViewItemDidCollapse(_ notification: Notification) {
        guard !reloading, let it = notification.userInfo?["NSObject"] as? SidebarItem else { return }
        expandedIds.remove(it.id)
    }

    public func outlineViewSelectionDidChange(_ notification: Notification) {
        // Keyboard moves (↑ ↓) open what they land on, as Mail and Notes do; clicks go through `clicked`.
        guard !reloading, NSApp.currentEvent?.type == .keyDown else { return }
        clicked()
    }

    // MARK: drag and drop

    public func outlineView(_ outlineView: NSOutlineView, pasteboardWriterForItem item: Any) -> (any NSPasteboardWriting)? {
        guard let it = item as? SidebarItem, let id = it.node.folderId else { return nil }
        let p = NSPasteboardItem()
        let drag = FolderDragItem(id: id, name: it.node.title, parentId: it.parent?.node.folderId)
        if let data = try? JSONEncoder().encode(drag) { p.setData(data, forType: .init(FrameDrag.folderType)) }
        p.setString(FoleviLinks.folder(id), forType: .string)
        return p
    }

    public func outlineView(_ outlineView: NSOutlineView, validateDrop info: any NSDraggingInfo, proposedItem item: Any?, proposedChildIndex index: Int) -> NSDragOperation {
        let pb = info.draggingPasteboard
        let target = item as? SidebarItem
        if let folder = pb.pasteboardItems?.first.flatMap(FrameDrag.folderId) {
            return SidebarDrop.folder(folder, onto: target?.node, parentIsFolders: target?.id == SidebarModel.foldersHeader, index: index, tree: FolderTree(model.folders.value?.folders ?? [])) == nil ? [] : .move
        }
        if pb.pasteboardItems?.contains(where: { FrameDrag.noteId($0) != nil }) == true {
            return SidebarDrop.notesTarget(target?.node, index: index) == nil ? [] : .move
        }
        return []
    }

    public func outlineView(_ outlineView: NSOutlineView, acceptDrop info: any NSDraggingInfo, item: Any?, childIndex index: Int) -> Bool {
        let pb = info.draggingPasteboard
        let target = item as? SidebarItem
        if let folder = pb.pasteboardItems?.first.flatMap(FrameDrag.folderId) {
            guard let move = SidebarDrop.folder(folder, onto: target?.node, parentIsFolders: target?.id == SidebarModel.foldersHeader, index: index, tree: FolderTree(model.folders.value?.folders ?? [])) else { return false }
            model.move(folder: folder, into: move.parentId, after: move.afterId)
            return true
        }
        let ids = (pb.pasteboardItems ?? []).compactMap(FrameDrag.noteId)
        guard !ids.isEmpty, let dest = SidebarDrop.notesTarget(target?.node, index: index) else { return false }
        model.move(notes: ids, to: dest.folderId)
        return true
    }
}

/// Where a drop on the sidebar goes. Pure (FoleviMacTests).
public enum SidebarDrop {
    public struct FolderPlace: Equatable, Sendable {
        public var parentId: String?
        public var afterId: String?
    }

    /// A folder dropped on a row (`index` -1, NSOutlineViewDropOnItemIndex) nests in it; dropped between rows
    /// under the Folders header or a folder it goes there among its siblings; on the Folders header itself it
    /// goes to the top level. Nil when the drop isn't allowed.
    public static func folder(_ folder: String, onto target: SidebarNode?, parentIsFolders: Bool, index: Int, tree: FolderTree) -> FolderPlace? {
        let parent: String?
        let after: String?
        if parentIsFolders {
            parent = nil
            after = index < 0 ? nil : tree.afterId(dropping: folder, into: nil, at: index)
        } else if let t = target, let tid = t.folderId {
            parent = tid
            after = index < 0 ? tree.children(of: tid).filter { $0 != folder }.last : tree.afterId(dropping: folder, into: tid, at: index)
        } else {
            return nil
        }
        guard tree.canMove(folder, into: parent) == nil else { return nil }
        // A drop that changes nothing (onto its own parent's end, or its own slot) isn't offered.
        if parent == tree.parentOf(folder) {
            let siblings = tree.children(of: parent)
            let currentAfter = siblings.firstIndex(of: folder).flatMap { $0 > 0 ? siblings[$0 - 1] : nil }
            if index < 0 && !parentIsFolders { return nil }
            if after == currentAfter { return nil }
        }
        return FolderPlace(parentId: parent, afterId: after)
    }

    public struct NotesPlace: Equatable, Sendable { public var folderId: String? }

    /// Notes go into a folder (dropped on its row) or Drafts (dropped on Drafts).
    public static func notesTarget(_ target: SidebarNode?, index: Int) -> NotesPlace? {
        guard index < 0, let t = target else { return nil }
        if let f = t.folderId { return NotesPlace(folderId: f) }
        if case .destination(.notes(.unsorted)) = t.kind { return NotesPlace(folderId: nil) }
        return nil
    }
}

// MARK: views

/// An outline that gives each row its own context menu.
@MainActor
final class SidebarOutlineView: NSOutlineView {
    var menuProvider: ((Int) -> NSMenu?)?
    override func menu(for event: NSEvent) -> NSMenu? {
        let row = self.row(at: convert(event.locationInWindow, from: nil))
        return row >= 0 ? menuProvider?(row) : nil
    }
}

@MainActor
final class SidebarCell: NSTableCellView {
    static let id = NSUserInterfaceItemIdentifier("SidebarCell")
    private let icon = NSImageView()
    private let emoji = NSTextField(labelWithString: "")
    private var glyph: NSHostingView<FolderGlyph>?
    private let title = NSTextField(labelWithString: "")
    private let count = NSTextField(labelWithString: "")
    private let dot = NSView()

    init() {
        super.init(frame: .zero)
        identifier = Self.id
        icon.symbolConfiguration = .init(pointSize: 14, weight: .regular)
        icon.contentTintColor = .secondaryLabelColor
        title.font = FoleviFonts.nsFont(.ui, size: 13.5)
        title.lineBreakMode = .byTruncatingTail
        count.font = FoleviFonts.nsFont(.ui, size: 12)
        count.textColor = .tertiaryLabelColor
        count.alignment = .right
        dot.wantsLayer = true
        dot.layer?.cornerRadius = 2
        for v in [icon, emoji, title, count, dot] as [NSView] {
            v.translatesAutoresizingMaskIntoConstraints = false
            addSubview(v)
        }
        textField = title
        imageView = icon
        NSLayoutConstraint.activate([
            icon.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 2),
            icon.centerYAnchor.constraint(equalTo: centerYAnchor),
            icon.widthAnchor.constraint(equalToConstant: 20),
            title.leadingAnchor.constraint(equalTo: icon.trailingAnchor, constant: 6),
            title.centerYAnchor.constraint(equalTo: centerYAnchor),
            title.trailingAnchor.constraint(lessThanOrEqualTo: count.leadingAnchor, constant: -6),
            count.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -8),
            count.centerYAnchor.constraint(equalTo: centerYAnchor),
            dot.widthAnchor.constraint(equalToConstant: 6),
            dot.heightAnchor.constraint(equalToConstant: 6),
            dot.trailingAnchor.constraint(equalTo: count.leadingAnchor, constant: -4),
            dot.centerYAnchor.constraint(equalTo: centerYAnchor),
        ])
        title.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        count.setContentCompressionResistancePriority(.required, for: .horizontal)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not from a nib") }

    func configure(_ node: SidebarNode) {
        title.stringValue = node.title
        count.stringValue = node.count.map { $0.formatted() } ?? ""
        if node.kind == .folder {
            icon.image = nil
            if glyph == nil {
                let g = NSHostingView(rootView: FolderGlyph(colorId: node.colorId, size: 15))
                g.translatesAutoresizingMaskIntoConstraints = false
                addSubview(g)
                NSLayoutConstraint.activate([g.centerXAnchor.constraint(equalTo: icon.centerXAnchor), g.centerYAnchor.constraint(equalTo: centerYAnchor)])
                glyph = g
            } else {
                glyph?.rootView = FolderGlyph(colorId: node.colorId, size: 15)
            }
            glyph?.isHidden = false
        } else {
            glyph?.isHidden = true
            icon.image = NSImage(systemSymbolName: node.symbol, accessibilityDescription: nil)
            if node.kind == .tag, let c = node.colorId { icon.contentTintColor = Self.tagColor(c) } else { icon.contentTintColor = .secondaryLabelColor }
        }
        // Waiting to sync or failed (folders made or moved offline), as the web's row marks.
        switch node.sync {
        case .saved: dot.isHidden = true
        case .waiting:
            dot.isHidden = false
            dot.layer?.backgroundColor = NSColor.tertiaryLabelColor.cgColor
        case .failed, .conflict:
            dot.isHidden = false
            dot.layer?.backgroundColor = NSColor.systemRed.cgColor
        }
        setAccessibilityLabel([node.title, node.count.map { "\($0) notes" }, node.sync == .saved ? nil : "waiting to sync"].compactMap { $0 }.joined(separator: ", "))
        setAccessibilityIdentifier("sidebar.row.\(node.id)")
    }

    static func tagColor(_ key: String) -> NSColor {
        switch key {
        case "ember", "coral", "red": return .systemOrange
        case "moss", "green": return .systemGreen
        case "marigold", "yellow", "amber": return .systemYellow
        case "plum", "purple": return .systemPurple
        default: return .secondaryLabelColor
        }
    }
}

@MainActor
final class SidebarHeaderCell: NSTableCellView {
    static let id = NSUserInterfaceItemIdentifier("SidebarHeaderCell")
    private let title = NSTextField(labelWithString: "")
    private let add = NSButton()
    private var onAdd: (() -> Void)?

    init() {
        super.init(frame: .zero)
        identifier = Self.id
        title.font = FoleviFonts.nsFont(.ui, size: 11.5, weight: .semibold)
        title.textColor = .tertiaryLabelColor
        add.isBordered = false
        add.image = NSImage(systemSymbolName: "plus", accessibilityDescription: "New Folder")
        add.symbolConfiguration = .init(pointSize: 11, weight: .semibold)
        add.contentTintColor = .tertiaryLabelColor
        add.toolTip = "New Folder ⌃⌘N"
        add.target = self
        add.action = #selector(addTapped)
        for v in [title, add] as [NSView] {
            v.translatesAutoresizingMaskIntoConstraints = false
            addSubview(v)
        }
        textField = title
        NSLayoutConstraint.activate([
            title.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 2),
            title.centerYAnchor.constraint(equalTo: centerYAnchor),
            add.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -8),
            add.centerYAnchor.constraint(equalTo: centerYAnchor),
            add.widthAnchor.constraint(equalToConstant: 18),
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not from a nib") }

    func configure(title: String, showsAdd: Bool, onAdd: @escaping () -> Void) {
        self.title.stringValue = title.uppercased()
        self.title.setAccessibilityLabel(title)
        add.isHidden = !showsAdd
        add.setAccessibilityIdentifier(showsAdd ? "sidebar.newFolder" : nil)
        self.onAdd = onAdd
    }

    @objc private func addTapped() { onAdd?() }
}

/// The sync button's face: the design system's cloud with its status dot.
struct SyncButtonFace: View {
    let model: FrameModel
    var body: some View {
        SyncStatusView(model.sync.value?.indicator ?? .syncing())
            .allowsHitTesting(false)
    }
}

/// The account and place button: avatar, name, where (email or the library's sync), a dot when other places have
/// something new.
@MainActor
final class AccountButton: NSButton {
    private let avatar = NSTextField(labelWithString: "")
    private let name = NSTextField(labelWithString: "")
    private let detail = NSTextField(labelWithString: "")
    private let chevron = NSImageView()
    private let dot = NSView()
    private var hovering = false { didSet { layer?.backgroundColor = hovering ? NSColor(white: 0.5, alpha: 0.12).cgColor : NSColor.clear.cgColor } }
    private var tracking: NSTrackingArea?

    init() {
        super.init(frame: .zero)
        isBordered = false
        title = ""
        wantsLayer = true
        layer?.cornerRadius = 8
        avatar.alignment = .center
        avatar.font = FoleviFonts.nsFont(.ui, size: 12, weight: .semibold)
        avatar.textColor = .white
        avatar.wantsLayer = true
        avatar.layer?.cornerRadius = 6
        avatar.layer?.backgroundColor = NSColor(srgbRed: 0.24, green: 0.24, blue: 0.27, alpha: 1).cgColor
        name.font = FoleviFonts.nsFont(.ui, size: 13.5, weight: .semibold)
        name.lineBreakMode = .byTruncatingTail
        detail.font = FoleviFonts.nsFont(.ui, size: 11.5)
        detail.textColor = .secondaryLabelColor
        detail.lineBreakMode = .byTruncatingTail
        chevron.image = NSImage(systemSymbolName: "chevron.up.chevron.down", accessibilityDescription: nil)
        chevron.symbolConfiguration = .init(pointSize: 10, weight: .semibold)
        chevron.contentTintColor = .tertiaryLabelColor
        dot.wantsLayer = true
        dot.layer?.cornerRadius = 2.5
        dot.layer?.backgroundColor = NSColor(srgbRed: 0.96, green: 0.38, blue: 0.21, alpha: 1).cgColor
        for v in [avatar, name, detail, chevron, dot] as [NSView] {
            v.translatesAutoresizingMaskIntoConstraints = false
            addSubview(v)
        }
        NSLayoutConstraint.activate([
            avatar.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 6),
            avatar.centerYAnchor.constraint(equalTo: centerYAnchor),
            avatar.widthAnchor.constraint(equalToConstant: 28),
            avatar.heightAnchor.constraint(equalToConstant: 28),
            name.leadingAnchor.constraint(equalTo: avatar.trailingAnchor, constant: 8),
            name.topAnchor.constraint(equalTo: topAnchor, constant: 5),
            name.trailingAnchor.constraint(lessThanOrEqualTo: chevron.leadingAnchor, constant: -4),
            detail.leadingAnchor.constraint(equalTo: name.leadingAnchor),
            detail.topAnchor.constraint(equalTo: name.bottomAnchor, constant: 0),
            detail.trailingAnchor.constraint(lessThanOrEqualTo: chevron.leadingAnchor, constant: -4),
            chevron.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -6),
            chevron.centerYAnchor.constraint(equalTo: centerYAnchor),
            dot.widthAnchor.constraint(equalToConstant: 5),
            dot.heightAnchor.constraint(equalToConstant: 5),
            dot.topAnchor.constraint(equalTo: avatar.topAnchor, constant: -1),
            dot.trailingAnchor.constraint(equalTo: avatar.trailingAnchor, constant: 1),
        ])
        name.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        detail.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not from a nib") }

    func update(name n: String, detail d: String, others: Int) {
        name.stringValue = n
        detail.stringValue = d
        avatar.stringValue = String(n.first.map(String.init) ?? "F").uppercased()
        dot.isHidden = others == 0
        setAccessibilityLabel("\(n), \(d). Places, settings and account")
        toolTip = d.isEmpty ? n : "\(n) (\(d))"
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let t = tracking { removeTrackingArea(t) }
        let t = NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect], owner: self)
        addTrackingArea(t)
        tracking = t
    }

    override func mouseEntered(with event: NSEvent) { hovering = true }
    override func mouseExited(with event: NSEvent) { hovering = false }
    // Menus open on mouse-down (polish 1, item 7).
    override func mouseDown(with event: NSEvent) { sendAction(action, to: target) }
}

/// The notifications bell with its unread badge.
@MainActor
final class BellButton: NSButton {
    private let badge = NSTextField(labelWithString: "")
    var count = 0 {
        didSet {
            badge.stringValue = count > 99 ? "99+" : "\(count)"
            badge.isHidden = count == 0
            setAccessibilityLabel(count == 0 ? "Notifications" : "Notifications, \(count) unread")
        }
    }

    init() {
        super.init(frame: .zero)
        isBordered = false
        title = ""
        image = NSImage(systemSymbolName: "bell", accessibilityDescription: "Notifications")
        symbolConfiguration = .init(pointSize: 14, weight: .regular)
        contentTintColor = .secondaryLabelColor
        toolTip = "Notifications"
        badge.font = FoleviFonts.nsFont(.ui, size: 9.5, weight: .semibold)
        badge.textColor = .white
        badge.alignment = .center
        badge.wantsLayer = true
        badge.layer?.cornerRadius = 4
        badge.layer?.backgroundColor = NSColor(srgbRed: 0.96, green: 0.38, blue: 0.21, alpha: 1).cgColor
        badge.translatesAutoresizingMaskIntoConstraints = false
        badge.isHidden = true
        addSubview(badge)
        NSLayoutConstraint.activate([
            badge.topAnchor.constraint(equalTo: topAnchor, constant: 0),
            badge.trailingAnchor.constraint(equalTo: trailingAnchor, constant: 2),
            badge.heightAnchor.constraint(equalToConstant: 13),
            badge.widthAnchor.constraint(greaterThanOrEqualToConstant: 13),
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not from a nib") }

    override func mouseDown(with event: NSEvent) { sendAction(action, to: target) }
}

/// A view whose empty background moves the window (the window buttons' band, the top bar): a drag moves it, a
/// double-click does what System Settings says (zoom, minimise or nothing).
@MainActor
open class DragBand: NSView {
    open override var mouseDownCanMoveWindow: Bool { true }

    open override func mouseDown(with event: NSEvent) {
        guard let window else { return super.mouseDown(with: event) }
        if event.clickCount == 2 {
            let global = UserDefaults.standard.persistentDomain(forName: UserDefaults.globalDomain) ?? [:]
            switch global["AppleActionOnDoubleClick"] as? String {
            case "Minimize": window.performMiniaturize(nil)
            case "None": break
            default: window.performZoom(nil)
            }
        } else {
            window.performDrag(with: event)
        }
    }
}
#endif
