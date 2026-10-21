"use client";
// Stand-ins for the hooks WP6, WP7 and WP8 are building (docs/E2EE_DESIGN.md §12), with the same names and
// signatures, so the screens in this folder can be built, seen and tested before those packages land.
// DELETED AT INTEGRATION: every import of "./__stubs__" (or "@/components/e2ee/__stubs__") then points at
// the real modules:
//   LockState, KeySession, getKeySession, getKeyRing, setup, useKeySession, useApprovals  -> lib/e2ee/keys/* (WP6)
//   useE2eeSpaceStatus, isSealedDocument, ReplicaStatus                                    -> lib/e2ee/router, replica (WP7)
//   startMigrationRunner, useMigrationProgress, startFeatureWorkers, useAiConsent,
//   createEncryptedLink, publishPlainCopy                                                  -> lib/e2ee/migrate, features, links (WP8)
// The block marked "WP9 glue" at the end has no §12 signature: those are thin wrappers WP9 replaces at
// integration with `useQuery` / `useMutation` on the Convex functions named next to each (§5.3).
//
// Every stub reports "no encryption on this account" by default, so Standard users see only Settings >
// Privacy. In development (never in production builds) a state can be forced for screenshots and the
// screen-level e2e specs: localStorage["folevi.e2ee.stub"] = JSON of a partial StubState (see `stubPreset`).
import { useSyncExternalStore } from "react";
import { scopeIdKey, type WireScope } from "@folevi/editor-schema";

// ─── Shared shapes (WP1 wire.ts / WP2 validators mirror these) ────────────────────────────────────────────

export type Level = "standard" | "selected" | "full";
export type SpaceState = "off" | "enabling" | "on" | "disabling";
export interface Switches {
  foliAi: "off" | "ask" | "auto";
  backgroundAi: boolean;
  searchEverywhere: boolean;
  apps: boolean;
  emailToNote: boolean;
  webClipper: boolean;
  notificationPreviews: boolean;
}
/** §7.1: the defaults at "Encrypted, with the features you pick". */
export const DEFAULT_SWITCHES: Switches = { foliAi: "ask", backgroundAi: false, searchEverywhere: false, apps: false, emailToNote: false, webClipper: false, notificationPreviews: false };
/** §7.1: at Fully encrypted every switch is off and can't change. */
export const FULL_SWITCHES: Switches = { foliAi: "off", backgroundAi: false, searchEverywhere: false, apps: false, emailToNote: false, webClipper: false, notificationPreviews: false };
/** `switchesOf(null)`: a Standard space reads as everything on (today's behaviour). */
export const STANDARD_SWITCHES: Switches = { foliAi: "auto", backgroundAi: true, searchEverywhere: true, apps: true, emailToNote: true, webClipper: true, notificationPreviews: true };

// ─── WP6: keys, unlock, devices (§12 WP6) ─────────────────────────────────────────────────────────────────

export type LockState = "none" /* no E2EE on this account */ | "locked" | "unlocking" | "unlocked";
export type MethodKind = "device" | "recoveryKey" | "passkey" | "passphrase";
/** One way in, as `e2ee.keys.listWraps` reports it (never the wrapped key). */
export interface MethodSummary {
  publicId: string;
  kind: MethodKind;
  label: string;
  createdAt: number;
  lastUsedAt?: number;
}
export interface ApprovalHandle {
  code: Promise<string>;
  done: Promise<boolean>;
  cancel(): void;
}
/** A request from a new device, shown on a trusted one (`e2ee.devices.approvals`). */
export interface IncomingApproval {
  requestId: string;
  /** "Chrome on Windows" */
  label: string;
  createdAt: number;
  /** Answers the request (`answerApproval`), waits for the reveal and resolves the 6-digit code. */
  start(): Promise<string>;
  /** "They match": seals the AMK to the new device (`completeApproval`). */
  confirm(): Promise<void>;
  /** "They don't match": cancels (`cancelApproval`). */
  reject(): Promise<void>;
}
export interface KeySession {
  state(): LockState;
  subscribe(cb: () => void): () => void;
  unlockWithDevice(): Promise<boolean>;
  unlockWithPassphrase(p: string): Promise<"ok" | "wrong" | "rate_limited">;
  unlockWithRecoveryKey(text: string): Promise<"ok" | "wrong" | "bad_format" | "rate_limited">;
  unlockWithPasskey(): Promise<"ok" | "cancelled" | "unsupported">;
  requestApproval(): Promise<ApprovalHandle>;
  trust(mode: "browser" | "public"): Promise<void>;
  lock(): void;
  accountKeys(): unknown;
  deviceId(): string;
}
export interface KeyRing {
  spaceKeys(scope: WireScope, version?: number): Promise<unknown>;
  noteKeys(documentId: string, version?: number): Promise<unknown>;
}

