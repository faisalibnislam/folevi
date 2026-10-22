// What the router, the replica and the sealers need from the rest of end-to-end encryption
// (docs/E2EE_DESIGN.md §12): WP6's key session and key ring, as the design names them, and the space shapes
// the server returns (§5.3). The router codes against these interfaces only, so its tests run with a fake key
// ring over real WP1 crypto, and the app hands it WP6's `getKeySession()` / `getKeyRing()`.
import type { AccountKeys, NoteKeys, SpaceKeys } from "@folevi/local-store/e2ee";
import type { WireScope } from "@folevi/editor-schema";
import { STANDARD_SWITCHES, type E2eeLevel, type Switches } from "../../../../../../convex/lib/e2ee/validators";

export type { WireScope } from "@folevi/editor-schema";
export type { Switches } from "../../../../../../convex/lib/e2ee/validators";
export type Level = E2eeLevel;
export { STANDARD_SWITCHES };

/** WP6 (§12): "none" means the account has no E2EE at all. */
export type LockState = "none" | "locked" | "unlocking" | "unlocked";

/** The part of WP6's KeySession the data side uses. */
export interface KeySessionLike {
  state(): LockState;
  subscribe(cb: () => void): () => void;
  accountKeys(): AccountKeys;
  deviceId(): string;
}

/** A note key wrap as the pull (and e2ee.grants.myNoteKeys) returns it (§5.3 PulledNoteKey). */
export interface PulledNoteKey {
  documentId: string;
  version: number;
  wrappedBy: "space" | "grant" | "link";
  spaceVersion?: number | null;
  profileId?: string | null;
  linkId?: string | null;
  wrapped: ArrayBuffer;
  /** The space it belongs to, when the caller knows (WP6's key ring uses it to pick the space key). */
  scope?: WireScope;
}

/** WP6's KeyRing (§12), exactly. */
export interface KeyRingLike {
  spaceKeys(scope: WireScope, version?: number): Promise<SpaceKeys & { version: number }>;
  noteKeys(documentId: string, version?: number): Promise<NoteKeys & { version: number }>;
  newNoteKey(documentId: string, scope: WireScope): Promise<{ keys: NoteKeys; version: number; wrapped: Uint8Array; spaceVersion: number }>;
  addNoteKeys(rows: PulledNoteKey[]): Promise<void>;
  linkNoteKey(documentId: string, secret: Uint8Array, wrapped: Uint8Array, version: number): Promise<void>;
}

/** One e2ee-active space the caller can open (e2ee.spaces.mine, §5.3). */
export interface E2eeSpace {
  scope: WireScope;
  /** `personal:<profileId>` or `workspace:<workspacePublicId>`: the scope inside AAD contexts (§4.5). */
  scopeId: string;
  level: Level;
  state: "off" | "enabling" | "on" | "disabling";
  switches: Switches;
  currentKeyVersion: number;
  lockedCount: number;
  seq?: number;
}

/** A WireScope as a stable string ("personal", "workspace:<id>"), for maps and database names. */
export function scopeKeyOf(scope: WireScope): string {
  return scope.kind === "personal" ? "personal" : `workspace:${scope.workspaceId}`;
}

export function sameScope(a: WireScope | null | undefined, b: WireScope | null | undefined): boolean {
  if (!a || !b) return false;
  return scopeKeyOf(a) === scopeKeyOf(b);
}

/**
 * Whether the device serves a space's lists itself (an encrypted level: its replica holds every note, the
 * ones a migration hasn't reached yet in plaintext), rather than only filling in its locked notes (a Standard
 * space with locks, or one being turned back to Standard: the replica holds only sealed notes).
 */
export function isEncryptedLevel(space: Pick<E2eeSpace, "level"> | null | undefined): boolean {
  return !!space && space.level !== "standard";
}
