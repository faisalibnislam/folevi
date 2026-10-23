// The first launch's migration screen (docs/MAC_WEBKIT_PLAN.md §8.4): a small native window, "Moving Folevi to its
// new engine", with a line per step. It runs before any main window opens (AppDelegate.migrate) and usually closes
// itself within a few seconds. A step that can't finish stops there with what happened and Try Again or Continue
// Without (each step can run again); a Keychain question is explained before macOS asks it. Nothing here deletes
// anything of the previous app's.
import AppKit

@MainActor
enum MigrationFlow {
    /// At launch, before the first window: false keeps the windows closed (quitting).
    static func runAtLaunch() async -> Bool {
        guard !Paths.testing else { return true }
        let migration = ElectronMigration.forThisApp()
        migration.cleanUpIfDue()
        guard migration.isNeeded else { return true }
        let window = MigrationWindow(migration: migration)
        return await window.run()
    }
}

@MainActor
final class MigrationWindow: NSObject, NSWindowDelegate {
    private let migration: ElectronMigration
    private let window: NSWindow
    private var rows: [ElectronMigration.Step: (icon: NSImageView, detail: NSTextField)] = [:]
    private let message = NSTextField(wrappingLabelWithString: "")
    private let buttons = NSStackView()
    private var choice: CheckedContinuation<String, Never>?

