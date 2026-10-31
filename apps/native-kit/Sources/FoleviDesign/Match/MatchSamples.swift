// The native side of the web's component samples (apps/web/src/app/dev/match/samples.tsx), by the same ids and
// with the same content, for the screenshot diffs.
import SwiftUI

enum MatchSamples {
    @MainActor @ViewBuilder
    static func view(_ id: String) -> some View {
        let parts = id.split(separator: ".").map(String.init)
        if parts.first == "button", parts.count == 3, let v = WebButtonVariant(rawValue: parts[1]) {
            if parts[2] == "md" {
                WebButton("Save changes", variant: v, size: .md)
            } else if parts[2] == "sm" {
                WebButton("New note", icon: .plus, variant: v, size: .sm)
            } else {
                WebIconButton(.x, label: "Close")
            }
        } else if id == "button.quiet.icon.pressed" {
            WebIconButton(.copy, label: "Pinned", pressed: true)
        } else if id == "select.trigger" {
            WebSelectTrigger("Newest first")
        } else if id == "input" {
            WebTextField(text: .constant("Kyoto in November"), width: 240)
        } else if id == "menu" {
            WebMenuPanel([
                .heading("Note"),
                .item("Duplicate", icon: .copy, shortcut: "⌘D"),
                .item("Mark as done", icon: .check, id: "done"),
                .separator(),
                .item("Move to Trash", icon: .trash, danger: true),
            ], highlighted: "done")
        } else if id == "dialog" {
            WebDialog("Rename folder", description: "Notes inside keep their links.", width: 440) {
                WebTextField(text: .constant("Travel")).frame(maxWidth: .infinity)
            } footer: {
                WebButton("Cancel", variant: .secondary)
                WebButton("Rename", variant: .primary)
            }
        } else if id == "card" {
            WebCard(width: 256) {
                VStack(alignment: .leading, spacing: 0) {
                    Text("Kyoto in November").webText(WebStyles.named("card.title").light.text).lineLimit(1).foregroundStyle(Folevi.color.heading)
                    Text("Edited 2 days ago").webText(WebStyles.named("card.subtitle").light.text).lineLimit(1).foregroundStyle(Folevi.color.inkMuted).padding(.top, 4)
                }
            }
        } else if id == "chip" {
            WebChip("Travel")
        } else if id == "kbd" {
            WebKbd("⌘K")
        } else if id == "iphone.circle" {
            WebGlassCircle("Back") { WebIconView(.chevronLeft, size: 24, strokeWidth: 2.2) }
        } else if id == "iphone.pill" {
            WebGlassPill {
                WebPillButton("Notifications") { WebIconView(.bell, size: 21, strokeWidth: 1.9) }
                WebPillButton("More") { WebIconView(.ellipsis, size: 24, strokeWidth: 2.2) }
            }
        } else if id == "iphone.text" {
            HStack(spacing: 12) {
                WebGlassTextButton("Select")
                WebGlassTextButton("Done", strong: true)
            }
        } else if id == "iphone.tabbar" {
            PhoneTabBar(current: .home).frame(width: 393)
        } else if id == "iphone.place" {
            PhoneNotePlaceChip(.folder(name: "Travel", colorId: "moss")) {}
        } else if id == "iphone.notebars" {
            PhoneNoteToolBars(open: nil, canEdit: true, aiOn: true) { _ in }.frame(width: 393)
        } else if id == "iphone.insert" {
            PhoneInsertSheetContent.sample(["Suggested", "Visuals"]).frame(width: 393)
        } else if id == "iphone.format" {
            PhoneFormatSheetContent(state: {
                var f = PhoneFormatState()
                f.marks = ["bold"]
                f.textStyle = "body"
                f.textColor = "moss"
                return f
            }()) { _ in }.frame(width: 393)
        } else if id == "iphone.style" {
            PhoneStyleSheetContent(state: {
                var s = PhoneStyleState()
                s.sheet = "paper"
                s.sheetColor = "#fbf8f2"
                s.textColor = "#1c1c1f"
                s.sheets = [("white", "White", "#ffffff"), ("paper", "Paper", "#fbf8f2"), ("ivory", "Ivory", "#f4ecdb"), ("mist", "Mist", "#edf1f6"), ("sage", "Sage", "#ecf2ea"), ("blush", "Blush", "#f8ecec"), ("night", "Night", "#161618")].map { PhoneStyleState.Choice(id: $0.0, name: $0.1, color: $0.2) }
                s.separators = [PhoneStyleState.Choice(id: "line", name: "Line"), PhoneStyleState.Choice(id: "dots", name: "Dots")]
                return s
            }(), open: "sheet") { _ in }
            .frame(width: 393)
            .background(SheetSurface())
        } else if id == "iphone.comments" {
            let now = Date(timeIntervalSince1970: 1_800_000_000)
            PhoneCommentsSheetContent(state: {
                var s = PhoneCommentsState()
                s.threads = [
                    .init(id: "t1", blockId: "b1", anchor: "“Temples to see”", author: "Mira", text: "Reservations open two months ahead, so book Saiho-ji early.", replies: 1, unread: true, lastActivityAt: now.addingTimeInterval(-7200)),
                    .init(id: "t2", blockId: nil, anchor: "On the whole note", author: "Sam", text: "Looks good to me.", lastActivityAt: now.addingTimeInterval(-3 * 86400)),
                ]
                return s
            }(), now: now) { _ in }
            .frame(width: 393)
            .background(SheetSurface())
        } else if id == "iphone.keybar" {
            PhoneKeyboardBar(state: PhoneKeyboardBarState(block: "todo", undo: true, redo: false), aiOn: true) { _ in }.frame(width: 393)
        } else {
            Text("no native sample \(id)").foregroundStyle(.red)
        }
    }
}

/// A sheet's surface (--iphone-solid) in the scheme on show.
private struct SheetSurface: View {
    @Environment(\.colorScheme) private var scheme
    var body: some View { PhoneSurface.solid.resolve(scheme).color }
}
