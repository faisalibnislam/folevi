// The rest of FoleviScreens' screens in the iPhone frame (N13, N14): Settings (the list pushed from the account
// sheet, each section pushed in turn, the technical ones as web pages in the Page View), the Face ID lock's
// settings over AppLock.swift, a note's Share screen, Quick Add, and accepting an invitation.
import SwiftUI
import UIKit
import FoleviEngine
import FoleviScreens

/// Settings > Privacy's lock (AppLock.swift's LockSettings), kept on this device only.
@MainActor
final class PhoneAppLock: AppLockSettings {
    var method: String { LockSettings.method() }
    var enabled: Bool { LockSettings.enabled }
    var after: Int { LockSettings.after }

    func setEnabled(_ on: Bool) async -> Bool {
        // Both ways prove it's the owner first: turning it on checks the lock works, turning it off is the lock.
        guard await AppLock.confirm(reason: on ? "Turn on the lock for Folevi" : "Turn off the lock for Folevi") else { return false }
        LockSettings.enabled = on
        return true
    }

    func setAfter(_ seconds: Int) { LockSettings.after = seconds }
}

/// Settings' list of sections, in the tab's stack; a section pushes its own screen.
final class SettingsListController: HostedScreen<AnyView> {
    init(model: SettingsModel, open: @escaping @MainActor (SettingsSection) -> Void, navigator: ScreenNavigator, feedback: ScreenFeedback) {
        super.init(rootView: AnyView(SettingsList(model: model, open: open).phoneEnvironment(navigator, feedback)))
        title = "Settings"
        navigationItem.largeTitleDisplayMode = .never
    }
}

final class SettingsSectionController: HostedScreen<AnyView> {
    init(model: SettingsModel, section: SettingsSection, navigator: ScreenNavigator, feedback: ScreenFeedback) {
        super.init(rootView: AnyView(SettingsSectionScreen(model: model, section: section).phoneEnvironment(navigator, feedback)))
        title = section.title
        navigationItem.largeTitleDisplayMode = .never
    }
}

extension PhoneFrameController {
    // MARK: Settings

    func openSettings(section raw: String?) {
        let nav = tabs.currentStack
        let settings = SettingsModel(client: model.client, host: SettingsHost(
            version: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "",
            openURL: { [weak self] url in self?.openExternal(url) },
            showWeb: { [weak self] page in
                guard let self else { return }
                self.tabs.currentStack.pushViewController(PageScreenController(page: page, title: Self.title(of: page), model: self.model, pageHost: self.pageHost), animated: true)
            },
            signOut: { [weak self] in
                guard let self, let place = ShellPlaces.state.current else { return }
                self.signOutNow(place)
            },
            appLock: PhoneAppLock()
        ), feedback: feedback, platform: .current)
        let push: @MainActor (SettingsSection) -> Void = { [weak self] s in
            guard let self else { return }
            self.tabs.currentStack.pushViewController(SettingsSectionController(model: settings, section: s, navigator: self.navigator, feedback: self.feedback), animated: true)
        }
        nav.pushViewController(SettingsListController(model: settings, open: push, navigator: navigator, feedback: feedback), animated: true)
        if let raw, let section = SettingsSection(rawValue: raw) ?? SettingsSection(macId: raw) { push(section) }
    }

    static func title(of page: FoleviEngine.WebPage) -> String {
        switch page {
        case .settingsConnectedApps: "Connected apps"
        case .settingsWorkspaceData: "Workspace data"
        case .settingsData: "Import & Export"
        case .settingsAiExport: "Export Foli AI data"
        case .reviews: "Reviews"
        case .graph: "Graph"
        }
    }

    // MARK: Share, Quick Add, invitations

    /// The note's Share screen (people, the public link), as a sheet.
    func presentShare(noteId: String) {
        let meta = model.noteMeta[noteId]
        let personal = meta?.space.map { s in model.session.value?.spaces.first { $0.id == s }?.kind == .personal } ?? false
        let sharing = SharingModel(client: model.client, noteId: noteId, title: meta?.title ?? "", personal: personal ?? false, feedback: feedback)
        PhoneSheets.present(ShareScreen(model: sharing) { [weak self] in self?.dismiss(animated: true) }.phoneEnvironment(navigator, feedback), from: self, id: "share-sheet")
    }

    /// Quick Add (a task, or a note) as a sheet that rides the keyboard.
    func presentQuickAdd(_ mode: QuickAddModel.Mode = .task) {
        let quick = QuickAddModel(client: model.client, mode: mode, feedback: feedback)
        PhoneSheets.present(FoleviScreens.QuickAddView(model: quick, style: .sheet) { [weak self] in self?.dismiss(animated: true) }.phoneEnvironment(navigator, feedback), from: self, id: "quick-add-sheet", detents: [.medium(), .large()])
    }

    /// An invitation link (/invite/<token> for a workspace, /share-invite/<token> for a page).
    func presentInvite(kind: InviteTokenArgs.Kind, token: String) {
        let invite = InviteModel(client: model.client, kind: kind, token: token, feedback: feedback)
        PhoneSheets.present(InviteScreen(model: invite) { [weak self] in self?.dismiss(animated: true) }.phoneEnvironment(navigator, feedback), from: self, id: "invite-sheet", detents: [.large()])
    }

    /// The invitation in an app path, when it is one.
    static func invite(in path: String) -> (InviteTokenArgs.Kind, String)? {
        let parts = (path.split(separator: "?").first.map(String.init) ?? path).split(separator: "/").map(String.init)
        guard parts.count >= 2, parts[1].range(of: #"^[A-Za-z0-9_-]{8,200}$"#, options: .regularExpression) != nil else { return nil }
        switch parts[0] {
        case "invite": return (.workspace, parts[1])
        case "share-invite": return (.page, parts[1])
        default: return nil
        }
    }
}
