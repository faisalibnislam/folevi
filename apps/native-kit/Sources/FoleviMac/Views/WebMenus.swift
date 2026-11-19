// Folevi's menus. On the Mac they are the system's (owner decision 2026-11-18, docs/MAC_NATIVE_LOOK.md): every
// menu Folevi builds as rows (WebMenuEntry) opens as an NSMenu, from a button (a pull-down under or over it), as a
// select's pop-up (the chosen option over its trigger) or as a right click's context menu, with the system's
// keyboard, type-to-select, placement and fade. On the iPad they are still drawn as the web's (ui/Menu.tsx): a
// WebMenuPanel in a layer over the window, until the owner decides there.
#if os(macOS) || os(iOS)
#if os(macOS)
import AppKit
#else
import UIKit
#endif
import SwiftUI
import FoleviDesign

/// Which button's menu is open, so that button keeps its open look while the menu is up (MAC-43). Set by
/// WebMenuWindow; observed by WebMenuButton and RowMoreButton.
@MainActor @Observable
final class WebMenuTrigger {
    static let shared = WebMenuTrigger()
    var open: ObjectIdentifier?
}

/// What a menu row does when picked.
public struct WebMenuEntry: Identifiable {
    public var item: WebMenuItem
    public var action: @MainActor () -> Void
    public var disabled: Bool
    public var id: String { item.id }

    public init(_ item: WebMenuItem, disabled: Bool = false, action: @escaping @MainActor () -> Void = {}) {
        self.item = item
        self.disabled = disabled
        self.action = action
    }

    public static func separator(_ n: Int = 0) -> WebMenuEntry { WebMenuEntry(.separator(n)) }
    public static func heading(_ t: String) -> WebMenuEntry { WebMenuEntry(.heading(t)) }
}

@MainActor
@Observable
final class WebMenuState {
    var highlighted: String?
    /// What's behind the panel, blurred and saturated (the web's backdrop-filter on Mac menus), once placed.
    var backdrop: NSImage?
    let entries: [WebMenuEntry]
    init(_ entries: [WebMenuEntry]) { self.entries = entries }

    var selectable: [WebMenuEntry] { entries.filter { $0.item.kind == .item && !$0.disabled } }

    /// The rows as the panel draws them: a disabled entry's row is drawn disabled (faded, no hover, no click: MAC-01).
    var panelItems: [WebMenuItem] { entries.map { $0.item.disabled($0.disabled || $0.item.disabled) } }

    func move(_ step: Int) {
        let list = selectable
        guard !list.isEmpty else { return }
        let i = list.firstIndex { $0.id == highlighted }.map { ($0 + step + list.count) % list.count } ?? (step > 0 ? 0 : list.count - 1)
        highlighted = list[i].id
    }
}

#if os(iOS)
struct WebMenuContent: View {
    @Bindable var state: WebMenuState
    let width: CGFloat
    var select = false
    let pick: (WebMenuEntry) -> Void

    var body: some View {
        WebMenuPanel(state.panelItems, width: width, highlighted: state.highlighted, select: select, onSelect: { item in
            if let e = state.entries.first(where: { $0.id == item.id }), !e.disabled { pick(e) }
        }, onHover: { state.highlighted = $0 })
        .background {
            if let image = state.backdrop {
                Image(platformImage: image).resizable().clipShape(RoundedRectangle(cornerRadius: WebStyles.named("menu.panel").light.radius, style: .circular))
            }
        }
        .onContinuousHover { phase in
            if case .ended = phase { state.highlighted = nil }
        }
    }
}

#endif

