// The built-in interface's native parts (Native/Shell) against the fixtures every implementation shares:
// packages/local-store/fixtures/fs-contract.json (the library's file layer, plain and encrypted),
// crypto-vectors.json (the FLV1 envelope, the passphrase, the names) and e2ee-vectors.json (FLS1 boxes and
// FST1 statements, the device keys the page uses for end-to-end encryption). The Simulator reads the fixtures
// straight from the repository.
import CryptoKit
import XCTest
@testable import App

private let fixtures = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../../../../packages/local-store/fixtures").standardizedFileURL

private func fixture(_ name: String) throws -> [String: Any] {
    let data = try Data(contentsOf: fixtures.appendingPathComponent(name))
    return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
}

private func hex(_ s: String) -> Data {
    var d = Data()
    var i = s.startIndex
    while i < s.endIndex {
        let j = s.index(i, offsetBy: 2)
        d.append(UInt8(s[i..<j], radix: 16)!)
        i = j
    }
    return d
}

private func hexString(_ d: Data) -> String { d.map { String(format: "%02x", $0) }.joined() }

final class ShellCryptoTests: XCTestCase {
    func testTheEnvelopeMatchesTheVectors() throws {
        let v = try fixture("crypto-vectors.json")
        for k in v["kdf"] as! [[String: Any]] {
            let key = try LibraryCrypto.deriveWrappingKey(k["passphrase"] as! String, salt: hex(k["saltHex"] as! String), iterations: k["iterations"] as! Int)
            XCTAssertEqual(hexString(key), k["wrappingKeyHex"] as? String)
        }
        for w in v["wrap"] as! [[String: Any]] {
            let header = try LibraryCrypto.wrap(hex(w["masterKeyHex"] as! String), passphrase: w["passphrase"] as! String, iterations: w["iterations"] as! Int, salt: hex(w["saltHex"] as! String), nonce: hex(w["nonceHex"] as! String))
            let want = w["header"] as! [String: Any]
            XCTAssertEqual(header.wrappedKey, want["wrappedKey"] as? String)
            XCTAssertEqual(header.keyCheck, want["keyCheck"] as? String)
            XCTAssertEqual(try LibraryCrypto.unlock(header, passphrase: w["passphrase"] as! String).map(hexString), w["masterKeyHex"] as? String)
            XCTAssertNil(try LibraryCrypto.unlock(header, passphrase: "wrong"))
        }
        for f in v["fileKeys"] as! [[String: Any]] {
            XCTAssertEqual(hexString(try LibraryCrypto.fileKey(hex(f["masterKeyHex"] as! String), f["pathId"] as! String)), f["keyHex"] as? String)
        }
        for n in v["names"] as! [[String: Any]] {
            XCTAssertEqual(try LibraryCrypto.hmacName(hex(n["masterKeyHex"] as! String), kind: n["kind"] as! String, id: n["id"] as! String), n["name"] as? String)
        }
        for s in v["single"] as! [[String: Any]] {
            let master = hex(s["masterKeyHex"] as! String)
            let env = try LibraryCrypto.sealFile(master, pathId: s["pathId"] as! String, Data((s["plaintextUtf8"] as! String).utf8), nonce: hex(s["nonceHex"] as! String))
            XCTAssertEqual(hexString(env), s["envelopeHex"] as? String)
            XCTAssertEqual(String(data: try LibraryCrypto.openFile(master, pathId: s["pathId"] as! String, env), encoding: .utf8), s["plaintextUtf8"] as? String)
        }
        for s in v["stream"] as! [[String: Any]] {
            let master = hex(s["masterKeyHex"] as! String)
            let length = s["plaintextLength"] as! Int
            let plain = Data((0..<length).map { UInt8($0 % 251) })
            let env = try LibraryCrypto.sealStream(master, pathId: s["pathId"] as! String, plain, noncePrefix: hex(s["noncePrefixHex"] as! String), chunkSize: s["chunkSize"] as! Int)
            XCTAssertEqual(env.count, s["envelopeLength"] as? Int)
            XCTAssertEqual(hexString(Data(SHA256.hash(data: env))), s["envelopeSha256"] as? String)
            XCTAssertEqual(try LibraryCrypto.openFile(master, pathId: s["pathId"] as! String, env), plain)
            let reader = try LibraryCrypto.StreamReader(master: master, pathId: s["pathId"] as! String, envelopeLength: env.count) { env.subdata(in: $0..<min(env.count, $0 + $1)) }
            if length > 10 { XCTAssertEqual(try reader.range(3, length - 2), plain.subdata(in: 3..<(length - 2))) }
        }
        let master = hex("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f")
        for r in v["rejects"] as! [[String: Any]] {
            XCTAssertThrowsError(try LibraryCrypto.openFile(master, pathId: r["pathId"] as! String, hex(r["envelopeHex"] as! String)), r["name"] as! String)
        }
    }

