import AppKit
import SwiftUI

/// Whiteboard block, as on the web (WhiteboardView.tsx): freehand drawing with pen, highlighter and a
/// stroke eraser, colours, pen sizes, undo and clear, in a fixed logical space (1000 wide) so the drawing
/// scales with the page. Drag the bottom edge (or use the arrow keys on it) to change the height.
struct WhiteboardBlockView: View {
    let block: Block
    let props: WhiteboardProps
    @Bindable var model: EditorModel
    @Environment(\.colorScheme) private var colorScheme

    enum Tool { case pen, highlighter, eraser }
    static let penColors = ["ink", "blue", "red", "green", "orange", "purple"]
    static let highlightColors = ["yellow", "green", "blue", "red"]
    static let penSizes: [(width: Double, label: String)] = [(2.5, "Fine"), (5, "Medium"), (10, "Thick")]
    static let colorNames = ["ink": "Black", "blue": "Blue", "red": "Red", "green": "Green", "orange": "Orange", "purple": "Purple", "yellow": "Yellow"]

    @State private var tool: Tool = .pen
    @State private var penColor = "ink"
    @State private var markColor = "yellow"
    @State private var penWidth = 2.5
    /// Local edits not yet written to the block (saved shortly after the pointer lifts).
    @State private var pending: [Whiteboard.Stroke]?
    @State private var undoStack: [[Whiteboard.Stroke]] = []
    @State private var draft: Whiteboard.Stroke?
    @State private var erasedThisDrag = false
    @State private var saveTask: Task<Void, Never>?
    @State private var canvasSize: CGSize = .zero
    @State private var liveHeight: Double?
    @State private var resizeStart: Double?
    @State private var resizeScale: Double = 1
    @State private var resizeHovering = false
    @FocusState private var resizeFocused: Bool

    private var editable: Bool { !model.isReadOnly }
    private var committed: [Whiteboard.Stroke] { Whiteboard.strokes(props.data) }
    private var strokes: [Whiteboard.Stroke] { pending ?? committed }
    private var savedHeight: Double { Whiteboard.clampHeight(props.height) }
    private var height: Double { liveHeight ?? savedHeight }

    var body: some View {
        VStack(spacing: 0) {
            if editable { toolbar }
            canvas
            if editable { resizeHandle }
        }
        .background(model.sheetPalette?.surface ?? FoleviColor.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(lineColor, lineWidth: 1))
        .richAtomOutline(model.selectedBlockIds.contains(block.id), accent: Color.folevi(accent: model.style.accent))
        .onDisappear { flush() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Whiteboard"))
    }

    private var lineColor: Color { model.sheetPalette?.line ?? FoleviColor.line }

    // MARK: Toolbar

    /// `.fb-wb-toolbar`: one row with Undo and Clear at the end, wrapping onto more rows when narrow.
    private var toolbar: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 4) {
                toolGroups
                Spacer(minLength: 4)
                historyButtons
            }
            FlowLayout(spacing: 4) {
                toolGroups
                historyButtons
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(FoleviColor.surfaceSunken.mix(with: model.sheetPalette?.surface ?? FoleviColor.surface, by: 0.45))
        .overlay(alignment: .bottom) { lineColor.frame(height: 1) }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Whiteboard tools"))
    }

