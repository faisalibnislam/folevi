// The Calendar screen's "…" menu, apart from the phone's agenda (./Agenda.tsx) so the Calendar view's wider layouts
// build it without loading the phone interface (./phone.ts).
import { CalendarDays, CalendarRange, Rows3, Rss } from "lucide-react";
import type { MenuEntry } from "@/components/ui/Menu";

export type Layout = "month" | "week" | "agenda";

/** The Calendar screen's "…" menu: the layouts, then (as the web's and the Mac's buttons) Subscribe, your tasks in
 *  another calendar app, and Calendars, other calendars by their link. */
export function calendarMenu(mode: Layout, pick: (l: Layout) => void, subscribe: (() => void) | null, calendars: (() => void) | null = null): MenuEntry[] {
  return [
    { heading: "Show" },
    { label: "Agenda", icon: <Rows3 size={18} />, checked: mode === "agenda", onSelect: () => pick("agenda") },
    { label: "Week", icon: <CalendarRange size={18} />, checked: mode === "week", onSelect: () => pick("week") },
    { label: "Month", icon: <CalendarDays size={18} />, checked: mode === "month", onSelect: () => pick("month") },
    ...(subscribe || calendars ? (["separator"] satisfies MenuEntry[]) : []),
    ...(subscribe ? ([{ label: "Subscribe", icon: <Rss size={18} />, onSelect: subscribe }] satisfies MenuEntry[]) : []),
    ...(calendars ? ([{ label: "Calendars", icon: <CalendarRange size={18} />, onSelect: calendars }] satisfies MenuEntry[]) : []),
  ];
}

