"use client";

// The iPhone app's push and pop: a new screen slides in from the right over the one you were on (which
// moves 30 % left and dims to 12 % black), and Back slides the top screen away to the right, both on UIKit's
// navigation spring (critically damped, response 0.42 s; docs/IOS_POLISH_PLAN.md §2.4). With Reduce Motion the
// new screen cross-fades in over 150 ms instead. The screen that leaves is a
// picture of itself (a copy of its elements, kept just long enough to animate), taken the moment the router
// moves (lib/app/historyNav.ts tells us), before React draws the next one.
//
// What moves is only transformed or faded (docs/IOS_PERFORMANCE.md): the dimming is a black layer fading in over
// the screen underneath and the shadow a strip beside the moving edge, not a filter or a box-shadow on a whole
// screen, which the web view would draw again on every frame. The picture is trimmed to what's on screen (what
// was scrolled below it is left out), so taking it costs little in a long note or list.
//
// A note opened from its card or row zooms out of it instead (as in Craft): the note grows from the card's
// box to the whole screen while the screen behind steps back a little and dims, and Back shrinks it into the
// card again (wherever the card now is; a card out of sight gets the usual slide). Transform, opacity and a
// clip on one layer each.
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
/** How far the screen underneath moves, and how dark it gets (12 % black over it). */
const UNDER_SHIFT = "-30%";
const UNDER_DIM = 0.12;
/** The shadow the moving screen casts on the one underneath, as a strip just outside its leading edge. */
const SHADOW_WIDTH = 32;

let backButton = false;
let tabSwitch = false;
let pending: { kind: "push" | "pop"; picture: HTMLElement; scrolls: number[]; fade?: boolean; zoom?: Zoom } | null = null;

/** Where a note zooms from (or back into): its card's or row's box on screen and its corners. */
interface Zoom {
  href: string;
  rect: DOMRect | null;
  radius: number;
}
/** The card just tapped, for the push it leads to (a moment later, in the same tap). */
let tapped: { zoom: Zoom; at: number } | null = null;
/** The note on screen that zoomed out of a card, for Back to shrink it into that card again. */
let zoomed: string | null = null;

/** The zoom's spring: a little quicker than a push, barely any overshoot. */
const ZOOM = springCss({ response: 0.38, damping: 0.94 });
/** How far the screen behind steps back while a note is zoomed over it. */
const BEHIND_SCALE = 0.94;

/**
 * A tap on a link to a note in the screen's content (a card, a row): the note it opens zooms out of it
 * (IphoneShell listens for taps on the stage, before the link navigates).
 */
