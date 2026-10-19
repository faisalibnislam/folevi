// Small helpers shared by the visual blocks whose content is a JSON string in `props.data` (mind map,
// sticky notes, chart, wireframe). Not exported from the package: each block's own module exports what
// clients need.

export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
export const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
export const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);
export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Ids of the items inside one block (not block ids): short, url-safe, unique within the block. */
export const ITEM_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

/** Control characters (other than new lines) never reach a canvas or an export. */
export const cleanText = (s: unknown, max: number): string =>
  typeof s === "string"
    ? s
        .replace(/\r\n?/g, "\n")
        .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, "")
        .slice(0, max)
    : "";

/** A short random id for a new item inside a block (prefix plus 7 letters or digits). */
export function itemId(prefix = "n"): string {
  let s = prefix;
  for (let i = 0; i < 7; i++) s += "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)];
  return s;
}

/** An item's id made usable: cleaned, and renamed when it's missing or already taken. */
export function cleanItemId(v: unknown, used: Set<string>, prefix: string): string {
  let id = typeof v === "string" || typeof v === "number" ? String(v).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) : "";
  while (!id || used.has(id)) id = itemId(prefix);
  used.add(id);
  return id;
}

/**
 * The first checks every data string gets: its size, then that it's a JSON object with only the given
 * top-level keys and version 1. Returns the object, or the reason it isn't usable. "" is an empty block.
 */
export function readDataObject(data: string, maxLength: number, keys: readonly string[], tooLarge: string): { obj: Record<string, unknown> | null; issue: string | null } {
  if (data.length > maxLength) return { obj: null, issue: tooLarge };
  if (data === "") return { obj: null, issue: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return { obj: null, issue: "expected JSON" };
  }
  if (!isObj(parsed)) return { obj: null, issue: "expected an object" };
  for (const k of Object.keys(parsed)) if (k !== "v" && !keys.includes(k)) return { obj: null, issue: `unexpected field ${k}` };
  if (parsed.v !== undefined && parsed.v !== 1) return { obj: null, issue: "unsupported version" };
  return { obj: parsed, issue: null };
}

/** Parses stored data for a forgiving reader: the object, or null when it's empty or not JSON. */
export function looseDataObject(data: string | null | undefined, maxLength: number): Record<string, unknown> | null {
  if (!data || data.length > maxLength) return null;
  try {
    const v = JSON.parse(data) as unknown;
    return isObj(v) ? v : null;
  } catch {
    return null;
  }
}

/** Whether an object has only the allowed keys; the first stray one otherwise. */
export function strayKey(o: Record<string, unknown>, allowed: ReadonlySet<string>): string | null {
  for (const k of Object.keys(o)) if (!allowed.has(k)) return k;
  return null;
}
