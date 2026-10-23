// The encrypted library's FLV1 envelope on iPhone and iPad (docs/LOCAL_MODE_PLAN.md §3.9, §3.10), with CryptoKit
// and CommonCrypto, in native code only: the page never holds a key. packages/local-store/src/crypto/envelope.ts
// is the reference and the Electron Mac app's library/crypto.ts the Mac's copy; FoleviTests checks these bytes against
// packages/local-store/fixtures/crypto-vectors.json.
//
//   passphrase --PBKDF2-SHA256--> wrapping key; AES-256-GCM(wrapping key, AAD "folevi-library-key/v1") seals the master key
//   master --HKDF-SHA256(salt "folevi/v1", info "file:" + path)--> per-file key; info "names" --> HMAC key; "key-check"
//   single:  "FLV1" 0x01 nonce(12) | ciphertext | tag, AAD = the 17 header bytes
//   stream:  "FLV1" 0x02 chunkSize(u32 BE) noncePrefix(8) | chunks: nonce prefix‖u32 BE(i), AAD header‖lastFlag
import CommonCrypto
import CryptoKit
import Foundation

enum LibraryCrypto {
    static let modeSingle: UInt8 = 0x01
    static let modeStream: UInt8 = 0x02
    static let streamChunk = 64 * 1024
    static let tagBytes = 16
    static let headerBytes = 17
    static let defaultIterations = 600_000
    static let magic: [UInt8] = Array("FLV1".utf8)
    private static let hkdfSalt = Data("folevi/v1".utf8)
    private static let wrapAAD = Data("folevi-library-key/v1".utf8)
    private static let crockford = Array("0123456789abcdefghjkmnpqrstvwxyz")

    struct EnvelopeError: Error, CustomStringConvertible {
        let description: String
        init(_ d: String) { description = d }
    }

    /// folevi-library.json's `encryption`.
    struct Header: Codable, Equatable {
        struct Kdf: Codable, Equatable {
            var name: String
            var iterations: Int
            var salt: String
        }
        var alg: String
        var kdf: Kdf
        var wrappedKey: String
        var keyCheck: String
    }

