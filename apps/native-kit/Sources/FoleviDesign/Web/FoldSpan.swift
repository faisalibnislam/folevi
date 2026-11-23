// Where iPhone Duo's fold crosses a view while the phone is partly closed (iOS 27.1's reserved regions, the
// `.division` kind). Scrolling content runs on across it; a row of controls leaves that span empty, so no button
// sits in the crease (Apple's HIG, "Designing for iPhone Duo": interactive elements stay out of the fold). Flat or
// closed, on any other device, and before iOS 27.1, there is none.
#if os(iOS)
import SwiftUI

/// The span of x an active fold covers, in a view's own coordinates.
public struct FoldSpan: Equatable, Sendable {
    public var minX: CGFloat
    public var maxX: CGFloat

    public init(minX: CGFloat, maxX: CGFloat) {
        self.minX = minX
        self.maxX = maxX
    }

    /// How far controls keep from the crease on each side.
    public static let margin: CGFloat = 12

    public var width: CGFloat { maxX - minX }
}

@available(iOS 27.1, *)
extension FoldSpan {
    /// The active fold running down through this view (a vertical division that crosses its bounds), or nil.
    nonisolated static func across(_ proxy: GeometryProxy) -> FoldSpan? {
        let size = proxy.size
        for region in proxy.reservedRegions(kind: .division) where region.isActive {
            let f = region.frame
            guard f.height > f.width, f.maxX > 0, f.minX < size.width, f.maxY > 0, f.minY < size.height else { continue }
            return FoldSpan(minX: max(0, f.minX), maxX: min(size.width, f.maxX))
        }
        return nil
    }
}

public extension View {
    /// Reports where an active fold crosses this view (nil when none does), as it changes.
    func readFold(_ action: @escaping (FoldSpan?) -> Void) -> some View {
        modifier(FoldReader(action: action))
    }
}

private struct FoldReader: ViewModifier {
    let action: (FoldSpan?) -> Void

    func body(content: Content) -> some View {
        if #available(iOS 27.1, *) {
            content.onGeometryChange(for: FoldSpan?.self) { FoldSpan.across($0) } action: { action($0) }
        } else {
            content
        }
    }
}
#endif
