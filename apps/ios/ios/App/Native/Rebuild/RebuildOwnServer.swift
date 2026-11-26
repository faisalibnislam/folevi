// "Your own server" on the native sign-in screen (docs/self-hosting/CONTRACT.md §6.1), as today's app has it
// (apps/web components/app/ShellSignIn.tsx state "server" and components/server/OwnServerSignIn.tsx): the
// server's address, typed or read from its QR code, checked here (ShellServer.lookUp: https, or http only on the
// home network, its /.well-known/folevi.json, the versions), the server it names, then "Sign in to <name>", which
// opens that server's sign-in screen as a new place (the same as the page's places.addServerPlace). An iOS sheet
// with Close in the header; the wording is today's app's.
import AVFoundation
import SwiftUI
import UIKit
import VisionKit
import FoleviDesign

struct RebuildOwnServerSheet: View {
    let close: () -> Void
    @State private var address = ""
    @State private var error: String?
    @State private var busy = false
    @State private var found: ShellServer?
    @State private var opening = false
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text("Enter the address of a Folevi server. It\u{2019}s added beside your other places.")
                        .webText(.role(.body))
                        .foregroundStyle(DS.color.inkMuted)
                        .fixedSize(horizontal: false, vertical: true)
                    if let found {
                        foundCard(found)
                    } else {
                        form
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 8)
                .padding(.bottom, 24)
            }
            .scrollBounceBehavior(.basedOnSize)
            .navigationTitle("Your own server")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .close, action: close)
                        .accessibilityIdentifier("own-server-close")
                }
            }
        }
        .accessibilityIdentifier("own-server-sheet")
    }

    // MARK: The address

    @ViewBuilder private var form: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Server address")
                .webText(.role(.subheadline, weight: FoleviTokens.FontWeight.semibold))
                .foregroundStyle(DS.color.heading)
            TextField("notes.example.com", text: $address)
                .webText(.role(.body))
                .keyboardType(.URL)
                .textContentType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.continue)
                .focused($focused)
                .onSubmit { go(address) }
                .padding(.horizontal, 16)
                .frame(height: 50)
                .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(DS.color.ink.opacity(0.06)))
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(error == nil ? .clear : DS.color.destructive, lineWidth: 1.5))
                .accessibilityLabel("Server address")
                .accessibilityIdentifier("own-server-address")
            Text(error ?? "The address the person who runs it gave you, or the one on your NAS\u{2019}s Folevi page.")
                .webText(.role(.footnote))
                .foregroundStyle(error == nil ? DS.color.inkMuted : DS.color.destructive)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier(error == nil ? "own-server-hint" : "own-server-error")
        }
        .onAppear { focused = true }
        VStack(spacing: 12) {
            Button { go(address) } label: {
                HStack(spacing: 8) {
                    if busy { ProgressView().tint(DS.color.canvas) } else { WebIconView(.arrowRight, size: 17, strokeWidth: 2) }
                    Text("Continue")
                }
                .webText(.role(.headline, weight: FoleviTokens.FontWeight.semibold))
                .foregroundStyle(DS.color.canvas)
                .frame(maxWidth: .infinity)
                .frame(height: 38)
            }
            .buttonStyle(.glassProminent)
            .buttonBorderShape(.capsule)
            .controlSize(.large)
            .tint(DS.color.heading)
            .disabled(busy)
            .accessibilityIdentifier("own-server-continue")
            if ServerCodeScanner.supported {
                Button { scan() } label: {
                    HStack(spacing: 8) {
                        WebIconView(.qrCode, size: 17, strokeWidth: 2)
                        Text("Scan QR code")
                    }
                    .webText(.role(.headline, weight: FoleviTokens.FontWeight.semibold))
                    .foregroundStyle(DS.color.heading)
                    .frame(maxWidth: .infinity)
                    .frame(height: 38)
                }
                .buttonStyle(.glass)
                .buttonBorderShape(.capsule)
                .controlSize(.large)
                .disabled(busy)
                .accessibilityIdentifier("own-server-scan")
            }
        }
    }

    private func go(_ value: String) {
        guard !busy else { return }
        error = nil
        guard ShellServer.normalizeOrigin(value) != nil else {
            error = value.trimmingCharacters(in: .whitespaces).isEmpty ? "Enter the server\u{2019}s address." : ShellServer.Problem.badAddress.message
            return
        }
        busy = true
        Task { @MainActor in
            let r = await ShellServer.lookUp(value, appVersion: ShellServer.appVersion)
            busy = false
            switch r {
            case .success(let server):
                focused = false
                withAnimation(.snappy(duration: 0.25)) { found = server }
            case .failure(let problem):
                error = problem.message
            }
        }
    }

    private func scan() {
        Task { @MainActor in
            switch await ServerCodeScanner.readiness() {
            case .unsupported: error = "This device can\u{2019}t scan QR codes. Type the server\u{2019}s address instead."
            case .denied: error = "Folevi can\u{2019}t use the camera. Turn on Camera for Folevi in the Settings app, or type the server\u{2019}s address instead."
            case .ready:
                guard let presenter = UIApplication.shared.foleviTopController else {
                    error = "Folevi couldn\u{2019}t open the scanner. Type the server\u{2019}s address instead."
                    return
                }
                guard let text = await ServerCodeScanner.scan(from: presenter) else { return }
                let value = Self.address(fromCode: text)
                address = value
                go(value)
            }
        }
    }

    /// The address in a QR code's text (the web's addressFromCode): a link's origin (an invite link on the server
    /// too), else the text itself.
    static func address(fromCode text: String) -> String {
        let raw = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if let url = URL(string: raw), let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http", let host = url.host {
            return "\(scheme)://\(host)\(url.port.map { ":\($0)" } ?? "")"
        }
        return raw
    }

    // MARK: The server it names

    private func foundCard(_ server: ShellServer) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 12) {
                WebIconView(.server, size: 18, strokeWidth: 1.9)
                    .foregroundStyle(DS.color.heading)
                    .frame(width: 40, height: 40)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(DS.color.canvas))
                VStack(alignment: .leading, spacing: 2) {
                    Text(server.name)
                        .webText(.role(.body, weight: FoleviTokens.FontWeight.semibold))
                        .foregroundStyle(DS.color.heading)
                        .lineLimit(1)
                    Text(server.origin.replacingOccurrences(of: #"^https?://"#, with: "", options: .regularExpression))
                        .webText(.role(.footnote))
                        .foregroundStyle(DS.color.inkMuted)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                Spacer(minLength: 0)
            }
            .padding(12)
            .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(DS.color.ink.opacity(0.06)))
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("own-server-found")
            Button { open(server) } label: {
                HStack(spacing: 8) {
                    if opening { ProgressView().tint(DS.color.canvas) }
                    Text("Sign in to \(server.name)").lineLimit(1)
                }
                .webText(.role(.headline, weight: FoleviTokens.FontWeight.semibold))
                .foregroundStyle(DS.color.canvas)
                .frame(maxWidth: .infinity)
                .frame(height: 38)
            }
            .buttonStyle(.glassProminent)
            .buttonBorderShape(.capsule)
            .controlSize(.large)
            .tint(DS.color.heading)
            .disabled(opening)
            .accessibilityIdentifier("own-server-sign-in")
            Button {
                withAnimation(.snappy(duration: 0.25)) { found = nil }
            } label: {
                Text("Back")
                    .webText(.role(.headline, weight: FoleviTokens.FontWeight.semibold))
                    .foregroundStyle(DS.color.heading)
                    .frame(maxWidth: .infinity)
                    .frame(height: 38)
            }
            .buttonStyle(.glass)
            .buttonBorderShape(.capsule)
            .controlSize(.large)
            .disabled(opening)
            .accessibilityIdentifier("own-server-back")
        }
    }

    /// The server's sign-in screen, as a place of its own (FoleviShellPlugin.placesAddServer does the same for the
    /// page): the app restarts on it, and signing in there makes the account a place on that server.
    private func open(_ server: ShellServer) {
        opening = true
        ShellPlaces.setCurrent(nil, pending: true, server: server)
        close()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { FoleviViewController.restart() }
    }
}

