// The flowchart's icon set: simple line icons on a 24 × 24 grid (stroke 2, round caps and joins, no fill),
// drawn inside or beside a shape. Kept here as path data so exports and share pages draw the same icons
// as the editor without an icon library.

export interface FlowIconDef {
  label: string;
  /** Path data on a 24 × 24 grid, stroked. */
  d: string;
}

export const FLOWCHART_ICON_DEFS = {
  user: { label: "Person", d: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6" },
  users: { label: "People", d: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z M2.5 20c1.2-3.6 3.6-5.5 6.5-5.5s5.3 1.9 6.5 5.5 M16 4.3a3.5 3.5 0 0 1 0 6.4 M18 14.8c1.7.7 2.9 2.4 3.5 5.2" },
  mail: { label: "Email", d: "M3 6h18v12H3Z M3 7l9 6 9-6" },
  phone: { label: "Phone", d: "M7 3h10v18H7Z M11 18h2" },
  chat: { label: "Message", d: "M4 5h16v11H9l-5 4Z" },
  database: { label: "Database", d: "M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3Z M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6 M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" },
  server: { label: "Server", d: "M4 4h16v6H4Z M4 14h16v6H4Z M8 7h.01 M8 17h.01" },
  cloud: { label: "Cloud", d: "M7 18h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.5 1.5A3.5 3.5 0 0 0 7 18Z" },
  globe: { label: "Web", d: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M3 12h18 M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9Z" },
  file: { label: "File", d: "M6 3h8l4 4v14H6Z M14 3v4h4" },
  folder: { label: "Folder", d: "M3 6h6l2 2h10v11H3Z" },
  check: { label: "Done", d: "M5 12.5l4.5 4.5L19 7" },
  x: { label: "Cancel", d: "M6 6l12 12 M18 6L6 18" },
  alert: { label: "Warning", d: "M12 4l9 16H3Z M12 10v4 M12 17h.01" },
  info: { label: "Info", d: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M12 11v6 M12 7.5h.01" },
  question: { label: "Question", d: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7 M12 17h.01" },
  clock: { label: "Time", d: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M12 7v5l3 2" },
  calendar: { label: "Date", d: "M4 5h16v15H4Z M4 10h16 M8 3v4 M16 3v4" },
  gear: { label: "Settings", d: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z M12 2v3 M12 19v3 M2 12h3 M19 12h3 M4.9 4.9 7 7 M17 17l2.1 2.1 M4.9 19.1 7 17 M17 7l2.1-2.1" },
  lock: { label: "Secure", d: "M6 11h12v9H6Z M8 11V8a4 4 0 0 1 8 0v3" },
  key: { label: "Key", d: "M8 11a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z M10.8 12.2 20 3 M16 7l2 2 M18.5 4.5l2 2" },
  star: { label: "Star", d: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z" },
  heart: { label: "Heart", d: "M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" },
  flag: { label: "Milestone", d: "M5 21V4 M5 4h11l-2 4 2 4H5" },
  home: { label: "Home", d: "M4 11l8-7 8 7 M6 9.5V20h12V9.5 M10 20v-6h4v6" },
  search: { label: "Search", d: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z M16 16l4.5 4.5" },
  bell: { label: "Notification", d: "M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15Z M10 20a2 2 0 0 0 4 0" },
  cart: { label: "Cart", d: "M3 4h2l2.4 11h10.6l2-8H6.2 M9 20h.01 M17 20h.01" },
  card: { label: "Payment", d: "M3 6h18v12H3Z M3 10h18 M7 15h3" },
  money: { label: "Money", d: "M12 3v18 M16 7.5C16 6.1 14.2 5 12 5S8 6.1 8 7.5 9.8 10 12 10.5s4 1.6 4 3-1.8 2.5-4 2.5-4-1.1-4-2.5" },
  chart: { label: "Chart", d: "M4 20V4 M4 20h16 M8 16v-5 M12 16V8 M16 16v-3" },
  code: { label: "Code", d: "M8 8l-4 4 4 4 M16 8l4 4-4 4 M13.5 6l-3 12" },
  link: { label: "Link", d: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" },
  bulb: { label: "Idea", d: "M9 18h6 M10 21h4 M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3Z" },
  play: { label: "Start", d: "M8 5v14l11-7Z" },
  stop: { label: "Stop", d: "M6 6h12v12H6Z" },
  refresh: { label: "Repeat", d: "M20 11a8 8 0 0 0-14.5-4.5L4 8 M4 4v4h4 M4 13a8 8 0 0 0 14.5 4.5L20 16 M20 20v-4h-4" },
  upload: { label: "Upload", d: "M12 16V4 M7 9l5-5 5 5 M4 20h16" },
  download: { label: "Download", d: "M12 4v12 M7 11l5 5 5-5 M4 20h16" },
  sparkles: { label: "Sparkle", d: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z M19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7Z" },
  target: { label: "Goal", d: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z M12 12h.01" },
} as const satisfies Record<string, FlowIconDef>;

export type FlowIconName = keyof typeof FLOWCHART_ICON_DEFS;
export const FLOWCHART_ICONS = Object.keys(FLOWCHART_ICON_DEFS) as FlowIconName[];

/** Icons matching a search (label or name), in set order. */
export function searchFlowIcons(query: string): FlowIconName[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...FLOWCHART_ICONS];
  return FLOWCHART_ICONS.filter((n) => n.toLowerCase().includes(q) || FLOWCHART_ICON_DEFS[n].label.toLowerCase().includes(q));
}
