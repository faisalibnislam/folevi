// The note's Insert tool on the iPhone, drawn natively (apps/web/src/components/doc/InsertPanel.tsx in the iPhone
// layout): a search field under the sheet's title, then the sections (Suggested, Text, Lists and tasks, Layout,
// Visuals, Media, Data and more) of picture tiles, four to a row, each in its block's colour family, and a Quick
// table picker at the end. Sections, tiles and pictures come from Generated/InsertCatalog.swift, written from the
// web's own components. A tile inserts below the current line (`insert { kind }`).
import CoreText
import SwiftUI

public struct InsertTileSpec: Sendable, Identifiable, Equatable {
    public let kind: String
    public let label: String
    /// The accessible name when it says more than the label (the divider styles).
    public let name: String?
    /// The picture's kind (nil: a divider, drawn as its line).
    public let preview: String?
    /// The colour family the picture is drawn in ("moss", "ember", ...; nil: the ink).
    public let hue: String?
    public let keywords: String
    public var id: String { kind }
}

public struct InsertSectionSpec: Sendable {
    public let title: String
    public let tiles: [InsertTileSpec]
}

/// What a picture's mark is painted with: the text colour, the paper (raised surface) or the accent.
public enum InsertInk: Sendable { case current, paper, accent }

public struct InsertPaint: Sendable {
    public var fill: InsertInk?
    public var fillOpacity: CGFloat
    public var stroke: InsertInk?
    public var strokeOpacity: CGFloat
    public var strokeWidth: CGFloat
    public var roundCap: Bool
    public var roundJoin: Bool
    public var dash: [CGFloat]
}

public struct InsertRotation: Sendable {
    public var degrees: CGFloat
    public var cx: CGFloat
    public var cy: CGFloat
}

/// One mark of an Insert picture, on its 48 x 36 grid.
public indirect enum InsertArt: Sendable {
    case shape(WebIconNode, InsertPaint)
    case text(String, x: CGFloat, y: CGFloat, size: CGFloat, weight: CGFloat, italic: Bool, centered: Bool, serif: Bool, paint: InsertPaint)
    case group(rotate: InsertRotation?, clip: WebIconNode?, [InsertArt])
}

/// An Insert tile's picture: the marks drawn in the tile's colour family (or the ink), the paper in the raised
/// surface's colour.
public struct InsertPicture: View {
    let preview: String
    let hue: String?
    @Environment(\.colorScheme) private var scheme

    public init(preview: String, hue: String?) {
        self.preview = preview
        self.hue = hue
    }

    public var body: some View {
        let art = InsertCatalog.pictures[preview] ?? []
        // (The picture's own `text-ink` keeps its marks in the ink; only the accent takes the tile's colour.)
        let current = FoleviTokens.Chrome.ink.resolve(scheme).color
        let accent = (hue.flatMap { FoleviTokens.Chrome.named[$0] } ?? FoleviTokens.Chrome.accent).resolve(scheme).color
        let paper = FoleviTokens.Chrome.surfaceRaised.resolve(scheme).color
        Canvas { context, size in
            context.scaleBy(x: size.width / 48, y: size.height / 36)
            Self.draw(art, in: &context) { ink in
                switch ink {
                case .current: current
                case .paper: paper
                case .accent: accent
                }
            }
        }
        .frame(width: 48, height: 36)
        .accessibilityHidden(true)
    }

    private static func draw(_ art: [InsertArt], in context: inout GraphicsContext, color: (InsertInk) -> Color) {
        for a in art {
            switch a {
            case .shape(let node, let paint):
                let cg = CGMutablePath()
                node.add(to: cg)
                let path = Path(cg)
                if let fill = paint.fill { context.fill(path, with: .color(color(fill).opacity(paint.fillOpacity))) }
                if let stroke = paint.stroke {
                    context.stroke(path, with: .color(color(stroke).opacity(paint.strokeOpacity)), style: StrokeStyle(lineWidth: paint.strokeWidth, lineCap: paint.roundCap ? .round : .butt, lineJoin: paint.roundJoin ? .round : .miter, dash: paint.dash))
                }
            case .text(let s, let x, let y, let size, let weight, let italic, let centered, let serif, let paint):
                let font = WebFont.font(serif ? .display : .sans, size: size, weight: weight, italic: italic)
                let text = context.resolve(Text(s).font(font).foregroundStyle(color(paint.fill ?? .current).opacity(paint.fillOpacity)))
                // (SVG text sits on its baseline at y.)
                context.draw(text, at: CGPoint(x: x, y: y), anchor: UnitPoint(x: centered ? 0.5 : 0, y: 0.78))
            case .group(let rotate, let clip, let inner):
                var g = context
                if let clip {
                    let cg = CGMutablePath()
                    clip.add(to: cg)
                    g.clip(to: Path(cg))
                }
                if let r = rotate {
                    g.translateBy(x: r.cx, y: r.cy)
                    g.rotate(by: .degrees(r.degrees))
                    g.translateBy(x: -r.cx, y: -r.cy)
                }
                draw(inner, in: &g, color: color)
            }
        }
    }
}

