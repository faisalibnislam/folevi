// The first launch's splash while the page boots: the Folevi wordmark on the canvas, nothing more. Gates (sign-in,
// onboarding, unlocking...) are FoleviScreens' GateScreen; "loading" is never a screen: a returning person sees their
// last screen from the launch snapshot, never "Opening your folio...".
import SwiftUI
import FoleviDesign
import FoleviScreens

struct SplashView: View {
    var body: some View {
        ZStack {
            DS.color.canvas.ignoresSafeArea()
            FoleviWordmark(height: 28)
        }
        .accessibilityIdentifier("splash")
    }
}
