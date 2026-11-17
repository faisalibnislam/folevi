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
import FoleviMac
import FoleviPhone
import FoleviScreens

extension PlacesModel {
    /// The sheet's rows: the places, with New workspace… under the open account's workspaces when it can make one.
    var sheetRows: [PhonePlaceRow] {
        let current = places.value?.current ?? session.value?.place ?? client.place
        let avatars = Dictionary((places.value?.places ?? []).map { ($0.id, $0.avatarUrl) }, uniquingKeysWith: { a, _ in a })
        // Each workspace's picture (its logo), by place and workspace: the open account's and the others'.
        let logos = Dictionary((places.value?.places ?? []).flatMap { p in p.workspaces.map { ("\(p.id):\($0.id)", $0.logoUrl) } }, uniquingKeysWith: { a, _ in a })
        func logo(_ place: String, _ workspace: String) -> URL? { (logos["\(place):\(workspace)"] ?? nil).flatMap(URL.init(string:)) }
        let pad = UIDevice.current.userInterfaceIdiom == .pad
        var rows: [PhonePlaceRow] = []
        var newAfter: Int?
        for item in items {
            switch item.kind {
            case .personal:
                let url = (session.value?.profile.avatarUrl ?? avatars[current] ?? nil).flatMap(URL.init(string:))
                rows.append(PhonePlaceRow(id: item.id, mark: .avatar(name: item.avatarName, url: url), label: item.title, description: item.subtitle, detail: item.detail, checked: item.checked))
                newAfter = rows.count
            case .workspace(let space):
                rows.append(PhonePlaceRow(id: item.id, mark: .workspace(name: item.title, url: (account.value?.spaces.first { $0.id == space }?.logoUrl).flatMap(URL.init(string:)) ?? logo(current, space)), label: item.title, detail: item.detail, checked: item.checked, sub: true))
                newAfter = rows.count
            case .otherAccount(let place, let workspace):
                let mark: PhonePlaceMark = workspace == nil ? .avatar(name: item.avatarName, url: (avatars[place] ?? nil).flatMap(URL.init(string:))) : .workspace(name: item.title, url: logo(place, workspace ?? ""))
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

/// New workspace's card (app/NewWorkspaceDialog.tsx): a name, then the team workspace is made and shown
/// (`workspace.create`).
struct RebuildNewWorkspace: View {
    let phone: PhoneModel
    let close: () -> Void

    var body: some View {
        PhoneCardSheet(title: "New workspace", close: close) {
            PhoneNameForm(label: "Workspace name", placeholder: "Workspace name", confirm: "Create workspace") { name in
                Task { @MainActor in
                    do {
                        _ = try await phone.client.command(.workspaceCreate(name: name))
                        close()
                        phone.toast("Created \(name)", tone: .success)
                    } catch {
                        phone.toast(ScreenErrors.message(error), tone: .error)
                    }
                }
            }
        }
    }
}

/// "Move or copy notes" (FoleviPhone's PhoneMovePlacesSheet) with its model, kept while the sheet is up.
struct RebuildMovePlacesSheet: View {
    let close: () -> Void
    @MadeOnce private var model: MovePlacesModel

    init(phone: PhoneModel, request: MovePlacesRequest, close: @escaping () -> Void) {
        self.close = close
        let feedback = ScreenFeedback(toast: { [weak phone] t in phone?.toast(t.message, tone: t.tone == .error ? .error : t.tone == .success ? .success : .info) })
        _model = MadeOnce(wrappedValue: MovePlacesModel(client: phone.client, request: request, feedback: feedback))
    }

    var body: some View {
        PhoneMovePlacesSheet(model: model, close: close)
    }
}

/// The sheet's content, live: the rows follow the engine, a pick goes to `pick`.
struct RebuildAccountSheet: View {
    let places: PlacesModel
    let pick: (PhoneAccountAction) -> Void

    var body: some View {
        PhoneAccountSheetContent(places: places.sheetRows, severalPlaces: places.offersAnotherAccount, otherPlaces: places.offersMove, signOutLabel: places.signOutTitle, hasAccount: places.hasAccount, pick: pick)
    }
}

extension RebuildFrameController {
    /// What a row or action of the account sheet does. `close` takes the sheet away.
    func account(_ action: PhoneAccountAction, places: PlacesModel, close: @escaping () -> Void) {
        switch action {
        case .place(RebuildAccount.newWorkspace):
            // (The frame's root opens New workspace's card itself: RebuildNewWorkspace.)
            close()
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
            // (Once the account sheet has gone: one sheet comes up as the other leaves.)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { [weak self] in self?.moveToAnotherPlace(folders: [], notes: []) }
        case .help:
            // Help in the app, as Settings › Help opens it (the web's /help).
            close()
            open(.web("/help"), source: nil)
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

    /// "Move or copy notes…" (the account sheet: everything here) and "Move to another place…" (a folder's menu:
    /// that folder): the phone's sheet over the frame; the iPad's wide layout keeps the desk's.
    func moveToAnotherPlace(folders: [String], notes: [String]) {
        if wide { return PlaceMove.present(from: self, model: desk) }
        model.movePlaces = MovePlacesRequest(folders: folders, notes: notes)
    }

    /// A folder's Share dialog (who has access, people and roles): the Mac's and iPad's, over the window.
    func shareFolder(_ id: String, name: String) {
        FrameSheets.attach(desk, window: view.window)
        FrameDialogs.folderShare(desk, folderId: id, name: name)
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
