// Encrypted share links and published plain copies (docs/E2EE_DESIGN.md §9, WP8).
//
// An encrypted link: a random 32-byte secret s; the note key wrapped by HKDF(s, "link/wrap") (context
// note-key/<doc>/<v>/link/<linkId>) goes to sharing.createPublicLink; the URL is /s/<token>#k=<base64url(s)>.
// The fragment never reaches the server. The secret is also kept for its creator as a per-person `prefs`
// record under the note (sealed with the note key), so rotating the note's key (a guest removed, another
// link revoked) can wrap the new key for the links that stay.
//
// Opening (app/s/[token]/EncryptedShare.tsx): `openShare` reads the fragment, opens the note key with the link
// key, then the title, look, blocks, records and file metadata, all in the reader's browser.
//
// A published copy (§9.3) is plain on purpose: the device renders the note (link labels resolved, collections
// as read-only tables) and e2ee.links.publishCopy stores it.
import { ConvexError } from "convex/values";
import {
  ctx as aad,
  deriveNoteKeys,
  fromBase64Url,
  importAead,
  linkWrapKey,
  openFileStream,
  openRecord,
  randomBytes,
  sealRecord,
  sha256,
  toBase64Url,
  toWireBytes,
  type NoteKeys,
  type SpaceKeys,
} from "@folevi/local-store/e2ee";
import { blockFileIds, ulid, type WireBlock } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import type { LocalCollection, LocalDocument } from "@/lib/local/store";
import type { LocalReader } from "@/lib/local/registry";
import { liveBlocks, ReaderLabels, toWireBlock, withSyncedContent } from "@/lib/local/functions/shared";
import { Sealer, type SealedDocumentFields } from "./seal";
import type { FileMeta } from "./files";
import type { SharePayload } from "./sharePayload";
import { requireActiveRouter } from "./router/active";
import type { E2eeRouterClient } from "./router/client";
import type { KeyRingLike, PulledNoteKey } from "./router/deps";

/** §12 WP8 (WP9's share dialog passes these). */
export interface LinkOptions {
  expiresAt?: number;
  password?: string;
  theme?: string;
}

/** The record id of a link's kept secret (one per link, per person: kind `prefs`, under the note). */
export const linkRecordId = (linkId: string) => `link-${linkId}`;

/** The note key's raw bytes, from WP6's key ring (needed to wrap it for a link). */
async function rawNoteKey(keyring: KeyRingLike, documentId: string, version: number): Promise<Uint8Array> {
  const open = (keyring as KeyRingLike & { openNoteRaw?(documentId: string, version: number): Promise<Uint8Array> }).openNoteRaw;
  if (!open) throw new Error("This device can't share the note's key.");
  return await open.call(keyring, documentId, version);
}

function appOrigin(): string {
  return (typeof location !== "undefined" ? location.origin : process.env.NEXT_PUBLIC_APP_URL) ?? "https://app.folevi.com";
}

/** The link's URL: the token for the server, the secret (and, when needed, the space id) in the fragment. */
export function linkUrl(token: string, secret: Uint8Array, scopeId?: string): string {
  const s = scopeId ? `&s=${toBase64Url(new TextEncoder().encode(scopeId))}` : "";
  return `${appOrigin()}/s/${token}#k=${toBase64Url(secret)}${s}`;
}

/** Reads `#k=…&s=…`: the link secret (32 bytes) and the space id, or null when the key is missing or damaged. */
export function parseFragment(hash: string): { secret: Uint8Array; scopeId: string | null } | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const k = params.get("k");
  if (!k) return null;
  let secret: Uint8Array;
  try {
    secret = fromBase64Url(k);
  } catch {
    return null;
  }
  if (secret.length !== 32) return null;
  let scopeId: string | null = null;
  const s = params.get("s");
  if (s) {
    try {
      scopeId = new TextDecoder().decode(fromBase64Url(s));
    } catch {
      scopeId = null;
    }
  }
  return { secret, scopeId };
}

