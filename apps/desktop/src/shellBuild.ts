// What the interface built into the app is (apps/web/scripts/build-shell.mjs writes shell/build.json into the
// export): which deployment and website it talks to, whether it's the production build, the app version it was
// built for, and the IndexedDB schema version it opens. main.ts reads it at startup: the handoff refuses a
// website database newer than `dbVersion` (handoff.ts), and a mismatch with the app is logged.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface ShellBuild {
  v: 1;
  target: "production" | "development";
  convexUrl: string | null;
  siteUrl: string;
  /** apps/web/src/lib/sync/db.ts DB_VERSION when the export was built. */
  dbVersion: number;
  /** apps/desktop/package.json's version when the export was built. */
  appVersion: string;
  builtAt: string;
}

export const SHELL_BUILD_FILE = "shell/build.json";

export function parseShellBuild(raw: string | null): ShellBuild | null {
  if (!raw) return null;
  try {
    const b = JSON.parse(raw) as Partial<ShellBuild>;
    if (b.v !== 1 || (b.target !== "production" && b.target !== "development")) return null;
    if (typeof b.dbVersion !== "number" || !Number.isInteger(b.dbVersion) || b.dbVersion < 1) return null;
    if (typeof b.siteUrl !== "string" || typeof b.appVersion !== "string") return null;
    return { v: 1, target: b.target, convexUrl: typeof b.convexUrl === "string" ? b.convexUrl : null, siteUrl: b.siteUrl, dbVersion: b.dbVersion, appVersion: b.appVersion, builtAt: String(b.builtAt ?? "") };
  } catch {
    return null;
  }
}

/** The build info of the export at `root` (Contents/Resources/web, or the development folder), or null. */
export function readShellBuild(root: string): ShellBuild | null {
  try {
    return parseShellBuild(readFileSync(join(root, SHELL_BUILD_FILE), "utf8"));
  } catch {
    return null;
  }
}

const origin = (u: string) => {
  try {
    return new URL(u).origin;
  } catch {
    return null;
  }
};

/**
 * What's wrong between the app and the interface it carries, in words for the log. A packaged app must carry a
 * production export for its own website; the export should have been built for this app version.
 */
export function shellBuildProblems(build: ShellBuild | null, app: { version: string; packaged: boolean; serviceUrl: string }): string[] {
  if (!build) return ["the bundled interface has no shell/build.json (build it with `pnpm shell`)"];
  const problems: string[] = [];
  if (app.packaged && build.target !== "production") problems.push(`the bundled interface is a ${build.target} build (${build.convexUrl ?? "no deployment"}), not production`);
  if (origin(build.siteUrl) !== origin(app.serviceUrl)) problems.push(`the bundled interface signs in at ${build.siteUrl}, the app at ${app.serviceUrl}`);
  if (app.packaged && build.appVersion !== app.version) problems.push(`the bundled interface was built for ${build.appVersion}, this app is ${app.version}`);
  return problems;
}
