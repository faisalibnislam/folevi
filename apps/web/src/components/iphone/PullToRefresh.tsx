"use client";

import { useEffect, useRef, useState } from "react";
import { useAppState } from "@/lib/app/state";
import { useBackendMode } from "@/lib/mode";
import { useLibraryControl, useLibraryStatusPick } from "@/lib/local/useLibrary";
import { feel, prepareFeel } from "@/lib/native/ui";
import { prefersReducedMotion } from "@/lib/native/physics";

/** How far a finger pulls down past the top before letting go refreshes (§4.5). */
const THRESHOLD = 64;
/** The spinner shows at least this long, so a quick refresh still reads as one. */
const MIN_SPIN_MS = 600;
const SPOKES = 8;

/**
 * What pulling a list down does, or null where there's nothing to fetch. Signed in: everything waiting is sent
 * now (what others changed arrives on its own, live). On this device only: nothing, unless the library is in
 * iCloud, Dropbox or Google Drive, which is asked for what changed there.
 */
export function useListRefresh(): (() => Promise<void>) | null {
  const mode = useBackendMode();
  const { engine, outbox } = useAppState();
  const control = useLibraryControl();
  const kind = useLibraryStatusPick(control, (s) => s?.info?.kind ?? null);
  if (mode === "account") {
    if (!engine && !outbox) return null;
    return async () => {
      engine?.scheduleFlush(0);
      outbox?.scheduleFlush(0);
    };
  }
  if (!control || !(kind === "icloud" || kind === "dropbox" || kind === "gdrive")) return null;
  return () => control.syncNow();
}

/**
 * Pull to refresh for the screen it's in (put it anywhere in the screen's content): pull down from the top
 * and the iOS spinner shows under the bar, its spokes appearing as you pull; past 64 points it's felt, and
 * letting go there runs `onRefresh` while it spins. Without `onRefresh` it does nothing.
 */
export function PullToRefresh({ onRefresh, label = "Refreshing" }: { onRefresh: (() => Promise<void>) | null; label?: string }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [pull, setPull] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const run = useRef(onRefresh);
  run.current = onRefresh;
  const busy = useRef(false);

  useEffect(() => {
    const scroller = anchor.current?.closest<HTMLElement>("main, [data-iphone-scroll]");
    if (!scroller || !onRefresh) return;
    let start: { x: number; y: number } | null = null;
    let mode: "pull" | "other" | null = null;
    let distance = 0;
    let armed = false;
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (busy.current || !t || e.touches.length > 1 || scroller.scrollTop > 0) {
        start = null;
        return;
      }
      start = { x: t.clientX, y: t.clientY };
      mode = null;
      distance = 0;
      armed = false;
      prepareFeel("refresh");
    };
    const onMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!start || !t) return;
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (!mode) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        mode = dy > 0 && Math.abs(dy) > Math.abs(dx) && scroller.scrollTop <= 0 ? "pull" : "other";
      }
      if (mode !== "pull") return;
      distance = Math.max(0, dy);
      setPull(distance);
      const past = distance >= THRESHOLD;
      if (past && !armed) feel("refresh");
      armed = past;
    };
    const onEnd = () => {
      if (!start || mode !== "pull") {
        start = null;
        return;
      }
      start = null;
      setPull(0);
      if (!armed || !run.current) return;
      busy.current = true;
      setSpinning(true);
      const began = performance.now();
      void run.current()
        .catch(() => feel("failed"))
        .finally(() => {
          const left = Math.max(0, MIN_SPIN_MS - (performance.now() - began));
          window.setTimeout(() => {
            busy.current = false;
            setSpinning(false);
          }, left);
        });
    };
    scroller.addEventListener("touchstart", onStart, { passive: true });
    scroller.addEventListener("touchmove", onMove, { passive: true });
    scroller.addEventListener("touchend", onEnd);
    scroller.addEventListener("touchcancel", onEnd);
    return () => {
      scroller.removeEventListener("touchstart", onStart);
      scroller.removeEventListener("touchmove", onMove);
      scroller.removeEventListener("touchend", onEnd);
      scroller.removeEventListener("touchcancel", onEnd);
    };
  }, [onRefresh]);

  const progress = spinning ? 1 : Math.min(1, pull / THRESHOLD);
  const shown = spinning || pull > 8;
  const reduced = typeof window !== "undefined" && prefersReducedMotion();
  return (
    <span ref={anchor} className="contents">
      {onRefresh ? (
        <span
          role={spinning ? "status" : undefined}
          aria-label={spinning ? label : undefined}
          aria-hidden={spinning ? undefined : true}
          className="pointer-events-none fixed left-1/2 top-[calc(env(safe-area-inset-top)+56px)] z-30 grid h-8 w-8 -translate-x-1/2 place-items-center text-muted"
          style={{
            opacity: shown ? Math.min(1, progress * 1.4) : 0,
            transform: reduced ? undefined : `translateY(${spinning ? 4 : Math.min(pull, THRESHOLD * 1.4) * 0.3}px)`,
            transition: pull ? "none" : "opacity 200ms ease-out, transform 300ms ease-out",
          }}
        >
          <svg viewBox="0 0 28 28" width={28} height={28} aria-hidden className={spinning && !reduced ? "animate-[iphone-spinner_800ms_steps(8)_infinite]" : undefined}>
            {Array.from({ length: SPOKES }, (_, i) => (
              <rect
                key={i}
                x={12.75}
                y={2}
                width={2.5}
                height={7}
                rx={1.25}
                fill="currentColor"
                transform={`rotate(${i * (360 / SPOKES)} 14 14)`}
                // Spokes appear one by one as the pull goes on; spinning, they fade round the circle.
                opacity={spinning ? 1 - (((SPOKES - i) % SPOKES) / SPOKES) * 0.75 : i < Math.ceil(progress * SPOKES) ? 0.9 : 0}
              />
            ))}
          </svg>
        </span>
      ) : null}
    </span>
  );
}
