// Home's blocks (the owner, 28 November 2026, Home design version 19): under the opening (the greeting, the Foli AI
// summary and the capture field, always there), sections this person can move, take
// off Home and add back: what they are, in which order by default, and how one person's saved layout
// (convex/homePrefs.ts) is laid over that. A block the saved order doesn't name (one added to the apps later) takes its
// default place, shown or hidden as its default says; an id the apps no longer know (the earlier designs' scratch,
// summary, upnext and today) is dropped.

export type HomeBlockId = "recent" | "bookmarks" | "today" | "tasks" | "dna" | "folders" | "shared" | "pinned" | "templates";

export type HomeBlock = {
  id: HomeBlockId;
  label: string;
  /** Off until the person adds it (Customize, Add a block). */
  hiddenByDefault?: boolean;
  /**
   * Shares a row with the other paired blocks next to it: the "main" ones stack in the left column (1fr), the "side"
   * ones in the right (1.15fr). Today and My tasks beside Foli DNA, in design version 19.
   */
  pair?: "main" | "side";
};

export const HOME_BLOCKS: readonly HomeBlock[] = [
  { id: "recent", label: "Recent notes" },
  { id: "bookmarks", label: "Bookmarks" },
  { id: "today", label: "Today", pair: "main" },
  { id: "tasks", label: "My tasks", pair: "main" },
  { id: "dna", label: "Foli DNA", pair: "side" },
  { id: "folders", label: "Recent folders" },
  { id: "shared", label: "Shared with me", hiddenByDefault: true },
  { id: "pinned", label: "Pinned note", hiddenByDefault: true },
  { id: "templates", label: "Templates", hiddenByDefault: true },
];

export type SavedHomeLayout = { order: string[]; hidden: string[] } | null | undefined;

const KNOWN = new Map(HOME_BLOCKS.map((b, i) => [b.id as string, i]));

/**
 * The blocks in this person's order with whether each is hidden. Unknown ids are dropped; blocks the saved order
 * doesn't name go in at their default place (after the block that comes before them by default), shown or hidden
 * as their default says.
 */
export function arrangeHome(saved: SavedHomeLayout): { block: HomeBlock; hidden: boolean }[] {
  const named = new Set(saved?.order ?? []);
  const hidden = new Set(saved?.hidden ?? []);
  const order: HomeBlockId[] = [];
  for (const id of saved?.order ?? []) if (KNOWN.has(id) && !order.includes(id as HomeBlockId)) order.push(id as HomeBlockId);
  for (const b of HOME_BLOCKS) {
    if (order.includes(b.id)) continue;
    const def = KNOWN.get(b.id)!;
    let at = 0;
    for (let i = def - 1; i >= 0; i--) {
      const prev = order.indexOf(HOME_BLOCKS[i]!.id);
      if (prev >= 0) {
        at = prev + 1;
        break;
      }
    }
    order.splice(at, 0, b.id);
  }
  return order.map((id) => {
    const block = HOME_BLOCKS[KNOWN.get(id)!]!;
    return { block, hidden: hidden.has(id) || (!named.has(id) && !!block.hiddenByDefault) };
  });
}

const layoutOf = (rows: { block: HomeBlock; hidden: boolean }[]) => ({ order: rows.map((r) => r.block.id as string), hidden: rows.filter((r) => r.hidden).map((r) => r.block.id as string) });

/**
 * Home's rows: a block on its own, or a run of paired blocks next to each other in two columns (main at the left,
 * side at the right). A run without both kinds is drawn one block per row.
 */
export function homeRows<T extends { block: HomeBlock }>(shown: readonly T[]): ({ kind: "one"; item: T } | { kind: "pair"; main: T[]; side: T[] })[] {
  const rows: ({ kind: "one"; item: T } | { kind: "pair"; main: T[]; side: T[] })[] = [];
  let run: T[] = [];
  const flush = () => {
    const main = run.filter((r) => r.block.pair === "main");
    const side = run.filter((r) => r.block.pair === "side");
    if (main.length && side.length) rows.push({ kind: "pair", main, side });
    else for (const item of run) rows.push({ kind: "one", item });
    run = [];
  };
  for (const r of shown) {
    if (r.block.pair) run.push(r);
    else {
      flush();
      rows.push({ kind: "one", item: r });
    }
  }
  flush();
  return rows;
}

