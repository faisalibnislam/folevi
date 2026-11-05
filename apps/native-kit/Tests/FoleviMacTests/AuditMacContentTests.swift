// The UI audit's Mac lists, note editor, Settings and Foli AI fixes (November 2026): what has logic is checked
// here (optimistic settings, following a streaming answer, the time zone picker's names and search, the slider's
// steps, the calendar's short heading, the title bar's double-click), and the changed views are drawn light and
// dark to FOLEVI_AUDIT_OUT when it's set, to look at (no references are kept for them).
#if os(macOS)
import AppKit
import Foundation
import SwiftUI
import Testing
import FoleviDesign
import FoleviEngine
@testable import FoleviMac
import FoleviScreens

@Suite("Audit: Mac content logic") @MainActor
struct AuditMacContentLogicTests {
    @Test func settingsShowAChangeAtOnceAndRollBackOnFailure() {
        var p = SettingsPending<Bool>()
        #expect(p.shown(false) == false)
        p.begin(true)
        #expect(p.shown(false) == true)
        // Saved, but the stored value hasn't arrived yet: the switch keeps showing the change.
        p.finish(ok: true, stored: false)
        #expect(p.shown(false) == true)
        // It arrives.
        p.stored(true)
        #expect(p.value == nil && p.shown(true) == true)
        // A failure goes back to the stored value.
        p.begin(false)
        p.finish(ok: false, stored: true)
        #expect(p.shown(true) == true && p.value == nil)
        // Saved and already stored: settled.
        var s = SettingsPending<String>()
        s.begin("dark")
        s.finish(ok: true, stored: "dark")
        #expect(s.value == nil)
    }

    @Test func aGrowingAnswerKeepsBeingFollowedUntilYouScrollUp() {
        let end = AiFollow.Reading(offset: 400, atEnd: true)
        // A tall chunk arrives: the end moves away, nobody scrolled (the offset didn't go back).
        let grown = AiFollow.Reading(offset: 400, atEnd: false)
        #expect(AiFollow.following(true, old: end, new: grown))
        // You scroll up to read.
        let up = AiFollow.Reading(offset: 300, atEnd: false)
        #expect(!AiFollow.following(true, old: grown, new: up))
        // More arrives while you read: still not following.
        #expect(!AiFollow.following(false, old: up, new: AiFollow.Reading(offset: 300, atEnd: false)))
        // Back at the end: following again.
        #expect(AiFollow.following(false, old: up, new: AiFollow.Reading(offset: 900, atEnd: true)))
    }

    @Test func timeZonesReadAsPlacesWithOffsets() {
        #expect(TimeZoneChoices.offset(0) == "UTC")
        #expect(TimeZoneChoices.offset(19_800) == "UTC+5:30")
        #expect(TimeZoneChoices.offset(-10_800) == "UTC\u{2212}3")
        #expect(TimeZoneChoices.offset(20_700) == "UTC+5:45")
        let winter = Date(timeIntervalSince1970: 1_800_000_000) // January 2027
        let c = TimeZoneChoices.choice("America/Argentina/Rio_Gallegos", at: winter)
        #expect(c.name == "Rio Gallegos, Argentina" && c.region == "America" && c.offset == "UTC\u{2212}3")
        #expect(TimeZoneChoices.choice("Asia/Calcutta", at: winter).name == "Calcutta")
        #expect(TimeZoneChoices.choice("UTC", at: winter).region == "Other")

        let all = TimeZoneChoices.all(ids: TimeZone.knownTimeZoneIdentifiers, chosen: "Asia/Tokyo", detected: "Europe/London", at: winter)
        #expect(all.count == Set(TimeZone.knownTimeZoneIdentifiers + ["Asia/Tokyo", "Europe/London"]).count)
        #expect(all[0].id == "Asia/Tokyo" && all[0].group == "Chosen")
        #expect(all[1].id == "Europe/London" && all[1].group == "This Mac")
        // Then by region: Africa first, the ones without a region last.
        #expect(all[2].region == "Africa")
        #expect(all.last?.region == "Other")
        // The chosen one isn't listed twice.
        #expect(all.filter { $0.id == "Asia/Tokyo" }.count == 1)

        #expect(TimeZoneChoices.filter(all, "gallegos").map(\.id) == ["America/Argentina/Rio_Gallegos"])
        #expect(TimeZoneChoices.filter(all, "argentina gall").map(\.id) == ["America/Argentina/Rio_Gallegos"])
        #expect(TimeZoneChoices.filter(all, "+5:30").contains { $0.id == "Asia/Calcutta" })
        #expect(TimeZoneChoices.filter(all, "").count == all.count)
        #expect(TimeZoneChoices.filter(all, "zzzz").isEmpty)
    }

