"use client";
// A move between modes under way (docs/LOCAL_MODE_PLAN.md §6), in the signed-in app: going up (a library into
// this account, started with "Sign in and move" in local mode) or coming down (this account into a library on
// this Mac, started from Settings > Import & export). It takes the whole window until it's done, and comes
// back by itself after a reload or a restart, going on from where it stopped.
import { useConvex } from "convex/react";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { FullPageMessage, useAppState } from "@/lib/app/state";
import { shell } from "@/lib/shell";
import { errorText, MigrationError } from "@/lib/migrate/copy";
import { exportState, exportToLocal } from "@/lib/migrate/exportToLocal";
import { openLibraryHere, pendingMove, setPendingMove, signOutAfterExport, subscribePendingMove, switchMode, type OpenLibrary, type PendingMove } from "@/lib/migrate/session";
import type { MigrationProblem, MigrationProgress, MigrationState } from "@/lib/migrate/types";
import { forgetUpload, libraryCounts, markMigrated, preflightUpload, uploadLibrary, uploadState, type LibraryCounts, type Preflight } from "@/lib/migrate/uploadLibrary";
import { fileSize } from "@/lib/migrate/remap";
import { deviceWords } from "@/lib/shell/words";

/** Shows the move under way instead of the app, and the app once there's none. */
export function MigrationGate({ children }: { children: ReactNode }) {
  const move = useSyncExternalStore(subscribePendingMove, pendingMove, () => null);
  if (!move || !shell()) return <>{children}</>;
  return move.direction === "upload" ? <UploadToAccount move={move} /> : <ExportToLibrary move={move} />;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** "a, b and c", leaving out what's empty. */
function listOf(parts: (string | null)[]): string {
  const p = parts.filter((x): x is string => Boolean(x));
  return p.length <= 1 ? (p[0] ?? "") : `${p.slice(0, -1).join(", ")} and ${p[p.length - 1]}`;
}

function Progress({ p, verb }: { p: MigrationProgress | null; verb: string }) {
  const total = p?.notesTotal ?? 0;
  const done = p?.notesDone ?? 0;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const waiting = p?.waitingUntil ? Math.max(1, Math.round((p.waitingUntil - Date.now()) / 60_000)) : null;
  return (
    <div data-testid="migration-progress">
      <div className="h-1.5 overflow-hidden rounded-tiny bg-sunken" role="progressbar" aria-label={verb} aria-valuemin={0} aria-valuemax={total || 1} aria-valuenow={done}>
        <div className="h-full rounded-tiny bg-heading transition-[width] duration-300" style={{ width: `${p?.phase === "done" ? 100 : pct}%` }} />
      </div>
      <p className="mt-3 text-subheadline text-muted" role="status" aria-live="polite">
        {!p || p.phase === "organizing"
          ? "Bringing folders and tags…"
          : p.phase === "trash"
            ? "Putting Trash back as it was…"
            : waiting
              ? `Folevi asked for a pause. Going on in about ${plural(waiting, "minute")}.`
              : `${done.toLocaleString()} of ${plural(total, "note")}${p.current ? `: ${p.current}` : ""}`}
      </p>
    </div>
  );
}

function Problems({ problems }: { problems: MigrationProblem[] }) {
  if (!problems.length) return null;
  const files = problems.filter((p) => p.kind === "file");
  const other = problems.filter((p) => p.kind !== "file");
  return (
    <div className="mt-4 text-subheadline" data-testid="migration-problems">
      {files.length ? (
        <>
          <p className="font-medium text-ink">Some files didn’t come along</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted">
            {files.slice(0, 8).map((p, i) => (
              <li key={i}>
                {p.name} in “{p.title || "Untitled"}”: {p.problem === "space" ? "it didn’t fit" : p.problem === "size" ? "it’s larger than one file can be" : p.problem === "missing" ? "it couldn’t be found" : "it was refused"}
              </li>
            ))}
            {files.length > 8 ? <li>and {plural(files.length - 8, "more file")}</li> : null}
          </ul>
          <p className="mt-1 text-muted">Each note says where its file is. Nothing was removed from where it was.</p>
        </>
      ) : null}
      {other.length ? (
        <>
          <p className="mt-3 font-medium text-ink">{plural(other.length, "thing")} couldn’t be moved</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted">
            {other.slice(0, 5).map((p, i) => (
              <li key={i}>
                “{p.title || "Untitled"}”: {p.detail}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

/** Keeps the opened library for the screen's life and closes it after. */
function useLibrary(): { lib: OpenLibrary | null; error: string | null; close: () => Promise<void> } {
  const [lib, setLib] = useState<OpenLibrary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<OpenLibrary | null>(null);
  useEffect(() => {
    let live = true;
    openLibraryHere().then(
      (l) => {
        if (!live) return void l.close();
        ref.current = l;
        setLib(l);
      },
      (e: unknown) => live && setError(errorText(e)),
    );
    return () => {
      live = false;
      void ref.current?.close();
      ref.current = null;
    };
  }, []);
  return {
    lib,
    error,
    close: async () => {
      const l = ref.current;
      ref.current = null;
      await l?.close();
    },
  };
}

type UploadPhase =
  | { kind: "checking" }
  | { kind: "ready"; counts: LibraryCounts; pre: Preflight }
  | { kind: "moving" }
  | { kind: "stopped"; message: string | null; state: MigrationState | null }
  | { kind: "done"; state: MigrationState }
  | { kind: "failed"; message: string };

/** Going up: the library this Mac keeps, into the account just signed in. */
function UploadToAccount({ move }: { move: Extract<PendingMove, { direction: "upload" }> }) {
  const client = useConvex();
  const { engine, profile } = useAppState();
  const { lib, error, close } = useLibrary();
  const [phase, setPhase] = useState<UploadPhase>({ kind: "checking" });
  const [progress, setProgress] = useState<MigrationProgress | null>(null);
  const [versions, setVersions] = useState(move.versions);
  const abort = useRef<AbortController | null>(null);
  const started = useRef(false);

  const run = async (l: OpenLibrary) => {
    const ctrl = new AbortController();
    abort.current = ctrl;
    setPhase({ kind: "moving" });
    try {
      const state = await uploadLibrary({ library: { client: l.client, backend: l.backend }, account: client, deviceId: engine?.deviceId ?? l.deviceId, engine, versions, onProgress: setProgress, signal: ctrl.signal });
      await markMigrated(l.host, profile.id);
      setPhase({ kind: "done", state });
    } catch (e) {
      const state = await uploadState(l.backend).catch(() => null);
      setPhase({ kind: "stopped", message: e instanceof MigrationError && e.code === "cancelled" ? null : errorText(e), state });
    }
  };

  useEffect(() => {
    if (!lib || started.current) return;
    started.current = true;
    void (async () => {
      try {
        let state = await uploadState(lib.backend);
        // A move into another account (several places): this one starts afresh.
        if (state && state.targetProfileId !== profile.id) {
          await forgetUpload(lib.backend).catch(() => undefined);
          state = null;
        }
        if (state?.finishedAt) return setPhase({ kind: "done", state });
        // A move that stopped goes on by itself: the person said yes before.
        if (state) {
          if (!engine) started.current = false;
          else return void run(lib);
          return;
        }
        const counts = await libraryCounts(lib.backend);
        setPhase({ kind: "ready", counts, pre: await preflightUpload(client, counts) });
      } catch (e) {
        setPhase({ kind: "failed", message: errorText(e) });
      }
    })();
    // `run` reads the latest state; it's started once per library.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lib, engine]);

  const backToLibrary = async () => {
    abort.current?.abort();
    if (lib) await forgetUpload(lib.backend).catch(() => undefined);
    await close();
    setPendingMove(null);
    await switchMode("local");
  };
  const openApp = async () => {
    if (lib) await forgetUpload(lib.backend).catch(() => undefined);
    await close();
    setPendingMove(null);
  };

  if (error || phase.kind === "failed") {
    return (
      <FullPageMessage title="The library couldn’t be opened" body={error ?? (phase.kind === "failed" ? phase.message : "")}>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => window.location.reload()}>
            Try again
          </Button>
          <Button onClick={() => void backToLibrary()}>Back to my library</Button>
        </div>
      </FullPageMessage>
    );
  }
  if (phase.kind === "checking") return <FullPageMessage title="Getting your library ready…" busy />;
  if (phase.kind === "ready") {
    const { counts, pre } = phase;
    return (
      <FullPageMessage
        title="Move your notes to Folevi"
        body={
          <div className="space-y-3" data-testid="migration-summary">
            <p>{listOf([plural(counts.notes, "note"), counts.folders ? plural(counts.folders, "folder") : null, counts.tags ? plural(counts.tags, "tag") : null, counts.files ? `${plural(counts.files, "file")} (${fileSize(counts.fileBytes)})` : null])} go into your account, with the same links between them.</p>
            <p>
              {!counts.files
                ? `Your account has ${fileSize(pre.availableBytes)} free.`
                : pre.fits
                ? `Your account has ${fileSize(pre.availableBytes)} free, enough for the files.`
                : `Some files won’t fit: they need ${fileSize(pre.shortByBytes)} more than the ${fileSize(pre.availableBytes)} your account has free. Those stay in your library folder, and their notes say so.`}
            </p>
            {pre.existingNotes ? <p>Your account already has {pre.existingMore ? "more than 1,000" : plural(pre.existingNotes, "note")}. These go beside them; nothing there is replaced.</p> : null}
            {counts.downloading ? <p>{plural(counts.downloading, "note")} hasn’t reached {deviceWords().here} yet and stays in the library.</p> : null}
            {!pre.writable ? <p className="text-danger">This account can’t take new notes right now.</p> : null}
            <label className="flex items-center justify-between gap-3 pt-1 text-ink">
              <span>Bring version history</span>
              <Switch checked={versions} onChange={setVersions} label="Bring version history" />
            </label>
            <p className="text-subheadline">Your library folder stays as it is either way. Keep them separate to use this account with nothing moved: both stay in the account menu, and you can move notes later with Move or copy notes.</p>
          </div>
        }
      >
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" disabled={!engine || !lib || !pre.writable} onClick={() => lib && void run(lib)}>
            {engine ? "Move my notes into this account" : "Getting ready…"}
          </Button>
          <Button onClick={() => void openApp()}>Keep them separate on {deviceWords().here}</Button>
          <Button variant="ghost" onClick={() => void backToLibrary()}>
            Back to my library
          </Button>
        </div>
      </FullPageMessage>
    );
  }
  if (phase.kind === "moving") {
    return (
      <FullPageMessage title="Moving your notes to Folevi" body="Keep Folevi open. If it closes, the move goes on from here next time.">
        <Progress p={progress} verb="Moving notes" />
        <div className="mt-4">
          <Button onClick={() => abort.current?.abort()}>Stop</Button>
        </div>
      </FullPageMessage>
    );
  }
  if (phase.kind === "stopped") {
    const done = phase.state ? Object.keys(phase.state.notes).length : 0;
    return (
      <FullPageMessage title="The move stopped" body={<>{phase.message ? <p>{phase.message}</p> : null}<p className="mt-2">{plural(done, "note")} {done === 1 ? "is" : "are"} in your account so far. Going on picks up from there.</p></>}>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" disabled={!lib} onClick={() => lib && void run(lib)}>
            Go on
          </Button>
          <Button onClick={() => void backToLibrary()}>Back to my library</Button>
        </div>
      </FullPageMessage>
    );
  }
  return (
    <FullPageMessage title="Your notes are in Folevi" body={<><p>Everything from your library is in your account now. The library folder on {deviceWords().here} is still there, untouched.</p><Problems problems={phase.state.problems} /></>}>
      <Button variant="primary" onClick={() => void openApp()}>
        Open Folevi
      </Button>
    </FullPageMessage>
  );
}

type ExportPhase = { kind: "starting" } | { kind: "moving" } | { kind: "stopped"; message: string | null } | { kind: "done"; problems: MigrationProblem[] } | { kind: "signing-out" };

/** Coming down: this account into a library on this Mac, then signed out here. */
function ExportToLibrary({ move }: { move: Extract<PendingMove, { direction: "export" }> }) {
  const client = useConvex();
  const { profile } = useAppState();
  const { lib, error, close } = useLibrary();
  const [phase, setPhase] = useState<ExportPhase>({ kind: "starting" });
  const [progress, setProgress] = useState<(MigrationProgress & { place: string }) | null>(null);
  const abort = useRef<AbortController | null>(null);
  const started = useRef(false);

  const run = async (l: OpenLibrary) => {
    const ctrl = new AbortController();
    abort.current = ctrl;
    setPhase({ kind: "moving" });
    try {
      await l.client.local.setup({ timeZone: profile.timeZone, locale: profile.locale, displayName: profile.displayName, seed: false });
      const out = await exportToLocal({ account: client, library: { client: l.client, backend: l.backend }, fs: l.host, deviceId: l.deviceId, versions: move.versions, workspaces: move.workspaces, onProgress: setProgress, signal: ctrl.signal });
      await l.backend.idle();
      await l.backend.store.library?.flush().catch(() => undefined);
      setPhase({ kind: "done", problems: [...out.personal.problems, ...out.workspaces.flatMap((w) => w.problems)] });
    } catch (e) {
      setPhase({ kind: "stopped", message: e instanceof MigrationError && e.code === "cancelled" ? null : errorText(e) });
    }
  };

  useEffect(() => {
    if (!lib || started.current) return;
    started.current = true;
    void (async () => {
      const state = await exportState(lib.backend).catch(() => null);
      if (state?.finishedAt && !move.workspaces.length) return setPhase({ kind: "done", problems: state.problems });
      void run(lib);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lib]);

  const cancel = async () => {
    abort.current?.abort();
    await close();
    setPendingMove(null);
  };
  const finish = async () => {
    setPhase({ kind: "signing-out" });
    await close();
    await signOutAfterExport(profile.id);
  };

  if (error) {
    return (
      <FullPageMessage title="The library couldn’t be opened" body={error}>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => window.location.reload()}>
            Try again
          </Button>
          <Button onClick={() => void cancel()}>Cancel the move</Button>
        </div>
      </FullPageMessage>
    );
  }
  if (phase.kind === "starting") return <FullPageMessage title="Getting the library ready…" busy />;
  if (phase.kind === "signing-out") return <FullPageMessage title={`Signing out of Folevi on ${deviceWords().here}…`} busy />;
  if (phase.kind === "moving") {
    return (
      <FullPageMessage title={`Bringing your notes to ${deviceWords().here}`} body={`Keep Folevi open. If it closes, this goes on from here next time.${progress?.place && progress.place !== "Personal" ? ` Now: ${progress.place}.` : ""}`}>
        <Progress p={progress} verb="Bringing notes" />
        <div className="mt-4">
          <Button onClick={() => abort.current?.abort()}>Stop</Button>
        </div>
      </FullPageMessage>
    );
  }
  if (phase.kind === "stopped") {
    return (
      <FullPageMessage title="This stopped partway" body={<>{phase.message ? <p>{phase.message}</p> : null}<p className="mt-2">Nothing in your account changed. Going on picks up where it stopped.</p></>}>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" disabled={!lib} onClick={() => lib && void run(lib)}>
            Go on
          </Button>
          <Button onClick={() => void cancel()}>Cancel</Button>
        </div>
      </FullPageMessage>
    );
  }
  return (
    <FullPageMessage
      title={`Your notes are on ${deviceWords().here}`}
      body={
        <>
          <p>Every note, folder, tag and file is in the library now. Comments, sharing and workspace members stay in your account; a record of them is in the library’s “exported” folder.</p>
          <p className="mt-2">Next, Folevi signs out on {deviceWords().here}. Your Folevi account isn’t deleted: it’s still there, and you can sign in again any time.</p>
          <Problems problems={phase.problems} />
        </>
      }
    >
      <Button variant="primary" onClick={() => void finish()}>
        Sign out and open my library
      </Button>
    </FullPageMessage>
  );
}
