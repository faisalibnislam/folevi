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
// card again (wherever the card now is; a card out of sight gets the usual slide).
//
// Every move is a Web Animation of transform and opacity only, its spring sampled 120 times a second into
// keyframes played linearly (not a CSS linear() curve, a clip-path or a border-radius, which WebKit may run on
// the page's own thread): Core Animation runs them at the display's rate (120 Hz on ProMotion) whatever the
// page is doing. Layers are promoted (will-change) for the move only, and a move to a note waits (up to
// 150 ms) for the note's words and the pictures on screen, so the page isn't busy drawing them while it moves
// (docs/IOS_PERFORMANCE.md, "120 Hz").
//
// The edge swipe isn't animated here: WebKit draws its own interactive swipe (allowsBackForwardNavigationGestures
// in FoleviViewController; it follows the finger 1:1 and finishes with its release speed), so only Back pressed
// in the bar plays the pop. Switching tabs never animates (as on iOS).

import { onHistoryMove } from "@/lib/app/historyNav";
import { SPRINGS, type Spring } from "@/lib/native/physics";
import { springFrames } from "./sheetMotion";

/** A spring as keyframes: `frame(k)` at each 120th of a second of its progress `k` (0 to 1, past 1 on overshoot). */
function track(spring: Spring, frame: (k: number) => Keyframe): { frames: Keyframe[]; ms: number } {
  const { progress, ms } = springFrames(spring);
  return { frames: progress.map(frame), ms };
}
const linear = (ms: number): KeyframeAnimationOptions => ({ duration: ms, easing: "linear" });
const round = (n: number) => Math.round(n * 1000) / 1000;
/** How far the screen underneath moves, and how dark it gets (12 % black over it). */
const UNDER_SHIFT = -30;
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
const ZOOM: Spring = { response: 0.38, damping: 0.94 };
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

/** Where the whole screen (`w` wide) sits drawn into `rect`: its top left there, scaled to the card's width. */
function inBox(rect: DOMRect, w: number): { x: number; y: number; s: number } {
  return { x: rect.left, y: rect.top, s: rect.width / w };
}
/** The screen `k` of the way from the card (0) to full screen (1). */
const between = (b: { x: number; y: number; s: number }, k: number): Keyframe => ({
  transform: `translate(${round(b.x * (1 - k))}px, ${round(b.y * (1 - k))}px) scale(${round(b.s + (1 - b.s) * k)})`,
});

/** Promotes the elements that move to layers of their own for the move, and back after. */
function promote(els: HTMLElement[]): () => void {
  for (const el of els) el.style.willChange = "transform, opacity";
  return () => {
    for (const el of els) el.style.willChange = "";
  };
}

/**
 * Starts the animations once the screen coming in is ready to be moved: a note with its words in, the pictures
 * on screen decoded, at most 150 ms after the tap's screen is drawn. Until then they wait on their first frame.
 */
