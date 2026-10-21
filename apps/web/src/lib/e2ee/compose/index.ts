// The composers (docs/E2EE_DESIGN.md §6.4 "compose", §6.7, WP7): device versions of the server mutations
// that derive content, for sealed notes and encrypted spaces. Most run the ported local handler over the
// replica (capture.ts); the version ones open the server's sealed version first.
import { ConvexError } from "convex/values";
import { cloneBlocks, markdownToBlocks, type WireBlock } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { insertDocument, toSummary } from "@/lib/local/functions/shared";
import { rewriteNote } from "@/lib/local/functions/documents.history";
import { copyCollectionsInto } from "@/lib/local/functions/collections";
import { getFunctionName } from "convex/server";
import type { LocalDocument } from "@/lib/local/store";
import type { LocalMutationCtx } from "@/lib/local/registry";
import { errorCode } from "@/lib/local/errors";
import { isEncryptedLevel, type E2eeSpace } from "../router/deps";
import type { Call, Composer, RouterEnv } from "../router/types";
import { capture, captureRun, project, replicaStoreFor, send, type Captured } from "./capture";

function spaceOf(call: Call): E2eeSpace {
  const space = call.res.space;
  if (!space) throw new ConvexError({ code: "e2ee_unavailable", message: "This encrypted space isn't open on this device.", feature: "compose" });
  return space;
}

function deviceOf(env: RouterEnv): string {
  return env.engine()?.deviceId ?? env.session.deviceId();
}

/** The plaintext path, for calls a composer finds aren't about sealed content after all. */
const passThrough = (call: Call, env: RouterEnv) =>
  call.kind === "action" ? env.inner.action(refOf(call.name, "action"), call.args) : env.inner.mutation(refOf(call.name, "mutation"), call.args);

function refOf<K extends "mutation" | "action">(name: string, _kind: K) {
  void _kind;
  const [mod, fn] = name.split(":") as [string, string];
  return (api as unknown as Record<string, Record<string, unknown>>)[mod]![fn] as never;
}

/**
 * Runs the ported local handler of `call.name` over the replica and sends what it wrote. In a Standard space
 * with locks, a call about a note the replica doesn't hold (not_found) is a plain note's: it goes to Convex.
 */
export function captured(kind: "mutation" | "action" = "mutation"): Composer {
  return async (call, env) => {
    const space = spaceOf(call);
    const store = replicaStoreFor(env, space);
    let c: Captured;
    try {
      c = await capture(store, kind, call.name, call.args, deviceOf(env));
    } catch (e) {
      if (errorCode(e) === "not_found" && !isEncryptedLevel(space) && !call.res.sealed) return await passThrough(call, env);
      throw e;
    }
    await send(await project(c, space, env), space, env);
    return c.result;
  };
}

/** Runs a function over the replica (a handler's helpers), capturing its writes. */
async function captureFn<T>(env: RouterEnv, space: E2eeSpace, fn: (ctx: LocalMutationCtx) => Promise<T>): Promise<{ result: T; c: Captured }> {
  let result: T | undefined;
  const c = await captureRun(replicaStoreFor(env, space), deviceOf(env), async (ctx) => {
    result = await fn(ctx);
    return result;
  });
  return { result: result as T, c };
}

/** The opened content of a server version (the snapshotContent decoder) and the note it belongs to. */
async function openedVersion(call: Call, env: RouterEnv): Promise<{ documentId: string; content: { title: string; icon: string | null; style?: unknown; blocks: WireBlock[] } }> {
  const snapshotId = String(call.args.snapshotId ?? "");
  const documentId = env.spaces.ref("snapshot", snapshotId)?.documentId ?? call.res.documentId;
  if (!documentId) throw new ConvexError({ code: "not_found", message: "Version not found." });
  const opened = (await env.call("query", getFunctionName(api.documents.snapshotContent), { snapshotId })) as { content: string | null } | null;
  if (!opened?.content) throw new ConvexError({ code: "not_found", message: "Version not found." });
  return { documentId, content: JSON.parse(opened.content) as { title: string; icon: string | null; style?: unknown; blocks: WireBlock[] } };
}

