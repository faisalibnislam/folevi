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

export { useE2eeSpaceStatus, isSealedDocument } from "@/lib/e2ee/router";
export { useMigrationProgress, retryFailed, startMigrationRunner, type MigrationProgress } from "@/lib/e2ee/migrate";
export { startFeatureWorkers, useAiConsent, useRotationProgress, type ConsentRequest } from "@/lib/e2ee/features";
export { createEncryptedLink, revokeEncryptedLink, publishPlainCopy } from "@/lib/e2ee/links";
export type { Level, Switches };

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
