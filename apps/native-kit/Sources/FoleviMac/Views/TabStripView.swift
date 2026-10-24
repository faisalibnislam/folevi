// The native tab strip (docs/MAC_POLISH_PLAN.md section 2.1: 32 tall, 12 / 8 padding, 13 text, radius 8, the
// active tab the content colour with a 1 pt edge, the close button on hover and always on the active tab), Craft
// style: the tab on screen is always shown whole and selected; the others shrink (down to their icon) to make
// room, and the strip scrolls only when even that isn't enough. Click selects, middle-click closes, drag
// reorders, right-click offers Close, Close Other Tabs, Close Tabs to the Right and Open in New Window.
#if os(macOS)
import AppKit
import FoleviDesign

@MainActor
public protocol TabStripDelegate: AnyObject {
    func tabStrip(select id: String)
    func tabStrip(close id: String)
    func tabStrip(move id: String, to index: Int)
    func tabStrip(closeOthers id: String)
    func tabStrip(closeToTheRight id: String)
    func tabStrip(openInNewWindow id: String)
}

@MainActor
public final class TabStripView: NSView {
    public weak var delegate: (any TabStripDelegate)?
    public private(set) var tabs: [FrameTab] = []
    public private(set) var activeID = FrameTab.homeID
    private var items: [TabItemView] = []
    private var scroll: CGFloat = 0
    /// While a tab is dragged: its id and the pointer's offset in it.
    private var dragging: (id: String, grab: CGFloat, x: CGFloat)?

    nonisolated static let height: CGFloat = 32
    nonisolated static let maxWidth: CGFloat = 220
    nonisolated static let minWidth: CGFloat = 40
    nonisolated static let gap: CGFloat = 4

    public override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.masksToBounds = true
        setAccessibilityRole(.tabGroup)
        setAccessibilityLabel("Tabs")
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not from a nib") }

    public override var isFlipped: Bool { true }
    public override var mouseDownCanMoveWindow: Bool { false }

    /// The model's tabs (call on every change; unchanged tabs keep their views).
    public func update(tabs: [FrameTab], activeID: String) {
        let old = Dictionary(items.map { ($0.tab.id, $0) }, uniquingKeysWith: { a, _ in a })
        var next: [TabItemView] = []
        for t in tabs {
            let item = old[t.id] ?? TabItemView(tab: t, strip: self)
            item.tab = t
            item.isActive = t.id == activeID
            next.append(item)
        }
        for item in items where !next.contains(where: { $0 === item }) { item.removeFromSuperview() }
        for item in next where item.superview !== self { addSubview(item) }
        items = next
        self.tabs = tabs
        self.activeID = activeID
        needsLayout = true
    }

    public override func layout() {
        super.layout()
        let frames = Self.layoutFrames(widths: items.map(\.idealWidth), active: items.firstIndex { $0.isActive } ?? 0, available: bounds.width, scroll: &scroll)
        for (item, f) in zip(items, frames) {
            var frame = f
            frame.origin.y = (bounds.height - Self.height) / 2
            frame.size.height = Self.height
            if let d = dragging, d.id == item.tab.id {
                frame.origin.x = max(0, min(bounds.width - frame.width, d.x - d.grab))
            }
            item.frame = frame
            item.compact = frame.width < 72
        }
    }

    /// Where each tab goes: ideal widths when they fit; else the active tab keeps its ideal width and the others
    /// shrink evenly (not below `minWidth`); then the strip scrolls just enough to show the active tab whole.
    /// Pure (FoleviMacTests).
    nonisolated public static func layoutFrames(widths: [CGFloat], active: Int, available: CGFloat, scroll: inout CGFloat) -> [CGRect] {
        guard !widths.isEmpty else { return [] }
        var w = widths.map { min(maxWidth, max(minWidth, $0)) }
        let gaps = gap * CGFloat(w.count - 1)
        let total = w.reduce(0, +) + gaps
        if total > available, w.count > 1 {
            let activeW = w.indices.contains(active) ? w[active] : 0
            let others = w.count - (w.indices.contains(active) ? 1 : 0)
            let each = max(minWidth, (available - activeW - gaps) / CGFloat(max(1, others)))
            for i in w.indices where i != active { w[i] = min(w[i], each) }
        }
        var x: CGFloat = 0
        var frames: [CGRect] = []
        for width in w {
            frames.append(CGRect(x: x, y: 0, width: width, height: height))
            x += width + gap
        }
        let content = x - gap
        // Scroll so the active tab shows whole (and never past the ends).
        if content <= available { scroll = 0 } else if frames.indices.contains(active) {
            let a = frames[active]
            if a.minX - scroll < 0 { scroll = a.minX }
            if a.maxX - scroll > available { scroll = a.maxX - available }
            scroll = max(0, min(content - available, scroll))
        }
        return frames.map { $0.offsetBy(dx: -scroll, dy: 0) }
    }

