/**
 * Closing an overlay (a dialog, the command palette): it fades out over 150 ms, with a 4 px rise on the web and only
 * the fade on the Mac and with Reduce Motion, then `done` runs (2026-11-25 polish review: overlays used to vanish at
 * once after an animated entry). Returns the running fade, so opening again can cancel it; without the Web
 * Animations API (tests), `done` runs at once and it returns null.
 */
export function fadeOut(el: HTMLElement, done: () => void): Animation | null {
  if (typeof el.animate !== "function") {
    done();
    return null;
  }
  const still = (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) || document.documentElement.getAttribute("data-desktop") === "mac";
  const fade = el.animate([{ opacity: 1 }, { opacity: 0, transform: still ? "none" : "translateY(-4px)" }], { duration: 150, easing: "ease-out", fill: "forwards" });
  fade.finished
    .then(() => {
      done();
      fade.cancel();
    })
    .catch(() => undefined);
  return fade;
}
