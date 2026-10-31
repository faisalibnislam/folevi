// A folder's menu, one for every place that offers it (the sidebar's rows, folder cards, the Folders page), as the
// web's app/FolderMenu.tsx builds it: New note in folder and New folder inside…; then Rename…, Change color…,
// Move folder…, Move to another place…, Move to top level, Ask Foli AI about this folder…, Always fully
// encrypted, Share…, Copy link and Invite people…; then Delete folder…. Its dialogs are the web's (Dialog,
// PromptDialog, FolderColorDialog, MoveFolderDialog, LockDialog) drawn by the frame, never the system's alerts.
#if os(macOS) || os(iOS)
#if os(macOS)
import AppKit
#else
import UIKit
#endif
import SwiftUI
import FoleviDesign
import FoleviEngine
import FoleviScreens

@MainActor
enum WebFolderMenu {
    /// The rows for `folder`. `context` says what this person may do here (FolderMenuContext).
    static func entries(_ folder: MenuFolder, context: FolderMenuContext, frame: FrameModel) -> [WebMenuEntry] {
        var out: [WebMenuEntry] = []
        let node = frame.folders.value?.folders.first { $0.id == folder.id }
        if context.canEdit {
            out.append(WebMenuEntry(.item("New note in folder", icon: .filePlusCorner)) { frame.newNote(in: folder.id) })
            if FolderRules.canNest(context.links, in: folder.id) || !context.links.contains(where: { $0.id == folder.id }) {
                out.append(WebMenuEntry(.item("New folder inside…", icon: .folderPlus)) { if let node { FrameDialogs.newFolder(frame, parent: node) } })
            }
            out.append(.separator(1))
            out.append(WebMenuEntry(.item("Rename…", icon: .pencilLine)) { if let node { FrameDialogs.renameFolder(frame, node) } })
            out.append(WebMenuEntry(.item("Change color…", icon: .palette)) { if let node { FrameDialogs.folderColor(frame, node) } })
            out.append(WebMenuEntry(.item("Move folder…", icon: .folderInput)) { if let node { FrameDialogs.moveFolder(frame, node) } })
            if context.otherPlaces {
                out.append(WebMenuEntry(.item("Move to another place…", icon: .arrowRightLeft)) { frame.host?.frameMoveOrCopy() })
            }
            if folder.parentId != nil {
                out.append(WebMenuEntry(.item("Move to top level", icon: .undo2)) {
                    frame.perform {
                        _ = try await frame.client.command(.folderMove(id: folder.id, parentId: nil))
                        frame.toast("Moved to the top level", tone: .success)
                    }
                })
            }
        }
        if context.aiOn {
            out.append(WebMenuEntry(.ai("Ask Foli AI about this folder…")) { frame.askAI(aboutFolder: folder.id, name: folder.name) })
        }
        if context.canLock {
            let locked = context.isLocked(folder.id)
            out.append(WebMenuEntry(.item("Always fully encrypted", icon: .lockKeyhole, checked: locked)) {
                FrameDialogs.lockFolder(frame, folder, locked: locked, level: context.level)
            })
        }
        if frame.session.value?.capabilities.sharing ?? false {
            out.append(WebMenuEntry(.item("Share…", icon: .share2)) { FrameDialogs.folderShare(frame, folderId: folder.id, name: folder.name) })
        }
        out.append(WebMenuEntry(.item("Copy link", icon: .link2)) {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(FoleviLinks.folder(folder.id), forType: .string)
            frame.toast("Link copied")
        })
        if context.inviteSpace != nil {
            out.append(WebMenuEntry(.item("Invite people…", icon: .userPlus)) { frame.host?.frameOpenSettings(section: "members") })
        }
        if context.canEdit {
            out.append(.separator(2))
            out.append(WebMenuEntry(.item("Delete folder…", icon: .trash, danger: true)) {
                FrameDialogs.deleteFolder(frame, folder, subfolders: context.subfolderCount(folder.id))
            })
        }
        return out
    }

    /// What the menu may offer, from what the frame watches (the sidebar, which has no screen model of its own).
    static func context(_ frame: FrameModel, locks: FolderLocksValue?) -> FolderMenuContext {
        FolderMenuContext(session: frame.session.value, places: frame.places.value, links: FolderRules.links(frame.folders.value?.folders ?? []), locks: locks)
    }
}

extension FrameDialogs {
    /// A confirmation (ui/Dialog.tsx with a footer): the title, what will happen, Cancel and the action.
    static func confirm(_ frame: FrameModel, title: String, description: String, action: String, danger: Bool, run: @escaping @MainActor () -> Void) {
        FrameSheets.present(frame) { close in
            WebSheetDialog(title: title, description: description, close: close) {
                EmptyView()
            } footer: {
                WebSheetFooter {
                    WebSheetButton(title: "Cancel", action: close)
                    WebSheetButton(title: action, primary: !danger, danger: danger) {
                        close()
                        run()
                    }
                }
            }
        }
    }

    /// Delete folder… (FolderMenu.tsx's Dialog): its notes go to Drafts, its subfolders up a level.
    static func deleteFolder(_ frame: FrameModel, _ folder: MenuFolder, subfolders: Int) {
        let description = subfolders > 0
            ? "The folder is removed. Its documents are kept and move to Drafts. Its \(subfolders == 1 ? "subfolder moves" : "subfolders move") up a level, with everything inside."
            : "The folder is removed. Its documents are kept and move to Drafts."
        confirm(frame, title: "Delete \u{201C}\(folder.name)\u{201D}?", description: description, action: "Delete folder", danger: true) {
            frame.perform {
                _ = try await frame.client.command(.folderDelete(id: folder.id))
                frame.toast("Folder deleted", tone: .success)
            }
        }
    }

