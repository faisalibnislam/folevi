// The iPhone's three tabs (the web's components/iphone/TabBar.tsx and tabStacks.ts): Home, Tasks and Calendar,
// each with its own stack of screens, and the first route each opens. The bar that draws them comes in I1
// (docs/IOS_REBUILD_PLAN.md).
import CoreGraphics

public enum PhoneTab: String, CaseIterable, Sendable, Identifiable {
    case home, tasks, calendar

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .home: "Home"
        case .tasks: "Tasks"
        case .calendar: "Calendar"
        }
    }

    /// The route the tab's stack starts at (TabBar.tsx's href).
    public var rootPath: String {
        switch self {
        case .home: "/documents"
        case .tasks: "/tasks/today"
        case .calendar: "/calendar"
        }
    }

    /// TabBar.tsx: 24 pt House, 23 pt for the other two; the chosen tab's stroke 2.3, the others 1.9.
    public var iconSize: CGFloat { self == .home ? 24 : 23 }
    public static func stroke(chosen: Bool) -> CGFloat { chosen ? 2.3 : 1.9 }
}
