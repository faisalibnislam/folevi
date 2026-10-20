// files.* in local mode (convex/files.ts). A note's attachments are stored in the library by content
// (files/<aa>/<sha256>, docs/LOCAL_MODE_PLAN.md §3.1): the bytes go in once through `client.local.putFile`
// (backend.ts, which runs `prepareUpload` then `commitUpload` here), with the server's checks: the real type
// read from the bytes, the size limits, image metadata stripped, a file that's an image filed as one.
//
// The account flow is three steps: generateUploadUrl (an upload address), a POST of the bytes, finalize. In
// local mode the uploader and the importer call putFile instead (lib/sync/uploads.ts, lib/app/identityImages.ts).
// The two functions still answer, so a caller that goes the long way works too: generateUploadUrl checks the
// upload as the server does and records it, the bytes go in with putFile (its file id stands for the storage
// id), and finalize files them as the recorded upload said.
//
// One person owns the library, so every file of it can be opened (`urls`) by its owner. Its address is the
// library's own (`shell().library.fileUrl`, served by the Mac app from the library folder); without a shell
// (tests, a development browser) it's an object URL of the bytes this page holds.
import { ulid } from "@folevi/editor-schema";
import { MAX_FILE_BYTES, MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS, safeFilename, sameBytes, sniff, sniffAudio, stripImageMetadata } from "@folevi/editor-schema/fileBytes";
import { api } from "@/lib/convex/api";
import { shell } from "@/lib/shell";
import { fail } from "../errors";
import { defineLocal, type LocalMutationCtx, type LocalReader } from "../registry";
import type { LocalFile } from "../store";
import { checkScope, requireProfile } from "./shared";

type UploadKind = "image" | "file" | "audio" | "avatar" | "logo" | "cover" | "attachment";
const KINDS = new Set<UploadKind>(["image", "file", "audio", "avatar", "logo", "cover", "attachment"]);
const INTENT_TTL_MS = 10 * 60_000;
const intentKey = (id: string) => `upload:${id}`;
/** Foli AI chat attachments (convex/lib/ai/attachments.ts MAX_ATTACHMENT_UPLOAD). */
const MAX_ATTACHMENT_UPLOAD = 14 * 1024 * 1024;
/** Profile pictures (convex/lib/identityImages.ts MAX_IDENTITY_IMAGE_BYTES, which imports server code). */
const MAX_IDENTITY_IMAGE_BYTES = 2 * 1024 * 1024;

function maxBytesFor(kind: UploadKind): number {
  if (kind === "attachment") return MAX_ATTACHMENT_UPLOAD;
  return kind === "file" || kind === "audio" ? MAX_FILE_BYTES : kind === "avatar" || kind === "logo" ? MAX_IDENTITY_IMAGE_BYTES : MAX_IMAGE_BYTES;
}

const unsupported = (message: string): never => fail("unsupported_file", message);

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** An upload's bytes as they'll be kept: checked, with their real type, an image's size, its final hash. */
export interface PreparedUpload {
  kind: UploadKind;
  name: string;
  documentId: string | null;
  bytes: Uint8Array;
  mimeType: string;
  width: number | null;
  height: number | null;
  sha256: string;
}

export interface UploadMeta {
  name: string;
  mimeType: string;
  kind: string;
  documentId?: string | null;
}

/**
 * The checks of the server's finalize (convex/files.ts): the size, the type read from the bytes (audio must
 * be a recording browsers play, an image kind must be an image), the pixel limit, metadata stripped. Runs
 * before the mutation that stores it, since it reads the bytes.
 */
export async function prepareUpload(blob: Blob, meta: UploadMeta): Promise<PreparedUpload> {
  const kind = meta.kind as UploadKind;
  if (!KINDS.has(kind)) fail("invalid_argument", "Unknown kind of file.");
  const max = maxBytesFor(kind);
  if (!blob.size || blob.size > max) fail("invalid_argument", `Files can be up to ${Math.round(max / 1024 / 1024)} MB.`);
  let bytes: Uint8Array = new Uint8Array(await blob.arrayBuffer());
  const audioMime = kind === "audio" || kind === "attachment" ? sniffAudio(bytes) : null;
  if (kind === "audio" && !audioMime) unsupported("Recordings must be WebM, Ogg, MP4, WAV or MP3 audio.");
  const sniffed = audioMime ? ({ kind: "file", mime: audioMime, risky: false } as const) : sniff(bytes);
  const wantsImage = kind !== "file" && kind !== "audio" && kind !== "attachment";
  if (wantsImage && sniffed.kind !== "image") unsupported("Images must be PNG, JPEG, GIF or WebP.");
  let width: number | null = null;
  let height: number | null = null;
  if (sniffed.kind === "image") {
    if (sniffed.width && sniffed.height && sniffed.width * sniffed.height > MAX_IMAGE_PIXELS) unsupported("That image is too large.");
    if (!sniffed.width || !sniffed.height) unsupported("That image couldn't be read. Try exporting it again as PNG or JPEG.");
    width = sniffed.width!;
    height = sniffed.height!;
    const stripped = stripImageMetadata(sniffed.mime, bytes);
    if (!sameBytes(stripped, bytes)) bytes = stripped;
  }
  return {
    kind: kind === "file" && sniffed.kind === "image" ? "image" : kind,
    name: safeFilename(meta.name),
    documentId: meta.documentId ?? null,
    bytes,
    mimeType: sniffed.mime,
    width,
    height,
    sha256: hex(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>)),
  };
}

