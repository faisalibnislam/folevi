// Launch: Folevi's notifications (reminders with Done and Snooze, mentions), the Keychain after a reinstall, and every
// way into the app (folevi:// links, universal links, Handoff) to DeepLinkRouter. Capacitor's own plugins get the same
// events through its proxies.
import Capacitor
import UIKit

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        PendingLink.handler = { url in Task { @MainActor in DeepLinkRouter.open(url) } }
        PushNotifications.shared.attach()
        Keychain.forgetAfterReinstall()
        return true
    }

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

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        Task { @MainActor in DeepLinkRouter.open(url) }
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }
}