/** The layout to save after moving block `id` one place earlier (-1) or later (+1) among the shown blocks. */
export function moveHomeBlock(saved: SavedHomeLayout, id: HomeBlockId, dir: -1 | 1): { order: string[]; hidden: string[] } {
  const rows = arrangeHome(saved);
  const shown = rows.filter((r) => !r.hidden).map((r) => r.block.id);
  const j = shown.indexOf(id) + dir;
  if (shown.indexOf(id) >= 0 && j >= 0 && j < shown.length) {
    const a = rows.findIndex((r) => r.block.id === id);
    const b = rows.findIndex((r) => r.block.id === shown[j]);
    [rows[a], rows[b]] = [rows[b]!, rows[a]!];
  }
  return layoutOf(rows);
}

/** The layout to save after showing or hiding block `id` (a block shown again goes to the end). */
export function setHomeBlockHidden(saved: SavedHomeLayout, id: HomeBlockId, hide: boolean): { order: string[]; hidden: string[] } {
  let rows = arrangeHome(saved).map((r) => (r.block.id === id ? { ...r, hidden: hide } : r));
  if (!hide) {
    const row = rows.find((r) => r.block.id === id)!;
    rows = [...rows.filter((r) => r.block.id !== id), row];
  }
  return layoutOf(rows);
}

/** "Good morning" / "Good afternoon" / "Good evening" for an hour of the day (0 to 23). */
export function greetingFor(hour: number): string {
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export type UpNextItem = { key: string; at: number | null; end?: number; time: string; title: string; meta: string; kind: "event" | "task"; href: string; color?: string };

/**
 * Up next: today's events that haven't ended and the open tasks due today or earlier, in time order (tasks without a
 * time after the timed ones, overdue first). `now` in ms; `time` formats a timestamp for the viewer.
 */
export function upNext(
  events: { id: string; title: string; start: number; end: number; allDay: boolean; location: string; calendarName: string; color?: string }[],
  tasks: { blockId: string; title: string; dueDate: string | null; dueTime?: string | null; documentId?: string | null; documentTitle?: string | null }[],
  today: string,
  now: number,
  time: (ms: number) => string,
): UpNextItem[] {
  const items: UpNextItem[] = [];
  for (const e of events) {
    if (e.end <= now && !e.allDay) continue;
    items.push({ key: `e:${e.id}`, at: e.allDay ? null : e.start, end: e.end, color: e.color, time: e.allDay ? "All day" : time(e.start), title: e.title || "Untitled event", meta: [e.location, e.calendarName].filter(Boolean).join(" · ") || "Event", kind: "event", href: "/calendar" });
  }
  for (const t of tasks) {
    if (!t.dueDate || t.dueDate > today) continue;
    let at: number | null = null;
    if (t.dueDate === today && t.dueTime && /^\d{2}:\d{2}$/.test(t.dueTime)) {
      const [h, m] = t.dueTime.split(":").map(Number) as [number, number];
      const d = new Date(now);
      d.setHours(h, m, 0, 0);
      at = d.getTime();
    }
    items.push({
      key: `t:${t.blockId}`,
      at,
      time: at !== null ? time(at) : t.dueDate < today ? "Overdue" : "Today",
      title: t.title || "Untitled task",
      meta: t.documentTitle ? `Task · ${t.documentTitle}` : "Task",
      kind: "task",
      href: "/tasks",
    });
  }
  const rank = (i: UpNextItem) => (i.at !== null ? 1 : i.time === "Overdue" ? 0 : i.kind === "event" ? 0.5 : 2);
  return items.sort((a, b) => rank(a) - rank(b) || (a.at ?? 0) - (b.at ?? 0));
}

/**
 * The Today card's tag on the first item still to come: "Now" while it's on, "Up next · in 25 min" (or "in 2 h",
 * "in 1 h 10 min") before it starts. Null for an item without a time.
 */
export function upNextTag(item: Pick<UpNextItem, "at" | "end">, now: number): string | null {
  if (item.at === null) return null;
  if (item.at <= now) return item.end !== undefined && item.end > now ? "Now" : null;
  const min = Math.max(1, Math.round((item.at - now) / 60_000));
  if (min < 60) return `Up next · in ${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `Up next · in ${h} h${m ? ` ${m} min` : ""}`;
}
