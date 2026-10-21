// Public computer mode, the key side (docs/E2EE_DESIGN.md §4.8, §6.10): the device is a `session` device
// whose keys exist only in this tab's memory; the account master key is never wrapped to it on the server,
// so a reload asks to unlock again. Anything a public session left in IndexedDB (`folevi-e2ee*`) is deleted
// at sign-out or on the next load.
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

/** Deletes every `folevi-e2ee*` database (keys, wrap cache, the replica and outbox of a public session). */
export async function clearE2eeDatabases(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  await closeKeyStore();
  let names: string[] = [KEYSTORE_DB];
  try {
    const list = await indexedDB.databases?.();
    if (list) names = list.map((d) => d.name ?? "").filter((n) => n === KEYSTORE_DB || n.startsWith(`${KEYSTORE_DB}-`));
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

/** At load: a public session's leftovers go. */
export async function clearPublicLeftovers(): Promise<boolean> {
  if (!wasPublicSession()) return false;
  await clearE2eeDatabases();
  markPublicSession(false);
  return true;
}