    func testSealedBoxesAndStatementsMatchTheE2eeVectors() throws {
        let v = try fixture("e2ee-vectors.json")
        for b in v["boxes"] as! [[String: Any]] {
            let key = try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: hex(b["recipientSeedHex"] as! String))
            XCTAssertEqual(hexString(key.publicKey.rawRepresentation), b["recipientPubHex"] as? String)
            let opened = try E2eeKeys.openSealedBox(key, recipientPub: key.publicKey.rawRepresentation, context: b["context"] as! String, box: hex(b["boxHex"] as! String))
            XCTAssertEqual(hexString(opened), b["plaintextHex"] as? String, b["name"] as! String)
            XCTAssertThrowsError(try E2eeKeys.openSealedBox(key, recipientPub: key.publicKey.rawRepresentation, context: (b["context"] as! String) + "x", box: hex(b["boxHex"] as! String)))
        }
        for s in v["statements"] as! [[String: Any]] {
            // CryptoKit's signatures are randomised; the vectors' own signatures verify with the same message.
            let pub = try Curve25519.Signing.PublicKey(rawRepresentation: hex(s["signerPubHex"] as! String))
            let sig = s["sig"] as! String
            let padded = sig.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/") + String(repeating: "=", count: (4 - sig.count % 4) % 4)
            XCTAssertTrue(pub.isValidSignature(Data(base64Encoded: padded)!, for: E2eeKeys.statementMessage(kind: s["kind"] as! String, body: s["body"] as! String)))
        }
    }

    func testThisDevicesKeysSignAndOpen() async throws {
        let keys = E2eeKeys.shared
        keys.reset()
        let k = try keys.deviceKeys()
        XCTAssertTrue(k.deviceId.hasPrefix("ios-"))
        XCTAssertEqual(try keys.deviceKeys().deviceId, k.deviceId, "kept")
        let sig = try keys.sign(kind: "device", body: #"{"deviceId":"x"}"#)
        let padded = sig.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/") + String(repeating: "=", count: (4 - sig.count % 4) % 4)
        XCTAssertTrue(try Curve25519.Signing.PublicKey(rawRepresentation: k.ed25519Pub).isValidSignature(Data(base64Encoded: padded)!, for: E2eeKeys.statementMessage(kind: "device", body: #"{"deviceId":"x"}"#)))
        XCTAssertThrowsError(try keys.sign(kind: "other", body: "{}"))
        // A box sealed to this device (the FLS1 layout), opened by it.
        let context = "folevi/e2ee/v1/amk/device/test"
        let eph = Curve25519.KeyAgreement.PrivateKey()
        let recipient = try Curve25519.KeyAgreement.PublicKey(rawRepresentation: k.x25519Pub)
        let shared = try eph.sharedSecretFromKeyAgreement(with: recipient).withUnsafeBytes { Data($0) }
        let boxKey = HKDF<SHA256>.deriveKey(inputKeyMaterial: SymmetricKey(data: shared), salt: eph.publicKey.rawRepresentation + k.x25519Pub, info: Data("seal/\(context)".utf8), outputByteCount: 32)
        let nonce = LibraryCrypto.randomBytes(12)
        let header = Data("FLS1".utf8) + Data([1]) + eph.publicKey.rawRepresentation + nonce
        let sealed = try AES.GCM.seal(Data("the account key".utf8), using: boxKey, nonce: AES.GCM.Nonce(data: nonce), authenticating: header + Data(context.utf8))
        let opened = try await keys.open(header + sealed.ciphertext + sealed.tag, context: context)
        XCTAssertEqual(String(data: opened, encoding: .utf8), "the account key")
        keys.reset()
        XCTAssertNotEqual(try keys.deviceKeys().deviceId, k.deviceId, "new keys after a reset")
        keys.reset()
    }
}

final class ShellFilesTests: XCTestCase {
    private func freshRoot() -> URL {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("lib-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return root
    }

    /// Runs local-store's LocalFs contract on a folder, plain or encrypted.
    private func runContract(encrypted: Bool) throws {
        let c = try fixture("fs-contract.json")
        for case let path as String in c["invalidPaths"] as! [Any] {
            let fs = FolderFS(root: freshRoot())
            for attempt in [{ _ = try fs.read(path) }, { _ = try fs.write(path, Data(), .any) }, { try fs.remove(path, ifMatch: nil) }, { _ = try fs.list(path.isEmpty ? "x/../" : path) }] {
                XCTAssertThrowsError(try attempt()) { XCTAssertEqual(($0 as? LibraryError)?.code, .invalidPath, path) }
            }
        }
        for case let test as [String: Any] in c["cases"] as! [Any] {
            let name = test["name"] as! String
            let requires = (test["requires"] as? [String]) ?? []
            if requires.contains("addConflictVersion") { continue } // only iCloud makes conflict versions
            let root = freshRoot()
            let plain = FolderFS(root: root)
            let enc = try EncryptedFS(inner: plain, masterKey: LibraryCrypto.randomBytes(32))
            let fs: LibraryFS = encrypted ? enc : plain
            var saved: [String: String] = [:]
            func etag(_ v: Any?) -> String? {
                guard let s = v as? String else { return nil }
                return s.hasPrefix("$") ? saved[String(s.dropFirst())] ?? "" : s
            }
            func bytes(_ s: [String: Any]) -> Data { (s["text"] as? String).map { Data($0.utf8) } ?? hex((s["hex"] as? String) ?? "") }
            func physicalURL(_ p: String) throws -> URL { root.appendingPathComponent(encrypted ? try enc.physical(p) : p) }
            for case let s as [String: Any] in test["steps"] as! [Any] {
                let op = s["op"] as! String
                let path = s["path"] as? String ?? ""
                let where_ = "\(name) / \(op) \(path) (\(encrypted ? "encrypted" : "plain"))"
                switch op {
                case "write":
                    let ifMatch: IfMatch = !s.keys.contains("ifMatch") ? .any : s["ifMatch"] is NSNull ? .create : .match(etag(s["ifMatch"])!)
                    let r = try fs.write(path, bytes(s), ifMatch)
                    switch r {
                    case .written(let e):
                        XCTAssertEqual(s["expect"] as? String, "written", where_)
                        if let n = s["save"] as? String { saved[n] = e }
                        if let not = s["etagNot"] { XCTAssertNotEqual(e, etag(not), where_) }
                    case .mismatch(let e):
                        XCTAssertEqual(s["expect"] as? String, "mismatch", where_)
                        if let want = s["etagIs"] { XCTAssertEqual(e, etag(want), where_) }
                        if let not = s["etagNot"] { XCTAssertNotEqual(e, etag(not), where_) }
                    }
                case "read":
                    switch s["expect"] as! String {
                    case "not_found":
                        XCTAssertThrowsError(try fs.read(path), where_) { XCTAssertEqual(($0 as? LibraryError)?.code, .notFound, where_) }
                    case "notDownloaded":
                        guard case .notDownloaded = try fs.read(path) else { XCTFail(where_); break }
                    default:
                        guard case .bytes(let d, let e) = try fs.read(path) else { XCTFail(where_); break }
                        XCTAssertEqual(d, bytes(s), where_)
                        if let want = s["etagIs"] { XCTAssertEqual(e, etag(want), where_) }
                        if let n = s["save"] as? String { saved[n] = e }
                    }
                case "remove":
                    if s["expect"] as? String == "mismatch" {
                        XCTAssertThrowsError(try fs.remove(path, ifMatch: etag(s["ifMatch"])), where_) { XCTAssertEqual(($0 as? LibraryError)?.code, .mismatch, where_) }
                    } else {
                        try fs.remove(path, ifMatch: etag(s["ifMatch"]))
                    }
                case "list":
                    let entries = try fs.list(s["dir"] as? String ?? "")
                    XCTAssertEqual(Set(entries.map(\.path)), Set(s["paths"] as! [String]), where_)
                    let by = Dictionary(uniqueKeysWithValues: entries.map { ($0.path, $0) })
                    for (p, want) in (s["etags"] as? [String: String]) ?? [:] { XCTAssertEqual(by[p]?.etag, etag(want), where_) }
                    for (p, want) in (s["downloaded"] as? [String: Bool]) ?? [:] { XCTAssertEqual(by[p]?.downloaded, want, where_) }
                    for (p, want) in (s["hasConflicts"] as? [String: Bool]) ?? [:] { XCTAssertEqual(by[p]?.hasConflicts, want, where_) }
                case "conflictVersions":
                    XCTAssertEqual(try fs.conflictVersions(path).map { String(data: $0.bytes, encoding: .utf8)! }.sorted(), ((s["texts"] as? [String]) ?? []).sorted(), where_)
                case "resolveConflicts":
                    try fs.resolveConflicts(path, ids: (s["ids"] as? [String]) ?? [])
                case "hook.evict":
                    // What iCloud does to a file it keeps only in the cloud: `.name.icloud` in its place.
                    let url = try physicalURL(path)
                    try FileManager.default.removeItem(at: url)
                    FileManager.default.createFile(atPath: url.deletingLastPathComponent().appendingPathComponent(LibraryPaths.placeholderName(url.lastPathComponent)).path, contents: Data("placeholder".utf8))
                case "hook.put":
                    // Another device's write arriving through the provider.
                    let data = encrypted ? try enc.seal(try enc.physical(path), bytes(s)) : bytes(s)
                    try data.write(to: try physicalURL(path), options: .atomic)
                default:
                    XCTFail("unknown step \(op)")
                }
            }
            try? FileManager.default.removeItem(at: root)
        }
    }

    func testTheFolderFollowsLocalStoresContract() throws { try runContract(encrypted: false) }
    func testTheEncryptedFolderFollowsLocalStoresContract() throws { try runContract(encrypted: true) }

    func testNoteNamesParseLikeLocalStore() {
        XCTAssertEqual(LibraryPaths.parseNoteFileName("01J9ZDOC000000000000000001.fnote")?.id, "01J9ZDOC000000000000000001")
        XCTAssertEqual(LibraryPaths.parseNoteFileName("01J9ZDOC000000000000000001 2.fnote")?.copy?.provider, .icloud)
        XCTAssertEqual(LibraryPaths.parseNoteFileName("01J9ZDOC000000000000000001 (Sam's conflicted copy).fnote")?.copy?.provider, .dropbox)
        XCTAssertEqual(LibraryPaths.parseNoteFileName("01J9ZDOC000000000000000001(1).fnote")?.copy?.provider, .numbered)
        XCTAssertEqual(LibraryPaths.parseNoteFileName(".01J9ZDOC000000000000000001.fnote.icloud")?.placeholder, true)
        XCTAssertNil(LibraryPaths.parseNoteFileName("notes.txt"))
    }

    func testTheJournalKeepsWholeRecordsAndCutsATornTail() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("journal-\(UUID().uuidString).bin")
        let j = LibraryJournal(url: url)
        try j.append(Data("one".utf8))
        try j.append(Data("two".utf8))
        XCTAssertEqual(j.records().map { String(data: $0, encoding: .utf8)! }, ["one", "two"])
        // The app stopped mid-append: half a frame at the end.
        let h = try FileHandle(forWritingTo: url)
        try h.seekToEnd()
        try h.write(contentsOf: Data([0, 0, 0, 9, 1, 2]))
        try h.close()
        XCTAssertEqual(j.records().count, 2)
        let again = LibraryJournal(url: url)
        try again.append(Data("three".utf8))
        XCTAssertEqual(again.records().map { String(data: $0, encoding: .utf8)! }, ["one", "two", "three"])
        try again.truncate(2)
        XCTAssertEqual(again.records().map { String(data: $0, encoding: .utf8)! }, ["three"])
        // The same bytes as the Mac's journal: "FLVJ" 0x01, then length, CRC-32, record.
        XCTAssertEqual(Array(try Data(contentsOf: url).prefix(5)), [0x46, 0x4c, 0x56, 0x4a, 0x01])
        XCTAssertEqual(LibraryJournal.crc32(Data("123456789".utf8)), 0xcbf4_3926)
        again.destroy()
    }

    func testRangesForAttachments() {
        XCTAssertEqual(LibraryFileHandler.parse("bytes=2-5", size: 10).map { [$0.0, $0.1] }, [2, 5])
        XCTAssertEqual(LibraryFileHandler.parse("bytes=4-", size: 10).map { [$0.0, $0.1] }, [4, 9])
        XCTAssertEqual(LibraryFileHandler.parse("bytes=-3", size: 10).map { [$0.0, $0.1] }, [7, 9])
        XCTAssertNil(LibraryFileHandler.parse("bytes=12-", size: 10))
        XCTAssertNil(LibraryFileHandler.parse("bytes=0-1,4-5", size: 10))
    }

    func testSignInOnlyReachesTheServicesAuthPaths() {
        let auth = ShellAuth()
        auth.service = URL(string: "https://app.folevi.com")!
        XCTAssertEqual(auth.authURL("/api/auth/get-session")?.absoluteString, "https://app.folevi.com/api/auth/get-session")
        XCTAssertNil(auth.authURL("/api/v1/notes"))
        XCTAssertNil(auth.authURL("/api/auth/../v1/notes"))
        XCTAssertNil(auth.authURL("/api/auth/%2e%2e/v1"))
        XCTAssertNil(auth.authURL("/api/auth/x%2fy"))
        XCTAssertNil(auth.authURL("//evil.example/api/auth/x"))
        XCTAssertEqual(ShellAuth.scrub("a TOKEN1234567890abcdef.sig b", ["TOKEN1234567890abcdef.sig"]), "a  b")
        XCTAssertTrue(ShellAuth.pkcePair().verifier.count == 43)
    }

    func testFoliAiChecksRequestsAndOnlyCallsTheProviders() throws {
        guard case .success(let req) = ShellAI.check(["provider": "anthropic", "messages": [["role": "user", "content": "Hi"]], "maxTokens": 100]) else { return XCTFail() }
        let r = try ShellAI.buildRequest("anthropic", req, key: "sk-ant-test")
        XCTAssertEqual(r.url?.host, "api.anthropic.com")
        XCTAssertEqual(r.value(forHTTPHeaderField: "x-api-key"), "sk-ant-test")
        if case .success = ShellAI.check(["provider": "folevi", "messages": [["role": "user", "content": "Hi"]]]) { XCTFail("unknown provider") }
        if case .success = ShellAI.check(["provider": "openai", "messages": [["role": "assistant", "content": "Hi"]]]) { XCTFail("last turn is the person's") }
        let g = try ShellAI.buildRequest("google", req, key: "AIzaTest")
        XCTAssertEqual(g.url?.host, "generativelanguage.googleapis.com")
        XCTAssertFalse(g.url!.absoluteString.contains("AIzaTest"), "the key goes in a header")
        XCTAssertEqual(ShellAI.scrub("bad key sk-abcdefghijk", key: nil), "bad key [key]")
        var state = ShellAI.StreamState()
        XCTAssertEqual(ShellAI.apply("anthropic", event: "content_block_delta", data: #"{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hel"}}"#, &state), "Hel")
        _ = ShellAI.apply("anthropic", event: "message_stop", data: #"{"type":"message_stop"}"#, &state)
        XCTAssertEqual(state.stop, "end")
        XCTAssertFalse(ShellHTTP.allowed(URL(string: "https://app.folevi.com/x")!))
        XCTAssertFalse(ShellHTTP.allowed(URL(string: "http://example.com/cal.ics")!))
        XCTAssertFalse(ShellHTTP.allowed(URL(string: "https://127.0.0.1/cal.ics")!))
        XCTAssertFalse(ShellHTTP.allowed(URL(string: "https://192.168.1.4/cal.ics")!))
    }

    func testDropboxAndDriveOnlyReachTheirOwnHostsAndKeepACopyHere() async throws {
        let cloud = ShellCloud()
        cloud.dropboxAppKey = "abcd1234efgh"
        cloud.googleClientId = "123-abc.apps.googleusercontent.com"
        XCTAssertEqual(cloud.available, ["dropbox", "googleDrive"])
        XCTAssertEqual(cloud.googleRedirectScheme, "com.googleusercontent.apps.123-abc")
        cloud.dropboxAppKey = "NOT A KEY"
        XCTAssertEqual(cloud.available, ["googleDrive"])
        for (p, url) in [("dropbox", "https://evil.example/2/files"), ("dropbox", "http://api.dropboxapi.com/2/x"), ("googleDrive", "https://api.dropboxapi.com/2/x"), ("dropbox", "https://api.dropboxapi.com:8443/2/x")] {
            do {
                _ = try await cloud.request(p, url: url, method: "GET", headers: [:], body: nil, authorized: true)
                XCTFail(url)
            } catch let e as CloudError {
                XCTAssertTrue(["invalid", "reconnect"].contains(e.code), url)
            }
        }
        // Not connected: an authorized request is refused before anything is sent.
        do {
            _ = try await cloud.request("googleDrive", url: "https://www.googleapis.com/drive/v3/files", method: "GET", headers: [:], body: nil, authorized: true)
            XCTFail("not connected")
        } catch let e as CloudError { XCTAssertEqual(e.code, "reconnect") }
        // The copy on this device keeps each file's provider etag.
        try ShellCloud.mirrorWrite("dropbox", "notes/01J9ZDOC000000000000000001.fnote", Data("x".utf8), etag: "rev1")
        XCTAssertEqual(try ShellCloud.mirrorRead("dropbox", "notes/01J9ZDOC000000000000000001.fnote")?.etag, "rev1")
        XCTAssertTrue(try ShellCloud.mirrorPaths("dropbox").contains("notes/01J9ZDOC000000000000000001.fnote"))
        XCTAssertThrowsError(try ShellCloud.mirrorWrite("dropbox", "../escape", Data(), etag: ""))
        try ShellCloud.mirrorDelete("dropbox", "notes/01J9ZDOC000000000000000001.fnote")
        XCTAssertNil(try ShellCloud.mirrorRead("dropbox", "notes/01J9ZDOC000000000000000001.fnote"))
    }
}
