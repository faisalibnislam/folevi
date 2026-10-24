// Toasts (web ui/Toast.tsx, the engine's `toast` events and the screens' own): a small capsule above the tab bar,
// the note's buttons or the keyboard, with its button (Undo, Retry, Open) when it has one. VoiceOver reads each one
// as it appears.
import SwiftUI
import UIKit
import FoleviDesign

struct ToastStack: View {
    let model: PhoneModel

    /// Room under the toasts: the keyboard and its toolbar, the note's buttons, or the tab bar.
    private var lift: CGFloat {
        if model.keyboardVisible { return max(0, model.keyboardOverlap - 34) + 54 }
        return model.shownNote != nil ? 78 : 86
    }

    var body: some View {
        VStack(spacing: 8) {
            Spacer(minLength: 0)
            ForEach(model.toasts) { t in
                HStack(spacing: 12) {
                    if t.tone != .info {
                        Image(systemName: t.tone == .error ? "exclamationmark.circle.fill" : "checkmark.circle.fill")
                            .foregroundStyle(t.tone == .error ? DS.color.coral : DS.color.moss)
                    }
                    Text(t.message).foleviFont(.callout).foregroundStyle(DS.color.heading).lineLimit(3)
                    if let title = t.actionTitle {
                        Button(title) { model.runToastAction(t) }
                            .foleviFont(.button)
                            .foregroundStyle(DS.color.heading)
                            .frame(minHeight: 44)
                            .accessibilityIdentifier("toast-action")
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, t.actionTitle == nil ? 12 : 0)
                .background(Capsule().fill(.regularMaterial))
                .overlay(Capsule().strokeBorder(DS.color.line, lineWidth: 0.5))
                .shadow(color: .black.opacity(0.12), radius: 12, y: 4)
                .padding(.horizontal, 16)
                .onTapGesture { model.dismissToast(t.id) }
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .accessibilityIdentifier("toast")
                .onAppear { UIAccessibility.post(notification: .announcement, argument: t.message) }
            }
        }
        .padding(.bottom, lift)
        .animation(.spring(duration: 0.3), value: model.toasts)
    }
}
