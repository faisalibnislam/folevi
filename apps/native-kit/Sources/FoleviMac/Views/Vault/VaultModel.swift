// The Vault screen's state (docs/VAULT_PLAN.md §9, docs/MAC_REBUILD_PLAN.md §5.6): the engine's vault.summary and the
// open section's views (bridge revision 18), and the commands the screens send. Nothing is decrypted here: the
// engine opens what's shown and logs it; values the screens show live in memory only, and go when the Vault locks.
#if os(macOS)
import AppKit
import SwiftUI
import FoleviEngine

@MainActor
@Observable
final class VaultModel {
    let frame: FrameModel
    let summary: ValueStore<VaultSummaryValue>
    var section: VaultSection = .files
    /// The ⋯ section shown as a third tab (Health, Trash, Settings…), as the web does.
    var fromMenu: VaultSection? { [.files, .passwords].contains(section) ? nil : section }
    /// Files & Notes: the folder open (nil: the top) and Grid or Lines (kept on this Mac, like the web's).
    var folderId: String?
    var filesLayout: String = UserDefaults.standard.string(forKey: "folevi.vault.filesLayout") ?? "grid" {
        didSet { UserDefaults.standard.set(filesLayout, forKey: "folevi.vault.filesLayout") }
    }
    /// Passwords: the item open beside the list.
    var selected: String?
    var dialog: VaultDialog?
    /// This device's encryption (`e2ee.state`), for the Vault's first step on a Mac without the account's keys.
    @ObservationIgnored lazy var e2ee: ValueStore<E2eeStateValue> = frame.client.watch(.e2eeState)
    /// This Mac started unlocking encryption on this screen: once it's unlocked, the passcode card offers Touch ID.
    var encryptionUnlockedHere = false
    @ObservationIgnored private var stores: [String: AnyObject] = [:]
    @ObservationIgnored private var openedFor: String?

    init(frame: FrameModel, section: VaultSection?) {
        self.frame = frame
        summary = frame.client.watch(.vaultSummary())
        if let section { self.section = section }
    }

    var value: VaultSummaryValue? { summary.value }
    var vaultId: String? { value?.vaultId }
    var isOpen: Bool { value?.state == .open }

    func toast(_ message: String, tone: FrameToast.Tone = .info) { frame.toast(message, tone: tone) }

    /// A view of the open Vault, kept while the screen lives (and dropped when it locks).
    func store<V: EngineViewSpec>(_ key: String, _ make: () -> V) -> ValueStore<V.Value> {
        if let s = stores[key] as? ValueStore<V.Value> { return s }
        let s = frame.client.watch(make())
        stores[key] = s
        return s
    }

    /// Called as the summary changes: a lock drops what was shown; an open records the first section.
    func summaryChanged() {
        guard isOpen else {
            if openedFor != nil {
                for s in stores.values { (s as? any Cancellable)?.cancel() }
                stores = [:]
                openedFor = nil
                selected = nil
                dialog = nil
                folderId = nil
            }
            return
        }
        openedFor = vaultId
    }

    func open(_ s: VaultSection) {
        section = s
        guard let vaultId else { return }
        run { try await self.frame.client.command(.vaultRecord(vaultId: vaultId, event: "section.open", field: s.rawValue)) }
    }

    /// Runs a command; its refusal becomes the web's error toast.
    func run(_ work: @escaping @MainActor () async throws -> Void) {
        Task { @MainActor in
            do { try await work() } catch { self.toast(Self.message(error), tone: .error) }
        }
    }

    static func message(_ e: any Error) -> String {
        if case .engine(let err)? = e as? EngineFailure { return err.message }
        return "Something went wrong."
    }

    func record(_ event: String, itemId: String? = nil, field: String? = nil) {
        guard let vaultId else { return }
        Task { try? await frame.client.command(.vaultRecord(vaultId: vaultId, event: event, itemId: itemId, field: field)) }
    }

    func lock() {
        guard let vaultId else { return }
        run { _ = try await self.frame.client.command(.vaultLock(vaultId: vaultId)) }
    }

    /// Copies a secret and clears the clipboard 30 seconds later if it still holds it (the web's copySecret).
    func copy(_ label: String, _ value: String, itemId: String, event: String = "item.copy") {
        let pb = NSPasteboard.general
        pb.clearContents()
        pb.setString(value, forType: .string)
        let count = pb.changeCount
        DispatchQueue.main.asyncAfter(deadline: .now() + 30) {
            if NSPasteboard.general.changeCount == count { NSPasteboard.general.clearContents() }
        }
        record(event, itemId: itemId, field: label)
        toast("\(label) copied. The clipboard clears in 30 seconds.")
    }
}

/// The dialogs over the Vault (drawn solid, as the web draws them over the inverted Vault).
enum VaultDialog: Identifiable {
    case newFolder
    case newNote
    case addItem
    case editItem(VaultItemValue)
    case history(itemId: String, canChange: Bool)
    case share(itemId: String, title: String, note: Bool)
    case note(VaultItemRow)
    case preview(files: [VaultItemRow], index: Int)
    case emptyTrash
    case changePasscode

    var id: String {
        switch self {
        case .newFolder: return "newFolder"
        case .newNote: return "newNote"
        case .addItem: return "addItem"
        case .editItem(let i): return "edit-\(i.id)"
        case .history(let id, _): return "history-\(id)"
        case .share(let id, _, _): return "share-\(id)"
        case .note(let r): return "note-\(r.id)"
        case .preview(let f, let i): return "preview-\(f[i].id)"
        case .emptyTrash: return "emptyTrash"
        case .changePasscode: return "changePasscode"
        }
    }
}

/// What a ValueStore can do when the screen lets go of it.
@MainActor protocol Cancellable: AnyObject { func cancel() }
extension ValueStore: Cancellable {}
#endif

#if os(macOS)
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
