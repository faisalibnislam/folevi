// The person's own AI keys on all their devices, end-to-end encrypted (lib/ai/ownKey.ts; docs/AI_ASSISTANT.md,
// "Your own AI key"). For an account with encryption set up, each key is sealed on the device with the account
// master key (AMK "account/records", context `record/account/<profileId>/aiKey/<provider>`, docs/E2EE_DESIGN.md
// §3) and kept in e2ee.accountRecords; the server never opens it. Other devices open it once they're unlocked
// and keep their own copy (the keychain in an app, the sealed page store in a browser, memory only on a public
// computer). Removing a key leaves an empty row, so the other devices remove theirs too. Which provider and model
// Foli AI uses (or none) is one more record, "choice": the newest change wins on every device.
//
// Accounts without encryption keep keys per device: there's no key the server can't read to seal them with.
import { ctx, openRecord, sealRecord } from "@folevi/local-store/e2ee";
import { sessionImpl } from "@/lib/e2ee/keys/session";
import { bytes, wire } from "@/lib/e2ee/keys/util";
import type { OwnKeyChoice, OwnKeyProvider } from "./ownKey";

const KIND = "aiKey" as const;
const SAVED_AT = "folevi:own-ai-key-at";

/** What this device needs from lib/ai/ownKey.ts (passed in, so the two modules don't import each other's internals). */
export interface LocalKeys {
  providers: readonly OwnKeyProvider[];
  read(p: OwnKeyProvider): Promise<string | null>;
  /** Saves on this device only (never synced again from here). */
  write(p: OwnKeyProvider, key: string): Promise<void>;
  forget(p: OwnKeyProvider): Promise<void>;
  /** The provider and model in use here, and setting it from another device's (never synced again from here). */
  choice(): OwnKeyChoice | null;
  applyChoice(c: OwnKeyChoice | null): void;
}

/** The record names: one per provider, and the choice. */
type RecordName = OwnKeyProvider | "choice";
const CHOICE = "choice" as const;

/** When this device's copy of each key was saved or last taken from another device. */
function savedAt(): Partial<Record<RecordName, number>> {
  try {
    return JSON.parse(localStorage.getItem(SAVED_AT) ?? "{}") as Partial<Record<RecordName, number>>;
  } catch {
    return {};
  }
}

export function markSaved(p: RecordName, at: number | null): void {
  try {
    const all = savedAt();
    if (at === null) delete all[p];
    else all[p] = at;
    localStorage.setItem(SAVED_AT, JSON.stringify(all));
  } catch {
    /* storage unavailable */
  }
}

/** Keys taken from another device on a public computer: kept in this tab's memory, never on disk. */
const inMemory = new Map<OwnKeyProvider, string>();
export const memoryKey = (p: OwnKeyProvider) => inMemory.get(p) ?? null;

function unlocked() {
  const s = sessionImpl();
  if (s.state() !== "unlocked") return null;
  try {
    const u = s.unlocked();
    return u.server.accountRecords ? { ...u, records: u.server.accountRecords, isPublic: s.isPublic() } : null;
  } catch {
    return null;
  }
}

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/** Seals this device's key for the person's other devices. Nothing happens without encryption set up and unlocked. */
export async function pushOwnKey(p: OwnKeyProvider, apiKey: string): Promise<boolean> {
  const u = unlocked();
  if (!u) return false;
  const sealed = await sealRecord(u.account.records, u.epoch, ctx.accountRecord(u.profileId, KIND, p), encoder.encode(JSON.stringify({ apiKey })));
  const r = await u.records.put({ kind: KIND, recordId: p, epoch: u.epoch, sealed: wire(sealed) });
  markSaved(p, r.updatedAt);
  return true;
}

/** Seals the provider and model in use (or none) for the person's other devices. */
export async function pushOwnKeyChoice(choice: OwnKeyChoice | null): Promise<boolean> {
  const u = unlocked();
  if (!u) return false;
  const sealed = await sealRecord(u.account.records, u.epoch, ctx.accountRecord(u.profileId, KIND, CHOICE), encoder.encode(JSON.stringify({ choice })));
  const r = await u.records.put({ kind: KIND, recordId: CHOICE, epoch: u.epoch, sealed: wire(sealed) });
  markSaved(CHOICE, r.updatedAt);
  return true;
}

