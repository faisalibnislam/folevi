// The local data seam end to end (docs/LOCAL_MODE_PLAN.md WP5): a note made and typed into through the real
// SyncEngine lands in the library, and the real hooks on screen update; an attachment goes into the library
// with no upload; LocalGate sets a new library up and opens the app's state on it.
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { ConvexProvider, usePaginatedQuery, useQuery, type ConvexReactClient } from "convex/react";
import { ulid, type WireBlock } from "@folevi/editor-schema";

vi.mock("next/navigation", () => ({ usePathname: () => "/documents", useSearchParams: () => new URLSearchParams() }));
// The whole interface isn't ported yet (most of its functions are L1-L4): the gate's Shell stands in.
vi.mock("@/components/app/Shell", async () => {
  const { useAppState } = await import("@/lib/app/state");
  const { usePaginatedQuery: paged } = await import("convex/react");
  const { api: functions } = await import("@/lib/convex/api");
  return {
    Shell: function ShellStandIn() {
      const s = useAppState();
      const list = paged(functions.documents.list, { scope: s.scope, view: "all" }, { initialNumItems: 10 });
      return createElement("p", null, `shell|${s.online}|${s.engine ? "engine" : "no engine"}|${s.profile.displayName}|${list.results.map((d) => d.title).join(",")}`);
    },
  };
});

import { api } from "@/lib/convex/api";
import { SyncEngine } from "@/lib/sync/engine";
import { uploadFileNow } from "@/lib/sync/uploads";
import { BackendProvider } from "@/lib/convex/provider";
import { AppRouterProvider } from "@/lib/app/router";
import { LocalGate } from "@/components/app/LocalGate";
import { closeLocalLibrary, configureLocalLibrary, MemoryStore } from "@/lib/local";
import { setCurrentBackendMode } from "@/lib/backendMode";
import { makeLibrary, settle } from "./local-fixtures";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no matchMedia (the app's appearance reads it).
window.matchMedia ??= ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;

const paragraph = (id: string, text: string, rank = "V"): WireBlock => ({ id, type: "paragraph", parentId: null, rank, schemaVersion: 1, text: [{ type: "text", text }], props: {} });

describe("local mode, end to end", () => {
  test("create a note and type into it through the SyncEngine; the hooks on screen follow", async () => {
    const { client, store } = await makeLibrary();
    const engine = await SyncEngine.open(client, `local-${ulid()}`, { kind: "personal" }, "web-local-device-1");
    engine.setOnline(true);
    const noteId = ulid();
    function Screen() {
      const list = usePaginatedQuery(api.documents.list, { scope: { kind: "personal" }, view: "all" }, { initialNumItems: 20 });
      const blocks = useQuery(api.blocks.list, { documentId: noteId });
      const meta = useQuery(api.documents.get, { documentId: noteId });
      const text = blocks?.blocks.map((b) => b.text.map((n) => (n.type === "text" ? n.text : "")).join("")).join("/") ?? "-";
      return createElement("p", null, `${list.results.map((d) => `${d.title}:${d.excerpt}`).join(",")}|${text}|${meta?.document.wordCount ?? "-"}`);
    }
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(createElement(ConvexProvider, { client: client as unknown as ConvexReactClient }, createElement(Screen))));
    await settle();
    expect(host.textContent).toBe("|-|-");

    engine.createDocument({ id: noteId, parentDocumentId: null, folderId: null, kind: "document", title: "Groceries", icon: null });
    engine.upsertBlock(noteId, paragraph("b1", "Apples"), ["content", "position"]);
    await act(async () => await engine.flush());
    await settle();
    expect(host.textContent).toBe("Groceries:Apples|Apples|1");
    expect(engine.status()).toBe("saved");
    expect(engine.serverRevision("b1")).toBe(1);

    // Typing more, and a second line.
    engine.upsertBlock(noteId, { ...paragraph("b1", "Apples and pears"), revision: 1 }, ["content"]);
    engine.upsertBlock(noteId, paragraph("b2", "Bread", "W"), ["content", "position"]);
    await act(async () => await engine.flush());
    await settle();
    expect(host.textContent).toBe("Groceries:Apples and pears Bread|Apples and pears/Bread|4");
    expect(engine.serverRevision("b1")).toBe(2);

    // A title change, and a deleted line.
    engine.updateDocument(noteId, { title: "Shopping" }, 1);
    engine.deleteBlock(noteId, "b2");
    await act(async () => await engine.flush());
    await settle();
    expect(host.textContent).toBe("Shopping:Apples and pears|Apples and pears|3");
    expect(engine.status()).toBe("saved");

    // An attachment goes straight into the library: no upload address, no fetch.
    const fileId = await uploadFileNow(client, { blob: new Blob(["hello"], { type: "text/plain" }), filename: "a.txt", mimeType: "text/plain", kind: "file", documentId: noteId });
    expect(await store.get("files", fileId)).toMatchObject({ name: "a.txt", size: 5, documentId: noteId, sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824" });

    act(() => root.unmount());
    engine.dispose();
    await client.close();
  });

  describe("LocalGate", () => {
    beforeAll(() => {
      configureLocalLibrary({ openStore: async () => new MemoryStore(), host: { locks: null, target: null, channel: () => new BroadcastChannel(`local-slice-${ulid()}`) as never } });
    });
    afterAll(async () => {
      await closeLocalLibrary();
      setCurrentBackendMode("account");
    });

    test("sets a new library up with the welcome notes and opens the app on it, always online", async () => {
      const host = document.createElement("div");
      const root = createRoot(host);
      act(() => root.render(
          <BackendProvider backend="local">
            <AppRouterProvider>
              <LocalGate />
            </AppRouterProvider>
          </BackendProvider>,
        ));
      for (let i = 0; i < 40 && !host.textContent?.includes("|engine|"); i++) await settle(2);
      const text = host.textContent ?? "";
      expect(text.startsWith("shell|true|engine|You|")).toBe(true);
      // The seeded library, newest first: the same notes an account starts with, in the same order.
      expect(text.split("|").at(-1)!.split(",")).toEqual(["Welcome to Folevi", "Reading Shelf", "Trip Sketch: Coastal Weekend", "Project Atlas Brief", "Field Notes: A Quiet Morning"]);
      act(() => root.unmount());
    });
  });
});
