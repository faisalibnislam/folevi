// foleviShell's native side on the Mac (Bridge/ShellRouter.swift): every method the shared shell-bridge.js and
// the cloud kit call is routed, with the iOS plugin's names; answers and refusals keep the shapes the page reads
// (lib/shell/types.ts); the library works end to end through the router; secrets are written, never read back;
// reminders and calendars answer only the library's pages (Electron's localShell).
import CryptoKit
import XCTest
@testable import Folevi

final class ShellTests: XCTestCase {
    private final class Sink: BridgeEvents {
        var events: [(String, String, [String: Any])] = []
        func emit(_ plugin: String, _ event: String, _ data: [String: Any]) { events.append((plugin, event, data)) }
    }

    private static let repo = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../..").standardizedFileURL

    @MainActor
    private func call(_ method: String, _ options: [String: Any] = [:], place: String? = ShellPlaces.library, sink: Sink = Sink()) async throws -> [String: Any] {
        try await ShellRouter(place: { place }, window: { nil }, events: sink).handle(method, options)
    }

    @MainActor
    private func refusal(_ method: String, _ options: [String: Any] = [:], place: String? = ShellPlaces.library) async -> BridgeError? {
        do {
            _ = try await call(method, options, place: place)
            return nil
        } catch {
            return error as? BridgeError
        }
    }

    func testTheRunUsesItsOwnFolder() {
        // project.yml's test scheme sets FOLEVI_USER_DATA: nothing here touches Folevi Dev's own folder or Keychain.
        XCTAssertNotNil(Paths.userDataOverride, "FOLEVI_USER_DATA is set for tests")
        XCTAssertTrue(Paths.keychainService("com.folevi.e2ee").hasPrefix("com.folevi.dev.\(Paths.runTag ?? "")."))
    }

