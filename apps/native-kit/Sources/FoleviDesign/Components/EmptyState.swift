// An empty state: a quiet glyph, a Spectral title, one line of help and an optional action.
import SwiftUI

public struct EmptyState: View {
    let systemImage: String
    let title: String
    let message: String?
    let actionTitle: String?
    let action: (() -> Void)?

    public init(systemImage: String, title: String, message: String? = nil, actionTitle: String? = nil, action: (() -> Void)? = nil) {
        self.systemImage = systemImage
        self.title = title
        self.message = message
        self.actionTitle = actionTitle
        self.action = action
    }

    public var body: some View {
        VStack(spacing: 10) {
            Group {
                // (`AiMarkGlyph.symbolName`: Foli AI's flower, in its colours.)
                if systemImage == AiMarkGlyph.symbolName {
                    AiMarkGlyph(size: 30)
                } else if let icon = FoleviGlyph.webIcon(systemImage) {
                    WebIconView(icon, size: 30, strokeWidth: 1.5)
                        .foregroundStyle(Folevi.color.inkFaint)
                } else {
                    Image(systemName: systemImage)
                        .font(.system(size: 30, weight: .light))
                        .foregroundStyle(Folevi.color.inkFaint)
                }
            }
                .frame(width: 60, height: 60)
                .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.container, style: .continuous).fill(Folevi.color.surfaceSunken))
                .accessibilityHidden(true)
                .padding(.bottom, 4)
            Text(title)
                .foleviFont(.title2)
                .foregroundStyle(Folevi.color.heading)
                .multilineTextAlignment(.center)
            if let message {
                Text(message)
                    .foleviFont(.callout)
                    .foregroundStyle(Folevi.color.inkMuted)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 320)
            }
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .buttonStyle(.folevi(.secondary))
                    .padding(.top, 6)
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .contain)
    }
}
