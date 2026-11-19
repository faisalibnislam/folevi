// @vitest-environment jsdom
// The iPhone and iPad app leaving the front. A web view's own visibilitychange can come late there, or not
// before iOS suspends the app, so the app says so itself (bridge.js: folevi:app-inactive) and the note saves
// what was typed in the last moment at once, instead of a quarter of a second later (when the page may no
// longer be running).
import "fake-indexeddb/auto";
import { afterEach, expect, test, vi } from "vitest";
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ConvexReactClient } from "convex/react";
import type { SyncOp, WireBlock, WireScope } from "@folevi/editor-schema";
import { SyncEngine } from "@/lib/sync/engine";
import { Editor, type EditorHandle } from "@/components/editor/Editor";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("convex/react", () => ({ useConvex: () => ({}), useAction: () => vi.fn(), useMutation: () => vi.fn(async () => undefined), useQuery: () => undefined }));
vi.mock("@/components/editor/EditorMenus", () => ({ EditorMenus: () => null }));
vi.mock("@/components/editor/PageLinkStatusWatcher", () => ({ PageLinkStatusWatcher: () => null }));
vi.mock("@/components/ai/useAi", () => ({ useAiEnabled: () => false }));
vi.mock("@/components/editor/pastedFiles", () => ({ usePastedFiles: () => undefined }));
vi.mock("@/components/editor/canvas/imageFiles", () => ({ useClipboardImageFiles: () => undefined }));

const PERSONAL: WireScope = { kind: "personal" };
const offline = { mutation: vi.fn(async () => { throw new Error("offline"); }) } as unknown as ConvexReactClient;
const block = (id: string, text: string, rank: string): WireBlock => ({ id, type: "paragraph", parentId: null, rank, schemaVersion: 1, text: [{ type: "text", text }], props: {}, revision: 1 });
const DECORATIONS = { presence: [], commentBlocks: new Set<string>(), selectedBlocks: new Set<string>(), conflictBlocks: new Set<string>() };

let root: Root | null = null;
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.innerHTML = "";
  root = null;
});

test("what was just typed is saved the moment the app says it is leaving the front", async () => {
  const engine = await SyncEngine.open(offline, "acct-inactive", PERSONAL, "web-1");
  engine.setOnline(false);
  engine.reconcileDocument("doc", [block("X", "One", "V")]);
  engine.markShown("doc");
  const handle = createRef<EditorHandle | null>();
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<Editor ref={handle} documentId="doc" engine={engine} accountKey="acct" editable decorations={DECORATIONS} />));
  await act(async () => await new Promise((r) => setTimeout(r, 30)));
  const upserts = () => (engine.state.pending as SyncOp[]).filter((op): op is Extract<SyncOp, { kind: "block.upsert" }> => op.kind === "block.upsert");

  await act(async () => {
    handle.current!.editor!.commands.insertContentAt(4, " two");
  });
  // Typed, and waiting for its quarter of a second.
  expect(upserts()).toEqual([]);
  act(() => {
    window.dispatchEvent(new Event("folevi:app-inactive"));
  });
  expect(upserts().map((op) => op.block.text)).toEqual([[{ type: "text", text: "One two" }]]);
  engine.dispose();
});
