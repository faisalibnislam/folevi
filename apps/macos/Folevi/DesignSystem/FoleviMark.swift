import AppKit
import SwiftUI

/// Folevi's mark, from the brand files (packages/design-tokens/brand/source/favicon.svg): a white F on a
/// black disc. The image in the asset catalog (FoleviMark) is rendered from that file by
/// scripts/brand-icons.mjs, so it matches the web's mark and the app icon exactly.
struct FoleviMark: View {
    var size: CGFloat = 20

    var body: some View {
        Image("FoleviMark")
            .resizable()
            .interpolation(.high)
            .frame(width: size, height: size)
            .accessibilityLabel(Text("Folevi"))
            .accessibilityAddTraits(.isImage)
    }
}

#Preview {
    HStack(spacing: 20) {
        FoleviMark(size: 16)
        FoleviMark(size: 32)
        FoleviMark(size: 96)
    }
    .padding()
}

/// The mark for monochrome places (the menu bar): the F alone, rendered from the brand file by
/// scripts/brand-icons.mjs as a template image (FoleviMenuBar) that the system tints.
enum FoleviMarkShape {
    @MainActor
    static func templateImage(size: CGFloat = 16) -> NSImage {
        let source = NSImage(named: "FoleviMenuBar") ?? NSImage()
        let aspect = source.size.height > 0 ? source.size.width / source.size.height : 260.0 / 340.0
        let image = NSImage(size: NSSize(width: (size * aspect).rounded(), height: size), flipped: false) { rect in
            source.draw(in: rect)
            return true
        }
        image.isTemplate = true
        image.accessibilityDescription = "Folevi"
        return image
    }
}

/// The logo: the mark and the "Folevi" letters (the web's FoleviLogo). The letters take the foreground
/// style, so they follow the text colour in light and dark.
struct FoleviLogo: View {
    var height: CGFloat = 26

    var body: some View {
        ZStack(alignment: .leading) {
            Image("FoleviWordmark")
                .renderingMode(.template)
                .resizable()
                .interpolation(.high)
            FoleviMark(size: height)
        }
        .frame(width: height * 2021 / 512, height: height)
        .accessibilityElement()
        .accessibilityLabel(Text("Folevi"))
        .accessibilityAddTraits(.isImage)
    }
}
