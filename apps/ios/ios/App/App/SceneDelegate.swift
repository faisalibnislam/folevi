// The app's window: Folevi's web view (FoleviViewController), with the Face ID lock (AppLock) following the
// scene as it comes and goes, and the widgets, share sheet and Spotlight kept fresh (AppServices). Capacitor
// hears about links and activities through its proxy (the App plugin hands folevi:// links to the page);
// Spotlight results become folevi:// links first (DeepLinkRouter).
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

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
        // Opened from Spotlight (or a Folevi page handed off): the note, once the page is up.
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
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        if let url = DeepLinkRouter.link(for: userActivity) { return DeepLinkRouter.open(url) }
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
