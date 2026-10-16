// This iPhone or iPad's model by name ("iPhone 18 Pro"), for its token's name in Settings > Connected apps
// ("Folevi for iPhone (iPhone 18 Pro)"). iOS only gives the model identifier ("iPhone19,2"); the names
// below are the iOS 17-capable models. A newer one is just "Folevi for iPhone" until it's added here.
import UIKit

enum DeviceModel {
    /// "iPhone" or "iPad".
    static var family: String { UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "iPhone" }

    /// The model's name, or "" when it isn't known.
    static var name: String { names[identifier] ?? "" }

    /// "iPhone19,2": the hardware's, or in the Simulator the simulated device's.
    static var identifier: String {
        if let simulated = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] { return simulated }
        var info = utsname()
        uname(&info)
        return withUnsafeBytes(of: &info.machine) { raw in String(decoding: raw.prefix { $0 != 0 }, as: UTF8.self) }
    }

    static let names: [String: String] = [
        "iPhone11,2": "iPhone XS", "iPhone11,4": "iPhone XS Max", "iPhone11,6": "iPhone XS Max", "iPhone11,8": "iPhone XR",
        "iPhone12,1": "iPhone 11", "iPhone12,3": "iPhone 11 Pro", "iPhone12,5": "iPhone 11 Pro Max", "iPhone12,8": "iPhone SE",
        "iPhone13,1": "iPhone 12 mini", "iPhone13,2": "iPhone 12", "iPhone13,3": "iPhone 12 Pro", "iPhone13,4": "iPhone 12 Pro Max",
        "iPhone14,2": "iPhone 13 Pro", "iPhone14,3": "iPhone 13 Pro Max", "iPhone14,4": "iPhone 13 mini", "iPhone14,5": "iPhone 13",
        "iPhone14,6": "iPhone SE", "iPhone14,7": "iPhone 14", "iPhone14,8": "iPhone 14 Plus",
        "iPhone15,2": "iPhone 14 Pro", "iPhone15,3": "iPhone 14 Pro Max", "iPhone15,4": "iPhone 15", "iPhone15,5": "iPhone 15 Plus",
        "iPhone16,1": "iPhone 15 Pro", "iPhone16,2": "iPhone 15 Pro Max",
        "iPhone17,1": "iPhone 16 Pro", "iPhone17,2": "iPhone 16 Pro Max", "iPhone17,3": "iPhone 16", "iPhone17,4": "iPhone 16 Plus", "iPhone17,5": "iPhone 16e",
        "iPhone18,1": "iPhone 17 Pro", "iPhone18,2": "iPhone 17 Pro Max", "iPhone18,3": "iPhone 17", "iPhone18,4": "iPhone Air", "iPhone18,5": "iPhone 17e",
        "iPhone19,2": "iPhone 18 Pro", "iPhone19,3": "iPhone 18 Pro Max",
        "iPad13,1": "iPad Air", "iPad13,2": "iPad Air", "iPad13,4": "iPad Pro 11-inch", "iPad13,5": "iPad Pro 11-inch", "iPad13,8": "iPad Pro 12.9-inch", "iPad13,10": "iPad Pro 12.9-inch",
        "iPad13,16": "iPad Air", "iPad13,17": "iPad Air", "iPad13,18": "iPad", "iPad13,19": "iPad",
        "iPad14,1": "iPad mini", "iPad14,2": "iPad mini", "iPad14,3": "iPad Pro 11-inch", "iPad14,4": "iPad Pro 11-inch", "iPad14,5": "iPad Pro 12.9-inch", "iPad14,6": "iPad Pro 12.9-inch",
        "iPad14,8": "iPad Air 11-inch (M2)", "iPad14,9": "iPad Air 11-inch (M2)", "iPad14,10": "iPad Air 13-inch (M2)", "iPad14,11": "iPad Air 13-inch (M2)",
        "iPad15,3": "iPad Air 11-inch (M3)", "iPad15,4": "iPad Air 11-inch (M3)", "iPad15,5": "iPad Air 13-inch (M3)", "iPad15,6": "iPad Air 13-inch (M3)", "iPad15,7": "iPad (A16)", "iPad15,8": "iPad (A16)",
        "iPad16,1": "iPad mini (A17 Pro)", "iPad16,2": "iPad mini (A17 Pro)",
        "iPad16,3": "iPad Pro 11-inch (M4)", "iPad16,4": "iPad Pro 11-inch (M4)", "iPad16,5": "iPad Pro 13-inch (M4)", "iPad16,6": "iPad Pro 13-inch (M4)",
        "iPad16,8": "iPad Air 11-inch (M4)", "iPad16,9": "iPad Air 11-inch (M4)", "iPad16,10": "iPad Air 13-inch (M4)", "iPad16,11": "iPad Air 13-inch (M4)",
        "iPad17,1": "iPad Pro 11-inch (M5)", "iPad17,2": "iPad Pro 11-inch (M5)", "iPad17,3": "iPad Pro 13-inch (M5)", "iPad17,4": "iPad Pro 13-inch (M5)",
    ]
}
