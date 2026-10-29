// The Vault over the bridge (revision 18; docs/VAULT_PLAN.md, docs/MAC_REBUILD_PLAN.md §5.6): the same calls and the
// same cryptography as the web's Vault screens (components/vault/*, lib/vault/*), with the opened values handed to
// native screens. Keys stay here, in memory (lib/vault/keys.ts); nothing of the Vault goes into the kept answers.
// One implementation for both places: in a library the page's client answers the vault functions on the device
// (lib/local/functions/vault.ts) and the session acts as the library (no account key).
import type { FunctionReference } from "convex/server";
import { QuerySource, Emitter, signalOf, toEngineError, type Signal, type Snapshot } from "./live";
import { BridgeError } from "./validate";
import type { EngineDeps, ViewContext } from "./context";
import { spaceOf } from "./context";
import type { LiveValue } from "./views";
import { VAULT_PASSCODE_LENGTHS } from "@folevi/local-store/e2ee";
import { getKeySession, sessionImpl } from "@/lib/e2ee/keys/session";
import { libraryVaultActor, vaultSessions, type UnlockResult, type VaultClient } from "@/lib/vault/keys";
import { ITEM_KINDS, openSummary, openSummaryAs, type ItemKind, type ItemSummary } from "@/lib/vault/items";
import { openFolderName, type FileSummary, type NoteSummary } from "@/lib/vault/files";
import type { VaultFieldDef, VaultHealthGroup, VaultItemRow, VaultKindDef, VaultSection, VaultSummaryValue, VaultUnlockResult } from "./protocol";

export type Row = { id: string; kind: string; folderId: string | null; keyVersion: number; wrappedKey: ArrayBuffer; sealedSummary: ArrayBuffer; revision: number; updatedAt: number; deletedAt: number | null; size: number | null; passwordMac: string | null; createdBy: { name: string }; updatedBy: { name: string } };
export type VaultInfo = {
  exists: boolean;
  id?: string;
  personal: boolean;
  role: string;
  keyVersion?: number;
  needsPasscode?: boolean;
  waitingForKey?: boolean;
  recoveryOutdated?: boolean;
  rotationNeeded?: boolean;
  accessReviewDue?: boolean;
  autoLockMinutes?: number;
  custodiansNameCustodians?: boolean;
} | null;

export const isLocal = (deps: EngineDeps) => deps.app.mode === "local";

/** Binds the page's Vault session to this device's actor: the library, or the account's unlocked keys. */
export function bindVault(deps: EngineDeps): void {
  const client = deps.client as unknown as VaultClient;
  if (isLocal(deps)) return vaultSessions().bind(client, libraryVaultActor());
  try {
    if (getKeySession().state() !== "unlocked") return vaultSessions().bind(client, null);
    const u = sessionImpl().unlocked();
    vaultSessions().bind(client, { profileId: deps.app.profile.id, epoch: u.epoch, account: u.account.x25519, deviceId: getKeySession().deviceId() });
  } catch {
    vaultSessions().bind(client, null);
  }
}

/** The keys of an open Vault (a locked one answers "locked", which native shows as the unlock screen). */
export function keysOf(vaultId: string) {
  if (!vaultSessions().isOpen(vaultId)) throw new BridgeError("locked", "The Vault is locked.");
  return (version: number) => vaultSessions().keys(vaultId, version);
}

/** A live query whose answers are never kept on the device (they're the Vault's, sealed or not). */
export function vaultSource<T>(ctx: ViewContext, ref: FunctionReference<"query">, args: Record<string, unknown>): QuerySource<T> {
  return new QuerySource<T>(ctx.deps().client, ref, args, { kept: null, persist: () => false });
}

export const sessionSignal: Signal = { subscribe: (cb) => vaultSessions().subscribe(cb) };

/**
 * A view whose value is worked out asynchronously (decrypting) from live inputs: it recomputes when an input's
 * snapshot changes, shows the last value meanwhile, and drops a result that an input overtook.
 */