/// A divider style's line (insert-blocks.css `.fb-line-preview`): dots, fine dots, a hairline or a strong rule.
struct InsertDividerLine: View {
    let style: String
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let faint = FoleviTokens.Chrome.inkFaint.resolve(scheme).color
        let ink = FoleviTokens.Chrome.ink.resolve(scheme).color
        Group {
            switch style {
            case "extralight":
                Canvas { c, size in
                    var x: CGFloat = 5
                    while x < size.width {
                        c.fill(Path(ellipseIn: CGRect(x: x - 1.1, y: size.height / 2 - 1.1, width: 2.2, height: 2.2)), with: .color(faint))
                        x += 10
                    }
                }
                .frame(height: 4)
                .opacity(0.8)
            case "light":
                Canvas { c, size in
                    var x: CGFloat = 2
                    while x < size.width {
                        c.fill(Path(ellipseIn: CGRect(x: x - 0.7, y: size.height / 2 - 0.7, width: 1.4, height: 1.4)), with: .color(faint))
                        x += 4
                    }
                }
                .frame(height: 2)
            case "strong":
                RoundedRectangle(cornerRadius: FoleviTokens.Radius.tiny).fill(ink.opacity(0.4)).frame(height: 3)
            default:
                FoleviTokens.Chrome.lineStrong.resolve(scheme).color.frame(height: 1)
            }
        }
        .padding(.horizontal, 12)
        .frame(maxWidth: .infinity)
    }
}

/// The Insert sheet's content (inside a PhoneSheetPanel titled "Insert").
public struct PhoneInsertSheetContent: View {
    let scanner: Bool
    let stockPhotos: Bool
    let insert: (String) -> Void
    /// The match harness's sample: only these sections, without the search field.
    var sampleTitles: [String]?
    @State private var query = ""
    @Environment(\.colorScheme) private var scheme

    /// `scanner`: the device can scan (adds Scan document and Scan from photos to Media); `stockPhotos`: Unsplash is
    /// offered (not in local mode).
    public init(scanner: Bool, stockPhotos: Bool, insert: @escaping (String) -> Void) {
        self.scanner = scanner
        self.stockPhotos = stockPhotos
        self.insert = insert
    }

    /// Words starting with what's typed ("tab" finds Table, not "database"); with a space, a phrase.
    static func matches(_ q: String, _ text: String) -> Bool {
        if q.isEmpty { return true }
        let t = text.lowercased()
        if q.contains(" ") { return t.contains(q) }
        return t.split(whereSeparator: { !$0.isLetter && !$0.isNumber }).contains { $0.hasPrefix(q) }
    }

