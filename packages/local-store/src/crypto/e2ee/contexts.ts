// AAD contexts (docs/E2EE_DESIGN.md §4.5). A context is never stored: the reader rebuilds it from where the
// bytes were found, so ciphertext moved to another document, block or person fails to open.
//
// `scope` is `scopeKey` from convex/lib/scope.ts (`personal:<profilePublicId>` or
// `workspace:<workspacePublicId>`); every id is a public id, never a Convex `_id`.
import { CONTEXT_PREFIX, E2eeError } from "./primitives";

function part(value: string | number, what: string): string {
  const s = String(value);
  if (s === "" || s.includes("/") || s.includes("\n"))
    throw new E2eeError(`Invalid ${what} in an encryption context.`);
  return s;
}

function version(value: number, what: string): string {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff)
    throw new E2eeError(`Invalid ${what} in an encryption context.`);
  return String(value);
}

const c = (...parts: string[]) => CONTEXT_PREFIX + parts.join("/");

/** One builder per row of §4.5; each returns the full context string. */
export const ctx = {
  /** AMK sealed to a device (FLS1, device X25519). */
  amkDevice: (profileId: string, deviceId: string) =>
    c("amk", "device", part(profileId, "profile id"), part(deviceId, "device id")),
  /** AMK wrapped by the recovery key (FLV1 0x03, keyVersion = AMK epoch). */
  amkRecovery: (profileId: string, wrapId: string) =>
    c("amk", "recovery", part(profileId, "profile id"), part(wrapId, "wrap id")),
  /** AMK wrapped by a passkey's PRF output. */
  amkPasskey: (profileId: string, credentialIdB64u: string) =>
    c("amk", "passkey", part(profileId, "profile id"), part(credentialIdB64u, "credential id")),
  /** AMK wrapped by the encryption passphrase. */
  amkPassphrase: (profileId: string, wrapId: string) =>
    c("amk", "passphrase", part(profileId, "profile id"), part(wrapId, "wrap id")),
  /** A space key version sealed to a member's account X25519 key (FLS1). */
  spaceGrant: (scope: string, spaceVersion: number, profileId: string) =>
    c("space-grant", part(scope, "scope"), version(spaceVersion, "space version"), part(profileId, "profile id")),
  /** A note key wrapped by the space key "space/wrap". */
  noteKeySpace: (docId: string, noteVersion: number, scope: string, spaceVersion: number) =>
    c(
      "note-key",
      part(docId, "document id"),
      version(noteVersion, "note version"),
      "space",
      part(scope, "scope"),
      version(spaceVersion, "space version"),
    ),
  /** A note key sealed to a guest's account X25519 key (FLS1). */
  noteKeyGrant: (docId: string, noteVersion: number, profileId: string) =>
    c("note-key", part(docId, "document id"), version(noteVersion, "note version"), "grant", part(profileId, "profile id")),
  /** A note key wrapped by a link key (from the URL fragment). */
  noteKeyLink: (docId: string, noteVersion: number, linkPublicId: string) =>
    c("note-key", part(docId, "document id"), version(noteVersion, "note version"), "link", part(linkPublicId, "link id")),
  docTitle: (docId: string) => c("doc", part(docId, "document id"), "title"),
  /** icon, cover, style */
  docAppearance: (docId: string) => c("doc", part(docId, "document id"), "appearance"),
  /** templateKey, collection row */
  docMeta: (docId: string) => c("doc", part(docId, "document id"), "meta"),
  block: (docId: string, blockId: string) => c("block", part(docId, "document id"), part(blockId, "block id")),
  comment: (docId: string, commentId: string) =>
    c("comment", part(docId, "document id"), part(commentId, "comment id")),
  /** Text found in a file (OCR, PDF text). */
  fileText: (docId: string, blockId: string) => c("file-text", part(docId, "document id"), part(blockId, "block id")),
  versionName: (docId: string, snapshotId: string) =>
    c("version-name", part(docId, "document id"), part(snapshotId, "snapshot id")),
  /** A file key wrapped by NK "note/files". */
  fileKey: (docId: string, fileId: string) => c("file-key", part(docId, "document id"), part(fileId, "file id")),
  /** A file's name, mime, width, height, palette (sealed with the file key). */
  fileMeta: (docId: string, fileId: string) => c("file-meta", part(docId, "document id"), part(fileId, "file id")),
  /** A file's bytes (FLV1 0x04 with the file key). */
  file: (fileId: string) => c("file", part(fileId, "file id")),
  folder: (scope: string, folderId: string) => c("folder", part(scope, "scope"), part(folderId, "folder id")),
  tag: (scope: string, tagId: string) => c("tag", part(scope, "scope"), part(tagId, "tag id")),
  /** A space record (SK "space/meta"), or a record under a note (sealed with the note key, §4.5). */
  spaceRecord: (scope: string, kind: string, recordId: string) =>
    c("record", part(scope, "scope"), part(kind, "record kind"), part(recordId, "record id")),
  /** A person's own record (AMK "account/records"). */
  accountRecord: (profileId: string, kind: string, recordId: string) =>
    c("record", "account", part(profileId, "profile id"), part(kind, "record kind"), part(recordId, "record id")),
  /** Something sealed to the space inbox key by the server (FLS1). */
  inbox: (scope: string, inboxId: string) => c("inbox", part(scope, "scope"), part(inboxId, "inbox id")),
};

export type ContextKind = keyof typeof ctx;