/// The web's icons (lucide) as the closest SF Symbols: the Mac's system menus carry them, and MacSymbol reads the
/// table backwards (on the Mac and the iPad alike).
enum WebIconSymbols {
    static let table: [WebIcon: String] = [
        .activity: "waveform.path.ecg", .appWindow: "macwindow", .appWindowMac: "macwindow", .archive: "archivebox",
        .archiveRestore: "tray.and.arrow.up", .arrowDown: "arrow.down", .arrowUp: "arrow.up", .arrowLeft: "arrow.left",
        .arrowRight: "arrow.right", .arrowLeftToLine: "arrow.left.to.line", .arrowRightToLine: "arrow.right.to.line",
        .arrowRightLeft: "arrow.left.arrow.right", .arrowLeftRight: "arrow.left.arrow.right", .arrowUpRight: "arrow.up.right",
        .arrowDownUp: "arrow.up.arrow.down", .arrowDownWideNarrow: "arrow.up.arrow.down", .arrowUpNarrowWide: "arrow.up.arrow.down",
        .arrowDownToLine: "arrow.down.to.line", .arrowUpToLine: "arrow.up.to.line", .atSign: "at", .ban: "nosign",
        .bell: "bell", .bellOff: "bell.slash", .bellPlus: "bell.badge", .bellMinus: "bell.slash", .bold: "bold",
        .italic: "italic", .underline: "underline", .strikethrough: "strikethrough", .bookOpen: "book",
        .bookmark: "bookmark", .bookmarkOff: "bookmark.slash", .bookmarkPlus: "bookmark", .brain: "brain",
        .briefcase: "briefcase", .calendar: "calendar", .calendarDays: "calendar", .calendarPlus: "calendar.badge.plus",
        .calendarCheck: "calendar.badge.checkmark", .calendarClock: "calendar.badge.clock", .calendarRange: "calendar",
        .camera: "camera", .check: "checkmark", .circleCheck: "checkmark.circle", .circleCheckBig: "checkmark.circle",
        .circleX: "xmark.circle", .circlePlus: "plus.circle", .circleMinus: "minus.circle", .circleAlert: "exclamationmark.circle",
        .circleQuestionMark: "questionmark.circle", .circleDot: "smallcircle.filled.circle", .circle: "circle",
        .chevronDown: "chevron.down", .chevronUp: "chevron.up", .chevronLeft: "chevron.left", .chevronRight: "chevron.right",
        .clipboardCopy: "doc.on.clipboard", .clipboardPaste: "doc.on.clipboard", .clipboardList: "list.clipboard",
        .clock: "clock", .clock3: "clock", .cloud: "cloud", .cloudOff: "icloud.slash", .cloudDownload: "icloud.and.arrow.down",
        .codeXml: "chevron.left.forwardslash.chevron.right", .columns2: "rectangle.split.2x1", .command: "command",
        .copy: "doc.on.doc", .copyPlus: "plus.square.on.square", .crop: "crop", .database: "cylinder",
        .download: "square.and.arrow.down", .upload: "square.and.arrow.up", .ellipsis: "ellipsis", .eraser: "eraser",
        .expand: "arrow.up.left.and.arrow.down.right", .externalLink: "arrow.up.forward.square", .eye: "eye",
        .eyeOff: "eye.slash", .file: "doc", .fileText: "doc.text", .filePlusCorner: "doc.badge.plus", .fileDown: "arrow.down.doc",
        .fileUp: "arrow.up.doc", .fileDiff: "plus.forwardslash.minus", .files: "doc.on.doc", .fileImage: "photo",
        .fileArchive: "doc.zipper", .fileCode: "doc.text", .flag: "flag", .focus: "scope", .folder: "folder",
        .folderPlus: "folder.badge.plus", .folderInput: "folder", .folderOpen: "folder", .folderX: "folder.badge.minus",
        .folderTree: "folder", .folderUp: "folder", .folderLock: "lock", .funnel: "line.3.horizontal.decrease.circle",
        .gitMerge: "arrow.triangle.merge", .globe: "globe", .graduationCap: "graduationcap", .grip: "line.3.horizontal",
        .gripVertical: "line.3.horizontal", .hardDrive: "internaldrive", .hash: "number", .heading1: "textformat.size",
        .heading2: "textformat.size", .heading3: "textformat.size", .heart: "heart", .highlighter: "highlighter",
        .hourglass: "hourglass", .house: "house", .image: "photo", .imagePlus: "photo.badge.plus", .inbox: "tray",
        .info: "info.circle", .kanban: "rectangle.split.3x1", .keyRound: "key", .languages: "character.bubble",
        .laptop: "laptopcomputer", .layers: "square.3.layers.3d", .layoutGrid: "square.grid.2x2", .layoutList: "list.bullet",
        .lifeBuoy: "lifepreserver", .lightbulb: "lightbulb", .link: "link", .link2: "link", .list: "list.bullet",
        .listChecks: "checklist", .listOrdered: "list.number", .listTodo: "checklist", .listPlus: "text.badge.plus",
        .listTree: "list.bullet.indent", .listIndentIncrease: "increase.indent", .listIndentDecrease: "decrease.indent",
        .lock: "lock", .lockKeyhole: "lock", .logIn: "rectangle.portrait.and.arrow.forward", .logOut: "rectangle.portrait.and.arrow.right",
        .mail: "envelope", .mapPin: "mappin", .maximize: "arrow.up.left.and.arrow.down.right",
        .maximize2: "arrow.up.left.and.arrow.down.right", .minimize2: "arrow.down.right.and.arrow.up.left",
        .messageSquare: "message", .messageCircle: "bubble.left", .messagesSquare: "bubble.left.and.bubble.right",
        .mic: "mic", .minus: "minus", .monitor: "display", .monitorPlay: "play.rectangle", .moon: "moon",
        .network: "network", .newspaper: "newspaper", .notebookText: "book.closed", .palette: "paintpalette",
        .panelLeft: "sidebar.left", .paperclip: "paperclip", .pause: "pause", .pencil: "pencil", .pencilLine: "pencil.line",
        .penLine: "pencil.line", .pin: "pin", .pinOff: "pin.slash", .play: "play", .plus: "plus",
        .presentation: "play.rectangle", .printer: "printer", .quote: "quote.opening", .redo2: "arrow.uturn.forward",
        .undo2: "arrow.uturn.backward", .refreshCw: "arrow.clockwise", .rotateCw: "arrow.clockwise",
        .rotateCcw: "arrow.counterclockwise", .rotateCcwClock: "clock.arrow.circlepath", .repeat: "repeat",
        .replace: "arrow.2.squarepath", .scissors: "scissors", .search: "magnifyingglass", .send: "paperplane",
        .settings: "gearshape", .settings2: "gearshape.2", .share: "square.and.arrow.up", .share2: "square.and.arrow.up",
        .shield: "shield", .shieldCheck: "checkmark.shield", .shuffle: "shuffle", .slidersHorizontal: "slider.horizontal.3",
        .smartphone: "iphone", .sparkles: "sparkles", .split: "arrow.triangle.branch", .square: "square",
        .squareCheck: "checkmark.square", .squareCheckBig: "checkmark.square", .squareDashed: "square.dashed",
        .squareDashedText: "character.textbox", .squareSplitHorizontal: "rectangle.split.2x1", .squareStack: "square.stack",
        .stickyNote: "note.text", .sun: "sun.max", .table2: "tablecells", .tag: "tag", .tags: "tag", .target: "scope",
        .textAlignStart: "text.alignleft", .textAlignCenter: "text.aligncenter", .textAlignEnd: "text.alignright",
        .textAlignJustify: "text.justify", .timer: "timer", .trash: "trash", .type: "textformat",
        .userPlus: "person.badge.plus", .userX: "person.badge.minus", .userMinus: "person.badge.minus", .users: "person.2",
        .userRound: "person", .userCheck: "person.badge.shield.checkmark", .wandSparkles: "wand.and.sparkles",
        .waypoints: "point.3.connected.trianglepath.dotted", .wifi: "wifi", .wifiOff: "wifi.slash", .x: "xmark",
        .zoomIn: "plus.magnifyingglass", .zoomOut: "minus.magnifyingglass",
    ]
}

#if os(macOS)
// MARK: - The Mac: system menus

/// A menu item that runs a closure (the action of a WebMenuEntry).
@MainActor
final class MenuActionItem: NSMenuItem {
    private let run: @MainActor () -> Void
    init(title: String, keyEquivalent: String = "", run: @escaping @MainActor () -> Void) {
        self.run = run
        super.init(title: title, action: #selector(fire), keyEquivalent: keyEquivalent)
        target = self
    }

    @available(*, unavailable)
    required init(coder: NSCoder) { fatalError("not from a nib") }

    @objc private func fire() { run() }
}

/// Folevi's menu rows as a system menu: headings are section headers, separators the system's (never two in a row,
/// none at either end), an item keeps its title, symbol, checkmark, subtitle (`description`), trailing note
/// (`detail`, as a badge), whether it's offered, its red when destructive, and its key equivalent where it has one.
@MainActor
public enum NativeMenu {
    public static func build(_ entries: [WebMenuEntry]) -> NSMenu {
        let menu = NSMenu()
        menu.autoenablesItems = false
        var separator = false
        for e in entries {
            switch e.item.kind {
            case .separator:
                if menu.numberOfItems > 0 { separator = true }
            case .heading:
                if separator { menu.addItem(.separator()) }
                separator = false
                let h = NSMenuItem.sectionHeader(title: e.item.title)
                h.identifier = NSUserInterfaceItemIdentifier(e.item.id)
                menu.addItem(h)
            case .item:
                if separator { menu.addItem(.separator()) }
                separator = false
                menu.addItem(item(e))
            }
        }
        comfortable(menu)
        return menu
    }

    // MARK: Comfortable rows (the owner, 2026-11-18: "context menu looks too compressed")

    /// A row's height in every pop-up and context menu: 32 pt, the note's own menu's, not the system's 24.
    public static let rowHeight: CGFloat = 32
    /// What the system adds to a title's line to make its row (measured: a 26 pt line gives a 32 pt row).
    static let rowPadding: CGFloat = 6
    /// A row's icon, in points (the note's menu draws its icons at 16).
    static let iconSize: CGFloat = 16

