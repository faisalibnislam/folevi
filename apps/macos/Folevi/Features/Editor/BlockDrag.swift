import AppKit
import Observation
import SwiftUI

/// Pointer-driven block drag and drop (docs/DESIGN_SYSTEM.md › Drag and drop):
///
/// 1. Press the grip and move 4pt → the block and its nested children lift: a snapshot copy follows
///    the pointer (1.02 scale, −0.6°, lift shadow, 96% opacity) and the source fades to 35%.
/// 2. A 3pt ember drop line glides (120ms) between blocks, its leading edge at the target indent;
///    every 24pt of horizontal pointer travel nests/un-nests (0…one deeper than the block above).
/// 3. Within 64pt of the scroll view's top/bottom the page auto-scrolls, faster nearer the edge.
/// 4. Release → one undoable move (a position change for sync), then the moved block glows ember-soft
///    for 700ms. Escape cancels and the copy glides back to where it came from.
/// 5. Insert tiles use the same lift, line and nesting; releasing outside the page cancels.
/// 6. Reduce Motion: no tilt/scale/glide; the line jumps; the glow becomes a static tint.
///
/// A SwiftUI gesture only *starts* the drag (after 4pt); from then on local NSEvent monitors drive it,
/// so it follows every mouse event at the display's refresh rate and survives row re-renders.
@MainActor
@Observable
final class BlockDragController {
    enum Payload: Equatable {
        case blocks(roots: [String])
        case insert(type: String, title: String, systemImage: String)
    }

    struct Ghost: Equatable {
        var image: NSImage?
        var size: CGSize
        /// Pointer position inside the ghost (so it stays under the same spot of the copy).
        var grab: CGPoint
        /// Where the source sat, in overlay (window content) coordinates.
        var origin: CGPoint
        var title: String
        var systemImage: String?
        var isChip: Bool
    }

    struct Line: Equatable {
        var x: CGFloat
        var y: CGFloat
        var width: CGFloat
        /// The visible editor area (window-content coordinates); the line never draws outside it.
        var clip: CGRect = .infinite
    }

    // Observed: rows read `draggedIds`, the drop line reads `line`, the overlay reads the rest.
    private(set) var payload: Payload?
    private(set) var draggedIds: Set<String> = []
    private(set) var ghost: Ghost?
    /// Pointer in overlay (window content) coordinates.
    private(set) var pointer: CGPoint = .zero
    private(set) var line: Line?
    private(set) var isReturning = false
    private(set) var glow: (id: String, token: Int)?

    // Not observed.
    @ObservationIgnored weak var model: EditorModel?
    @ObservationIgnored var rowFrames: [String: CGRect] = [:]
    @ObservationIgnored weak var anchor: NSView?
    @ObservationIgnored var indentStep: CGFloat = 24
    @ObservationIgnored private var start: CGPoint = .zero
    @ObservationIgnored private var originalDepth = 0
    @ObservationIgnored private var placement: BlockDrop.Placement?
    @ObservationIgnored private var monitors: [Any] = []
    @ObservationIgnored private var timer: Timer?
    @ObservationIgnored private var lastTick: CFTimeInterval = 0
    @ObservationIgnored private var glowCounter = 0
    @ObservationIgnored private var remaining: [BlockDrop.Row] = []
    @ObservationIgnored private var cursorPushed = false

    static let liftScale: CGFloat = 1.02
    static let liftRotation: Double = -0.6
    static let edge: CGFloat = 64
    static let maxScrollSpeed: CGFloat = 1600 // pt/s at the very edge

    var isActive: Bool { payload != nil }

    private var reduceMotion: Bool { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }

    // MARK: Begin