/**
 * §12 WP8: an encrypted link for a sealed note. The secret goes into the URL fragment only; its creator keeps
 * it sealed under the note (so later note keys can be wrapped for it).
 */
export async function createEncryptedLink(documentId: string, opts: LinkOptions = {}): Promise<{ url: string }> {
  const router = requireActiveRouter();
  return await createEncryptedLinkWith(router, documentId, opts);
}

export async function createEncryptedLinkWith(router: Pick<E2eeRouterClient, "env" | "spaces" | "replicas">, documentId: string, opts: LinkOptions = {}): Promise<{ url: string; linkId: string }> {
  const { env } = router;
  const doc = router.spaces.document(documentId);
  const space = doc ? router.spaces.get(doc.scope) : null;
  if (!doc?.sealed || !space) throw new ConvexError({ code: "invalid_argument", message: "This note isn't end-to-end encrypted." });
  const { version } = await env.keyring.noteKeys(documentId);
  const linkId = ulid();
  const secret = randomBytes(32);
  const raw = await rawNoteKey(env.keyring, documentId, version);
  let wrapped: Uint8Array;
  try {
    wrapped = await sealRecord(await linkWrapKey(secret.slice()), version, aad.noteKeyLink(documentId, version, linkId), raw, { compress: false });
  } finally {
    raw.fill(0);
  }
  const created = (await env.inner.mutation(api.sharing.createPublicLink, {
    documentId,
    ...(opts.expiresAt ? { expiresAt: opts.expiresAt } : {}),
    ...(opts.password ? { password: opts.password } : {}),
    ...(opts.theme ? { theme: opts.theme } : {}),
    e2ee: { noteVersion: version, wrapped: toWireBytes(wrapped) },
    linkId,
  } as never)) as { id: string; token: string };
  // Kept for this person only, sealed with the note key: anyone who can open it can read the note already.
  const kept = await env.sealer.sealRecordValue({ documentId }, space.scopeId, "prefs", linkRecordId(created.id), { linkId: created.id, secret: toBase64Url(secret) });
  await env.inner.mutation(api.e2ee.content.putRecord, { scope: space.scope, kind: "prefs", recordId: linkRecordId(created.id), documentId, sealed: kept.sealed, keyVersion: kept.keyVersion, baseRev: 0 }).catch(() => undefined);
  // A note hosting collections needs the space id to open them (their records' context names the space).
  const store = router.replicas.hostedStore?.(space.scope) ?? null;
  const hosts = store ? (await store.list("collections")).some((c) => c.documentId === documentId && c.deletedAt === null) : false;
  const url = linkUrl(created.token, secret, hosts ? space.scopeId : undefined);
  secret.fill(0);
  return { url, linkId: created.id };
}

/**
 * The secrets of this person's encrypted links to a note: the note's links (sharing.get) whose kept secret the
 * replica opened (the ingest keeps `prefs` records as opened values in meta, "record-value:prefs:<id>").
 */
export async function linkSecretsFor(router: Pick<E2eeRouterClient, "env" | "spaces" | "replicas">, documentId: string): Promise<{ linkId: string; secret: Uint8Array }[]> {
  const doc = router.spaces.document(documentId);
  const space = doc ? router.spaces.get(doc.scope) : null;
  const store = space ? (router.replicas.hostedStore?.(space.scope) ?? null) : null;
  if (!store) return [];
  let links: { id: string; encrypted?: true }[];
  try {
    links = (((await router.env.inner.query(api.sharing.get, { documentId })) as { links?: { id: string; encrypted?: true }[] } | null)?.links ?? []).filter((l) => l.encrypted);
  } catch {
    return [];
  }
  return await secretsFromMeta(store, links.map((l) => l.id));
}

async function secretsFromMeta(store: LocalReader, linkIds: string[]): Promise<{ linkId: string; secret: Uint8Array }[]> {
  const out: { linkId: string; secret: Uint8Array }[] = [];
  for (const linkId of linkIds) {
    const v = (await store.get("meta", `record-value:prefs:${linkRecordId(linkId)}`)) as { linkId?: string; secret?: string } | undefined;
    if (v?.secret && v.linkId === linkId) out.push({ linkId, secret: fromBase64Url(v.secret) });
  }
  return out;
}