    /// Makes a system menu comfortable, as the note's own menu is: every row 32 pt tall with its title centred in
    /// it, its icon shown (macOS 27 hides menu pictures unless a row asks for its own), and Folevi's icon for a
    /// row that came without one. Submenus too. Separators, section headers and rows with a view of their own are
    /// left as they are. Safe to run twice.
    public static func comfortable(_ menu: NSMenu) {
        for item in menu.items {
            if let sub = item.submenu { comfortable(sub) }
            guard !item.isSeparatorItem, !item.isSectionHeader, item.view == nil else { continue }
            if item.image == nil, let icon = defaultIcon(for: item.title) {
                item.image = icon.nsImage(size: iconSize, strokeWidth: 1.75)
            }
            if #available(macOS 27.0, *), item.image != nil { item.preferredImageVisibility = .visible }
            item.attributedTitle = roomy(item.attributedTitle ?? NSAttributedString(string: item.title))
        }
    }

    /// A title set on a line as tall as the row less the system's padding, centred in it.
    static func roomy(_ title: NSAttributedString) -> NSAttributedString {
        let out = NSMutableAttributedString(attributedString: title)
        guard out.length > 0 else { return out }
        let font = out.attribute(.font, at: 0, effectiveRange: nil) as? NSFont ?? NSFont.menuFont(ofSize: 0)
        let line = rowHeight - rowPadding
        let paragraph = NSMutableParagraphStyle()
        paragraph.minimumLineHeight = line
        paragraph.maximumLineHeight = line
        paragraph.lineBreakMode = .byTruncatingTail
        // (A taller line puts its extra room above the words: half of it goes back under them.)
        let natural = font.ascender - font.descender + font.leading
        out.addAttributes([.font: font, .paragraphStyle: paragraph, .baselineOffset: ((line - natural) / 2).rounded(.down)], range: NSRange(location: 0, length: out.length))
        return out
    }

    /// Folevi's icon for a row that was built without one (the tab's and the sidebar's menus), by what it says.
    static func defaultIcon(for title: String) -> WebIcon? {
        let key = title.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "… ."))
        return defaultIcons[key]
    }

    static let defaultIcons: [String: WebIcon] = [
        "open": .externalLink, "open in new tab": .appWindow, "open in new window": .appWindowMac,
        "new note": .filePlusCorner, "new note here": .filePlusCorner, "new note in folder": .filePlusCorner,
        "new folder": .folderPlus, "new folder inside": .folderPlus, "rename": .pencil, "duplicate": .copy,
        "close tab": .x, "close other tabs": .x, "close tabs to the right": .arrowRightToLine,
        "pin tab": .pin, "unpin tab": .pinOff, "move to top level": .arrowUpToLine, "delete": .trash,
        "move to trash": .trash, "back": .arrowLeft, "forward": .arrowRight, "reload": .refreshCw,
        "copy link": .link, "search": .search,
    ]

    /// One row as a menu item.
    public static func item(_ e: WebMenuEntry) -> NSMenuItem {
        let w = e.item
        let key = w.shortcut.flatMap(keyEquivalent)
        let item = MenuActionItem(title: w.title, keyEquivalent: key?.key ?? "", run: e.action)
        if let key { item.keyEquivalentModifierMask = key.modifiers }
        item.identifier = NSUserInterfaceItemIdentifier(w.id)
        item.setAccessibilityIdentifier("menu.\(w.id)")
        item.isEnabled = !(e.disabled || w.disabled)
        if w.checkable || w.checked { item.state = w.checked ? .on : .off }
        if let d = w.description, !d.isEmpty { item.subtitle = d }
        if let d = w.detail, !d.isEmpty { item.badge = NSMenuItemBadge(string: d) }
        item.image = image(for: w)
        if w.danger {
            item.attributedTitle = NSAttributedString(string: w.title, attributes: [.foregroundColor: NSColor.systemRed, .font: NSFont.menuFont(ofSize: 0)])
        }
        return item
    }

    /// A row's picture: its colour square, Foli AI's flower, or its icon as an SF Symbol (the web's own drawing
    /// where there's no close symbol), red for a destructive row.
    static func image(for w: WebMenuItem) -> NSImage? {
        if let swatch = w.swatch { return swatchImage(NSColor(swatch)) }
        if w.aiMark { return aiImage }
        guard let icon = w.icon else { return nil }
        // Folevi's own icon, as the note's menu and the rest of the app draw it (the owner, 2026-11-18: the web's
        // icons wherever the web has one), not the nearest SF Symbol.
        let base = icon.nsImage(size: iconSize, strokeWidth: 1.75, label: w.title)
        guard w.danger else { return base }
        if base.isTemplate, let red = base.withSymbolConfiguration(NSImage.SymbolConfiguration(paletteColors: [.systemRed])) { return red }
        return base
    }

    static func symbolImage(_ icon: WebIcon) -> NSImage? {
        guard let name = symbols[icon] else { return nil }
        return NSImage(systemSymbolName: name, accessibilityDescription: nil)
    }

    /// A 12 pt rounded square in the colour (a tag's or a folder's), with a hairline so white and black show.
    static func swatchImage(_ color: NSColor) -> NSImage {
        let image = NSImage(size: NSSize(width: 14, height: 14), flipped: false) { rect in
            let r = rect.insetBy(dx: 1, dy: 1)
            let path = NSBezierPath(roundedRect: r, xRadius: 3.5, yRadius: 3.5)
            color.setFill()
            path.fill()
            NSColor.black.withAlphaComponent(0.12).setStroke()
            path.lineWidth = 0.5
            path.stroke()
            return true
        }
        return image
    }

    /// Foli AI's flower, one colour, tinted as the menu tints its symbols.
    static let aiImage: NSImage? = {
        let renderer = ImageRenderer(content: WebAiMark(size: 15, mono: true))
        renderer.scale = 2
        guard let cg = renderer.cgImage else { return nil }
        let image = NSImage(cgImage: cg, size: NSSize(width: 15, height: 15))
        image.isTemplate = true
        return image
    }()

    /// "⌘K", "⌘⌥N", "⇧⌘D", "⌘," as an NSMenuItem key equivalent and its modifiers; nil for anything else.
    nonisolated public static func keyEquivalent(_ s: String) -> (key: String, modifiers: NSEvent.ModifierFlags)? {
        var mods: NSEvent.ModifierFlags = []
        var rest = Substring(s.trimmingCharacters(in: .whitespaces))
        while let c = rest.first, "⌘⌥⇧⌃".contains(c) {
            switch c {
            case "⌘": mods.insert(.command)
            case "⌥": mods.insert(.option)
            case "⇧": mods.insert(.shift)
            default: mods.insert(.control)
            }
            rest = rest.dropFirst()
        }
        let special: [String: String] = [
            "⌫": "\u{8}", "⌦": String(UnicodeScalar(NSDeleteFunctionKey)!), "↩": "\r", "⏎": "\r", "↵": "\r", "Return": "\r",
            "⎋": "\u{1b}", "Esc": "\u{1b}", "⇥": "\t", "Tab": "\t", "Space": " ",
            "←": String(UnicodeScalar(NSLeftArrowFunctionKey)!), "→": String(UnicodeScalar(NSRightArrowFunctionKey)!),
            "↑": String(UnicodeScalar(NSUpArrowFunctionKey)!), "↓": String(UnicodeScalar(NSDownArrowFunctionKey)!),
        ]
        let key = String(rest)
        if let k = special[key] { return mods.isEmpty ? nil : (k, mods) }
        guard key.count == 1, !mods.isEmpty else { return nil }
        return (key.lowercased(), mods)
    }

    /// The menu's items as text (the eval hook, the before-and-after dumps): a title with its key equivalent,
    /// checkmark, subtitle, badge, "(off)" when not offered, "(danger)" in red; "---" a separator; "# title" a
    /// section header; a submenu's items indented under it.
    public static func describe(_ menu: NSMenu, depth: Int = 0) -> [String] {
        let pad = String(repeating: "    ", count: depth)
        return menu.items.flatMap { item -> [String] in
            if item.isSeparatorItem { return [pad + "---"] }
            if item.isSectionHeader { return [pad + "# " + item.title] }
            var t = pad + item.title
            if !item.keyEquivalent.isEmpty { t += " [\(shortcutText(item.keyEquivalent, item.keyEquivalentModifierMask))]" }
            if item.state == .on { t += " ✓" }
            if let s = item.subtitle { t += " {\(s)}" }
            if let b = item.badge { t += " <\(b.stringValue ?? "")>" }
            if item.indentationLevel > 0 { t += " (indent \(item.indentationLevel))" }
            if !item.isEnabled { t += " (off)" }
            if let a = item.attributedTitle, a.length > 0, (a.attribute(.foregroundColor, at: 0, effectiveRange: nil) as? NSColor) == .systemRed { t += " (danger)" }
            if item.image != nil { t += " 🖼" }
            var out = [t]
            if let sub = item.submenu { out += describe(sub, depth: depth + 1) }
            return out
        }
    }

    nonisolated static func shortcutText(_ key: String, _ m: NSEvent.ModifierFlags) -> String {
        var s = ""
        if m.contains(.control) { s += "⌃" }
        if m.contains(.option) { s += "⌥" }
        if m.contains(.shift) { s += "⇧" }
        if m.contains(.command) { s += "⌘" }
        let names: [String: String] = ["\u{8}": "⌫", "\r": "↩", "\u{1b}": "⎋", "\t": "⇥", " ": "Space"]
        return s + (names[key] ?? key.uppercased())
    }

    /// The window an open menu draws in (the eval hook's pictures), when AppKit shows it as one.
    static var openMenuWindow: NSWindow? {
        NSApp?.windows.last { $0.isVisible && $0.level.rawValue >= NSWindow.Level.popUpMenu.rawValue && String(describing: type(of: $0)).contains("Menu") }
    }

    /// The web's icons (lucide) as the closest SF Symbols, so Folevi's menus carry the system's own pictures.
    static var symbols: [WebIcon: String] { WebIconSymbols.table }
}

