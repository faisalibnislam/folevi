import AppKit
import CoreText
import SwiftUI

/// Native typesetting of a parsed formula (Domain/LaTeX.swift), after TeX's rules in a simplified form:
/// atom spacing, display / text / script styles, fractions on the math axis, radicals, big operators
/// with limits, stretchy delimiters and matrices. Glyphs come from STIX Two (the system's math fonts).
enum MathTypesetter {
    // MARK: Boxes

    enum Op {
        /// A run of text with its baseline origin (y down, baseline at 0).
        case text(String, CTFont, CGPoint, scaleY: CGFloat)
        case rule(CGRect)
        case stroke(CGPath, width: CGFloat)
    }

    struct Box {
        var width: CGFloat = 0
        var ascent: CGFloat = 0
        var descent: CGFloat = 0
        var ops: [Op] = []
        var atom: LaTeX.AtomClass? = .ord
        /// The base ends in an italic letter (scripts get a little room).
        var italic = false

        func shifted(_ dx: CGFloat, _ dy: CGFloat) -> [Op] {
            ops.map { op in
                switch op {
                case .text(let s, let f, let p, let sy): return .text(s, f, CGPoint(x: p.x + dx, y: p.y + dy), scaleY: sy)
                case .rule(let r): return .rule(r.offsetBy(dx: dx, dy: dy))
                case .stroke(let path, let w):
                    var t = CGAffineTransform(translationX: dx, y: dy)
                    return .stroke(path.copy(using: &t) ?? path, width: w)
                }
            }
        }
    }

    /// 0 display, 1 text, 2 script, 3 scriptscript.
    struct Style {
        var level: Int
        var base: CGFloat
        var size: CGFloat { base * (level <= 1 ? 1 : level == 2 ? 0.7 : 0.5) }
        var script: Style { Style(level: level <= 1 ? 2 : 3, base: base) }
        var fractionPart: Style { Style(level: level == 0 ? 1 : level == 1 ? 2 : 3, base: base) }
    }

    // MARK: Fonts

    private static func font(_ face: LaTeX.Face, italicLetter: Bool, size: CGFloat) -> CTFont {
        switch face {
        case .math where italicLetter, .italic:
            return CTFontCreateWithName("STIXTwoText-Italic" as CFString, size, nil)
        case .bold:
            let f = CTFontCreateWithName("STIXTwoText" as CFString, size, nil)
            return CTFontCreateCopyWithSymbolicTraits(f, size, nil, .traitBold, .traitBold) ?? f
        case .sans:
            return CTFontCreateWithName("HelveticaNeue" as CFString, size, nil)
        case .mono:
            return FoleviFont.nsFont(.mono, size: size * 0.92) as CTFont
        default:
            return CTFontCreateWithName("STIXTwoText" as CFString, size, nil)
        }
    }

    private static func mathFont(_ size: CGFloat) -> CTFont {
        CTFontCreateWithName("STIXTwoMath-Regular" as CFString, size, nil)
    }

    /// Letters in the double-struck, script and fraktur alphabets (Unicode mathematical alphanumerics).
    static func styled(_ s: String, _ face: LaTeX.Face) -> String {
        let exceptions: [LaTeX.Face: [Character: String]] = [
            .blackboard: ["C": "ℂ", "H": "ℍ", "N": "ℕ", "P": "ℙ", "Q": "ℚ", "R": "ℝ", "Z": "ℤ"],
            .calligraphic: ["B": "ℬ", "E": "ℰ", "F": "ℱ", "H": "ℋ", "I": "ℐ", "L": "ℒ", "M": "ℳ", "R": "ℛ", "e": "ℯ", "g": "ℊ", "o": "ℴ"],
            .fraktur: ["C": "ℭ", "H": "ℌ", "I": "ℑ", "R": "ℜ", "Z": "ℨ"],
        ]
        let base: [LaTeX.Face: (upper: UInt32, lower: UInt32, digit: UInt32?)] = [
            .blackboard: (0x1D538, 0x1D552, 0x1D7D8), .calligraphic: (0x1D49C, 0x1D4B6, nil), .fraktur: (0x1D504, 0x1D51E, nil),
        ]
        guard let b = base[face] else { return s }
        var out = ""
        for c in s {
            if let e = exceptions[face]?[c] { out += e; continue }
            guard let v = c.unicodeScalars.first?.value, c.unicodeScalars.count == 1 else { out.append(c); continue }
            var mapped: UInt32?
            if (65...90).contains(v) { mapped = b.upper + v - 65 } else if (97...122).contains(v) { mapped = b.lower + v - 97 } else if let d = b.digit, (48...57).contains(v) { mapped = d + v - 48 }
            if let m = mapped, let scalar = Unicode.Scalar(m) { out.unicodeScalars.append(scalar) } else { out.append(c) }
        }
        return out
    }

