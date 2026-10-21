// End-to-end encryption: the cheap checks every content path uses (docs/E2EE_DESIGN.md §5.6).
//
// Standard spaces never have an `e2eeSpaces` row, so for them `spaceE2ee` is one indexed read that finds
// nothing and every guard here passes. The new behaviour starts only when a space row exists or a row
// carries sealed fields (§5.9).
import { ConvexError } from "convex/values";
import type { Doc } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { scopeKey, scopeOfRow, type Scope } from "../scope";
import { plainReadable } from "./plainText";
import { FULL_SWITCHES, STANDARD_SWITCHES, type MirrorPurpose, type MirrorTask, type Switches } from "./validators";

export type { MirrorTask, Switches } from "./validators";

/** Error codes of end-to-end encryption (§5.6). Thrown as `ConvexError({ code, message, ...extra })`. */
export type E2eeErrorCode =
  | "e2ee_required"
  | "e2ee_not_set_up"
  | "e2ee_plaintext"
  | "e2ee_busy"
  | "e2ee_unavailable"
  | "e2ee_switch_off"
  | "e2ee_locked"
  | "e2ee_recovery_required"
  | "e2ee_last_method"
  | "e2ee_conflict"
  | "e2ee_device_only"
  | "e2ee_rate_limited";

/** The default message of each code (the client shows its own copy, §10.12). */
export const E2EE_MESSAGES: Record<E2eeErrorCode, string> = {
  e2ee_required: "This note is end-to-end encrypted. Update Folevi to edit it.",
  e2ee_not_set_up: "End-to-end encryption isn't set up for this space yet.",
  e2ee_plaintext: "This note is end-to-end encrypted, so its content must be encrypted too.",
  e2ee_busy: "Encrypting this note. Your changes are saved on this device.",
  e2ee_unavailable: "This isn't available in an end-to-end encrypted space.",
  e2ee_switch_off: "This feature is turned off for this space in Settings > Privacy.",
  e2ee_locked: "This note is always fully encrypted, so this feature can't use it.",
  e2ee_recovery_required: "Add a second way to unlock before you turn on encryption.",
  e2ee_last_method: "You need at least two ways to unlock. Add another before removing this one.",
  e2ee_conflict: "This changed on another device. Try again.",
  e2ee_device_only: "This is done on your device for encrypted notes.",
  e2ee_rate_limited: "Too many tries. Try again in an hour, or use another way to unlock.",
};

export function failE2ee(code: E2eeErrorCode, message?: string, extra?: Record<string, string | number | boolean>): never {
  throw new ConvexError({ code, message: message ?? E2EE_MESSAGES[code], ...extra });
}

/** A space's E2EE row (level, state, switches), or null for a Standard space that never set it up. One indexed read. */
export async function spaceE2ee(ctx: QueryCtx, scope: Scope): Promise<Doc<"e2eeSpaces"> | null> {
  return await ctx.db
    .query("e2eeSpaces")
    .withIndex("by_scope_key", (q) => q.eq("scopeKey", scopeKey(scope)))
    .unique();
}

/** Whether a space needs the device's attention: encrypted, or Standard with locked folders or notes. */
export function isE2eeActive(space: Doc<"e2eeSpaces"> | null): boolean {
  return space !== null && (space.level !== "standard" || space.state === "disabling" || space.lockedCount > 0);
}

/** A sealed note: its title, appearance, meta and blocks are ciphertext. */
export function isSealed(doc: Doc<"documents">): boolean {
  return doc.sealedAt !== undefined;
}

/** A sealed block: its content is ciphertext (the plaintext fields hold placeholders). */
export function isSealedBlock(row: Doc<"blocks">): boolean {
  return row.sealed !== undefined;
}

/** "Always fully encrypted": the note itself, or inherited from a locked folder (kept in step by moves). */
export async function isLocked(_ctx: QueryCtx, doc: Doc<"documents">): Promise<boolean> {
  return doc.locked === true || doc.lockedVia !== undefined;
}

/** Refuses a plaintext content write to a sealed note, or to any note of an encrypted space (an old client). */
export async function requirePlainWrite(ctx: MutationCtx, doc: Doc<"documents">): Promise<void> {
  if (isSealed(doc)) failE2ee("e2ee_required");
  await requirePlainWriteInScope(ctx, scopeOfRow(doc));
}

/** Refuses a plaintext content write into an encrypted space (level above Standard). */
export async function requirePlainWriteInScope(ctx: MutationCtx, scope: Scope): Promise<void> {
  const space = await spaceE2ee(ctx, scope);
  if (space && space.level !== "standard") failE2ee("e2ee_required");
}

/**
 * The switches in force for a space. A Standard space (no row, or level standard) reads as everything on,
 * which is today's behaviour; Fully encrypted reads as everything off. Locked folders and notes follow
 * FULL_SWITCHES whatever this says (callers check `isLocked`).
 */
export function switchesOf(space: Doc<"e2eeSpaces"> | null): Switches {
  if (!space || space.level === "standard") return STANDARD_SWITCHES;
  if (space.level === "full") return FULL_SWITCHES;
  return space.switches;
}

/** The switch a readable copy of each purpose needs (§7.2 to §7.4). */
const SWITCH_OF_PURPOSE: Record<MirrorPurpose, "searchEverywhere" | "backgroundAi" | "apps"> = {
  search: "searchEverywhere",
  ai: "backgroundAi",
  apps: "apps",
};

export interface Readable {
  title: string;
  text: string;
  tasks?: MirrorTask[];
  folderPath?: string;
  tags?: string[];
}

/**
 * What the server may read of a note for `purpose`: a Standard note from its rows as today; a sealed note
 * from its readable copy (`e2eeMirrors`) when the space's switch for it is on; otherwise null. A locked note
 * is never readable, sealed or not.
 */
export async function readableFor(ctx: QueryCtx, doc: Doc<"documents">, purpose: MirrorPurpose): Promise<Readable | null> {
  if (await isLocked(ctx, doc)) return null;
  if (!isSealed(doc)) return await plainReadable(ctx, doc, purpose);
  const space = await spaceE2ee(ctx, scopeOfRow(doc));
  if (!switchesOf(space)[SWITCH_OF_PURPOSE[purpose]]) return null;
  const mirror = await ctx.db
    .query("e2eeMirrors")
    .withIndex("by_document_purpose", (q) => q.eq("documentId", doc._id).eq("purpose", purpose))
    .unique();
  if (!mirror) return null;
  const out: Readable = { title: mirror.title, text: mirror.text };
  if (mirror.tasks) out.tasks = mirror.tasks;
  if (mirror.folderPath !== undefined) out.folderPath = mirror.folderPath;
  if (mirror.tags) out.tags = mirror.tags;
  return out;
}

/**
 * The scope as it appears inside AAD contexts and statements (§4.5): `personal:<profile id>` or
 * `workspace:<workspace public id>`. Profiles have no separate public id; their id is what clients see.
 */
export async function e2eeScopeId(ctx: QueryCtx, scope: Scope): Promise<string> {
  if (scope.kind === "personal") return `personal:${scope.profileId}`;
  const ws = await ctx.db.get(scope.workspaceId);
  if (!ws) failE2ee("e2ee_not_set_up", "Workspace not found.");
  return `workspace:${ws.publicId}`;
}
