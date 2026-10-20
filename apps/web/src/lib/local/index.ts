// This page's local library: one LocalHost per page (host.ts), started the first time local mode renders.
// Where the library is stored is configured by the shell (Phase 2: a store over packages/local-store and the
// native file layer). Until then the default is an in-memory store, so local mode can be opened in
// development, and nothing written there survives a reload.
import { ulid } from "@folevi/editor-schema";
import { LocalBackend } from "./backend";
import { startLocalHost, type LocalHost, type LocalHostOptions } from "./host";
import { MemoryStore, type LocalStore } from "./store";

export interface LocalLibraryConfig {
  openStore: () => Promise<LocalStore>;
  /** Overrides for the host (tests: fake locks and channels). */
  host?: Omit<LocalHostOptions, "openBackend">;
}

let warned = false;
let config: LocalLibraryConfig = {
  openStore: async () => {
    if (!warned && process.env.NODE_ENV !== "production") {
      warned = true;
      console.warn("[local mode] No library store is configured: notes are kept in memory and go when the page reloads.");
    }
    return new MemoryStore();
  },
};
let host: LocalHost | null = null;

/** Sets where the library lives. Call before local mode first renders. */
export function configureLocalLibrary(next: LocalLibraryConfig): void {
  config = next;
}

const DEVICE_KEY = "folevi:local-device";

/** This device's id in local libraries (kept in this origin's storage). */
export function localDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = `dev_${ulid()}`;
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return `dev_${ulid()}`;
  }
}

/** The page's library host, started on first use. */
export function localLibrary(): LocalHost {
  host ??= startLocalHost({
    ...config.host,
    openBackend: async () => new LocalBackend(await config.openStore(), { deviceId: localDeviceId() }),
  });
  return host;
}

/** Closes the page's library (tests, and a switch to account mode). */
export async function closeLocalLibrary(): Promise<void> {
  const h = host;
  host = null;
  await h?.close();
}

export { LocalClient, type LocalExecutor, type LocalHostApi, type LocalSetup } from "./client";
export { LocalBackend } from "./backend";
export { MemoryStore, type LocalStore } from "./store";
