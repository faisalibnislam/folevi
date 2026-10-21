// `@folevi/local-store/e2ee`: the end-to-end encryption crypto core (docs/E2EE_DESIGN.md §4, WP1).
// FIRST COMMIT: signatures only; every function throws until the implementation lands.
import type { StatementKind, SignedStatement } from "./wire";

export type AeadKey = CryptoKey | Uint8Array;
export interface X25519KeyPair {
  privateKey: CryptoKey | Uint8Array;
  publicKey: Uint8Array;
}
export interface Ed25519KeyPair {
  privateKey: CryptoKey | Uint8Array;
  publicKey: Uint8Array;
}
export type BackendName = "webcrypto" | "noble";
export interface CryptoBackend {
  x25519: BackendName;
  ed25519: BackendName;
  aes: BackendName;
}

const todo = (name: string): never => {
  throw new Error(`@folevi/local-store/e2ee: ${name} is not implemented yet.`);
};

export function cryptoBackend(): Promise<CryptoBackend> {
  return todo("cryptoBackend");
}
export function forceBackend(_b: BackendName | null): void {
  todo("forceBackend");
}
export function randomBytes(_n: number): Uint8Array {
  return todo("randomBytes");
}
export function hkdf(_ikm: Uint8Array | CryptoKey, _info: string, _bytes?: number): Promise<Uint8Array> {
  return todo("hkdf");
}
export function importAead(_raw: Uint8Array): Promise<AeadKey> {
  return todo("importAead");
}
export function macOf(_key: Uint8Array | CryptoKey, _context: string, _plaintext: Uint8Array): Promise<string> {
  return todo("macOf");
}

/** One builder per row of §4.5; each returns the full context string, starting "folevi/e2ee/v1/". */
export const ctx = {
  amkDevice: (profileId: string, deviceId: string) => `folevi/e2ee/v1/amk/device/${profileId}/${deviceId}`,
  amkRecovery: (profileId: string, wrapId: string) => `folevi/e2ee/v1/amk/recovery/${profileId}/${wrapId}`,
  amkPasskey: (profileId: string, credentialIdB64u: string) =>
    `folevi/e2ee/v1/amk/passkey/${profileId}/${credentialIdB64u}`,
  amkPassphrase: (profileId: string, wrapId: string) => `folevi/e2ee/v1/amk/passphrase/${profileId}/${wrapId}`,
  spaceGrant: (scope: string, version: number, profileId: string) =>
    `folevi/e2ee/v1/space-grant/${scope}/${version}/${profileId}`,
  noteKeySpace: (docId: string, noteVersion: number, scope: string, spaceVersion: number) =>
    `folevi/e2ee/v1/note-key/${docId}/${noteVersion}/space/${scope}/${spaceVersion}`,
  noteKeyGrant: (docId: string, noteVersion: number, profileId: string) =>
    `folevi/e2ee/v1/note-key/${docId}/${noteVersion}/grant/${profileId}`,
  noteKeyLink: (docId: string, noteVersion: number, linkPublicId: string) =>
    `folevi/e2ee/v1/note-key/${docId}/${noteVersion}/link/${linkPublicId}`,
  docTitle: (docId: string) => `folevi/e2ee/v1/doc/${docId}/title`,
  docAppearance: (docId: string) => `folevi/e2ee/v1/doc/${docId}/appearance`,
  docMeta: (docId: string) => `folevi/e2ee/v1/doc/${docId}/meta`,
  block: (docId: string, blockId: string) => `folevi/e2ee/v1/block/${docId}/${blockId}`,
  comment: (docId: string, commentId: string) => `folevi/e2ee/v1/comment/${docId}/${commentId}`,
  fileText: (docId: string, blockId: string) => `folevi/e2ee/v1/file-text/${docId}/${blockId}`,
  versionName: (docId: string, snapshotId: string) => `folevi/e2ee/v1/version-name/${docId}/${snapshotId}`,
  fileKey: (docId: string, fileId: string) => `folevi/e2ee/v1/file-key/${docId}/${fileId}`,
  fileMeta: (docId: string, fileId: string) => `folevi/e2ee/v1/file-meta/${docId}/${fileId}`,
  file: (fileId: string) => `folevi/e2ee/v1/file/${fileId}`,
  folder: (scope: string, folderId: string) => `folevi/e2ee/v1/folder/${scope}/${folderId}`,
  tag: (scope: string, tagId: string) => `folevi/e2ee/v1/tag/${scope}/${tagId}`,
  spaceRecord: (scope: string, kind: string, recordId: string) =>
    `folevi/e2ee/v1/record/${scope}/${kind}/${recordId}`,
  accountRecord: (profileId: string, kind: string, recordId: string) =>
    `folevi/e2ee/v1/record/account/${profileId}/${kind}/${recordId}`,
  inbox: (scope: string, inboxId: string) => `folevi/e2ee/v1/inbox/${scope}/${inboxId}`,
};