/// One menu on screen: a system `NSMenu` built from Folevi's rows, opened from a button (under or over it), as a
/// select's pop-up (its chosen option over the trigger), or as a right click's context menu. One at a time. The
/// name and entry points are the ones the drawn panel had, so every caller kept working as it was converted.
@MainActor
public final class WebMenuWindow: NSObject, NSMenuDelegate {
    private static var current: WebMenuWindow?
    private let entries: [WebMenuEntry]
    /// The system menu shown.
    public let menu: NSMenu
    /// The button it opened from (nil: a right click), and its frame in the window.
    private weak var trigger: NSView?
    private var triggerRect: NSRect = .zero
    private var tracking = false
    private var closed = false
    /// Where it opened, in screen coordinates (the eval hook).
    public private(set) var frame: NSRect = .zero

    private init(entries: [WebMenuEntry], menu: NSMenu? = nil) {
        self.entries = entries
        self.menu = menu ?? NativeMenu.build(entries)
        // (A menu handed in, a right click's with the system's Share submenu, gets the same rows.)
        NativeMenu.comfortable(self.menu)
        super.init()
        self.menu.delegate = self
    }

    /// Which edge of its button a menu lines up with.
    public enum Align { case start, end }
    /// Which side of its button a menu opens on when there's room.
    public enum Side { case top, bottom }

    /// Opens the menu at `point` (window coordinates of `window`, bottom-left origin), its top-left corner there.
    @discardableResult
    public static func show(_ entries: [WebMenuEntry], width: CGFloat = 200, at point: NSPoint, in window: NSWindow) -> WebMenuWindow {
        let m = open(WebMenuWindow(entries: entries))
        m.present { menu in
            guard let view = window.contentView else { return }
            let p = view.convert(point, from: nil)
            m.frame = NSRect(origin: window.convertPoint(toScreen: point), size: menu.size)
            menu.popUp(positioning: nil, at: p, in: view)
        }
        return m
    }

    /// Opens a context menu for a right click (`event`), as the system places one.
    @discardableResult
    static func showContext(_ entries: [WebMenuEntry], menu: NSMenu? = nil, event: NSEvent, in window: NSWindow) -> WebMenuWindow {
        let m = open(WebMenuWindow(entries: entries, menu: menu))
        m.present { menu in
            guard let view = window.contentView else { return }
            m.frame = NSRect(origin: window.convertPoint(toScreen: event.locationInWindow), size: menu.size)
            NSMenu.popUpContextMenu(menu, with: event, for: view)
        }
        return m
    }

    /// Opens the menu under a view (a pull-down), lined up with its end (or start) edge; above it when there's more
    /// room there (or `side` asks for the top and there's room).
    @discardableResult
    public static func show(_ entries: [WebMenuEntry], width: CGFloat = 200, below view: NSView, align: Align = .end, side: Side = .bottom) -> WebMenuWindow? {
        guard let window = view.window else { return nil }
        let m = open(WebMenuWindow(entries: entries))
        m.openedFrom(view)
        m.present { [weak view] menu in
            guard let view, view.window === window else { return }
            let size = menu.size
            let b = view.bounds
            let onScreen = window.convertToScreen(view.convert(b, to: nil))
            let area = window.screen?.visibleFrame ?? onScreen.insetBy(dx: -2000, dy: -2000)
            let roomBelow = onScreen.minY - area.minY, roomAbove = area.maxY - onScreen.maxY
            let up = side == .top ? !(roomAbove < size.height && roomBelow > roomAbove) : roomBelow < size.height && roomAbove > roomBelow
            let gap: CGFloat = 4
            let x = align == .end ? b.maxX - size.width : b.minX
            let y: CGFloat = view.isFlipped ? (up ? b.minY - gap - size.height : b.maxY + gap) : (up ? b.maxY + gap + size.height : b.minY - gap)
            m.frame = NSRect(x: onScreen.minX + (x - b.minX), y: up ? onScreen.maxY + gap : onScreen.minY - gap - size.height, width: size.width, height: size.height)
            menu.popUp(positioning: nil, at: NSPoint(x: x, y: y), in: view)
        }
        return m
    }

