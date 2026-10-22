"use client";
// "Move or copy notes..." (docs/MULTI_ACCOUNT_PLAN.md §7.3): from the account menu, and "Move to another place..."
// in folder and note menus (with that folder or note picked). One dialog: where to (any other place, and for an
// account its Personal or one of its workspaces), what (everything here, or picked folders and notes), copy or
// move, version history. It runs here when this page can reach both places; from the library to an account it
// switches to the account first and runs there (the library's page reaches nothing but this device), picking up
// after the reload (PlaceMoveGate).
import { useConvex } from "convex/react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { WireScope } from "@folevi/editor-schema";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { FullPageMessage, useAppState } from "@/lib/app/state";
import { useBackendMode } from "@/lib/mode";
import { useLocalClient } from "@/lib/convex/provider";
import { deviceWords } from "@/lib/shell/words";
import { errorText, MigrationError } from "@/lib/migrate/copy";
import { newMoveKey, type Pick } from "@/lib/migrate/reshape";
import { clientSource } from "@/lib/migrate/source";
import type { MigrationClient, MigrationProgress, MigrationState, ProgressStore } from "@/lib/migrate/types";
import { currentPlaceId, LIBRARY_PLACE, switchToPlace, usePlaces, type Place } from "@/lib/places";
import { otherAccountEnd, pageEnd, runPlaceMove, type MoveEnd, type MoveSide, type PlaceMove } from "@/lib/places/move";

// ---------------------------------------------------------------------------------------------------- opening

const OPEN_EVENT = "folevi:move-places";

/** Opens "Move or copy notes..." (with a folder or note already picked, from its menu). */
export function openMovePlaces(pick?: Pick): void {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: pick ?? null }));
}

/** Where the dialog lives (Shell): it opens on openMovePlaces. */
export function MovePlacesHost() {
  const [pick, setPick] = useState<Pick | null | undefined>(undefined);
  useEffect(() => {
    const on = (e: Event) => setPick((e as CustomEvent<Pick | null>).detail ?? null);
    window.addEventListener(OPEN_EVENT, on);
    return () => window.removeEventListener(OPEN_EVENT, on);
  }, []);
  if (pick === undefined) return null;
  return <MovePlacesDialog initialPick={pick} onClose={() => setPick(undefined)} />;
}

// ---------------------------------------------------------------------------------------------------- the move kept

const PENDING_KEY = "folevi:place-move";
const STATE_PREFIX = "folevi:place-move-state:";

type Pending = PlaceMove & { runIn: string };

function readPending(): Pending | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as Pending) : null;
  } catch {
    return null;
  }
}

function writePending(p: Pending | null) {
  try {
    if (p) localStorage.setItem(PENDING_KEY, JSON.stringify(p));
    else localStorage.removeItem(PENDING_KEY);
  } catch {
    /* without storage the move can't go on after a reload; it still runs in this page */
  }
}

/** What a move has done, kept between runs in this browser (or app), so a stopped move goes on where it was. */
function storedProgress(key: string): ProgressStore {
  return {
    load: async () => {
      try {
        const raw = localStorage.getItem(`${STATE_PREFIX}${key}`);
        return raw ? (JSON.parse(raw) as MigrationState) : null;
      } catch {
        return null;
      }
    },
    save: async (s) => {
      try {
        localStorage.setItem(`${STATE_PREFIX}${key}`, JSON.stringify(s));
      } catch {
        /* kept in this page only */
      }
    },
  };
}

function forgetProgress(key: string) {
  try {
    localStorage.removeItem(`${STATE_PREFIX}${key}`);
  } catch {
    /* nothing kept */
  }
}

// ---------------------------------------------------------------------------------------------------- the words

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

function placeLabel(p: Place): string {
  return p.kind === "library" ? `On ${deviceWords().here}` : p.name || p.email || "Folevi account";
}

interface Destination {
  value: string;
  label: string;
  place: Place;
  scope: WireScope;
  side: string;
}