    /// Starts dragging a block (and its selection, if the block is part of it).
    /// `start`/`current` are the gesture's locations in window-content (SwiftUI global) coordinates.
    func beginBlockDrag(blockId: String, start startPoint: CGPoint, current: CGPoint) {
        guard let model, !isActive, !model.isReadOnly, let window = anchor?.window else { return }
        let roots = rootIds(for: blockId, model: model)
        guard !roots.isEmpty else { return }
        let rows = model.dropRows
        remaining = BlockDrop.remaining(rows, dragging: Set(roots))
        let rootSet = Set(roots)
        var moving: Set<String> = []
        var skipDeeper: Int?
        for r in rows {
            if let d = skipDeeper, r.depth > d { moving.insert(r.id); continue }
            skipDeeper = nil
            if rootSet.contains(r.id) { moving.insert(r.id); skipDeeper = r.depth }
        }
        originalDepth = rows.first { $0.id == roots[0] }?.depth ?? 0
        let p = (overlay: current, window: current)
        start = startPoint

        // Snapshot the lifted rows before they fade.
        let frames = rows.filter { moving.contains($0.id) }.compactMap { rowFrames[$0.id] }
        var ghost = Ghost(image: nil, size: CGSize(width: 240, height: 40), grab: CGPoint(x: 24, y: 18), origin: p.overlay,
                          title: "", systemImage: nil, isChip: false)
        if let union = frames.reduce(nil, { (acc: CGRect?, r: CGRect) in acc.map { $0.union(r) } ?? r }),
           let anchor, let content = window.contentView {
            let capped = CGRect(x: union.minX, y: union.minY, width: union.width, height: min(union.height, 260))
            let inContent = content.convert(capped, from: anchor)
            let padded = inContent.insetBy(dx: -14, dy: -6)
            ghost.image = Self.snapshot(content, rect: inContent)
            ghost.size = padded.size
            ghost.origin = padded.origin
            // Keep the copy under the spot that was grabbed.
            ghost.grab = CGPoint(x: startPoint.x - padded.minX, y: startPoint.y - padded.minY)
        }
        if let block = model.blocks[roots[0]] {
            ghost.title = RichText.plainText(block.text).isEmpty ? BlockStyles.accessibilityName(block) : String(RichText.plainText(block.text).prefix(60))
        }
        begin(.blocks(roots: roots), ghost: ghost, pointer: p.overlay, dragged: moving)
        AccessibilityNotification.Announcement(String(localized: "Moving block. Press Escape to cancel.")).post()
    }

    /// Starts dragging an Insert tile into the page.
    func beginInsertDrag(type: String, title: String, systemImage: String, at point: CGPoint) {
        guard let model, !isActive, !model.isReadOnly else { return }
        remaining = model.dropRows
        originalDepth = 0
        let p = (overlay: point, window: point)
        start = point
        let size = CGSize(width: max(120, CGFloat(title.count) * 7.6 + 64), height: 38)
        let ghost = Ghost(image: nil, size: size, grab: CGPoint(x: 26, y: 19), origin: CGPoint(x: p.overlay.x - 26, y: p.overlay.y - 19),
                          title: title, systemImage: systemImage, isChip: true)
        begin(.insert(type: type, title: title, systemImage: systemImage), ghost: ghost, pointer: p.overlay, dragged: [])
    }

    private func begin(_ payload: Payload, ghost: Ghost, pointer: CGPoint, dragged: Set<String>) {
        var t = Transaction()
        t.disablesAnimations = true
        withTransaction(t) {
            self.payload = payload
            self.ghost = ghost
            self.pointer = pointer
            self.isReturning = false
            self.line = nil
        }
        withAnimation(reduceMotion ? nil : .easeOut(duration: FoleviMotion.fast)) {
            self.draggedIds = dragged
        }
        NSCursor.closedHand.push()
        cursorPushed = true
        installMonitors()
        startTimer()
        update()
    }

    // MARK: Tracking

