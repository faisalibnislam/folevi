// From a Folevi account to "Keep notes on my devices" (docs/LOCAL_MODE_PLAN.md §6.2). Runs signed in, with a
// new (or existing) library open beside the account: every note of Personal comes down (Archive and Trash
// too), with its blocks, collections, folders, tags, found text and, if asked, its history; attachments are
// downloaded and stored in the library by their bytes. Note and block ids stay, so links and synced blocks keep
// working; the Inbox becomes the library's Inbox. Workspaces the person manages can come too, each as a folder
// named after it. What only the server can keep (comments, sharing, workspace members) is written down in
// exported/server-only.json. Then this device signs out of the account, which goes on existing.
import type { LocalFs } from "@folevi/local-store";
import { api } from "@/lib/convex/api";
import type { LocalBackend } from "@/lib/local/backend";
import { copyLibrary } from "./copy";
import { libraryProgress, progressKey } from "./progress";
import { accountFiles, clientSource } from "./source";
import { clientTarget, libraryPutFile } from "./target";
import type { MigrationClient, MigrationProgress, MigrationState } from "./types";

/** Where the record of what stays on the server goes, in the library's folder. */
export const SERVER_ONLY_PATH = "exported/server-only.json";

/** A workspace the person can manage (owner or admin), offered as a folder of its own. */
export interface ExportableWorkspace {
  id: string;
  name: string;
}

/** The workspaces the person may bring along: the ones they own or manage. */
export async function manageableWorkspaces(account: MigrationClient): Promise<ExportableWorkspace[]> {
  const mine = await account.query(api.workspaces.mine, {});
  return mine.filter((w) => w.canManage && !w.deletionScheduledFor).map((w) => ({ id: w.id, name: w.name }));
}

/** The folder a workspace comes down into (the same on every run, so a stopped copy goes on into it). */
export function workspaceFolderId(workspaceId: string): string {
  return `ws_${workspaceId}`.slice(0, 64);
}

export interface ExportOptions {
  account: MigrationClient;
  /** The library, open in a LocalBackend here, and a client over it (its putFile stores attachments). */
  library: {
    client: MigrationClient & { local: { putFile(blob: Blob, meta: { name: string; mimeType: string; kind: string; documentId?: string | null }): Promise<{ fileId: string }> } };
    backend: Pick<LocalBackend, "store" | "run">;
  };
  /** The library's folder, for exported/server-only.json. */
  fs: Pick<LocalFs, "read" | "write">;
  deviceId: string;
  /** Bring each note's saved versions along. */
  versions: boolean;
  /** Workspaces to bring along as folders (from manageableWorkspaces). */
  workspaces?: ExportableWorkspace[];
  /** Downloads an attachment from its signed link (default: fetch). */
  fetchBytes?: (url: string) => Promise<Blob>;
  onProgress?: (p: MigrationProgress & { place: string }) => void;
  signal?: AbortSignal;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
}

/** Copies the account into the library (or goes on with a copy that stopped), then writes the server-only record. */
export async function exportToLocal(o: ExportOptions): Promise<{ personal: MigrationState; workspaces: MigrationState[] }> {
  const readFile = accountFiles(o.account, o.fetchBytes);
  const target = clientTarget(o.library.client, { deviceId: o.deviceId, putFile: libraryPutFile(o.library.client.local) });
  const personal = await copyLibrary({
    source: clientSource(o.account, { readFile }),
    target,
    progress: libraryProgress(o.library.backend, progressKey("export")),
    direction: "export",
    versions: o.versions,
    mapInbox: true,
    onProgress: (p) => o.onProgress?.({ ...p, place: "Personal" }),
    signal: o.signal,
    sleep: o.sleep,
    now: o.now,
  });
  const workspaces: MigrationState[] = [];
  for (const w of o.workspaces ?? []) {
    workspaces.push(
      await copyLibrary({
        source: clientSource(o.account, { scope: { kind: "workspace", workspaceId: w.id }, readFile }),
        target,
        progress: libraryProgress(o.library.backend, progressKey("export", w.id)),
        direction: "export",
        versions: o.versions,
        mapInbox: false,
        intoFolder: { id: workspaceFolderId(w.id), name: w.name },
        onProgress: (p) => o.onProgress?.({ ...p, place: w.name }),
        signal: o.signal,
        sleep: o.sleep,
        now: o.now,
      }),
    );
  }
  await writeServerOnly(o.fs, await serverOnlyRecord(o.account, o.workspaces ?? [], o.now?.() ?? Date.now()));
  return { personal, workspaces };
}

/** What only the server keeps, for the record: comments, sharing and the workspaces' members. */
export async function serverOnlyRecord(account: MigrationClient, workspaces: ExportableWorkspace[], now: number) {
  const places = [{ name: "Personal", scope: { kind: "personal" as const } }, ...workspaces.map((w) => ({ name: w.name, scope: { kind: "workspace" as const, workspaceId: w.id } }))];
  const notes: { place: string; id: string; title: string; comments?: unknown; sharing?: unknown }[] = [];
  for (const place of places) {
    for (const n of await clientSource(account, { scope: place.scope, readFile: async () => null }).notes()) {
      if (!n.hasComments && !n.shared) continue;
      const entry: (typeof notes)[number] = { place: place.name, id: n.id, title: n.title };
      if (n.hasComments) entry.comments = await account.query(api.comments.threads, { documentId: n.id }).catch(() => null);
      if (n.shared) entry.sharing = await account.query(api.sharing.get, { documentId: n.id }).catch(() => null);
      notes.push(entry);
    }
  }
  const mine = await account.query(api.workspaces.mine, {});
  const memberships = [];
  for (const w of mine) {
    const brought = workspaces.some((x) => x.id === w.id);
    memberships.push({
      id: w.id,
      name: w.name,
      role: w.role,
      memberAccess: w.memberAccess,
      broughtAlong: brought,
      ...(brought ? { members: await account.query(api.workspaces.members, { workspaceId: w.id }).catch(() => null) } : {}),
    });
  }
  return {
    format: "folevi-server-only",
    v: 1,
    exportedAt: new Date(now).toISOString(),
    about: "What stayed in the Folevi account when these notes moved to this library: comments, sharing and workspace membership. The account still exists; sign in to Folevi to see them there.",
    workspaces: memberships,
    notes,
  };
}

/** Writes the record into the library's folder (replacing one from an earlier run). */
export async function writeServerOnly(fs: Pick<LocalFs, "read" | "write">, record: unknown): Promise<void> {
  const bytes = new TextEncoder().encode(`${JSON.stringify(record, null, 2)}\n`);
  for (let attempt = 0; attempt < 3; attempt++) {
    let etag: string | null;
    try {
      const r = await fs.read(SERVER_ONLY_PATH);
      etag = "etag" in r ? r.etag : null;
    } catch {
      etag = null;
    }
    const w = await fs.write(SERVER_ONLY_PATH, bytes, { ifMatch: etag });
    if (!("mismatch" in w)) return;
  }
  throw new Error("The record of what stays on the server couldn't be written.");
}

/** The move's record so far for a place, if one was started. */
export async function exportState(backend: Pick<LocalBackend, "store" | "run">, place = "personal"): Promise<MigrationState | null> {
  return await libraryProgress(backend, progressKey("export", place)).load();
}
