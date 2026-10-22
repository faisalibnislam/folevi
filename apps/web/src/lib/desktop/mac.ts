// Folevi for Mac's web layer (docs/MAC_POLISH_PLAN.md, package WM4): what the page does differently inside the
// Mac app, today's Electron app and the native WebKit app alike. Both mark <html data-desktop="mac"> before the
// first paint (apps/desktop/src/preload.ts, apps/mac/Folevi/Bridge/mac-bridge.js); the website in a browser never
// has it, so nothing here changes the website.

/** Inside Folevi for Mac (either engine). */
export function inMacApp(): boolean {
  return typeof document !== "undefined" && document.documentElement.getAttribute("data-desktop") === "mac";
}

/** The native WebKit app (not Electron). */
export function inMacWebKit(): boolean {
  return inMacApp() && document.documentElement.getAttribute("data-mac-engine") === "webkit";
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

/**
 * <html data-window-active="true|false">: whether this window is the key window (§3.3), so the page can dim its
 * selection and toolbar icons in a window behind others, as Notes and Things do. The native app may also set it
 * (didBecomeKey / didResignKey); both agree. A frame inside the page taking focus doesn't count as leaving.
 */
export function installWindowActive(): () => void {
  const root = document.documentElement;
  let timer = 0;
  const update = () => {
    window.clearTimeout(timer);
    // (After the event: focus moving into an embed's frame blurs the window, though it still has focus.)
    timer = window.setTimeout(() => root.setAttribute("data-window-active", String(document.hasFocus())), 0);
  };
  update();
  window.addEventListener("focus", update);
  window.addEventListener("blur", update);
  return () => {
    window.clearTimeout(timer);
    window.removeEventListener("focus", update);
    window.removeEventListener("blur", update);
    root.removeAttribute("data-window-active");
  };
}

/**
 * <html data-fullscreen="true|false">: whether the window is in full screen (§3.3): the room kept for the window
 * buttons collapses, as the system shows them only at the top edge there. The native app sets it from AppKit
 * (chrome-page.js); Electron says nothing, so there the page tells by its size (a full-screen window covers the
 * menu bar too).
 */
export function installFullscreen(): () => void {
  const root = document.documentElement;
  const update = () => root.setAttribute("data-fullscreen", String(window.innerWidth >= screen.width && window.innerHeight >= screen.height));
  update();
  window.addEventListener("resize", update);
  return () => window.removeEventListener("resize", update);
}
