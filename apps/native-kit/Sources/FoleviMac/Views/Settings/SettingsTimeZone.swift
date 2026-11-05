// Settings > Account > Time zone on the Mac (MAC-28): the zones by readable name ("Rio Gallegos, Argentina") with
// their offset from UTC, the chosen one and this Mac's first, then by region; a search field at the top filters
// as you type (a city, a region, an offset like "+5:30" or the id), the arrow keys move and Return picks. A
// Folevi popover, never the system's menu.
#if os(macOS)
import AppKit
import SwiftUI
import FoleviDesign

/// The zones as the picker lists them.
enum TimeZoneChoices {
    struct Choice: Identifiable, Equatable {
        var id: String
        /// "Rio Gallegos"
        var city: String
        /// "America", "Europe"; "Other" for ids without one (UTC, GMT).
        var region: String
        /// "Argentina" for America/Argentina/Rio_Gallegos, else nil.
        var area: String?
        /// "UTC−3", "UTC+5:30", "UTC".
        var offset: String
        /// The group it's listed under: "Chosen", "This Mac" or its region.
        var group: String

        /// "Rio Gallegos, Argentina"
        var name: String { area.map { "\(city), \($0)" } ?? city }
    }

    /// "UTC+5:30" for 19 800 seconds, "UTC−3" for −10 800, "UTC" for 0.
    static func offset(_ seconds: Int) -> String {
        guard seconds != 0 else { return "UTC" }
        let sign = seconds < 0 ? "\u{2212}" : "+"
        let m = abs(seconds) / 60
        return m % 60 == 0 ? "UTC\(sign)\(m / 60)" : "UTC\(sign)\(m / 60):\(String(format: "%02d", m % 60))"
    }

    static func choice(_ id: String, at date: Date, group: String? = nil) -> Choice {
        let parts = id.split(separator: "/").map { $0.replacingOccurrences(of: "_", with: " ") }
        let region = parts.count > 1 ? parts[0] : "Other"
        let city = parts.last ?? id
        let area = parts.count > 2 ? parts[1] : nil
        let seconds = TimeZone(identifier: id)?.secondsFromGMT(for: date) ?? 0
        return Choice(id: id, city: city, region: region, area: area, offset: offset(seconds), group: group ?? region)
    }

    /// Every zone: the chosen one, this Mac's (when it's another), then by region and name.
    static func all(ids: [String], chosen: String, detected: String, at date: Date) -> [Choice] {
        var out: [Choice] = [choice(chosen, at: date, group: "Chosen")]
        if detected != chosen { out.append(choice(detected, at: date, group: "This Mac")) }
        let rest = ids.filter { $0 != chosen && $0 != detected }.map { choice($0, at: date) }
            .sorted { ($0.region == "Other" ? 1 : 0, $0.region, $0.name) < ($1.region == "Other" ? 1 : 0, $1.region, $1.name) }
        return out + rest
    }

    /// The zones that match what's typed: every word in the city, area, region, offset or id.
    static func filter(_ choices: [Choice], _ query: String) -> [Choice] {
        let words = query.lowercased().split(separator: " ").map(String.init)
        guard !words.isEmpty else { return choices }
        return choices.filter { c in
            let hay = "\(c.city) \(c.area ?? "") \(c.region) \(c.offset) \(c.id)".lowercased()
            return words.allSatisfy { hay.contains($0) }
        }
    }
}

/// The time zone's field: an input well with the zone's name and offset; a click opens the picker under it.
struct SettingsTimeZoneSelect: View {
    let value: String
    let save: (String) async -> Bool
    @State private var pending = SettingsPending<String>()
    @State private var anchor = PlannerAnchor()
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let pair = SettingsStyle.pair("select")
        let s = pair.resolve(scheme)
        let label = SettingsStyle.pair("select.label").resolve(scheme)
        let chevron = SettingsStyle.pair("select.chevron").resolve(scheme)
        let c = TimeZoneChoices.choice(pending.shown(value), at: Date())
        Button { open() } label: {
            HStack(spacing: s.gap) {
                Text(c.name).webText(label.text).lineLimit(1).truncationMode(.tail)
                Text(c.offset).webText(label.text).lineLimit(1).foregroundStyle(SettingsColor.v("color-ink-muted", scheme))
                Spacer(minLength: 0)
                WebIconView(.chevronDown, size: 14).opacity(chevron.opacity)
            }
            .padding(s.padding.edgeInsets)
            .frame(height: s.height)
            .frame(maxWidth: .infinity)
            .foregroundStyle(s.color.color)
            .webBox(pair)
            .contentShape(Rectangle())
            .plannerAnchor(anchor)
        }
        .buttonStyle(SettingsHoverOverlayStyle(radius: s.radius))
        .onChange(of: value) { _, v in pending.stored(v) }
        .accessibilityLabel("Time zone: \(c.name), \(c.offset)")
    }

    private func open() {
        guard let v = anchor.view else { return }
        let current = pending.shown(value)
        PlannerPanel.popover(below: v) { close in
            TimeZonePicker(chosen: current) { id in
                close()
                choose(id)
            }
        }
    }

    private func choose(_ id: String) {
        guard id != pending.shown(value) else { return }
        pending.begin(id)
        Task { @MainActor in
            let ok = await save(id)
            guard pending.value == id else { return }
            pending.finish(ok: ok, stored: value)
        }
    }
}

