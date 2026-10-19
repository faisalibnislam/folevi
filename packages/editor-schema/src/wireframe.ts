// Wireframe block data: screens with interface parts on them, and arrows between screens, stored as a JSON
// string in `props.data`.
//
//   { "v": 1, "style": "sketch",
//     "screens": [{ "id": "s1", "name": "Sign in", "frame": "phone", "x": 0, "y": 0, "w": 390, "h": 844 }],
//     "items": [{ "id": "i1", "screen": "s1", "kind": "heading", "x": 24, "y": 96, "w": 342, "h": 40, "text": "Welcome back" },
//               { "id": "i2", "screen": "s1", "kind": "button", "x": 24, "y": 700, "w": 342, "h": 48, "text": "Sign in" }],
//     "links": [{ "id": "l1", "from": "i2", "to": "s2" }] }
//
// Screens sit in an unbounded logical space (the canvas pans and zooms); an item's x/y is relative to its
// screen's top-left corner. A link starts at a screen or an item and points at a screen. On the wire
// `style` (default clean), `text` and `links` are optional. `wireframeDataIssue` is the strict check the
// server runs on every write; `parseWireframe` is the forgiving reader clients use before drawing anything.
import { LIMITS } from "./generated/schema";
import { ITEM_ID_RE, clamp, cleanItemId, cleanText, isNum, isObj, looseDataObject, oneOf, readDataObject, strayKey } from "./blockData";

export const WIREFRAME_STYLES = ["clean", "sketch"] as const;
export type WireframeStyle = (typeof WIREFRAME_STYLES)[number];
export const WIREFRAME_FRAMES = ["phone", "tablet", "browser", "plain"] as const;
export type WireframeFrame = (typeof WIREFRAME_FRAMES)[number];

/** Every interface part the component library draws. */
export const WIREFRAME_COMPONENTS = [
  "text",
  "heading",
  "paragraph",
  "button",
  "input",
  "search",
  "textarea",
  "checkbox",
  "radio",
  "toggle",
  "slider",
  "dropdown",
  "datePicker",
  "tabs",
  "navBar",
  "sidebar",
  "menu",
  "breadcrumbs",
  "pagination",
  "card",
  "table",
  "list",
  "avatar",
  "badge",
  "tooltip",
  "modal",
  "alert",
  "progress",
  "image",
  "icon",
  "video",
  "map",
  "divider",
] as const;
export type WireframeComponent = (typeof WIREFRAME_COMPONENTS)[number];

export const WIREFRAME_COMPONENT_LABEL: Record<WireframeComponent, string> = {
  text: "Text",
  heading: "Heading",
  paragraph: "Paragraph",
  button: "Button",
  input: "Input",
  search: "Search box",
  textarea: "Text area",
  checkbox: "Checkbox",
  radio: "Radio button",
  toggle: "Toggle",
  slider: "Slider",
  dropdown: "Dropdown",
  datePicker: "Date picker",
  tabs: "Tabs",
  navBar: "Navigation bar",
  sidebar: "Sidebar",
  menu: "Menu",
  breadcrumbs: "Breadcrumbs",
  pagination: "Pagination",
  card: "Card",
  table: "Table",
  list: "List",
  avatar: "Avatar",
  badge: "Badge",
  tooltip: "Tooltip",
  modal: "Modal",
  alert: "Alert",
  progress: "Progress bar",
  image: "Image",
  icon: "Icon",
  video: "Video",
  map: "Map",
  divider: "Divider",
};

export const WIREFRAME_FRAME_LABEL: Record<WireframeFrame, string> = { phone: "Phone", tablet: "Tablet", browser: "Browser", plain: "Plain" };

/** Default screen size for each frame. */
export const WIREFRAME_FRAME_SIZE: Record<WireframeFrame, { w: number; h: number }> = {
  phone: { w: 390, h: 844 },
  tablet: { w: 820, h: 1180 },
  browser: { w: 1280, h: 800 },
  plain: { w: 640, h: 480 },
};

