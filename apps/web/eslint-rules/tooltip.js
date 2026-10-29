// folevi/icon-button-tooltip: a button or link that shows only an icon must say what it does on hover. Folevi's
// tooltip shows an element's `title` (lib/desktop/tooltip.ts), so an icon-only <button>, <a> or <AppLink> needs a
// `title` (IconButton and MenuButton set theirs from `label`). Anything with visible text, a spread of props
// (which may carry a title) or children it can't see into isn't flagged.

const CONTROLS = new Set(["button", "a", "AppLink"]);

/** Whether a JSX child is an icon: an element (an <svg>, a Lucide icon, a glyph component) or blank text. */
function iconOnly(children) {
  let icons = 0;
  for (const c of children) {
    if (c.type === "JSXText") {
      if (c.value.trim()) return false;
      continue;
    }
    if (c.type === "JSXElement") {
      const name = c.openingElement.name;
      const tag = name.type === "JSXIdentifier" ? name.name : "";
      // A text element (a label in a <span>) is text.
      if (/^[a-z]/.test(tag) && tag !== "svg") return false;
      icons += 1;
      continue;
    }
    // {expressions}, fragments: can't tell what they show.
    return false;
  }
  return icons > 0;
}

export default {
  rules: {
    "icon-button-tooltip": {
      meta: { type: "suggestion", messages: { missing: "An icon-only {{tag}} needs a title: Folevi's tooltip shows it on hover." } },
      create(context) {
        return {
          JSXElement(node) {
            const open = node.openingElement;
            const tag = open.name.type === "JSXIdentifier" ? open.name.name : null;
            if (!tag || !CONTROLS.has(tag)) return;
            const attrs = open.attributes;
            if (attrs.some((a) => a.type === "JSXSpreadAttribute")) return;
            if (attrs.some((a) => a.type === "JSXAttribute" && a.name.name === "title")) return;
            // Hidden from people (a decoration, or a control only screen readers use) isn't shown on hover.
            if (attrs.some((a) => a.type === "JSXAttribute" && (a.name.name === "aria-hidden" || a.name.name === "hidden"))) return;
            if (!iconOnly(node.children)) return;
            context.report({ node: open, messageId: "missing", data: { tag: `<${tag}>` } });
          },
        };
      },
    },
  },
};
