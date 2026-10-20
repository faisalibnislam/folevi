// What the local Foli AI handlers share: the gates the server's `ai.begin` applies that still mean something
// on a device (Foli AI turned off in settings), a note as the model reads it (Markdown with its synced content
// and link labels, as convex/ai.ts noteText), the person's saved preferences for a request (memory), and
// reading the library from an action.
import { blocksToMarkdown } from "@folevi/editor-schema";
import { memoryPrompt, type MemoryKind } from "@folevi/ai-prompts/memory";
import { fail } from "../errors";
import type { LocalActionCtx, LocalMutationCtx, LocalReader } from "../registry";
import type { LocalDocument } from "../store";
import { getProfile, liveBlocks, ReaderLabels, toWireBlock, withSyncedContent, type LocalProfile } from "../functions/shared";

/** The most of a note a request reads (convex/ai.ts FOCUS_CHARS). */
export const FOCUS_CHARS = 30_000;

export const AI_OFF = "Foli AI is turned off in your settings.";

/** The library's profile with Foli AI on, or the server's refusal. */
export async function requireAiProfile(db: LocalReader): Promise<LocalProfile> {
  const p = await getProfile(db);
  if (!p) fail("profile_missing", "Set up this library first.");
  if (p.aiEnabled === false) fail("forbidden", AI_OFF);
  return p;
}

/** The person's AI settings with the defaults filled in (convex/lib/ai/prefs.ts aiPrefsOf). */
export function prefsOf(p: LocalProfile): { history: boolean; memory: boolean; attachments: boolean; webResearch: boolean } {
  const prefs: Partial<LocalProfile["aiPrefs"]> = p.aiPrefs ?? {};
  return { history: prefs.history !== false, memory: prefs.memory !== false, attachments: prefs.attachments !== false, webResearch: prefs.webResearch !== false };
}

/** Every AI setting with the defaults filled in, as aiChat.capabilities reports them. */
export function prefsAll(p: LocalProfile): LocalProfile["aiPrefs"] {
  const defaults: LocalProfile["aiPrefs"] = { history: true, memory: true, suggestions: true, attachments: true, webResearch: true, digests: false, readImages: false, deviceText: true };
  return { ...defaults, ...((p.aiPrefs ?? {}) as Partial<LocalProfile["aiPrefs"]>) };
}

/** A note that's there (not deleted for good), or the server's not_found. */
export async function readableNote(db: LocalReader, id: string): Promise<LocalDocument> {
  const doc = await db.get("documents", id);
  if (!doc || doc.pending) fail("not_found", "Document not found.");
  return doc;
}

/** A note as the model reads it: Markdown with its synced content, link labels resolved, at most `max`. */
export async function noteMarkdown(db: LocalReader, doc: LocalDocument, max = FOCUS_CHARS, opts: { title?: boolean } = {}): Promise<string> {
  const own = (await liveBlocks(db, doc.id)).map(toWireBlock);
  const blocks = await new ReaderLabels(db).blocks(await withSyncedContent(db, doc, own));
  return blocksToMarkdown(blocks, opts.title === false ? {} : { title: doc.title || "Untitled" }).slice(0, max);
}

/** convex/ai.ts noteText: `{ id, title, text }`. */
export async function noteText(db: LocalReader, id: string, max = FOCUS_CHARS): Promise<{ id: string; title: string; text: string }> {
  const doc = await readableNote(db, id);
  return { id: doc.id, title: doc.title || "Untitled", text: await noteMarkdown(db, doc, max) };
}

/** Saved preferences (aiMemory) as kept in the library: synced, newest first by `updatedAt`. */
export interface LocalMemoryEntry {
  id: string;
  kind: MemoryKind;
  text: string;
  source: "settings" | "chat";
  createdAt: number;
  updatedAt: number;
}

export const MEMORY_KEY = "aiMemory";

export async function memoryEntries(db: LocalReader): Promise<LocalMemoryEntry[]> {
  const rows = ((await db.get("meta", MEMORY_KEY)) as LocalMemoryEntry[] | undefined) ?? [];
  return [...rows].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** The preferences block for a request (aiMemory.forHold): null while memory or Foli AI is off. */
export async function memoryFor(db: LocalReader): Promise<string | null> {
  const p = await getProfile(db);
  if (!p || p.aiEnabled === false || !prefsOf(p).memory) return null;
  return memoryPrompt(await memoryEntries(db));
}

/**
 * Reads the library from an action: a mutation of its own that writes nothing (actions have no db, as on the
 * server, where they read through internal queries).
 */
export function read<T>(ctx: LocalActionCtx, fn: (db: LocalReader, m: LocalMutationCtx) => Promise<T>): Promise<T> {
  return ctx.mutate((m) => fn(m.db, m));
}
