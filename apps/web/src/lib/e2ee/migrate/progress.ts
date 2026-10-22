"use client";
// Migration progress for Settings > Privacy and the sidebar footer (docs/E2EE_DESIGN.md §10.10, WP8). The
// server counts notes (e2ee.migrate.progress: done, total, whether a device holds the lease); this device adds
// what it knows from its own run: versions and attachments handed out and done, and the items it set aside.
import { useSyncExternalStore } from "react";
import { useQuery } from "convex/react";
import type { WireScope } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { activeRouter } from "../router/active";
import { scopeKeyOf } from "../router/deps";

/** §12 WP8 (the shape WP9's screens draw). */
export interface MigrationProgress {
  direction: "seal" | "unseal" | "reseal";
  phase: "documents" | "history" | "files" | "cleanup" | "done";
  documents: { done: number; total: number };
  history: { done: number; total: number };
  files: { done: number; total: number; bytesLeft: number };
  /** No device is working on it right now. */
  paused: boolean;
  failed: { documentId: string; title: string }[];
}

export interface ServerJobRow {
  id: string;
  direction: MigrationProgress["direction"];
  scopeOf: "space" | "folder" | "document";
  rootId: string | null;
  phase: MigrationProgress["phase"];
  total: number;
  done: number;
  failed: number;
  startedAt?: number;
  finishedAt: number | null;
  running: boolean;
}

interface LocalJob {
  history: { done: number; total: number; seen: Set<string> };
  files: { done: number; total: number; seen: Set<string> };
  failedDocuments: Set<string>;
  result: "done" | "busy" | "stopped" | "paused" | null;
}

class ProgressStore {
  private jobs = new Map<string, ServerJobRow[]>();
  private local = new Map<string, LocalJob>();
  private listeners = new Set<() => void>();
  private version = 0;

  private emit() {
    this.version++;
    for (const l of [...this.listeners]) l();
  }

  subscribe = (cb: () => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };

  snapshot = () => this.version;

  of(jobId: string): LocalJob {
    let j = this.local.get(jobId);
    if (!j) this.local.set(jobId, (j = { history: { done: 0, total: 0, seen: new Set() }, files: { done: 0, total: 0, seen: new Set() }, failedDocuments: new Set(), result: null }));
    return j;
  }

  setJobs(scope: WireScope, jobs: ServerJobRow[]) {
    this.jobs.set(scopeKeyOf(scope), jobs);
    this.emit();
  }

  jobsOf(scope: WireScope): ServerJobRow[] | undefined {
    return this.jobs.get(scopeKeyOf(scope));
  }

  phase(_scope: WireScope, jobId: string, phase: MigrationProgress["phase"], counts: { history: number; files: number }) {
    void _scope;
    const j = this.of(jobId);
    // A claim lists what's left of the phase: done so far plus what it handed out.
    if (phase === "history") j.history.total = Math.max(j.history.total, j.history.done + counts.history);
    if (phase === "files") j.files.total = Math.max(j.files.total, j.files.done + counts.files);
    this.emit();
  }

  item(_scope: WireScope, jobId: string, kind: "documents" | "history" | "files", id: string, ok: boolean) {
    void _scope;
    const j = this.of(jobId);
    if (kind === "documents") {
      if (ok) j.failedDocuments.delete(id);
      else j.failedDocuments.add(id);
    } else if (ok && !j[kind].seen.has(id)) {
      j[kind].seen.add(id);
      j[kind].done++;
    }
    this.emit();
  }

  result(_scope: WireScope, jobId: string, result: LocalJob["result"]) {
    void _scope;
    this.of(jobId).result = result;
    this.emit();
  }

  clearFailures(jobId: string) {
    this.of(jobId).failedDocuments.clear();
    this.emit();
  }
}

export const progressStore = new ProgressStore();

/** The open job of a scope as MigrationProgress, from the server's rows and this device's run. */
export function progressOf(rows: readonly ServerJobRow[] | undefined, title: (documentId: string) => string): MigrationProgress | null {
  const job = (rows ?? []).find((j) => j.phase !== "done" && j.finishedAt === null);
  if (!job) return null;
  const local = progressStore.of(job.id);
  const documentsDone = job.phase === "documents" ? Math.min(job.done, job.total) : Math.max(job.total, job.done);
  return {
    direction: job.direction,
    phase: job.phase,
    documents: { done: documentsDone, total: Math.max(job.total, documentsDone) },
    history: { done: local.history.done, total: Math.max(local.history.total, local.history.done) },
    files: { done: local.files.done, total: Math.max(local.files.total, local.files.done), bytesLeft: 0 },
    paused: !job.running,
    failed: [...local.failedDocuments].map((documentId) => ({ documentId, title: title(documentId) })),
  };
}

/**
 * §12 WP8: the scope's open migration (encrypting, decrypting or changing the key), or null when nothing is
 * running there. A Standard account (no router) never asks the server.
 */
export function useMigrationProgress(scope: WireScope): MigrationProgress | null {
  useSyncExternalStore(progressStore.subscribe, progressStore.snapshot, progressStore.snapshot);
  const router = activeRouter();
  const space = router?.spaces.get(scope) ?? null;
  const rows = useQuery(api.e2ee.migrate.progress, space ? { scope } : "skip") as ServerJobRow[] | undefined;
  if (!space) return null;
  return progressOf(rows ?? progressStore.jobsOf(scope), (id) => router?.spaces.label(id)?.title || "Untitled");
}
