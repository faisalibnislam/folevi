"use client";

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { ulid, type SyncState, type WireBlock } from "@folevi/editor-schema";

/**
 * Per-account local store (IndexedDB). Holds the durable operation log (sync state), last-known
 * documents and blocks for offline reading, and the device id. Cleared on sign-out.
 *
 * Cached lists are keyed by a scope key (`scopeIdKey`: "personal" for your Personal, or the team
 * workspace's id), never a workspace id standing in for Personal.
 */
export interface CachedDocument {
  id: string;
  /** `scopeIdKey` of the context whose list it was cached from. */
  scopeKey: string;
  title: string;
  icon: string | null;
  kind: string;
  updatedAt: number;
  excerpt: string;
  parentDocumentId: string | null;
  cachedAt: number;
  summary: unknown;
}

interface FoleviDB extends DBSchema {
  meta: { key: string; value: unknown };
  syncState: { key: string; value: SyncState };
  documents: { key: string; value: CachedDocument; indexes: { by_scope: string } };
  blocks: { key: string; value: { documentId: string; blocks: WireBlock[]; cachedAt: number } };
  uploads: { key: string; value: PendingUpload };
}

/** An attachment waiting to upload. Its page decides where it's stored (the server checks), so no scope. */
export interface PendingUpload {
  uploadId: string;
  documentId: string;
  blockId: string;
  kind: "image" | "file" | "audio";
  filename: string;
  mimeType: string;
  size: number;
  blob: Blob;
  attempts: number;
  nextAttemptAt: number;
}

/** v1 stores · v2 uploads · v3 scope-keyed document cache (Personal is not a workspace). */
export const DB_VERSION = 3;

/** Key of the single, account-wide sync state (older builds keyed one state per workspace id). */
export const ACCOUNT_SYNC_KEY = "account";

/**
 * Each block of the sync state is a record of its own in `meta`, keyed `syncBlock:<block id>`, so a save
 * writes only the blocks that changed (it used to copy the whole account every time); the `account` record
 * holds the rest. They live in `meta` because a new store would need a database upgrade, which waits until
 * every tab still running the previous version has closed. States saved before this hold their blocks in
 * the `account` record, and are moved over on their first save.
 */
export const SYNC_BLOCK_PREFIX = "syncBlock:";
export const syncBlockKeys = () => IDBKeyRange.bound(SYNC_BLOCK_PREFIX, `${SYNC_BLOCK_PREFIX}\uffff`);

const dbs = new Map<string, Promise<IDBPDatabase<FoleviDB>>>();

export function localDb(accountKey: string): Promise<IDBPDatabase<FoleviDB>> {
  const name = `folevi-${accountKey}`;
  let db = dbs.get(name);
  if (!db) {
    db = openDB<FoleviDB>(name, DB_VERSION, {
      async upgrade(database, oldVersion, _newVersion, transaction) {
        if (oldVersion < 1) {
          database.createObjectStore("meta");
          database.createObjectStore("syncState");
          database.createObjectStore("blocks", { keyPath: "documentId" });
        }
        if (oldVersion < 2) database.createObjectStore("uploads", { keyPath: "uploadId" });
        if (oldVersion < 3) {
          // v3: Personal is not a workspace. The document-list cache was indexed by workspace id (Personal's
          // was the old personal workspace's id); it's only a cache, so it's rebuilt, keyed by scope. The sync
          // queue (syncState) and waiting uploads are never dropped: queued page creates get a scope when the
          // engine opens (engine.ts adoptLegacyCreates), and waiting uploads lose their workspace id (their
          // page decides where they're stored).
          if (oldVersion >= 1) database.deleteObjectStore("documents");
          database.createObjectStore("documents", { keyPath: "id" }).createIndex("by_scope", "scopeKey");
          if (oldVersion >= 2) {
            let cursor = await transaction.objectStore("uploads").openCursor();
            while (cursor) {
              const { workspaceId, ...upload } = cursor.value as PendingUpload & { workspaceId?: string };
              if (workspaceId !== undefined) await cursor.update(upload);
              cursor = await cursor.continue();
            }
          }
        }
      },
    });
    dbs.set(name, db);
  }
  return db;
}

export async function deviceId(accountKey: string): Promise<string> {
  const db = await localDb(accountKey);
  const existing = (await db.get("meta", "deviceId")) as string | undefined;
  if (existing) return existing;
  const id = `web-${ulid()}`;
  await db.put("meta", id, "deviceId");
  return id;
}

export async function clearAllLocalData(): Promise<void> {
  try {
    localStorage.removeItem("folevi:last-account");
  } catch {
    /* storage unavailable */
  }
  for (const [name, db] of dbs) {
    (await db).close();
    dbs.delete(name);
  }
  const all = (await indexedDB.databases?.()) ?? [];
  await Promise.all(
    all
      .filter((d) => d.name?.startsWith("folevi-"))
      .map(
        (d) =>
          new Promise<void>((resolve) => {
            const req = indexedDB.deleteDatabase(d.name!);
            req.onsuccess = req.onerror = req.onblocked = () => resolve();
          }),
      ),
  );
  if ("caches" in window) {
    for (const key of await caches.keys()) if (key.startsWith("folevi-")) await caches.delete(key);
  }
}
