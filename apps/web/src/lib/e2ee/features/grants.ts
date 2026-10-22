// Completing grants on a manager's device (docs/E2EE_DESIGN.md §8.2 to §8.4, WP8). In an encrypted workspace
// the server lists who is waiting for the key (e2ee.grants.pending): new members ("joined"), members who
// reset their encryption ("reset"), people a sealed page was shared with ("page"), and, after a member left,
// a key change ("rotation"). Any online device of an owner or admin with the key does the work: WP6's
// setup.completePendingGrants seals the space key (or the page's note key) to each waiting person who has
// set up encryption, and setup.rotateSpace makes the new space key; the server's reseal job then re-seals the
// notes in the background (migrate/runner.ts).
import { useSyncExternalStore } from "react";
import type { WireScope } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import type { E2eeSpace } from "../router/deps";
import type { InnerClient } from "../router/types";
import { scopeKeyOf } from "../router/deps";
import { codeOf } from "../migrate/env";

export interface PendingRow {
  profileId: string;
  reason: "joined" | "reset" | "rotation" | "page";
  documentId: string | null;
  hasKeys: boolean;
}

export interface GrantDeps {
  server: Pick<InnerClient, "query">;
  space: E2eeSpace;
  /** WP6 setup.completePendingGrants. */
  completePendingGrants(scope: WireScope): Promise<number>;
  /** WP6 setup.rotateSpace. */
  rotateSpace(scope: WireScope, onProgress: (n: number, of: number) => void): Promise<void>;
}

const rotations = new Map<string, { done: number; total: number }>();
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of [...listeners]) l();
};

/** A workspace's key change in progress on this device ("Changing the workspace key… 120 of 900 notes"). */
export function useRotationProgress(scope: WireScope): { done: number; total: number } | null {
  const key = scopeKeyOf(scope);
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => rotations.get(key) ?? null,
    () => null,
  );
}

/**
 * One pass for one workspace: who is waiting, then the work this device can do. Returns false when this person
 * can't manage the workspace (the server says forbidden): the worker stops asking.
 */
export async function completeGrants(d: GrantDeps): Promise<boolean> {
  if (d.space.scope.kind !== "workspace" || d.space.level === "standard") return true;
  let rows: PendingRow[];
  try {
    rows = ((await d.server.query(api.e2ee.grants.pending, { scope: d.space.scope })) as PendingRow[] | null) ?? [];
  } catch (e) {
    if (codeOf(e) === "forbidden") return false;
    throw e;
  }
  if (rows.some((r) => r.reason === "rotation")) {
    const key = scopeKeyOf(d.space.scope);
    rotations.set(key, { done: 0, total: 0 });
    emit();
    try {
      await d.rotateSpace(d.space.scope, (n, of) => {
        rotations.set(key, { done: n, total: of });
        emit();
      });
    } finally {
      rotations.delete(key);
      emit();
    }
  }
  if (rows.some((r) => r.hasKeys && r.reason !== "rotation")) await d.completePendingGrants(d.space.scope);
  return true;
}