    // MARK: Text boxes

    static func textBox(_ s: String, font: CTFont, atom: LaTeX.AtomClass?, italic: Bool = false) -> Box {
        guard !s.isEmpty else { return Box(atom: atom) }
        let line = CTLineCreateWithAttributedString(NSAttributedString(string: s, attributes: [.font: font]) as CFAttributedString)
        let width = CGFloat(CTLineGetTypographicBounds(line, nil, nil, nil))
        let bounds = CTLineGetBoundsWithOptions(line, .useGlyphPathBounds)
        let size = CTFontGetSize(font)
        // Tight glyph bounds, with a floor so lowercase letters still line up with each other.
        let ascent = max(bounds.maxY, size * 0.45)
        let descent = max(-bounds.minY, 0)
        return Box(width: width, ascent: ascent, descent: descent, ops: [.text(s, font, .zero, scaleY: 1)], atom: atom, italic: italic)
    }

    // MARK: Layout

    static func layout(_ node: LaTeX.Node, _ style: Style) -> Box {
        let size = style.size
        switch node {
        case .row(let items):
            return row(items, style)
        case .symbol(let s, let atom, let face):
            if s.isEmpty { return Box(atom: atom) }
            let isLetter = s.count == 1 && (s.first?.isLetter ?? false)
            switch face {
            case .blackboard, .calligraphic, .fraktur:
                return textBox(styled(s, face), font: mathFont(size), atom: atom)
            default:
                let useMath = !isLetter && !(s.first?.isNumber ?? false) && face != .bold
                let f = useMath ? mathFont(size) : font(face, italicLetter: isLetter, size: size)
                return textBox(s, font: f, atom: atom, italic: isLetter && (face == .math || face == .italic))
            }
        case .text(let s, let face):
            return textBox(s, font: font(face, italicLetter: false, size: size), atom: .op)
        case .space(let em):
            return Box(width: CGFloat(em) * size, atom: nil)
        case .error(let s):
            var b = textBox(s, font: font(.roman, italicLetter: false, size: size * 0.9), atom: .ord)
            b.ops = b.ops.map { op in
                if case .text(let t, let f, let p, let sy) = op { return .text("\u{1}" + t, f, p, scaleY: sy) }
                return op
            }
            return b
        case .frac(let num, let den, let rule):
            return fraction(num, den, rule: rule, style)
        case .sqrt(let radicand, let index):
            return radical(radicand, index: index, style)
        case .scripts(let base, let sub, let sup):
            return scripts(base, sub: sub, sup: sup, style)
        case .bigOp(let s, let limits):
            return bigOperator(s, limits: limits, style)
        case .fenced(let l, let inner, let r):
            let content = layout(inner, style)
            return fence(content, left: l, right: r, style, atom: .inner)
        case .accent(let base, let mark):
            return accent(base, mark, style)
        case .overline(let base):
            var b = layout(base, style)
            let t = size * 0.045
            let y = -(b.ascent + size * 0.12)
            b.ops.append(.rule(CGRect(x: 0, y: y - t, width: b.width, height: t)))
            b.ascent += size * 0.12 + t + size * 0.04
            b.atom = .ord
            return b
        case .underline(let base):
            var b = layout(base, style)
            let t = size * 0.045
            b.ops.append(.rule(CGRect(x: 0, y: b.descent + size * 0.12, width: b.width, height: t)))
            b.descent += size * 0.12 + t + size * 0.04
            b.atom = .ord
            return b
        case .matrix(let rows, let align, let left, let right):
            return matrix(rows, align: align, left: left, right: right, style)
        }
    }

