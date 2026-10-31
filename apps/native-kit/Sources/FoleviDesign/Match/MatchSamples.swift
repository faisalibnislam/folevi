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
        } else if id == "iphone.keybar" {
            PhoneKeyboardBar(state: PhoneKeyboardBarState(block: "todo", undo: true, redo: false), aiOn: true) { _ in }.frame(width: 393)
        } else {
            Text("no native sample \(id)").foregroundStyle(.red)
        }
    }
}