/**
 * Where an upload may go (the server's generateUploadUrl): a profile picture is the library's own, a logo
 * belongs to a workspace (there are none here), a Foli AI attachment needs Foli AI on, and a note's file
 * needs the note.
 */
async function checkDestination(ctx: LocalMutationCtx, kind: UploadKind, documentId: string | null): Promise<void> {
  const profile = await requireProfile(ctx);
  if (kind === "avatar" || kind === "logo") {
    if (documentId) fail("invalid_argument", "Profile pictures and logos can't be attached to a page.");
    if (kind === "logo") fail("not_found", "Workspace not found.");
  } else if (kind === "attachment") {
    if (documentId) fail("invalid_argument", "Chat attachments aren't added to a page.");
    if (profile.aiEnabled === false) fail("forbidden", "Foli AI is turned off in your settings.");
  } else if (documentId) {
    const doc = await ctx.db.get("documents", documentId);
    if (!doc) fail("not_found", "Document not found.");
  }
}

/** Stores a prepared upload as a file of the library (and of its note, when it has one). */
export async function commitUpload(ctx: LocalMutationCtx, p: PreparedUpload): Promise<{ fileId: string; mimeType: string }> {
  await checkDestination(ctx, p.kind, p.documentId);
  const file: LocalFile = {
    id: ulid(),
    documentId: p.documentId,
    name: p.name,
    mimeType: p.mimeType,
    size: p.bytes.length,
    sha256: p.sha256,
    kind: p.kind,
    blob: new Blob([p.bytes as Uint8Array<ArrayBuffer>], { type: p.mimeType }),
    createdAt: ctx.now(),
    width: p.width,
    height: p.height,
  };
  ctx.db.put("files", file.id, file);
  return { fileId: file.id, mimeType: file.mimeType };
}

interface UploadIntent {
  kind: UploadKind;
  documentId: string | null;
  filename: string;
  expiresAt: number;
  consumedAt: number | null;
}

defineLocal(api.files.generateUploadUrl, "mutation", async (ctx, args) => {
  const kind = args.kind as UploadKind;
  if (kind !== "logo") checkScope(args.scope);
  await checkDestination(ctx, kind, args.documentId ?? null);
  const max = maxBytesFor(kind);
  if (!Number.isFinite(args.size) || args.size <= 0 || args.size > max) fail("invalid_argument", `Files can be up to ${Math.round(max / 1024 / 1024)} MB.`);
  const intentId = ulid();
  const intent: UploadIntent = { kind, documentId: args.documentId ?? null, filename: safeFilename(args.filename), expiresAt: ctx.now() + INTENT_TTL_MS, consumedAt: null };
  ctx.db.put("meta", intentKey(intentId), intent);
  // Not an address to POST to: the bytes go in with client.local.putFile, whose file id finalize takes.
  return { uploadUrl: `folevi-local-upload:${intentId}`, intentId };
});

defineLocal(api.files.finalize, "action", async (ctx, args) => {
  return await ctx.mutate(async (m) => {
    await requireProfile(m);
    const intent = (await m.db.get("meta", intentKey(args.intentId))) as UploadIntent | undefined;
    const file = await m.db.get("files", String(args.storageId));
    if (!intent || intent.consumedAt !== null || intent.expiresAt < m.now() || !file) unsupported("Upload expired. Try again.");
    m.db.put("meta", intentKey(args.intentId), { ...intent!, consumedAt: m.now() });
    m.db.put("files", file!.id, { ...file!, documentId: intent!.documentId, name: intent!.filename, kind: file!.kind === "image" && intent!.kind === "file" ? "image" : intent!.kind });
    return { fileId: file!.id, mimeType: file!.mimeType, width: file!.width ?? null, height: file!.height ?? null, size: file!.size };
  });
});

// ---- addresses ---------------------------------------------------------------------------------------

const objectUrls = new Map<string, string>();

/** Where this page reads a file's bytes: the library's address in the app, else an object URL of them. */
export function localFileUrl(file: Pick<LocalFile, "id" | "sha256" | "mimeType" | "blob">): string {
  const library = shell()?.library;
  if (library && /^[0-9a-f]{64}$/.test(file.sha256)) {
    try {
      return library.fileUrl(file.sha256, file.mimeType);
    } catch {
      // A shell without the library layer yet: the bytes this page has.
    }
  }
  let url = objectUrls.get(file.id);
  if (!url) {
    url = typeof URL.createObjectURL === "function" ? URL.createObjectURL(file.blob) : `folevi-local-file:${file.sha256}`;
    objectUrls.set(file.id, url);
  }
  return url;
}

