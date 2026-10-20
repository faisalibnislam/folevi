// A public link's page signs addresses for the images inside a flowchart's shapes too (the read-only view
// draws them), but only for files of the note itself, never another note's.
import { describe, expect, test } from "vitest";
import { SCHEMA_VERSION, serializeFlowchart, flowchart, type WireBlock } from "@folevi/editor-schema";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { person, PERSONAL, setup, ulid } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;
const secret = "a".repeat(64);

async function noteWith(p: Person, title: string, blocks: WireBlock[]) {
  const id = ulid();
  await p.as.mutation(api.sync.push, {
    scope: PERSONAL,
    deviceId: "device-fc-images",
    ops: [
      { opId: ulid(), kind: "document.create", document: { id, parentDocumentId: null, folderId: null, kind: "document", title, icon: null } },
      ...blocks.map((block) => ({ opId: ulid(), kind: "block.upsert", documentId: id, block, baseRevision: null, fields: ["content", "position"] })),
    ] as never,
  });
  return id;
}

describe("share pages and flowchart images", () => {
  test("the page gets signed addresses for its own flowchart images only", async () => {
    const t = setup();
    const a = await person(t, "fc-images@example.com");
    const other = await noteWith(a, "Other", []);
    const own = ulid();
    const foreign = ulid();
    const data = serializeFlowchart(
      flowchart({
        nodes: [
          { id: "a", shape: "process", x: 0, y: 0, w: 160, h: 120, text: "Photo", color: "neutral", image: { fileId: own } },
          { id: "b", shape: "process", x: 0, y: 200, w: 160, h: 120, text: "Theirs", color: "neutral", image: { fileId: foreign } },
        ],
      }),
    );
    const block: WireBlock = { id: ulid(), type: "flowchart", parentId: null, rank: "V", schemaVersion: SCHEMA_VERSION, text: [], props: { data, height: 440 } };
    const docId = await noteWith(a, "Chart", [block]);
    await t.run(async (ctx) => {
      const docOf = async (publicId: string) => (await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", publicId)).unique())!._id;
      for (const [publicId, documentId] of [
        [own, await docOf(docId)],
        [foreign, await docOf(other)],
      ] as const) {
        const storageId = await ctx.storage.store(new Blob(["png"], { type: "image/png" }));
        await ctx.db.insert("files", { publicId, storageId, ownerProfileId: a.profileId as Id<"profiles">, documentId, uploadedBy: a.profileId as Id<"profiles">, filename: "p.png", mimeType: "image/png", size: 3, sha256: "", kind: "image", status: "ready", createdAt: Date.now() });
      }
    });
    const link = await a.as.mutation(api.sharing.createPublicLink, { documentId: docId });
    const r = await t.mutation(api.sharing.openPublicLink, { token: link.token, serverSecret: secret, clientKey: "client-fc-images" });
    if (r.status !== "ok") throw new Error(r.status);
    expect(Object.keys(r.fileUrls)).toEqual([own]);
    expect(r.fileUrls[own]).toMatch(new RegExp(`/files/${own}\\?exp=\\d+&sig=`));
  });
});