    /// Spacing between neighbouring atoms in em (TeX's table, simplified).
    static func spacing(_ a: LaTeX.AtomClass, _ b: LaTeX.AtomClass, script: Bool) -> CGFloat {
        let thin: CGFloat = 3 / 18, medium: CGFloat = 4 / 18, thick: CGFloat = 5 / 18
        switch (a, b) {
        case (.bin, _), (_, .bin): return script ? 0 : medium
        case (.rel, .rel): return 0
        case (.rel, _), (_, .rel): return script ? 0 : thick
        case (.op, .ord), (.ord, .op), (.op, .op), (.close, .op), (.op, .inner), (.inner, .op): return thin
        case (.punct, _): return script ? 0 : thin
        case (.inner, .ord), (.ord, .inner), (.inner, .inner), (.close, .inner), (.inner, .open): return script ? 0 : thin
        default: return 0
        }
    }

    static func row(_ items: [LaTeX.Node], _ style: Style) -> Box {
        var boxes = items.map { layout($0, style) }
        // A binary operator with nothing to bind on its left reads as unary (−x, a = −b).
        var previous: LaTeX.AtomClass?
        for i in boxes.indices {
            guard let atom = boxes[i].atom else { continue }
            if atom == .bin, previous == nil || [.bin, .op, .rel, .open, .punct].contains(previous!) { boxes[i].atom = .ord }
            previous = boxes[i].atom
        }
        if let lastIndex = boxes.lastIndex(where: { $0.atom != nil }), boxes[lastIndex].atom == .bin { boxes[lastIndex].atom = .ord }
        var out = Box(atom: boxes.count == 1 ? boxes[0].atom : .ord)
        var x: CGFloat = 0
        var prev: LaTeX.AtomClass?
        for b in boxes {
            if let a = prev, let c = b.atom { x += spacing(a, c, script: style.level >= 2) * style.size }
            out.ops += b.shifted(x, 0)
            x += b.width
            out.ascent = max(out.ascent, b.ascent)
            out.descent = max(out.descent, b.descent)
            if b.atom != nil { prev = b.atom }
        }
        out.width = x
        out.italic = boxes.last?.italic ?? false
        return out
    }

    private static func axis(_ size: CGFloat) -> CGFloat { size * 0.25 }

    static func fraction(_ numNode: LaTeX.Node, _ denNode: LaTeX.Node, rule: Bool, _ style: Style) -> Box {
        let size = style.size
        let num = layout(numNode, style.fractionPart), den = layout(denNode, style.fractionPart)
        let t = rule ? size * 0.045 : 0
        let gap = style.level == 0 ? size * 0.16 : size * 0.09
        let pad = size * 0.12
        let width = max(num.width, den.width) + pad * 2
        let a = axis(size)
        // Numerator baseline: above the bar by its descent and the gap; denominator below.
        let numBase = -(a + t / 2 + gap + num.descent)
        let denBase = -a + t / 2 + gap + den.ascent
        var out = Box(width: width, atom: .inner)
        out.ops += num.shifted((width - num.width) / 2, numBase)
        out.ops += den.shifted((width - den.width) / 2, denBase)
        if rule { out.ops.append(.rule(CGRect(x: pad * 0.5, y: -a - t / 2, width: width - pad, height: t))) }
        out.ascent = -numBase + num.ascent
        out.descent = denBase + den.descent
        return out
    }

