// The account and place switcher's view model (plan 5.2 and 3.6; web iphone/AccountSheet.tsx and the sidebar's
// account menu): places first (the open account with Personal and its workspaces, each with its plan and a check
// where you are; the other accounts on this device with theirs; the library on this device), then New workspace,
// Settings, Sign in to another account, Move or copy notes, Help, and Sign out (which warns when changes haven't
// synced). A space of the open account switches in the engine (`space.switch`); another place goes to the frame,
// which flushes, switches and crossfades.
import Foundation
import Observation
import FoleviDesign
import FoleviEngine
#if canImport(UIKit)
import UIKit
#endif

/// A row of the Places section.
public struct PlaceItem: Hashable, Sendable, Identifiable {
    public enum Kind: Hashable, Sendable {
        /// Personal in the open account.
        case personal
        /// A workspace of the open account (switches with `space.switch`).
        case workspace(SpaceRef)
        /// Another account on this device (or one of its workspaces).
        case otherAccount(place: String, workspaceId: String?)
        /// The library on this device.
        case library(place: String?)
    }
    public var id: String
    public var kind: Kind
    public var title: String
    public var subtitle: String?
    /// The plan or role at the end ("Pro", "Team").
    public var detail: String?
    public var avatarName: String
    public var checked: Bool
    /// Sits under the account above it.
    public var nested: Bool
    public var unread: Int
    public var dot: Bool
}

public enum DeviceWords {
    /// "this iPhone", "this iPad", "this Mac".
    @MainActor public static var here: String {
        #if os(macOS)
        return "this Mac"
        #else
        return UIDevice.current.userInterfaceIdiom == .pad ? "this iPad" : "this iPhone"
        #endif
    }
}

@MainActor
@Observable
public final class PlacesModel {
    public let client: EngineClient
    let feedback: ScreenFeedback
    public let places: ValueStore<PlacesValue>
    public let session: ValueStore<SessionValue>
    public let account: ValueStore<AccountDetails>
    public let sync: ValueStore<SyncStatusValue>
    /// The row just picked (its check moves at once; the frame crossfades to it).
    public private(set) var switchingTo: String?
    public var confirmingSignOut = false

    public init(client: EngineClient, feedback: ScreenFeedback = ScreenFeedback()) {
        self.client = client
        self.feedback = feedback
        self.places = client.watch(.placesList, snapshotKey: "places")
        self.session = client.watch(.session, snapshotKey: "session.\(client.place)")
        self.account = client.watch(.accountDetails, snapshotKey: "account.\(client.place)")
        self.sync = client.watch(.syncStatus)
    }

    public var isLocal: Bool { session.value?.mode == .local }
    public var profileName: String { session.value?.profile.name ?? account.value?.profile.name ?? "" }
    public var email: String { session.value?.profile.email ?? account.value?.profile.email ?? "" }

