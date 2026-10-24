// The floating glass capsules of the tab bar and the note's bottom buttons (web iphone/Glass.tsx): Liquid Glass on
// iOS 26 and later, a chrome material tinted to 72 % of the canvas below it (the owner's numbers in
// docs/IOS_PERFORMANCE.md), solid under Reduce Transparency. A capsule holds a row of 52 to 64 pt round buttons.
import UIKit
import FoleviDesign

@MainActor
final class GlassCapsule: UIView {
    let row = UIStackView()
    private let effect: UIVisualEffectView
    private let tint = UIView()

    init(spacing: CGFloat = 2) {
        if #available(iOS 26.0, *) {
            let glass = UIGlassEffect()
            glass.isInteractive = true
            effect = UIVisualEffectView(effect: glass)
        } else {
            effect = UIVisualEffectView(effect: UIBlurEffect(style: .systemChromeMaterial))
        }
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        effect.translatesAutoresizingMaskIntoConstraints = false
        effect.clipsToBounds = true
        effect.layer.cornerCurve = .continuous
        addSubview(effect)
        if #unavailable(iOS 26.0) {
            tint.backgroundColor = Chrome.canvas.withAlphaComponent(0.72)
            tint.translatesAutoresizingMaskIntoConstraints = false
            tint.isUserInteractionEnabled = false
            effect.contentView.addSubview(tint)
            NSLayoutConstraint.activate([
                tint.leadingAnchor.constraint(equalTo: effect.contentView.leadingAnchor),
                tint.trailingAnchor.constraint(equalTo: effect.contentView.trailingAnchor),
                tint.topAnchor.constraint(equalTo: effect.contentView.topAnchor),
                tint.bottomAnchor.constraint(equalTo: effect.contentView.bottomAnchor),
            ])
            layer.shadowColor = UIColor.black.cgColor
            layer.shadowOpacity = 0.12
            layer.shadowRadius = 14
            layer.shadowOffset = CGSize(width: 0, height: 4)
        }
        row.axis = .horizontal
        row.spacing = spacing
        row.alignment = .center
        row.translatesAutoresizingMaskIntoConstraints = false
        effect.contentView.addSubview(row)
        NSLayoutConstraint.activate([
            effect.leadingAnchor.constraint(equalTo: leadingAnchor),
            effect.trailingAnchor.constraint(equalTo: trailingAnchor),
            effect.topAnchor.constraint(equalTo: topAnchor),
            effect.bottomAnchor.constraint(equalTo: bottomAnchor),
            row.leadingAnchor.constraint(equalTo: effect.contentView.leadingAnchor, constant: 4),
            row.trailingAnchor.constraint(equalTo: effect.contentView.trailingAnchor, constant: -4),
            row.topAnchor.constraint(equalTo: effect.contentView.topAnchor, constant: 4),
            row.bottomAnchor.constraint(equalTo: effect.contentView.bottomAnchor, constant: -4),
        ])
        reduceTransparencyChanged()
        NotificationCenter.default.addObserver(self, selector: #selector(reduceTransparencyChanged), name: UIAccessibility.reduceTransparencyStatusDidChangeNotification, object: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func layoutSubviews() {
        super.layoutSubviews()
        effect.layer.cornerRadius = bounds.height / 2
        layer.shadowPath = UIBezierPath(roundedRect: bounds, cornerRadius: bounds.height / 2).cgPath
    }

    @objc private func reduceTransparencyChanged() {
        let solid = UIAccessibility.isReduceTransparencyEnabled
        effect.backgroundColor = solid ? Chrome.canvas : .clear
        tint.alpha = solid ? 0 : 1
    }

    /// A round button for a capsule: a Folevi glyph, its label for VoiceOver, an identifier for UI tests.
    static func button(symbol: String, label: String, id: String, size: CGFloat = 52, pointSize: CGFloat = 21, action: @escaping () -> Void) -> UIButton {
        let b = UIButton(type: .system)
        b.setImage(UIImage(systemName: symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: pointSize, weight: .regular)), for: .normal)
        b.tintColor = Chrome.heading
        b.accessibilityLabel = label
        b.accessibilityIdentifier = id
        b.translatesAutoresizingMaskIntoConstraints = false
        b.widthAnchor.constraint(equalToConstant: size).isActive = true
        b.heightAnchor.constraint(equalToConstant: size).isActive = true
        b.layer.cornerRadius = size / 2
        b.addAction(UIAction { _ in
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            action()
        }, for: .touchUpInside)
        return b
    }

    /// The "+" of the tab bar and the note's Insert: a dark disc with the canvas-coloured plus (web TabBar's `plus`),
    /// in a 52 to 56 pt touch target.
    static func plusButton(label: String, id: String, target: CGFloat = 56, disc: CGFloat = 40) -> UIButton {
        var c = UIButton.Configuration.filled()
        c.baseBackgroundColor = Chrome.heading
        c.baseForegroundColor = Chrome.canvas
        c.cornerStyle = .capsule
        c.image = UIImage(systemName: "plus", withConfiguration: UIImage.SymbolConfiguration(pointSize: disc * 0.45, weight: .semibold))
        c.contentInsets = .zero
        let b = UIButton(configuration: c)
        b.accessibilityLabel = label
        b.accessibilityIdentifier = id
        b.translatesAutoresizingMaskIntoConstraints = false
        b.widthAnchor.constraint(equalToConstant: disc).isActive = true
        b.heightAnchor.constraint(equalToConstant: disc).isActive = true
        b.layer.shadowColor = UIColor.black.cgColor
        b.layer.shadowOpacity = 0.18
        b.layer.shadowRadius = 3
        b.layer.shadowOffset = CGSize(width: 0, height: 2)
        // The touch target is the capsule's slot, wider than the disc.
        let slot = TouchSlot(target: target)
        slot.addSubview(b)
        b.centerXAnchor.constraint(equalTo: slot.centerXAnchor).isActive = true
        b.centerYAnchor.constraint(equalTo: slot.centerYAnchor).isActive = true
        slot.inner = b
        return b
    }
}

/// A square slot that forwards touches anywhere in it to the button it holds (a small disc in a 56 pt target).
final class TouchSlot: UIView {
    weak var inner: UIView?
    init(target: CGFloat) {
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        widthAnchor.constraint(equalToConstant: target).isActive = true
        heightAnchor.constraint(equalToConstant: target).isActive = true
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        guard self.point(inside: point, with: event), !isHidden, alpha > 0.01 else { return nil }
        return inner ?? super.hitTest(point, with: event)
    }
}

extension UIButton {
    /// The view to put in a row: the slot around a plus disc, or the button itself.
    var slot: UIView { (superview as? TouchSlot) ?? self }
}
