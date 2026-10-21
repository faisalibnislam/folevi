// Test helpers for WP5's suites (e2ee-guards-ai.test.ts, e2ee-features.test.ts): an encrypted space set up
// directly in the database with a real inbox key pair (so the server's sealed items can be opened here,
// playing the device), notes sealed in place, readable copies, and a stubbed Gemini.
//
// The server never opens anything; only these tests do (the static invariant covers convex/ only).
import { vi } from "vitest";
import { canonicalJson } from "@folevi/editor-schema";
import { ctx as aad, generateX25519, openSealed, type X25519KeyPair } from "@folevi/local-store/e2ee";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { para, ulid, type T } from "./helpers";

export type Switches = {
  foliAi: "off" | "ask" | "auto";
  backgroundAi: boolean;
  searchEverywhere: boolean;
  apps: boolean;
  emailToNote: boolean;
  webClipper: boolean;
  notificationPreviews: boolean;
};

export const OFF: Switches = { foliAi: "off", backgroundAi: false, searchEverywhere: false, apps: false, emailToNote: false, webClipper: false, notificationPreviews: false };
export const PICKED: Switches = { ...OFF, foliAi: "ask" };

type Who = { as: { mutation: (...a: never[]) => Promise<unknown> }; profileId: string };
type ScopeArg = { kind: "personal" } | { kind: "workspace"; workspaceId: string };

/** The scope fields and key of a Personal or a workspace (by public id). */
async function scopeOf(t: T, profileId: string, workspaceId?: string) {
  return await t.run(async (ctx) => {
    if (!workspaceId) return { fields: { ownerProfileId: profileId as Id<"profiles"> }, key: `p:${profileId}`, scopeId: `personal:${profileId}` };
    const ws = await ctx.db
      .query("workspaces")
      .withIndex("by_public_id", (q) => q.eq("publicId", workspaceId))
      .unique();
    return { fields: { workspaceId: ws!._id }, key: `w:${ws!._id}`, scopeId: `workspace:${workspaceId}` };
  });
}

/**
 * An encrypted space as WP2's setUp + enable would leave it: level, switches, key version 1 with a real
 * inbox key pair (returned, so tests can open what the server sealed to it).
 */
export async function encryptScope(t: T, owner: { profileId: string }, opts: { workspaceId?: string; level?: "standard" | "selected" | "full"; switches?: Partial<Switches>; lockedCount?: number } = {}) {
  const inbox: X25519KeyPair = await generateX25519({ extractable: true });
  const { fields, key, scopeId } = await scopeOf(t, owner.profileId, opts.workspaceId);
  const level = opts.level ?? "selected";
  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("e2eeSpaces", {
      ...fields,
      scopeKey: key,
      level,
      state: level === "standard" ? "off" : "on",
      switches: { ...(level === "full" ? OFF : PICKED), ...opts.switches },
      currentKeyVersion: 1,
      lockedCount: opts.lockedCount ?? 0,
      changedBy: owner.profileId as Id<"profiles">,
      changedAt: now,
      seq: 0,
    } as never);
    await ctx.db.insert("e2eeSpaceKeys", {
      ...fields,
      scopeKey: key,
      version: 1,
      inboxPub: inbox.publicKey.slice().buffer as ArrayBuffer,
      skCheck: new ArrayBuffer(16),
      createdBy: owner.profileId as Id<"profiles">,
      createdAt: now,
    } as never);
  });
  return { inbox, scopeId, scopeKey: key };
}

/** Changes a space's switches (WP2's setSwitches would). */
export async function setSwitches(t: T, scopeKey: string, switches: Partial<Switches>) {
  await t.run(async (ctx) => {
    const row = await ctx.db
      .query("e2eeSpaces")
      .withIndex("by_scope_key", (q) => q.eq("scopeKey", scopeKey))
      .unique();
    await ctx.db.patch(row!._id, { switches: { ...row!.switches, ...switches } });
  });
}

/** A plain note made through sync.push (before its space is encrypted). Returns its public id. */
export async function note(who: Who, title: string, lines: string[], scope: ScopeArg = { kind: "personal" }): Promise<string> {
  const id = ulid();
  await who.as.mutation(
    api.sync.push as never,
    {
      scope,
      deviceId: "device-wp5",
      ops: [
        { opId: ulid(), kind: "document.create", document: { id, parentDocumentId: null, folderId: null, kind: "document", title, icon: null } },
        ...lines.map((text, i) => ({ opId: ulid(), kind: "block.upsert", documentId: id, block: para(ulid(), text, String.fromCharCode(80 + i)), baseRevision: null, fields: ["content", "position"] })),
      ],
    } as never,
  );
  return id;
}

