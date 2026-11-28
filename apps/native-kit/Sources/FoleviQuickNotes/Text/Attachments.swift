import AppKit
import UniformTypeIdentifiers

/// The eight divider styles (⇧⌘-). All export to Markdown as `---`.
enum DividerStyle: String, CaseIterable, Identifiable, Sendable {
    case thin, thick, dotted, dashed, double, shortCentered, ornamental, blankSpace
    var id: String { rawValue }

    var title: String {
        switch self {
        case .thin: String(localized: "Thin")
        case .thick: String(localized: "Thick")
        case .dotted: String(localized: "Dotted")
        case .dashed: String(localized: "Dashed")
        case .double: String(localized: "Double")
        case .shortCentered: String(localized: "Short, centered")
        case .ornamental: String(localized: "Ornamental")
        case .blankSpace: String(localized: "Blank space")
        }
    }

    /// Draws the divider into `rect` using the current appearance's separator color.
    func draw(in rect: NSRect, scale: CGFloat) {
        let color = NSColor.tertiaryLabelColor
        color.setFill()
        color.setStroke()
        let midY = (rect.midY * scale).rounded() / scale + (0.5 / scale)
        let inset = rect.insetBy(dx: 2, dy: 0)
        let hair = 1 / scale
        switch self {
        case .thin:
            NSRect(x: inset.minX, y: midY - hair / 2, width: inset.width, height: hair).fill()
        case .thick:
            NSBezierPath(roundedRect: NSRect(x: inset.minX, y: midY - 1.25, width: inset.width, height: 2.5),
                         xRadius: 1.25, yRadius: 1.25).fill()
        case .dotted:
            var x = inset.minX + 1.5
            while x < inset.maxX {
                NSBezierPath(ovalIn: NSRect(x: x - 1.25, y: midY - 1.25, width: 2.5, height: 2.5)).fill()
                x += 7
            }
        case .dashed:
            let path = NSBezierPath()
            path.move(to: NSPoint(x: inset.minX, y: midY)); path.line(to: NSPoint(x: inset.maxX, y: midY))
            path.lineWidth = 1.25
            path.setLineDash([6, 4], count: 2, phase: 0)
            path.stroke()
        case .double:
            NSRect(x: inset.minX, y: midY - 2 - hair / 2, width: inset.width, height: hair).fill()
            NSRect(x: inset.minX, y: midY + 2 - hair / 2, width: inset.width, height: hair).fill()
        case .shortCentered:
            let w = max(24, inset.width * 0.28)
            NSBezierPath(roundedRect: NSRect(x: inset.midX - w / 2, y: midY - 1, width: w, height: 2),
                         xRadius: 1, yRadius: 1).fill()
        case .ornamental:
            let gap: CGFloat = 34
            let lineW = max(0, (inset.width - gap) / 2 - 6)
            // Lines that fade toward the ornament.
            if let g = NSGradient(starting: color.withAlphaComponent(0), ending: color) {
                g.draw(in: NSRect(x: inset.midX - gap / 2 - lineW, y: midY - hair / 2, width: lineW, height: hair), angle: 0)
                g.draw(in: NSRect(x: inset.midX + gap / 2, y: midY - hair / 2, width: lineW, height: hair), angle: 180)
            }
            for dx in [-11.0, 0.0, 11.0] {
                let s: CGFloat = dx == 0 ? 3.2 : 2.2
                let c = NSPoint(x: inset.midX + dx, y: midY)
                let p = NSBezierPath()
                p.move(to: NSPoint(x: c.x, y: c.y - s)); p.line(to: NSPoint(x: c.x + s, y: c.y))
                p.line(to: NSPoint(x: c.x, y: c.y + s)); p.line(to: NSPoint(x: c.x - s, y: c.y)); p.close()
                p.fill()
            }
        case .blankSpace:
            break
        }
    }
}

/// A full-width divider drawn with TextKit 2's attachment APIs (never TextKit 1).
final class DividerAttachment: NSTextAttachment {
    let style: DividerStyle

    init(style: DividerStyle) {
        self.style = style
        super.init(data: nil, ofType: nil)
    }