    @ViewBuilder private var toolGroups: some View {
        toolButton(.pen, "pencil.line", "Pen")
        toolButton(.highlighter, "highlighter", "Highlighter")
        toolButton(.eraser, "eraser", "Eraser (removes whole strokes)")
        Rectangle().fill(FoleviColor.lineStrong).frame(width: 1, height: 18).padding(.horizontal, 4)
        if tool != .eraser {
            HStack(spacing: 4) {
                ForEach(tool == .highlighter ? Self.highlightColors : Self.penColors, id: \.self) { c in
                    let active = (tool == .highlighter ? markColor : penColor) == c
                    Button {
                        if tool == .highlighter { markColor = c } else { penColor = c }
                    } label: {
                        // A 24pt swatch; the chosen one gets a 2pt ink ring 2pt outside it.
                        Circle().fill(strokeColor(c))
                            .overlay(Circle().strokeBorder(.black.opacity(0.18), lineWidth: 1))
                            .frame(width: 24, height: 24)
                            .overlay {
                                if active {
                                    Circle().strokeBorder(FoleviColor.ink, lineWidth: 2).frame(width: 32, height: 32)
                                }
                            }
                            .frame(height: 30)
                            .contentShape(Circle())
                    }
                    .buttonStyle(.plain)
                    .help(Text(Self.colorNames[c] ?? c))
                    .accessibilityLabel(Text(Self.colorNames[c] ?? c))
                    .accessibilityAddTraits(active ? .isSelected : [])
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text(tool == .highlighter ? "Highlighter colour" : "Pen colour"))
        }
        if tool == .pen {
            HStack(spacing: 4) {
                ForEach(Self.penSizes, id: \.width) { s in
                    WhiteboardToolButton(isActive: penWidth == s.width, label: "\(s.label) pen") {
                        penWidth = s.width
                    } content: {
                        Circle().fill(.primary).frame(width: 3 + s.width * 0.9, height: 3 + s.width * 0.9)
                    }
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text("Pen size"))
        }
    }

    private var historyButtons: some View {
        HStack(spacing: 4) {
            WhiteboardToolButton(isActive: false, label: "Undo") { undo() } content: {
                Image(systemName: "arrow.uturn.backward").font(.system(size: 14, weight: .medium))
            }
            .disabled(undoStack.isEmpty)
            WhiteboardToolButton(isActive: false, label: "Clear whiteboard", help: "Clear") { clear() } content: {
                Image(systemName: "trash").font(.system(size: 14, weight: .medium))
            }
            .disabled(strokes.isEmpty)
        }
    }

    private func toolButton(_ t: Tool, _ icon: String, _ label: String) -> some View {
        WhiteboardToolButton(isActive: tool == t, label: label, help: t == .eraser ? "Eraser" : label) { tool = t } content: {
            Image(systemName: icon).font(.system(size: 14, weight: .medium))
        }
    }

    // MARK: Canvas

    private var canvas: some View {
        let ink = model.sheetPalette?.ink ?? FoleviColor.ink
        let dark = model.sheetPalette?.isDark ?? (colorScheme == .dark)
        let shown = strokes
        let current = draft
        let h = height
        let dotStep = 22 * model.app.editorScale
        let dotColor = FoleviColor.lineStrong.opacity(0.7)
        return Canvas { ctx, size in
            // Dot grid: a dot every 22pt of the page (the web's 22px background tile), not of the drawing.
            let step = dotStep
            if step > 4 {
                var dots = Path()
                var y = step / 2
                while y < size.height {
                    var x = step / 2
                    while x < size.width {
                        dots.addEllipse(in: CGRect(x: x - 1, y: y - 1, width: 2, height: 2))
                        x += step
                    }
                    y += step
                }
                ctx.fill(dots, with: .color(dotColor))
            }
            let k = size.width / Double(Whiteboard.width)
            ctx.scaleBy(x: k, y: k)
            for s in shown + (current.map { [$0] } ?? []) {
                let path = WhiteboardPath.path(for: s)
                ctx.stroke(path, with: .color(Self.color(s.color, ink: ink, dark: dark).opacity(s.opacity ?? 1)),
                           style: StrokeStyle(lineWidth: s.width, lineCap: .round, lineJoin: .round))
            }
        }
        .aspectRatio(Double(Whiteboard.width) / h, contentMode: .fit)
        .frame(maxWidth: .infinity)
        .onGeometryChange(for: CGSize.self) { $0.size } action: { canvasSize = $0 }
        .contentShape(Rectangle())
        .gesture(drawGesture, including: editable ? .all : .subviews)
        .pointerStyle(editable ? .rectSelection : nil)
        .accessibilityElement()
        .accessibilityLabel(Text(shown.isEmpty
            ? (editable ? String(localized: "Empty whiteboard. Draw with a mouse, pen or finger") : String(localized: "Empty whiteboard"))
            : shown.count == 1 ? String(localized: "Whiteboard drawing with 1 stroke")
            : String(localized: "Whiteboard drawing with \(shown.count) strokes")))
    }

    static func color(_ name: String, ink: Color, dark: Bool) -> Color {
        if name.hasPrefix("#") { return Color(hex: name) ?? ink }
        let light = ["blue": "#2563eb", "red": "#dc2626", "green": "#16a34a", "orange": "#ea580c", "purple": "#7c3aed", "yellow": "#facc15"]
        let night = ["blue": "#60a5fa", "red": "#f87171", "green": "#4ade80", "orange": "#fb923c", "purple": "#a78bfa", "yellow": "#fde047"]
        guard let hex = (dark ? night : light)[name] else { return ink }
        return Color(hex: hex) ?? ink
    }

    private func strokeColor(_ name: String) -> Color {
        Self.color(name, ink: model.sheetPalette?.ink ?? FoleviColor.ink, dark: model.sheetPalette?.isDark ?? (colorScheme == .dark))
    }

    private func point(_ location: CGPoint) -> (Double, Double) {
        guard canvasSize.width > 0, canvasSize.height > 0 else { return (0, 0) }
        let x = Double(location.x / canvasSize.width) * Double(Whiteboard.width)
        let y = Double(location.y / canvasSize.height) * height
        return ((x * 10).rounded() / 10, (y * 10).rounded() / 10)
    }

    private var currentStyle: (color: String, width: Double, opacity: Double?) {
        tool == .highlighter ? (markColor, 18, 0.4) : (penColor, penWidth, nil)
    }

    private var drawGesture: some Gesture {
        DragGesture(minimumDistance: 0, coordinateSpace: .local)
            .onChanged { value in
                guard editable else { return }
                let p = point(value.location)
                if !dragging {
                    // Pointer down.
                    dragging = true
                    saveTask?.cancel()
                    erasedThisDrag = false
                    if tool == .eraser {
                        eraseAt(p)
                    } else {
                        let s = currentStyle
                        draft = Whiteboard.Stroke(points: [p], color: s.color, width: s.width, opacity: s.opacity)
                    }
                    return
                }
                if tool == .eraser {
                    eraseAt(p)
                } else if var d = draft, var pts = d.points, let last = pts.last {
                    guard hypot(p.0 - last.0, p.1 - last.1) >= 1.5, pts.count < 3000 else { return }
                    pts.append(p)
                    d.points = pts
                    draft = d
                }
            }
            .onEnded { _ in
                dragging = false
                guard editable else { return }
                if tool == .eraser {
                    if erasedThisDrag { save(strokes) }
                    erasedThisDrag = false
                    return
                }
                guard let d = draft else { return }
                draft = nil
                pushUndo()
                save(strokes + [d])
            }
    }

    @State private var dragging = false

    private func eraseAt(_ p: (Double, Double)) {
        let current = strokes
        let kept = current.filter { !Whiteboard.strokeHit($0, p, radius: 8) }
        guard kept.count != current.count else { return }
        if !erasedThisDrag {
            pushUndo()
            erasedThisDrag = true
        }
        pending = kept
    }

    private func pushUndo() {
        undoStack.append(strokes)
        if undoStack.count > 100 { undoStack.removeFirst() }
    }

    private func undo() {
        guard let prev = undoStack.popLast() else { return }
        save(prev)
    }

    private func clear() {
        guard !strokes.isEmpty else { return }
        pushUndo()
        save([])
    }

    /// Saves after a short pause (debounced), like the web.
    private func save(_ next: [Whiteboard.Stroke]) {
        pending = next
        saveTask?.cancel()
        saveTask = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }
            write(next)
        }
    }

