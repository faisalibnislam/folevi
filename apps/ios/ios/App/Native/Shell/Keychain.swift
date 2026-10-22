// Small Keychain items the built-in interface's host keeps on this device (docs/LOCAL_MODE_PLAN.md §4.1): the
// account session (ShellAuth), the person's Foli AI keys (ShellSecrets), an encrypted library's unwrapped key
// (LibraryKeyCache) and this device's end-to-end encryption keys (E2eeKeys). Generic passwords in the app's own
// Keychain (not the group the extensions share), readable after the first unlock, never synced to iCloud,
// never logged. The page never reads any of them back.
import Foundation
import Security

enum Keychain {
    private static func query(_ service: String, _ account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account, kSecAttrSynchronizable as String: false]
    }

    static func get(_ service: String, _ account: String) -> Data? {
        var q = query(service, account)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess else { return nil }
        return out as? Data
    }

    @discardableResult
    static func set(_ service: String, _ account: String, _ data: Data) -> Bool {
        let update: [String: Any] = [kSecValueData as String: data, kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        var status = SecItemUpdate(query(service, account) as CFDictionary, update as CFDictionary)
        if status == errSecItemNotFound {
            var add = query(service, account)
            add.merge(update) { _, new in new }
            status = SecItemAdd(add as CFDictionary, nil)
        }
        return status == errSecSuccess
    }

    static func delete(_ service: String, _ account: String) {
        SecItemDelete(query(service, account) as CFDictionary)
    }

    static func getString(_ service: String, _ account: String) -> String? {
        get(service, account).flatMap { String(data: $0, encoding: .utf8) }
    }

    @discardableResult
    static func setString(_ service: String, _ account: String, _ value: String) -> Bool {
        set(service, account, Data(value.utf8))
    }

    /// The Keychain outlives the app: after Folevi is deleted and installed again, nothing of the earlier install
    /// signs anyone in or unlocks anything (its session, Foli AI keys, library keys and encryption keys go).
    static func forgetAfterReinstall() {
        let key = "folevi.installed"
        guard !UserDefaults.standard.bool(forKey: key) else { return }
        for service in ["com.folevi.shell-auth", "com.folevi.shell-secrets", "com.folevi.library-key", "com.folevi.e2ee"] {
            SecItemDelete([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service] as CFDictionary)
        }
        UserDefaults.standard.set(true, forKey: key)
    }
}
