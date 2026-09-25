// Paste normalization: arbitrary HTML (web pages, Google Docs, Word, other editors) → canonical blocks.
// Only structure and safe inline formatting survive; scripts, styles and unknown markup are dropped.
import { SCHEMA_VERSION, normalizeInline, rankSequence, sanitizeHref, ulid, type InlineNode, type Mark, type WireBlock } from "@folevi/editor-schema";

interface Draft {
  type: string;
  depth: number;
  text: InlineNode[];
  props: Record<string, unknown>;
}

const BLOCK_TAGS = new Set(["P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "BLOCKQUOTE", "PRE", "HR", "UL", "OL", "TABLE", "IMG", "FIGURE", "SECTION", "ARTICLE", "HEADER", "FOOTER", "ASIDE", "DETAILS"]);
const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "IFRAME", "OBJECT", "EMBED", "SVG", "CANVAS", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "META", "LINK", "HEAD", "TITLE"]);

function inlineOf(el: Node, marks: Mark[] = []): InlineNode[] {
  const out: InlineNode[] = [];
  el.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = (child.textContent ?? "").replace(/\s+/g, " ");
      if (text) out.push(marks.length ? { type: "text", text, marks: [...marks] } : { type: "text", text });
      return;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return;
    const e = child as HTMLElement;
    if (SKIP.has(e.tagName) || BLOCK_TAGS.has(e.tagName)) return;
    if (e.tagName === "BR") {
      out.push({ type: "text", text: "\n" });
      return;
    }
    const next = [...marks];
    const style = e.getAttribute("style") ?? "";
    if (e.tagName === "STRONG" || e.tagName === "B" || /font-weight:\s*(bold|[6-9]00)/.test(style)) next.push({ type: "bold" });
    if (e.tagName === "EM" || e.tagName === "I" || /font-style:\s*italic/.test(style)) next.push({ type: "italic" });
    if (e.tagName === "U" || /text-decoration[^;]*underline/.test(style)) next.push({ type: "underline" });
    if (e.tagName === "S" || e.tagName === "DEL" || e.tagName === "STRIKE" || /line-through/.test(style)) next.push({ type: "strike" });
    if (e.tagName === "CODE" || e.tagName === "KBD" || e.tagName === "SAMP") next.push({ type: "code" });
    if (e.tagName === "MARK") next.push({ type: "highlight", value: "yellow" });
    if (e.tagName === "A") {
      const href = sanitizeHref(e.getAttribute("href") ?? "");
      if (href && !href.startsWith("#")) next.push({ type: "link", href });
    }
    out.push(...inlineOf(e, next));
  });
  return out;
}

function clean(nodes: InlineNode[]): InlineNode[] {
  const normalized = normalizeInline(nodes);
  // Trim leading/trailing whitespace of the block.
  const first = normalized[0];
  if (first?.type === "text") first.text = first.text.replace(/^\s+/, "");
  const last = normalized[normalized.length - 1];
  if (last?.type === "text") last.text = last.text.replace(/\s+$/, "");
  return normalizeInline(normalized);
}

