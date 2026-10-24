// The pieces the screens before the app share (gates, sign-in, onboarding): the page with the logo, title and text
// (ModeChoice.tsx's PRE_APP_PAGE: centred, at most 460 wide, Spectral 34 titles on iPhone and iPad, 32 on the Mac),
// labelled fields, the big choice cards, inline alerts and the full-width buttons (50 tall on touch, 44 on the Mac).
import SwiftUI
import FoleviDesign
import FoleviEngine

/// The page every screen before the app sits on.
public struct PreAppPage<Content: View>: View {
    let title: String
    let lede: String?
    let showsLogo: Bool
    let identifier: String
    @ViewBuilder let content: () -> Content

    public init(title: String, lede: String? = nil, showsLogo: Bool = true, identifier: String, @ViewBuilder content: @escaping () -> Content) {
        self.title = title
        self.lede = lede
        self.showsLogo = showsLogo
        self.identifier = identifier
        self.content = content
    }

    public var body: some View {
        GeometryReader { geo in
            ScrollView {
                VStack(spacing: 28) {
                    VStack(spacing: 18) {
                        if showsLogo { FoleviWordmark(height: 26) }
                        Text(title)
                            .font(FoleviFonts.font(.display, size: PreApp.titleSize, weight: .semibold, relativeTo: .largeTitle))
                            .tracking(-0.02 * PreApp.titleSize)
                            .foregroundStyle(Folevi.color.heading)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityAddTraits(.isHeader)
                            .accessibilityIdentifier("gate-title")
                        if let lede, !lede.isEmpty {
                            Text(lede)
                                .foleviFont(.body)
                                .foregroundStyle(Folevi.color.inkMuted)
                                .multilineTextAlignment(.center)
                                .fixedSize(horizontal: false, vertical: true)
                                .padding(.horizontal, 8)
                                .accessibilityIdentifier("gate-message")
                        }
                    }
                    VStack(spacing: 12) { content() }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 40)
                .frame(maxWidth: 460)
                .frame(maxWidth: .infinity, minHeight: geo.size.height)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .background(Folevi.color.canvas.ignoresSafeArea())
        .accessibilityIdentifier(identifier)
    }
}

enum PreApp {
    #if os(macOS)
    static let titleSize: CGFloat = 32
    static let buttonHeight: CGFloat = 44
    static let fieldHeight: CGFloat = 40
    #else
    static let titleSize: CGFloat = 34
    static let buttonHeight: CGFloat = 50
    static let fieldHeight: CGFloat = 48
    #endif
}

/// A full-width button of the screens before the app.
public struct PreAppButton: View {
    let title: String
    let kind: FoleviButtonKind
    let busy: Bool
    let systemImage: String?
    let action: () -> Void

    public init(_ title: String, kind: FoleviButtonKind = .primary, busy: Bool = false, systemImage: String? = nil, action: @escaping () -> Void) {
        self.title = title
        self.kind = kind
        self.busy = busy
        self.systemImage = systemImage
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                if busy {
                    ProgressView().controlSize(.small)
                } else if let systemImage {
                    Image(systemName: systemImage).font(.system(size: 17, weight: .semibold))
                }
                Text(title)
            }
            .frame(maxWidth: .infinity, minHeight: PreApp.buttonHeight)
        }
        .buttonStyle(FoleviButtonStyle(kind, size: .large, fullWidth: true))
        .accessibilityAddTraits(busy ? .updatesFrequently : [])
    }
}

/// The Sign in with Apple button: black on light, white on dark (Apple's own style), its mark and words.
struct AppleButton: View {
    @Environment(\.colorScheme) private var scheme
    let busy: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if busy { ProgressView().controlSize(.small).tint(scheme == .dark ? .black : .white) } else { Image(systemName: "apple.logo").font(.system(size: 18, weight: .medium)) }
                Text("Continue with Apple").font(FoleviFonts.font(.ui, size: PreApp.buttonHeight >= 50 ? 17 : 15, weight: .semibold))
            }
            .foregroundStyle(scheme == .dark ? Color.black : Color.white)
            .frame(maxWidth: .infinity, minHeight: PreApp.buttonHeight)
            .background(RoundedRectangle(cornerRadius: Folevi.radius.control, style: .continuous).fill(scheme == .dark ? Color.white : Color.black))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(busy)
        .accessibilityIdentifier("sign-in-apple")
    }
}

