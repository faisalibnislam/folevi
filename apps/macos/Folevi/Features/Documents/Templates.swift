import SwiftUI

/// A template's icon on a pastel tile (the web's TemplateTile): the web's Lucide names mapped to SF
/// Symbols, each with the same tint.
struct TemplateTile: View {
    var name: String
    var size: CGFloat = 36

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
            .font(.system(size: size * 0.46, weight: .medium))
            .foregroundStyle(hue.mix(with: FoleviColor.heading, by: 0.22))
            .frame(width: size, height: size)
            .background(hue.opacity(0.17), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            .accessibilityHidden(true)
    }
}

/// "Built-in templates" above your own templates (the web's Templates view): a card per template that starts
/// a new page from it, then the "Your templates" heading.
struct BuiltInTemplatesSection: View {
    var openDocument: (String, Bool) -> Void
    @Environment(AppModel.self) private var app
    @State private var templates: [BuiltInTemplate] = []
    @State private var columns = 3

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if !templates.isEmpty {
                Text("Built-in templates").font(.ui(12, .semibold)).textCase(.uppercase).tracking(0.06 * 12)
                    .foregroundStyle(FoleviColor.inkFaint).accessibilityAddTraits(.isHeader)
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12, alignment: .top), count: columns), spacing: 12) {
                    ForEach(templates) { t in
                        BuiltInTemplateCard(template: t) {
                            Templates.use(t.key, title: t.name, app: app, open: { openDocument($0, false) })
                        }
                    }
                }
                Text("Your templates").font(.ui(12, .semibold)).textCase(.uppercase).tracking(0.06 * 12)
                    .foregroundStyle(FoleviColor.inkFaint).accessibilityAddTraits(.isHeader).padding(.top, 20)
            }
        }
        .padding(.bottom, templates.isEmpty ? 0 : 40)
        .frame(maxWidth: .infinity, alignment: .leading)
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { w in
            let c = w < 560 ? 1 : w < 900 ? 2 : 3
            if c != columns { columns = c }
        }
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
}

private struct BuiltInTemplateCard: View {
    let template: BuiltInTemplate
    var action: () -> Void
    @State private var hovering = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: 12) {
                TemplateTile(name: template.icon)
                VStack(alignment: .leading, spacing: 0) {
                    Text(template.name).font(.ui(16, .medium)).foregroundStyle(FoleviColor.ink)
                    Text(template.description).font(.ui(14)).foregroundStyle(FoleviColor.inkMuted).fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.clear.foleviSurface(.color(FoleviColor.surface), shape: .rounded(8), shadow: hovering ? FoleviShadow.pop : FoleviShadow.card))
            .offset(y: hovering && !reduceMotion ? -1 : 0)
            .animation(reduceMotion ? nil : .timingCurve(0.2, 0.7, 0.2, 1, duration: FoleviMotion.base), value: hovering)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .accessibilityLabel(Text("New page from \(template.name)"))
    }
}

/// "Use" on a template card or row: a new page from it.
struct UseTemplateButton: View {
    let document: DocumentSummary
    var raised = false
    var openDocument: (String, Bool) -> Void
    @Environment(AppModel.self) private var app

    var body: some View {
        Button {
            Templates.use(document.id, title: document.title, app: app, open: { openDocument($0, false) })
        } label: {
            Label("Use", systemImage: "doc.badge.plus")
        }
        .buttonStyle(.folevi(raised ? .secondary : .ghost, .small))
        .accessibilityLabel(Text("New page from template \(document.displayTitle)"))
    }
}

