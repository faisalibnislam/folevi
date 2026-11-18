// The frame's native menus:
// - the account and place menu at the sidebar's foot (the web's WorkspaceMenu.tsx, Slack/Notion style), built
//   from AccountMenuRows (WebAccountMenu.swift): places first (each account with its workspaces under it, the
//   library "On this Mac"), then Settings, Sign in to another account, Move or copy notes, Help, then Sign out;
// - the note's "..." menu (plan 4.3): star, move, copy to, duplicate, export, version history, present, print,
//   find, archive, delete. Star, archive and delete are engine commands; the rest open the note page's own
//   dialogs and panels (`note.menu`).
#if os(macOS)
import AppKit
import FoleviDesign
import FoleviEngine

@MainActor
public enum AccountMenu {
    /// The account menu's rows (AccountMenuRows, the web's WorkspaceMenu) as a system menu.
    public static func build(model: FrameModel) -> NSMenu {
        build(AccountMenuRows.build(model: model))
    }

    static func build(_ rows: [AccountMenuRow]) -> NSMenu {
        let menu = NSMenu()
        menu.autoenablesItems = false
        for row in rows {
            switch row.kind {
            case .heading:
                menu.addItem(NSMenuItem.sectionHeader(title: row.title))
            case .separator:
                if menu.numberOfItems > 0, menu.items.last?.isSeparatorItem == false { menu.addItem(.separator()) }
            case .place, .sub, .item:
                let item = MenuActionItem(title: row.title, keyEquivalent: row.shortcut == "\u{2318}," ? "," : "", run: row.action)
                item.identifier = NSUserInterfaceItemIdentifier(row.id)
                item.setAccessibilityIdentifier("account.\(row.id)")
                item.isEnabled = !row.disabled
                if row.kind != .item { item.state = row.checked ? .on : .off }
                if row.kind == .sub { item.indentationLevel = 1 }
                if let d = row.detail, !d.isEmpty {
                    // A place's email or where the library syncs under its name; a workspace's plan after it.
                    if row.kind == .sub { item.badge = NSMenuItemBadge(string: d) } else { item.subtitle = d }
                }
                if row.badge > 0 {
                    item.badge = NSMenuItemBadge(count: row.badge)
                } else if row.dot {
                    item.badge = NSMenuItemBadge(string: "\u{2022}")
                }
                image(row.mark, for: item)
                menu.addItem(item)
            }
        }
        NativeMenu.comfortable(menu)
        return menu
    }

    /// A row's mark as the item's image: an SF Symbol, the library's laptop, or a person's or workspace's picture
    /// (its initial until the picture arrives).
    private static func image(_ mark: AccountMenuRow.Mark, for item: NSMenuItem) {
        switch mark {
        case .none: break
        case .icon(let icon): item.image = icon.nsImage(size: NativeMenu.iconSize, strokeWidth: 1.75)
        case .plus: item.image = NSImage(systemSymbolName: "plus", accessibilityDescription: nil)
        case .library: item.image = NSImage(systemSymbolName: "laptopcomputer", accessibilityDescription: nil)
        case .avatar(let name, let url, let size):
            let side: CGFloat = size > 24 ? 24 : 16
            item.image = avatar(name, size: side)
            if let url, let u = URL(string: url), u.scheme == "https" {
                Task { @MainActor [weak item] in
                    guard let (data, _) = try? await URLSession.shared.data(from: u), let picture = NSImage(data: data) else { return }
                    item?.image = rounded(picture, size: side)
                }
            }
        }
    }

    /// A rounded square with the initial in the accent's ink on the accent (avatars are rounded squares, decision
    /// D3's family; Folevi's black and white).
    static func avatar(_ name: String, size: CGFloat = 20) -> NSImage {
        let letter = String(name.trimmingCharacters(in: .whitespaces).first.map(String.init) ?? "F").uppercased()
        let image = NSImage(size: NSSize(width: size, height: size), flipped: false) { rect in
            MacLook.accent.setFill()
            NSBezierPath(roundedRect: rect, xRadius: size * 0.25, yRadius: size * 0.25).fill()
            let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: (size * 0.5).rounded(), weight: .semibold), .foregroundColor: MacLook.onAccent]
            let s = (letter as NSString).size(withAttributes: attrs)
            (letter as NSString).draw(at: NSPoint(x: rect.midX - s.width / 2, y: rect.midY - s.height / 2), withAttributes: attrs)
            return true
        }
        return image
    }

    /// A picture cut to the avatar's rounded square.
    private static func rounded(_ picture: NSImage, size: CGFloat) -> NSImage {
        NSImage(size: NSSize(width: size, height: size), flipped: false) { rect in
            NSBezierPath(roundedRect: rect, xRadius: size * 0.25, yRadius: size * 0.25).addClip()
            let p = picture.size
            let scale = max(rect.width / max(p.width, 1), rect.height / max(p.height, 1))
            let w = p.width * scale, h = p.height * scale
            picture.draw(in: NSRect(x: rect.midX - w / 2, y: rect.midY - h / 2, width: w, height: h))
            return true
        }
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
            item.image = FoleviGlyph.nsImage(symbol)
            item.isEnabled = enabled
            menu.addItem(item)
        }
        menu.autoenablesItems = false
        add(starred ? "Remove bookmark" : "Bookmark", starred ? FoleviGlyph.name(.bookmarkOff) : FoleviGlyph.name(.bookmark)) { model.star([id], !starred) }
        add("Move to…", "folder", enabled: canEdit) { model.noteMenu(.move) }
        add("Copy to…", "doc.on.doc") { model.noteMenu(.copyTo) }
        add("Duplicate", "plus.square.on.square") { model.noteMenu(.duplicate) }
        menu.addItem(.separator())
        add("Export…", "square.and.arrow.down") { model.noteMenu(.export) }
        add("Version History…", "clock.arrow.circlepath") { model.noteMenu(.history) }
        add("Present", "play.rectangle") { model.noteMenu(.present) }
        add("Print…", "printer") { model.noteMenu(.print) }
        add("Find in Note…", "magnifyingglass") { model.noteMenu(.find) }
        if model.session.value?.capabilities.graph == true { add("Foli DNA of This Note", "point.3.connected.trianglepath.dotted") { model.open(.web("/graph?note=\(id)")) } }
        menu.addItem(.separator())
        add("Open in New Window", "macwindow.badge.plus") { model.host?.frameOpenInNewWindow(.note(id)) }
        menu.addItem(.separator())
        let archived = meta?.archived ?? false
        add(archived ? "Unarchive" : "Archive", "archivebox", enabled: canEdit) { model.archive([id], !archived) }
        add("Move to Trash", "trash", enabled: canEdit) { model.trash([id]) }
        NativeMenu.comfortable(menu)
        return menu
    }
}
#endif
