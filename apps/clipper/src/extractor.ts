// Runs inside the page being clipped (injected with chrome.scripting.executeScript, in the extension's
// isolated world, only when the person clips or opens the popup). It defines one function the extension
// then calls: Readability finds the article (on a copy of the page, so the page itself is untouched), the
// selection is read from the live page, and both come back as Markdown with the page's title and address.
// Nothing here talks to the network.
import { Readability } from "@mozilla/readability";
import { htmlToMarkdown, nodeToMarkdown } from "./lib/htmlToMarkdown";
import type { Extracted, ExtractMode } from "./lib/messages";

/** Never parse more than this much of a page (Readability's own cap on elements). */
const MAX_ELEMS = 20_000;
/** Markdown longer than this is cut later (lib/note.ts); stop converting well past it. */
const MAX_MARKDOWN = 400_000;

function selectionMarkdown(): string {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return "";
  const box = document.createElement("div");
  for (let i = 0; i < sel.rangeCount; i++) box.appendChild(sel.getRangeAt(i).cloneContents());
  return nodeToMarkdown(box, document.baseURI).trim() || sel.toString().trim();
}

function linkTextFor(href: string): string {
  for (const a of Array.from(document.links)) if (a.href === href) return (a.textContent ?? "").replace(/\s+/g, " ").trim();
  return "";
}

/** "Clean notes | Example Weekly" is "Clean notes" when the site's name is known. */
export function withoutSiteName(title: string, siteName: string | null | undefined): string {
  const site = (siteName ?? "").trim();
  if (!site) return title;
  const escaped = site.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const stripped = title.replace(new RegExp(`\\s+[|\\-\u2013\u2014:\u00b7]\\s+${escaped}$`, "i"), "").trim();
  return stripped || title;
}

function article(): Omit<Extracted, "url" | "hasSelection"> {
  const copy = document.cloneNode(true) as Document;
  const parsed = (() => {
    try {
      return new Readability(copy, { maxElemsToParse: MAX_ELEMS, keepClasses: false }).parse();
    } catch {
      return null;
    }
  })();
  if (parsed?.content) {
    return { title: withoutSiteName((parsed.title ?? "").trim() || document.title, parsed.siteName), markdown: htmlToMarkdown(parsed.content, document.baseURI).slice(0, MAX_MARKDOWN), byline: parsed.byline ?? null, siteName: parsed.siteName ?? null, readable: true };
  }
  // Not an article (an app, a listing): the page's main text, without its navigation.
  const body = (document.querySelector("main") ?? document.body)?.cloneNode(true) as HTMLElement | undefined;
  body?.querySelectorAll("nav, header, footer, aside, [role=navigation], [role=banner], [role=contentinfo]").forEach((n) => n.remove());
  return { title: document.title, markdown: body ? nodeToMarkdown(body, document.baseURI).slice(0, MAX_MARKDOWN) : "", byline: null, siteName: null, readable: false };
}

function extract(mode: ExtractMode, linkUrl?: string): Extracted {
  const url = location.href;
  const hasSelection = !(window.getSelection()?.isCollapsed ?? true);
  if (mode === "selection") return { url, hasSelection, title: document.title, markdown: selectionMarkdown(), byline: null, siteName: null, readable: true };
  if (mode === "link") return { url, hasSelection, title: linkTextFor(linkUrl ?? ""), markdown: "", byline: null, siteName: null, readable: true };
  return { url, hasSelection, ...article() };
}

(globalThis as unknown as { __foleviExtract: typeof extract }).__foleviExtract = extract;
