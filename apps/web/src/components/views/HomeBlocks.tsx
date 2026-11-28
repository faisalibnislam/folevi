"use client";

// Home's own pieces (the owner, 28 November 2026, Home design version 19): the top line (the date and Customize), the
// greeting, the capture field (with where a capture saves), the Today card (today's events and due tasks on one
// timeline), My tasks, Foli DNA of the week, the sections' heads, and the frame and Add-a-block tile of Customize
// mode. The layout and the pinned note are one person's, synced (convex/homePrefs.ts).
import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import { useMutation } from "convex/react";
import { ArrowDown, ArrowRight, ArrowUp, CalendarDays, Check, ChevronDown, EyeOff, LayoutTemplate, NotebookPen, PencilLine, Plus, SquareCheckBig } from "lucide-react";
import { scopeIdKey, type WireScope } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { AppLink, useAppRouter } from "@/lib/app/router";
import { useFolderTree } from "@/lib/app/folders";
import { useCachedQuery, useOfflineQuery } from "@/lib/sync/queryCache";
import { useQuery } from "@/lib/convex/queries";
import { folderHex } from "@/lib/folderColors";
import { noteFromText } from "@/lib/desktop/capabilities";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { FolderGlyph } from "@/components/ui/FolderGlyph";
import { TaskItem, useToggleTask } from "./TasksView";
import { greetingFor, moveHomeBlock, setHomeBlockHidden, upNext, upNextTag, type HomeBlock, type HomeBlockId, type SavedHomeLayout } from "@/lib/app/homeLayout";

/** This person's Home layout and pinned note, with the calls that change them. */
export function useHomePrefs() {
  const prefs = useOfflineQuery(api.homePrefs.get, {});
  const setLayout = useMutation(api.homePrefs.setLayout);
  const setPinnedNote = useMutation(api.homePrefs.setPinnedNote);
  return { prefs, setLayout, setPinnedNote };
}

/** A section's head: its title in the serif face over a hairline, with See all (or another link) at the right. */
export function SectionHead({ id, children, action, icon: Icon }: { id: string; children: ReactNode; action?: ReactNode; icon?: ComponentType<{ size?: number; "aria-hidden"?: boolean }> }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 id={id} className="flex min-w-0 items-center gap-2.5 font-serif text-title-3 font-semibold leading-tight text-heading">
        {Icon ? (
          <span aria-hidden className="grid size-7 flex-none place-items-center rounded-small border border-[var(--color-line)] bg-surface text-muted shadow-[var(--shadow-raised)]">
            <Icon size={14} aria-hidden />
          </span>
        ) : null}
        <span className="truncate">{children}</span>
      </h2>
      {action}
    </div>
  );
}

/** "See all"-style link at a section's top right. */
export function BlockLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <AppLink href={href} className="ui-hit group/link -mr-2 inline-flex flex-none items-center gap-0.5 whitespace-nowrap rounded-chip px-2 py-0.5 text-subheadline text-muted transition-colors hover:bg-accent-soft hover:text-heading">
      {children}
      <ArrowRight size={13} aria-hidden className="transition-transform duration-200 ease-[var(--ease-folio)] group-hover/link:translate-x-0.5" />
    </AppLink>
  );
}

/** Home's top line: the date at the left, Customize at the right. */
export function HomeTopLine({ editing, onToggle }: { editing: boolean; onToggle: () => void }) {
  const now = useNow();
  const date = now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  return (
    <div className="flex h-control items-center justify-between gap-3">
      <p className="text-subheadline text-faint">{date}</p>
      <button type="button" aria-pressed={editing} onClick={onToggle} className={`ui-btn ${editing ? "ui-btn-primary" : "ui-btn-quiet"} h-control-sm gap-2 px-3 text-subheadline`}>
        {editing ? <Check size={14} aria-hidden /> : <PencilLine size={14} aria-hidden />}
        {editing ? "Done" : "Customize"}
      </button>
    </div>
  );
}

/** "Good morning, Faisal" in the serif display face, the opening's first line. */
export function HomeGreeting() {
  const { profile } = useAppState();
  const now = useNow();
  const first = (profile.displayName ?? "").trim().split(/\s+/)[0] ?? "";
  return (
    <h1 className="ui-display font-serif text-large-title font-medium leading-[1.08] @[860px]:text-[44px]">
      {greetingFor(now.getHours())}
      {first ? `, ${first}` : ""}
    </h1>
  );
}

