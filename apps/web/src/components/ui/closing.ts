/** A running close: `cancel` stops the fade and puts the dialog away at once (opening again calls it). */
export interface Closing {
  cancel(): void;
}

/**
 * Closing an overlay (a dialog, the command palette): it fades out over 150 ms, with a 4 px rise on the web and only
 * the fade on the Mac and with Reduce Motion, then `done` runs (2026-11-25 polish review: overlays used to vanish at
 * once after an animated entry).
 *
 * The dialog itself closes first, so the page behind takes focus and the keyboard back at once: a modal dialog
 * left open for the fade kept the page inert, and whatever was typed in those 150 ms was lost. Its picture stays
 * for the fade as a manual popover (the top layer again, in the same place, but not modal: the page isn't inert).
 * The fading dialog is inert itself, so showing the popover can't put focus back inside it (a dialog shown as a
 * popover takes focus like one that opens) and a tap goes to the page under it. Returns the running close, so
 * opening again can cancel it; without the Web Animations API or popovers (tests, older browsers), `done` runs at
 * once and it returns null.
 */
export function fadeOut(el: HTMLDialogElement, done: () => void): Closing | null {
  if (el.open && typeof el.close === "function") el.close();
  if (typeof el.animate !== "function" || typeof el.showPopover !== "function") {
    done();
    return null;
  }
  let over = false;
  const putAway = () => {
    if (over) return;
    over = true;
    try {
      el.hidePopover();
    } catch {
      // (Already hidden.)
    }
    el.removeAttribute("popover");
    el.removeAttribute("inert");
    el.style.removeProperty("display");
  };
  try {
    el.setAttribute("inert", "");
    el.setAttribute("popover", "manual");
    el.style.setProperty("display", "block");
    el.showPopover();
  } catch {
    putAway();
    done();
    return null;
  }
  const still = (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) || document.documentElement.getAttribute("data-desktop") === "mac";
  const fade = el.animate([{ opacity: 1 }, { opacity: 0, transform: still ? "none" : "translateY(-4px)" }], { duration: 150, easing: "ease-out", fill: "forwards" });
  fade.finished
    .then(() => {
      putAway();
      done();
      fade.cancel();
    })
    .catch(() => undefined);
  return {
    cancel: () => {
      putAway();
      fade.cancel();
    },
  };
}
