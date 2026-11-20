#if os(iOS)
import SwiftUI
import UIKit
import XCTest
@testable import FoleviDesign

/// The phone's folder card drawn alone at 178 pt: where its frosted front starts and ends (the web's: 45% down, to
/// the foot of the square card), read off a column of pixels.
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
        let h = Double(w)
        XCTAssertEqual(Double(img.height) / 3 - 40, h, accuracy: 0.5)
        // The front starts at 45% (its 1 pt rim) and ends with the card (its rim).
        // (The back's and the notes' edges come first: the front's top is the edge nearest 45%.)
        let top = edges.min { abs($0 - h * 0.45) < abs($1 - h * 0.45) } ?? 0
        XCTAssertEqual(top, h * 0.45, accuracy: 1.5, "front top, edges \(edges)")
        XCTAssertEqual(edges.last ?? 0, h, accuracy: 1, "cover foot, edges \(edges)")
    }
}
#endif
