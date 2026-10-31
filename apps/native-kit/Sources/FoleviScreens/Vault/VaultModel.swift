// The Vault screen's state (docs/VAULT_PLAN.md §9, docs/MAC_REBUILD_PLAN.md §5.6), shared by the Mac and the iPhone
// and iPad: the engine's vault.summary and the open section's views (bridge revision 18), and the commands the
// screens send. Nothing is decrypted here: the engine opens what's shown and logs it; values the screens show live
// in memory only, and go when the Vault locks.
import Foundation
import Observation
import FoleviEngine
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

@MainActor
@Observable
public final class VaultModel {
    public let client: EngineClient
    public let feedback: ScreenFeedback
    public let summary: ValueStore<VaultSummaryValue>
    public var section: VaultSection = .files
    /// The ⋯ section shown as a third tab (Health, Trash, Settings…), as the web does.
    public var fromMenu: VaultSection? { [.files, .passwords].contains(section) ? nil : section }
    /// Files & Notes: the folder open (nil: the top) and Grid or Lines (kept on this device, like the web's).
    public var folderId: String?
    public var filesLayout: String = UserDefaults.standard.string(forKey: "folevi.vault.filesLayout") ?? "grid" {
        didSet { UserDefaults.standard.set(filesLayout, forKey: "folevi.vault.filesLayout") }
    }
    /// Passwords: the item open (beside the list on the Mac, its own screen on the iPhone).
    public var selected: String?
    public var dialog: VaultDialog?
    /// This device's encryption (`e2ee.state`), for the Vault's first step on a device without the account's keys.
    @ObservationIgnored public lazy var e2ee: ValueStore<E2eeStateValue> = client.watch(.e2eeState)
    /// This device started unlocking encryption on this screen: once it's unlocked, the passcode card offers Touch ID.
    public var encryptionUnlockedHere = false
    @ObservationIgnored private var stores: [String: AnyObject] = [:]
    @ObservationIgnored private var openedFor: String?

    public init(client: EngineClient, feedback: ScreenFeedback, section: VaultSection?) {
        self.client = client
        self.feedback = feedback
        summary = client.watch(.vaultSummary())
        if let section { self.section = section }
    }

    public var value: VaultSummaryValue? { summary.value }
    public var vaultId: String? { value?.vaultId }
    public var isOpen: Bool { value?.state == .open }

    public func toast(_ message: String, tone: ScreenToast.Tone = .info) { feedback.toast(ScreenToast(message, tone: tone)) }

    /// A view of the open Vault, kept while the screen lives (and dropped when it locks).
    public func store<V: EngineViewSpec>(_ key: String, _ make: () -> V) -> ValueStore<V.Value> {
        if let s = stores[key] as? ValueStore<V.Value> { return s }
        let s = client.watch(make())
        stores[key] = s
        return s
    }

    /// Called as the summary changes: a lock drops what was shown; an open records the first section.
    public func summaryChanged() {
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

    public func open(_ s: VaultSection) {
        section = s
        guard let vaultId else { return }
        run { try await self.client.command(.vaultRecord(vaultId: vaultId, event: "section.open", field: s.rawValue)) }
    }

    /// Runs a command; its refusal becomes the web's error toast.
    public func run(_ work: @escaping @MainActor () async throws -> Void) {
        Task { @MainActor in
            do { try await work() } catch { self.toast(Self.message(error), tone: .error) }
        }
    }

    public static func message(_ e: any Error) -> String {
        if case .engine(let err)? = e as? EngineFailure { return err.message }
        return "Something went wrong."
    }

    public func record(_ event: String, itemId: String? = nil, field: String? = nil) {
        guard let vaultId else { return }
        Task { try? await client.command(.vaultRecord(vaultId: vaultId, event: event, itemId: itemId, field: field)) }
    }

    public func lock() {
        guard let vaultId else { return }
        run { _ = try await self.client.command(.vaultLock(vaultId: vaultId)) }
    }

    /// Copies a secret and clears the clipboard 30 seconds later if it still holds it (the web's copySecret). On
    /// iOS the copy stays on this device (no Handoff) and expires by itself.
    public func copy(_ label: String, _ value: String, itemId: String, event: String = "item.copy") {
        Self.copySecret(value)
        record(event, itemId: itemId, field: label)
        toast("\(label) copied. The clipboard clears in 30 seconds.")
    }

    public static func copySecret(_ value: String) {
        #if canImport(UIKit)
        UIPasteboard.general.setItems([[UIPasteboard.typeAutomatic: value]], options: [.localOnly: true, .expirationDate: Date().addingTimeInterval(30)])
        #elseif canImport(AppKit)
        let pb = NSPasteboard.general
        pb.clearContents()
        pb.setString(value, forType: .string)
        let count = pb.changeCount
        DispatchQueue.main.asyncAfter(deadline: .now() + 30) {
            if NSPasteboard.general.changeCount == count { NSPasteboard.general.clearContents() }
        }
        #endif
    }
}

/// The dialogs over the Vault (drawn solid, as the web draws them over the inverted Vault; sheets on the iPhone).
public enum VaultDialog: Identifiable {
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