    init(migration: ElectronMigration) {
        self.migration = migration
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 480, height: 320), styleMask: [.titled, .closable], backing: .buffered, defer: false)
        super.init()
        window.title = "Folevi"
        window.isReleasedWhenClosed = false
        window.delegate = self
        build()
    }

    private func build() {
        let title = NSTextField(labelWithString: "Moving Folevi to its new engine")
        title.font = .systemFont(ofSize: 17, weight: .semibold)
        let intro = NSTextField(wrappingLabelWithString: "Your sign-ins, keys, library and settings move over once. This takes a few seconds.")
        intro.textColor = .secondaryLabelColor
        let list = NSStackView()
        list.orientation = .vertical
        list.alignment = .leading
        list.spacing = 8
        for step in ElectronMigration.Step.allCases {
            let icon = NSImageView()
            icon.symbolConfiguration = .init(pointSize: 13, weight: .regular)
            icon.contentTintColor = .tertiaryLabelColor
            icon.image = NSImage(systemSymbolName: "circle", accessibilityDescription: "Waiting")
            icon.setContentHuggingPriority(.required, for: .horizontal)
            let name = NSTextField(labelWithString: step.title)
            name.font = .systemFont(ofSize: 13, weight: .medium)
            name.widthAnchor.constraint(equalToConstant: 120).isActive = true
            let detail = NSTextField(labelWithString: "")
            detail.textColor = .secondaryLabelColor
            detail.lineBreakMode = .byTruncatingTail
            detail.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
            let row = NSStackView(views: [icon, name, detail])
            row.spacing = 8
            list.addArrangedSubview(row)
            rows[step] = (icon, detail)
        }
        message.isHidden = true
        message.preferredMaxLayoutWidth = 432
        buttons.orientation = .horizontal
        buttons.spacing = 8
        let stack = NSStackView(views: [title, intro, list, message, buttons])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 14
        stack.setCustomSpacing(6, after: title)
        stack.edgeInsets = NSEdgeInsets(top: 24, left: 24, bottom: 20, right: 24)
        stack.translatesAutoresizingMaskIntoConstraints = false
        let content = NSView()
        content.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: content.leadingAnchor), stack.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            stack.topAnchor.constraint(equalTo: content.topAnchor), stack.bottomAnchor.constraint(lessThanOrEqualTo: content.bottomAnchor),
            intro.widthAnchor.constraint(equalToConstant: 432),
        ])
        window.contentView = content
        window.setContentSize(NSSize(width: 480, height: 320))
    }

    private func show(_ step: ElectronMigration.Step, _ state: String, _ detail: String) {
        guard let row = rows[step] else { return }
        let (symbol, tint, label): (String, NSColor, String)
        switch state {
        case "running": (symbol, tint, label) = ("arrow.triangle.2.circlepath", .secondaryLabelColor, "Moving")
        case "done": (symbol, tint, label) = ("checkmark.circle.fill", .systemGreen, "Done")
        case "skipped": (symbol, tint, label) = ("minus.circle", .tertiaryLabelColor, "Nothing to move")
        case "continued": (symbol, tint, label) = ("arrow.right.circle", .secondaryLabelColor, "Went on without it")
        default: (symbol, tint, label) = ("exclamationmark.circle.fill", .systemOrange, "Stopped")
        }
        row.icon.image = NSImage(systemSymbolName: symbol, accessibilityDescription: label)
        row.icon.contentTintColor = tint
        row.detail.stringValue = detail
    }

    /// Shows a message and buttons, and waits for one.
    private func ask(_ text: String, _ choices: [String]) async -> String {
        message.stringValue = text
        message.isHidden = false
        buttons.arrangedSubviews.forEach { $0.removeFromSuperview() }
        for (i, c) in choices.enumerated() {
            let b = NSButton(title: c, target: self, action: #selector(chose(_:)))
            b.bezelStyle = .push
            if i == 0 { b.keyEquivalent = "\r" }
            buttons.addArrangedSubview(b)
        }
        let answer = await withCheckedContinuation { choice = $0 }
        message.isHidden = true
        buttons.arrangedSubviews.forEach { $0.removeFromSuperview() }
        return answer
    }

    @objc private func chose(_ sender: NSButton) {
        choice?.resume(returning: sender.title)
        choice = nil
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        // Closing the window is quitting: the migration runs again next time.
        choice?.resume(returning: "Quit")
        choice = nil
        return true
    }

    /// What going on without a step means for the person ("If you continue without it, ...").
    private static func consequence(_ step: ElectronMigration.Step) -> String {
        switch step {
        case .sessions: return "you'll sign in to your accounts again."
        case .keys: return "encrypted notes will ask you to approve this Mac again, from another device or with your recovery method."
        case .library: return "Folevi will ask where your library is."
        case .settings: return "Folevi's Mac settings start from their defaults."
        }
    }

    /// The same as a line of its own (the step's detail once the person went on).
    private static func without(_ step: ElectronMigration.Step) -> String {
        let c = consequence(step)
        return c.prefix(1).uppercased() + c.dropFirst()
    }

    func run() async -> Bool {
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate()
        for step in ElectronMigration.Step.allCases {
            if let s = migration.state(step), s.state != "failed" {
                show(step, s.state, s.detail)
                continue
            }
            switch await runStep(step) {
            case .go: continue
            case .quit:
                window.close()
                NSApp.terminate(nil)
                return false
            }
        }
        migration.finish()
        // A moment to see it finished.
        try? await Task.sleep(nanoseconds: 600_000_000)
        window.close()
        return true
    }

    /// What happens after a step: the next one, or quitting.
    private enum Next { case go, quit }

    /// One step until it's done or the person goes on without it.
    private func runStep(_ step: ElectronMigration.Step) async -> Next {
        var allowPrompt = false
        while true {
            show(step, "running", "")
            do {
                try await migration.run(step, allowPrompt: allowPrompt)
                let s = migration.state(step)
                show(step, s?.state ?? "done", s?.detail ?? "")
                return .go
            } catch let f as ElectronMigration.Failure {
                show(step, "failed", "")
                if f.needsPermission && !allowPrompt {
                    let a = await ask("macOS will now ask whether Folevi may use the keys the previous version saved in your Keychain. Choose Always Allow and Folevi carries on.", ["Continue", "Continue Without", "Quit"])
                    if a == "Quit" { return .quit }
                    if a == "Continue Without" {
                        migration.continueWithout(step, because: f.message)
                        show(step, "continued", Self.without(step))
                        return .go
                    }
                    allowPrompt = true
                    continue
                }
                let a = await ask("\(f.message)\nIf you continue without it, \(Self.consequence(step))", ["Try Again", "Continue Without", "Quit"])
                if a == "Quit" { return .quit }
                if a == "Continue Without" {
                    migration.continueWithout(step, because: f.message)
                    show(step, "continued", Self.without(step))
                    return .go
                }
            } catch {
                return .quit
            }
        }
    }
}
