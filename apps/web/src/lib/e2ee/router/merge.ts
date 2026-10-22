// Merging the server's answer with the replica's (docs/E2EE_DESIGN.md §6.4 "overlay" and "append", WP7), for
// Standard spaces with locked notes (the replica holds only those) and for searches across spaces.
//
// overlay: the server's list already names the sealed notes (placeholders, sealed fields opened by the
// decoder); what it can't know (excerpt, preview, counts) is filled in from the replica's answer to the same
// call, matched by id.
// append: the server's hits (Standard notes) plus the replica's (sealed notes), one entry per id.
import type { Merger } from "./types";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

/** The id an entry is matched by. */
function keyOf(v: unknown): string | null {
  if (!isObj(v)) return null;
  for (const k of ["id", "documentId", "blockId", "taskId"] as const) if (typeof v[k] === "string") return `${k}:${v[k]}`;
  return null;
}

/** Fields the server holds placeholders for in a sealed note. */
const DERIVED = ["title", "excerpt", "preview", "wordCount", "charCount", "blockCount", "snippet", "searchText"];

function indexDevice(value: unknown, into = new Map<string, Obj>(), depth = 0): Map<string, Obj> {
  if (depth > 6) return into;
  if (Array.isArray(value)) for (const v of value) indexDevice(v, into, depth + 1);
  else if (isObj(value)) {
    const k = keyOf(value);
    if (k) into.set(k, value);
    for (const v of Object.values(value)) if (v && typeof v === "object") indexDevice(v, into, depth + 1);
  }
  return into;
}

function fill(value: unknown, device: Map<string, Obj>, depth = 0): unknown {
  if (depth > 6) return value;
  if (Array.isArray(value)) return value.map((v) => fill(v, device, depth + 1));
  if (!isObj(value)) return value;
  const k = keyOf(value);
  const twin = k ? device.get(k) : undefined;
  const out: Obj = {};
  for (const [key, v] of Object.entries(value)) out[key] = v && typeof v === "object" ? fill(v, device, depth + 1) : v;
  if (twin) for (const f of DERIVED) if (f in twin && f in out && (out[f] === "" || out[f] === null || out[f] === 0 || out[f] === undefined)) out[f] = twin[f];
  return out;
}

export const overlay: Merger = (server, device) => {
  if (device === undefined || device === null) return server;
  return fill(server, indexDevice(device));
};

function appendArrays(a: unknown[], b: unknown[]): unknown[] {
  const seen = new Set(a.map(keyOf).filter((k): k is string => k !== null));
  const out = [...a];
  for (const v of b) {
    const k = keyOf(v);
    if (k && seen.has(k)) continue;
    if (k) seen.add(k);
    out.push(v);
  }
  return out;
}

/** The server's entries, then the replica's that the server didn't have. Counts add up. */
export const append: Merger = (server, device) => {
  if (device === undefined || device === null) return server;
  if (server === undefined || server === null) return device;
  if (Array.isArray(server) && Array.isArray(device)) return appendArrays(server, device);
  if (isObj(server) && isObj(device)) {
    const out: Obj = { ...server };
    for (const [k, d] of Object.entries(device)) {
      const s = server[k];
      if (Array.isArray(s) && Array.isArray(d)) out[k] = appendArrays(s, d);
      else if (typeof s === "number" && typeof d === "number" && k !== "now" && !/At$/.test(k)) out[k] = s + d;
      else if (isObj(s) && isObj(d)) out[k] = append(s, d, undefined as never);
      else if (s === undefined) out[k] = d;
    }
    return out;
  }
  return server;
};

/** documents.info: the counts from the replica (the server has placeholders), the activity from the server. */
export const info: Merger = (server, device) => {
  if (!isObj(device)) return server;
  if (!isObj(server)) return device;
  return { ...device, activity: server.activity ?? device.activity };
};