    static func radical(_ radicandNode: LaTeX.Node, index: LaTeX.Node?, _ style: Style) -> Box {
        let size = style.size
        let body = layout(radicandNode, style)
        let t = size * 0.045
        let gap = size * (style.level == 0 ? 0.18 : 0.12)
        let top = body.ascent + gap + t
        let bottom = body.descent + size * 0.06
        let surd = size * 0.62
        var indexBox: Box?
        var lead: CGFloat = 0
        if let index {
            let ib = layout(index, Style(level: 3, base: style.base))
            indexBox = ib
            lead = max(0, ib.width - surd * 0.45)
        }
        let path = CGMutablePath()
        let h = top + bottom
        path.move(to: CGPoint(x: lead + surd * 0.05, y: -h * 0.42 + bottom))
        path.addLine(to: CGPoint(x: lead + surd * 0.25, y: -h * 0.5 + bottom))
        path.addLine(to: CGPoint(x: lead + surd * 0.5, y: bottom))
        path.addLine(to: CGPoint(x: lead + surd * 0.92, y: -top + t / 2))
        path.addLine(to: CGPoint(x: lead + surd + body.width + size * 0.08, y: -top + t / 2))
        var out = Box(width: lead + surd + body.width + size * 0.12, ascent: top + size * 0.02, descent: bottom, atom: .ord)
        out.ops.append(.stroke(path, width: t))
        out.ops += body.shifted(lead + surd, 0)
        if let ib = indexBox {
            out.ops += ib.shifted(0, -h * 0.5 + bottom - size * 0.06 - ib.descent)
            out.ascent = max(out.ascent, h * 0.5 - bottom + size * 0.06 + ib.descent + ib.ascent)
        }
        return out
    }

    static func scripts(_ baseNode: LaTeX.Node, sub: LaTeX.Node?, sup: LaTeX.Node?, _ style: Style) -> Box {
        if case .bigOp(let s, let limits) = baseNode { return bigOperator(s, limits: limits, style, sub: sub, sup: sup) }
        let size = style.size
        let base = layout(baseNode, style)
        let supBox = sup.map { layout($0, style.script) }
        let subBox = sub.map { layout($0, style.script) }
        var supShift = max(size * (style.level == 0 ? 0.41 : 0.36), base.ascent - size * 0.25)
        var subShift = max(size * 0.15, base.descent + size * 0.05)
        if let sp = supBox { supShift = max(supShift, sp.descent + size * 0.11) }
        if let sp = supBox, let sb = subBox {
            subShift = max(subShift, size * 0.25)
            let clearance = (supShift - sp.descent) - (sb.ascent - subShift)
            if clearance < size * 0.18 { subShift += size * 0.18 - clearance }
        }
        var out = Box(atom: base.atom)
        out.ops = base.ops
        let x = base.width
        let kern = base.italic ? size * 0.06 : 0
        var w = x
        if let sp = supBox {
            out.ops += sp.shifted(x + kern, -supShift)
            w = max(w, x + kern + sp.width)
        }
        if let sb = subBox {
            out.ops += sb.shifted(x, subShift)
            w = max(w, x + sb.width)
        }
        out.width = w + size * 0.03
        out.ascent = max(base.ascent, supBox.map { supShift + $0.ascent } ?? 0)
        out.descent = max(base.descent, subBox.map { subShift + $0.descent } ?? 0)
        return out
    }

