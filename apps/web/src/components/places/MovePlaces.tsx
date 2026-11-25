"use client";
// "Move or copy notes..." (docs/MULTI_ACCOUNT_PLAN.md §7.3), the part every page start carries: opening the dialog,
// and the gate that finishes a move after a switch of place. The dialog and the move itself (./MovePlacesDialog.tsx,
// with lib/migrate and the local store) load only when one opens or runs (docs/perf/web-results.md).
import { lazy, Suspense, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Pick } from "@/lib/migrate/reshape";
import { currentPlaceId } from "@/lib/places";
import type { PlaceMove } from "@/lib/places/move";

const loadDialog = () => import("./MovePlacesDialog");
const MovePlacesDialog = lazy(() => loadDialog().then((m) => ({ default: m.MovePlacesDialog })));
const RunPending = lazy(() => loadDialog().then((m) => ({ default: m.RunPending })));

// ---------------------------------------------------------------------------------------------------- opening

const OPEN_EVENT = "folevi:move-places";

/** Opens "Move or copy notes..." (with a folder or note already picked, from its menu). */
export function openMovePlaces(pick?: Pick): void {
  void loadDialog();
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: pick ?? null }));
}

/** Where the dialog lives (Shell): it opens on openMovePlaces. */
export function MovePlacesHost() {
  const [pick, setPick] = useState<Pick | null | undefined>(undefined);
  useEffect(() => {
    const on = (e: Event) => setPick((e as CustomEvent<Pick | null>).detail ?? null);
    window.addEventListener(OPEN_EVENT, on);
    return () => window.removeEventListener(OPEN_EVENT, on);
  }, []);
  if (pick === undefined) return null;
  return (
    <Suspense fallback={null}>
      <MovePlacesDialog initialPick={pick} onClose={() => setPick(undefined)} />
    </Suspense>
  );
}

/** Runs a move or copy between places from this page (./MovePlacesDialog.tsx, startPlaceMove). */
export async function startPlaceMove(...args: Parameters<typeof import("./MovePlacesDialog").startPlaceMove>): ReturnType<typeof import("./MovePlacesDialog").startPlaceMove> {
  return (await loadDialog()).startPlaceMove(...args);
}

// ---------------------------------------------------------------------------------------------------- after a switch

/** A move kept for the place it runs in (written by startPlaceMove when it switches place first). */
export const PENDING_KEY = "folevi:place-move";
export type Pending = PlaceMove & { runIn: string };

function readPending(): Pending | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as Pending) : null;
  } catch {
    return null;
  }
}

const subscribe = (cb: () => void) => {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
};

/**
 * A move that switched here to run (from the library into this account): it runs before the app shows, and says
 * how it went. Shown only in the place it was meant to run in.
 */
export function PlaceMoveGate({ children }: { children: ReactNode }) {
  const raw = useSyncExternalStore(subscribe, () => localStorage.getItem(PENDING_KEY), () => null);
  const pending = useMemo(() => (raw ? readPending() : null), [raw]);
  if (!pending || pending.runIn !== currentPlaceId()) return <>{children}</>;
  return (
    <Suspense fallback={null}>
      <RunPending move={pending} />
    </Suspense>
  );
}

export type { MoveSide } from "@/lib/places/move";
