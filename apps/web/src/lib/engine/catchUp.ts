// Home's Catch me up / Your week card for the native apps (components/ai/CatchUp.tsx is the web's): made on
// request with `ai.brief`, kept in memory only (a brief may quote encrypted notes), per space.
import type { CatchUpCard, EngineError } from "./protocol";
import { Emitter } from "./live";

interface Entry {
  state: CatchUpCard["state"];
  brief: CatchUpCard["brief"];
  error: EngineError | null;
}

const briefs = new Map<string, Entry>();

/** Fires when any space's card changes. */
export const catchUpSignal = new Emitter();

export function catchUpCard(spaceKey: string, available: boolean): CatchUpCard {
  const e = briefs.get(spaceKey);
  return { available, state: e?.state ?? "idle", brief: e?.brief ?? null, error: e?.error ?? null };
}

export function setCatchUp(spaceKey: string, entry: Entry | null): void {
  if (entry) briefs.set(spaceKey, entry);
  else briefs.delete(spaceKey);
  catchUpSignal.emit();
}

/** Forgets every brief (signing out, the app lock, memory pressure). */
export function forgetCatchUps(): void {
  if (!briefs.size) return;
  briefs.clear();
  catchUpSignal.emit();
}
