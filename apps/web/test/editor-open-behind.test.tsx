// @vitest-environment jsdom
// A note that was open on this device before and has changed elsewhere since. The editor is made a moment
// after its first render; in between, the page gives the engine the server's newer blocks. The editor used to
// keep showing the older ones, counted the newer ones as shown, and an edit of a line then went out as an edit
// of the newer version: the other device's change to that line was replaced with no question asked.
import "fake-indexeddb/auto";
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, createRef, useEffect } from "react";
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
const block = (id: string, text: string, rank: string, revision: number): WireBlock => ({ id, type: "paragraph", parentId: null, rank, schemaVersion: 1, text: [{ type: "text", text }], props: {}, revision });
const DECORATIONS = { presence: [], commentBlocks: new Set<string>(), selectedBlocks: new Set<string>(), conflictBlocks: new Set<string>() };

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
});

const settle = async (ms = 30) => act(async () => await new Promise((r) => setTimeout(r, ms)));

/** The note page around the editor: once drawn, it hands the engine the server's blocks and tells the editor. */
function Page({ engine, handle, server }: { engine: SyncEngine; handle: React.RefObject<EditorHandle | null>; server: WireBlock[] }) {
  useEffect(() => {
    handle.current?.flush();
    engine.reconcileDocument("doc", server);
    handle.current?.applyFromEngine();
  }, [engine, handle, server]);
  return <Editor ref={handle} documentId="doc" engine={engine} accountKey="acct" editable decorations={DECORATIONS} />;
}

async function open(account: string, held: WireBlock[], server: WireBlock[]) {
  const engine = await SyncEngine.open(offline, account, PERSONAL, "web-1");
  engine.setOnline(false);
  // What this device holds from the last time the note was open here.
  engine.reconcileDocument("doc", held);
  engine.markShown("doc");
  const handle = createRef<EditorHandle | null>();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<Page engine={engine} handle={handle} server={server} />));
  await settle();
  return { engine, handle };
}
const linesOf = (handle: React.RefObject<EditorHandle | null>) => {
  const out: string[] = [];
  handle.current!.editor!.state.doc.forEach((n) => out.push(n.textContent));
  return out;
};
const upsertsOf = (engine: SyncEngine) => (engine.state.pending as SyncOp[]).filter((op): op is Extract<SyncOp, { kind: "block.upsert" }> => op.kind === "block.upsert");

describe("a note changed elsewhere since this device last had it open", () => {
  test("opens showing the newer blocks", async () => {
    const { engine, handle } = await open("acct-behind-1", [block("X", "old words", "V", 1), block("Y", "second", "W", 1)], [block("X", "new words from the Mac", "V", 2), block("Y", "second", "W", 1), block("Z", "added on the Mac", "X", 1)]);
    expect(linesOf(handle)).toEqual(["new words from the Mac", "second", "added on the Mac"]);
    // Nothing was typed: nothing to save.
    expect(upsertsOf(engine)).toEqual([]);
    engine.dispose();
  });

  test("an edit of a line afterwards is an edit of the newer version, and only of that line", async () => {
    const { engine, handle } = await open("acct-behind-2", [block("X", "old words", "V", 1), block("Y", "second", "W", 1)], [block("X", "new words from the Mac", "V", 2), block("Y", "second", "W", 1)]);
    const ed = handle.current!.editor!;
    await act(async () => {
      ed.commands.insertContentAt(1, "Hi ");
      handle.current!.flush();
    });
    const ops = upsertsOf(engine);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.block.id).toBe("X");
    expect(ops[0]!.block.text).toEqual([{ type: "text", text: "Hi new words from the Mac" }]);
    expect(ops[0]!.baseRevision).toBe(2);
    engine.dispose();
  });

  test("a note this device holds as the server has it opens with nothing to do", async () => {
    const same = [block("X", "words", "V", 3), block("Y", "second", "W", 1)];
    const { engine, handle } = await open("acct-behind-3", same, same.map((b) => ({ ...b })));
    expect(linesOf(handle)).toEqual(["words", "second"]);
    expect(upsertsOf(engine)).toEqual([]);
    engine.dispose();
  });
});