/**
 * Turns a note into a sealed one in place, as a finished seal migration leaves it: the plaintext columns
 * hold placeholders, its blocks are sealed (fake ciphertext: the server never opens it), derived rows go.
 */
export async function sealDoc(t: T, publicId: string, opts: { locked?: boolean } = {}) {
  await t.run(async (ctx) => {
    const doc = (await ctx.db
      .query("documents")
      .withIndex("by_public_id", (q) => q.eq("publicId", publicId))
      .unique())!;
    await ctx.db.patch(doc._id, {
      sealedAt: Date.now(),
      sealedTitle: { c: new ArrayBuffer(40), k: 1, mac: "A".repeat(22) },
      title: "",
      searchText: "",
      excerpt: "",
      ...(opts.locked ? { locked: true } : {}),
    } as never);
    for (const b of await ctx.db
      .query("blocks")
      .withIndex("by_document", (q) => q.eq("documentId", doc._id))
      .collect()) {
      await ctx.db.patch(b._id, { type: "sealed", text: [], props: {}, schemaVersion: 0, sealed: { c: new ArrayBuffer(48), mac: "B".repeat(22), k: 1 } } as never);
    }
    for (const r of await ctx.db
      .query("tasks")
      .withIndex("by_document", (q) => q.eq("documentId", doc._id))
      .collect())
      await ctx.db.delete(r._id);
  });
}

/** A readable copy of a sealed note, written directly (the device's features/mirror.ts would call e2ee.mirrors.put). */
export async function mirror(t: T, publicId: string, purpose: "search" | "ai" | "apps", copy: { title: string; text: string; tasks?: { blockId: string; text: string; done: boolean; due?: string }[]; tags?: string[]; folderPath?: string }) {
  await t.run(async (ctx) => {
    const doc = (await ctx.db
      .query("documents")
      .withIndex("by_public_id", (q) => q.eq("publicId", publicId))
      .unique())!;
    await ctx.db.insert("e2eeMirrors", {
      ...(doc.workspaceId ? { workspaceId: doc.workspaceId } : { ownerProfileId: doc.ownerProfileId }),
      purpose,
      documentId: doc._id,
      title: copy.title,
      text: copy.text,
      ...(copy.tasks ? { tasks: copy.tasks } : {}),
      ...(copy.tags ? { tags: copy.tags } : {}),
      ...(copy.folderPath ? { folderPath: copy.folderPath } : {}),
      contentHash: `h${Date.now()}`,
      updatedAt: Date.now(),
    } as never);
  });
}

/** The Convex id of a note by its public id. */
export async function docId(t: T, publicId: string): Promise<Id<"documents">> {
  return await t.run(async (ctx) => (await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", publicId)).unique())!._id);
}

/** A stubbed Gemini: every call answers `reply` (or what it returns for the request body); the prompts are kept. */
export function gemini(reply: string | ((body: string) => string) = "An answer.") {
  process.env.GEMINI_API_KEY = "test-key";
  const prompts: string[] = [];
  const fetchMock = vi.fn(async (_url: string, init?: { body?: string }) => {
    const body = String(init?.body ?? "");
    prompts.push(body);
    const text = typeof reply === "function" ? reply(body) : reply;
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 } }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { prompts, fetchMock };
}

export function stopGemini() {
  vi.unstubAllGlobals();
  delete process.env.GEMINI_API_KEY;
}

/** Opens an inbox item the server sealed, as a member's device would (the space's inbox private key). */
export async function openInboxItem(t: T, inbox: X25519KeyPair, scopeId: string, publicId: string): Promise<Record<string, unknown>> {
  const row = await t.run(async (ctx) => await ctx.db.query("e2eeInbox").withIndex("by_public_id", (q) => q.eq("publicId", publicId)).unique());
  if (!row) throw new Error(`no inbox item ${publicId}`);
  const plain = await openSealed(inbox.privateKey, inbox.publicKey, aad.inbox(scopeId, publicId), new Uint8Array(row.sealed));
  return JSON.parse(new TextDecoder().decode(plain)) as Record<string, unknown>;
}

/** Every row of every table, as JSON text (UTF-8 and base64 of byte fields), for marker scans. */
export async function everyRow(t: T, tables: string[]): Promise<string> {
  return await t.run(async (ctx) => {
    const parts: string[] = [];
    for (const table of tables) {
      const rows = await (ctx.db.query(table as never) as unknown as { collect(): Promise<unknown[]> }).collect();
      parts.push(
        JSON.stringify(rows, (_k, val) => {
          if (val instanceof ArrayBuffer) {
            const u = new Uint8Array(val);
            return `${new TextDecoder().decode(u)}|${btoa(String.fromCharCode(...u))}`;
          }
          return val;
        }),
      );
    }
    return parts.join("\n");
  });
}

export { canonicalJson };