    private var sections: [InsertSectionSpec] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        return InsertCatalog.sections.filter { sampleTitles?.contains($0.title) ?? true }.map { s in
            let extra = s.title == "Media" && scanner ? InsertCatalog.scanTiles : []
            let tiles = (s.tiles + extra).filter { Self.matches(q, $0.keywords) && (stockPhotos || $0.kind != "image-from-unsplash") }
            return InsertSectionSpec(title: s.title, tiles: tiles)
        }
        .filter { !$0.tiles.isEmpty || ($0.title == "Data and more" && showTable) }
    }

    private var showTable: Bool { Self.matches(query.trimmingCharacters(in: .whitespaces).lowercased(), "table grid rows columns size") }

    public var body: some View {
        let muted = FoleviTokens.Chrome.inkMuted.resolve(scheme).color
        VStack(alignment: .leading, spacing: 0) {
            if sampleTitles == nil {
            HStack(spacing: 8) {
                WebIconView(.search, size: 17, strokeWidth: 2.2).foregroundStyle(muted)
                TextField("", text: $query, prompt: Text("Search").foregroundStyle(FoleviTokens.Chrome.inkFaint.resolve(scheme).color))
                    .font(WebFont.font(.sans, size: WebTypeRole.body.metrics.size))
                    .foregroundStyle(FoleviTokens.Chrome.ink.resolve(scheme).color)
                    .textFieldStyle(.plain)
                    .submitLabel(.search)
                    .accessibilityLabel("Search blocks")
            }
            .padding(.horizontal, 12)
            .frame(height: 40)
            .background(FoleviTokens.Chrome.ink.resolve(scheme).color.opacity(0.07), in: RoundedRectangle(cornerRadius: FoleviTokens.Radius.control, style: .circular))
            .padding(.top, 2)
            .padding(.bottom, 8)
            }
            ForEach(sections, id: \.title) { s in
                section(s)
            }
            if sections.isEmpty {
                VStack(spacing: 4) {
                    Text("No matches").webText(WebTextStyle(size: WebTypeRole.subheadline.metrics.size, leading: 20, weight: FoleviTokens.FontWeight.medium)).foregroundStyle(FoleviTokens.Chrome.ink.resolve(scheme).color)
                    Text("Nothing called “\(query.trimmingCharacters(in: .whitespaces))”. Try another word.").webText(.role(.footnote)).foregroundStyle(muted).multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)
                .padding(.top, 32)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 4)
        .padding(.bottom, 16)
    }

    private func section(_ s: InsertSectionSpec) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(s.title.uppercased())
                .webText(PhoneType.captionCaps)
                .foregroundStyle(FoleviTokens.Chrome.inkMuted.resolve(scheme).color)
                .padding(.horizontal, 4)
                .padding(.bottom, 10)
            if !s.tiles.isEmpty {
                // Four to a row (a plain grid: the tiles are few, and pictures for the diffs can draw it).
                Grid(alignment: .top, horizontalSpacing: 8, verticalSpacing: 14) {
                    ForEach(Array(stride(from: 0, to: s.tiles.count, by: 4)), id: \.self) { i in
                        GridRow {
                            ForEach(0..<4, id: \.self) { j in
                                if i + j < s.tiles.count { tile(s.tiles[i + j]) } else { Color.clear.frame(maxWidth: .infinity, maxHeight: 1) }
                            }
                        }
                    }
                }
            }
            if s.title == "Data and more", showTable {
                QuickTablePicker { r, c in insert("quick-table-\(r)x\(c)") }
                    .padding(.top, s.tiles.isEmpty ? 0 : 16)
            }
        }
        .padding(.top, sampleTitles?.first == s.title ? 0 : 24)
    }

    private func tile(_ t: InsertTileSpec) -> some View {
        let hue = t.hue.flatMap { FoleviTokens.Chrome.named[$0] }?.resolve(scheme).color ?? FoleviTokens.Chrome.ink.resolve(scheme).color
        let raised = FoleviTokens.Chrome.surfaceRaised.resolve(scheme).color
        return Button { insert(t.kind) } label: {
            VStack(spacing: 4) {
                Group {
                    if let p = t.preview {
                        InsertPicture(preview: p, hue: t.hue)
                    } else {
                        InsertDividerLine(style: String(t.kind.dropFirst("divider-".count)))
                    }
                }
                .frame(maxWidth: .infinity)
                .frame(height: 56)
                // .iphone-insert-art: the tile's colour at 8% over the raised surface, a 0.5 pt edge at 14%.
                .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.panel, style: .circular).fill(raised).overlay(RoundedRectangle(cornerRadius: FoleviTokens.Radius.panel, style: .circular).fill(hue.opacity(0.08))))
                .overlay(RoundedRectangle(cornerRadius: FoleviTokens.Radius.panel, style: .circular).strokeBorder(hue.opacity(0.14), lineWidth: 0.5))
                TileLabel(text: t.label)
                    .foregroundStyle(FoleviTokens.Chrome.ink.resolve(scheme).color)
                    .padding(.horizontal, 2)
                    .frame(maxWidth: .infinity)
            }
        }
        .buttonStyle(TilePressStyle())
        .accessibilityLabel(t.name ?? t.label)
    }
}

/// A tile's label: Subheadline on 16 pt lines, centred, at most two (`line-clamp-2 break-words leading-4`). The
/// lines are broken here, by words and inside a word too long for one, since SwiftUI won't set lines closer than
/// the font's own height.
struct TileLabel: View {
    let text: String
    @State private var width: CGFloat = 0
    static let style = WebTextStyle(size: WebTypeRole.subheadline.metrics.size, leading: 16)

