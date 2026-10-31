// "Export" under an agent's or research report on the Mac (ChatMessage.tsx AnswerExport): FoleviScreens'
// AiAssistantMessage draws it where the web does, from the button this hands it (AiThread.swift).
#if os(macOS) || os(iOS)
import SwiftUI
import FoleviDesign
import FoleviScreens

/// "Export" under an answer (a row button, `<MoreHorizontal size={12} /> Export`): its menu opens above it.
struct AiExportButton: View {
    let entries: @MainActor () -> [WebMenuEntry]
    @State private var hover = false
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let s = AiLook(scheme: scheme).s("ai.rowbtn")
        WebMenuButton(side: .top, entries: entries) {
            HStack(spacing: s.gap) {
                WebIconView(.ellipsis, size: 12)
                Text("Export").webText(s.text).lineLimit(1)
            }
            .padding(.horizontal, s.padding.left)
            .frame(height: s.height)
            // (hover:bg-[var(--glass-hover)] hover:text-heading, as the row's other buttons)
            .foregroundStyle(hover ? (WebStyles.vars["color-heading"]?.resolve(scheme).color ?? s.color.color) : s.color.color)
            .background(RoundedRectangle(cornerRadius: s.radius, style: .circular).fill(hover ? (WebStyles.vars["glass-hover"]?.resolve(scheme).color ?? .clear) : .clear))
            .contentShape(Rectangle())
        }
        .onHover { hover = $0 }
        .accessibilityLabel("Export this answer")
    }
}
#endif
