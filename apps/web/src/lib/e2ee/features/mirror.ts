// Readable copies for the switches that ask for them (docs/E2EE_DESIGN.md §7.2 to §7.4, WP8). With Search
// everywhere, Background Foli AI or Apps and integrations on in a space at "Encrypted, with the features you
// pick", this device keeps one `e2eeMirrors` row per sealed, unlocked note for each purpose:
//
//   search: title, and the note's search text plus its found text (what the server's index holds for Standard);
//   ai:     title, and the note as Markdown;
//   apps:   title, Markdown, folder path, tag names and to-dos (the MCP noteDetail shape).
//
// Only changed copies are uploaded (e2ee.mirrors.hashes, paged). Notes in Trash, deleted or locked lose their
// copy. With the switch off nothing is uploaded; the server purges what was there (spaces.setSwitches).
import { canonicalJson, type InlineNode } from "@folevi/editor-schema";
import { sha256 } from "@folevi/local-store/e2ee";
import { api } from "@/lib/convex/api";
import { noteMarkdown } from "@/lib/local/ai/common";
import type { LocalBlock, LocalDocument, LocalFolder } from "@/lib/local/store";
import type { LocalReader } from "@/lib/local/registry";
import type { E2eeSpace, Switches } from "../router/deps";
import type { InnerClient } from "../router/types";
import { hex } from "../migrate/env";
import type { LockIndex } from "./locks";

export type MirrorPurpose = "search" | "ai" | "apps";

const SWITCH_OF: Record<MirrorPurpose, keyof Switches> = { search: "searchEverywhere", ai: "backgroundAi", apps: "apps" };

/** convex/e2ee/mirrors.ts MIRROR_LIMITS, kept a little under. */
const LIMITS = { textChars: 900_000, titleChars: 300, folderPathChars: 1000, tags: 50, tagChars: 60, tasks: 500, taskChars: 1000 };

export interface MirrorDeps {
  server: Pick<InnerClient, "query" | "mutation">;
  space: E2eeSpace;
  store: LocalReader;
  locks: LockIndex;
  /** Whether a note is sealed (only sealed notes get copies; a plain one is the server's own). */
  isSealed(documentId: string): boolean;
}

export interface MirrorCopy {
  title: string;
  text: string;
  folderPath?: string;
  tags?: string[];
  tasks?: { blockId: string; text: string; done: boolean; due?: string; dueTime?: string }[];
}

/** Whether a space's switch for a purpose is on and the level lets it be (only "features you pick"). */
export function mirrorOn(space: Pick<E2eeSpace, "level" | "switches">, purpose: MirrorPurpose): boolean {
  return space.level === "selected" && space.switches[SWITCH_OF[purpose]] === true;
}

const inlineText = (nodes: unknown): string =>
  Array.isArray(nodes) ? (nodes as InlineNode[]).map((n) => String((n as { text?: unknown }).text ?? (n as { label?: unknown }).label ?? "")).join("") : "";

async function folderPath(store: LocalReader, folderId: string | null): Promise<string | undefined> {
  const names: string[] = [];
  for (let id = folderId, i = 0; id && i < 20; i++) {
    const f = (await store.get("folders", id)) as LocalFolder | undefined;
    if (!f || f.deletedAt !== null) break;
    names.unshift(f.name);
    id = f.parentFolderId;
  }
  return names.length ? names.join(" / ").slice(0, LIMITS.folderPathChars) : undefined;
}

/** The copy of one note for one purpose. */
export async function mirrorCopy(store: LocalReader, doc: LocalDocument, purpose: MirrorPurpose): Promise<MirrorCopy> {
  const title = (doc.title || "Untitled").slice(0, LIMITS.titleChars);
  if (purpose === "search") {
    const found = ((await store.list("fileTexts", doc.id)) as { text: string }[]).map((t) => t.text);
    return { title, text: [doc.searchText, ...found].filter(Boolean).join("\n").slice(0, LIMITS.textChars) };
  }
  const text = await noteMarkdown(store, doc, LIMITS.textChars, { title: false });
  if (purpose === "ai") return { title, text };
  const blocks = ((await store.list("blocks", doc.id)) as LocalBlock[]).filter((b) => b.deletedAt === null && b.type === "todo");
  const tasks = blocks.slice(0, LIMITS.tasks).map((b) => {
    const p = b.props as { checked?: unknown; dueDate?: unknown; dueTime?: unknown };
    return {
      blockId: b.id,
      text: inlineText(b.text).slice(0, LIMITS.taskChars),
      done: p.checked === true,
      ...(typeof p.dueDate === "string" ? { due: p.dueDate } : {}),
      ...(typeof p.dueDate === "string" && typeof p.dueTime === "string" ? { dueTime: p.dueTime } : {}),
    };
  });
  const tags: string[] = [];
  for (const id of doc.tagIds.slice(0, LIMITS.tags)) {
    const t = (await store.get("tags", id)) as { name: string } | undefined;
    if (t?.name) tags.push(t.name.slice(0, LIMITS.tagChars));
  }
  const path = await folderPath(store, doc.folderId);
  return { title, text, ...(path ? { folderPath: path } : {}), tags, tasks };
}

/** A copy's content hash (what e2ee.mirrors.hashes compares). */
export function contentHash(copy: MirrorCopy): string {
  return hex(sha256(new TextEncoder().encode(canonicalJson(copy)))).slice(0, 64);
}

async function serverHashes(d: MirrorDeps, purpose: MirrorPurpose): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let cursor: string | null = null;
  for (let i = 0; i < 1000; i++) {
    const page = (await d.server.query(api.e2ee.mirrors.hashes, { scope: d.space.scope, purpose, cursor })) as { items: { documentId: string; contentHash: string }[]; cursor: string | null };
    for (const it of page.items) out.set(it.documentId, it.contentHash);
    if (!page.cursor) break;
    cursor = page.cursor;
  }
  return out;
}

/** Brings one purpose's copies in step with the replica. Returns what changed. */
export async function syncMirrors(d: MirrorDeps, purpose: MirrorPurpose): Promise<{ put: number; removed: number }> {
  if (!mirrorOn(d.space, purpose)) return { put: 0, removed: 0 };
  const have = await serverHashes(d, purpose);
  const docs = ((await d.store.list("documents")) as LocalDocument[]).filter((x) => !x.pending);
  const keep = new Set<string>();
  let put = 0;
  let removed = 0;
  for (const doc of docs) {
    if (doc.inTrash || doc.deletedAt !== null || doc.kind === "template" || !d.isSealed(doc.id)) continue;
    if (await d.locks.isLocked(d.store, doc.id)) continue;
    keep.add(doc.id);
    const copy = await mirrorCopy(d.store, doc, purpose);
    const hash = contentHash(copy);
    if (have.get(doc.id) === hash) continue;
    try {
      await d.server.mutation(api.e2ee.mirrors.put, { scope: d.space.scope, purpose, documentId: doc.id, ...copy, contentHash: hash });
      put++;
    } catch (e) {
      const code = (e as { data?: { code?: string } }).data?.code;
      // The switch went off meanwhile: stop; the server purges.
      if (code === "e2ee_switch_off") return { put, removed };
      if (code !== "e2ee_locked" && code !== "not_found" && code !== "invalid_argument" && code !== "limit_exceeded") throw e;
    }
  }
  for (const id of have.keys()) {
    if (keep.has(id)) continue;
    try {
      await d.server.mutation(api.e2ee.mirrors.remove, { purpose, documentId: id });
      removed++;
    } catch {
      // A note gone for good takes its copy with it (maintenance.purgeDocument).
    }
  }
  return { put, removed };
}
