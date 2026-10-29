"use client";
// What the encryption screens read and write, from the real packages (docs/E2EE_DESIGN.md §12): WP6's keys
// (`@/lib/e2ee/keys`, imported directly by the screens), WP7's router hooks, WP8's migration, features and
// links, and the few Convex calls of §5.3 the screens make themselves.
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import type { WireScope } from "@folevi/editor-schema";
import { memberSecurityCode } from "@folevi/local-store/e2ee";
import { api } from "@/lib/convex/api";
import { useKeySession } from "@/lib/e2ee/keys";
import type { Level, Switches } from "@/lib/e2ee/router/deps";

// From the modules themselves, not their indexes: these hooks are on every page, and the indexes bring the
// router, the migration runner, the feature workers and the links (with the local functions they share),
// which only spaces with end-to-end encryption run. Those load when first used (docs/E2EE_DESIGN.md §6.4).
export { useE2eeSpaceStatus, isSealedDocument } from "@/lib/e2ee/router/hooks";
export { useMigrationProgress, type MigrationProgress } from "@/lib/e2ee/migrate/progress";
export { useAiConsent, type ConsentRequest } from "@/lib/e2ee/features/consent";
export { useRotationProgress } from "@/lib/e2ee/features/grants";
export type { Level, Switches };

/** Starts a runner from a module loaded on demand; the stop returned works before it has loaded too. */
function startLater(load: () => Promise<() => () => void>): () => void {
  let stop: (() => void) | null = null;
  let stopped = false;
  void load().then((start) => {
    if (!stopped) stop = start();
  });
  return () => {
    stopped = true;
    stop?.();
  };
}

/** The encrypted spaces' migration runner (WP8), while the device is unlocked. */
export const startMigrationRunner = (): (() => void) => startLater(() => import("@/lib/e2ee/migrate/runner").then((m) => m.startMigrationRunner));
/** The feature workers (§7, §8.2 to §8.4), while the device is unlocked. */
export const startFeatureWorkers = (): (() => void) => startLater(() => import("@/lib/e2ee/features").then((m) => m.startFeatureWorkers));
/** Tries a failed migration job again (all of them without `jobId`). */
export function retryFailed(jobId?: string): void {
  void import("@/lib/e2ee/migrate/runner").then((m) => m.retryFailed(jobId));
}
export const createEncryptedLink = async (...a: Parameters<typeof import("@/lib/e2ee/links").createEncryptedLink>) => (await import("@/lib/e2ee/links")).createEncryptedLink(...a);
export const revokeEncryptedLink = async (...a: Parameters<typeof import("@/lib/e2ee/links").revokeEncryptedLink>) => (await import("@/lib/e2ee/links")).revokeEncryptedLink(...a);
export const publishPlainCopy = async (...a: Parameters<typeof import("@/lib/e2ee/links").publishPlainCopy>) => (await import("@/lib/e2ee/links")).publishPlainCopy(...a);

/** §7.1: the defaults at "Encrypted, with the features you pick". */
export const DEFAULT_SWITCHES: Switches = { foliAi: "ask", backgroundAi: false, searchEverywhere: false, apps: false, emailToNote: false, webClipper: false, notificationPreviews: false };
/** §7.1: at Fully encrypted every switch is off and can't change. */
export const FULL_SWITCHES: Switches = { foliAi: "off", backgroundAi: false, searchEverywhere: false, apps: false, emailToNote: false, webClipper: false, notificationPreviews: false };

export interface SpaceRow {
  setUp: boolean;
  level: Level;
  state: "off" | "enabling" | "on" | "disabling";
  switches: Switches;
  lockedCount: number;
  keyHolders: number;
  /** Encrypted, or Standard with folders or notes that are always fully encrypted. */
  e2eeActive: boolean;
}

