// The sidebar's Vault row (the Mac, and the iPad's wide layout on the Mac frame's views). The Vault screen's state
// (VaultModel) is shared with the iPhone and iPad, in FoleviScreens/Vault.
#if os(macOS) || os(iOS)
import SwiftUI
import FoleviEngine
import FoleviScreens

/// The sidebar's Vault row, shown while vault.summary says there's a Vault for this person here (the web's
/// Sidebar: `vault !== null`). Its own subscription, so the frame model stays as it is.
struct VaultSidebarRow<Row: View>: View {
    let model: FrameModel
    @ViewBuilder let row: () -> Row

    var body: some View {
        if let v = VaultSidebarStores.summary(model.client).value, v.state != .none { row() }
    }
}

/// One vault.summary subscription per engine client for the sidebar, for as long as the app runs.
@MainActor
enum VaultSidebarStores {
    private static var stores: [ObjectIdentifier: ValueStore<VaultSummaryValue>] = [:]
    static func summary(_ client: EngineClient) -> ValueStore<VaultSummaryValue> {
        if let s = stores[ObjectIdentifier(client)] { return s }
        let s = client.watch(.vaultSummary())
        stores[ObjectIdentifier(client)] = s
        return s
    }
}
#endif