function whenReady(entering: HTMLElement, anims: Animation[], note: boolean) {
  const images = [...entering.querySelectorAll<HTMLImageElement>("img")].filter((i) => {
    const r = i.getBoundingClientRect();
    return r.bottom > 0 && r.top < window.innerHeight && !i.complete;
  });
  if (!images.length && (!note || noteHasText(entering))) return;
  anims.forEach((a) => a.pause());
  let decoded = images.length === 0;
  if (!decoded) void Promise.all(images.map((i) => i.decode().catch(() => undefined))).then(() => (decoded = true));
  const started = performance.now();
  let titled = 0;
  const wait = () => {
    const now = performance.now();
    // A note's text usually lands a frame or two after its title: wait for it a little too, so the page draws
    // it before the move rather than in the middle of it (an empty note has none to wait for).
    if (note && !titled && noteReady(entering)) titled = now;
    const noteIn = !note || noteHasText(entering) || (titled > 0 && now - titled > 60);
    if ((decoded && noteIn) || now - started > READY_WAIT_MS) anims.forEach((a) => a.play());
    else requestAnimationFrame(wait);
  };
  requestAnimationFrame(wait);
}

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
  const dim = document.createElement("div");
  dim.style.cssText = "position:absolute;inset:0;background:#000;opacity:0;pointer-events:none";
  dim.setAttribute("data-iphone-zoom-dim", "");
  const card = inBox(box.rect, w);
  const unpromote = promote([entering, leaving, dim]);
  const done = () => {
    if (leaving.parentElement === pictures) pictures.replaceChildren();
    entering.removeAttribute("data-iphone-zoom");
    entering.style.transformOrigin = "";
    unpromote();
  };
  entering.setAttribute("data-iphone-zoom", kind);
  let out: Animation;
  const anims: Animation[] = [];
  if (kind === "push") {
    // The screen left behind under the note, stepping back and dimming; the note on top, out of the card.
    pictures.replaceChildren(leaving, dim);
    pictures.style.zIndex = "0";
    scrollersOf(leaving).forEach((el, i) => (el.scrollTop = scrolls[i] ?? 0));
    const grow = track(ZOOM, (k) => between(card, k));
    const t = linear(grow.ms);
    out = leaving.animate(track(ZOOM, (k) => ({ transform: `scale(${round(1 - (1 - BEHIND_SCALE) * k)})` })).frames, t);
    anims.push(out, dim.animate(track(ZOOM, (k) => ({ opacity: round(UNDER_DIM * Math.min(1, k)) })).frames, t));
    entering.style.transformOrigin = "0 0";
    anims.push(entering.animate(grow.frames, t));
    // Its first moments fade in over the card, so the card's face gives way to the note's.
    anims.push(entering.animate([{ opacity: 0.2 }, { opacity: 1, offset: 0.3 }, { opacity: 1 }], t));
    zoomed = href;
    whenReady(entering, anims, true);
  } else {
    // The screen coming back steps forward under the note, which shrinks into the card and fades at the end.
    pictures.replaceChildren(dim, leaving);
    pictures.style.zIndex = "2";
    scrollersOf(leaving).forEach((el, i) => (el.scrollTop = scrolls[i] ?? 0));
    const shrink = track(ZOOM, (k) => between(card, 1 - k));
    const t = linear(shrink.ms);
    entering.animate(track(ZOOM, (k) => ({ transform: `scale(${round(BEHIND_SCALE + (1 - BEHIND_SCALE) * k)})` })).frames, t);
    dim.animate(track(ZOOM, (k) => ({ opacity: round(Math.max(0, UNDER_DIM * (1 - k))) })).frames, t);
    leaving.style.transformOrigin = "0 0";
    out = leaving.animate(shrink.frames, t);
    leaving.animate([{ opacity: 1 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }], t);
  }
  out.onfinish = done;
  out.oncancel = done;
}

/** How long a move waits for the screen coming in (a note's words, its pictures), at most. */
const READY_WAIT_MS = 150;

/** Whether the note on the screen has its text in. */
function noteHasText(screen: HTMLElement): boolean {
  const body = screen.querySelector('[aria-label="Document body"]');
  return Boolean(body && body.textContent && body.textContent.trim().length > 0);
}

/** Whether the note on the screen has its title or text in (not still loading). */
function noteReady(screen: HTMLElement): boolean {
  const title = screen.querySelector<HTMLTextAreaElement>("textarea[id^='title-']");
  if (title?.value) return true;
  const body = screen.querySelector('[aria-label="Document body"]');
  return Boolean(body && body.textContent && body.textContent.trim().length > 0);
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
  const pictures = layer;
  const unpromote = promote([entering, leaving, dim, shadow]);
  const done = () => {
    if (leaving.parentElement === pictures) pictures.replaceChildren();
    unpromote();
  };
  const at = (k: number) => round(k * 100);
  const slide = track(SPRINGS.push, (k) => ({ transform: `translateX(${at(1 - k)}%)` }));
  const t = linear(slide.ms);
  const under = (k: number) => `translateX(${round(UNDER_SHIFT * k)}%)`;
  let out: Animation;
  const anims: Animation[] = [];
  if (kind === "push") {
    anims.push(entering.animate(slide.frames, t));
    anims.push(shadow.animate(track(SPRINGS.push, (k) => ({ transform: `translateX(${round((1 - k) * 100)}vw)`, opacity: round(Math.max(0, 1 - k)) })).frames, t));
    anims.push(dim.animate(track(SPRINGS.push, (k) => ({ opacity: round(UNDER_DIM * Math.min(1, k)) })).frames, t));
    out = leaving.animate(track(SPRINGS.push, (k) => ({ transform: under(k) })).frames, t);
    anims.push(out);
    // A note slid in (a link to it): it moves once its words are in. A new note has none to wait for.
    whenReady(entering, anims, location.pathname.startsWith("/d/") && new URLSearchParams(location.search).get("new") !== "1");
  } else {
    entering.animate(track(SPRINGS.push, (k) => ({ transform: under(1 - k) })).frames, t);
    dim.animate(track(SPRINGS.push, (k) => ({ opacity: round(Math.max(0, UNDER_DIM * (1 - k))) })).frames, t);
    shadow.animate(track(SPRINGS.push, (k) => ({ transform: `translateX(${round(k * 100)}vw)` })).frames, t);
    out = leaving.animate(track(SPRINGS.push, (k) => ({ transform: `translateX(${at(k)}%)` })).frames, t);
  }
  out.onfinish = done;
  out.oncancel = done;
}

/** The same screen stayed (another task view, the next month): the picture isn't needed. */
export function dropTransition() {
  pending = null;
}
