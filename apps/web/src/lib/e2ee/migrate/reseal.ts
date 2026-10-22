// Re-sealing (docs/E2EE_DESIGN.md §4.9, §6.9 "Re-seal", WP8): changing one note's key (a link revoked, a guest
// removed, every note after a space key rotation) and re-encrypting what was sealed under older note keys.
//
// A new note key goes up with e2ee.grants.rotateNoteKey, wrapped by the space's current key, for each guest the
// page is still shared with (sealed to their account key, with a signed note-grant statement) and for each of
// this person's encrypted links whose secret this person kept (features' link records, links.ts). Rows sealed
// under older versions are then sealed again: blocks with resealBlocks (rows whose revision moved are skipped:
// their new content already used the new key), the title, look and comments under a hold, records, versions.
import { ctx as aad, linkWrapKey, randomBytes, sealRecord, sealTo, signStatement, toBase64Url, toWireBytes, verifyStatement, type AccountKeys } from "@folevi/local-store/e2ee";
import type { WireBlock } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { call, checkStop, loadNoteKeys, migrate, unb64, type MigrateEnv } from "./env";
import { allBlocks, getDocument, sealVersionContent } from "./seal";

/** What rotating a note's key needs beyond the migration's environment. */
export interface RotateDeps {
  /** The person's account keys (signs the guests' note-grant statements). */
  accountKeys(): AccountKeys;
  /** The person's profile id (the statement's `grantedBy`). */
  profileId: string;
  /** The secrets of this person's encrypted links to the note that should keep working. */
  linkSecrets?(documentId: string): Promise<{ linkId: string; secret: Uint8Array }[]>;
  now?(): number;
}

interface AudienceRow {
  profileId: string;
  keys: { epoch: number; x25519Pub: ArrayBuffer; ed25519Pub: ArrayBuffer; statement: { kind: "account-key"; body: string; sig: string } } | null;
}

/**
 * Makes note key v(n+1) for one note and uploads its wraps. Returns the new version. `dropLinks` and
 * `dropPeople` are left out (a revoked link, a removed guest).
 */
export async function rotateNote(env: MigrateEnv, deps: RotateDeps, documentId: string, o: { dropLinks?: string[]; dropPeople?: string[] } = {}): Promise<number> {
  const newest = await loadNoteKeys(env, documentId);
  if (newest < 1) throw new Error("This note has no key yet.");
  const version = newest + 1;
  const sk = await env.keyring.spaceKeys(env.space.scope);
  const raw = randomBytes(32);
  try {
    const wraps: Record<string, unknown>[] = [];
    const spaceWrapped = await sealRecord(sk.wrap, sk.version, aad.noteKeySpace(documentId, version, env.space.scopeId, sk.version), raw, { compress: false });
    wraps.push({ documentId, version, wrappedBy: "space", spaceVersion: sk.version, wrapped: toWireBytes(spaceWrapped) });

    const audience = ((await call.query(env, api.e2ee.grants.noteAudience, { documentId })) as AudienceRow[] | null) ?? [];
    const drop = new Set(o.dropPeople ?? []);
    for (const a of audience) {
      if (!a.keys || drop.has(a.profileId)) continue;
      const ed = new Uint8Array(a.keys.ed25519Pub);
      const x = new Uint8Array(a.keys.x25519Pub);
      // Their account-key statement must name these keys and verify (a server can't swap in its own key unseen).
      if (!(await verifyStatement(ed, a.keys.statement))) continue;
      const body = JSON.parse(a.keys.statement.body) as { profileId?: string; x25519Pub?: string; ed25519Pub?: string };
      if (body.profileId !== a.profileId || body.x25519Pub !== toBase64Url(x) || body.ed25519Pub !== toBase64Url(ed)) continue;
      const wrapped = await sealTo(x, aad.noteKeyGrant(documentId, version, a.profileId), raw);
      const statement = await signStatement(deps.accountKeys().ed25519.privateKey, "note-grant", {
        documentId,
        version,
        profileId: a.profileId,
        granteeX25519Pub: toBase64Url(x),
        grantedBy: deps.profileId,
        at: deps.now?.() ?? Date.now(),
      });
      wraps.push({ documentId, version, wrappedBy: "grant", profileId: a.profileId, wrapped: toWireBytes(wrapped), statement });
    }

    const dropLinks = new Set(o.dropLinks ?? []);
    for (const l of (await deps.linkSecrets?.(documentId)) ?? []) {
      if (dropLinks.has(l.linkId)) continue;
      const key = await linkWrapKey(l.secret.slice());
      const wrapped = await sealRecord(key, version, aad.noteKeyLink(documentId, version, l.linkId), raw, { compress: false });
      wraps.push({ documentId, version, wrappedBy: "link", linkId: l.linkId, wrapped: toWireBytes(wrapped) });
    }

    await call.mutation(env, api.e2ee.grants.rotateNoteKey, { documentId, version, wraps: wraps as never });
    await env.keyring.addNoteKeys([{ documentId, version, wrappedBy: "space", spaceVersion: sk.version, wrapped: toWireBytes(spaceWrapped), scope: env.space.scope }]);
    return version;
  } finally {
    raw.fill(0);
  }
}

