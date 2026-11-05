// QA F06 in local mode (lib/local/functions/tasks.ts, projected on read with the server's projectTask): an empty
// checkbox, such as a template's blank Follow-ups line, isn't a task in Tasks or Calendar; typing a title into it
// makes exactly one, with the note as its source.
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { SCHEMA_VERSION, ulid, type WireBlock } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { createTestLocalClient, type TestLocalClient } from "@/lib/local/testing";

const PERSONAL = { kind: "personal" } as const;

let client: TestLocalClient;
beforeEach(async () => {
  localStorage.clear();
  client = await createTestLocalClient();
});
afterEach(async () => {
  await client.close();
});

const todo = (id: string, text: string): WireBlock => ({ id, type: "todo", parentId: null, rank: "a1", schemaVersion: SCHEMA_VERSION, text: text ? [{ type: "text", text }] : [], props: { checked: false } });

describe("empty checkboxes in local mode", () => {
  test("stay out of Tasks until they have a title", async () => {
    const doc = ulid();
    await client.mutation(api.sync.push, {
      scope: PERSONAL,
      deviceId: client.deviceId,
      ops: [{ opId: ulid(), kind: "document.create", document: { id: doc, parentDocumentId: null, folderId: null, kind: "document", title: "Meeting Notes", icon: "📝" } }],
    });
    const id = ulid();
    let revision: number | null = null;
    const write = async (text: string) => {
      const [r] = await client.mutation(api.sync.push, {
        scope: PERSONAL,
        deviceId: client.deviceId,
        ops: [{ opId: ulid(), kind: "block.upsert", documentId: doc, block: todo(id, text), baseRevision: revision, fields: ["content", "position"] }],
      });
      expect(r!.status).toBe("applied");
      revision = (r as { revision: number }).revision;
    };
    const mine = async () => (await client.query(api.tasks.list, { scope: PERSONAL, view: "all", today: "2026-11-05" })).filter((t) => t.documentId === doc);

    await write("");
    expect(await mine()).toEqual([]);
    await write("Send the recap");
    const tasks = await mine();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ blockId: id, documentTitle: "Meeting Notes", title: "Send the recap" });
    await write("  ");
    expect(await mine()).toEqual([]);
  });
});
