// Folevi for iPhone and iPad. Everything happens in the one scene (SceneDelegate): the web app in Capacitor's
// web view, plus the native parts (FoleviViewController, FoleviNativePlugin, AppLock). Notifications
// (PushNotifications) start here, so one that launches the app is heard.
import Capacitor
import UIKit

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Links from App Intents go to the page from here on (an intent can run before the window exists).
        PendingLink.handler = { url in Task { @MainActor in DeepLinkRouter.open(url) } }
        // Before launching finishes: a notification that opened the app (or a button pressed on one) arrives.
        PushNotifications.shared.attach()
        Keychain.forgetAfterReinstall()
        // Several places: what was saved to an account that isn't open goes to it in the background too.
        BackgroundRefresh.register()
        return true
    }

    // A silent push (content-available): the same work as a background refresh.
    func application(_ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable: Any], fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
        guard (userInfo["aps"] as? [String: Any])?["content-available"] as? Int == 1 else { return completionHandler(.noData) }
        Task {
            let sent = await BackgroundRefresh.run()
            completionHandler(sent > 0 ? .newData : .noData)
        }
    }

    // The device token for Apple's push service (PushNotifications asked for it).
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        PushNotifications.shared.registered(deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        PushNotifications.shared.failedToRegister(error)
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