    private func flush() {
        guard let saveTask, let pending else { return }
        saveTask.cancel()
        self.saveTask = nil
        write(pending)
    }

    private func write(_ next: [Whiteboard.Stroke]) {
        let data = Whiteboard.serialize(next)
        if data.utf16.count > FoleviLimits.maxWhiteboardDataLength {
            pending = nil
            model.app.showToast(String(localized: "This whiteboard is full. Clear some strokes to keep drawing."))
            return
        }
        model.update(block.id, actionName: String(localized: "Drawing")) { b in
            guard case .whiteboard(var p) = b.content else { return }
            p.data = data
            b.content = .whiteboard(p)
        }
        pending = nil
        saveTask = nil
    }

    // MARK: Height

    private var resizeHandle: some View {
        ZStack {
            Capsule().fill(resizeStart != nil || resizeHovering ? FoleviColor.inkFaint : FoleviColor.lineStrong).frame(width: 36, height: 4)
        }
        .frame(maxWidth: .infinity)
        .frame(height: 14)
        .overlay(alignment: .top) { lineColor.frame(height: 1) }
        .contentShape(Rectangle())
        .onHover { resizeHovering = $0 }
        .pointerStyle(.frameResize(position: .bottom))
        .gesture(
            DragGesture(minimumDistance: 1, coordinateSpace: .global)
                .onChanged { value in
                    if resizeStart == nil {
                        resizeStart = height
                        resizeScale = canvasSize.height > 0 ? height / Double(canvasSize.height) : 1
                    }
                    liveHeight = clampHeight((resizeStart ?? height) + Double(value.translation.height) * resizeScale)
                }
                .onEnded { _ in
                    resizeStart = nil
                    commitHeight(height)
                }
        )
        .focusable()
        .focused($resizeFocused)
        .focusEffectDisabled()
        .overlay { if resizeFocused { Rectangle().strokeBorder(FoleviColor.focus, lineWidth: 2) } }
        .onKeyPress(.downArrow) { commitHeight(clampHeight(height + 40)); return .handled }
        .onKeyPress(.upArrow) { commitHeight(clampHeight(height - 40)); return .handled }
        .help(Text("Drag to resize (or use the arrow keys)"))
        .accessibilityElement()
        .accessibilityLabel(Text("Whiteboard height"))
        .accessibilityValue(Text("\(Int(height))"))
        .accessibilityAdjustableAction { direction in
            commitHeight(clampHeight(height + (direction == .increment ? 40 : -40)))
        }
    }

