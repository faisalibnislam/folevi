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

export function text(value: string, marks?: Mark[]): InlineNode[] {
  if (!value) return [];
  return marks && marks.length ? [{ type: "text", text: value, marks }] : [{ type: "text", text: value }];
}

const SAFE_PROTOCOLS = ["http:", "https:", "mailto:", "folevi:"];

/** Returns a safe href or null. Relative paths and fragments are allowed; javascript:, data: etc. are not. */
export function sanitizeHref(raw: string): string | null {
  const href = raw.trim();
  if (!href || href.length > 2048) return null;
  if (href.startsWith("/") || href.startsWith("#")) return href.startsWith("//") ? null : href;
  // Strip control characters and whitespace that browsers ignore inside schemes ("java\tscript:").
  const compact = href.replace(/[\u0000-\u001F\u007F\s]+/g, "");
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(compact);
  if (!match) return `https://${compact}`;
  const protocol = `${match[1]!.toLowerCase()}:`;
  return SAFE_PROTOCOLS.includes(protocol) ? compact : null;
}

export function wordCount(value: string): number {
  const words = value.trim().match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu);
  return words ? words.length : 0;
}
