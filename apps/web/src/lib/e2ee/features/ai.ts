"use client";
// Foli AI per request in encrypted spaces (docs/E2EE_DESIGN.md §7.2, WP8): `aiRoute` is the router's "ai"
// route (WP7's E2EE_ROUTES). For a call about an encrypted space or a locked note:
//
// 1. Standard space, note not locked: passed through unchanged.
// 2. Foli AI off for the space, or the note locked: refused (e2ee_switch_off / e2ee_locked), nothing sent.
// 3. The notes the server would have read are gathered here: the note asked about as Markdown (with its found
//    text), or for questions about the space the replica's search hits for the question (12 notes at most,
//    60,000 characters together), or for Catch me up the notes edited in the last 7 days. Locked notes are
//    never among them.
// 4. "Ask me each time": the consent dialog (§10.9) lists each note and its length; "Send" or "Don't send".
//    "Don't ask again for these notes today" is kept in memory only.
// 5. The call goes out with `provided: { scope, notes, consent, ephemeral: true }` (files: an image or a
//    recording the person picked, decrypted here). Nothing about it is stored on the server afterwards.
//
// The stored chat and research functions don't take `provided` (their results are rows): in encrypted spaces
// the device uses aiChat.sendSealed / aiResearch.startSealed (`sealedChat` below keeps the chat as an aiChat
// record), and the old ones are refused here with the reason.
import { useSyncExternalStore } from "react";
import { ConvexError } from "convex/values";
import { getFunctionName, type FunctionReference } from "convex/server";
import { api } from "@/lib/convex/api";
import { noteMarkdown } from "@/lib/local/ai/common";
import type { LocalDocument, LocalFileText } from "@/lib/local/store";
import type { LocalReader } from "@/lib/local/registry";
import { isEncryptedLevel, type E2eeSpace } from "../router/deps";
import type { AiRouter, Call, RouterEnv } from "../router/types";
import { lockIndexFor } from "./locks";

// ---- consent (§10.9) -------------------------------------------------------------------------------------

/** §12 WP8 (WP9's ConsentPopover draws it). */
export interface ConsentRequest {
  notes: { id: string; title: string; chars: number }[];
}

interface Asked {
  request: ConsentRequest;
  resolve(ok: boolean): void;
}

const queue: Asked[] = [];
const consentListeners = new Set<() => void>();
/** "Don't ask again for this note today": note id → the day it was said (memory only, this tab). */
const remembered = new Map<string, string>();
const today = () => new Date().toISOString().slice(0, 10);

function emitConsent() {
  for (const l of [...consentListeners]) l();
}

/** Asks the person before notes are sent (resolves false on "Don't send"). Notes allowed today aren't asked again. */
export function askConsent(request: ConsentRequest): Promise<boolean> {
  if (request.notes.length && request.notes.every((n) => remembered.get(n.id) === today())) return Promise.resolve(true);
  return new Promise((resolve) => {
    queue.push({ request, resolve });
    emitConsent();
  });
}

/** The request waiting for an answer now (outside React). */
export function pendingConsent(): ConsentRequest | null {
  return queue[0]?.request ?? null;
}

/** Answers the request waiting now: "Send" (true) or "Don't send"; `rememberForNote` skips asking again today. */
export function answerConsent(ok: boolean, rememberForNote?: boolean): void {
  const head = queue.shift();
  if (!head) return;
  if (ok && rememberForNote) for (const n of head.request.notes) remembered.set(n.id, today());
  head.resolve(ok);
  emitConsent();
}

/** §12 WP8: the request waiting for an answer, and the answer. */
export function useAiConsent(): { pending: ConsentRequest | null; answer(ok: boolean, rememberForNote?: boolean): void } {
  const pending = useSyncExternalStore(
    (cb) => {
      consentListeners.add(cb);
      return () => {
        consentListeners.delete(cb);
      };
    },
    pendingConsent,
    () => null,
  );
  return { pending, answer: answerConsent };
}

/** Sign-out: nothing remembered, nothing waiting. */
export function resetConsent(): void {
  remembered.clear();
  for (const q of queue.splice(0)) q.resolve(false);
  emitConsent();
}

// ---- gathering -----------------------------------------------------------------------------------------

/** server limits (convex/lib/e2ee/ai.ts PROVIDED_LIMITS), with the design's budget for questions. */
const NOTE_CHARS = 39_000;
const CANDIDATE_CHARS = 6_000;
const QUESTION_BUDGET = 60_000;
const CANDIDATES = 12;
const BRIEF_NOTES = 8;
const BRIEF_CHARS = 2_500;
const FILE_BYTES = 8 * 1024 * 1024;

export interface ProvidedNote {
  id: string;
  title: string;
  markdown: string;
  folder?: string;
}

