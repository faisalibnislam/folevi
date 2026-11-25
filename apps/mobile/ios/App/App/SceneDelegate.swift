// The app's window: Folevi's web view (FoleviViewController) with the Face ID lock (AppLock) following the scene as it
// comes and goes. Links from other apps, universal links and Handoff become folevi:// links for the page.
import Capacitor
import UIKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)
        window.rootViewController = FoleviViewController()
        window.makeKeyAndVisible()
        self.window = window
        AppLock.shared.attach(to: window)
        for context in connectionOptions.urlContexts { Task { @MainActor in DeepLinkRouter.open(context.url) } }
        for activity in connectionOptions.userActivities {
            if let url = MainActor.assumeIsolated({ DeepLinkRouter.link(for: activity) }) { Task { @MainActor in DeepLinkRouter.open(url) } }
        }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for context in URLContexts { Task { @MainActor in DeepLinkRouter.open(context.url) } }
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        guard let url = MainActor.assumeIsolated({ DeepLinkRouter.link(for: userActivity) }) else { return }
        Task { @MainActor in DeepLinkRouter.open(url) }
    }

    func sceneWillResignActive(_ scene: UIScene) { AppLock.shared.willResignActive() }

    func sceneDidBecomeActive(_ scene: UIScene) {
        AppLock.shared.didBecomeActive()
        // The widgets, Shortcuts and Spotlight: fetched again with an account, and a link an extension left opens.
        MainActor.assumeIsolated { AppServices.becameActive() }
    }

    func sceneDidEnterBackground(_ scene: UIScene) {
        holdForPageSave()
        AppLock.shared.didEnterBackground()
        MainActor.assumeIsolated { AppServices.enteredBackground() }
    }

    /// The page hears the app is leaving (Capacitor's App plugin, "appStateChange") and writes what was typed in the
    /// last moment. A few seconds for that before iOS suspends the app.
    private func holdForPageSave() {
        var task = UIBackgroundTaskIdentifier.invalid
        task = UIApplication.shared.beginBackgroundTask(withName: "Folevi saves") {
            UIApplication.shared.endBackgroundTask(task)
            task = .invalid
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 4) {
            guard task != .invalid else { return }
            UIApplication.shared.endBackgroundTask(task)
            task = .invalid
        }
    }
}