    /// "Free", "Core", "Pro", "Pro AI", "Team" (web plan short names).
    public static func planName(_ tier: String) -> String {
        switch tier {
        case "free": "Free"
        case "core": "Core"
        case "pro": "Pro"
        case "pro_ai": "Pro AI"
        case "team": "Team"
        case "business": "Business"
        default: tier.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }

    static func roleName(_ role: String) -> String {
        switch role {
        case "owner": "Owner"
        case "admin": "Admin"
        case "member": "Member"
        case "guest": "Guest"
        default: role.capitalized
        }
    }

    /// The name an avatar takes its initials from: words of letters only ("Faisal (work)" reads "Faisal work").
    static func avatarName(_ s: String) -> String {
        s.components(separatedBy: CharacterSet.letters.inverted).filter { !$0.isEmpty }.joined(separator: " ")
    }

    public var items: [PlaceItem] {
        var out: [PlaceItem] = []
        let s = session.value
        let current = places.value?.current ?? s?.place ?? client.place
        let here = DeviceWords.here
        if let s, s.mode == .account {
            let personalPlan = account.value?.plan.map { Self.planName($0.tier) }
            let picked = switchingTo
            func isChecked(_ id: String) -> Bool { picked.map { $0 == id } ?? (s.space == id) }
            for space in s.spaces {
                if space.kind == .personal {
                    out.append(PlaceItem(id: space.id, kind: .personal, title: s.profile.name.isEmpty ? (s.profile.email.isEmpty ? "Personal" : s.profile.email) : s.profile.name, subtitle: s.profile.email.isEmpty ? nil : s.profile.email, detail: personalPlan, avatarName: s.profile.name.isEmpty ? s.profile.email : s.profile.name, checked: isChecked(space.id), nested: false, unread: 0, dot: false))
                }
            }
            for space in s.spaces where space.kind == .workspace {
                out.append(PlaceItem(id: space.id, kind: .workspace(space.id), title: space.name, subtitle: nil, detail: space.locked ? "Locked" : Self.roleName(space.role), avatarName: space.name, checked: isChecked(space.id), nested: true, unread: 0, dot: false))
            }
        }
        for p in places.value?.places ?? [] where p.id != current {
            switch p.kind {
            case .account:
                let title = p.name.isEmpty ? (p.email ?? "Folevi account") : p.name
                out.append(PlaceItem(id: p.id, kind: .otherAccount(place: p.id, workspaceId: nil), title: title, subtitle: p.name.isEmpty ? nil : p.email, detail: nil, avatarName: Self.avatarName(title), checked: switchingTo == p.id, nested: false, unread: p.unread, dot: p.reminders > 0))
                for w in p.workspaces {
                    out.append(PlaceItem(id: "\(p.id):\(w.id)", kind: .otherAccount(place: p.id, workspaceId: w.id), title: w.name, subtitle: nil, detail: nil, avatarName: w.name, checked: switchingTo == "\(p.id):\(w.id)", nested: true, unread: 0, dot: false))
                }
            case .library:
                out.append(PlaceItem(id: p.id, kind: .library(place: p.id), title: "On \(here)", subtitle: p.syncs, detail: nil, avatarName: "", checked: switchingTo == p.id, nested: false, unread: 0, dot: p.reminders > 0 || p.waiting > 0))
            }
        }
        if isLocal {
            let lib = places.value?.places.first { $0.id == current }
            out.insert(PlaceItem(id: current, kind: .library(place: nil), title: "On \(here)", subtitle: lib?.syncs ?? "On your devices", detail: nil, avatarName: "", checked: true, nested: false, unread: 0, dot: false), at: 0)
        }
        return out
    }

    /// Several places on this device: offer "Sign in to another account" (every account mode device can).
    public var offersAnotherAccount: Bool { true }
    /// Moving or copying needs another place to go to.
    public var offersMove: Bool { (places.value?.places.count ?? 1) > 1 }
    public var canCreateWorkspace: Bool { !isLocal && (session.value?.capabilities.workspaces ?? true) }

    // MARK: Switching

    /// Picks a row. A space of this account switches here; another place is the frame's (it gets an intent back).
    public func choose(_ item: PlaceItem) async -> ScreenIntent? {
        guard !item.checked else { return .dismiss }
        feedback.haptic(.selection)
        switchingTo = item.id
        switch item.kind {
        case .personal, .workspace:
            do {
                _ = try await client.command(.spaceSwitch(space: item.id))
                return .dismiss
            } catch {
                switchingTo = nil
                feedback.haptic(.error)
                feedback.toast(ScreenToast(ScreenErrors.message(error), tone: .error))
                return nil
            }
        case .otherAccount(let place, let ws):
            return .switchPlace(id: place, workspaceId: ws)
        case .library(let place):
            guard let place else { return .dismiss }
            return .switchPlace(id: place, workspaceId: nil)
        }
    }

    /// The engine said the space or place changed: the check follows the truth again.
    public func settle() { switchingTo = nil }

    // MARK: Signing out

    public var signOutTitle: String { isLocal ? "Sign out" : "Sign out of \(profileName.isEmpty ? "this account" : profileName)" }

    /// Changes waiting to sync on this device (they'd be lost).
    public var unsynced: Int { sync.value?.pending ?? 0 }

    /// The warning before signing out: plain, or naming what hasn't synced.
    public var signOutMessage: String {
        let n = unsynced
        if n > 0 {
            return "\(n == 1 ? "1 change on \(DeviceWords.here) hasn't" : "\(n) changes on \(DeviceWords.here) haven't") synced yet. If you sign out now, \(n == 1 ? "it" : "they") will be lost. Connect to the internet and wait for them to sync first."
        }
        return "Your notes stay in your account. You can sign in again any time."
    }

    public var signOutAction: String { unsynced > 0 ? "Sign out and lose changes" : "Sign out" }
}
