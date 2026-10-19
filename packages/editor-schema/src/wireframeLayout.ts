// Wireframe sizes and layout: how big each interface part starts, where a new part goes on a screen, and
// drafts (screens listing their parts, positions optional) turned into a laid-out wireframe. Drafts are what
// Foli AI returns and what a ```wireframe fence in Markdown holds (Foli AI chat and the MCP tools write
// notes as Markdown), so both go through `wireframeFromDraft` and then the forgiving reader.
//
//   { "screens": [{ "name": "Sign up", "frame": "phone", "parts": [
//       { "kind": "heading", "text": "Create your account" },
//       { "kind": "input", "text": "Email" },
//       { "kind": "button", "text": "Continue with Google", "variant": "secondary", "goesTo": "Home" } ] },
//     { "name": "Home", "frame": "phone", "parts": [{ "kind": "navBar", "text": "Home" }] }] }
import { clamp, isNum, isObj, oneOf } from "./blockData";
import { LIMITS } from "./generated/schema";
import {
  WIREFRAME_COMPONENTS,
  WIREFRAME_FRAMES,
  WIREFRAME_FRAME_SIZE,
  WIREFRAME_LIMITS,
  emptyWireframe,
  normalizeWireframe,
  serializeWireframe,
  type WireItem,
  type WireScreen,
  type WireframeComponent,
  type WireframeData,
  type WireframeFrame,
} from "./wireframe";

/** Room the frame keeps at the top of a screen (the phone's status bar). */
export const WIREFRAME_TOP_INSET: Record<WireframeFrame, number> = { phone: 44, tablet: 28, browser: 0, plain: 0 };
/** The side margin parts keep from the screen's edges. */
export const wireframeMargin = (screen: Pick<WireScreen, "w">) => (screen.w < 600 ? 16 : 24);
/** Space between screens laid out side by side (room for the arrows between them). */
export const WIREFRAME_SCREEN_GAP = 120;

/**
 * A part's starting size: `w` is a fixed width, or "full" (the screen's width inside its margins, at most
 * `max`), or "edge" (the whole width, margins included).
 */
const PART: Record<WireframeComponent, { w: number | "full" | "edge"; max?: number; h: number }> = {
  text: { w: "full", max: 640, h: 24 },
  heading: { w: "full", max: 640, h: 36 },
  paragraph: { w: "full", max: 640, h: 84 },
  button: { w: "full", max: 280, h: 48 },
  input: { w: "full", max: 480, h: 48 },
  search: { w: "full", max: 480, h: 44 },
  textarea: { w: "full", max: 480, h: 120 },
  checkbox: { w: 200, h: 28 },
  radio: { w: 200, h: 28 },
  toggle: { w: "full", max: 320, h: 32 },
  slider: { w: "full", max: 360, h: 28 },
  dropdown: { w: "full", max: 360, h: 48 },
  datePicker: { w: "full", max: 320, h: 48 },
  tabs: { w: "full", max: 640, h: 44 },
  navBar: { w: "edge", h: 56 },
  sidebar: { w: 240, h: 480 },
  menu: { w: 200, h: 176 },
  breadcrumbs: { w: "full", max: 480, h: 24 },
  pagination: { w: 280, h: 36 },
  card: { w: "full", max: 360, h: 220 },
  table: { w: "full", max: 960, h: 200 },
  list: { w: "full", max: 640, h: 224 },
  avatar: { w: 48, h: 48 },
  badge: { w: 72, h: 24 },
  tooltip: { w: 160, h: 40 },
  modal: { w: "full", max: 480, h: 280 },
  alert: { w: "full", max: 640, h: 56 },
  progress: { w: "full", max: 480, h: 12 },
  image: { w: "full", max: 640, h: 200 },
  icon: { w: 24, h: 24 },
  video: { w: "full", max: 640, h: 200 },
  map: { w: "full", max: 640, h: 220 },
  divider: { w: "full", h: 8 },
};

