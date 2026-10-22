// What arrived for an encrypted space (docs/E2EE_DESIGN.md §7.4, §7.5, WP8): emails, web clips, connected
// apps' writes and Foli AI's digests, sealed by the server to the space's inbox key (e2eeInbox). An unlocked
// device of the person each item came for lists them (e2ee.inbox.waiting), opens each with the space key,
// makes the change through the sync engine (sealed by the router), then marks it applied.
//
// Ids come from the item (the note the server promised the app, the to-do's id) or are derived from the
// item's id, so a second device applying the same item writes the same rows instead of new ones.
import { ConvexError } from "convex/values";
import {
  inboxDocumentId,
  localDate,
  markdownToBlocks,
  rankBetween,
  repeatProps,
  SCHEMA_VERSION,
  scopeIdKey,
  validateWireBlock,
  type SyncOp,
  type WireBlock,
} from "@folevi/editor-schema";
import { ctx as aad, openSealed, sha256 } from "@folevi/local-store/e2ee";
import { api } from "@/lib/convex/api";
import type { LocalBlock, LocalDocument } from "@/lib/local/store";
import type { LocalReader } from "@/lib/local/registry";
import type { E2eeSpace, KeyRingLike } from "../router/deps";
import type { InnerClient } from "../router/types";
import { codeOf } from "../migrate/env";

/** What a device finds inside an item (convex/lib/e2ee/inboxSeal.ts InboxPayload). */
export type InboxPayload =
  | { kind: "email"; subject: string; from: { address: string; name: string }; receivedAt: number; blocks: WireBlock[]; attachments: string[]; documentId: string }
  | { kind: "clip"; title: string; markdown: string; url?: string; documentId: string; folderId?: string }
  | { kind: "app"; tool: string; app: { name: string; device: string; reason: "mcp" | "api" }; args: Record<string, unknown>; documentId?: string; taskId?: string; profileId: string; at: number }
  | { kind: "note"; source: "digest" | "routine"; title: string; blocks: WireBlock[]; documentId: string; profileId: string; at: number };

export interface InboxDeps {
  server: Pick<InnerClient, "query" | "mutation">;
  keyring: Pick<KeyRingLike, "spaceKeys">;
  space: E2eeSpace;
  store: LocalReader;
  profileId: string;
  timeZone?: string;
  /** Sends sync ops (sealed) and, once the notes they create are on the server, the calls after them. */
  send(ops: SyncOp[], after: { ref: unknown; args: Record<string, unknown> }[], created: string[]): Promise<void>;
  /** Items applied by this device in this session (a second listing before the server catches up). */
  done?: Set<string>;
}

interface Waiting {
  id: string;
  kind: "email" | "clip" | "app";
  keyVersion: number;
  targetDocumentId: string | null;
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A ULID-shaped id derived from a seed: the same item gives the same rows on every device. */
export function stableId(seed: string, n: number | string): string {
  const h = sha256(new TextEncoder().encode(`folevi/e2ee/inbox-id\n${seed}\n${n}`));
  let out = "";
  for (let i = 0; i < 26; i++) out += CROCKFORD[h[i]! & 31];
  return out;
}

/** Opens one item with the space's inbox key (FLS1, context inbox/<scope>/<id>). */
export async function openItem(d: Pick<InboxDeps, "server" | "keyring" | "space">, id: string): Promise<{ payload: InboxPayload; targetDocumentId: string | null }> {
  const item = (await d.server.query(api.e2ee.inbox.open, { inboxId: id })) as { keyVersion: number; scopeId: string; sealed: ArrayBuffer; targetDocumentId: string | null };
  const sk = await d.keyring.spaceKeys(d.space.scope, item.keyVersion);
  const bytes = await openSealed(sk.inbox.privateKey, sk.inbox.publicKey, aad.inbox(item.scopeId, id), new Uint8Array(item.sealed));
  try {
    return { payload: JSON.parse(new TextDecoder().decode(bytes)) as InboxPayload, targetDocumentId: item.targetDocumentId };
  } finally {
    bytes.fill(0);
  }
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

function liveRoots(blocks: LocalBlock[]): LocalBlock[] {
  return blocks.filter((b) => b.deletedAt === null && b.parentId === null).sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0));
}

