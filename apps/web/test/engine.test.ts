import { describe, expect, test, vi } from "vitest";
import { SyncEngine } from "@/lib/sync/engine";
import type { WireScope } from "@folevi/editor-schema";

const PERSONAL: WireScope = { kind: "personal" };
import type { ConvexReactClient } from "convex/react";

function fakeClient(respond: (ops: { opId: string; kind: string; block?: { id: string } }[]) => unknown[]) {
  const calls: unknown[] = [];
  return {
    calls,
    client: {
      mutation: vi.fn(async (_fn: unknown, args: { ops: { opId: string; kind: string }[] }) => {
        calls.push(args);
        return respond(args.ops as never);
      }),
    } as unknown as ConvexReactClient,
  };
}

const block = (id: string, text: string) => ({ id, type: "paragraph", parentId: null, rank: "V", schemaVersion: 1, text: [{ type: "text" as const, text }], props: {} });

describe("web sync engine", () => {
  test("persists the op log to IndexedDB before sending, and survives a restart", async () => {
    const { client } = fakeClient(() => {
      throw new Error("offline");
    });
    const engine = await SyncEngine.open(client, "acct-1", PERSONAL, "web-dev-1");
    engine.setOnline(false);
    engine.upsertBlock("doc-1", block("b1", "offline words"), ["content", "position"]);
    await engine.persisted();
    const reopened = await SyncEngine.open(client, "acct-1", PERSONAL, "web-dev-1");
    expect(reopened.state.pending).toHaveLength(1);
    expect(reopened.documentBlocks("doc-1")[0]!.text[0]).toEqual({ type: "text", text: "offline words" });
  });

  test("flush sends ops in order, applies acknowledgements and reports Saved", async () => {
    const { client, calls } = fakeClient((ops) => ops.map((o) => ({ opId: o.opId, status: "applied", revision: 1, block: { ...block(o.block!.id, "x"), revision: 1 } })));
    const engine = await SyncEngine.open(client, "acct-2", PERSONAL, "web-dev-2");
    engine.setOnline(true);
    engine.upsertBlock("doc-1", block("b1", "x"), ["content", "position"]);
    engine.upsertBlock("doc-1", block("b2", "x"), ["content", "position"]);
    await engine.flush();
    expect(calls).toHaveLength(1);
    expect(engine.status()).toBe("saved");
    expect(engine.serverRevision("b1")).toBe(1);
  });

  test("an unauthenticated batch keeps every op and waits for re-auth", async () => {
    const { ConvexError } = await import("convex/values");
    const { client } = fakeClient(() => {
      throw new ConvexError({ code: "unauthenticated" });
    });
    const engine = await SyncEngine.open(client, "acct-3", PERSONAL, "web-dev-3");
    engine.setOnline(true);
    engine.upsertBlock("doc-1", block("b1", "x"), ["content", "position"]);
    await engine.flush();
    expect(engine.state.pending).toHaveLength(1);
    expect(engine.status()).toBe("error");
  });
});
