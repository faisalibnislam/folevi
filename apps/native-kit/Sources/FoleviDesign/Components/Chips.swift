// Chips (24 pt, soft fills, chip radius 6), count badges and dots, avatars and the rounded-square checkbox.
import SwiftUI

public struct Chip: View {
    let title: String
    let systemImage: String?
    let count: Int?
    let isSelected: Bool
    let action: (() -> Void)?

    public init(_ title: String, systemImage: String? = nil, count: Int? = nil, isSelected: Bool = false, action: (() -> Void)? = nil) {
        self.title = title
        self.systemImage = systemImage
        self.count = count
        self.isSelected = isSelected
        self.action = action
    }

    public var body: some View {
        let label = HStack(spacing: 5) {
            if let systemImage { Image(systemName: systemImage).font(.system(size: 11, weight: .semibold)) }
            Text(title).lineLimit(1)
            if let count { Text(count.formatted()).foregroundStyle(isSelected ? Folevi.color.accentInk.opacity(0.75) : Folevi.color.inkFaint) }
        }
        .foleviFont(.caption)
        .fontWeight(.semibold)
        .padding(.horizontal, 9)
        .frame(minHeight: 24)
        .foregroundStyle(isSelected ? Folevi.color.accentInk : Folevi.color.accentSoftInk)
        .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.chip, style: .continuous).fill(isSelected ? Folevi.color.accent : Folevi.color.accentSoft))
        if let action {
            Button(action: action) { label }
                .buttonStyle(.plain)
                .contentShape(Rectangle().inset(by: -10))
                .accessibilityAddTraits(isSelected ? .isSelected : [])
        } else {
            label
        }
    }
}

/// A count badge (ember, for unread and attention) or a plain neutral count.
public struct Badge: View {
    public enum Tone: Sendable { case ember, neutral }
    let count: Int
    let tone: Tone
    public init(count: Int, tone: Tone = .ember) {
        self.count = count
        self.tone = tone
    }

    public var body: some View {
        Text(count > 99 ? "99+" : "\(count)")
            .font(FoleviFonts.font(.ui, size: 10.5, weight: .bold))
            .monospacedDigit()
            .foregroundStyle(tone == .ember ? Color.white : Folevi.color.inkMuted)
            .padding(.horizontal, 5)
            .frame(minWidth: 17, minHeight: 17)
            .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.chip, style: .continuous).fill(tone == .ember ? Folevi.color.ember : Folevi.color.accentSoft))
            .accessibilityLabel("\(count)")
    }
}

/// A small signal dot (ember by default), e.g. "today" or "new".
public struct SignalDot: View {
    let color: Color
    public init(_ color: Color = Folevi.color.ember) { self.color = color }
    public var body: some View {
        RoundedRectangle(cornerRadius: 2, style: .continuous).fill(color).frame(width: 7, height: 7)
    }
}

/// Initials or an image in a rounded square (chip radius: nothing fully round outside the glass).
public struct Avatar: View {
    let name: String
    let image: Image?
    let size: CGFloat
    public init(name: String, image: Image? = nil, size: CGFloat = 28) {
        self.name = name
        self.image = image
        self.size = size
    }

    var initials: String {
        let parts = name.split(separator: " ").prefix(2)
        return parts.compactMap(\.first).map(String.init).joined().uppercased()
    }

    public var body: some View {
        ZStack {
            if let image {
                image.resizable().scaledToFill()
            } else {
                Folevi.color.accentSoft
                Text(initials).font(FoleviFonts.font(.ui, size: size * 0.4, weight: .semibold)).foregroundStyle(Folevi.color.accentSoftInk)
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: FoleviTokens.Radius.chip, style: .continuous))
        .accessibilityLabel(name)
    }
}

/// The rounded-square checkbox (decision D3): fills with moss and a check when done.
public struct Checkbox: View {
    @Binding var isOn: Bool
    let label: String
    public init(isOn: Binding<Bool>, label: String) {
        _isOn = isOn
        self.label = label
    }

    public var body: some View {
        Button { isOn.toggle() } label: {
            ZStack {
                RoundedRectangle(cornerRadius: FoleviTokens.Radius.tiny + 1, style: .continuous)
                    .fill(isOn ? Folevi.color.moss : Folevi.color.surface)
                RoundedRectangle(cornerRadius: FoleviTokens.Radius.tiny + 1, style: .continuous)
                    .strokeBorder(isOn ? Color.clear : Folevi.color.lineStrong, lineWidth: 1.5)
                if isOn { Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundStyle(.white) }
            }
            .frame(width: 20, height: 20)
            .contentShape(Rectangle().inset(by: -12))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityValue(isOn ? "Done" : "Not done")
        .accessibilityAddTraits(.isButton)
        .foleviAnimation(FoleviTokens.Motion.fast, value: isOn)
    }
}
