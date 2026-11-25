// Write calls the read-cost harness measures (library.test.ts).
import { api } from "../../../convex/_generated/api";
import { para, PERSONAL, ulid, type person } from "../helpers";

type Person = Awaited<ReturnType<typeof person>>;

export async function pushEdit(p: Person, documentId: string) {
  return await p.as.mutation(api.sync.push, {
    scope: PERSONAL,
    deviceId: "device-perf-writes",
    ops: [{ opId: ulid(), kind: "block.upsert", documentId, block: para(ulid(), "A new line typed in"), baseRevision: null, fields: ["content", "position"] }],
  });
}

export async function pushMove(p: Person, documentId: string, folderId: string) {
  return await p.as.mutation(api.documents.move, { documentId, folderId });
}
