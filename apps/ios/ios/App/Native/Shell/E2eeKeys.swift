// End-to-end encryption on iPhone and iPad (docs/E2EE_DESIGN.md §4.8, §6.2; the iOS twin of the Mac's
// apps/desktop/src/e2ee.ts): this device's keys, as `foleviShell.e2ee`.
//
// The app holds an X25519 key pair (the account master key is sealed to it as an FLS1 box) and an Ed25519 key
// pair (it signs as this device). Their private halves never leave native code: they're kept in the Keychain
// (this device only, readable after the first unlock, never in iCloud); the device id and public halves too.
// The page can ask for the public keys, open a box sealed to this device, sign a statement, or forget the keys.
// The one secret that crosses is what `open` unseals (the account master key), which the page imports as
// non-extractable keys and zeroes.
//
// With "Ask for Face ID to unlock encrypted notes" on (Settings > This device), `open` asks for Face ID (or
// Touch ID, or the passcode) first. Nothing here logs a key, a box or what a box holds.
import CryptoKit
import Foundation
import LocalAuthentication

struct E2eeError: Error {
    /// "unavailable" | "invalid_argument" | "cancelled" | "failed"
    let code: String
    let message: String
}

final class E2eeKeys {
    static let shared = E2eeKeys()
    static let contextPrefix = "folevi/e2ee/v1/"
    private static let service = "com.folevi.e2ee"
    private static let sealedMagic = Array("FLS1".utf8)
    private static let sealedVersion: UInt8 = 0x01
    private static let sealedHeader = 49
    private static let tagBytes = 16
    private static let maxBox = 64 * 1024
    private static let maxContext = 512
    private static let maxStatement = 4096
    private static let statementKinds: Set<String> = ["device", "space-grant", "note-grant", "account-key"]
    /// After Face ID says yes, a second unlock right after doesn't ask again.
    private static let grace: TimeInterval = 30
    private var confirmedAt: Date?
    private let lock = NSLock()

    private struct Stored: Codable {
        var version: Int
        var deviceId: String
        var x: String
        var ed: String
    }

    private static func b64u(_ d: Data) -> String {
        d.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }

    /// Each account's own keys (several places, docs/MULTI_ACCOUNT_PLAN.md §4): the open account's Keychain item,
    /// `device.<user id>`; the library and older builds use `device`.
    private static var item: String { ShellPlaces.currentUserId.map { "device.\($0)" } ?? "device" }

    /// The keys this device made before it held several accounts belonged to its one account: they become its.
    static func adoptLegacy(userId: String) {
        guard Keychain.get(service, "device.\(userId)") == nil, let legacy = Keychain.get(service, "device") else { return }
        if Keychain.set(service, "device.\(userId)", legacy) { Keychain.delete(service, "device") }
    }

    /// Forgets an account's keys (signing out of it).
    static func forget(userId: String) {
        Keychain.delete(service, "device.\(userId)")
    }

    /// A ULID (time, then 80 random bits): the device id is `ios-<ulid>`, like the Mac's `mac-<ulid>`.
    static func ulid(_ now: Date = Date()) -> String { LibraryService.newLibraryId(now) }

    private func load() -> (x: Curve25519.KeyAgreement.PrivateKey, ed: Curve25519.Signing.PrivateKey, id: String)? {
        guard let data = Keychain.get(Self.service, Self.item), let s = try? JSONDecoder().decode(Stored.self, from: data), s.version == 1,
              let xRaw = Data(base64Encoded: s.x), let edRaw = Data(base64Encoded: s.ed),
              let x = try? Curve25519.KeyAgreement.PrivateKey(rawRepresentation: xRaw), let ed = try? Curve25519.Signing.PrivateKey(rawRepresentation: edRaw) else { return nil }
        return (x, ed, s.deviceId)
    }

    private func loadOrCreate() throws -> (x: Curve25519.KeyAgreement.PrivateKey, ed: Curve25519.Signing.PrivateKey, id: String) {
        if let k = load() { return k }
        let x = Curve25519.KeyAgreement.PrivateKey()
        let ed = Curve25519.Signing.PrivateKey()
        let s = Stored(version: 1, deviceId: "ios-\(Self.ulid())", x: x.rawRepresentation.base64EncodedString(), ed: ed.rawRepresentation.base64EncodedString())
        guard let data = try? JSONEncoder().encode(s), Keychain.set(Self.service, Self.item, data) else { throw E2eeError(code: "unavailable", message: "This device can't keep encryption keys safely right now.") }
        return (x, ed, s.deviceId)
    }

    /// This device's id and public keys (made and kept on the first call).
    func deviceKeys() throws -> (deviceId: String, x25519Pub: Data, ed25519Pub: Data) {
        let k = try loadOrCreate()
        return (k.id, k.x.publicKey.rawRepresentation, k.ed.publicKey.rawRepresentation)
    }

    private static func checkContext(_ context: String) throws -> String {
        guard context.hasPrefix(contextPrefix), context.count > contextPrefix.count, context.count <= maxContext, !context.unicodeScalars.contains(where: { $0.value < 0x20 }) else {
            throw E2eeError(code: "invalid_argument", message: "Not an encryption context.")
        }
        return context
    }

