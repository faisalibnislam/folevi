// Android's press ripple, one of the light Android touches the owner picked on 2026-11-24 (same layout and colors as
// iPhone, plus the ripple, Android's back gesture and share sheet). Only inside the Android app.
//
// The ripple is drawn in a layer of its own laid over the pressed control (fixed, clipped to its rectangle and
// corners), so nothing about the control itself changes: no overflow, no position, no extra child for React to
// find. It grows from the finger and fades when the finger lifts; with Reduce Motion there's none.

/** What a press ripples on: Folevi's controls, not text or the note's own content. */
const PRESSABLE = 'button, a[href], [role="button"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="tab"], [role="option"], [role="switch"], summary';

/** Grows in this long; fades over FADE_MS once the finger lifts (and never before it has grown a little). */
const GROW_MS = 380;
const FADE_MS = 220;
const MIN_SHOWN_MS = 90;

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

/** Draws one ripple over `el` from (x, y) and returns how to let it go. */
export function ripple(el: HTMLElement, x: number, y: number): () => void {
  const rect = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  const host = document.createElement("div");
  host.className = "ui-ripple-host";
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;border-radius:${style.borderRadius};color:${style.color}`;
  const dot = document.createElement("span");
  dot.className = "ui-ripple";
  // A circle reaching the farthest corner from the finger.
  const dx = Math.max(x - rect.left, rect.right - x);
  const dy = Math.max(y - rect.top, rect.bottom - y);
  const r = Math.hypot(dx, dy);
  dot.style.cssText = `left:${x - rect.left - r}px;top:${y - rect.top - r}px;width:${r * 2}px;height:${r * 2}px;animation-duration:${GROW_MS}ms`;
  host.append(dot);
  document.body.append(host);
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
  const end = () => {
    release?.();
    release = null;
  };
  const down = (e: PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (reducedMotion()) return;
    const el = pressTarget(e.target);
    if (!el) return;
    end();
    release = ripple(el, e.clientX, e.clientY);
  };
  document.addEventListener("pointerdown", down, { capture: true, passive: true });
  for (const type of ["pointerup", "pointercancel", "dragstart"] as const) document.addEventListener(type, end, { capture: true, passive: true });
  // A scroll that starts as a press isn't a press.
  window.addEventListener("scroll", end, { capture: true, passive: true });
  return () => {
    end();
    document.removeEventListener("pointerdown", down, { capture: true });
    for (const type of ["pointerup", "pointercancel", "dragstart"] as const) document.removeEventListener(type, end, { capture: true });
    window.removeEventListener("scroll", end, { capture: true });
  };
}
