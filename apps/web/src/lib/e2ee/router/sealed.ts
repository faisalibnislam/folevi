// Argument sealers (docs/E2EE_DESIGN.md §6.4 "sealed", WP7): a plaintext mutation the app calls becomes its
// e2ee variant with the content sealed on the device. A sealer returns null when the call isn't about sealed
// content after all (a Standard note in a space with locks): the router sends it to Convex as it is.
import { ConvexError } from "convex/values";
import { toBase64Url, type Bytes } from "@folevi/local-store/e2ee";
import { ulid, type WireBlock } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { Sealer, mentionIds } from "../seal";
import { capture, project, replicaStoreFor, send } from "../compose/capture";
import { content, files as e2eeFiles } from "./refs";
import { isEncryptedLevel, type E2eeSpace } from "./deps";
import type { ArgSealer, Call, RouterEnv } from "./types";

type SealResult = Awaited<ReturnType<ArgSealer>>;
type Sealing = (call: Call, env: RouterEnv) => Promise<SealResult | null>;

const TAG_COLORS = ["accent", "moss", "marigold", "plum", "coral", "muted"];
const b64 = (b: Bytes) => toBase64Url(new Uint8Array(b));
const one = (ref: SealResult["calls"][number]["ref"], args: Record<string, unknown>, result: (r: unknown) => unknown = (r) => r): SealResult => ({ calls: [{ ref, args }], result: (rs) => result(rs[0]) });
const done = (value: unknown): SealResult => ({ calls: [], result: () => value });

function requireSpace(call: Call): E2eeSpace {
  if (!call.res.space) throw new ConvexError({ code: "e2ee_not_set_up", message: "End-to-end encryption isn't set up for this space yet." });
  return call.res.space;
}

/** Plain text of inline nodes (a comment's preview). */
function plainText(nodes: unknown): string {
  if (!Array.isArray(nodes)) return "";
  return nodes.map((n) => (n && typeof n === "object" ? String((n as { text?: unknown; label?: unknown }).text ?? (n as { label?: unknown }).label ?? "") : "")).join("");
}

function commentMentions(body: unknown[]): string[] {
  return mentionIds({ text: body as WireBlock["text"], props: {} });
}

/** The preview a sealed comment may carry: only with notification previews on, never for a locked note (§7.7). */
function commentPreview(call: Call, env: RouterEnv, documentId: string, body: unknown[]): { title: string; excerpt: string } | undefined {
  if (!call.res.space?.switches.notificationPreviews || !isEncryptedLevel(call.res.space)) return undefined;
  const title = env.spaces.label(documentId)?.title || "Untitled";
  return { title: title.slice(0, 140), excerpt: plainText(body).slice(0, 140) };
}

// ---- organization -------------------------------------------------------------------------------------------

const createFolder: Sealing = async (call, env) => {
  const a = call.args as { scope: E2eeSpace["scope"]; name: string; parentFolderId?: string; id?: string };
  const space = requireSpace(call);
  const inLocked = typeof a.parentFolderId === "string" && env.spaces.ref("folder", a.parentFolderId) !== null;
  if (!isEncryptedLevel(space) && !inLocked) return null;
  const folderId = a.id ?? ulid();
  const sealed = await env.sealer.sealFolderName(space.scope, space.scopeId, folderId, a.name.trim().slice(0, 200));
  env.spaces.noteRef("folder", folderId, space.scope);
  // A folder's icon isn't sent: it would be readable (folders in an encrypted space have names only).
  return one(content.createFolder, { scope: a.scope ?? space.scope, folderId, parentFolderId: a.parentFolderId ?? null, sealedName: sealed.c }, (r) => r ?? { id: folderId });
};

const renameFolder: Sealing = async (call, env) => {
  const a = call.args as { folderId: string; name: string };
  if (!env.spaces.ref("folder", a.folderId)) return null;
  const space = requireSpace(call);
  const sealed = await env.sealer.sealFolderName(space.scope, space.scopeId, a.folderId, a.name.trim().slice(0, 200));
  return one(content.renameFolder, { folderId: a.folderId, sealedName: sealed.c }, () => null);
};

const createTag: Sealing = async (call, env) => {
  const a = call.args as { scope: E2eeSpace["scope"]; name: string; color?: string };
  const space = requireSpace(call);
  if (!isEncryptedLevel(space)) return null;
  const tagId = ulid();
  const sealed = await env.sealer.sealTagName(space.scope, space.scopeId, tagId, a.name.trim().slice(0, 60));
  const color = a.color && TAG_COLORS.includes(a.color) ? a.color : TAG_COLORS[Math.floor(Math.random() * 5)]!;
  return one(content.createTag, { scope: a.scope ?? space.scope, tagId, sealedName: sealed.c, nameMac: sealed.nameMac, color }, (r) => {
    const id = (r as { id?: string } | null)?.id ?? tagId;
    env.spaces.noteRef("tag", id, space.scope);
    return { id };
  });
};