export interface Provided {
  scope: E2eeSpace["scope"];
  notes: ProvidedNote[];
  memories?: string[];
  files?: { name: string; mime: string; bytes: ArrayBuffer }[];
  consent: "asked" | "auto";
  ephemeral: true;
}

const refuse = (code: string, message: string, data: Record<string, unknown> = {}) => new ConvexError({ code, message, ...data });

export const COPY = {
  off: "Foli AI is off for this space because it's end-to-end encrypted. Turn it on in Settings > Privacy.",
  full: "Foli AI can't read fully encrypted notes.",
  locked: "This note is always fully encrypted, so Foli AI, apps and server search can't use it.",
  declined: "Nothing was sent to Foli AI.",
  opening: "This encrypted space is still opening on this device. Try again in a moment.",
  chat: "Ask Foli AI about this space from the chat on this device: the chat here keeps nothing on our servers.",
};

/** A note (and its found text) as Markdown, the way convex/ai.ts noteText reads it. */
export async function noteForAi(store: LocalReader, doc: LocalDocument, max = NOTE_CHARS): Promise<ProvidedNote> {
  let markdown = await noteMarkdown(store, doc, max);
  const found = ((await store.list("fileTexts", doc.id)) as LocalFileText[]).map((t) => t.text).filter(Boolean);
  if (found.length && markdown.length < max) markdown = `${markdown}\n\n${found.join("\n\n")}`.slice(0, max);
  return { id: doc.id, title: (doc.title || "Untitled").slice(0, 300), markdown };
}

interface Ctx {
  env: RouterEnv;
  space: E2eeSpace;
  store: LocalReader;
}

async function usable(c: Ctx, doc: LocalDocument | undefined): Promise<boolean> {
  if (!doc || doc.inTrash || doc.deletedAt !== null || doc.pending) return false;
  return !(await lockIndexFor(c.env.inner, () => c.env.spaces.get(c.space.scope) ?? c.space).isLocked(c.store, doc.id));
}

/** The replica's search hits for a question, best first, then the asked note first of all. */
export async function notesForQuestion(c: Ctx, question: string, o: { documentId?: string; folderId?: string; onlyNote?: boolean } = {}): Promise<ProvidedNote[]> {
  const out: ProvidedNote[] = [];
  let used = 0;
  if (o.documentId) {
    const doc = (await c.store.get("documents", o.documentId)) as LocalDocument | undefined;
    if (doc && (await usable(c, doc))) {
      const n = await noteForAi(c.store, doc, Math.min(NOTE_CHARS, QUESTION_BUDGET / 2));
      out.push(n);
      used += n.markdown.length;
    }
  }
  if (o.onlyNote) return out;
  let ids: string[] = [];
  const replica = c.env.replicas.get(c.space.scope);
  if (replica && question.trim()) {
    try {
      const found = (await replica.client.query(api.search.documents, { scope: { kind: "personal" }, query: question.trim().slice(0, 200), limit: CANDIDATES, ...(o.folderId ? { folderId: o.folderId } : {}) } as never)) as { id: string }[];
      ids = found.map((f) => f.id);
    } catch {
      ids = [];
    }
  }
  for (const id of ids) {
    if (out.length >= CANDIDATES + (o.documentId ? 1 : 0) || used >= QUESTION_BUDGET) break;
    if (out.some((n) => n.id === id)) continue;
    const doc = (await c.store.get("documents", id)) as LocalDocument | undefined;
    if (!doc || !(await usable(c, doc))) continue;
    const n = await noteForAi(c.store, doc, Math.min(CANDIDATE_CHARS, QUESTION_BUDGET - used));
    out.push(n);
    used += n.markdown.length;
  }
  return out;
}

/** Catch me up: notes edited in the last 7 days (their search text, which holds their open to-dos too). */
export async function notesForBrief(c: Ctx, now = Date.now()): Promise<ProvidedNote[]> {
  const docs = ((await c.store.list("documents")) as LocalDocument[]).filter((d) => d.updatedAt >= now - 7 * 86_400_000 && d.kind !== "template").sort((a, b) => b.updatedAt - a.updatedAt);
  const out: ProvidedNote[] = [];
  for (const d of docs) {
    if (out.length >= BRIEF_NOTES) break;
    if (!(await usable(c, d))) continue;
    out.push({ id: d.id, title: (d.title || "Untitled").slice(0, 300), markdown: d.searchText.slice(0, BRIEF_CHARS) });
  }
  return out;
}

// ---- the route -----------------------------------------------------------------------------------------

