// Local mode's search index (lib/local/search): words, prefixes, BM25 ranking, entries updated and removed
// one at a time, the snapshot it's saved as; LocalSearchIndex following the library and saving itself through
// the store's hook; and search.documents re-running when a note changes, through the real LocalClient.
import { describe, expect, test, vi } from "vitest";
import { SCHEMA_VERSION, ulid } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { LocalSearchIndex, TextIndex, queryTerms, tokenize } from "@/lib/local/search";
import { MemoryStore, type LocalIndexStorage } from "@/lib/local/store";
import { createTestLocalClient } from "@/lib/local/testing";
import { makeDoc } from "./local-fixtures";

describe("tokenize", () => {
  test("folds case, accents and quotes and splits at anything that isn't a letter or digit", () => {
    expect(tokenize("Café “Déjà-vu”, 2 Flat-Whites!")).toEqual(["cafe", "deja", "vu", "2", "flat", "whites"]);
    expect(tokenize("")).toEqual([]);
    expect(queryTerms("the The  the cat")).toEqual(["the", "cat"]);
  });
});

describe("TextIndex", () => {
  const index = () => {
    const i = new TextIndex(["title", "text"] as const);
    i.set("a", "1", { title: "Garden plans", text: "Tomatoes and beans in the garden, garden tools" });
    i.set("b", "1", { title: "Groceries", text: "Beans, bread, a gardening magazine" });
    i.set("c", "1", { title: "Taxes", text: "Nothing about it" });
    return i;
  };
  const order = (scores: Map<string, number>) => [...scores].sort((x, y) => y[1] - x[1]).map(([id]) => id);

  test("a term finds the words it starts; whole words and more of them rank higher", () => {
    const i = index();
    expect(order(i.search("garden"))).toEqual(["a", "b"]);
    expect(order(i.search("gard"))).toEqual(["a", "b"]);
    expect(i.search("taxes", ["text"]).size).toBe(0);
    expect(order(i.search("taxes", ["title"]))).toEqual(["c"]);
    // Two terms: an entry with both beats one with either.
    expect(order(i.search("beans bread"))[0]).toBe("b");
  });

  test("entries are replaced and removed one at a time, words that go leave the vocabulary", () => {
    const i = index();
    i.set("c", "2", { title: "Taxes", text: "Garden shed receipts" });
    expect(i.stampOf("c")).toBe("2");
    expect(new Set(i.search("receipts").keys())).toEqual(new Set(["c"]));
    i.remove("c");
    expect(i.search("receipts").size).toBe(0);
    expect(i.stampOf("c")).toBeUndefined();
    expect(i.size).toBe(2);
  });

  test("a snapshot restores the same index; one for other fields is refused", () => {
    const i = index();
    const copy = new TextIndex(["title", "text"] as const);
    expect(copy.restore(JSON.parse(JSON.stringify(i.snapshot())))).toBe(true);
    expect(copy.search("garden")).toEqual(i.search("garden"));
    expect(new TextIndex(["text"] as const).restore(i.snapshot())).toBe(false);
    expect(copy.restore({ v: 2 })).toBe(false);
  });
});

describe("LocalSearchIndex", () => {
  test("follows the rows it's given, then saves itself and loads again", async () => {
    vi.useFakeTimers();
    try {
      let saved: unknown = null;
      const storage: LocalIndexStorage = { load: async () => saved, save: async (s) => void (saved = structuredClone(s)) };
      const one = new LocalSearchIndex({ storage, saveDelayMs: 10 });
      await one.ready();
      const a = makeDoc("A", { title: "Quokka notes", searchText: "Quokka notes\nsmiling marsupials" });
      const b = makeDoc("B", { title: "Other", searchText: "Other\nnothing" });
      one.syncNotes([a, b]);
      expect([...one.notes.search("marsupials").keys()]).toEqual(["A"]);
      // Changed (a new stamp): indexed again. Gone: dropped.
      one.syncNotes([{ ...b, seq: 2, searchText: "Other\nmarsupials too" }]);
      expect([...one.notes.search("marsupials").keys()]).toEqual(["B"]);
      expect(saved).toBeNull();
      await vi.advanceTimersByTimeAsync(20);
      expect(saved).not.toBeNull();

      const two = new LocalSearchIndex({ storage });
      await two.ready();
      expect(two.notes.stampOf("B")).toBe(one.notes.stampOf("B"));
      expect([...two.notes.search("marsupials").keys()]).toEqual(["B"]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("a snapshot it can't read is dropped and the index starts empty", async () => {
    const index = new LocalSearchIndex({ storage: { load: async () => ({ format: "folevi-search-index", v: 1, notes: { v: 9 } }), save: async () => undefined } });
    await index.ready();
    expect(index.notes.size).toBe(0);
  });
});

describe("search.documents in local mode", () => {
  test("re-runs when a note changes, and uses the store's index storage", async () => {
    const store = new MemoryStore();
    const saves: unknown[] = [];
    store.searchIndexStorage = { load: async () => null, save: async (s) => void saves.push(s) };
    const client = await createTestLocalClient({ store });
    const note = ulid();
    await client.mutation(api.sync.push, {
      scope: { kind: "personal" },
      deviceId: "test-device-1",
      ops: [{ opId: ulid(), kind: "document.create", document: { id: note, parentDocumentId: null, folderId: null, kind: "document", title: "Shopping", icon: "📝" } }],
    });
    const watch = client.watchQuery(api.search.documents, { scope: { kind: "personal" }, query: "wombat" });
    const updates = vi.fn();
    const stop = watch.onUpdate(updates);
    await vi.waitFor(() => expect(watch.localQueryResult()).toEqual([]));
    await client.mutation(api.sync.push, {
      scope: { kind: "personal" },
      deviceId: "test-device-1",
      ops: [{ opId: ulid(), kind: "block.upsert", documentId: note, block: { id: ulid(), type: "paragraph", parentId: null, rank: "V", schemaVersion: SCHEMA_VERSION, text: [{ type: "text", text: "Food for the wombat" }], props: {} }, baseRevision: null, fields: ["content", "position"] }],
    });
    await vi.waitFor(() => expect((watch.localQueryResult() as { id: string }[]).map((r) => r.id)).toEqual([note]));
    expect(updates).toHaveBeenCalled();
    stop();
    await client.close();
    // Closing the library saves what the index learned.
    expect(saves.length).toBeGreaterThan(0);
  });
});
