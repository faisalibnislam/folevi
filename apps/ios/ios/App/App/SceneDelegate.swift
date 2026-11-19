// The app's window: Folevi's web view (FoleviViewController, with the page AppDelegate started loading), with the
// Face ID lock (AppLock) following the scene as it comes and goes, and the widgets, share sheet and Spotlight
// kept fresh (AppServices). folevi:// links from other apps and widgets, Spotlight results and Handoff of a
// Folevi page all become folevi:// links for the page (DeepLinkRouter).
import UIKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        // The new frame comes back where the scene left it (its tabs and their screens), as iOS restores a scene.
        if RebuildFrame.enabled, let data = session.stateRestorationActivity?.userInfo?[RebuildFrame.restorationKey] as? Data {
            RebuildFrame.restore(data)
        }
        let window = UIWindow(windowScene: windowScene)
        window.rootViewController = RebuildFrame.enabled ? RebuildFrame.controller() : PhoneFrame.enabled ? PhoneFrameController() : FoleviViewController()
        // The iPad's wide layout's tabs too (kept with the scene, or saved when the app last ran).
        (window.rootViewController as? RebuildFrameController)?.restoreDesk(from: session.stateRestorationActivity)
        window.makeKeyAndVisible()
        self.window = window
        AppLock.shared.attach(to: window)

        // Opened by a folevi:// link, from Spotlight, or a Folevi page handed off: the page opens it once it's up.
        for context in connectionOptions.urlContexts { DeepLinkRouter.open(context.url) }
        for activity in connectionOptions.userActivities {
            if let url = DeepLinkRouter.link(for: activity) { DeepLinkRouter.open(url) }
        }
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        AppLock.shared.didBecomeActive()
        AppServices.becameActive()
    }

    func sceneWillResignActive(_ scene: UIScene) {
        AppLock.shared.willResignActive()
    }

    func sceneDidEnterBackground(_ scene: UIScene) {
        holdForPageSave()
        PhoneFrameController.current?.snapshot.flush()
        (window?.rootViewController as? RebuildFrameController)?.saveDesk()
        AppLock.shared.didEnterBackground()
        AppServices.enteredBackground()
    }

    /// The page was told the app is leaving as it resigned active (WebHost, "appStateChange"): it writes what was
    /// typed in the last moment and sends it. A few seconds for that before iOS suspends the app.
    private func holdForPageSave() {
        final class Holder: @unchecked Sendable { var task = UIBackgroundTaskIdentifier.invalid }
        let holder = Holder()
        let end: @MainActor @Sendable () -> Void = {
            guard holder.task != .invalid else { return }
            UIApplication.shared.endBackgroundTask(holder.task)
            holder.task = .invalid
        }
        holder.task = UIApplication.shared.beginBackgroundTask(withName: "Folevi save", expirationHandler: end)
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(3))
            end()
        }
    }

    /// What iOS keeps for the scene: the new frame's tabs and screens, the phone layout's and the iPad's wide one's.
    func stateRestorationActivity(for scene: UIScene) -> NSUserActivity? {
        guard RebuildFrame.enabled else { return nil }
        var info: [String: Any] = [:]
        if let data = RebuildFrame.model.snapshotData { info[RebuildFrame.restorationKey] = data }
        if let data = (window?.rootViewController as? RebuildFrameController)?.deskRestorationData { info[RebuildFrame.deskRestorationKey] = data }
        guard !info.isEmpty else { return nil }
        let activity = NSUserActivity(activityType: RebuildFrame.restorationType)
        activity.userInfo = info
        return activity
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for context in URLContexts { DeepLinkRouter.open(context.url) }
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        if let url = DeepLinkRouter.link(for: userActivity) { DeepLinkRouter.open(url) }
    }
}