function destinations(places: Place[], current: string | null): Destination[] {
  const out: Destination[] = [];
  for (const p of places) {
    if (p.id === current) continue;
    if (p.kind === "library") {
      out.push({ value: `${p.id}|personal`, label: placeLabel(p), place: p, scope: { kind: "personal" }, side: placeLabel(p) });
      continue;
    }
    const name = placeLabel(p);
    out.push({ value: `${p.id}|personal`, label: `${name}: Personal`, place: p, scope: { kind: "personal" }, side: `${name}'s Personal` });
    for (const w of p.workspaces) out.push({ value: `${p.id}|ws:${w.id}`, label: `${name}: ${w.name}`, place: p, scope: { kind: "workspace", workspaceId: w.id }, side: w.name });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------- the dialog

type Phase = { kind: "form" } | { kind: "running"; progress: MigrationProgress | null; trashing: { done: number; total: number } | null } | { kind: "done"; state: MigrationState; move: PlaceMove; to: Place } | { kind: "stopped"; message: string | null };

function MovePlacesDialog({ initialPick, onClose }: { initialPick: Pick | null; onClose: () => void }) {
  const convex = useConvex() as unknown as MigrationClient;
  const local = useLocalClient();
  const mode = useBackendMode();
  const { context, workspace, deviceId } = useAppState();
  const { places, current } = usePlaces();
  const options = useMemo(() => destinations(places, current), [places, current]);
  const [to, setTo] = useState<string>("");
  const [what, setWhat] = useState<"all" | "pick">(initialPick ? "pick" : "all");
  const [pick, setPick] = useState<Pick>(initialPick ?? { folders: [], notes: [] });
  const [moveMode, setMoveMode] = useState<"copy" | "move">("copy");
  const [versions, setVersions] = useState(true);
  const [phase, setPhase] = useState<Phase>({ kind: "form" });
  const abort = useRef<AbortController | null>(null);
  const here = mode === "local" ? `On ${deviceWords().here}` : workspace ? workspace.name : "Personal";
  const fromScope: WireScope = context.kind === "workspace" ? { kind: "workspace", workspaceId: context.workspaceId } : { kind: "personal" };
  useEffect(() => {
    if (!to && options[0]) setTo(options[0].value);
  }, [options, to]);
  const dest = options.find((o) => o.value === to) ?? null;

  const start = async () => {
    if (!dest) return;
    const move: PlaceMove = {
      from: { place: current ?? "", scope: fromScope, label: here },
      to: { place: dest.place.id, scope: dest.scope, label: dest.side },
      pick: what === "all" ? null : pick,
      mode: moveMode,
      versions,
      key: newMoveKey(),
      startedAt: Date.now(),
    };
    // The library's page reaches nothing but this device: an account side runs from the account's own page.
    if (mode === "local" && dest.place.kind === "account") {
      writePending({ ...move, runIn: dest.place.id });
      await local?.local.library?.flush().catch(() => undefined);
      await switchToPlace(dest.place);
      return;
    }
    const ctrl = new AbortController();
    abort.current = ctrl;
    setPhase({ kind: "running", progress: null, trashing: null });
    let other: MoveEnd | null = null;
    try {
      // (From the library's own page a move always runs in the account, above: here the open place is an account.)
      const fromEnd = pageEnd(convex, "account");
      other = dest.place.kind === "library" ? await libraryEnd() : await otherAccountEnd(dest.place.id);
      const state = await runPlaceMove({
        move,
        from: fromEnd,
        to: other,
        open: "from",
        deviceId: deviceId ?? "web-move",
        progress: storedProgress(move.key),
        onProgress: (p) => setPhase({ kind: "running", progress: p, trashing: null }),
        onTrash: (done, total) => setPhase((ph) => (ph.kind === "running" ? { ...ph, trashing: { done, total } } : ph)),
        signal: ctrl.signal,
      });
      forgetProgress(move.key);
      setPhase({ kind: "done", state, move, to: dest.place });
    } catch (e) {
      setPhase({ kind: "stopped", message: e instanceof MigrationError && e.code === "cancelled" ? null : errorText(e) });
    } finally {
      await other?.close().catch(() => undefined);
    }
  };

  const running = phase.kind === "running";
  return (
    <Dialog
      open
      onClose={() => (running ? undefined : onClose())}
      title="Move or copy notes"
      description={phase.kind === "form" ? `From ${here} to another place. Nothing crosses between places unless you move it.` : undefined}
      size="md"
      footer={
        phase.kind === "form" ? (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={!dest || (what === "pick" && !pick.folders.length && !pick.notes.length)} onClick={() => void start()}>
              {moveMode === "move" ? "Move notes" : "Copy notes"}
            </Button>
          </>
        ) : running ? (
          <Button onClick={() => abort.current?.abort()}>Stop</Button>
        ) : phase.kind === "done" ? (
          <>
            <Button onClick={onClose}>Close</Button>
            <Button variant="primary" onClick={() => void switchToPlace(phase.to, phase.move.to.scope.kind === "workspace" ? { workspaceId: phase.move.to.scope.workspaceId } : { workspaceId: null })}>
              Open {placeLabel(phase.to)}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onClose}>Close</Button>
            <Button variant="primary" onClick={() => setPhase({ kind: "form" })}>
              Try again
            </Button>
          </>
        )
      }
    >
      {phase.kind === "form" ? (
        options.length === 0 ? (
          <p className="text-sm text-muted">There&apos;s no other place yet. Sign in to another account from the account menu first.</p>
        ) : (
          <div className="space-y-4 text-sm">
            <Row label="To">
              <Select aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} className="w-full">
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Row>
            <Row label="What">
              <Select aria-label="What" value={what} onChange={(e) => setWhat(e.target.value as "all" | "pick")} className="w-full">
                <option value="all">Everything in {here}</option>
                <option value="pick">Folders and notes I pick</option>
              </Select>
            </Row>
            {what === "pick" ? <Picker client={convex} scope={fromScope} pick={pick} onChange={setPick} /> : null}
            <Row label="How">
              <Select aria-label="Copy or move" value={moveMode} onChange={(e) => setMoveMode(e.target.value as "copy" | "move")} className="w-full">
                <option value="copy">Copy: they stay here too</option>
                <option value="move">Move: they go to Trash here</option>
              </Select>
            </Row>
            <label className="flex items-center justify-between gap-3 text-ink">
              <span>Bring version history</span>
              <Switch checked={versions} onChange={setVersions} label="Bring version history" />
            </label>
            {mode === "local" && dest?.place.kind === "account" ? <p className="text-muted">Folevi opens {placeLabel(dest.place)} to do this, then shows how it went.</p> : null}
          </div>
        )
      ) : phase.kind === "running" ? (
        <MoveProgress p={phase.progress} trashing={phase.trashing} />
      ) : phase.kind === "done" ? (
        <Summary state={phase.state} move={phase.move} />
      ) : (
        <p className="text-sm text-muted">{phase.message ?? "The move was stopped. What came along so far stays there; trying again goes on from where it was."}</p>
      )}
    </Dialog>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[72px_1fr] items-center gap-3">
      <span className="text-muted">{label}</span>
      {children}
    </div>
  );
}

