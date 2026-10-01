import Foundation

/// Port of packages/editor-schema/src/html.ts (standalone HTML export).
public enum HTMLExport {
    public struct Options {
        public var resolveFile: ((String) -> String?)?
        public var resolveDocument: ((String) -> String?)?
        public var title: String
        public init(title: String, resolveFile: ((String) -> String?)? = nil, resolveDocument: ((String) -> String?)? = nil) {
            self.title = title
            self.resolveFile = resolveFile
            self.resolveDocument = resolveDocument
        }
    }

    public static func escape(_ value: String) -> String {
        value.replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "'", with: "&#39;")
    }

    public static func inlineToHTML(_ nodes: [InlineNode], _ opts: Options) -> String {
        nodes.map { node -> String in
            switch node {
            case .mention(_, let label):
                return "<span class=\"mention\">@\(escape(label))</span>"
            case .date(let date):
                return "<time datetime=\"\(escape(date))\">\(escape(date))</time>"
            case .pageLink(let documentId, let label):
                if let href = opts.resolveDocument?(documentId) {
                    return "<a href=\"\(escape(href))\">\(escape(label))</a>"
                }
                return escape(label)
            case .text(let text, let marks):
                var s = escape(text).replacingOccurrences(of: "\n", with: "<br>")
                for m in marks ?? [] {
                    switch m {
                    case .bold: s = "<strong>\(s)</strong>"
                    case .italic: s = "<em>\(s)</em>"
                    case .underline: s = "<u>\(s)</u>"
                    case .strike: s = "<s>\(s)</s>"
                    case .code: s = "<code>\(s)</code>"
                    case .link(let href):
                        if let safe = RichText.sanitizeHref(href) {
                            s = "<a href=\"\(escape(safe))\" rel=\"noopener noreferrer\">\(s)</a>"
                        }
                    case .color(let v): s = "<span class=\"text-\(v.rawValue)\">\(s)</span>"
                    case .highlight(let v): s = "<mark class=\"highlight-\(v.rawValue)\">\(s)</mark>"
                    }
                }
                return s
            }
        }.joined()
    }

    static let css = """

:root{color-scheme:light dark;--ink:#18201C;--muted:#5F6962;--line:#D8D7CF;--paper:#FBFAF6;--accent:#3159D8;--code:#EFECE3}
@media (prefers-color-scheme:dark){:root{--ink:#F2F0E9;--muted:#A9B0AA;--line:#343A35;--paper:#171C18;--accent:#88A4FF;--code:#1B211C}}
body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:760px;margin:48px auto;padding:0 24px}
h1{font-family:ui-serif,Georgia,serif;font-weight:500;font-size:2.2rem;line-height:1.2}
h2,h3,h4{line-height:1.3}
a{color:var(--accent)}
blockquote{border-left:3px solid var(--line);margin:0;padding-left:16px;color:var(--muted)}
.callout{border:1px solid var(--line);border-radius:12px;padding:12px 16px}
pre{background:var(--code);padding:16px;border-radius:10px;overflow:auto}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.9em}
table{border-collapse:collapse;width:100%}td,th{border:1px solid var(--line);padding:6px 10px;text-align:left}
img{max-width:100%;border-radius:10px}
ul.todo{list-style:none;padding-left:0}ul.todo li::before{content:"☐ ";}ul.todo li.done::before{content:"☑ ";}
ul.todo li.done{color:var(--muted);text-decoration:line-through}
mark{background:#F7E7A6;color:inherit}
.page-break{break-after:page;page-break-after:always;height:0;margin:32px 0;border-top:1px dashed var(--line)}
.formula{margin:16px 0;text-align:center;overflow-x:auto}.formula pre{text-align:left}
.whiteboard svg{width:100%;height:auto;border:1px solid var(--line);border-radius:10px}
hr.divider-extralight{border:0;border-top:2px dotted var(--line);opacity:.7}hr.divider-light{border:0;border-top:1px dotted var(--muted)}
hr.divider-regular{border:0;border-top:1px solid var(--line)}hr.divider-strong{border:0;border-top:3px solid var(--ink)}
@media print{body{background:#fff;color:#000}main{margin:0 auto}.page-break{border:0;margin:0}}

"""

    public static func blocksToHTML(_ blocks: [WireBlock], _ opts: Options) -> String {
        let flat = Tree.flatten(blocks)
        var parts: [String] = []
        var openList: [(tag: String, depth: Int)] = []
        func closeLists(_ depth: Int) {
            while let top = openList.last, top.depth >= depth {
                parts.append("</\(top.tag)>")
                openList.removeLast()
            }
        }
        func str(_ v: JSONValue?) -> String { MarkdownCodec.string(v) }
        for entry in flat {
            let block = entry.block
            let depth = entry.depth
            let p = block.props.objectValue ?? [:]
            let t = inlineToHTML(block.inlineText, opts)
            let listTag: String? = block.type == "bulleted" ? "ul" : block.type == "numbered" ? "ol" : block.type == "todo" ? "ul class=\"todo\"" : nil
            if let listTag {
                let baseTag = String(listTag.split(separator: " ").first ?? "ul")
                if let top = openList.last, top.depth > depth { closeLists(depth + 1) }
                let cur = openList.last
                if cur == nil || cur!.depth < depth || cur!.tag != baseTag {
                    if let cur, cur.depth == depth { closeLists(depth) }
                    parts.append("<\(listTag)>")
                    openList.append((baseTag, depth))
                }
                let cls = block.type == "todo" && (p["checked"]?.isTruthy ?? false) ? " class=\"done\"" : ""
                parts.append("<li\(cls)>\(t)</li>")
                continue
            }
            closeLists(0)
            openList = []
            switch block.type {
            case "paragraph":
                parts.append("<p>\(t.isEmpty ? "<br>" : t)</p>")
            case "heading":
                var level = p["level"]?.doubleValue ?? 0
                if level.isNaN || level == 0 { level = 1 }
                let n = Int(min(3, level)) + 1
                parts.append("<h\(n)>\(t)</h\(n)>")
            case "toggle":
                parts.append("<details><summary>\(t)</summary></details>")
            case "quote":
                parts.append("<blockquote>\(t)</blockquote>")
            case "callout":
                let icon = (p["icon"]?.isTruthy ?? false) ? "\(escape(str(p["icon"]))) " : ""
                parts.append("<aside class=\"callout callout-\(escape(str(p["tone"])))\">\(icon)\(t)</aside>")
            case "divider":
                parts.append((p["style"]?.isTruthy ?? false) ? "<hr class=\"divider-\(escape(str(p["style"])))\">" : "<hr>")
            case "pageBreak":
                parts.append("<div class=\"page-break\" role=\"separator\" aria-label=\"Page break\"></div>")
            case "formula":
                // No math renderer on the Mac yet: formulas export as their LaTeX source (the web's fallback).
                parts.append("<div class=\"formula\"><pre><code class=\"language-latex\">\(escape((p["latex"]?.isNull == false ? str(p["latex"]) : "")))</code></pre></div>")
            case "whiteboard":
                parts.append("<figure class=\"whiteboard\">\(Whiteboard.svg(data: (p["data"]?.isNull == false ? str(p["data"]) : ""), height: p["height"]?.doubleValue))</figure>")
            case "code":
                let code = p["code"].flatMap { $0.isNull ? nil : $0 }.map { str($0) } ?? ""
                parts.append("<pre><code class=\"language-\(escape(str(p["language"])))\">\(escape(code))</code></pre>")
            case "image":
                let src: String? = (p["fileId"]?.isTruthy ?? false)
                    ? opts.resolveFile?(str(p["fileId"]))
                    : RichText.sanitizeHref(p["url"].flatMap { $0.isNull ? nil : $0 }.map { str($0) } ?? "")
                if let src, !src.isEmpty {
                    let alt = p["alt"].flatMap { $0.isNull ? nil : $0 }.map { str($0) } ?? ""
                    let caption = (p["caption"]?.isTruthy ?? false) ? "<figcaption>\(escape(str(p["caption"])))</figcaption>" : ""
                    parts.append("<figure><img src=\"\(escape(src))\" alt=\"\(escape(alt))\">\(caption)</figure>")
                }
            case "file":
                let src = opts.resolveFile?(str(p["fileId"]))
                parts.append("<p><a href=\"\(escape(src ?? "#"))\" download>\(escape(str(p["name"])))</a></p>")
            case "audio":
                if let src = opts.resolveFile?(str(p["fileId"])), !src.isEmpty {
                    parts.append("<figure class=\"audio\"><audio controls preload=\"metadata\" src=\"\(escape(src))\"></audio><figcaption><a href=\"\(escape(src))\" download>\(escape(str(p["name"])))</a></figcaption></figure>")
                } else {
                    parts.append("<p>\(escape(str(p["name"])))</p>")
                }
            case "table":
                let rows: [[[InlineNode]]] = (try? (p["rows"] ?? .array([])).decode([[[InlineNode]]].self)) ?? []
                let headerRow = p["headerRow"]?.isTruthy ?? false
                let body = rows.enumerated().map { i, r -> String in
                    let tag = i == 0 && headerRow ? "th" : "td"
                    return "<tr>" + r.map { "<\(tag)>\(inlineToHTML($0, opts))</\(tag)>" }.joined() + "</tr>"
                }.joined()
                parts.append("<table>\(body)</table>")
            case "page":
                let href = opts.resolveDocument?(str(p["documentId"]))
                let label = escape(p["titleCache"].flatMap { $0.isNull ? nil : $0 }.map { str($0) } ?? "Untitled")
                parts.append("<p>\(href.map { "<a href=\"\(escape($0))\">\(label)</a>" } ?? label)</p>")
            case "bookmark":
                let href = RichText.sanitizeHref(str(p["url"]))
                let title = p["title"].flatMap { $0.isNull ? nil : $0 }.map { str($0) } ?? str(p["url"])
                parts.append("<p><a href=\"\(escape(href ?? "#"))\" rel=\"noopener noreferrer\">\(escape(title))</a></p>")
            default:
                break
            }
        }
        closeLists(0)
        return """
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Folevi">
<title>\(escape(opts.title))</title>
<style>\(css)</style>
</head>
<body>
<main>
<h1>\(escape(opts.title))</h1>
\(parts.joined(separator: "\n"))
</main>
</body>
</html>

"""
    }
}
