"use client";

// Home's own blocks (the owner, 28 November 2026, from the Home concepts canvas): the centred greeting and capture
// field (with where a capture saves), the scratch pad, Up next, Today, My tasks, Foli DNA of the week, and the frame
// and Add-a-block tile of Customize mode. The layout and the scratch pad are one person's, synced
// (convex/homePrefs.ts).
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation } from "convex/react";
import { ArrowDown, ArrowUp, Check, ChevronDown, EyeOff, LayoutTemplate, NotebookPen, Plus, SquareCheckBig } from "lucide-react";
import { scopeIdKey, type WireScope } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { AppLink, useAppRouter } from "@/lib/app/router";
import { useFolderTree } from "@/lib/app/folders";
import { useCachedQuery, useOfflineQuery } from "@/lib/sync/queryCache";
import { useQuery } from "@/lib/convex/queries";
import { dueLabel } from "@/lib/format";
import { folderHex } from "@/lib/folderColors";
import { noteFromText } from "@/lib/desktop/capabilities";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { FolderGlyph } from "@/components/ui/FolderGlyph";
import { useToggleTask } from "./TasksView";
import { greetingFor, moveHomeBlock, setHomeBlockHidden, upNext, type HomeBlock, type HomeBlockId, type SavedHomeLayout } from "@/lib/app/homeLayout";

/** The scratch pad's length, at most (convex/homePrefs.ts SCRATCH_MAX). */
const SCRATCH_MAX = 4000;

/** This person's Home layout and scratch pad, with the calls that change them. */
export function useHomePrefs() {
  const prefs = useOfflineQuery(api.homePrefs.get, {});
  const setLayout = useMutation(api.homePrefs.setLayout);
  const setScratch = useMutation(api.homePrefs.setScratch);
  return { prefs, setLayout, setScratch };
}

/** A block's heading, the same as Home's other sections (an icon in a chip, then the title in the display face). */
export function BlockTitle({ id, icon, children, action }: { id: string; icon: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 id={id} className="ui-display flex min-w-0 items-center gap-2.5 text-title-2">
        <span aria-hidden className="grid h-8 w-8 flex-none place-items-center rounded-chip bg-[var(--glass-hover)] text-heading">
          {icon}
        </span>
        <span className="truncate">{children}</span>
      </h2>
      {action}
    </div>
  );
}

/** "See all"-style link at a block's top right. */
export function BlockLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <AppLink href={href} className="ui-hit inline-flex flex-none items-center gap-1 whitespace-nowrap rounded-chip px-2.5 py-1 text-subheadline font-medium text-ink transition-colors hover:bg-accent-soft">
      {children}
    </AppLink>
  );
}

/** Home's top: the Customize switch, then the date and "Good morning, Faisal", centred. */
export function HomeHeader({ editing, onToggle }: { editing: boolean; onToggle: () => void }) {
  const { profile } = useAppState();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  const first = (profile.displayName ?? "").trim().split(/\s+/)[0] ?? "";
  const date = now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  return (
    <>
      <div className="mt-4 flex justify-end">
        <button type="button" aria-pressed={editing} onClick={onToggle} className={`ui-btn ${editing ? "ui-btn-primary" : "ui-btn-quiet"} h-control gap-2 px-3 text-callout`}>
          {editing ? <Check size={14} aria-hidden /> : <NotebookPen size={14} aria-hidden />}
          {editing ? "Done" : "Customize"}
        </button>
      </div>
      <header className="mx-auto mt-4 max-w-[680px] text-center">
        <p className="text-subheadline text-faint">{date}</p>
        <h1 className="ui-display mt-2 text-large-title">
          {greetingFor(now.getHours())}
          {first ? `, ${first}` : ""}
        </h1>
      </header>
    </>
  );
}

/** Where a capture saves: a space (Personal or a workspace) and a folder in it (null: its Drafts). */
type Dest = { scope: WireScope; folderId: string | null };
const DEST_KEY = "folevi:home-capture-to";

function readDest(): Dest | null {
  try {
    const v = JSON.parse(localStorage.getItem(DEST_KEY) ?? "null") as Dest | null;
    return v && typeof v === "object" && v.scope ? v : null;
  } catch {
    return null;
  }
}

