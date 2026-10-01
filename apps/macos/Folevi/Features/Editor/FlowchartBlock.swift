import AppKit
import SwiftUI

// The flowchart block in a note (web: FlowchartView.tsx, FlowchartChrome.tsx, FlowchartAi.tsx): the
// editable canvas with its floating tools (shapes, Tidy up, AI, undo; zoom; the bar that edits the
// selection), a bottom edge that sets the block's height, and a static picture in read-only notes.
// Neutral glass chrome; only the swatches carry colour.

struct FlowchartBlockView: View {
    let block: Block
    let props: FlowchartProps
    @Bindable var model: EditorModel
    @Environment(AppModel.self) private var app
    @State private var controller = FlowchartController()
    @State private var liveHeight: Double?
    @State private var dragStart: Double?
    @State private var handleHover = false

    private var surface: Color { model.sheetPalette?.surface ?? FoleviColor.surface }
    private var ink: Color { model.sheetPalette?.ink ?? FoleviColor.ink }
    private var accent: Color { model.documentAccent }
    private var height: Double { liveHeight ?? props.height }

    var body: some View {
        if model.isReadOnly {
            FlowchartStaticView(data: props.data, height: props.height, surface: surface, ink: ink, accent: accent)
                .onTapGesture { model.select(block.id, extend: false) }
        } else {
            editor
        }
    }