export function sealRecord(
  _key: AeadKey,
  _keyVersion: number,
  _context: string,
  _plaintext: Uint8Array,
  _o?: { nonce?: Uint8Array; compress?: boolean },
): Promise<Uint8Array> {
  return todo("sealRecord");
}
export function openRecord(
  _key: AeadKey | ((keyVersion: number) => Promise<AeadKey>),
  _context: string,
  _envelope: Uint8Array,
): Promise<Uint8Array> {
  return todo("openRecord");
}
export function recordKeyVersion(_envelope: Uint8Array): number {
  return todo("recordKeyVersion");
}
export function sealFileStream(
  _fileKey: AeadKey,
  _context: string,
  _plaintext: Uint8Array,
  _o?: { chunkSize?: number; noncePrefix?: Uint8Array },
): Promise<Uint8Array> {
  return todo("sealFileStream");
}
export function openFileStream(_fileKey: AeadKey, _context: string, _envelope: Uint8Array): Promise<Uint8Array> {
  return todo("openFileStream");
}
export function openFileStreamRange(
  _fileKey: AeadKey,
  _context: string,
  _envelope: Uint8Array,
  _start: number,
  _end: number,
): Promise<Uint8Array> {
  return todo("openFileStreamRange");
}
export function generateX25519(_o?: { extractable?: boolean }): Promise<X25519KeyPair> {
  return todo("generateX25519");
}
export function generateEd25519(_o?: { extractable?: boolean }): Promise<Ed25519KeyPair> {
  return todo("generateEd25519");
}
export function x25519FromSeed(_seed: Uint8Array): Promise<X25519KeyPair> {
  return todo("x25519FromSeed");
}
export function ed25519FromSeed(_seed: Uint8Array): Promise<Ed25519KeyPair> {
  return todo("ed25519FromSeed");
}
export function sealTo(
  _recipientPub: Uint8Array,
  _context: string,
  _plaintext: Uint8Array,
  _o?: { ephemeral?: X25519KeyPair; nonce?: Uint8Array },
): Promise<Uint8Array> {
  return todo("sealTo");
}
export function openSealed(
  _recipient: X25519KeyPair["privateKey"],
  _recipientPub: Uint8Array,
  _context: string,
  _box: Uint8Array,
): Promise<Uint8Array> {
  return todo("openSealed");
}
export function signStatement<K extends StatementKind>(
  _key: Ed25519KeyPair["privateKey"],
  _kind: K,
  _body: object,
): Promise<SignedStatement<K>> {
  return todo("signStatement");
}
export function verifyStatement(_pub: Uint8Array, _s: SignedStatement): Promise<boolean> {
  return todo("verifyStatement");
}

export interface AccountKeys {
  x25519: X25519KeyPair;
  ed25519: Ed25519KeyPair;
  records: AeadKey;
  check: Uint8Array;
}
export function deriveAccountKeys(_amk: Uint8Array): Promise<AccountKeys> {
  return todo("deriveAccountKeys");
}
export interface SpaceKeys {
  wrap: AeadKey;
  meta: AeadKey;
  mac: CryptoKey | Uint8Array;
  inbox: X25519KeyPair;
  check: Uint8Array;
}
export function deriveSpaceKeys(_sk: Uint8Array): Promise<SpaceKeys> {
  return todo("deriveSpaceKeys");
}
export interface NoteKeys {
  content: AeadKey;
  mac: CryptoKey | Uint8Array;
  files: AeadKey;
}
export function deriveNoteKeys(_nk: Uint8Array): Promise<NoteKeys> {
  return todo("deriveNoteKeys");
}
export function newRecoveryKey(): { bytes: Uint8Array; text: string } {
  return todo("newRecoveryKey");
}
export function parseRecoveryKey(_text: string): Uint8Array | null {
  return todo("parseRecoveryKey");
}
export function recoveryWrapKey(_bytes: Uint8Array): Promise<AeadKey> {
  return todo("recoveryWrapKey");
}
export const ARGON2ID_DEFAULTS = { m: 65536, t: 3, p: 1 } as const;
export interface Argon2idParams {
  name: "argon2id";
  m: number;
  t: number;
  p: number;
  salt: Uint8Array;
}
export function passphraseWrapKey(
  _passphrase: string,
  _kdf: Argon2idParams,
  _onProgress?: (f: number) => void,
): Promise<AeadKey> {
  return todo("passphraseWrapKey");
}
export function prfWrapKey(_prfOutput: Uint8Array): Promise<AeadKey> {
  return todo("prfWrapKey");
}
export function linkWrapKey(_secret: Uint8Array): Promise<AeadKey> {
  return todo("linkWrapKey");
}
export function approvalCommit(_nonce: Uint8Array, _x25519Pub: Uint8Array, _ed25519Pub: Uint8Array): Promise<Uint8Array> {
  return todo("approvalCommit");
}
export interface ApprovalCodeInput {
  newX: Uint8Array;
  newEd: Uint8Array;
  approverEd: Uint8Array;
  accountX: Uint8Array;
  accountEd: Uint8Array;
  approverNonce: Uint8Array;
  newNonce: Uint8Array;
}
export function approvalCode(_i: ApprovalCodeInput): Promise<string> {
  return todo("approvalCode");
}
export function memberSecurityCode(_ed25519Pub: Uint8Array): Promise<string> {
  return todo("memberSecurityCode");
}

export * from "./wire";