    public var id: String {
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
@MainActor public protocol Cancellable: AnyObject { func cancel() }
extension ValueStore: Cancellable {}

/// The web's formatRelative (lib/format.ts): "just now", "5 mins ago", "2 hours ago", "3 days ago", "Oct 2".
public enum VaultTime {
    public static func relative(_ ms: Double, now: Date = Date()) -> String {
        let nowMs = now.timeIntervalSince1970 * 1000
        let ahead = ms > nowMs
        let unit = { (n: Int, u: String) -> String in
            let words = "\(n) \(u)\(n == 1 ? "" : "s")"
            return ahead ? "in \(words)" : "\(words) ago"
        }
        let exact = abs(nowMs - ms) / 60_000
        let mins = ahead ? max(1, Int(exact.rounded())) : Int(exact.rounded())
        if mins < 1 { return "just now" }
        if mins < 60 { return unit(mins, "min") }
        let hours = Int((Double(mins) / 60).rounded())
        if hours < 24 { return unit(hours, "hour") }
        let days = Int((Double(hours) / 24).rounded())
        if days < 7 { return unit(days, "day") }
        let date = Date(timeIntervalSince1970: ms / 1000)
        let f = DateFormatter()
        f.setLocalizedDateFormatFromTemplate(Calendar.current.component(.year, from: date) == Calendar.current.component(.year, from: now) ? "MMM d" : "MMM d y")
        return f.string(from: date)
    }

    /// The web's formatDateTime.
    public static func dateTime(_ ms: Double) -> String {
        let f = DateFormatter()
        f.dateStyle = .medium
        f.timeStyle = .short
        return f.string(from: Date(timeIntervalSince1970: ms / 1000))
    }
}

/// The section a /vault/<section> link opens (the screen captures use it; the web ignores the rest of the path).
public extension VaultSection {
    init?(path: String) {
        let parts = path.split(separator: "/")
        guard parts.count > 1 else { return nil }
        self.init(rawValue: String(parts[1]))
    }

    var label: String {
        switch self {
        case .files: return "Files & Notes"
        case .passwords: return "Passwords & Credentials"
        case .health: return "Health"
        case .activity: return "Activity"
        case .people: return "People"
        case .trash: return "Trash"
        case .settings: return "Settings"
        }
    }
}

import FoleviDesign

public extension VaultSection {
    var icon: WebIcon {
        switch self {
        case .files: return .folderLock
        case .passwords: return .keyRound
        case .health: return .heartPulse
        case .activity: return .activity
        case .people: return .users
        case .trash: return .trash
        case .settings: return .settings
        }
    }
}

/// CSV as rows (FilePreview.tsx parseCsv: quotes, doubled quotes, commas and line breaks inside quotes), for the
/// file previews.
public enum VaultCSV {
    public static func parse(_ text: String, max: Int = 501) -> [[String]] {
        var rows: [[String]] = []
        var row: [String] = []
        var field = ""
        var quoted = false
        let it = Array(text)
        var i = 0
        while i < it.count && rows.count < max {
            let c = it[i]
            if quoted {
                if c == "\"" && i + 1 < it.count && it[i + 1] == "\"" { field.append("\""); i += 1 }
                else if c == "\"" { quoted = false }
                else { field.append(c) }
            } else if c == "\"" { quoted = true }
            else if c == "," { row.append(field); field = "" }
            else if c == "\n" || c == "\r" || c == "\r\n" {
                row.append(field)
                rows.append(row)
                row = []
                field = ""
            } else { field.append(c) }
            i += 1
        }
        if (!field.isEmpty || !row.isEmpty) && rows.count < max { rows.append(row + [field]) }
        return rows
    }
}
