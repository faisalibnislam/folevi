// The background migration runner (docs/E2EE_DESIGN.md §6.9, WP8): on an unlocked device of someone allowed
// to (Personal: its owner; workspaces: owners and admins; a lock: whoever may edit there), while a job is
// open, it claims the job's lease (e2ee.migrate.claim), works through the notes the server hands out, then
// versions, files and cleanup, heartbeating every 30 seconds. It stops when the tab goes to the background
// or the device locks; the lease lapses after two minutes and any device carries on from the job's cursor.
//
// One job runs at a time on a device. A note that fails is set aside for this run (listed in the progress,
// "Try again" clears it); a note another device is converting (`e2ee_busy`) is simply offered again later.
import { api } from "@/lib/convex/api";
import type { LocalReader } from "@/lib/local/registry";
import { activeRouter, onActiveRouter } from "../router/active";
import { isEncryptedLevel, type E2eeSpace } from "../router/deps";
import type { E2eeRouterClient } from "../router/client";
import { checkStop, codeOf, isMissingFunction, migrate, StopRun, type MigrateEnv } from "./env";
import { sealDocument, sealFile, sealNames, sealSnapshot, VersionNames } from "./seal";
import { unsealDocument, unsealFile, unsealNames, unsealSnapshot } from "./unseal";
import { resealDocument, rotateNote, type RotateDeps } from "./reseal";
import { progressStore } from "./progress";
import { linkSecretsFor } from "../links";

export const HEARTBEAT_MS = 30_000;
const POLL_MS = 15_000;
const MAX_ROUNDS = 500;

export interface Job {
  id: string;
  direction: "seal" | "unseal" | "reseal";
  scopeOf: "space" | "folder" | "document";
  rootId: string | null;
  phase: "documents" | "history" | "files" | "cleanup" | "done";
}

interface Claimed {
  busy: boolean;
  phase: Job["phase"];
  documents: string[];
  snapshots: { snapshotId: string; documentId: string }[];
  files: { fileId: string; documentId: string }[];
}

export interface RunHooks {
  /** Items set aside in this run (id → why), shared across runs of the same job so "Try again" can clear it. */
  failed?: Map<string, string>;
  /** The space's notes, for a space key rotation's first pass (every note gets a new key, §4.9). */
  listNotes?(): Promise<string[]>;
  /** Rotating note keys (a reseal job of a whole space). */
  rotate?: RotateDeps;
  /** Where a rotation pass got to (resumable), kept by the caller. */
  rotation?: { load(): Promise<string | null>; save(cursor: string | null): Promise<void> };
  /** The replica (an unseal reads collection rows from it). */
  store?: LocalReader | null;
  /** Progress for the screens. */
  onItem?(kind: "documents" | "history" | "files", item: string, ok: boolean, bytes?: number): void;
  onPhase?(phase: Job["phase"], counts: { history: number; files: number }): void;
}

export type RunResult = "done" | "busy" | "stopped" | "paused";

/**
 * Runs one job as far as it goes on this device: "done" (finished), "busy" (another device holds the lease),
 * "stopped" (told to stop), "paused" (only items that failed here are left).
 */