    // MARK: from the items

    func clicked(_ item: TabItemView) { delegate?.tabStrip(select: item.tab.id) }
    func closeClicked(_ item: TabItemView) { delegate?.tabStrip(close: item.tab.id) }

    func dragBegan(_ item: TabItemView, at x: CGFloat) {
        guard !item.tab.isHome else { return }
        dragging = (item.tab.id, x - item.frame.minX, x)
        addSubview(item) // on top while it moves
    }

    func dragMoved(to x: CGFloat) {
        guard var d = dragging else { return }
        d.x = x
        dragging = d
        // The slot under the dragged tab's middle.
        let middle = x - d.grab + (items.first { $0.tab.id == d.id }?.frame.width ?? 0) / 2
        let others = items.filter { $0.tab.id != d.id }
        var index = others.count
        for (i, o) in others.enumerated() where middle < o.frame.midX { index = i; break }
        index = max(1, index)
        if let from = items.firstIndex(where: { $0.tab.id == d.id }), from != index {
            let item = items.remove(at: from)
            items.insert(item, at: min(index, items.count))
        }
        needsLayout = true
    }

    func dragEnded() {
        guard let d = dragging else { return }
        dragging = nil
        if let to = items.firstIndex(where: { $0.tab.id == d.id }), tabs.firstIndex(where: { $0.id == d.id }) != to {
            delegate?.tabStrip(move: d.id, to: to)
        }
        needsLayout = true
    }

    func menu(for item: TabItemView) -> NSMenu? {
        let id = item.tab.id
        let menu = NSMenu()
        if !item.tab.isHome {
            menu.addItem(Self.action("Close Tab") { [weak self] in self?.delegate?.tabStrip(close: id) })
        }
        menu.addItem(Self.action("Close Other Tabs") { [weak self] in self?.delegate?.tabStrip(closeOthers: id) })
        menu.addItem(Self.action("Close Tabs to the Right") { [weak self] in self?.delegate?.tabStrip(closeToTheRight: id) })
        menu.addItem(.separator())
        menu.addItem(Self.action("Open in New Window") { [weak self] in self?.delegate?.tabStrip(openInNewWindow: id) })
        return menu
    }

    static func action(_ title: String, _ run: @escaping @MainActor () -> Void) -> NSMenuItem {
        let item = ClosureMenuItem(title: title, run: run)
        return item
    }

    /// The items in strip order (tests, the eval hook).
    public var itemFrames: [(id: String, frame: CGRect)] { items.map { ($0.tab.id, $0.frame) } }
}

/// A menu item that runs a closure.
@MainActor
final class ClosureMenuItem: NSMenuItem {
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

/// One tab: icon, title, close button.
@MainActor
final class TabItemView: NSView {
    var tab: FrameTab { didSet { if tab != oldValue { refresh() } } }
    var isActive = false { didSet { if isActive != oldValue { refresh() } } }
    var compact = false { didSet { if compact != oldValue { refresh() } } }
    private unowned let strip: TabStripView
    private let icon = NSTextField(labelWithString: "")
    private let symbol = NSImageView()
    private let title = NSTextField(labelWithString: "")
    private let close = NSButton()
    private var hovering = false { didSet { refresh() } }
    private var tracking: NSTrackingArea?
    private var downAt: NSPoint?
    private var dragged = false