/** The folders of one space as picker options (loaded only while the picker is open). */
function SpaceOptions({ scope, spaceName, dest, pick }: { scope: WireScope; spaceName: string; dest: Dest; pick: (d: Dest) => void }) {
  const tree = useFolderTree(scope);
  const folders = tree?.folders ?? [];
  const byId = new Map(folders.map((f) => [f.id, f]));
  const path = (id: string) => {
    const parts: string[] = [];
    for (let f = byId.get(id); f && parts.length < 6; f = f.parentFolderId ? byId.get(f.parentFolderId) : undefined) parts.unshift(f.name);
    return parts.join(" › ");
  };
  const same = scopeIdKey(scope) === scopeIdKey(dest.scope);
  const option = (folderId: string | null, label: string, color: string | null) => {
    const on = same && dest.folderId === folderId;
    return (
      <button
        key={folderId ?? "drafts"}
        type="button"
        role="option"
        aria-selected={on}
        onClick={() => pick({ scope, folderId })}
        className={`flex h-control-sm w-full items-center gap-2 rounded-chip px-2 text-left text-subheadline text-ink ${on ? "bg-[var(--glass-active)]" : "hover:bg-[var(--glass-hover)]"}`}
      >
        {folderId ? <FolderGlyph color={color} size={11} /> : <NotebookPen size={12} aria-hidden className="flex-none text-muted" />}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {on ? <Check size={12} aria-hidden /> : null}
      </button>
    );
  };
  return (
    <div role="group" aria-label={spaceName}>
      <div className="px-2 pb-1 pt-2 text-footnote font-semibold text-faint">{spaceName}</div>
      {option(null, "Drafts", null)}
      {folders.map((f) => option(f.id, path(f.id), f.color))}
    </div>
  );
}

/**
 * The capture field (the calm start's): write anything, Save makes a note of it (its first line the title) where it
 * says it saves; that place can be changed and is remembered on this device. Task adds it to Tasks instead, Template
 * opens the templates.
 */
