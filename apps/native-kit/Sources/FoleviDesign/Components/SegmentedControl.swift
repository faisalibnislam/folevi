// Segmented control: a sunken track (control radius 10) with a raised thumb (chip radius 6, 4 pt padding,
// 10 = 6 + 4) that slides 180 ms under the chosen item.
import SwiftUI

public struct SegmentedControl<Value: Hashable>: View {
    @Binding var selection: Value
    let options: [(value: Value, title: String)]
    @Namespace private var thumb

    public init(selection: Binding<Value>, options: [(value: Value, title: String)]) {
        _selection = selection
        self.options = options
    }

    public var body: some View {
        HStack(spacing: 0) {
            ForEach(options, id: \.value) { option in
                let selected = option.value == selection
                Button {
                    selection = option.value
                } label: {
                    Text(option.title)
                        .foleviFont(.footnote)
                        .fontWeight(selected ? .semibold : .medium)
                        .lineLimit(1)
                        .foregroundStyle(selected ? Folevi.color.ink : Folevi.color.inkMuted)
                        .padding(.horizontal, 12)
                        .frame(maxWidth: .infinity, minHeight: 28)
                        .background {
                            if selected {
                                RoundedRectangle(cornerRadius: FoleviTokens.Radius.chip, style: .continuous)
                                    .fill(Folevi.color.surfaceRaised)
                                    .foleviShadow(.control, radius: FoleviTokens.Radius.chip)
                                    .matchedGeometryEffect(id: "thumb", in: thumb)
                            }
                        }
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selected ? [.isSelected, .isButton] : .isButton)
            }
        }
        .padding(4)
        .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.control, style: .continuous).fill(Folevi.color.surfaceSunken))
        .foleviAnimation(FoleviTokens.Motion.base, value: selection)
    }
}