/** Every function of these modules takes `provided` (their arguments carry the block they work on). */
const PROVIDED_MODULES = new Set(["chartAi", "mindmapAi", "wireframeAi", "flowchartAi", "tableAi", "stickiesAi"]);
/** Functions about one note: its text goes along. */
const ONE_NOTE = new Set(["ai:write", "aiTodos:find", "aiStudy:translateNote", "chartAi:fromWords", "flowchartAi:fromText", "mindmapAi:generate"]);
const PROVIDED_FUNCTIONS = new Set(["ai:ask", "ai:write", "ai:flowchart", "ai:brief", "aiTodos:find", "aiStudy:translateNote", "aiAttachments:transcribe", "fileText:readImage", "aiChat:sendSealed", "aiResearch:startSealed"]);
/** Stored chats and research: rows on the server, so not for encrypted spaces (the sealed variants are). */
const STORED = new Set(["aiChat:send", "aiChat:regenerate", "aiChat:edit", "aiChat:create", "aiResearch:start", "aiResearch:regenerate"]);
/** Functions whose files the device decrypts and sends. */
const WITH_FILE = new Set(["fileText:readImage", "aiAttachments:transcribe"]);

const takesProvided = (name: string) => PROVIDED_FUNCTIONS.has(name) || PROVIDED_MODULES.has(name.slice(0, name.indexOf(":")));

function refOf(name: string): FunctionReference<"action" | "mutation"> {
  const [mod, fn] = name.split(":") as [string, string];
  const ref = (api as unknown as Record<string, Record<string, FunctionReference<"action" | "mutation">>>)[mod]?.[fn];
  if (!ref) throw new Error(`Unknown function ${name}.`);
  return ref;
}

async function fileFor(env: RouterEnv, documentId: string, fileId: string): Promise<{ name: string; mime: string; bytes: ArrayBuffer }> {
  const urls = (await env.inner.query(api.files.urls, { fileIds: [fileId], now: Date.now() })) as Record<string, { url: string; sealed?: { key: ArrayBuffer; meta: ArrayBuffer; k: number; plainSize: number } } | undefined>;
  const entry = urls[fileId];
  if (!entry?.sealed) throw refuse("not_found", "File not found.");
  if (entry.sealed.plainSize > FILE_BYTES) throw refuse("invalid_argument", "The file is too large to send to Foli AI (8 MB at most).");
  const { bytes, meta } = await env.files.bytes(fileId, documentId, entry.url, entry.sealed);
  return { name: meta.name, mime: meta.mime, bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer };
}

/** Builds the provided context for a call (or null when the call is passed through as it is). */
export async function providedFor(call: Call, env: RouterEnv, space: E2eeSpace): Promise<{ provided: Provided; asked: ConsentRequest } | null> {
  const store = env.replicas.hostedStore?.(space.scope) ?? null;
  if (!store) throw refuse("e2ee_unavailable", COPY.opening, { feature: "ai" });
  const c: Ctx = { env, space, store };
  const a = call.args as { documentId?: unknown; question?: unknown; text?: unknown; range?: unknown; folderId?: unknown; fileId?: unknown };
  const documentId = typeof a.documentId === "string" ? a.documentId : undefined;
  if (documentId) {
    const doc = (await store.get("documents", documentId)) as LocalDocument | undefined;
    if (doc && (await lockIndexFor(env.inner, () => env.spaces.get(space.scope) ?? space).isLocked(store, documentId))) throw refuse("e2ee_locked", COPY.locked);
  }
  let notes: ProvidedNote[] = [];
  if (call.name === "ai:ask") notes = await notesForQuestion(c, String(a.question ?? ""), { documentId, folderId: typeof a.folderId === "string" ? a.folderId : undefined, onlyNote: a.range === "note" });
  else if (call.name === "aiChat:sendSealed" || call.name === "aiResearch:startSealed") notes = await notesForQuestion(c, String(a.text ?? ""), {});
  else if (call.name === "ai:brief") notes = await notesForBrief(c);
  else if (ONE_NOTE.has(call.name) && documentId) {
    const doc = (await store.get("documents", documentId)) as LocalDocument | undefined;
    if (doc) notes = [await noteForAi(store, doc)];
  }
  const files = WITH_FILE.has(call.name) && documentId && typeof a.fileId === "string" ? [await fileFor(env, documentId, a.fileId)] : undefined;
  const asked: ConsentRequest = {
    notes: notes.length
      ? notes.map((n) => ({ id: n.id, title: n.title, chars: n.markdown.length }))
      : documentId
        ? [{ id: documentId, title: env.spaces.label(documentId)?.title || "Untitled", chars: JSON.stringify(call.args).length + (files?.[0]?.bytes.byteLength ?? 0) }]
        : [],
  };
  const consent = space.switches.foliAi === "auto" ? "auto" : "asked";
  return { provided: { scope: space.scope, notes, ...(files ? { files } : {}), consent, ephemeral: true }, asked };
}

/**
 * §12 WP8: the router's "ai" route. Queries pass (their results carry nothing sealed the server made);
 * mutations and actions about encrypted content follow the rules above.
 */
