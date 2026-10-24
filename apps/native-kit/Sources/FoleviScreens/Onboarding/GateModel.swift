// The full screen shown instead of the app (plan 5.1), driven by the engine's `gate.changed` (revision 3; revision
// 8 adds E2EE setup and device approval as gate actions). The web screen that stands for each gate stays mounted,
// hidden, in the Page View and reports its heading, text, fields and buttons; native draws them in Folevi's own
// look and presses its buttons with `gate.act { action, values }`. The copy is the web's own (the payload's
// `title` and `message`), with native words only where the web leaves them empty.
//
// One model per window. The frame feeds it every `gate.changed` (and the hello reply's gate) or lets it listen to
// the client's events itself (`start()`).
import Foundation
import Observation
import FoleviEngine

/// Which screen a gate is (`GateChangedEvent.gate`).
public enum GateKind: Equatable, Hashable, Sendable {
    case loading, modeChoice, signedOut, emailUnverified, suspended, setupFailed, offline, error
    case deviceLimit, onboarding, librarySetup, libraryLocked, updateRequired, migration, placeMove
    case e2eeLocked, e2eeSetup, e2eeWaiting, e2eeTrust
    case other(String)

    public init(_ raw: String) {
        switch raw {
        case "loading": self = .loading
        case "modeChoice": self = .modeChoice
        case "signedOut": self = .signedOut
        case "emailUnverified": self = .emailUnverified
        case "suspended": self = .suspended
        case "setupFailed": self = .setupFailed
        case "offline": self = .offline
        case "error": self = .error
        case "deviceLimit": self = .deviceLimit
        case "onboarding": self = .onboarding
        case "librarySetup": self = .librarySetup
        case "libraryLocked": self = .libraryLocked
        case "updateRequired": self = .updateRequired
        case "migration": self = .migration
        case "placeMove": self = .placeMove
        case "e2eeLocked": self = .e2eeLocked
        case "e2eeSetup": self = .e2eeSetup
        case "e2eeWaiting": self = .e2eeWaiting
        case "e2eeTrust": self = .e2eeTrust
        default: self = .other(raw)
        }
    }

    public var raw: String {
        switch self {
        case .loading: "loading"
        case .modeChoice: "modeChoice"
        case .signedOut: "signedOut"
        case .emailUnverified: "emailUnverified"
        case .suspended: "suspended"
        case .setupFailed: "setupFailed"
        case .offline: "offline"
        case .error: "error"
        case .deviceLimit: "deviceLimit"
        case .onboarding: "onboarding"
        case .librarySetup: "librarySetup"
        case .libraryLocked: "libraryLocked"
        case .updateRequired: "updateRequired"
        case .migration: "migration"
        case .placeMove: "placeMove"
        case .e2eeLocked: "e2eeLocked"
        case .e2eeSetup: "e2eeSetup"
        case .e2eeWaiting: "e2eeWaiting"
        case .e2eeTrust: "e2eeTrust"
        case .other(let s): s
        }
    }

    /// Kinds that show a screen of their own (loading is the splash or the launch snapshot, never a screen).
    public var isScreen: Bool { self != .loading }
}

/// Which platform the words are for ("on this iPhone", "Check for Updates in the Folevi menu").
public enum DeviceWords: Sendable, Equatable {
    case iPhone, iPad, mac

    public static var current: DeviceWords {
        #if os(macOS)
        return .mac
        #else
        return DeviceKind.isPad ? .iPad : .iPhone
        #endif
    }

    /// "this iPhone", "this iPad", "this Mac".
    public var here: String {
        switch self {
        case .iPhone: "this iPhone"
        case .iPad: "this iPad"
        case .mac: "this Mac"
        }
    }
}

@MainActor
@Observable
public final class GateModel {
    public let client: EngineClient
    let feedback: ScreenFeedback
    let device: DeviceWords

    /// The screen to show, or nil (signed in and ready, or not known yet).
    public private(set) var gate: GateChangedEvent?
    /// What's typed in the screen's fields, by field id.
    public var values: [String: String] = [:]
    /// The method picked on a screen that offers several ways in (an unlock with the passphrase or the recovery key).
    public var method: String?
    /// The button pressed and still running.
    public private(set) var pending: String?
    /// The last press's error (a refused `gate.act`); the payload's own `error` shows otherwise.
    public private(set) var actError: EngineError?
    /// The recovery key was copied, saved or printed (the setup's Continue waits for it, as the web's does).
    public var recoveryKeySaved = false

    @ObservationIgnored private var listener: Task<Void, Never>?

