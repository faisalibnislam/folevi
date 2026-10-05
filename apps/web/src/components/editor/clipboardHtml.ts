// The HTML the editor puts on the clipboard. It carries every block's data-* attributes, so pasting into a
// note brings the block back whole, but other apps (Gmail, Docs, Word) only read the HTML itself: a table
// was an empty <div>, an image had no <img>, and bullets were plain lines. Here lists become real lists and
// the whole blocks get readable insides, without changing what the editor shows or how it parses a paste.
import { DOMSerializer, type DOMOutputSpec, type Fragment, type Node as PMNode, type Schema } from "@tiptap/pm/model";
import { plainText, sanitizeHref, type InlineNode } from "@folevi/editor-schema";

const LIST_TAG: Record<string, "ul" | "ol"> = { bulleted: "ul", numbered: "ol", todo: "ul" };

type NodeSpecFn = (node: PMNode) => DOMOutputSpec;

/** What other apps see inside a whole block (its data stays on the outer element for pasting back). */
function inside(node: PMNode): DOMOutputSpec[] {
  const a = node.attrs as Record<string, unknown>;
  switch (node.type.name) {
    case "image": {
      const src = typeof a.url === "string" ? sanitizeHref(a.url) : null;
      return src ? [["img", { src, alt: String(a.alt ?? "") }]] : [];
    }
    case "table": {
      const rows = Array.isArray(a.rows) ? (a.rows as InlineNode[][][]) : [];
      return [
        [
          "table",
          {},
          [
            "tbody",
            {},
            ...rows.map((row, r): DOMOutputSpec => ["tr", {}, ...row.map((cell): DOMOutputSpec => [r === 0 && a.headerRow ? "th" : "td", {}, plainText(cell ?? [])])]),
          ],
        ],
      ];
    }
    case "bookmark": {
      const href = typeof a.url === "string" ? sanitizeHref(a.url) : null;
      return href ? [["a", { href }, String(a.title || a.url)]] : [];
    }
    case "page":
      return a.documentId ? [["a", { href: `${location.origin}/d/${String(a.documentId)}` }, String(a.titleCache || "Untitled")]] : [];
    case "file":
    case "audio":
      return a.name ? [["span", {}, String(a.name)]] : [];
    case "formula":
      return a.latex ? [["code", {}, String(a.latex)]] : [];
    default:
      return [];
  }
}

class ClipboardSerializer extends DOMSerializer {
  override serializeFragment(fragment: Fragment, options: { document?: Document } = {}, target?: HTMLElement | DocumentFragment): HTMLElement | DocumentFragment {
    const out = super.serializeFragment(fragment, options, target);
    // One list per run of items (each item was its own list), so numbering counts on and bullets group.
    let prev: Element | null = null;
    for (const el of [...out.childNodes]) {
      if (!(el instanceof Element)) {
        prev = null;
        continue;
      }
      if (prev && el.tagName === prev.tagName && (el.tagName === "UL" || el.tagName === "OL") && el.hasAttribute("data-fb-list") && prev.hasAttribute("data-fb-list")) {
        while (el.firstChild) prev.appendChild(el.firstChild);
        el.remove();
        continue;
      }
      prev = el;
    }
    return out;
  }
}

const cache = new WeakMap<Schema, DOMSerializer>();

export function clipboardSerializer(schema: Schema): DOMSerializer {
  const hit = cache.get(schema);
  if (hit) return hit;
  const base = DOMSerializer.fromSchema(schema);
  const nodes: Record<string, NodeSpecFn> = { ...(base.nodes as Record<string, NodeSpecFn>) };
  for (const [name, fn] of Object.entries(base.nodes as Record<string, NodeSpecFn>)) {
    const type = schema.nodes[name];
    if (!type) continue;
    if (LIST_TAG[name]) {
      // The item keeps the block's attributes (and a data-list the paste rules know), inside a real list.
      nodes[name] = (node) => {
        const spec = fn(node) as [string, Record<string, string>, ...unknown[]];
        const attrs = typeof spec[1] === "object" && spec[1] && !Array.isArray(spec[1]) ? spec[1] : {};
        return [LIST_TAG[name]!, { "data-fb-list": "" }, ["li", { ...attrs, "data-list": name }, 0]];
      };
    } else if (type.isAtom && type.isBlock) {
      nodes[name] = (node) => {
        const spec = fn(node);
        const extra = inside(node);
        return Array.isArray(spec) && extra.length ? ([...(spec as readonly unknown[]), ...extra] as unknown as DOMOutputSpec) : spec;
      };
    }
  }
  const serializer = new ClipboardSerializer(nodes, base.marks);
  cache.set(schema, serializer);
  return serializer;
}