async function lastRank(store: LocalReader, documentId: string): Promise<string | null> {
  const roots = liveRoots((await store.list("blocks", documentId)) as LocalBlock[]);
  return roots[roots.length - 1]?.rank ?? null;
}

/** Valid blocks only, root blocks placed one after the other from `after`. */
function placed(blocks: WireBlock[], after: string | null): WireBlock[] {
  let prev = after;
  const out: WireBlock[] = [];
  for (const b of blocks) {
    const { revision: _r, ...rest } = b;
    void _r;
    const block = rest as WireBlock;
    if (block.parentId === null) {
      block.rank = rankBetween(prev, null);
      prev = block.rank;
    }
    if (!validateWireBlock(block).length) out.push(block);
  }
  return out;
}

function fromMarkdown(markdown: string, seed: string): WireBlock[] {
  let n = 0;
  return markdownToBlocks(markdown, { newId: () => stableId(seed, n++) }).blocks;
}

const upsert = (documentId: string, block: WireBlock, baseRevision: number | null = null): SyncOp => ({ opId: stableId(`${documentId}/${block.id}`, `op-${baseRevision ?? "new"}`), kind: "block.upsert", documentId, block, baseRevision, fields: ["content", "position"] });

/**
 * The person's Inbox page in the space, made sealed when there is none (§6.7 "Inbox page"). Personal: the
 * one e2eeSpaces.inboxDocumentId names, else this device makes one and registers it (e2ee.content.setInbox;
 * the first registered wins and is returned). A workspace: each person's at its fixed id, unregistered.
 */
export async function ensureInbox(d: InboxDeps): Promise<string> {
  const personal = d.space.scope.kind === "personal";
  const fixed = inboxDocumentId(d.profileId, scopeIdKey(d.space.scope));
  if (personal) {
    const named = ((await d.store.get("meta", "space")) as { inboxDocumentId?: string | null } | undefined)?.inboxDocumentId;
    const doc = named ? ((await d.store.get("documents", named)) as LocalDocument | undefined) : undefined;
    if (named && doc && doc.deletedAt === null) return named;
  }
  const existing = (await d.store.get("documents", fixed)) as LocalDocument | undefined;
  if (!existing) {
    await d.send([{ opId: stableId(fixed, "create"), kind: "document.create", document: { id: fixed, parentDocumentId: null, folderId: null, kind: "document", title: "Inbox", icon: null, scope: d.space.scope } }], [], [fixed]);
  }
  if (!personal) return fixed;
  const r = (await d.server.mutation(api.e2ee.content.setInbox, { scope: d.space.scope, documentId: fixed })) as { documentId: string };
  return r.documentId;
}

/** A new note under the Inbox with a card for it at the end of the Inbox (convex/aiDigest.ts saveToInbox). */
async function noteUnderInbox(d: InboxDeps, seed: string, documentId: string, title: string, blocks: WireBlock[]): Promise<SyncOp[]> {
  const inbox = await ensureInbox(d);
  const ops: SyncOp[] = [];
  if (!(await d.store.get("documents", documentId))) {
    ops.push({ opId: stableId(seed, "create"), kind: "document.create", document: { id: documentId, parentDocumentId: inbox, folderId: null, kind: "document", title: title.slice(0, 200), icon: null, scope: d.space.scope } });
    for (const b of placed(blocks, null)) ops.push(upsert(documentId, b));
    const card: WireBlock = { id: stableId(seed, "card"), type: "page", parentId: null, rank: rankBetween(await lastRank(d.store, inbox), null), schemaVersion: SCHEMA_VERSION, text: [], props: { documentId, display: "card", titleCache: title.slice(0, 200) } };
    ops.push(upsert(inbox, card));
  }
  return ops;
}

