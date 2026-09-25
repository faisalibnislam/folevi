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
    let bundle = "com.folevi.mac"
    let domain = "auth.folevi.com"

    func testCallbackURLShape() {
        XCTAssertEqual(AuthCallback.callbackURL(bundleId: bundle, domain: domain)?.absoluteString,
                       "com.folevi.mac://auth.folevi.com/macos/com.folevi.mac/callback")
    }

    func testParsesCode() throws {
        let url = try XCTUnwrap(URL(string: "com.folevi.mac://auth.folevi.com/macos/com.folevi.mac/callback?code=abc123&state=xyz"))
        XCTAssertEqual(AuthCallback.parse(url, bundleId: bundle, domain: domain), .code(code: "abc123", state: "xyz"))
    }

    func testParsesError() throws {
        let url = try XCTUnwrap(URL(string: "com.folevi.mac://auth.folevi.com/macos/com.folevi.mac/callback?error=access_denied&error_description=User%20cancelled"))
        XCTAssertEqual(AuthCallback.parse(url, bundleId: bundle, domain: domain), .error(code: "access_denied", description: "User cancelled"))
    }

    func testRejectsForeignCallbacks() throws {
        for s in ["com.evil.app://auth.folevi.com/macos/com.folevi.mac/callback?code=1",
                  "com.folevi.mac://evil.com/macos/com.folevi.mac/callback?code=1",
                  "com.folevi.mac://auth.folevi.com/macos/other/callback?code=1",
                  "com.folevi.mac://auth.folevi.com/macos/com.folevi.mac/callback"] {
            XCTAssertNil(AuthCallback.parse(try XCTUnwrap(URL(string: s)), bundleId: bundle, domain: domain), s)
        }
    }

    func testConfigPlaceholderDetection() {
        let placeholder = AppConfig.from(info: ["FoleviConvexURL": "https://<prod>.convex.cloud", "FoleviAuth0Domain": "auth.folevi.com", "FoleviAuth0ClientID": "set-me"])
        XCTAssertFalse(placeholder.isAuth0Configured)
        XCTAssertFalse(placeholder.isBackendConfigured)
        XCTAssertNil(placeholder.devAuthURL)
        let real = AppConfig.from(info: ["FoleviConvexURL": "http://127.0.0.1:3210", "FoleviAuth0Domain": "folevi.eu.auth0.com", "FoleviAuth0ClientID": "AbC123", "FoleviDevAuthURL": "http://localhost:3000/api/dev-auth/token"])
        XCTAssertTrue(real.isAuth0Configured)
        XCTAssertTrue(real.isBackendConfigured)
        XCTAssertNotNil(real.devAuthURL)
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
        XCTAssertEqual(DailyNote.documentId(profileId: "jd7abc", workspaceId: "01JAWORKSPACE0000000000000", date: "2026-09-25"),
                       "daily-2026-09-25-853a6c8f815eecb3")
        XCTAssertEqual(DailyNote.documentId(profileId: "nd757rgzz01edng98mnz5jnj3h8f2hsk", workspaceId: "01M3BF5QHB3E99KWK3RRN8NW6Y", date: "2026-01-02"),
                       "daily-2026-01-02-a19252a939b28e37")
        XCTAssertEqual(DailyNote.documentId(profileId: "ü✓", workspaceId: "w", date: "2026-12-31"), "daily-2026-12-31-4421f1d765e718a3")
    }

    func testInboxDocumentIdMatchesTypeScript() {
        // packages/editor-schema inboxDocumentId("k57abc", "01M3BEZPKC").
        XCTAssertEqual(InboxPage.documentId(profileId: "k57abc", workspaceId: "01M3BEZPKC"), "inbox-85fc6e917711f0a6")
        XCTAssertTrue(ULID.isValidId(InboxPage.documentId(profileId: "p", workspaceId: "w")))
    }

    func testDailyIdIsValidAndTitled() {
        let id = DailyNote.documentId(profileId: "p", workspaceId: "w", date: "2026-09-25")
        XCTAssertTrue(ULID.isValidId(id))
        XCTAssertEqual(DailyNote.title(for: "2026-09-25"), "Friday, September 25, 2026")
    }
}
