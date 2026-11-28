import FoleviDesign
import SwiftUI
import UniformTypeIdentifiers

/// The row of dots in a glass capsule. Click to switch, double-click (or ⌘R) to rename, drag to
/// reorder, right-click for more; drop text or files on a dot to add them to it.
struct DotBar: View {
    @Environment(AppModel.self) private var model
    var namespace: Namespace.ID

    @State private var hoveringBar = false
    @State private var drag: (id: UUID, dx: CGFloat)?

    static let slot: CGFloat = 12
    static let spacing: CGFloat = 14
    static var pitch: CGFloat { slot + spacing }

    var body: some View {
        let dots = model.dots
        let canAdd = dots.count < NoteStore.hardCap
        HStack(spacing: Self.spacing) {
            ForEach(dots) { dot in
                DotView(dot: dot, isActive: dot.id == model.activeDotID, namespace: namespace,
                        showName: model.settings.showDotNames)
                    .offset(x: offset(for: dot, in: dots))
                    .zIndex(drag?.id == dot.id ? 1 : 0)
                    .gesture(dragGesture(for: dot, in: dots))
            }
            if hoveringBar && canAdd {
                Button {
                    model.addDot()
                } label: {
                    QNIcon(.plus, size: 13)
                        .frame(width: 14, height: 14)
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .help("New quick note (⌘N)")
                .accessibilityLabel("New quick note")
                .transition(.scale(scale: 0.4).combined(with: .opacity))
            }
        }
        .padding(.horizontal, 12)
        .frame(height: model.settings.showDotNames ? 40 : 30)
        .contentShape(Capsule())
        .quickGlass(.regular.tint(model.activeDot?.color.opacity(0.12)).interactive(), in: Capsule())
        .glassEffectID("dotbar", in: namespace)
        .onHover { h in Motion.animate(Motion.spring) { hoveringBar = h } }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Quick notes")
    }

    private func offset(for dot: DotState, in dots: [DotState]) -> CGFloat {
        guard let drag, let from = dots.firstIndex(where: { $0.id == drag.id }) else { return 0 }
        if dot.id == drag.id { return drag.dx }
        let to = target(from: from, dx: drag.dx, count: dots.count)
        let i = dot.index
        if from < to, i > from, i <= to { return -Self.pitch }
        if from > to, i < from, i >= to { return Self.pitch }
        return 0
    }

    private func target(from: Int, dx: CGFloat, count: Int) -> Int {
        min(max(0, from + Int((dx / Self.pitch).rounded())), count - 1)
    }

    private func dragGesture(for dot: DotState, in dots: [DotState]) -> some Gesture {
        DragGesture(minimumDistance: 6)
            .onChanged { value in
                if drag == nil { model.hoveredDotID = nil }
                var t = Transaction()
                t.animation = drag == nil ? Motion.spring : nil
                withTransaction(t) { drag = (dot.id, value.translation.width) }
            }
            .onEnded { value in
                guard let from = dots.firstIndex(where: { $0.id == dot.id }) else { drag = nil; return }
                let to = target(from: from, dx: value.translation.width, count: dots.count)
                Motion.animate(Motion.spring) {
                    drag = nil
                    model.moveDot(from: from, to: to)
                }
            }
    }
}

struct DotView: View {
    @Environment(AppModel.self) private var model
    let dot: DotState
    let isActive: Bool
    var namespace: Namespace.ID
    var showName: Bool

    @State private var hovering = false
    @State private var dropTargeted = false
    @State private var hoverTask: Task<Void, Never>?