function walk(el: Element, depth: number, out: Draft[], listType: "bulleted" | "numbered" | null = null): void {
  el.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = (child.textContent ?? "").trim();
      if (text) out.push({ type: "paragraph", depth, text: [{ type: "text", text }], props: {} });
      return;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return;
    const e = child as HTMLElement;
    if (SKIP.has(e.tagName)) return;
    switch (e.tagName) {
      case "H1":
      case "H2":
      case "H3":
      case "H4":
      case "H5":
      case "H6": {
        const text = clean(inlineOf(e));
        if (text.length) out.push({ type: "heading", depth: 0, text, props: { level: Math.min(3, Number(e.tagName[1])) } });
        return;
      }
      case "P": {
        const text = clean(inlineOf(e));
        if (text.length) out.push({ type: "paragraph", depth, text, props: {} });
        return;
      }
      case "UL":
      case "OL":
        walk(e, listType ? depth + 1 : depth, out, e.tagName === "OL" ? "numbered" : "bulleted");
        return;
      case "LI": {
        const checkbox = e.querySelector(":scope > input[type=checkbox], :scope > p > input[type=checkbox]") as HTMLInputElement | null;
        const text = clean(inlineOf(e));
        const nested = [...e.children].filter((c) => c.tagName === "UL" || c.tagName === "OL" || c.tagName === "P");
        let inline = text;
        if (!inline.length) {
          const p = nested.find((n) => n.tagName === "P");
          if (p) inline = clean(inlineOf(p));
        }
        const type = checkbox || e.getAttribute("data-checked") !== null || /task-list-item|checklist/.test(e.className) ? "todo" : (listType ?? "bulleted");
        const props = type === "todo" ? { checked: Boolean(checkbox?.checked) || e.getAttribute("data-checked") === "true" } : {};
        out.push({ type, depth, text: inline, props });
        for (const n of nested) if (n.tagName !== "P") walk(n, depth + 1, out, n.tagName === "OL" ? "numbered" : "bulleted");
        return;
      }
      case "BLOCKQUOTE": {
        const text = clean(inlineOf(e));
        if (text.length) out.push({ type: "quote", depth, text, props: {} });
        else walk(e, depth, out);
        return;
      }
      case "PRE": {
        const code = e.textContent ?? "";
        const cls = e.querySelector("code")?.className ?? "";
        const lang = /language-(\w+)/.exec(cls)?.[1] ?? "plaintext";
        out.push({ type: "code", depth: 0, text: [], props: { language: lang, code: code.replace(/\n$/, "") } });
        return;
      }
      case "HR":
        out.push({ type: "divider", depth: 0, text: [], props: {} });
        return;
      case "IMG": {
        const src = e.getAttribute("src") ?? "";
        if (/^https:\/\//i.test(src)) out.push({ type: "image", depth, text: [], props: { url: src, alt: e.getAttribute("alt") ?? "", caption: "" } });
        return;
      }
      case "TABLE": {
        const rows = [...e.querySelectorAll("tr")].slice(0, 200).map((tr) => [...tr.querySelectorAll("th,td")].slice(0, 20).map((c) => clean(inlineOf(c))));
        const width = Math.max(1, ...rows.map((r) => r.length));
        if (rows.length) out.push({ type: "table", depth: 0, text: [], props: { headerRow: Boolean(e.querySelector("th")), rows: rows.map((r) => [...r, ...Array.from({ length: width - r.length }, () => [])]) } });
        return;
      }
      default: {
        if ([...e.children].some((c) => BLOCK_TAGS.has(c.tagName))) {
          walk(e, depth, out, listType);
          return;
        }
        const text = clean(inlineOf(e));
        if (text.length) out.push({ type: "paragraph", depth, text, props: {} });
      }
    }
  });
}

export function htmlToBlocks(html: string): WireBlock[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const drafts: Draft[] = [];
  walk(doc.body, 0, drafts);
  // Convert depth annotations into parents/ranks.
  const blocks: WireBlock[] = [];
  const stack: { id: string; depth: number }[] = [];
  const siblingsCount = new Map<string | null, number>();
  const assigned: { draft: Draft; id: string; parentId: string | null }[] = [];
  for (const d of drafts) {
    const depth = Math.min(d.depth, stack.length ? stack[stack.length - 1]!.depth + 1 : 0);
    while (stack.length && stack[stack.length - 1]!.depth >= depth) stack.pop();
    const parentId = depth > 0 && stack.length ? stack[stack.length - 1]!.id : null;
    const id = ulid();
    assigned.push({ draft: d, id, parentId });
    siblingsCount.set(parentId, (siblingsCount.get(parentId) ?? 0) + 1);
    stack.push({ id, depth });
  }
  const rankPools = new Map<string | null, string[]>();
  for (const [parent, count] of siblingsCount) rankPools.set(parent, rankSequence(count));
  for (const a of assigned) {
    const rank = rankPools.get(a.parentId)!.shift()!;
    blocks.push({ id: a.id, type: a.draft.type, parentId: a.parentId, rank, schemaVersion: SCHEMA_VERSION, text: a.draft.text, props: a.draft.props });
  }
  return blocks;
}
