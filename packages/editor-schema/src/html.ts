import type { InlineNode } from "./generated/schema";
import type { WireBlock } from "./types";
import { flattenTree } from "./tree";
import { sanitizeHref } from "./richtext";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface HtmlExportOptions {
  resolveFile?: (fileId: string) => string | null;
  resolveDocument?: (documentId: string) => string | null;
}

export function inlineToHtml(nodes: readonly InlineNode[], opts: HtmlExportOptions = {}): string {
  return nodes
    .map((n) => {
      switch (n.type) {
        case "mention":
          return `<span class="mention">@${escapeHtml(n.label)}</span>`;
        case "date":
          return `<time datetime="${escapeHtml(n.date)}">${escapeHtml(n.date)}</time>`;
        case "pageLink": {
          const href = opts.resolveDocument?.(n.documentId);
          return href ? `<a href="${escapeHtml(href)}">${escapeHtml(n.label)}</a>` : escapeHtml(n.label);
        }
        case "text": {
          let s = escapeHtml(n.text).replace(/\n/g, "<br>");
          for (const m of n.marks ?? []) {
            switch (m.type) {
              case "bold":
                s = `<strong>${s}</strong>`;
                break;
              case "italic":
                s = `<em>${s}</em>`;
                break;
              case "underline":
                s = `<u>${s}</u>`;
                break;
              case "strike":
                s = `<s>${s}</s>`;
                break;
              case "code":
                s = `<code>${s}</code>`;
                break;
              case "link": {
                const href = sanitizeHref(m.href);
                if (href) s = `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${s}</a>`;
                break;
              }
              case "color":
                s = `<span class="text-${m.value}">${s}</span>`;
                break;
              case "highlight":
                s = `<mark class="highlight-${m.value}">${s}</mark>`;
                break;
            }
          }
          return s;
        }
      }
    })
    .join("");
}

const EXPORT_CSS = `
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
@media print{body{background:#fff;color:#000}main{margin:0 auto}}
`;

export function blocksToHtml(blocks: readonly WireBlock[], opts: HtmlExportOptions & { title: string }): string {
  const flat = flattenTree(blocks);
  const parts: string[] = [];
  let openList: { tag: string; depth: number }[] = [];
  const closeLists = (depth: number) => {
    while (openList.length && openList[openList.length - 1]!.depth >= depth) {
      parts.push(`</${openList.pop()!.tag}>`);
    }
  };
  for (const { block, depth } of flat) {
    const p = block.props as Record<string, unknown>;
    const t = inlineToHtml(block.text, opts);
    const listTag = block.type === "bulleted" ? "ul" : block.type === "numbered" ? "ol" : block.type === "todo" ? "ul class=\"todo\"" : null;
    if (listTag) {
      const top = openList[openList.length - 1];
      if (top && top.depth > depth) closeLists(depth + 1);
      const cur = openList[openList.length - 1];
      if (!cur || cur.depth < depth || cur.tag !== listTag.split(" ")[0]) {
        if (cur && cur.depth === depth) closeLists(depth);
        parts.push(`<${listTag}>`);
        openList.push({ tag: listTag.split(" ")[0]!, depth });
      }
      const cls = block.type === "todo" && p.checked ? ' class="done"' : "";
      parts.push(`<li${cls}>${t}</li>`);
      continue;
    }
    closeLists(0);
    openList = [];
    switch (block.type) {
      case "paragraph":
        parts.push(`<p>${t || "<br>"}</p>`);
        break;
      case "heading": {
        const level = Math.min(3, Number(p.level) || 1) + 1;
        parts.push(`<h${level}>${t}</h${level}>`);
        break;
      }
      case "toggle":
        parts.push(`<details><summary>${t}</summary></details>`);
        break;
      case "quote":
        parts.push(`<blockquote>${t}</blockquote>`);
        break;
      case "callout":
        parts.push(`<aside class="callout callout-${escapeHtml(String(p.tone))}">${p.icon ? `${escapeHtml(String(p.icon))} ` : ""}${t}</aside>`);
        break;
      case "divider":
        parts.push("<hr>");
        break;
      case "code":
        parts.push(`<pre><code class="language-${escapeHtml(String(p.language))}">${escapeHtml(String(p.code ?? ""))}</code></pre>`);
        break;
      case "image": {
        const src = p.fileId ? opts.resolveFile?.(String(p.fileId)) : sanitizeHref(String(p.url ?? ""));
        if (src) {
          parts.push(
            `<figure><img src="${escapeHtml(src)}" alt="${escapeHtml(String(p.alt ?? ""))}">${p.caption ? `<figcaption>${escapeHtml(String(p.caption))}</figcaption>` : ""}</figure>`,
          );
        }
        break;
      }
      case "file": {
        const src = opts.resolveFile?.(String(p.fileId));
        parts.push(`<p><a href="${escapeHtml(src ?? "#")}" download>${escapeHtml(String(p.name))}</a></p>`);
        break;
      }
      case "table": {
        const rows = (p.rows as InlineNode[][][]) ?? [];
        const body = rows
          .map((r, i) => {
            const tag = i === 0 && p.headerRow ? "th" : "td";
            return `<tr>${r.map((c) => `<${tag}>${inlineToHtml(c, opts)}</${tag}>`).join("")}</tr>`;
          })
          .join("");
        parts.push(`<table>${body}</table>`);
        break;
      }
      case "page": {
        const href = opts.resolveDocument?.(String(p.documentId));
        const label = escapeHtml(String(p.titleCache ?? "Untitled"));
        parts.push(`<p>${href ? `<a href="${escapeHtml(href)}">${label}</a>` : label}</p>`);
        break;
      }
      case "bookmark": {
        const href = sanitizeHref(String(p.url));
        parts.push(`<p><a href="${escapeHtml(href ?? "#")}" rel="noopener noreferrer">${escapeHtml(String(p.title ?? p.url))}</a></p>`);
        break;
      }
      default:
        break;
    }
  }
  closeLists(0);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Folevi">
<title>${escapeHtml(opts.title)}</title>
<style>${EXPORT_CSS}</style>
</head>
<body>
<main>
<h1>${escapeHtml(opts.title)}</h1>
${parts.join("\n")}
</main>
</body>
</html>
`;
}
