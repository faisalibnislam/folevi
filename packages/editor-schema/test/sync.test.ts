import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { sync } from "../src";
import type { SyncState } from "../src";

const fixturePath = resolve(__dirname, "../fixtures/sync-scenarios.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
  scenarios: { name: string; steps: Step[]; expectedFinal: string | null }[];
};

type Step = { action: string; input?: unknown } & Record<string, unknown>;

export function runStep(state: SyncState, step: Step): SyncState {
  const i = step.input as never;
  switch (step.action) {
    case "localUpsert":
      return sync.localUpsert(state, i);
    case "localDelete":
      return sync.localDelete(state, i);
    case "localRestore":
      return sync.localRestore(state, i);
    case "setConnection":
      return sync.setConnection(state, i);
    case "takeBatch":
      return sync.takeBatch(state);
    case "applyResults":
      return sync.applyResults(state, i);
    case "batchFailed":
      return sync.batchFailed(state, i);
    case "authRefreshed":
      return sync.authRefreshed(state);
    case "remoteUpdate":
      return sync.remoteUpdate(state, i);
    case "queueUpload":
      return sync.queueUpload(state, i);
    case "uploadFailed":
      return sync.uploadFailed(state, i);
    case "uploadCompleted":
      return sync.uploadCompleted(state, i);
    case "resolveConflict":
      return sync.resolveConflict(state, i);
    case "expect":
      return state;
    default:
      throw new Error(`unknown action ${step.action}`);
  }
}

function checkExpect(state: SyncState, step: Step, where: string) {
  if (step.status !== undefined) expect(sync.syncStatus(state), where).toBe(step.status);
  if (step.pending !== undefined) expect(state.pending.length, `${where} pending`).toBe(step.pending);
  if (step.inflight !== undefined) expect(state.inflight.length, `${where} inflight`).toBe(step.inflight);
  if (step.conflicts !== undefined) expect(state.conflicts.length, `${where} conflicts`).toBe(step.conflicts);
  if (step.baseRevisions !== undefined) {
    expect(state.pending.map((op) => ("baseRevision" in op ? op.baseRevision : null)), where).toEqual(step.baseRevisions);
  }
  if (step.revisions !== undefined) {
    for (const [id, rev] of Object.entries(step.revisions as Record<string, number>)) {
      expect(state.blocks[id]?.serverRevision, `${where} revision ${id}`).toBe(rev);
    }
  }
  if (step.deleted !== undefined) {
    const deleted = Object.entries(state.blocks)
      .filter(([, e]) => e.deleted)
      .map(([id]) => id);
    expect(deleted, where).toEqual(step.deleted);
  }
  if (step.absent !== undefined) for (const id of step.absent as string[]) expect(state.blocks[id], where).toBeUndefined();
}

describe("golden sync scenarios", () => {
  let updated = false;
  for (const scenario of fixture.scenarios) {
    it(scenario.name, () => {
      let state = sync.emptySyncState();
      scenario.steps.forEach((step, idx) => {
        state = runStep(state, step);
        if (step.action === "expect") checkExpect(state, step, `${scenario.name}#${idx}`);
      });
      const canonical = sync.canonicalSyncState(state);
      if (process.env.UPDATE_FIXTURES) {
        scenario.expectedFinal = canonical;
        updated = true;
      } else {
        expect(canonical).toBe(scenario.expectedFinal);
      }
    });
  }
  it.runIf(process.env.UPDATE_FIXTURES)("writes fixtures", () => {
    if (updated) writeFileSync(fixturePath, JSON.stringify(fixture, null, 2) + "\n");
  });
});