/**
 * Revokes an encrypted link (§9.1): the link goes, its kept secret goes, and the note's key changes so
 * someone who saved the key can't read later edits; the note is re-sealed in the background.
 */
export async function revokeEncryptedLink(documentId: string, linkId: string): Promise<void> {
  const router = requireActiveRouter();
  const { env } = router;
  await env.inner.mutation(api.sharing.revokePublicLink, { linkId } as never);
  const doc = router.spaces.document(documentId);
  const space = doc ? router.spaces.get(doc.scope) : null;
  if (!space) return;
  const store = router.replicas.hostedStore?.(space.scope) ?? null;
  const meta = store ? ((await store.get("meta", `record:prefs:${linkRecordId(linkId)}`)) as { rev?: number } | undefined) : undefined;
  if (meta?.rev) await env.inner.mutation(api.e2ee.content.deleteRecord, { scope: space.scope, kind: "prefs", recordId: linkRecordId(linkId), documentId, baseRev: meta.rev }).catch(() => undefined);
  const { rotateNote, resealDocument } = await import("./migrate/reseal");
  const menv = { server: env.inner, sealer: env.sealer, keyring: env.keyring, deviceId: env.engine()?.deviceId ?? env.session.deviceId(), space: { scope: space.scope, scopeId: space.scopeId } };
  const profileId = space.scope.kind === "personal" ? space.scopeId.slice("personal:".length) : (router.spaces.list().find((s) => s.scope.kind === "personal")?.scopeId.slice("personal:".length) ?? "");
  await rotateNote(menv, { accountKeys: () => env.session.accountKeys(), profileId, linkSecrets: (id) => linkSecretsFor(router, id) }, documentId, { dropLinks: [linkId] });
  void resealDocument(menv, documentId).catch((e) => console.warn("[e2ee] Re-sealing after a link was revoked will finish later.", e instanceof Error ? e.name : "error"));
}

// ---- published plain copy (§9.3) ---------------------------------------------------------------------

/** A collection as a published page shows it (convex/sharing.ts PublicCollection), from the replica. */
export async function publicCollections(store: LocalReader, blocks: WireBlock[], documentId: string): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const docs = (await store.list("documents")) as LocalDocument[];
  for (const b of blocks) {
    const props = b.props as { collectionId?: unknown; viewId?: unknown };
    if (b.type !== "collection" || typeof props.collectionId !== "string" || out[props.collectionId]) continue;
    const c = (await store.get("collections", props.collectionId)) as LocalCollection | undefined;
    if (!c || c.deletedAt !== null || c.documentId !== documentId) continue;
    const properties = Object.values(c.properties).filter((p) => p.deletedAt === null).sort((x, y) => (x.rank < y.rank ? -1 : 1));
    const views = Object.values(c.views).filter((v) => v.deletedAt === null).sort((x, y) => (x.rank < y.rank ? -1 : 1));
    const view = views.find((v) => v.id === props.viewId) ?? views[0];
    if (!view) continue;
    const rows = docs
      .filter((d) => d.row && d.row.collectionId === c.id && d.row.deletedAt === null && !d.inTrash)
      .sort((x, y) => (x.row!.rank < y.row!.rank ? -1 : 1))
      .slice(0, 500)
      .map((d) => {
        const values: Record<string, unknown> = {};
        for (const p of properties) {
          const v = d.row!.values[p.id];
          if (v === undefined) continue;
          // As on a Standard shared page: relations as a count; people never by id.
          values[p.id] = p.type === "relation" ? (Array.isArray(v) ? v.length : 0) : p.type === "person" ? "A member" : v;
        }
        return { id: d.id, title: d.title, icon: d.icon ?? null, values };
      });
    out[c.id] = {
      name: c.name,
      viewType: view.type,
      config: view.config,
      properties: properties.map((p) => ({ id: p.id, name: p.name, type: p.type, options: p.options, formula: p.formula, numberFormat: p.numberFormat })),
      rows,
    };
  }
  return out;
}

