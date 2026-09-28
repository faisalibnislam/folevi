// Markdown import bundles: loose files, a folder, or a ZIP. Markdown files are imported as documents;
// the images they reference by relative path (e.g. `![](assets/photo.png)`) are uploaded first and
// passed to the server as an image map, so they arrive as real image blocks instead of dead links.
import { unzipSync } from "fflate";

export interface BundleEntry {
  /** Path inside the bundle, "/"-separated, no leading "./" (just the file name for loose files). */
  path: string;
  blob: Blob;
}

export const TEXT_EXT = /\.(md|markdown|txt|text)$/i;
const IMAGE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

export function imageMime(path: string): string | null {
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
  return ext ? (IMAGE_TYPES[ext] ?? null) : null;
}

/** Collapses "." and ".." segments; returns null when the path escapes the bundle root. */
export function normalizePath(path: string): string | null {
  const out: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!out.length) return null;
      out.pop();
    } else out.push(part);
  }
  return out.join("/");
}

export function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

/** Every image source written in a Markdown text, exactly as written (the server looks them up verbatim). */
export function imageSources(markdown: string): string[] {
  const out = new Set<string>();
  const re = /!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
  for (let m = re.exec(markdown); m; m = re.exec(markdown)) out.add(m[1]!);
  return [...out];
}

/**
 * Finds the bundle entry an image source in `fromPath` points to: relative to the Markdown file first,
 * then from the bundle root, then (if unambiguous) by file name alone.
 */
export function resolveImage(entries: Map<string, BundleEntry>, fromPath: string, src: string): BundleEntry | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith("//") || src.startsWith("#")) return null;
  let decoded = src;
  try {
    decoded = decodeURIComponent(src);
  } catch {
    /* keep as written */
  }
  const candidates = [normalizePath(`${dirname(fromPath)}/${decoded}`), normalizePath(decoded)];
  for (const c of candidates) {
    if (c === null) continue;
    const hit = entries.get(c) ?? entries.get(c.toLowerCase());
    if (hit) return hit;
  }
  const base = (decoded.split("/").pop() ?? "").toLowerCase();
  if (!base) return null;
  const byName = [...entries.values()].filter((e) => (e.path.split("/").pop() ?? "").toLowerCase() === base);
  return byName.length === 1 ? byName[0]! : null;
}

/** Unpacks a ZIP into entries (skipping folders and macOS metadata). */
export function entriesFromZip(bytes: Uint8Array): BundleEntry[] {
  const files = unzipSync(bytes, { filter: (f) => !f.name.endsWith("/") && !f.name.startsWith("__MACOSX/") && !/(^|\/)\.DS_Store$/.test(f.name) });
  return Object.entries(files).map(([path, data]) => ({ path: normalizePath(path) ?? path, blob: new Blob([data as Uint8Array<ArrayBuffer>], { type: imageMime(path) ?? "application/octet-stream" }) }));
}

/** Loose files or a picked folder (files carry webkitRelativePath) → entries; ZIPs are expanded. */
export async function entriesFromFiles(files: File[]): Promise<{ entries: BundleEntry[]; errors: { name: string; message: string }[] }> {
  const entries: BundleEntry[] = [];
  const errors: { name: string; message: string }[] = [];
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) {
      if (f.size > 300 * 1024 * 1024) {
        errors.push({ name: f.name, message: "ZIP files can be up to 300 MB." });
        continue;
      }
      try {
        const prefix = f.name.replace(/\.zip$/i, "");
        for (const e of entriesFromZip(new Uint8Array(await f.arrayBuffer()))) entries.push({ path: `${prefix}/${e.path}`, blob: e.blob });
      } catch {
        errors.push({ name: f.name, message: "This ZIP file couldn’t be opened." });
      }
      continue;
    }
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath;
    entries.push({ path: normalizePath(rel || f.name) ?? f.name, blob: f });
  }
  return { entries, errors };
}

export function entryMap(entries: BundleEntry[]): Map<string, BundleEntry> {
  const map = new Map<string, BundleEntry>();
  for (const e of entries) {
    map.set(e.path, e);
    if (!map.has(e.path.toLowerCase())) map.set(e.path.toLowerCase(), e);
  }
  return map;
}