export async function runJob(env: MigrateEnv, job: Pick<Job, "id" | "direction" | "scopeOf" | "rootId">, hooks: RunHooks = {}): Promise<RunResult> {
  const failed = hooks.failed ?? new Map<string, string>();
  const names = new VersionNames(env);
  let rotated = job.direction !== "reseal" || job.scopeOf !== "space" || !hooks.rotate || !hooks.listNotes;
  const beat = setInterval(() => {
    void env.server.mutation(migrate.heartbeat as never, { migrationId: job.id, deviceId: env.deviceId }).catch(() => undefined);
  }, HEARTBEAT_MS);
  const attempt = async (kind: "documents" | "history" | "files", id: string, fn: () => Promise<unknown>) => {
    checkStop(env);
    try {
      await fn();
      hooks.onItem?.(kind, id, true);
    } catch (e) {
      if (e instanceof StopRun) throw e;
      const code = codeOf(e);
      if (code === "e2ee_busy") return; // another device is converting it: offered again later
      if (code === "e2ee_locked_session") throw new StopRun();
      failed.set(id, isMissingFunction(e) ? "server" : (code ?? "error"));
      hooks.onItem?.(kind, id, false);
      // Never the content: which item, and the error's code.
      console.warn(`[e2ee] Couldn't convert ${kind === "documents" ? "a note" : kind === "history" ? "a version" : "a file"} (${id}): ${code ?? (e instanceof Error ? e.name : "error")}`);
    }
  };
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      checkStop(env);
      const work = (await env.server.mutation(migrate.claim as never, { migrationId: job.id, deviceId: env.deviceId })) as Claimed;
      if (work.busy) return "busy";
      if (work.phase === "done") return "done";
      hooks.onPhase?.(work.phase, { history: work.snapshots.length, files: work.files.length });
      if (work.phase === "documents") {
        if (!rotated) {
          await rotatePass(env, hooks);
          rotated = true;
          continue;
        }
        const todo = work.documents.filter((id) => !failed.has(id));
        if (!todo.length) {
          if (work.documents.length) return "paused";
          if (!(await finishPhase(env, job.id, "documents"))) return "paused";
          continue;
        }
        const visited = new Set<string>();
        for (const id of todo) {
          await attempt("documents", id, () =>
            job.direction === "seal" ? sealDocument(env, id, { visited }) : job.direction === "unseal" ? unsealDocument(env, id, { visited, store: hooks.store }) : resealDocument(env, id),
          );
        }
      } else if (work.phase === "history") {
        const todo = work.snapshots.filter((s) => !failed.has(s.snapshotId));
        if (!todo.length) {
          if (work.snapshots.length) return "paused";
          if (!(await finishPhase(env, job.id, "history"))) return "paused";
          continue;
        }
        for (const s of todo) await attempt("history", s.snapshotId, () => (job.direction === "unseal" ? unsealSnapshot(env, s.snapshotId, s.documentId, names) : sealSnapshot(env, s.snapshotId, s.documentId, names)));
      } else if (work.phase === "files") {
        const todo = work.files.filter((f) => !failed.has(f.fileId));
        if (!todo.length) {
          if (work.files.length) return "paused";
          if (!(await finishPhase(env, job.id, "files"))) return "paused";
          continue;
        }
        for (const f of todo) await attempt("files", f.fileId, () => (job.direction === "unseal" ? unsealFile(env, f.fileId, f.documentId) : sealFile(env, f.fileId, f.documentId)));
      } else if (work.phase === "cleanup") {
        try {
          if (job.direction === "seal") await sealNames(env, job);
          else if (job.direction === "unseal") await unsealNames(env, job, { store: hooks.store });
        } catch (e) {
          if (e instanceof StopRun) throw e;
          failed.set(`cleanup:${job.id}`, isMissingFunction(e) ? "server" : (codeOf(e) ?? "error"));
          console.warn(`[e2ee] Couldn't finish converting folder and tag names: ${codeOf(e) ?? (e instanceof Error ? e.name : "error")}`);
          return "paused";
        }
        const r = (await env.server.mutation(migrate.finishPhase as never, { migrationId: job.id, phase: "cleanup", deviceId: env.deviceId })) as { phase: Job["phase"]; more?: boolean };
        if (r.phase === "done") return "done";
      }
    }
    return "paused";
  } catch (e) {
    if (e instanceof StopRun) return "stopped";
    throw e;
  } finally {
    clearInterval(beat);
  }
}

/** Ends a phase; false when the server says work is left that this device can't do (it set it aside). */
async function finishPhase(env: MigrateEnv, migrationId: string, phase: Job["phase"]): Promise<boolean> {
  try {
    await env.server.mutation(migrate.finishPhase as never, { migrationId, phase, deviceId: env.deviceId });
    return true;
  } catch (e) {
    if (codeOf(e) === "conflict") return true; // something appeared meanwhile: the next claim hands it out
    throw e;
  }
}

/**
 * The first pass of a space key rotation (§4.9): every note gets a new note key wrapped by the new space key,
 * so a removed member's copy of the old note keys opens nothing written from now on. Resumable by id order.
 */
async function rotatePass(env: MigrateEnv, hooks: RunHooks): Promise<void> {
  const ids = (await hooks.listNotes!()).sort();
  const from = (await hooks.rotation?.load()) ?? null;
  for (const id of ids) {
    if (from && id <= from) continue;
    checkStop(env);
    try {
      await rotateNote(env, hooks.rotate!, id);
    } catch (e) {
      if (codeOf(e) !== "not_found" && codeOf(e) !== "conflict") throw e;
    }
    await hooks.rotation?.save(id);
  }
}

// ---- the app's runner ----------------------------------------------------------------------------------

interface ServerJob {
  id: string;
  direction: Job["direction"];
  scopeOf: Job["scopeOf"];
  rootId: string | null;
  phase: Job["phase"];
  total: number;
  done: number;
  failed: number;
  finishedAt: number | null;
  running: boolean;
}

/** Items set aside per job, for this tab (cleared by "Try again"). */
const failures = new Map<string, Map<string, string>>();

export function failuresOf(jobId: string): Map<string, string> {
  let m = failures.get(jobId);
  if (!m) failures.set(jobId, (m = new Map()));
  return m;
}

/** "Try again": the items set aside go back in the queue. */
export function retryFailed(jobId?: string): void {
  if (jobId) failures.get(jobId)?.clear();
  else for (const m of failures.values()) m.clear();
  kick?.();
}

let kick: (() => void) | null = null;

