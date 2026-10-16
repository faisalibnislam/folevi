"use client";

// The iPhone app's push and pop: a new screen slides in from the right over the one you were on (which
// eases left and dims), and Back slides the top screen away to the right. The screen that leaves is a
// picture of itself (a copy of its elements, kept just long enough to animate), taken the moment the router
// moves (lib/app/historyNav.ts tells us), before React draws the next one.
//
// The edge swipe isn't animated here: WebKit draws its own interactive swipe (allowsBackForwardNavigationGestures
// in FoleviViewController), so only Back pressed in the bar plays the pop. Switching tabs never animates
// (as on iOS), and neither does anything with reduced motion on.

import { onHistoryMove } from "@/lib/app/historyNav";

const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
const DURATION = 420;

let backButton = false;
let tabSwitch = false;
let pending: { kind: "push" | "pop"; picture: HTMLElement; scrolls: number[] } | null = null;
let stage: HTMLElement | null = null;
let layer: HTMLElement | null = null;

/** Back was pressed in the bar: the next pop slides. */
export function markBackButton() {
  backButton = true;
}

/** A tab was picked: the next move doesn't slide. */
export function markTabSwitch() {
  tabSwitch = true;
}

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Where the screen scrolls (its own content, a note's page), in document order. */
const scrollersOf = (el: HTMLElement) => [el.querySelector<HTMLElement>("#main"), ...el.querySelectorAll<HTMLElement>("[data-iphone-scroll]")].filter((x): x is HTMLElement => Boolean(x));

function picture(of: HTMLElement): HTMLElement {
  const copy = of.cloneNode(true) as HTMLElement;
  // A copy is only a picture: no ids twice in the page, nothing focusable or announced, no frames reloading.
  copy.querySelectorAll("iframe, video, audio, dialog, [popover]").forEach((n) => n.remove());
  copy.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
  copy.removeAttribute("id");
  copy.setAttribute("aria-hidden", "true");
  // Its own entrance animations mustn't play again in the copy.
  copy.setAttribute("data-iphone-picture", "");
  copy.inert = true;
  return copy;
}

function onMove(kind: "push" | "pop") {
  const fromBack = backButton;
  const fromTab = tabSwitch;
  backButton = false;
  tabSwitch = false;
  pending = null;
  if (!stage || !layer || reduced() || fromTab) return;
  if (kind === "pop" && !fromBack) return;
  const current = stage.firstElementChild as HTMLElement | null;
  if (!current) return;
  pending = { kind, picture: picture(current), scrolls: scrollersOf(current).map((s) => s.scrollTop) };
}

/** The shell's screen container and the layer pictures go in; returns the function that stops. */
export function attachStage(screens: HTMLElement, pictures: HTMLElement): () => void {
  stage = screens;
  layer = pictures;
  const stop = onHistoryMove(onMove);
  return () => {
    stop();
    if (stage === screens) stage = null;
    if (layer === pictures) layer = null;
    pending = null;
  };
}

/**
 * A new screen is on the stage (its key changed): slide it in, or the old one out. Called from a layout
 * effect, so both start on the same frame. Without a move waiting (a tab switch, a swipe), nothing moves.
 */
export function playTransition(entering: HTMLElement | null) {
  const move = pending;
  pending = null;
  if (!move || !entering || !layer) return;
  const { kind, picture: leaving, scrolls } = move;
  layer.replaceChildren(leaving);
  layer.style.zIndex = kind === "pop" ? "2" : "0";
  scrollersOf(leaving).forEach((s, i) => (s.scrollTop = scrolls[i] ?? 0));
  const timing = { duration: DURATION, easing: EASE };
  const done = () => {
    if (leaving.parentElement === layer) leaving.remove();
  };
  const shadow = "-12px 0 32px rgb(0 0 0 / 0.14)";
  if (kind === "push") {
    entering.animate([{ transform: "translateX(100%)", boxShadow: shadow }, { transform: "translateX(0)", boxShadow: "0 0 0 transparent" }], timing);
    const out = leaving.animate([{ transform: "translateX(0)", filter: "brightness(1)" }, { transform: "translateX(-28%)", filter: "brightness(0.94)" }], timing);
    out.onfinish = done;
    out.oncancel = done;
  } else {
    entering.animate([{ transform: "translateX(-28%)", filter: "brightness(0.94)" }, { transform: "translateX(0)", filter: "brightness(1)" }], timing);
    const out = leaving.animate([{ transform: "translateX(0)", boxShadow: shadow }, { transform: "translateX(100%)", boxShadow: shadow }], timing);
    out.onfinish = done;
    out.oncancel = done;
  }
}

/** The same screen stayed (another task view, the next month): the picture isn't needed. */
export function dropTransition() {
  pending = null;
}
