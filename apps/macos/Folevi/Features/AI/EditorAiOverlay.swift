import AppKit
import SwiftUI

/// The note's floating AI, laid over the page and following the text as it scrolls (the web renders these
/// in the top layer): the inline composer right under the text it's about (or above when there's no room),
/// and the title's "Edit with AI" pill and menu under the title.
struct EditorAiOverlay: View {
    var editor: EditorModel
    @State private var box = AiOverlayAnchorBox()
    /// Bumped when the page scrolls, so the floating pieces follow their text.
    @State private var tick = 0
    @State private var composerHeight: CGFloat = 260

    private var ai: EditorAi { editor.ai }

    private var showPill: Bool {
        editor.aiWritable && ai.titleRange == nil && editor.focusedBlockId == "__title__" && (ai.titleSelection?.length ?? 0) > 0
    }

    var body: some View {
        GeometryReader { geo in
            let _ = tick
            // Each piece sits at a layout position from the top left (anything above the top stays at the top).
            ZStack(alignment: .topLeading) {
                Color.clear
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
                if let composer = ai.composer {
                    let frame = composerFrame(composer, size: geo.size)
                    InlineAiComposer(model: composer, width: frame.width)
                        .id(composer.id)
                        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { composerHeight = $0 }
                        .placed(at: frame.left, frame.top)
                        .transition(.opacity)
                }
                if let range = ai.titleRange, editor.aiWritable {
                    let at = titlePosition(size: geo.size)
                    TitleAiMenu(model: editor, range: range)
                        .background(OutsideClickWatcher { editor.ai.titleRange = nil })
                        .placed(at: at.left, at.top)
                        .transition(.opacity)
                } else if showPill, case let at = titlePosition(size: geo.size), at.top >= 0 {
                    TitleAiPill { if let r = ai.titleSelection { editor.openTitleAi(range: r) } }
                        .placed(at: at.left, at.top)
                        .transition(.opacity)
                }
            }
            .frame(width: geo.size.width, height: geo.size.height, alignment: .topLeading)
        }
        // The overlay's coordinates in AppKit, for placing things at the text.
        .background(AiOverlayAnchor(box: box).allowsHitTesting(false).accessibilityHidden(true))
        .onReceive(NotificationCenter.default.publisher(for: NSView.boundsDidChangeNotification)) { note in
            guard ai.composer != nil || ai.titleRange != nil || showPill,
                  let clip = editor.drag.anchor?.enclosingScrollView?.contentView, (note.object as AnyObject?) === clip else { return }
            tick &+= 1
        }
        .onChange(of: ai.composer?.id) { _, _ in tick &+= 1 }
    }

    // MARK: Where things go

    /// The composer: under the caret, the selection's end or the selected blocks; as wide as the text column.
    private func composerFrame(_ composer: InlineAiModel, size: CGSize) -> InlineAiPlacement.Frame {
        let h = Double(composerHeight)
        if let anchor = box.view, let caret = caretRect(composer), let column = columnRect() {
            let c = anchor.convert(caret, from: nil)
            let col = anchor.convert(column, from: nil)
            return InlineAiPlacement.place(caretTop: c.minY, caretBottom: c.maxY, columnLeft: col.minX, columnWidth: col.width,
                                           viewportWidth: size.width, viewportHeight: size.height, height: h)
        }
        // The text isn't on screen: keep the composer in view, centered near the bottom.
        let width = min(640, max(320, size.width - 48))
        return InlineAiPlacement.Frame(left: max(8, (size.width - width) / 2), top: max(8, size.height - h - 96), width: width, up: true)
    }

    private func caretRect(_ composer: InlineAiModel) -> CGRect? {
        switch composer.target {
        case .text(let blockId, let range, _):
            if let tv = editor.textView(blockId) { return Self.caret(in: tv, at: NSMaxRange(range)) }
            return rowRect(blockId)
        case .blocks(let ids, _):
            return ids.last.flatMap(rowRect)
        case .none:
            guard let id = composer.cursorBlockId else { return nil }
            if let tv = editor.textView(id) { return Self.caret(in: tv, at: NSMaxRange(tv.selectedRange())) }
            return rowRect(id)
        }
    }

    /// The caret's rectangle at `location`, in window coordinates.
    static func caret(in tv: NSTextView, at location: Int) -> CGRect? {
        guard let window = tv.window else { return nil }
        let at = min(max(0, location), (tv.string as NSString).length)
        let screen = tv.firstRect(forCharacterRange: NSRange(location: at, length: 0), actualRange: nil)
        if screen == .zero || screen.height <= 0 { return tv.convert(tv.bounds, to: nil) }
        return window.convertFromScreen(screen)
    }

