// The root's tabs (plan 4.1, web iphone/TabBar.tsx): Home, Tasks and Calendar, each its own navigation stack, under
// Folevi's floating bar: the three tabs in one glass capsule on the left (the current one in a lens that slides to
// the tab you pick), Foli AI and "+" in another on the right. No fade over the bottom: content scrolls under the
// capsules at full strength. The bar steps away on a note, in Select mode and while the keyboard is up. Tapping
// the tab you're on goes back to its first screen, or, already there, to the top.
import UIKit
import FoleviDesign

@MainActor
final class PhoneTabsController: UIViewController {
    enum Tab: Int, CaseIterable { case home, tasks, calendar }

    let stacks: [PhoneNavigationController]
    let bar = FloatingTabBar()
    private(set) var current: Tab = .home
    private var barHidden = false
    /// Reasons the bar steps away, besides a note (Select mode, the keyboard).
    var hideReasons: Set<String> = [] { didSet { if hideReasons != oldValue { updateBar(animated: true) } } }

    init(stacks: [PhoneNavigationController]) {
        self.stacks = stacks
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    var currentStack: PhoneNavigationController { stacks[current.rawValue] }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Chrome.canvas
        for s in stacks { addChild(s) }
        show(.home)
        bar.translatesAutoresizingMaskIntoConstraints = false
        bar.onSelect = { [weak self] tab in self?.pick(tab) }
        view.addSubview(bar)
        NSLayoutConstraint.activate([
            bar.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 16),
            bar.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16),
            bar.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: 10),
            bar.heightAnchor.constraint(equalToConstant: FloatingTabBar.height),
        ])
    }

    /// The room screens leave for the bar at the bottom of their content.
    static let room: CGFloat = FloatingTabBar.height + 4

    func pick(_ tab: Tab) {
        if tab == current {
            let s = currentStack
            if s.viewControllers.count > 1 {
                s.popToRootViewController(animated: true)
            } else if let scroll = firstScrollView(in: s.topViewController?.view ?? s.view) {
                scroll.setContentOffset(CGPoint(x: 0, y: -scroll.adjustedContentInset.top), animated: true)
            }
            return
        }
        UISelectionFeedbackGenerator().selectionChanged()
        show(tab)
    }

    func show(_ tab: Tab) {
        let old = stacks[current.rawValue]
        let next = stacks[tab.rawValue]
        if old !== next || next.view.superview == nil {
            old.view.removeFromSuperview()
            next.view.frame = view.bounds
            next.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            view.insertSubview(next.view, at: 0)
            next.didMove(toParent: self)
        }
        current = tab
        bar.select(tab, animated: isViewLoaded && view.window != nil)
        updateBar(animated: false)
    }

    /// Hides the bar while the stack's top is a note (or another reason holds).
    func updateBar(animated: Bool, top: UIViewController? = nil) {
        let top = top ?? currentStack.topViewController
        let hidden = top is NoteViewController || top is PageScreenController || !hideReasons.isEmpty
        guard hidden != barHidden else { return }
        barHidden = hidden
        bar.isUserInteractionEnabled = !hidden
        bar.accessibilityElementsHidden = hidden
        let apply = {
            self.bar.alpha = hidden ? 0 : 1
            self.bar.transform = hidden ? CGAffineTransform(translationX: 0, y: 120) : .identity
        }
        if animated && !UIAccessibility.isReduceMotionEnabled {
            UIViewPropertyAnimator(duration: 0.32, controlPoint1: CGPoint(x: 0.32, y: 0.72), controlPoint2: CGPoint(x: 0, y: 1), animations: apply).startAnimation()
        } else {
            apply()
        }
    }
}

@MainActor
final class FloatingTabBar: UIView {
    static let height: CGFloat = 64
    var onSelect: ((PhoneTabsController.Tab) -> Void)?
    var onFoliAI: (() -> Void)?
    var onQuickTask: (() -> Void)?
    /// The "+" menu (New note, From template, New folder, Quick task); rebuilt by the frame.
    var plusMenu: UIMenu? { didSet { plus.menu = plusMenu; updatePlus() } }

