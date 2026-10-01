import AppKit
import SwiftUI

/// A Mermaid code block, as on the web (codeView.ts): a diagram card with the source folded away until it's
/// being edited ("Edit diagram" / "Done", or while the caret is in it), and "Convert to flowchart" for
/// flowchart diagrams. Flowcharts are laid out and drawn natively (Domain/MermaidFlow.swift); other diagram
/// kinds keep showing their source.
struct MermaidBlockView: View {
    let block: Block
    let props: CodeProps
    @Bindable var model: EditorModel
    var focusRequest: FocusRequest?
    @State private var editingByButton = false
    @State private var hovering = false
    @State private var note: String?

    private var editing: Bool {
        editingByButton || model.focusedBlockId == block.id || props.code.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var selected: Bool { model.selectedBlockIds.contains(block.id) }

    var body: some View {
        let parsed = MermaidFlow.parse(props.code)
        VStack(spacing: 0) {
            if editing {
                bar(editingHeader: true)
                CodeBlockView(block: block, props: props, model: model, focusRequest: focusRequest, flat: true)
                    .overlay(alignment: .bottom) { line.frame(height: 1) }
            }
            switch parsed {
            case .success(let diagram):
                MermaidDiagramView(diagram: diagram, palette: model.sheetPalette)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 22)
                    .frame(maxWidth: .infinity, minHeight: 64)
            case .failure(let error):
                if !editing {
                    CodeBlockView(block: block, props: props, model: model, focusRequest: focusRequest, flat: true)
                }
                if !props.code.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Text(message(error))
                        .font(.ui(13))
                        .foregroundStyle(FoleviColor.coralInk)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(FoleviColor.coralSoft.mix(with: FoleviColor.surface, by: 0.4)))
                        .padding(.horizontal, 20)
                        .padding(.vertical, 22)
                } else {
                    Text("Write a Mermaid diagram above to see it here.")
                        .font(.ui(13))
                        .foregroundStyle(FoleviColor.inkMuted)
                        .padding(.horizontal, 20)
                        .padding(.vertical, 22)
                        .frame(maxWidth: .infinity, minHeight: 64)
                }
            }
        }
        .background(model.sheetPalette?.surface ?? FoleviColor.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(selected ? Color.folevi(accent: model.style.accent) : hovering || editing ? FoleviColor.lineStrong : line,
                              lineWidth: selected ? 2 : 1)
        }
        .overlay(alignment: .topTrailing) {
            if !editing && !model.isReadOnly && (hovering || selected) { bar(editingHeader: false).padding(8) }
        }
        .onHover { hovering = $0 }
        .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .onTapGesture(count: 2) { if !model.isReadOnly { edit() } }
        .onTapGesture { if !editing { model.select(block.id, extend: false) } }
        .onChange(of: editing) { _, on in if !on { note = nil } }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Mermaid diagram"))
    }

    private var line: Color { model.sheetPalette?.line ?? FoleviColor.line }

    private func message(_ e: MermaidFlow.ParseError) -> String {
        switch e {
        case .notFlowchart: return String(localized: "Couldn’t draw this diagram. The Mac draws Mermaid flowcharts; open this page on the web for other kinds.")
        case .empty: return String(localized: "Couldn’t draw this diagram. The diagram is empty.")
        case .unreadable: return String(localized: "Couldn’t draw this diagram. Couldn’t read any shapes from this diagram.")
        }
    }

    /// The slim bar (12pt, weight 550): over the drawing a glass pill at the top right, shown on hover; while
    /// editing a header above the source with the "Mermaid" label.
    @ViewBuilder private func bar(editingHeader: Bool) -> some View {
        HStack(spacing: 4) {
            if editingHeader {
                Text("Mermaid").font(.ui(12, .semibold)).tracking(0.24).foregroundStyle(FoleviColor.inkMuted)
                Spacer()
            }
            if let note {
                Text(note).font(.ui(12, .medium)).foregroundStyle(FoleviColor.coralInk).lineLimit(1).truncationMode(.tail)
                    .frame(maxWidth: 220, alignment: .trailing)
                    .accessibilityAddTraits(.updatesFrequently)
            }
            if !model.isReadOnly {
                if MermaidConvert.isFlowchartSource(props.code) {
                    MermaidBarButton(title: "Convert to flowchart", help: "Turn this diagram into an editable flowchart") { convert() }
                }
                MermaidBarButton(title: editing ? "Done" : "Edit diagram", help: nil) { editing ? done() : edit() }
                    .accessibilityValue(Text(editing ? "Expanded" : "Collapsed"))
            }
        }
        .padding(editingHeader ? EdgeInsets(top: 5, leading: 14, bottom: 5, trailing: 6) : EdgeInsets(top: 3, leading: 3, bottom: 3, trailing: 3))
        .background {
            if editingHeader {
                FoleviColor.surfaceSunken.mix(with: model.sheetPalette?.surface ?? FoleviColor.surface, by: 0.55)
                    .overlay(alignment: .bottom) { line.frame(height: 1) }
            } else {
                Color.clear.foleviSurface(.color(FoleviColor.surfaceRaised), shape: .rounded(10), shadow: FoleviShadow.pop)
            }
        }
    }

    private func edit() {
        editingByButton = true
        model.focus = FocusRequest(blockId: block.id, caret: .end)
    }

    private func done() {
        editingByButton = false
        model.select(block.id, extend: false)
    }

    /// Replaces the block with an editable flowchart (one undo step), or says why it can't.
    private func convert() {
        switch MermaidConvert.convert(props.code) {
        case .failure(let e):
            note = e.text
        case .success(let r):
            let flow = FlowchartProps(data: Flowchart.serialize(r.data), height: r.height)
            editingByButton = false
            model.update(block.id, actionName: String(localized: "Convert to Flowchart")) { b in
                b.content = .unknown(type: FlowchartProps.type, props: flow.json)
            }
            model.select(block.id, extend: false)
        }
    }
}