/** The time, a minute at most behind. */
function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
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
    <div className="relative rounded-container border border-[var(--color-line)] bg-surface px-5 pb-3 pt-4 shadow-[var(--shadow-resting)]">
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
          {value ? <span className="mr-1 hidden text-caption-1 text-faint @[640px]:inline">⌘↩ to save</span> : null}
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

/** The open tasks of this space (the Tasks page's "All", soonest due first). */
function useOpenTasks() {
  const { scope, today } = useAppState();
  return useCachedQuery(api.tasks.list, { scope, view: "all", today }).data;
}

/**
 * Today, as a calendar day (the owner, 28 November 2026: "redesign properly, calendar"): the date on a tile at the
 * left, today's events at the right as time rows with their calendar's colour, the next one tagged "Up next · in
 * 25 min", and one line for the tasks due (they're listed in My tasks beside it). Same head as the other sections.
 */
export function TodayCard() {
  const { today } = useAppState();
  const events = useTodayEvents();
  const tasks = useOpenTasks();
  const nowDate = useNow();
  const now = nowDate.getTime();
  const items = events === undefined || tasks === undefined ? undefined : upNext(events, tasks, today, now, clock);
  const agenda = items?.filter((i) => i.kind === "event").slice(0, 5);
  const due = items?.filter((i) => i.kind === "task").length ?? 0;
  const tagged = agenda?.find((i) => upNextTag(i, now) !== null);
  return (
    <section aria-labelledby="home-today-title">
      <SectionHead id="home-today-title" icon={CalendarDays} action={<BlockLink href="/calendar">Calendar</BlockLink>}>
        Today
      </SectionHead>
      <div className="mt-4 flex overflow-hidden rounded-container border border-[var(--color-line)] bg-surface">
        <div className="flex w-28 flex-none flex-col items-center justify-center gap-0.5 border-r border-[var(--color-line)] px-3 py-5 text-center">
          <span className="text-caption-1 font-semibold uppercase tracking-[0.08em] text-[var(--color-danger,#b4432c)]">{nowDate.toLocaleDateString(undefined, { weekday: "short" })}</span>
          <span className="font-serif text-large-title font-medium leading-none tabular-nums text-heading">{nowDate.getDate()}</span>
          <span className="text-footnote text-muted">{nowDate.toLocaleDateString(undefined, { month: "long" })}</span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          {agenda === undefined ? (
            <p className="px-4 py-5 text-subheadline text-muted">Loading…</p>
          ) : !agenda.length ? (
            <div className="flex flex-1 flex-col justify-center px-4 py-5">
              <p className="text-subheadline font-medium text-ink">No more events today</p>
              <p className="text-footnote text-muted">Your calendars are clear for the rest of the day.</p>
            </div>
          ) : (
            <ol aria-label="Today’s events" className="flex-1">
              {agenda.map((i) => {
                const tag = i === tagged ? upNextTag(i, now) : null;
                return (
                  <li key={i.key} className="border-b border-[var(--color-line)] last:border-b-0">
                    <AppLink href={i.href} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-[var(--glass-hover)]">
                      <span className="w-14 flex-none text-footnote font-medium tabular-nums text-muted">{i.time}</span>
                      <span aria-hidden className="h-8 w-[3px] flex-none rounded-tiny" style={{ background: i.color || "var(--color-ink-faint)" }} />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-subheadline text-heading">{i.title}</span>
                        {i.meta ? <span className="truncate text-footnote text-muted">{i.meta}</span> : null}
                      </span>
                      {tag ? <span className="flex-none rounded-chip bg-[var(--glass-hover)] px-2 py-0.5 text-caption-1 font-semibold text-heading">{tag}</span> : null}
                    </AppLink>
                  </li>
                );
              })}
            </ol>
          )}
          {due ? (
            <AppLink href="/tasks" className="flex items-center gap-2 border-t border-[var(--color-line)] px-4 py-2.5 text-footnote text-muted transition-colors hover:bg-[var(--glass-hover)] hover:text-heading">
              <span aria-hidden className="size-1.5 flex-none rounded-tiny bg-[var(--color-danger,#b4432c)]" />
              {due === 1 ? "1 task due today or overdue" : `${due} tasks due today or overdue`}
            </AppLink>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/**
 * My tasks: the next open tasks by due date as one-line rows, the due date at the right, ticked off here. In two
 * columns when the section has the row to itself.
 */
export function TasksPreview({ twoColumns }: { twoColumns: boolean }) {
  const { today } = useAppState();
  const data = useOpenTasks();
  const toggle = useToggleTask();
  if (data === undefined) return <p className="pt-3 text-subheadline text-muted">Loading…</p>;
  if (!data.length) return <p className="pt-3 text-subheadline text-muted">No open tasks.</p>;
  return (
    <ul aria-label="Open tasks" className={`-mx-3 mt-3 grid grid-cols-1 gap-x-10 ${twoColumns ? "@[640px]:grid-cols-2" : ""}`}>
      {data.slice(0, twoColumns ? 6 : 5).map((t) => (
        <TaskItem key={t.blockId} task={t} today={today} onToggle={toggle} draggable={false} />
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
  if (!week) return <div className="h-72 animate-pulse rounded-container bg-[var(--glass-hover)] motion-reduce:animate-none" role="status" aria-label="Loading Foli DNA" />;
  if (!week.hub)
    return (
      <p className="rounded-container border border-[var(--color-line)] px-5 py-8 text-center text-subheadline text-muted">
        No links between your notes yet. Link one note to another with [[ and it shows here.
      </p>
    );
  const chip = "absolute inline-flex max-w-[40%] -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 whitespace-nowrap rounded-panel px-2.5 py-1 text-footnote font-medium transition-[filter] hover:brightness-95";
  return (
    <div className="relative h-72 overflow-hidden rounded-container border border-[var(--color-line)] bg-surface bg-[radial-gradient(circle,color-mix(in_oklab,var(--color-ink)_14%,transparent)_1px,transparent_1.2px)] bg-[length:16px_16px] shadow-[var(--shadow-resting)]">
      <svg aria-hidden width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0">
        <g fill="none" stroke="var(--color-ink-faint)" strokeOpacity="0.45" strokeWidth="1">
          {week.around.map((_, i) => {
            const [x, y] = RING[i]!;
            return <path key={i} d={`M50 50 C ${(50 + x) / 2} ${50 + (y - 50) * 0.2}, ${x} ${y < 50 ? y + 12 : y - 12}, ${x} ${y}`} vectorEffect="non-scaling-stroke" />;
          })}
        </g>
      </svg>
      <AppLink href={`/d/${week.hub.id}`} className={`${chip} left-1/2 top-1/2 bg-heading text-canvas shadow-[var(--shadow-raised)]`}>
        <span aria-hidden className="h-[7px] w-[7px] flex-none rounded-tiny" style={{ background: colorOf(week.hub.folderId) }} />
        <span className="truncate">{week.hub.label}</span>
      </AppLink>
      {week.around.map((n, i) => (
        <AppLink key={n.id} href={`/d/${n.id}`} className={`${chip} bg-surface text-ink shadow-[0_0_0_1px_var(--color-line)]`} style={{ left: `${RING[i]![0]}%`, top: `${RING[i]![1]}%` }}>
          <span aria-hidden className="h-[7px] w-[7px] flex-none rounded-tiny" style={{ background: colorOf(n.folderId) }} />
          <span className="truncate">{n.label}</span>
        </AppLink>
      ))}
      <span className="absolute bottom-3 left-4 rounded-chip bg-surface/90 px-2 py-0.5 text-footnote text-muted backdrop-blur-sm">
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
}: {
  block: HomeBlock;
  hidden: boolean;
  editing: boolean;
  first: boolean;
  last: boolean;
  saved: SavedHomeLayout;
  saveLayout: (layout: { order: string[]; hidden: string[] }) => Promise<unknown>;
  children: ReactNode;
}) {
  const toast = useToast();
  if (hidden) return null;
  const save = (l: { order: string[]; hidden: string[] }) => saveLayout(l).catch((e) => toast.show(errorMessage(e), { tone: "error" }));
  const move = (dir: -1 | 1) => void save(moveHomeBlock(saved, block.id as HomeBlockId, dir));
  const tool = "ui-btn ui-btn-quiet size-control p-0 disabled:opacity-40";
  return (
    <div className={`relative min-w-0 ${editing ? "rounded-panel outline-dashed outline-[1.5px] outline-offset-[10px] outline-[var(--color-ink-faint)]" : ""}`}>
      {editing ? (
        <div className="absolute -top-7 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-control bg-surface px-1 shadow-[var(--shadow-raised)]">
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
    <div className="flex min-h-24 flex-wrap items-center gap-2 rounded-container border-[1.5px] border-dashed border-[var(--color-ink-faint)] px-5 py-4">
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
