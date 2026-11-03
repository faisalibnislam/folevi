// A name and one button, for a PhoneCardSheet: the phone's PromptDialog (apps/web/src/components/ui/PromptDialog.tsx),
// as New workspace asks for one (app/NewWorkspaceDialog.tsx). The field and the button are New folder's.
#if os(iOS)
import SwiftUI
import FoleviDesign

public struct PhoneNameForm: View {
    let label: String
    let placeholder: String
    let confirm: String
    let submit: (String) -> Void
    @State private var name: String
    @FocusState private var focused: Bool
    @Environment(\.colorScheme) private var scheme

    /// `submit` gets the name trimmed (never empty).
    public init(label: String, placeholder: String, initial: String = "", confirm: String, submit: @escaping (String) -> Void) {
        self.label = label
        self.placeholder = placeholder
        self.confirm = confirm
        self.submit = submit
        _name = State(initialValue: initial)
    }

    public var body: some View {
        let ink = FoleviTokens.Chrome.ink.resolve(scheme)
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        VStack(alignment: .leading, spacing: 0) {
            Text(label).webText(WebTextStyle(size: 13, leading: 18)).foregroundStyle(FoleviTokens.Chrome.inkMuted.resolve(scheme).color).padding(.horizontal, 4).padding(.bottom, 6)
            TextField("", text: $name, prompt: Text(placeholder).foregroundStyle(FoleviTokens.Chrome.inkFaint.resolve(scheme).color))
                .font(Font(WebTextStyle(size: 17, leading: 22).ctFont))
                .foregroundStyle(ink.color)
                .focused($focused)
                .submitLabel(.done)
                .onSubmit(done)
                .onChange(of: name) { _, v in if v.count > 80 { name = String(v.prefix(80)) } }
                .frame(height: 48)
                .padding(.horizontal, 12)
                .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.panel, style: .continuous).fill(ink.opacity(0.06).color))
            Button(action: done) {
                Text(confirm)
                    .webText(WebTextStyle(size: 17, leading: 22, weight: 600))
                    .foregroundStyle((trimmed.isEmpty ? FoleviTokens.Chrome.inkFaint : FoleviTokens.Chrome.canvas).resolve(scheme).color)
                    .frame(maxWidth: .infinity)
                    .frame(height: 48)
                    .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.panel, style: .continuous).fill(trimmed.isEmpty ? ink.opacity(0.08).color : FoleviTokens.Chrome.heading.resolve(scheme).color))
            }
            .buttonStyle(PhoneCardPressStyle())
            .disabled(trimmed.isEmpty)
            .padding(.top, 20)
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 16)
        .onAppear { focused = true }
    }

    private func done() {
        let t = name.trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty else { return }
        submit(t)
    }
}
#endif