    /// A select's options (a pop-up button's menu): at least as wide as its trigger, the chosen option over it.
    @discardableResult
    public static func showSelect(_ entries: [WebMenuEntry], below view: NSView) -> WebMenuWindow? {
        guard let window = view.window else { return nil }
        let m = open(WebMenuWindow(entries: entries))
        m.openedFrom(view)
        m.menu.minimumWidth = view.bounds.width
        m.present { [weak view] menu in
            guard let view, view.window === window else { return }
            let b = view.bounds
            let chosen = menu.items.first { $0.state == .on }
            // The chosen option sits over the trigger (its row centred on it), as NSPopUpButton puts it; with none,
            // the list opens under it.
            let row: CGFloat = 22
            let top = chosen == nil ? (view.isFlipped ? b.maxY + 4 : b.minY - 4) : (view.isFlipped ? b.midY - row / 2 : b.midY + row / 2)
            let onScreen = window.convertToScreen(view.convert(b, to: nil))
            m.frame = NSRect(origin: NSPoint(x: onScreen.minX, y: onScreen.minY - menu.size.height), size: menu.size)
            menu.popUp(positioning: chosen, at: NSPoint(x: b.minX, y: top), in: view)
        }
        return m
    }

    /// The previous menu goes; this one is the one on screen.
    private static func open(_ m: WebMenuWindow) -> WebMenuWindow {
        current?.close()
        current = m
        return m
    }

    /// Remembers the button it opened from, which keeps its open look meanwhile.
    private func openedFrom(_ view: NSView) {
        trigger = view
        triggerRect = view.convert(view.bounds, to: nil)
        WebMenuTrigger.shared.open = ObjectIdentifier(view)
    }

    /// Shows the menu on the next turn of the run loop (the button's click or the right click has finished), and
    /// tidies up when it closes. Never while the app isn't running (unit tests build menus without showing them).
    private func present(_ place: @escaping @MainActor (NSMenu) -> Void) {
        DispatchQueue.main.async {
            MainActor.assumeIsolated {
                guard Self.current === self, !self.closed else { return }
                guard NSApp?.isRunning == true else { return }
                self.tracking = true
                place(self.menu)
                self.tracking = false
                self.finish()
            }
        }
    }

    /// The menu on screen, if any (tests, the eval hook).
    public static var shown: WebMenuWindow? { current.flatMap { $0.closed ? nil : $0 } }

    /// Whether `view` opened the menu on screen (its trigger keeps its open look meanwhile).
    static func isOpen(from view: NSView?) -> Bool {
        guard let view, let m = shown else { return false }
        return m.trigger === view
    }

    /// What a mouse down outside a Folevi floating panel does (MAC-06, MAC-08): it always closes the panel; on the
    /// panel's own button it stops there (the button would open it again); anywhere else it goes on to what's under it.
    /// (System menus do this themselves; the planner's panels still ask.)
    enum OutsideClick: Equatable { case closeAndPass, closeAndSwallow }

    nonisolated static func outsideClick(at point: NSPoint, inParent: Bool, left: Bool, trigger: NSRect) -> OutsideClick {
        inParent && left && trigger.width > 0 && trigger.height > 0 && trigger.contains(point) ? .closeAndSwallow : .closeAndPass
    }

    /// Its rows as text (the eval hook, menus.mjs): "—" for a separator, "# title" for a heading, an item's title
    /// with "[shortcut]", " ✓" when checked, " (off)" when disabled and " (danger)".
    public var rows: [String] {
        entries.map { e in
            switch e.item.kind {
            case .separator: return "—"
            case .heading: return "# \(e.item.title)"
            case .item:
                var t = e.item.title
                if let k = e.item.shortcut { t += " [\(k)]" }
                if e.item.checked { t += " ✓" }
                if e.disabled { t += " (off)" }
                if e.item.danger { t += " (danger)" }
                return t
            }
        }
    }

    /// The system menu's items as text (NativeMenu.describe).
    public var nativeRows: [String] { NativeMenu.describe(menu) }

    /// The menu as it is on screen, when AppKit draws it in a window this process can read (the eval hook).
    public func snapshot() -> NSBitmapImageRep? {
        guard let view = NativeMenu.openMenuWindow?.contentView, let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return nil }
        view.cacheDisplay(in: view.bounds, to: rep)
        return rep
    }

    /// Closes it (the system's fade).
    public func close() {
        if tracking { menu.cancelTracking() } else { finish() }
    }

    private func finish() {
        guard !closed else { return }
        closed = true
        if let t = trigger, WebMenuTrigger.shared.open == ObjectIdentifier(t) { WebMenuTrigger.shared.open = nil }
        if Self.current === self { Self.current = nil }
    }

    // MARK: NSMenuDelegate

    public func menuDidClose(_ menu: NSMenu) {
        // (The trigger lets go of its open look as the menu goes; the rest when popUp returns.)
        if let t = trigger, WebMenuTrigger.shared.open == ObjectIdentifier(t) { WebMenuTrigger.shared.open = nil }
    }
}

/// Clicks outside Folevi's floating panels (the planner's popovers): MAC-06.
@MainActor
enum OutsideClicks {
    /// A mouse down that closed a panel goes on to the window under it. That window is made key here, before AppKit
    /// hands it the click: a click on a window that isn't key only makes it key. Now the one click closes and acts.
    static func prepare(_ event: NSEvent) {
        guard let w = event.window, w.isVisible, !w.isKeyWindow, w.canBecomeKey else { return }
        w.makeKey()
    }
}

extension NSWindow {
    /// A floating panel closing gives the keys back to the window it floats over, if it had them.
    func handKeyBack() {
        guard isKeyWindow, let p = parent, p.isVisible, p.canBecomeKey else { return }
        p.makeKey()
    }
}

// MARK: right-click menus

/// Right-click (or Control-click) menus: views register their area, one event monitor picks the smallest area under
/// the pointer and opens its menu as the system's context menu.
@MainActor
final class WebContextMenus {
    static let shared = WebContextMenus()
    private var catchers: [ObjectIdentifier: WeakCatcher] = [:]
    private var monitor: Any?

    struct WeakCatcher {
        weak var view: ContextCatcherView?
    }

    func register(_ v: ContextCatcherView) {
        catchers[ObjectIdentifier(v)] = WeakCatcher(view: v)
        if monitor == nil {
            monitor = NSEvent.addLocalMonitorForEvents(matching: [.rightMouseDown, .leftMouseDown]) { [weak self] event in
                guard let self else { return event }
                let right = event.type == .rightMouseDown || (event.type == .leftMouseDown && event.modifierFlags.contains(.control))
                guard right, let window = event.window else { return event }
                let hits = self.catchers.values.compactMap(\.view).filter { $0.window === window && !$0.isHiddenOrHasHiddenAncestor }.filter { v in
                    v.convert(v.bounds, to: nil).contains(event.locationInWindow)
                }
                if let best = hits.min(by: { $0.bounds.width * $0.bounds.height < $1.bounds.width * $1.bounds.height }), let entries = best.entries?(), !entries.isEmpty {
                    WebMenuWindow.showContext(entries, event: event, in: window)
                    return nil
                }
                // Nothing here has its own menu: a text field's, or the window's (AppContextMenu.swift).
                guard let built = AppContextMenu.menu(for: event, in: window) else { return event }
                WebMenuWindow.showContext(built.entries, menu: built.menu, event: event, in: window)
                return nil
            }
        }
    }