    private func clampHeight(_ h: Double) -> Double {
        max(Double(FoleviLimits.minWhiteboardHeight), min(Double(FoleviLimits.maxWhiteboardHeight), h.rounded()))
    }

    private func commitHeight(_ h: Double) {
        liveHeight = nil
        guard h != savedHeight else { return }
        model.update(block.id, actionName: String(localized: "Resize Whiteboard")) { b in
            guard case .whiteboard(var p) = b.content else { return }
            p.height = h
            b.content = .whiteboard(p)
        }
    }
}

/// A 30pt toolbar button (fb-wb-btn): muted, accent-soft when hovered or pressed in.
private struct WhiteboardToolButton<Content: View>: View {
    var isActive: Bool
    var label: String
    var help: String?
    var action: () -> Void
    @ViewBuilder var content: () -> Content
    @State private var hovering = false
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        Button(action: action) {
            content()
                .foregroundStyle(isActive || (hovering && isEnabled) ? FoleviColor.heading : FoleviColor.inkMuted)
                .frame(width: 30, height: 30)
                .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(isActive || (hovering && isEnabled) ? FoleviColor.accentSoft : .clear))
                .overlay {
                    if isActive { RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(FoleviColor.lineStrong, lineWidth: 1) }
                }
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .opacity(isEnabled ? 1 : 0.35)
        .onHover { hovering = $0 }
        .help(Text(help ?? label))
        .accessibilityLabel(Text(label))
        .accessibilityAddTraits(isActive ? .isSelected : [])
    }
}

extension View {
    /// `.fb-atom-selected`: a 2pt outline in the note's accent, 3pt outside a selected rich block
    /// (formula, whiteboard, audio).
    func richAtomOutline(_ selected: Bool, accent: Color) -> some View {
        overlay {
            if selected {
                RoundedRectangle(cornerRadius: 11, style: .continuous)
                    .strokeBorder(accent, lineWidth: 2)
                    .padding(-5)
                    .allowsHitTesting(false)
            }
        }
    }
}

/// SwiftUI paths for strokes: smoothed points (the web's strokePath) or an SVG path `d`.
enum WhiteboardPath {
    static func path(for stroke: Whiteboard.Stroke) -> Path {
        if let pts = stroke.points { return smooth(pts) }
        return svg(stroke.d ?? "")
    }