    private var editor: some View {
        VStack(spacing: 0) {
            ZStack(alignment: .topLeading) {
                FlowchartCanvas(controller: controller, staticData: nil, surface: surface, ink: ink, accent: accent)
                if controller.doc.nodes.isEmpty && controller.editing == nil { emptyState }
                FlowchartMainToolbar(controller: controller, aiAvailable: app.aiAvailable)
                    .padding(10)
                FlowchartZoomBar(controller: controller)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
                    .padding(10)
                selectionBar
                if controller.aiOpen && app.aiAvailable {
                    FlowchartAiPanel(controller: controller, hasChart: !controller.doc.nodes.isEmpty)
                        .frame(width: max(200, min(380, controller.size.width - 20)))
                        .frame(maxWidth: .infinity, alignment: .topTrailing)
                        .padding(.top, 54)
                        .padding(.trailing, 10)
                }
                if controller.tooLarge {
                    Text("This flowchart is too large to save. Remove some shapes or text.")
                        .font(.ui(12.5, .medium))
                        .foregroundStyle(FoleviColor.destructive)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(FoleviColor.surfaceRaised))
                        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(FoleviGlass.border))
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
                        .padding(10)
                        .accessibilityAddTraits(.isStaticText)
                }
            }
            .frame(height: height)
            .clipped()
            resizeHandle
        }
        .background(surface.mix(with: FoleviColor.inkMuted, by: 0.02))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(controller.active ? FoleviColor.ink.mix(with: FoleviColor.line, by: 0.72) : FoleviColor.line)
        )
        .padding(.vertical, 6)
        .onAppear(perform: configure)
        .onChange(of: props.data) { _, data in controller.load(data) }
        .onChange(of: controller.active) { _, active in
            // The canvas has the keyboard: block commands (⌘D, Delete Block) must not reach a block behind it.
            guard active else { return }
            model.clearSelection()
            model.focusedBlockId = nil
        }
        .onDisappear { controller.flush() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Flowchart"))
    }

    private func configure() {
        let id = block.id
        let m = model
        controller.write = { [weak m] data in
            m?.update(id, actionName: String(localized: "Edit Flowchart")) { b in
                guard case .unknown(let type, let props) = b.content, type == FlowchartProps.type else { return }
                var o = props.objectValue ?? [:]
                o["data"] = .string(data)
                if o["height"] == nil { o["height"] = .number(Double(Flowchart.defaultHeight)) }
                b.content = .unknown(type: type, props: .object(o))
            }
        }
        controller.exitToNote = { [weak m] in m?.select(id, extend: false) }
        controller.load(props.data)
    }

    // MARK: Empty state

    private var emptyState: some View {
        VStack(spacing: 10) {
            Text("Double-click anywhere to add a shape, or pick one above.")
                .font(.ui(13.5))
                .foregroundStyle(FoleviColor.inkMuted)
                .multilineTextAlignment(.center)
                .allowsHitTesting(false)
            if app.aiAvailable {
                Button { controller.aiOpen = true } label: {
                    HStack(spacing: 6) {
                        AiIcon(size: 14)
                        Text("Create with AI")
                    }
                }
                .buttonStyle(FlowBarButtonStyle(text: true))
                .flowGlass(radius: 10, padding: 0)
            }
        }
        .padding(.horizontal, 16)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.top, 52)
        .padding(.bottom, 16)
    }

    // MARK: Selection bar

    @ViewBuilder private var selectionBar: some View {
        if controller.showsSelectionBar, let box = controller.selectionBox {
            let v = controller.view
            let w = Double(controller.size.width)
            let top = box.y * v.k + v.y
            let bottom = (box.y + box.h) * v.k + v.y
            let cx = min(max((box.x + box.w / 2) * v.k + v.x, 150), max(150, w - 150))
            let y = top - 52 > 56 ? top - 52 : min(height - 48, bottom + 12)
            Group {
                if !controller.sel.nodes.isEmpty && controller.sel.edges.isEmpty {
                    FlowchartNodeBar(controller: controller)
                } else if !controller.sel.edges.isEmpty && controller.sel.nodes.isEmpty {
                    FlowchartEdgeBar(controller: controller)
                }
            }
            .fixedSize()
            .position(x: cx, y: y + 19)
        }
    }

    // MARK: Height

    private func clampHeight(_ h: Double) -> Double {
        Flowchart.jsRound(Flowchart.clamp(h, Double(Flowchart.minBlockHeight), Double(Flowchart.maxBlockHeight)))
    }

    private func commitHeight(_ h: Double) {
        liveHeight = nil
        guard h != props.height else { return }
        model.update(block.id, actionName: String(localized: "Resize Flowchart")) { b in
            guard case .unknown(let type, let props) = b.content, type == FlowchartProps.type else { return }
            var o = props.objectValue ?? [:]
            o["height"] = .number(h)
            if o["data"] == nil { o["data"] = .string("") }
            b.content = .unknown(type: type, props: .object(o))
        }
    }

    /// Drag the bottom edge to set the height (or use VoiceOver's adjust actions).
    private var resizeHandle: some View {
        Capsule()
            .fill(handleHover ? FoleviColor.inkFaint : FoleviColor.lineStrong)
            .frame(width: 36, height: 4)
            .frame(maxWidth: .infinity)
            .frame(height: 14)
            .overlay(alignment: .top) { Rectangle().fill(FoleviColor.line).frame(height: 1) }
            .contentShape(Rectangle())
            .onHover { handleHover = $0 }
            .pointerStyle(.rowResize)
            .gesture(
                DragGesture(minimumDistance: 1, coordinateSpace: .global)
                    .onChanged { v in
                        let start = dragStart ?? height
                        dragStart = start
                        liveHeight = clampHeight(start + Double(v.translation.height))
                    }
                    .onEnded { _ in
                        dragStart = nil
                        commitHeight(liveHeight ?? props.height)
                    }
            )
            .help(Text("Drag to resize"))
            .accessibilityElement()
            .accessibilityLabel(Text("Flowchart height"))
            .accessibilityValue(Text("\(Int(height)) points"))
            .accessibilityAdjustableAction { direction in
                commitHeight(clampHeight(height + (direction == .increment ? 40 : -40)))
            }
    }
}

// MARK: - Read-only

/// The whole chart as a static picture that fits its content (never enlarged), as on the web's read-only
/// pages; "Empty flowchart" when there's nothing to show.
struct FlowchartStaticView: View {
    let data: String
    let height: Double
    var surface: Color
    var ink: Color
    var accent: Color
    @State private var width: CGFloat = 0