    func unregister(_ v: ContextCatcherView) { catchers[ObjectIdentifier(v)] = nil }
}

final class ContextCatcherView: NSView {
    var entries: (@MainActor () -> [WebMenuEntry])?
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        MainActor.assumeIsolated {
            if window != nil { WebContextMenus.shared.register(self) } else { WebContextMenus.shared.unregister(self) }
        }
    }
}

struct ContextCatcher: NSViewRepresentable {
    let entries: @MainActor () -> [WebMenuEntry]
    func makeNSView(context: Context) -> ContextCatcherView {
        let v = ContextCatcherView()
        v.entries = entries
        return v
    }

    func updateNSView(_ v: ContextCatcherView, context: Context) { v.entries = entries }
}

/// An anchor for a menu opened from a SwiftUI button: the button's own NSView.
final class MenuAnchorView: NSView {
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

struct MenuAnchor: NSViewRepresentable {
    let hold: (NSView) -> Void
    func makeNSView(context: Context) -> MenuAnchorView {
        let v = MenuAnchorView()
        DispatchQueue.main.async { hold(v) }
        return v
    }

    func updateNSView(_ v: MenuAnchorView, context: Context) {}
}

#else
/// The layer an iPad menu sits in, over the whole window. A touch (or a click, a scroll) anywhere outside the panel
/// closes the menu and goes on to what's under it, as iPadOS's own menus do: the button under the finger answers the
/// same tap, a scroll scrolls. The window changing size (a rotation, Split View, Stage Manager) closes it too.
final class WebMenuLayerView: UIView {
    /// The panel's frame in the layer (its shadow's room left out).
    var panel: () -> CGRect = { .zero }
    var outside: () -> Void = {}
    private var placedSize: CGSize?

    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        if panel().contains(point) { return super.hitTest(point, with: event) }
        // (A pointer only hovering asks too: that leaves the menu up.)
        if let type = event?.type, type == .touches || type == .scroll || type == .transform { outside() }
        return nil
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        guard bounds.size != .zero else { return }
        if let placed = placedSize, placed != bounds.size { outside() }
        placedSize = bounds.size
    }
}

/// The iPad's menu: the same panel in a layer over the window (a touch outside closes it and goes through), one at
/// a time.
@MainActor
public final class WebMenuWindow {
    private static var current: WebMenuWindow?
    private let state: WebMenuState
    private let layer = WebMenuLayerView()
    private let host: UIHostingController<AnyView>
    static let margin: CGFloat = 32

    private init(entries: [WebMenuEntry], width: CGFloat) {
        state = WebMenuState(entries)
        host = UIHostingController(rootView: AnyView(EmptyView()))
        host.rootView = AnyView(WebMenuContent(state: state, width: width) { [weak self] e in self?.pick(e) }.padding(Self.margin))
        host.view.backgroundColor = .clear
        host.safeAreaRegions = []
        layer.backgroundColor = .clear
        layer.panel = { [weak self] in
            guard let self else { return .zero }
            return self.host.view.frame.insetBy(dx: Self.margin, dy: Self.margin)
        }
        layer.outside = { [weak self] in
            MainActor.assumeIsolated { self?.close() }
        }
    }

    /// Opens the menu with its top-left corner at `point` (in `window`'s coordinates), kept on screen.
    @discardableResult
    public static func show(_ entries: [WebMenuEntry], width: CGFloat = 224, at point: CGPoint, in window: UIWindow, growFrom: CGPoint? = nil) -> WebMenuWindow {
        current?.close()
        let menu = WebMenuWindow(entries: entries, width: width)
        menu.layer.frame = window.bounds
        menu.layer.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        let size = menu.host.sizeThatFits(in: CGSize(width: width + margin * 2, height: window.bounds.height))
        let safe = window.bounds.inset(by: window.safeAreaInsets)
        var origin = CGPoint(x: point.x - margin, y: point.y - margin)
        origin.x = min(max(origin.x, safe.minX - margin + 8), safe.maxX - size.width + margin - 8)
        if origin.y + size.height - margin > safe.maxY { origin.y = max(safe.minY - margin, point.y - size.height + margin - 28) }
        menu.host.view.frame = CGRect(origin: origin, size: size)
        menu.host.overrideUserInterfaceStyle = window.overrideUserInterfaceStyle
        menu.layer.addSubview(menu.host.view)
        window.addSubview(menu.layer)
        current = menu
        // (After any placing under or over a view: it grows out of the point it was opened from.)
        DispatchQueue.main.async { MainActor.assumeIsolated { menu.growIn(from: growFrom ?? point) } }
        return menu
    }

    /// Grows out of `point` (the window's coordinates) on a spring with a little overshoot (FoleviSpring.pop's feel);
    /// under Reduce Motion it only fades in.
    private func growIn(from point: CGPoint) {
        guard let v = host.view else { return }
        v.alpha = 0
        if UIAccessibility.isReduceMotionEnabled {
            UIView.animate(withDuration: 0.12) { v.alpha = 1 }
            return
        }
        let p = v.convert(point, from: layer)
        let scale: CGFloat = 0.8
        v.transform = CGAffineTransform(translationX: (p.x - v.bounds.midX) * (1 - scale), y: (p.y - v.bounds.midY) * (1 - scale)).scaledBy(x: scale, y: scale)
        UIView.animate(withDuration: 0.42, delay: 0, usingSpringWithDamping: 0.66, initialSpringVelocity: 0, options: [.allowUserInteraction]) {
            v.transform = .identity
            v.alpha = 1
        }
    }

    public enum Align { case start, end }
    public enum Side { case top, bottom }

    /// Opens the menu under (or over) a view, 4 pt off it: its left edge at the view's (`start`) or its right edge at
    /// the view's (`end`).
    @discardableResult
    public static func show(_ entries: [WebMenuEntry], width: CGFloat = 200, below view: UIView, align: Align = .start, side: Side = .bottom) -> WebMenuWindow? {
        guard let window = view.window else { return nil }
        let r = view.convert(view.bounds, to: window)
        let menu = show(entries, width: width, at: CGPoint(x: r.minX, y: r.maxY + 4), in: window)
        // (Placed from the menu's own size: its end under the view's end, or above the view.)
        let f = menu.host.view.frame
        var x = f.minX, y = f.minY
        if align == .end { x = r.maxX - (f.width - margin) }
        if side == .top { y = r.minY - 4 - (f.height - margin) }
        let safe = window.bounds.inset(by: window.safeAreaInsets)
        x = min(max(x, safe.minX - margin + 8), safe.maxX - f.width + margin - 8)
        menu.host.view.frame.origin = CGPoint(x: x, y: y)
        return menu
    }

