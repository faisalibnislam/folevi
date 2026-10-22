// Result openers (docs/E2EE_DESIGN.md §6.4 "decode", WP7). Convex results carry sealed content in the shapes
// WP3 and WP4 return (convex/lib/e2ee/sealedRows.ts): a sealed block is a SealedWireBlock (placeholders plus
// `sealed`), a sealed note's summary carries `sealed: { title, appearance, meta? }`, a folder `sealedName`, a
// comment `sealedBody`, a version `sealedName` and SealedVersionContent. `openDeep` walks a result and puts
// the plaintext back where the caller expects it; the few functions whose results need more (versions,
// version content, files, notifications) have their own decoders on top.
//
// Results are never changed in place (the Convex client keeps them); every opened object is a copy.
import { fromBase64Url, type Bytes } from "@folevi/local-store/e2ee";
import { HIDDEN_PAGE_LABEL } from "@/lib/local/functions/shared";
import type { WireBlock } from "@folevi/editor-schema";
import { isArrayBuffer, type OpenedDocumentFields, type SealedDocumentFields } from "../seal";
import type { SealedFileFields } from "../files";
import { scopeKeyOf, type E2eeSpace } from "./deps";
import type { Call, Decoder, RouterEnv } from "./types";

type Obj = Record<string, unknown>;

export interface DecodeHint {
  /** The note the content belongs to, when the result doesn't say (blocks.list's blocks). */
  documentId?: string | null;
  /** The space the call concerns. */
  space?: E2eeSpace | null;
}

const isBytes = (v: unknown): v is Bytes => isArrayBuffer(v) || ArrayBuffer.isView(v);
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v) && !isBytes(v);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

function isSealedBlockFields(v: unknown): v is { c: Bytes; mac: string; k: number; collapsed?: true } {
  return isObj(v) && isBytes(v.c) && typeof v.mac === "string" && typeof v.k === "number";
}

function isSealedDocFields(v: unknown): v is SealedDocumentFields {
  return isObj(v) && isObj(v.title) && isBytes(v.title.c) && isObj(v.appearance) && isBytes(v.appearance.c);
}

function isSealedField(v: unknown): v is { c: Bytes; k: number } {
  return isObj(v) && isBytes(v.c) && typeof v.k === "number";
}

const PAGE_LINK = (n: unknown): n is { type: "pageLink"; documentId: string; label?: string } =>
  isObj(n) && n.type === "pageLink" && typeof n.documentId === "string";

/**
 * Page links and page cards in an opened block show the linked note's current title, from what the space
 * index has opened (§6.7: the server can't relabel sealed blocks). Links to notes it doesn't know keep what
 * the block says, except a sealed note's placeholder label.
 */
export function relabel(block: WireBlock, label: (id: string) => { title: string; icon: string | null } | null): WireBlock {
  let next = block;
  const props = block.props as Obj;
  if (block.type === "page" && typeof props.documentId === "string") {
    const l = label(props.documentId);
    if (l) {
      const p: Obj = { ...props, titleCache: l.title || "Untitled" };
      if (l.icon) p.iconCache = l.icon;
      else delete p.iconCache;
      next = { ...next, props: p };
    }
  }
  const nodes = (list: unknown): unknown =>
    Array.isArray(list) && list.some(PAGE_LINK)
      ? list.map((n) => {
          if (!PAGE_LINK(n)) return n;
          const l = label(n.documentId);
          return l ? { ...n, label: l.title || "Untitled" } : n.label ? n : { ...n, label: HIDDEN_PAGE_LABEL };
        })
      : list;
  if (Array.isArray(block.text) && block.text.some(PAGE_LINK)) next = { ...next, text: nodes(block.text) as WireBlock["text"] };
  const rows = block.type === "table" && Array.isArray(props.rows) ? (props.rows as unknown[][]) : null;
  if (rows && rows.some((r) => Array.isArray(r) && r.some((c) => Array.isArray(c) && c.some(PAGE_LINK)))) {
    next = { ...next, props: { ...(next.props as Obj), rows: rows.map((r) => (Array.isArray(r) ? r.map(nodes) : r)) } };
  }
  return next;
}

/** The spaces a sealed folder name may belong to: the hinted one first. */
function candidateSpaces(env: RouterEnv, hint: DecodeHint): E2eeSpace[] {
  const out: E2eeSpace[] = [];
  if (hint.space) out.push(hint.space);
  if (hint.documentId) {
    const d = env.spaces.document(hint.documentId);
    const s = d ? env.spaces.get(d.scope) : null;
    if (s && !out.includes(s)) out.push(s);
  }
  for (const s of env.spaces.list()) if (!out.includes(s)) out.push(s);
  return out;
}

