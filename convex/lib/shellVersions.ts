// The oldest app versions whose built-in interface still works with this backend (docs/LOCAL_MODE_PLAN.md
// §5.3, risk R1). The Mac app (and later the iPhone and iPad app) carries its interface built in, so it keeps
// calling the functions it shipped with until the person updates. A breaking change to one of those
// functions (tests/contract/api-snapshot.test.ts says which) raises the floor here, in the same change; an
// operator can raise it further without a deploy (systemSettings "min_shell_version", settings.ts).
// Shared with the web app, so it has no imports.

export type ShellPlatformName = "mac" | "ios";

/** The floor set in code. null: every version works. */
export const MIN_SHELL_VERSIONS: Record<ShellPlatformName, string | null> = { mac: null, ios: null };

const VERSION_RE = /^\d{1,6}(\.\d{1,6}){0,3}$/;

/** Whether `v` is a plain dotted version ("1.16.0"). */
export function isShellVersion(v: unknown): v is string {
  return typeof v === "string" && VERSION_RE.test(v);
}

/** Negative when a is older than b, 0 when the same, positive when newer. Missing parts count as 0. */
export function compareShellVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** The newer of two floors (either may be absent or malformed, which counts as no floor). */
export function newerFloor(a: string | null | undefined, b: string | null | undefined): string | null {
  const x = isShellVersion(a) ? a : null;
  const y = isShellVersion(b) ? b : null;
  if (!x) return y;
  if (!y) return x;
  return compareShellVersions(x, y) >= 0 ? x : y;
}

/** Whether an app at `version` is older than the floor and must update before it syncs again. */
export function shellNeedsUpdate(version: string | null | undefined, floor: string | null | undefined): boolean {
  if (!isShellVersion(floor)) return false;
  // An app that can't say its version is treated as current: the floor is for known old builds.
  if (!isShellVersion(version)) return false;
  return compareShellVersions(version, floor) < 0;
}