    var body: some View {
        let lines = Self.lines(text, width: width)
        // (The lines sit over a box as wide as the column: they never widen it.)
        Color.clear
            .frame(maxWidth: .infinity)
            .frame(height: CGFloat(lines.count) * Self.style.leading)
            .overlay(alignment: .top) {
                VStack(spacing: 0) {
                    ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                        Text(line).webText(Self.style).lineLimit(1).fixedSize()
                    }
                }
            }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(text)
    }

    static func measure(_ s: String) -> CGFloat {
        let attrs: [NSAttributedString.Key: Any] = [NSAttributedString.Key(kCTFontAttributeName as String): style.ctFont, NSAttributedString.Key(kCTKernAttributeName as String): style.letterSpacing]
        let line = CTLineCreateWithAttributedString(NSAttributedString(string: s, attributes: attrs))
        return CGFloat(CTLineGetTypographicBounds(line, nil, nil, nil))
    }

    /// Greedy lines by words; a word wider than the line is broken where it runs out; two lines at most, the
    /// second cut with an ellipsis.
    static func lines(_ text: String, width: CGFloat) -> [String] {
        guard width > 0 else { return [text] }
        var lines: [String] = []
        var current = ""
        for word in text.split(separator: " ").map(String.init) {
            let tryLine = current.isEmpty ? word : current + " " + word
            if measure(tryLine) <= width + 0.5 {
                current = tryLine
                continue
            }
            if !current.isEmpty { lines.append(current) }
            current = ""
            var rest = word
            while measure(rest) > width + 0.5, rest.count > 1 {
                var cut = rest.count - 1
                while cut > 1, measure(String(rest.prefix(cut))) > width + 0.5 { cut -= 1 }
                lines.append(String(rest.prefix(cut)))
                rest = String(rest.dropFirst(cut))
            }
            current = rest
        }
        if !current.isEmpty { lines.append(current) }
        if lines.count > 2 {
            var second = lines[1] + " " + lines[2...].joined(separator: " ")
            while second.count > 1, measure(second + "…") > width + 0.5 { second.removeLast() }
            lines = [lines[0], second + "…"]
        }
        return lines
    }
}

private struct TilePressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.scaleEffect(configuration.isPressed ? 0.96 : 1).animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}

/// Quick table: 5 rows of 8 cells; a touch lights rows by columns from the top left, letting go adds that table.
struct QuickTablePicker: View {
    let pick: (Int, Int) -> Void
    @State private var lit: (r: Int, c: Int)?
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let ink = FoleviTokens.Chrome.ink.resolve(scheme).color
        let muted = FoleviTokens.Chrome.inkMuted.resolve(scheme).color
        VStack(alignment: .leading, spacing: 6) {
            Text("Quick table").webText(WebTextStyle(size: WebTypeRole.footnote.metrics.size, leading: WebTypeRole.footnote.metrics.leading, weight: FoleviTokens.FontWeight.medium)).foregroundStyle(ink).padding(.horizontal, 4)
            Text("Pick a size, then click to add the table.").webText(.role(.footnote)).foregroundStyle(muted).padding(.horizontal, 4)
            GeometryReader { geo in
                let cw = (geo.size.width - 20 - 7 * 4) / 8
                VStack(spacing: 4) {
                    ForEach(1...5, id: \.self) { r in
                        HStack(spacing: 4) {
                            ForEach(1...8, id: \.self) { c in
                                let on = lit.map { r <= $0.r && c <= $0.c } ?? false
                                RoundedRectangle(cornerRadius: 3)
                                    .fill(on ? FoleviTokens.Chrome.heading.resolve(scheme).color.opacity(0.85) : ink.opacity(0.08))
                                    .frame(width: cw, height: cw * 0.7)
                                    .accessibilityElement()
                                    .accessibilityLabel("\(r) × \(c) table")
                                    .accessibilityAddTraits(.isButton)
                                    .accessibilityAction { pick(r, c) }
                            }
                        }
                    }
                }
                .padding(10)
                .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.control).fill(FoleviTokens.Chrome.surfaceRaised.resolve(scheme).color).overlay(RoundedRectangle(cornerRadius: FoleviTokens.Radius.control).strokeBorder(FoleviTokens.Chrome.line.resolve(scheme).color)))
                .contentShape(Rectangle())
                .gesture(DragGesture(minimumDistance: 0).onChanged { v in
                    let c = min(8, max(1, Int((v.location.x - 10) / (cw + 4)) + 1))
                    let r = min(5, max(1, Int((v.location.y - 10) / (cw * 0.7 + 4)) + 1))
                    lit = (r, c)
                }.onEnded { _ in
                    if let l = lit { pick(l.r, l.c) }
                    lit = nil
                })
            }
            .aspectRatio(8 / 5 * 1.25, contentMode: .fit)
            Text(lit.map { "\($0.r) × \($0.c)" } ?? " ").webText(WebTextStyle(size: WebTypeRole.footnote.metrics.size, leading: WebTypeRole.footnote.metrics.leading, weight: FoleviTokens.FontWeight.medium)).monospacedDigit().foregroundStyle(muted).frame(maxWidth: .infinity)
        }
    }
}

extension PhoneInsertSheetContent {
    /// The match harness's sample: these sections' tiles as the sheet draws them.
    static func sample(_ titles: [String]) -> PhoneInsertSheetContent {
        var v = PhoneInsertSheetContent(scanner: false, stockPhotos: true) { _ in }
        v.sampleTitles = titles
        return v
    }
}
