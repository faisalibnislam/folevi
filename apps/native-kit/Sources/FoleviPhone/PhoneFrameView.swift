// The iPhone frame (docs/IOS_REBUILD_PLAN.md, I1; the web's components/iphone/IphoneShell.tsx): one navigation
// stack per tab, each kept alive while another shows (a tab comes back where it was left), iOS's own push and edge
// swipe for Back, and the floating tab bar over them. What each route shows comes from `screen`.
#if os(iOS)
import SwiftUI
import FoleviDesign
import FoleviScreens

public struct PhoneFrameView<Screen: View>: View {
    @Bindable var model: PhoneFrameModel
    let aiOn: Bool
    /// Whether the tab bar steps out of the way (the keyboard, Select).
    let tabBarHidden: Bool
    let screen: (FrameRoute) -> Screen
    let openAI: () -> Void
    let plus: () -> Void

    public init(model: PhoneFrameModel, aiOn: Bool = true, tabBarHidden: Bool = false, openAI: @escaping () -> Void = {}, plus: @escaping () -> Void = {}, @ViewBuilder screen: @escaping (FrameRoute) -> Screen) {
        self.model = model
        self.aiOn = aiOn
        self.tabBarHidden = tabBarHidden
        self.openAI = openAI
        self.plus = plus
        self.screen = screen
    }

    public var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .bottom) {
                ForEach(PhoneTab.allCases) { tab in
                    stack(tab)
                        .opacity(tab == model.current ? 1 : 0)
                        .allowsHitTesting(tab == model.current)
                        .accessibilityHidden(tab != model.current)
                }
                // The tab bar floats over the home indicator and steps away for a note (which has its own bars),
                // the keyboard and Select (TabBar.tsx: 300 ms, cubic-bezier(0.32, 0.72, 0, 1)).
                let hidden = tabBarHidden || model.top.isNote || model.top == .web("/ai") || isAI(model.top)
                PhoneTabBar(current: model.current, aiOn: aiOn, pick: { model.pick($0) }, openAI: openAI, plus: plus)
                    .padding(.leading, geo.safeAreaInsets.leading)
                    .padding(.trailing, geo.safeAreaInsets.trailing)
                    .padding(.bottom, max(10, geo.safeAreaInsets.bottom - 10))
                    .offset(y: hidden ? 64 * 1.4 + 20 : 0)
                    .opacity(hidden ? 0 : 1)
                    .animation(.timingCurve(0.32, 0.72, 0, 1, duration: 0.3), value: hidden)
                    .allowsHitTesting(!hidden)
                    .accessibilityHidden(hidden)
            }
            .ignoresSafeArea(edges: .bottom)
        }
    }

    private func isAI(_ route: FrameRoute) -> Bool {
        if case .web(let p) = route { return p == "/ai" || p.hasPrefix("/ai/") }
        return false
    }

    /// A tab's stack: its first screen, then what was opened on top (bound to the model, so Back by the edge swipe
    /// pops the model too).
    private func stack(_ tab: PhoneTab) -> some View {
        let path = Binding<[PhoneStackEntry]>(
            get: { Array((model.stacks[tab] ?? []).dropFirst()) },
            set: { model.setPath($0, in: tab) }
        )
        let first = model.stacks[tab]?.first?.route ?? PhoneFrameModel.root(of: tab)
        return NavigationStack(path: path) {
            screen(first)
                .toolbar(.hidden, for: .navigationBar)
                .navigationDestination(for: PhoneStackEntry.self) { entry in
                    screen(entry.route).toolbar(.hidden, for: .navigationBar)
                }
        }
    }
}
#endif
