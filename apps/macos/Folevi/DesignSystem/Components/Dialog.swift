import SwiftUI

/// A small confirmation sheet, as the web's Dialog: a serif title, a description, optional content (a field
/// to type a name into), Cancel and the action. Return confirms, Escape cancels.
struct FoleviDialog<Content: View>: View {
    var title: String
    var message: String?
    var confirmTitle: String
    var confirmKind: FoleviButtonKind = .danger
    var cancelTitle: String = String(localized: "Cancel")
    var confirmDisabled = false
    var busy = false
    var onCancel: (() -> Void)?
    var onConfirm: () -> Void
    @ViewBuilder var content: Content
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(title)
                .font(FoleviType.display(20))
                .tracking(FoleviType.displayTracking(20))
                .foregroundStyle(FoleviColor.heading)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            if let message {
                Text(message)
                    .font(.ui(13))
                    .foregroundStyle(FoleviColor.inkMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            content
            HStack(spacing: 8) {
                Spacer()
                Button(cancelTitle) {
                    onCancel?()
                    dismiss()
                }
                .buttonStyle(.folevi(.quiet, .medium))
                .keyboardShortcut(.cancelAction)
                Button(confirmTitle) { onConfirm() }
                    .buttonStyle(.folevi(confirmKind, .medium))
                    .keyboardShortcut(.defaultAction)
                    .disabled(confirmDisabled || busy)
            }
            .padding(.top, 4)
        }
        .padding(24)
        .frame(width: 420)
        .background(FoleviColor.surface)
    }
}

extension FoleviDialog where Content == EmptyView {
    init(title: String, message: String?, confirmTitle: String, confirmKind: FoleviButtonKind = .danger, confirmDisabled: Bool = false,
         busy: Bool = false, onConfirm: @escaping () -> Void) {
        self.init(title: title, message: message, confirmTitle: confirmTitle, confirmKind: confirmKind, confirmDisabled: confirmDisabled,
                  busy: busy, onConfirm: onConfirm) { EmptyView() }
    }
}

/// "Type X to confirm": a label with the expected text in bold and a field.
struct TypeToConfirmField: View {
    var expected: String
    @Binding var text: String
    var label: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let label {
                Text(label).font(.ui(13))
            } else {
                Text("Type \(Text(expected).bold()) to confirm").font(.ui(13))
            }
            TextField("", text: $text)
                .textFieldStyle(.folevi)
                .autocorrectionDisabled()
        }
    }
}
