// The app's window: Folevi's web view (FoleviViewController, with the page AppDelegate started loading), with the
// Face ID lock (AppLock) following the scene as it comes and goes, and the widgets, share sheet and Spotlight
// kept fresh (AppServices). folevi:// links from other apps and widgets, Spotlight results and Handoff of a
// Folevi page all become folevi:// links for the page (DeepLinkRouter).
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
        AppLock.shared.didEnterBackground()
        AppServices.enteredBackground()
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for context in URLContexts { DeepLinkRouter.open(context.url) }
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        if let url = DeepLinkRouter.link(for: userActivity) { DeepLinkRouter.open(url) }
    }
}
