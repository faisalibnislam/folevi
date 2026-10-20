// Shared set-up for the local mode tests (lib/local): a library in memory with its profile, and note rows.
import { act } from "react";
import { DEFAULT_COVER, DEFAULT_DOCUMENT_STYLE } from "@folevi/editor-schema";
import { LocalBackend } from "@/lib/local/backend";
import { LocalClient } from "@/lib/local/client";
import { MemoryStore, type LocalDocument, type StoreWrite } from "@/lib/local/store";

export function makeDoc(id: string, patch: Partial<LocalDocument> = {}): LocalDocument {
  return {
    id,
    parentDocumentId: null,
    folderId: null,
    kind: "document",
    title: `Note ${id}`,
    icon: null,
    cover: DEFAULT_COVER,
    style: DEFAULT_DOCUMENT_STYLE,
    dailyDate: null,
    templateKey: null,
    collectionId: null,
    rank: "V",
    createdAt: 1,
    ordinal: 0,
    updatedAt: 1,
    archivedAt: null,
    deletedAt: null,
    inTrash: false,
    revision: 1,
    titleRev: 1,
    seq: 1,
    contentSeq: 0,
    searchText: "",
    wordCount: 0,
    charCount: 0,
    blockCount: 0,
    excerpt: "",
    preview: null,
    starred: false,
    tagIds: [],
    ...patch,
  };
}

export const docWrite = (d: LocalDocument): StoreWrite => ({ table: "documents", id: d.id, value: d });

/** A set-up library (profile, no seeded notes) with `docs` in it, its backend and a client on it. */
export async function makeLibrary(docs: LocalDocument[] = [], opts: { evictAfterMs?: number } = {}) {
  const store = new MemoryStore();
  await store.commit(docs.map(docWrite));
  const backend = new LocalBackend(store, { deviceId: "test-device" });
  await backend.local.setup({ timeZone: "UTC", locale: "en", seed: false });
  const client = new LocalClient(backend, opts);
  return { store, backend, client };
}

/** Lets microtasks, timers of 0 ms and React updates settle. */
export async function settle(rounds = 6) {
  for (let i = 0; i < rounds; i++) await act(async () => await new Promise((r) => setTimeout(r, 0)));
}