const updateTag: Sealing = async (call, env) => {
  const a = call.args as { tagId: string; name?: string; color?: string };
  if (!env.spaces.ref("tag", a.tagId) || !isEncryptedLevel(call.res.space)) return null;
  const space = requireSpace(call);
  const args: Record<string, unknown> = { tagId: a.tagId };
  if (a.name !== undefined) {
    const sealed = await env.sealer.sealTagName(space.scope, space.scopeId, a.tagId, a.name.trim().slice(0, 60));
    args.sealedName = sealed.c;
    args.nameMac = sealed.nameMac;
  }
  if (a.color !== undefined) args.color = a.color;
  return one(content.updateTag, args, () => null);
};

const setDocumentTags: Sealing = async (call) => {
  if (!call.res.sealed) return null;
  return one(content.setDocumentTags, { documentId: call.args.documentId, tagIds: call.args.tagIds }, () => null);
};

// ---- comments -----------------------------------------------------------------------------------------------

const commentCreate: Sealing = async (call, env) => {
  if (!call.res.sealed) return null;
  const a = call.args as { documentId: string; blockId?: string; body: unknown[]; threadId?: string; commentId?: string };
  const threadId = a.threadId ?? ulid();
  const commentId = a.commentId ?? ulid();
  const sealed = await env.sealer.sealComment(a.documentId, commentId, a.body);
  const scope = env.spaces.document(a.documentId)?.scope ?? "";
  env.spaces.noteRef("thread", threadId, scope, a.documentId);
  env.spaces.noteRef("comment", commentId, scope, a.documentId);
  const preview = commentPreview(call, env, a.documentId, a.body);
  return one(
    content.createComment,
    { documentId: a.documentId, ...(a.blockId ? { blockId: a.blockId } : {}), threadId, commentId, sealedBody: sealed.c, mentions: commentMentions(a.body), ...(preview ? { preview } : {}) },
    (r) => r ?? { threadId, commentId },
  );
};

const commentReply: Sealing = async (call, env) => {
  const a = call.args as { threadId: string; body: unknown[]; commentId?: string };
  const documentId = env.spaces.ref("thread", a.threadId)?.documentId;
  if (!documentId || !call.res.sealed) return null;
  const commentId = a.commentId ?? ulid();
  const sealed = await env.sealer.sealComment(documentId, commentId, a.body);
  env.spaces.noteRef("comment", commentId, env.spaces.document(documentId)?.scope ?? "", documentId);
  const preview = commentPreview(call, env, documentId, a.body);
  return one(content.replyComment, { threadId: a.threadId, commentId, sealedBody: sealed.c, mentions: commentMentions(a.body), ...(preview ? { preview } : {}) }, (r) => r ?? { commentId });
};

const commentEdit: Sealing = async (call, env) => {
  const a = call.args as { commentId: string; body: unknown[] };
  const documentId = env.spaces.ref("comment", a.commentId)?.documentId;
  if (!documentId || !call.res.sealed) return null;
  const sealed = await env.sealer.sealComment(documentId, a.commentId, a.body);
  const preview = commentPreview(call, env, documentId, a.body);
  return one(content.editComment, { commentId: a.commentId, sealedBody: sealed.c, mentions: commentMentions(a.body), ...(preview ? { preview } : {}) }, () => null);
};

// ---- versions -----------------------------------------------------------------------------------------------

const nameVersion: Sealing = async (call, env) => {
  const a = call.args as { snapshotId: string; name: string };
  const documentId = env.spaces.ref("snapshot", a.snapshotId)?.documentId;
  if (!documentId || !call.res.sealed) return null;
  const name = a.name.trim();
  const sealedName = name ? (await env.sealer.sealVersionName(documentId, a.snapshotId, name.slice(0, 120))).c : null;
  return one(content.nameVersion, { snapshotId: a.snapshotId, sealedName }, () => null);
};

