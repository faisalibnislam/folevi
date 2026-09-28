import SwiftUI

/// The note's tools, floating at the bottom of the page (the web's dock): AI, Insert, Format, Style,
/// Info and Comments. Each opens its panel; pressing the open one again closes it.
struct NoteDock: View {
    @Bindable var nav: NavigationModel
    @Binding var aiOpen: Bool
    var aiAvailable: Bool

    var body: some View {
        HStack(spacing: 2) {
            if aiAvailable {
                item(title: "AI", isActive: aiOpen) { AiIcon(size: 14) } action: {
                    aiOpen.toggle()
                }
            }
            item(.insert, systemImage: "plus")
            item(.format, systemImage: "textformat")
            item(.style, systemImage: "paintbrush.pointed")
            item(.info, systemImage: "info.circle")
            Divider().frame(height: 20).padding(.horizontal, 4)
            item(title: nil, isActive: nav.showInspector && nav.inspectorTab == .comments) {
                Image(systemName: "text.bubble")
            } action: { toggle(.comments) }
            .help(Text("Comments"))
            .accessibilityLabel(Text("Comments"))
        }
        .padding(6)
        .background(FoleviGlass.pop, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(FoleviGlass.border))
        .shadow(color: .black.opacity(0.1), radius: 16, y: 6)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Note tools"))
    }

    private func toggle(_ tab: InspectorTab) {
        if nav.showInspector && nav.inspectorTab == tab {
            nav.showInspector = false
        } else {
            nav.inspectorTab = tab
            nav.showInspector = true
        }
    }

    private func item(_ tab: InspectorTab, systemImage: String) -> some View {
        item(title: tab.title, isActive: nav.showInspector && nav.inspectorTab == tab) {
            Image(systemName: systemImage)
        } action: { toggle(tab) }
    }

    private func item<Icon: View>(title: LocalizedStringKey?, isActive: Bool, @ViewBuilder icon: () -> Icon, action: @escaping () -> Void) -> some View {
        DockButton(title: title, isActive: isActive, icon: icon(), action: action)
    }
}

private struct DockButton<Icon: View>: View {
    var title: LocalizedStringKey?
    var isActive: Bool
    var icon: Icon
    var action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 7) {
                icon.font(.system(size: 13.5, weight: .medium))
                if let title { Text(title).font(.ui(13.5, .medium)) }
            }
            .foregroundStyle(FoleviColor.heading)
            .padding(.horizontal, title == nil ? 9 : 12)
            .frame(height: 34)
            .background(isActive ? FoleviGlass.active : hovering ? FoleviGlass.hover : .clear, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay {
                if isActive { RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(Color.black.opacity(0.06)) }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .accessibilityAddTraits(isActive ? [.isSelected] : [])
    }
}
