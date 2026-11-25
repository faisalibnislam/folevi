// "Your own server": scanning a Folevi server's QR code (its address, or an invite link on it) with the camera,
// for the sign-in screen's "Scan QR code" (apps/web components/server/OwnServerSignIn.tsx). The page reaches it as
// `foleviShell.places.scanServerCode()` (bridge/mobile-bridge.js, through FoleviNative's "scanServerCode"); the
// code's text goes back to the page, which reads the address out of it and adds the server as it would a typed
// one (places.addServerPlace, where the app checks it again). Nothing is opened from the code here.
//
// VisionKit's DataScannerViewController does the scanning. Where it can't (no camera, the Simulator, camera access
// turned off, Screen Time) the call is refused with a reason in words and the page keeps the address field, so the
// person types the address instead.
import AVFoundation
import UIKit
import VisionKit

extension FoleviNativePlugin {
    /// { value: string | null }: the first QR code's text, or null when the person closed the scanner. Refuses with
    /// code "unavailable" (this device can't scan) or "camera_denied" (camera access is off for Folevi).
    @objc func scanServerCode(_ call: BridgeCall) {
        Task { @MainActor in
            guard self.fromFolevi else { return call.reject("Not allowed here") }
            switch await ServerCodeScanner.readiness() {
            case .unsupported:
                return call.reject("This device can't scan QR codes. Type the server's address instead.", "unavailable")
            case .denied:
                return call.reject("Folevi can't use the camera. Turn on Camera for Folevi in the Settings app, or type the server's address instead.", "camera_denied")
            case .ready:
                break
            }
            guard let presenter = self.topController() else { return call.reject("Folevi couldn't open the scanner. Type the server's address instead.", "unavailable") }
            let value = await ServerCodeScanner.scan(from: presenter)
            call.resolve(["value": value ?? NSNull()])
        }
    }
}

@MainActor
final class ServerCodeScanner: NSObject, DataScannerViewControllerDelegate {
    enum Readiness { case ready, unsupported, denied }

    /// Whether the scanner can open now. Asks for camera access the first time.
    static func readiness() async -> Readiness {
        guard DataScannerViewController.isSupported else { return .unsupported }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .denied, .restricted:
            return .denied
        case .notDetermined:
            guard await AVCaptureDevice.requestAccess(for: .video) else { return .denied }
        default:
            break
        }
        return DataScannerViewController.isAvailable ? .ready : .denied
    }

    /// Opens the scanner over `presenter`: the first QR code's text, or nil when it was closed first.
    static func scan(from presenter: UIViewController) async -> String? {
        await withCheckedContinuation { (done: CheckedContinuation<String?, Never>) in
            let scanner = ServerCodeScanner(done: done)
            scanner.present(from: presenter)
        }
    }

    private var done: CheckedContinuation<String?, Never>?
    private weak var navigation: UINavigationController?
    /// Kept alive while the scanner is on screen (the view controller only holds its delegate weakly).
    private var keepAlive: ServerCodeScanner?

    private init(done: CheckedContinuation<String?, Never>) {
        self.done = done
    }

    private func present(from presenter: UIViewController) {
        let camera = DataScannerViewController(
            recognizedDataTypes: [.barcode(symbologies: [.qr])],
            qualityLevel: .balanced,
            recognizesMultipleItems: false,
            isHighFrameRateTrackingEnabled: false,
            isPinchToZoomEnabled: true,
            isGuidanceEnabled: true,
            isHighlightingEnabled: true
        )
        camera.delegate = self
        camera.title = "Scan the server's QR code"
        camera.navigationItem.leftBarButtonItem = UIBarButtonItem(systemItem: .cancel, primaryAction: UIAction { [weak self] _ in self?.finish(nil) })
        let nav = UINavigationController(rootViewController: camera)
        nav.modalPresentationStyle = .fullScreen
        nav.presentationController?.delegate = self
        navigation = nav
        keepAlive = self
        presenter.present(nav, animated: true) {
            do {
                try camera.startScanning()
            } catch {
                self.finish(nil)
            }
        }
    }

    private func finish(_ value: String?) {
        guard let done else { return }
        self.done = nil
        if let nav = navigation {
            (nav.viewControllers.first as? DataScannerViewController)?.stopScanning()
            nav.dismiss(animated: true)
        }
        done.resume(returning: value)
        keepAlive = nil
    }

    private func take(_ items: [RecognizedItem]) {
        for item in items {
            if case .barcode(let code) = item, let text = code.payloadStringValue?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty, text.count <= 2048 {
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                return finish(text)
            }
        }
    }

    nonisolated func dataScanner(_ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
        MainActor.assumeIsolated { take(addedItems) }
    }

    nonisolated func dataScanner(_ dataScanner: DataScannerViewController, didTapOn item: RecognizedItem) {
        MainActor.assumeIsolated { take([item]) }
    }

    nonisolated func dataScanner(_ dataScanner: DataScannerViewController, becameUnavailableWithError error: DataScannerViewController.ScanningUnavailable) {
        MainActor.assumeIsolated { finish(nil) }
    }
}

extension ServerCodeScanner: UIAdaptivePresentationControllerDelegate {
    /// Swiped away (a sheet on iPad): the same as Cancel.
    nonisolated func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        MainActor.assumeIsolated { finish(nil) }
    }
}
