// The bundled app shell (docs/LOCAL_MODE_PLAN.md §1 and §4.1): the static export of the product the Mac app
// carries built in (`pnpm --filter @folevi/web build:shell`), later the iPhone and iPad app too.
//
// isShell() is a build-time constant: next.config.ts sets NEXT_PUBLIC_FOLEVI_SHELL only for FOLEVI_BUILD=shell,
// so in website builds every `if (isShell())` branch is dead code and is dropped from the bundle.
import type { Backend, FoleviShell, ShellMode } from "./types";

export type * from "./types";

/** True in the shell build (and in `next dev` started with FOLEVI_BUILD=shell); false on the website. */
export function isShell(): boolean {
  return process.env.NEXT_PUBLIC_FOLEVI_SHELL === "1";
}

/**
 * The host's bridge, or null: always on the website, and in a shell build opened in a plain browser (a
 * static server in the tests, `next dev` with the flag). Callers treat null as "no native features".
 *
 * Development builds also honour `window.__foleviTestShell`, the e2e FakeShell (e2e/fixtures/localShell.ts),
 * on the dev server too; like `__foleviTestRecognizer`, production builds never read it.
 */
export function shell(): FoleviShell | null {
  if (typeof window === "undefined") return null;
  if (process.env.NODE_ENV !== "production") {
    const test = (window as { __foleviTestShell?: FoleviShell }).__foleviTestShell;
    if (test && typeof test === "object") return test;
  }
  if (!isShell()) return null;
  const bridge = window.foleviShell;
  return bridge && typeof bridge === "object" ? bridge : null;
}

const MODES: readonly ShellMode[] = ["unset", "local", "account"];

/**
 * The mode to open in, read synchronously (the host sets it before page scripts run). Without a bridge, or
 * with a value this build doesn't know, it's "account": the product as it is on the website.
 */
export function initialShellMode(): ShellMode {
  const mode = shell()?.initialMode;
  return mode && MODES.includes(mode) ? mode : "account";
}

/** Saves the person's choice with the host. Without a bridge there's nothing to save it in. */
export async function setShellMode(mode: Backend): Promise<void> {
  await shell()?.setMode(mode);
}
