// A folder's menu (web app/FolderMenu.tsx) as a native context menu (UIMenu on iOS, NSMenu on the Mac through
// SwiftUI's Menu and contextMenu): New note in folder, New folder inside, Rename, Change color, Move folder,
// Move to another place, Move to top level, Ask Foli AI about this folder, Copy link, Invite people, Delete
// folder. Its dialogs (rename and new-folder prompts, the move sheet, the delete alert) hang off the screen with
// `.folderDialogs(...)`.
import SwiftUI
import FoleviDesign
import FoleviEngine

/// A folder as its menu needs it.
public struct MenuFolder: Hashable, Sendable, Identifiable {
    public var id: String
    public var name: String
    public var parentId: String?
    public var color: String?
    public init(id: String, name: String, parentId: String?, color: String?) {
        self.id = id
        self.name = name
        self.parentId = parentId
        self.color = color
    }
    public init(_ card: FolderCard) { self.init(id: card.id, name: card.name, parentId: card.parentId, color: card.color) }
    public init(_ node: FolderNode) { self.init(id: node.id, name: node.name, parentId: node.parentId, color: node.color) }
}

/// What the menu may offer here.
public struct FolderMenuContext: Sendable {
    public var canEdit: Bool
    /// A team workspace this person manages (Personal has no members to invite).
    public var inviteSpace: SpaceRef?
    public var aiOn: Bool
    /// Another place exists (another account or the library).
    public var otherPlaces: Bool
    public var links: [FolderRules.Link]
    /// "Always fully encrypted" is offered here (an account with encryption, and this person may).
    public var canLock: Bool
    /// The space's level, "standard" or "encrypted" (the stop wording differs).
    public var level: String
    public var lockedIds: Set<String>
    public init(canEdit: Bool, inviteSpace: SpaceRef?, aiOn: Bool, otherPlaces: Bool, links: [FolderRules.Link], canLock: Bool = false, level: String = "standard", lockedIds: Set<String> = []) {
        self.canEdit = canEdit
        self.inviteSpace = inviteSpace
        self.aiOn = aiOn
        self.otherPlaces = otherPlaces
        self.links = links
        self.canLock = canLock
        self.level = level
        self.lockedIds = lockedIds
    }

    @MainActor
    public init(session: SessionValue?, places: PlacesValue?, links: [FolderRules.Link], locks: FolderLocksValue? = nil) {
        let space = session.flatMap { s in s.spaces.first { $0.id == s.space } }
        self.init(
            canEdit: space?.canEdit ?? true,
            inviteSpace: (space?.kind == .workspace && space?.canManage == true) ? space?.id : nil,
            aiOn: session?.capabilities.ai ?? false,
            otherPlaces: (places?.places.count ?? 0) > 1,
            links: links,
            canLock: locks?.canLock ?? false,
            level: locks?.level ?? "standard",
            lockedIds: Set(locks?.locked ?? [])
        )
    }

    public func isLocked(_ id: String) -> Bool { lockedIds.contains(id) }

    public func subfolderCount(_ id: String) -> Int { links.filter { $0.parentId == id }.count }
}

public enum FolderMenuItem: Hashable, Sendable {
    case newNote, newFolderInside, rename, color, move, movePlaces, moveToTop, askAI, lock, copyLink, invite, delete

    public var title: String {
        switch self {
        case .newNote: "New note in folder"
        case .newFolderInside: "New folder inside…"
        case .rename: "Rename…"
        case .color: "Change color"
        case .move: "Move folder…"
        case .movePlaces: "Move to another place…"
        case .moveToTop: "Move to top level"
        case .askAI: "Ask Foli AI about this folder…"
        case .lock: "Always fully encrypted"
        case .copyLink: "Copy link"
        case .invite: "Invite people…"
        case .delete: "Delete folder…"
        }
    }