    static func smooth(_ points: [(Double, Double)]) -> Path {
        var p = Path()
        guard let first = points.first else { return p }
        p.move(to: CGPoint(x: first.0, y: first.1))
        if points.count == 1 {
            p.addLine(to: CGPoint(x: first.0 + 0.1, y: first.1))
            return p
        }
        if points.count == 2 {
            p.addLine(to: CGPoint(x: points[1].0, y: points[1].1))
            return p
        }
        for i in 1..<(points.count - 1) {
            let (x, y) = points[i], (nx, ny) = points[i + 1]
            p.addQuadCurve(to: CGPoint(x: (x + nx) / 2, y: (y + ny) / 2), control: CGPoint(x: x, y: y))
        }
        let last = points[points.count - 1]
        p.addLine(to: CGPoint(x: last.0, y: last.1))
        return p
    }

    /// A small SVG path reader for M L H V Q T C S Z (absolute and relative).
    static func svg(_ d: String) -> Path {
        var path = Path()
        var tokens: [String] = []
        var num = ""
        func flush() { if !num.isEmpty { tokens.append(num); num = "" } }
        for c in d {
            if c.isLetter && c != "e" && c != "E" { flush(); tokens.append(String(c)) } else if c == "," || c.isWhitespace { flush() } else if c == "-" && !num.isEmpty && !(num.last == "e" || num.last == "E") { flush(); num = "-" } else { num.append(c) }
        }
        flush()
        var i = 0
        var cmd: Character = "M"
        var cur = CGPoint.zero, start = CGPoint.zero, lastControl: CGPoint?
        func next() -> Double? {
            guard i < tokens.count, let v = Double(tokens[i]) else { return nil }
            i += 1
            return v
        }
        while i < tokens.count {
            if let c = tokens[i].first, c.isLetter { cmd = c; i += 1 }
            let rel = cmd.isLowercase
            let base = rel ? cur : .zero
            switch cmd.uppercased().first ?? "M" {
            case "M":
                guard let x = next(), let y = next() else { i += 1; continue }
                cur = CGPoint(x: base.x + x, y: base.y + y); start = cur
                path.move(to: cur)
                cmd = rel ? "l" : "L"
                lastControl = nil
            case "L":
                guard let x = next(), let y = next() else { i += 1; continue }
                cur = CGPoint(x: base.x + x, y: base.y + y)
                path.addLine(to: cur); lastControl = nil
            case "H":
                guard let x = next() else { i += 1; continue }
                cur = CGPoint(x: (rel ? cur.x : 0) + x, y: cur.y); path.addLine(to: cur); lastControl = nil
            case "V":
                guard let y = next() else { i += 1; continue }
                cur = CGPoint(x: cur.x, y: (rel ? cur.y : 0) + y); path.addLine(to: cur); lastControl = nil
            case "Q":
                guard let cx = next(), let cy = next(), let x = next(), let y = next() else { i += 1; continue }
                let c = CGPoint(x: base.x + cx, y: base.y + cy)
                cur = CGPoint(x: base.x + x, y: base.y + y)
                path.addQuadCurve(to: cur, control: c); lastControl = c
            case "T":
                guard let x = next(), let y = next() else { i += 1; continue }
                let c = lastControl.map { CGPoint(x: 2 * cur.x - $0.x, y: 2 * cur.y - $0.y) } ?? cur
                cur = CGPoint(x: base.x + x, y: base.y + y)
                path.addQuadCurve(to: cur, control: c); lastControl = c
            case "C":
                guard let x1 = next(), let y1 = next(), let x2 = next(), let y2 = next(), let x = next(), let y = next() else { i += 1; continue }
                let c2 = CGPoint(x: base.x + x2, y: base.y + y2)
                cur = CGPoint(x: base.x + x, y: base.y + y)
                path.addCurve(to: cur, control1: CGPoint(x: base.x + x1, y: base.y + y1), control2: c2); lastControl = c2
            case "S":
                guard let x2 = next(), let y2 = next(), let x = next(), let y = next() else { i += 1; continue }
                let c1 = lastControl.map { CGPoint(x: 2 * cur.x - $0.x, y: 2 * cur.y - $0.y) } ?? cur
                let c2 = CGPoint(x: base.x + x2, y: base.y + y2)
                cur = CGPoint(x: base.x + x, y: base.y + y)
                path.addCurve(to: cur, control1: c1, control2: c2); lastControl = c2
            case "Z":
                path.closeSubpath(); cur = start; lastControl = nil
            default:
                i += 1
            }
        }
        return path
    }
}
