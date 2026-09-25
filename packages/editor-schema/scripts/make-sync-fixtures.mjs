#!/usr/bin/env node
// Writes fixtures/sync-scenarios.json (steps + hand-written assertions). The canonical expected state
// after every scenario is filled in by `UPDATE_FIXTURES=1 pnpm test` and must be reviewed in the diff.
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../fixtures/sync-scenarios.json");
const DOC = "01J9ZDOC000000000000000001";
const P1 = "01J9ZBLK000000000000000001";
const P2 = "01J9ZBLK000000000000000002";
const IMG = "01J9ZBLK000000000000000003";
const NEW = "01J9ZBLK000000000000000004";

const para = (id, text, rank = "V", revision) => {
  const b = { id, type: "paragraph", parentId: null, rank, schemaVersion: 1, text: text ? [{ type: "text", text }] : [], props: {} };
  if (revision !== undefined) b.revision = revision;
  return b;
};

const scenarios = [
  {
    name: "create_offline",
    steps: [
      { action: "setConnection", input: "offline" },
      { action: "localUpsert", input: { opId: "op1", documentId: DOC, block: para(P1, "Written on a train"), fields: ["content", "position"] } },
      { action: "expect", status: "offline", pending: 1 },
      { action: "setConnection", input: "online" },
      { action: "takeBatch" },
      { action: "expect", status: "syncing", inflight: 1 },
      { action: "applyResults", input: [{ opId: "op1", status: "applied", revision: 1, block: para(P1, "Written on a train", "V", 1) }] },
      { action: "expect", status: "saved", pending: 0, revisions: { [P1]: 1 } },
    ],
  },
  {
    name: "edit_offline",
    steps: [
      { action: "remoteUpdate", input: { documentId: DOC, block: para(P1, "Draft", "V", 3), deleted: false } },
      { action: "setConnection", input: "offline" },
      { action: "localUpsert", input: { opId: "op1", documentId: DOC, block: para(P1, "Draft one"), fields: ["content"] } },
      { action: "localUpsert", input: { opId: "op2", documentId: DOC, block: para(P1, "Draft one, revised"), fields: ["content"] } },
      { action: "expect", status: "offline", pending: 1, baseRevisions: [3] },
      { action: "setConnection", input: "online" },
      { action: "takeBatch" },
      { action: "applyResults", input: [{ opId: "op1", status: "applied", revision: 4, block: para(P1, "Draft one, revised", "V", 4) }] },
      { action: "expect", status: "saved", revisions: { [P1]: 4 } },
    ],
  },
  {
    name: "reorder_offline",
    steps: [
      { action: "remoteUpdate", input: { documentId: DOC, block: para(P1, "First", "V", 1), deleted: false } },
      { action: "remoteUpdate", input: { documentId: DOC, block: para(P2, "Second", "l", 1), deleted: false } },
      { action: "setConnection", input: "offline" },
      { action: "localUpsert", input: { opId: "op1", documentId: DOC, block: para(P2, "Second", "G"), fields: ["position"] } },
      { action: "expect", status: "offline", pending: 1 },
      { action: "setConnection", input: "online" },
      { action: "takeBatch" },
      { action: "applyResults", input: [{ opId: "op1", status: "applied", revision: 2, block: para(P2, "Second", "G", 2) }] },
      { action: "expect", status: "saved", revisions: { [P2]: 2 } },
    ],
  },
  {
    name: "delete_restore_offline",
    steps: [
      { action: "remoteUpdate", input: { documentId: DOC, block: para(P1, "Keep me", "V", 2), deleted: false } },
      { action: "setConnection", input: "offline" },
      { action: "localDelete", input: { opId: "op1", documentId: DOC, blockId: P1 } },
      { action: "localRestore", input: { opId: "op2", documentId: DOC, blockId: P1 } },
      { action: "expect", status: "offline", pending: 0 },
      { action: "localDelete", input: { opId: "op3", documentId: DOC, blockId: P1 } },
      { action: "setConnection", input: "online" },
      { action: "takeBatch" },
      { action: "applyResults", input: [{ opId: "op3", status: "applied", revision: 3, block: para(P1, "Keep me", "V", 3), deleted: true }] },
      { action: "expect", status: "saved", deleted: [P1] },
      { action: "localRestore", input: { opId: "op4", documentId: DOC, blockId: P1 } },
      { action: "takeBatch" },
      { action: "applyResults", input: [{ opId: "op4", status: "applied", revision: 4, block: para(P1, "Keep me", "V", 4), deleted: false }] },
      { action: "expect", status: "saved", deleted: [], revisions: { [P1]: 4 } },
    ],
  },
  {
    name: "duplicate_delivery",
    steps: [
      { action: "localUpsert", input: { opId: "op1", documentId: DOC, block: para(P1, "Once"), fields: ["content", "position"] } },
      { action: "takeBatch" },
      { action: "batchFailed", input: "network" },
      { action: "expect", status: "offline", pending: 1 },
      { action: "setConnection", input: "online" },
      { action: "takeBatch" },
      { action: "applyResults", input: [{ opId: "op1", status: "duplicate", revision: 1, block: para(P1, "Once", "V", 1) }] },
      { action: "expect", status: "saved", revisions: { [P1]: 1 } },
    ],
  },
  {
    name: "reconnect_after_token_expiry",
    steps: [
      { action: "remoteUpdate", input: { documentId: DOC, block: para(P1, "Before", "V", 5), deleted: false } },
      { action: "localUpsert", input: { opId: "op1", documentId: DOC, block: para(P1, "After"), fields: ["content"] } },
      { action: "takeBatch" },
      { action: "batchFailed", input: "unauthenticated" },
      { action: "expect", status: "error", pending: 1 },
      { action: "takeBatch" },
      { action: "expect", inflight: 0, pending: 1 },
      { action: "authRefreshed" },
      { action: "takeBatch" },
      { action: "applyResults", input: [{ opId: "op1", status: "applied", revision: 6, block: para(P1, "After", "V", 6) }] },
      { action: "expect", status: "saved", revisions: { [P1]: 6 } },
    ],
  },
  {
    name: "server_rejection",
    steps: [
      { action: "localUpsert", input: { opId: "op1", documentId: DOC, block: para(P1, "Too long for the server"), fields: ["content", "position"] } },
      { action: "takeBatch" },
      { action: "applyResults", input: [{ opId: "op1", status: "rejected", error: { code: "invalid_block", message: "text too long" } }] },
      { action: "expect", status: "error", pending: 0, absent: [P1] },
    ],
  },
  {
    name: "same_block_conflict",
    steps: [
      { action: "remoteUpdate", input: { documentId: DOC, block: para(P1, "Hello", "V", 1), deleted: false } },
      { action: "localUpsert", input: { opId: "op1", documentId: DOC, block: para(P1, "Hello from the Mac"), fields: ["content"] } },
      { action: "takeBatch" },
      {
        action: "applyResults",
        input: [
          {
            opId: "op1",
            status: "conflict",
            revision: 2,
            block: para(P1, "Hello from the web", "V", 2),
            conflict: { reason: "content", server: para(P1, "Hello from the web", "V", 2), client: para(P1, "Hello from the Mac") },
          },
        ],
      },
      { action: "expect", status: "conflict", conflicts: 1, revisions: { [P1]: 2 } },
      { action: "resolveConflict", input: { conflictId: "op1", choice: "both", opId: "op2", newBlockId: NEW, newRank: "k" } },
      { action: "expect", status: "saving", conflicts: 0, pending: 1 },
      { action: "takeBatch" },
      { action: "applyResults", input: [{ opId: "op2", status: "applied", revision: 1, block: para(NEW, "Hello from the Mac", "k", 1) }] },
      { action: "expect", status: "saved", revisions: { [P1]: 2, [NEW]: 1 } },
    ],
  },
  {
    name: "attachment_upload_interruption",
    steps: [
      { action: "queueUpload", input: { uploadId: "up1", documentId: DOC, blockId: IMG } },
      {
        action: "localUpsert",
        input: {
          opId: "op1",
          documentId: DOC,
          block: { id: IMG, type: "image", parentId: null, rank: "V", schemaVersion: 1, text: [], props: { alt: "Harbor at dawn", caption: "" } },
          fields: ["content", "position"],
          blockedBy: "up1",
        },
      },
      { action: "localUpsert", input: { opId: "op2", documentId: DOC, block: para(P2, "Caption notes", "l"), fields: ["content", "position"] } },
      { action: "takeBatch" },
      { action: "expect", inflight: 1, pending: 1 },
      { action: "applyResults", input: [{ opId: "op2", status: "applied", revision: 1, block: para(P2, "Caption notes", "l", 1) }] },
      { action: "uploadFailed", input: "up1" },
      { action: "expect", status: "saving", pending: 1 },
      { action: "takeBatch" },
      { action: "expect", inflight: 0, pending: 1 },
      { action: "uploadCompleted", input: { uploadId: "up1", fileId: "file_harbor" } },
      { action: "takeBatch" },
      { action: "expect", inflight: 1, pending: 0 },
      {
        action: "applyResults",
        input: [
          {
            opId: "op1",
            status: "applied",
            revision: 1,
            block: { id: IMG, type: "image", parentId: null, rank: "V", schemaVersion: 1, text: [], props: { alt: "Harbor at dawn", caption: "", fileId: "file_harbor" }, revision: 1 },
          },
        ],
      },
      { action: "expect", status: "saved", revisions: { [IMG]: 1, [P2]: 1 } },
    ],
  },
];

// Preserve previously recorded expectations.
let existing = {};
if (existsSync(out)) {
  for (const s of JSON.parse(readFileSync(out, "utf8")).scenarios) existing[s.name] = s.expectedFinal;
}
const data = {
  $description: "Golden offline/sync scenarios executed by the TypeScript and Swift reducers. See docs/SYNC_PROTOCOL.md.",
  scenarios: scenarios.map((s) => ({ ...s, expectedFinal: existing[s.name] ?? null })),
};
writeFileSync(out, JSON.stringify(data, null, 2) + "\n");
console.log(`wrote ${out}`);