    static func bigOperator(_ s: String, limits: Bool, _ style: Style, sub: LaTeX.Node? = nil, sup: LaTeX.Node? = nil) -> Box {
        let size = style.size
        let isWord = s.count > 1 && s.allSatisfy(\.isLetter)
        var op: Box
        if isWord {
            op = textBox(s, font: font(.roman, italicLetter: false, size: size), atom: .op)
        } else {
            let integral = "∫∬∭∮".contains(s)
            let scale: CGFloat = style.level == 0 ? (integral ? 2.0 : 1.55) : (integral ? 1.35 : 1.15)
            op = textBox(s, font: mathFont(size * scale), atom: .op)
            // Centre the symbol on the math axis.
            let mid = (op.ascent - op.descent) / 2
            let shift = mid - axis(size)
            op.ops = op.shifted(0, shift)
            op.ascent -= shift
            op.descent += shift
        }
        op.atom = .op
        let supBox = sup.map { layout($0, style.script) }
        let subBox = sub.map { layout($0, style.script) }
        if supBox == nil && subBox == nil { return op }
        let gap = size * 0.12
        if limits && style.level == 0 {
            let width = max(op.width, supBox?.width ?? 0, subBox?.width ?? 0)
            var out = Box(width: width, ascent: op.ascent, descent: op.descent, atom: .op)
            out.ops += op.shifted((width - op.width) / 2, 0)
            if let sp = supBox {
                let y = -(op.ascent + gap + sp.descent)
                out.ops += sp.shifted((width - sp.width) / 2, y)
                out.ascent = -y + sp.ascent
            }
            if let sb = subBox {
                let y = op.descent + gap + sb.ascent
                out.ops += sb.shifted((width - sb.width) / 2, y)
                out.descent = y + sb.descent
            }
            return out
        }
        // Scripts beside the operator (integrals, text style).
        var out = Box(atom: .op)
        out.ops = op.ops
        let integralKern: CGFloat = "∫∬∭∮".contains(s) ? -size * 0.42 : 0
        var w = op.width
        if let sp = supBox {
            let y = -(op.ascent - sp.ascent * 0.6)
            out.ops += sp.shifted(op.width + size * 0.02, y)
            w = max(w, op.width + size * 0.02 + sp.width)
            out.ascent = max(op.ascent, -y + sp.ascent)
        } else { out.ascent = op.ascent }
        if let sb = subBox {
            let y = op.descent - sb.descent * 0.3
            out.ops += sb.shifted(op.width + integralKern, y)
            w = max(w, op.width + integralKern + sb.width)
            out.descent = max(op.descent, y + sb.descent)
        } else { out.descent = op.descent }
        out.width = w + size * 0.04
        return out
    }

    static func accent(_ baseNode: LaTeX.Node, _ mark: String, _ style: Style) -> Box {
        let size = style.size
        var b = layout(baseNode, style)
        let top = -(b.ascent + size * 0.08)
        let t = size * 0.04
        switch mark {
        case "¯":
            b.ops.append(.rule(CGRect(x: b.width * 0.08, y: top - t, width: b.width * 0.84, height: t)))
            b.ascent += size * 0.08 + t
        case "→":
            let path = CGMutablePath()
            let y = top - size * 0.08
            path.move(to: CGPoint(x: b.width * 0.1, y: y))
            path.addLine(to: CGPoint(x: b.width * 0.9 + size * 0.05, y: y))
            path.move(to: CGPoint(x: b.width * 0.9 - size * 0.08, y: y - size * 0.08))
            path.addLine(to: CGPoint(x: b.width * 0.9 + size * 0.05, y: y))
            path.addLine(to: CGPoint(x: b.width * 0.9 - size * 0.08, y: y + size * 0.08))
            b.ops.append(.stroke(path, width: t))
            b.ascent += size * 0.24
        case "^" where b.width > size * 0.8, "~" where b.width > size * 0.8:
            let path = CGMutablePath()
            let y = top - size * 0.02
            if mark == "^" {
                path.move(to: CGPoint(x: 0, y: y))
                path.addLine(to: CGPoint(x: b.width / 2, y: y - size * 0.2))
                path.addLine(to: CGPoint(x: b.width, y: y))
            } else {
                path.move(to: CGPoint(x: 0, y: y - size * 0.04))
                path.addCurve(to: CGPoint(x: b.width, y: y - size * 0.1), control1: CGPoint(x: b.width * 0.3, y: y - size * 0.22),
                              control2: CGPoint(x: b.width * 0.7, y: y + size * 0.08))
            }
            b.ops.append(.stroke(path, width: t))
            b.ascent += size * 0.26
        default:
            // The accent's ink sits just above the base.
            let s = mark == "^" ? "ˆ" : mark == "~" ? "˜" : mark
            let f = font(.roman, italicLetter: false, size: size)
            let line = CTLineCreateWithAttributedString(NSAttributedString(string: s, attributes: [.font: f]) as CFAttributedString)
            let ink = CTLineGetBoundsWithOptions(line, .useGlyphPathBounds)
            let width = CGFloat(CTLineGetTypographicBounds(line, nil, nil, nil))
            let baseline = top + size * 0.02 + ink.minY
            b.ops.append(.text(s, f, CGPoint(x: (b.width - width) / 2 + (b.italic ? size * 0.06 : 0), y: baseline), scaleY: 1))
            b.ascent = max(b.ascent, -(baseline - ink.maxY))
        }
        b.atom = .ord
        return b
    }