/** A sealed folder or tag name (both sealed with the space's "space/meta", each with its own context). */
async function openFolderName(env: RouterEnv, hint: DecodeHint, id: string, c: Bytes): Promise<string | null> {
  for (const s of candidateSpaces(env, hint)) {
    try {
      const name = await env.sealer.openFolderName(s.scope, s.scopeId, id, c);
      env.spaces.noteRef("folder", id, s.scope);
      return name;
    } catch {
      // Not this space's folder.
    }
    try {
      const name = await env.sealer.openTagName(s.scope, s.scopeId, id, c);
      env.spaces.noteRef("tag", id, s.scope);
      return name;
    } catch {
      // Not this space's tag either.
    }
  }
  return null;
}

/** A note's opened title for an object that names it (documentTitle, breadcrumbs). */
async function openTitleOf(env: RouterEnv, documentId: string, sealed: SealedDocumentFields): Promise<OpenedDocumentFields | null> {
  try {
    const opened = await env.sealer.openDocumentFields(documentId, sealed);
    const known = env.spaces.document(documentId);
    if (known) env.spaces.noteDocument(documentId, known.scope, true, { title: opened.title, icon: opened.icon });
    return opened;
  } catch {
    console.warn(`[e2ee] A note's title couldn't be decrypted (${documentId}).`);
    return null;
  }
}

const DERIVED_FIELDS = ["excerpt", "preview", "wordCount", "charCount", "blockCount"] as const;

/** Copies a sealed note's derived fields from the replica that holds it, for the keys the result has. */
async function fillDerived(env: RouterEnv, documentId: string, obj: Obj, out: Obj): Promise<void> {
  if (!DERIVED_FIELDS.some((k) => k in obj)) return;
  const known = env.spaces.document(documentId);
  const space = known ? env.spaces.get(known.scope) : null;
  const store = space ? env.replicas.hostedStore?.(space.scope) : null;
  const doc = (await store?.get("documents", documentId)) as Obj | undefined;
  if (!doc) return;
  for (const k of DERIVED_FIELDS) if (k in obj && k in doc) out[k] = doc[k];
}

const MAX_DEPTH = 12;

