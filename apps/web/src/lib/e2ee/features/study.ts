// Study schedules across encryption (docs/E2EE_DESIGN.md §6.7, "Settled while building WP3", WP8). Schedules
// are per person: the device converting a note carries only its own person's into `studyReview` records. Every
// other reader's device carries theirs (e2ee.migrate.plainStudy, then e2ee.content.putRecord, which deletes the
// server rows), and after someone else made a note readable again, puts theirs back (e2ee.migrate.restoreStudy,
// which drops the record). Schedules hold timing only, no text.
import { studyKindOf } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import type { LocalBlock, LocalDocument, LocalStudyReview } from "@/lib/local/store";
import type { LocalReader } from "@/lib/local/registry";
import type { Sealer } from "../seal";
import type { E2eeSpace } from "../router/deps";
import type { InnerClient } from "../router/types";
import { studyRecord } from "../migrate/seal";
import { studyRow, type StudyRow } from "../migrate/unseal";

export interface StudyDeps {
  server: Pick<InnerClient, "query" | "mutation">;
  sealer: Sealer;
  space: E2eeSpace;
  store: LocalReader;
  isSealed(documentId: string): boolean;
  /** Notes this device already looked at this session. */
  done: Set<string>;
}

/** This person's schedules of sealed notes still on the server, into their records. Returns how many moved. */
export async function carryStudy(d: StudyDeps): Promise<number> {
  let moved = 0;
  for (const doc of (await d.store.list("documents")) as LocalDocument[]) {
    if (d.done.has(doc.id) || !d.isSealed(doc.id) || doc.inTrash) continue;
    const cards = ((await d.store.list("blocks", doc.id)) as LocalBlock[]).filter((b) => b.deletedAt === null && studyKindOf({ type: b.type, props: b.props }) !== null);
    if (!cards.length) {
      d.done.add(doc.id);
      continue;
    }
    const rows = ((await d.server.query(api.e2ee.migrate.plainStudy, { documentId: doc.id })) as StudyRow[] | null) ?? [];
    for (const row of rows) {
      const r = await studyRecord({ sealer: d.sealer, space: d.space }, doc.id, row);
      // A record already there (another of this person's devices wrote it): written over at its revision.
      const rev = ((await d.store.get("meta", `record:studyReview:${r.recordId}`)) as { rev?: number } | undefined)?.rev ?? 0;
      await d.server.mutation(api.e2ee.content.putRecord, { scope: d.space.scope, kind: "studyReview", recordId: r.recordId, documentId: doc.id, sealed: r.sealed, keyVersion: r.keyVersion, baseRev: rev });
      moved++;
    }
    d.done.add(doc.id);
  }
  return moved;
}

/**
 * After a note became readable again (a space decrypted, a lock removed) on someone else's device: this
 * person's schedules in their records go back to the server. Only in spaces being decrypted or with locks.
 */
export async function restoreStudy(d: StudyDeps): Promise<number> {
  if (d.space.level !== "standard") return 0;
  const byDoc = new Map<string, LocalStudyReview[]>();
  for (const r of (await d.store.list("studyReviews")) as LocalStudyReview[]) {
    const list = byDoc.get(r.documentId) ?? [];
    list.push(r);
    byDoc.set(r.documentId, list);
  }
  let restored = 0;
  for (const [documentId, rows] of byDoc) {
    if (d.done.has(`restore:${documentId}`)) continue;
    // Still sealed (e2ee.pull.document answers only for sealed notes): nothing to do.
    const sealed = await d.server.query(api.e2ee.pull.document, { documentId }).catch(() => undefined);
    if (sealed === undefined || sealed !== null) continue;
    await d.server.mutation(api.e2ee.migrate.restoreStudy, { documentId, studyReviews: rows.map(studyRow) });
    d.done.add(`restore:${documentId}`);
    restored += rows.length;
  }
  return restored;
}
