// The persistent local store: where `configureLocalLibrary` (lib/local/index.ts) gets the library when the
// app runs in the shell (docs/LOCAL_MODE_PLAN.md §3, §4.1). See libraryStore.ts for how it works.
import { shell } from "@/lib/shell";
import type { LibraryKind } from "@/lib/shell/types";
import { LibraryStore, libraryDeviceId, type LibraryStoreOptions } from "./libraryStore";
import type { LibraryHost } from "./types";

export { LibraryStore, libraryDeviceId, type LibraryStoreOptions } from "./libraryStore";
export { MemoryLibraryHost, createEncryptedLibrary, type MemoryLibraryHostOptions } from "./memoryHost";
export { IdbReplicaDb, MemoryReplicaDb, openDefaultReplicaDb, replicaDbName, type OpenReplicaDb, type ReplicaDb } from "./replicaDb";
export type { HealthItem, LibraryControl, LibraryDevice, LibraryHealth, LibraryHost, LibraryState, LibraryStatus } from "./types";

/** The shell's library as the store uses it, or null without a shell. */
export function shellLibraryHost(): LibraryHost | null {
  const library = shell()?.library;
  return library ? (library as unknown as LibraryHost) : null;
}

/**
 * Sets up where the library lives (the place the person chose on first launch, WP10's LibrarySetup) and
 * returns its info; null when they cancelled the folder picker. The library's own files are made when the
 * store first opens it.
 */
export async function setupLibraryLocation(kind: LibraryKind) {
  const library = shell()?.library;
  if (!library) throw new Error("There's no app shell to keep a library in.");
  return await library.setup({ kind });
}

/** Opens the library the shell keeps, for this device. */
export async function openShellLibraryStore(deviceId: string, opts: Partial<Omit<LibraryStoreOptions, "host" | "deviceId">> = {}): Promise<LibraryStore> {
  const host = shellLibraryHost();
  if (!host) throw new Error("There's no app shell to keep a library in.");
  const platform = shell()?.platform ?? "mac";
  return await LibraryStore.open({ host, deviceId, device: { platform, appVersion: shell()?.shellVersion ?? "", ...(shell()?.deviceName ? { name: shell()!.deviceName } : {}), ...opts.device }, ...opts });
}

export { libraryDeviceId as deviceIdForLibrary };