    override func viewProvider(for parentView: NSView?, location: any NSTextLocation, textContainer: NSTextContainer?) -> NSTextAttachmentViewProvider? {
        let provider = QuickNoteAttachmentViewProvider(textAttachment: self, parentView: parentView,
                                                    textLayoutManager: textContainer?.textLayoutManager, location: location)
        provider.tracksTextAttachmentViewBounds = true
        return provider
    }

    required init?(coder: NSCoder) {
        style = .thin
        super.init(coder: coder)
    }

    override func attachmentBounds(for attributes: [NSAttributedString.Key: Any], location: any NSTextLocation,
                                   textContainer: NSTextContainer?, proposedLineFragment: CGRect,
                                   position: CGPoint) -> CGRect {
        let padding = textContainer?.lineFragmentPadding ?? 5
        let width = max(40, proposedLineFragment.width - padding * 2 - 2)
        let font = attributes[.font] as? NSFont ?? .systemFont(ofSize: 14)
        let height: CGFloat = style == .blankSpace ? 20 : 16
        return CGRect(x: 0, y: font.descender - 1, width: width, height: height)
    }

    override func image(for bounds: CGRect, attributes: [NSAttributedString.Key: Any], location: any NSTextLocation,
                        textContainer: NSTextContainer?) -> NSImage? {
        let style = style
        return NSImage(size: bounds.size, flipped: false) { rect in
            let scale = NSGraphicsContext.current?.cgContext.userSpaceToDeviceSpaceTransform.a ?? 2
            style.draw(in: rect, scale: max(1, scale))
            return true
        }
    }
}

/// A clickable checkbox drawn from SF Symbols; the checked state lives in `.quickNoteCheckbox`.
final class CheckboxAttachment: NSTextAttachment {
    let isChecked: Bool

    init(checked: Bool) {
        isChecked = checked
        super.init(data: nil, ofType: nil)
    }

    override func viewProvider(for parentView: NSView?, location: any NSTextLocation, textContainer: NSTextContainer?) -> NSTextAttachmentViewProvider? {
        let provider = QuickNoteAttachmentViewProvider(textAttachment: self, parentView: parentView,
                                                    textLayoutManager: textContainer?.textLayoutManager, location: location)
        provider.tracksTextAttachmentViewBounds = true
        return provider
    }

    required init?(coder: NSCoder) {
        isChecked = false
        super.init(coder: coder)
    }

    static func side(for font: NSFont) -> CGFloat { (font.pointSize * 1.08).rounded() }

    override func attachmentBounds(for attributes: [NSAttributedString.Key: Any], location: any NSTextLocation,
                                   textContainer: NSTextContainer?, proposedLineFragment: CGRect,
                                   position: CGPoint) -> CGRect {
        let font = attributes[.font] as? NSFont ?? .systemFont(ofSize: 14)
        let side = Self.side(for: font)
        let y = (font.capHeight - side) / 2
        return CGRect(x: 0, y: y.rounded(), width: side + 1, height: side)
    }

    override func image(for bounds: CGRect, attributes: [NSAttributedString.Key: Any], location: any NSTextLocation,
                        textContainer: NSTextContainer?) -> NSImage? {
        Self.image(checked: isChecked, size: bounds.size)
    }

    static func image(checked: Bool, size: CGSize) -> NSImage {
        let side = min(size.width, size.height)
        let config = NSImage.SymbolConfiguration(pointSize: side * 0.86, weight: checked ? .semibold : .regular)
            .applying(.init(paletteColors: checked ? [.white, .controlAccentColor] : [.tertiaryLabelColor]))
        let name = checked ? "checkmark.square.fill" : "square"
        let symbol = NSImage(systemSymbolName: name, accessibilityDescription: nil)?.withSymbolConfiguration(config)
        return NSImage(size: size, flipped: false) { rect in
            guard let symbol else { return false }
            let s = symbol.size
            symbol.draw(in: NSRect(x: rect.midX - s.width / 2 - 0.5, y: rect.midY - s.height / 2, width: s.width, height: s.height))
            return true
        }
    }
}

