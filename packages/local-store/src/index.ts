/**
 * `@folevi/local-store`: the on-disk library format and merge for "Keep notes on my devices"
 * (docs/LOCAL_MODE_PLAN.md §3). Pure TypeScript with WebCrypto and fflate only, so the same code runs in
 * the app's web view, in Node tests and as the reference the native file layers are checked against.
 *
 * - Clocks: `HybridClock`, `compareHlc` (hlc.ts); version vectors `compareVv`, `mergeVv` (vv.ts).
 * - Note files: `NoteFile`, `NoteStub`, `encodeNoteFile` / `decodeNoteFile` with `sum` (noteFile.ts);
 *   local edits that stamp what they change: `upsertBlock`, `deleteBlock`, `setDocField`, `addTag`, ... (edits.ts).
 * - Merge: `mergeNoteFiles` (any two states, stubs included) returns the merged file and the `Loss`es that go
 *   to history; `normalizeBlocks` gives the live tree in document order (merge.ts).
 * - Library index, catalogs, devices: `mergeIndex`, `resolveCatalog`, `DeviceRecord` (indexFile.ts, catalog.ts).
 * - History, attachments, compaction: `snapshotVersion`, `conflictVersion`, `thinVersions`, `gcEligible`,
 *   `compactTombstones` (history.ts, attachments.ts, tombstones.ts).
 * - Files: `LocalFs` (the bridge contract), `readMergeWrite`, `NoteReplica` (io.ts, librarySync.ts),
 *   paths and conflict-copy names (layout.ts), the journal (journal.ts).
 * - Encryption: the FLV1 envelope, key wrapping, HMAC names (crypto/envelope.ts) and `EncryptedFs`.
 * - Test filesystems: `MemoryFs`, `FaultyCloud` (fs/).
 */
export * from "./bytes";
export { sha256, sha256Hex } from "./sha256";
export * from "./hlc";
export * from "./vv";
export * from "./noteFile";
export * from "./edits";
export * from "./merge";
export * from "./history";
export * from "./indexFile";
export * from "./catalog";
export * from "./attachments";
export * from "./tombstones";
export * from "./layout";
export * from "./io";
export * from "./librarySync";
export * from "./journal";
export * from "./crypto/envelope";
export { EncryptedFs } from "./crypto/encryptedFs";
export { MemoryFs, type MemoryFsOptions } from "./fs/memoryFs";
export {
  FaultyCloud,
  FaultyMount,
  DEFAULT_FAULTS,
  NO_FAULTS,
  seededRandom,
  type CopyStyle,
  type FaultRates,
  type FaultyCloudOptions,
} from "./fs/faultyFs";
