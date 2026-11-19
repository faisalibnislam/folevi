// The HTML the editor puts on the clipboard. It carries every block's data-* attributes, so pasting into a
// note brings the block back whole, but other apps (Gmail, Docs, Word) only read the HTML itself: a table
// was an empty <div>, an image had no <img>, and bullets were plain lines. Here lists become real lists and
// the whole blocks get readable insides, without changing what the editor shows or how it parses a paste.
import { DOMSerializer, type DOMOutputSpec, type Fragment, type Node as PMNode, type Schema } from "@tiptap/pm/model";
import { plainText, sanitizeHref, tableDisplayRows, tableOptionsFromProps, type InlineNode } from "@folevi/editor-schema";

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
      // Formulas as their results and numbers in their columns' formats, as the note shows them.
      const rows = Array.isArray(a.rows) ? tableDisplayRows(a.rows as InlineNode[][][], tableOptionsFromProps(a)) : [];
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
    case "embed":
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
  /**
   * Each list item comes out of the schema as a list of its own, at the top level. Here they become the
   * lists other apps read (Mail, Notes, Docs, Word): one list per run of items, an item nested under another
   * (by data-depth) inside that item, numbering that counts on after something came between, and a to-do
   * with a check box that says whether it is done. Every item keeps its own attributes, so pasted back into
   * a note it is the block it was.
   */
  override serializeFragment(fragment: Fragment, options: { document?: Document } = {}, target?: HTMLElement | DocumentFragment): HTMLElement | DocumentFragment {
    const out = super.serializeFragment(fragment, options, target);
    /** The lists a next item could go into: the last list at each depth, outermost first. */
    const open: { depth: number; list: Element; item: Element }[] = [];
    /** The number the last numbered item had at each depth, counted as the note counts them (editor.css). */
    const numbers: number[] = [];
    for (const el of [...out.childNodes]) {
      const element = el.nodeType === 1 ? (el as Element) : null;
      const item = element && (element.tagName === "UL" || element.tagName === "OL") && element.hasAttribute("data-fb-list") ? element.firstElementChild : null;
      const depth = Number((item ?? element)?.getAttribute("data-depth") ?? 0) || 0;
      if (!element || !item) {
        // Anything else ends the lists before it; numbers at its depth and deeper start again after it.
        open.length = 0;
        numbers.length = Math.min(numbers.length, depth);
        continue;
      }
      const numbered = element.tagName === "OL";
      numbers.length = Math.min(numbers.length, numbered ? depth + 1 : depth);
      if (numbered) numbers[depth] = (numbers[depth] ?? 0) + 1;
      if (item.getAttribute("data-list") === "todo") {
        const box = item.ownerDocument.createElement("input");
        box.setAttribute("type", "checkbox");
        box.setAttribute("disabled", "");
        if (item.getAttribute("data-checked") === "true") box.setAttribute("checked", "");
        item.insertBefore(box, item.firstChild);
      }
      while (open.length && open[open.length - 1]!.depth > depth) open.pop();
      const same = open.length && open[open.length - 1]!.depth === depth ? open[open.length - 1]! : null;
      if (same && same.list.tagName === element.tagName) {
        // The next item of the list that is open at this depth.
        same.list.appendChild(item);
        same.item = item;
        element.remove();
        continue;
      }
      // A new list: beside a list of another kind at this depth, or the first one this deep.
      if (same) open.pop();
      const parent = open[open.length - 1];
      if (parent) parent.item.appendChild(element);
      if (numbered && numbers[depth]! > 1) element.setAttribute("start", String(numbers[depth]));
      open.push({ depth, list: element, item });
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