// ─── WP7: replica status (§12 WP7) ────────────────────────────────────────────────────────────────────────

export type ReplicaStatus = { state: "opening" | "downloading" | "ready" | "locked"; have: number; total: number | null };

// ─── WP8: migration, consent, links (§12 WP8) ─────────────────────────────────────────────────────────────

export interface MigrationProgress {
  direction: "seal" | "unseal" | "reseal";
  phase: "documents" | "history" | "files" | "cleanup" | "done";
  documents: { done: number; total: number };
  history: { done: number; total: number };
  files: { done: number; total: number; bytesLeft: number };
  /** No device is working on it right now. */
  paused: boolean;
  failed: { documentId: string; title: string }[];
}
export interface ConsentRequest {
  notes: { id: string; title: string; chars: number }[];
}
export interface LinkOptions {
  expiresAt?: number;
  password?: string;
  theme?: string;
}

// ─── The stub's own state ─────────────────────────────────────────────────────────────────────────────────

interface StubSpace {
  level: Level;
  state: SpaceState;
  switches: Switches;
  lockedCount: number;
  /** Members holding the current space key (workspaces). */
  keyHolders: number;
}
export interface StubState {
  lock: LockState;
  methods: MethodSummary[];
  spaces: Record<string, StubSpace>;
  migrations: Record<string, MigrationProgress>;
  replica: ReplicaStatus;
  approvals: { requestId: string; label: string; createdAt: number }[];
  lockedFolders: string[];
  lockedDocuments: string[];
  sealedDocuments: string[];
  /** Settings > Devices: how each signed-in session stands ("*" = any not listed). */
  devices: Record<string, "trusted" | "none" | "session">;
  consent: ConsentRequest | null;
  /** Workspace members (profile ids) waiting for the key. */
  pendingMembers: string[];
  rotation: { done: number; total: number } | null;
  /** Members whose account key changed since you last saw it. */
  keyChanged: string[];
  /** The account has keys, but this workspace hasn't been shared with it yet. */
  waitingForKey: string[];
  passkeys: boolean;
}

const KEY = "folevi.e2ee.stub";
const NONE: StubState = {
  lock: "none",
  methods: [],
  spaces: {},
  migrations: {},
  replica: { state: "ready", have: 0, total: 0 },
  approvals: [],
  lockedFolders: [],
  lockedDocuments: [],
  sealedDocuments: [],
  devices: {},
  consent: null,
  pendingMembers: [],
  rotation: null,
  keyChanged: [],
  waitingForKey: [],
  passkeys: true,
};

