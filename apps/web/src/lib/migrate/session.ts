"use client";
// The app's side of a move between modes (docs/LOCAL_MODE_PLAN.md §6): which move is under way (kept in this
// origin's storage, so it goes on after the page reloads into the other mode), opening the library in a
// signed-in window, and the steps around the copy itself: signing in before going up, signing out after
// coming down.
import type { LibraryKind, ShellSignInOptions } from "@/lib/shell/types";
import { setShellMode, shell } from "@/lib/shell";

/** A move under way. Kept until it's done or the person goes back. */
export type PendingMove =
  | { direction: "upload"; startedAt: number; versions: boolean }
  | { direction: "export"; startedAt: number; versions: boolean; kind: LibraryKind; workspaces: { id: string; name: string }[] };

const KEY = "folevi:migration";
const listeners = new Set<() => void>();
let cached: { raw: string | null; value: PendingMove | null } | null = null;

function read(): PendingMove | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    raw = null;
  }
  if (cached && cached.raw === raw) return cached.value;
  let value: PendingMove | null;
  try {
    const parsed = raw ? (JSON.parse(raw) as PendingMove) : null;
    value = parsed && (parsed.direction === "upload" || parsed.direction === "export") ? parsed : null;
  } catch {
    value = null;
  }
  cached = { raw, value };
  return value;
}

/** The move under way, or null. */
export function pendingMove(): PendingMove | null {
  if (typeof window === "undefined") return null;
  return read();
}

export function subscribePendingMove(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function setPendingMove(move: PendingMove | null): void {
  try {
    if (move) localStorage.setItem(KEY, JSON.stringify(move));
    else localStorage.removeItem(KEY);
  } catch {
    // Without storage the move can't go on after a reload; it still runs in this page.
  }
  cached = null;
  for (const l of [...listeners]) l();
}

/** Switches the app to the other mode; the host reloads its windows (a page without one reloads itself). */
export async function switchMode(mode: "local" | "account"): Promise<void> {
  await setShellMode(mode);
  window.location.reload();
}

/**
 * "Sign in to Folevi" from a library (local mode): the sign-in sheet opens (on Google's or Apple's page with
 * `provider`), the person signs in or makes an account there, and the app comes back signed in, in account
 * mode, where the move starts (plan §6.1 step 1). Nothing changes if signing in doesn't finish.
 * `beforeSwitch` closes the library first.
 */
export async function startMoveToAccount(o: { versions: boolean; beforeSwitch?: () => Promise<void> } & ShellSignInOptions): Promise<boolean> {
  const host = shell();
  if (!host) throw new Error("Moving a library needs the Folevi app.");
  const ok = await (o.provider ? host.auth.signIn({ provider: o.provider }) : host.auth.signIn());
  if (!ok) return false;
  setPendingMove({ direction: "upload", startedAt: Date.now(), versions: o.versions });
  await o.beforeSwitch?.();
  await switchMode("account");
  return true;
}

/** Opens the library this device keeps, in a window signed in to an account (where a move runs). */
export async function openLibraryHere() {
  const [{ LocalBackend }, { LocalClient }, { localDeviceId }, store] = await Promise.all([
    import("@/lib/local/backend"),
    import("@/lib/local/client"),
    import("@/lib/local/index"),
    import("@/lib/local/store/index"),
  ]);
  const host = store.shellLibraryHost();
  if (!host) throw new Error("There's no library on this Mac.");
  const deviceId = localDeviceId();
  const opened = await store.openShellLibraryStore(deviceId);
  const backend = new LocalBackend(opened, { deviceId });
  const client = new LocalClient(backend);
  return {
    backend,
    client,
    host,
    deviceId,
    async close() {
      await client.close();
      await backend.close();
    },
  };
}

export type OpenLibrary = Awaited<ReturnType<typeof openLibraryHere>>;

/**
 * After an account came down into a library (plan §6.2 step 6): this device signs out (the host revokes its
 * session and forgets the token), forgets the account's copy here (but never the library's, `folevi-local-*`),
 * and opens in local mode. The account itself goes on existing.
 */
export async function signOutAfterExport(profileId?: string): Promise<void> {
  const [{ forgetThisDevice }, { clearAllLocalData, clearAccountData }] = await Promise.all([import("@/lib/nativeDevice"), import("@/lib/sync/db")]);
  await forgetThisDevice().catch(() => undefined);
  // Several places: only this account goes, and the library opens (the other accounts stay signed in).
  const places = shell()?.places;
  const place = places?.current ?? null;
  if (places && place?.startsWith("acct:")) {
    if (profileId) await clearAccountData(profileId, place.slice(5));
    setPendingMove(null);
    await places.signOut(place, { next: "library" }).catch(() => undefined);
    return;
  }
  await shell()
    ?.auth.signOut()
    .catch(() => undefined);
  await clearAllLocalData({ keep: (name) => name.startsWith("folevi-local-") });
  setPendingMove(null);
  await switchMode("local");
}

/** What only Folevi's own files are in a library folder (Remove the local copy… removes these, nothing else). */
export const LIBRARY_PATHS = ["folevi-library.json", "notes/", "files/", "history/", "index/", "devices/", "exported/", ".folevi-tmp/"];

/** Removes the library's files from its folder and this device's copy of it, after it moved to an account. */
export async function removeLocalCopy(): Promise<number> {
  const host = shell()?.library;
  if (!host) return 0;
  const entries = await host.list("");
  let removed = 0;
  // The library file goes last, so a folder half removed still reads as a library.
  const paths = entries.map((e) => e.path).filter((p) => LIBRARY_PATHS.some((own) => (own.endsWith("/") ? p.startsWith(own) : p === own)));
  paths.sort((a, b) => (a === "folevi-library.json" ? 1 : b === "folevi-library.json" ? -1 : 0));
  for (const p of paths) {
    await host.remove(p).catch(() => undefined);
    removed++;
  }
  const all = (await indexedDB.databases?.()) ?? [];
  await Promise.all(
    all
      .filter((d) => d.name?.startsWith("folevi-local-"))
      .map(
        (d) =>
          new Promise<void>((resolve) => {
            const req = indexedDB.deleteDatabase(d.name!);
            req.onsuccess = req.onerror = req.onblocked = () => resolve();
          }),
      ),
  );
  return removed;
}