/** Folders and the notes at the top of this place, to pick from. */
function Picker({ client, scope, pick, onChange }: { client: MigrationClient; scope: WireScope; pick: Pick; onChange: (p: Pick) => void }) {
  const [items, setItems] = useState<{ folders: { id: string; name: string; depth: number }[]; notes: { id: string; title: string }[] } | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      const source = clientSource(client, { scope, readFile: async () => null });
      const [{ folders }, notes] = await Promise.all([source.organization(), source.notes()]);
      const depth = (id: string | null, d = 0): number => (id && d < 8 ? depth(folders.find((f) => f.id === id)?.parentFolderId ?? null, d + 1) : d);
      const tops = notes.filter((n) => !n.parentDocumentId && !n.inTrash && n.kind !== "synced" && n.kind !== "collectionRow").sort((a, b) => b.updatedAt - a.updatedAt);
      if (live) setItems({ folders: folders.map((f) => ({ id: f.id, name: f.name, depth: depth(f.parentFolderId) })), notes: tops.slice(0, 300).map((n) => ({ id: n.id, title: n.title || "Untitled" })) });
    })().catch(() => live && setItems({ folders: [], notes: [] }));
    return () => {
      live = false;
    };
  }, [client, scope]);
  const toggle = (kind: "folders" | "notes", id: string, on: boolean) => onChange({ ...pick, [kind]: on ? [...pick[kind], id] : pick[kind].filter((x) => x !== id) });
  if (!items) return <p className="text-muted">Getting your folders and notes…</p>;
  return (
    <div className="max-h-64 space-y-3 overflow-y-auto rounded-control bg-sunken p-3" role="group" aria-label="Folders and notes to bring">
      {items.folders.length ? (
        <div className="space-y-1.5">
          <p className="ui-caps">Folders</p>
          {items.folders.map((f) => (
            <div key={f.id} style={{ paddingLeft: f.depth * 16 }}>
              <Checkbox checked={pick.folders.includes(f.id)} onChange={(on) => toggle("folders", f.id, on)}>
                {f.name}
              </Checkbox>
            </div>
          ))}
        </div>
      ) : null}
      {items.notes.length ? (
        <div className="space-y-1.5">
          <p className="ui-caps">Notes</p>
          {items.notes.map((n) => (
            <Checkbox key={n.id} checked={pick.notes.includes(n.id)} onChange={(on) => toggle("notes", n.id, on)}>
              {n.title}
            </Checkbox>
          ))}
        </div>
      ) : null}
      <p className="text-[12.5px] text-muted">A folder brings its folders and notes; a note brings the pages under it.</p>
    </div>
  );
}