/// The picker: the search field and the zones under their groups.
struct TimeZonePicker: View {
    let chosen: String
    let pick: (String) -> Void
    @State private var query = ""
    @State private var highlighted: String?
    @FocusState private var focused: Bool
    @Environment(\.colorScheme) private var scheme

    private static let ids = TimeZone.knownTimeZoneIdentifiers

    var body: some View {
        let all = TimeZoneChoices.all(ids: Self.ids, chosen: chosen, detected: TimeZone.current.identifier, at: Date())
        let shown = TimeZoneChoices.filter(all, query)
        let panel = WebStyles.named("menu.panel")
        let p = panel.resolve(scheme)
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                WebIconView(.search, size: 14).foregroundStyle(SettingsColor.v("color-ink-muted", scheme))
                TextField("Search time zones", text: $query)
                    .textFieldStyle(.plain)
                    .webText(.role(.subheadline))
                    .focused($focused)
                    .onSubmit { if let id = highlighted ?? shown.first?.id { pick(id) } }
                    .onKeyPress(.downArrow) { move(1, in: shown); return .handled }
                    .onKeyPress(.upArrow) { move(-1, in: shown); return .handled }
            }
            .padding(.horizontal, 10)
            .frame(height: 32)
            .webBox(webFocused(SettingsStyle.pair("input")))
            .padding(4)
            ScrollViewReader { proxy in
                ScrollView(.vertical) {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        if shown.isEmpty {
                            Text("No time zone matches “\(query)”.").webText(.role(.subheadline)).foregroundStyle(SettingsColor.v("color-ink-muted", scheme))
                                .padding(.horizontal, 10).padding(.vertical, 8)
                        }
                        ForEach(Array(shown.enumerated()), id: \.element.id) { i, c in
                            if i == 0 || shown[i - 1].group != c.group {
                                Text(c.group.uppercased()).webText(.caps).foregroundStyle(SettingsColor.v("color-ink-faint", scheme))
                                    .padding(.horizontal, 10).padding(.top, i == 0 ? 6 : 12).padding(.bottom, 4)
                            }
                            TimeZoneRow(choice: c, checked: c.id == chosen, highlighted: highlighted == c.id) { pick(c.id) } hover: { over in
                                if over { highlighted = c.id }
                            }
                            .id(c.id)
                        }
                    }
                    .padding(.bottom, 4)
                }
                .frame(height: 320)
                .onChange(of: highlighted) { _, id in if let id { proxy.scrollTo(id) } }
            }
        }
        .padding(p.padding.edgeInsets)
        .frame(width: 340)
        .webBox(panel)
        .onAppear { DispatchQueue.main.async { focused = true } }
        .onChange(of: query) { highlighted = nil }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Time zones")
    }

    private func move(_ by: Int, in shown: [TimeZoneChoices.Choice]) {
        guard !shown.isEmpty else { return }
        let i = highlighted.flatMap { id in shown.firstIndex { $0.id == id } } ?? (by > 0 ? -1 : shown.count)
        highlighted = shown[min(shown.count - 1, max(0, i + by))].id
    }
}

private struct TimeZoneRow: View {
    let choice: TimeZoneChoices.Choice
    let checked: Bool
    let highlighted: Bool
    let pick: () -> Void
    let hover: (Bool) -> Void
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let item = WebStyles.named("menu.item").resolve(scheme)
        Button(action: pick) {
            HStack(spacing: 8) {
                Text(choice.name).webText(.role(.subheadline)).lineLimit(1).truncationMode(.tail)
                    .foregroundStyle(SettingsColor.v(highlighted ? "color-heading" : "color-ink", scheme))
                Spacer(minLength: 8)
                Text(choice.offset).webText(.role(.footnote)).lineLimit(1).monospacedDigit()
                    .foregroundStyle(SettingsColor.v("color-ink-muted", scheme))
                WebIconView(.check, size: 14).opacity(checked ? 1 : 0).foregroundStyle(SettingsColor.v("color-heading", scheme))
            }
            .padding(.horizontal, 10)
            .frame(height: 30)
            .background { if highlighted { RoundedRectangle(cornerRadius: item.radius, style: .circular).fill(SettingsColor.v("color-accent-soft", scheme)) } }
            .contentShape(Rectangle())
        }
        .buttonStyle(SettingsNoHighlight())
        .onHover(perform: hover)
        .accessibilityLabel("\(choice.name), \(choice.offset)")
        .accessibilityAddTraits(checked ? .isSelected : [])
    }
}
#endif