/** Opens every sealed thing in a result (see the file comment). */
export async function openDeep(value: unknown, env: RouterEnv, hint: DecodeHint = {}, depth = 0): Promise<unknown> {
  if (depth > MAX_DEPTH || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return await Promise.all(value.map((v) => openDeep(v, env, hint, depth + 1)));
  if (!isObj(value)) return value;
  const obj = value;

  // A sealed block.
  if (obj.type === "sealed" && isSealedBlockFields(obj.sealed) && typeof obj.id === "string") {
    const documentId = str(obj.documentId) ?? hint.documentId ?? null;
    if (!documentId) return value;
    const rest: Obj = {};
    for (const [k, v] of Object.entries(obj)) if (!["sealed", "type", "schemaVersion", "text", "props"].includes(k)) rest[k] = v;
    const opened = await env.sealer.openBlockOrUnreadable(documentId, {
      id: obj.id,
      parentId: (obj.parentId as string | null) ?? null,
      rank: String(obj.rank ?? ""),
      revision: typeof obj.revision === "number" ? obj.revision : undefined,
      sealed: obj.sealed as never,
    });
    return { ...rest, ...relabel(opened, (id) => env.spaces.label(id)) };
  }

  const out: Obj = {};
  const here: DecodeHint = { ...hint, documentId: str(obj.documentId) ?? hint.documentId };

  // A sealed note (a summary, a breadcrumb, a title entry).
  if (isSealedDocFields(obj.sealed)) {
    const id = str(obj.id) ?? str(obj.documentId);
    if (id) {
      const opened = await openTitleOf(env, id, obj.sealed);
      for (const [k, v] of Object.entries(obj)) if (k !== "sealed") out[k] = v;
      if (opened) {
        out.title = opened.title;
        if ("icon" in obj) out.icon = opened.icon;
        if ("cover" in obj) out.cover = opened.cover;
        if ("style" in obj) out.style = opened.style;
        if ("templateKey" in obj) out.templateKey = opened.templateKey;
      }
      // What the server can't derive for a sealed note (excerpt, preview, counts) comes from the replica.
      await fillDerived(env, id, obj, out);
      here.documentId = str(obj.documentId) ?? (here.documentId || id);
      for (const [k, v] of Object.entries(out)) if (v && typeof v === "object") out[k] = await openDeep(v, env, { ...here, documentId: id }, depth + 1);
      return out;
    }
  }

  for (const [k, v] of Object.entries(obj)) {
    if (k === "sealedName" && isSealedField(v)) continue;
    if (k === "sealedBody" && isSealedField(v)) continue;
    out[k] = v && typeof v === "object" && !isBytes(v) ? await openDeep(v, env, here, depth + 1) : v;
  }

  // A sealed name: a version's (left for the versions decoder, which knows the note), or a folder's.
  if (isSealedField(obj.sealedName)) {
    if ("reason" in obj || typeof obj.id !== "string") out.sealedName = obj.sealedName;
    else {
      const name = await openFolderName(env, here, obj.id, obj.sealedName.c);
      if (name !== null) out.name = name;
      else out.sealedName = obj.sealedName;
    }
  }

  // A sealed comment body.
  if (isSealedField(obj.sealedBody)) {
    const commentId = str(obj.id) ?? str(obj.commentId);
    const documentId = here.documentId;
    if (commentId && documentId) {
      try {
        out.body = await env.sealer.openComment(documentId, commentId, obj.sealedBody.c);
        env.spaces.noteRef("comment", commentId, env.spaces.document(documentId)?.scope ?? "", documentId);
      } catch {
        console.warn(`[e2ee] A comment couldn't be decrypted (${commentId}).`);
        out.body = [{ type: "text", text: "This comment couldn't be decrypted." }];
      }
    }
  }
  return out;
}

// ---- decoders ---------------------------------------------------------------------------------------------

const hintOf = (call: Call): DecodeHint => ({ documentId: str(call.args.documentId) ?? call.res.documentId, space: call.res.space });

/** The default: open everything the result carries. */
export const generic: Decoder = async (value, call, env) => await openDeep(value, env, hintOf(call));

/** documents.versions: names opened, titles from the note (a sealed version's title is ""), ids remembered. */
export const versions: Decoder = async (value, call, env) => {
  const opened = (await openDeep(value, env, hintOf(call))) as Obj | null;
  const documentId = str(call.args.documentId);
  if (!opened || !documentId || !Array.isArray(opened.versions)) return opened;
  const scope = env.spaces.document(documentId)?.scope ?? (call.res.space ? scopeKeyOf(call.res.space.scope) : "");
  const current = env.spaces.label(documentId);
  opened.versions = await Promise.all(
    (opened.versions as Obj[]).map(async (v) => {
      const id = str(v.id);
      if (id) env.spaces.noteRef("snapshot", id, scope, documentId);
      if (v.sealed !== true) return v;
      const out: Obj = { ...v };
      delete out.sealed;
      delete out.sealedName;
      if (!out.title && current) out.title = current.title;
      if (id && isSealedField(v.sealedName)) {
        try {
          out.name = await env.sealer.openVersionName(documentId, id, v.sealedName.c);
        } catch {
          out.name = null;
        }
      }
      return out;
    }),
  );
  return opened;
};

interface SealedVersionJson {
  e2ee: 1;
  title: { c: string; k: number };
  appearance: { c: string; k: number };
  meta?: { c: string; k: number };
  blocks: { id: string; parentId: string | null; rank: string; c: string; k: number; collapsed?: true }[];
}

const b64 = (s: string): Bytes => fromBase64Url(s).slice().buffer as ArrayBuffer;

/** documents.snapshotContent: a sealed version's SealedVersionContent opened into the plaintext content JSON. */
/** A SealedVersionContent opened: its title, look and blocks as the plaintext version content has them. */
async function openSealedVersion(env: RouterEnv, call: Call, documentId: string, parsed: SealedVersionJson): Promise<{ title: string; icon: string | null; style: unknown; blocks: WireBlock[] }> {
  const [title, appearance, blocks] = await Promise.all([
    env.sealer.openTitle(documentId, b64(parsed.title.c)).catch(() => ""),
    env.sealer.openAppearance(documentId, b64(parsed.appearance.c)).catch(() => ({ icon: null, cover: undefined, style: undefined })),
    Promise.all(
      parsed.blocks.map((b) =>
        env.sealer
          .openBlockOrUnreadable(documentId, { id: b.id, parentId: b.parentId, rank: b.rank, sealed: { c: b64(b.c), k: b.k, mac: "", ...(b.collapsed ? { collapsed: true as const } : {}) } })
          .then((o) => relabel(o, (id) => env.spaces.label(id)))
          .then(async (o) => {
            // A version's blocks carry no revision; the note's own block has one (what a restore compares).
            const store = call.res.space ? env.replicas.hostedStore?.(call.res.space.scope) : null;
            const live = (await store?.get("blocks", o.id, documentId)) as { revision?: number } | undefined;
            return live?.revision !== undefined ? { ...o, revision: live.revision } : o;
          }),
      ),
    ),
  ]);
  return { title, icon: appearance.icon, style: appearance.style, blocks };
}

/** documents.snapshotContent: a sealed version's SealedVersionContent opened into the plaintext content JSON. */
export const snapshotContent: Decoder = async (value, call, env) => {
  const v = value as Obj | null;
  if (!v || v.sealed !== true || typeof v.content !== "string") return await generic(value, call, env);
  const snapshotId = str(call.args.snapshotId);
  const documentId = (snapshotId && env.spaces.ref("snapshot", snapshotId)?.documentId) ?? call.res.documentId;
  if (!documentId) return { ...v, content: null };
  const out: Obj = { ...v, content: JSON.stringify(await openSealedVersion(env, call, documentId, JSON.parse(v.content) as SealedVersionJson)) };
  delete out.sealed;
  return out;
};

/**
 * changes.note for a sealed note: the changed lines as they were (`previousSealed`, ciphertext of the version
 * from when the person last looked) opened into `previous`, as a plain note's comes, so the Changes view and
 * the undo composer read one shape. The version's id is remembered (it belongs to this note).
 */
export const changesNote: Decoder = async (value, call, env) => {
  const opened = (await openDeep(value, env, hintOf(call))) as Obj | null;
  const documentId = str(call.args.documentId);
  if (!opened || !documentId) return opened;
  const sealed = opened.previousSealed as SealedVersionJson | null | undefined;
  if (str(opened.seenVersionId)) env.spaces.noteRef("snapshot", opened.seenVersionId as string, env.spaces.document(documentId)?.scope ?? "", documentId);
  if (!sealed || !Array.isArray(sealed.blocks)) return opened;
  const out: Obj = { ...opened, previous: (await openSealedVersion(env, call, documentId, sealed)).blocks };
  delete out.previousSealed;
  return out;
};

/** notifications.list: a sealed note's current title opened (the stored sentence stays generic, §7.7). */
export const notifications: Decoder = async (value, call, env) => {
  const opened = await openDeep(value, env, hintOf(call));
  const fill = async (n: unknown): Promise<unknown> => {
    if (!isObj(n)) return n;
    if (n.sealedDocument === true && isSealedDocFields(n.documentSealed) && typeof n.documentId === "string") {
      const t = await openTitleOf(env, n.documentId, n.documentSealed);
      const out: Obj = { ...n, documentTitle: t ? t.title || "Untitled" : n.documentTitle };
      delete out.documentSealed;
      return out;
    }
    return n;
  };
  if (Array.isArray(opened)) return await Promise.all(opened.map(fill));
  if (isObj(opened)) {
    const out: Obj = { ...opened };
    for (const [k, v] of Object.entries(out)) if (Array.isArray(v)) out[k] = await Promise.all(v.map(fill));
    return out;
  }
  return opened;
};

/** files.urls: a sealed file's url becomes a `blob:` URL of its opened bytes, with its opened name and type. */
export const fileUrls: Decoder = async (value, call, env) => {
  if (!isObj(value)) return value;
  const out: Obj = {};
  await Promise.all(
    Object.entries(value).map(async ([fileId, entry]) => {
      if (!isObj(entry) || !isObj(entry.sealed)) {
        out[fileId] = entry;
        return;
      }
      const sealed = entry.sealed as unknown as SealedFileFields;
      const documentId = str(entry.documentId) ?? env.spaces.ref("file", fileId)?.documentId ?? call.res.documentId;
      if (!documentId) return;
      try {
        const opened = await env.files.open(fileId, documentId, String(entry.url), sealed);
        const { sealed: _s, ...rest } = entry;
        void _s;
        out[fileId] = {
          ...rest,
          url: "tooLarge" in opened ? "" : opened.url,
          ...("tooLarge" in opened ? { tooLargeToOpen: true } : {}),
          filename: opened.meta.name,
          mimeType: opened.meta.mime,
          size: sealed.plainSize,
          width: opened.meta.width ?? null,
          height: opened.meta.height ?? null,
          palette: (opened.meta.palette as never) ?? (rest as Obj).palette ?? null,
        };
      } catch {
        console.warn(`[e2ee] A file couldn't be decrypted (${fileId}).`);
      }
    }),
  );
  return out;
};
