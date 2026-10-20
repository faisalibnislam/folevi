// Version vectors (LOCAL_MODE_PLAN.md §3.2): `{ deviceId: hlc }`, the newest stamp of each device a state
// incorporates. They tell "edited after seeing it" apart from "edited concurrently".
import { isDeviceId, isHlc } from "./hlc";

export type VersionVector = Record<string, string>;

/** `after`: a strictly dominates b; `before`: b strictly dominates a. */
export type VvOrder = "equal" | "before" | "after" | "concurrent";

export function compareVv(a: VersionVector | undefined, b: VersionVector | undefined): VvOrder {
  const x = a ?? {};
  const y = b ?? {};
  let aAhead = false;
  let bAhead = false;
  for (const key of new Set([...Object.keys(x), ...Object.keys(y)])) {
    const av = x[key] ?? "";
    const bv = y[key] ?? "";
    if (av > bv) aAhead = true;
    else if (bv > av) bAhead = true;
    if (aAhead && bAhead) return "concurrent";
  }
  return aAhead ? "after" : bAhead ? "before" : "equal";
}

/** a ≥ b pointwise. */
export function dominates(a: VersionVector | undefined, b: VersionVector | undefined): boolean {
  const order = compareVv(a, b);
  return order === "after" || order === "equal";
}

/** Pointwise max. */
export function mergeVv(a: VersionVector | undefined, b: VersionVector | undefined): VersionVector {
  const out: VersionVector = { ...(a ?? {}) };
  for (const [key, value] of Object.entries(b ?? {}))
    if (value > (out[key] ?? "")) out[key] = value;
  return sortedVv(out);
}

/** The vector with `deviceId` advanced to `hlc` (never moved backwards). */
export function bumpVv(v: VersionVector | undefined, deviceId: string, hlc: string): VersionVector {
  const out: VersionVector = { ...(v ?? {}) };
  if (hlc > (out[deviceId] ?? "")) out[deviceId] = hlc;
  return sortedVv(out);
}

/** True when every entry of `v` is at or below `seen` (a clock is "covered" by what a file has incorporated). */
export function coveredBy(v: VersionVector | undefined, seen: VersionVector | undefined): boolean {
  return dominates(seen, v);
}

export function isVersionVector(value: unknown): value is VersionVector {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  for (const [k, v] of Object.entries(value)) if (!isDeviceId(k) || !isHlc(v)) return false;
  return true;
}

function sortedVv(v: VersionVector): VersionVector {
  const out: VersionVector = {};
  for (const key of Object.keys(v).sort()) out[key] = v[key]!;
  return out;
}
