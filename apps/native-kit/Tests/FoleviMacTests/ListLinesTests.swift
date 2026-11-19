// No line between the rows of a list in the Mac's native look (the owner, 2026-11-19: "keep the spacing but remove
// the horizontal lines ... it will look much cleaner"): tasks, notes and folders in list view, the account lists,
// the Vault's lists, the Calendars popover and Help's shortcuts. The line's point of room stays, so no row moved.
// Pictures: docs/audits/2026-11-18-mac-ui (tasks-no-lines, lists-no-lines).
#if os(macOS)
import Foundation
import SwiftUI
import Testing
@testable import FoleviMac

@Suite("List lines")
struct ListLinesTests {
    static func source(_ path: String) throws -> String {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Sources/FoleviMac/Views")
        return try String(contentsOf: root.appendingPathComponent(path), encoding: .utf8)
    }

    @Test func tasksHaveNone() {
        #expect(TaskCardLook.nativeLine == Color.clear)
    }

    /// The notes list, the folders list and the account lists share one gap, and none draws the old separator.
    @Test func notesFoldersAndAccountListsUseTheGap() throws {
        let notes = try Self.source("WebNoteScreens.swift")
        #expect(notes.components(separatedBy: "NativeRowGap()").count - 1 == 2)
        #expect(try Self.source("More/AccountScreens.swift").contains("NativeRowGap()"))
        for file in ["WebNoteScreens.swift", "More/AccountScreens.swift", "NativeScreenKit.swift"] {
            #expect(!(try Self.source(file)).contains("NativeRowSeparator"), "\(file) still draws a row separator")
        }
        // The gap is room only.
        let kit = try Self.source("NativeScreenKit.swift")
        let gap = try #require(kit.range(of: "struct NativeRowGap"))
        #expect(kit[gap.lowerBound...].prefix(200).contains("Color.clear.frame(height: 1)"))
    }

    /// The Vault's lists, the Calendars popover and Help's shortcuts draw their lines only outside the native look.
    @Test func theOtherListsDrawNoLineInTheNativeLook() throws {
        #expect(try Self.source("Vault/VaultSections.swift").contains("VaultDividedLayout(line: chrome != nil ? .clear : VS.color(\"line\", scheme))"))
        #expect(try Self.source("Planner/CalendarSubscriptions.swift").contains("chrome != nil && i < cals.count - 1 ? .clear : line"))
        #expect(try Self.source("More/HelpScreen.swift").contains("chrome != nil ? .clear : moreVar(\"color-line\", scheme)"))
    }
}
#endif