    private func installMonitors() {
        removeMonitors()
        let drag = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDragged, .mouseMoved]) { [weak self] event in
            let location = event.locationInWindow
            let windowNumber = event.windowNumber
            MainActor.assumeIsolated { self?.pointerMoved(location, windowNumber: windowNumber) }
            return event
        }
        let up = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseUp]) { [weak self] event in
            MainActor.assumeIsolated { self?.finish() }
            return event
        }
        let keys = NSEvent.addLocalMonitorForEvents(matching: [.keyDown]) { [weak self] event in
            let isEscape = event.keyCode == 53
            let swallow = MainActor.assumeIsolated { () -> Bool in
                guard let self, self.isActive else { return false }
                if isEscape { self.cancel() }
                return true // Escape cancels; other keys are ignored while dragging
            }
            return swallow ? nil : event
        }
        monitors = [drag, up, keys].compactMap { $0 }
    }

    private func removeMonitors() {
        monitors.forEach(NSEvent.removeMonitor)
        monitors = []
    }

    private func pointerMoved(_ location: CGPoint, windowNumber: Int) {
        guard isActive, !isReturning, let window = anchor?.window, window.windowNumber == windowNumber, let content = window.contentView else { return }
        let p = content.convert(location, from: nil)
        var t = Transaction()
        t.disablesAnimations = true
        withTransaction(t) { pointer = p }
        update()
    }

    /// Recomputes the drop target from the pointer.
    private func update() {
        guard isActive, let anchor, let window = anchor.window, let content = window.contentView else { return }
        let inBlocks = anchor.convert(pointer, from: content)
        guard insideDropArea(window: window) else {
            placement = nil
            setLine(nil)
            return
        }
        let mids = remaining.map { r -> Double in
            guard let f = rowFrames[r.id] else { return .greatestFiniteMagnitude }
            return Double(f.midY)
        }
        let gap = BlockDrop.gap(forY: Double(inBlocks.y), midpoints: mids)
        let range = BlockDrop.depthRange(remaining: remaining, gap: gap)
        let depth: Int
        switch payload {
        case .blocks:
            depth = BlockDrop.depth(original: originalDepth, horizontalOffset: Double(pointer.x - start.x), step: Double(indentStep), in: range)
        default:
            let desired = Int(max(0, inBlocks.x - BlockMetrics.gutter + indentStep * 0.5) / indentStep)
            depth = min(max(desired, range.lowerBound), range.upperBound)
        }
        placement = BlockDrop.placement(remaining: remaining, gap: gap, depth: depth)

        // Line geometry in the blocks column.
        let y: CGFloat
        let frames = remaining.compactMap { rowFrames[$0.id] }
        if frames.isEmpty {
            y = 0
        } else if gap == 0 {
            y = (rowFrames[remaining[0].id]?.minY ?? 0) - 1
        } else if gap >= remaining.count {
            y = (rowFrames[remaining[remaining.count - 1].id]?.maxY ?? 0) + 1
        } else {
            let above = rowFrames[remaining[gap - 1].id]?.maxY ?? 0
            let below = rowFrames[remaining[gap].id]?.minY ?? above
            y = (above + below) / 2
        }
        let width = anchor.bounds.width
        let x = BlockMetrics.gutter + CGFloat(depth) * indentStep
        // The line is drawn in the window overlay, above the lifted copy, so it's never hidden by it.
        let origin = content.convert(CGPoint(x: x, y: y), from: anchor)
        let clip = anchor.enclosingScrollView.map { content.convert($0.bounds, from: $0) } ?? .infinite
        setLine(Line(x: origin.x, y: origin.y, width: max(40, width - x), clip: clip))
    }

    private func setLine(_ newLine: Line?) {
        guard newLine != line else { return }
        if line == nil || newLine == nil || reduceMotion {
            var t = Transaction()
            t.disablesAnimations = true
            withTransaction(t) { line = newLine }
        } else {
            withAnimation(.timingCurve(0.2, 0.7, 0.2, 1, duration: 0.12)) { line = newLine }
        }
    }

    /// The drop area is the editor's scroll view (plus a little slack at its sides).
    private func insideDropArea(window: NSWindow) -> Bool {
        guard let anchor, let scroll = anchor.enclosingScrollView, let content = window.contentView else { return true }
        let frame = content.convert(scroll.bounds, from: scroll).insetBy(dx: -8, dy: -8)
        return frame.contains(pointer)
    }

    // MARK: Auto-scroll

    private func startTimer() {
        timer?.invalidate()
        lastTick = CACurrentMediaTime()
        let t = Timer(timeInterval: 1.0 / 120.0, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
        RunLoop.main.add(t, forMode: .common)
        timer = t
    }

    private func tick() {
        let now = CACurrentMediaTime()
        let dt = min(0.05, now - lastTick)
        lastTick = now
        guard isActive, !isReturning, let anchor, let scroll = anchor.enclosingScrollView, let content = anchor.window?.contentView else { return }
        let visible = content.convert(scroll.bounds, from: scroll) // overlay coords (flipped)
        guard pointer.x >= visible.minX - 40, pointer.x <= visible.maxX + 40 else { return }
        let fromTop = pointer.y - visible.minY
        let fromBottom = visible.maxY - pointer.y
        var velocity: CGFloat = 0
        if fromTop < Self.edge {
            let k = min(1, (Self.edge - max(fromTop, -Self.edge)) / Self.edge)
            velocity = -Self.maxScrollSpeed * k * k
        } else if fromBottom < Self.edge {
            let k = min(1, (Self.edge - max(fromBottom, -Self.edge)) / Self.edge)
            velocity = Self.maxScrollSpeed * k * k
        }
        guard velocity != 0, let doc = scroll.documentView else { return }
        let clip = scroll.contentView
        var origin = clip.bounds.origin
        let maxY = max(0, doc.frame.height - clip.bounds.height)
        let delta = velocity * CGFloat(dt)
        // The clip view is flipped for SwiftUI documents; fall back to AppKit's sign otherwise.
        origin.y = clip.isFlipped ? origin.y + delta : origin.y - delta
        origin.y = min(max(0, origin.y), maxY)
        guard origin.y != clip.bounds.origin.y else { return }
        clip.scroll(to: origin)
        scroll.reflectScrolledClipView(clip)
        update()
    }

    // MARK: End

    private func finish() {
        guard isActive, !isReturning else { return }
        let payload = self.payload
        let placement = self.placement
        guard let placement, let model else {
            cancel()
            return
        }
        var movedId: String?
        switch payload {
        case .blocks(let roots):
            let nodes = model.allNodes()
            if BlockDrop.isNoOp(nodes, root: roots[0], placement: placement, dragged: Set(roots)) && roots.count == 1 {
                cancel()
                return
            }
            if model.dropBlocks(roots, at: placement) { movedId = roots[0] }
        case .insert(let type, _, _):
            movedId = model.insertBlock(type: type, at: placement)
        case nil:
            break
        }
        end()
        if let movedId { flash(movedId) }
    }

    /// Escape (or a drop outside the page): the copy glides back, nothing changes.
    func cancel() {
        guard isActive else { return }
        stopTracking()
        setLine(nil)
        placement = nil
        guard let ghost, !reduceMotion, case .blocks = payload else {
            end()
            return
        }
        isReturning = true
        withAnimation(.timingCurve(0.2, 0.7, 0.2, 1, duration: FoleviMotion.slow)) {
            pointer = CGPoint(x: ghost.origin.x + ghost.grab.x, y: ghost.origin.y + ghost.grab.y)
        } completion: { [weak self] in
            self?.end()
        }
    }

    private func stopTracking() {
        removeMonitors()
        timer?.invalidate()
        timer = nil
        if cursorPushed {
            NSCursor.pop()
            cursorPushed = false
        }
    }

    private func end() {
        stopTracking()
        var t = Transaction()
        t.disablesAnimations = true
        withTransaction(t) {
            payload = nil
            ghost = nil
            line = nil
            isReturning = false
        }
        withAnimation(reduceMotion ? nil : .easeOut(duration: FoleviMotion.fast)) { draggedIds = [] }
        placement = nil
        remaining = []
    }

    private func flash(_ id: String) {
        glowCounter += 1
        glow = (id, glowCounter)
        let token = glowCounter
        Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(760))
            if self?.glow?.token == token { self?.glow = nil }
        }
    }

    // MARK: Helpers

    private func rootIds(for blockId: String, model: EditorModel) -> [String] {
        guard model.selectedBlockIds.contains(blockId), model.selectedBlockIds.count > 1 else { return [blockId] }
        // Only the top-most selected blocks move; their children come along.
        let ordered = model.orderedByRows(Array(model.selectedBlockIds))
        let selected = Set(ordered)
        return ordered.filter { id in
            var cursor = model.blocks[id]?.parentId
            while let c = cursor {
                if selected.contains(c) { return false }
                cursor = model.blocks[c]?.parentId
            }
            return true
        }
    }

    /// Renders a region of the window's content (overlay coordinates) into an image.
    static func snapshot(_ content: NSView, rect: CGRect) -> NSImage? {
        guard rect.width >= 1, rect.height >= 1, let layer = content.layer else { return nil }
        let scale = content.window?.backingScaleFactor ?? 2
        let w = Int(ceil(rect.width * scale)), h = Int(ceil(rect.height * scale))
        guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        ctx.scaleBy(x: scale, y: scale)
        if content.isFlipped {
            // Draw top-down: flip the context so the layer tree (flipped geometry) lands upright.
            ctx.translateBy(x: 0, y: rect.height)
            ctx.scaleBy(x: 1, y: -1)
            ctx.translateBy(x: -rect.minX, y: -rect.minY)
        } else {
            ctx.translateBy(x: -rect.minX, y: -(content.bounds.height - rect.maxY))
        }
        layer.render(in: ctx)
        guard let cg = ctx.makeImage() else { return nil }
        return NSImage(cgImage: cg, size: rect.size)
    }
}