    static func matrix(_ rows: [[LaTeX.Node]], align: [Character], left: String, right: String, _ style: Style) -> Box {
        let size = style.size
        let cellStyle = Style(level: max(style.level, 1), base: style.base)
        let cells = rows.map { $0.map { layout($0, cellStyle) } }
        let cols = cells.map(\.count).max() ?? 0
        var colWidths = Array(repeating: CGFloat(0), count: cols)
        for r in cells { for (c, b) in r.enumerated() { colWidths[c] = max(colWidths[c], b.width) } }
        let aligned = left.isEmpty && right.isEmpty && align.first == "r"
        let colGap = size * (aligned ? 0 : 1)
        let pairGap = size * 1.2
        let rowGap = size * (left == "{" && right.isEmpty ? 0.25 : 0.3)
        var y: CGFloat = 0
        var out = Box(atom: .inner)
        var placed: [(Box, CGFloat, CGFloat)] = []
        var totalWidth: CGFloat = 0
        for (r, row) in cells.enumerated() {
            let asc = max(row.map(\.ascent).max() ?? 0, size * 0.7)
            let desc = max(row.map(\.descent).max() ?? 0, size * 0.25)
            if r > 0 { y += rowGap }
            y += asc
            var x: CGFloat = 0
            for c in 0..<cols {
                if c > 0 { x += aligned ? (c % 2 == 0 ? pairGap : colGap) : colGap }
                if c < row.count {
                    let b = row[c]
                    let a = c < align.count ? align[c] : "c"
                    let dx = a == "l" ? 0 : a == "r" ? colWidths[c] - b.width : (colWidths[c] - b.width) / 2
                    // In aligned columns the relation after "&" keeps its space on the left.
                    let rel: CGFloat = aligned && c % 2 == 1 ? size * 5 / 18 : 0
                    placed.append((b, x + dx + rel, y))
                }
                x += colWidths[c] + (aligned && c % 2 == 1 ? size * 5 / 18 : 0)
            }
            totalWidth = max(totalWidth, x)
            y += desc
        }
        // Centre the grid on the math axis.
        let shift = -(y / 2) - axis(size)
        for (b, x, baseY) in placed { out.ops += b.shifted(x, baseY + shift) }
        out.width = totalWidth
        out.ascent = -shift
        out.descent = y + shift
        if left.isEmpty && right.isEmpty { return out }
        return fence(out, left: left.isEmpty ? "." : left, right: right.isEmpty ? "." : right, style, atom: .inner, padding: size * 0.15)
    }

    // MARK: Delimiters

    static func fence(_ content: Box, left: String, right: String, _ style: Style, atom: LaTeX.AtomClass, padding: CGFloat = 0) -> Box {
        let size = style.size
        let a = axis(size)
        let half = max(content.ascent - a, content.descent + a, size * 0.5) + size * 0.08
        let l = delimiter(left, halfHeight: half, size: size)
        let r = delimiter(right, halfHeight: half, size: size)
        var out = Box(atom: atom)
        var x: CGFloat = 0
        out.ops += l.shifted(0, 0)
        x += l.width + (l.width > 0 ? size * 0.04 + padding : 0)
        out.ops += content.shifted(x, 0)
        x += content.width + (r.width > 0 ? size * 0.04 + padding : 0)
        out.ops += r.shifted(x, 0)
        x += r.width
        out.width = x
        out.ascent = max(content.ascent, l.ascent, r.ascent)
        out.descent = max(content.descent, l.descent, r.descent)
        return out
    }

