// The screenshot diffs' specimens drawn natively (docs/MAC_REBUILD_PLAN.md section 3.2). The web draws the same
// file (packages/design-tokens/match/specimens.json) at /dev/match/<id> with its real CSS; FoleviDesignTests
// MatchShots photographs these, and apps/mac/scripts/match.mjs compares the two pixel by pixel.
import Foundation
import SwiftUI

public struct MatchSpecimens: Decodable, Sendable {
    public let scale: CGFloat
    public let threshold: Threshold
    public let specimens: [MatchSpecimen]

    public struct Threshold: Decodable, Sendable {
        /// A pixel differs when a channel is more than this far apart (0 to 255).
        public let channel: Int
        /// Anti-aliasing tolerance: a pixel matches a close pixel of the other picture this many pixels away.
        public var radius: Int?
        /// A specimen passes when at most this share of its pixels differ.
        public let maxRatio: Double
    }
}

public struct MatchSpecimen: Decodable, Sendable, Identifiable {
    public let id: String
    /// Where it's checked ("ios", "mac"); everywhere when nil.
    public var platforms: [String]?
    public let width: CGFloat
    public let padding: CGFloat
    public var gap: CGFloat?
    public var grid: Grid?
    public var items: [Item]?
    public var icons: [Icon]?
    public var swatches: [String]?
    /// Component samples by id (apps/web/src/app/dev/match/samples.tsx), in a column.
    public var samples: [String]?

    /// Whether this platform checks it.
    public var checkedHere: Bool {
        #if os(iOS)
        platforms?.contains("ios") ?? true
        #else
        platforms?.contains("mac") ?? true
        #endif
    }

    public struct Grid: Decodable, Sendable {
        public let cell: CGFloat
        public let gap: CGFloat
    }

    public struct Item: Decodable, Sendable {
        public let text: String
        public let style: Style
    }

    public struct Style: Decodable, Sendable {
        public var role: String?
        public var weight: CGFloat?
        public var display: String?
        public var caps: Bool?
    }

    public struct Icon: Decodable, Sendable {
        public let name: String
        public let size: CGFloat
        public let strokeWidth: CGFloat
    }
}

/// One specimen, laid out as the web page lays it out (a column of lines, or a CSS `auto-fill` grid of cells).
public struct MatchSpecimenView: View {
    public let specimen: MatchSpecimen

    public init(_ specimen: MatchSpecimen) { self.specimen = specimen }

    public var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let items = specimen.items {
                VStack(alignment: .leading, spacing: specimen.gap ?? 0) {
                    ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                        line(item)
                    }
                }
            }
            if let samples = specimen.samples {
                VStack(alignment: .leading, spacing: specimen.gap ?? 0) {
                    ForEach(samples, id: \.self) { id in
                        MatchSamples.view(id)
                    }
                }
            }
            if let icons = specimen.icons, let grid = specimen.grid {
                cells(icons.count, grid) { i in
                    if let icon = WebIcon(rawValue: icons[i].name) {
                        WebIconView(icon, size: icons[i].size, strokeWidth: icons[i].strokeWidth)
                            .foregroundStyle(Folevi.color.ink)
                    }
                }
            }
            if let swatches = specimen.swatches, let grid = specimen.grid {
                cells(swatches.count, grid) { i in
                    Rectangle().fill(Self.chrome(swatches[i]) ?? .clear)
                }
            }
        }
        .padding(specimen.padding)
        .frame(width: specimen.width, alignment: .topLeading)
        .background(Folevi.color.canvas)
    }

    @ViewBuilder
    private func line(_ item: MatchSpecimen.Item) -> some View {
        let s = item.style
        if s.caps == true {
            Text(item.text.uppercased()).webText(.caps).foregroundStyle(WebTextStyle.capsInk).lineLimit(1).fixedSize()
        } else if let display = s.display.flatMap(WebTypeRole.init(rawValue:)) {
            Text(item.text).webText(.display(display)).foregroundStyle(Folevi.color.heading).lineLimit(1).fixedSize()
        } else {
            let role = s.role.flatMap(WebTypeRole.init(rawValue:)) ?? .body
            Text(item.text).webText(.role(role, weight: s.weight)).foregroundStyle(Folevi.color.ink).lineLimit(1).fixedSize()
        }
    }

    /// CSS `grid-template-columns: repeat(auto-fill, <cell>px)` with `gap`: as many columns as fit, from the left.
    private func cells<Cell: View>(_ count: Int, _ grid: MatchSpecimen.Grid, @ViewBuilder _ cell: @escaping (Int) -> Cell) -> some View {
        let inner = specimen.width - specimen.padding * 2
        let columns = max(1, Int((inner + grid.gap) / (grid.cell + grid.gap)))
        let rows = (count + columns - 1) / columns
        return VStack(alignment: .leading, spacing: grid.gap) {
            ForEach(0..<rows, id: \.self) { r in
                HStack(spacing: grid.gap) {
                    ForEach(0..<min(columns, count - r * columns), id: \.self) { c in
                        cell(r * columns + c).frame(width: grid.cell, height: grid.cell)
                    }
                }
            }
        }
    }

    /// A chrome colour by its token name (`inkMuted`), as `--color-ink-muted` resolves in the app.
    static func chrome(_ token: String) -> Color? {
        return FoleviTokens.Chrome.named[token]?.color
    }
}