/** The bytes of one of a sealed note's files, decrypted on this device (null when it can't be read here). */
async function plainFileOf(router: Pick<E2eeRouterClient, "env">, documentId: string, fileId: string): Promise<{ bytes: Uint8Array; name: string; mime: string } | null> {
  const urls = (await router.env.inner.query(api.files.urls, { fileIds: [fileId], now: Date.now() })) as Record<string, { url: string; sealed?: { key: ArrayBuffer; meta: ArrayBuffer; k: number; plainSize: number } } | undefined>;
  const entry = urls[fileId];
  if (!entry?.sealed) return null;
  const { bytes, meta } = await router.env.files.bytes(fileId, documentId, entry.url, entry.sealed);
  return { bytes, name: meta.name, mime: meta.mime };
}

/**
 * The copy's own plain files (§9.3): each file the copy shows is decrypted here and uploaded as a plain file of
 * the note for publishing (e2ee.links.generateFileUploadUrl, then files.finalize as any upload). Returns the
 * new id for each old one; a file that can't be read or uploaded is left out.
 */
export async function publishFiles(router: Pick<E2eeRouterClient, "env">, documentId: string, wanted: { fileId: string; kind: "image" | "file" | "cover" }[], o: { fetch?: typeof fetch } = {}): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const w of wanted) {
    if (out.has(w.fileId)) continue;
    try {
      const plain = await plainFileOf(router, documentId, w.fileId);
      if (!plain) continue;
      const target = (await router.env.inner.mutation(api.e2ee.links.generateFileUploadUrl, { documentId, filename: plain.name || "file", size: plain.bytes.length, mimeType: plain.mime || "application/octet-stream", kind: w.kind })) as { uploadUrl: string; intentId: string };
      const res = await (o.fetch ?? fetch)(target.uploadUrl, { method: "POST", headers: { "Content-Type": plain.mime || "application/octet-stream" }, body: plain.bytes as Uint8Array<ArrayBuffer> });
      if (!res.ok) continue;
      const { storageId } = (await res.json()) as { storageId: string };
      const done = (await router.env.inner.action(api.files.finalize, { intentId: target.intentId, storageId, sha256: hexOf(sha256(plain.bytes)) } as never)) as { fileId: string };
      out.set(w.fileId, done.fileId);
      plain.bytes.fill(0);
    } catch (e) {
      console.warn("[e2ee] A file of the published copy couldn't be added.", e instanceof Error ? e.name : "error");
    }
  }
  return out;
}

const hexOf = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

/** A block with its file ids swapped for the copy's (ids are unique ULIDs, so a text swap in its props is exact, flowchart data included). */
function withFiles(block: WireBlock, ids: Map<string, string>): WireBlock | null {
  const own = blockFileIds(block);
  if (own.some((id) => !ids.has(id))) return null;
  if (!own.length) return block;
  let props = JSON.stringify(block.props);
  for (const id of own) props = props.split(id).join(ids.get(id)!);
  return { ...block, props: JSON.parse(props) as WireBlock["props"] };
}

/**
 * §12 WP8: publishes a readable copy of a sealed note (after the person confirmed the §10.11 warning). The
 * copy is made on this device from the replica, its images and files uploaded as plain files of their own; it
 * doesn't follow later edits. `linkId` updates an existing published copy.
 */
export async function publishPlainCopy(documentId: string, o: { linkId?: string } = {}): Promise<{ url: string }> {
  return await publishPlainCopyWith(requireActiveRouter(), documentId, o);
}

