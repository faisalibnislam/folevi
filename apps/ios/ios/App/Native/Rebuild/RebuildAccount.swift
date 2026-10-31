// The avatar's account sheet in the rebuild frame (docs/IOS_REBUILD_PLAN.md, I2): the places this device has from
// the engine (FoleviScreens' PlacesModel: the open account with its workspaces, the other accounts, the library),
// drawn as the web's AccountSheet.tsx draws them (PhoneAccountSheetContent). A space of the open account switches
// in the engine; another place, signing in to another account and signing out go through ShellPlaces and
// ShellAuth, and the app opens again in the new place (FoleviViewController.restart); signing out is the page's
// (`account.signOut`), which clears what this account kept here first.
import SwiftUI
import UIKit
import FoleviDesign
import FoleviEngine
import FoleviScreens

extension PlacesModel {
    /// The sheet's rows: the places, with New workspace… under the open account's workspaces when it can make one.
    var sheetRows: [PhonePlaceRow] {
        let current = places.value?.current ?? session.value?.place ?? client.place
        let avatars = Dictionary((places.value?.places ?? []).map { ($0.id, $0.avatarUrl) }, uniquingKeysWith: { a, _ in a })
        let pad = UIDevice.current.userInterfaceIdiom == .pad
        var rows: [PhonePlaceRow] = []
        var newAfter: Int?
        for item in items {
            switch item.kind {
            case .personal:
                let url = (session.value?.profile.avatarUrl ?? avatars[current] ?? nil).flatMap(URL.init(string:))
                rows.append(PhonePlaceRow(id: item.id, mark: .avatar(name: item.avatarName, url: url), label: item.title, description: item.subtitle, detail: item.detail, checked: item.checked))
                newAfter = rows.count
            case .workspace:
                rows.append(PhonePlaceRow(id: item.id, mark: .workspace(name: item.title, url: nil), label: item.title, detail: item.detail, checked: item.checked, sub: true))
                newAfter = rows.count
            case .otherAccount(let place, let workspace):
                let mark: PhonePlaceMark = workspace == nil ? .avatar(name: item.avatarName, url: (avatars[place] ?? nil).flatMap(URL.init(string:))) : .workspace(name: item.title, url: nil)
                rows.append(PhonePlaceRow(id: item.id, mark: mark, label: item.title, description: item.subtitle, checked: item.checked, sub: item.nested, badge: item.unread, dot: item.dot))
            case .library:
                rows.append(PhonePlaceRow(id: item.id, mark: .library(pad ? .tablet : .smartphone), label: item.title, description: item.subtitle, checked: item.checked, dot: item.dot))
            }
        }
        if canCreateWorkspace, let at = newAfter {
            rows.insert(PhonePlaceRow(id: RebuildAccount.newWorkspace, mark: .newWorkspace, label: "New workspace…", checked: nil, sub: true), at: at)
        }
        return rows
    }
}

enum RebuildAccount {
    /// The New workspace… row's id (no place has it).
    static let newWorkspace = "new-workspace"
}

/// The sheet's content, live: the rows follow the engine, a pick goes to `pick`.
struct RebuildAccountSheet: View {
    let places: PlacesModel
    let pick: (PhoneAccountAction) -> Void

    var body: some View {
        PhoneAccountSheetContent(places: places.sheetRows, severalPlaces: places.offersAnotherAccount, otherPlaces: places.offersMove, signOutLabel: places.signOutTitle, pick: pick)
    }
}

extension RebuildFrameController {
    /// What a row or action of the account sheet does. `close` takes the sheet away.
    func account(_ action: PhoneAccountAction, places: PlacesModel, close: @escaping () -> Void) {
        switch action {
        case .place(RebuildAccount.newWorkspace):
            close()
            model.toast("New workspaces come to the app with the next update.")
        case .place(let id):
            guard let item = places.items.first(where: { $0.id == id }) else { return }
            Task { @MainActor in
                switch await places.choose(item) {
                case .switchPlace(let place, _):
                    close()
                    switchPlace(place)
                case .dismiss: close()
                default: break
                }
            }
        case .settings:
            close()
            frame.open(.web("/settings"))
        case .signInAnother:
            close()
            Task { @MainActor in
                guard let u = await ShellAuth.shared.signInAccount(window: self.view.window, provider: nil) else { return }
                self.adoptAccount(userId: u.userId, name: u.name, email: u.email, avatarUrl: u.avatarUrl)
            }
        case .movePlaces:
            close()
            model.toast("Moving notes between places comes to the app with the next update.")
        case .help:
            close()
            if let url = URL(string: "https://folevi.com/help") { openExternal(url) }
        case .signOut:
            // As the web's safe sign-out: a warning only when changes here haven't synced (they'd be lost).
            if places.unsynced > 0 {
                places.confirmingSignOut = true
            } else {
                close()
                signOutNow()
            }
        }
    }

    /// Another place on this device: it becomes the current one and the app opens again in it.
    func switchPlace(_ id: String) {
        guard ShellPlaces.has(id) else { return }
        ShellPlaces.setCurrent(id)
        FoleviViewController.restart()
    }

    /// A new session becomes a place and the app opens again in it.
    func adoptAccount(userId: String, name: String, email: String, avatarUrl: String?) {
        let wasEmpty = ShellPlaces.state.accounts.isEmpty
        guard let a = ShellPlaces.addAccount(userId: userId, name: name, email: email, avatarUrl: avatarUrl) else { return }
        if wasEmpty { E2eeKeys.adoptLegacy(userId: userId) }
        ShellMode.current = "account"
        ShellPlaces.setCurrent(a.id)
        FoleviViewController.restart()
    }

    /// Signs out of the place on screen (after the warning) the way the page does (`account.signOut`): this
    /// account's copy and keys here go, then the host ends its session and opens the next place.
    func signOutNow() {
        Task { @MainActor in
            do {
                _ = try await model.client.command(.accountSignOut)
            } catch {
                model.toast("Folevi couldn't sign out. Try again.", tone: .error)
            }
        }
    }
}