function todoProps(args: Record<string, unknown>, timeZone: string): Record<string, unknown> {
  const props: Record<string, unknown> = { checked: false };
  if (typeof args.dueDate === "string") props.dueDate = args.dueDate;
  if (typeof args.dueDate === "string" && typeof args.dueTime === "string") props.dueTime = args.dueTime;
  if (typeof args.priority === "string" && args.priority !== "none") props.priority = args.priority;
  if (typeof args.assigneeId === "string") props.assigneeId = args.assigneeId;
  if (typeof args.repeat === "string" && args.repeat !== "none") {
    for (const [k, v] of Object.entries(repeatProps({ repeat: args.repeat } as Parameters<typeof repeatProps>[0]))) if (v !== null) props[k] = v;
    if (typeof props.dueDate !== "string") props.dueDate = localDate(Date.now(), timeZone);
  }
  return props;
}

/** A to-do changed the way convex/mcp.ts does it for Standard notes. */
function changedTodo(tool: string, props: Record<string, unknown>, a: Record<string, unknown>): Record<string, unknown> {
  const p = { ...props };
  if (tool === "complete_task") {
    p.checked = a.done !== false;
    return p;
  }
  if (typeof a.done === "boolean") p.checked = a.done;
  if (a.dueDate === null) {
    delete p.dueDate;
    delete p.dueTime;
  } else if (typeof a.dueDate === "string") p.dueDate = a.dueDate;
  if (a.dueTime === null) delete p.dueTime;
  else if (typeof a.dueTime === "string" && typeof p.dueDate === "string") p.dueTime = a.dueTime;
  if (typeof a.priority === "string") {
    if (a.priority === "none") delete p.priority;
    else p.priority = a.priority;
  }
  if (typeof a.repeat === "string") {
    for (const [k, v] of Object.entries(repeatProps(a.repeat === "none" ? null : ({ repeat: a.repeat } as Parameters<typeof repeatProps>[0])))) {
      if (v === null) delete p[k];
      else p[k] = v;
    }
  }
  if (a.remindAt === null) delete p.reminderAt;
  else if (typeof a.remindAt === "string" && Number.isFinite(Date.parse(a.remindAt))) p.reminderAt = Date.parse(a.remindAt);
  return p;
}

/** The sync ops one item stands for, and the note it created (if any). */
export async function opsFor(d: InboxDeps, itemId: string, p: InboxPayload): Promise<{ ops: SyncOp[]; created: string | null }> {
  switch (p.kind) {
    case "email":
      return { ops: await noteUnderInbox(d, itemId, p.documentId, p.subject || "Email", p.blocks ?? []), created: p.documentId };
    case "note":
      return { ops: await noteUnderInbox(d, itemId, p.documentId, p.title || "Untitled", p.blocks ?? []), created: p.documentId };
    case "clip": {
      const blocks = fromMarkdown(p.markdown ?? "", itemId);
      if (p.url) blocks.push({ id: stableId(itemId, "source"), type: "paragraph", parentId: null, rank: "V", schemaVersion: SCHEMA_VERSION, text: [{ type: "text", text: p.url, marks: [{ type: "link", href: p.url }] } as never], props: {} });
      if (p.folderId) {
        const ops: SyncOp[] = [{ opId: stableId(itemId, "create"), kind: "document.create", document: { id: p.documentId, parentDocumentId: null, folderId: p.folderId, kind: "document", title: (p.title || "Clip").slice(0, 200), icon: null, scope: d.space.scope } }];
        for (const b of placed(blocks, null)) ops.push(upsert(p.documentId, b));
        return { ops, created: p.documentId };
      }
      return { ops: await noteUnderInbox(d, itemId, p.documentId, p.title || "Clip", blocks), created: p.documentId };
    }
    case "app":
      return await appOps(d, itemId, p);
  }
}

