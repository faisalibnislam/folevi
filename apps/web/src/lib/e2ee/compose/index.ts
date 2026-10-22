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
import { reportNoteMarkdown, reportTitle, type ReportSource } from "../../../../../../convex/lib/ai/research";
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
    const store = (await replicaStoreFor(env, space));
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
  const c = await captureRun((await replicaStoreFor(env, space)), deviceOf(env), async (ctx) => {
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
  // Named after the version's name when it has one, as the server does.
  const listed = (await env.call("query", getFunctionName(api.documents.versions), { documentId })) as { versions?: { id: string; name: string | null }[] } | null;
  const name = listed?.versions?.find((v) => v.id === call.args.snapshotId)?.name ?? null;
  const { result, c } = await captureFn(env, space, async (ctx) => {
    const doc = await ctx.db.get("documents", documentId);
    if (!doc) throw new ConvexError({ code: "not_found", message: "Document not found." });
    const profile = (await ctx.db.get("meta", "profile")) as { id: string };
    const copy = await insertDocument(ctx, {
      title: `${name ?? (content.title || "Untitled")} (copy)`.slice(0, 500),
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
  const c = await capture((await replicaStoreFor(env, space)), "mutation", getFunctionName(api.aiWriting.saveDraft), { scope: space.scope, kind: "note", title, markdown: exported.markdown }, deviceOf(env));
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
  const store = (await replicaStoreFor(env, space));
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

/** study.setNewPerDay: a setting of the person's (the server keeps it); the replica's study queue reads it too. */
const newPerDay: Composer = async (call, env) => {
  const r = await env.inner.mutation(api.study.setNewPerDay, call.args);
  for (const s of env.spaces.list()) await env.replicas.hostedStore?.(s.scope)?.ingest([{ table: "meta", id: "studyNewPerDay", value: call.args.value }]);
  return r;
};

/**
 * users.completeOnboardingStep in an encrypted Personal: the server records the step but can't write the
 * starter notes or style the Welcome note there (§5.7 users row), so local mode's handler works out what it
 * would add (from the replica, before the step moves on), the server takes the step, then the notes go sealed.
 */
const onboardingStep: Composer = async (call, env) => {
  const space = call.res.space;
  if (!space || space.scope.kind !== "personal" || !isEncryptedLevel(space)) return await env.inner.mutation(api.users.completeOnboardingStep, call.args);
  let c: Captured | null = null;
  try {
    c = await capture((await replicaStoreFor(env, space)), "mutation", call.name, call.args, deviceOf(env));
  } catch {
    // Whatever the server answers (a step out of order) is the answer.
  }
  const r = await env.inner.mutation(api.users.completeOnboardingStep, call.args);
  if (c) await send(await project({ result: null, writes: c.writes.filter(({ w }) => w.table === "documents" || w.table === "blocks") }, space, env), space, env);
  return r;
};

/**
 * changes.undo for a sealed note (§6.7): the lines others changed since this person last looked go back to
 * what they were. changes.note gives the changed lines and, opened, how they were: `previous` (the server's,
 * for a plain note) or the version saved when they last looked (`seenVersionId`, opened here).
 */
const undoChanges: Composer = async (call, env) => {
  const space = spaceOf(call);
  const documentId = String(call.args.documentId);
  const note = (await env.call("query", getFunctionName(api.changes.note), { documentId })) as {
    kinds?: [string, "added" | "edited" | "removed"][];
    previous?: WireBlock[] | null;
    seenVersionId?: string | null;
    more?: boolean;
  } | null;
  const gone = () => new ConvexError({ code: "not_found", message: "The version from when you last looked is gone. Open version history to go back further." });
  if (!note || !note.kinds) throw gone();
  if (note.more) throw new ConvexError({ code: "limit_exceeded", message: "That's too many changes to undo here. Open version history instead." });
  let before = note.previous ?? null;
  if (!before && note.seenVersionId) {
    const opened = (await env.call("query", getFunctionName(api.documents.snapshotContent), { snapshotId: note.seenVersionId })) as { content: string | null } | null;
    before = opened?.content ? (JSON.parse(opened.content) as { blocks: WireBlock[] }).blocks : null;
  }
  if (!before) throw gone();
  if (!note.kinds.length) return { undoVersionId: null, reverted: 0 };
  const was = new Map(before.map((b) => [b.id, b]));
  const made = (await env.inner.mutation(api.documents.createSnapshot, { documentId, reason: "manual" })) as { id?: string } | null;
  const { c } = await captureFn(env, space, async (ctx) => {
    const doc = await ctx.db.get("documents", documentId);
    if (!doc) throw new ConvexError({ code: "not_found", message: "Document not found." });
    const page = new Map((await ctx.db.list("blocks", documentId)).filter((b) => b.deletedAt === null).map((b) => [b.id, { id: b.id, type: b.type, parentId: b.parentId, rank: b.rank, schemaVersion: b.schemaVersion, text: b.text, props: b.props } as WireBlock]));
    for (const [blockId] of note.kinds!) {
      const old = was.get(blockId);
      if (old) page.set(blockId, old);
      else page.delete(blockId);
    }
    const blocks = [...page.values()].map((b) => (b.parentId && !page.has(b.parentId) ? { ...b, parentId: null } : b));
    return await rewriteNote(ctx, doc, { title: doc.title, icon: doc.icon, blocks });
  });
  await send(await project(c, space, env), space, env);
  await env.inner.mutation(api.changes.markSeen, { documentIds: [documentId] });
  return { undoVersionId: made?.id ?? null, reverted: note.kinds.length };
};

/**
 * aiResearch.saveAsNote into a sealed place (a locked folder): the report's Markdown is made here, as the
 * server makes it (convex/lib/ai/research.ts), and saved as a sealed note through local mode's draft handler.
 */
const researchAsNote: Composer = async (call, env) => {
  const space = spaceOf(call);
  const researchId = String(call.args.researchId);
  const jobs = (await env.inner.query(api.aiResearch.list, { scope: space.scope })) as { id: string; status: string; question: string; sources: ReportSource[]; messageId: string; conversationId: string; noteId: string | null }[];
  const job = jobs.find((j) => j.id === researchId);
  if (!job) throw new ConvexError({ code: "not_found", message: "That research isn't there anymore." });
  if (job.status !== "done") throw new ConvexError({ code: "invalid_argument", message: "The report isn't finished yet." });
  if (job.noteId && env.spaces.document(job.noteId)) return { id: job.noteId };
  const chat = (await env.inner.query(api.aiChat.get, { conversationId: job.conversationId })) as { messages?: { id: string; text: string }[] } | null;
  const text = chat?.messages?.find((m) => m.id === job.messageId)?.text ?? "";
  if (!text.trim()) throw new ConvexError({ code: "not_found", message: "The report isn't there anymore." });
  const c = await capture(await replicaStoreFor(env, space), "mutation", getFunctionName(api.aiWriting.saveDraft), { scope: space.scope, kind: "note", title: reportTitle(job.question), markdown: reportNoteMarkdown(text, job.sources), ...(call.args.folderId ? { folderId: call.args.folderId } : {}) }, deviceOf(env));
  await send(await project(c, space, env), space, env);
  return c.result;
};

export const COMPOSERS = {
  undoChanges,
  researchAsNote,
  onboardingStep,
  newPerDay,
  captured,
  restoreSnapshot,
  copyVersion,
  linkNote,
  chatAsNote,
  copyTo,
  unavailable,
};