function envFor(router: E2eeRouterClient, space: E2eeSpace, signal: AbortSignal): MigrateEnv {
  const e = router.env;
  return {
    server: e.inner,
    sealer: e.sealer,
    keyring: e.keyring,
    deviceId: e.engine()?.deviceId ?? e.session.deviceId(),
    space: { scope: space.scope, scopeId: space.scopeId },
    signal,
  };
}

/**
 * §12 WP8: started by ProductApp once the device is unlocked. Watches the e2ee-active spaces' jobs and runs
 * them one at a time while the tab is visible. Returns the stop.
 */
export function startMigrationRunner(): () => void {
  let stopped = false;
  let running: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const visible = () => typeof document === "undefined" || document.visibilityState !== "hidden";

  const schedule = (ms: number) => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void tick(), ms);
  };

  const tick = async () => {
    timer = null;
    if (stopped || running) return;
    const router = activeRouter();
    if (!router || router.env.session.state() !== "unlocked" || !visible()) return schedule(POLL_MS);
    const controller = new AbortController();
    running = controller;
    try {
      for (const space of router.spaces.list()) {
        if (controller.signal.aborted) break;
        let jobs: ServerJob[];
        try {
          jobs = ((await router.env.inner.query(api.e2ee.migrate.progress, { scope: space.scope })) as ServerJob[]) ?? [];
        } catch {
          continue;
        }
        progressStore.setJobs(space.scope, jobs);
        for (const job of jobs.filter((j) => j.phase !== "done" && j.finishedAt === null).reverse()) {
          if (controller.signal.aborted) break;
          const env = envFor(router, space, controller.signal);
          const store = router.replicas.hostedStore?.(space.scope) ?? null;
          const result = await runJob(env, job, {
            failed: failuresOf(job.id),
            store,
            listNotes: store ? async () => (await store.list("documents")).filter((d) => router.spaces.isSealed(d.id)).map((d) => d.id) : undefined,
            rotate: rotateDeps(router),
            rotation: store ? { load: async () => ((await store.readState(`rotation:${job.id}`)) as string | undefined) ?? null, save: (c) => store.writeState([[`rotation:${job.id}`, c]]) } : undefined,
            onItem: (kind, id, ok) => progressStore.item(space.scope, job.id, kind, id, ok),
            onPhase: (phase, counts) => progressStore.phase(space.scope, job.id, phase, counts),
          }).catch((e) => {
            console.warn("[e2ee] The migration stopped on this device:", codeOf(e) ?? (e instanceof Error ? e.name : "error"));
            return "paused" as const;
          });
          progressStore.result(space.scope, job.id, result);
          if (result === "stopped") break;
        }
      }
    } finally {
      running = null;
      schedule(POLL_MS);
    }
  };

  const onVisibility = () => {
    // Hidden: stop after the current note; the lease lapses and any device continues (§6.9).
    if (!visible()) running?.abort();
    else schedule(0);
  };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
  let offSession: (() => void) | null = null;
  const bindSession = () => {
    offSession?.();
    const r = activeRouter();
    offSession = r
      ? r.env.session.subscribe(() => {
          if (r.env.session.state() !== "unlocked") running?.abort();
          else schedule(0);
        })
      : null;
  };
  bindSession();
  const offRouter = onActiveRouter(() => {
    bindSession();
    schedule(0);
  });
  kick = () => schedule(0);
  schedule(0);
  return () => {
    stopped = true;
    running?.abort();
    if (timer) clearTimeout(timer);
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
    offSession?.();
    offRouter();
    kick = null;
  };
}

function rotateDeps(router: E2eeRouterClient): RotateDeps | undefined {
  const s = router.env.session;
  return {
    accountKeys: () => s.accountKeys(),
    get profileId() {
      return profileIdOf(router);
    },
    linkSecrets: (documentId) => linkSecretsFor(router, documentId),
  } as RotateDeps;
}

/** The person's profile id, from the space ids (Personal's scope id is `personal:<profileId>`). */
function profileIdOf(router: E2eeRouterClient): string {
  const personal = router.spaces.list().find((s) => s.scope.kind === "personal");
  return personal?.scopeId.startsWith("personal:") ? personal.scopeId.slice("personal:".length) : "";
}

/**
 * Seals one note now, out of order (§6.9 "Edits during a migration"): the router calls this before sending an
 * edit to a note an enabling space hasn't sealed yet. Resolves once the note is sealed (or was already).
 */
export async function sealNow(documentId: string): Promise<void> {
  const router = activeRouter();
  if (!router) throw new Error("End-to-end encryption isn't set up on this account.");
  const doc = router.spaces.document(documentId);
  const space = doc ? router.spaces.get(doc.scope) : null;
  if (!space || !isEncryptedLevel(space)) return;
  await sealDocument(envFor(router, space, new AbortController().signal), documentId);
}
