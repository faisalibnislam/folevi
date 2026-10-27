// A library Vault's file bytes (docs/MAC_REBUILD_PLAN.md §5.6): the ciphertext the device sealed (FLV1 keyed stream,
// lib/vault/files.ts sealFile), in the library folder at vault/files/<item id>, written through the shell's library
// file layer. Without a shell (a plain browser in development, tests) they're kept in memory for the page.
//
// Uploading has two steps, as on the server: the bytes are staged under an intent (vaultFiles.uploadUrl's
// `folevi-local-vault-upload:<intent>`), then saveFile moves them to the item. Reading goes by
// `folevi-local-vault-file:<item id>` (vaultFiles.fileUrl). lib/vault/files.ts sendCiphertext and fetchCiphertext
// understand both, so the web screens and the engine do the same thing in either mode.
import { isNotFound, type LocalFs } from "@folevi/local-store";

export const UPLOAD_PREFIX = "folevi-local-vault-upload:";
export const FILE_PREFIX = "folevi-local-vault-file:";
export const VAULT_FILES_DIR = "vault/files";

const memory = new Map<string, Uint8Array>();
const staged = new Map<string, Uint8Array>();
let override: LocalFs | null | undefined;

/** Uses this file layer for the bytes (tests); null keeps them in memory; undefined goes back to the shell's. */
export function setVaultFileLayer(fs: LocalFs | null | undefined): void {
  override = fs;
  memory.clear();
  staged.clear();
}

async function layer(): Promise<LocalFs | null> {
  if (override !== undefined) return override;
  const { shellLibraryHost } = await import("../store/index");
  return shellLibraryHost();
}

const pathOf = (itemId: string) => {
  if (!/^[0-9A-Za-z_-]{1,64}$/.test(itemId)) throw new Error("Invalid item id.");
  return `${VAULT_FILES_DIR}/${itemId}`;
};

/** Keeps uploaded bytes until saveFile claims them (only this page's memory: never written as they are). */
export function stageUpload(intentId: string, bytes: Uint8Array): void {
  staged.set(intentId, bytes.slice());
}

export function takeStaged(intentId: string): Uint8Array | null {
  const b = staged.get(intentId) ?? null;
  staged.delete(intentId);
  return b;
}

export async function writeVaultFile(itemId: string, bytes: Uint8Array): Promise<void> {
  const fs = await layer();
  if (!fs) {
    memory.set(itemId, bytes.slice());
    return;
  }
  await fs.write(pathOf(itemId), bytes, {});
}

export async function readVaultFile(itemId: string): Promise<Uint8Array> {
  const fs = await layer();
  if (!fs) {
    const b = memory.get(itemId);
    if (!b) throw new Error("This file isn't on this device.");
    return b.slice();
  }
  const r = await fs.read(pathOf(itemId));
  if ("notDownloaded" in r) throw new Error("This file is still downloading to this device. Try again in a moment.");
  return r.bytes;
}

export async function removeVaultFile(itemId: string): Promise<void> {
  const fs = await layer();
  if (!fs) {
    memory.delete(itemId);
    return;
  }
  await fs.remove(pathOf(itemId)).catch((e: unknown) => {
    if (!isNotFound(e)) throw e;
  });
}
