// End-to-end encryption and Foli AI (docs/E2EE_DESIGN.md §7.2). WP5.
//
// In an encrypted space the server can't read the notes a request needs, so the device gathers them (the
// note as Markdown, search candidates from its replica, memories) and sends them with the request as
// `provided`. The server's rules, enforced here for every AI entry point:
//
// - the space's `foliAi` switch must not be "off" (Fully encrypted is always off), and "ask" needs the
//   person's consent for this request (`consent: "asked"`);
// - no provided note, and no note the request names, may be locked ("Always fully encrypted");
// - every provided note id must be a note the caller can read, in the provided scope;
// - with `provided`, nothing is read from the server's own copy of that scope (no noteText, gather or
//   hybridSearch), nothing about the request is stored after the answer (no conversations, messages, runs
//   or research rows; stream rows are deleted when it finishes), and nothing from it goes into scheduler
//   arguments;
// - credits are metered exactly as for any other request (ai.begin / ai.settle).
//
// Standard spaces pay one indexed read per scope (`spaceE2ee`) and nothing else changes for them.
import { v, type Infer } from "convex/values";
import type { Doc } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { accessAtLeast, documentAccess, getDocumentByPublicId, resolveScope } from "../auth";
import { fail } from "../errors";
import { inScope, sameScope, scopeOfRow, vScopeArg, type Scope } from "../scope";
import { failE2ee, isLocked, isSealed, spaceE2ee, switchesOf } from "./state";

// ---------------------------------------------------------------- limits

export const PROVIDED_LIMITS = {
  /** Notes in one request: the 12 search candidates, plus the notes the person attached. */
  notes: 24,
  /** Markdown of one note (FOCUS_CHARS is 24,000; a little room for found text in PDFs). */
  noteChars: 40_000,
  /** Markdown of every note together. */
  totalChars: 160_000,
  titleChars: 300,
  folderChars: 500,
  memories: 50,
  memoryChars: 500,
  /** Files (readImage, transcribe, chat attachments) together. */
  fileBytes: 8 * 1024 * 1024,
  files: 10,
} as const;

// ---------------------------------------------------------------- validators

export const vProvidedNote = v.object({
  id: v.string(),
  title: v.string(),
  markdown: v.string(),
  folder: v.optional(v.string()),
});
export type ProvidedNote = Infer<typeof vProvidedNote>;

export const vProvidedFile = v.object({ name: v.string(), mime: v.string(), bytes: v.bytes() });

/** What the device sends with an AI request about an encrypted space (§7.2). */
export const vProvidedContext = v.object({
  scope: vScopeArg,
  notes: v.array(vProvidedNote),
  memories: v.optional(v.array(v.string())),
  files: v.optional(v.array(vProvidedFile)),
  consent: v.union(v.literal("asked"), v.literal("auto")),
  ephemeral: v.literal(true),
});
export type ProvidedContext = Infer<typeof vProvidedContext>;

/**
 * The part of `provided` the checks need (ids, no text), so `ai.begin` (a mutation) never receives note
 * text in its arguments.
 */
export const vProvidedMeta = v.object({
  scope: vScopeArg,
  noteIds: v.array(v.string()),
  consent: v.union(v.literal("asked"), v.literal("auto")),
});
export type ProvidedMeta = Infer<typeof vProvidedMeta>;

/** The ids-only summary of a provided context, after its sizes are checked (actions call this first). */
export function providedMeta(p: ProvidedContext): ProvidedMeta {
  checkProvidedSizes(p);
  return { scope: p.scope, noteIds: p.notes.map((n) => n.id), consent: p.consent };
}

/** Refuses a provided context over the limits (checked in the action, before anything is held or sent). */
export function checkProvidedSizes(p: ProvidedContext): void {
  if (p.ephemeral !== true) fail("invalid_argument", "Provided context must be ephemeral.");
  if (p.notes.length > PROVIDED_LIMITS.notes) fail("invalid_argument", `Send at most ${PROVIDED_LIMITS.notes} notes with one request.`);
  let total = 0;
  const ids = new Set<string>();
  for (const n of p.notes) {
    if (ids.has(n.id)) fail("invalid_argument", "A note was sent twice.");
    ids.add(n.id);
    if (n.markdown.length > PROVIDED_LIMITS.noteChars) fail("invalid_argument", "A note sent with the request is too long.");
    if (n.title.length > PROVIDED_LIMITS.titleChars || (n.folder?.length ?? 0) > PROVIDED_LIMITS.folderChars) fail("invalid_argument", "A note's title or folder is too long.");
    total += n.markdown.length;
  }
  if (total > PROVIDED_LIMITS.totalChars) fail("invalid_argument", "The notes sent with the request are too long together.");
  const memories = p.memories ?? [];
  if (memories.length > PROVIDED_LIMITS.memories || memories.some((m) => m.length > PROVIDED_LIMITS.memoryChars)) fail("invalid_argument", "Too many or too long preferences.");
  const files = p.files ?? [];
  if (files.length > PROVIDED_LIMITS.files) fail("invalid_argument", `Send at most ${PROVIDED_LIMITS.files} files with one request.`);
  if (files.reduce((n, f) => n + f.bytes.byteLength, 0) > PROVIDED_LIMITS.fileBytes) fail("invalid_argument", "The files sent with the request are too large (8 MB together).");
}

