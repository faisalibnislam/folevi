// Reads what Electron's safeStorage sealed (docs/MAC_WEBKIT_PLAN.md §8.2), so the native app can take over the old
// Folevi's sessions, encryption keys, library keys and cloud tokens without anyone signing in again.
//
// Electron on macOS is Chromium's OSCrypt: a random password in a login-keychain generic password item (service
// "<app name> Safe Storage", account "<app name> Key"; "Folevi Safe Storage" / "Folevi Key" for Folevi), stretched
// with PBKDF2-HMAC-SHA1 (salt "saltysalt", 1003 iterations) into a 16-byte AES-128-CBC key; the IV is 16 spaces,
// the padding PKCS#7, and every blob starts with "v10". This file only ever reads: it never writes, changes or
// deletes the old app's Keychain item, and never logs the password, a key or anything it decrypts.
//
// The item's access list names the Electron app's code signature (its designated requirement: bundle id and
// team). The native app has the same bundle id and team, so macOS hands the item over without asking; WM3's R1
// check proved it with two Developer ID builds of a test bundle id. `password(allowPrompt: false)` never shows a
// dialog: if macOS would ask, it says `.needsPermission` and the migration screen explains the one question before
// asking it (`allowPrompt: true`).
import CommonCrypto
import Foundation
import Security

enum SafeStorage {
    /// Folevi's own item ("Folevi Safe Storage", account "Folevi Key").
    static let folevi = Item(appName: "Folevi")

    struct Item: Equatable {
        let service: String
        let account: String
        init(appName: String) {
            service = "\(appName) Safe Storage"
            account = "\(appName) Key"
        }
    }

    enum ReadError: Error, Equatable {
        /// There's no such item (Electron never encrypted anything on this Mac, or it was removed).
        case notFound
        /// macOS would ask the person first (the item's access list doesn't name this app).
        case needsPermission
        /// The person said Deny, or the Keychain is locked and stays locked.
        case denied
        case failed(OSStatus)
    }

    enum DecryptError: Error, Equatable {
        /// Not a "v10" blob (empty, damaged, or sealed some other way).
        case notSealed
        /// The wrong key (another Mac's Keychain) or a damaged blob.
        case badData
    }

    /// The item's password, the secret the key is made from. With `allowPrompt` false nothing is ever shown.
    static func password(_ item: Item = folevi, allowPrompt: Bool) -> Result<Data, ReadError> {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: item.service,
            kSecAttrAccount as String: item.account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
            // The login keychain Electron wrote to, never the data-protection one.
            kSecUseDataProtectionKeychain as String: false,
        ]
        if !allowPrompt { query[kSecUseAuthenticationUI as String] = kSecUseAuthenticationUIFail }
        var out: AnyObject?
        let status = withInteraction(allowPrompt) { SecItemCopyMatching(query as CFDictionary, &out) }
        switch status {
        case errSecSuccess:
            guard let data = out as? Data, !data.isEmpty else { return .failure(.notFound) }
            return .success(data)
        case errSecItemNotFound: return .failure(.notFound)
        case errSecInteractionNotAllowed, errSecAuthFailed, errSecInteractionRequired: return .failure(allowPrompt ? .denied : .needsPermission)
        case errSecUserCanceled: return .failure(.denied)
        default: return .failure(.failed(status))
        }
    }

    /// The legacy keychain asks through its own dialogs unless told not to, whatever the query says.
    private static func withInteraction(_ allowed: Bool, _ body: () -> OSStatus) -> OSStatus {
        var before: DarwinBoolean = true
        SecKeychainGetUserInteractionAllowed(&before)
        SecKeychainSetUserInteractionAllowed(allowed)
        defer { SecKeychainSetUserInteractionAllowed(before.boolValue) }
        return body()
    }

    /// PBKDF2-HMAC-SHA1(password, "saltysalt", 1003) → 16 bytes, OSCrypt's key on macOS.
    static func key(password: Data) -> Data {
        var key = Data(count: kCCKeySizeAES128)
        let salt = Data("saltysalt".utf8)
        let status = key.withUnsafeMutableBytes { k in
            password.withUnsafeBytes { p in
                salt.withUnsafeBytes { s in
                    CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2), p.bindMemory(to: Int8.self).baseAddress, password.count,
                                         s.bindMemory(to: UInt8.self).baseAddress, salt.count, CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA1), 1003,
                                         k.bindMemory(to: UInt8.self).baseAddress, kCCKeySizeAES128)
                }
            }
        }
        precondition(status == kCCSuccess, "PBKDF2 failed")
        return key
    }

    private static let prefix = Data("v10".utf8)
    private static let iv = Data(repeating: 0x20, count: kCCBlockSizeAES128)

    /// Opens one blob safeStorage.encryptString wrote.
    static func decrypt(_ blob: Data, key: Data) throws -> Data {
        guard blob.count > prefix.count, blob.prefix(prefix.count) == prefix else { throw DecryptError.notSealed }
        let body = blob.dropFirst(prefix.count)
        guard !body.isEmpty, body.count % kCCBlockSizeAES128 == 0 else { throw DecryptError.badData }
        return try crypt(CCOperation(kCCDecrypt), Data(body), key: key)
    }

    static func decryptString(_ blob: Data, key: Data) throws -> String {
        guard let text = String(data: try decrypt(blob, key: key), encoding: .utf8) else { throw DecryptError.badData }
        return text
    }

    /// What safeStorage.encryptString does (tests only: the migration never writes Electron's format).
    static func encrypt(_ plain: Data, key: Data) throws -> Data {
        prefix + (try crypt(CCOperation(kCCEncrypt), plain, key: key))
    }

    private static func crypt(_ op: CCOperation, _ input: Data, key: Data) throws -> Data {
        guard key.count == kCCKeySizeAES128 else { throw DecryptError.badData }
        var out = Data(count: input.count + kCCBlockSizeAES128)
        let capacity = out.count
        var moved = 0
        let status = out.withUnsafeMutableBytes { o in
            input.withUnsafeBytes { i in
                key.withUnsafeBytes { k in
                    iv.withUnsafeBytes { v in
                        CCCrypt(op, CCAlgorithm(kCCAlgorithmAES128), CCOptions(kCCOptionPKCS7Padding), k.baseAddress, key.count, v.baseAddress,
                                i.baseAddress, input.count, o.baseAddress, capacity, &moved)
                    }
                }
            }
        }
        guard status == kCCSuccess else { throw DecryptError.badData }
        out.removeSubrange(moved...)
        return out
    }
}