    var body: some View {
        let fc = Flowchart.parse(data)
        let b = FlowGeometry.bounds(fc)
        Group {
            if let b {
                let vw = (b.w + 48).rounded(.up), vh = (b.h + 48).rounded(.up)
                let k = min(1, Double(max(1, width - 24)) / vw, height / vh)
                FlowchartCanvas(controller: nil, staticData: fc, surface: surface, ink: ink, accent: accent)
                    .frame(height: max(40, vh * k))
                    .padding(.vertical, 8)
                    .padding(.horizontal, 12)
                    .accessibilityLabel(Text(summary(fc)))
            } else {
                Text("Empty flowchart")
                    .font(.ui(13))
                    .foregroundStyle(FoleviColor.inkMuted)
                    .padding(20)
                    .frame(maxWidth: .infinity)
            }
        }
        .frame(maxWidth: .infinity)
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(surface))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(FoleviColor.line))
        .padding(.vertical, 6)
    }

    private func summary(_ fc: FlowchartData) -> String {
        let names = fc.nodes.prefix(12).map { $0.text.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }.joined(separator: ", ")
        return String(localized: "Flowchart with \(fc.nodes.count) shapes: \(names)\(fc.nodes.count > 12 ? "…" : "")")
    }
}

// MARK: - Chrome

/// A glass toolbar: blurred pop fill, hairline border, soft shadow (web `.fc-bar`).
private struct FlowGlass: ViewModifier {
    var radius: CGFloat
    var padding: CGFloat

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .background(FoleviGlass.pop, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(FoleviGlass.border))
            .shadow(color: .black.opacity(0.12), radius: 10, y: 5)
    }
}

extension View {
    fileprivate func flowGlass(radius: CGFloat = 12, padding: CGFloat = 4) -> some View {
        modifier(FlowGlass(radius: radius, padding: padding))
    }
}

/// A toolbar button (web `.fc-btn`): 30pt, muted until hovered or on.
struct FlowBarButtonStyle: ButtonStyle {
    var isOn = false
    var text = false

    func makeBody(configuration: Configuration) -> some View {
        FlowBarButtonBody(configuration: configuration, isOn: isOn, text: text)
    }
}

private struct FlowBarButtonBody: View {
    let configuration: ButtonStyle.Configuration
    let isOn: Bool
    let text: Bool
    @State private var hovering = false
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        let lit = isEnabled && (isOn || hovering || configuration.isPressed)
        configuration.label
            .font(.ui(12.5, text ? .semibold : .medium))
            .foregroundStyle(text ? FoleviColor.ink : lit ? FoleviColor.heading : FoleviColor.inkMuted)
            .padding(.horizontal, text ? 9 : 6)
            .frame(minWidth: 30, minHeight: 30)
            .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(lit ? FoleviGlass.hover : .clear))
            .overlay {
                if isOn { RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(FoleviGlass.border) }
            }
            .contentShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .opacity(isEnabled ? 1 : 0.35)
            .onHover { hovering = $0 }
    }
}

private struct FlowBarSeparator: View {
    var body: some View {
        Rectangle().fill(FoleviColor.lineStrong).frame(width: 1, height: 18).padding(.horizontal, 4).accessibilityHidden(true)
    }
}

/// A small outline of each shape for buttons and menus.
struct FlowShapeIcon: View {
    var shape: FlowShape
    var size: CGFloat = 18

