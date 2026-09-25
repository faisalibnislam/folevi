import Foundation
import Security

/// The only place credentials are stored. Generic-password items scoped by service; never UserDefaults.
/// Uses the app's default keychain access group, so no provisioning profile is required.
public struct Keychain: Sendable {
    public enum KeychainError: Error, Equatable, CustomStringConvertible {
        case unexpectedStatus(OSStatus)
        case notFound
        public var description: String {
            switch self {
            case .notFound: return "Keychain item not found"
            case .unexpectedStatus(let s): return "Keychain error \(s)"
            }
        }
    }

    public let service: String

    public init(service: String) {
        self.service = service
    }

    public static let app = Keychain(service: "com.folevi.mac.credentials")

    private func baseQuery(_ account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    public func set(_ data: Data, for account: String) throws {
        let query = baseQuery(account)
        let attrs: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]
        var status = SecItemUpdate(query as CFDictionary, attrs as CFDictionary)
        if status == errSecItemNotFound {
            var add = query
            add.merge(attrs) { _, new in new }
            add[kSecAttrLabel as String] = "Folevi"
            status = SecItemAdd(add as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw KeychainError.unexpectedStatus(status) }
    }

    public func setString(_ value: String, for account: String) throws {
        try set(Data(value.utf8), for: account)
    }

    public func data(for account: String) throws -> Data {
        var query = baseQuery(account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { throw KeychainError.notFound }
        guard status == errSecSuccess, let data = result as? Data else { throw KeychainError.unexpectedStatus(status) }
        return data
    }

    public func string(for account: String) -> String? {
        guard let d = try? data(for: account) else { return nil }
        return String(data: d, encoding: .utf8)
    }

    public func delete(_ account: String) throws {
        let status = SecItemDelete(baseQuery(account) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw KeychainError.unexpectedStatus(status) }
    }

    public func deleteAll() throws {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service]
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw KeychainError.unexpectedStatus(status) }
    }
}
