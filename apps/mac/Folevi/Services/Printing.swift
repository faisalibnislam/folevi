// Printing (docs/MAC_WEBKIT_PLAN.md §6.8): the page prints as it does in a browser, and the print panel comes up as
// a sheet on its window, with Save as PDF there as everywhere on the Mac.
// - window.print() in the page or in one of its frames (the PDF export and the recovery key print a hidden frame
//   with the clean page in it, components/doc/export.ts and components/e2ee/PrintRecoveryKey.tsx): WKWebView
//   leaves print() to its host through a delegate method it hasn't made public, which this answers with the
//   print operation for that frame (WebKit's own, for that frame alone). Without it, print() would do nothing.
// - foleviDesktop.print(): the page as it is (File > Print when no note is open).
// A Debug build can save the next print as a PDF without the panel (MacEval "printToFile"), for scripts.
import AppKit
import WebKit

@MainActor
enum Printing {
    /// Debug: the next print goes to this PDF without a panel.
    static var nextToFile: URL?

    static func install() {}

    /// The page as it is, in a print panel on its window.
    static func printPage(_ view: WKWebView) {
        run(view.printOperation(with: printInfo()), in: view, done: nil)
    }

    /// One frame of the page (`frame` is WebKit's handle for it), or the whole page when WebKit can't give it.
    static func print(_ view: WKWebView, frame: AnyObject?, done: (() -> Void)?) {
        let info = printInfo()
        let selector = NSSelectorFromString("_printOperationWithPrintInfo:forFrame:")
        if let frame, view.responds(to: selector), let op = view.perform(selector, with: info, with: frame)?.takeUnretainedValue() as? NSPrintOperation {
            run(op, in: view, done: done)
        } else {
            run(view.printOperation(with: info), in: view, done: done)
        }
    }

    static func printInfo() -> NSPrintInfo {
        let info = (NSPrintInfo.shared.copy() as? NSPrintInfo) ?? NSPrintInfo()
        info.horizontalPagination = .fit
        info.verticalPagination = .automatic
        info.isHorizontallyCentered = false
        info.isVerticallyCentered = false
        // The page's own print styles set the margins (@page); the paper's are the system's.
        if let out = nextToFile {
            info.jobDisposition = .save
            info.dictionary()[NSPrintInfo.AttributeKey.jobSavingURL] = out
        }
        return info
    }

    private static func run(_ op: NSPrintOperation, in view: WKWebView, done: (() -> Void)?) {
        let toFile = nextToFile != nil
        nextToFile = nil
        op.jobTitle = view.title?.isEmpty == false ? view.title! : "Folevi"
        op.showsPrintPanel = !toFile
        op.showsProgressPanel = !toFile
        op.printPanel.options.formUnion([.showsPaperSize, .showsOrientation, .showsScaling, .showsPreview])
        // WebKit lays the pages out from the view's size: a zero frame prints blank pages.
        if let printing = op.view, printing.frame.isEmpty { printing.frame = view.bounds }
        // WebKit's pages come from the page's process as they're drawn: run as a sheet (modal or not), never
        // with a blocking run() while a window is there.
        guard let window = view.window else {
            _ = op.run()
            done?()
            return
        }
        let target = Done(done)
        op.runModal(for: window, delegate: target, didRun: #selector(Done.printOperationDidRun(_:success:contextInfo:)), contextInfo: nil)
    }

    /// Keeps the callback alive until the sheet ends.
    final class Done: NSObject {
        private static var running: Set<Done> = []
        private let done: (() -> Void)?

        init(_ done: (() -> Void)?) {
            self.done = done
            super.init()
            Self.running.insert(self)
        }

        @objc func printOperationDidRun(_ op: NSPrintOperation, success: Bool, contextInfo: UnsafeMutableRawPointer?) {
            done?()
            Self.running.remove(self)
        }
    }
}

// WebKit's print() hook (WKUIDelegatePrivate): the frame that called print(), and a callback that lets the page go
// on (print() returns, "afterprint" fires) once printing is done. Two spellings across WebKit versions.
extension Navigation {
    @objc(_webView:printFrame:pdfFirstPageSize:completionHandler:)
    func foleviWebView(_ webView: WKWebView, printFrame frame: AnyObject, pdfFirstPageSize size: CGSize, completionHandler: @escaping () -> Void) {
        Printing.print(webView, frame: frame, done: completionHandler)
    }

    @objc(_webView:printFrame:)
    func foleviWebView(_ webView: WKWebView, printFrame frame: AnyObject) {
        Printing.print(webView, frame: frame, done: nil)
    }
}
