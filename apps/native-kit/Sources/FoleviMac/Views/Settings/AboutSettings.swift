// Settings > About (the web's AboutSection.tsx): which Folevi this is, its version and never a build number, and the
// pages people look for about it on the website. The version lives here only; Settings has no version line at its
// foot any more (the owner, 2026-11-01). Under the links: the company that operates Folevi with its address and the
// copyright line (FoleviOperator; the owner, 2026-11-27).
#if os(macOS) || os(iOS)
import SwiftUI
import FoleviDesign

struct AboutSettingsView: View {
    let model: MacSettingsModel
    @Environment(\.settingsNative) private var native

    /// The pages About links to (AboutSection.tsx ABOUT_LINKS).
    static let links: [(label: String, path: String)] = [
        ("What's new", "/changelog"),
        ("Privacy policy", "/privacy"),
        ("Terms of service", "/terms"),
        ("AI policy", "/ai-policy"),
        ("Security", "/security"),
        ("Service status", "/status"),
    ]

    var body: some View {
        SettingsCard(model.version, anchor: "about") {
            VStack(alignment: .leading, spacing: native ? 8 : 4) {
                ForEach(Self.links, id: \.path) { link in
                    if native {
                        // The Settings window: links in the system's link style, each saying it leaves for the website.
                        Button {
                            if let url = URL(string: "https://folevi.com\(link.path)") { model.frame.host?.frameOpenExternal(url) }
                        } label: {
                            Label(link.label, systemImage: "arrow.up.right")
                        }
                        #if os(macOS)
                        .buttonStyle(.link)
                        #else
                        .buttonStyle(.borderless)
                        #endif
                        .foleviTooltip("folevi.com\(link.path)")
                    } else {
                        SButton(link.label, icon: .externalLink, variant: .ghost, size: .sm) {
                            if let url = URL(string: "https://folevi.com\(link.path)") { model.frame.host?.frameOpenExternal(url) }
                        }
                        .fixedSize()
                    }
                }
                AboutOperatorView(native: native) { model.frame.host?.frameOpenExternal($0) }
                    .padding(.top, native ? 8 : 6)
            }
        }
    }
}

/// "Operated by Space Cherries LLC" (a link to its website), its postal address and "© 2026 Space Cherries LLC".
struct AboutOperatorView: View {
    let native: Bool
    let open: (URL) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
                Text("Operated by")
                Button(FoleviOperator.name) { open(FoleviOperator.website) }
                    #if os(macOS)
                    .buttonStyle(.link)
                    #else
                    .buttonStyle(.borderless)
                    #endif
                    .foleviTooltip("spacecherries.com")
                    .accessibilityIdentifier("about-operator-link")
            }
            Text(FoleviOperator.address).textSelection(.enabled)
            Text(FoleviOperator.copyright)
        }
        .foleviFont(.footnote)
        .foregroundStyle(Folevi.color.inkMuted)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("about-operator")
    }
}
#endif
