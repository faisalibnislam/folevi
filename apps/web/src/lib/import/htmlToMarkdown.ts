// HTML (from an HTML file, a Word document via mammoth, or an Evernote note's ENML) to Markdown, which
// the importer turns into blocks (convex/imports.ts). Covers what notes contain: headings, paragraphs,
// lists (nested), to-dos (Evernote's en-todo and checklist styles), quotes, code, tables, links, images
// and emphasis. Anything else keeps its text. Scripts, styles and comments never come through.

export interface HtmlImage {
  /** What the Markdown refers to (the image's src, or "evernote:<hash>" for an Evernote resource). */
  src: string;
  alt: string;
}

const BLOCK = new Set(["p", "div", "section", "article", "header", "footer", "main", "aside", "figure", "en-note", "body", "center"]);
const SKIP = new Set(["script", "style", "head", "title", "meta", "link", "noscript", "template", "svg", "button", "input", "select", "textarea"]);

/** Characters that would read as Markdown, escaped in plain text. */
function escapeText(text: string): string {
  return text.replace(/([\\`*_[\]])/g, "\\$1");
}

function inline(node: Node, images: HtmlImage[]): string {
  if (node.nodeType === Node.TEXT_NODE) return escapeText((node.textContent ?? "").replace(/\s+/g, " "));
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (SKIP.has(tag)) return "";
  const inner = () => [...el.childNodes].map((c) => inline(c, images)).join("");
  switch (tag) {
    case "br":
      return "\n";
    case "strong":
    case "b": {
      const t = inner();
      return t.trim() ? `**${t.trim()}**` : t;
    }
    case "em":
    case "i": {
      const t = inner();
      return t.trim() ? `_${t.trim()}_` : t;
    }
    case "s":
    case "strike":
    case "del": {
      const t = inner();
      return t.trim() ? `~~${t.trim()}~~` : t;
    }
    case "code":
    case "kbd":
    case "samp":
      return `\`${(el.textContent ?? "").replace(/`/g, "'")}\``;
    case "a": {
      const href = el.getAttribute("href") ?? "";
      const t = inner().trim();
      if (!href || href.startsWith("javascript:")) return t;
      return `[${t || href}](${href.replace(/\)/g, "%29").replace(/ /g, "%20")})`;
    }
    case "img": {
      const src = el.getAttribute("src") ?? "";
      if (!src) return "";
      const alt = (el.getAttribute("alt") ?? "").replace(/[[\]\n]/g, " ").trim();
      images.push({ src, alt });
      return `\n\n![${alt}](${src})\n\n`;
    }
    case "en-media": {
      const hash = el.getAttribute("hash") ?? "";
      const type = el.getAttribute("type") ?? "";
      if (!hash) return "";
      const src = `evernote:${hash}`;
      images.push({ src, alt: "" });
      return type.startsWith("image/") ? `\n\n![](${src})\n\n` : `\n\n[Attachment](${src})\n\n`;
    }
    case "en-todo":
      // Parsed as HTML, "<en-todo/>" isn't self-closing: the to-do's text ends up inside it.
      return `${el.getAttribute("checked") === "true" ? "[x] " : "[ ] "}${inner()}`;
    default:
      return inner();
  }
}

function isTodoList(el: Element): boolean {
  return /--en-todo\s*:\s*true/.test(el.getAttribute("style") ?? "") || el.getAttribute("data-type") === "taskList";
}

