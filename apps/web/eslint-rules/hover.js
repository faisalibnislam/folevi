// folevi/button-hover: every button shows a visible hover (the owner's rule, 6 November 2026: "all buttons show
// hover effect everywhere"). A <button> (or role="button") passes when its className carries a hover of its own:
// a `hover:` utility (group-hover:, [&:hover] count too), or a class the app's CSS gives a :hover (ui-btn-*,
// ui-input, ui-menu-item, ...), or it sits inside an element whose CSS hovers its children (ui-seg, ...).
// Classes are read from the CSS files under src, so a new shared style counts without touching this rule.
// A className made only of what it can't see into (a prop passed down, a value from elsewhere) isn't flagged: the
// caller owns it.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

/** A selector without its functional pseudo-classes: :not(...) and :has(...) go, :is(...) and :where(...) become
 *  their classes, plus `:hover` when they hold one (`.ui-tab:is(:hover, ...)`). */
function flatten(sel) {
  let out = "";
  for (let i = 0; i < sel.length; i++) {
    const m = /^:(is|where|not|has)\(/.exec(sel.slice(i));
    if (!m) {
      out += sel[i];
      continue;
    }
    let depth = 0;
    let j = i + m[0].length - 1;
    for (; j < sel.length; j++) {
      if (sel[j] === "(") depth += 1;
      if (sel[j] === ")" && --depth === 0) break;
    }
    const inner = sel.slice(i + m[0].length, j);
    // :is(.a, .b) keeps its classes (any of them may be the one hovered).
    if (m[1] === "is" || m[1] === "where") out += [...inner.matchAll(/\.[A-Za-z_][\w-]*/g)].join("") + (inner.includes(":hover") ? ":hover" : "");
    i = j;
  }
  return out;
}

/** Class names whose element hovers (`.x:hover`) and class names whose descendants hover (`.x > *:hover`). */
function cssHoverClasses() {
  const own = new Set();
  const parents = new Set();
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".css")) read(fs.readFileSync(p, "utf8"));
    }
  };
  const read = (css) => {
    css = css.replace(/\/\*[\s\S]*?\*\//g, "");
    // Each rule's selector list: the text before a "{" back to the previous "}", "{" or ";".
    for (const m of css.matchAll(/([^{};]+)\{/g)) {
      // Split the list on its top-level commas (not the ones inside :is(...) or :not(...)).
      const list = [];
      let depth = 0;
      let cur = "";
      for (const ch of m[1]) {
        if (ch === "(") depth += 1;
        if (ch === ")") depth -= 1;
        if (ch === "," && depth === 0) {
          list.push(cur);
          cur = "";
        } else cur += ch;
      }
      list.push(cur);
      for (const raw of list) {
        if (!raw.includes(":hover")) continue;
        const sel = flatten(raw);
        // The compound selector carrying :hover, and the ones before it.
        const parts = sel.trim().split(/\s*[\s>+~]\s*/);
        const at = parts.findIndex((p) => p.includes(":hover"));
        if (at < 0) continue;
        const classesOf = (s) => [...s.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((x) => x[1]);
        const mine = classesOf(parts[at]);
        // Tailwind's `group` marks a hover that reveals something inside, not a hover of the group itself.
        if (mine.length) mine.filter((c) => c !== "group").forEach((c) => own.add(c));
        else parts.slice(0, at).forEach((p) => classesOf(p).forEach((c) => parents.add(c)));
      }
    }
  };
  walk(SRC);
  return { own, parents };
}

let cached;
const hoverClasses = () => (cached ??= cssHoverClasses());

/** The string pieces of a className expression, and whether some part of it can't be read. */
function pieces(expr, scope, file, seen = new Set()) {
  const out = { strings: [], opaque: false };
  const visit = (n) => {
    if (!n) return;
    switch (n.type) {
      case "Literal":
        if (typeof n.value === "string") out.strings.push(n.value);
        return;
      case "TemplateLiteral":
        n.quasis.forEach((q) => out.strings.push(q.value.cooked ?? q.value.raw));
        n.expressions.forEach(visit);
        return;
      case "JSXExpressionContainer":
        return visit(n.expression);
      case "ConditionalExpression":
        visit(n.consequent);
        visit(n.alternate);
        return;
      case "LogicalExpression":
      case "BinaryExpression":
        visit(n.left);
        visit(n.right);
        return;
      case "CallExpression":
        // cn(...), [..].join(" "), clsx(...): their string arguments.
        n.arguments.forEach(visit);
        if (n.callee.type === "MemberExpression") visit(n.callee.object);
        // A local helper (const segBtn = (on) => `...`): the strings it returns.
        else visit(n.callee);
        return;
      case "ArrowFunctionExpression":
        if (n.body.type !== "BlockStatement") visit(n.body);
        else out.opaque = true;
        return;
      case "ArrayExpression":
        n.elements.forEach(visit);
        return;
      case "ObjectExpression":
        // { "hover:bg-x": cond } or { a: "hover:..." } (a lookup table of variants).
        n.properties.forEach((p) => {
          if (p.type !== "Property") return (out.opaque = true);
          if (p.key.type === "Literal") visit(p.key);
          visit(p.value);
        });
        return;
      case "MemberExpression":
        // variants[variant]: every value the table holds.
        visit(n.object);
        return;
      case "Identifier": {
        let s = scope;
        while (s) {
          const v = s.set.get(n.name);
          if (v) {
            const def = v.defs[0];
            if (def && def.type === "Variable" && def.node.init && !seen.has(v)) {
              seen.add(v);
              visit(def.node.init);
            } else if (def && def.type === "ImportBinding" && def.node.type === "ImportSpecifier") {
              // An exported class string in another of the app's files (export const ROW_SEG = "ui-seg ...").
              const found = importedStrings(file, def.parent.source.value, def.node.imported.name);
              if (found) out.strings.push(...found);
              else out.opaque = true;
            } else out.opaque = true;
            return;
          }
          s = s.upper;
        }
        out.opaque = true;
        return;
      }
      case "TSAsExpression":
      case "TSNonNullExpression":
        return visit(n.expression);
      default:
        out.opaque = true;
    }
  };
  visit(expr);
  return out;
}

/** The string literals of `export const NAME = ...` in an imported file of the app (`@/...` or relative), or null. */
function importedStrings(from, source, name) {
  let base;
  if (source.startsWith("@/")) base = path.join(SRC, source.slice(2));
  else if (source.startsWith(".")) base = path.resolve(path.dirname(from), source);
  else return null;
  const file = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"].map((x) => base + x).find((p) => fs.existsSync(p) && fs.statSync(p).isFile());
  if (!file) return null;
  const m = new RegExp(`export const ${name}\\s*(?::[^=]+)?=\\s*([\\s\\S]*?);\\s*\\n`).exec(fs.readFileSync(file, "utf8"));
  if (!m || /\$\{|\bfunction\b|=>/.test(m[1])) return null;
  const strings = [...m[1].matchAll(/"([^"]*)"|`([^`]*)`|'([^']*)'/g)].map((x) => x[1] ?? x[2] ?? x[3]);
  return strings.length ? strings : null;
}

const attr = (open, name) => open.attributes.find((a) => a.type === "JSXAttribute" && a.name.name === name);
const tokens = (strings) => strings.join(" ").split(/\s+/).filter(Boolean);

export default {
  rules: {
    "button-hover": {
      meta: { type: "suggestion", messages: { missing: "This {{tag}} has no hover: give it a hover: class or a shared style (ui-btn-*, ui-input, ui-seg, ui-menu-item)." } },
      create(context) {
        const sourceCode = context.sourceCode ?? context.getSourceCode();
        const { own, parents } = hoverClasses();
        // Its own hover: a hover: utility (enabled:hover:, dark:hover:, [&:hover]), not a group-hover: or peer-hover: that only
        // reveals it while something else is hovered (opacity-0 group-hover:opacity-100 is shown, not hovered).
        const ownHover = (t) => (/(^|:)hover:/.test(t) && !/(group|peer)-hover/.test(t)) || t.includes("&:hover");
        const hovers = (strings) => tokens(strings).some((t) => ownHover(t) || own.has(t));
        const classStrings = (open, node, name = "className") => {
          const a = attr(open, name);
          if (!a || !a.value) return { strings: [], opaque: false };
          return pieces(a.value, sourceCode.getScope ? sourceCode.getScope(node) : context.getScope(), context.filename ?? context.getFilename());
        };
        /** Whether the control at `node`, styled by its `name` attribute, shows a hover (or needs none). */
        const passes = (node, name) => {
          const open = node.openingElement;
          const own_ = classStrings(open, node, name);
          // Nothing readable at all (className={className}): the caller owns the look.
          if (own_.opaque && !own_.strings.join("").trim()) return true;
          if (hovers(own_.strings)) return true;
          const toks = tokens(own_.strings);
          if (toks.some((t) => t === "sr-only" || t === "pointer-events-none")) return true;
          // A scrim (the dimmed backdrop a click closes) isn't a control.
          if (own_.strings.some((s) => s.includes("--color-scrim"))) return true;
          // The iPhone app's own controls (iphone-*, *-phone*): touched, never pointed at.
          if (toks.some((t) => /^iphone-|-phone(-|$)/.test(t))) return true;
          // A group whose hover shows on something inside it (group-hover: on a child).
          if (toks.some((t) => /^group(\/|$)/.test(t)) && sourceCode.getText(node).includes("group-hover")) return true;
          // A parent whose CSS hovers its children (ui-seg, ...), or a part of the iPhone layout (iphone-*).
          for (let p = node.parent; p; p = p.parent) {
            if (p.type !== "JSXElement") continue;
            const ps = classStrings(p.openingElement, p);
            if (tokens(ps.strings).some((t) => parents.has(t) || /^iphone-/.test(t))) return true;
          }
          return false;
        };
        const LINKS = new Set(["a", "Link", "AppLink"]);
        return {
          JSXElement(node) {
            const open = node.openingElement;
            const tag = open.name.type === "JSXIdentifier" ? open.name.name : null;
            if (!tag) return;
            if (attr(open, "aria-hidden") || attr(open, "hidden")) return;
            const disabled = attr(open, "disabled");
            if (disabled && (disabled.value === null || (disabled.value.type === "JSXExpressionContainer" && disabled.value.expression.type === "Literal" && disabled.value.expression.value === true))) return;
            // A menu's trigger (MenuButton, FolderMenu, BlockExportMenu, ...): the class it gives the trigger button.
            if (attr(open, "triggerClassName")) {
              if (!passes(node, "triggerClassName")) context.report({ node: open, messageId: "missing", data: { tag: `<${tag}> trigger` } });
              return;
            }
            if (open.attributes.some((a) => a.type === "JSXSpreadAttribute")) return;
            const role = attr(open, "role");
            const isButton = tag === "button" || (/^[a-z]/.test(tag) && role?.value?.type === "Literal" && role.value.value === "button");
            // A link drawn as a button or a card (it has corners): the same rule. A link in running text isn't.
            const isButtonLink = LINKS.has(tag) && tokens(classStrings(open, node).strings).some((t) => /^rounded/.test(t));
            if (!isButton && !isButtonLink) return;
            if (passes(node, "className")) return;
            context.report({ node: open, messageId: "missing", data: { tag: tag === "button" ? "<button>" : isButtonLink ? `<${tag}>` : `<${tag} role="button">` } });
          },
        };
      },
    },
  },
};