    /// A delimiter tall enough to span ±halfHeight around the math axis: the font's glyph when it is
    /// big enough, a drawn shape otherwise.
    static func delimiter(_ d: String, halfHeight: CGFloat, size: CGFloat) -> Box {
        guard d != ".", !d.isEmpty else { return Box(atom: nil) }
        let a = axis(size)
        let glyph = textBox(d, font: mathFont(size), atom: nil)
        let glyphHalf = (glyph.ascent + glyph.descent) / 2
        if halfHeight <= max(glyphHalf, size * 0.6) * 1.08 {
            var g = glyph
            let mid = (g.ascent - g.descent) / 2
            g.ops = g.shifted(0, mid - a)
            g.ascent -= mid - a
            g.descent += mid - a
            return g
        }
        let top = -(a + halfHeight), bottom = -a + halfHeight
        let h = bottom - top
        let t = size * 0.055
        let w = min(size * 0.5, max(size * 0.32, h * 0.12))
        let path = CGMutablePath()
        switch d {
        case "(":
            path.move(to: CGPoint(x: w * 0.85, y: top))
            path.addQuadCurve(to: CGPoint(x: w * 0.85, y: bottom), control: CGPoint(x: -w * 0.35, y: top + h / 2))
        case ")":
            path.move(to: CGPoint(x: w * 0.15, y: top))
            path.addQuadCurve(to: CGPoint(x: w * 0.15, y: bottom), control: CGPoint(x: w * 1.35, y: top + h / 2))
        case "[", "⌈", "⌊":
            path.move(to: CGPoint(x: w * 0.8, y: top))
            path.addLine(to: CGPoint(x: w * 0.3, y: top))
            path.addLine(to: CGPoint(x: w * 0.3, y: bottom))
            path.addLine(to: CGPoint(x: w * 0.8, y: bottom))
            if d == "⌈" { path.move(to: CGPoint(x: w * 0.3, y: bottom)) }
        case "]", "⌉", "⌋":
            path.move(to: CGPoint(x: w * 0.2, y: top))
            path.addLine(to: CGPoint(x: w * 0.7, y: top))
            path.addLine(to: CGPoint(x: w * 0.7, y: bottom))
            path.addLine(to: CGPoint(x: w * 0.2, y: bottom))
        case "{":
            let m = top + h / 2
            path.move(to: CGPoint(x: w * 0.9, y: top))
            path.addCurve(to: CGPoint(x: w * 0.45, y: top + h * 0.12), control1: CGPoint(x: w * 0.55, y: top), control2: CGPoint(x: w * 0.45, y: top + h * 0.04))
            path.addLine(to: CGPoint(x: w * 0.45, y: m - h * 0.1))
            path.addCurve(to: CGPoint(x: w * 0.05, y: m), control1: CGPoint(x: w * 0.45, y: m - h * 0.03), control2: CGPoint(x: w * 0.25, y: m))
            path.addCurve(to: CGPoint(x: w * 0.45, y: m + h * 0.1), control1: CGPoint(x: w * 0.25, y: m), control2: CGPoint(x: w * 0.45, y: m + h * 0.03))
            path.addLine(to: CGPoint(x: w * 0.45, y: bottom - h * 0.12))
            path.addCurve(to: CGPoint(x: w * 0.9, y: bottom), control1: CGPoint(x: w * 0.45, y: bottom - h * 0.04), control2: CGPoint(x: w * 0.55, y: bottom))
        case "}":
            let m = top + h / 2
            path.move(to: CGPoint(x: w * 0.1, y: top))
            path.addCurve(to: CGPoint(x: w * 0.55, y: top + h * 0.12), control1: CGPoint(x: w * 0.45, y: top), control2: CGPoint(x: w * 0.55, y: top + h * 0.04))
            path.addLine(to: CGPoint(x: w * 0.55, y: m - h * 0.1))
            path.addCurve(to: CGPoint(x: w * 0.95, y: m), control1: CGPoint(x: w * 0.55, y: m - h * 0.03), control2: CGPoint(x: w * 0.75, y: m))
            path.addCurve(to: CGPoint(x: w * 0.55, y: m + h * 0.1), control1: CGPoint(x: w * 0.75, y: m), control2: CGPoint(x: w * 0.55, y: m + h * 0.03))
            path.addLine(to: CGPoint(x: w * 0.55, y: bottom - h * 0.12))
            path.addCurve(to: CGPoint(x: w * 0.1, y: bottom), control1: CGPoint(x: w * 0.55, y: bottom - h * 0.04), control2: CGPoint(x: w * 0.45, y: bottom))
        case "⟨":
            path.move(to: CGPoint(x: w * 0.85, y: top))
            path.addLine(to: CGPoint(x: w * 0.2, y: top + h / 2))
            path.addLine(to: CGPoint(x: w * 0.85, y: bottom))
        case "⟩":
            path.move(to: CGPoint(x: w * 0.15, y: top))
            path.addLine(to: CGPoint(x: w * 0.8, y: top + h / 2))
            path.addLine(to: CGPoint(x: w * 0.15, y: bottom))
        case "‖":
            path.move(to: CGPoint(x: w * 0.3, y: top)); path.addLine(to: CGPoint(x: w * 0.3, y: bottom))
            path.move(to: CGPoint(x: w * 0.7, y: top)); path.addLine(to: CGPoint(x: w * 0.7, y: bottom))
        default: // "|", "/" and anything else: a straight bar
            path.move(to: CGPoint(x: w * 0.5, y: top)); path.addLine(to: CGPoint(x: w * 0.5, y: bottom))
        }
        return Box(width: w, ascent: -top, descent: bottom, ops: [.stroke(path, width: t)], atom: nil)
    }

