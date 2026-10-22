// The library's files on the Mac, through the shared iOS services: packages/local-store's fixtures every
// implementation follows (fs-contract.json, plain and encrypted; crypto-vectors.json), the journal's format,
// and attachments' ranges, on macOS (the iOS app runs the same in its ShellTests.swift).
import CryptoKit
import XCTest
@testable import Folevi

let fixtures = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../../packages/local-store/fixtures").standardizedFileURL

func fixture(_ name: String) throws -> [String: Any] {
    let data = try Data(contentsOf: fixtures.appendingPathComponent(name))
    return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
}

func hex(_ s: String) -> Data {
    var d = Data()
    var i = s.startIndex
    while i < s.endIndex {
        let j = s.index(i, offsetBy: 2)
        d.append(UInt8(s[i..<j], radix: 16)!)
        i = j
    }
    return d
}

func hexString(_ d: Data) -> String { d.map { String(format: "%02x", $0) }.joined() }

final class LibraryTests: XCTestCase {
    private func freshRoot() -> URL {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("mac-lib-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return root
    }

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
        }
        let master = hex("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f")
        for r in v["rejects"] as! [[String: Any]] {
            XCTAssertThrowsError(try LibraryCrypto.openFile(master, pathId: r["pathId"] as! String, hex(r["envelopeHex"] as! String)), r["name"] as! String)
        }
    }

    /// local-store's LocalFs contract on a folder of this Mac, plain or encrypted.
    private func runContract(encrypted: Bool) throws {
        let c = try fixture("fs-contract.json")
        for case let path as String in c["invalidPaths"] as! [Any] {
            let fs = FolderFS(root: freshRoot())
            for attempt in [{ _ = try fs.read(path) }, { _ = try fs.write(path, Data(), .any) }, { try fs.remove(path, ifMatch: nil) }, { _ = try fs.list(path.isEmpty ? "x/../" : path) }] {
                XCTAssertThrowsError(try attempt()) { XCTAssertEqual(($0 as? LibraryError)?.code, .invalidPath, path) }
            }
        }
        var ran = 0
        for case let test as [String: Any] in c["cases"] as! [Any] {
            let name = test["name"] as! String
            let requires = (test["requires"] as? [String]) ?? []
            if requires.contains("addConflictVersion") { continue } // only iCloud makes conflict versions
            ran += 1
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
                let at = "\(name) / \(op) \(path) (\(encrypted ? "encrypted" : "plain"))"
                switch op {
                case "write":
                    let ifMatch: IfMatch = !s.keys.contains("ifMatch") ? .any : s["ifMatch"] is NSNull ? .create : .match(etag(s["ifMatch"])!)
                    switch try fs.write(path, bytes(s), ifMatch) {
                    case .written(let e):
                        XCTAssertEqual(s["expect"] as? String, "written", at)
                        if let n = s["save"] as? String { saved[n] = e }
                        if let not = s["etagNot"] { XCTAssertNotEqual(e, etag(not), at) }
                    case .mismatch(let e):
                        XCTAssertEqual(s["expect"] as? String, "mismatch", at)
                        if let want = s["etagIs"] { XCTAssertEqual(e, etag(want), at) }
                        if let not = s["etagNot"] { XCTAssertNotEqual(e, etag(not), at) }
                    }
                case "read":
                    switch s["expect"] as! String {
                    case "not_found":
                        XCTAssertThrowsError(try fs.read(path), at) { XCTAssertEqual(($0 as? LibraryError)?.code, .notFound, at) }
                    case "notDownloaded":
                        guard case .notDownloaded = try fs.read(path) else { XCTFail(at); break }
                    default:
                        guard case .bytes(let d, let e) = try fs.read(path) else { XCTFail(at); break }
                        XCTAssertEqual(d, bytes(s), at)
                        if let want = s["etagIs"] { XCTAssertEqual(e, etag(want), at) }
                        if let n = s["save"] as? String { saved[n] = e }
                    }
                case "remove":
                    if s["expect"] as? String == "mismatch" {
                        XCTAssertThrowsError(try fs.remove(path, ifMatch: etag(s["ifMatch"])), at) { XCTAssertEqual(($0 as? LibraryError)?.code, .mismatch, at) }
                    } else {
                        try fs.remove(path, ifMatch: etag(s["ifMatch"]))
                    }
                case "list":
                    let entries = try fs.list(s["dir"] as? String ?? "")
                    XCTAssertEqual(Set(entries.map(\.path)), Set(s["paths"] as! [String]), at)
                    let by = Dictionary(uniqueKeysWithValues: entries.map { ($0.path, $0) })
                    for (p, want) in (s["etags"] as? [String: String]) ?? [:] { XCTAssertEqual(by[p]?.etag, etag(want), at) }
                    for (p, want) in (s["downloaded"] as? [String: Bool]) ?? [:] { XCTAssertEqual(by[p]?.downloaded, want, at) }
                    for (p, want) in (s["hasConflicts"] as? [String: Bool]) ?? [:] { XCTAssertEqual(by[p]?.hasConflicts, want, at) }
                case "conflictVersions":
                    XCTAssertEqual(try fs.conflictVersions(path).map { String(data: $0.bytes, encoding: .utf8)! }.sorted(), ((s["texts"] as? [String]) ?? []).sorted(), at)
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
        XCTAssertGreaterThan(ran, 5, "the contract's cases ran")
    }

    func testTheFolderFollowsLocalStoresContract() throws { try runContract(encrypted: false) }
    func testTheEncryptedFolderFollowsLocalStoresContract() throws { try runContract(encrypted: true) }

    func testTheJournalIsTheMacsFormat() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("mac-journal-\(UUID().uuidString).bin")
        let j = LibraryJournal(url: url)
        try j.append(Data("one".utf8))
        try j.append(Data("two".utf8))
        let h = try FileHandle(forWritingTo: url)
        try h.seekToEnd()
        try h.write(contentsOf: Data([0, 0, 0, 9, 1, 2]))
        try h.close()
        XCTAssertEqual(j.records().map { String(data: $0, encoding: .utf8)! }, ["one", "two"], "a torn tail is cut")
        try j.truncate(1)
        XCTAssertEqual(j.records().map { String(data: $0, encoding: .utf8)! }, ["two"])
        // Electron's journal (apps/desktop/src/library/journal.ts): "FLVJ" 0x01, then length, CRC-32, record.
        XCTAssertEqual(Array(try Data(contentsOf: url).prefix(5)), [0x46, 0x4c, 0x56, 0x4a, 0x01])
        j.destroy()
    }

    func testLibraryPlacesReadAsElectronsDo() {
        let home = FileManager.default.homeDirectoryForCurrentUser
        XCTAssertEqual(Platform.libraryPlace(home.appendingPathComponent("Documents/Folevi Library")), "~/Documents/Folevi Library")
        XCTAssertEqual(Platform.libraryPlace(home.appendingPathComponent("Library/Mobile Documents/iCloud~com~folevi/Documents")), "iCloud Drive › Folevi")
        XCTAssertEqual(Platform.libraryPlace(home.appendingPathComponent("Library/Mobile Documents/com~apple~CloudDocs/Notes")), "iCloud Drive › Notes")
        XCTAssertEqual(Platform.libraryPlace(home.appendingPathComponent("Library/CloudStorage/Dropbox/Notes")), "Dropbox › Notes")
        XCTAssertEqual(Platform.libraryPlace(home.appendingPathComponent("Library/CloudStorage/GoogleDrive-a@b.c/My Drive/Notes")), "Google Drive › My Drive › Notes")
        XCTAssertEqual(Platform.libraryPlace(URL(fileURLWithPath: "/Volumes/USB/Notes")), "/Volumes/USB/Notes")
        XCTAssertEqual(LibraryService.describe(home.appendingPathComponent("Documents/Notes")), "~/Documents/Notes")
    }
}