/** The library's file, if there is one by that id (a note's, or one of its own: a profile picture, an import's). */
export async function fileById(db: LocalReader, id: string): Promise<LocalFile | null> {
  return (await db.get("files", id)) ?? null;
}

defineLocal(api.files.urls, "query", async (ctx, args) => {
  await requireProfile(ctx);
  const out: Record<string, { url: string; mimeType: string; filename: string; size: number; width: number | null; height: number | null; palette: LocalFile["palette"] | null }> = {};
  for (const id of args.fileIds.slice(0, 200)) {
    const file = await fileById(ctx.db, id);
    if (!file) continue;
    // A note's file goes with its note (deleted for good: gone); the library's own files are all its owner's.
    if (file.documentId && !(await ctx.db.get("documents", file.documentId))) continue;
    out[id] = { url: localFileUrl(file), mimeType: file.mimeType, filename: file.name, size: file.size, width: file.width ?? null, height: file.height ?? null, palette: file.palette ?? null };
  }
  return out;
});

// ---- colours of a note theme image ---------------------------------------------------------------------

const HEX = /^#[0-9a-f]{6}$/i;

defineLocal(api.files.setPalette, "mutation", async (ctx, args) => {
  await requireProfile(ctx);
  const file = await fileById(ctx.db, args.fileId);
  if (!file || (file.kind !== "cover" && file.kind !== "image")) fail("not_found", "File not found.");
  if (file.documentId && !(await ctx.db.get("documents", file.documentId))) fail("not_found", "File not found.");
  const p = args.palette;
  const lower = (list: string[] | undefined) => list?.map((c) => c.toLowerCase());
  const colours = [p.paper, p.ink, p.paperDark, p.inkDark, p.accent, p.accentDark, ...(p.text ?? []), ...(p.textDark ?? []), ...(p.highlight ?? []), ...(p.highlightDark ?? [])].filter((c): c is string => c !== undefined);
  if (!colours.every((c) => HEX.test(c))) fail("invalid_argument", "Colours must be #rrggbb.");
  if ((p.text && p.text.length !== 5) || (p.textDark && p.textDark.length !== 5) || (p.highlight && p.highlight.length !== 4) || (p.highlightDark && p.highlightDark.length !== 4)) {
    fail("invalid_argument", "Unexpected palette size.");
  }
  if (p.names && (p.names.length !== 5 || !p.names.every((n) => /^[A-Za-z ]{1,20}$/.test(n)))) fail("invalid_argument", "Unexpected colour names.");
  const palette = Object.fromEntries(
    Object.entries({
      paper: p.paper.toLowerCase(),
      ink: p.ink.toLowerCase(),
      paperDark: p.paperDark.toLowerCase(),
      inkDark: p.inkDark.toLowerCase(),
      tone: p.tone,
      accent: p.accent?.toLowerCase(),
      accentDark: p.accentDark?.toLowerCase(),
      text: lower(p.text),
      textDark: lower(p.textDark),
      names: p.names,
      highlight: lower(p.highlight),
      highlightDark: lower(p.highlightDark),
    }).filter(([, v]) => v !== undefined),
  ) as LocalFile["palette"];
  ctx.db.put("files", file.id, { ...file, palette });
  return null;
});

// ---- pasted blocks -------------------------------------------------------------------------------------

/** Kinds of file a pasted block can show. */
const PASTED_KINDS = new Set(["image", "file", "audio"]);

/**
 * Files in blocks pasted into another note get rows of that note (convex/files.ts shareForPaste). The library
 * is one place, so a pasted file always shares the original's bytes (content addressed: nothing is copied);
 * pasted into the same note again, it's the same row.
 */
defineLocal(api.files.shareForPaste, "mutation", async (ctx, args) => {
  await requireProfile(ctx);
  const doc = await ctx.db.get("documents", args.documentId);
  if (!doc || doc.inTrash) fail("not_found", "Document not found.");
  const out: Record<string, string> = {};
  let all: LocalFile[] | null = null;
  for (const id of [...new Set(args.fileIds)].slice(0, 50)) {
    const f = await fileById(ctx.db, id);
    if (!f || !f.documentId || !PASTED_KINDS.has(f.kind)) continue;
    if (f.documentId === doc.id) {
      out[id] = id;
      continue;
    }
    if (!(await ctx.db.get("documents", f.documentId))) continue;
    all ??= await ctx.db.list("files");
    const before = all.find((r) => r.sha256 === f.sha256 && r.documentId === doc.id);
    if (before) {
      out[id] = before.id;
      continue;
    }
    const copy: LocalFile = { ...f, id: ulid(), documentId: doc.id, createdAt: ctx.now() };
    ctx.db.put("files", copy.id, copy);
    all.push(copy);
    out[id] = copy.id;
  }
  return out;
});

