import type { InlineNode, Mark } from "./generated/schema";
import { MarkTypes } from "./generated/schema";

const MARK_ORDER = new Map<string, number>(MarkTypes.map((t, i) => [t, i]));

function markKey(m: Mark): string {
  switch (m.type) {
    case "link":
      return `link:${m.href}`;
    case "color":
    case "highlight":
      return `${m.type}:${m.value}`;
    default:
      return m.type;
  }
}

/** Canonical mark order, one mark per type (the last wins for valued marks). */
export function normalizeMarks(marks: readonly Mark[] | undefined): Mark[] | undefined {
  if (!marks || marks.length === 0) return undefined;
  const byType = new Map<string, Mark>();
  for (const m of marks) byType.set(m.type, m);
  const out = [...byType.values()].sort(
    (a, b) => (MARK_ORDER.get(a.type) ?? 99) - (MARK_ORDER.get(b.type) ?? 99),
  );
  return out.length ? out : undefined;
}

function sameMarks(a: Mark[] | undefined, b: Mark[] | undefined): boolean {
  const ka = (a ?? []).map(markKey).join("|");
  const kb = (b ?? []).map(markKey).join("|");
  return ka === kb;
}

/** Merges adjacent text runs with identical marks, drops empty runs, canonicalizes marks. */
export function normalizeInline(nodes: readonly InlineNode[]): InlineNode[] {
  const out: InlineNode[] = [];
  for (const node of nodes) {
    if (node.type === "text") {
      if (node.text.length === 0) continue;
      const marks = normalizeMarks(node.marks);
      const prev = out[out.length - 1];
      if (prev && prev.type === "text" && sameMarks(prev.marks, marks)) {
        out[out.length - 1] = marks ? { type: "text", text: prev.text + node.text, marks } : { type: "text", text: prev.text + node.text };
        continue;
      }
      out.push(marks ? { type: "text", text: node.text, marks } : { type: "text", text: node.text });
    } else {
      out.push({ ...node });
    }
  }
  return out;
}

export function plainText(nodes: readonly InlineNode[]): string {
  return nodes
    .map((n) => {
      switch (n.type) {
        case "text":
          return n.text;
        case "mention":
          return `@${n.label}`;
        case "date":
          return n.date;
        case "pageLink":
          return n.label;
      }
    })
    .join("");
}

export function textLength(nodes: readonly InlineNode[]): number {
  return plainText(nodes).length;
}

/**
 * Inline content cut into pieces of at most `max` characters (of plain text), each to be its own block, so
 * text over the schema's length limit is kept instead of rejected. Cuts fall on a line break or a space
 * when there is one; formatting carries over to both sides of a cut.
 */
export function splitInline(nodes: readonly InlineNode[], max: number): InlineNode[][] {
  if (textLength(nodes) <= max) return [[...nodes]];
  const parts: InlineNode[][] = [];
  let cur: InlineNode[] = [];
  let len = 0;
  const close = () => {
    const part = normalizeInline(cur);
    if (part.length) parts.push(part);
    cur = [];
    len = 0;
  };
  for (const node of nodes) {
    if (node.type !== "text") {
      const l = plainText([node]).length;
      if (len + l > max) close();
      cur.push(node);
      len += l;
      continue;
    }
    let rest = node.text;
    while (len + rest.length > max) {
      const room = max - len;
      // The last line break in the second half of the room, else the last space, else (a run with no
      // spaces) a hard cut, unless this piece already has text and the run can start the next one.
      const newline = rest.lastIndexOf("\n", room);
      const space = newline > room / 2 ? newline : rest.lastIndexOf(" ", room);
      let cut = space > 0 ? space : len > 0 ? 0 : room;
      // Never between the two halves of an emoji or other surrogate pair.
      if (space <= 0 && cut > 0 && /[\uD800-\uDBFF]/.test(rest[cut - 1] ?? "")) cut--;
      if (cut > 0) cur.push({ ...node, text: rest.slice(0, cut) });
      close();
      rest = rest.slice(space > 0 ? cut + 1 : cut);
    }
    if (rest) {
      cur.push({ ...node, text: rest });
      len += rest.length;
    }
  }
  close();
  return parts;
}

export function text(value: string, marks?: Mark[]): InlineNode[] {
  if (!value) return [];
  return marks && marks.length ? [{ type: "text", text: value, marks }] : [{ type: "text", text: value }];
}

const SAFE_PROTOCOLS = ["http:", "https:", "mailto:", "folevi:"];

/** Returns a safe href or null. Relative paths and fragments are allowed; javascript:, data: etc. are not. */
export function sanitizeHref(raw: string): string | null {
  const href = raw.trim();
  if (!href || href.length > 2048) return null;
  // Two slashes or backslashes in any mix ("//x", "/\\x") are another host to a browser, not a path here.
  // Browsers drop tabs and line breaks inside URLs, so "/\t/x" counts too.
  if (/^[/\\]{2}/.test(href.replace(/[\u0000-\u001F\u007F]+/g, ""))) return null;
  if (href.startsWith("/") || href.startsWith("#")) return href;
  // Strip control characters and whitespace that browsers ignore inside schemes ("java\tscript:").
  const compact = href.replace(/[\u0000-\u001F\u007F\s]+/g, "");
  // "example.com:8080/path" is a host and port, not a scheme.
  if (/^[a-z0-9.-]+:\d+(?:[/?#]|$)/i.test(compact)) return `https://${compact}`;
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(compact);
  if (!match) return `https://${compact}`;
  const protocol = `${match[1]!.toLowerCase()}:`;
  return SAFE_PROTOCOLS.includes(protocol) ? compact : null;
}

export function wordCount(value: string): number {
  const words = value.trim().match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu);
  return words ? words.length : 0;
}
