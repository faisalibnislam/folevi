// The sidebar's selected item shows its icon filled (the owner, 28 November 2026: "filled when selected"), the same
// drawings as the web app's (apps/web/src/components/app/SidebarFilledIcons.tsx). Each is its outline icon's 24 pt
// grid: parts filled with the text colour, parts stroked, and details (a door, a check, calendar dots) cut out, so
// the row's own background shows through them on any theme.
import FoleviDesign
import SwiftUI

/// How one part of a filled icon is drawn.
enum FilledIconPart {
    case fill(WebIconNode)
    case stroke(WebIconNode)
    /// Punched out of what's drawn so far (stroked).
    case cutStroke(WebIconNode)
    /// Punched out of what's drawn so far (filled).
    case cutFill(WebIconNode)
}

enum FilledSidebarIcons {
    /// The filled drawing for a sidebar symbol name (SidebarItemID.symbol), when there is one.
    static func parts(for symbol: String) -> [FilledIconPart]? { table[symbol] }

    static let table: [String: [FilledIconPart]] = [
        "house": [.fill(.path("M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2h-4v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8H5a2 2 0 0 1-2-2z"))],
        "point.3.connected.trianglepath.dotted": [
            .fill(.circle(cx: 12, cy: 4.5, r: 2.5)), .stroke(.path("m10.2 6.3-3.9 3.9")),
            .fill(.circle(cx: 4.5, cy: 12, r: 2.5)), .stroke(.path("M7 12h10")),
            .fill(.circle(cx: 19.5, cy: 12, r: 2.5)), .stroke(.path("m13.8 17.7 3.9-3.9")),
            .fill(.circle(cx: 12, cy: 19.5, r: 2.5)),
        ],
        "bookmark": [.fill(.path("m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"))],
        "tray": [
            .stroke(.path("M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z")),
            .fill(.path("M2 12h6l2 3h4l2-3h6v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z")),
        ],
        "doc.on.doc": [
            .fill(.path("M9 18a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h7l4 4v10a2 2 0 0 1-2 2Z")),
            .stroke(.path("M3 7.6v12.8A1.6 1.6 0 0 0 4.6 22h9.8")),
        ],
        "checkmark.square": [
            .fill(.rect(x: 3, y: 3, width: 18, height: 18, rx: 2, ry: 2)),
            .cutStroke(.path("m8.5 12 2.5 2.5 4.5-5")),
        ],
        "calendar": [
            .fill(.rect(x: 3, y: 4, width: 18, height: 18, rx: 2, ry: 2)),
            .stroke(.path("M8 2v4M16 2v4")),
            .cutStroke(.path("M3 10h18")),
            .cutFill(.circle(cx: 8, cy: 14, r: 1)), .cutFill(.circle(cx: 12, cy: 14, r: 1)), .cutFill(.circle(cx: 16, cy: 14, r: 1)),
            .cutFill(.circle(cx: 8, cy: 18, r: 1)), .cutFill(.circle(cx: 12, cy: 18, r: 1)), .cutFill(.circle(cx: 16, cy: 18, r: 1)),
        ],
        "rectangle.stack": [
            .fill(.path("M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z")),
            .stroke(.path("M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12")),
            .stroke(.path("M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17")),
        ],
        "square.and.arrow.up": [
            .fill(.circle(cx: 18, cy: 5, r: 3)), .fill(.circle(cx: 6, cy: 12, r: 3)), .fill(.circle(cx: 18, cy: 19, r: 3)),
            .stroke(.path("m8.59 13.51 6.83 3.98M15.41 6.51l-6.82 3.98")),
        ],
        "lock": [
            .fill(.rect(x: 3, y: 11, width: 18, height: 11, rx: 2, ry: 2)),
            .stroke(.path("M7 11V7a5 5 0 0 1 10 0v4")),
        ],
        "plus.forwardslash.minus": [
            .fill(.path("M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z")),
            .cutStroke(.path("M9 10h6M12 7v6M9 17h6")),
        ],
        "rectangle.3.group": [
            .fill(.rect(x: 3, y: 3, width: 18, height: 7, rx: 1, ry: 1)),
            .fill(.rect(x: 3, y: 14, width: 9, height: 7, rx: 1, ry: 1)),
            .fill(.rect(x: 16, y: 14, width: 5, height: 7, rx: 1, ry: 1)),
        ],
    ]
}

/// A filled sidebar icon at the size `WebIconView` draws its outline (the foreground style is its colour).
struct FilledSidebarIconView: View {
    let parts: [FilledIconPart]
    let size: CGFloat
    var strokeWidth: CGFloat = 2

    var body: some View {
        Canvas { context, canvas in
            let scale = canvas.width / 24
            context.scaleBy(x: scale, y: scale)
            let style = StrokeStyle(lineWidth: strokeWidth, lineCap: .round, lineJoin: .round)
            let ink = GraphicsContext.Shading.foreground
            for part in parts {
                switch part {
                case .fill(let node):
                    let path = Path(Self.cg(node))
                    context.fill(path, with: ink)
                    context.stroke(path, with: ink, style: style)
                case .stroke(let node):
                    context.stroke(Path(Self.cg(node)), with: ink, style: style)
                case .cutStroke(let node):
                    var cut = context
                    cut.blendMode = .destinationOut
                    cut.stroke(Path(Self.cg(node)), with: .color(.black), style: style)
                case .cutFill(let node):
                    var cut = context
                    cut.blendMode = .destinationOut
                    cut.fill(Path(Self.cg(node)), with: .color(.black))
                }
            }
        }
        .frame(width: size, height: size)
        .compositingGroup()
        .accessibilityHidden(true)
    }

    private static func cg(_ node: WebIconNode) -> CGPath {
        let path = CGMutablePath()
        node.add(to: path)
        return path
    }
}