async function appOps(d: InboxDeps, itemId: string, p: Extract<InboxPayload, { kind: "app" }>): Promise<{ ops: SyncOp[]; created: string | null }> {
  const a = p.args ?? {};
  switch (p.tool) {
    case "create_note": {
      if (!p.documentId) throw new ConvexError({ code: "invalid_argument", message: "No note id." });
      const title = str(a.title).trim().slice(0, 200);
      const blocks = fromMarkdown(str(a.markdown), itemId);
      if ((await d.store.get("documents", p.documentId)) !== undefined) return { ops: [], created: p.documentId };
      const ops: SyncOp[] = [{ opId: stableId(itemId, "create"), kind: "document.create", document: { id: p.documentId, parentDocumentId: null, folderId: typeof a.folderId === "string" ? a.folderId : null, kind: "document", title, icon: null, scope: d.space.scope } }];
      for (const b of placed(blocks, null)) ops.push(upsert(p.documentId, b));
      return { ops, created: p.documentId };
    }
    case "append_to_note": {
      if (!p.documentId || !(await d.store.get("documents", p.documentId))) throw new ConvexError({ code: "not_found", message: "Note not found." });
      return { ops: placed(fromMarkdown(str(a.markdown), itemId), await lastRank(d.store, p.documentId)).map((b) => upsert(p.documentId!, b)), created: null };
    }
    case "add_task": {
      const documentId = p.documentId ?? (await ensureInbox(d));
      const id = p.taskId ?? stableId(itemId, "task");
      if ((await d.store.get("blocks", id, documentId)) !== undefined) return { ops: [], created: null };
      const block: WireBlock = { id, type: "todo", parentId: null, rank: rankBetween(await lastRank(d.store, documentId), null), schemaVersion: SCHEMA_VERSION, text: [{ type: "text", text: str(a.text).trim().slice(0, 500) }], props: todoProps(a, d.timeZone ?? "UTC") };
      return { ops: [upsert(documentId, block)], created: null };
    }
    case "complete_task":
    case "update_task": {
      if (!p.documentId || !p.taskId) throw new ConvexError({ code: "not_found", message: "Task not found." });
      const row = (await d.store.get("blocks", p.taskId, p.documentId)) as LocalBlock | undefined;
      if (!row || row.deletedAt !== null) throw new ConvexError({ code: "not_found", message: "Task not found." });
      const block: WireBlock = { id: row.id, type: row.type, parentId: row.parentId, rank: row.rank, schemaVersion: row.schemaVersion, text: row.text, props: changedTodo(p.tool, row.props as Record<string, unknown>, a) };
      const op = upsert(p.documentId, block, row.revision) as Extract<SyncOp, { kind: "block.upsert" }>;
      return { ops: [{ ...op, fields: ["content"] }], created: null };
    }
    default:
      throw new ConvexError({ code: "invalid_argument", message: "Unknown app write." });
  }
}

/** One pass over what's waiting: each item opened, applied and marked. Returns how many were applied. */
export async function applyInbox(d: InboxDeps): Promise<number> {
  const waiting = ((await d.server.query(api.e2ee.inbox.waiting, { scope: d.space.scope })) as Waiting[] | null) ?? [];
  const done = d.done ?? new Set<string>();
  let applied = 0;
  for (const w of waiting) {
    if (done.has(w.id)) continue;
    let payload: InboxPayload;
    try {
      payload = (await openItem(d, w.id)).payload;
    } catch (e) {
      if (codeOf(e) === "not_found") continue;
      await d.server.mutation(api.e2ee.inbox.markFailed, { inboxId: w.id, reason: "cant_open" }).catch(() => undefined);
      continue;
    }
    try {
      const { ops, created } = await opsFor(d, w.id, payload);
      if (ops.length) await d.send(ops, [], created ? [created] : []);
      const createdDocumentId = created && w.targetDocumentId === created ? { createdDocumentId: created } : {};
      await d.server.mutation(api.e2ee.inbox.markApplied, { inboxId: w.id, ...createdDocumentId });
      done.add(w.id);
      applied++;
    } catch (e) {
      const code = codeOf(e) ?? "error";
      // Locked out or offline: tried again next pass. Anything else won't get better: set aside.
      if (code === "e2ee_locked_session" || code === "e2ee_busy") continue;
      if (e instanceof TypeError) continue;
      await d.server.mutation(api.e2ee.inbox.markFailed, { inboxId: w.id, reason: code }).catch(() => undefined);
    }
  }
  return applied;
}
