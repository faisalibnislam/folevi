// What the background migration (docs/E2EE_DESIGN.md §6.9, WP8) works with: the plain Convex client (the
// migration reads plaintext rows through the normal queries and writes through e2ee.migrate, never through the
// router), the sealer and key ring (WP7, WP6), this device's id (it is `documents.sealing.by`) and the space.
//
// The server functions are WP3's (convex/e2ee/migrate.ts). Two that an unseal needs aren't there yet; they
// are called by name (see `pending` below and the "Settled while building WP8" note in docs/E2EE_DESIGN.md),
// and a missing one pauses the job with a clear failure instead of looping.
import { makeFunctionReference, type FunctionReference } from "convex/server";
import { ConvexError } from "convex/values";
import type { WireBlock, WireScope } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import type { Sealer } from "../seal";
import type { KeyRingLike, PulledNoteKey } from "../router/deps";
import type { InnerClient } from "../router/types";

export interface MigrateSpace {
  scope: WireScope;
  /** `personal:<id>` / `workspace:<id>`: the scope inside AAD contexts (§4.5). */
  scopeId: string;
}

export interface MigrateEnv {
  server: InnerClient;
  sealer: Sealer;
  keyring: KeyRingLike;
  /** This device (sync engine id): what `documents.sealing.by` names while it converts a note. */
  deviceId: string;
  space: MigrateSpace;
  fetch?: typeof fetch;
  /** Stops between notes (the tab went to the background, the device locked). */
  signal?: AbortSignal;
}

type Args = Record<string, unknown>;

/** Typed-enough calls on the plain client (results are cast where they're read). */
export const call = {
  query: (env: Pick<MigrateEnv, "server">, ref: FunctionReference<"query">, args: Args) => env.server.query(ref, args),
  mutation: (env: Pick<MigrateEnv, "server">, ref: FunctionReference<"mutation">, args: Args) => env.server.mutation(ref, args),
  action: (env: Pick<MigrateEnv, "server">, ref: FunctionReference<"action">, args: Args) => env.server.action(ref, args),
};

/** The e2ee.migrate functions (WP3). */
export const migrate = api.e2ee.migrate as unknown as Record<string, FunctionReference<"query" | "mutation">>;

/**
 * Functions an unseal needs that WP3 hasn't added yet, by name, with the signatures WP8 calls:
 * - unsealSnapshot({ snapshotId, content: { title, icon, cover?, style?, blocks }, name: string | null })
 * - unsealNames({ scope, folders: { folderId, name }[], tags: { tagId, name }[] })
 */
export const pending = {
  unsealSnapshot: makeFunctionReference<"mutation", { snapshotId: string; content: PlainVersionContent; name: string | null }, unknown>("e2ee/migrate:unsealSnapshot"),
  unsealNames: makeFunctionReference<"mutation", { scope: WireScope; folders: { folderId: string; name: string }[]; tags: { tagId: string; name: string }[] }, unknown>("e2ee/migrate:unsealNames"),
};

/** A version's content in the plain shape `documents.snapshotContent` serves for Standard notes. */
export interface PlainVersionContent {
  title: string;
  icon: string | null;
  cover?: unknown;
  style?: unknown;
  blocks: WireBlock[];
}

/** The error code of a Convex (or local) error, if it has one. */
export function codeOf(e: unknown): string | null {
  if (e instanceof ConvexError) {
    const d = e.data as { code?: unknown } | string;
    if (typeof d === "object" && d && typeof d.code === "string") return d.code;
  }
  const data = (e as { data?: { code?: unknown } } | null)?.data;
  if (data && typeof data.code === "string") return data.code;
  return null;
}

/** Whether the server doesn't have a function (an older deployment, or a server follow-up not landed yet). */
export function isMissingFunction(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /Could not find (public )?function|No such function|there is no such export|isn't a function on the server/i.test(msg);
}

/** A note key row as e2ee.grants.myNoteKeys answers. */
interface MyNoteKey {
  documentId: string;
  version: number;
  wrappedBy: "space" | "grant" | "link";
  spaceVersion: number | null;
  wrapped: ArrayBuffer;
}

/**
 * Hands the key ring every wrap of a note's key this person may open (the server's copy is the truth: a lapsed
 * lease may have stored note key v1 already). Returns the newest version, or 0 when the note has no key yet.
 */
export async function loadNoteKeys(env: Pick<MigrateEnv, "server" | "keyring" | "space">, documentId: string): Promise<number> {
  const rows = ((await call.query(env, api.e2ee.grants.myNoteKeys, { documentIds: [documentId] })) as MyNoteKey[] | null) ?? [];
  const mine = rows.filter((r) => r.documentId === documentId);
  if (!mine.length) return 0;
  const pulled: PulledNoteKey[] = mine.map((r) => ({ documentId, version: r.version, wrappedBy: r.wrappedBy, spaceVersion: r.spaceVersion, wrapped: r.wrapped, scope: env.space.scope }));
  await env.keyring.addNoteKeys(pulled);
  return Math.max(...mine.map((r) => r.version));
}

/** Throws when the run was told to stop (between notes, never in the middle of one). */
export function checkStop(env: Pick<MigrateEnv, "signal">): void {
  if (env.signal?.aborted) throw new StopRun();
}

export class StopRun extends Error {
  constructor() {
    super("The migration stopped on this device.");
    this.name = "StopRun";
  }
}

/** base64url of wire bytes (SealedVersionContent carries ciphertext as text). */
export function b64(bytes: ArrayBuffer | Uint8Array): string {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function unb64(text: string): Uint8Array {
  const s = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Hex of bytes. */
export function hex(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}
