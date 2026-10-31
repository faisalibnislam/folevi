#if os(iOS)
import SwiftUI
import UIKit
import XCTest
@testable import FoleviDesign

/// The phone's folder card drawn alone at 178 pt: where its front cover starts and ends (the web's: 46% down,
/// 54% of the card's 820/912 height), read off a column of pixels.
@MainActor
final class FolderCardGeometryTests: XCTestCase {
    func testFrontCoverPlacement() throws {
        FoleviFonts.register()
        let model = FolderCardModel(id: "f", name: "Personal", colorId: "rose", count: 3, ageText: "36 mins ago")
        let w: CGFloat = 178
        let view = WebFolderCard(model).frame(width: w).environment(\.webPhoneCards, true).padding(20).background(Color.white)
        let r = ImageRenderer(content: view.environment(\.colorScheme, .light))
        r.scale = 3
        r.isOpaque = true
        guard let img = r.cgImage, let data = img.dataProvider?.data, let p = CFDataGetBytePtr(data) else { return XCTFail("no image") }
        let bpr = img.bytesPerRow, bpp = img.bitsPerPixel / 8
        let x = Int((20 + w * 0.75) * 3)
        // Where the column changes colour (in points from the card's top): the cover's top edge and its foot.
        var edges: [Double] = []
        var prev: (Int, Int, Int)? = nil
        for y in 0..<img.height {
            let o = y * bpr + x * bpp
            let v = (Int(p[o]), Int(p[o + 1]), Int(p[o + 2]))
            if let q = prev, abs(q.0 - v.0) + abs(q.1 - v.1) + abs(q.2 - v.2) > 30 { edges.append(Double(y) / 3 - 20) }
            prev = v
        }
        let h = Double(w) * 912 / 820
        XCTAssertEqual(Double(img.height) / 3 - 40, h, accuracy: 0.5)
        // The cover starts at 46% (its 1 pt highlight) and ends with the card (its 1 pt edge).
        XCTAssertEqual(edges.first ?? 0, h * 0.46, accuracy: 1.5, "cover top, edges \(edges)")
        XCTAssertEqual(edges.last ?? 0, h, accuracy: 1, "cover foot, edges \(edges)")
    }
}
#endif
