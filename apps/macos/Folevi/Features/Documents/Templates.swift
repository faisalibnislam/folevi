import SwiftUI

/// A template's icon on a pastel tile (the web's TemplateTile): the web's Lucide names mapped to SF
/// Symbols, each with the same tint.
struct TemplateTile: View {
    var name: String
    var size: CGFloat = 36
    /// The glyph's size (default: 46% of the tile) and the tile's corner radius.
    var iconSize: CGFloat? = nil
    var cornerRadius: CGFloat = 9

    /// Lucide name → SF Symbol, in the web's order (the order sets the tint).
    private static let icons: [(String, String)] = [
        ("book-open", "book"), ("briefcase", "briefcase"), ("bug", "ladybug"), ("calendar-check", "calendar.badge.checkmark"),
        ("calendar-range", "calendar"), ("chef-hat", "fork.knife"), ("clipboard-list", "list.clipboard"), ("compass", "safari"),
        ("dumbbell", "dumbbell"), ("flask-conical", "flask"), ("graduation-cap", "graduationcap"), ("heart", "heart"),
        ("history", "clock.arrow.circlepath"), ("lightbulb", "lightbulb"), ("messages-square", "bubble.left.and.bubble.right"),
        ("party-popper", "party.popper"), ("pen-line", "pencil.line"), ("plane", "airplane"), ("refresh-cw", "arrow.clockwise"),
        ("scale", "scalemass"), ("sun", "sun.max"), ("target", "target"), ("timer", "timer"),
        ("user-round-search", "person.crop.circle.badge.questionmark"), ("users", "person.2"), ("wallet", "wallet.bifold"),
    ]
    private static let tints = ["#e0607e", "#e8844a", "#d6a21e", "#6fa83a", "#2fa58a", "#3a9cc9", "#5b7fe0", "#8a6ee0", "#c465c9", "#d9738f"]

    var body: some View {
        let index = Self.icons.firstIndex { $0.0 == name }
        let hue = Color(hex: Self.tints[((index ?? 0) * 3) % Self.tints.count]) ?? .gray
        Image(systemName: index.map { Self.icons[$0].1 } ?? "doc.text")
            .font(.system(size: iconSize ?? size * 0.46, weight: .medium))
            .foregroundStyle(hue.mix(with: FoleviColor.heading, by: 0.22))
            .frame(width: size, height: size)
            .background(hue.opacity(0.17), in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .accessibilityHidden(true)
    }
}

/// "Built-in templates" above your own templates (the web's Templates view): a tile per template that
/// creates a note from it.
struct BuiltInTemplatesSection: View {
    var openDocument: (String, Bool) -> Void
    @Environment(AppModel.self) private var app
    @State private var templates: [BuiltInTemplate] = []
    @State private var creating: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if !templates.isEmpty {
                Text("Built-in templates").foleviCapsLabel()
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 260, maximum: 420), spacing: 12)], spacing: 12) {
                    ForEach(templates) { t in
                        Button {
                            create(t)
                        } label: {
                            HStack(alignment: .top, spacing: 12) {
                                TemplateTile(name: t.icon)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(t.name).font(.ui(14, .medium)).foregroundStyle(FoleviColor.heading)
                                    Text(t.description).font(.ui(12.5)).foregroundStyle(FoleviColor.inkMuted).lineLimit(2)
                                }
                                Spacer(minLength: 0)
                                if creating == t.key { ProgressView().controlSize(.small) }
                            }
                            .padding(14)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(FoleviColor.surface, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(FoleviGlass.border))
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .disabled(creating != nil)
                        .accessibilityLabel(Text("New page from \(t.name)"))
                    }
                }
                Text("Your templates").foleviCapsLabel().padding(.top, 20)
            }
        }
        .padding(.top, templates.isEmpty ? 0 : 22)
        .frame(maxWidth: .infinity, alignment: .leading)
        .task { await load() }
    }

    private func load() async {
        guard let session = app.session else { return }
        let key = "templates.builtIn"
        if templates.isEmpty, let cached = try? await session.store.codable([BuiltInTemplate].self, forKey: key) { templates = cached }
        guard app.sync.isOnline, let fresh = try? await session.documents.builtInTemplates() else { return }
        templates = fresh
        try? await session.store.setCodable(fresh, forKey: key)
    }

    private func create(_ t: BuiltInTemplate) {
        guard let session = app.session else { return }
        guard app.sync.isOnline else {
            app.showToast(String(localized: "Templates need a connection. Try again when you're online."))
            return
        }
        let id = ULID.make()
        creating = t.key
        Task {
            defer { creating = nil }
            do {
                try await session.documents.createFromTemplate(id: id, scope: session.scope, templateId: t.key, title: t.name, folderId: nil)
                await session.engine.syncNow()
                openDocument(id, false)
            } catch {
                app.showToast(ConvexService.mapError(error).localizedDescription)
            }
        }
    }
}