export function CaptureField() {
  const { scope, workspaces, today, deviceId } = useAppState();
  const importText = useMutation(api.imports.importText);
  const quickAdd = useMutation(api.tasks.quickAdd);
  const { navigate } = useAppRouter();
  const toast = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [dest, setDest] = useState<Dest>(() => readDest() ?? { scope, folderId: null });
  const menu = useRef<HTMLDivElement>(null);
  // A remembered place in a workspace this person has left falls back to Drafts here.
  const spaces = useMemo(() => [{ scope: { kind: "personal" } as WireScope, name: "Personal" }, ...workspaces.map((w) => ({ scope: { kind: "workspace", workspaceId: w.id } as WireScope, name: w.name }))], [workspaces]);
  const space = spaces.find((s) => scopeIdKey(s.scope) === scopeIdKey(dest.scope));
  const where = space ? dest : { scope, folderId: null };
  const destTree = useFolderTree(where.scope);
  const folder = where.folderId ? destTree?.folders.find((f) => f.id === where.folderId) : undefined;
  const spaceName = spaces.find((s) => scopeIdKey(s.scope) === scopeIdKey(where.scope))?.name ?? "Personal";
  const destLabel = `${spaces.length > 1 ? `${spaceName} › ` : ""}${folder ? folder.name : "Drafts"}`;
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const pick = (d: Dest) => {
    setDest(d);
    setOpen(false);
    try {
      localStorage.setItem(DEST_KEY, JSON.stringify(d));
    } catch {
      /* storage unavailable: kept for this visit */
    }
  };
  const value = text.trim();
  const save = async () => {
    if (!value || busy) return;
    setBusy(true);
    try {
      const { title, body } = noteFromText(value);
      const folderId = where.folderId && folder ? where.folderId : undefined;
      const made = (await importText({ scope: where.scope, filename: title, content: body.split(/\n+/).join("\n\n"), format: "text", ...(folderId ? { folderId } : {}) })) as { document: { id: string } };
      setText("");
      toast.show(`Saved to ${destLabel}`, { action: { label: "Open", onClick: () => navigate(`/d/${made.document.id}`) } });
    } catch (e) {
      toast.show(errorMessage(e), { tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  const addTask = async () => {
    if (!value || busy) return;
    setBusy(true);
    try {
      await quickAdd({ scope: where.scope, title: value.split("\n")[0]!.slice(0, 500), today, deviceId: deviceId ?? undefined });
      setText("");
      toast.show("Task added", { action: { label: "Open Tasks", onClick: () => navigate("/tasks") } });
    } catch (e) {
      toast.show(errorMessage(e), { tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  const tool = "ui-btn ui-btn-quiet size-control p-0 text-muted disabled:opacity-40";
  return (
    <div className="relative mx-auto mt-7 max-w-[680px] rounded-container border border-[var(--color-line)] bg-surface px-5 pb-3 pt-4 shadow-[0_1px_2px_rgb(0_0_0/0.04),0_12px_32px_-18px_rgb(20_20_40/0.25)]">
      <label htmlFor="home-capture" className="sr-only">
        New note
      </label>
      <textarea
        id="home-capture"
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void save();
          }
        }}
        placeholder="What’s on your mind?"
        className="w-full resize-none bg-transparent font-serif text-title-3 leading-relaxed text-ink outline-none placeholder:text-faint"
      />
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <span className="text-footnote text-faint">Saves to</span>
        <div ref={menu} className="relative">
          <button type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="ui-btn ui-btn-quiet h-control-sm gap-1.5 px-2 text-footnote font-medium">
            {folder ? <FolderGlyph color={folder.color} size={11} /> : <NotebookPen size={12} aria-hidden className="text-muted" />}
            {destLabel}
            <ChevronDown size={12} aria-hidden />
          </button>
          {open ? (
            <div role="listbox" aria-label="Where it saves" className="ui-raised absolute left-0 top-full z-30 mt-1 max-h-80 w-64 overflow-y-auto rounded-container p-1.5">
              {spaces.map((s) => (
                <SpaceOptions key={scopeIdKey(s.scope)} scope={s.scope} spaceName={s.name} dest={where} pick={pick} />
              ))}
            </div>
          ) : null}
        </div>
        <span className="ml-auto flex items-center gap-1">
          <button type="button" className={tool} disabled={!value || busy} onClick={() => void addTask()} aria-label="Add as a task" title="Add as a task">
            <SquareCheckBig size={16} aria-hidden />
          </button>
          <button type="button" className={tool} onClick={() => navigate("/templates")} aria-label="Start from a template" title="Start from a template">
            <LayoutTemplate size={16} aria-hidden />
          </button>
          <button type="button" disabled={!value || busy} onClick={() => void save()} className="ui-btn ui-btn-primary h-control-sm px-3 text-footnote font-semibold disabled:opacity-50">
            Save
          </button>
        </span>
      </div>
    </div>
  );
}

/** The scratch pad: plain text that saves itself as you type (a moment after the last key) and follows you. */
export function ScratchPad({ saved, save }: { saved: string | undefined; save: (text: string) => Promise<unknown> }) {
  const toast = useToast();
  const [text, setText] = useState<string | null>(null);
  const dirty = useRef(false);
  // Until this person types, the pad shows what the server has (another device's edit appears here).
  useEffect(() => {
    if (!dirty.current && saved !== undefined) setText(saved);
  }, [saved]);
  useEffect(() => {
    if (text === null || !dirty.current) return;
    const t = setTimeout(() => {
      save(text).then(
        () => {
          dirty.current = false;
        },
        (e) => toast.show(errorMessage(e), { tone: "error" }),
      );
    }, 600);
    return () => clearTimeout(t);
  }, [text, save, toast]);
  return (
    <div className="flex min-h-48 flex-col rounded-control bg-[color-mix(in_oklab,var(--color-surface),#f5d76e_14%)] p-3">
      <label htmlFor="home-scratch" className="sr-only">
        Scratch pad
      </label>
      <textarea
        id="home-scratch"
        value={text ?? ""}
        disabled={text === null}
        maxLength={SCRATCH_MAX}
        placeholder="Jot anything. It saves itself."
        onChange={(e) => {
          dirty.current = true;
          setText(e.target.value);
        }}
        className="min-h-40 flex-1 resize-none bg-transparent text-body leading-relaxed text-ink outline-none placeholder:text-faint"
      />
      <span className="self-end text-footnote tabular-nums text-faint">
        {(text ?? "").length} / {SCRATCH_MAX}
      </span>
    </div>
  );
}

/** Today's events (the calendars this person shows in Calendar), from local midnight to midnight. */
function useTodayEvents() {
  const range = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { from: start.getTime(), to: end.getTime() };
  }, []);
  return useOfflineQuery(api.externalCalendars.events, range);
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** Today: the day's events, in time order. */
export function TodayAgenda() {
  const events = useTodayEvents();
  if (events === undefined) return <p className="text-subheadline text-muted">Loading…</p>;
  const sorted = [...events].sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start - b.start);
  if (!sorted.length)
    return (
      <p className="text-subheadline text-muted">
        Nothing on your calendar today.{" "}
        <AppLink href="/calendar" className="font-medium text-ink underline underline-offset-2">
          Open Calendar
        </AppLink>
      </p>
    );
  return (
    <ul className="flex flex-col gap-2">
      {sorted.slice(0, 6).map((e) => (
        <li key={e.id} className="grid grid-cols-[48px_minmax(0,1fr)] gap-3">
          <span className="pt-2 text-footnote tabular-nums text-muted">{e.allDay ? "All day" : clock(e.start)}</span>
          <span className="min-w-0 rounded-chip px-3 py-2" style={{ background: `color-mix(in oklab, ${e.color || "#6b7280"} 14%, var(--color-surface))` }}>
            <span className="block truncate text-subheadline font-semibold text-heading">{e.title || "Untitled event"}</span>
            <span className="block truncate text-footnote text-muted">{[e.allDay ? null : `${clock(e.start)} to ${clock(e.end)}`, e.location || e.calendarName].filter(Boolean).join(" · ")}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The open tasks of this space (the Tasks page's "All", soonest due first). */
function useOpenTasks() {
  const { scope, today } = useAppState();
  return useCachedQuery(api.tasks.list, { scope, view: "all", today }).data;
}

/** My tasks: the next open tasks by due date, ticked off right here. */
export function TasksPreview() {
  const { today } = useAppState();
  const data = useOpenTasks();
  const toggle = useToggleTask();
  if (data === undefined) return <p className="text-subheadline text-muted">Loading…</p>;
  if (!data.length) return <p className="text-subheadline text-muted">No open tasks.</p>;
  return (
    <ul className="flex flex-col">
      {data.slice(0, 5).map((t) => {
        const due = !!t.dueDate && t.dueDate <= today;
        return (
          <li key={t.blockId} className="flex items-start gap-3 border-b border-[var(--color-line)] py-2.5 last:border-b-0">
            <button
              type="button"
              aria-label={`Complete “${t.title || "Untitled task"}”`}
              title="Complete"
              onClick={() => toggle(t)}
              className="mt-0.5 grid h-4 w-4 flex-none place-items-center rounded-small border border-[var(--color-ink-muted)] text-transparent transition-colors hover:text-muted"
            >
              <Check size={10} aria-hidden />
            </button>
            <span className="min-w-0">
              <span className="block text-subheadline text-ink">{t.title || "Untitled task"}</span>
              <span className={`block text-footnote ${due ? "text-[var(--color-danger,#b4432c)]" : "text-muted"}`}>{t.dueDate ? dueLabel(t.dueDate, today) : "No date"}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Up next: today's events still to come and the tasks due, in time order (lib/app/homeLayout.ts upNext). */
export function UpNextList() {
  const { today } = useAppState();
  const events = useTodayEvents();
  const tasks = useOpenTasks();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  if (events === undefined || tasks === undefined) return <p className="text-subheadline text-muted">Loading…</p>;
  const items = upNext(events, tasks, today, now, clock).slice(0, 5);
  if (!items.length) return <p className="text-subheadline text-muted">Nothing else today.</p>;
  return (
    <ul className="flex flex-col">
      {items.map((i) => (
        <li key={i.key} className="border-b border-[var(--color-line)] last:border-b-0">
          <AppLink href={i.href} className="flex items-start gap-3 py-2.5 hover:opacity-80">
            <span className={`min-w-12 flex-none pt-px text-footnote font-semibold tabular-nums ${i.kind === "task" ? "text-[var(--color-danger,#b4432c)]" : "text-heading"}`}>{i.time}</span>
            <span className="min-w-0">
              <span className="block truncate text-subheadline text-ink">{i.title}</span>
              <span className="block truncate text-footnote text-muted">{i.meta}</span>
            </span>
          </AppLink>
        </li>
      ))}
    </ul>
  );
}

/** Where the linked notes sit around the week's most linked one, as a share of the map (x, y). */
const RING: readonly [number, number][] = [
  [20, 25],
  [80, 24],
  [24, 78],
  [77, 77],
  [50, 86],
  [50, 14],
];

/**
 * Foli DNA of the week: the note with the most links made this week in the middle, the notes it's linked with around
 * it (their folder's colour on each), and how many links were made (Foli DNA's own data, aiGraph.graph).
 */
export function DnaWeek({ load }: { load: boolean }) {
  const { scope } = useAppState();
  const graph = useQuery(api.aiGraph.graph, load ? { scope } : "skip");
  const tree = useFolderTree(scope);
  const week = useMemo(() => {
    if (!graph) return null;
    const since = Date.now() - 7 * 86_400_000;
    const notes = new Map(graph.nodes.filter((n) => n.kind === "note").map((n) => [n.id, n]));
    const between = graph.edges.filter((e) => notes.has(e.source) && notes.has(e.target));
    const thisWeek = between.filter((e) => (e.createdAt ?? 0) >= since);
    // A week without new links shows the most linked notes of all, so the map isn't empty most weeks.
    const edges = thisWeek.length ? thisWeek : between;
    const degree = new Map<string, number>();
    for (const e of edges) for (const id of [e.source, e.target]) degree.set(id, (degree.get(id) ?? 0) + 1);
    const hubId = [...degree.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const hub = hubId ? notes.get(hubId)! : null;
    const around = hubId
      ? [...new Set(edges.flatMap((e) => (e.source === hubId ? [e.target] : e.target === hubId ? [e.source] : [])))].slice(0, RING.length).map((id) => notes.get(id)!)
      : [];
    return { count: thisWeek.length, hub, around };
  }, [graph]);
  const colorOf = (folderId: string | null | undefined) => {
    const f = folderId ? tree?.folders.find((x) => x.id === folderId) : undefined;
    return f ? folderHex(f.color) : "var(--color-ink-faint)";
  };
  if (!week) return <div className="h-56 animate-pulse rounded-container bg-[var(--glass-hover)] motion-reduce:animate-none" role="status" aria-label="Loading Foli DNA" />;
  if (!week.hub)
    return (
      <p className="rounded-container border border-[var(--color-line)] px-5 py-8 text-center text-subheadline text-muted">
        No links between your notes yet. Link one note to another with [[ and it shows here.
      </p>
    );
  const chip = "absolute inline-flex max-w-[40%] -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 whitespace-nowrap rounded-panel px-2.5 py-1 text-footnote font-medium transition-[filter] hover:brightness-95";
  return (
    <div className="relative h-56 overflow-hidden rounded-container border border-[var(--color-line)] bg-[var(--glass-hover)]">
      <svg aria-hidden width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0">
        <g fill="none" stroke="var(--color-ink-faint)" strokeOpacity="0.45" strokeWidth="1">
          {week.around.map((_, i) => {
            const [x, y] = RING[i]!;
            return <path key={i} d={`M50 50 C ${(50 + x) / 2} ${50 + (y - 50) * 0.2}, ${x} ${y < 50 ? y + 12 : y - 12}, ${x} ${y}`} vectorEffect="non-scaling-stroke" />;
          })}
        </g>
      </svg>
      <AppLink href={`/d/${week.hub.id}`} className={`${chip} left-1/2 top-1/2 bg-heading text-canvas shadow-[0_6px_16px_-8px_rgb(0_0_0/0.35)]`}>
        <span aria-hidden className="h-[7px] w-[7px] flex-none rounded-tiny" style={{ background: colorOf(week.hub.folderId) }} />
        <span className="truncate">{week.hub.label}</span>
      </AppLink>
      {week.around.map((n, i) => (
        <AppLink key={n.id} href={`/d/${n.id}`} className={`${chip} bg-surface text-ink shadow-[0_0_0_1px_var(--color-line)]`} style={{ left: `${RING[i]![0]}%`, top: `${RING[i]![1]}%` }}>
          <span aria-hidden className="h-[7px] w-[7px] flex-none rounded-tiny" style={{ background: colorOf(n.folderId) }} />
          <span className="truncate">{n.label}</span>
        </AppLink>
      ))}
      <span className="absolute bottom-3 left-4 text-footnote text-muted">
        {week.count ? `${week.count} new ${week.count === 1 ? "link" : "links"} between your notes this week` : "No new links this week: your most linked notes"}
      </span>
    </div>
  );
}

/**
 * A block on Home. In Customize mode it gets a dashed outline and buttons to move it and to take it off Home (it then
 * waits in Add a block); a hidden block isn't drawn.
 */
export function HomeBlockFrame({
  block,
  hidden,
  editing,
  first,
  last,
  saved,
  saveLayout,
  children,
  panel,
}: {
  block: HomeBlock;
  hidden: boolean;
  editing: boolean;
  first: boolean;
  last: boolean;
  saved: SavedHomeLayout;
  saveLayout: (layout: { order: string[]; hidden: string[] }) => Promise<unknown>;
  children: ReactNode;
  /** The small blocks sit on a panel; the wide ones (rows of cards, the map) on the page. */
  panel: boolean;
}) {
  const toast = useToast();
  if (hidden) return null;
  const save = (l: { order: string[]; hidden: string[] }) => saveLayout(l).catch((e) => toast.show(errorMessage(e), { tone: "error" }));
  const move = (dir: -1 | 1) => void save(moveHomeBlock(saved, block.id as HomeBlockId, dir));
  const tool = "ui-btn ui-btn-quiet size-control p-0 disabled:opacity-40";
  const span = block.span === 3 ? "col-span-full" : block.span === 2 ? "@[760px]:col-span-2" : "";
  return (
    <div className={`relative min-w-0 ${span} ${panel ? "rounded-container border border-[var(--color-line)] bg-[color-mix(in_oklab,var(--color-surface),var(--color-ink)_1.5%)] p-5" : ""} ${editing ? "rounded-container outline-dashed outline-[1.5px] outline-offset-4 outline-[var(--color-ink-faint)]" : ""}`}>
      {editing ? (
        <div className="absolute -top-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-control bg-surface px-1 shadow-[0_1px_4px_rgb(0_0_0/0.12)]">
          <button type="button" className={tool} disabled={first} onClick={() => move(-1)} aria-label={`Move ${block.label} earlier`} title="Move earlier">
            <ArrowUp size={14} aria-hidden />
          </button>
          <button type="button" className={tool} disabled={last} onClick={() => move(1)} aria-label={`Move ${block.label} later`} title="Move later">
            <ArrowDown size={14} aria-hidden />
          </button>
          <button type="button" className={tool} onClick={() => void save(setHomeBlockHidden(saved, block.id as HomeBlockId, true))} aria-label={`Take ${block.label} off Home`} title="Take off Home">
            <EyeOff size={14} aria-hidden />
          </button>
        </div>
      ) : null}
      {children}
    </div>
  );
}

/** Customize mode's last tile: the blocks not on Home, each added back with a click (to the end). */
export function AddBlockTile({ blocks, saved, saveLayout }: { blocks: HomeBlock[]; saved: SavedHomeLayout; saveLayout: (layout: { order: string[]; hidden: string[] }) => Promise<unknown> }) {
  const toast = useToast();
  return (
    <div className="col-span-full flex min-h-24 flex-wrap items-center gap-2 rounded-container border-[1.5px] border-dashed border-[var(--color-ink-faint)] px-5 py-4">
      <span className="mr-2 inline-flex items-center gap-2 text-callout font-medium text-muted">
        <Plus size={16} aria-hidden /> Add a block
      </span>
      {blocks.length ? (
        blocks.map((b) => (
          <button key={b.id} type="button" className="ui-btn ui-btn-quiet h-control-sm px-3 text-subheadline" onClick={() => void saveLayout(setHomeBlockHidden(saved, b.id, false)).catch((e) => toast.show(errorMessage(e), { tone: "error" }))}>
            {b.label}
          </button>
        ))
      ) : (
        <span className="text-subheadline text-faint">Every block is on Home.</span>
      )}
    </div>
  );
}