    init(tab: FrameTab, strip: TabStripView) {
        self.tab = tab
        self.strip = strip
        super.init(frame: .zero)
        wantsLayer = true
        layer?.cornerRadius = 8
        layer?.cornerCurve = .continuous
        title.font = FoleviFonts.nsFont(.ui, size: 13, weight: .regular)
        title.lineBreakMode = .byTruncatingTail
        title.cell?.truncatesLastVisibleLine = true
        icon.font = .systemFont(ofSize: 13)
        symbol.symbolConfiguration = .init(pointSize: 12, weight: .medium)
        symbol.contentTintColor = .secondaryLabelColor
        close.bezelStyle = .accessoryBarAction
        close.isBordered = false
        close.image = NSImage(systemSymbolName: "xmark", accessibilityDescription: "Close tab")
        close.symbolConfiguration = .init(pointSize: 9, weight: .semibold)
        close.contentTintColor = .secondaryLabelColor
        close.target = self
        close.action = #selector(closeTab)
        close.setAccessibilityLabel("Close \(tab.title)")
        for v in [icon, symbol, title, close] as [NSView] { addSubview(v) }
        setAccessibilityElement(true)
        setAccessibilityRole(.radioButton)
        refresh()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not from a nib") }

    override var isFlipped: Bool { true }
    override var mouseDownCanMoveWindow: Bool { false }

    var idealWidth: CGFloat {
        if tab.isHome { return 40 }
        let text = (tab.title as NSString).size(withAttributes: [.font: title.font as Any]).width
        return ceil(12 + 16 + 6 + text + 10 + 16 + 8)
    }

    private func refresh() {
        let dark = effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
        title.stringValue = tab.isHome ? "" : tab.title
        title.textColor = isActive ? .labelColor : .secondaryLabelColor
        title.isHidden = tab.isHome || compact
        if let emoji = tab.icon, !emoji.isEmpty, !tab.isHome {
            icon.stringValue = emoji
            icon.isHidden = false
            symbol.isHidden = true
        } else {
            icon.isHidden = true
            symbol.isHidden = false
            symbol.image = NSImage(systemSymbolName: tab.route.symbol, accessibilityDescription: nil)
        }
        close.isHidden = tab.isHome || !(isActive || hovering) || (compact && !isActive)
        // Active: the content colour with a 1 pt edge; hover: a faint fill (polish 2.3, 2.4).
        if isActive {
            layer?.backgroundColor = (dark ? NSColor(white: 1, alpha: 0.10) : NSColor.white).cgColor
            layer?.borderWidth = 1
            layer?.borderColor = (dark ? NSColor(white: 1, alpha: 0.10) : NSColor(white: 0, alpha: 0.08)).cgColor
            layer?.shadowOpacity = dark ? 0 : 0.06
            layer?.shadowRadius = 2
            layer?.shadowOffset = CGSize(width: 0, height: -1)
        } else {
            layer?.backgroundColor = hovering ? (dark ? NSColor(white: 1, alpha: 0.06) : NSColor(white: 0, alpha: 0.05)).cgColor : NSColor.clear.cgColor
            layer?.borderWidth = 0
            layer?.shadowOpacity = 0
        }
        setAccessibilityLabel(tab.isHome ? "Home" : tab.title)
        setAccessibilityValue(isActive ? "selected" : nil)
        toolTip = tab.isHome ? "Home" : tab.title
        needsLayout = true
    }

    override func viewDidChangeEffectiveAppearance() { refresh() }

    override func layout() {
        super.layout()
        let h = bounds.height
        if tab.isHome || compact {
            let s: CGFloat = 16
            let x = (close.isHidden ? (bounds.width - s) / 2 : 8)
            symbol.frame = CGRect(x: x, y: (h - s) / 2, width: s, height: s)
            icon.frame = CGRect(x: x - 1, y: (h - 18) / 2, width: 20, height: 18)
            close.frame = CGRect(x: bounds.width - 22, y: (h - 16) / 2, width: 16, height: 16)
            return
        }
        symbol.frame = CGRect(x: 12, y: (h - 16) / 2, width: 16, height: 16)
        icon.frame = CGRect(x: 11, y: (h - 18) / 2, width: 20, height: 18)
        let closeX = bounds.width - 8 - 16
        close.frame = CGRect(x: closeX, y: (h - 16) / 2, width: 16, height: 16)
        let textX: CGFloat = 12 + 16 + 6
        let titleH: CGFloat = 17
        title.frame = CGRect(x: textX, y: (h - titleH) / 2, width: max(0, (close.isHidden ? bounds.width - 10 : closeX - 4) - textX), height: titleH)
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

    override func mouseDown(with event: NSEvent) {
        downAt = event.locationInWindow
        dragged = false
    }

    override func mouseDragged(with event: NSEvent) {
        guard let down = downAt else { return }
        let p = strip.convert(event.locationInWindow, from: nil)
        if !dragged, abs(event.locationInWindow.x - down.x) > 4 {
            dragged = true
            strip.dragBegan(self, at: strip.convert(down, from: nil).x)
        }
        if dragged { strip.dragMoved(to: p.x) }
    }

    override func mouseUp(with event: NSEvent) {
        defer { downAt = nil }
        if dragged {
            dragged = false
            strip.dragEnded()
            return
        }
        strip.clicked(self)
    }

    // Middle-click closes (browsers' rule).
    override func otherMouseUp(with event: NSEvent) {
        if event.buttonNumber == 2, !tab.isHome { strip.closeClicked(self) } else { super.otherMouseUp(with: event) }
    }

    override func menu(for event: NSEvent) -> NSMenu? { strip.menu(for: self) }

    @objc private func closeTab() { strip.closeClicked(self) }

    override func accessibilityPerformPress() -> Bool {
        strip.clicked(self)
        return true
    }
}
#endif