    public var symbol: String {
        switch self {
        case .newNote: "doc.badge.plus"
        case .newFolderInside: "folder.badge.plus"
        case .rename: "pencil"
        case .color: "paintpalette"
        case .move: "folder"
        case .movePlaces: "arrow.left.arrow.right"
        case .moveToTop: "arrow.uturn.up"
        case .askAI: "sparkles"
        case .lock: "lock"
        case .copyLink: "link"
        case .invite: "person.badge.plus"
        case .delete: "trash"
        }
    }

    /// The menu's groups for a folder, in the web's order (separators between groups).
    public static func groups(for folder: MenuFolder, in context: FolderMenuContext) -> [[FolderMenuItem]] {
        var groups: [[FolderMenuItem]] = []
        if context.canEdit {
            var create: [FolderMenuItem] = [.newNote]
            if FolderRules.canNest(context.links, in: folder.id) || !context.links.contains(where: { $0.id == folder.id }) { create.append(.newFolderInside) }
            groups.append(create)
            var edit: [FolderMenuItem] = [.rename, .color, .move]
            if context.otherPlaces { edit.append(.movePlaces) }
            if folder.parentId != nil { edit.append(.moveToTop) }
            groups.append(edit)
        }
        var share: [FolderMenuItem] = []
        if context.aiOn { share.append(.askAI) }
        if context.canLock { share.append(.lock) }
        share.append(.copyLink)
        if context.inviteSpace != nil { share.append(.invite) }
        groups.append(share)
        if context.canEdit { groups.append([.delete]) }
        return groups
    }
}

/// The dialog a folder menu item opened.
public enum FolderDialog: Identifiable, Hashable, Sendable {
    case rename(MenuFolder)
    /// A new folder (inside `parent`, or at the top level).
    case newFolder(parent: MenuFolder?)
    case move(MenuFolder)
    case delete(MenuFolder, subfolders: Int)
    /// Turning Always fully encrypted on (`locked` false now) or off.
    case lock(MenuFolder, locked: Bool, level: String)

    public var id: String {
        switch self {
        case .rename(let f): "rename:\(f.id)"
        case .newFolder(let p): "new:\(p?.id ?? "top")"
        case .move(let f): "move:\(f.id)"
        case .delete(let f, _): "delete:\(f.id)"
        case .lock(let f, _, _): "lock:\(f.id)"
        }
    }
}

@MainActor
@Observable
public final class FolderDialogState {
    public var dialog: FolderDialog?
    public var text = ""
    public init() {}

    public func open(_ d: FolderDialog) {
        if case .rename(let f) = d { text = f.name } else { text = "" }
        dialog = d
    }
}

/// The items of a folder's menu, for `.contextMenu { }` and `Menu { }`.
public struct FolderMenuItems: View {
    let folder: MenuFolder
    let context: FolderMenuContext
    let actions: NoteActions
    let dialogs: FolderDialogState
    @Environment(\.screenNavigator) private var navigator
    @Environment(\.screenFeedback) private var feedback

    public init(folder: MenuFolder, context: FolderMenuContext, actions: NoteActions, dialogs: FolderDialogState) {
        self.folder = folder
        self.context = context
        self.actions = actions
        self.dialogs = dialogs
    }

    public var body: some View {
        let groups = FolderMenuItem.groups(for: folder, in: context)
        ForEach(Array(groups.enumerated()), id: \.offset) { index, group in
            if index > 0 { Divider() }
            ForEach(group, id: \.self) { item in
                if item == .lock {
                    Toggle(isOn: Binding(get: { context.isLocked(folder.id) }, set: { _ in
                        dialogs.open(.lock(folder, locked: context.isLocked(folder.id), level: context.level))
                    })) {
                        Label(item.title, systemImage: item.symbol)
                    }
                } else if item == .color {
                    Menu {
                        ForEach(FoleviTokens.folderColors) { c in
                            Button {
                                Task { await actions.setFolderColor(folder.id, c.id == FolderColor.defaultId ? nil : c.id) }
                            } label: {
                                Label(c.name, systemImage: FolderColor.resolve(folder.color).id == c.id ? "checkmark" : "circle.fill")
                            }
                        }
                    } label: {
                        Label(item.title, systemImage: item.symbol)
                    }
                } else {
                    Button(role: item == .delete ? .destructive : nil) { run(item) } label: {
                        Label(item.title, systemImage: item.symbol)
                    }
                }
            }
        }
    }

