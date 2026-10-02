import SwiftUI

/// Dialog widths, as on the web: sm 384, md 512, lg 768.
enum FoleviDialogSize {
    case sm, md, lg
    var width: CGFloat {
        switch self {
        case .sm: return 384
        case .md: return 512
        case .lg: return 768
        }
    }
}

/// The web's Dialog shell: a serif 21pt title with an optional description and a close button, the body,
/// and an optional footer on a sunken band. Escape closes (the sheet's cancel action).
struct FoleviDialogShell<Content: View, Footer: View>: View {
    var title: String
    var description: String?
    var size: FoleviDialogSize = .md
    var onClose: () -> Void
    @ViewBuilder var content: Content
    @ViewBuilder var footer: Footer

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(FoleviType.display(21))
                        .tracking(FoleviType.displayTracking(21))
                        .cssLineHeight(28, family: .serif, size: 21, weight: .semibold) // the web's 28px title line
                        .foregroundStyle(FoleviColor.heading)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isHeader)
                    if let description {
                        Text(description)
                            .font(.ui(13))
                            .uiLineHeight(13 * 1.4286, size: 13)
                            .foregroundStyle(FoleviColor.inkMuted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                IconButton(systemImage: "xmark", label: "Close", size: 32, action: onClose)
            }
            .padding(.horizontal, 24)
            .padding(.top, 20)
            .padding(.bottom, 8)
            content
                .padding(.horizontal, 24)
                .padding(.vertical, 16)
                .frame(maxWidth: .infinity, alignment: .leading)
            if Footer.self != EmptyView.self {
                HStack(spacing: 8) {
                    Spacer()
                    footer
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 14)
                .background(FoleviColor.surfaceSunken.opacity(0.6))
                .overlay(alignment: .top) { FoleviColor.line.frame(height: 1) }
            }
        }
        .frame(width: size.width)
        .background(FoleviColor.surface)
        .onExitCommand(perform: onClose)
    }
}

extension FoleviDialogShell where Footer == EmptyView {
    init(title: String, description: String? = nil, size: FoleviDialogSize = .md, onClose: @escaping () -> Void,
         @ViewBuilder content: () -> Content) {
        self.init(title: title, description: description, size: size, onClose: onClose, content: content, footer: { EmptyView() })
    }
}

/// A small confirmation dialog, as the web's Dialog with a footer: the title, a description, optional content
/// (a field to type a name into), Cancel and the action. Return confirms, Escape cancels.
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
    @DialogDismiss private var dismiss

    var body: some View {
        FoleviDialogShell(title: title, description: message, size: .sm, onClose: cancel) {
            // The web always renders the dialog body, so an empty one still adds its 32pt of padding.
            if Content.self != EmptyView.self { content } else { Color.clear.frame(height: 0) }
        } footer: {
            Button(cancelTitle, action: cancel)
                .buttonStyle(.folevi(.secondary, .medium))
                .keyboardShortcut(.cancelAction)
            Button(confirmTitle) { onConfirm() }
                .buttonStyle(.folevi(confirmKind, .medium))
                .keyboardShortcut(.defaultAction)
                .disabled(confirmDisabled || busy)
        }
    }

    private func cancel() {
        onCancel?()
        dismiss()
    }
}

extension FoleviDialog where Content == EmptyView {
    init(title: String, message: String?, confirmTitle: String, confirmKind: FoleviButtonKind = .danger, confirmDisabled: Bool = false,
         busy: Bool = false, onConfirm: @escaping () -> Void) {
        self.init(title: title, message: message, confirmTitle: confirmTitle, confirmKind: confirmKind, confirmDisabled: confirmDisabled,
                  busy: busy, onConfirm: onConfirm) { EmptyView() }
    }
}

/// The web's PromptDialog: one text field in a small dialog (a name for a new folder, a rename…).
/// Cancel and the action; the action stays disabled while the field is empty.
struct FoleviPromptDialog: View {
    var title: String
    var label: String
    var initial: String = ""
    var confirmTitle: String = String(localized: "Save")
    var maxLength = 80
    var onSubmit: (String) -> Void
    @DialogDismiss private var dismiss
    @State private var value = ""
    @FocusState private var focused: Bool

    var body: some View {
        FoleviDialogShell(title: title, size: .sm, onClose: { dismiss() }) {
            VStack(alignment: .leading, spacing: 8) {
                Text(label).font(.ui(13, .medium)).foregroundStyle(FoleviColor.ink)
                    .uiLineHeight(13 * 1.4286, size: 13, weight: .medium)
                TextField("", text: $value)
                    .textFieldStyle(.plain)
                    .font(.ui(16))
                    .focused($focused)
                    .padding(.horizontal, 16)
                    .frame(height: 40)
                    .foleviInputSurface(focused: focused)
                    .onChange(of: value) { _, v in if v.count > maxLength { value = String(v.prefix(maxLength)) } }
                    .onSubmit(submit)
                    .accessibilityLabel(Text(label))
                HStack(spacing: 8) {
                    Spacer()
                    Button("Cancel") { dismiss() }
                        .buttonStyle(.folevi(.secondary, .medium))
                        .keyboardShortcut(.cancelAction)
                    Button(confirmTitle, action: submit)
                        .buttonStyle(.folevi(.primary, .medium))
                        .keyboardShortcut(.defaultAction)
                        .disabled(trimmed.isEmpty)
                }
                .padding(.top, 8)
            }
        }
        .onAppear { value = initial }
        .claimsFocus($focused)
    }

    private var trimmed: String { value.trimmingCharacters(in: .whitespacesAndNewlines) }

    private func submit() {
        guard !trimmed.isEmpty else { return }
        onSubmit(trimmed)
        dismiss()
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
