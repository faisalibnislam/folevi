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
        /// A dialog: centred in the window, with a backdrop that takes clicks (the web's modal <dialog>).
        var centered = false
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
                // A dialog's transparent backdrop: the page behind can't be clicked (an outside click closes it).
                if coordinator.entries.contains(where: \.centered) {
                    Color.black.opacity(0.001).frame(width: size.width, height: size.height)
                }
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
        let rawX = entry.centered ? (container.width - size.width) / 2 : entry.align == .end ? a.maxX - size.width : a.minX
        let x = min(max(margin, rawX), max(margin, container.width - size.width - margin))
        let rawY = entry.centered ? (container.height - size.height) / 2 : up ? a.minY - entry.gap - size.height : a.maxY + entry.gap
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

extension View {
    /// A right-click menu as the web's ContextMenu: the same rows as a FoleviViewMenu, opened at the pointer
    /// in the window's popover layer. Falls back to the system context menu where there's no layer.
    func foleviContextMenu<Items: View>(@ViewBuilder items: @escaping () -> Items) -> some View {
        modifier(FoleviContextMenuModifier(items: items))
    }
}

private struct FoleviContextMenuModifier<Items: View>: ViewModifier {
    let items: () -> Items
    @Environment(\.foleviPopovers) private var coordinator
    @State private var id = UUID()
    @State private var frame: CGRect = .zero

    func body(content: Content) -> some View {
        if let coordinator {
            content
                .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { frame = $0 }
                .overlay { RightClickCatcher { point in present(at: point, in: coordinator) } }
                .onDisappear { coordinator.remove(id) }
        } else {
            content.contextMenu { items() }
        }
    }

    private func present(at point: CGPoint, in coordinator: FoleviPopoverCoordinator) {
        let id = self.id
        let at = CGRect(x: frame.minX + point.x, y: frame.minY + point.y, width: 0, height: 0)
        let close = { [weak coordinator] in coordinator?.remove(id) }
        let menu = VStack(alignment: .leading, spacing: 0) { items() }
            .buttonStyle(FoleviMenuRowStyle())
            .labelStyle(FoleviMenuLabelStyle())
            .padding(6)
            .frame(minWidth: 224, alignment: .leading)
            .simultaneousGesture(TapGesture().onEnded { close() })
        // A zero-size anchor: the web places a context menu 2pt from the pointer.
        coordinator.present(.init(id: id, anchor: at, above: false, align: .start, gap: 2, radius: 10,
                                  content: AnyView(menu), dismiss: {}))
    }
}

/// Takes right clicks (and Control-clicks) only; every other event passes through to the views below.
private struct RightClickCatcher: NSViewRepresentable {
    var onRightClick: (CGPoint) -> Void

    func makeNSView(context: Context) -> CatcherView {
        let view = CatcherView()
        view.onRightClick = onRightClick
        return view
    }

    func updateNSView(_ view: CatcherView, context: Context) { view.onRightClick = onRightClick }

    final class CatcherView: NSView {
        var onRightClick: ((CGPoint) -> Void)?
        override var isFlipped: Bool { true }

        override func hitTest(_ point: NSPoint) -> NSView? {
            guard let event = NSApp.currentEvent else { return nil }
            let secondary = event.type == .rightMouseDown || (event.type == .leftMouseDown && event.modifierFlags.contains(.control))
            return secondary ? super.hitTest(point) : nil
        }

        override func rightMouseDown(with event: NSEvent) {
            onRightClick?(convert(event.locationInWindow, from: nil))
        }

        override func mouseDown(with event: NSEvent) {
            if event.modifierFlags.contains(.control) { onRightClick?(convert(event.locationInWindow, from: nil)) }
        }
    }
}

extension View {
    /// A dialog as the web's: a panel centred in the window (radius 14, the glass pop), the page behind left
    /// as it is, and resizing with its content. An outside click or Escape closes it. A system sheet where
    /// the window has no popover layer.
    func foleviDialog<Content: View>(isPresented: Binding<Bool>, @ViewBuilder content: @escaping () -> Content) -> some View {
        modifier(FoleviDialogModifier(isPresented: isPresented, dialog: content))
    }
}

private struct FoleviDialogModifier<Dialog: View>: ViewModifier {
    @Binding var isPresented: Bool
    let dialog: () -> Dialog
    @Environment(\.foleviPopovers) private var coordinator
    @State private var id = UUID()
    @State private var window: NSWindow?

    private var inLayer: Bool { coordinator?.isHost(of: window) == true }

    func body(content: Content) -> some View {
        content
            .background(WindowReader { window = $0 })
            .onChange(of: isPresented, initial: true) { _, on in update(on) }
            .onChange(of: inLayer) { _, _ in update(isPresented) }
            .onDisappear { coordinator?.remove(id) }
            .sheet(isPresented: Binding(get: { isPresented && !inLayer && window != nil }, set: { if !$0 { isPresented = false } }),
                   content: dialog)
    }

    private func update(_ on: Bool) {
        guard let coordinator, inLayer else { return }
        if on {
            let binding = $isPresented
            coordinator.present(.init(id: id, anchor: .zero, above: false, centered: true, align: .start, gap: 0, radius: 14,
                                      content: AnyView(dialog()), dismiss: { binding.wrappedValue = false }))
        } else {
            coordinator.remove(id)
        }
    }
}