export function decrypting<T>(signals: Signal[], inputs: () => { ready: boolean; stale: boolean; error: unknown; token: unknown[] }, run: () => Promise<T>): LiveValue {
  const done = new Emitter();
  let token: unknown[] | null = null;
  let value: T | undefined;
  let error: unknown = null;
  let running = false;
  const same = (a: unknown[] | null, b: unknown[]) => !!a && a.length === b.length && a.every((x, i) => x === b[i]);
  return {
    signals: [...signals, done, sessionSignal],
    compute(): Snapshot<unknown> {
      const i = inputs();
      if (i.error) return { value: undefined, stale: false, error: toEngineError(i.error) };
      if (!i.ready) return { value, stale: true, error: null };
      if (!same(token, i.token)) {
        const mine = i.token;
        token = mine;
        running = true;
        void run().then(
          (v) => {
            if (token !== mine) return;
            value = v;
            error = null;
            running = false;
            done.emit();
          },
          (e) => {
            if (token !== mine) return;
            error = e;
            running = false;
            done.emit();
          },
        );
      }
      if (error && !running) return { value: undefined, stale: false, error: toEngineError(error) };
      return { value, stale: running || i.stale, error: null };
    },
  };
}

// ---- words and shapes the web screens use ----

export const KIND_DEFS: VaultKindDef[] = (Object.entries(ITEM_KINDS) as [ItemKind, (typeof ITEM_KINDS)[ItemKind]][]).map(([kind, d]) => ({ kind, label: d.label, fields: d.fields.map((f): VaultFieldDef => ({ key: f.key, label: f.label, type: f.type })) }));

export const kindLabel = (k: string) => (k === "note" ? "Note" : k === "file" ? "File" : (ITEM_KINDS[k as ItemKind]?.label ?? k));

/** A file's size as the web writes it. */
export const fileSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** The web's password row second line: the kind, then the username, service or website. */
export const passwordDetail = (s: ItemSummary & { kind: ItemKind }) => [ITEM_KINDS[s.kind]?.label, s.fields.username || s.fields.service || s.fields.website].filter(Boolean).join(" · ");

export interface OpenedRow {
  row: Row;
  summary: (ItemSummary & { kind: ItemKind }) | null;
  out: VaultItemRow;
}

/** Opens a row's summary into what lists show (the web's Passwords, Files and Trash rows). */
export async function openRow(vaultId: string, row: Row): Promise<OpenedRow> {
  const keys = keysOf(vaultId);
  const base = { id: row.id, kind: row.kind, kindLabel: kindLabel(row.kind), folderId: row.folderId, revision: row.revision, updatedAt: row.updatedAt, deletedAt: row.deletedAt, mime: null as string | null, size: row.size };
  if (row.kind === "file") {
    const s = await openSummaryAs<FileSummary>(vaultId, row, keys).catch(() => null);
    return { row, summary: null, out: { ...base, title: s?.title ?? "Can't open", detail: fileSize(row.size ?? s?.size ?? 0), mime: s?.mime ?? null, size: s?.size ?? row.size } };
  }
  if (row.kind === "note") {
    const s = await openSummaryAs<NoteSummary>(vaultId, row, keys).catch(() => null);
    return { row, summary: null, out: { ...base, title: s?.title ?? "Can't open", detail: s?.excerpt ?? "" } };
  }
  const s = await openSummary(vaultId, row, keys).catch(() => null);
  return { row, summary: s, out: { ...base, title: s?.title ?? "Can't open this item", detail: s ? passwordDetail(s) : kindLabel(row.kind) } };
}

export async function folderNames(vaultId: string, rows: { id: string; parentId: string | null; sealedName: ArrayBuffer; keyVersion: number; updatedAt: number }[]) {
  const keys = keysOf(vaultId);
  return await Promise.all(rows.map(async (f) => ({ id: f.id, parentId: f.parentId, name: await openFolderName(vaultId, f.id, f.sealedName, keys, f.keyVersion).catch(() => "Can't open"), updatedAt: f.updatedAt })));
}

// ---- Health (components/vault/Health.tsx) ----

type Issue = "breached" | "reused" | "weak" | "expired" | "expiring" | "unchecked";
const DAY = 86_400_000;
const ISSUE_TEXT: Record<Issue, { title: string; body: string; tone: string }> = {
  breached: { title: "Found in a data breach", body: "This password is in Pwned Passwords. Change it wherever it's used.", tone: "danger" },
  reused: { title: "Used more than once", body: "The same password is on other items. If one leaks, the others go too.", tone: "warning" },
  weak: { title: "Weak", body: "Short or easy to guess. Generate a new one.", tone: "warning" },
  expired: { title: "Expired", body: "Its expiry date has passed.", tone: "danger" },
  expiring: { title: "Expires within 30 days", body: "Renew or replace it soon.", tone: "warning" },
  unchecked: { title: "Not checked yet", body: "Saved before Health existed, or the breach check couldn't reach the service. Edit and save it to check.", tone: "muted" },
};
const ISSUE_ORDER: Issue[] = ["breached", "expired", "reused", "weak", "expiring", "unchecked"];