/** `e2ee.spaces.get`: a space's encryption as the server has it (undefined while loading). `skip` runs nothing. */
export function useE2eeSpace(scope: WireScope, o: { skip?: boolean } = {}): SpaceRow | null | undefined {
  const row = useQuery(api.e2ee.spaces.get, o.skip ? "skip" : { scope });
  if (o.skip) return null;
  if (row === undefined) return undefined;
  return { setUp: row.setUp, level: row.level, state: row.state, switches: row.switches as Switches, lockedCount: row.lockedCount, keyHolders: row.keyHolders, e2eeActive: row.active };
}

/** The writes the screens make (§5.3). */
export function useE2eeActions() {
  const enable = useMutation(api.e2ee.spaces.enable);
  const setSwitches = useMutation(api.e2ee.spaces.setSwitches);
  const lower = useMutation(api.e2ee.spaces.lower);
  const folderLocked = useMutation(api.e2ee.content.setFolderLocked);
  const documentLocked = useMutation(api.e2ee.content.setDocumentLocked);
  return {
    /** Starts encrypting a Standard space, or raises an encrypted one (selected → full). */
    enable: (scope: WireScope, level: Exclude<Level, "standard">, switches: Switches) => enable({ scope, level, switches }),
    setSwitches: (scope: WireScope, switches: Switches) => setSwitches({ scope, switches }),
    /** Needs the wrap a method re-check opened in the last 10 minutes (`recheckedWrapId`). */
    lower: (scope: WireScope, level: Level, recheckedWrapId: string) => lower({ scope, level, recheckedWrapId }),
    setFolderLocked: (folderId: string, locked: boolean) => folderLocked({ folderId, locked }),
    setDocumentLocked: (documentId: string, locked: boolean) => documentLocked({ documentId, locked }),
  };
}

/** `e2ee.spaces.keyHolders` and the key change in progress: who waits for the key, and how far a rotation is. */
export function useWorkspaceKeys(scope: WireScope, rotation: { done: number; total: number } | null): { pending: ReadonlySet<string>; rotation: { done: number; total: number } | null; keyChanged: ReadonlySet<string> } | null {
  const { state } = useKeySession();
  const space = useE2eeSpace(scope, { skip: state === "none" });
  const holders = useQuery(api.e2ee.spaces.keyHolders, space && space.level !== "standard" ? { scope } : "skip");
  if (!space || space.level === "standard") return null;
  // Key changes of other members (§8.6) are noticed by the key ring when it opens their grants; the screen
  // doesn't list them yet.
  return { pending: new Set((holders?.pending ?? []).filter((p) => p.reason !== "page").map((p) => p.profileId)), rotation, keyChanged: new Set() };
}

/** A member's security code (§8.6): 12 digits from their account key, or null while loading or without keys. */
export function useMemberSecurityCode(profileId: string | null): string | null {
  const keys = useQuery(api.e2ee.keys.accountKeysOf, profileId ? { profileIds: [profileId] } : "skip");
  const pub = keys?.[0]?.ed25519Pub;
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (!pub) {
      setCode(null);
      return;
    }
    void memberSecurityCode(new Uint8Array(pub)).then((c) => live && setCode(c));
    return () => {
      live = false;
    };
  }, [pub]);
  return code;
}

/**
 * Whether this person can open an encrypted workspace (§8.1, §8.2): "needs_setup" without keys of their own,
 * "waiting_for_key" while no admin's device has shared the key yet. Personal is always theirs. Only a
 * workspace is asked about, so a Standard account in Personal runs nothing.
 */
export function useSpaceAccess(scope: WireScope): "ok" | "needs_setup" | "waiting_for_key" {
  const { state } = useKeySession();
  const workspace = scope.kind === "workspace";
  const space = useE2eeSpace(scope, { skip: !workspace });
  const mine = useQuery(api.e2ee.spaces.mine, workspace && state !== "none" && space && space.level !== "standard" ? {} : "skip");
  if (!workspace || !space || space.level === "standard") return "ok";
  if (state === "none") return "needs_setup";
  if (!mine) return "ok";
  const row = mine.find((m) => m.scope.kind === "workspace" && m.scope.workspaceId === scope.workspaceId);
  return row && row.grants.length === 0 ? "waiting_for_key" : "ok";
}
