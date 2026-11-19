// Settings > About (the web's AboutSection.tsx): which Folevi this is, its version and never a build number, and the
// pages people look for about it on the website. The version lives here only; Settings has no version line at its
// foot any more (the owner, 2026-11-01).
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
            }
        }
    }
}
#endif