    /// A block's row, in window coordinates.
    private func rowRect(_ id: String) -> CGRect? {
        guard let anchor = editor.drag.anchor, let f = editor.drag.rowFrames[id] else { return nil }
        return anchor.convert(f, to: nil)
    }

    /// The page's text column (the blocks, without the hover gutter), in window coordinates.
    private func columnRect() -> CGRect? {
        guard let anchor = editor.drag.anchor else { return nil }
        var r = anchor.bounds
        r.origin.x += BlockMetrics.gutter
        r.size.width = max(0, r.size.width - BlockMetrics.gutter)
        return anchor.convert(r, to: nil)
    }

    /// The title's AI: 8 points under the title, at its left.
    private func titlePosition(size: CGSize) -> (left: CGFloat, top: CGFloat) {
        guard let anchor = box.view, let tv = editor.textView("__title__") else { return (16, 16) }
        let r = anchor.convert(tv.convert(tv.bounds, to: nil), from: nil)
        let at = InlineAiPlacement.belowTitle(titleLeft: r.minX, titleBottom: r.maxY, viewportWidth: size.width)
        return (at.left, at.top)
    }
}

private extension View {
    /// Lays the view out at (`x`, `y`) of a top-leading ZStack (a layout position, so its fields and the
    /// click watcher move with it).
    func placed(at x: CGFloat, _ y: CGFloat) -> some View {
        alignmentGuide(.leading) { _ in -x }
            .alignmentGuide(.top) { _ in -y }
    }
}

/// The overlay's own coordinates in AppKit (flipped, origin top left).
@MainActor
final class AiOverlayAnchorBox {
    weak var view: NSView?
}

struct AiOverlayAnchor: NSViewRepresentable {
    let box: AiOverlayAnchorBox

    func makeNSView(context: Context) -> PassthroughView {
        let v = PassthroughView()
        box.view = v
        return v
    }

    func updateNSView(_ nsView: PassthroughView, context: Context) {
        if box.view !== nsView { box.view = nsView }
    }

    /// Takes no clicks and isn't announced: only its coordinates matter.
    final class PassthroughView: NSView {
        override var isFlipped: Bool { true }
        override func hitTest(_ point: NSPoint) -> NSView? { nil }
        override func isAccessibilityElement() -> Bool { false }
    }
}

/// Calls `onOutside` when the mouse goes down in this window outside the view it's the background of
/// (the web closes its floating menus and threads on a pointerdown elsewhere). Menus and lists opened from
/// the view are windows of their own, so clicks in them don't count. `reveals` scrolls it into view once.
struct OutsideClickWatcher: NSViewRepresentable {
    var reveals = false
    var onOutside: () -> Void

    func makeNSView(context: Context) -> WatcherView {
        let v = WatcherView()
        v.onOutside = onOutside
        v.reveals = reveals
        return v
    }

    func updateNSView(_ nsView: WatcherView, context: Context) {
        nsView.onOutside = onOutside
    }

    static func dismantleNSView(_ nsView: WatcherView, coordinator: ()) {
        nsView.stop()
    }

    final class WatcherView: NSView {
        var onOutside: (() -> Void)?
        var reveals = false
        nonisolated(unsafe) private var monitor: Any?
        private var revealed = false

        override func hitTest(_ point: NSPoint) -> NSView? { nil }
        override func isAccessibilityElement() -> Bool { false }

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            stop()
            guard window != nil else { return }
            monitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] event in
                let location = event.locationInWindow
                let eventWindow = event.window
                MainActor.assumeIsolated {
                    guard let self, let window = self.window, eventWindow === window else { return }
                    let p = self.convert(location, from: nil)
                    guard !self.bounds.contains(p) else { return }
                    let callback = self.onOutside
                    DispatchQueue.main.async { callback?() }
                }
                return event
            }
            if reveals && !revealed {
                revealed = true
                DispatchQueue.main.async { [weak self] in
                    guard let self, self.window != nil else { return }
                    self.scrollToVisible(self.bounds.insetBy(dx: 0, dy: -12))
                }
            }
        }

        func stop() {
            if let monitor { NSEvent.removeMonitor(monitor) }
            monitor = nil
        }

        deinit {
            if let monitor { NSEvent.removeMonitor(monitor) }
        }
    }
}
