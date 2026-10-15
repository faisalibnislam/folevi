"use client";

import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { FunctionReturnType } from "convex/server";
import { CalendarRange, MapPin, RefreshCw, Trash2 } from "lucide-react";
import { api } from "@/lib/convex/api";
import { Button } from "@/components/ui/Button";
import { Popover } from "@/components/ui/Popover";
import { Switch } from "@/components/ui/Switch";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { formatCalendarDate } from "@/i18n";
import { formatRelative } from "@/lib/format";
import { eventSegments, minutesToTime, zonedParts, type Segment } from "./calendarLayout";

export type ExternalEvent = FunctionReturnType<typeof api.externalCalendars.events>[number];
type Subscription = FunctionReturnType<typeof api.externalCalendars.list>[number];
export type PlacedEvent = { event: ExternalEvent; segment: Segment };

const COLORS = [
  { id: "accent", label: "Cocoa" },
  { id: "moss", label: "Moss" },
  { id: "marigold", label: "Marigold" },
  { id: "plum", label: "Plum" },
  { id: "coral", label: "Coral" },
  { id: "muted", label: "Gray" },
] as const;
type Color = (typeof COLORS)[number]["id"];

/** A subscribed calendar's colour as a CSS colour. */
export function calendarColor(color: string): string {
  return `var(--color-${color === "muted" ? "ink-muted" : color})`;
}

/**
 * Events from your subscribed calendars on the days shown, placed in your time zone. Opening the Calendar
 * also tells the server it was looked at (stale calendars refresh then, and stay on the schedule).
 */
export function useExternalEvents(days: string[], timeZone: string): Map<string, PlacedEvent[]> {
  const first = days[0]!;
  const last = days[days.length - 1]!;
  // A day of margin each side: the server range is in UTC, the days are in your zone.
  const from = Date.parse(`${first}T00:00:00Z`) - 86_400_000;
  const to = Date.parse(`${last}T00:00:00Z`) + 2 * 86_400_000;
  const events = useQuery(api.externalCalendars.events, { from, to });
  const viewed = useMutation(api.externalCalendars.viewed);
  useEffect(() => {
    void viewed({}).catch(() => {});
  }, [viewed]);
  return useMemo(() => {
    const m = new Map<string, PlacedEvent[]>();
    for (const event of events ?? []) {
      for (const segment of eventSegments(event, timeZone)) {
        if (segment.date < first || segment.date > last) continue;
        const day = m.get(segment.date);
        if (day) day.push({ event, segment });
        else m.set(segment.date, [{ event, segment }]);
      }
    }
    for (const day of m.values()) day.sort((a, b) => Number(b.segment.allDay) - Number(a.segment.allDay) || a.segment.start - b.segment.start);
    return m;
  }, [events, timeZone, first, last]);
}

/** "09:00 to 10:30", "All day" or a date range, in your time zone. */
export function eventWhen(e: ExternalEvent, timeZone: string): string {
  if (e.allDay) {
    const firstDay = new Date(e.start).toISOString().slice(0, 10);
    const lastDay = new Date(Math.max(e.start, e.end - 86_400_000)).toISOString().slice(0, 10);
    const fmt = (d: string) => formatCalendarDate(d, { weekday: "short", month: "short", day: "numeric" });
    return firstDay === lastDay ? `${fmt(firstDay)}, all day` : `${fmt(firstDay)} to ${fmt(lastDay)}`;
  }
  const s = zonedParts(e.start, timeZone);
  const t = zonedParts(e.end, timeZone);
  const day = formatCalendarDate(s.date, { weekday: "short", month: "short", day: "numeric" });
  if (e.end <= e.start) return `${day}, ${minutesToTime(s.minutes)}`;
  if (t.date === s.date) return `${day}, ${minutesToTime(s.minutes)} to ${minutesToTime(t.minutes)}`;
  return `${day}, ${minutesToTime(s.minutes)} to ${formatCalendarDate(t.date, { weekday: "short", month: "short", day: "numeric" })}, ${minutesToTime(t.minutes)}`;
}

