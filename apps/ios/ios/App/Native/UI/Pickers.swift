// The system's pickers in native sheets (docs/IOS_POLISH_PLAN.md §4.3; the page calls lib/native/ui.ts
// pickDate(), pickColor() and shareContent()): the date and time picker (UIDatePicker in a sheet with
// detents and a grabber, Cancel and Done, and Clear when the page offers it), the colour picker
// (UIColorPickerViewController) and the share sheet (UIActivityViewController, a popover on iPad).
//
// Dates travel as the page writes them, in local time: YYYY-MM-DD, HH:MM or YYYY-MM-DDTHH:MM.
import UIKit

enum NativeDates {
    enum Mode: String {
        case date, time, dateAndTime

        var pickerMode: UIDatePicker.Mode {
            switch self {
            case .date: .date
            case .time: .time
            case .dateAndTime: .dateAndTime
            }
        }

        var format: String {
            switch self {
            case .date: "yyyy-MM-dd"
            case .time: "HH:mm"
            case .dateAndTime: "yyyy-MM-dd'T'HH:mm"
            }
        }
    }

    static func formatter(_ mode: Mode, timeZone: TimeZone = .current) -> DateFormatter {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.calendar = Calendar(identifier: .gregorian)
        f.timeZone = timeZone
        f.dateFormat = mode.format
        f.isLenient = false
        return f
    }

    /// The page's value as a date (a time alone is today at that time), or nil when it isn't that mode's shape.
    static func parse(_ value: String?, _ mode: Mode, timeZone: TimeZone = .current, now: Date = Date()) -> Date? {
        guard let value, !value.isEmpty else { return nil }
        guard let date = formatter(mode, timeZone: timeZone).date(from: value) else { return nil }
        guard mode == .time else { return date }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = timeZone
        let t = cal.dateComponents([.hour, .minute], from: date)
        return cal.date(bySettingHour: t.hour ?? 0, minute: t.minute ?? 0, second: 0, of: now)
    }

    static func format(_ date: Date, _ mode: Mode, timeZone: TimeZone = .current) -> String {
        formatter(mode, timeZone: timeZone).string(from: date)
    }

    /// How tall the sheet is for a mode: the inline calendar, with its time row, or the time wheels.
    static func sheetHeight(_ mode: Mode, clearable: Bool) -> CGFloat {
        let base: CGFloat = switch mode {
        case .date: 460
        case .dateAndTime: 510
        case .time: 300
        }
        return base + (clearable ? 44 : 0)
    }
}

enum NativeColors {
    /// "#rrggbb" for a colour (in sRGB), lower case.
    static func hex(_ color: UIColor) -> String {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        let srgb = color.cgColor.converted(to: CGColorSpace(name: CGColorSpace.sRGB)!, intent: .defaultIntent, options: nil).flatMap(UIColor.init(cgColor:)) ?? color
        srgb.getRed(&r, green: &g, blue: &b, alpha: &a)
        let c = { (v: CGFloat) in Int((min(max(v, 0), 1) * 255).rounded()) }
        return String(format: "#%02x%02x%02x", c(r), c(g), c(b))
    }

    /// A colour from "#rrggbb", or nil.
    static func color(_ hex: String?) -> UIColor? {
        guard let hex, hex.count == 7, hex.hasPrefix("#"), let v = Int(hex.dropFirst(), radix: 16) else { return nil }
        return UIColor(red: CGFloat((v >> 16) & 0xff) / 255, green: CGFloat((v >> 8) & 0xff) / 255, blue: CGFloat(v & 0xff) / 255, alpha: 1)
    }
}

/// The date and time picker in a sheet: Cancel and Done in its bar, Clear below when offered.
final class DatePickerSheet: UIViewController, UIAdaptivePresentationControllerDelegate {
    let picker = UIDatePicker()
    private let mode: NativeDates.Mode
    private let clearable: Bool
    private var answer: ((Date?, Bool) -> Void)?