    @Test func theSliderStepsOnItsGrid() {
        let r = 0.85...1.35
        #expect(WebSlider.snap(1.12, range: r, step: 0.05) == 1.1)
        #expect(WebSlider.snap(1.13, range: r, step: 0.05) == 1.15)
        #expect(WebSlider.snap(2, range: r, step: 0.05) == 1.35)
        #expect(WebSlider.snap(0.1, range: r, step: 0.05) == 0.85)
        // Along a 216 pt line (a 16 pt thumb): the ends, and the middle.
        #expect(WebSlider.value(at: 0, width: 216, range: r, step: 0.05) == 0.85)
        #expect(WebSlider.value(at: 216, width: 216, range: r, step: 0.05) == 1.35)
        #expect(WebSlider.value(at: 108, width: 216, range: r, step: 0.05) == 1.1)
    }

    @Test func theCalendarsShortWeekHeading() {
        #expect(CalendarHeading.week(first: "2026-11-02", last: "2026-11-08") == "Nov 2 to 8")
        #expect(CalendarHeading.week(first: "2026-11-30", last: "2026-12-06") == "Nov 30 to Dec 6")
        #expect(CalendarHeading.week(first: "2026-12-28", last: "2027-01-03").hasPrefix("Dec 28 to Jan 3"))
    }

    @Test func theTitleBarsDoubleClickFollowsTheMacsSetting() {
        #expect(FloatingNoteState.doubleClickAction(nil) == .zoom)
        #expect(FloatingNoteState.doubleClickAction("Maximize") == .zoom)
        #expect(FloatingNoteState.doubleClickAction("Minimize") == .minimize)
        #expect(FloatingNoteState.doubleClickAction("None") == .none)
    }
}

@Suite("Audit: Mac content pictures", .serialized) @MainActor
struct AuditMacContentPictures {
    static var out: URL? { ProcessInfo.processInfo.environment["FOLEVI_AUDIT_OUT"].map { URL(fileURLWithPath: $0) } }

    /// Draws `view` at `size` in both schemes into the output folder.
    func draw<V: View>(_ name: String, size: CGSize, settle: Int = 4, _ view: @escaping () -> V) async {
        guard let out = Self.out else { return }
        _ = FoleviFonts.register()
        try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
        for scheme in [ColorScheme.light, .dark] {
            let root = view()
                .frame(width: size.width, height: size.height)
                .background(WebStyles.vars["color-canvas"]?.resolve(scheme).color ?? .white)
                .environment(\.colorScheme, scheme)
            let host = NSHostingView(rootView: root)
            host.frame = CGRect(origin: .zero, size: size)
            let window = NSWindow(contentRect: host.frame, styleMask: [.borderless], backing: .buffered, defer: false)
            window.appearance = NSAppearance(named: scheme == .dark ? .darkAqua : .aqua)
            window.contentView = host
            window.setFrameOrigin(CGPoint(x: -20000, y: -20000))
            window.orderFrontRegardless()
            for _ in 0..<settle {
                host.layoutSubtreeIfNeeded()
                try? await Task.sleep(for: .milliseconds(150))
            }
            if let image = DnaSnapshotTests.image(host, scale: 2), let data = DnaSnapshotTests.png(image) {
                try? data.write(to: out.appendingPathComponent("\(name)-\(scheme == .dark ? "dark" : "light").png"))
            }
            window.orderOut(nil)
        }
    }