    var body: some View {
        Canvas { ctx, sz in
            let s = sz.width / 20
            ctx.scaleBy(x: s, y: s)
            var p = Path()
            switch shape {
            case .process: p.addRoundedRect(in: CGRect(x: 2.5, y: 5, width: 15, height: 10), cornerSize: CGSize(width: 2.5, height: 2.5))
            case .decision: p.addLines([CGPoint(x: 10, y: 2.8), CGPoint(x: 17.2, y: 10), CGPoint(x: 10, y: 17.2), CGPoint(x: 2.8, y: 10)]); p.closeSubpath()
            case .terminator: p.addRoundedRect(in: CGRect(x: 2, y: 6, width: 16, height: 8), cornerSize: CGSize(width: 4, height: 4))
            case .io: p.addLines([CGPoint(x: 6, y: 5), CGPoint(x: 17.5, y: 5), CGPoint(x: 14, y: 15), CGPoint(x: 2.5, y: 15)]); p.closeSubpath()
            case .circle: p.addEllipse(in: CGRect(x: 3.2, y: 3.2, width: 13.6, height: 13.6))
            case .note:
                p.addLines([CGPoint(x: 3.5, y: 3.5), CGPoint(x: 16.5, y: 3.5), CGPoint(x: 16.5, y: 12.5), CGPoint(x: 12.5, y: 16.5), CGPoint(x: 3.5, y: 16.5)])
                p.closeSubpath()
                p.move(to: CGPoint(x: 12.5, y: 16.5))
                p.addLine(to: CGPoint(x: 12.5, y: 12.5))
                p.addLine(to: CGPoint(x: 16.5, y: 12.5))
            case .text:
                p.move(to: CGPoint(x: 4.5, y: 6))
                p.addLine(to: CGPoint(x: 4.5, y: 4.5))
                p.addLine(to: CGPoint(x: 15.5, y: 4.5))
                p.addLine(to: CGPoint(x: 15.5, y: 6))
                p.move(to: CGPoint(x: 10, y: 4.5))
                p.addLine(to: CGPoint(x: 10, y: 15.5))
                p.move(to: CGPoint(x: 8, y: 15.5))
                p.addLine(to: CGPoint(x: 12, y: 15.5))
            }
            ctx.stroke(p, with: .foreground, style: StrokeStyle(lineWidth: 1.5, lineCap: .round, lineJoin: .round))
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// Line and arrow glyphs for the connector bar (web EdgeBar icons, 20×20).
private struct FlowLineIcon: View {
    enum Kind { case solid, dashed, arrowEnd, arrowBoth, arrowNone }
    var kind: Kind

    var body: some View {
        Canvas { ctx, sz in
            let s = sz.width / 20
            ctx.scaleBy(x: s, y: s)
            var p = Path()
            switch kind {
            case .solid, .dashed, .arrowNone:
                p.move(to: CGPoint(x: 3, y: 10)); p.addLine(to: CGPoint(x: 17, y: 10))
            case .arrowEnd:
                p.move(to: CGPoint(x: 3, y: 10)); p.addLine(to: CGPoint(x: 16, y: 10))
                p.move(to: CGPoint(x: 12, y: 6)); p.addLine(to: CGPoint(x: 16, y: 10)); p.addLine(to: CGPoint(x: 12, y: 14))
            case .arrowBoth:
                p.move(to: CGPoint(x: 4, y: 10)); p.addLine(to: CGPoint(x: 16, y: 10))
                p.move(to: CGPoint(x: 8, y: 6)); p.addLine(to: CGPoint(x: 4, y: 10)); p.addLine(to: CGPoint(x: 8, y: 14))
                p.move(to: CGPoint(x: 12, y: 6)); p.addLine(to: CGPoint(x: 16, y: 10)); p.addLine(to: CGPoint(x: 12, y: 14))
            }
            ctx.stroke(p, with: .foreground, style: StrokeStyle(lineWidth: 1.6, lineCap: .round, lineJoin: .round, dash: kind == .dashed ? [3, 3] : []))
        }
        .frame(width: 18, height: 18)
        .accessibilityHidden(true)
    }
}

/// Shapes to add, Tidy up, AI, undo and redo (top left).
private struct FlowchartMainToolbar: View {
    var controller: FlowchartController
    var aiAvailable: Bool

    var body: some View {
        HStack(spacing: 2) {
            ForEach(FlowShape.allCases, id: \.self) { s in
                Button { controller.add(s) } label: { FlowShapeIcon(shape: s) }
                    .buttonStyle(FlowBarButtonStyle())
                    .help(Text(Flowchart.shapeLabel(s)))
                    .accessibilityLabel(Text("Add \(Flowchart.shapeLabel(s).lowercased())"))
            }
            FlowBarSeparator()
            Button { controller.tidy() } label: {
                HStack(spacing: 5) {
                    Image(systemName: "wand.and.stars").font(.system(size: 12.5, weight: .medium))
                    Text("Tidy up")
                }
            }
            .buttonStyle(FlowBarButtonStyle(text: true))
            .disabled(controller.doc.nodes.count < 2)
            .help(Text("Tidy up: lay the chart out neatly"))
            if aiAvailable {
                Button { controller.aiOpen.toggle() } label: {
                    HStack(spacing: 5) {
                        AiIcon(size: 14)
                        Text("AI")
                    }
                }
                .buttonStyle(FlowBarButtonStyle(isOn: controller.aiOpen, text: true))
                .help(Text("Create or change the flowchart with AI"))
            }
            FlowBarSeparator()
            Button { controller.undo() } label: { Image(systemName: "arrow.uturn.backward").font(.system(size: 13, weight: .medium)) }
                .buttonStyle(FlowBarButtonStyle())
                .disabled(!controller.canUndo)
                .help(Text("Undo (⌘Z)"))
                .accessibilityLabel(Text("Undo"))
            Button { controller.redo() } label: { Image(systemName: "arrow.uturn.forward").font(.system(size: 13, weight: .medium)) }
                .buttonStyle(FlowBarButtonStyle())
                .disabled(!controller.canRedo)
                .help(Text("Redo (⇧⌘Z)"))
                .accessibilityLabel(Text("Redo"))
        }
        .flowGlass()
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Flowchart tools"))
    }
}

/// Zoom out, the zoom level, zoom in and fit (bottom right).
private struct FlowchartZoomBar: View {
    var controller: FlowchartController

    var body: some View {
        HStack(spacing: 2) {
            Button { controller.zoomBy(1 / 1.2) } label: { Image(systemName: "minus").font(.system(size: 12.5, weight: .medium)) }
                .buttonStyle(FlowBarButtonStyle())
                .help(Text("Zoom out (−)"))
                .accessibilityLabel(Text("Zoom out"))
            Text("\(Int(Flowchart.jsRound(controller.view.k * 100)))%")
                .font(.ui(12.5, .medium).monospacedDigit())
                .foregroundStyle(FoleviColor.inkMuted)
                .frame(minWidth: 42)
            Button { controller.zoomBy(1.2) } label: { Image(systemName: "plus").font(.system(size: 12.5, weight: .medium)) }
                .buttonStyle(FlowBarButtonStyle())
                .help(Text("Zoom in (+)"))
                .accessibilityLabel(Text("Zoom in"))
            Button { controller.fitView() } label: { Image(systemName: "arrow.up.left.and.arrow.down.right").font(.system(size: 12, weight: .medium)) }
                .buttonStyle(FlowBarButtonStyle())
                .help(Text("Fit to content (⇧1)"))
                .accessibilityLabel(Text("Fit to content"))
        }
        .flowGlass()
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Zoom"))
    }
}

private func same<T: Equatable>(_ list: [T]) -> T? {
    guard let first = list.first, list.allSatisfy({ $0 == first }) else { return nil }
    return first
}

/// Edits the selected shapes: shape, colour, duplicate, delete.
private struct FlowchartNodeBar: View {
    var controller: FlowchartController
    @State private var showShapes = false

    var body: some View {
        let nodes = controller.selNodes
        let shape = same(nodes.map(\.shape))
        let color = same(nodes.map(\.color))
        HStack(spacing: 2) {
            Button { showShapes.toggle() } label: {
                HStack(spacing: 2) {
                    FlowShapeIcon(shape: shape ?? .process)
                    Image(systemName: "chevron.down").font(.system(size: 8, weight: .bold))
                }
            }
            .buttonStyle(FlowBarButtonStyle(isOn: showShapes))
            .help(Text("Change shape"))
            .accessibilityLabel(Text("Change shape"))
            .foleviPopover(isPresented: $showShapes, arrowEdge: .bottom) {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(FlowShape.allCases, id: \.self) { s in
                        FlowMenuRow(isChecked: shape == s) {
                            showShapes = false
                            controller.setShape(s)
                        } label: {
                            FlowShapeIcon(shape: s, size: 16)
                            Text(Flowchart.shapeLabel(s))
                        }
                    }
                }
                .padding(6)
                .frame(width: 200)
            }
            FlowBarSeparator()
            HStack(spacing: 2) {
                ForEach(FlowColor.allCases, id: \.self) { c in
                    FlowSwatch(color: c, isOn: color == c, tint: swatchTint(c)) { controller.setColor(c) }
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text("Colour"))
            FlowBarSeparator()
            Button { controller.duplicateSelection() } label: { Image(systemName: "plus.square.on.square").font(.system(size: 12.5, weight: .medium)) }
                .buttonStyle(FlowBarButtonStyle())
                .help(Text("Duplicate (⌘D)"))
                .accessibilityLabel(Text("Duplicate"))
            Button { controller.removeSelection() } label: { Image(systemName: "trash").font(.system(size: 12.5, weight: .medium)) }
                .buttonStyle(FlowBarButtonStyle())
                .help(Text("Delete (⌫)"))
                .accessibilityLabel(Text("Delete"))
        }
        .flowGlass()
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Selected shapes"))
    }

    private func swatchTint(_ c: FlowColor) -> Color? {
        switch c {
        case .neutral: return nil
        case .accent: return FoleviColor.ember
        case .blue: return Color(nsColor: .flowDynamic(0x3B82F6, 0x6EA8FE))
        case .green: return Color(nsColor: .flowDynamic(0x22A05A, 0x4CC38A))
        case .yellow: return Color(nsColor: .flowDynamic(0xE0A800, 0xF0C24B))
        case .pink: return Color(nsColor: .flowDynamic(0xE05A8A, 0xF07AA5))
        case .purple: return Color(nsColor: .flowDynamic(0x8B5CF6, 0xA78BFA))
        }
    }
}

extension NSColor {
    static func flowDynamic(_ light: Int, _ dark: Int) -> NSColor {
        NSColor(name: nil) { appearance in
            appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? .flowHex(dark) : .flowHex(light)
        }
    }
}

/// A colour swatch (web `.fc-swatch`).
private struct FlowSwatch: View {
    var color: FlowColor
    var isOn: Bool
    var tint: Color?
    var action: () -> Void

    var body: some View {
        let t = tint ?? FoleviColor.inkFaint
        Button(action: action) {
            Circle()
                .fill(tint.map { $0.mix(with: FoleviColor.surface, by: 0.78) } ?? FoleviColor.surfaceRaised)
                .overlay(Circle().strokeBorder(t.mix(with: FoleviColor.surface, by: 0.45), lineWidth: 1.5))
                .frame(width: 22, height: 22)
                .padding(3)
                .overlay {
                    if isOn { Circle().strokeBorder(FoleviColor.ink, lineWidth: 2) }
                }
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .help(Text(Flowchart.colorLabel(color)))
        .accessibilityLabel(Text(Flowchart.colorLabel(color)))
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }
}

/// A row in a flowchart popover menu, with a check for the current choice.
private struct FlowMenuRow<Label: View>: View {
    var isChecked: Bool
    var action: () -> Void
    @ViewBuilder var label: Label
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 9) {
                label
                Spacer(minLength: 8)
                if isChecked { Image(systemName: "checkmark").font(.system(size: 11, weight: .semibold)) }
            }
            .font(.ui(13))
            .foregroundStyle(FoleviColor.ink)
            .padding(.horizontal, 8)
            .frame(height: 30)
            .background(RoundedRectangle(cornerRadius: 7, style: .continuous).fill(hovering ? FoleviGlass.hover : .clear))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .accessibilityAddTraits(isChecked ? .isSelected : [])
    }
}

/// Edits the selected connectors: line, arrows, label, delete.
private struct FlowchartEdgeBar: View {
    var controller: FlowchartController

    var body: some View {
        let edges = controller.selEdges
        let style = same(edges.map(\.style))
        let arrow = same(edges.map(\.arrow))
        HStack(spacing: 2) {
            Button { controller.setEdgeStyle(.solid) } label: { FlowLineIcon(kind: .solid) }
                .buttonStyle(FlowBarButtonStyle(isOn: style == .solid))
                .help(Text("Solid"))
                .accessibilityLabel(Text("Solid line"))
            Button { controller.setEdgeStyle(.dashed) } label: { FlowLineIcon(kind: .dashed) }
                .buttonStyle(FlowBarButtonStyle(isOn: style == .dashed))
                .help(Text("Dashed"))
                .accessibilityLabel(Text("Dashed line"))
            FlowBarSeparator()
            arrowButton(.end, .arrowEnd, "Arrow at the end")
            arrowButton(.both, .arrowBoth, "Arrows at both ends")
            arrowButton(.noArrow, .arrowNone, "No arrows")
            if edges.count == 1 {
                FlowBarSeparator()
                Button("Label") { controller.startEdit(.edge, edges[0].id) }
                    .buttonStyle(FlowBarButtonStyle(text: true))
                    .help(Text("Label (Return)"))
            }
            FlowBarSeparator()
            Button { controller.removeSelection() } label: { Image(systemName: "trash").font(.system(size: 12.5, weight: .medium)) }
                .buttonStyle(FlowBarButtonStyle())
                .help(Text("Delete (⌫)"))
                .accessibilityLabel(Text("Delete connector"))
        }
        .flowGlass()
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Selected connectors"))
    }

    private func arrowButton(_ a: FlowArrow, _ icon: FlowLineIcon.Kind, _ label: LocalizedStringKey) -> some View {
        Button { controller.setArrow(a) } label: { FlowLineIcon(kind: icon) }
            .buttonStyle(FlowBarButtonStyle(isOn: same(controller.selEdges.map(\.arrow)) == a))
            .help(Text(label))
            .accessibilityLabel(Text(label))
    }
}

// MARK: - AI

/// "Create with AI" / "Update with AI" (web FlowchartAi.tsx). The server returns a sanitised draft; the
/// canvas lays it out and applies it as one change (⌘Z undoes it).
private struct FlowchartAiPanel: View {
    var controller: FlowchartController
    var hasChart: Bool
    @Environment(AppModel.self) private var app
    @State private var update: Bool
    @State private var text = ""
    @State private var busy = false
    @State private var error: AiProblem?
    @FocusState private var focused: Bool

    private static let createIdeaText = ["Customer refund process", "Hiring pipeline from application to offer", "How a pull request gets merged"]
    private static let updateIdeaText = ["Add an approval step after review", "Add error handling to every step", "Simplify it to the main steps"]

    init(controller: FlowchartController, hasChart: Bool) {
        self.controller = controller
        self.hasChart = hasChart
        _update = State(initialValue: hasChart)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if hasChart {
                HStack(spacing: 4) {
                    modeButton("Update this chart", on: update) { update = true }
                    modeButton("Start over", on: !update) { update = false }
                }
                .padding(.horizontal, 10)
                .padding(.top, 8)
                .accessibilityElement(children: .contain)
                .accessibilityLabel(Text("What the AI should do"))
            }
            HStack(alignment: .top, spacing: 8) {
                AiIcon(size: 15).padding(.top, 3)
                TextField(update ? "What should change? e.g. add an approval step after review" : "Describe a process, step by step or in a sentence…",
                          text: $text, axis: .vertical)
                    .textFieldStyle(.plain)
                    .font(.ui(14))
                    .foregroundStyle(FoleviColor.ink)
                    .lineLimit(2...6)
                    .disabled(busy)
                    .focused($focused)
                    .onSubmit { run(text) }
                    .accessibilityLabel(Text(update ? "What should change?" : "Describe the process"))
                Button { run(text) } label: {
                    Image(systemName: "arrow.up").font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(FoleviColor.canvas)
                        .frame(width: 28, height: 28)
                        .background(Circle().fill(FoleviColor.heading))
                }
                .buttonStyle(.plain)
                .disabled(busy || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .opacity(busy || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? 0.3 : 1)
                .accessibilityLabel(Text(update ? "Update flowchart" : "Create flowchart"))
                Button { controller.aiOpen = false } label: { Image(systemName: "xmark").font(.system(size: 12.5, weight: .medium)) }
                    .buttonStyle(FlowBarButtonStyle())
                    .help(Text("Close (Esc)"))
                    .accessibilityLabel(Text("Close AI"))
            }
            .padding(10)
            if busy {
                Text(update ? "Updating the flowchart…" : "Drawing your flowchart…")
                    .font(.ui(13))
                    .foregroundStyle(FoleviColor.inkMuted)
                    .padding(.horizontal, 14)
                    .padding(.top, 4)
                    .padding(.bottom, 10)
                    .accessibilityAddTraits(.updatesFrequently)
            } else if let error {
                if error.kind == .other {
                    Text(error.message)
                        .font(.ui(13))
                        .foregroundStyle(FoleviColor.destructive)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 14)
                        .padding(.top, 4)
                        .padding(.bottom, 10)
                } else {
                    AiProblemNotice(problem: error).padding(.horizontal, 12).padding(.bottom, 8)
                }
            } else {
                AiCreditsNote().padding(.horizontal, 12).padding(.bottom, 8)
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(update ? Self.updateIdeaText : Self.createIdeaText, id: \.self) { idea in
                        FlowAiIdeaRow(title: LocalizedStringKey(idea)) { text = idea }
                    }
                }
                .padding(.horizontal, 6)
                .padding(.top, 4)
                .padding(.bottom, 6)
                .overlay(alignment: .top) { Rectangle().fill(FoleviColor.line.opacity(0.6)).frame(height: 1) }
                .accessibilityElement(children: .contain)
                .accessibilityLabel(Text("Ideas"))
            }
            Text(update ? "AI can make mistakes. Sent to Google Gemini. Undo with ⌘Z." : "AI can make mistakes. Sent to Google Gemini.")
                .font(.ui(11))
                .foregroundStyle(FoleviColor.inkFaint)
                .padding(.horizontal, 14)
                .padding(.vertical, 7)
                .frame(maxWidth: .infinity, alignment: .leading)
                .overlay(alignment: .top) { Rectangle().fill(FoleviColor.line.opacity(0.6)).frame(height: 1) }
        }
        .foleviPop(radius: 12)
        .claimsFocus($focused)
        .onExitCommand { controller.aiOpen = false }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(update ? "Change the flowchart with AI" : "Create a flowchart with AI"))
    }

    private func modeButton(_ title: LocalizedStringKey, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.ui(12, .semibold))
                .foregroundStyle(on ? FoleviColor.heading : FoleviColor.inkMuted)
                .padding(.horizontal, 9)
                .padding(.vertical, 4)
                .background(Capsule().fill(on ? FoleviGlass.hover : .clear))
                .overlay { if on { Capsule().strokeBorder(FoleviGlass.border) } }
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private func run(_ instruction: String) {
        let trimmed = String(instruction.trimmingCharacters(in: .whitespacesAndNewlines).prefix(2000))
        guard !busy, !trimmed.isEmpty else { return }
        guard let session = app.session else {
            error = .other(FoleviError.offline.localizedDescription)
            return
        }
        busy = true
        error = nil
        let isUpdate = update
        var args: [String: JSONValue] = ["scope": session.scope.arg, "mode": .string(isUpdate ? "update" : "create"), "instruction": .string(trimmed)]
        if isUpdate { args["current"] = .string(Flowchart.serialize(controller.doc)) }
        Task { @MainActor in
            defer { busy = false }
            do {
                let draft: JSONValue = try await session.convex.action("ai:flowchart", args, timeout: 90)
                controller.applyDraft(draft, update: isUpdate)
                text = ""
            } catch {
                self.error = AiProblem.from(error)
            }
        }
    }
}

/// One idea under the flowchart AI's field: muted, darker with a soft fill on hover.
private struct FlowAiIdeaRow: View {
    var title: LocalizedStringKey
    var action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.ui(13))
                .foregroundStyle(hovering ? FoleviColor.heading : FoleviColor.inkMuted)
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 8)
                .padding(.vertical, 6)
                .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(hovering ? FoleviGlass.hover : .clear))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
    }
}