export function markZoomFrom(link: HTMLElement) {
  const href = link.getAttribute("href");
  if (!href || !/^\/d\/[^/?#]+/.test(href)) return;
  // (A card or a row, not a link inside a note's text.)
  if (link.closest(".ProseMirror, [contenteditable]")) return;
  const rect = link.getBoundingClientRect();
  if (rect.width < 60 || rect.height < 36) return;
  tapped = { zoom: { href: new URL(href, location.href).pathname, rect, radius: parseFloat(getComputedStyle(link).borderTopLeftRadius) || 0 }, at: performance.now() };
}
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

/**
 * Leaves out of the copy what the original has below the bottom of the screen (in the normal flow, so nothing
 * above it moves): a long note or list is a few screens of elements the slide never shows. Walks only the
 * elements that reach past the bottom.
 */
function trim(original: Element, copy: Element, bottom: number) {
  const from = original.children;
  const to = copy.children;
  if (from.length !== to.length) return;
  for (let i = from.length - 1; i >= 0; i--) {
    const el = from[i]!;
    const r = el.getBoundingClientRect();
    if (r.bottom <= bottom) continue;
    if (r.top > bottom) {
      const position = getComputedStyle(el).position;
      if (position === "static" || position === "relative") to[i]!.remove();
      continue;
    }
    trim(el, to[i]!, bottom);
  }
}

function picture(of: HTMLElement): HTMLElement {
  const copy = of.cloneNode(true) as HTMLElement;
  trim(of, copy, window.innerHeight);
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
  const tap = tapped && performance.now() - tapped.at < 1000 ? tapped.zoom : null;
  tapped = null;
  // (Reduce Motion: only a cross-fade, which needs no picture.)
  if (reduced()) {
    pending = { kind, picture: document.createElement("div"), scrolls: [], fade: true };
    return;
  }
  // Back from a note that zoomed out of a card: into the card again (found once the screen behind is drawn).
  const back = kind === "pop" && zoomed && location.pathname !== zoomed ? { href: zoomed, rect: null, radius: 0 } : undefined;
  zoomed = null;
  pending = { kind, picture: picture(current), scrolls: scrollersOf(current).map((s) => s.scrollTop), zoom: kind === "push" ? (tap ?? undefined) : back };
}

/** The transform and clip that draw a whole screen (w × h) in `rect` with `radius` corners (origin top left). */
function inBox(rect: DOMRect, radius: number, w: number, h: number): Keyframe {
  const s = rect.width / w;
  const visible = Math.min(h, rect.height / s);
  return {
    transform: `translate(${rect.left}px, ${rect.top}px) scale(${s})`,
    clipPath: `inset(0px 0px ${Math.max(0, h - visible)}px 0px round ${radius / s}px)`,
  };
}
const FULL: Keyframe = { transform: "translate(0px, 0px) scale(1)", clipPath: "inset(0px 0px 0px 0px round 0px)" };

/** The note's card on the screen coming back, if it's on screen to shrink into. */
function cardIn(screen: HTMLElement, href: string): { rect: DOMRect; radius: number } | null {
  for (const a of screen.querySelectorAll<HTMLElement>(`a[href="${CSS.escape(href)}"], a[href^="${CSS.escape(href)}?"]`)) {
    // Where it comes to rest: an entrance of its own (a card rising into its row) ends now, under the note.
    for (let el: Element | null = a; el && el !== screen; el = el.parentElement) for (const anim of el.getAnimations()) anim.finish();
    const rect = a.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 24) continue;
    if (rect.top < 0 || rect.left < 0 || rect.bottom > window.innerHeight || rect.right > window.innerWidth) continue;
    return { rect, radius: parseFloat(getComputedStyle(a).borderTopLeftRadius) || 0 };
  }
  return null;
}

function playZoom(kind: "push" | "pop", entering: HTMLElement, leaving: HTMLElement, scrolls: number[], pictures: HTMLElement, box: { rect: DOMRect; radius: number }, href: string) {
  const w = pictures.clientWidth || window.innerWidth;
  const h = pictures.clientHeight || window.innerHeight;
  const dim = document.createElement("div");
  dim.style.cssText = "position:absolute;inset:0;background:#000;opacity:0;pointer-events:none";
  dim.setAttribute("data-iphone-zoom-dim", "");
  const t: KeyframeAnimationOptions = { duration: ZOOM.ms, easing: ZOOM.easing };
  const card = inBox(box.rect, box.radius, w, h);
  const behind = { transform: `scale(${BEHIND_SCALE})` };
  const done = () => {
    if (leaving.parentElement === pictures) pictures.replaceChildren();
    entering.removeAttribute("data-iphone-zoom");
  };
  entering.setAttribute("data-iphone-zoom", kind);
  let out: Animation;
  if (kind === "push") {
    // The screen left behind under the note, stepping back and dimming; the note on top, out of the card.
    pictures.replaceChildren(leaving, dim);
    pictures.style.zIndex = "0";
    scrollersOf(leaving).forEach((el, i) => (el.scrollTop = scrolls[i] ?? 0));
    out = leaving.animate([{ transform: "scale(1)" }, behind], t);
    dim.animate([{ opacity: 0 }, { opacity: UNDER_DIM }], t);
    entering.animate([{ ...card, transformOrigin: "0 0" }, { ...FULL, transformOrigin: "0 0" }], t);
    // Its first moments fade in over the card, so the card's face gives way to the note's.
    entering.animate([{ opacity: 0.35 }, { opacity: 1, offset: 0.35 }, { opacity: 1 }], t);
    zoomed = href;
  } else {
    // The screen coming back steps forward under the note, which shrinks into the card and fades at the end.
    pictures.replaceChildren(dim, leaving);
    pictures.style.zIndex = "2";
    scrollersOf(leaving).forEach((el, i) => (el.scrollTop = scrolls[i] ?? 0));
    entering.animate([behind, { transform: "scale(1)" }], t);
    dim.animate([{ opacity: UNDER_DIM }, { opacity: 0 }], t);
    leaving.style.transformOrigin = "0 0";
    out = leaving.animate([FULL, card], t);
    leaving.animate([{ opacity: 1 }, { opacity: 1, offset: 0.65 }, { opacity: 0 }], t);
  }
  out.onfinish = done;
  out.oncancel = done;
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
  if (move.zoom) {
    const box = kind === "push" ? (move.zoom.rect ? { rect: move.zoom.rect, radius: move.zoom.radius } : null) : cardIn(entering, move.zoom.href);
    if (box && (kind === "pop" || location.pathname === move.zoom.href)) {
      playZoom(kind, entering, leaving, scrolls, layer, box, move.zoom.href);
      return;
    }
  }
  // Push: the picture under the new screen, dimmed by a layer above it, the shadow beside the new screen's
  // edge (the layer is under the stage). Pop: the layer goes above the stage: the dimming over the screen
  // coming back, then the picture sliding away with its shadow.
  const dim = document.createElement("div");
  dim.style.cssText = "position:absolute;inset:0;background:#000;opacity:0;pointer-events:none";
  const shadow = document.createElement("div");
  shadow.style.cssText = `position:absolute;top:0;bottom:0;left:-${SHADOW_WIDTH}px;width:${SHADOW_WIDTH}px;background:linear-gradient(to left, rgb(0 0 0 / 0.14), rgb(0 0 0 / 0));pointer-events:none`;
  layer.replaceChildren(...(kind === "push" ? [leaving, dim, shadow] : [dim, leaving, shadow]));
  layer.style.zIndex = kind === "pop" ? "2" : "0";
  scrollersOf(leaving).forEach((s, i) => (s.scrollTop = scrolls[i] ?? 0));
  const t = timing();
  const pictures = layer;
  const done = () => {
    if (leaving.parentElement === pictures) pictures.replaceChildren();
  };
  let out: Animation;
  if (kind === "push") {
    entering.animate([{ transform: "translateX(100%)" }, { transform: "translateX(0)" }], t);
    shadow.animate([{ transform: "translateX(100vw)", opacity: 1 }, { transform: "translateX(0)", opacity: 0 }], t);
    dim.animate([{ opacity: 0 }, { opacity: UNDER_DIM }], t);
    out = leaving.animate([{ transform: "translateX(0)" }, { transform: `translateX(${UNDER_SHIFT})` }], t);
  } else {
    entering.animate([{ transform: `translateX(${UNDER_SHIFT})` }, { transform: "translateX(0)" }], t);
    dim.animate([{ opacity: UNDER_DIM }, { opacity: 0 }], t);
    shadow.animate([{ transform: "translateX(0)" }, { transform: "translateX(100vw)" }], t);
    out = leaving.animate([{ transform: "translateX(0)" }, { transform: "translateX(100%)" }], t);
  }
  out.onfinish = done;
  out.oncancel = done;
}

/** The same screen stayed (another task view, the next month): the picture isn't needed. */
export function dropTransition() {
  pending = null;
}