    public init(client: EngineClient, feedback: ScreenFeedback = ScreenFeedback(), device: DeviceWords = .current, gate: GateChangedEvent? = nil) {
        self.client = client
        self.feedback = feedback
        self.device = device
        if let gate { show(gate) }
    }

    /// Listens to the client's `gate.changed` events (frames that route events themselves call `show` instead).
    public func start() {
        guard listener == nil else { return }
        let stream = client.events()
        listener = Task { [weak self] in
            for await event in stream {
                guard let self else { return }
                if case .gateChanged(let e) = event { self.show(e) }
            }
        }
    }

    public func stop() {
        listener?.cancel()
        listener = nil
    }

    /// A new payload from the engine. Typed values survive while the same fields stay on screen.
    public func show(_ event: GateChangedEvent) {
        let previous = gate
        guard event.gate != nil else {
            gate = nil
            values = [:]
            method = nil
            actError = nil
            return
        }
        let sameScreen = previous?.gate == event.gate && previous?.fields.map(\.id) == event.fields.map(\.id)
        if !sameScreen {
            values = values.filter { key, _ in event.fields.contains { $0.id == key } }
            actError = nil
            recoveryKeySaved = false
        }
        // A new error from the engine replaces the last press's.
        if event.error != nil { actError = nil }
        gate = event
        if let m = method, !methodActions.contains(where: { $0.id == m }) { method = nil }
        if method == nil { method = methodActions.first?.id }
        // The wrong secret is cleared so the field is ready for another try (as the web's form does).
        if event.error?.code == "wrong_secret" { for f in event.fields where f.kind == .secret || f.kind == .recoveryKey { values[f.id] = "" } }
    }

    // MARK: What the screen shows

    public var kind: GateKind { gate?.gate.map(GateKind.init) ?? .loading }
    public var isScreen: Bool { gate != nil && kind.isScreen }

    public var title: String {
        if let t = gate?.title, !t.isEmpty { return t }
        return Self.fallbackTitle(kind, device: device)
    }

    public var message: String {
        if let m = gate?.message, !m.isEmpty { return m }
        return Self.fallbackMessage(kind, device: device)
    }

    /// The error to show: the last press's, or the engine's for the screen.
    public var errorMessage: String? { (actError ?? gate?.error)?.message }

    /// Actions that pick a way in with a field of their own (`passphrase` with the passphrase field, `recovery` with
    /// the recovery key's). With more than one, the screen offers them as choices and shows one field at a time.
    public var methodActions: [GateAction] {
        guard let gate else { return [] }
        let bound = gate.actions.filter { a in gate.fields.contains { Self.field($0, belongsTo: a.id) } }
        return bound.count > 1 ? bound : []
    }

    /// The fields on screen now: every field, or the picked method's when there are choices.
    public var visibleFields: [GateField] {
        guard let gate else { return [] }
        let methods = methodActions
        guard !methods.isEmpty, let method else { return gate.fields }
        return gate.fields.filter { f in
            let owner = methods.first { Self.field(f, belongsTo: $0.id) }
            return owner == nil || owner?.id == method
        }
    }

    /// The buttons, in order. With method choices the picked one leads (as the primary button) and the other
    /// methods become "use … instead" switches drawn by the screen.
    public var visibleActions: [GateAction] {
        guard let gate else { return [] }
        let methods = methodActions
        guard !methods.isEmpty else { return gate.actions }
        var out: [GateAction] = []
        if let m = methods.first(where: { $0.id == method }) {
            var lead = m
            lead.style = .primary
            out.append(lead)
        }
        out += gate.actions.filter { a in !methods.contains { $0.id == a.id } }
        return out
    }

    /// The other ways in, for the switches under the primary button.
    public var otherMethods: [GateAction] { methodActions.filter { $0.id != method } }

    public func isEnabled(_ action: GateAction) -> Bool {
        guard action.enabled, pending == nil, gate?.busy != true || Self.allowedWhileBusy(action.id) else { return false }
        // A button whose own field is empty waits for it.
        guard let gate else { return false }
        for f in gate.fields where Self.field(f, belongsTo: action.id) {
            if (values[f.id] ?? "").trimmingCharacters(in: .whitespaces).isEmpty { return false }
        }
        if action.id == "confirmRecovery" {
            for f in gate.fields where f.kind == .code && (values[f.id] ?? "").isEmpty { return false }
        }
        return true
    }

    // MARK: Pressing

