"use client";

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { ulid, type SyncState, type WireBlock } from "@folevi/editor-schema";

/**
 * Per-account local store (IndexedDB). Holds the durable operation log (sync state), last-known
 * documents and blocks for offline reading, and the device id. Cleared on sign-out.
 */
export interface CachedDocument {
  id: string;
  workspaceId: string;
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
  documents: { key: string; value: CachedDocument; indexes: { by_workspace: string } };
  blocks: { key: string; value: { documentId: string; workspaceId: string; blocks: WireBlock[]; cachedAt: number } };
  uploads: { key: string; value: PendingUpload };
}

export interface PendingUpload {
  uploadId: string;
  workspaceId: string;
  documentId: string;
  blockId: string;
  kind: "image" | "file";
  filename: string;
  mimeType: string;
  size: number;
  blob: Blob;
  attempts: number;
  nextAttemptAt: number;
}

const dbs = new Map<string, Promise<IDBPDatabase<FoleviDB>>>();

export function localDb(accountKey: string): Promise<IDBPDatabase<FoleviDB>> {
  const name = `folevi-${accountKey}`;
  let db = dbs.get(name);
  if (!db) {
    db = openDB<FoleviDB>(name, 2, {
      upgrade(database, oldVersion) {
        if (oldVersion < 1) {
          database.createObjectStore("meta");
          database.createObjectStore("syncState");
          const docs = database.createObjectStore("documents", { keyPath: "id" });
          docs.createIndex("by_workspace", "workspaceId");
          database.createObjectStore("blocks", { keyPath: "documentId" });
        }
        if (oldVersion < 2) database.createObjectStore("uploads", { keyPath: "uploadId" });
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