    /// Always fully encrypted (e2ee/LockDialog.tsx): turning it on, or off.
    static func lockFolder(_ frame: FrameModel, _ folder: MenuFolder, locked: Bool, level: String) {
        let standard = level == "standard"
        let title = locked ? "Stop encrypting \(folder.name)?" : "Always fully encrypt \(folder.name)?"
        let description = locked
            ? (standard ? "Its notes will be readable by Folevi again." : "Its notes stay encrypted. Features you've turned on for this space can use them again.")
            : "Its notes are encrypted on your devices and never shared in a readable form, even with features you've turned on for this space. Foli AI, search on our servers and apps can't use them."
        confirm(frame, title: title, description: description, action: locked ? "Stop encrypting" : "Encrypt", danger: locked && standard) {
            frame.perform {
                _ = try await frame.client.command(.folderLock(id: folder.id, locked: !locked))
                frame.toast(locked ? "\(folder.name) is no longer always fully encrypted" : "\(folder.name) is always fully encrypted", tone: .success)
            }
        }
    }

    /// Delete tag… (Sidebar.tsx TagMenu).
    static func deleteTag(_ frame: FrameModel, id: String, name: String) {
        confirm(frame, title: "Delete #\(name)?", description: "The tag is removed from every document. The documents themselves are not affected.", action: "Delete tag", danger: true) {
            frame.perform {
                _ = try await frame.client.command(.tagDelete(id: id))
                frame.toast("Deleted #\(name)", tone: .success)
                if frame.route == .tag(id) { frame.open(.home, .replace) }
            }
        }
    }

    /// Edit tag… (Sidebar.tsx TagMenu): its name and colour.
    static func editTag(_ frame: FrameModel, id: String, name: String, color: String) {
        FrameSheets.present(frame) { close in
            EditTagSheet(frame: frame, id: id, name: name, color: color, close: close)
        }
    }
}

/// A dialog's footer (ui/Dialog.tsx): its buttons at the end, on the sunken surface under a hairline.
struct WebSheetFooter<Content: View>: View {
    @ViewBuilder let content: () -> Content
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        HStack(spacing: 8) {
            Spacer(minLength: 0)
            content()
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity)
        .background(moreVar("color-surface-sunken", scheme).opacity(0.6))
        .overlay(alignment: .top) { Rectangle().fill(moreVar("color-line", scheme)).frame(height: 1) }
    }
}

/// Edit tag (Sidebar.tsx): Name (40 at most), Color as six chips, Cancel and Save.
struct EditTagSheet: View {
    let frame: FrameModel
    let id: String
    @State var name: String
    @State var color: String
    let close: @MainActor () -> Void
    @State private var problem: String?
    @FocusState private var focused: Bool
    @Environment(\.colorScheme) private var scheme

    init(frame: FrameModel, id: String, name: String, color: String, close: @escaping @MainActor () -> Void) {
        self.frame = frame
        self.id = id
        _name = State(initialValue: name)
        _color = State(initialValue: color)
        self.close = close
    }

    var body: some View {
        let input = focused ? webFocused(WebStyles.named("more.prompt.input")) : WebStyles.named("more.prompt.input")
        let i = input.resolve(scheme)
        let label = WebTextStyle.role(.subheadline).weight(500)
        WebSheetDialog(title: "Edit tag", close: close) {
            VStack(alignment: .leading, spacing: 0) {
                Text("Name").webText(label).foregroundStyle(moreVar("color-ink", scheme))
                TextField("", text: $name)
                    .textFieldStyle(.plain)
                    .webText(.role(.callout))
                    .focused($focused)
                    .onSubmit(save)
                    .onChange(of: name) { _, v in
                        problem = nil
                        if v.count > 40 { name = String(v.prefix(40)) }
                    }
                    .padding(.horizontal, 12)
                    .frame(height: 40)
                    .foregroundStyle(i.color.color)
                    .webBox(input)
                    .padding(.top, 8)
                    .accessibilityLabel("Name")
                Text("Color").webText(label).foregroundStyle(moreVar("color-ink", scheme)).padding(.top, 16)
                WebFlow(spacing: 8) {
                    ForEach(WebSidebar.tagColors, id: \.id) { c in
                        Button { color = c.id } label: {
                            HStack(spacing: 6) {
                                RoundedRectangle(cornerRadius: 6, style: .circular).fill(WebSidebar.tagColor(c.id)).frame(width: 12, height: 12)
                                Text(c.label).webText(.role(.subheadline)).foregroundStyle(moreVar("color-ink", scheme))
                            }
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(RoundedRectangle(cornerRadius: 6, style: .circular).fill(color == c.id ? moreVar("color-accent-soft", scheme) : .clear))
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(color == c.id ? .isSelected : [])
                    }
                }
                .padding(.top, 8)
                if let problem {
                    Text(problem).webText(.role(.subheadline)).foregroundStyle(moreVar("color-danger", scheme)).padding(.top, 12)
                }
                HStack(spacing: 8) {
                    Spacer(minLength: 0)
                    WebSheetButton(title: "Cancel", action: close)
                    WebSheetButton(title: "Save", primary: true, action: save)
                }
                .padding(.top, 20)
            }
        }
        .task {
            try? await Task.sleep(for: .milliseconds(60))
            focused = true
        }
    }

    private func save() {
        let n = name.trimmingCharacters(in: .whitespacesAndNewlines)
        Task { @MainActor in
            do {
                _ = try await frame.client.command(.tagUpdate(id: id, name: n, color: color))
                close()
                frame.toast("Tag updated", tone: .success)
            } catch {
                problem = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            }
        }
    }
}
#endif
