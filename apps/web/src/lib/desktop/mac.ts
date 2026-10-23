// Folevi for Mac's web layer (docs/MAC_POLISH_PLAN.md, package WM4): what the page does differently inside the
// native Mac app (apps/mac, WebKit). It marks <html data-desktop="mac"> before the first paint
// (apps/mac/Folevi/Bridge/mac-bridge.js); the website in a browser never has it, so nothing here changes the website.

/** Inside Folevi for Mac. */
export function inMacApp(): boolean {
  return typeof document !== "undefined" && document.documentElement.getAttribute("data-desktop") === "mac";
}

/** Keys only a keyboard sends while moving around: after one of these, focus rings show (globals.css, data-input). */
const NAVIGATION_KEYS = new Set(["Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Escape", "PageUp", "PageDown", "Home", "End", "Enter", " "]);

/**
 * Keeps <html data-input> as the Mac expects (MAC_POLISH_PLAN.md §2.5): "key" once the keyboard moves focus (Tab,
 * the arrows, a ⌘ shortcut), "pointer" from the next mouse or trackpad press. Focus rings show only for "key", so a
 * click never leaves one behind, nor does a menu closed by a click. Returns the function that stops.
 */
export function installMacInputModality(): () => void {
  const root = document.documentElement;
  const key = (e: KeyboardEvent) => {
    if (!e.isTrusted) return;
    // Typing in a field isn't moving focus: only the navigation keys and shortcuts count.
    const typing = e.target instanceof HTMLElement && e.target.closest("input, textarea, [contenteditable]:not([contenteditable='false'])");
    if ((NAVIGATION_KEYS.has(e.key) && !(typing && (e.key === " " || e.key === "Enter"))) || e.key === "Tab" || ((e.metaKey || e.ctrlKey) && e.key.length === 1)) root.dataset.input = "key";
  };
  const pointer = (e: PointerEvent) => {
    if (e.isTrusted) root.dataset.input = "pointer";
  };
  window.addEventListener("keydown", key, true);
  window.addEventListener("pointerdown", pointer, true);
  return () => {
    window.removeEventListener("keydown", key, true);
    window.removeEventListener("pointerdown", pointer, true);
    delete root.dataset.input;
  };
}