export interface WireScreen {
  id: string;
  name: string;
  frame: WireframeFrame;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WireItem {
  id: string;
  /** The screen it's on. */
  screen: string;
  kind: WireframeComponent;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Its words; parts with several labels (tabs, menus, lists, tables) take one per line. */
  text: string;
  /** A button's look (primary when left out). */
  variant?: WireframeVariant;
  /** A checkbox, radio button or toggle that's on. */
  checked?: boolean;
  /** How far a slider or progress bar is, 0 to 100. */
  value?: number;
  /** How many tabs, rows or items (tabs, table rows, list, menu, breadcrumbs, pagination, nav bar, sidebar). */
  count?: number;
  /** A table's columns. */
  cols?: number;
}

export const WIREFRAME_VARIANTS = ["primary", "secondary"] as const;
export type WireframeVariant = (typeof WIREFRAME_VARIANTS)[number];

/** The options each part takes (anything else is refused on the server and dropped by the reader). */
export type WireframeOption = "variant" | "checked" | "value" | "count" | "cols";
export const WIREFRAME_OPTIONS: Partial<Record<WireframeComponent, readonly WireframeOption[]>> = {
  button: ["variant"],
  checkbox: ["checked"],
  radio: ["checked"],
  toggle: ["checked"],
  slider: ["value"],
  progress: ["value"],
  tabs: ["count"],
  table: ["count", "cols"],
  list: ["count"],
  menu: ["count"],
  breadcrumbs: ["count"],
  pagination: ["count"],
  navBar: ["count"],
  sidebar: ["count"],
};

/** What a part shows while an option is left out. */
export const WIREFRAME_OPTION_DEFAULTS: Partial<Record<WireframeComponent, { count?: number; cols?: number; value?: number }>> = {
  slider: { value: 50 },
  progress: { value: 60 },
  tabs: { count: 3 },
  table: { count: 4, cols: 3 },
  list: { count: 4 },
  menu: { count: 4 },
  breadcrumbs: { count: 3 },
  pagination: { count: 5 },
  navBar: { count: 3 },
  sidebar: { count: 5 },
};

export interface WireLink {
  id: string;
  /** A screen or an item. */
  from: string;
  /** A screen. */
  to: string;
}

export interface WireframeData {
  v: 1;
  style: WireframeStyle;
  screens: WireScreen[];
  items: WireItem[];
  links: WireLink[];
}

export const WIREFRAME_LIMITS = {
  maxScreens: 40,
  maxItems: 2000,
  maxLinks: 200,
  maxName: 80,
  maxText: 500,
  maxCoord: 100_000,
  minScreen: 120,
  maxScreen: 4000,
  minItem: 4,
  maxCount: 50,
  maxCols: 12,
} as const;

export const WIREFRAME_DEFAULT_HEIGHT = 520;

const SCREEN_KEYS = new Set(["id", "name", "frame", "x", "y", "w", "h"]);
const ITEM_KEYS = new Set(["id", "screen", "kind", "x", "y", "w", "h", "text", "variant", "checked", "value", "count", "cols"]);
const OPTION_KEYS: readonly WireframeOption[] = ["variant", "checked", "value", "count", "cols"];

/** Why an item's options aren't valid (an option its part doesn't take, or a value out of range), or null. */
function optionIssue(it: Record<string, unknown>, kind: WireframeComponent): string | null {
  const allowed = WIREFRAME_OPTIONS[kind] ?? [];
  const L = WIREFRAME_LIMITS;
  for (const k of OPTION_KEYS) {
    const v = it[k];
    if (v === undefined) continue;
    if (!allowed.includes(k)) return `unexpected field ${k}`;
    if (k === "variant" && !oneOf(WIREFRAME_VARIANTS, v)) return "invalid variant";
    if (k === "checked" && typeof v !== "boolean") return "invalid checked";
    if (k === "value" && (!isNum(v) || v < 0 || v > 100)) return "invalid value";
    if (k === "count" && (!Number.isInteger(v) || (v as number) < 1 || (v as number) > L.maxCount)) return "invalid count";
    if (k === "cols" && (!Number.isInteger(v) || (v as number) < 1 || (v as number) > L.maxCols)) return "invalid cols";
  }
  return null;
}

/** An item's usable options for its part (the forgiving reader's half of optionIssue). */
function cleanOptions(raw: Record<string, unknown>, kind: WireframeComponent): Pick<WireItem, WireframeOption> {
  const out: Pick<WireItem, WireframeOption> = {};
  const allowed = WIREFRAME_OPTIONS[kind] ?? [];
  const int = (v: unknown, max: number) => (isNum(v) ? Math.round(clamp(v, 1, max)) : undefined);
  for (const k of allowed) {
    const v = raw[k];
    if (k === "variant" && oneOf(WIREFRAME_VARIANTS, v)) out.variant = v;
    else if (k === "checked" && typeof v === "boolean") out.checked = v;
    else if (k === "value" && isNum(v)) out.value = Math.round(clamp(v, 0, 100));
    else if (k === "count" && int(v, WIREFRAME_LIMITS.maxCount) !== undefined) out.count = int(v, WIREFRAME_LIMITS.maxCount);
    else if (k === "cols" && int(v, WIREFRAME_LIMITS.maxCols) !== undefined) out.cols = int(v, WIREFRAME_LIMITS.maxCols);
  }
  return out;
}
const LINK_KEYS = new Set(["id", "from", "to"]);

export const emptyWireframe = (): WireframeData => ({ v: 1, style: "clean", screens: [], items: [], links: [] });

/** Why `data` isn't valid wireframe JSON, or null when it is (the server's check on every write). */
export function wireframeDataIssue(data: string): string | null {
  const { obj, issue } = readDataObject(data, LIMITS.maxWireframeDataLength, ["style", "screens", "items", "links"], "wireframe too large");
  if (issue || !obj) return issue;
  const L = WIREFRAME_LIMITS;
  if (obj.style !== undefined && !oneOf(WIREFRAME_STYLES, obj.style)) return "invalid style";
  const { screens, items, links } = obj;
  if (!Array.isArray(screens)) return "screens must be an array";
  if (!Array.isArray(items)) return "items must be an array";
  if (links !== undefined && !Array.isArray(links)) return "links must be an array";
  if (screens.length > L.maxScreens) return "too many screens";
  if (items.length > L.maxItems) return "too many items";
  if ((links?.length ?? 0) > L.maxLinks) return "too many links";
  const coord = (v: unknown) => isNum(v) && Math.abs(v) <= L.maxCoord;
  const ids = new Set<string>();
  const screenIds = new Set<string>();
  const sizes = new Map<string, { w: number; h: number }>();
  for (const [i, s] of screens.entries()) {
    if (!isObj(s)) return `screen ${i} must be an object`;
    const stray = strayKey(s, SCREEN_KEYS);
    if (stray) return `screen ${i}: unexpected field ${stray}`;
    if (typeof s.id !== "string" || !ITEM_ID_RE.test(s.id) || ids.has(s.id)) return `screen ${i}: invalid id`;
    ids.add(s.id);
    screenIds.add(s.id);
    if (typeof s.name !== "string" || s.name.length > L.maxName) return `screen ${i}: invalid name`;
    if (!oneOf(WIREFRAME_FRAMES, s.frame)) return `screen ${i}: invalid frame`;
    if (!coord(s.x) || !coord(s.y)) return `screen ${i}: invalid position`;
    for (const k of ["w", "h"] as const) if (!isNum(s[k]) || s[k] < L.minScreen || s[k] > L.maxScreen) return `screen ${i}: invalid ${k}`;
    sizes.set(s.id, { w: s.w as number, h: s.h as number });
  }
  for (const [i, it] of items.entries()) {
    if (!isObj(it)) return `item ${i} must be an object`;
    const stray = strayKey(it, ITEM_KEYS);
    if (stray) return `item ${i}: unexpected field ${stray}`;
    if (typeof it.id !== "string" || !ITEM_ID_RE.test(it.id) || ids.has(it.id)) return `item ${i}: invalid id`;
    ids.add(it.id);
    const size = typeof it.screen === "string" ? sizes.get(it.screen) : undefined;
    if (!size) return `item ${i}: unknown screen`;
    if (!oneOf(WIREFRAME_COMPONENTS, it.kind)) return `item ${i}: invalid kind`;
    if (!isNum(it.x) || !isNum(it.y) || it.x < 0 || it.y < 0 || it.x > size.w || it.y > size.h) return `item ${i}: invalid position`;
    if (!isNum(it.w) || it.w < L.minItem || it.w > size.w) return `item ${i}: invalid w`;
    if (!isNum(it.h) || it.h < L.minItem || it.h > size.h) return `item ${i}: invalid h`;
    if (it.text !== undefined && (typeof it.text !== "string" || it.text.length > L.maxText)) return `item ${i}: invalid text`;
    const opt = optionIssue(it, it.kind as WireframeComponent);
    if (opt) return `item ${i}: ${opt}`;
  }
  const linkIds = new Set<string>();
  for (const [i, l] of (links ?? []).entries()) {
    if (!isObj(l)) return `link ${i} must be an object`;
    const stray = strayKey(l, LINK_KEYS);
    if (stray) return `link ${i}: unexpected field ${stray}`;
    if (typeof l.id !== "string" || !ITEM_ID_RE.test(l.id) || linkIds.has(l.id) || ids.has(l.id)) return `link ${i}: invalid id`;
    linkIds.add(l.id);
    if (typeof l.from !== "string" || !ids.has(l.from)) return `link ${i}: unknown start`;
    if (typeof l.to !== "string" || !screenIds.has(l.to)) return `link ${i}: unknown screen`;
  }
  return null;
}

/**
 * Forgiving reader for any wireframe-shaped value (stored data, AI output, pasted JSON). Never throws:
 * unusable screens, items and links are dropped (an item whose screen is gone, a link to nowhere), unknown
 * parts read as text, sizes and positions are clamped into their screen, strings trimmed, duplicate ids
 * renamed.
 */
export function normalizeWireframe(input: unknown): WireframeData {
  const out = emptyWireframe();
  if (!isObj(input)) return out;
  const L = WIREFRAME_LIMITS;
  if (oneOf(WIREFRAME_STYLES, input.style)) out.style = input.style;
  const used = new Set<string>();
  const rename = new Map<string, string>();
  const keep = (raw: unknown, prefix: string) => {
    const original = typeof raw === "string" || typeof raw === "number" ? String(raw) : "";
    const id = cleanItemId(raw, used, prefix);
    if (original && !rename.has(original)) rename.set(original, id);
    return id;
  };
  const byId = new Map<string, WireScreen>();
  for (const raw of Array.isArray(input.screens) ? input.screens : []) {
    if (out.screens.length >= L.maxScreens) break;
    if (!isObj(raw)) continue;
    const frame: WireframeFrame = oneOf(WIREFRAME_FRAMES, raw.frame) ? raw.frame : "plain";
    const size = WIREFRAME_FRAME_SIZE[frame];
    const s: WireScreen = {
      id: keep(raw.id, "s"),
      name: cleanText(raw.name, L.maxName).replace(/\n+/g, " "),
      frame,
      // Screens without a position go in a row, left to right.
      x: Math.round(clamp(isNum(raw.x) ? raw.x : out.screens.reduce((x, o) => Math.max(x, o.x + o.w + 80), 0), -L.maxCoord, L.maxCoord)),
      y: Math.round(clamp(isNum(raw.y) ? raw.y : 0, -L.maxCoord, L.maxCoord)),
      w: Math.round(clamp(isNum(raw.w) ? raw.w : size.w, L.minScreen, L.maxScreen)),
      h: Math.round(clamp(isNum(raw.h) ? raw.h : size.h, L.minScreen, L.maxScreen)),
    };
    out.screens.push(s);
    byId.set(s.id, s);
  }
  const rawItems = (Array.isArray(input.items) ? input.items : []).filter(isObj);
  for (const raw of rawItems) {
    if (out.items.length >= L.maxItems) break;
    const screen = byId.get(rename.get(String(raw.screen ?? "")) ?? "");
    if (!screen) continue;
    const w = Math.round(clamp(isNum(raw.w) ? raw.w : 120, L.minItem, screen.w));
    const h = Math.round(clamp(isNum(raw.h) ? raw.h : 40, L.minItem, screen.h));
    const kind: WireframeComponent = oneOf(WIREFRAME_COMPONENTS, raw.kind) ? raw.kind : "text";
    out.items.push({
      id: keep(raw.id, "i"),
      screen: screen.id,
      kind,
      x: Math.round(clamp(isNum(raw.x) ? raw.x : 0, 0, screen.w - w)),
      y: Math.round(clamp(isNum(raw.y) ? raw.y : 0, 0, screen.h - h)),
      w,
      h,
      text: cleanText(raw.text, L.maxText),
      ...cleanOptions(raw, kind),
    });
  }
  const linkIds = new Set<string>();
  const known = new Set([...out.screens.map((s) => s.id), ...out.items.map((i) => i.id)]);
  const seen = new Set<string>();
  for (const raw of Array.isArray(input.links) ? input.links : []) {
    if (out.links.length >= L.maxLinks) break;
    if (!isObj(raw)) continue;
    const from = rename.get(String(raw.from ?? ""));
    const to = rename.get(String(raw.to ?? ""));
    if (!from || !to || !known.has(from) || !byId.has(to) || from === to || seen.has(`${from}>${to}`)) continue;
    seen.add(`${from}>${to}`);
    let id = cleanItemId(raw.id, linkIds, "l");
    while (used.has(id)) id = cleanItemId(undefined, linkIds, "l");
    out.links.push({ id, from, to });
  }
  return out;
}

/** Reads stored wireframe data; anything unusable reads as an empty wireframe (never throws). */
export function parseWireframe(data: string | null | undefined): WireframeData {
  return normalizeWireframe(looseDataObject(data, LIMITS.maxWireframeDataLength));
}

/** Compact wire JSON (defaults omitted). A wireframe with no screens serialises to "". */
export function serializeWireframe(wf: WireframeData): string {
  if (!wf.screens.length) return "";
  const o: Record<string, unknown> = { v: 1 };
  if (wf.style !== "clean") o.style = wf.style;
  o.screens = wf.screens.map((s) => ({ id: s.id, name: s.name, frame: s.frame, x: Math.round(s.x), y: Math.round(s.y), w: Math.round(s.w), h: Math.round(s.h) }));
  o.items = wf.items.map((i) => {
    const x: Record<string, unknown> = { id: i.id, screen: i.screen, kind: i.kind, x: Math.round(i.x), y: Math.round(i.y), w: Math.round(i.w), h: Math.round(i.h) };
    if (i.text) x.text = i.text;
    const allowed = WIREFRAME_OPTIONS[i.kind] ?? [];
    if (allowed.includes("variant") && i.variant === "secondary") x.variant = i.variant;
    if (allowed.includes("checked") && i.checked) x.checked = true;
    for (const k of ["value", "count", "cols"] as const) if (allowed.includes(k) && isNum(i[k])) x[k] = Math.round(i[k]);
    return x;
  });
  if (wf.links.length) o.links = wf.links.map((l) => ({ id: l.id, from: l.from, to: l.to }));
  return JSON.stringify(o);
}

/** Each screen's items, top to bottom then left to right (reading order). */
export function wireframeScreenItems(wf: WireframeData): Map<string, WireItem[]> {
  const out = new Map<string, WireItem[]>(wf.screens.map((s) => [s.id, []]));
  for (const it of wf.items) out.get(it.screen)?.push(it);
  for (const list of out.values()) list.sort((a, b) => a.y - b.y || a.x - b.x);
  return out;
}

/** All of the wireframe's words, for search. */
export const wireframeText = (wf: WireframeData): string =>
  [...wf.screens.map((s) => s.name), ...wf.items.map((i) => i.text)]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" ");