// MARK: - Scanning the server's QR code

/// VisionKit's DataScannerViewController for the server's QR code (apps/mobile ServerCodeScanner.swift, the
/// Capacitor app's): offered only where the device can scan (not the Simulator); with camera access off the
/// person is told so and types the address instead. Nothing is opened from the code here: its address is checked
/// as a typed one.
@MainActor
final class ServerCodeScanner: NSObject, DataScannerViewControllerDelegate {
    enum Readiness { case ready, unsupported, denied }

    static var supported: Bool { DataScannerViewController.isSupported }

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
            ServerCodeScanner(done: done).present(from: presenter)
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
        camera.title = "Scan the server\u{2019}s QR code"
        camera.navigationItem.leftBarButtonItem = UIBarButtonItem(systemItem: .close, primaryAction: UIAction { [weak self] _ in self?.finish(nil) })
        let nav = UINavigationController(rootViewController: camera)
        nav.modalPresentationStyle = .fullScreen
        navigation = nav
        keepAlive = self
        presenter.present(nav, animated: true) {
            do { try camera.startScanning() } catch { self.finish(nil) }
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

extension UIApplication {
    /// The controller on top in the key window (a sheet's, when one is up): where the scanner opens.
    @MainActor var foleviTopController: UIViewController? {
        let window = connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows).first(where: \.isKeyWindow)
        var top = window?.rootViewController
        while let next = top?.presentedViewController, !next.isBeingDismissed { top = next }
        return top
    }
}