    /// A select's list (ui/Select.tsx) under its trigger, as wide as the trigger at least.
    @discardableResult
    public static func showSelect(_ entries: [WebMenuEntry], below view: UIView) -> WebMenuWindow? {
        show(entries, width: max(view.bounds.width, 160), below: view)
    }

    /// Opens the menu beside a finger held on the screen (`point`, the window's coordinates): below the finger's
    /// 44-point spot, its left edge at the finger, or above the spot when there's more room there, so neither the
    /// finger nor the menu hides the other.
    @discardableResult
    public static func show(_ entries: [WebMenuEntry], width: CGFloat = 224, besideFinger point: CGPoint, in window: UIWindow) -> WebMenuWindow {
        let spot = CGRect(x: point.x - 22, y: point.y - 22, width: 44, height: 44)
        let menu = show(entries, width: width, at: CGPoint(x: point.x, y: spot.maxY), in: window, growFrom: point)
        let f = menu.host.view.frame
        let h = f.height - margin * 2
        let safe = window.bounds.inset(by: window.safeAreaInsets)
        let below = safe.maxY - spot.maxY - 8
        let above = spot.minY - safe.minY - 8
        var y = below >= h || below >= above ? spot.maxY : spot.minY - h
        y = min(max(y, safe.minY + 8), safe.maxY - h - 8)
        menu.host.view.frame.origin.y = y - margin
        return menu
    }

    /// The menu on screen, if any.
    public static var shown: WebMenuWindow? { current }

    private func pick(_ e: WebMenuEntry) {
        close()
        DispatchQueue.main.async { MainActor.assumeIsolated { e.action() } }
    }

    public func close() {
        if Self.current === self { Self.current = nil }
        // Fades as it goes, shrinking a touch (taps go through to the window meanwhile).
        let layer = layer
        layer.isUserInteractionEnabled = false
        UIView.animate(withDuration: 0.14, delay: 0, options: [.beginFromCurrentState]) { [host] in
            host.view.alpha = 0
            if !UIAccessibility.isReduceMotionEnabled { host.view.transform = CGAffineTransform(scaleX: 0.96, y: 0.96) }
        } completion: { _ in layer.removeFromSuperview() }
    }
}

/// An anchor for a menu opened from a SwiftUI button: a view of the button's size.
struct MenuAnchor: UIViewRepresentable {
    let hold: (UIView) -> Void
    func makeUIView(context: Context) -> UIView {
        let v = UIView()
        v.isUserInteractionEnabled = false
        DispatchQueue.main.async { hold(v) }
        return v
    }

    func updateUIView(_ v: UIView, context: Context) {}
}

/// The iPad's right click: a Folevi menu from a finger held still on the view (0.45 s), or from a pointer's
/// secondary click (a two-finger click on a trackpad, a mouse's right button) at the pointer.
///
/// Both are UIKit recognizers that run beside everything else on the view (its Button's tap, a scroll, the drag
/// `.draggable` adds), so the hold is never lost to the drag's lift (IPAD-01, IPAD-09): the menu opens first, and a
/// finger that then moves on carries the item away as a drag, closing the menu (iPadOS's own context menus do the
/// same). A finger that moves before the hold has begun is a scroll and opens nothing.
struct ContextCatcher: ViewModifier {
    let entries: @MainActor () -> [WebMenuEntry]

    func body(content: Content) -> some View {
        content
            .gesture(MenuHold { point, window in
                let list = entries()
                guard !list.isEmpty else { return false }
                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                WebMenuWindow.show(list, besideFinger: point, in: window)
                return true
            })
            .gesture(SecondaryClick { point, window in
                let list = entries()
                guard !list.isEmpty else { return }
                WebMenuWindow.show(list, at: point, in: window)
            })
    }
}

/// A held finger (0.45 s, within 10 pt), recognized alongside the view's other gestures. `began` gets the finger's
/// place in the window and says whether it opened a menu; that menu closes again if the finger then travels on (a
/// drag of the item, or a scroll that started late).
struct MenuHold: UIGestureRecognizerRepresentable {
    let began: @MainActor (CGPoint, UIWindow) -> Bool

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        var start: CGPoint = .zero
        weak var menu: WebMenuWindow?
        func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
        // (Only fingers: a pointer's click and hold is a drag or a selection there.)
        func gestureRecognizer(_ g: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool { touch.type == .direct }
    }

    func makeCoordinator(converter: CoordinateSpaceConverter) -> Coordinator { Coordinator() }

    func makeUIGestureRecognizer(context: Context) -> UILongPressGestureRecognizer {
        let hold = UILongPressGestureRecognizer()
        hold.minimumPressDuration = 0.45
        hold.allowableMovement = 10
        hold.cancelsTouchesInView = false
        hold.delaysTouchesEnded = false
        hold.delegate = context.coordinator
        return hold
    }

    func handleUIGestureRecognizerAction(_ recognizer: UILongPressGestureRecognizer, context: Context) {
        guard let window = recognizer.view?.window else { return }
        let at = recognizer.location(in: window)
        switch recognizer.state {
        case .began:
            context.coordinator.start = at
            if began(at, window) { context.coordinator.menu = WebMenuWindow.shown }
        case .changed:
            // The finger travels on with the menu up: it's carrying the item (or scrolling) now.
            if let menu = context.coordinator.menu, hypot(at.x - context.coordinator.start.x, at.y - context.coordinator.start.y) > 16 {
                menu.close()
                context.coordinator.menu = nil
            }
        default:
            context.coordinator.menu = nil
        }
    }
}

/// A pointer's secondary click (a two-finger click on a trackpad, a mouse's right button, Control-click), with the
/// pointer's place in the window.
struct SecondaryClick: UIGestureRecognizerRepresentable {
    let clicked: @MainActor (CGPoint, UIWindow) -> Void

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
        // (Only a pointer's click: a finger's tap must never count as one, whatever button mask it reports.)
        func gestureRecognizer(_ g: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool { touch.type == .indirectPointer }
    }

    func makeCoordinator(converter: CoordinateSpaceConverter) -> Coordinator { Coordinator() }

    func makeUIGestureRecognizer(context: Context) -> UITapGestureRecognizer {
        let click = UITapGestureRecognizer()
        click.buttonMaskRequired = .secondary
        click.cancelsTouchesInView = false
        click.delegate = context.coordinator
        return click
    }

    func handleUIGestureRecognizerAction(_ recognizer: UITapGestureRecognizer, context: Context) {
        guard recognizer.state == .ended, let window = recognizer.view?.window else { return }
        clicked(recognizer.location(in: window), window)
    }
}

#endif

public extension View {
    /// A Folevi menu on right click: the system's context menu with Folevi's rows on the Mac, the drawn one on iPad.
    func webContextMenu(_ entries: @escaping @MainActor () -> [WebMenuEntry]) -> some View {
        #if os(macOS)
        background(ContextCatcher(entries: entries))
        #else
        modifier(ContextCatcher(entries: entries))
        #endif
    }
}

