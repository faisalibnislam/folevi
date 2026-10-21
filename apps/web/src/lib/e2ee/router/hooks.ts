// React hooks and checks over the active router (docs/E2EE_DESIGN.md §12 WP7). For a Standard account (no
// router) they answer "Standard, ready" at once and load nothing.
import { useCallback, useRef, useSyncExternalStore } from "react";
import type { WireScope } from "@folevi/editor-schema";
import { STANDARD_SWITCHES, type Level, type Switches } from "./deps";
import { activeRouter, onActiveRouter } from "./active";

export type ReplicaStatus = { state: "opening" | "downloading" | "ready" | "locked"; have: number; total: number | null };
export type SpaceStatus = ReplicaStatus & { level: Level; switches: Switches; locked: boolean };

const STANDARD: SpaceStatus = Object.freeze({ state: "ready", have: 0, total: null, level: "standard", switches: STANDARD_SWITCHES, locked: false });

/** The status of one space as this device sees it, now (no React). */
export function spaceStatus(scope: WireScope): SpaceStatus {
  const router = activeRouter();
  if (!router) return STANDARD;
  const space = router.spaces.get(scope);
  const lock = router.env.session.state();
  const locked = lock === "locked" || lock === "unlocking";
  if (!space) return { ...STANDARD, locked: false };
  const replica = router.status(scope);
  return { ...replica, level: space.level, switches: space.switches, locked };
}

function subscribe(cb: () => void): () => void {
  let offRouter: (() => void)[] = [];
  const bind = () => {
    for (const o of offRouter) o();
    offRouter = [];
    const r = activeRouter();
    if (!r) return;
    offRouter = [r.spaces.subscribe(cb), r.replicas.subscribe(cb), r.env.session.subscribe(cb), r.onRoutesChanged(cb)];
  };
  bind();
  const offActive = onActiveRouter(() => {
    bind();
    cb();
  });
  return () => {
    offActive();
    for (const o of offRouter) o();
  };
}

const sameStatus = (a: SpaceStatus, b: SpaceStatus) =>
  a.state === b.state && a.have === b.have && a.total === b.total && a.level === b.level && a.locked === b.locked && JSON.stringify(a.switches) === JSON.stringify(b.switches);

/** §12 WP7: a space's replica status, level, switches and whether this device is locked. */
export function useE2eeSpaceStatus(scope: WireScope): SpaceStatus {
  const last = useRef<SpaceStatus>(STANDARD);
  const key = scope.kind === "personal" ? "personal" : `workspace:${scope.workspaceId}`;
  const get = useCallback(() => {
    const next = spaceStatus(key === "personal" ? { kind: "personal" } : { kind: "workspace", workspaceId: key.slice("workspace:".length) });
    if (!sameStatus(last.current, next)) last.current = next;
    return last.current;
  }, [key]);
  return useSyncExternalStore(subscribe, get, () => STANDARD);
}

/** §12 WP7: whether this device knows the note to be sealed (end-to-end encrypted). */
export function isSealedDocument(documentId: string): boolean {
  return activeRouter()?.spaces.isSealed(documentId) ?? false;
}