/** A choice as another device sealed it, checked: a known provider and a model name, or none. */
function choiceOf(v: unknown, providers: readonly OwnKeyProvider[]): OwnKeyChoice | null | undefined {
  if (v === null) return null;
  if (!v || typeof v !== "object") return undefined;
  const c = v as { provider?: unknown; model?: unknown };
  if (typeof c.provider !== "string" || !(providers as readonly string[]).includes(c.provider) || typeof c.model !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(c.model)) return undefined;
  return { provider: c.provider as OwnKeyProvider, model: c.model };
}

/** Removes the key from the person's other devices (an empty row they apply on their next sync). */
export async function removeSyncedKey(p: OwnKeyProvider): Promise<void> {
  inMemory.delete(p);
  const s = sessionImpl();
  if (s.state() === "none") return;
  try {
    await s.bound().server.accountRecords?.remove({ kind: KIND, recordId: p });
  } catch {
    /* signed out or offline: the other devices keep theirs until it's removed there */
  }
}

let running: Promise<number> | null = null;

/**
 * Brings this device and the account's sealed keys together: a key saved elsewhere is opened and kept here, one
 * removed elsewhere is forgotten here, and a key only this device has (or one sealed under an older master key)
 * is sealed again for the others. Returns how many keys changed here.
 */
export function syncOwnKeys(local: LocalKeys): Promise<number> {
  running ??= (async () => {
    const u = unlocked();
    if (!u) return 0;
    const rows = await u.records.list({ kind: KIND });
    const at = savedAt();
    let changed = 0;
    for (const p of local.providers) {
      const row = rows.find((r) => r.recordId === p);
      const mine = (u.isPublic ? memoryKey(p) : null) ?? (await local.read(p));
      const when = at[p] ?? 0;
      if (row?.deletedAt) {
        // Removed on another device after this one saved it.
        if (mine && row.deletedAt > when) {
          inMemory.delete(p);
          await local.forget(p);
          markSaved(p, null);
          changed++;
        }
        continue;
      }
      if (row?.sealed && row.epoch === u.epoch && (!mine || row.updatedAt > when)) {
        let theirs: unknown = null;
        try {
          const plain = await openRecord(u.account.records, ctx.accountRecord(u.profileId, KIND, p), bytes(row.sealed));
          theirs = (JSON.parse(decoder.decode(plain)) as { apiKey?: unknown }).apiKey;
        } catch {
          /* not readable here: sealed again from this device's copy below */
        }
        if (typeof theirs === "string" && theirs) {
          if (theirs !== mine) {
            if (u.isPublic) inMemory.set(p, theirs);
            else await local.write(p, theirs);
            changed++;
          }
          markSaved(p, row.updatedAt);
          continue;
        }
      }
      // Only this device has it, or the others' copy is from before an encryption reset: seal it for them.
      if (mine && (!row?.sealed || row.epoch !== u.epoch)) await pushOwnKey(p, mine).catch(() => false);
    }
    // The provider and model in use: the newest change wins.
    const row = rows.find((r) => r.recordId === CHOICE);
    const when = at[CHOICE] ?? 0;
    let readable = false;
    if (row?.sealed && row.epoch === u.epoch) {
      try {
        const plain = await openRecord(u.account.records, ctx.accountRecord(u.profileId, KIND, CHOICE), bytes(row.sealed));
        const theirs = choiceOf((JSON.parse(decoder.decode(plain)) as { choice?: unknown }).choice, local.providers);
        if (theirs !== undefined) {
          readable = true;
          if (row.updatedAt > when) {
            const mine = local.choice();
            if (JSON.stringify(theirs) !== JSON.stringify(mine)) {
              local.applyChoice(theirs);
              changed++;
            }
            markSaved(CHOICE, row.updatedAt);
          }
        }
      } catch {
        /* not readable here: sealed again from this device's below */
      }
    }
    // Chosen here and never shared (or the shared one is from before a reset): seal it for the others.
    if (!readable && at[CHOICE] !== undefined) await pushOwnKeyChoice(local.choice()).catch(() => false);
    return changed;
  })().finally(() => {
    running = null;
  });
  return running;
}

let watching = false;

/** Syncs whenever this tab's encryption keys unlock (and once now, if they already are). */
export function watchOwnKeySync(local: LocalKeys, onChange: () => void): void {
  if (watching) return;
  watching = true;
  const s = sessionImpl();
  let was = s.state();
  const run = () => void syncOwnKeys(local).then((n) => n && onChange(), () => undefined);
  s.subscribe(() => {
    const now = s.state();
    if (now === "unlocked" && was !== "unlocked") run();
    if (now !== "unlocked") inMemory.clear();
    was = now;
  });
  if (was === "unlocked") run();
}