/** The size a new part of `kind` starts at on `screen`. */
export function wireframePartSize(kind: WireframeComponent, screen: Pick<WireScreen, "w" | "h">): { w: number; h: number } {
  const p = PART[kind];
  const m = wireframeMargin(screen);
  const w = p.w === "edge" ? screen.w : p.w === "full" ? Math.min(screen.w - m * 2, p.max ?? Infinity) : Math.min(p.w, screen.w - m * 2);
  const h = kind === "sidebar" ? screen.h : kind === "navBar" && screen.w >= 600 ? 64 : p.h;
  return { w: Math.max(WIREFRAME_LIMITS.minItem, Math.round(w)), h: Math.max(WIREFRAME_LIMITS.minItem, Math.min(screen.h, Math.round(h))) };
}

/** Where the next part goes on a screen: under the lowest part already there (or at the top), at the margin. */
export function wireframeNextSpot(screen: WireScreen, items: readonly WireItem[], size: { w: number; h: number }, kind?: WireframeComponent): { x: number; y: number } {
  const m = wireframeMargin(screen);
  const on = items.filter((i) => i.screen === screen.id);
  if (kind === "navBar" || kind === "sidebar") return { x: 0, y: kind === "navBar" ? WIREFRAME_TOP_INSET[screen.frame] : 0 };
  const top = WIREFRAME_TOP_INSET[screen.frame] + m;
  const bottom = on.reduce((y, i) => (i.kind === "sidebar" ? y : Math.max(y, i.y + i.h + 12)), top);
  const left = on.some((i) => i.kind === "sidebar") ? Math.min(screen.w - size.w, 240 + m) : m;
  const x = kind === "modal" ? (screen.w - size.w) / 2 : left;
  return { x: Math.round(clamp(x, 0, screen.w - size.w)), y: Math.round(clamp(kind === "modal" ? (screen.h - size.h) / 2 : bottom, 0, screen.h - size.h)) };
}

// ---------------------------------------------------------------------------------------------- drafts

const str = (v: unknown, max = 200) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "").slice(0, max);
const key = (s: string) => s.trim().toLowerCase();

/** Common names for parts (what a model or a person might write) to the library's kinds. */
const KIND_ALIASES: Record<string, WireframeComponent> = {
  label: "text",
  title: "heading",
  h1: "heading",
  h2: "heading",
  body: "paragraph",
  copy: "paragraph",
  textfield: "input",
  "text field": "input",
  field: "input",
  email: "input",
  password: "input",
  searchbox: "search",
  "search box": "search",
  select: "dropdown",
  combobox: "dropdown",
  switch: "toggle",
  range: "slider",
  date: "datePicker",
  datepicker: "datePicker",
  calendar: "datePicker",
  tabbar: "navBar",
  "tab bar": "navBar",
  navbar: "navBar",
  nav: "navBar",
  header: "navBar",
  toolbar: "navBar",
  appbar: "navBar",
  drawer: "sidebar",
  dialog: "modal",
  popup: "modal",
  banner: "alert",
  toast: "alert",
  progressbar: "progress",
  photo: "image",
  picture: "image",
  placeholder: "image",
  chip: "badge",
  tag: "badge",
  line: "divider",
  separator: "divider",
  grid: "table",
};
const KIND_BY_LOWER = new Map(WIREFRAME_COMPONENTS.map((k) => [k.toLowerCase(), k]));

/** A part kind from loose text ("Text field" → input); unknown kinds read as text. */
export function wireframeKind(v: unknown): WireframeComponent {
  if (oneOf(WIREFRAME_COMPONENTS, v)) return v;
  const k = key(str(v, 40)).replace(/[_-]+/g, " ");
  return KIND_BY_LOWER.get(k.replace(/ /g, "")) ?? KIND_ALIASES[k] ?? KIND_ALIASES[k.replace(/ /g, "")] ?? "text";
}

