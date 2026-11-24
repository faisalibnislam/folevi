// Moves the pointer for one app only, without moving the Mac's own pointer:
//   pointer <pid> <x> <y> [click]
// posts a mouse-moved event (and, with `click`, a press and release) at a point in screen coordinates (origin top
// left, as CGWindowList reports window bounds) straight to the process. screens.mjs --look uses it to draw hover
// states in real captures while the owner keeps working on the Mac.
import CoreGraphics
import Foundation

let args = Array(CommandLine.arguments.dropFirst())
guard args.count >= 3, let pid = Int32(args[0]), let x = Double(args[1]), let y = Double(args[2]) else {
    FileHandle.standardError.write("pointer <pid> <x> <y> [click]\n".data(using: .utf8)!)
    exit(2)
}
let at = CGPoint(x: x, y: y)
func post(_ type: CGEventType) {
    guard let e = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: at, mouseButton: .left) else { return }
    e.postToPid(pid)
    usleep(40_000)
}
post(.mouseMoved)
post(.mouseMoved)
if args.count > 3, args[3] == "click" {
    post(.leftMouseDown)
    post(.leftMouseUp)
}
