"use client";

// The iPhone app's push and pop: a new screen slides in from the right over the one you were on (which
// moves 30 % left and dims to 12 % black), and Back slides the top screen away to the right, both on UIKit's
// navigation spring (critically damped, response 0.42 s; docs/IOS_POLISH_PLAN.md §2.4). With Reduce Motion the
// new screen cross-fades in over 150 ms instead. The screen that leaves is a
// picture of itself (a copy of its elements, kept just long enough to animate), taken the moment the router
// moves (lib/app/historyNav.ts tells us), before React draws the next one.
//
// The edge swipe isn't animated here: WebKit draws its own interactive swipe (allowsBackForwardNavigationGestures
// in FoleviViewController; it follows the finger 1:1 and finishes with its release speed), so only Back pressed
// in the bar plays the pop. Switching tabs never animates (as on iOS).

import { onHistoryMove } from "@/lib/app/historyNav";
import { SPRINGS, springCss } from "@/lib/native/physics";

/** The navigation spring as a CSS timing function (Safari 17.2 and later), else UIKit's older push curve. */
const PUSH = springCss(SPRINGS.push);
const supportsLinear = () => typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("transition-timing-function", "linear(0, 1)");
const timing = (): KeyframeAnimationOptions => (supportsLinear() ? { duration: PUSH.ms, easing: PUSH.easing } : { duration: 420, easing: "cubic-bezier(0.32, 0.72, 0, 1)" });
/** How far the screen underneath moves, and how dark it gets. */
const UNDER_SHIFT = "-30%";
const UNDER_DIM = "brightness(0.88)";

let backButton = false;
let tabSwitch = false;
let pending: { kind: "push" | "pop"; picture: HTMLElement; scrolls: number[]; fade?: boolean } | null = null;
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
  if (!stage || !layer || fromTab) return;
  if (kind === "pop" && !fromBack) return;
  const current = stage.firstElementChild as HTMLElement | null;
  if (!current) return;
  // (Reduce Motion: only a cross-fade, which needs no picture.)
  if (reduced()) {
    pending = { kind, picture: document.createElement("div"), scrolls: [], fade: true };
    return;
  }
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
  if (move.fade) {
    entering.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: "ease-out" });
    return;
  }
  const { kind, picture: leaving, scrolls } = move;
  layer.replaceChildren(leaving);
  layer.style.zIndex = kind === "pop" ? "2" : "0";
  scrollersOf(leaving).forEach((s, i) => (s.scrollTop = scrolls[i] ?? 0));
  const t = timing();
  const done = () => {
    if (leaving.parentElement === layer) leaving.remove();
  };
  const shadow = "-12px 0 32px rgb(0 0 0 / 0.14)";
  if (kind === "push") {
    entering.animate([{ transform: "translateX(100%)", boxShadow: shadow }, { transform: "translateX(0)", boxShadow: "0 0 0 transparent" }], t);
    const out = leaving.animate([{ transform: "translateX(0)", filter: "brightness(1)" }, { transform: `translateX(${UNDER_SHIFT})`, filter: UNDER_DIM }], t);
    out.onfinish = done;
    out.oncancel = done;
  } else {
    entering.animate([{ transform: `translateX(${UNDER_SHIFT})`, filter: UNDER_DIM }, { transform: "translateX(0)", filter: "brightness(1)" }], t);
    const out = leaving.animate([{ transform: "translateX(0)", boxShadow: shadow }, { transform: "translateX(100%)", boxShadow: shadow }], t);
    out.onfinish = done;
    out.oncancel = done;
  }
}

/** The same screen stayed (another task view, the next month): the picture isn't needed. */
export function dropTransition() {
  pending = null;
}
