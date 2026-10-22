// Public computer mode, the key side (docs/E2EE_DESIGN.md §4.8, §6.10): the device is a `session` device
// whose keys exist only in this tab's memory; the account master key is never wrapped to it on the server,
// so a reload asks to unlock again.
//
// The choice is kept for the browser (localStorage "folevi.e2ee.publicSession") until someone picks "Trust
// this browser": while it's set, every load opens the account's database in memory from the start
// (lib/sync/db.ts memoryLocalDbIfPublic, called before the account's engine opens) and deletes what an
// earlier session left on disk. A tab that picks "public computer" after its account database already opened
// on disk sets the flag and reloads (`trust("public")`), so the same tab continues in memory and the next
// load wipes what was written before the choice.
import { generateEd25519, generateX25519, openSealed } from "@folevi/local-store/e2ee";
import { ulid } from "@folevi/editor-schema";
import type { DeviceIdentity } from "./keystore";
import { KEYSTORE_DB, closeKeyStore } from "./keystore";

const FLAG = "folevi.e2ee.publicSession";

/** A device for this tab only: non-extractable keys in memory, a new id each time. */
export async function sessionIdentity(): Promise<DeviceIdentity> {
  const [x, ed] = await Promise.all([generateX25519({ extractable: false }), generateEd25519({ extractable: false })]);
  return {
    kind: "session",
    deviceId: `session-${ulid()}`,
    x25519Pub: x.publicKey,
    ed25519Pub: ed.publicKey,
    open: (box, context) => openSealed(x.privateKey, x.publicKey, context, box),
  };
}

/** Marks this browser as used as a public computer, so the next load clears what's left. */
export function markPublicSession(on: boolean): void {
  try {
    if (on) localStorage.setItem(FLAG, "1");
    else localStorage.removeItem(FLAG);
  } catch {
    /* Storage blocked: nothing was kept either. */
  }
}

export function wasPublicSession(): boolean {
  try {
    return localStorage.getItem(FLAG) === "1";
  } catch {
    return false;
  }
}

/** Deletes every `folevi-e2ee*` database (keys, wrap cache, the replicas of a public session). */
export async function clearE2eeDatabases(): Promise<void> {
  await deleteDatabases((n) => n === KEYSTORE_DB || n.startsWith(`${KEYSTORE_DB}-`), [KEYSTORE_DB]);
}

/**
 * What a public computer may have on disk: the key store and replicas (`folevi-e2ee*`) and the accounts' own
 * databases (`folevi-<account>`: sync state, outbox, cached pages). A local library's copy (`folevi-local-*`)
 * isn't an account's and stays, as at sign-out (lib/sync/db.ts clearAllLocalData).
 */
export async function clearPublicDatabases(): Promise<void> {
  await deleteDatabases((n) => n.startsWith("folevi-") && !n.startsWith("folevi-local-"), [KEYSTORE_DB]);
}

async function deleteDatabases(match: (name: string) => boolean, fallback: string[]): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  await closeKeyStore();
  let names = fallback;
  try {
    const list = await indexedDB.databases?.();
    if (list) names = list.map((d) => d.name ?? "").filter(match);
  } catch {
    /* Older browsers can't list: the key store at least goes. */
  }
  await Promise.all(
    names.map(
      (name) =>
        new Promise<void>((resolve) => {
          const req = indexedDB.deleteDatabase(name);
          req.onsuccess = req.onerror = req.onblocked = () => resolve();
        }),
    ),
  );
}

/**
 * At load, on a browser used as a public computer: deletes what is on disk (this tab's own account database
 * is in memory, so none of it is open here). The browser stays a public computer.
 */
export async function clearPublicLeftovers(): Promise<boolean> {
  if (!wasPublicSession()) return false;
  await clearPublicDatabases();
  return true;
}