// MARK: - Anchor (the blocks column's coordinate space in AppKit)

/// A zero-interaction NSView filling the blocks column. Its (flipped) coordinates equal the SwiftUI
/// named space `"blocks"`, so pointer positions convert straight into row frames (and back out to the
/// window for the drop line).
struct BlocksAnchor: NSViewRepresentable {
    var controller: BlockDragController

    func makeNSView(context: Context) -> AnchorView {
        let v = AnchorView()
        controller.anchor = v
        return v
    }

    func updateNSView(_ nsView: AnchorView, context: Context) {
        if controller.anchor !== nsView { controller.anchor = nsView }
    }

    final class AnchorView: NSView {
        override var isFlipped: Bool { true }
        override func hitTest(_ point: NSPoint) -> NSView? { nil }
        override func isAccessibilityElement() -> Bool { false }
    }
}

// MARK: - Drop line

/// 3pt ember line with round caps and a soft halo; a small ring marks its leading edge.
struct DropLineView: View {
    var controller: BlockDragController
    /// The overlay's origin in window-content coordinates.
    var origin: CGPoint = .zero

    var body: some View {
        if let line = controller.line {
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(FoleviColor.ember)
                    .frame(width: line.width, height: 3)
                    .background(Capsule().fill(FoleviColor.ember.opacity(0.2)).padding(-3))
                Circle()
                    .fill(FoleviColor.surface)
                    .overlay(Circle().strokeBorder(FoleviColor.ember, lineWidth: 2.5))
                    .frame(width: 10, height: 10)
                    .offset(x: -5)
            }
            .frame(width: line.width, height: 10, alignment: .leading)
            .position(x: line.x - origin.x + line.width / 2, y: line.y - origin.y)
            .mask {
                if line.clip.isInfinite {
                    Color.black
                } else {
                    Rectangle()
                        .frame(width: line.clip.width + 16, height: line.clip.height)
                        .position(x: line.clip.midX - origin.x, y: line.clip.midY - origin.y)
                }
            }
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
    }
}

