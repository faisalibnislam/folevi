"use client";

/** True when a demo should hold its first frame: reduced motion, or shown as a card cover (ScaledPreview). */
export function isStill(el: Element): boolean {
  return Boolean(el.closest("[data-demo-still]")) || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Runs a demo's script while `el` is on screen. `sleep` waits, holds while the element is off screen or the
 * tab is hidden, and throws once stopped so the script unwinds. Returns the stop function. Nothing runs
 * with reduced motion.
 */
export function autoplay(el: Element | null, script: (sleep: (ms: number) => Promise<void>) => Promise<void>): () => void {
  if (!el || isStill(el)) return () => undefined;
  let alive = true;
  let visible = false;
  const io = new IntersectionObserver(([e]) => (visible = Boolean(e?.isIntersecting)), { threshold: 0.25 });
  io.observe(el);
  const sleep = async (ms: number) => {
    let left = ms;
    while (alive && left > 0) {
      await new Promise((r) => setTimeout(r, Math.min(left, 50)));
      if (visible && !document.hidden) left -= 50;
    }
    if (!alive) throw new Error("stopped");
  };
  script(sleep).catch(() => undefined);
  return () => {
    alive = false;
    io.disconnect();
  };
}

/** Text that is `shown` characters long, cut at the last whole word so streaming reads naturally. */
export function streamed(text: string, shown: number): string {
  if (shown >= text.length) return text;
  const cut = text.lastIndexOf(" ", shown);
  return text.slice(0, cut > 0 ? cut : shown);
}