/** documents.restoreSnapshot: the note as it is now is kept as a version first (blind), then rewritten (§6.7). */
const restoreSnapshot: Composer = async (call, env) => {
  const space = spaceOf(call);
  const { documentId, content } = await openedVersion(call, env);
  const before = (await env.inner.mutation(api.documents.createSnapshot, { documentId, reason: "manual" })) as { id?: string } | null;
  const { c } = await captureFn(env, space, async (ctx) => {
    const doc = await ctx.db.get("documents", documentId);
    if (!doc) throw new ConvexError({ code: "not_found", message: "Document not found." });
    return await rewriteNote(ctx, doc, { title: content.title, icon: content.icon, style: content.style as LocalDocument["style"], blocks: content.blocks });
  });
  await send(await project(c, space, env), space, env);
  return { undoVersionId: before?.id ?? null };
};

/** documents.copyVersion: a new note with the version's content. */
const copyVersion: Composer = async (call, env) => {
  const space = spaceOf(call);
  const { documentId, content } = await openedVersion(call, env);
  const { result, c } = await captureFn(env, space, async (ctx) => {
    const doc = await ctx.db.get("documents", documentId);
    if (!doc) throw new ConvexError({ code: "not_found", message: "Document not found." });
    const profile = (await ctx.db.get("meta", "profile")) as { id: string };
    const copy = await insertDocument(ctx, {
      title: `${content.title || "Untitled"} (copy)`.slice(0, 500),
      icon: content.icon ?? doc.icon,
      kind: doc.kind === "template" ? "template" : "document",
      folderId: doc.folderId,
      parentDocumentId: doc.parentDocumentId,
      style: (content.style as LocalDocument["style"]) ?? doc.style,
      cover: doc.cover,
      blocks: cloneBlocks(content.blocks),
    });
    await copyCollectionsInto(ctx, copy.id);
    return toSummary((await ctx.db.get("documents", copy.id)) ?? copy, profile.id);
  });
  await send(await project(c, space, env), space, env);
  return result;
};

/** aiGraph.linkNote: a "Related:" line at the end of the note, as the server writes it. */
const linkNote: Composer = async (call, env) => {
  const space = spaceOf(call);
  const documentId = String(call.args.documentId);
  const targetId = String(call.args.targetId);
  const { result, c } = await captureFn(env, space, async (ctx) => {
    const { rankBetween, SCHEMA_VERSION, ulid } = await import("@folevi/editor-schema");
    const doc = await ctx.db.get("documents", documentId);
    if (!doc || doc.inTrash) throw new ConvexError({ code: "not_found", message: "Note not found." });
    const target = await ctx.db.get("documents", targetId);
    const label = target?.title || env.spaces.label(targetId)?.title || "Untitled";
    const roots = (await ctx.db.list("blocks", documentId)).filter((b) => b.deletedAt === null && b.parentId === null).sort((a, b) => (a.rank < b.rank ? -1 : 1));
    const id = ulid();
    const now = ctx.now();
    ctx.db.put("blocks", id, {
      id,
      type: "paragraph",
      parentId: null,
      rank: rankBetween(roots.at(-1)?.rank ?? null, null),
      schemaVersion: SCHEMA_VERSION,
      text: [{ type: "text", text: "Related: " }, { type: "pageLink", documentId: targetId, label }],
      props: {},
      documentId,
      revision: 1,
      contentRev: 1,
      positionRev: 1,
      seq: 0,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    }, documentId);
    return { blockId: id };
  });
  await send(await project(c, space, env), space, env);
  return result;
};