    static func randomBytes(_ n: Int) -> Data {
        var d = Data(count: n)
        let ok = d.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, n, $0.baseAddress!) }
        precondition(ok == errSecSuccess, "No random bytes.")
        return d
    }

    static func hkdf(_ master: Data, _ info: String, _ length: Int) throws -> Data {
        guard master.count == 32 else { throw EnvelopeError("The master key must be 32 bytes.") }
        let key = HKDF<SHA256>.deriveKey(inputKeyMaterial: SymmetricKey(data: master), salt: hkdfSalt, info: Data(info.utf8), outputByteCount: length)
        return key.withUnsafeBytes { Data($0) }
    }

    static func fileKey(_ master: Data, _ pathId: String) throws -> Data { try hkdf(master, "file:\(pathId)", 32) }

    static func gcmSeal(_ key: Data, _ nonce: Data, _ plaintext: Data, _ aad: Data) throws -> Data {
        let box = try AES.GCM.seal(plaintext, using: SymmetricKey(data: key), nonce: AES.GCM.Nonce(data: nonce), authenticating: aad)
        return box.ciphertext + box.tag
    }

    static func gcmOpen(_ key: Data, _ nonce: Data, _ sealed: Data, _ aad: Data) throws -> Data {
        guard sealed.count >= tagBytes else { throw EnvelopeError("The file is incomplete.") }
        do {
            let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: nonce), ciphertext: sealed.prefix(sealed.count - tagBytes), tag: sealed.suffix(tagBytes))
            return try AES.GCM.open(box, using: SymmetricKey(data: key), authenticating: aad)
        } catch {
            throw EnvelopeError("The file failed its integrity check (damaged, incomplete, or a different key).")
        }
    }

    // MARK: passphrase and master key

    static func deriveWrappingKey(_ passphrase: String, salt: Data, iterations: Int) throws -> Data {
        guard iterations >= 1 else { throw EnvelopeError("Invalid iteration count.") }
        let pass = Array(passphrase.precomposedStringWithCanonicalMapping.utf8)
        let length = pass.count
        // A pointer even for an empty passphrase (its length says 0).
        let buffer: [UInt8] = pass.isEmpty ? [0] : pass
        let saltBytes: [UInt8] = salt.isEmpty ? [0] : Array(salt)
        var out = [UInt8](repeating: 0, count: 32)
        let status = buffer.withUnsafeBufferPointer { p in
            p.baseAddress!.withMemoryRebound(to: Int8.self, capacity: buffer.count) { pp in
                CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2), pp, length, saltBytes, salt.count, CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), UInt32(iterations), &out, out.count)
            }
        }
        guard status == kCCSuccess else { throw EnvelopeError("The passphrase couldn't be stretched.") }
        return Data(out)
    }

    static func keyCheck(_ master: Data) throws -> String { try hkdf(master, "key-check", 32).prefix(16).base64EncodedString() }

    static func wrap(_ master: Data, passphrase: String, iterations: Int = defaultIterations, salt: Data? = nil, nonce: Data? = nil) throws -> Header {
        let salt = salt ?? randomBytes(16)
        let nonce = nonce ?? randomBytes(12)
        let wrapping = try deriveWrappingKey(passphrase, salt: salt, iterations: iterations)
        let sealed = try gcmSeal(wrapping, nonce, master, wrapAAD)
        return Header(alg: "A256GCM", kdf: .init(name: "PBKDF2-SHA256", iterations: iterations, salt: salt.base64EncodedString()), wrappedKey: (nonce + sealed).base64EncodedString(), keyCheck: try keyCheck(master))
    }

    static func create(passphrase: String, iterations: Int = defaultIterations) throws -> (header: Header, masterKey: Data) {
        let master = randomBytes(32)
        return (try wrap(master, passphrase: passphrase, iterations: iterations), master)
    }

    /// The master key, or nil when the passphrase is wrong.
    static func unlock(_ header: Header, passphrase: String) throws -> Data? {
        guard header.alg == "A256GCM", header.kdf.name == "PBKDF2-SHA256" else { throw EnvelopeError("Unsupported library encryption.") }
        guard let wrapped = Data(base64Encoded: header.wrappedKey), wrapped.count == 12 + 32 + tagBytes, let salt = Data(base64Encoded: header.kdf.salt) else { throw EnvelopeError("The wrapped key is damaged.") }
        let wrapping = try deriveWrappingKey(passphrase, salt: salt, iterations: header.kdf.iterations)
        guard let master = try? gcmOpen(wrapping, wrapped.prefix(12), wrapped.dropFirst(12), wrapAAD) else { return nil }
        return try keyCheck(master) == header.keyCheck ? master : nil
    }

    static func keyMatches(_ header: Header, _ master: Data) -> Bool {
        master.count == 32 && (try? keyCheck(master)) == header.keyCheck
    }

    // MARK: names

    /// HMAC-SHA256(names key, "<kind>:<id>"), first 130 bits as 26 lowercase Crockford characters.
    static func hmacName(_ master: Data, kind: String, id: String) throws -> String {
        let mac = Array(HMAC<SHA256>.authenticationCode(for: Data("\(kind):\(id)".utf8), using: SymmetricKey(data: try hkdf(master, "names", 32))))
        var out = ""
        var acc = 0
        var bits = 0
        var i = 0
        while out.count < 26 {
            if bits < 5 {
                acc = (acc << 8) | Int(mac[i])
                i += 1
                bits += 8
            }
            bits -= 5
            out.append(crockford[(acc >> bits) & 31])
            acc &= (1 << bits) - 1
        }
        return out
    }

    // MARK: one-shot envelope

    static func isEnvelope(_ bytes: Data) -> Bool {
        bytes.count >= 5 && Array(bytes.prefix(4)) == magic
    }

    static func sealFile(_ master: Data, pathId: String, _ plaintext: Data, nonce: Data? = nil) throws -> Data {
        let nonce = nonce ?? randomBytes(12)
        guard nonce.count == 12 else { throw EnvelopeError("The nonce must be 12 bytes.") }
        let h = Data(magic) + Data([modeSingle]) + nonce
        return h + (try gcmSeal(try fileKey(master, pathId), nonce, plaintext, h))
    }

    static func openFile(_ master: Data, pathId: String, _ envelope: Data) throws -> Data {
        let e = Data(envelope)
        guard isEnvelope(e) else { throw EnvelopeError("Not an encrypted Folevi file.") }
        if e[4] == modeStream { return try openStream(master, pathId: pathId, e) }
        guard e[4] == modeSingle else { throw EnvelopeError("Unknown envelope mode.") }
        guard e.count >= headerBytes + tagBytes else { throw EnvelopeError("The file is incomplete.") }
        let h = e.prefix(headerBytes)
        return try gcmOpen(try fileKey(master, pathId), h.dropFirst(5), e.dropFirst(headerBytes), h)
    }

    // MARK: STREAM envelope

    static func chunkNonce(_ prefix: Data, _ index: Int) -> Data {
        var n = Data(prefix)
        var be = UInt32(index).bigEndian
        n.append(Data(bytes: &be, count: 4))
        return n
    }

    static func chunkAAD(_ header: Data, last: Bool) -> Data { Data(header) + Data([last ? 1 : 0]) }

    static func sealStream(_ master: Data, pathId: String, _ plaintext: Data, noncePrefix: Data? = nil, chunkSize: Int = streamChunk) throws -> Data {
        let prefix = noncePrefix ?? randomBytes(8)
        guard prefix.count == 8 else { throw EnvelopeError("The nonce prefix must be 8 bytes.") }
        let count = max(1, (plaintext.count + chunkSize - 1) / chunkSize)
        var size = UInt32(chunkSize).bigEndian
        let h = Data(magic) + Data([modeStream]) + Data(bytes: &size, count: 4) + prefix
        let key = try fileKey(master, pathId)
        var out = h
        let p = Data(plaintext)
        for i in 0..<count {
            let chunk = p.subdata(in: (i * chunkSize)..<min(p.count, (i + 1) * chunkSize))
            out += try gcmSeal(key, chunkNonce(prefix, i), chunk, chunkAAD(h, last: i == count - 1))
        }
        return out
    }

    struct StreamLayout {
        let header: Data
        let prefix: Data
        let chunkSize: Int
        let count: Int
        let plainLength: Int
        let envelopeLength: Int
    }

    static func streamLayout(_ header: Data, envelopeLength: Int) throws -> StreamLayout {
        let h = Data(header.prefix(headerBytes))
        guard h.count == headerBytes, isEnvelope(h), h[4] == modeStream else { throw EnvelopeError("Not an encrypted Folevi stream.") }
        guard envelopeLength >= headerBytes + tagBytes else { throw EnvelopeError("The file is incomplete.") }
        let chunkSize = Int(UInt32(h[5]) << 24 | UInt32(h[6]) << 16 | UInt32(h[7]) << 8 | UInt32(h[8]))
        guard chunkSize >= 1 else { throw EnvelopeError("Invalid chunk size.") }
        let body = envelopeLength - headerBytes
        let full = chunkSize + tagBytes
        let count = max(1, (body + full - 1) / full)
        let lastLength = body - (count - 1) * full
        guard lastLength >= tagBytes else { throw EnvelopeError("The file is incomplete.") }
        return StreamLayout(header: h, prefix: h.subdata(in: 9..<17), chunkSize: chunkSize, count: count, plainLength: (count - 1) * chunkSize + lastLength - tagBytes, envelopeLength: envelopeLength)
    }

    static func openStream(_ master: Data, pathId: String, _ envelope: Data) throws -> Data {
        let e = Data(envelope)
        let l = try streamLayout(e, envelopeLength: e.count)
        let key = try fileKey(master, pathId)
        let full = l.chunkSize + tagBytes
        var out = Data()
        for i in 0..<l.count {
            let start = headerBytes + i * full
            out += try gcmOpen(key, chunkNonce(l.prefix, i), e.subdata(in: start..<min(e.count, start + full)), chunkAAD(l.header, last: i == l.count - 1))
        }
        return out
    }

    /// A stream envelope opened for range reads: chunks are read, checked and decrypted only as needed.
    final class StreamReader {
        let layout: StreamLayout
        private let key: Data
        private let readAt: (Int, Int) throws -> Data

        init(master: Data, pathId: String, envelopeLength: Int, readAt: @escaping (Int, Int) throws -> Data) throws {
            self.layout = try LibraryCrypto.streamLayout(try readAt(0, LibraryCrypto.headerBytes), envelopeLength: envelopeLength)
            self.key = try LibraryCrypto.fileKey(master, pathId)
            self.readAt = readAt
            // The final chunk must carry the last flag, so a cut-short file never reads as a shorter valid one.
            _ = try chunk(layout.count - 1)
        }

        func chunk(_ i: Int) throws -> Data {
            guard i >= 0, i < layout.count else { throw EnvelopeError("Range out of bounds.") }
            let full = layout.chunkSize + LibraryCrypto.tagBytes
            let start = LibraryCrypto.headerBytes + i * full
            let length = min(full, layout.envelopeLength - start)
            let sealed = try readAt(start, length)
            guard sealed.count == length else { throw EnvelopeError("The file is incomplete.") }
            return try LibraryCrypto.gcmOpen(key, LibraryCrypto.chunkNonce(layout.prefix, i), sealed, LibraryCrypto.chunkAAD(layout.header, last: i == layout.count - 1))
        }

        /// Up to `length` plaintext bytes from `position` (fewer at the end), as a plain file reads: the shape
        /// `LibraryService.openAttachment`'s readers share, encrypted or not.
        func read(position: Int, length: Int) throws -> Data {
            guard position >= 0, length >= 0, position <= layout.plainLength else { throw EnvelopeError("Range out of bounds.") }
            return try range(position, min(layout.plainLength, position + length))
        }

        /// Plaintext bytes [start, end).
        func range(_ start: Int, _ end: Int) throws -> Data {
            guard start >= 0, end >= start, end <= layout.plainLength else { throw EnvelopeError("Range out of bounds.") }
            if end == start { return Data() }
            let first = start / layout.chunkSize
            let last = (end - 1) / layout.chunkSize
            var joined = Data()
            for i in first...last { joined += try chunk(i) }
            let offset = start - first * layout.chunkSize
            return joined.subdata(in: offset..<(offset + end - start))
        }
    }
}