function list(el: Element, depth: number, images: HtmlImage[], out: string[]) {
  const ordered = el.tagName.toLowerCase() === "ol";
  const todo = isTodoList(el);
  let n = Number(el.getAttribute("start")) || 1;
  for (const li of [...el.children].filter((c) => c.tagName.toLowerCase() === "li")) {
    const nested: Element[] = [];
    const parts: string[] = [];
    for (const c of [...li.childNodes]) {
      if (c.nodeType === Node.ELEMENT_NODE && ["ul", "ol"].includes((c as Element).tagName.toLowerCase())) nested.push(c as Element);
      else parts.push(inline(c, images));
    }
    let text = parts.join("").replace(/\s*\n\s*/g, " ").trim();
    const checked = /--en-checked\s*:\s*true/.test(li.getAttribute("style") ?? "") || li.getAttribute("data-checked") === "true";
    const indent = "  ".repeat(depth);
    if (todo) text = `[${checked ? "x" : " "}] ${text}`;
    out.push(`${indent}${ordered && !todo ? `${n++}.` : "-"} ${text}`);
    for (const sub of nested) list(sub, depth + 1, images, out);
  }
}

function table(el: Element, images: HtmlImage[]): string {
  const rows = [...el.querySelectorAll("tr")].map((tr) => [...tr.children].filter((c) => ["td", "th"].includes(c.tagName.toLowerCase())).map((c) => inline(c, images).replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|").trim()));
  if (!rows.length) return "";
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]) => [...r, ...Array.from({ length: width - r.length }, () => "")];
  const [head, ...body] = rows.map(pad);
  return [`| ${head!.join(" | ")} |`, `| ${head!.map(() => "---").join(" | ")} |`, ...body.map((r) => `| ${r.join(" | ")} |`)].join("\n");
}

function blocks(node: Node, images: HtmlImage[], out: string[]) {
  let buffer = "";
  const flush = () => {
    const text = buffer.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (text) out.push(text);
    buffer = "";
  };
  for (const child of [...node.childNodes]) {
    if (child.nodeType !== Node.ELEMENT_NODE) {
      buffer += inline(child, images);
      continue;
    }
    const el = child as Element;
    const tag = el.tagName.toLowerCase();
    if (SKIP.has(tag)) continue;
    if (/^h[1-6]$/.test(tag)) {
      flush();
      const t = inline(el, images).replace(/\s+/g, " ").trim();
      if (t) out.push(`${"#".repeat(Math.min(3, Number(tag[1])))} ${t}`);
    } else if (tag === "ul" || tag === "ol") {
      flush();
      const lines: string[] = [];
      list(el, 0, images, lines);
      if (lines.length) out.push(lines.join("\n"));
    } else if (tag === "blockquote") {
      flush();
      const inner: string[] = [];
      blocks(el, images, inner);
      if (inner.length) out.push(inner.join("\n\n").split("\n").map((l) => `> ${l}`).join("\n"));
    } else if (tag === "pre") {
      flush();
      const code = (el.textContent ?? "").replace(/\n$/, "");
      const fence = code.includes("```") ? "~~~" : "```";
      out.push(`${fence}\n${code}\n${fence}`);
    } else if (tag === "hr") {
      flush();
      out.push("---");
    } else if (tag === "table") {
      flush();
      const t = table(el, images);
      if (t) out.push(t);
    } else if (BLOCK.has(tag)) {
      // A div holding only inline content (Evernote's line-per-div) is a paragraph; one with blocks recurses.
      const hasBlocks = [...el.children].some((c) => /^(h[1-6]|ul|ol|blockquote|pre|hr|table|p|div|section|figure)$/i.test(c.tagName));
      if (hasBlocks) {
        flush();
        blocks(el, images, out);
      } else {
        flush();
        buffer = inline(el, images);
        // Evernote's to-dos: a line that starts with its checkbox is a to-do.
        if (/^\[( |x)\] /.test(buffer.trim())) buffer = `- ${buffer.trim()}`;
        flush();
      }
    } else {
      buffer += inline(el, images);
    }
  }
  flush();
}

/** Markdown for an HTML document or fragment, and the images it refers to (in order). */
export function htmlToMarkdown(html: string): { markdown: string; images: HtmlImage[]; title: string | null } {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const images: HtmlImage[] = [];
  const out: string[] = [];
  blocks(doc.body, images, out);
  const title = doc.querySelector("title")?.textContent?.trim() || null;
  return { markdown: out.join("\n\n"), images, title };
}
