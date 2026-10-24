// The screen native shows instead of the app (docs/NATIVE_APP_PLAN.md section 5.1, `gate.changed`). Whatever the
// page renders before the app (the first-launch choice, sign-in, onboarding, a migration, the E2EE unlock screen)
// reports itself here in native chrome mode (components/engine/NativeGate.tsx), with its buttons as actions;
// the app itself reports "no gate". The last one reported wins: only one of them is on screen at a time.
import { BridgeError } from "./validate";
import type { E2eeGateInfo, GateChangedEvent } from "./protocol";

/** An E2EE gate's info with the revision 8 fields filled in. */
export function e2eeInfo(p: Pick<E2eeGateInfo, "space" | "spaceName" | "view" | "methods"> & Partial<E2eeGateInfo>): E2eeGateInfo {
  return { approval: null, approvalCode: null, setupStep: null, recoveryKey: null, methodsAdded: [], ...p };
}

export type GateHandler = (values: Record<string, string>) => unknown | Promise<unknown>;

interface Entry {
  event: GateChangedEvent;
  handlers: ReadonlyMap<string, GateHandler>;
}

const stack: Entry[] = [];
const listeners = new Set<() => void>();

export const LOADING_GATE: GateChangedEvent = gateEvent({ gate: "loading", busy: true });

/** A gate event with every field filled in. */
export function gateEvent(p: Partial<GateChangedEvent> & { gate: string | null }): GateChangedEvent {
  return {
    gate: p.gate,
    title: p.title ?? "",
    message: p.message ?? "",
    busy: p.busy ?? false,
    actions: p.actions ?? [],
    fields: p.fields ?? [],
    progress: p.progress ?? null,
    migration: p.migration ?? null,
    deviceLimit: p.deviceLimit ?? null,
    e2ee: p.e2ee ?? null,
    onboarding: p.onboarding ?? null,
    error: p.error ?? null,
  };
}

function changed() {
  for (const l of [...listeners]) l();
}

/** Reports a screen; returns the function that takes it back (it unmounted). */
export function pushGate(event: GateChangedEvent, handlers: ReadonlyMap<string, GateHandler>): { update(event: GateChangedEvent, handlers: ReadonlyMap<string, GateHandler>): void; release(): void } {
  const entry: Entry = { event, handlers };
  stack.push(entry);
  changed();
  return {
    update(next, h) {
      entry.event = next;
      entry.handlers = h;
      if (stack[stack.length - 1] === entry) changed();
    },
    release() {
      const i = stack.indexOf(entry);
      if (i < 0) return;
      stack.splice(i, 1);
      changed();
    },
  };
}

/** The screen native should show now ("loading" while nothing has reported yet). */
export function currentGate(): GateChangedEvent {
  return stack[stack.length - 1]?.event ?? LOADING_GATE;
}

export function onGate(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Runs one of the current screen's actions. */
export async function actOnGate(action: string, values: Record<string, string>): Promise<void> {
  const top = stack[stack.length - 1];
  const run = top?.handlers.get(action);
  const offered = top?.event.actions.find((a) => a.id === action);
  if (!run || !offered) throw new BridgeError("unavailable", "That isn't on this screen any more.");
  if (!offered.enabled) throw new BridgeError("unavailable", "That can't be done yet.");
  await run(values);
}

/** For tests. */
export function resetGates(): void {
  stack.length = 0;
  listeners.clear();
}