    /// Presses a button with what's typed in the fields on screen.
    public func act(_ actionId: String) async {
        guard pending == nil, let gate, let action = gate.actions.first(where: { $0.id == actionId }) else { return }
        pending = actionId
        actError = nil
        defer { pending = nil }
        var sent: [String: String] = [:]
        for f in visibleFields {
            let v = values[f.id] ?? ""
            guard !v.isEmpty else { continue }
            sent[f.id] = f.kind == .recoveryKey ? Self.normalizedRecoveryKey(v) : (f.kind == .code ? v.uppercased().trimmingCharacters(in: .whitespaces) : v)
        }
        do {
            _ = try await client.command(.gateAct(action: action.id, values: sent.isEmpty ? nil : sent))
            if action.style == .destructive { feedback.haptic(.warning) }
        } catch let f as EngineFailure {
            actError = EngineError(code: f.code, message: f.message)
            feedback.haptic(.error)
        } catch {
            actError = EngineError(code: "failed", message: "That didn't work. Try again.")
            feedback.haptic(.error)
        }
    }

    /// Picks another way in (no press).
    public func choose(method id: String) {
        guard methodActions.contains(where: { $0.id == id }) else { return }
        method = id
        actError = nil
        feedback.haptic(.selection)
    }

    // MARK: Rules

    /// Whether a field goes with an action: the same id, or the recovery key's field with `recovery`.
    static func field(_ f: GateField, belongsTo action: String) -> Bool {
        f.id == action || (action == "recovery" && f.id == "recoveryKey") || (action == "unlock" && f.kind == .secret)
    }

    /// Buttons that stay pressable while the screen is busy (stopping a move, cancelling an approval).
    static func allowedWhileBusy(_ id: String) -> Bool { ["stop", "cancel", "cancelApproval", "back"].contains(id) }

    /// "k7qm 2rtx…" as typed or pasted: upper case, groups of four joined by dashes.
    static func normalizedRecoveryKey(_ text: String) -> String {
        let chars = text.uppercased().filter { $0.isLetter || $0.isNumber }
        var groups: [String] = []
        var i = chars.startIndex
        while i < chars.endIndex {
            let j = chars.index(i, offsetBy: 4, limitedBy: chars.endIndex) ?? chars.endIndex
            groups.append(String(chars[i..<j]))
            i = j
        }
        return groups.joined(separator: "-")
    }

    /// Native words where the web left the heading empty.
    static func fallbackTitle(_ kind: GateKind, device: DeviceWords) -> String {
        switch kind {
        case .loading: "Opening your folio…"
        case .modeChoice: "Where should your notes live?"
        case .signedOut: "Sign in to Folevi"
        case .emailUnverified: "Check your inbox"
        case .suspended: "This account is suspended"
        case .setupFailed: "Folevi couldn't start"
        case .offline: "You're offline"
        case .error: "Something went wrong"
        case .deviceLimit: "Too many devices"
        case .onboarding: "Welcome to Folevi"
        case .librarySetup: "Choose a folder for your notes"
        case .libraryLocked: "Unlock your library"
        case .updateRequired: "Update Folevi to keep syncing"
        case .migration: "Move your notes to Folevi"
        case .placeMove: "Moving notes"
        case .e2eeLocked: "Unlock your encrypted notes"
        case .e2eeSetup: "Set up encryption"
        case .e2eeWaiting: "Waiting for your encryption key"
        case .e2eeTrust: "Trust this device?"
        case .other: "Folevi"
        }
    }

    static func fallbackMessage(_ kind: GateKind, device: DeviceWords) -> String {
        switch kind {
        case .updateRequired:
            device == .mac
                ? "This version of Folevi for Mac is too old to sync with your account. Choose Check for Updates in the Folevi menu, then open Folevi again. Your notes on this Mac are safe."
                : "This version of Folevi is too old to sync with your account. Update it from the App Store, then open it again. Your notes on this device are safe."
        case .modeChoice: "Notes on your devices stay in a folder you pick, such as iCloud Drive or Dropbox. Folevi's servers never see them."
        case .offline: "Folevi needs a connection the first time it opens. Connect, and it carries on by itself."
        case .emailUnverified: "Open the confirmation link we emailed you to continue. It expires in 24 hours and works once."
        default: ""
        }
    }
}

/// Whether this is an iPad (a pad layout), without importing UIKit into every caller.
enum DeviceKind {
    @MainActor static var isPad: Bool {
        #if canImport(UIKit)
        return UIDevice.current.userInterfaceIdiom == .pad
        #else
        return false
        #endif
    }
}

#if canImport(UIKit)
import UIKit
#endif