/**
 * Wraps the keys of a note's files that are under an older note key with the newest (e2ee.files.oldKeyFiles /
 * rewrapKeys): the bytes and their metadata stay as they are. Returns how many moved.
 */
export async function rewrapFileKeys(env: MigrateEnv, documentId: string): Promise<number> {
  const old = ((await call.query(env, api.e2ee.files.oldKeyFiles, { documentId })) as { fileId: string; k: number; key: ArrayBuffer }[] | null) ?? [];
  if (!old.length) return 0;
  const nk = await env.keyring.noteKeys(documentId);
  const files = [];
  for (const f of old) {
    const raw = await env.sealer.openFileKey(documentId, f.fileId, f.key);
    try {
      const key = await sealRecord(nk.files, nk.version, aad.fileKey(documentId, f.fileId), raw, { compress: false });
      files.push({ fileId: f.fileId, key: toWireBytes(key), k: nk.version });
    } finally {
      raw.fill(0);
    }
  }
  for (let i = 0; i < files.length; i += 200) await call.mutation(env, api.e2ee.files.rewrapKeys, { documentId, files: files.slice(i, i + 200) });
  return files.length;
}

/** Re-seals everything of one note still under an older note key. Returns whether anything changed. */
export async function resealDocument(env: MigrateEnv, documentId: string): Promise<boolean> {
  const newest = await loadNoteKeys(env, documentId);
  if (newest < 1) return false;
  let changed = (await rewrapFileKeys(env, documentId)) > 0;

  for (let round = 0; round < 3; round++) {
    const old = (await allBlocks(env, documentId)).filter((r) => r.block.sealed && r.block.sealed.k < newest);
    if (!old.length) break;
    const blocks = [];
    for (const r of old) {
      const opened = await env.sealer.openBlock(documentId, { id: r.block.id, parentId: r.block.parentId, rank: r.block.rank, sealed: r.block.sealed! });
      const { revision: _revision, ...plain } = opened;
      void _revision;
      const s = (await env.sealer.sealBlock(documentId, plain as WireBlock)).sealed;
      blocks.push({ blockId: r.block.id, revision: r.revision, sealed: { c: s.c, mac: s.mac, k: s.k, ...(s.collapsed ? { collapsed: true } : {}) }, ...(s.syncedSource ? { syncedSource: s.syncedSource } : {}), ...(s.mentions?.length ? { mentionIds: s.mentions } : {}) });
    }
    let skipped = 0;
    for (let i = 0; i < blocks.length; i += 200) {
      const r = (await call.mutation(env, migrate.resealBlocks as never, { documentId, blocks: blocks.slice(i, i + 200) })) as { skipped?: string[] } | null;
      skipped += r?.skipped?.length ?? 0;
    }
    changed = true;
    if (!skipped) break;
  }

  // The title, look and comments are written under a hold (sealDocumentFields, sealComments), ended by finishDocument.
  const got = await getDocument(env, documentId);
  const sealed = got?.document.sealed;
  const extras = (await call.query(env, migrate.plainExtras as never, { documentId })) as { comments: { commentId: string; sealedBody?: { c: ArrayBuffer; k: number } }[] };
  const oldComments = extras.comments.filter((c) => c.sealedBody && c.sealedBody.k < newest);
  const oldFields = sealed && (sealed.title.k < newest || sealed.appearance.k < newest || (sealed.meta && sealed.meta.k < newest));
  if (sealed && (oldFields || oldComments.length)) {
    await call.mutation(env, migrate.beginDocument as never, { documentId, deviceId: env.deviceId });
    const fields = await env.sealer.openDocumentFields(documentId, sealed);
    const title = await env.sealer.sealTitle(documentId, fields.title);
    const appearance = await env.sealer.sealAppearance(documentId, { icon: fields.icon, cover: fields.cover, style: fields.style });
    const meta = sealed.meta ? await env.sealer.sealMeta(documentId, { ...(fields.templateKey ? { templateKey: fields.templateKey } : {}), ...(fields.row ? { row: fields.row } : {}) }) : undefined;
    const pulled = (await call.query(env, api.e2ee.pull.document, { documentId })) as { document: { fileIds?: string[] } } | null;
    await call.mutation(env, migrate.sealDocumentFields as never, { documentId, deviceId: env.deviceId, sealedTitle: { c: title.c, mac: title.mac }, sealedAppearance: appearance, ...(meta ? { sealedMeta: meta } : {}), fileIds: pulled?.document.fileIds ?? [] });
    const comments = [];
    for (const c of oldComments) {
      const body = await env.sealer.openComment(documentId, c.commentId, c.sealedBody!.c);
      comments.push({ commentId: c.commentId, sealedBody: (await env.sealer.sealComment(documentId, c.commentId, body)).c });
    }
    for (let i = 0; i < comments.length; i += 200) await call.mutation(env, migrate.sealComments as never, { documentId, deviceId: env.deviceId, comments: comments.slice(i, i + 200) });
    await call.mutation(env, migrate.finishDocument as never, { documentId, deviceId: env.deviceId, records: [] });
    changed = true;
  }

  // Records under the note (collections, found text, this person's study schedules).
  const pulled = (await call.query(env, api.e2ee.pull.document, { documentId })) as { records: { kind: string; recordId: string; keyVersion: number; sealed: ArrayBuffer; rev: number }[] } | null;
  for (const r of pulled?.records ?? []) {
    if (r.keyVersion >= newest) continue;
    checkStop(env);
    const value = await env.sealer.openRecordValue({ documentId }, env.space.scopeId, r.kind, r.recordId, r.sealed);
    const s = await env.sealer.sealRecordValue({ documentId }, env.space.scopeId, r.kind, r.recordId, value);
    await call.mutation(env, api.e2ee.content.putRecord, { scope: env.space.scope, kind: r.kind as never, recordId: r.recordId, documentId, sealed: s.sealed, keyVersion: s.keyVersion, baseRev: r.rev });
    changed = true;
  }

  // History, version by version (§4.9 "History is re-sealed too").
  const versions = (await call.query(env, api.documents.versions, { documentId })) as { versions: { id: string; sealed?: true; sealedName?: { c: ArrayBuffer; k: number } | null }[] } | null;
  for (const v of versions?.versions ?? []) {
    if (!v.sealed) continue;
    checkStop(env);
    const got = (await call.query(env, api.documents.snapshotContent, { snapshotId: v.id })) as { content: string | null } | null;
    if (!got?.content) continue;
    const parsed = JSON.parse(got.content) as { e2ee?: 1; title: { c: string; k: number }; appearance: { c: string; k: number }; blocks: { id: string; parentId: string | null; rank: string; c: string; k: number; mac?: string; collapsed?: true }[] };
    if (parsed.e2ee !== 1) continue;
    const stale = parsed.title.k < newest || parsed.appearance.k < newest || parsed.blocks.some((b) => b.k < newest) || (v.sealedName && v.sealedName.k < newest);
    if (!stale) continue;
    const look = await env.sealer.openAppearance(documentId, unb64(parsed.appearance.c).buffer as ArrayBuffer);
    const blocks: WireBlock[] = [];
    for (const b of parsed.blocks) {
      const opened = await env.sealer.openBlock(documentId, { id: b.id, parentId: b.parentId, rank: b.rank, sealed: { c: unb64(b.c).buffer as ArrayBuffer, mac: b.mac ?? "", k: b.k, ...(b.collapsed ? { collapsed: true } : {}) } });
      blocks.push(opened);
    }
    const content = await sealVersionContent(env.sealer, documentId, { title: await env.sealer.openTitle(documentId, unb64(parsed.title.c).buffer as ArrayBuffer), icon: look.icon, cover: look.cover, style: look.style, blocks });
    const name = v.sealedName ? await env.sealer.openVersionName(documentId, v.id, v.sealedName.c) : null;
    const sealedName = name ? (await env.sealer.sealVersionName(documentId, v.id, name)).c : undefined;
    await call.mutation(env, migrate.sealSnapshot as never, { snapshotId: v.id, content, ...(sealedName ? { sealedName } : {}) });
    changed = true;
  }
  return changed;
}
