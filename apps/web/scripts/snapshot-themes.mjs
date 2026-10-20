#!/usr/bin/env node
// Snapshots what admins manage on the server into the bundled app shell (docs/LOCAL_MODE_PLAN.md §1, "Built-in
// templates and admin themes"), so the Mac app has it with no server: in local mode, and before the first answer
// in account mode. Run by scripts/build-shell.mjs after `next build`; on its own:
//   node scripts/snapshot-themes.mjs <out-shell dir> [--required]
//
// Writes, inside the export:
//   shell/snapshot.json        { version, builtAt, source, themes: ThemeRow[], templates: { disabled: string[] } }
//   shell/themes/<key>-<size>  each admin-uploaded theme image (full, half, thumb), so nothing is fetched from
//                              Convex storage at run time; the rows point at these files instead.
// The shipped themes' own art is public/covers and is already in the export. The built-in templates' content
// ships as code (BUILT_IN_TEMPLATES in @folevi/editor-schema); only which ones admins switched off is data.
//
// The deployment is NEXT_PUBLIC_CONVEX_URL, the same one the build bakes in. Both queries are public (no auth).
// Without --required, a deployment that can't be reached gives an empty snapshot and a warning, so a build
// works offline; release builds pass --required.
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Buffer } from "node:buffer";
import { URL, fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";

export const SNAPSHOT_VERSION = 1;

const EXT = { "image/webp": "webp", "image/avif": "avif", "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/svg+xml": "svg" };

/** Downloads one image into shell/themes and answers its path in the shell, or null if it can't be had. */
async function localImage(url, dir, name) {
  if (!url) return null;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} for ${name}`);
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  const ext = EXT[type];
  if (!ext) throw new Error(`unexpected type ${type || "(none)"} for ${name}`);
  const file = `${name}.${ext}`;
  await writeFile(join(dir, file), Buffer.from(await res.arrayBuffer()));
  return `/shell/themes/${file}`;
}

/**
 * @param {{ outDir: string, convexUrl?: string, required?: boolean, log?: (line: string) => void }} o
 * @returns {Promise<{ themes: number, images: number, disabledTemplates: number, source: string | null }>}
 */
export async function snapshotThemes({ outDir, convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL, required = false, log = console.log }) {
  const shellDir = join(resolve(outDir), "shell");
  const imageDir = join(shellDir, "themes");
  await rm(shellDir, { recursive: true, force: true });
  await mkdir(imageDir, { recursive: true });

  let rows;
  let disabled;
  let source = null;
  try {
    if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL isn't set");
    const client = new ConvexHttpClient(convexUrl);
    [rows, disabled] = await Promise.all([client.query(anyApi.themes.list, {}), client.query(anyApi.settings.disabledBuiltInTemplates, {})]);
    source = new URL(convexUrl).host;
  } catch (e) {
    if (required) throw new Error(`snapshot-themes: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
    log(`snapshot-themes: warning: no snapshot (${e instanceof Error ? e.message : String(e)}); the shell ships the built-in themes only`);
    rows = [];
    disabled = [];
  }

  let images = 0;
  const themes = [];
  for (const row of rows) {
    if (!row.image) {
      themes.push(row);
      continue;
    }
    const key = String(row.key).replace(/[^a-zA-Z0-9_-]/g, "_");
    try {
      const [full, half, thumb] = await Promise.all(["full", "half", "thumb"].map((size) => localImage(row.image[size], imageDir, `${key}-${size}`)));
      images += [full, half, thumb].filter(Boolean).length;
      themes.push({ ...row, image: { ...row.image, full, half, thumb } });
    } catch (e) {
      if (required) throw new Error(`snapshot-themes: theme ${row.key}: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
      log(`snapshot-themes: warning: theme ${row.key} ships without its image (${e instanceof Error ? e.message : String(e)})`);
      // lib/themes.ts treats a row without all three images as "no uploaded image" (the built-in art, if any).
      themes.push({ ...row, image: null });
    }
  }

  const snapshot = { version: SNAPSHOT_VERSION, builtAt: Date.now(), source, themes, templates: { disabled: [...disabled].sort() } };
  await writeFile(join(shellDir, "snapshot.json"), JSON.stringify(snapshot));
  return { themes: themes.length, images, disabledTemplates: disabled.length, source };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const outDir = process.argv[2];
  if (!outDir) {
    console.error("usage: node scripts/snapshot-themes.mjs <out-shell dir> [--required]");
    process.exit(2);
  }
  const result = await snapshotThemes({ outDir, required: process.argv.includes("--required") });
  console.log(`snapshot-themes: ${result.themes} theme rows, ${result.images} images, ${result.disabledTemplates} templates switched off (${result.source ?? "no deployment"})`);
}