/// A bar button (26pt tall, 7pt corners): ink text, a glass fill and the heading colour on hover.
private struct MermaidBarButton: View {
    var title: LocalizedStringKey
    var help: LocalizedStringKey?
    var action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.ui(12, .semibold))
                .foregroundStyle(hovering ? FoleviColor.heading : FoleviColor.ink)
                .padding(.horizontal, 10)
                .frame(height: 26)
                .background(RoundedRectangle(cornerRadius: 7, style: .continuous).fill(hovering ? FoleviColor.accentSoft : .clear))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .help(help.map { Text($0) } ?? Text(""))
    }
}

/// A laid-out Mermaid flowchart, drawn to fit the width (never larger than its natural size).
struct MermaidDiagramView: View {
    var diagram: MermaidFlow.Diagram
    var palette: SheetPalette?

    static var font: NSFont { .systemFont(ofSize: 13.5) }

    var body: some View {
        let laid = MermaidFlow.layout(Self.sized(diagram))
        let w = max(laid.width, 1), h = max(laid.height, 1)
        let ink = palette?.ink ?? FoleviColor.ink
        let lineColor = (palette?.ink ?? FoleviColor.ink).opacity(0.55)
        let fill = FoleviColor.accentSoft.mix(with: palette?.surface ?? FoleviColor.surface, by: 0.35)
        let decisionFill = FoleviColor.marigoldSoft.mix(with: palette?.surface ?? FoleviColor.surface, by: 0.35)
        let labelBg = palette?.surface ?? FoleviColor.surface
        Canvas { ctx, size in
            let k = min(1, size.width / w)
            ctx.translateBy(x: (size.width - w * k) / 2, y: 0)
            ctx.scaleBy(x: k, y: k)
            let byId = Dictionary(uniqueKeysWithValues: laid.nodes.map { ($0.id, $0) })
            // Edges under the nodes.
            for e in laid.edges {
                guard let a = byId[e.from], let b = byId[e.to] else { continue }
                let ca = CGPoint(x: a.x + a.w / 2, y: a.y + a.h / 2), cb = CGPoint(x: b.x + b.w / 2, y: b.y + b.h / 2)
                let p1 = Self.boundary(a, toward: cb), p2 = Self.boundary(b, toward: ca)
                var path = Path()
                path.move(to: p1)
                path.addLine(to: p2)
                ctx.stroke(path, with: .color(lineColor), style: StrokeStyle(lineWidth: e.thick ? 2.6 : 1.4, lineCap: .round, dash: e.dashed ? [5, 4] : []))
                if e.arrow != .none { ctx.fill(Self.arrowHead(at: p2, from: p1), with: .color(lineColor)) }
                if e.arrow == .both { ctx.fill(Self.arrowHead(at: p1, from: p2), with: .color(lineColor)) }
                if !e.label.isEmpty {
                    let mid = CGPoint(x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2)
                    let text = ctx.resolve(Text(e.label).font(.ui(12)).foregroundColor(ink))
                    let s = text.measure(in: CGSize(width: 180, height: 200))
                    let r = CGRect(x: mid.x - s.width / 2 - 5, y: mid.y - s.height / 2 - 2, width: s.width + 10, height: s.height + 4)
                    ctx.fill(Path(roundedRect: r, cornerRadius: 5), with: .color(labelBg))
                    ctx.draw(text, in: r.insetBy(dx: 5, dy: 2))
                }
            }
            for n in laid.nodes {
                let rect = CGRect(x: n.x, y: n.y, width: n.w, height: n.h)
                let shape = Self.shapePath(n.shape, rect)
                ctx.fill(shape, with: .color(n.shape == .decision ? decisionFill : fill))
                ctx.stroke(shape, with: .color(lineColor), lineWidth: 1.3)
                if n.shape == .subroutine {
                    var inner = Path()
                    inner.move(to: CGPoint(x: rect.minX + 8, y: rect.minY)); inner.addLine(to: CGPoint(x: rect.minX + 8, y: rect.maxY))
                    inner.move(to: CGPoint(x: rect.maxX - 8, y: rect.minY)); inner.addLine(to: CGPoint(x: rect.maxX - 8, y: rect.maxY))
                    ctx.stroke(inner, with: .color(lineColor), lineWidth: 1.3)
                }
                let text = ctx.resolve(Text(n.text).font(.system(size: 13.5)).foregroundColor(ink))
                let inset = Self.textInset(n.shape, rect)
                let s = text.measure(in: inset.size)
                ctx.draw(text, in: CGRect(x: inset.midX - s.width / 2, y: inset.midY - s.height / 2, width: s.width, height: s.height))
            }
        }
        .aspectRatio(w / h, contentMode: .fit)
        .frame(maxWidth: w, maxHeight: min(h, 640))
        .frame(maxWidth: .infinity)
        .accessibilityElement()
        .accessibilityLabel(Text("Diagram with \(laid.nodes.count) shapes: \(laid.nodes.map(\.text).joined(separator: ", "))"))
    }