export async function publishPlainCopyWith(router: Pick<E2eeRouterClient, "env" | "spaces" | "replicas">, documentId: string, o: { linkId?: string; fetch?: typeof fetch } = {}): Promise<{ url: string; linkId: string }> {
  const doc = router.spaces.document(documentId);
  const space = doc ? router.spaces.get(doc.scope) : null;
  const store = space ? (router.replicas.hostedStore?.(space.scope) ?? null) : null;
  if (!space || !store) throw new ConvexError({ code: "e2ee_unavailable", message: "This encrypted space is still opening on this device. Try again in a moment.", feature: "publish" });
  const note = (await store.get("documents", documentId)) as LocalDocument | undefined;
  if (!note) throw new ConvexError({ code: "not_found", message: "Document not found." });
  const own = (await liveBlocks(store, documentId)).map(toWireBlock);
  const labelled = await new ReaderLabels(store).blocks(await withSyncedContent(store, note, own));
  const plain = labelled.map(({ revision: _r, ...b }) => {
    void _r;
    return b as WireBlock;
  });
  const coverValue = (note.cover as { kind?: string; value?: unknown } | null)?.kind === "image" ? (note.cover as { value?: unknown }).value : null;
  const wanted: { fileId: string; kind: "image" | "file" | "cover" }[] = [];
  for (const b of plain) for (const id of blockFileIds(b)) wanted.push({ fileId: id, kind: b.type === "image" ? "image" : "file" });
  if (typeof coverValue === "string") wanted.push({ fileId: coverValue, kind: "cover" });
  const ids = await publishFiles(router, documentId, wanted, { fetch: o.fetch });
  const blocks = plain.map((b) => withFiles(b, ids)).filter((b): b is WireBlock => b !== null);
  const cover = typeof coverValue === "string" ? (ids.has(coverValue) ? { ...(note.cover as object), value: ids.get(coverValue) } : { kind: "none" as const }) : note.cover;
  const copy = {
    title: note.title,
    ...(note.icon ? { icon: note.icon } : {}),
    cover,
    style: note.style,
    blocks,
    collections: await publicCollections(store, blocks, documentId),
    fileIds: [...new Set(ids.values())],
  };
  const r = (await router.env.inner.mutation(api.e2ee.links.publishCopy, { documentId, ...(o.linkId ? { linkId: o.linkId } : {}), copy } as never)) as { linkId: string; token?: string };
  return { url: r.token ? `${appOrigin()}/s/${r.token}` : "", linkId: r.linkId };
}

// ---- opening a link in the reader's browser (no account) --------------------------------------------

export type { SharePayload } from "./sharePayload";

const ab = (text: string): ArrayBuffer => {
  const u = fromBase64Url(text);
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
};

/** A key ring that knows one note's key (a link reader's). */
class LinkKeyRing implements KeyRingLike {
  constructor(
    private readonly documentId: string,
    private readonly keys: NoteKeys & { version: number },
  ) {}
  async noteKeys(documentId: string): Promise<NoteKeys & { version: number }> {
    if (documentId !== this.documentId) throw new ConvexError({ code: "e2ee_no_key", message: "This link opens one note." });
    return this.keys;
  }
  async spaceKeys(): Promise<SpaceKeys & { version: number }> {
    throw new ConvexError({ code: "e2ee_no_key", message: "This link opens one note." });
  }
  async newNoteKey(): Promise<never> {
    throw new ConvexError({ code: "e2ee_no_key", message: "This link opens one note." });
  }
  async addNoteKeys(_rows: PulledNoteKey[]): Promise<void> {
    void _rows;
  }
  async linkNoteKey(): Promise<void> {}
}

export interface OpenedShare {
  title: string;
  icon: string | null;
  cover: unknown;
  style: unknown;
  blocks: WireBlock[];
  /** Decrypted images and files as `blob:` URLs, by file id. */
  fileUrls: Record<string, string>;
  /** Collections the note hosts (definitions only: a row is another note, which the link doesn't open). */
  collections: Record<string, unknown>;
  failedBlocks: number;
}

export type OpenShareResult = { ok: true; share: OpenedShare } | { ok: false; reason: "missing_key" | "wrong_key" };

/**
 * Opens an encrypted link's payload with the secret from the URL fragment. Everything happens here; nothing
 * opened is sent anywhere. Blocks that fail to open become the read-only "couldn't be decrypted" block.
 */