    /// Opens an FLS1 sealed box addressed to this device's X25519 key (§4.4). Asks for Face ID first when that's on.
    func open(_ box: Data, context: String) async throws -> Data {
        let b = [UInt8](box)
        guard b.count >= Self.sealedHeader + Self.tagBytes, b.count <= Self.maxBox, Array(b[0..<4]) == Self.sealedMagic, b[4] == Self.sealedVersion else {
            throw E2eeError(code: "invalid_argument", message: "Not a sealed Folevi box.")
        }
        let ctx = try Self.checkContext(context)
        guard let k = load() else { throw E2eeError(code: "unavailable", message: "This device has no encryption keys yet.") }
        try await confirm()
        return try Self.openSealedBox(k.x, recipientPub: k.x.publicKey.rawRepresentation, context: ctx, box: Data(b))
    }

    /// FLS1 open (§4.4): s = X25519(d, E); k = HKDF-SHA256(s, salt E ‖ R, info "seal/" ‖ context);
    /// plaintext = AES-256-GCM-open(k, nonce, body, AAD = header ‖ utf8(context)). Refuses an all-zero s.
    static func openSealedBox(_ privateKey: Curve25519.KeyAgreement.PrivateKey, recipientPub: Data, context: String, box: Data) throws -> Data {
        let header = box.prefix(sealedHeader)
        let eph = box.subdata(in: 5..<37)
        let nonce = box.subdata(in: 37..<sealedHeader)
        let body = box.subdata(in: sealedHeader..<(box.count - tagBytes))
        let tag = box.suffix(tagBytes)
        guard let ephKey = try? Curve25519.KeyAgreement.PublicKey(rawRepresentation: eph), let shared = try? privateKey.sharedSecretFromKeyAgreement(with: ephKey) else {
            throw E2eeError(code: "failed", message: "The key agreement failed.")
        }
        let sharedBytes = shared.withUnsafeBytes { Data($0) }
        guard sharedBytes.contains(where: { $0 != 0 }) else { throw E2eeError(code: "failed", message: "The key agreement failed.") }
        let key = HKDF<SHA256>.deriveKey(inputKeyMaterial: SymmetricKey(data: sharedBytes), salt: eph + recipientPub, info: Data("seal/\(context)".utf8), outputByteCount: 32)
        do {
            let sealed = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: nonce), ciphertext: body, tag: tag)
            return try AES.GCM.open(sealed, using: key, authenticating: Data(header) + Data(context.utf8))
        } catch {
            throw E2eeError(code: "failed", message: "The sealed box failed its integrity check.")
        }
    }

    /// The bytes an FST1 signature covers (§4.4).
    static func statementMessage(kind: String, body: String) -> Data {
        Data("folevi/e2ee/v1/statement\n\(kind)\n".utf8) + Data(body.utf8)
    }

    /// An FST1 signature (base64url) by this device's Ed25519 key over a statement's canonical JSON body.
    func sign(kind: String, body: String) throws -> String {
        guard Self.statementKinds.contains(kind) else { throw E2eeError(code: "invalid_argument", message: "Unknown statement kind.") }
        guard body.count <= Self.maxStatement, let parsed = try? JSONSerialization.jsonObject(with: Data(body.utf8)), parsed is [String: Any] else {
            throw E2eeError(code: "invalid_argument", message: "Not a statement.")
        }
        guard let k = load() else { throw E2eeError(code: "unavailable", message: "This device has no encryption keys yet.") }
        guard let sig = try? k.ed.signature(for: Self.statementMessage(kind: kind, body: body)) else { throw E2eeError(code: "failed", message: "Signing failed.") }
        return Self.b64u(sig)
    }

    /// Forgets this device's keys (signed out for good, or the device was removed). The next call makes new ones.
    func reset() {
        Keychain.delete(Self.service, Self.item)
        lock.lock()
        confirmedAt = nil
        lock.unlock()
    }

    // MARK: Face ID before unlocking

    private var faceIdOn: Bool {
        get { UserDefaults.standard.bool(forKey: "e2ee.faceId") }
        set { UserDefaults.standard.set(newValue, forKey: "e2ee.faceId") }
    }

    /// Whether this device can ask (Face ID, Touch ID or Optic ID, else its passcode).
    static var canAsk: Bool { LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: nil) }

    func settings() -> (touchId: Bool, available: Bool) {
        let available = Self.canAsk
        return (available && faceIdOn, available)
    }

    /// Turning it on or off asks too, so someone holding an unlocked phone can't switch it off.
    func setFaceId(_ on: Bool) async throws -> (touchId: Bool, available: Bool) {
        guard Self.canAsk else { throw E2eeError(code: "unavailable", message: "This device has no Face ID or passcode set up.") }
        if on != faceIdOn {
            guard await AppLock.confirm(reason: on ? "Ask before unlocking encrypted notes" : "Stop asking before unlocking encrypted notes") else {
                throw E2eeError(code: "cancelled", message: "Face ID didn't confirm it.")
            }
            faceIdOn = on
        }
        return settings()
    }

    private func confirm() async throws {
        guard faceIdOn, Self.canAsk else { return }
        let recent = lock.withLock { confirmedAt.map { Date().timeIntervalSince($0) < Self.grace } ?? false }
        if recent { return }
        guard await AppLock.confirm(reason: "Unlock your encrypted notes") else { throw E2eeError(code: "cancelled", message: "Face ID didn't confirm it.") }
        lock.withLock { confirmedAt = Date() }
    }
}