/// An inline image. The text holds only the attachment's id and a downsampled thumbnail; full
/// images are loaded on demand (Quick Look, copy, save) from `AttachmentStore`.
final class ImageAttachment: NSTextAttachment {
    let attachmentID: UUID
    let pixelSize: CGSize
    let thumbnail: NSImage?

    init(id: UUID, thumbnail: NSImage?, pixelSize: CGSize) {
        attachmentID = id
        self.thumbnail = thumbnail
        self.pixelSize = pixelSize
        super.init(data: nil, ofType: nil)
    }

    override func viewProvider(for parentView: NSView?, location: any NSTextLocation, textContainer: NSTextContainer?) -> NSTextAttachmentViewProvider? {
        let provider = QuickNoteAttachmentViewProvider(textAttachment: self, parentView: parentView,
                                                    textLayoutManager: textContainer?.textLayoutManager, location: location)
        provider.tracksTextAttachmentViewBounds = true
        return provider
    }

    required init?(coder: NSCoder) {
        attachmentID = UUID()
        thumbnail = nil
        pixelSize = .zero
        super.init(coder: coder)
    }

    /// Longest edge used for thumbnails, in points.
    static let maxDisplayWidth: CGFloat = 420

    override func attachmentBounds(for attributes: [NSAttributedString.Key: Any], location: any NSTextLocation,
                                   textContainer: NSTextContainer?, proposedLineFragment: CGRect,
                                   position: CGPoint) -> CGRect {
        let padding = textContainer?.lineFragmentPadding ?? 5
        let available = max(60, proposedLineFragment.width - padding * 2 - 4)
        // While the thumbnail loads, reserve the image's real proportions so the text doesn't jump.
        let natural = thumbnail?.size
            ?? (pixelSize.width > 0 ? CGSize(width: pixelSize.width / 2, height: pixelSize.height / 2) : CGSize(width: 160, height: 100))
        let width = min(available, natural.width, Self.maxDisplayWidth)
        let height = natural.width > 0 ? width * natural.height / natural.width : 100
        return CGRect(x: 0, y: 0, width: width.rounded(), height: min(height, 480).rounded())
    }

    override func image(for bounds: CGRect, attributes: [NSAttributedString.Key: Any], location: any NSTextLocation,
                        textContainer: NSTextContainer?) -> NSImage? {
        let thumb = thumbnail
        return NSImage(size: bounds.size, flipped: false) { rect in
            let path = NSBezierPath(roundedRect: rect.insetBy(dx: 0.5, dy: 0.5), xRadius: 8, yRadius: 8)
            NSGraphicsContext.saveGraphicsState()
            path.addClip()
            if let thumb {
                thumb.draw(in: rect, from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: [.interpolation: NSImageInterpolation.high.rawValue])
            } else {
                NSColor.quaternaryLabelColor.setFill(); rect.fill()
                let icon = NSImage(systemSymbolName: "photo", accessibilityDescription: nil)
                icon?.draw(in: NSRect(x: rect.midX - 12, y: rect.midY - 10, width: 24, height: 20))
            }
            NSGraphicsContext.restoreGraphicsState()
            NSColor.separatorColor.setStroke()
            path.lineWidth = 1
            path.stroke()
            return true
        }
    }
}

enum AttachmentChar {
    static let character: Character = "\u{FFFC}"
    static let string = "\u{FFFC}"
}


// MARK: - TextKit 2 attachment views

/// Hosts Notlet's attachment views (divider, checkbox, image) in TextKit 2 text.
final class QuickNoteAttachmentViewProvider: NSTextAttachmentViewProvider {
    override func loadView() {
        // TextKit calls this on the main thread.
        nonisolated(unsafe) let provider = self
        MainActor.assumeIsolated { provider.makeView() }
    }

    @MainActor
    private func makeView() {
        switch textAttachment {
        case let divider as DividerAttachment:
            view = DividerView(style: divider.style)
        case let box as CheckboxAttachment:
            let v = CheckboxView(checked: box.isChecked)
            v.onToggle = { [weak self] in self?.toggle() }
            view = v
        case let image as ImageAttachment:
            let v = ImageAttachmentView(thumbnail: image.thumbnail)
            v.onOpen = { [weak self] in self?.openImage(image.attachmentID) }
            v.onSelect = { [weak self] in self?.select() }
            view = v
        default:
            view = NSView()
        }
    }