    /// Sizes nodes to their labels (up to 240 wide), like the web's fitNodeToText.
    static func sized(_ d: MermaidFlow.Diagram) -> MermaidFlow.Diagram {
        var out = d
        out.nodes = d.nodes.map { n in
            var m = n
            let attr = NSAttributedString(string: n.text, attributes: [.font: font])
            let single = attr.size()
            let pad: Double = n.shape == .decision ? 64 : n.shape == .io ? 48 : 32
            let width = min(240, max(n.w, Double(single.width) + pad))
            let bounds = attr.boundingRect(with: NSSize(width: width - pad, height: 1000), options: [.usesLineFragmentOrigin])
            let base = MermaidFlow.baseSize(n.shape)
            m.w = (width / 8).rounded(.up) * 8
            m.h = max(base.h * (n.shape == .circle ? 1 : 0.75), (Double(bounds.height) + (n.shape == .decision ? 48 : 24)) / 8 * 8)
            if n.shape == .circle { let s = max(m.w, m.h); m.w = s; m.h = s }
            return m
        }
        return out
    }

    static func shapePath(_ shape: MermaidFlow.Shape, _ r: CGRect) -> Path {
        switch shape {
        case .decision:
            var p = Path()
            p.move(to: CGPoint(x: r.midX, y: r.minY)); p.addLine(to: CGPoint(x: r.maxX, y: r.midY))
            p.addLine(to: CGPoint(x: r.midX, y: r.maxY)); p.addLine(to: CGPoint(x: r.minX, y: r.midY)); p.closeSubpath()
            return p
        case .terminator: return Path(roundedRect: r, cornerRadius: r.height / 2)
        case .circle: return Path(ellipseIn: r)
        case .database: return Path(roundedRect: r, cornerSize: CGSize(width: r.width / 2, height: 10))
        case .io:
            var p = Path()
            let s: CGFloat = 14
            p.move(to: CGPoint(x: r.minX + s, y: r.minY)); p.addLine(to: CGPoint(x: r.maxX, y: r.minY))
            p.addLine(to: CGPoint(x: r.maxX - s, y: r.maxY)); p.addLine(to: CGPoint(x: r.minX, y: r.maxY)); p.closeSubpath()
            return p
        case .note:
            var p = Path()
            let f: CGFloat = 14
            p.move(to: CGPoint(x: r.minX, y: r.minY)); p.addLine(to: CGPoint(x: r.maxX - f, y: r.minY))
            p.addLine(to: CGPoint(x: r.maxX, y: r.minY + f)); p.addLine(to: CGPoint(x: r.maxX, y: r.maxY))
            p.addLine(to: CGPoint(x: r.minX, y: r.maxY)); p.closeSubpath()
            return p
        case .process, .subroutine: return Path(roundedRect: r, cornerRadius: shape == .subroutine ? 2 : 8)
        }
    }

