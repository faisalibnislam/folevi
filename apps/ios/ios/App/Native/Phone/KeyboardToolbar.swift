// The bar that rides the keyboard while writing in a note (plan 4.3, the owner's request in docs/IOS_PERFORMANCE.md):
// insert ("/"), checklist, text style, bold, italic, outdent, indent, undo, redo and Foli AI in a row that scrolls
// sideways, and the key that puts the keyboard away pinned at the end. It is pinned to the view's
// keyboardLayoutGuide, so it moves with the keyboard frame for frame, including a drag down that takes the
// keyboard with the finger. Its buttons never become first responder, so the editor keeps the keyboard; each one
// sends an editor command, and `editor.state` lights the active ones.
import UIKit
import FoleviEngine
import FoleviDesign

@MainActor
final class KeyboardToolbar: UIView {
    enum Command {
        case insert, checklist, block(EditorBlock), formatPanel, bold, italic, outdent, indent, undo, redo, ai, hideKeyboard
    }

    var onCommand: ((Command) -> Void)?
    static let height: CGFloat = 46

    private let background: UIVisualEffectView
    private let scroll = UIScrollView()
    private let stack = UIStackView()
    private let hide = UIButton(type: .system)
    private var buttons: [String: UIButton] = [:]
    private var aiButton: UIButton?

    override init(frame: CGRect) {
        if #available(iOS 26.0, *) {
            background = UIVisualEffectView(effect: UIGlassEffect())
        } else {
            background = UIVisualEffectView(effect: UIBlurEffect(style: .systemChromeMaterial))
        }
        super.init(frame: frame)
        accessibilityIdentifier = "keyboard-toolbar"
        background.translatesAutoresizingMaskIntoConstraints = false
        background.layer.cornerRadius = 0
        addSubview(background)
        let hairline = UIView()
        hairline.backgroundColor = Chrome.line
        hairline.translatesAutoresizingMaskIntoConstraints = false
        addSubview(hairline)

        scroll.showsHorizontalScrollIndicator = false
        scroll.alwaysBounceHorizontal = true
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.delaysContentTouches = false
        addSubview(scroll)
        stack.axis = .horizontal
        stack.spacing = 2
        stack.alignment = .center
        stack.translatesAutoresizingMaskIntoConstraints = false
        scroll.addSubview(stack)

        hide.translatesAutoresizingMaskIntoConstraints = false
        configure(hide, symbol: "keyboard.chevron.compact.down", label: "Hide keyboard", id: "kb-hide") { [weak self] in self?.onCommand?(.hideKeyboard) }
        addSubview(hide)
        let divider = UIView()
        divider.backgroundColor = Chrome.line
        divider.translatesAutoresizingMaskIntoConstraints = false
        addSubview(divider)

