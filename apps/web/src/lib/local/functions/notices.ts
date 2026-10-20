// Local-only: a note's "Changed on another device" notices and its placeholder state (lib/local/localApi.ts).
// The library store writes the notices from the note file (store/materialize.ts); here they're only read,
// and dismissed (store/project.ts writes the dismissal into the note's file, so it holds on every device).
import { localApi, type NoteNotice } from "../localApi";
import { defineLocal } from "../registry";
import { Devices, requireProfile } from "./shared";

defineLocal(localApi.noteStatus, "query", async (ctx, args) => {
  await requireProfile(ctx);
  const doc = await ctx.db.get("documents", args.documentId);
  if (!doc) return null;
  const devices = new Devices(ctx.db, ctx.deviceId);
  const notices: NoteNotice[] = [];
  for (const n of await ctx.db.list("notices", doc.id)) {
    if (n.dismissed) continue;
    notices.push({ id: n.id, blockId: n.blockId, field: n.field, kind: n.kind, versionId: n.versionId, otherDevice: n.other ? (await devices.get(n.other)).name : null, at: n.at });
  }
  notices.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
  return { pending: doc.pending ?? null, notices };
});

defineLocal(localApi.dismissNotice, "mutation", async (ctx, args) => {
  await requireProfile(ctx);
  const notice = await ctx.db.get("notices", args.noticeId, args.documentId);
  if (!notice || notice.dismissed) return null;
  ctx.db.put("notices", notice.id, { ...notice, dismissed: true }, args.documentId);
  return null;
});