const oneLine = (s: string) => s.replace(/\s*\n+\s*/g, " ").trim();

/** Each screen with its parts as readable lines ("Button: Sign in, goes to Home"), for the text exports. */
function wireframeOutline(wf: WireframeData): { title: string; lines: string[] }[] {
  const items = wireframeScreenItems(wf);
  const name = new Map(wf.screens.map((s) => [s.id, oneLine(s.name) || "Untitled screen"]));
  const goes = (from: string) =>
    wf.links
      .filter((l) => l.from === from)
      .map((l) => name.get(l.to))
      .filter(Boolean)
      .join(" and ");
  return wf.screens.map((s) => {
    const lines = (items.get(s.id) ?? []).map((it) => {
      const text = it.text.split("\n").map((l) => l.trim()).filter(Boolean).join(", ");
      const to = goes(it.id);
      const state = it.checked ? " (on)" : it.variant === "secondary" ? " (secondary)" : "";
      return `${WIREFRAME_COMPONENT_LABEL[it.kind]}${text ? `: ${text}` : ""}${state}${to ? `, goes to ${to}` : ""}`;
    });
    const to = goes(s.id);
    if (to) lines.push(`Goes to ${to}`);
    return { title: `${name.get(s.id)} (${WIREFRAME_FRAME_LABEL[s.frame]})`, lines };
  });
}

/**
 * Markdown for exports: each screen's name in bold over a bulleted list of its parts, top to bottom. `esc`
 * escapes Markdown; `indent` is the block's own nesting.
 */
export function wireframeToMarkdown(wf: WireframeData, esc: (s: string) => string, indent = ""): string[] {
  const lines: string[] = [];
  for (const screen of wireframeOutline(wf)) {
    lines.push(`${indent}**${esc(screen.title)}**`, "");
    for (const l of screen.lines) lines.push(`${indent}- ${esc(l)}`);
    if (screen.lines.length) lines.push("");
  }
  return lines;
}

/** HTML for exports: the same screens and lists. */
export function wireframeToHtml(wf: WireframeData, esc: (s: string) => string): string {
  const parts = wireframeOutline(wf).map((s) => `<p><strong>${esc(s.title)}</strong></p>${s.lines.length ? `<ul>${s.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : ""}`);
  return parts.length ? `<figure class="wireframe">${parts.join("")}</figure>` : "";
}
