// Folevi for iPhone and iPad. Everything happens in the one scene (SceneDelegate): the web app in Capacitor's
// web view, plus the native parts (FoleviViewController, FoleviNativePlugin, AppLock).
import Capacitor
import UIKit

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Links from App Intents go to the page from here on (an intent can run before the window exists).
        PendingLink.handler = { url in Task { @MainActor in DeepLinkRouter.open(url) } }
        return true
    }

    func application(_ application: UIApplication, configurationForConnecting connectingSceneSession: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration", sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }

    // Links and activities that arrive without a scene still reach Capacitor's plugins.
    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        if let url = DeepLinkRouter.link(for: userActivity) {
            DeepLinkRouter.open(url)
            return true
        }
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }
}
