// This device's REST API token, in the Keychain under the access group the app and its extensions share
// (Folevi.keychainGroup). Readable after the device's first unlock, so widgets can refresh while it's
// locked; never synced to iCloud, never logged.
import Foundation
import Security

final class DeviceCredential {
    static let shared = DeviceCredential(service: "com.folevi.device-token", accessGroup: Folevi.keychainGroup)

    private let service: String
    private let accessGroup: String?
    private let account = "rest-api"

    init(service: String, accessGroup: String?) {
        self.service = service
        self.accessGroup = accessGroup
    }

    private func query() -> [String: Any] {
        var q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
        if let accessGroup { q[kSecAttrAccessGroup as String] = accessGroup }
        return q
    }

    /// The token, or nil. Setting nil deletes it.
    var token: String? {
        get {
            var q = query()
            q[kSecReturnData as String] = true
            q[kSecMatchLimit as String] = kSecMatchLimitOne
            var out: AnyObject?
            guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
            return String(data: data, encoding: .utf8)
        }
        set {
            guard let newValue else {
                SecItemDelete(query() as CFDictionary)
                return
            }
            _ = store(newValue)
        }
    }

    /// Saves the token; false when the Keychain refused (the result code is the only thing worth knowing).
    @discardableResult
    func store(_ token: String) -> Bool {
        let data = Data(token.utf8)
        let update: [String: Any] = [kSecValueData as String: data, kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        var status = SecItemUpdate(query() as CFDictionary, update as CFDictionary)
        if status == errSecItemNotFound {
            var add = query()
            add.merge(update) { _, new in new }
            status = SecItemAdd(add as CFDictionary, nil)
        }
        return status == errSecSuccess
    }
}