/** An event's details, read-only: title, when, where and the description as plain text (links stay text). */
export function EventPopover({ event, anchor, timeZone, onClose }: { event: ExternalEvent | null; anchor: RefObject<HTMLElement | null>; timeZone: string; onClose: () => void }) {
  return (
    <Popover open={event !== null} onClose={onClose} anchor={anchor} label={event ? event.title || "Event" : "Event"} className="w-80">
      {event ? (
        <div className="p-4 text-sm">
          <p className="flex items-center gap-2 text-xs text-muted">
            <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-chip" style={{ background: calendarColor(event.color) }} />
            {event.calendarName}
          </p>
          <h3 className="mt-1.5 text-[15px] font-semibold text-heading">{event.title || "Untitled event"}</h3>
          <p className="mt-1 text-muted">{eventWhen(event, timeZone)}</p>
          {event.location ? (
            <p className="mt-2 flex items-start gap-1.5 break-words">
              <MapPin size={14} aria-hidden className="mt-0.5 flex-none text-faint" />
              {event.location}
            </p>
          ) : null}
          {event.description ? <p className="mt-3 max-h-60 overflow-y-auto whitespace-pre-wrap break-words border-t border-line pt-3 text-[13px] text-ink">{event.description}</p> : null}
          <p className="mt-3 text-xs text-faint">From a calendar you subscribe to. Change it in the app it comes from.</p>
        </div>
      ) : null}
    </Popover>
  );
}