    static func textInset(_ shape: MermaidFlow.Shape, _ r: CGRect) -> CGRect {
        switch shape {
        case .decision: return r.insetBy(dx: r.width * 0.2, dy: r.height * 0.15)
        case .io: return r.insetBy(dx: 20, dy: 8)
        case .circle: return r.insetBy(dx: r.width * 0.15, dy: r.height * 0.15)
        default: return r.insetBy(dx: 12, dy: 6)
        }
    }

    /// Where the line from the node's centre toward `p` leaves the node.
    static func boundary(_ n: MermaidFlow.Node, toward p: CGPoint) -> CGPoint {
        let c = CGPoint(x: n.x + n.w / 2, y: n.y + n.h / 2)
        let dx = p.x - c.x, dy = p.y - c.y
        guard dx != 0 || dy != 0 else { return c }
        let hw = n.w / 2, hh = n.h / 2
        let t: CGFloat
        switch n.shape {
        case .circle:
            t = 1 / ((dx * dx) / (hw * hw) + (dy * dy) / (hh * hh)).squareRoot()
        case .decision:
            t = 1 / (abs(dx) / hw + abs(dy) / hh)
        default:
            t = min(abs(dx) > 0 ? hw / abs(dx) : .infinity, abs(dy) > 0 ? hh / abs(dy) : .infinity)
        }
        return CGPoint(x: c.x + dx * t, y: c.y + dy * t)
    }

    static func arrowHead(at tip: CGPoint, from: CGPoint) -> Path {
        let angle = atan2(tip.y - from.y, tip.x - from.x)
        let len: CGFloat = 9, spread: CGFloat = 0.42
        var p = Path()
        p.move(to: tip)
        p.addLine(to: CGPoint(x: tip.x - len * cos(angle - spread), y: tip.y - len * sin(angle - spread)))
        p.addLine(to: CGPoint(x: tip.x - len * cos(angle + spread), y: tip.y - len * sin(angle + spread)))
        p.closeSubpath()
        return p
    }
}
