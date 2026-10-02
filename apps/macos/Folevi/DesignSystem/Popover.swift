import AppKit
import SwiftUI

/// Popovers drawn inside the window, as the web draws its menus, selects and panels: no arrow, the
/// panel's edge lined up with its button (start or end), a few points below it (above when there's more
/// room there), kept 8pt inside the window, the web's glass pop. An outside click closes it and still
/// reaches what was clicked; Escape closes the newest. Windows without a host (sheets, small windows) keep
/// the system popover.
enum FoleviPopoverAlign: Sendable { case start, end }

@MainActor
@Observable
final class FoleviPopoverCoordinator {
    struct Entry: Identifiable {
        let id: UUID
        var anchor: CGRect
        var above: Bool
        var align: FoleviPopoverAlign
        var gap: CGFloat
        var radius: CGFloat
        var content: AnyView
        var dismiss: () -> Void
    }

    fileprivate(set) var entries: [Entry] = []
    /// Where each panel landed, in the layer's space (for outside clicks).
    @ObservationIgnored fileprivate var panelFrames: [UUID: CGRect] = [:]
    /// The layer's origin in SwiftUI's global space (anchors are measured there).
    @ObservationIgnored fileprivate var origin: CGPoint = .zero
    @ObservationIgnored fileprivate weak var window: NSWindow?

    func present(_ entry: Entry) {
        if let i = entries.firstIndex(where: { $0.id == entry.id }) { entries[i] = entry } else { entries.append(entry) }
    }

    func move(_ id: UUID, anchor: CGRect) {
        guard let i = entries.firstIndex(where: { $0.id == id }), entries[i].anchor != anchor else { return }
        entries[i].anchor = anchor
    }

    func remove(_ id: UUID) {
        entries.removeAll { $0.id == id }
        panelFrames[id] = nil
    }

    func isHost(of window: NSWindow?) -> Bool { window != nil && window === self.window }

    fileprivate func dismissTop() {
        guard let top = entries.last else { return }
        top.dismiss()
        remove(top.id)
    }

    /// Closes every panel the point (in the layer's space) is outside of, newest first, unless it's on the
    /// panel's own button (which toggles it).
    fileprivate func mouseDown(at point: CGPoint) {
        for entry in entries.reversed() {
            let anchor = entry.anchor.offsetBy(dx: -origin.x, dy: -origin.y)
            if panelFrames[entry.id]?.contains(point) == true || anchor.contains(point) { return }
            entry.dismiss()
            remove(entry.id)
        }
    }
}

extension EnvironmentValues {
    @Entry var foleviPopovers: FoleviPopoverCoordinator? = nil
}

extension View {
    /// The window's popover layer. Apply right on the window's root view, inside its environment.
    func foleviPopoverHost() -> some View { modifier(FoleviPopoverHost()) }
}

private struct FoleviPopoverHost: ViewModifier {
    @State private var coordinator = FoleviPopoverCoordinator()

    func body(content: Content) -> some View {
        content
            .environment(\.foleviPopovers, coordinator)
            .overlay { FoleviPopoverLayer(coordinator: coordinator) }
    }
}

private struct FoleviPopoverLayer: View {
    let coordinator: FoleviPopoverCoordinator

    var body: some View {
        GeometryReader { geo in
            let size = geo.size
            ZStack(alignment: .topLeading) {
                Color.clear
                ForEach(coordinator.entries) { entry in
                    FoleviPopoverPanel(entry: entry, container: size, origin: geo.frame(in: .global).origin, coordinator: coordinator)
                }
            }
            .background(PopoverEventProbe(coordinator: coordinator))
            .onGeometryChange(for: CGPoint.self) { $0.frame(in: .global).origin } action: { coordinator.origin = $0 }
        }
        .ignoresSafeArea()
    }
}

private struct FoleviPopoverPanel: View {
    let entry: FoleviPopoverCoordinator.Entry
    let container: CGSize
    let origin: CGPoint
    let coordinator: FoleviPopoverCoordinator
    @State private var size: CGSize = .zero

    var body: some View {
        let margin: CGFloat = 8
        let a = entry.anchor.offsetBy(dx: -origin.x, dy: -origin.y)
        let below = container.height - a.maxY - entry.gap - margin
        let aboveRoom = a.minY - entry.gap - margin
        // The web's flip: its preferred side unless the panel doesn't fit there and the other side has more room.
        let up = entry.above ? !(aboveRoom < size.height && below > aboveRoom) : (below < size.height && aboveRoom > below)
        let rawX = entry.align == .end ? a.maxX - size.width : a.minX
        let x = min(max(margin, rawX), max(margin, container.width - size.width - margin))
        let rawY = up ? a.minY - entry.gap - size.height : a.maxY + entry.gap
        let y = min(max(margin, rawY), max(margin, container.height - size.height - margin))
        PopoverSizing(maxHeight: max(80, container.height - margin * 2)) { entry.content }
            .clipShape(RoundedRectangle(cornerRadius: entry.radius, style: .continuous))
            .foleviGlassPop(radius: entry.radius)
            .onGeometryChange(for: CGSize.self) { $0.size } action: { size = $0 }
            .offset(x: x, y: y)
            .opacity(size == .zero ? 0 : 1)
            .onChange(of: CGRect(x: x, y: y, width: size.width, height: size.height), initial: true) { _, frame in
                coordinator.panelFrames[entry.id] = frame
            }
            .transition(.opacity.combined(with: .offset(y: up ? 4 : -4)))
    }
}