export interface WireframeDraftOptions {
  /** Where the first new screen goes (its top-left corner). Default 0, 0. */
  origin?: { x: number; y: number };
  /** The frame for screens that don't name one. Default phone. */
  frame?: WireframeFrame;
  /** At most this many screens and parts per screen are read (the rest are dropped). */
  maxScreens?: number;
  maxParts?: number;
}

/**
 * A wireframe from a draft: screens with their `parts` in reading order (positions and sizes optional,
 * relative to the screen), links by screen name or id (`links: [{ from, to }]`, or `goesTo` on a part or
 * a screen). Screens go side by side from `origin`; parts without a position stack top to bottom. A value
 * that's already a stored wireframe (screens and items with positions) is read as it is. The result has
 * been through the forgiving reader, so it always passes the server's check.
 */
export function wireframeFromDraft(input: unknown, opts: WireframeDraftOptions = {}): WireframeData {
  if (!isObj(input)) return emptyWireframe();
  if (Array.isArray(input.items) && Array.isArray(input.screens) && input.screens.every((s) => isObj(s) && !Array.isArray(s.parts))) return normalizeWireframe(input);
  const origin = opts.origin ?? { x: 0, y: 0 };
  const maxScreens = Math.min(opts.maxScreens ?? WIREFRAME_LIMITS.maxScreens, WIREFRAME_LIMITS.maxScreens);
  const maxParts = opts.maxParts ?? 120;
  const screensIn = (Array.isArray(input.screens) ? input.screens : isObj(input) && Array.isArray(input.parts) ? [input] : []).filter(isObj).slice(0, maxScreens);
  const screens: Record<string, unknown>[] = [];
  const items: Record<string, unknown>[] = [];
  const links: { from: string; to: string }[] = [];
  /** Screen names and ids to the screen's id in the result. */
  const screenRef = new Map<string, string>();
  const partIds = new Set<string>();
  let x = origin.x;
  screensIn.forEach((s, si) => {
    const frame: WireframeFrame = oneOf(WIREFRAME_FRAMES, s.frame) ? s.frame : (opts.frame ?? "phone");
    const size = WIREFRAME_FRAME_SIZE[frame];
    const w = Math.round(clamp(isNum(s.w) ? s.w : size.w, WIREFRAME_LIMITS.minScreen, WIREFRAME_LIMITS.maxScreen));
    const h = Math.round(clamp(isNum(s.h) ? s.h : size.h, WIREFRAME_LIMITS.minScreen, WIREFRAME_LIMITS.maxScreen));
    const id = str(s.id, 32).replace(/[^A-Za-z0-9_-]/g, "") || `s${si + 1}`;
    const sid = screenRef.has(id) ? `s${si + 1}x` : id;
    const name = str(s.name, WIREFRAME_LIMITS.maxName).replace(/\s*\n+\s*/g, " ").trim() || `Screen ${si + 1}`;
    screenRef.set(id, sid);
    if (!screenRef.has(key(name))) screenRef.set(key(name), sid);
    const screen: WireScreen = { id: sid, name, frame, x: Math.round(isNum(s.x) ? s.x : x), y: Math.round(isNum(s.y) ? s.y : origin.y), w, h };
    x = Math.max(x, screen.x + w + WIREFRAME_SCREEN_GAP);
    screens.push({ ...screen });
    if (s.goesTo !== undefined) links.push({ from: sid, to: str(s.goesTo, 80) });
    const placed: WireItem[] = [];
    for (const [pi, raw] of (Array.isArray(s.parts) ? s.parts : []).filter(isObj).slice(0, maxParts).entries()) {
      const kind = wireframeKind(raw.kind ?? raw.type);
      const base = wireframePartSize(kind, screen);
      const pw = isNum(raw.w) ? raw.w : base.w;
      const ph = isNum(raw.h) ? raw.h : base.h;
      const at = isNum(raw.x) && isNum(raw.y) ? { x: raw.x, y: raw.y } : wireframeNextSpot(screen, placed, { w: pw, h: ph }, kind);
      let pid = str(raw.id, 32).replace(/[^A-Za-z0-9_-]/g, "") || `${sid}p${pi + 1}`;
      while (partIds.has(pid) || screenRef.has(pid)) pid += "x";
      partIds.add(pid);
      const text = Array.isArray(raw.items) ? raw.items.map((v) => (Array.isArray(v) ? v.map((c) => str(c, 80)).join(" | ") : str(v, 120))).join("\n") : str(raw.text ?? raw.label, WIREFRAME_LIMITS.maxText);
      const item: Record<string, unknown> & { x: number; y: number } = { id: pid, screen: sid, kind, x: at.x, y: at.y, w: pw, h: ph, text };
      for (const k of ["variant", "checked", "value", "count", "cols"] as const) if (raw[k] !== undefined) item[k] = raw[k];
      if (typeof raw.checked === "string") item.checked = /^(true|yes|on|checked)$/i.test(raw.checked);
      if (typeof raw.variant === "string") item.variant = /secondary|outline|ghost/i.test(raw.variant) ? "secondary" : "primary";
      placed.push({ id: pid, screen: sid, kind, text, x: Math.round(clamp(item.x, 0, w)), y: Math.round(clamp(item.y, 0, h)), w: Math.round(clamp(pw, WIREFRAME_LIMITS.minItem, w)), h: Math.round(clamp(ph, WIREFRAME_LIMITS.minItem, h)) });
      items.push(item);
      if (raw.goesTo !== undefined) links.push({ from: pid, to: str(raw.goesTo, 80) });
    }
  });
  for (const l of Array.isArray(input.links) ? input.links.filter(isObj) : []) links.push({ from: str(l.from, 80), to: str(l.to, 80) });
  const resolve = (ref: string) => screenRef.get(ref) ?? screenRef.get(key(ref)) ?? (partIds.has(ref) ? ref : undefined);
  const outLinks = links
    .map((l, i) => ({ id: `l${i + 1}`, from: resolve(l.from), to: screenRef.get(l.to) ?? screenRef.get(key(l.to)) }))
    .filter((l): l is { id: string; from: string; to: string } => Boolean(l.from && l.to));
  return normalizeWireframe({ v: 1, style: input.style, screens, items, links: outLinks });
}