// ---------------------------------------------------------------- the gate

export interface AiGate {
  /** The request concerns encrypted content: nothing about it is kept after the answer. */
  sealed: boolean;
}

/**
 * The E2EE checks of one AI request, run in `ai.begin` before any credit is held: every scope it runs in
 * or reads from allows Foli AI, no note it names is locked, and a provided context is valid. Standard
 * scopes cost one indexed read each.
 */
export async function aiGate(ctx: QueryCtx, profile: Doc<"profiles">, scopes: Scope[], docs: Doc<"documents">[], provided?: ProvidedMeta): Promise<AiGate> {
  let sealed = false;
  const seen: Scope[] = [];
  const check = async (s: Scope) => {
    if (seen.some((x) => sameScope(x, s))) return;
    seen.push(s);
    const space = await spaceE2ee(ctx, s);
    if (!space) return;
    const sw = switchesOf(space);
    if (sw.foliAi === "off") failE2ee("e2ee_switch_off", "Foli AI is turned off for this space in Settings > Privacy.", { switch: "foliAi" });
    if (space.level !== "standard") sealed = true;
    if (provided && sw.foliAi === "ask" && provided.consent !== "asked") failE2ee("e2ee_switch_off", "Foli AI asks before it reads notes in this space.", { switch: "foliAi" });
  };
  for (const s of scopes) await check(s);
  for (const d of docs) {
    if (await isLocked(ctx, d)) failE2ee("e2ee_locked");
    if (isSealed(d)) {
      sealed = true;
      await check(scopeOfRow(d));
    }
  }
  if (provided) {
    sealed = true;
    const { scope } = await resolveScope(ctx, profile, provided.scope);
    await check(scope);
    const space = await spaceE2ee(ctx, scope);
    if (provided.consent === "auto" && space && switchesOf(space).foliAi !== "auto") failE2ee("e2ee_switch_off", "Foli AI asks before it reads notes in this space.", { switch: "foliAi" });
    for (const id of provided.noteIds) {
      const doc = await getDocumentByPublicId(ctx, id);
      if (!doc || doc.inTrash || doc.deletedAt !== undefined || !inScope(doc, scope)) fail("not_found", "A note sent with the request isn't there anymore.");
      if (!accessAtLeast(await documentAccess(ctx, profile, doc), "read")) fail("not_found", "A note sent with the request isn't there anymore.");
      if (await isLocked(ctx, doc)) failE2ee("e2ee_locked");
    }
  }
  return { sealed };
}

/**
 * Whether the server may read a note for a request that came without `provided`: Standard notes yes;
 * sealed notes never (their text comes from the device). Locked notes are refused by the gate before.
 */
export function serverMayRead(doc: Doc<"documents">): boolean {
  return !isSealed(doc);
}

/** The person's preferences sent with the request, as the memory entries `memoryPrompt` takes. */
export function providedMemories(p: ProvidedContext | undefined): { kind: "instruction"; text: string }[] | null {
  if (!p?.memories?.length) return null;
  return p.memories.map((text) => ({ kind: "instruction" as const, text: text.slice(0, PROVIDED_LIMITS.memoryChars) }));
}

/** Provided notes as the AI prompts take them (title, text), in the order sent. */
export function providedSources(p: ProvidedContext): { id: string; title: string; text: string }[] {
  return p.notes.map((n) => ({ id: n.id, title: n.title.trim() || "Untitled", text: n.markdown }));
}

/** The provided note with this id, if it was sent (a request about one note). */
export function providedNote(p: ProvidedContext | undefined, id: string | undefined): { id: string; title: string; text: string } | null {
  if (!p || !id) return null;
  const n = p.notes.find((x) => x.id === id);
  return n ? { id: n.id, title: n.title.trim() || "Untitled", text: n.markdown } : null;
}

/**
 * A request about one note in an encrypted space that came without its text (an old client): refused,
 * so it never runs on less than the person asked about.
 */
export function requireProvidedFor(doc: Doc<"documents">, p: ProvidedContext | undefined): void {
  if (isSealed(doc) && !p?.notes.some((n) => n.id === doc.publicId)) failE2ee("e2ee_required", "This note is end-to-end encrypted. Update Folevi to use Foli AI with it.");
}

/**
 * Refuses a server-side write that makes notes from AI output (save a draft, apply a plan) in an encrypted
 * space: the device composes it there (it seals the note), so the router never sends it (`e2ee_device_only`).
 */
export async function requireServerCompose(ctx: MutationCtx, scope: Scope): Promise<void> {
  const space = await spaceE2ee(ctx, scope);
  if (space && space.level !== "standard") failE2ee("e2ee_device_only");
}