/// A row's "…" button, shown while its row is hovered, always taking its room. On the Mac the ellipsis symbol with
/// the system's hover fill, its menu the system's; on the iPad MenuButton's own trigger (32 pt, the chip radius,
/// muted, the soft accent on hover).
public struct RowMoreButton: View {
    let label: String
    let shown: Bool
    var size: CGFloat = 32
    var iconSize: CGFloat = 14
    let entries: @MainActor () -> [WebMenuEntry]
    @State private var hover = false
    @Environment(\.colorScheme) private var scheme

    /// `size` and `iconSize`: the trigger's own where the web gives it one (a notification's: h-7 w-7, 15).
    public init(label: String, shown: Bool, size: CGFloat = 32, iconSize: CGFloat = 14, entries: @escaping @MainActor () -> [WebMenuEntry]) {
        self.label = label
        self.shown = shown
        self.size = size
        self.iconSize = iconSize
        self.entries = entries
    }

    public var body: some View {
        WebMenuButton(hover: nil, entries: entries) {
            RowMoreFace(hover: hover, shown: shown, size: size, iconSize: iconSize)
        }
        .onHover { hover = $0 }
        #if os(iOS)
        // (A finger can't hover: on the iPad it's always shown. A "…" hidden but still taking taps opened an unseen
        // menu from the right of the row instead of the row.)
        .allowsHitTesting(shown || hover || TouchReveal.always)
        #endif
        .accessibilityLabel(label)
    }
}

/// The "…" itself: muted, in the heading colour on the accent's soft fill under the pointer and while its menu is
/// open (it stays shown then, though the pointer has left its row for the menu: MAC-43).
private struct RowMoreFace: View {
    let hover: Bool
    let shown: Bool
    let size: CGFloat
    let iconSize: CGFloat
    @Environment(\.webMenuOpen) private var open
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let hot = hover || open
        #if os(macOS)
        // The system's: the ellipsis symbol in the secondary label colour, the quaternary hover fill (MacLook).
        MacSymbol("ellipsis", size: iconSize, weight: .medium)
            .foregroundStyle(hot ? MacLook.Colors.label : MacLook.Colors.secondary)
            .frame(width: size, height: size)
            .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(hot ? MacLook.Colors.hover : .clear))
            .contentShape(Rectangle())
            .opacity(shown || hot ? 1 : 0)
        #else
        let ink = WebStyles.vars[hot ? "color-heading" : "color-ink-muted"]?.resolve(scheme).color ?? .secondary
        let soft = WebStyles.vars["color-accent-soft"]?.resolve(scheme).color ?? .clear
        WebIconView(.ellipsis, size: iconSize)
            .foregroundStyle(ink)
            .frame(width: size, height: size)
            .background(RoundedRectangle(cornerRadius: 6, style: .circular).fill(hot ? soft : .clear))
            .contentShape(Rectangle())
            .opacity(shown || hot || TouchReveal.always ? 1 : 0)
        #endif
    }
}

extension View {
    /// On the iPad, a control drawn smaller than a finger (a 24 to 40 pt icon button) takes taps 44 points across,
    /// its drawn size and its place unchanged (IPAD-06, IPAD-07, IPAD-12). Nothing on the Mac.
    func fingerTarget(width: CGFloat, height: CGFloat) -> some View {
        #if os(iOS)
        contentShape(Rectangle().inset(by: -max(0, (44 - min(width, height)) / 2)))
        #else
        self
        #endif
    }
}

/// Controls the Mac shows only while the pointer is over their row or card (a "…"): on the iPad always shown, as the
/// web shows them to a finger (`pointer-coarse:opacity-100`), since a finger can't hover.
enum TouchReveal {
    #if os(iOS)
    static let always = true
    #else
    static let always = false
    #endif
}

/// Hands its content whether the pointer is over it (a row that shows its "…" on hover).
public struct HoverReveal<Content: View>: View {
    let content: (Bool) -> Content
    @State private var hover = false

    public init(@ViewBuilder content: @escaping (Bool) -> Content) { self.content = content }

    public var body: some View {
        content(hover).onHover { hover = $0 }
    }
}

/// A button that opens a Folevi menu under itself (on the Mac a system pull-down, or a select's pop-up).
public struct WebMenuButton<Label: View>: View {
    let entries: @MainActor () -> [WebMenuEntry]
    let width: CGFloat
    let align: WebMenuWindow.Align
    /// A select's trigger (ui/Select.tsx): its list instead of a menu (WebMenuWindow.showSelect).
    let select: Bool
    let side: WebMenuWindow.Side
    let label: Label
    /// The radius of its hover fill (the glass hover over the label's box); nil for a label that draws its own hover.
    let hover: CGFloat?
    @State private var anchor: NSView?
    @State private var hovered = false

    public init(width: CGFloat = 200, align: WebMenuWindow.Align = .end, side: WebMenuWindow.Side = .bottom, select: Bool = false, hover: CGFloat? = FoleviTokens.Radius.chip, entries: @escaping @MainActor () -> [WebMenuEntry], @ViewBuilder label: () -> Label) {
        self.entries = entries
        self.hover = hover
        self.width = width
        self.align = align
        self.side = side
        self.select = select
        self.label = label()
    }

    public var body: some View {
        // While its menu is open the button keeps an open look: the glass hover fill behind it (a select's well
        // covers it with its own box) and `webMenuOpen` for a label that draws its own (MAC-43).
        let open = anchor.map { WebMenuTrigger.shared.open == ObjectIdentifier($0) } ?? false
        Button {
            if let anchor {
                if select { WebMenuWindow.showSelect(entries(), below: anchor) } else { WebMenuWindow.show(entries(), width: width, below: anchor, align: align, side: side) }
            }
        } label: {
            #if os(macOS)
            // The system's hover and open fills (MacLook's quaternary), never the web's glass.
            label
                .environment(\.webMenuOpen, open)
                .background(MenuAnchor { anchor = $0 })
                .background {
                    if let radius = hover, open || hovered, !select {
                        RoundedRectangle(cornerRadius: radius, style: .continuous).fill(MacLook.Colors.hover.opacity(open ? 1 : 0.7))
                    }
                }
                .onHover { hovered = $0 }
            #else
            label
                .environment(\.webMenuOpen, open)
                .background(MenuAnchor { anchor = $0 })
                .background {
                    if open, !select { WebMenuOpenFill() }
                }
                // Under the pointer the glass hover over its box (hover everywhere, 2026-11-06); not while it's open.
                .webHover(radius: hover ?? 0, active: hover != nil && !open)
            #endif
        }
        .buttonStyle(.plain)
    }
}

/// A menu button's fill while its menu is open: the glass hover at the chip radius (the iPad; the Mac's is the
/// system's quaternary fill).
struct WebMenuOpenFill: View {
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        RoundedRectangle(cornerRadius: FoleviTokens.Radius.chip, style: .circular)
            .fill(WebStyles.vars["glass-hover"]?.resolve(scheme).color ?? .clear)
    }
}

extension EnvironmentValues {
    /// The menu this label's button opens is on screen (MAC-43).
    @Entry var webMenuOpen = false
}
#endif
