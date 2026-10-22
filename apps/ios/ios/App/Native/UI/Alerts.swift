// Action sheets and alerts (docs/IOS_POLISH_PLAN.md §4.2; the page calls lib/native/ui.ts confirmAction(),
// askText() and chooseAction()): iOS's own UIAlertController, so a confirmation ("Delete "Brainstorming"?"),
// a rename (one text field) or a short choice looks and behaves as it does in every iOS app. On iPad an action
// sheet is a popover from what the page names (`anchor`).
//
// The page answers with the chosen action's id (and the field's text), or null when the person tapped away.
import Capacitor
import UIKit

enum NativeAlerts {
    struct Action: Equatable {
        let id: String
        let title: String
        let style: UIAlertAction.Style
    }

    struct Field: Equatable {
        var value: String
        var placeholder: String
        var capitalize: UITextAutocapitalizationType
    }

    /// The actions the page sent ([{ id, title, style }]), in its order; at most one cancel. Nil when unusable.
    static func actions(_ raw: [Any]?) -> [Action]? {
        guard let raw, !raw.isEmpty, raw.count <= 12 else { return nil }
        var out: [Action] = []
        var cancel = false
        for item in raw {
            guard let o = item as? [String: Any], let id = o["id"] as? String, !id.isEmpty, let title = o["title"] as? String, !title.isEmpty else { return nil }
            var style: UIAlertAction.Style = .default
            switch o["style"] as? String {
            case "destructive": style = .destructive
            case "cancel":
                // (iOS allows one; a second is an ordinary button.)
                style = cancel ? .default : .cancel
                cancel = true
            default: break
            }
            out.append(Action(id: id, title: String(title.prefix(80)), style: style))
        }
        return out
    }

    static func field(_ raw: [String: Any]?) -> Field? {
        guard let raw else { return nil }
        let cap: UITextAutocapitalizationType
        switch raw["capitalize"] as? String {
        case "none": cap = .none
        case "words": cap = .words
        default: cap = .sentences
        }
        return Field(value: String((raw["value"] as? String ?? "").prefix(500)), placeholder: raw["placeholder"] as? String ?? "", capitalize: cap)
    }

    /// The controller, its buttons answering `answer` (id, field text). Tapping outside an action sheet (or its
    /// cancel) answers nil, as does an alert's cancel.
    @MainActor static func make(style: UIAlertController.Style, title: String?, message: String?, actions: [Action], field: Field?, answer: @escaping (String?, String?) -> Void) -> UIAlertController {
        let alert = UIAlertController(title: title?.isEmpty == true ? nil : title, message: message?.isEmpty == true ? nil : message, preferredStyle: style)
        if let field, style == .alert {
            alert.addTextField { text in
                text.text = field.value
                text.placeholder = field.placeholder
                text.autocapitalizationType = field.capitalize
                text.clearButtonMode = .whileEditing
                text.returnKeyType = .done
            }
        }
        let hasCancel = actions.contains { $0.style == .cancel }
        for a in actions {
            alert.addAction(UIAlertAction(title: a.title, style: a.style) { [weak alert] _ in
                answer(a.style == .cancel ? nil : a.id, alert?.textFields?.first?.text)
            })
        }
        // An action sheet always has a way out (iOS shows none on iPad's popover; tapping outside answers nil).
        if style == .actionSheet && !hasCancel {
            alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in answer(nil, nil) })
        }
        // The confirming button is the bold one (the last that isn't cancel or destructive), as iOS's own alerts.
        if style == .alert, let preferred = alert.actions.last(where: { $0.style == .default }) { alert.preferredAction = preferred }
        return alert
    }
}

/// Answers a tap outside an iPad popover (an action sheet's "cancel" isn't shown there).
private final class PopoverDismissal: NSObject, UIPopoverPresentationControllerDelegate {
    let onDismiss: () -> Void
    init(_ onDismiss: @escaping () -> Void) { self.onDismiss = onDismiss }
    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) { onDismiss() }
}

extension FoleviNativePlugin {
    /// { title?, message?, actions: [{ id, title, style }], anchor? }: { value: id } or { value: null }.
    @objc func actionSheet(_ call: CAPPluginCall) {
        guard let actions = NativeAlerts.actions(call.getArray("actions")) else { return call.reject("An action sheet needs actions") }
        let anchor = LiftPreview.rect(call.getObject("anchor"))
        Task { @MainActor in
            guard self.fromFolevi, let presenter = self.topController() else { return call.reject("Not allowed here") }
            var answered = false
            var keep: PopoverDismissal?
            let answer = { (id: String?, _: String?) in
                guard !answered else { return }
                answered = true
                keep = nil
                call.resolve(["value": id.map { $0 as Any } ?? NSNull()])
            }
            let sheet = NativeAlerts.make(style: .actionSheet, title: call.getString("title"), message: call.getString("message"), actions: actions, field: nil, answer: answer)
            if let popover = sheet.popoverPresentationController, let webView = self.bridge?.webView {
                popover.sourceView = webView
                popover.sourceRect = anchor ?? CGRect(x: webView.bounds.midX, y: webView.bounds.midY, width: 1, height: 1)
                if anchor == nil { popover.permittedArrowDirections = [] }
                let dismissal = PopoverDismissal { answer(nil, nil) }
                keep = dismissal
                popover.delegate = dismissal
            }
            _ = keep
            presenter.present(sheet, animated: true)
        }
    }

    /// { title, message?, actions, field?: { value, placeholder, capitalize } }: { id, text? } or null.
    @objc func alert(_ call: CAPPluginCall) {
        guard let title = call.getString("title"), !title.isEmpty, let actions = NativeAlerts.actions(call.getArray("actions")) else { return call.reject("An alert needs a title and actions") }
        let field = NativeAlerts.field(call.getObject("field"))
        Task { @MainActor in
            guard self.fromFolevi, let presenter = self.topController() else { return call.reject("Not allowed here") }
            let alert = NativeAlerts.make(style: .alert, title: title, message: call.getString("message"), actions: actions, field: field) { id, text in
                guard let id else { return call.resolve(["value": NSNull()]) }
                var result: [String: Any] = ["id": id]
                if field != nil { result["text"] = text ?? "" }
                call.resolve(["value": result])
            }
            presenter.present(alert, animated: true) {
                // A rename starts with the name selected, ready to type over.
                if field != nil, let text = alert.textFields?.first { text.selectAll(nil) }
            }
        }
    }
}
