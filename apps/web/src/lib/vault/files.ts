// Files & Notes on the device (docs/VAULT_PLAN.md §5): folder names sealed with VK "vault/meta", notes (their editor
// content as the item's secrets), and files of any kind encrypted with their own file key before upload (only
// ciphertext reaches the server). The server's half is convex/vaultFiles.ts.
import { fromBase64Url, importAead, openFileStream, openRecord, randomBytes, sealFileStream, sealRecord, toBase64Url, vaultCtx, type VaultKeys } from "@folevi/local-store/e2ee";
import { bytes, wire } from "@/lib/e2ee/keys/util";
import { openSecretsAs, openSummaryAs, sealParts, type KeepKey } from "./items";

const enc = new TextEncoder();
const dec = new TextDecoder();

/** A folder's name, sealed under the Vault's current key. */
export async function sealFolderName(vaultId: string, folderId: string, keyVersion: number, keys: VaultKeys, name: string) {
  return wire(await sealRecord(keys.meta, keyVersion, vaultCtx.folder(vaultId, folderId), enc.encode(name.trim().slice(0, 200) || "Untitled")));
}

export async function openFolderName(vaultId: string, folderId: string, sealedName: ArrayBuffer, keysOf: (version: number) => VaultKeys, keyVersion: number) {
  return dec.decode(await openRecord(keysOf(keyVersion).meta, vaultCtx.folder(vaultId, folderId), bytes(sealedName)));
}

/** What a note's list row shows. */
export interface NoteSummary {
  kind: "note";
  title: string;
  excerpt: string;
}

/** A note's content: the editor's document (ProseMirror JSON). */
export interface NoteContent {
  doc: unknown;
}

/** Seals a note (title and a short excerpt in the summary, the document in the secrets). */
export async function sealNote(vaultId: string, itemId: string, keyVersion: number, keys: VaultKeys, title: string, doc: unknown, excerpt: string, keep?: KeepKey) {
  const summary: NoteSummary = { kind: "note", title: title.trim() || "Untitled", excerpt: excerpt.slice(0, 200) };
  return await sealParts(vaultId, itemId, keyVersion, keys, summary, { doc } satisfies NoteContent, undefined, keep);
}

export const openNoteSummary = (vaultId: string, row: Parameters<typeof openSummaryAs>[1], keysOf: (v: number) => VaultKeys) => openSummaryAs<NoteSummary>(vaultId, row, keysOf);
export const openNote = (vaultId: string, row: Parameters<typeof openSecretsAs>[1], keysOf: (v: number) => VaultKeys) => openSecretsAs<NoteContent>(vaultId, row, keysOf);

/** What a file's list row shows. */
export interface FileSummary {
  kind: "file";
  title: string;
  mime: string;
  size: number;
}

/** A file's own key and true name and type (the secrets record). */
interface FileSecrets {
  fileKey: string;
  name: string;
  mime: string;
}

/**
 * Encrypts a file for the Vault: a fresh file key seals its bytes (FLV1 keyed stream, in chunks); the key, name and
 * type go in the item's secrets. Returns the ciphertext to upload and the sealed item.
 */
export async function sealFile(vaultId: string, itemId: string, keyVersion: number, keys: VaultKeys, file: { name: string; type: string; bytes: Uint8Array }) {
  const raw = randomBytes(32);
  try {
    const fileKey = await importAead(raw.slice());
    const ciphertext = await sealFileStream(fileKey, vaultCtx.fileBytes(vaultId, itemId), file.bytes);
    const mime = file.type || "application/octet-stream";
    const summary: FileSummary = { kind: "file", title: file.name.slice(0, 200) || "Untitled", mime, size: file.bytes.length };
    const secrets: FileSecrets = { fileKey: toBase64Url(raw), name: file.name, mime };
    return { ciphertext, item: await sealParts(vaultId, itemId, keyVersion, keys, summary, secrets) };
  } finally {
    raw.fill(0);
  }
}

export const openFileSummary = (vaultId: string, row: Parameters<typeof openSummaryAs>[1], keysOf: (v: number) => VaultKeys) => openSummaryAs<FileSummary>(vaultId, row, keysOf);

/** Decrypts a file's bytes with the key its secrets hold (from vaultFiles.fileUrl's answer and the fetched bytes). */
export async function openFile(vaultId: string, row: { id: string; keyVersion: number; wrappedKey: ArrayBuffer; sealed: ArrayBuffer }, ciphertext: Uint8Array, keysOf: (v: number) => VaultKeys): Promise<{ name: string; mime: string; bytes: Uint8Array }> {
  const secrets = await openSecretsAs<FileSecrets>(vaultId, row, keysOf);
  const raw = fromBase64Url(secrets.fileKey);
  try {
    const key = await importAead(raw.slice());
    return { name: secrets.name, mime: secrets.mime, bytes: await openFileStream(key, vaultCtx.fileBytes(vaultId, row.id), ciphertext) };
  } finally {
    raw.fill(0);
  }
}
