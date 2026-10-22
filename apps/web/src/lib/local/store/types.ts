// What the library store shows the rest of the app (Library settings, the unlock screen) and what it needs from
// the host (docs/LOCAL_MODE_PLAN.md §3, §4.1). Types only.
import type { JournalStore, LocalFs } from "@folevi/local-store";
import type { LibraryChange, LibraryInfo, LibraryKind } from "@/lib/shell/types";

/**
 * The part of `shell().library` the store uses: the library's files (`LocalFs`), its journal, change events,
 * placeholders and the passphrase. The Mac preload provides it; tests use `MemoryLibraryHost`.
 */
export interface LibraryHost extends LocalFs {
  info(): Promise<LibraryInfo>;
  setup?(o: { kind: LibraryKind }): Promise<LibraryInfo | null>;
  watch(cb: (changes: LibraryChange[]) => void): () => void;
  startDownload(paths: string[]): Promise<void>;
  journal: JournalStore;
  unlock(passphrase: string): Promise<boolean>;
}

/** Where the store is in its life. */
export type LibraryState =
  /** Reading what this device kept, and the folder. */
  | "opening"
  /** Open and in step with the folder (or catching up). */
  | "ready"
  /** Encrypted and waiting for the passphrase: what this device kept shows, nothing is read from or written to the folder. */
  | "locked"
  /** The folder can't be reached (iCloud signed out, the folder moved): edits are kept on this device until it's back. */
  | "unavailable"
  | "closed";

/** A file Library health lists. */
export interface HealthItem {
  path: string;
  /** The note it belongs to, when known. */
  documentId: string | null;
  /** The note's title from the catalog, when known. */
  title: string | null;
  detail?: string;
  /** When it was first seen in this state. */
  since: number;
}

export interface LibraryHealth {
  /** Files that couldn't be read or checked (damaged, half written, can't be decrypted). Never written over. */
  unreadable: HealthItem[];
  /** Files the provider hasn't downloaded to this device yet. */
  downloading: HealthItem[];
  /** Things another device referred to that haven't arrived (an attachment, a synced block's note). */
  waiting: HealthItem[];
}

export interface LibraryDevice {
  deviceId: string;
  name: string;
  platform: "mac" | "ios" | "android" | "web";
  appVersion: string;
  /** When it last wrote its record (its last sync). */
  lastSeen: number;
  thisDevice: boolean;
}

export interface LibraryStatus {
  state: LibraryState;
  info: LibraryInfo | null;
  libraryId: string | null;
  /** This device's id in the library (file names, version history). */
  deviceId: string;
  /** The last time a sync with the folder finished. */
  lastSyncAt: number | null;
  syncing: boolean;
  /** Notes changed on this device that the folder doesn't hold yet. */
  unsaved: number;
  notes: { total: number; downloading: number };
  health: LibraryHealth;
  devices: LibraryDevice[];
  /** The last error a sync hit, for people to read. */
  error: string | null;
}

/** The library's controls (`store.library`, and `client.local.library` in the window that hosts it). */
export interface LibraryControl {
  status(): LibraryStatus;
  /** Called whenever `status()` changes. */
  subscribe(cb: () => void): () => void;
  /** Unlocks an encrypted library; false when the passphrase is wrong. */
  unlock(passphrase: string): Promise<boolean>;
  /** Reads the folder and writes what it lacks, now ("Sync now"). */
  syncNow(): Promise<void>;
  /** Writes every unsaved note to the folder now (the app going to the background). */
  flush(): Promise<void>;
}