/**
 * A ```wireframe fence's body (JSON, a draft or a stored wireframe), or null when it holds no screens (or
 * more than a block can keep): the fence then stays a code block.
 */
export function wireframeFromFence(body: string): WireframeData | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.trim().slice(0, 200_000));
  } catch {
    return null;
  }
  const wf = wireframeFromDraft(parsed);
  return wf.screens.length && serializeWireframe(wf).length <= LIMITS.maxWireframeDataLength ? wf : null;
}

/**
 * How Foli AI chat and the MCP tools describe the fence to a model (static text, shown in their tool
 * descriptions).
 */
export const WIREFRAME_MARKDOWN_HINT =
  'To draw a wireframe (app or web screens), put a fenced block with the language "wireframe" in the Markdown, holding JSON: ' +
  '{"screens":[{"name":"Sign up","frame":"phone|tablet|browser|plain","parts":[{"kind":"heading","text":"Create your account"},{"kind":"input","text":"Email"},{"kind":"button","text":"Continue","goesTo":"Home"}]}]}. ' +
  `Part kinds: ${WIREFRAME_COMPONENTS.join(", ")}. Parts stack top to bottom unless they have x, y, w, h (pixels inside the screen; a phone is 390 by 844). ` +
  'Options: button "variant" (primary or secondary), checkbox/radio/toggle "checked", slider/progress "value" (0-100), "count" for tabs, rows and items. One label per line in "text" for tabs, menus, lists and table rows (cells split by |). "goesTo" names the screen a part or screen leads to.';