        NSLayoutConstraint.activate([
            background.leadingAnchor.constraint(equalTo: leadingAnchor),
            background.trailingAnchor.constraint(equalTo: trailingAnchor),
            background.topAnchor.constraint(equalTo: topAnchor),
            background.bottomAnchor.constraint(equalTo: bottomAnchor),
            hairline.leadingAnchor.constraint(equalTo: leadingAnchor),
            hairline.trailingAnchor.constraint(equalTo: trailingAnchor),
            hairline.topAnchor.constraint(equalTo: topAnchor),
            hairline.heightAnchor.constraint(equalToConstant: 1 / UIScreen.main.scale),
            hide.trailingAnchor.constraint(equalTo: safeAreaLayoutGuide.trailingAnchor, constant: -6),
            hide.centerYAnchor.constraint(equalTo: centerYAnchor),
            hide.widthAnchor.constraint(equalToConstant: 44),
            hide.heightAnchor.constraint(equalToConstant: 44),
            divider.trailingAnchor.constraint(equalTo: hide.leadingAnchor, constant: -4),
            divider.widthAnchor.constraint(equalToConstant: 1),
            divider.heightAnchor.constraint(equalToConstant: 24),
            divider.centerYAnchor.constraint(equalTo: centerYAnchor),
            scroll.leadingAnchor.constraint(equalTo: safeAreaLayoutGuide.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: divider.leadingAnchor, constant: -2),
            scroll.topAnchor.constraint(equalTo: topAnchor),
            scroll.bottomAnchor.constraint(equalTo: bottomAnchor),
            stack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 6),
            stack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -6),
            stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor),
            stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor),
            stack.heightAnchor.constraint(equalTo: scroll.frameLayoutGuide.heightAnchor),
        ])

        add("slash", text: "/", label: "Insert", id: "kb-insert") { [weak self] in self?.onCommand?(.insert) }
        add("checklist", symbol: "checkmark.square", label: "Checklist", id: "kb-todo") { [weak self] in self?.onCommand?(.checklist) }
        addStyleMenu()
        add("bold", symbol: "bold", label: "Bold", id: "kb-bold") { [weak self] in self?.onCommand?(.bold) }
        add("italic", symbol: "italic", label: "Italic", id: "kb-italic") { [weak self] in self?.onCommand?(.italic) }
        add("outdent", symbol: "decrease.indent", label: "Outdent", id: "kb-outdent") { [weak self] in self?.onCommand?(.outdent) }
        add("indent", symbol: "increase.indent", label: "Indent", id: "kb-indent") { [weak self] in self?.onCommand?(.indent) }
        add("undo", symbol: "arrow.uturn.backward", label: "Undo", id: "kb-undo") { [weak self] in self?.onCommand?(.undo) }
        add("redo", symbol: "arrow.uturn.forward", label: "Redo", id: "kb-redo") { [weak self] in self?.onCommand?(.redo) }
        aiButton = add("ai", symbol: "sparkle", label: "Foli AI", id: "kb-ai") { [weak self] in self?.onCommand?(.ai) }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    /// Lights the marks and the block at the selection, and greys out undo and redo when there's nothing to do.
    func update(_ state: EditorStateEvent?, aiOn: Bool) {
        let marks = Set(state?.marks ?? [])
        select("bold", marks.contains(.bold))
        select("italic", marks.contains(.italic))
        select("checklist", state?.block == EditorBlock.todo.rawValue)
        buttons["undo"]?.isEnabled = state?.undo ?? true
        buttons["redo"]?.isEnabled = state?.redo ?? false
        aiButton?.isHidden = !aiOn
    }

    private func select(_ key: String, _ on: Bool) {
        guard let b = buttons[key], b.isSelected != on else { return }
        b.isSelected = on
        b.backgroundColor = on ? Chrome.surfaceSunken : .clear
        b.accessibilityTraits = on ? [.button, .selected] : .button
    }

    @discardableResult
    private func add(_ key: String, symbol: String? = nil, text: String? = nil, label: String, id: String, action: @escaping () -> Void) -> UIButton {
        let b = UIButton(type: .custom)
        configure(b, symbol: symbol, text: text, label: label, id: id, action: action)
        b.translatesAutoresizingMaskIntoConstraints = false
        b.widthAnchor.constraint(equalToConstant: 44).isActive = true
        b.heightAnchor.constraint(equalToConstant: 38).isActive = true
        stack.addArrangedSubview(b)
        buttons[key] = b
        return b
    }

    private func configure(_ b: UIButton, symbol: String? = nil, text: String? = nil, label: String, id: String, action: @escaping () -> Void) {
        if let symbol {
            b.setImage(UIImage(systemName: symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: 17, weight: .medium)), for: .normal)
        }
        if let text {
            b.setTitle(text, for: .normal)
            b.titleLabel?.font = FoleviFonts.uiFont(.ui, size: 20, weight: .medium)
            b.setTitleColor(Chrome.heading, for: .normal)
        }
        b.tintColor = Chrome.heading
        b.layer.cornerRadius = FoleviTokens.Radius.control
        b.layer.cornerCurve = .continuous
        b.accessibilityLabel = label
        b.accessibilityIdentifier = id
        // Pressing never takes the keyboard from the editor.
        b.addAction(UIAction { _ in
            UISelectionFeedbackGenerator().selectionChanged()
            action()
        }, for: .touchUpInside)
    }

    /// Text style: the block types in a menu, and the Format panel for everything else.
    private func addStyleMenu() {
        let b = UIButton(type: .custom)
        b.setImage(UIImage(systemName: "textformat", withConfiguration: UIImage.SymbolConfiguration(pointSize: 17, weight: .medium)), for: .normal)
        b.tintColor = Chrome.heading
        b.accessibilityLabel = "Text style"
        b.accessibilityIdentifier = "kb-style"
        b.layer.cornerRadius = FoleviTokens.Radius.control
        b.translatesAutoresizingMaskIntoConstraints = false
        b.widthAnchor.constraint(equalToConstant: 44).isActive = true
        b.heightAnchor.constraint(equalToConstant: 38).isActive = true
        let blocks: [(String, String, EditorBlock)] = [
            ("Body", "text.alignleft", .paragraph), ("Heading 1", "textformat.size.larger", .heading1), ("Heading 2", "textformat.size", .heading2),
            ("Heading 3", "textformat.size.smaller", .heading3), ("Bulleted list", "list.bullet", .bulleted), ("Numbered list", "list.number", .numbered),
            ("Quote", "text.quote", .quote), ("Toggle", "chevron.right.square", .toggle),
        ]
        let items = blocks.map { title, symbol, block in
            UIAction(title: title, image: UIImage(systemName: symbol)) { [weak self] _ in self?.onCommand?(.block(block)) }
        }
        let more = UIAction(title: "More formatting", image: UIImage(systemName: "textformat.alt")) { [weak self] _ in self?.onCommand?(.formatPanel) }
        b.menu = UIMenu(children: [UIMenu(options: .displayInline, children: items), more])
        b.showsMenuAsPrimaryAction = true
        stack.addArrangedSubview(b)
        buttons["style"] = b
    }
}