describe("sync reducer details", () => {
  const block = (id: string, t: string) => ({ id, type: "paragraph", parentId: null, rank: "V", schemaVersion: 1, text: [{ type: "text" as const, text: t }], props: {} });

  it("create then delete before sending drops everything", () => {
    let s = sync.emptySyncState();
    s = sync.localUpsert(s, { opId: "1", documentId: "d", block: block("a", "x"), fields: ["content", "position"] });
    s = sync.localDelete(s, { opId: "2", documentId: "d", blockId: "a" });
    expect(s.pending).toEqual([]);
    expect(s.blocks.a).toBeUndefined();
  });

  it("rebases queued edits made while an earlier edit was in flight", () => {
    let s = sync.emptySyncState();
    s = sync.remoteUpdate(s, { documentId: "d", block: { ...block("a", "v1"), revision: 1 }, deleted: false });
    s = sync.localUpsert(s, { opId: "1", documentId: "d", block: block("a", "v2"), fields: ["content"] });
    s = sync.takeBatch(s);
    s = sync.localUpsert(s, { opId: "2", documentId: "d", block: block("a", "v3"), fields: ["content"] });
    s = sync.applyResults(s, [{ opId: "1", status: "applied", revision: 2, block: { ...block("a", "v2"), revision: 2 } }]);
    expect(s.pending).toHaveLength(1);
    expect((s.pending[0] as { baseRevision: number }).baseRevision).toBe(2);
    // Local content (v3) is not overwritten by the ack of v2.
    expect(s.blocks.a!.block.text[0]).toEqual({ type: "text", text: "v3" });
  });

  it("sends a new block before a child that was queued ahead of it", () => {
    let s = sync.emptySyncState();
    s = sync.remoteUpdate(s, { documentId: "d", block: { ...block("c", "v1"), revision: 1 }, deleted: false });
    // Typed in C, then a new line N above it, then C tabbed under N.
    s = sync.localUpsert(s, { opId: "1", documentId: "d", block: block("c", "v2"), fields: ["content"] });
    s = sync.localUpsert(s, { opId: "2", documentId: "d", block: block("n", ""), fields: ["content", "position"] });
    s = sync.localUpsert(s, { opId: "3", documentId: "d", block: { ...block("c", "v2"), parentId: "n" }, fields: ["position"] });
    s = sync.takeBatch(s);
    expect(s.inflight.map((op) => (op.kind === "block.upsert" ? op.block.id : null))).toEqual(["n", "c"]);
    expect(s.pending).toEqual([]);
  });

  it("holds a child back while its new parent waits for an upload", () => {
    let s = sync.emptySyncState();
    s = sync.localUpsert(s, { opId: "1", documentId: "d", block: block("img", ""), fields: ["content", "position"], blockedBy: "u1" });
    s = sync.localUpsert(s, { opId: "2", documentId: "d", block: { ...block("cap", "under"), parentId: "img" }, fields: ["content", "position"] });
    s = sync.localUpsert(s, { opId: "3", documentId: "d", block: block("other", "x"), fields: ["content", "position"] });
    s = sync.takeBatch(s);
    expect(s.inflight.map((op) => (op.kind === "block.upsert" ? op.block.id : null))).toEqual(["other"]);
    expect(s.pending.map((op) => op.opId)).toEqual(["1", "2"]);
  });

  it("remote updates never clobber unsent local work", () => {
    let s = sync.emptySyncState();
    s = sync.remoteUpdate(s, { documentId: "d", block: { ...block("a", "v1"), revision: 1 }, deleted: false });
    s = sync.localUpsert(s, { opId: "1", documentId: "d", block: block("a", "mine"), fields: ["content"] });
    s = sync.remoteUpdate(s, { documentId: "d", block: { ...block("a", "theirs"), revision: 2 }, deleted: false });
    expect(s.blocks.a!.block.text[0]).toEqual({ type: "text", text: "mine" });
  });

  it("status reflects saved only when nothing is outstanding", () => {
    let s = sync.emptySyncState();
    expect(sync.syncStatus(s)).toBe("saved");
    s = sync.localUpsert(s, { opId: "1", documentId: "d", block: block("a", "x"), fields: ["content"] });
    expect(sync.syncStatus(s)).toBe("saving");
  });
});
