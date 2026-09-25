import XCTest

final class JSONValueTests: XCTestCase {
    func testNumbersFormatLikeJavaScript() throws {
        let cases = try XCTUnwrap(Fixtures.reference["numbers"]?.arrayValue)
        for c in cases {
            let value = try XCTUnwrap(c["value"]?.doubleValue)
            XCTAssertEqual(JSONValue.formatNumber(value), c["text"]?.stringValue, "\(value)")
        }
        XCTAssertEqual(JSONValue.number(3).canonicalString, "3")
        XCTAssertEqual(JSONValue.number(-0.5).canonicalString, "-0.5")
    }

    func testCanonicalSortsKeysAndEscapes() throws {
        let v: JSONValue = ["b": 1, "a": ["z": nil, "y": "q\"\n\u{01}"], "c": [true, false]]
        XCTAssertEqual(v.canonicalString, #"{"a":{"y":"q\"\n\u0001","z":null},"b":1,"c":[true,false]}"#)
    }

    func testDecodePreservesTypes() throws {
        let v = try JSONValue(jsonString: #"{"n":1,"f":1.5,"b":true,"s":"x","a":[null],"o":{}}"#)
        XCTAssertEqual(v["n"], .number(1))
        XCTAssertEqual(v["b"], .bool(true))
        XCTAssertEqual(v["a"], .array([.null]))
        XCTAssertEqual(v["o"], .object([:]))
    }
}

final class FlexibleDecodingTests: XCTestCase {
    struct Holder: Decodable {
        var a: Int
        var b: Int?
        enum CodingKeys: String, CodingKey { case a, b }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            a = try c.decodeFlexibleInt(forKey: .a)
            b = try c.decodeFlexibleIntIfPresent(forKey: .b)
        }
    }

    func testAcceptsIntegralDoubles() throws {
        let h = try JSONDecoder().decode(Holder.self, from: Data(#"{"a":3.0,"b":4}"#.utf8))
        XCTAssertEqual(h.a, 3)
        XCTAssertEqual(h.b, 4)
        let n = try JSONDecoder().decode(Holder.self, from: Data(#"{"a":7,"b":null}"#.utf8))
        XCTAssertNil(n.b)
        XCTAssertThrowsError(try JSONDecoder().decode(Holder.self, from: Data(#"{"a":3.5}"#.utf8)))
    }

    func testHeadingLevelAcceptsDouble() throws {
        let p = try JSONDecoder().decode(HeadingProps.self, from: Data(#"{"level":2.0}"#.utf8))
        XCTAssertEqual(p.level, .level2)
        XCTAssertThrowsError(try JSONDecoder().decode(HeadingProps.self, from: Data(#"{"level":4}"#.utf8)))
    }
}