export async function openShare(payload: SharePayload, hash: string, o: { fetch?: typeof fetch; createUrl?: (b: Blob) => string } = {}): Promise<OpenShareResult> {
  const frag = parseFragment(hash);
  if (!frag) return { ok: false, reason: "missing_key" };
  const { documentId, linkId } = payload;
  let keys: NoteKeys & { version: number };
  try {
    const wrapKey = await linkWrapKey(frag.secret.slice());
    const raw = await openRecord(wrapKey, aad.noteKeyLink(documentId, payload.noteKey.version, linkId), fromBase64Url(payload.noteKey.wrapped));
    keys = { ...(await deriveNoteKeys(raw)), version: payload.noteKey.version };
  } catch {
    return { ok: false, reason: "wrong_key" };
  } finally {
    frag.secret.fill(0);
  }
  const sealer = new Sealer(new LinkKeyRing(documentId, keys));
  let title = "";
  let icon: string | null = null;
  let cover: unknown = { kind: "none" };
  let style: unknown = undefined;
  if (payload.title && payload.appearance) {
    const fields: SealedDocumentFields = { title: { c: ab(payload.title.c), k: payload.title.k, mac: payload.title.mac ?? "" }, appearance: { c: ab(payload.appearance.c), k: payload.appearance.k }, meta: payload.meta ? { c: ab(payload.meta.c), k: payload.meta.k } : null };
    try {
      const opened = await sealer.openDocumentFields(documentId, fields);
      ({ title, icon, cover, style } = opened);
    } catch {
      title = "";
    }
  }
  let failedBlocks = 0;
  const blocks: WireBlock[] = [];
  for (const b of payload.blocks) {
    const shell = { id: b.id, parentId: b.parentId, rank: b.rank, sealed: { ...b.sealed, c: ab(b.sealed.c) } };
    try {
      blocks.push(await sealer.openBlock(documentId, shell));
    } catch {
      failedBlocks++;
      blocks.push(await sealer.openBlockOrUnreadable(documentId, shell));
    }
  }
  const fileUrls: Record<string, string> = {};
  for (const f of payload.files) {
    try {
      const raw = await sealer.openFileKey(documentId, f.id, ab(f.sealed.key));
      try {
        const meta = (await Sealer.openFileMeta(raw, documentId, f.id, ab(f.sealed.meta))) as FileMeta & { sourceFileId?: string };
        if (f.sealed.plainSize > 100 * 1024 * 1024) continue;
        const res = await (o.fetch ?? fetch)(f.url, { referrerPolicy: "no-referrer" });
        if (!res.ok) continue;
        const bytes = await openFileStream(await importAead(raw.slice()), aad.file(meta.sourceFileId ?? f.id), new Uint8Array(await res.arrayBuffer()));
        fileUrls[f.id] = (o.createUrl ?? URL.createObjectURL)(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: meta.mime || "application/octet-stream" }));
      } finally {
        raw.fill(0);
      }
    } catch {
      // A file that can't be opened shows as missing.
    }
  }
  const collections: Record<string, unknown> = {};
  const scopeId = payload.scopeId ?? frag.scopeId;
  if (scopeId) {
    for (const r of payload.records) {
      if (r.kind !== "collection") continue;
      try {
        const c = (await sealer.openRecordValue({ documentId }, scopeId, "collection", r.recordId, ab(r.sealed))) as LocalCollection;
        const view = Object.values(c.views).filter((v) => v.deletedAt === null).sort((x, y) => (x.rank < y.rank ? -1 : 1))[0];
        if (!view) continue;
        collections[r.recordId] = {
          name: c.name,
          viewType: view.type,
          config: view.config,
          properties: Object.values(c.properties).filter((p) => p.deletedAt === null).sort((x, y) => (x.rank < y.rank ? -1 : 1)).map((p) => ({ id: p.id, name: p.name, type: p.type, options: p.options, formula: p.formula, numberFormat: p.numberFormat })),
          rows: [],
        };
      } catch {
        // Left out.
      }
    }
  }
  return { ok: true, share: { title, icon, cover, style, blocks, fileUrls, collections, failedBlocks } };
}