/// Watches the window's clicks and Escape for the layer (without taking part in hit testing).
private struct PopoverEventProbe: NSViewRepresentable {
    let coordinator: FoleviPopoverCoordinator

    func makeNSView(context: Context) -> ProbeView {
        let view = ProbeView()
        view.coordinator = coordinator
        return view
    }

    func updateNSView(_ view: ProbeView, context: Context) { view.coordinator = coordinator }

    final class ProbeView: NSView {
        weak var coordinator: FoleviPopoverCoordinator?
        private var monitor: Any?

        override var isFlipped: Bool { true }
        override func hitTest(_ point: NSPoint) -> NSView? { nil }

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            coordinator?.window = window
            if let monitor { NSEvent.removeMonitor(monitor) }
            monitor = nil
            guard window != nil else { return }
            monitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown, .keyDown]) { [weak self] event in
                guard let self, let window = self.window, event.window === window,
                      let coordinator = self.coordinator, !coordinator.entries.isEmpty else { return event }
                if event.type == .keyDown {
                    guard event.keyCode == 53 else { return event } // Escape
                    coordinator.dismissTop()
                    return nil
                }
                coordinator.mouseDown(at: self.convert(event.locationInWindow, from: nil))
                return event
            }
        }
        // The monitor goes when the view leaves its window (viewDidMoveToWindow with no window).
    }
}

/// Presents `content` in the window's popover layer while `isPresented` is true, or as a system popover
/// where the window has no layer.
struct FoleviPopoverModifier<Popover: View>: ViewModifier {
    @Binding var isPresented: Bool
    var arrowEdge: Edge?
    var align: FoleviPopoverAlign
    var gap: CGFloat
    var radius: CGFloat
    let popover: () -> Popover
    @Environment(\.foleviPopovers) private var coordinator
    @State private var id = UUID()
    @State private var anchor: CGRect = .zero
    @State private var window: NSWindow?

    private var inLayer: Bool { coordinator?.isHost(of: window) == true }

    func body(content: Content) -> some View {
        content
            .background(WindowReader { window = $0 })
            .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { frame in
                anchor = frame
                if isPresented, inLayer { coordinator?.move(id, anchor: frame) }
            }
            .onChange(of: isPresented, initial: true) { _, on in update(on) }
            .onChange(of: inLayer) { _, _ in update(isPresented) }
            .onDisappear { coordinator?.remove(id) }
            .popover(isPresented: Binding(get: { isPresented && !inLayer && window != nil }, set: { if !$0 { isPresented = false } }),
                     arrowEdge: arrowEdge) {
                popover()
                    .background(FoleviColor.surface)
                    .presentationBackground(FoleviColor.surface)
            }
    }

    private func update(_ on: Bool) {
        guard let coordinator, inLayer else { return }
        if on {
            let binding = $isPresented
            coordinator.present(.init(id: id, anchor: anchor, above: arrowEdge == .top, align: align, gap: gap, radius: radius,
                                      content: AnyView(popover()), dismiss: { binding.wrappedValue = false }))
        } else {
            coordinator.remove(id)
        }
    }
}

/// Reports the view's window.
private struct WindowReader: NSViewRepresentable {
    var onWindow: (NSWindow?) -> Void

    func makeNSView(context: Context) -> ReaderView {
        let view = ReaderView()
        view.onWindow = onWindow
        return view
    }

    func updateNSView(_ view: ReaderView, context: Context) { view.onWindow = onWindow }

    final class ReaderView: NSView {
        var onWindow: ((NSWindow?) -> Void)?
        override func hitTest(_ point: NSPoint) -> NSView? { nil }
        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            let window = self.window
            DispatchQueue.main.async { [weak self] in self?.onWindow?(window) }
        }
    }
}

/// Sizes a panel like the system popover (its ideal size), no taller than `maxHeight`, and lays it out at
/// that size: a fixed-size panel was laid out with no height, so a scrolling list taller than its frame
/// pushed the panel's header out of view.
private struct PopoverSizing: Layout {
    var maxHeight: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        guard let child = subviews.first else { return .zero }
        let ideal = child.sizeThatFits(.unspecified)
        guard ideal.height > maxHeight else { return ideal }
        return CGSize(width: ideal.width, height: min(maxHeight, child.sizeThatFits(ProposedViewSize(width: ideal.width, height: maxHeight)).height))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        subviews.first?.place(at: bounds.origin, anchor: .topLeading, proposal: ProposedViewSize(bounds.size))
    }
}