export const aiRoute: AiRouter = async (call, env, forward) => {
  if (call.kind === "query") return await forward();
  const space = call.res.space;
  const encrypted = !!space && isEncryptedLevel(space);
  if (!encrypted) {
    // A Standard space: only a locked note is off limits.
    if (call.res.sealed) throw refuse("e2ee_locked", COPY.locked);
    return await forward();
  }
  if (space.switches.foliAi === "off") throw refuse("e2ee_switch_off", space.level === "full" ? COPY.full : COPY.off, { switch: "foliAi" });
  if (STORED.has(call.name)) throw refuse("e2ee_unavailable", COPY.chat, { feature: "chat" });
  if (!takesProvided(call.name)) return await forward();
  const built = await providedFor(call, env, space);
  if (!built) return await forward();
  if (space.switches.foliAi === "ask" && built.asked.notes.length && !(await askConsent(built.asked))) throw refuse("e2ee_consent_declined", COPY.declined);
  const args = { ...call.args, provided: built.provided };
  const ref = refOf(call.name);
  const result = call.kind === "action" ? await env.inner.action(ref as FunctionReference<"action">, args) : await env.inner.mutation(ref as FunctionReference<"mutation">, args);
  // readImage hands back the text found unsaved: the device keeps it as the note's sealed found-text record.
  if (call.name === "fileText:readImage") {
    const r = result as { status?: string; text?: string } | null;
    const a = call.args as { documentId: string; blockId: string; fileId: string };
    if (r?.status === "read" && typeof r.text === "string") {
      await env.call("mutation", getFunctionName(api.fileText.save), { documentId: a.documentId, blockId: a.blockId, fileId: a.fileId, source: "image", text: r.text }).catch(() => undefined);
    }
  }
  return result;
};

// ---- chats on the device (aiChat records) -------------------------------------------------------------

export interface SealedTurn {
  role: "user" | "assistant";
  text: string;
  at: number;
  citations?: { n: number; noteId: string; title: string }[];
}

export interface SealedChat {
  id: string;
  title: string;
  turns: SealedTurn[];
  updatedAt: number;
}

/**
 * One chat turn in an encrypted space (§7.2): the device gathers the notes, asks consent, calls
 * aiChat.sendSealed and keeps the conversation as an `aiChat` record (sealed with the space key, this person
 * only). Returns the chat with the answer added.
 */
export async function sealedChat(env: RouterEnv, space: E2eeSpace, chat: SealedChat | null, text: string, o: { web?: boolean; streamId?: string; baseRev?: number } = {}): Promise<{ chat: SealedChat; rev: number; answer: unknown }> {
  if (space.switches.foliAi === "off") throw refuse("e2ee_switch_off", COPY.off, { switch: "foliAi" });
  const store = env.replicas.hostedStore?.(space.scope) ?? null;
  if (!store) throw refuse("e2ee_unavailable", COPY.opening, { feature: "ai" });
  const notes = await notesForQuestion({ env, space, store }, text);
  if (space.switches.foliAi === "ask" && notes.length && !(await askConsent({ notes: notes.map((n) => ({ id: n.id, title: n.title, chars: n.markdown.length })) }))) throw refuse("e2ee_consent_declined", COPY.declined);
  const history = (chat?.turns ?? []).slice(-6).map((t) => ({ role: t.role, text: t.text.slice(0, 3000) }));
  const answer = (await env.inner.action(api.aiChat.sendSealed, {
    scope: space.scope,
    text,
    history,
    provided: { scope: space.scope, notes, consent: space.switches.foliAi === "auto" ? "auto" : "asked", ephemeral: true },
    ...(o.web ? { web: true } : {}),
    ...(o.streamId ? { streamId: o.streamId } : {}),
  } as never)) as { status: string; text: string; citations?: SealedTurn["citations"] };
  const now = Date.now();
  const next: SealedChat = {
    id: chat?.id ?? `chat-${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    title: chat?.title ?? text.slice(0, 80),
    turns: [...(chat?.turns ?? []), { role: "user", text, at: now }, ...(answer.status === "done" ? [{ role: "assistant" as const, text: answer.text, at: Date.now(), citations: answer.citations ?? [] }] : [])],
    updatedAt: Date.now(),
  };
  const sealed = await env.sealer.sealRecordValue({ scope: space.scope }, space.scopeId, "aiChat", next.id, next);
  const r = (await env.inner.mutation(api.e2ee.content.putRecord, { scope: space.scope, kind: "aiChat", recordId: next.id, sealed: sealed.sealed, keyVersion: sealed.keyVersion, baseRev: o.baseRev ?? 0 })) as { rev: number };
  return { chat: next, rev: r.rev, answer };
}
