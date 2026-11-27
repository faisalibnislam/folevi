// Home's places on the iPhone: Foli DNA takes Shared with Me's tile, and Shared with Me goes to the card at the end.
#if os(iOS)
import SwiftUI
import Testing
import FoleviEngine
@testable import FoleviPhone

@Suite("Home on the iPhone")
struct PhoneHomeTests {
    private let rows = [
        HomeRow(id: .notes, title: "All notes", route: "/notes"),
        HomeRow(id: .drafts, title: "Drafts", count: 12, route: "/drafts"),
        HomeRow(id: .shared, title: "Shared with Me", route: "/shared"),
        HomeRow(id: .changes, title: "Changes", route: "/changes"),
    ]

    @Test func foliDNATakesSharedWithMesTile() {
        let p = PhoneHomeContent.places(rows, graphOn: true)
        #expect(p.tiles.map { $0?.id } == [.notes, .drafts, nil, .changes])
        #expect(p.sharedBelow?.id == .shared)
    }

    @Test func withoutFoliDNAHomeKeepsTheEnginesTiles() {
        let p = PhoneHomeContent.places(rows, graphOn: false)
        #expect(p.tiles.map { $0?.id } == [.notes, .drafts, .shared, .changes])
        #expect(p.sharedBelow == nil)
    }

    @Test func withNoSharedWithMeFoliDNAComesThird() {
        let p = PhoneHomeContent.places(rows.filter { $0.id != .shared }, graphOn: true)
        #expect(p.tiles.map { $0?.id } == [.notes, .drafts, nil, .changes])
        #expect(p.sharedBelow == nil)
    }

    /// Twenty 110 x 40 chips in 362 (three a line) lay out as two lines only: 40 + 8 + 40.
    @MainActor @Test func tagsFlowStopsAtTwoLines() {
        let flow = PhoneVaultFlow(gap: 8, rowGap: 8, pushAfterFirst: false, maxLines: PhoneHomeContent.tagLinesShown) {
            ForEach(0..<20, id: \.self) { _ in Color.gray.frame(width: 110, height: 40) }
        }
        #expect(Self.height(flow) == 88)
        let all = PhoneVaultFlow(gap: 8, rowGap: 8, pushAfterFirst: false) {
            ForEach(0..<20, id: \.self) { _ in Color.gray.frame(width: 110, height: 40) }
        }
        // Without the limit: seven lines, 7 × 40 + 6 × 8.
        let allHeight = Self.height(all) ?? 0
        #expect(allHeight == 328, "measured \(allHeight)")
    }

    /// The view's height at 362 wide, rendered offscreen.
    @MainActor private static func height(_ view: some View) -> CGFloat? {
        let renderer = ImageRenderer(content: view.frame(width: 362).fixedSize(horizontal: false, vertical: true))
        renderer.scale = 1
        return renderer.uiImage.map { $0.size.height.rounded() }
    }
}
#endif