    func testEveryMethodTheBridgeCallsIsRouted() throws {
        let bridge = try String(contentsOf: Self.repo.appendingPathComponent("apps/ios/ios/App/Native/Shell/shell-bridge.js"), encoding: .utf8)
        var called = Set<String>()
        for pattern in [#"shellCall\("([A-Za-z0-9]+)""#, #"call\("FoleviShell", "([A-Za-z0-9]+)""#, #"(?:request|status): "([A-Za-z0-9]+)""#] {
            let re = try NSRegularExpression(pattern: pattern)
            for m in re.matches(in: bridge, range: NSRange(bridge.startIndex..., in: bridge)) {
                called.insert(String(bridge[Range(m.range(at: 1), in: bridge)!]))
            }
        }
        XCTAssertGreaterThan(called.count, 40)
        XCTAssertTrue(called.isSubset(of: ShellRouter.methods), "not routed: \(called.subtracting(ShellRouter.methods).sorted())")
        // The cloud kit's own calls (packages/cloud-folders through folevi-cloud.js): the mirror and libSetCloud.
        for m in ["mirrorRead", "mirrorWrite", "mirrorDelete", "mirrorPaths", "mirrorLoadState", "mirrorSaveState", "libSetCloud", "cloudRequest", "cloudStatus"] {
            XCTAssertTrue(ShellRouter.methods.contains(m), m)
        }
        // The same list as the iOS plugin.
        let plugin = try String(contentsOf: Self.repo.appendingPathComponent("apps/ios/ios/App/Native/Shell/FoleviShellPlugin.swift"), encoding: .utf8)
        let start = try XCTUnwrap(plugin.range(of: "pluginMethods"))
        let end = try XCTUnwrap(plugin.range(of: "].map", range: start.upperBound..<plugin.endIndex))
        let names = try NSRegularExpression(pattern: #""([A-Za-z0-9]+)""#).matches(in: String(plugin[start.upperBound..<end.lowerBound]), range: NSRange(location: 0, length: plugin[start.upperBound..<end.lowerBound].utf16.count))
        let list = String(plugin[start.upperBound..<end.lowerBound])
        let ios = Set(names.map { String(list[Range($0.range(at: 1), in: list)!]) })
        XCTAssertEqual(ios, ShellRouter.methods)
    }

    @MainActor
    func testUnknownMethodsAndRefusalsKeepTheirCodes() async throws {
        let got1 = await refusal("libNope")
        XCTAssertEqual(got1?.code, "unavailable")
        let got2 = await refusal("setMode", ["mode": "web"])
        XCTAssertEqual(got2?.code, "invalid_argument")
        let got3 = await refusal("libSetup", ["kind": "dropbox"])
        XCTAssertEqual(got3?.path, "unsupported")
        let got4 = await refusal("libWrite", ["path": "notes/a.md"])
        XCTAssertEqual(got4?.code, "invalid_argument", "bytes are needed")
        let got5 = await refusal("placesSwitch", ["id": "acct:nobody"])
        XCTAssertEqual(got5?.code, "invalid_argument")
        let got6 = await refusal("placesSignOut", ["id": "library"])
        XCTAssertEqual(got6?.code, "invalid_argument")
        let got7 = await refusal("aiGenerate", ["id": "g1"])
        XCTAssertEqual(got7?.code, "invalid_argument")
        let e = ShellRouter.bridgeError(LibraryError(.notFound, "Gone", path: "notes/a.md"))
        XCTAssertEqual([e.code, e.message, e.path], ["not_found", "Gone", "notes/a.md"])
        XCTAssertEqual(ShellRouter.bridgeError(E2eeError(code: "cancelled", message: "No")).code, "cancelled")
        XCTAssertEqual(ShellRouter.bridgeError(CloudError(code: "one_connection", message: "x")).code, "one_connection")
    }

    @MainActor
    func testTheLibraryThroughTheRouter() async throws {
        let lib = LibraryService.shared
        lib.iterations = 1000
        defer { lib.iterations = LibraryCrypto.defaultIterations }
        // A library of this test's own, from nothing.
        await Places.onLibraryQueue { lib.forget() }
        try? FileManager.default.removeItem(at: Paths.documentsFolder.appendingPathComponent(LibraryService.deviceFolder, isDirectory: true))
        let setup = try await call("libSetup", ["kind": "device"])
        XCTAssertEqual(setup["configured"] as? Bool, true)
        XCTAssertEqual(setup["kind"] as? String, "device")
        let info = try await call("libInfo")
        XCTAssertEqual(Set(info.keys), ["kind", "displayPath", "available", "encrypted", "locked", "configured"])
        let path = "notes/01J9ZDOC000000000000000777.fnote"
        // A note's file names its id (an encrypted library learns its note names back from it).
        let note = Data(#"{"id":"01J9ZDOC000000000000000777","title":"hello"}"#.utf8)
        let w = try await call("libWrite", ["path": path, "bytes": note.base64EncodedString(), "mode": "create"])
        let etag = try XCTUnwrap(w["etag"] as? String)
        let again = try await call("libWrite", ["path": path, "bytes": Data("x".utf8).base64EncodedString(), "mode": "create"])
        XCTAssertEqual(again["mismatch"] as? Bool, true)
        let r = try await call("libRead", ["path": path])
        XCTAssertEqual(r["bytes"] as? String, note.base64EncodedString())
        XCTAssertEqual(r["etag"] as? String, etag)
        let list = try await call("libList", ["dir": "notes"])
        XCTAssertTrue(((list["entries"] as? [[String: Any]]) ?? []).contains { $0["path"] as? String == path })
        // The journal.
        let before = try await call("journalRead")
        _ = try await call("journalTruncate", ["n": (before["records"] as? [String])?.count ?? 0])
        _ = try await call("journalAppend", ["record": Data("r1".utf8).base64EncodedString()])
        _ = try await call("journalAppend", ["record": Data("r2".utf8).base64EncodedString()])
        let got8 = try await call("journalRead")
        XCTAssertEqual(got8["records"] as? [String], [Data("r1".utf8).base64EncodedString(), Data("r2".utf8).base64EncodedString()])
        _ = try await call("journalTruncate", ["n": 1])
        let got9 = try await call("journalRead")
        XCTAssertEqual((got9["records"] as? [String])?.count, 1)
        // A passphrase, a wrong one, the right one.
        _ = try await call("libSetPassphrase", ["passphrase": "correct horse"])
        let got10 = try await call("libInfo")
        XCTAssertEqual(got10["encrypted"] as? Bool, true)
        let got11 = try await call("libUnlock", ["passphrase": "nope"])
        XCTAssertEqual(got11["value"] as? Bool, false)
        let got12 = try await call("libUnlock", ["passphrase": "correct horse"])
        XCTAssertEqual(got12["value"] as? Bool, true)
        let got13 = try await call("libRead", ["path": path])
        XCTAssertEqual(got13["bytes"] as? String, note.base64EncodedString(), "read back decrypted")
        _ = try await call("libSetPassphrase", [:])
        let got14 = try await call("libInfo")
        XCTAssertEqual(got14["encrypted"] as? Bool, false)
        _ = try await call("libRemove", ["path": path])
        let got15 = await refusal("libRead", ["path": path])
        XCTAssertEqual(got15?.code, "not_found")
        let got16 = await refusal("libRead", ["path": "../escape"])
        XCTAssertEqual(got16?.code, "invalid_path")
        await Places.onLibraryQueue { lib.forget() }
        let got17 = try await call("libInfo")
        XCTAssertEqual(got17["configured"] as? Bool, false)
    }

    /// app://folevi/_files/<sha256> from the library (Places.swift's LibraryAttachments): a file over the 256 KB a
    /// reader piece holds, whole and by byte range, and a 404 for one that isn't there, plain and encrypted.
    @MainActor
    func testAttachmentsWholeAndByRangePlainAndEncrypted() async throws {
        let lib = LibraryService.shared
        lib.iterations = 1000
        defer { lib.iterations = LibraryCrypto.defaultIterations }
        await Places.onLibraryQueue { lib.forget() }
        try? FileManager.default.removeItem(at: Paths.documentsFolder.appendingPathComponent(LibraryService.deviceFolder, isDirectory: true))
        _ = try await call("libSetup", ["kind": "device"])
        let bytes = Data((0..<700_000).map { UInt8(($0 * 7) % 251) })
        let sha = SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
        let scheme = AppScheme(root: FileManager.default.temporaryDirectory, serviceOrigin: "https://app.folevi.com")
        let files = LibraryAttachments()
        scheme.files = files
        func get(_ path: String, range: String? = nil) -> AppResponse {
            var r = AppRequest(url: URL(string: "app://folevi/_files/\(path)")!)
            if let range { r.headers["Range"] = range }
            return scheme.respond(r)
        }
        for encrypted in [false, true] {
            if encrypted { _ = try await call("libSetPassphrase", ["passphrase": "attachments"]) }
            files.reset()
            _ = try await call("libWrite", ["path": "files/\(sha.prefix(2))/\(sha)", "bytes": bytes.base64EncodedString()])
            let whole = get("\(sha)?type=image%2Fpng")
            XCTAssertEqual(whole.status, 200, "encrypted: \(encrypted)")
            XCTAssertEqual(whole.body, bytes, "encrypted: \(encrypted)")
            XCTAssertEqual(whole.header("Content-Type"), "image/png")
            for (range, lo, hi) in [("bytes=10-19", 10, 19), ("bytes=262140-262150", 262_140, 262_150), ("bytes=699990-", 699_990, 699_999), ("bytes=-5", 699_995, 699_999)] {
                let part = get(sha, range: range)
                XCTAssertEqual(part.status, 206, "\(range) encrypted: \(encrypted)")
                XCTAssertEqual(part.body, bytes.subdata(in: lo..<(hi + 1)), "\(range) encrypted: \(encrypted)")
                XCTAssertEqual(part.header("Content-Range"), "bytes \(lo)-\(hi)/\(bytes.count)")
            }
            XCTAssertEqual(get(String(repeating: "0", count: 64)).status, 404)
            XCTAssertEqual(get(sha, range: "bytes=800000-").status, 416)
        }
        _ = try await call("libSetPassphrase", [:])
        await Places.onLibraryQueue { lib.forget() }
    }

    @MainActor
    func testSecretsAreWrittenNeverRead() async throws {
        _ = try await call("secretsSet", ["name": "ai.openai", "value": "sk-test-0123456789"])
        let got18 = try await call("secretsHas", ["name": "ai.openai"])
        XCTAssertEqual(got18["value"] as? Bool, true)
        let got19 = await refusal("secretsSet", ["name": "auth.session", "value": "x"])
        XCTAssertEqual(got19?.code, "invalid_argument")
        let got20 = try await call("secretsHas", ["name": "auth.session"])
        XCTAssertEqual(got20["value"] as? Bool, false)
        _ = try await call("secretsDelete", ["name": "ai.openai"])
        let got21 = try await call("secretsHas", ["name": "ai.openai"])
        XCTAssertEqual(got21["value"] as? Bool, false)
        XCTAssertFalse(ShellRouter.methods.contains("secretsGet"))
    }

    @MainActor
    func testRemindersAndCalendarsOnlyForTheLibrary() async throws {
        let notLocal = try await call("notifySchedule", ["id": "r1", "at": 1, "title": "t", "body": "", "path": "/tasks"], place: "acct:someone")
        XCTAssertEqual(notLocal["value"] as? Bool, false)
        let cal = try await call("httpCalendar", ["url": "https://example.com/a.ics", "previous": [:]], place: "acct:someone")
        XCTAssertEqual(cal["kind"] as? String, "error")
        let refused = try await call("httpCalendar", ["url": "http://example.com/a.ics", "previous": [:]], place: ShellPlaces.library)
        XCTAssertEqual(refused["message"] as? String, "Folevi can only subscribe to public https calendar links.")
        let got22 = await refusal("notifySchedule", ["id": "r1"], place: ShellPlaces.library)
        XCTAssertEqual(got22?.code, "invalid_argument")
    }

    @MainActor
    func testFoliAiAnswersLikeIOS() async throws {
        let caps = try await call("aiCapabilities")
        // Electron's AiCaps: { onDevice, onDeviceStatus, keys, onDeviceContext? }.
        XCTAssertTrue(Set(caps.keys).isSubset(of: ["onDevice", "onDeviceStatus", "keys", "onDeviceContext"]), "\(caps.keys.sorted())")
        XCTAssertNotNil(caps["onDevice"] as? Bool)
        XCTAssertEqual(Set(((caps["keys"] as? [String: Bool]) ?? [:]).keys), ["ai.openai", "ai.anthropic", "ai.google"])
        let bad = try await call("aiGenerate", ["id": "g1", "req": ["provider": "folevi", "messages": []]])
        XCTAssertEqual(bad["stopReason"] as? String, "error")
        XCTAssertEqual(bad["errorCode"] as? String, "invalid")
        let got23 = try await call("aiCancel", ["id": "nope"])
        XCTAssertEqual(got23.count, 0)
    }

    @MainActor
    func testTheLockSaysTouchIDOrNone() async throws {
        let s = try await call("lockGet")
        XCTAssertEqual(Set(s.keys), ["lock", "lockAfter", "method"])
        XCTAssertTrue(["touchID", "none"].contains(s["method"] as? String ?? ""))
        let got24 = await refusal("lockSet", ["lockAfter": "soon"])
        XCTAssertEqual(got24?.code, "invalid_argument")
    }

    @MainActor
    func testSignedOutAnswers() async throws {
        let got25 = try await call("placesConvexToken", ["id": "acct:someone"], place: ShellPlaces.library)
        XCTAssertTrue(got25["value"] is NSNull)
        let got26 = try await call("authConvexToken", place: "acct:nosession")
        XCTAssertTrue(got26["value"] is NSNull)
        let status = try await call("cloudStatus")
        XCTAssertEqual(Set(status.keys), ["available", "provider", "state", "account"])
    }

    /// The app's own Continue with Google or Apple opens the sheet straight on /app-google for that provider;
    /// email, or anything else, is the website's sign-in page (/connect). Same PKCE request either way.
    func testTheSignInSheetStartsOnTheChosenProvider() throws {
        let service = URL(string: "https://app.folevi.com")!
        let challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        func query(_ url: URL?) -> [String: String] {
            Dictionary(uniqueKeysWithValues: (URLComponents(url: url!, resolvingAgainstBaseURL: false)?.queryItems ?? []).map { ($0.name, $0.value ?? "") })
        }
        let common = ["client_id": "folevi-shell", "redirect_uri": "folevi://auth/callback", "code_challenge": challenge, "code_challenge_method": "S256", "state": "st"]
        for provider in ["google", "apple"] {
            let url = ShellAuth.signInStart(service: service, provider: provider, challenge: challenge, state: "st")
            XCTAssertEqual(url?.host, "app.folevi.com")
            XCTAssertEqual(url?.path, "/app-google")
            XCTAssertEqual(query(url), common.merging(["provider": provider]) { $1 })
        }
        for other in [nil, "email", "facebook", ""] as [String?] {
            let url = ShellAuth.signInStart(service: service, provider: other, challenge: challenge, state: "st")
            XCTAssertEqual(url?.path, "/connect")
            XCTAssertEqual(query(url), common)
        }
    }
}