    private func run(_ item: FolderMenuItem) {
        switch item {
        case .newNote:
            Task {
                if let id = await actions.create(folderId: folder.id) { navigator.open(.note(id: id), nil) }
            }
        case .newFolderInside: dialogs.open(.newFolder(parent: folder))
        case .rename: dialogs.open(.rename(folder))
        case .color, .lock: break
        case .move: dialogs.open(.move(folder))
        case .movePlaces: navigator.open(.movePlaces(folders: [folder.id], notes: []), nil)
        case .moveToTop:
            Task { await actions.moveFolder(folder.id, to: FolderRules.Place(parentId: nil, afterId: context.links.filter { $0.parentId == nil }.last?.id), message: "Moved to the top level") }
        case .askAI: navigator.open(.foliAI(about: .folder(id: folder.id, name: folder.name)), nil)
        case .copyLink:
            feedback.copy(FoleviLinks.folder(folder.id))
            feedback.toast(ScreenToast("Link copied", tone: .success))
        case .invite:
            if let space = context.inviteSpace { navigator.open(.invite(space: space), nil) }
        case .delete: dialogs.open(.delete(folder, subfolders: context.subfolderCount(folder.id)))
        }
    }
}

/// Where a folder can move: the top level and every folder the rules allow, as an indented list.
struct MoveFolderSheet: View {
    let folder: MenuFolder
    let tree: [FolderNode]
    let onPick: (FolderRules.Place, String) -> Void
    let onCancel: () -> Void

    var body: some View {
        let links = FolderRules.links(tree)
        NavigationStack {
            List {
                Button { onPick(FolderRules.Place(parentId: nil, afterId: links.filter { $0.parentId == nil && $0.id != folder.id }.last?.id), "the top level") } label: {
                    Label("Top level", systemImage: "house")
                }
                .disabled(folder.parentId == nil)
                ForEach(tree, id: \.id) { node in
                    let problem = FolderRules.moveProblem(links, id: folder.id, into: node.id)
                    Button {
                        onPick(FolderRules.Place(parentId: node.id, afterId: links.filter { $0.parentId == node.id && $0.id != folder.id }.last?.id), node.name)
                    } label: {
                        HStack(spacing: 10) {
                            FolderGlyph(colorId: node.color, size: 20)
                            Text(node.name).foleviFont(.body).foregroundStyle(Folevi.color.ink)
                        }
                        .padding(.leading, CGFloat(node.depth) * 18)
                    }
                    .disabled(problem != nil || node.id == folder.parentId)
                    .accessibilityHint(problem.map { FolderRules.message($0) } ?? "")
                }
            }
            .navigationTitle("Move “\(folder.name)”")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel", action: onCancel) }
            }
        }
        .frame(minWidth: 360, minHeight: 420)
    }
}

public extension View {
    /// The folder menu's dialogs: name prompts, the move sheet and the delete alert.
    func folderDialogs(_ state: FolderDialogState, actions: NoteActions, tree: [FolderNode]) -> some View {
        modifier(FolderDialogsModifier(state: state, actions: actions, tree: tree))
    }
}

struct FolderDialogsModifier: ViewModifier {
    @Bindable var state: FolderDialogState
    let actions: NoteActions
    let tree: [FolderNode]
    @Environment(\.screenNavigator) private var navigator

    private func shown(_ match: @escaping (FolderDialog) -> Bool) -> Binding<Bool> {
        Binding { state.dialog.map(match) ?? false } set: { if !$0 { state.dialog = nil } }
    }