    /// `answer(date, cleared)`: (date, false) for Done, (nil, true) for Clear, (nil, false) when dismissed.
    init(mode: NativeDates.Mode, value: Date?, min: Date?, max: Date?, title: String?, clearable: Bool, answer: @escaping (Date?, Bool) -> Void) {
        self.mode = mode
        self.clearable = clearable
        self.answer = answer
        super.init(nibName: nil, bundle: nil)
        picker.datePickerMode = mode.pickerMode
        picker.preferredDatePickerStyle = mode == .time ? .wheels : .inline
        if mode != .date { picker.minuteInterval = 1 }
        picker.minimumDate = min
        picker.maximumDate = max
        picker.date = value ?? Self.defaultValue(mode)
        // Folevi's chrome is neutral: the chosen day in the heading colour, not iOS blue.
        picker.tintColor = .label
        self.title = title ?? (mode == .time ? "Time" : "Date")
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    /// A new date starts today (at 9:00 when it has a time).
    static func defaultValue(_ mode: NativeDates.Mode, now: Date = Date()) -> Date {
        mode == .date ? now : Calendar.current.date(bySettingHour: 9, minute: 0, second: 0, of: now) ?? now
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        navigationItem.leftBarButtonItem = UIBarButtonItem(systemItem: .cancel, primaryAction: UIAction { [weak self] _ in self?.finish(nil, cleared: false) })
        let done = UIBarButtonItem(systemItem: .done, primaryAction: UIAction { [weak self] _ in
            guard let self else { return }
            self.finish(self.picker.date, cleared: false)
        })
        navigationItem.rightBarButtonItem = done
        navigationController?.navigationBar.tintColor = .label
        picker.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(picker)
        var constraints = [
            picker.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 4),
            picker.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 12),
            picker.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -12),
        ]
        if clearable {
            var config = UIButton.Configuration.plain()
            config.title = "Clear"
            config.baseForegroundColor = .label
            let clear = UIButton(configuration: config, primaryAction: UIAction { [weak self] _ in self?.finish(nil, cleared: true) })
            clear.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(clear)
            constraints += [
                clear.topAnchor.constraint(equalTo: picker.bottomAnchor, constant: 4),
                clear.centerXAnchor.constraint(equalTo: view.centerXAnchor),
                clear.heightAnchor.constraint(greaterThanOrEqualToConstant: 44),
            ]
        }
        NSLayoutConstraint.activate(constraints)
    }

    private func finish(_ date: Date?, cleared: Bool) {
        guard let answer else { return }
        self.answer = nil
        dismiss(animated: true)
        answer(date, cleared)
    }

    /// Dragged down or tapped away: no answer.
    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        guard let answer else { return }
        self.answer = nil
        answer(nil, false)
    }

    /// In a navigation controller (for its bar), as a sheet with a grabber sized to the picker.
    func presentable() -> UINavigationController {
        let nav = UINavigationController(rootViewController: self)
        nav.presentationController?.delegate = self
        if let sheet = nav.sheetPresentationController {
            let height = NativeDates.sheetHeight(mode, clearable: clearable)
            sheet.detents = [.custom(identifier: .init("folevi.picker")) { context in min(height, context.maximumDetentValue) }]
            sheet.prefersGrabberVisible = true
            sheet.preferredCornerRadius = 38
            sheet.prefersEdgeAttachedInCompactHeight = true
        }
        return nav
    }
}

/// The colour picker's answer: the colour chosen, or none when it was closed without one.
private final class ColorPickerAnswer: NSObject, UIColorPickerViewControllerDelegate {
    var chosen: UIColor?
    let done: (UIColor?) -> Void
    init(done: @escaping (UIColor?) -> Void) { self.done = done }

    func colorPickerViewController(_ viewController: UIColorPickerViewController, didSelect color: UIColor, continuously: Bool) {
        chosen = color
    }

    func colorPickerViewControllerDidFinish(_ viewController: UIColorPickerViewController) {
        done(chosen)
    }
}