    var body: some View {
        VStack(spacing: 3) {
            ZStack {
                if isActive {
                    Circle()
                        .strokeBorder(dot.color, lineWidth: 2)
                        .frame(width: 22, height: 22)
                        .shadow(color: dot.color.opacity(0.55), radius: 5)
                        .matchedGeometryEffect(id: "activeRing", in: namespace)
                }
                dotShape
                    .frame(width: isActive ? 14 : 12, height: isActive ? 14 : 12)
                if dropTargeted {
                    Circle().stroke(dot.color, lineWidth: 1.5).frame(width: 26, height: 26).opacity(0.8)
                }
            }
            .frame(width: DotBar.slot, height: 22)
            .scaleEffect(hovering && !isActive ? 1.1 : 1)
            if showName {
                Text(dot.hasCustomName ? dot.displayName : "\(dot.index + 1)")
                    .font(FoleviFonts.font(.ui, size: 10, weight: isActive ? .semibold : .regular))
                    .foregroundStyle(isActive ? .primary : .secondary)
                    .lineLimit(1)
                    .fixedSize()
                    .frame(width: DotBar.slot)
            }
        }
        .contentShape(Rectangle().inset(by: -6))
        .onTapGesture { model.selectDot(id: dot.id) }
        .simultaneousGesture(TapGesture(count: 2).onEnded { model.overlay = .rename(dot.id) })
        .onHover { h in
            Motion.animate(Motion.spring) { hovering = h }
            if h { NSCursor.pointingHand.push() } else { NSCursor.pop() }
            hoverTask?.cancel()
            if h {
                hoverTask = Task { @MainActor in
                    try? await Task.sleep(for: .milliseconds(650))
                    if !Task.isCancelled { model.hoveredDotID = dot.id }
                }
            } else if model.hoveredDotID == dot.id {
                model.hoveredDotID = nil
            }
        }
        .anchorPreference(key: DotAnchorKey.self, value: .bounds) { [dot.id: $0] }
        .help(tooltip)
        .contextMenu { DotContextMenu(dot: dot) }
        .onDrop(of: [.fileURL, .utf8PlainText, .plainText, .url, .image], isTargeted: $dropTargeted) { providers in
            model.handleDrop(providers, into: dot.id)
            return true
        }
        .accessibilityElement()
        .accessibilityLabel(dot.accessibilityLabel)
        .accessibilityAddTraits(isActive ? [.isButton, .isSelected] : [.isButton])
        .accessibilityHint("Shows this quick note. Double-click to rename.")
        .accessibilityAction { model.selectDot(id: dot.id) }
        .accessibilityAction(named: "Rename") { model.overlay = .rename(dot.id) }
        .accessibilityAction(named: "Delete") { model.requestDelete(dot.id) }
        .accessibilityAction(named: "Move left") { model.selectDot(id: dot.id); model.moveActiveDot(by: -1) }
        .accessibilityAction(named: "Move right") { model.selectDot(id: dot.id); model.moveActiveDot(by: 1) }
    }

    @ViewBuilder private var dotShape: some View {
        if dot.isEmpty {
            Circle().strokeBorder(dot.color, lineWidth: 1.5)
        } else {
            Circle().fill(dot.color)
                .overlay(Circle().strokeBorder(.white.opacity(0.18), lineWidth: 0.5))
        }
    }

    private var tooltip: String {
        let shortcut = dot.index < 9 ? " (⌘\(dot.index + 1))" : ""
        return dot.displayName + shortcut
    }
}

struct DotAnchorKey: PreferenceKey {
    static let defaultValue: [UUID: Anchor<CGRect>] = [:]
    static func reduce(value: inout [UUID: Anchor<CGRect>], nextValue: () -> [UUID: Anchor<CGRect>]) {
        value.merge(nextValue()) { $1 }
    }
}

struct DotContextMenu: View {
    @Environment(AppModel.self) private var model
    let dot: DotState

    var body: some View {
        Button("Rename…") { model.overlay = .rename(dot.id) }
        Menu("Change Color") {
            ForEach(DotColorID.allCases) { color in
                Button {
                    model.setColor(dot.id, colorID: color)
                } label: {
                    Label { Text(color.localizedName.capitalized) } icon: { Image(nsImage: ColorSwatch.image(color.nsColor)) }
                }
            }
        }
        Button(dot.isRichText ? "Switch to Plain Text" : "Switch to Rich Text") {
            model.toggleRichText(dot.id)
        }
        Divider()
        Button("Save to Note") { model.selectDot(id: dot.id); model.saveToNote() }
            .disabled(dot.isEmpty)
        Divider()
        Button("Clear All Text") { model.clearDot(dot.id) }
        Button("Delete Quick Note…", role: .destructive) { model.requestDelete(dot.id) }
    }
}

enum ColorSwatch {
    @MainActor
    static func image(_ color: NSColor, size: CGFloat = 12) -> NSImage {
        let image = NSImage(size: NSSize(width: size, height: size), flipped: false) { rect in
            color.setFill()
            NSBezierPath(ovalIn: rect.insetBy(dx: 1, dy: 1)).fill()
            return true
        }
        image.isTemplate = false
        return image
    }
}
