import Foundation

/// An invitation link: `…/invite/<token>` (join a workspace) or `…/share-invite/<token>` (a page shared
/// with this address), as an https link to the web app or with the app's own scheme.
enum InviteLinkKind: Equatable, Sendable {
    case workspace(String)
    case page(String)

    static func parse(_ url: URL) -> InviteLinkKind? {
        var parts = url.pathComponents.filter { $0 != "/" }
        // com.folevi.mac://invite/<token>: the host is the first part.
        if let scheme = url.scheme?.lowercased(), scheme != "https", scheme != "http", let host = url.host() { parts.insert(host, at: 0) }
        guard parts.count >= 2, let token = parts.last, !token.isEmpty else { return nil }
        switch parts[parts.count - 2] {
        case "invite": return .workspace(token)
        case "share-invite": return .page(token)
        default: return nil
        }
    }
}
