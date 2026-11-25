// Android's press ripple, one of the light Android touches the owner picked on 2026-11-24 (same layout and colors as
// iPhone, plus the ripple, Android's back gesture and share sheet). Only inside the Android app.
//
// The ripple is drawn in a layer of its own laid over the pressed control (fixed, clipped to its rectangle and
// corners), so nothing about the control itself changes: no overflow, no position, no extra child for React to
// find. It grows from the finger and fades when the finger lifts; with Reduce Motion there's none. It starts a beat
// after the finger lands (PRESS_DELAY_MS, the beat the phone's own press feedback waits, globals.css), so a scroll
// that starts on a control doesn't ripple it; a quick tap still ripples, from when it lets go. The control's own
// `active:` scale and tint are off inside the Android app (globals.css, the `active` variant): one feedback, not two.

/** What a press ripples on: Folevi's controls, not text or the note's own content. */
const PRESSABLE = 'button, a[href], [role="button"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="tab"], [role="option"], [role="switch"], summary';

/** Grows in this long; fades over FADE_MS once the finger lifts (and never before it has grown a little). */
const GROW_MS = 380;
const FADE_MS = 220;
const MIN_SHOWN_MS = 90;
/** How long a finger rests on a control before it ripples. */
export const PRESS_DELAY_MS = 70;

function reducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The control a press at this target ripples on, or null (text, the editor, a disabled control). */
export function pressTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest<HTMLElement>(PRESSABLE);
  if (!el || el.closest(".ProseMirror, [contenteditable='true'], [data-no-ripple]")) return null;
  if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") return null;
  return el;
}

/**
 * Where a ripple over `el` is drawn: the open dialog or popover it's in (a sheet, a menu), which sit in the top layer
 * above the page's body, or the body.
 */
function layerFor(el: HTMLElement): HTMLElement {
  let top: HTMLElement | null;
  try {
    top = el.closest<HTMLElement>("dialog[open], :popover-open");
  } catch {
    // (A browser that doesn't know :popover-open.)
    top = el.closest<HTMLElement>("dialog[open]");
  }
  return top ?? document.body;
}

/** Draws one ripple over `el` from (x, y) and returns how to let it go. */
export function ripple(el: HTMLElement, x: number, y: number): () => void {
  const rect = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  const host = document.createElement("div");
  host.className = "ui-ripple-host";
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;color:${style.color}`;
  // (The pressed control's own corners, so the ripple stays inside them.)
  host.style.borderRadius = style.borderRadius;
  const dot = document.createElement("span");
  dot.className = "ui-ripple";
  // A circle reaching the farthest corner from the finger.
  const dx = Math.max(x - rect.left, rect.right - x);
  const dy = Math.max(y - rect.top, rect.bottom - y);
  const r = Math.hypot(dx, dy);
  dot.style.cssText = `left:${x - rect.left - r}px;top:${y - rect.top - r}px;width:${r * 2}px;height:${r * 2}px;animation-duration:${GROW_MS}ms`;
  host.append(dot);
  const layer = layerFor(el);
  layer.append(host);
  if (layer !== document.body) {
    // A dialog or menu that's moved (a transform) places fixed things from its own box: put it back over the control.
    const at = host.getBoundingClientRect();
    if (Math.abs(at.left - rect.left) > 0.5 || Math.abs(at.top - rect.top) > 0.5) {
      host.style.left = `${2 * rect.left - at.left}px`;
      host.style.top = `${2 * rect.top - at.top}px`;
    }
  }
  const born = performance.now();
  let gone = false;
  return () => {
    if (gone) return;
    gone = true;
    window.setTimeout(
      () => {
        host.setAttribute("data-out", "");
        host.style.transitionDuration = `${FADE_MS}ms`;
        window.setTimeout(() => host.remove(), FADE_MS + 40);
      },
      Math.max(0, MIN_SHOWN_MS - (performance.now() - born)),
    );
  };
}

/** Ripples every press on the page's controls; returns how to stop. */
export function installPressRipple(): () => void {
  if (typeof document === "undefined") return () => undefined;
  let release: (() => void) | null = null;
  // A press not rippled yet: where, and the timer that starts it.
  let pending: { el: HTMLElement; x: number; y: number; timer: number } | null = null;
  const begin = () => {
    if (!pending) return;
    window.clearTimeout(pending.timer);
    release = ripple(pending.el, pending.x, pending.y);
    pending = null;
  };
  // Not a press after all (a scroll, a drag): no ripple, and one already showing goes.
  const end = () => {
    if (pending) window.clearTimeout(pending.timer);
    pending = null;
    release?.();
    release = null;
  };
  const down = (e: PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (reducedMotion()) return;
    const el = pressTarget(e.target);
    if (!el) return;
    end();
    pending = { el, x: e.clientX, y: e.clientY, timer: window.setTimeout(begin, PRESS_DELAY_MS) };
  };
  // Let go: a tap quicker than the beat still ripples, briefly (MIN_SHOWN_MS).
  const up = () => {
    begin();
    end();
  };
  document.addEventListener("pointerdown", down, { capture: true, passive: true });
  document.addEventListener("pointerup", up, { capture: true, passive: true });
  for (const type of ["pointercancel", "dragstart"] as const) document.addEventListener(type, end, { capture: true, passive: true });
  // A scroll that starts as a press isn't a press.
  window.addEventListener("scroll", end, { capture: true, passive: true });
  return () => {
    end();
    document.removeEventListener("pointerdown", down, { capture: true });
    document.removeEventListener("pointerup", up, { capture: true });
    for (const type of ["pointercancel", "dragstart"] as const) document.removeEventListener(type, end, { capture: true });
    window.removeEventListener("scroll", end, { capture: true });
  };
}
