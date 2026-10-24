// The search field: a sunken, control-radius field with a magnifier, clear button and optional cancel.
import SwiftUI

public struct SearchField: View {
    @Binding var text: String
    let prompt: String
    var onSubmit: () -> Void
    @FocusState private var focused: Bool

    public init(text: Binding<String>, prompt: String = "Search", onSubmit: @escaping () -> Void = {}) {
        _text = text
        self.prompt = prompt
        self.onSubmit = onSubmit
    }

    public var body: some View {
        HStack(spacing: 7) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(Folevi.color.inkFaint)
                .accessibilityHidden(true)
            TextField(prompt, text: $text)
                .textFieldStyle(.plain)
                .foleviFont(.body)
                .foregroundStyle(Folevi.color.ink)
                .focused($focused)
                .submitLabel(.search)
                .onSubmit(onSubmit)
                #if os(iOS)
                .textInputAutocapitalization(.never)
                #endif
                .autocorrectionDisabled()
            if !text.isEmpty {
                Button { text = "" } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(Folevi.color.inkFaint)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear search")
            }
        }
        .padding(.horizontal, 10)
        .frame(minHeight: 38)
        .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.control, style: .continuous).fill(Folevi.color.surfaceSunken))
        .overlay {
            RoundedRectangle(cornerRadius: FoleviTokens.Radius.control, style: .continuous)
                .strokeBorder(focused ? Folevi.color.focus.opacity(0.5) : .clear, lineWidth: 1.5)
        }
        .foleviAnimation(FoleviTokens.Motion.fast, value: focused)
    }
}
