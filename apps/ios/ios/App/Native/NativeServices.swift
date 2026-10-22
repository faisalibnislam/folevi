// FoleviNativePlugin's calls for what lives outside the web view (bridge.js, lib/nativeApp.ts): this
// device and the token its widgets and extensions use, the shares the share extension kept, and the
// document scanner. Like every FoleviNative call, each one checks the page is Folevi's own first. The token
// goes one way only: the page hands it over, native code never gives it back.
import AuthenticationServices
import Capacitor
import UIKit

/// The sign-in sheet on show (kept alive while it's up) and the window it's shown over.
@MainActor final class SignInSheet: NSObject, ASWebAuthenticationPresentationContextProviding {
    static var current: SignInSheet?
    let session: ASWebAuthenticationSession
    weak var window: UIWindow?

    init(session: ASWebAuthenticationSession, window: UIWindow?) {
        self.session = session
        self.window = window
    }

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated { window ?? ASPresentationAnchor() }
    }
}

extension FoleviNativePlugin {
    /// { url } -> { url }: signs in with Google in iOS's sign-in sheet, which Google allows (it doesn't sign in
    /// inside the app's web view). The sheet opens Folevi's /app-google page (only Folevi's own address), and
    /// closes on the folevi://auth/google link that page ends on; the page in the app gets that link (with a
    /// one-time code) and redeems it itself. Answers { url: null } if the sheet was closed.
    @objc func authenticate(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard self.fromFolevi else { return call.reject("Not allowed here") }
            guard let raw = call.getString("url"), let url = URL(string: raw), AppOrigin.of(url) == self.appOrigin, url.path == "/app-google" else {
                return call.reject("Not a Folevi sign-in address")
            }
            SignInSheet.current?.session.cancel()
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: "folevi") { callback, _ in
                Task { @MainActor in
                    SignInSheet.current = nil
                    if let callback, callback.host == "auth", callback.path == "/google" {
                        call.resolve(["url": callback.absoluteString])
                    } else {
                        call.resolve(["url": NSNull()])
                    }
                }
            }
            // Safari's own Google sign-in carries over, so there's often nothing to type.
            session.prefersEphemeralWebBrowserSession = false
            let sheet = SignInSheet(session: session, window: self.bridge?.viewController?.view.window)
            session.presentationContextProvider = sheet
            SignInSheet.current = sheet
            if !session.start() {
                SignInSheet.current = nil
                call.resolve(["url": NSNull()])
            }
        }
    }

    /// { id, family, model, accountId, tokenId, scanner }: this device and which token the app holds.
    @objc func device(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard self.fromFolevi else { return call.reject("Not allowed here") }
            let holds = DeviceCredential.shared.token != nil
            let accountId: Any = (holds ? SharedAccount.accountId : nil) ?? NSNull()
            let tokenId: Any = (holds ? SharedAccount.tokenId : nil) ?? NSNull()
            call.resolve([
                "id": SharedAccount.deviceId,
                "family": DeviceModel.family,
                "model": DeviceModel.name,
                "accountId": accountId,
                "tokenId": tokenId,
                "scanner": DocumentScanner.cameraAvailable,
            ])
        }
    }

    /// { token, tokenId, accountId }: keeps the token in the Keychain for the extensions, then refreshes
    /// what they show.
    @objc func setCredential(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard self.fromFolevi else { return call.reject("Not allowed here") }
            guard let token = call.getString("token"), token.hasPrefix("fvpat_"), token.count < 200, let tokenId = call.getString("tokenId"), let accountId = call.getString("accountId") else { return call.reject("That isn't a token") }
            // Several places: the open account keeps its own copy too, for the share sheet and Siri when it isn't open.
            let userId = ShellPlaces.currentUserId
            if SharedAccount.accountId != nil, SharedAccount.accountId != accountId {
                // Another account: nothing of the last one stays for the widgets or Spotlight. With several places
                // the last one is still signed in here: its token and notifications stay, only what's shown goes.
                if userId != nil { AppServices.placeChanged() } else { AppServices.signedOut() }
            }
            guard DeviceCredential.shared.store(token) else { return call.reject("The Keychain didn't keep it") }
            if let userId { SaveTargets.keep(userId: userId, accountId: accountId, tokenId: tokenId, token: token) }
            SharedAccount.accountId = accountId
            SharedAccount.tokenId = tokenId
            AppServices.launched(serverURL: self.bridge?.config.serverURL)
            AppServices.refresh()
            call.resolve(["value": true])
        }
    }

    /// Signing out: the token, the widgets' copy, the share sheet's places and Spotlight's notes go.
    @objc func clearCredential(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard self.fromFolevi else { return call.reject("Not allowed here") }
            if let userId = ShellPlaces.currentUserId { SaveTargets.forget(userId: userId) }
            AppServices.signedOut(keepNotifications: ShellPlaces.state.accounts.count > 1)
            call.resolve()
        }
    }

    /// The shares the extension kept for this account (or shared while signed out), with their files.
    @objc func takeShares(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard self.fromFolevi else { return call.reject("Not allowed here") }
            let queue = ShareQueue.shared
            // Several places: only what was saved to the open one (SaveTargets); older shares by their account.
            let shares = queue.forOpenPlace(current: LocalMode.on ? SaveTargets.library : SaveTargets.current(), accountId: SharedAccount.accountId)
            let list: [[String: Any]] = shares.map { share in
                [
                    "id": share.id,
                    "title": share.title,
                    "text": share.text,
                    "url": share.url,
                    "place": share.place ?? NSNull(),
                    "files": share.files.compactMap { file in
                        queue.data(of: file, in: share).map { ["name": file.name, "type": file.type, "data": $0.base64EncodedString()] }
                    },
                ]
            }
            call.resolve(["value": list])
        }
    }

    /// A kept share was saved: it goes from the queue.
    @objc func finishShare(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard self.fromFolevi else { return call.reject("Not allowed here") }
            if let id = call.getString("id") { ShareQueue.shared.remove(id) }
            call.resolve()
        }
    }

    /// { source: "camera" | "photos" }: the pages (base64 JPEG) and their text, or null when cancelled.
    @objc func scanDocument(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard self.fromFolevi else { return call.reject("Not allowed here") }
            guard let presenter = self.topController() else { return call.reject("Can't scan right now") }
            guard let result = await DocumentScanner.scan(source: call.getString("source") ?? "photos", from: presenter) else { return call.resolve(["value": NSNull()]) }
            call.resolve(["value": [
                "pages": result.pages.map { ["name": $0.name, "type": "image/jpeg", "data": $0.jpeg.base64EncodedString()] },
                "text": result.text,
            ]])
        }
    }
}
