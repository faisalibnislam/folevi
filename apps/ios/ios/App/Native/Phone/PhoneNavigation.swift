// A tab's stack (plan 4.1): a UINavigationController, so the back swipe, the per-tab stacks and state come from
// UIKit. Large titles done right: the system large title in Spectral 34 and the inline title in Instrument Sans
// semibold 17, on a solid neutral bar (white or near-black, never a note's colour) with a hairline only once
// content scrolls under it. The large title lives in its own row under the bar items, so it never overlaps the
// avatar or the pill; collapsed, the inline title is centred between them and truncates with "…".
import SwiftUI
import UIKit
import FoleviDesign
import FoleviEngine
import FoleviScreens

/// The chrome colours as UIKit colours (dynamic, light and dark).
enum Chrome {
    static let canvas = FoleviTokens.Chrome.canvas.platformColor
    static let ink = FoleviTokens.Chrome.ink.platformColor
    static let heading = FoleviTokens.Chrome.heading.platformColor
    static let inkMuted = FoleviTokens.Chrome.inkMuted.platformColor
    static let inkFaint = FoleviTokens.Chrome.inkFaint.platformColor
    static let line = FoleviTokens.Chrome.line.platformColor
    static let surfaceSunken = FoleviTokens.Chrome.surfaceSunken.platformColor
    static let coral = FoleviTokens.Chrome.coral.platformColor
    static let ember = FoleviTokens.Chrome.ember.platformColor
    static let moss = FoleviTokens.Chrome.moss.platformColor

    static func navigationAppearance() -> (standard: UINavigationBarAppearance, edge: UINavigationBarAppearance) {
        let a = UINavigationBarAppearance()
        a.configureWithOpaqueBackground()
        a.backgroundColor = canvas
        a.backgroundEffect = nil
        a.shadowColor = line
        a.titleTextAttributes = [.font: FoleviFonts.uiFont(.ui, size: 17, weight: .semibold), .foregroundColor: heading]
        a.largeTitleTextAttributes = [.font: FoleviFonts.uiFont(.display, size: 34, weight: .medium), .foregroundColor: heading]
        let plain = UIBarButtonItemAppearance(style: .plain)
        plain.normal.titleTextAttributes = [.font: FoleviFonts.uiFont(.ui, size: 17, weight: .medium), .foregroundColor: heading]
        a.buttonAppearance = plain
        let done = UIBarButtonItemAppearance(style: .done)
        done.normal.titleTextAttributes = [.font: FoleviFonts.uiFont(.ui, size: 17, weight: .semibold), .foregroundColor: heading]
        a.doneButtonAppearance = done
        a.backButtonAppearance = plain
        let edge = a.copy()
        edge.shadowColor = .clear
        return (a, edge)
    }

    static func apply(to bar: UINavigationBar) {
        let (standard, edge) = navigationAppearance()
        bar.standardAppearance = standard
        bar.compactAppearance = standard
        bar.scrollEdgeAppearance = edge
        bar.compactScrollEdgeAppearance = edge
        bar.tintColor = heading
        bar.prefersLargeTitles = true
    }
}

@MainActor
protocol PhoneNavigationObserver: AnyObject {
    /// The stack's top changed (or will): the frame hides the tab bar on a note.
    func navigation(_ nav: PhoneNavigationController, willShow top: UIViewController, animated: Bool)
    func navigation(_ nav: PhoneNavigationController, didShow top: UIViewController)
}

final class PhoneNavigationController: UINavigationController, UINavigationControllerDelegate, UIGestureRecognizerDelegate {
    weak var observer: PhoneNavigationObserver?

    override init(rootViewController: UIViewController) {
        super.init(rootViewController: rootViewController)
        Chrome.apply(to: navigationBar)
        view.backgroundColor = Chrome.canvas
        delegate = self
    }

    override init(nibName nibNameOrNil: String?, bundle nibBundleOrNil: Bundle?) {
        super.init(nibName: nibNameOrNil, bundle: nibBundleOrNil)
    }

    @available(*, unavailable)
    required init?(coder aDecoder: NSCoder) { fatalError("init(coder:) is not used") }

    override func viewDidLoad() {
        super.viewDidLoad()
        // The edge swipe keeps working with custom transitions (iOS 17's zoom, Reduce Motion's fade).
        interactivePopGestureRecognizer?.delegate = self
    }

    func gestureRecognizerShouldBegin(_ g: UIGestureRecognizer) -> Bool {
        g === interactivePopGestureRecognizer ? viewControllers.count > 1 : true
    }

    // MARK: UINavigationControllerDelegate

    func navigationController(_ nav: UINavigationController, willShow vc: UIViewController, animated: Bool) {
        observer?.navigation(self, willShow: vc, animated: animated)
    }

    func navigationController(_ nav: UINavigationController, didShow vc: UIViewController, animated: Bool) {
        ZoomSources.removeAll()
        observer?.navigation(self, didShow: vc)
    }

    func navigationController(_ nav: UINavigationController, animationControllerFor operation: UINavigationController.Operation, from fromVC: UIViewController, to toVC: UIViewController) -> UIViewControllerAnimatedTransitioning? {
        guard operation == .push, let note = toVC as? NoteViewController else { return nil }
        return NoteTransitions.animator(for: note, from: fromVC)
    }
}