/** aiChat.saveAsNote: the conversation as Markdown (the server keeps the chat), saved on the device as a sealed note. */
const chatAsNote: Composer = async (call, env) => {
  const space = spaceOf(call);
  const exported = (await env.inner.query(api.aiChat.exportMarkdown, { conversationId: call.args.conversationId, ...(call.args.messageId ? { messageId: call.args.messageId } : {}) })) as { filename: string; markdown: string };
  const title = exported.filename.replace(/\.md$/, "") || "Foli AI chat";
  const c = await capture(replicaStoreFor(env, space), "mutation", getFunctionName(api.aiWriting.saveDraft), { scope: space.scope, kind: "note", title, markdown: exported.markdown }, deviceOf(env));
  await send(await project(c, space, env), space, env);
  return c.result;
};

/** Composers not built yet answer as the server does for a sealed note (e2ee_device_only), with the feature named. */
function unavailable(feature: string): Composer {
  return async () => {
    throw new ConvexError({ code: "e2ee_unavailable", message: "This isn't available in an end-to-end encrypted space yet.", feature });
  };
}

/** copies.copyTo from a sealed note: the note and its sub-pages read from the replica, created again where asked. */
const copyTo: Composer = async (call, env) => {
  const space = spaceOf(call);
  const store = replicaStoreFor(env, space);
  const documentId = String(call.args.documentId);
  const includeSubpages = call.args.includeSubpages !== false;
  const destination = call.args.destination as E2eeSpace["scope"];
  const root = await store.get("documents", documentId);
  if (!root) throw new ConvexError({ code: "not_found", message: "Document not found." });
  const all = includeSubpages ? await store.list("documents") : [root];
  const pages: LocalDocument[] = [];
  const walk = (id: string, depth: number) => {
    const d = all.find((x) => x.id === id);
    if (!d || d.inTrash || depth > 12) return;
    pages.push(d);
    if (includeSubpages) for (const kid of all.filter((x) => x.parentDocumentId === id)) walk(kid.id, depth + 1);
  };
  walk(documentId, 0);
  const { ulid } = await import("@folevi/editor-schema");
  const ids = new Map(pages.map((p) => [p.id, ulid()]));
  const ops = [];
  for (const p of pages) {
    const id = ids.get(p.id)!;
    const blocks = cloneBlocks((await store.list("blocks", p.id)).filter((b) => b.deletedAt === null).map((b) => ({ id: b.id, type: b.type, parentId: b.parentId, rank: b.rank, schemaVersion: b.schemaVersion, text: b.text, props: b.props })));
    ops.push({
      opId: ulid(),
      kind: "document.create" as const,
      document: {
        id,
        parentDocumentId: p.id === documentId ? null : (ids.get(p.parentDocumentId ?? "") ?? null),
        folderId: p.id === documentId ? ((call.args.folderId as string | null | undefined) ?? null) : null,
        kind: p.kind,
        title: p.title,
        icon: p.icon,
        style: p.style,
        cover: p.cover,
        scope: destination,
      },
    });
    for (const b of blocks) ops.push({ opId: ulid(), kind: "block.upsert" as const, documentId: id, block: b, baseRevision: null, fields: ["content", "position"] as ("content" | "position")[] });
  }
  for (let i = 0; i < ops.length; i += 100) {
    const results = await env.push(destination, ops.slice(i, i + 100));
    const refused = results.find((r) => r.status === "rejected");
    if (refused) throw new ConvexError({ code: refused.error?.code ?? "rejected", message: refused.error?.message ?? "The copy couldn't be made." });
  }
  return { id: ids.get(documentId)!, title: root.title, pages: pages.length, place: destination.kind === "personal" ? "Personal" : "workspace" };
};

/** Markdown into blocks (imports and drafts), for composers that build notes from text. */
export function markdownBlocks(markdown: string): WireBlock[] {
  return markdownToBlocks(markdown, { titleFromHeading: false }).blocks;
}

export const COMPOSERS = {
  captured,
  restoreSnapshot,
  copyVersion,
  linkNote,
  chatAsNote,
  copyTo,
  unavailable,
};