    private let tabs = GlassCapsule(spacing: 2)
    private let create = GlassCapsule(spacing: 4)
    private let lens = UIView()
    private var tabButtons: [UIButton] = []
    private var lensX: NSLayoutConstraint?
    private(set) var aiButton: UIButton!
    private let plus = GlassCapsule.plusButton(label: "New", id: "tab-new")
    private var selected: PhoneTabsController.Tab = .home

    override init(frame: CGRect) {
        super.init(frame: frame)
        addSubview(tabs)
        addSubview(create)
        lens.translatesAutoresizingMaskIntoConstraints = false
        lens.isUserInteractionEnabled = false
        lens.backgroundColor = Chrome.surfaceSunken
        lens.layer.cornerRadius = 28
        lens.layer.cornerCurve = .continuous
        tabs.row.superview?.insertSubview(lens, belowSubview: tabs.row)
        let items: [(PhoneTabsController.Tab, String, String, String)] = [
            (.home, "house", "Home", "tab-home"), (.tasks, "checkmark.square", "Tasks", "tab-tasks"), (.calendar, "calendar", "Calendar", "tab-calendar"),
        ]
        for (tab, symbol, label, id) in items {
            let b = GlassCapsule.button(symbol: symbol, label: label, id: id, size: 56, pointSize: 21) { [weak self] in self?.onSelect?(tab) }
            b.widthAnchor.constraint(equalToConstant: 64).isActive = true
            tabButtons.append(b)
            tabs.row.addArrangedSubview(b)
        }
        aiButton = GlassCapsule.button(symbol: "sparkle", label: "Foli AI", id: "tab-foli", size: 56, pointSize: 23) { [weak self] in self?.onFoliAI?() }
        create.row.addArrangedSubview(aiButton)
        plus.showsMenuAsPrimaryAction = true
        plus.addAction(UIAction { [weak self] _ in
            guard let self, self.plus.menu == nil else { return }
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            self.onQuickTask?()
        }, for: .touchUpInside)
        create.row.addArrangedSubview(plus.slot)

        let x = lens.leadingAnchor.constraint(equalTo: tabs.leadingAnchor, constant: 4)
        lensX = x
        NSLayoutConstraint.activate([
            tabs.leadingAnchor.constraint(equalTo: leadingAnchor),
            tabs.topAnchor.constraint(equalTo: topAnchor),
            tabs.bottomAnchor.constraint(equalTo: bottomAnchor),
            create.trailingAnchor.constraint(equalTo: trailingAnchor),
            create.topAnchor.constraint(equalTo: topAnchor),
            create.bottomAnchor.constraint(equalTo: bottomAnchor),
            create.leadingAnchor.constraint(greaterThanOrEqualTo: tabs.trailingAnchor, constant: 12),
            x,
            lens.centerYAnchor.constraint(equalTo: tabs.centerYAnchor),
            lens.widthAnchor.constraint(equalToConstant: 64),
            lens.heightAnchor.constraint(equalToConstant: 56),
        ])
        accessibilityIdentifier = "tab-bar"
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    /// The bar only takes touches on its capsules: content between them stays tappable.
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        let hit = super.hitTest(point, with: event)
        return hit === self ? nil : hit
    }

    func select(_ tab: PhoneTabsController.Tab, animated: Bool) {
        selected = tab
        for (i, b) in tabButtons.enumerated() {
            let on = i == tab.rawValue
            b.tintColor = on ? Chrome.heading : Chrome.inkMuted
            b.accessibilityTraits = on ? [.button, .selected] : .button
        }
        lensX?.constant = 4 + CGFloat(tab.rawValue) * 66
        updatePlus()
        guard animated, !UIAccessibility.isReduceMotionEnabled else { return layoutIfNeeded() }
        UIView.animate(withDuration: 0.42, delay: 0, usingSpringWithDamping: 0.78, initialSpringVelocity: 0, options: [.beginFromCurrentState, .allowUserInteraction]) {
            self.layoutIfNeeded()
        }
    }

    func setAI(_ on: Bool) { aiButton.isHidden = !on }

    /// On Tasks, "+" goes straight to Quick task; elsewhere it opens its menu.
    private func updatePlus() {
        plus.showsMenuAsPrimaryAction = selected != .tasks && plusMenu != nil
        if selected == .tasks { plus.menu = nil } else if plus.menu == nil { plus.menu = plusMenu }
        plus.accessibilityLabel = selected == .tasks ? "Quick task" : "New"
    }
}