    // MARK: Drawing

    static func draw(_ box: Box, in cg: CGContext, at origin: CGPoint, color: NSColor, errorColor: NSColor) {
        cg.saveGState()
        cg.setFillColor(color.cgColor)
        cg.setStrokeColor(color.cgColor)
        cg.setLineCap(.round)
        cg.setLineJoin(.round)
        for op in box.ops {
            switch op {
            case .text(let s, let font, let p, let sy):
                let isError = s.hasPrefix("\u{1}")
                let text = isError ? String(s.dropFirst()) : s
                let attr = NSAttributedString(string: text, attributes: [.font: font, .foregroundColor: isError ? errorColor : color])
                let line = CTLineCreateWithAttributedString(attr as CFAttributedString)
                cg.saveGState()
                cg.textMatrix = CGAffineTransform(scaleX: 1, y: -sy)
                cg.textPosition = CGPoint(x: origin.x + p.x, y: origin.y + p.y)
                CTLineDraw(line, cg)
                cg.restoreGState()
            case .rule(let r):
                cg.fill(r.offsetBy(dx: origin.x, dy: origin.y))
            case .stroke(let path, let width):
                cg.saveGState()
                cg.translateBy(x: origin.x, y: origin.y)
                cg.addPath(path)
                cg.setLineWidth(width)
                cg.strokePath()
                cg.restoreGState()
            }
        }
        cg.restoreGState()
    }
}

/// A rendered formula (display style), sized to its content and centred by the caller.
struct MathFormulaView: View {
    var latex: String
    var fontSize: CGFloat
    var color: Color = FoleviColor.ink

    /// A mistake renders in red instead of failing, in KaTeX's own error colour (`errorColor` #cc0000).
    static let errorColor = NSColor(srgbRed: 0.8, green: 0, blue: 0, alpha: 1)

    var body: some View {
        let box = MathTypesetter.layout(LaTeX.parse(latex), MathTypesetter.Style(level: 0, base: fontSize))
        let pad = fontSize * 0.1
        let width = ceil(box.width + pad * 2), height = ceil(box.ascent + box.descent + pad * 2)
        let ink = NSColor(color)
        Canvas { ctx, _ in
            ctx.withCGContext { cg in
                MathTypesetter.draw(box, in: cg, at: CGPoint(x: pad, y: pad + box.ascent), color: ink, errorColor: Self.errorColor)
            }
        }
        .frame(width: width, height: height)
        .accessibilityElement()
        .accessibilityLabel(Text("Formula: \(latex)"))
    }
}