    @Test func settingsPieces() async {
        await draw("settings-confirm", size: CGSize(width: 520, height: 300)) {
            SettingsConfirmDialog(title: "Delete your account?", message: "Your account, your Personal and everything in it are deleted after 7 days. Sign in before then to cancel.", confirm: "Schedule deletion") {}
        }
        await draw("settings-controls", size: CGSize(width: 620, height: 520)) {
            VStack(alignment: .leading, spacing: 18) {
                SettingsSwitchRow(label: "Open at login", hint: "Folevi starts quietly when you log in, so Quick Add is always ready.", isOn: true) { _ in true }
                SettingsSwitchRow(label: "Menu bar icon", hint: "Quick Add, a new note, recent notes and the save state from the menu bar.", isOn: false) { _ in true }
                SettingsPrefRow(label: "Memory", body_: "Let Foli AI remember things you approve, like the tone you like or words you use.", isOn: true) { _ in true }
                SettingsField(placeholder: "Your name", text: .constant("Sam"))
                SettingsTimeZoneSelect(value: "America/Argentina/Rio_Gallegos") { _ in true }
                Toggle("I understand Folevi can't recover a lost passphrase", isOn: .constant(true)).toggleStyle(WebCheckboxStyle()).webText(.role(.body))
                Toggle("Rename the note", isOn: .constant(false)).toggleStyle(WebCheckboxStyle()).webText(.role(.body))
                HStack(spacing: 12) {
                    Text("Smaller").webText(.role(.subheadline))
                    WebSlider(value: .constant(1.1), in: 0.85...1.35, step: 0.05, label: "Editor text size")
                    Text("Larger").webText(.role(.subheadline))
                }
                .frame(maxWidth: 448)
                HStack(spacing: 12) { WebSpinner(); WebSpinner(size: 13); Text("Checking…").webText(.role(.subheadline)) }
                SettingsLinkedText(before: "Choose the model and add your keys in ", link: "Settings, under Foli AI", after: ". Keys stay on this Mac.", style: "link.text") {}
            }
            .padding(24)
        }
        await draw("settings-timezone-picker", size: CGSize(width: 420, height: 440)) {
            TimeZonePicker(chosen: "Asia/Tokyo") { _ in }.padding(24)
        }
    }

    @Test func listPieces() async {
        await draw("list-skeletons", size: CGSize(width: 900, height: 520)) {
            VStack(alignment: .leading, spacing: 24) {
                ListSkeleton(shape: .chips)
                ListSkeleton(shape: .rows)
                ListSkeleton(shape: .carousel(width: 840))
            }
            .padding(30)
        }
    }

    @Test func screens() async throws {
        let pages: [(String, FrameRoute, CGSize)] = [
            ("calendar-week-narrow", .calendar(nil), CGSize(width: 680, height: 560)),
            ("calendar-week-wide", .calendar(nil), CGSize(width: 1180, height: 560)),
            ("tasks", .tasks(.all), CGSize(width: 1000, height: 640)),
            ("tags", .web("/tags"), CGSize(width: 1000, height: 400)),
            ("settings-appearance", .web("/settings/appearance"), CGSize(width: 1000, height: 640)),
            ("ai-new-chat", .web("/ai"), CGSize(width: 1000, height: 640)),
        ]
        guard Self.out != nil else { return }
        UserDefaults.standard.set("week", forKey: WebCalendarState.layoutKey)
        for (name, route, size) in pages {
            let demo = DemoEngine(now: Date(timeIntervalSince1970: 1_800_000_000))
            let frame = FrameModel(client: demo.client())
            let models = ScreenModels(frame: frame)
            await draw(name, size: size, settle: 12) { ScreenRoot(model: frame, models: models, route: route) }
        }
    }
}
#endif
