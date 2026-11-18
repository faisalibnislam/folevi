// Lists a process's windows that are on screen (their ids, names, layers and bounds), as JSON:
//   winlist <pid>
// screens.mjs --look captures each one with `screencapture -l <id>` (the main window, and a popover, menu,
// sheet or second window open over it). Built once into apps/mac/build/tools by the script.
import CoreGraphics
import Foundation

let pid = Int(CommandLine.arguments.dropFirst().first ?? "") ?? 0
let all = (CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]]) ?? []
var out: [[String: Any]] = []
for w in all where (w[kCGWindowOwnerPID as String] as? Int) == pid {
    let b = w[kCGWindowBounds as String] as? [String: Double] ?? [:]
    out.append([
        "id": w[kCGWindowNumber as String] as? Int ?? 0,
        "name": w[kCGWindowName as String] as? String ?? "",
        "layer": w[kCGWindowLayer as String] as? Int ?? 0,
        "alpha": w[kCGWindowAlpha as String] as? Double ?? 1,
        "x": b["X"] ?? 0, "y": b["Y"] ?? 0, "width": b["Width"] ?? 0, "height": b["Height"] ?? 0,
    ])
}
let data = try JSONSerialization.data(withJSONObject: out)
print(String(data: data, encoding: .utf8)!)
