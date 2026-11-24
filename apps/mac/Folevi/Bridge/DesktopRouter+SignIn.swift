// foleviDesktop.signInInBrowser (docs/MAC_WEBKIT_PLAN.md §5.2, WM1's row): "Continue with Google" or Apple on a
// sign-in page in the app. Electron opened the website's /app-google in the default browser and waited for the
// folevi://auth/google link it ends on; here the same page opens in the system's sign-in sheet
// (ASWebAuthenticationSession, callback scheme folevi), which hands the link back with no round trip through the
// browser. The answer is that link (with its one-time code), or null when closed. Only the website's /app-google
// may start it (Electron's isSignInStart).
import AppKit
import AuthenticationServices

enum SignInInBrowser {
    /// Registers the call (from Places.install, before the first view).
    @MainActor
    static func install() {
        DesktopRouter.features.insert("signInInBrowser")
        DesktopRouter.extraHandlers["signInInBrowser"] = { router, options in
            guard let raw = options["url"] as? String, raw.count <= 4096, let url = URL(string: raw), isSignInStart(url) else { return ["url": NSNull()] }
            return ["url": (await run(url, window: router.context.window()))?.absoluteString ?? NSNull()]
        }
    }

    /// Electron's isSignInStart: always on the website, at /app-google.
    static func isSignInStart(_ url: URL, service: URL = Paths.serviceURL) -> Bool {
        Links.isServiceUrl(url, service: service) && url.path == "/app-google"
    }

    @MainActor private static var current: SignInSheet?

    /// The sheet on `url`, ending on folevi://auth/google (or nil when closed or refused).
    @MainActor
    static func run(_ url: URL, window: NSWindow?) async -> URL? {
        current?.session.cancel()
        let back: URL? = await withCheckedContinuation { cont in
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: "folevi") { url, _ in cont.resume(returning: url) }
            session.prefersEphemeralWebBrowserSession = false
            let sheet = SignInSheet(session: session, window: window)
            session.presentationContextProvider = sheet
            current = sheet
            if !session.start() { cont.resume(returning: nil) }
        }
        current = nil
        guard let back, back.scheme == "folevi", back.host == "auth", back.path == "/google" else { return nil }
        return back
    }
}