extension FoleviNativePlugin {
    /// { value?, mode, min?, max?, title?, clearable }: { value: { value } } (null value: cleared), or { value: null }.
    @objc func pickDate(_ call: BridgeCall) {
        guard let mode = NativeDates.Mode(rawValue: call.getString("mode") ?? "") else { return call.reject("Unknown picker mode") }
        let value = NativeDates.parse(call.getString("value"), mode)
        let min = NativeDates.parse(call.getString("min"), mode)
        let max = NativeDates.parse(call.getString("max"), mode)
        let clearable = call.getBool("clearable") ?? false
        let title = call.getString("title").map { String($0.prefix(60)) }
        Task { @MainActor in
            guard self.fromFolevi, let presenter = self.topController() else { return call.reject("Not allowed here") }
            let sheet = DatePickerSheet(mode: mode, value: value, min: min, max: max, title: title, clearable: clearable) { date, cleared in
                if cleared { return call.resolve(["value": ["value": NSNull()]]) }
                guard let date else { return call.resolve(["value": NSNull()]) }
                call.resolve(["value": ["value": NativeDates.format(date, mode)]])
            }
            presenter.present(sheet.presentable(), animated: true)
        }
    }

    /// { value?, title? }: { value: "#rrggbb" } or { value: null }.
    @objc func pickColor(_ call: BridgeCall) {
        let start = NativeColors.color(call.getString("value"))
        let title = call.getString("title")
        Task { @MainActor in
            guard self.fromFolevi, let presenter = self.topController() else { return call.reject("Not allowed here") }
            let picker = UIColorPickerViewController()
            picker.supportsAlpha = false
            if let start { picker.selectedColor = start }
            if let title { picker.title = String(title.prefix(60)) }
            var keep: ColorPickerAnswer?
            let answer = ColorPickerAnswer { color in
                keep = nil
                call.resolve(["value": color.map { NativeColors.hex($0) as Any } ?? NSNull()])
            }
            keep = answer
            picker.delegate = answer
            _ = keep
            if let sheet = picker.sheetPresentationController {
                sheet.detents = [.medium(), .large()]
                sheet.prefersGrabberVisible = true
            }
            presenter.present(picker, animated: true)
        }
    }

    /// { title?, text?, url?, anchor? }: { value: true } when something was shared.
    @objc func share(_ call: BridgeCall) {
        var items: [Any] = []
        let text = [call.getString("title"), call.getString("text")].compactMap { $0?.isEmpty == false ? $0 : nil }.joined(separator: "\n")
        if !text.isEmpty { items.append(text) }
        if let raw = call.getString("url"), let url = URL(string: raw), ["http", "https"].contains(url.scheme?.lowercased() ?? "") { items.append(url) }
        guard !items.isEmpty else { return call.reject("Nothing to share") }
        let anchor = LiftPreview.rect(call.getObject("anchor"))
        Task { @MainActor in
            guard self.fromFolevi, let presenter = self.topController() else { return call.reject("Not allowed here") }
            let sheet = UIActivityViewController(activityItems: items, applicationActivities: nil)
            var answered = false
            sheet.completionWithItemsHandler = { _, completed, _, _ in
                guard !answered else { return }
                answered = true
                call.resolve(["value": completed])
            }
            if let popover = sheet.popoverPresentationController, let webView = self.bridge?.webView {
                popover.sourceView = webView
                popover.sourceRect = anchor ?? CGRect(x: webView.bounds.midX, y: webView.bounds.midY, width: 1, height: 1)
                if anchor == nil { popover.permittedArrowDirections = [] }
            }
            presenter.present(sheet, animated: true)
        }
    }

    /// { text }: puts the text on the pasteboard. The page's own clipboard needs a tap to allow it, and WebKit
    /// doesn't count every touch as one (a held finger let go on a menu item, say): bridge.js falls back to this.
    @objc func copyText(_ call: BridgeCall) {
        guard let text = call.getString("text"), text.utf8.count <= 1_000_000 else { return call.reject("Nothing to copy") }
        Task { @MainActor in
            guard self.fromFolevi else { return call.reject("Not allowed here") }
            UIPasteboard.general.string = text
            call.resolve(["value": true])
        }
    }
}
