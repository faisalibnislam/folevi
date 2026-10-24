// The frame's native menus:
// - the account and place menu at the sidebar's foot (the web's WorkspaceMenu.tsx, Slack/Notion style): places
//   first (each account with its workspaces under it, the library "On this Mac"), then Settings, Sign in to
//   another account, Move or copy notes, Help, then Sign out;
// - the note's "..." menu (plan 4.3): star, move, copy to, duplicate, export, version history, present, print,
//   find, archive, delete. Star, archive and delete are engine commands; the rest open the note page's own
//   dialogs and panels (`note.menu`).
#if os(macOS)
import AppKit
import FoleviEngine

@MainActor
public enum AccountMenu {
    public static func build(model: FrameModel) -> NSMenu {
        let menu = NSMenu()
        menu.autoenablesItems = false
        let session = model.session.value
        let places = model.places.value
        let current = places?.current ?? session?.place
        let rows = places?.places ?? []
        if !rows.isEmpty {
            menu.addItem(NSMenuItem.sectionHeader(title: "Places"))
            for p in rows.filter({ $0.kind == .account }) {
                let isHere = p.id == current
                let item = ClosureMenuItem(title: p.name.isEmpty ? (p.email ?? "Folevi account") : p.name) { [weak model] in
                    guard let model, !isHere else { return }
                    model.host?.frameSwitchPlace(p.id, space: nil)
                }
                item.subtitle = p.name.isEmpty ? nil : p.email
                item.image = avatar(p.name.isEmpty ? (p.email ?? "F") : p.name)
                item.state = isHere && session?.space == "personal" ? .on : .off
                if p.unread > 0, !isHere { item.badge = NSMenuItemBadge(count: p.unread) }
                item.setAccessibilityIdentifier("account.place.\(p.id)")
                menu.addItem(item)
                // Its workspaces: in the open account they switch the space; elsewhere they open that place there.
                let workspaces: [(id: String, name: String)] = isHere ? (session?.spaces ?? []).filter { $0.kind == .workspace }.map { ($0.id, $0.name) } : p.workspaces.map { ($0.id, $0.name) }
                for w in workspaces {
                    let sub = ClosureMenuItem(title: w.name) { [weak model] in
                        guard let model else { return }
                        if isHere { model.switchSpace(w.id) } else { model.host?.frameSwitchPlace(p.id, space: w.id) }
                    }
                    sub.indentationLevel = 1
                    sub.image = NSImage(systemSymbolName: "person.3", accessibilityDescription: nil)
                    sub.state = isHere && session?.space == w.id ? .on : .off
                    menu.addItem(sub)
                }
            }
            if let lib = rows.first(where: { $0.kind == .library }) {
                let isHere = lib.id == current
                let item = ClosureMenuItem(title: "On this Mac") { [weak model] in
                    guard let model, !isHere else { return }
                    model.host?.frameSwitchPlace(lib.id, space: nil)
                }
                item.subtitle = lib.syncs
                item.image = NSImage(systemSymbolName: "internaldrive", accessibilityDescription: nil)
                item.state = isHere ? .on : .off
                item.setAccessibilityIdentifier("account.place.library")
                menu.addItem(item)
            }
            menu.addItem(.separator())
        }
        let settings = ClosureMenuItem(title: "Settings…", keyEquivalent: ",") { [weak model] in model?.host?.frameOpenSettings(section: nil) }
        settings.image = NSImage(systemSymbolName: "gearshape", accessibilityDescription: nil)
        menu.addItem(settings)
        let signIn = ClosureMenuItem(title: "Sign in to another account…") { [weak model] in model?.host?.frameSignInAnotherAccount() }
        signIn.image = NSImage(systemSymbolName: "person.badge.plus", accessibilityDescription: nil)
        menu.addItem(signIn)
        if rows.contains(where: { $0.id != current }) {
            let move = ClosureMenuItem(title: "Move or copy notes…") { [weak model] in model?.host?.frameMoveOrCopy() }
            move.image = NSImage(systemSymbolName: "arrow.left.arrow.right", accessibilityDescription: nil)
            menu.addItem(move)
        }
        let help = ClosureMenuItem(title: "Help") { [weak model] in model?.host?.frameOpenHelp() }
        help.image = NSImage(systemSymbolName: "questionmark.circle", accessibilityDescription: nil)
        menu.addItem(help)
        if session?.mode == .account, let place = current {
            menu.addItem(.separator())
            let name = model.accountName.isEmpty ? "this account" : model.accountName
            let out = ClosureMenuItem(title: "Sign out of \(name)…") { [weak model] in model?.host?.frameSignOut(place: place) }
            out.image = NSImage(systemSymbolName: "rectangle.portrait.and.arrow.right", accessibilityDescription: nil)
            out.setAccessibilityIdentifier("account.signOut")
            menu.addItem(out)
        }
        return menu
    }

    /// A 20 pt rounded square with the initial (avatars are 6-radius squares, decision D3's family).
    static func avatar(_ name: String) -> NSImage {
        let letter = String(name.first.map(String.init) ?? "F").uppercased()
        let image = NSImage(size: NSSize(width: 20, height: 20), flipped: false) { rect in
            NSColor(srgbRed: 0.24, green: 0.24, blue: 0.27, alpha: 1).setFill()
            NSBezierPath(roundedRect: rect, xRadius: 5, yRadius: 5).fill()
            let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 10.5, weight: .semibold), .foregroundColor: NSColor.white]
            let s = (letter as NSString).size(withAttributes: attrs)
            (letter as NSString).draw(at: NSPoint(x: rect.midX - s.width / 2, y: rect.midY - s.height / 2), withAttributes: attrs)
            return true
        }
        return image
    }
}

@MainActor
public enum NoteMenu {
    /// The "..." menu for the note on screen.
    public static func build(model: FrameModel) -> NSMenu {
        let menu = NSMenu()
        guard let id = model.route.noteId else { return menu }
        let meta = model.noteMeta[id]
        let starred = meta?.starred ?? false
        let canEdit = meta?.canEdit ?? true
        func add(_ title: String, _ symbol: String, enabled: Bool = true, _ run: @escaping @MainActor () -> Void) {
            let item = ClosureMenuItem(title: title, run: run)
            item.image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)
            item.isEnabled = enabled
            menu.addItem(item)
        }
        menu.autoenablesItems = false
        add(starred ? "Unstar" : "Star", starred ? "star.slash" : "star") { model.star([id], !starred) }
        add("Move to…", "folder", enabled: canEdit) { model.noteMenu(.move) }
        add("Copy to…", "doc.on.doc") { model.noteMenu(.copyTo) }
        add("Duplicate", "plus.square.on.square") { model.noteMenu(.duplicate) }
        menu.addItem(.separator())
        add("Export…", "square.and.arrow.down") { model.noteMenu(.export) }
        add("Version History…", "clock.arrow.circlepath") { model.noteMenu(.history) }
        add("Present", "play.rectangle") { model.noteMenu(.present) }
        add("Print…", "printer") { model.noteMenu(.print) }
        add("Find in Note…", "magnifyingglass") { model.noteMenu(.find) }
        menu.addItem(.separator())
        add("Open in New Window", "macwindow.badge.plus") { model.host?.frameOpenInNewWindow(.note(id)) }
        menu.addItem(.separator())
        let archived = meta?.archived ?? false
        add(archived ? "Unarchive" : "Archive", "archivebox", enabled: canEdit) { model.archive([id], !archived) }
        add("Move to Trash", "trash", enabled: canEdit) { model.trash([id]) }
        return menu
    }
}
#endif
