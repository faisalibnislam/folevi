// This Mac's end-to-end encryption keys through the shared E2eeKeys and the router: the WP1 vectors
// (packages/local-store/fixtures/e2ee-vectors.json, as apps/desktop/src/e2ee.test.ts checks them), the device id
// Electron makes (mac-<ulid>), its words (Touch ID, this Mac), and each account's own keys, by the sender's place.
import CryptoKit
import XCTest
@testable import Folevi

final class E2eeTests: XCTestCase {
    private final class Sink: BridgeEvents {
        func emit(_ plugin: String, _ event: String, _ data: [String: Any]) {}
    }

    private let accounts = ["e2eeMacAna", "e2eeMacBen"]

    override func tearDown() {
        for id in accounts { E2eeKeys.forget(userId: id) }
        ShellPlaces.$acting.withValue(ShellPlaces.library) { E2eeKeys.shared.reset() }
    }

    @MainActor
    private func call(_ method: String, _ options: [String: Any] = [:], place: String?) async throws -> [String: Any] {
        try await ShellRouter(place: { place }, window: { nil }, events: Sink()).handle(method, options)
    }

    func testSealedBoxesAndStatementsMatchTheVectors() throws {
        let v = try fixture("e2ee-vectors.json")
        for b in v["boxes"] as! [[String: Any]] {
            let key = try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: hex(b["recipientSeedHex"] as! String))
            XCTAssertEqual(hexString(key.publicKey.rawRepresentation), b["recipientPubHex"] as? String)
            let opened = try E2eeKeys.openSealedBox(key, recipientPub: key.publicKey.rawRepresentation, context: b["context"] as! String, box: hex(b["boxHex"] as! String))
            XCTAssertEqual(hexString(opened), b["plaintextHex"] as? String, b["name"] as! String)
            XCTAssertThrowsError(try E2eeKeys.openSealedBox(key, recipientPub: key.publicKey.rawRepresentation, context: (b["context"] as! String) + "x", box: hex(b["boxHex"] as! String)))
        }
        for s in v["statements"] as! [[String: Any]] {
            let pub = try Curve25519.Signing.PublicKey(rawRepresentation: hex(s["signerPubHex"] as! String))
            let sig = s["sig"] as! String
            let padded = sig.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/") + String(repeating: "=", count: (4 - sig.count % 4) % 4)
            XCTAssertTrue(pub.isValidSignature(Data(base64Encoded: padded)!, for: E2eeKeys.statementMessage(kind: s["kind"] as! String, body: s["body"] as! String)))
        }
    }

    @MainActor
    func testTheRouterOpensAndSignsAsThisMac() async throws {
        let place = "acct:e2eeMacAna"
        let k = try await call("e2eeDeviceKeys", place: place)
        let deviceId = try XCTUnwrap(k["deviceId"] as? String)
        XCTAssertTrue(deviceId.range(of: "^mac-[0-9A-HJKMNP-TV-Z]{26}$", options: .regularExpression) != nil, deviceId)
        let x = try XCTUnwrap(Data(base64Encoded: k["x25519Pub"] as! String))
        let ed = try XCTUnwrap(Data(base64Encoded: k["ed25519Pub"] as! String))
        XCTAssertEqual(x.count, 32)
        // A box sealed to this Mac (the FLS1 layout), opened through the bridge.
        let context = "folevi/e2ee/v1/amk/device/test"
        let eph = Curve25519.KeyAgreement.PrivateKey()
        let shared = try eph.sharedSecretFromKeyAgreement(with: try Curve25519.KeyAgreement.PublicKey(rawRepresentation: x)).withUnsafeBytes { Data($0) }
        let boxKey = HKDF<SHA256>.deriveKey(inputKeyMaterial: SymmetricKey(data: shared), salt: eph.publicKey.rawRepresentation + x, info: Data("seal/\(context)".utf8), outputByteCount: 32)
        let nonce = LibraryCrypto.randomBytes(12)
        let header = Data("FLS1".utf8) + Data([1]) + eph.publicKey.rawRepresentation + nonce
        let sealed = try AES.GCM.seal(Data("the account key".utf8), using: boxKey, nonce: AES.GCM.Nonce(data: nonce), authenticating: header + Data(context.utf8))
        let box = (header + sealed.ciphertext + sealed.tag).base64EncodedString()
        let opened = try await call("e2eeOpen", ["box": box, "context": context], place: place)
        XCTAssertEqual(Data(base64Encoded: opened["bytes"] as! String).flatMap { String(data: $0, encoding: .utf8) }, "the account key")
        let signed = try await call("e2eeSign", ["kind": "device", "body": #"{"deviceId":"x"}"#], place: place)
        let sig = signed["value"] as! String
        let padded = sig.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/") + String(repeating: "=", count: (4 - sig.count % 4) % 4)
        XCTAssertTrue(try Curve25519.Signing.PublicKey(rawRepresentation: ed).isValidSignature(Data(base64Encoded: padded)!, for: E2eeKeys.statementMessage(kind: "device", body: #"{"deviceId":"x"}"#)))
        // Refusals keep Electron's codes and words.
        do {
            _ = try await call("e2eeOpen", ["box": "AAAA", "context": context], place: place)
            XCTFail("not a box")
        } catch let e as BridgeError {
            XCTAssertEqual(e.code, "invalid_argument")
            XCTAssertEqual(e.message, "Not a sealed Folevi box.")
        }
        do {
            _ = try await call("e2eeSign", ["kind": "other", "body": "{}"], place: place)
            XCTFail("unknown kind")
        } catch let e as BridgeError {
            XCTAssertEqual(e.code, "invalid_argument")
        }
        _ = try await call("e2eeReset", place: place)
        do {
            _ = try await call("e2eeSign", ["kind": "device", "body": "{}"], place: place)
            XCTFail("no keys after a reset")
        } catch let e as BridgeError {
            XCTAssertEqual(e.code, "unavailable")
            XCTAssertEqual(e.message, "This Mac has no encryption keys yet.")
        }
        let settings = try await call("e2eeSettings", place: place)
        XCTAssertNotNil(settings["touchId"] as? Bool)
        XCTAssertEqual(settings["available"] as? Bool, MacAppLock.canPromptTouchID())
    }

    @MainActor
    func testEachPlaceHasItsOwnKeys() async throws {
        let ana = try await call("e2eeDeviceKeys", place: "acct:e2eeMacAna")["deviceId"] as? String
        let ben = try await call("e2eeDeviceKeys", place: "acct:e2eeMacBen")["deviceId"] as? String
        let library = try await call("e2eeDeviceKeys", place: ShellPlaces.library)["deviceId"] as? String
        XCTAssertNotNil(ana)
        XCTAssertNotEqual(ana, ben, "each account its own, by the sender's place")
        XCTAssertNotEqual(ana, library)
        let got1 = try await call("e2eeDeviceKeys", place: "acct:e2eeMacAna")
        XCTAssertEqual(got1["deviceId"] as? String, ana, "kept")
        // The keychain item is the account's own (E2eeKeys' `device.<user id>`).
        XCTAssertNotNil(Keychain.get("com.folevi.e2ee", "device.e2eeMacAna"))
        XCTAssertEqual(Platform.e2ee.noCheck, "This Mac has no Touch ID, or it isn't set up.")
        XCTAssertEqual(Platform.e2ee.notConfirmed, "Touch ID didn't confirm it.")
    }
}
