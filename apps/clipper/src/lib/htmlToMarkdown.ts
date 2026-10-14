// HTML to Markdown for clips, run inside the page (the injected extractor) on the article Readability
// found or on the selection. Ported from the web app's importer (apps/web/src/lib/import/htmlToMarkdown.ts)
// and tuned for the web: links and images become absolute against the page's address, images stay remote
// (never uploaded; inline data: images are dropped), figure captions are kept, and in-page anchors and
// javascript: links keep only their text. Scripts, styles, forms and comments never come through.

const TEXT = 3;
const ELEMENT = 1;

const BLOCK = new Set(["p", "div", "section", "article", "header", "footer", "main", "aside", "figure", "body", "center", "details", "summary", "dl", "dd", "dt", "address"]);
const SKIP = new Set(["script", "style", "head", "title", "meta", "link", "noscript", "template", "svg", "canvas", "button", "input", "select", "textarea", "form", "iframe", "object", "embed", "video", "audio", "nav", "dialog"]);
const BLOCK_CHILD = /^(h[1-6]|ul|ol|blockquote|pre|hr|table|p|div|section|figure|figcaption|article|header|footer|aside|details|dl)$/i;

/** Characters that would read as Markdown, escaped in plain text. */
function escapeText(text: string): string {
  return text.replace(/([\\`*_[\]])/g, "\\$1");
}

/** An absolute http(s) or mailto address, or null for anything else (javascript:, data:, in-page anchors). */
export function safeUrl(raw: string | null | undefined, base: string, allowMailto = false): string | null {
  const value = (raw ?? "").trim();
  if (!value || value.startsWith("#")) return null;
  try {
    const url = new URL(value, base);
    if (url.protocol === "http:" || url.protocol === "https:" || (allowMailto && url.protocol === "mailto:")) return url.href.replace(/\)/g, "%29").replace(/ /g, "%20");
  } catch {
    // Not an address.
  }
  return null;
}

/** An image's address: src, else a lazy-loading attribute, else the first srcset candidate. */
function imageSrc(el: Element, base: string): string | null {
  const candidates = [el.getAttribute("src"), el.getAttribute("data-src"), el.getAttribute("data-original"), (el.getAttribute("srcset") ?? el.getAttribute("data-srcset") ?? "").split(",")[0]?.trim().split(/\s+/)[0]];
  for (const c of candidates) {
    const url = safeUrl(c, base);
    if (url) return url;
  }
  return null;
}

class Converter {
  constructor(private readonly base: string) {}

  inline(node: Node): string {
    if (node.nodeType === TEXT) return escapeText((node.textContent ?? "").replace(/\s+/g, " "));
    if (node.nodeType !== ELEMENT) return "";
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (SKIP.has(tag)) return "";
    const inner = () => [...el.childNodes].map((c) => this.inline(c)).join("");
    const wrap = (mark: string) => {
      const t = inner();
      return t.trim() ? `${mark}${t.trim()}${mark}` : t;
    };
    switch (tag) {
      case "br":
        return "\n";
      case "strong":
      case "b":
        return wrap("**");
      case "em":
      case "i":
      case "cite":
        return wrap("_");
      case "s":
      case "strike":
      case "del":
        return wrap("~~");
      case "code":
      case "kbd":
      case "samp":
        return `\`${(el.textContent ?? "").replace(/`/g, "'")}\``;
      case "a": {
        const t = inner().trim();
        const href = safeUrl(el.getAttribute("href"), this.base, true);
        if (!href) return t;
        return `[${t || href}](${href})`;
      }
      case "img": {
        const src = imageSrc(el, this.base);
        if (!src) return "";
        const alt = (el.getAttribute("alt") ?? "").replace(/[[\]\s]+/g, " ").trim();
        return `\n\n![${alt}](${src})\n\n`;
      }
      case "picture": {
        const img = el.querySelector("img");
        return img ? this.inline(img) : "";
      }
      default:
        return inner();
    }
  }

  list(el: Element, depth: number, out: string[]) {
    const ordered = el.tagName.toLowerCase() === "ol";
    let n = Number(el.getAttribute("start")) || 1;
    for (const li of [...el.children].filter((c) => c.tagName.toLowerCase() === "li")) {
      const nested: Element[] = [];
      const parts: string[] = [];
      let checked: boolean | null = null;
      for (const c of [...li.childNodes]) {
        if (c.nodeType === ELEMENT && ["ul", "ol"].includes((c as Element).tagName.toLowerCase())) nested.push(c as Element);
        else if (c.nodeType === ELEMENT && (c as Element).tagName.toLowerCase() === "input" && (c as Element).getAttribute("type") === "checkbox") checked = (c as Element).hasAttribute("checked");
        else parts.push(this.inline(c));
      }
      let text = parts.join("").replace(/\s*\n\s*/g, " ").trim();
      if (checked !== null) text = `[${checked ? "x" : " "}] ${text}`;
      out.push(`${"  ".repeat(depth)}${ordered && checked === null ? `${n++}.` : "-"} ${text}`);
      for (const sub of nested) this.list(sub, depth + 1, out);
    }
  }

  table(el: Element): string {
    const rows = [...el.querySelectorAll("tr")].map((tr) =>
      [...tr.children].filter((c) => ["td", "th"].includes(c.tagName.toLowerCase())).map((c) => this.inline(c).replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|").trim()),
    );
    const filled = rows.filter((r) => r.length);
    if (!filled.length) return "";
    const width = Math.max(...filled.map((r) => r.length));
    const pad = (r: string[]) => [...r, ...Array.from({ length: width - r.length }, () => "")];
    const [head, ...body] = filled.map(pad);
    return [`| ${head!.join(" | ")} |`, `| ${head!.map(() => "---").join(" | ")} |`, ...body.map((r) => `| ${r.join(" | ")} |`)].join("\n");
  }

  blocks(node: Node, out: string[]) {
    let buffer = "";
    const flush = () => {
      const text = buffer.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      if (text) out.push(text);
      buffer = "";
    };
    for (const child of [...node.childNodes]) {
      if (child.nodeType !== ELEMENT) {
        buffer += this.inline(child);
        continue;
      }
      const el = child as Element;
      const tag = el.tagName.toLowerCase();
      if (SKIP.has(tag)) continue;
      if (/^h[1-6]$/.test(tag)) {
        flush();
        const t = this.inline(el).replace(/\s+/g, " ").trim();
        if (t) out.push(`${"#".repeat(Math.min(3, Number(tag[1])))} ${t}`);
      } else if (tag === "ul" || tag === "ol") {
        flush();
        const lines: string[] = [];
        this.list(el, 0, lines);
        if (lines.length) out.push(lines.join("\n"));
      } else if (tag === "blockquote") {
        flush();
        const inner: string[] = [];
        this.blocks(el, inner);
        if (inner.length) out.push(inner.join("\n\n").split("\n").map((l) => `> ${l}`).join("\n"));
      } else if (tag === "pre") {
        flush();
        const code = (el.textContent ?? "").replace(/\n$/, "");
        const fence = code.includes("```") ? "~~~" : "```";
        const lang = /language-([\w+-]+)/.exec(el.querySelector("code")?.className ?? el.className)?.[1] ?? "";
        out.push(`${fence}${lang}\n${code}\n${fence}`);
      } else if (tag === "hr") {
        flush();
        out.push("---");
      } else if (tag === "table") {
        flush();
        const t = this.table(el);
        if (t) out.push(t);
      } else if (tag === "figcaption") {
        flush();
        const t = this.inline(el).replace(/\s+/g, " ").trim();
        if (t) out.push(`_${t.replace(/^_+|_+$/g, "")}_`);
      } else if (BLOCK.has(tag)) {
        flush();
        if ([...el.children].some((c) => BLOCK_CHILD.test(c.tagName))) this.blocks(el, out);
        else {
          buffer = this.inline(el);
          flush();
        }
      } else {
        buffer += this.inline(el);
      }
    }
    flush();
  }
}

/** Markdown for a node's content (an article's container, or a selection's fragment). */
export function nodeToMarkdown(node: Node, baseUrl: string): string {
  const out: string[] = [];
  new Converter(baseUrl).blocks(node, out);
  return out.join("\n\n");
}

/** Markdown for an HTML fragment (what Readability returns). */
export function htmlToMarkdown(html: string, baseUrl: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return nodeToMarkdown(doc.body, baseUrl);
}
