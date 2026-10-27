// The Vault's log (docs/VAULT_PLAN.md §7): every entry chained to the one before it by hash, written only here,
// never edited, deleted only by the 3-year expiry (convex/vaultLog.ts expire). A static test fails if anything
// else writes to, patches or deletes from vaultLog.
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { sha256Hex } from "../crypto";
import type { VaultRole } from "./access";

/** How long an entry is kept: 3 years from when it was written. */
export const LOG_RETENTION_MS = 3 * 365.25 * 24 * 60 * 60 * 1000;

/** The chain's start for a new Vault (its first entry's prevHash). */
export const genesisHash = (vaultPublicId: string) => sha256Hex(`folevi/vault/v1/genesis/${vaultPublicId}`);

export type LogRole = VaultRole | "recipient" | "link" | "system";

/** Where an action came from, as the caller's device reports it (never trusted for access decisions). */
export interface LogClient {
  deviceId?: string;
  deviceLabel?: string;
  deviceKind?: string;
  timeZone?: string;
  sessionId?: string;
  ip?: string;
  location?: string;
}

export interface LogEntry {
  /** What happened, e.g. "vault.unlock", "item.reveal" (docs/VAULT_PLAN.md §7.2). */
  event: string;
  actor: { profile: Doc<"profiles"> | null; role: LogRole; name?: string; email?: string };
  outcome?: "ok" | "failed";
  reason?: string;
  item?: { publicId: string; kind: string };
  /** Names and paths, already sealed with the vault key by the device. */
  sealedDetail?: ArrayBuffer;
  /** Facts that aren't secret (changed field names, counts, recipient, role, expiry, file type and size). */
  detail?: Record<string, unknown>;
  client?: LogClient;
  source?: "server" | "device";
}

/** JSON with object keys sorted at every level (Convex returns stored objects with their keys sorted). */
function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
    .join(",")}}`;
}

/** The canonical text an entry's hash covers (stable key order; the sealed detail by its own hash). */
async function canonical(e: Omit<Doc<"vaultLog">, "_id" | "_creationTime" | "hash">): Promise<string> {
  const sealed = e.sealedDetail ? await sha256Hex(Array.from(new Uint8Array(e.sealedDetail), (b) => b.toString(16).padStart(2, "0")).join("")) : "";
  return stable([
    e.vaultPublicId,
    e.place.kind,
    e.place.id,
    e.seq,
    e.at,
    e.timeZone ?? "",
    e.actorId ?? "",
    e.actorName,
    e.actorEmail ?? "",
    e.actorRole,
    e.event,
    e.outcome,
    e.reason ?? "",
    e.itemPublicId ?? "",
    e.itemKind ?? "",
    sealed,
    e.detail ?? null,
    e.device ?? null,
    e.ip ?? "",
    e.location ?? "",
    e.sessionId ?? "",
    e.source,
    e.prevHash,
    e.expiresAt,
  ]);
}

/** An entry's hash: what the next entry chains to, and what the integrity check recomputes. */
export async function entryHash(e: Omit<Doc<"vaultLog">, "_id" | "_creationTime" | "hash">): Promise<string> {
  return await sha256Hex(`folevi/vault/v1/log/${await canonical(e)}`);
}

/** Where a Vault lives, as the log keeps it (public ids, so it outlives the rows). */
async function placeOf(ctx: MutationCtx, vault: Doc<"vaults">): Promise<{ kind: "personal" | "workspace"; id: string }> {
  if (vault.ownerProfileId) return { kind: "personal", id: vault.ownerProfileId as string };
  const ws = vault.workspaceId ? await ctx.db.get(vault.workspaceId) : null;
  return { kind: "workspace", id: ws?.publicId ?? (vault.workspaceId as string) };
}

/** Appends one entry to a Vault's log and moves its chain head. Returns the entry's number. */
export async function appendLog(ctx: MutationCtx, vault: Doc<"vaults">, entry: LogEntry): Promise<number> {
  // Re-read the vault so two entries in one mutation chain correctly.
  const current = (await ctx.db.get(vault._id)) ?? vault;
  const now = Date.now();
  const actor = entry.actor;
  const row: Omit<Doc<"vaultLog">, "_id" | "_creationTime" | "hash"> = {
    vaultPublicId: current.publicId,
    place: await placeOf(ctx, current),
    seq: current.logSeq + 1,
    at: now,
    ...(entry.client?.timeZone ? { timeZone: entry.client.timeZone.slice(0, 64) } : {}),
    ...(actor.profile ? { actorId: actor.profile._id as Id<"profiles"> } : {}),
    actorName: (actor.name ?? actor.profile?.displayName ?? "Someone").slice(0, 120),
    ...(actor.email ?? actor.profile?.email ? { actorEmail: (actor.email ?? actor.profile!.email).slice(0, 254) } : {}),
    actorRole: actor.role,
    event: entry.event,
    outcome: entry.outcome ?? "ok",
    ...(entry.reason ? { reason: entry.reason.slice(0, 200) } : {}),
    ...(entry.item ? { itemPublicId: entry.item.publicId, itemKind: entry.item.kind } : {}),
    ...(entry.sealedDetail ? { sealedDetail: entry.sealedDetail } : {}),
    ...(entry.detail ? { detail: entry.detail } : {}),
    ...(entry.client && (entry.client.deviceId || entry.client.deviceLabel || entry.client.deviceKind)
      ? { device: { ...(entry.client.deviceId ? { id: entry.client.deviceId.slice(0, 80) } : {}), ...(entry.client.deviceLabel ? { label: entry.client.deviceLabel.slice(0, 120) } : {}), ...(entry.client.deviceKind ? { kind: entry.client.deviceKind.slice(0, 20) } : {}) } }
      : {}),
    ...(entry.client?.ip ? { ip: entry.client.ip.slice(0, 64) } : {}),
    ...(entry.client?.location ? { location: entry.client.location.slice(0, 120) } : {}),
    ...(entry.client?.sessionId ? { sessionId: entry.client.sessionId.slice(0, 80) } : {}),
    source: entry.source ?? "server",
    prevHash: current.logHead,
    expiresAt: now + LOG_RETENTION_MS,
  };
  const hash = await entryHash(row);
  await ctx.db.insert("vaultLog", { ...row, hash });
  await ctx.db.patch(current._id, { logSeq: row.seq, logHead: hash });
  return row.seq;
}