    private var moveFolder: Binding<MenuFolder?> {
        Binding {
            if case .move(let f) = state.dialog { return f }
            return nil
        } set: { if $0 == nil { state.dialog = nil } }
    }

    private var newFolder: Binding<NewFolderRequest?> {
        Binding {
            if case .newFolder(let parent) = state.dialog { return NewFolderRequest(parent: parent) }
            return nil
        } set: { if $0 == nil { state.dialog = nil } }
    }

    func body(content: Content) -> some View {
        content
            .alert("Rename folder", isPresented: shown { if case .rename = $0 { true } else { false } }) {
                TextField("Folder name", text: $state.text)
                Button("Cancel", role: .cancel) { state.dialog = nil }
                Button("Rename") {
                    if case .rename(let f) = state.dialog { let name = state.text; Task { await actions.renameFolder(f.id, to: name) } }
                    state.dialog = nil
                }
            }
            .alert(deleteTitle, isPresented: shown { if case .delete = $0 { true } else { false } }) {
                Button("Cancel", role: .cancel) { state.dialog = nil }
                Button("Delete folder", role: .destructive) {
                    if case .delete(let f, _) = state.dialog { Task { await actions.deleteFolder(f.id) } }
                    state.dialog = nil
                }
            } message: {
                Text(deleteMessage)
            }
            .alert(lockText.title, isPresented: shown { if case .lock = $0 { true } else { false } }) {
                Button("Cancel", role: .cancel) { state.dialog = nil }
                Button(lockText.button, role: lockText.destructive ? .destructive : nil) {
                    if case .lock(let f, let locked, _) = state.dialog { Task { await actions.lockFolder(f.id, name: f.name, locked: !locked) } }
                    state.dialog = nil
                }
            } message: {
                Text(lockText.message)
            }
            .sheet(item: moveFolder) { folder in
                MoveFolderSheet(folder: folder, tree: tree) { place, name in
                    state.dialog = nil
                    Task { await actions.moveFolder(folder.id, to: place, message: "Moved to \(name)") }
                } onCancel: {
                    state.dialog = nil
                }
            }
            .sheet(item: newFolder) { request in
                NewFolderSheet(parent: request.parent, tree: tree) { name, color, parentId in
                    state.dialog = nil
                    Task {
                        if let id = await actions.createFolder(name: name, parentId: parentId, color: color) {
                            // Create opens it (web NewFolderSheet).
                            navigator.open(.folder(id: id), nil)
                        }
                    }
                } onCancel: {
                    state.dialog = nil
                }
            }
    }

    private var deleteTitle: String {
        if case .delete(let f, _) = state.dialog { return "Delete “\(f.name)”?" }
        return ""
    }

    private var deleteMessage: String {
        guard case .delete(_, let subfolders) = state.dialog else { return "" }
        if subfolders > 0 {
            return "The folder is removed. Its documents are kept and move to Drafts. Its \(subfolders == 1 ? "subfolder moves" : "subfolders move") up a level, with everything inside."
        }
        return "The folder is removed. Its documents are kept and move to Drafts."
    }

    /// The web's LockDialog wording (lib/e2ee/copy.ts `lock`).
    private var lockText: (title: String, message: String, button: String, destructive: Bool) {
        guard case .lock(let f, let locked, let level) = state.dialog else { return ("", "", "", false) }
        if locked {
            let standard = level == "standard"
            return ("Stop encrypting \(f.name)?", standard ? "Its notes will be readable by Folevi again." : "Its notes stay encrypted. Features you've turned on for this space can use them again.", "Stop encrypting", standard)
        }
        return ("Always fully encrypt \(f.name)?", "Its notes are encrypted on your devices and never shared in a readable form, even with features you've turned on for this space. Foli AI, search on our servers and apps can't use them.", "Encrypt", false)
    }
}

struct NewFolderRequest: Identifiable {
    let parent: MenuFolder?
    var id: String { parent?.id ?? "top" }
}
