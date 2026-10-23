"use client";
// Memory pressure in the page (docs/MAC_WEBKIT_PLAN.md "Memory", step 5): when the Mac says memory is short (its
// memory pressure warnings, apps/mac App/Memory.swift), each part of the page that keeps something it can get
// again lets it go: what queries answered (they're on this device in IndexedDB too), decrypted files no note shows,
// encrypted spaces' copies not used for a while. WebKit drops its own caches (decoded images, fonts, compiled
// code) at the same time, by itself. Nothing typed or waiting to sync is ever touched.

export type PressureLevel = "warning" | "critical";
type Relief = (level: PressureLevel) => void;

const reliefs = new Set<Relief>();

/** What to let go when memory is short; returns the way to stop. */
export function onMemoryPressure(relief: Relief): () => void {
  reliefs.add(relief);
  return () => {
    reliefs.delete(relief);
  };
}

/** Memory is short: everything registered lets go of what it can. */
export function relieveMemory(level: PressureLevel = "warning"): number {
  let ran = 0;
  for (const relief of [...reliefs]) {
    try {
      relief(level);
      ran += 1;
    } catch {
      // One part failing to let go never stops the others.
    }
  }
  return ran;
}

// The Mac app calls this when macOS warns (App/Memory.swift); nothing else does.
if (typeof window !== "undefined") {
  (window as unknown as { __foleviMemoryPressure?: (level: string) => number }).__foleviMemoryPressure = (level) => relieveMemory(level === "critical" ? "critical" : "warning");
}
