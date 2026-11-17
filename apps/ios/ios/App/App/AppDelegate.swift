// Folevi for iPhone and iPad. Everything happens in the one scene (SceneDelegate): the web app in Folevi's own web
// view (Native/Host/WebHost.swift), plus the native parts (FoleviViewController, FoleviNativePlugin, AppLock).
// Notifications (PushNotifications) start here, so one that launches the app is heard, and the page starts
// loading here too (WebHost.prewarm()), before the window exists.
import UIKit

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        PhoneMetrics.mark("didFinishLaunching")
        // Links from App Intents go to the page from here on (an intent can run before the window exists).
        PendingLink.handler = { url in Task { @MainActor in DeepLinkRouter.open(url) } }
        // Before launching finishes: a notification that opened the app (or a button pressed on one) arrives.
        PushNotifications.shared.attach()
        Keychain.forgetAfterReinstall()
        // Several places: what was saved to an account that isn't open goes to it in the background too.
        BackgroundRefresh.register()
        #if DEBUG && targetEnvironment(simulator)
        DebugHooks.forgetLibraryKeyFromEnvironment()
        #endif
        // The page starts loading now (a background launch for a refresh or a silent push doesn't need it).
        if application.applicationState != .background { WebHost.prewarm() }
        PhoneMetrics.mark("prewarmed")
        // The iPad's menu bar (Native/Rebuild/RebuildMenuBar.swift), as early as iPadOS asks for it to be set.
        IPadMenuBar.configure()
        #if DEBUG && targetEnvironment(simulator)
        DebugHooks.seedFromEnvironment()
        #endif
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

    // Links and activities that arrive without a scene go to the page as folevi:// links.
    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        DeepLinkRouter.open(url)
        return true
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        guard let url = DeepLinkRouter.link(for: userActivity) else { return false }
        DeepLinkRouter.open(url)
        return true
    }

    // MARK: the iPad's menu bar (Native/Rebuild/RebuildMenuBar.swift)

    // Before iPadOS 26 (the ⌘ overlay's commands); from 26 IPadMenuBar.configure() builds it instead.
    override func buildMenu(with builder: UIMenuBuilder) {
        super.buildMenu(with: builder)
        guard builder.system == .main else { return }
        if #unavailable(iOS 26.0) { IPadMenuBar.build(builder) }
    }

    /// Every item of the menu bar: here, at the end of the responder chain, whatever has the keyboard.
    @objc func foleviMenu(_ sender: UICommand) {
        guard let id = IPadMenuBar.id(of: sender) else { return }
        IPadMenuBar.perform(id)
    }

    override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
        if action == #selector(foleviMenu(_:)) {
            guard let id = IPadMenuBar.id(of: sender) else { return false }
            return IPadMenuBar.isEnabled(id, sender: sender)
        }
        return super.canPerformAction(action, withSender: sender)
    }

    override func validate(_ command: UICommand) {
        super.validate(command)
        if command.action == #selector(foleviMenu(_:)) { IPadMenuBar.validate(command) }
    }
}
