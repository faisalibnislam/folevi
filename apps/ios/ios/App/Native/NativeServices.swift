// FoleviNativePlugin's calls for what lives outside the web view (bridge.js, lib/nativeApp.ts): this
// device and the token its widgets and extensions use, the shares the share extension kept, and the
// document scanner. Like every FoleviNative call, each one checks the page is Folevi's own first. The token
// goes one way only: the page hands it over, native code never gives it back.
import Capacitor
import UIKit

extension FoleviNativePlugin {
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
            if SharedAccount.accountId != nil, SharedAccount.accountId != accountId {
                // Another account: nothing of the last one stays for the widgets or Spotlight.
                AppServices.signedOut()
            }
            guard DeviceCredential.shared.store(token) else { return call.reject("The Keychain didn't keep it") }
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
            AppServices.signedOut()
            call.resolve()
        }
    }

    /// The shares the extension kept for this account (or shared while signed out), with their files.
    @objc func takeShares(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard self.fromFolevi else { return call.reject("Not allowed here") }
            let account = SharedAccount.accountId
            let queue = ShareQueue.shared
            let shares = queue.all().filter { $0.accountId == nil || $0.accountId == account }
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