const dev = process.env.NODE_ENV !== "production";
let state: StubState = NONE;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  if (!dev) return;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) state = { ...NONE, ...(JSON.parse(raw) as Partial<StubState>) };
  } catch {
    // A broken override is ignored.
  }
}
function read(): StubState {
  load();
  return state;
}
function write(next: Partial<StubState>) {
  state = { ...read(), ...next };
  if (dev && typeof window !== "undefined") {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      // Storage full or blocked: the state lives for this tab.
    }
  }
  for (const l of listeners) l();
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function useStub<T>(pick: (s: StubState) => T): T {
  return useSyncExternalStore(subscribe, () => pick(read()), () => pick(NONE));
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Stubs refuse to act in production builds: nothing is encrypted until the real packages land. */
function devOnly() {
  if (!dev) throw new Error("End-to-end encryption isn't available yet.");
}
const spaceOf = (s: StubState, scope: WireScope): StubSpace | undefined => s.spaces[scopeIdKey(scope)];
let nextId = 1;
const newId = (p: string) => `${p}_${Date.now().toString(36)}${(nextId++).toString(36)}`;

// ─── WP6 stubs ────────────────────────────────────────────────────────────────────────────────────────────

const session: KeySession = {
  state: () => read().lock,
  subscribe,
  async unlockWithDevice() {
    return false;
  },
  async unlockWithPassphrase(p) {
    write({ lock: "unlocking" });
    await wait(500);
    if (p === "wrong passphrase") {
      write({ lock: "locked" });
      return "wrong";
    }
    if (p === "too many") {
      write({ lock: "locked" });
      return "rate_limited";
    }
    return "ok";
  },
  async unlockWithRecoveryKey(text) {
    write({ lock: "unlocking" });
    await wait(400);
    const clean = text.replace(/[\s-]/g, "");
    if (clean.length !== 36) {
      write({ lock: "locked" });
      return "bad_format";
    }
    return "ok";
  },
  async unlockWithPasskey() {
    return read().passkeys ? "ok" : "unsupported";
  },
  async requestApproval() {
    let cancelled = false;
    const code = wait(1500).then(() => "482019");
    const done = code.then(() => wait(2500)).then(() => !cancelled);
    return { code, done, cancel: () => (cancelled = true) };
  },
  async trust() {
    write({ lock: "unlocked" });
  },
  lock() {
    write({ lock: "locked" });
  },
  accountKeys() {
    throw new Error("stub");
  },
  deviceId: () => "stub-device",
};
export function getKeySession(): KeySession {
  return session;
}
export function getKeyRing(): KeyRing {
  return {
    spaceKeys: () => Promise.reject(new Error("stub")),
    noteKeys: () => Promise.reject(new Error("stub")),
  };
}

const RECOVERY_SAMPLE = "7KQ2-M9XD-4HWB-T8NC-2RJF-Q6ZP-K3VS-9GDM-R4TA";
const addMethod = (kind: MethodKind, label: string) => write({ methods: [...read().methods, { publicId: newId("wrap"), kind, label, createdAt: Date.now() }] });
export const setup = {
  async createAccount(): Promise<void> {
    devOnly();
    await wait(300);
    if (read().lock === "none") write({ lock: "unlocked", methods: [{ publicId: newId("wrap"), kind: "device", label: "This browser", createdAt: Date.now() }] });
  },
  async addRecoveryKey(): Promise<{ text: string; confirm(groups: [string, string]): Promise<boolean> }> {
    devOnly();
    await wait(200);
    const groups = RECOVERY_SAMPLE.split("-");
    return {
      text: RECOVERY_SAMPLE,
      async confirm([g3, g7]) {
        const ok = g3.trim().toUpperCase() === groups[2] && g7.trim().toUpperCase() === groups[6];
        if (ok) {
          write({ methods: read().methods.filter((m) => m.kind !== "recoveryKey") });
          addMethod("recoveryKey", "Recovery key");
        }
        return ok;
      },
    };
  },
  async addPassphrase(_p: string): Promise<void> {
    devOnly();
    await wait(800);
    write({ methods: read().methods.filter((m) => m.kind !== "passphrase") });
    addMethod("passphrase", "Encryption passphrase");
  },
  async addPasskey(label: string): Promise<"ok" | "unsupported" | "cancelled"> {
    devOnly();
    if (!read().passkeys) return "unsupported";
    await wait(400);
    addMethod("passkey", label);
    return "ok";
  },
  async removeMethod(publicId: string): Promise<void> {
    devOnly();
    const left = read().methods.filter((m) => m.publicId !== publicId);
    const anySpace = Object.values(read().spaces).some((s) => s.level !== "standard" || s.lockedCount > 0);
    if (anySpace && new Set(left.map((m) => m.kind)).size < 2) throw Object.assign(new Error("e2ee_last_method"), { data: { code: "e2ee_last_method" } });
    write({ methods: left });
  },
  async rotateAccount(): Promise<void> {
    devOnly();
    await wait(600);
  },
  async resetAccount(): Promise<void> {
    devOnly();
    await wait(600);
  },
  async setUpSpace(_scope: WireScope): Promise<void> {
    devOnly();
    await wait(300);
  },
  async rotateSpace(_scope: WireScope, onProgress: (n: number, of: number) => void): Promise<void> {
    devOnly();
    for (let i = 0; i <= 10; i++) {
      onProgress(i * 90, 900);
      await wait(150);
    }
  },
  async completePendingGrants(_scope: WireScope): Promise<number> {
    const n = read().pendingMembers.length;
    write({ pendingMembers: [] });
    return n;
  },
  async grantNote(_documentId: string, _profileId: string): Promise<void> {},
};

export function useKeySession(): { state: LockState; methods: MethodSummary[] } {
  const lock = useStub((s) => s.lock);
  const methods = useStub((s) => s.methods);
  return { state: lock, methods };
}

const approvalsCache = new Map<string, IncomingApproval>();
export function useApprovals(): IncomingApproval[] {
  const raw = useStub((s) => s.approvals);
  return raw.map((a) => {
    let hit = approvalsCache.get(a.requestId);
    if (!hit) {
      const drop = () => write({ approvals: read().approvals.filter((x) => x.requestId !== a.requestId) });
      hit = {
        ...a,
        start: () => wait(900).then(() => "482019"),
        confirm: async () => {
          await wait(400);
          drop();
        },
        reject: async () => {
          await wait(200);
          drop();
        },
      };
      approvalsCache.set(a.requestId, hit);
    }
    return hit;
  });
}

// ─── WP7 stubs ────────────────────────────────────────────────────────────────────────────────────────────

export function useE2eeSpaceStatus(scope: WireScope): ReplicaStatus & { level: Level; switches: Switches; locked: boolean } {
  const key = scopeIdKey(scope);
  const space = useStub((s) => s.spaces[key]);
  const replica = useStub((s) => s.replica);
  const lock = useStub((s) => s.lock);
  const level = space?.level ?? "standard";
  return {
    ...replica,
    level,
    switches: level === "standard" ? STANDARD_SWITCHES : level === "full" ? FULL_SWITCHES : (space?.switches ?? DEFAULT_SWITCHES),
    locked: lock === "locked" || lock === "unlocking",
  };
}
export function isSealedDocument(documentId: string): boolean {
  const s = read();
  return s.sealedDocuments.includes(documentId) || s.lockedDocuments.includes(documentId);
}

// ─── WP8 stubs ────────────────────────────────────────────────────────────────────────────────────────────

export function startMigrationRunner(): () => void {
  return () => undefined;
}
export function startFeatureWorkers(): () => void {
  return () => undefined;
}
export function useMigrationProgress(scope: WireScope): MigrationProgress | null {
  const key = scopeIdKey(scope);
  return useStub((s) => s.migrations[key] ?? null);
}
export function useAiConsent(): { pending: ConsentRequest | null; answer(ok: boolean, rememberForNote?: boolean): void } {
  const pending = useStub((s) => s.consent);
  return { pending, answer: () => write({ consent: null }) };
}
export async function createEncryptedLink(_documentId: string, _opts: LinkOptions): Promise<{ url: string }> {
  devOnly();
  await wait(300);
  return { url: `${location.origin}/s/stub${Date.now().toString(36)}#k=Q2hlY2sgdGhhdCB0aGUga2V5IHN0YXlzIGluIHRoZSBmcmFnbWVudA` };
}
export async function publishPlainCopy(_documentId: string): Promise<{ url: string }> {
  devOnly();
  await wait(500);
  return { url: `${location.origin}/s/stubcopy${Date.now().toString(36)}` };
}

// ─── WP9 glue (replaced at integration with Convex calls, §5.3) ───────────────────────────────────────────

/** e2ee.spaces.get({scope}) plus `canManage` from the app state: the space row, or null for a Standard space never set up. */
export function useE2eeSpace(scope: WireScope): (StubSpace & { e2eeActive: boolean }) | null {
  const key = scopeIdKey(scope);
  const space = useStub((s) => s.spaces[key]);
  if (!space) return null;
  return { ...space, e2eeActive: space.level !== "standard" || space.lockedCount > 0 };
}

/** The writes the screens make. */
export const e2eeActions = {
  /** e2ee.spaces.enable({scope, level, switches}) after setup.setUpSpace(scope). */
  async enable(scope: WireScope, level: Exclude<Level, "standard">, switches: Switches): Promise<void> {
    devOnly();
    await wait(400);
    const key = scopeIdKey(scope);
    const s = read();
    write({
      spaces: { ...s.spaces, [key]: { level, state: "enabling", switches: level === "full" ? FULL_SWITCHES : switches, lockedCount: spaceOf(s, scope)?.lockedCount ?? 0, keyHolders: 1 } },
      migrations: { ...s.migrations, [key]: { direction: "seal", phase: "documents", documents: { done: 0, total: 48 }, history: { done: 0, total: 120 }, files: { done: 0, total: 6, bytesLeft: 18_400_000 }, paused: false, failed: [] } },
    });
  },
  /** e2ee.spaces.setSwitches({scope, switches}); resolves once the purge job reports done for switches turned off. */
  async setSwitches(scope: WireScope, switches: Switches): Promise<void> {
    devOnly();
    const key = scopeIdKey(scope);
    const s = read();
    const space = s.spaces[key];
    if (!space) return;
    write({ spaces: { ...s.spaces, [key]: { ...space, switches } } });
    await wait(900);
  },
  /** e2ee.keys.getWrap + e2ee.spaces.lower({scope, level, recheckedWrapId}). */
  async lower(scope: WireScope, level: Level, _recheckedWrapId?: string): Promise<void> {
    devOnly();
    await wait(400);
    const key = scopeIdKey(scope);
    const s = read();
    const space = s.spaces[key];
    if (!space) return;
    write({ spaces: { ...s.spaces, [key]: { ...space, level, state: level === "standard" ? "disabling" : "on", switches: level === "full" ? FULL_SWITCHES : space.switches } } });
  },
  /** e2ee.content.setFolderLocked({folderId, locked}). */
  async setFolderLocked(scope: WireScope, folderId: string, locked: boolean): Promise<void> {
    devOnly();
    await wait(300);
    const s = read();
    const list = locked ? [...new Set([...s.lockedFolders, folderId])] : s.lockedFolders.filter((id) => id !== folderId);
    bumpLocks(scope, list.length + s.lockedDocuments.length, { lockedFolders: list });
  },
  /** e2ee.content.setDocumentLocked({documentId, locked}). */
  async setDocumentLocked(scope: WireScope, documentId: string, locked: boolean): Promise<void> {
    devOnly();
    await wait(300);
    const s = read();
    const list = locked ? [...new Set([...s.lockedDocuments, documentId])] : s.lockedDocuments.filter((id) => id !== documentId);
    bumpLocks(scope, list.length + s.lockedFolders.length, { lockedDocuments: list });
  },
  /** e2ee.devices.revoke({deviceId}), then setup.rotateAccount() when `rotate`. */
  async removeDevice(sessionId: string, rotate: boolean): Promise<void> {
    devOnly();
    await wait(400);
    write({ devices: { ...read().devices, [sessionId]: "none" } });
    if (rotate) await setup.rotateAccount();
  },
  /** e2ee.keys.getWrap({kind}) opened on this device: proves a recovery method again before lowering (§5.3 `lower`). */
  async recheck(kind: "passphrase" | "recoveryKey" | "passkey", input: string): Promise<{ ok: true; wrapId: string } | { ok: false; reason: "wrong" | "bad_format" | "rate_limited" | "cancelled" | "unsupported" }> {
    const r = kind === "passphrase" ? await session.unlockWithPassphrase(input) : kind === "recoveryKey" ? await session.unlockWithRecoveryKey(input) : await session.unlockWithPasskey();
    write({ lock: "unlocked" });
    return r === "ok" ? { ok: true, wrapId: "wrap_recheck" } : { ok: false, reason: r };
  },
  /** e2ee.migrate: puts failed documents back in the queue. */
  async retryFailed(scope: WireScope): Promise<void> {
    const key = scopeIdKey(scope);
    const m = read().migrations[key];
    if (m) write({ migrations: { ...read().migrations, [key]: { ...m, failed: [] } } });
  },
};
function bumpLocks(scope: WireScope, count: number, patch: Partial<StubState>) {
  const key = scopeIdKey(scope);
  const s = read();
  const space = s.spaces[key] ?? { level: "standard" as Level, state: "off" as SpaceState, switches: STANDARD_SWITCHES, lockedCount: 0, keyHolders: 1 };
  write({ ...patch, spaces: { ...s.spaces, [key]: { ...space, lockedCount: count } } });
}

/** Folders and notes marked Always fully encrypted (from the replica's `folders.locked` / `documents.locked`). */
export function useLockedIds(): { folders: ReadonlySet<string>; documents: ReadonlySet<string> } {
  const folders = useStub((s) => s.lockedFolders);
  const documents = useStub((s) => s.lockedDocuments);
  return { folders: new Set(folders), documents: new Set(documents) };
}

/** e2ee.devices.list joined to users.listSessions by `sessionKey`: how each signed-in session stands. */
export function useE2eeDevices(): ((sessionId: string) => "trusted" | "none" | "session") | null {
  const lock = useStub((s) => s.lock);
  const devices = useStub((s) => s.devices);
  if (lock === "none") return null;
  return (id) => devices[id] ?? devices["*"] ?? "trusted";
}

/** e2ee.spaces.keyHolders / e2ee.grants.pending: members waiting for the key, rotation progress, changed keys. */
export function useWorkspaceKeys(scope: WireScope): { pending: ReadonlySet<string>; rotation: { done: number; total: number } | null; keyChanged: ReadonlySet<string> } | null {
  const key = scopeIdKey(scope);
  const space = useStub((s) => s.spaces[key]);
  const pending = useStub((s) => s.pendingMembers);
  const rotation = useStub((s) => s.rotation);
  const changed = useStub((s) => s.keyChanged);
  if (!space || space.level === "standard") return null;
  return { pending: new Set(pending), rotation, keyChanged: new Set(changed) };
}

/** WP1 memberSecurityCode over e2ee.keys.accountKeysOf: 12 digits, or null while loading. */
export function useMemberSecurityCode(profileId: string | null): string | null {
  if (!profileId) return null;
  let h = 0;
  for (const c of profileId) h = (h * 31 + c.charCodeAt(0)) % 1_000_000_007;
  return String(h * 7919).padStart(12, "0").slice(-12);
}

/** Whether this person can open an e2ee-active space: keys missing, waiting for an admin's device, or fine. */
export function useSpaceAccess(scope: WireScope): "ok" | "needs_setup" | "waiting_for_key" {
  const key = scopeIdKey(scope);
  const space = useStub((s) => s.spaces[key]);
  const lock = useStub((s) => s.lock);
  const waiting = useStub((s) => s.waitingForKey);
  if (!space || scope.kind === "personal" || space.level === "standard") return "ok";
  if (lock === "none") return "needs_setup";
  return waiting.includes(key) ? "waiting_for_key" : "ok";
}

/** Development only: named states for screenshots and the screen-level e2e specs. */
export function stubPreset(name: "none" | "encrypted" | "locked" | "full" | "migrating"): Partial<StubState> {
  const methods: MethodSummary[] = [
    { publicId: "wrap_device", kind: "device", label: "This browser", createdAt: Date.now() - 86_400_000 },
    { publicId: "wrap_rk", kind: "recoveryKey", label: "Recovery key", createdAt: Date.now() - 86_400_000 },
    { publicId: "wrap_pp", kind: "passphrase", label: "Encryption passphrase", createdAt: Date.now() - 3_600_000 },
  ];
  const personal = (level: Level): Record<string, StubSpace> => ({ personal: { level, state: "on", switches: level === "full" ? FULL_SWITCHES : DEFAULT_SWITCHES, lockedCount: 0, keyHolders: 1 } });
  switch (name) {
    case "none":
      return NONE;
    case "encrypted":
      return { lock: "unlocked", methods, spaces: personal("selected") };
    case "full":
      return { lock: "unlocked", methods, spaces: personal("full") };
    case "locked":
      return { lock: "locked", methods, spaces: personal("selected") };
    case "migrating":
      return {
        lock: "unlocked",
        methods,
        spaces: { personal: { level: "selected", state: "enabling", switches: DEFAULT_SWITCHES, lockedCount: 0, keyHolders: 1 } },
        migrations: { personal: { direction: "seal", phase: "history", documents: { done: 1800, total: 1800 }, history: { done: 340, total: 2100 }, files: { done: 12, total: 80, bytesLeft: 1_200_000_000 }, paused: false, failed: [] } },
      };
  }
}
/** Development only: sets the stub state (used by e2e specs through page.evaluate, and by hand in the console). */
export function setStubState(next: Partial<StubState>) {
  if (!dev) return;
  write(next);
}
if (dev && typeof window !== "undefined") (window as unknown as { __foleviE2eeStub?: unknown }).__foleviE2eeStub = { set: setStubState, preset: stubPreset, read };