/** documents.importSnapshot (bringing history along): the version sealed as SealedVersionContent. */
const importSnapshot: Sealing = async (call, env) => {
  if (!call.res.sealed) return null;
  const a = call.args as { documentId: string; id: string; title: string; icon: string | null; style?: unknown; blocks: WireBlock[]; createdAt: number; name?: string };
  const title = await env.sealer.sealTitle(a.documentId, a.title);
  const appearanceBytes = await env.sealer.sealAppearance(a.documentId, { icon: a.icon, style: a.style });
  const blocks = await Promise.all(
    a.blocks.map(async (b) => {
      const s = await env.sealer.sealBlock(a.documentId, b);
      return { id: b.id, parentId: b.parentId, rank: b.rank, c: b64(s.sealed.c), k: s.sealed.k, mac: s.sealed.mac, ...(s.sealed.collapsed ? { collapsed: true as const } : {}) };
    }),
  );
  const sealedVersion = { e2ee: 1 as const, title: { c: b64(title.c), k: title.k, mac: title.mac }, appearance: { c: b64(appearanceBytes), k: title.k }, blocks };
  const sealedName = a.name ? (await env.sealer.sealVersionName(a.documentId, a.id, a.name)).c : undefined;
  return one(content.importVersion, { documentId: a.documentId, id: a.id, content: sealedVersion, createdAt: a.createdAt, ...(sealedName ? { sealedName } : {}) });
};

/** documents.deletePermanently: the title is checked here (the server can't read it) and sent as "sealed". */
const deletePermanently: Sealing = async (call, env) => {
  if (!call.res.sealed) return null;
  const a = call.args as { documentId: string; confirmTitle: string };
  const title = env.spaces.label(a.documentId)?.title ?? (await (async () => {
    const store = call.res.space ? env.replicas.hostedStore?.(call.res.space.scope) : null;
    return (await store?.get("documents", a.documentId))?.title;
  })());
  if (title !== undefined && a.confirmTitle.trim() !== (title.trim() || "Untitled")) throw new ConvexError({ code: "invalid_argument", message: "Type the document title to confirm." });
  return one(api.documents.deletePermanently, { documentId: a.documentId, confirmTitle: "sealed" });
};

// ---- files --------------------------------------------------------------------------------------------------

/** files.setPalette: the palette lives in the file's sealed meta, which is sealed again with it. */
const setPalette: Sealing = async (call, env) => {
  const a = call.args as { fileId: string; palette: unknown };
  const urls = (await env.inner.query(api.files.urls, { fileIds: [a.fileId], now: Date.now() })) as Record<string, { sealed?: { key: Bytes; meta: Bytes }; documentId?: string } | undefined>;
  const entry = urls[a.fileId];
  if (!entry?.sealed) return null;
  const documentId = entry.documentId ?? env.spaces.ref("file", a.fileId)?.documentId ?? call.res.documentId;
  if (!documentId) return null;
  const raw = await env.sealer.openFileKey(documentId, a.fileId, entry.sealed.key);
  try {
    const meta = (await Sealer.openFileMeta(raw, documentId, a.fileId, entry.sealed.meta)) as Record<string, unknown>;
    const sealedMeta = await Sealer.sealFileMeta(raw, documentId, a.fileId, { ...meta, palette: a.palette });
    return { calls: [{ ref: e2eeFiles.updateMeta as never, args: { fileId: a.fileId, meta: sealedMeta } }], result: () => null };
  } finally {
    raw.fill(0);
  }
};

// ---- records: collections, found text, study (the local handler's writes, as records) --------------------------

/**
 * collections.* writes, fileText.save and study.review for sealed notes: the ported local handler runs over the
 * replica (a collection is a LocalCollection, a row's values its note's meta, found text and schedules their own
 * rows), and what it wrote goes out as sealed records, row metas and, for a new row, a sealed note.
 */
const records: Sealing = async (call, env) => {
  const space = requireSpace(call);
  if (!call.res.sealed && !isEncryptedLevel(space)) return null;
  const c = await capture(replicaStoreFor(env, space), "mutation", call.name, call.args, env.engine()?.deviceId ?? env.session.deviceId());
  await send(await project(c, space, env), space, env);
  return done(c.result);
};

export function sealedRoute(fn: Sealing): ArgSealer {
  return async (call, env) => {
    const r = await fn(call, env);
    if (r) return r;
    // Not sealed content: the original mutation, as it is.
    const [mod, name] = call.name.split(":") as [string, string];
    const ref = (api as unknown as Record<string, Record<string, unknown>>)[mod]?.[name];
    if (!ref) throw new Error(`No plaintext function ${call.name}.`);
    return { calls: [{ ref: ref as never, args: call.args }], result: (rs) => rs[0] };
  };
}

export const SEALERS = {
  createFolder: sealedRoute(createFolder),
  renameFolder: sealedRoute(renameFolder),
  createTag: sealedRoute(createTag),
  updateTag: sealedRoute(updateTag),
  setDocumentTags: sealedRoute(setDocumentTags),
  commentCreate: sealedRoute(commentCreate),
  commentReply: sealedRoute(commentReply),
  commentEdit: sealedRoute(commentEdit),
  nameVersion: sealedRoute(nameVersion),
  importSnapshot: sealedRoute(importSnapshot),
  deletePermanently: sealedRoute(deletePermanently),
  setPalette: sealedRoute(setPalette),
  records: sealedRoute(records),
};