function MoveProgress({ p, trashing }: { p: MigrationProgress | null; trashing: { done: number; total: number } | null }) {
  const total = p?.notesTotal ?? 0;
  const done = p?.notesDone ?? 0;
  const pct = trashing ? 100 : total ? Math.round((done / total) * 100) : 0;
  return (
    <div data-testid="place-move-progress">
      <div className="h-1.5 overflow-hidden rounded-tiny bg-sunken" role="progressbar" aria-label="Moving notes" aria-valuemin={0} aria-valuemax={total || 1} aria-valuenow={done}>
        <div className="h-full rounded-tiny bg-heading transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-3 text-sm text-muted" role="status" aria-live="polite">
        {trashing
          ? `Putting the originals in Trash: ${trashing.done} of ${trashing.total}`
          : !p || p.phase === "organizing"
            ? "Bringing folders and tags…"
            : p.phase === "trash"
              ? "Putting Trash back as it was…"
              : `${done.toLocaleString()} of ${plural(total, "note")}${p.current ? `: ${p.current}` : ""}`}
      </p>
    </div>
  );
}

function Summary({ state, move }: { state: MigrationState; move: PlaceMove }) {
  const n = Object.keys(state.notes).length;
  const files = state.problems.filter((p) => p.kind === "file");
  return (
    <div className="space-y-2 text-sm" data-testid="place-move-done">
      <p className="text-ink">
        {plural(n, "note")} {move.mode === "move" ? "moved" : "copied"} to {move.to.label}.{move.mode === "move" ? " The originals are in Trash here for 30 days." : ""}
      </p>
      {files.length ? <p className="text-muted">{plural(files.length, "file")} didn&apos;t come along. Each note says where its file is.</p> : null}
      {state.problems.length - files.length > 0 ? <p className="text-muted">{plural(state.problems.length - files.length, "thing")} couldn&apos;t be copied.</p> : null}
    </div>
  );
}

/** The library on this device, opened beside an account (apps only). */
async function libraryEnd(): Promise<MoveEnd> {
  const { openLibraryHere } = await import("@/lib/migrate/session");
  const lib = await openLibraryHere();
  return { ...pageEnd(lib.client as unknown as MigrationClient, "library", lib.backend.store), close: () => lib.close() };
}

// ---------------------------------------------------------------------------------------------------- after a switch

const subscribe = (cb: () => void) => {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
};

/**
 * A move that switched here to run (from the library into this account): it runs before the app shows, and says
 * how it went. Shown only in the place it was meant to run in.
 */
export function PlaceMoveGate({ children }: { children: ReactNode }) {
  const raw = useSyncExternalStore(subscribe, () => localStorage.getItem(PENDING_KEY), () => null);
  const pending = useMemo(() => (raw ? readPending() : null), [raw]);
  if (!pending || pending.runIn !== currentPlaceId()) return <>{children}</>;
  return <RunPending move={pending} />;
}

function RunPending({ move }: { move: Pending }) {
  const convex = useConvex() as unknown as MigrationClient;
  const { deviceId } = useAppState();
  const [progress, setProgress] = useState<MigrationProgress | null>(null);
  const [result, setResult] = useState<{ state: MigrationState } | { error: string } | null>(null);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      let from: MoveEnd | null = null;
      try {
        from = move.from.place === LIBRARY_PLACE ? await libraryEnd() : await otherAccountEnd(move.from.place);
        const state = await runPlaceMove({ move, from, to: pageEnd(convex, "account"), open: "to", deviceId: deviceId ?? "web-move", progress: storedProgress(move.key), onProgress: setProgress });
        forgetProgress(move.key);
        setResult({ state });
      } catch (e) {
        setResult({ error: errorText(e) });
      } finally {
        await from?.close().catch(() => undefined);
      }
    })();
  }, [move, convex, deviceId]);
  const done = () => {
    writePending(null);
    window.dispatchEvent(new StorageEvent("storage", { key: PENDING_KEY }));
  };
  if (!result) {
    return (
      <FullPageMessage title={move.mode === "move" ? "Moving your notes" : "Copying your notes"} body="Keep Folevi open. If it closes, this goes on from here next time.">
        <MoveProgress p={progress} trashing={null} />
      </FullPageMessage>
    );
  }
  return (
    <FullPageMessage title={"error" in result ? "The move stopped" : "Done"} body={"error" in result ? result.error : <Summary state={result.state} move={move} />}>
      <div className="flex gap-2">
        <Button variant="primary" onClick={done}>
          Open {move.to.label}
        </Button>
      </div>
    </FullPageMessage>
  );
}

export type { MoveSide };