/// Google's "G" in its four colours (the web's GoogleMark), for "Continue with Google".
struct GoogleMark: View {
    var body: some View {
        Canvas { ctx, size in
            let s = min(size.width, size.height)
            let r = s * 0.42, w = s * 0.18
            let c = CGPoint(x: size.width / 2, y: size.height / 2)
            func arc(_ from: Double, _ to: Double, _ color: Color) {
                var p = Path()
                p.addArc(center: c, radius: r, startAngle: .degrees(from), endAngle: .degrees(to), clockwise: false)
                ctx.stroke(p, with: .color(color), style: StrokeStyle(lineWidth: w, lineCap: .butt))
            }
            arc(-40, 45, Color(red: 0.26, green: 0.52, blue: 0.96))
            arc(45, 135, Color(red: 0.20, green: 0.66, blue: 0.33))
            arc(135, 200, Color(red: 0.98, green: 0.74, blue: 0.02))
            arc(200, 320, Color(red: 0.92, green: 0.26, blue: 0.21))
            var bar = Path()
            bar.addRect(CGRect(x: c.x, y: c.y - w / 2, width: r + w / 2, height: w))
            ctx.fill(bar, with: .color(Color(red: 0.26, green: 0.52, blue: 0.96)))
        }
        .frame(width: 18, height: 18)
        .accessibilityHidden(true)
    }
}

/// A big answer (ModeChoice.tsx `ChoiceButton`, the phone and tablet style): icon tile, a caption for the one
/// Folevi suggests, name and line under it, chevron or spinner.
struct ChoiceCard<Icon: View>: View {
    let title: String
    let detail: String
    let recommended: Bool
    let busy: Bool
    let identifier: String
    @ViewBuilder let icon: () -> Icon
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 14) {
                icon()
                    .frame(width: 40, height: 40)
                    .background(RoundedRectangle(cornerRadius: Folevi.radius.small, style: .continuous).fill(Folevi.color.ink.opacity(0.06)))
                VStack(alignment: .leading, spacing: 2) {
                    if recommended {
                        Text("Recommended").foleviFont(.caps).foregroundStyle(Folevi.color.inkMuted)
                    }
                    Text(title).foleviFont(.headline).foregroundStyle(Folevi.color.heading)
                    Text(detail).foleviFont(.callout).foregroundStyle(Folevi.color.inkMuted).fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if busy {
                    ProgressView().controlSize(.small)
                } else {
                    Image(systemName: "chevron.right").font(.system(size: 14, weight: .semibold)).foregroundStyle(Folevi.color.inkFaint)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .frame(minHeight: 72)
            .background(
                RoundedRectangle(cornerRadius: Folevi.radius.container, style: .continuous)
                    .fill(Folevi.color.surface)
                    .shadow(color: .black.opacity(0.05), radius: 1.5, y: 1)
            )
            .overlay(
                RoundedRectangle(cornerRadius: Folevi.radius.container, style: .continuous)
                    .strokeBorder(recommended ? Folevi.color.heading.opacity(0.85) : Folevi.color.line, lineWidth: recommended ? 1.5 : 0.5)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(PressScale())
        .accessibilityElement(children: .combine)
        .accessibilityHint(recommended ? "Recommended" : "")
        .accessibilityIdentifier(identifier)
    }
}

/// Shrinks a little while pressed (the web's active:scale-[0.985]); not under Reduce Motion.
struct PressScale: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.985 : 1)
            .opacity(configuration.isPressed ? 0.92 : 1)
            .animation(.folevi(0.12), value: configuration.isPressed)
    }
}

/// A form field with its label above (fields.tsx `Field` and `PasswordField`).
public struct LabeledField: View {
    public enum Kind: Sendable { case text, email, name, password, newPassword, code, recoveryKey }

    let label: String
    let placeholder: String
    let kind: Kind
    @Binding var text: String
    let hint: String?
    let error: String?
    let identifier: String
    let submit: (() -> Void)?
    @State private var reveal = false