// MARK: - Screens hosted in a stack

/// A SwiftUI screen in a tab's stack: its title for the bar, the tab bar's room at the bottom, and the scroll view
/// UIKit collapses the large title with. The hosting controller is a child of this plain controller, so SwiftUI's
/// own navigation-title bridging never reaches the bar (it resets the title and drops the large title of a pushed
/// screen on iOS 26); the bar shows what UIKit sets here.
class HostedScreen<Content: View>: UIViewController {
    let host: UIHostingController<Content>
    /// Room for the floating tab bar (its capsules float over content, which scrolls under them at full strength).
    var tabBarRoom: CGFloat = 0 { didSet { if tabBarRoom != oldValue { additionalSafeAreaInsets.bottom = tabBarRoom } } }
    private var scrollViewFound = false

    init(rootView: Content) {
        host = UIHostingController(rootView: rootView)
        super.init(nibName: nil, bundle: nil)
        navigationItem.backButtonDisplayMode = .minimal
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Chrome.canvas
        host.view.backgroundColor = Chrome.canvas
        addChild(host)
        host.view.frame = view.bounds
        host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(host.view)
        host.didMove(toParent: self)
        additionalSafeAreaInsets.bottom = tabBarRoom
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        findScrollView()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        findScrollView()
    }

    /// The large title collapses with the screen's own scroll view (SwiftUI's, found once it exists: the hosting
    /// controller lays its content out after this controller, so it looks again on the next turns until found).
    private func findScrollView(retries: Int = 10) {
        guard !scrollViewFound else { return }
        guard let scroll = firstScrollView(in: host.view) else {
            if retries > 0 { DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in self?.findScrollView(retries: retries - 1) } }
            return
        }
        scrollViewFound = true
        setContentScrollView(scroll, for: .top)
        if collapsingTitle != nil {
            offsetObservation = scroll.observe(\.contentOffset, options: [.new]) { [weak self] s, _ in
                MainActor.assumeIsolated { self?.scrolled(s) }
            }
            scrolled(scroll)
        }
    }

    // MARK: The title in the content

    /// Tab roots draw their large title in their own content (Home's header: the place, "Home", the sync status),
    /// and the bar shows the small title only once that has scrolled under it, centred between the bar's items and
    /// truncated with "…", so it never overlaps the avatar or the pill. (The system large title isn't used for
    /// them: on iOS 27 it isn't drawn again after a push and pop, and it can't hold the place and the sync status.)
    var collapsingTitle: String? {
        didSet {
            guard let collapsingTitle else { return }
            navigationItem.largeTitleDisplayMode = .never
            // No item title (the bar would draw it at once); the back button and the label carry the name.
            navigationItem.title = nil
            navigationItem.backButtonTitle = collapsingTitle
            smallTitle.text = collapsingTitle
            smallTitle.sizeToFit()
            titleBox.frame = smallTitle.bounds
            smallTitle.frame = titleBox.bounds
            smallTitle.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            titleBox.addSubview(smallTitle)
            navigationItem.titleView = titleBox
        }
    }
    /// How far the content scrolls before the small title shows (the header's height, about).
    var collapseAfter: CGFloat = 44
    private lazy var smallTitle: UILabel = {
        let l = UILabel()
        l.font = FoleviFonts.uiFont(.ui, size: 17, weight: .semibold)
        l.textColor = Chrome.heading
        l.lineBreakMode = .byTruncatingTail
        l.alpha = 0
        l.accessibilityTraits = .header
        return l
    }()
    private let titleBox = UIView()
    private var offsetObservation: NSKeyValueObservation?
    private var smallTitleShown = false

    private func scrolled(_ s: UIScrollView) {
        let y = s.contentOffset.y + s.adjustedContentInset.top
        let show = y > collapseAfter
        guard show != smallTitleShown else { return }
        smallTitleShown = show
        UIView.animate(withDuration: 0.15) { self.smallTitle.alpha = show ? 1 : 0 }
    }
}

/// The first tall scroll view under `view` (a SwiftUI screen's own), breadth first.
@MainActor
func firstScrollView(in view: UIView) -> UIScrollView? {
    var queue: [UIView] = [view]
    while !queue.isEmpty {
        let v = queue.removeFirst()
        if let s = v as? UIScrollView, !(s is UITextView), s.frame.height > 100 { return s }
        queue.append(contentsOf: v.subviews)
    }
    return nil
}

/// A SwiftUI view as a bar item (the screens' own trailing and leading items), sized to fit.
@MainActor
func barItem<V: View>(_ view: V, glass: Bool = false) -> UIBarButtonItem {
    let host = UIHostingController(rootView: view)
    host.sizingOptions = .intrinsicContentSize
    host.view.backgroundColor = .clear
    host.view.translatesAutoresizingMaskIntoConstraints = false
    let item = UIBarButtonItem(customView: host.view)
    // The screens draw their own glass pills; iOS 26's shared bar background would put glass on glass.
    if #available(iOS 26.0, *), !glass { item.hidesSharedBackground = true }
    objc_setAssociatedObject(item, &hostKey, host, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
    return item
}

nonisolated(unsafe) private var hostKey: UInt8 = 0
