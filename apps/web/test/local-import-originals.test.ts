// Local mode's imports.importText (lib/local/functions/imports.ts) keeps an imported note's original dates, its
// tags and its attachments as file blocks, as the server does (tests/convex/import-originals.test.ts), and they
// reach another device of the library.
import { afterEach, describe, expect, test } from "vitest";
import { ulid } from "@folevi/editor-schema";
import { MemoryFs, type LocalFs } from "@folevi/local-store";
import { api } from "@/lib/convex/api";
import { LocalBackend } from "@/lib/local/backend";
import { LocalClient } from "@/lib/local/client";
import { LibraryStore, MemoryLibraryHost, MemoryReplicaDb } from "@/lib/local/store/index";

const remembered = new Map<string, string>();
afterEach(() => {
  MemoryReplicaDb.wipe();
  remembered.clear();
});

async function launch(name: string, fs: LocalFs) {
  const host = new MemoryLibraryHost({ fs });
  const store = await LibraryStore.open({
    host,
    deviceId: name,
    openDb: async (libraryId) => MemoryReplicaDb.open(`${name}:${libraryId}`),
    page: null,
    scanMs: 0,
    libraryIds: { recall: () => remembered.get(name) ?? null, remember: (id) => void remembered.set(name, id) },
    device: { name: `${name}'s Mac` },
  });
  const backend = new LocalBackend(store, { deviceId: name });
  const client = new LocalClient(backend);
  await store.idle();
  return { store, backend, client };
}

describe("local import keeps the original", () => {
  test("dates, tags and attachments, on this device and the next", async () => {
    const fs = new MemoryFs();
    const a = await launch("macbookA", fs);
    await a.client.local.setup({ timeZone: "UTC", locale: "en", displayName: "Test", seed: false });
    const created = Date.UTC(2020, 0, 2);
    const updated = Date.UTC(2023, 5, 7);
    const r = (await a.client.mutation(api.imports.importText, {
      scope: { kind: "personal" },
      filename: "Trip.md",
      content: "# Trip\n\nBefore\n\n[Tickets.pdf](apple-notes-file-1)",
      format: "markdown",
      createdAt: created,
      updatedAt: updated,
      fileMap: { "apple-notes-file-1": { fileId: "FILE1", name: "Tickets.pdf", size: 1234, mimeType: "application/pdf" } },
      tags: ["#travel", "Travel", "japan"],
    } as never)) as { document: { id: string } };
    const id = r.document.id;
    const doc = await a.store.get("documents", id);
    expect(doc).toMatchObject({ createdAt: created, updatedAt: updated });
    const blocks = ((await a.client.query(api.blocks.list, { documentId: id })) as { blocks: { type: string; props: unknown }[] }).blocks;
    expect(blocks.map((b) => b.type).sort()).toEqual(["file", "paragraph"]);
    expect(blocks.find((b) => b.type === "file")!.props).toEqual({ fileId: "FILE1", name: "Tickets.pdf", size: 1234, mimeType: "application/pdf" });
    const sidebar = (await a.client.query(api.organization.sidebar, { scope: { kind: "personal" } } as never)) as { tags: { id: string; name: string }[] };
    const tags = sidebar.tags.filter((t) => doc!.tagIds.includes(t.id)).map((t) => t.name);
    expect(tags.sort()).toEqual(["japan", "travel"]);
    await a.store.library.flush();
    const b = await launch("macbookB", fs);
    await b.store.library.syncNow();
    const onB = await b.store.get("documents", id);
    expect(onB).toMatchObject({ createdAt: created, updatedAt: updated });
    expect([...onB!.tagIds].sort()).toEqual([...doc!.tagIds].sort());
    // Changed here: it shows the new last change, on this device and the other.
    const before = Date.now();
    await b.client.mutation(api.sync.push, { scope: { kind: "personal" }, deviceId: "macbookB", ops: [{ opId: ulid(), kind: "document.update", documentId: id, patch: { title: "Trip 2027" }, baseRevision: null }] } as never);
    expect((await b.store.get("documents", id))!.updatedAt).toBeGreaterThanOrEqual(before);
    await b.store.library.flush();
    await a.store.library.syncNow();
    expect((await a.store.get("documents", id))!.updatedAt).toBeGreaterThanOrEqual(before);
    expect((await a.store.get("documents", id))!.createdAt).toBe(created);
    for (const d of [a, b]) {
      await d.client.close();
      await d.backend.close();
    }
  });
});