    override func attachmentBounds(for attributes: [NSAttributedString.Key: Any], location: any NSTextLocation,
                                   textContainer: NSTextContainer?, proposedLineFragment: CGRect, position: CGPoint) -> CGRect {
        textAttachment?.attachmentBounds(for: attributes, location: location, textContainer: textContainer,
                                         proposedLineFragment: proposedLineFragment, position: position) ?? .zero
    }

    private var characterIndex: Int? {
        guard let tcm = textLayoutManager?.textContentManager else { return nil }
        return tcm.offset(from: tcm.documentRange.location, to: location)
    }

    @MainActor
    private var textView: QuickNoteTextView? {
        var v: NSView? = view?.superview
        while let current = v {
            if let tv = current as? QuickNoteTextView { return tv }
            v = current.superview
        }
        return nil
    }

    @MainActor
    private func toggle() {
        guard let index = characterIndex, let tv = textView else { return }
        tv.window?.makeFirstResponder(tv)
        tv.toggleCheckbox(at: index)
    }

    @MainActor
    private func select() {
        guard let index = characterIndex, let tv = textView else { return }
        tv.window?.makeFirstResponder(tv)
        tv.setSelectedRange(NSRange(location: index, length: 1))
    }

    @MainActor
    private func openImage(_ id: UUID) {
        textView?.page?.controller?.quickLook(attachmentID: id)
    }
}

final class DividerView: NSView {
    let style: DividerStyle
    init(style: DividerStyle) {
        self.style = style
        super.init(frame: .zero)
        setAccessibilityElement(true)
        setAccessibilityRole(.splitter)
        setAccessibilityLabel(String(localized: "Divider"))
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    override var isFlipped: Bool { true }
    override func draw(_ dirtyRect: NSRect) {
        style.draw(in: bounds, scale: window?.backingScaleFactor ?? 2)
    }
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

final class CheckboxView: NSView {
    var checked: Bool
    var onToggle: (() -> Void)?

    init(checked: Bool) {
        self.checked = checked
        super.init(frame: .zero)
        setAccessibilityElement(true)
        setAccessibilityRole(.checkBox)
        setAccessibilityLabel(String(localized: "Checkbox"))
        setAccessibilityValue(checked ? 1 : 0)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func draw(_ dirtyRect: NSRect) {
        CheckboxAttachment.image(checked: checked, size: bounds.size).draw(in: bounds)
    }
    override func resetCursorRects() { addCursorRect(bounds, cursor: .pointingHand) }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func mouseDown(with event: NSEvent) { onToggle?() }
    override func accessibilityPerformPress() -> Bool { onToggle?(); return true }
}

final class ImageAttachmentView: NSView {
    var onOpen: (() -> Void)?
    var onSelect: (() -> Void)?

    init(thumbnail: NSImage?) {
        super.init(frame: .zero)
        wantsLayer = true
        layer?.cornerRadius = 8
        layer?.cornerCurve = .continuous
        layer?.masksToBounds = true
        layer?.borderWidth = 1
        layer?.contentsGravity = .resizeAspectFill
        if let thumbnail { layer?.contents = thumbnail.cgImage(forProposedRect: nil, context: nil, hints: nil) }
        setAccessibilityElement(true)
        setAccessibilityRole(.image)
        setAccessibilityLabel(String(localized: "Image. Double-click to open in Quick Look."))
        toolTip = String(localized: "Double-click to Quick Look")
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func updateLayer() {
        layer?.borderColor = NSColor.separatorColor.cgColor
        layer?.backgroundColor = NSColor.quaternaryLabelColor.cgColor
    }
    override var wantsUpdateLayer: Bool { true }
    override func resetCursorRects() { addCursorRect(bounds, cursor: .pointingHand) }
    override func mouseDown(with event: NSEvent) {
        if event.clickCount >= 2 { onOpen?() } else { onSelect?() }
    }
    override func rightMouseDown(with event: NSEvent) {
        onSelect?()
        super.rightMouseDown(with: event)
    }
}