// MARK: - Lifted copy (window overlay)

struct BlockDragOverlay: View {
    var controller: BlockDragController?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        GeometryReader { geo in
            if let controller, let ghost = controller.ghost {
                let origin = geo.frame(in: .global).origin
                let lifted = !controller.isReturning && !reduceMotion
                GhostView(ghost: ghost)
                    .scaleEffect(lifted ? BlockDragController.liftScale : 1, anchor: UnitPoint(x: ghost.grab.x / max(1, ghost.size.width), y: ghost.grab.y / max(1, ghost.size.height)))
                    .rotationEffect(.degrees(lifted ? BlockDragController.liftRotation : 0))
                    .opacity(0.96)
                    .animation(reduceMotion ? nil : .timingCurve(0.2, 0.7, 0.2, 1, duration: 0.15), value: lifted)
                    .position(x: controller.pointer.x - ghost.grab.x + ghost.size.width / 2 - origin.x,
                              y: controller.pointer.y - ghost.grab.y + ghost.size.height / 2 - origin.y)
                    .transition(.identity)
            }
            if let controller {
                DropLineView(controller: controller, origin: geo.frame(in: .global).origin)
            }
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

private struct GhostView: View {
    var ghost: BlockDragController.Ghost

    var body: some View {
        Group {
            if ghost.isChip {
                HStack(spacing: 8) {
                    if let icon = ghost.systemImage {
                        Image(systemName: icon).font(.system(size: 13, weight: .semibold)).foregroundStyle(FoleviColor.ember)
                    }
                    Text(ghost.title).font(.ui(13, .semibold)).foregroundStyle(FoleviColor.heading).lineLimit(1)
                }
                .padding(.horizontal, 16)
                .frame(width: ghost.size.width, height: ghost.size.height)
                .foleviSurface(.color(FoleviColor.surface), shape: .capsule, shadow: FoleviShadow.lift)
            } else if let image = ghost.image {
                Image(nsImage: image)
                    .resizable()
                    .interpolation(.high)
                    .frame(width: ghost.size.width - 28, height: ghost.size.height - 12)
                    .mask(LinearGradient(stops: [.init(color: .black, location: 0), .init(color: .black, location: ghost.size.height > 200 ? 0.78 : 1),
                                                 .init(color: .black.opacity(ghost.size.height > 200 ? 0 : 1), location: 1)],
                                         startPoint: .top, endPoint: .bottom))
                    .padding(.horizontal, 14)
                    .padding(.vertical, 6)
                    .frame(width: ghost.size.width, height: ghost.size.height)
                    .foleviSurface(.color(FoleviColor.surface), shape: .rounded(14), shadow: FoleviShadow.lift)
            } else {
                Text(ghost.title)
                    .font(.ui(14))
                    .foregroundStyle(FoleviColor.ink)
                    .lineLimit(1)
                    .padding(.horizontal, 14)
                    .frame(width: ghost.size.width, height: ghost.size.height, alignment: .leading)
                    .foleviSurface(.color(FoleviColor.surface), shape: .rounded(14), shadow: FoleviShadow.lift)
            }
        }
    }
}

// MARK: - Press/drag source (grip, Insert tiles)

/// An AppKit view that turns a real mouse press into either a click or — after `threshold` points of
/// movement — the start of a drag. AppKit delivers mouseDown/mouseDragged straight to this view, so a
/// press always works (first mouse included) and never competes with SwiftUI gestures. It also reports
/// hover so the gutter stays visible while the pointer is on it. Hidden from accessibility: the SwiftUI
/// element underneath carries the label and actions.
struct PointerDragSource: NSViewRepresentable {
    var threshold: CGFloat = 4
    var cursor: NSCursor = .openHand
    var help: String?
    var onHover: (Bool) -> Void = { _ in }
    var onClick: () -> Void
    /// Start and current pointer, in window-content (SwiftUI global) coordinates.
    var onDragStart: (CGPoint, CGPoint) -> Void

    func makeNSView(context: Context) -> TrackerView {
        let v = TrackerView()
        update(v)
        return v
    }

    func updateNSView(_ nsView: TrackerView, context: Context) { update(nsView) }

    private func update(_ v: TrackerView) {
        v.threshold = threshold
        v.cursor = cursor
        v.toolTip = help
        v.onHover = onHover
        v.onClick = onClick
        v.onDragStart = onDragStart
    }

    final class TrackerView: NSView {
        var threshold: CGFloat = 4
        var cursor: NSCursor = .openHand
        var onHover: (Bool) -> Void = { _ in }
        var onClick: () -> Void = {}
        var onDragStart: (CGPoint, CGPoint) -> Void = { _, _ in }
        private var downPoint: NSPoint?
        private var started = false

        override var isFlipped: Bool { true }
        override var mouseDownCanMoveWindow: Bool { false }
        override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
        override func isAccessibilityElement() -> Bool { false }

        override func updateTrackingAreas() {
            super.updateTrackingAreas()
            trackingAreas.forEach(removeTrackingArea)
            addTrackingArea(NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeInActiveApp, .inVisibleRect, .cursorUpdate],
                                           owner: self, userInfo: nil))
        }

        override func mouseEntered(with event: NSEvent) { onHover(true) }
        override func mouseExited(with event: NSEvent) { onHover(false) }
        override func cursorUpdate(with event: NSEvent) { cursor.set() }

        override func mouseDown(with event: NSEvent) {
            downPoint = event.locationInWindow
            started = false
        }

        override func mouseDragged(with event: NSEvent) {
            guard let down = downPoint, !started else { return }
            let p = event.locationInWindow
            guard hypot(p.x - down.x, p.y - down.y) >= threshold, let content = window?.contentView else { return }
            started = true
            onDragStart(content.convert(down, from: nil), content.convert(p, from: nil))
        }

        override func mouseUp(with event: NSEvent) {
            if downPoint != nil, !started { onClick() }
            downPoint = nil
            started = false
        }
    }
}

// MARK: - Native block options menu (the grip is also a button)

final class ClosureMenuItem: NSMenuItem {
    private let handler: () -> Void

    init(_ title: String, key: String = "", modifiers: NSEvent.ModifierFlags = [], enabled: Bool = true, handler: @escaping () -> Void) {
        self.handler = handler
        super.init(title: title, action: #selector(run), keyEquivalent: key)
        keyEquivalentModifierMask = modifiers
        target = self
        isEnabled = enabled
    }

    @available(*, unavailable)
    required init(coder: NSCoder) { fatalError() }

    @objc private func run() { handler() }
}