function ColorPicker({ value, onChange, name }: { value: Color; onChange: (c: Color) => void; name: string }) {
  return (
    <fieldset>
      <legend className="text-xs font-medium text-muted">Color</legend>
      <div className="mt-1 flex flex-wrap gap-1">
        {COLORS.map((c) => (
          <label key={c.id} className="flex cursor-pointer items-center gap-1.5 rounded-chip px-1.5 py-0.5 text-xs has-[:checked]:bg-accent-soft has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus">
            <input type="radio" name={name} value={c.id} checked={value === c.id} onChange={() => onChange(c.id)} className="sr-only" />
            <span aria-hidden className="inline-block h-3 w-3 rounded-chip" style={{ background: calendarColor(c.id) }} />
            {c.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function asColor(c: string): Color {
  return (COLORS.find((x) => x.id === c)?.id ?? "moss") as Color;
}

function SubscriptionRow({ cal }: { cal: Subscription }) {
  const update = useMutation(api.externalCalendars.update);
  const refresh = useMutation(api.externalCalendars.refresh);
  const remove = useMutation(api.externalCalendars.remove);
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [name, setName] = useState(cal.name);
  const [color, setColor] = useState<Color>(asColor(cal.color));
  const host = (() => {
    try {
      return new URL(cal.url).hostname;
    } catch {
      return cal.url;
    }
  })();
  const status = cal.loading ? "Loading…" : cal.lastFetchedAt ? `Updated ${formatRelative(cal.lastFetchedAt)}` : "";
  return (
    <li className="px-4 py-2.5" aria-label={cal.name}>
      <div className="flex items-start gap-2">
        <span aria-hidden className="mt-1.5 inline-block h-2.5 w-2.5 flex-none rounded-chip" style={{ background: calendarColor(cal.color) }} />
        <div className="min-w-0 flex-1">
          <p className={`truncate text-sm font-medium ${cal.visible ? "" : "text-muted"}`}>{cal.name}</p>
          <p className="truncate text-xs text-faint" title={host}>
            {host}
            {status ? ` · ${status}` : ""}
          </p>
        </div>
        <Switch
          checked={cal.visible}
          label={`Show ${cal.name}`}
          onChange={(visible) => void update({ calendarId: cal.id, visible }).catch((err) => toast.show(errorMessage(err), { tone: "error" }))}
        />
        <button
          type="button"
          aria-expanded={editing}
          aria-label={`Edit ${cal.name}`}
          onClick={() => {
            setEditing(!editing);
            setConfirming(false);
            setName(cal.name);
            setColor(asColor(cal.color));
          }}
          className="ui-btn ui-btn-ghost h-7 px-2 text-xs"
        >
          {editing ? "Close" : "Edit"}
        </button>
      </div>
      {cal.lastError ? (
        <p role="status" className="mt-1.5 rounded-chip bg-danger/10 px-2 py-1 text-xs text-danger">
          {cal.lastError}
        </p>
      ) : null}
      {cal.truncated ? <p className="mt-1.5 text-xs text-muted">This calendar has more events than Folevi shows; the earliest 1,500 are here.</p> : null}
      {editing ? (
        <form
          className="mt-2 space-y-2 rounded-chip ui-well p-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            update({ calendarId: cal.id, name, color }).then(
              () => setEditing(false),
              (err) => toast.show(errorMessage(err), { tone: "error" }),
            );
          }}
        >
          <label className="block text-xs font-medium text-muted">
            Name
            <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} className="ui-input mt-1 h-8 w-full rounded-chip px-2.5 text-sm text-ink" />
          </label>
          <ColorPicker value={color} onChange={setColor} name={`calendar-color-${cal.id}`} />
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <Button size="sm" type="submit" variant="primary">
              Save
            </Button>
            <Button size="sm" onClick={() => void refresh({ calendarId: cal.id }).catch((err) => toast.show(errorMessage(err), { tone: "error" }))}>
              <RefreshCw size={13} aria-hidden /> Refresh
            </Button>
            {confirming ? (
              <Button
                size="sm"
                variant="danger"
                onClick={() => void remove({ calendarId: cal.id }).catch((err) => toast.show(errorMessage(err), { tone: "error" }))}
              >
                Remove calendar
              </Button>
            ) : (
              <Button size="sm" variant="quiet" className="text-danger" onClick={() => setConfirming(true)}>
                <Trash2 size={13} aria-hidden /> Remove
              </Button>
            )}
          </div>
          {confirming ? <p className="text-xs text-muted">Its events leave your Calendar. You can add it again with its link.</p> : null}
        </form>
      ) : null}
    </li>
  );
}

function AddCalendar({ count }: { count: number }) {
  const add = useMutation(api.externalCalendars.add);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [color, setColor] = useState<Color>(COLORS[count % COLORS.length]!.id);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (count >= 20) return <p className="px-4 py-3 text-xs text-muted">You have 20 calendars, the most you can subscribe to. Remove one to add another.</p>;
  return (
    <form
      aria-label="Add calendar"
      className="space-y-2 px-4 py-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!url.trim()) return;
        setBusy(true);
        setError(null);
        try {
          await add({ url, name: name.trim() || undefined, color });
          setUrl("");
          setName("");
        } catch (err) {
          setError(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3 className="text-sm font-semibold">Add calendar</h3>
      <label className="block text-xs font-medium text-muted">
        Calendar link (ICS)
        <input
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setError(null);
          }}
          placeholder="https://… or webcal://…"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          className="ui-input mt-1 h-8 w-full rounded-chip px-2.5 text-sm text-ink"
        />
      </label>
      <label className="block text-xs font-medium text-muted">
        Name (optional)
        <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} className="ui-input mt-1 h-8 w-full rounded-chip px-2.5 text-sm text-ink" />
      </label>
      <ColorPicker value={color} onChange={setColor} name="new-calendar-color" />
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex items-center justify-between gap-2 pt-1">
        <p className="text-[11px] leading-snug text-faint">Read-only. Folevi checks it for changes about once an hour.</p>
        <Button size="sm" type="submit" variant="primary" disabled={busy || !url.trim()}>
          Add
        </Button>
      </div>
    </form>
  );
}

/** The Calendars button: your subscribed calendars (rename, colour, refresh, remove) and adding one by its link. */
export function CalendarsButton() {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const cals = useQuery(api.externalCalendars.list, {});
  const failing = (cals ?? []).some((c) => c.lastError);
  return (
    <>
      <Button ref={anchor} size="sm" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)}>
        <CalendarRange size={14} aria-hidden /> Calendars
        {failing ? (
          <>
            <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-chip bg-danger" />
            <span className="sr-only">(a calendar couldn't be loaded)</span>
          </>
        ) : null}
      </Button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} label="Calendars" align="end" className="w-[360px]">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">Calendars</h2>
          <p className="mt-0.5 text-xs text-muted">Calendars you subscribe to by link show beside your tasks. They’re read-only here. Turn one off to hide its events.</p>
        </div>
        {cals?.length ? (
          <ul className="divide-y divide-line border-b border-line" aria-label="Subscribed calendars">
            {cals.map((c) => (
              <SubscriptionRow key={c.id} cal={c} />
            ))}
          </ul>
        ) : null}
        <AddCalendar count={cals?.length ?? 0} />
      </Popover>
    </>
  );
}
