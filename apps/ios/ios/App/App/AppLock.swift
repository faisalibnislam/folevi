// Face ID lock: optional and off until turned on in Settings > This device (the web app asks through
// FoleviNativePlugin). The choice is kept on this device only (UserDefaults), never on Folevi's servers.
// While it's on, a cover hides the app whenever it leaves the screen (so the app switcher's snapshot shows
// the cover, not the note), and coming back after longer than the chosen time asks for Face ID (or Touch ID,
// or the device passcode when those fail) before the cover lifts.
import LocalAuthentication
import UIKit

enum LockSettings {
    private static let enabledKey = "folevi.lock.enabled"
    private static let afterKey = "folevi.lock.after"
    /// The choices Settings offers, in seconds: immediately, 1, 5 and 15 minutes.
    static let choices: [Int] = [0, 60, 300, 900]

    static var enabled: Bool {
        get { UserDefaults.standard.bool(forKey: enabledKey) }
        set { UserDefaults.standard.set(newValue, forKey: enabledKey) }
    }

    /// Seconds in the background before coming back asks to unlock again.
    static var after: Int {
        get { choices.contains(UserDefaults.standard.integer(forKey: afterKey)) ? UserDefaults.standard.integer(forKey: afterKey) : 0 }
        set { UserDefaults.standard.set(choices.contains(newValue) ? newValue : 0, forKey: afterKey) }
    }

    /// What unlocks the app on this device, as the page names it: "faceID", "touchID", "opticID", or "passcode"
    /// (no biometrics set up, the passcode works), or "none" (no passcode either: locking isn't possible).
    static func method() -> String {
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else { return "none" }
        _ = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        switch context.biometryType {
        case .faceID: return "faceID"
        case .touchID: return "touchID"
        case .opticID: return "opticID"
        default: return "passcode"
        }
    }
}

@MainActor
final class AppLock {
    static let shared = AppLock()

    private weak var window: UIWindow?
    private var cover: LockCover?
    private var locked = false
    private var authenticating = false
    private var leftAt: Date?
    /// Whether coming on screen should ask by itself: at launch and after the background, not after a canceled prompt.
    private var askOnReturn = false

    /// At launch: with the lock on, the app starts covered and asks to unlock once it's on screen.
    func attach(to window: UIWindow) {
        self.window = window
        if LockSettings.enabled {
            locked = true
            askOnReturn = true
            showCover()
        }
    }

    /// Leaving the screen (the app switcher, Control Center, another app): cover it before iOS takes its snapshot.
    func willResignActive() {
        guard LockSettings.enabled, !authenticating else { return }
        showCover()
    }

    func didEnterBackground() {
        guard !authenticating else { return }
        leftAt = Date()
        askOnReturn = true
        if LockSettings.enabled { showCover() }
    }

    func didBecomeActive() {
        guard LockSettings.enabled else {
            locked = false
            hideCover()
            return
        }
        if authenticating { return }
        if let leftAt, Date().timeIntervalSince(leftAt) >= TimeInterval(LockSettings.after) { locked = true }
        leftAt = nil
        let ask = askOnReturn
        askOnReturn = false
        // A canceled prompt leaves the cover and its Unlock button; it doesn't ask again by itself.
        if !locked { hideCover() } else if ask { unlock() }
    }

    /// Asks for Face ID (or the passcode). Canceling leaves the cover with its Unlock button.
    func unlock() {
        guard !authenticating else { return }
        let context = LAContext()
        context.localizedFallbackTitle = "Use passcode"
        var error: NSError?
        // Nothing can unlock this device any more (its passcode was removed): locking would shut the person out.
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
            locked = false
            hideCover()
            return
        }
        authenticating = true
        cover?.setWaiting(true)
        context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "Unlock Folevi") { success, _ in
            Task { @MainActor in
                self.authenticating = false
                self.cover?.setWaiting(false)
                if success {
                    self.locked = false
                    self.hideCover()
                }
            }
        }
    }

    /// Turning the lock on proves it works first: one successful unlock.
    static func confirm(reason: String) async -> Bool {
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else { return false }
        return (try? await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason)) ?? false
    }

    private func showCover() {
        guard let window else { return }
        if let cover {
            window.bringSubviewToFront(cover)
            cover.alpha = 1
            return
        }
        let next = LockCover(frame: window.bounds) { [weak self] in self?.unlock() }
        next.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        window.addSubview(next)
        cover = next
    }

    private func hideCover() {
        guard let cover else { return }
        self.cover = nil
        UIView.animate(withDuration: 0.2, animations: { cover.alpha = 0 }, completion: { _ in cover.removeFromSuperview() })
    }
}

/// What shows instead of the app while it's locked or off screen: the mark, and a way to unlock.
private final class LockCover: UIView {
    private let button = UIButton(configuration: .filled())
    private let onUnlock: () -> Void

    init(frame: CGRect, onUnlock: @escaping () -> Void) {
        self.onUnlock = onUnlock
        super.init(frame: frame)
        backgroundColor = .systemBackground

        let mark = UIImageView(image: UIImage(named: "Mark")?.withRenderingMode(.alwaysTemplate))
        mark.tintColor = .label
        mark.contentMode = .scaleAspectFit
        mark.translatesAutoresizingMaskIntoConstraints = false
        mark.widthAnchor.constraint(equalToConstant: 56).isActive = true
        mark.heightAnchor.constraint(equalToConstant: 56).isActive = true

        let title = UILabel()
        title.text = "Folevi is locked"
        title.font = .preferredFont(forTextStyle: .headline)
        title.textColor = .label
        title.adjustsFontForContentSizeCategory = true

        var config = UIButton.Configuration.filled()
        config.title = Self.unlockTitle()
        config.baseBackgroundColor = .label
        config.baseForegroundColor = .systemBackground
        config.cornerStyle = .medium
        config.contentInsets = NSDirectionalEdgeInsets(top: 10, leading: 18, bottom: 10, trailing: 18)
        button.configuration = config
        button.addAction(UIAction { [weak self] _ in self?.onUnlock() }, for: .primaryActionTriggered)

        let stack = UIStackView(arrangedSubviews: [mark, title, button])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 16
        stack.setCustomSpacing(24, after: title)
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: centerYAnchor),
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func setWaiting(_ waiting: Bool) {
        button.isEnabled = !waiting
    }

    private static func unlockTitle() -> String {
        switch LockSettings.method() {
        case "faceID": return "Unlock with Face ID"
        case "touchID": return "Unlock with Touch ID"
        case "opticID": return "Unlock with Optic ID"
        default: return "Unlock"
        }
    }
}
