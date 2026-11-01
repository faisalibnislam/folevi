// The device Folevi runs on, as its words name it ("On this Mac", "saved on this iPad"): the shared screens are the
// Mac's and the iPad's. Read once from the hardware model (the Simulator names the one it plays), so any thread
// can use it.
import Foundation

public enum ThisDevice {
    public static let noun: String = {
        #if os(iOS)
        var size = 0
        sysctlbyname("hw.machine", nil, &size, nil, 0)
        var raw = [CChar](repeating: 0, count: max(size, 1))
        sysctlbyname("hw.machine", &raw, &size, nil, 0)
        let machine = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] ?? String(cString: raw)
        return machine.hasPrefix("iPad") ? "iPad" : "iPhone"
        #else
        return "Mac"
        #endif
    }()
}