    public init(_ label: String, text: Binding<String>, kind: Kind = .text, placeholder: String = "", hint: String? = nil, error: String? = nil, identifier: String, submit: (() -> Void)? = nil) {
        self.label = label
        self._text = text
        self.kind = kind
        self.placeholder = placeholder
        self.hint = hint
        self.error = error
        self.identifier = identifier
        self.submit = submit
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).foleviFont(.footnote).fontWeight(.semibold).foregroundStyle(Folevi.color.ink)
            HStack(spacing: 8) {
                input
                if kind == .password || kind == .newPassword {
                    Button { reveal.toggle() } label: {
                        Image(systemName: reveal ? "eye.slash" : "eye").foregroundStyle(Folevi.color.inkMuted)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(reveal ? "Hide password" : "Show password")
                }
            }
            .padding(.horizontal, 12)
            .frame(minHeight: PreApp.fieldHeight)
            .background(RoundedRectangle(cornerRadius: Folevi.radius.control, style: .continuous).fill(Folevi.color.surface))
            .overlay(RoundedRectangle(cornerRadius: Folevi.radius.control, style: .continuous).strokeBorder(error == nil ? Folevi.color.lineStrong : Folevi.color.destructive, lineWidth: error == nil ? 0.75 : 1.2))
            if let error {
                Text(error).foleviFont(.footnote).foregroundStyle(Folevi.color.destructive).fixedSize(horizontal: false, vertical: true)
            } else if let hint {
                Text(hint).foleviFont(.footnote).foregroundStyle(Folevi.color.inkMuted).fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder private var input: some View {
        let secure = (kind == .password || kind == .newPassword) && !reveal
        Group {
            if secure {
                SecureField(placeholder, text: $text)
            } else {
                TextField(placeholder, text: $text)
            }
        }
        .textFieldStyle(.plain)
        .font(kind == .code || kind == .recoveryKey ? FoleviFonts.font(.mono, size: 18, weight: .medium) : FoleviTextStyle.body.font)
        .foregroundStyle(Folevi.color.ink)
        .autocorrectionDisabled()
        #if os(iOS)
        .textInputAutocapitalization(kind == .name ? .words : (kind == .recoveryKey || kind == .code ? .characters : .never))
        .keyboardType(kind == .email ? .emailAddress : (kind == .code && placeholder.isEmpty ? .numberPad : .default))
        #endif
        .textContentType(contentType)
        .onSubmit { submit?() }
        .accessibilityLabel(label)
        .accessibilityIdentifier(identifier)
    }

    private var contentType: TextContentTypeValue? {
        switch kind {
        case .email: .username
        case .password: .password
        case .newPassword: .newPassword
        case .name: .name
        case .code: placeholder.isEmpty ? .oneTimeCode : nil
        default: nil
        }
    }
}

#if os(iOS)
typealias TextContentTypeValue = UITextContentType
#else
typealias TextContentTypeValue = NSTextContentType
#endif

/// An alert box in a form (the web's `Alert`): danger, info or success.
struct InlineAlert: View {
    enum Tone { case danger, info, success }
    let text: String
    let tone: Tone

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: tone == .danger ? "exclamationmark.circle.fill" : (tone == .success ? "checkmark.circle.fill" : "info.circle.fill"))
                .foregroundStyle(color)
            Text(text).foleviFont(.callout).foregroundStyle(Folevi.color.ink).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: Folevi.radius.control, style: .continuous).fill(background))
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(tone == .danger ? .isStaticText : [])
    }

    private var color: Color {
        switch tone {
        case .danger: Folevi.color.destructive
        case .info: Folevi.color.inkMuted
        case .success: Folevi.color.success
        }
    }

    private var background: Color {
        switch tone {
        case .danger: Folevi.color.destructiveSoft
        case .info: Folevi.color.surfaceSunken
        case .success: Folevi.color.mossSoft
        }
    }
}

/// A text-only button under a form ("Forgot your password?", "Keep notes on my devices instead").
struct TextLinkButton: View {
    let title: String
    let identifier: String
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(title).foleviFont(.callout).fontWeight(.medium).foregroundStyle(Folevi.color.accent)
                .frame(minHeight: 44)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(identifier)
    }
}

extension GateAction.Style {
    var buttonKind: FoleviButtonKind {
        switch self {
        case .primary: .primary
        case .secondary: .secondary
        case .quiet: .ghost
        case .destructive: .destructive
        }
    }
}