export function healthGroups(opened: OpenedRow[], reuse: Record<string, number>, now: number): { needsLook: number; groups: VaultHealthGroup[] } {
  const by = new Map<Issue, VaultItemRow[]>();
  const serious = new Set<string>();
  for (const o of opened) {
    const s = o.summary;
    if (!s) continue;
    const out: Issue[] = [];
    const h = s.health;
    if (h?.breached === "breached") out.push("breached");
    if (o.row.passwordMac && (reuse[o.row.passwordMac] ?? 0) > 1) out.push("reused");
    if (h && h.strength <= 1) out.push("weak");
    const expires = s.fields.expires ? Date.parse(s.fields.expires) : NaN;
    if (!Number.isNaN(expires)) out.push(...(expires < now ? (["expired"] as Issue[]) : expires < now + 30 * DAY ? (["expiring"] as Issue[]) : []));
    if (o.row.passwordMac && (!h || h.breached === "unknown")) out.push("unchecked");
    for (const i of out) {
      if (i !== "unchecked") serious.add(o.row.id);
      const detail = [o.out.detail, i === "expired" || i === "expiring" ? `expires ${s.fields.expires}` : null].filter(Boolean).join(" · ");
      by.set(i, [...(by.get(i) ?? []), { ...o.out, detail }]);
    }
  }
  return { needsLook: serious.size, groups: ISSUE_ORDER.filter((i) => by.has(i)).map((i) => ({ issue: i, ...ISSUE_TEXT[i], items: by.get(i)! })) };
}

// ---- the summary ----

export function summaryOf(deps: EngineDeps, info: VaultInfo): VaultSummaryValue {
  const local = isLocal(deps);
  const base: VaultSummaryValue = {
    state: "none",
    vaultId: null,
    personal: info?.personal ?? true,
    local,
    role: info?.role ?? "member",
    autoLockMinutes: info?.autoLockMinutes ?? 5,
    locksAt: null,
    recoveryToSave: null,
    recoveryOutdated: false,
    accessReviewDue: false,
    custodiansNameCustodians: info?.custodiansNameCustodians ?? false,
    moreSections: [],
    passcodeLengths: [...VAULT_PASSCODE_LENGTHS],
  };
  if (!info) return base;
  const more: VaultSection[] = ["health", ...(local ? [] : (["activity"] as VaultSection[])), ...(info.personal ? [] : (["people"] as VaultSection[])), "trash", "settings"];
  const s = vaultSessions();
  const id = info.exists ? (info.id ?? null) : null;
  let state: VaultSummaryValue["state"];
  const encryption = local ? "unlocked" : getKeySession().state();
  if (!local && (encryption === "locked" || encryption === "unlocking")) state = "encryptionLocked";
  else if (!info.exists || info.keyVersion === 0) state = "setUp";
  else if (id && s.isOpen(id)) state = "open";
  else if (info.waitingForKey) state = "waitingForKey";
  else if (info.needsPasscode) state = "needsPasscode";
  else state = "locked";
  return {
    ...base,
    state,
    vaultId: id,
    locksAt: id ? s.locksAt(id) : null,
    recoveryToSave: id ? s.recoveryFor(id) : null,
    recoveryOutdated: info.recoveryOutdated ?? false,
    accessReviewDue: info.accessReviewDue ?? false,
    moreSections: more,
  };
}

export function scopeArgs(deps: EngineDeps, space: string | undefined) {
  const s = spaceOf(deps.app, space);
  if (!s) throw new BridgeError("not_found", "That Personal or workspace isn't in this place.");
  return { scope: s.scope };
}

// ---- unlock results in the web's words (components/vault/VaultGate.tsx) ----

export function unlockResult(r: UnlockResult): VaultUnlockResult {
  if (r.status === "wrong") return { status: "wrong", until: null, message: "That isn't right. Try again." };
  if (r.status === "locked") return { status: "locked", until: r.until, message: `Too many wrong tries. Try again at ${new Date(r.until).toLocaleTimeString()}.` };
  if (r.status === "notSetUp") return { status: "notSetUp", until: null, message: "You don't have this Vault's key yet. A custodian's device shares it when they next open the Vault." };
  if (r.status === "needsPasscode") return { status: "needsPasscode", until: null, message: null };
  return { status: "ok", until: null, message: null };
}

/** Passcodes from before PINs had a letter, or more than 12 digits; a mistyped PIN never does. */
export const fromBeforePins = (passcode: string) => /\D/.test(passcode) || passcode.length > 12;

export { signalOf };
