import XCTest

final class RankTests: XCTestCase {
    func testGoldenRankBetweenCases() throws {
        let fixture = try Fixtures.json(Fixtures.editorSchema("ranks.json"))
        let cases = try XCTUnwrap(fixture["cases"]?.arrayValue)
        XCTAssertFalse(cases.isEmpty)
        for c in cases {
            let before = c["before"]?.stringValue
            let after = c["after"]?.stringValue
            let expected = try XCTUnwrap(c["result"]?.stringValue)
            XCTAssertEqual(try Rank.between(before, after), expected, "rankBetween(\(before ?? "null"), \(after ?? "null"))")
        }
    }

    func testGoldenSequence10() throws {
        let fixture = try Fixtures.json(Fixtures.editorSchema("ranks.json"))
        let expected = try XCTUnwrap(fixture["sequence10"]?.arrayValue).compactMap(\.stringValue)
        XCTAssertEqual(try Rank.sequence(10), expected)
    }

    func testInvalidRanksThrow() {
        XCTAssertThrowsError(try Rank.between("V0", nil))
        XCTAssertThrowsError(try Rank.between("b", "a"))
        XCTAssertThrowsError(try Rank.between("a", "a"))
        XCTAssertFalse(Rank.isValid(""))
        XCTAssertFalse(Rank.isValid("a!"))
        XCTAssertTrue(Rank.isValid("aZ9"))
    }

    func testRepeatedInsertionStaysOrdered() throws {
        var lower: String? = nil
        let upper = "V"
        var ranks: [String] = []
        for _ in 0..<200 {
            let r = try Rank.between(lower, upper)
            if let lower { XCTAssertLessThan(Rank.compare(lower, r), 0) }
            XCTAssertLessThan(Rank.compare(r, upper), 0)
            ranks.append(r)
            lower = r
        }
        XCTAssertEqual(ranks, ranks.sorted { Rank.compare($0, $1) < 0 })
    }
}
