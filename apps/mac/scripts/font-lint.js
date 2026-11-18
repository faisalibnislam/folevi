// Finds interface text of the note page that isn't in the system font in Folevi for Mac's native look
// (docs/MAC_NATIVE_LOOK.md: the system font for the whole app, but for notes, folders and the editor).
// An async function body for the page (mac.mjs eval @apps/mac/scripts/font-lint.js): the text on screen now whose
// font is one of Folevi's own (Spectral, Instrument Sans, ...) outside the note's own sheet and note previews.
const NOTE = ".fb-page, .ProseMirror, [data-note-font], [data-theme-preview], [data-note-preview], [style*='font-family']";
const out = new Map();
const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
for (let n = tw.nextNode(); n; n = tw.nextNode()) {
  const text = n.textContent.trim();
  const el = n.parentElement;
  if (!text || !el || el.closest(NOTE) || el.closest(".sr-only")) continue;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) continue;
  const cs = getComputedStyle(el);
  if (cs.visibility === "hidden" || cs.display === "none") continue;
  const family = cs.fontFamily.split(",")[0].trim().replace(/["']/g, "");
  if (/^(-apple-system|BlinkMacSystemFont|system-ui|ui-monospace|SFMono-Regular|SF Mono|Menlo|monospace)$/i.test(family)) continue;
  const key = `${family} | ${text.slice(0, 40)}`;
  if (!out.has(key)) out.set(key, { family, text: text.slice(0, 50), size: cs.fontSize, cls: String(el.className?.baseVal ?? el.className).slice(0, 100) });
}
return [...out.values()];
