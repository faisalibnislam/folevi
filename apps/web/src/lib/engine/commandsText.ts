// Revision 24: `text.layout`, lines as this page's WebKit breaks them. The native apps draw the web's small text
// themselves (a note card's preview, a folder card's papers), and iOS WebKit's `text-wrap: pretty` in a
// line-clamped box breaks lines in ways no model of it matches: they ask here and draw the lines they're given.
// Nothing is read or written; the text is set in a hidden paragraph styled as asked.
import type { CommandDef } from "./commands";
import { BridgeError, num, only, oneOf } from "./validate";
import type { CommandName, TextLayoutResult } from "./protocol";

const FAMILIES = ["sans", "display"] as const;
const WRAPS = ["pretty", "wrap", "balance"] as const;
const MAX_TEXTS = 64;
const MAX_CHARS = 4000;

let box: HTMLParagraphElement | null = null;

/** The hidden paragraph the text is set in, under the body (so it has the body's font features). */
function paragraph(): HTMLParagraphElement {
  if (box?.isConnected) return box;
  box = document.createElement("p");
  box.setAttribute("aria-hidden", "true");
  box.style.cssText = "position:absolute;left:-10000px;top:0;visibility:hidden;pointer-events:none;margin:0;padding:0;overflow-wrap:break-word;word-break:normal";
  document.body.appendChild(box);
  return box;
}

/** The text's lines: each its characters from the first on that line to the last, trailing spaces dropped. */
function linesOf(p: HTMLParagraphElement, max: number): string[] {
  const node = p.firstChild;
  if (!node || node.nodeType !== Node.TEXT_NODE) return [];
  const t = node as Text;
  const range = document.createRange();
  const lines: string[] = [];
  let start = -1;
  let top: number | null = null;
  const close = (end: number) => {
    if (start >= 0) lines.push(t.data.slice(start, end).replace(/[ \t]+$/, ""));
  };
  for (let i = 0; i < t.length; i++) {
    const c = t.data[i]!;
    if (c === "\n") {
      // A forced break (pre-line): what's before it ends a line, an empty line stays one.
      if (start < 0) lines.push("");
      else close(i);
      start = -1;
      top = null;
      if (lines.length >= max) break;
      continue;
    }
    range.setStart(t, i);
    range.setEnd(t, i + 1);
    const r = range.getClientRects()[0];
    if (!r) continue;
    if (top === null || Math.abs(r.top - top) > 1) {
      if (top !== null) close(i);
      if (lines.length >= max) break;
      start = i;
      top = r.top;
    }
  }
  if (lines.length < max && start >= 0) close(t.length);
  return lines.slice(0, max);
}

export const TEXT_COMMANDS = {
  "text.layout": {
    async run(_deps, args): Promise<TextLayoutResult> {
      only(args, ["texts", "family", "pxSize", "pxLineHeight", "weight", "pxLetterSpacing", "pxWidth", "wrap", "pre", "clamp"]);
      const texts = args.texts;
      if (!Array.isArray(texts) || texts.length > MAX_TEXTS || texts.some((x) => typeof x !== "string" || x.length > MAX_CHARS)) {
        throw new BridgeError("invalid_args", `texts must be up to ${MAX_TEXTS} strings of up to ${MAX_CHARS} characters.`);
      }
      const family = oneOf(args, "family", FAMILIES);
      const size = num(args, "pxSize", { min: 1, max: 200 });
      const lineHeight = num(args, "pxLineHeight", { min: 1, max: 400 });
      const weight = num(args, "weight", { min: 100, max: 900, fallback: 400 });
      const letterSpacing = num(args, "pxLetterSpacing", { min: -20, max: 20, fallback: 0 });
      const width = num(args, "pxWidth", { min: 1, max: 4000 });
      const wrap = oneOf(args, "wrap", WRAPS);
      const pre = args.pre === true;
      const clamp = args.clamp === undefined ? 0 : num(args, "clamp", { min: 1, max: 200 });
      const p = paragraph();
      const s = p.style;
      s.fontFamily = family === "display" ? "var(--font-display)" : "var(--font-sans)";
      s.fontSize = `${size}px`;
      s.lineHeight = `${lineHeight}px`;
      s.fontWeight = String(weight);
      s.letterSpacing = `${letterSpacing}px`;
      s.width = `${width}px`;
      s.whiteSpace = pre ? "pre-line" : "normal";
      s.setProperty("text-wrap", wrap);
      // A clamped preview is a -webkit-box, as the cards' are: WebKit breaks its lines differently.
      if (clamp) {
        s.display = "-webkit-box";
        s.setProperty("-webkit-box-orient", "vertical");
        s.setProperty("-webkit-line-clamp", String(clamp));
        s.overflow = "hidden";
      } else {
        s.display = "block";
        s.removeProperty("-webkit-line-clamp");
        s.overflow = "visible";
      }
      const lines = texts.map((x) => {
        p.textContent = x;
        return linesOf(p, clamp ? clamp + 1 : 1000);
      });
      p.textContent = "";
      return { lines };
    },
  },
} satisfies Partial<Record<CommandName, CommandDef>>;
