// Sealing what arrives for an encrypted space (docs/E2EE_DESIGN.md §7.4, §7.5). WP5.
//
// An email to the space's address, a web clip, or a connected app's write can't be turned into a note on
// the server: the server can't read or write the space's notes. Instead it seals the item to the public
// half of the space's inbox key (FLS1, `sealTo` from @folevi/local-store/e2ee, context `inbox/<scope>/<id>`)
// and stores only the sealed box in `e2eeInbox`. A member's unlocked device opens it with the space key,
// creates the note (sealed, through the sync engine) and marks the item applied (convex/e2ee/inbox.ts).
//
// The server may seal but never opens (tests/convex/static/invariants.test.ts). The plaintext bytes are
// zeroed once sealed; nothing plaintext is stored or logged.
import { canonicalJson, ulid } from "@folevi/editor-schema";
import { ctx as aad, sealTo } from "@folevi/local-store/e2ee";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { fail } from "../errors";
import { insertScoped, scopeKey, type Scope } from "../scope";
import { e2eeScopeId, failE2ee, spaceE2ee } from "./state";

/** How long an item waits for a device before it expires (§5.8). */
export const INBOX_TTL_MS = 30 * 86_400_000;
/** One sealed item (a Convex document holds at most 1 MiB). */
export const INBOX_ITEM_BYTES = 512 * 1024;
/**
 * Bytes that may wait in one space. The design's 25 MiB (§5.8) can't be summed in one transaction (Convex
 * reads at most 16 MiB), so the cap is 12 MiB: summing stops as soon as it is passed.
 */
export const INBOX_WAITING_BYTES = 12 * 1024 * 1024;

export type InboxKind = "email" | "clip" | "app";

/** What a device finds inside an item (canonical JSON, sealed). Ids are public ids. */
export type InboxPayload =
  | { kind: "email"; subject: string; from: { address: string; name: string }; receivedAt: number; blocks: unknown[]; attachments: string[]; documentId: string }
  | { kind: "clip"; title: string; markdown: string; url?: string; documentId: string; folderId?: string }
  | { kind: "app"; tool: string; app: { name: string; device: string; reason: "mcp" | "api" }; args: Record<string, unknown>; documentId?: string; taskId?: string; profileId: string; at: number }
  /** A note Foli AI wrote for the person (a digest, a routine): made under their Inbox page. Stored as kind "app". */
  | { kind: "note"; source: "digest" | "routine"; title: string; blocks: unknown[]; documentId: string; profileId: string; at: number };

/** The space's current key version with its inbox public key, or null when the space has no key yet. */
export async function currentInboxKey(ctx: QueryCtx, scope: Scope): Promise<{ version: number; inboxPub: ArrayBuffer } | null> {
  const space = await spaceE2ee(ctx, scope);
  if (!space || space.currentKeyVersion < 1) return null;
  const row = await ctx.db
    .query("e2eeSpaceKeys")
    .withIndex("by_scope_version", (q) => q.eq("scopeKey", scopeKey(scope)).eq("version", space.currentKeyVersion))
    .unique();
  if (!row || row.retiredAt !== undefined) return null;
  return { version: row.version, inboxPub: row.inboxPub };
}

/** Bytes of items still waiting in a space (counted up to the cap, which is all the check needs). */
async function waitingBytes(ctx: QueryCtx, scope: Scope): Promise<number> {
  let total = 0;
  for await (const r of ctx.db.query("e2eeInbox").withIndex("by_scope_status", (q) => q.eq("scopeKey", scopeKey(scope)).eq("status", "waiting"))) {
    total += r.size;
    if (total > INBOX_WAITING_BYTES) break;
  }
  return total;
}

/**
 * Seals `payload` to the space's inbox key and stores it as a waiting item. `publicId` may be given (a
 * deterministic id makes a retried delivery find the item it already stored). Returns the item's id.
 */
export async function sealToInbox(
  ctx: MutationCtx,
  scope: Scope,
  kind: InboxKind,
  payload: InboxPayload,
  opts: { publicId?: string; targetDocumentId?: string; for?: Id<"profiles"> } = {},
): Promise<{ id: Id<"e2eeInbox">; publicId: string }> {
  const key = await currentInboxKey(ctx, scope);
  if (!key) failE2ee("e2ee_not_set_up");
  const publicId = opts.publicId ?? ulid();
  const plaintext = new TextEncoder().encode(canonicalJson(payload));
  let sealed: Uint8Array;
  try {
    if (plaintext.byteLength + 64 > INBOX_ITEM_BYTES) fail("limit_exceeded", "That is too large to save in an encrypted space.");
    sealed = await sealTo(new Uint8Array(key.inboxPub), aad.inbox(await e2eeScopeId(ctx, scope), publicId), plaintext);
  } finally {
    plaintext.fill(0);
  }
  if ((await waitingBytes(ctx, scope)) + sealed.byteLength > INBOX_WAITING_BYTES) {
    fail("limit_exceeded", "This encrypted space has too much waiting for a device. Open Folevi on one of your devices, then try again.");
  }
  const now = Date.now();
  const id = await insertScoped(ctx, "e2eeInbox", scope, {
    publicId,
    scopeKey: scopeKey(scope),
    keyVersion: key.version,
    kind,
    sealed: sealed.buffer.slice(sealed.byteOffset, sealed.byteOffset + sealed.byteLength) as ArrayBuffer,
    size: sealed.byteLength,
    ...(opts.targetDocumentId ? { targetDocumentId: opts.targetDocumentId } : {}),
    status: "waiting",
    // While it waits, `appliedBy` names the person it came for: only their devices apply it (e2ee/inbox.ts).
    ...(opts.for ? { appliedBy: opts.for } : {}),
    receivedAt: now,
    expiresAt: now + INBOX_TTL_MS,
  });
  return { id, publicId };
}

/** An item stored earlier under this public id (a retried delivery), if any. */
export async function inboxItem(ctx: QueryCtx, publicId: string): Promise<Doc<"e2eeInbox"> | null> {
  return await ctx.db
    .query("e2eeInbox")
    .withIndex("by_public_id", (q) => q.eq("publicId", publicId))
    .unique();
}

/** A short deterministic id from parts (hex of SHA-256), for retried deliveries. */
export async function stableInboxId(prefix: string, ...parts: string[]): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts.join("\n"))));
  let hex = "";
  for (const b of digest.subarray(0, 13)) hex += b.toString(16).padStart(2, "0");
  return `${prefix}${hex}`;
}
