import XCTest

final class KeychainTests: XCTestCase {
    let keychain = Keychain(service: "com.folevi.mac.tests.\(UUID().uuidString)")

    override func tearDown() {
        try? keychain.deleteAll()
    }

    func testSetReadUpdateDelete() throws {
        XCTAssertThrowsError(try keychain.data(for: "token")) { XCTAssertEqual($0 as? Keychain.KeychainError, .notFound) }
        try keychain.setString("first", for: "token")
        XCTAssertEqual(keychain.string(for: "token"), "first")
        try keychain.setString("second", for: "token")
        XCTAssertEqual(keychain.string(for: "token"), "second")
        try keychain.delete("token")
        XCTAssertNil(keychain.string(for: "token"))
        XCTAssertNoThrow(try keychain.delete("token"), "deleting a missing item is not an error")
    }

    func testServicesAreIsolated() throws {
        let other = Keychain(service: keychain.service + ".other")
        defer { try? other.deleteAll() }
        try keychain.setString("a", for: "k")
        XCTAssertNil(other.string(for: "k"))
    }
}

final class AuthCallbackTests: XCTestCase {
    func testParsesCode() throws {
        let url = try XCTUnwrap(URL(string: "com.folevi.mac://auth/callback?code=abc123&state=xyz"))
        XCTAssertEqual(AuthCallback.parse(url), .code(code: "abc123", state: "xyz"))
    }

    func testParsesError() throws {
        let url = try XCTUnwrap(URL(string: "com.folevi.mac://auth/callback?error=access_denied&state=xyz"))
        XCTAssertEqual(AuthCallback.parse(url), .error(code: "access_denied", description: nil))
    }

    func testRejectsForeignCallbacks() throws {
        for s in ["com.evil.app://auth/callback?code=1",
                  "com.folevi.mac://evil/callback?code=1",
                  "com.folevi.mac://auth/other?code=1",
                  "com.folevi.mac://auth/callback"] {
            XCTAssertNil(AuthCallback.parse(try XCTUnwrap(URL(string: s))), s)
        }
    }

    func testPKCEMatchesRFC7636() {
        // RFC 7636 Appendix B.
        let pkce = PKCE(verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")
        XCTAssertEqual(pkce.challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
        let random = PKCE.make()
        XCTAssertEqual(random.verifier.count, 43)
        XCTAssertNotEqual(random, PKCE.make())
    }

    func testConnectURLCarriesTheChallenge() throws {
        let pkce = PKCE.make()
        let url = try XCTUnwrap(AuthCallback.connectURL(origin: try XCTUnwrap(URL(string: "https://app.folevi.com")), pkce: pkce, state: "st"))
        let items = Dictionary(uniqueKeysWithValues: (URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []).map { ($0.name, $0.value ?? "") })
        XCTAssertEqual(url.host, "app.folevi.com")
        XCTAssertEqual(url.path, "/connect")
        XCTAssertEqual(items["client_id"], "folevi-mac")
        XCTAssertEqual(items["redirect_uri"], "com.folevi.mac://auth/callback")
        XCTAssertEqual(items["code_challenge"], pkce.challenge)
        XCTAssertEqual(items["code_challenge_method"], "S256")
        XCTAssertEqual(items["state"], "st")
        XCTAssertNil(items["code_verifier"], "the verifier never leaves this Mac")
    }

    func testConfigPlaceholderDetection() {
        let placeholder = AppConfig.from(info: ["FoleviConvexURL": "https://<prod>.convex.cloud", "FoleviAppURL": "$(FOLEVI_APP_URL)"])
        XCTAssertFalse(placeholder.isSignInConfigured)
        XCTAssertFalse(placeholder.isBackendConfigured)
        let real = AppConfig.from(info: ["FoleviConvexURL": "http://127.0.0.1:3210", "FoleviAppURL": "http://app.localhost:3000"])
        XCTAssertTrue(real.isSignInConfigured)
        XCTAssertTrue(real.isBackendConfigured)
        XCTAssertFalse(AppConfig.from(info: ["FoleviAppURL": "javascript:alert(1)"]).isSignInConfigured)
    }

    func testULIDShape() {
        let id = ULID.make()
        XCTAssertTrue(ULID.isULID(id))
        XCTAssertTrue(ULID.isValidId(id))
        XCTAssertFalse(ULID.isValidId("has space"))
        XCTAssertLessThan(ULID.make(now: Date(timeIntervalSince1970: 1)), ULID.make(now: Date(timeIntervalSince1970: 2)))
    }
}

final class DailyNoteTests: XCTestCase {
    func testDailyDocumentIdMatchesTypeScript() {
        // Reference values computed with packages/editor-schema/src/ids.ts (node --experimental-strip-types).
        XCTAssertEqual(DailyNote.documentId(profileId: "jd7abc", scopeKey: "01JAWORKSPACE0000000000000", date: "2026-09-25"),
                       "daily-2026-09-25-853a6c8f815eecb3")
        XCTAssertEqual(DailyNote.documentId(profileId: "nd757rgzz01edng98mnz5jnj3h8f2hsk", scopeKey: "01M3BF5QHB3E99KWK3RRN8NW6Y", date: "2026-01-02"),
                       "daily-2026-01-02-a19252a939b28e37")
        XCTAssertEqual(DailyNote.documentId(profileId: "ü✓", scopeKey: "w", date: "2026-12-31"), "daily-2026-12-31-4421f1d765e718a3")
    }

    func testInboxDocumentIdMatchesTypeScript() {
        // packages/editor-schema inboxDocumentId("k57abc", "01M3BEZPKC").
        XCTAssertEqual(InboxPage.documentId(profileId: "k57abc", scopeKey: "01M3BEZPKC"), "inbox-85fc6e917711f0a6")
        XCTAssertTrue(ULID.isValidId(InboxPage.documentId(profileId: "p", scopeKey: "w")))
    }

    func testDailyIdIsValidAndTitled() {
        let id = DailyNote.documentId(profileId: "p", scopeKey: "w", date: "2026-09-25")
        XCTAssertTrue(ULID.isValidId(id))
        XCTAssertEqual(DailyNote.title(for: "2026-09-25"), "Friday, September 25, 2026")
    }
}
