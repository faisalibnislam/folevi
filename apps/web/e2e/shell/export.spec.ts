// The bundled shell's static export (scripts/build-shell.mjs, docs/LOCAL_MODE_PLAN.md §1 WP1): what's in it and,
// more to the point, what isn't. Reads out-shell/ from disk; no browser.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const WEB = fileURLToPath(new URL("../../", import.meta.url));
const OUT = join(WEB, "out-shell");
const SRC = join(WEB, "src");

/** Every file under `dir`, leaving out installed packages' folders inside it. */
function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules") return [];
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const rel = (p: string) => relative(OUT, p).split("\\").join("/");

test.beforeAll(() => {
  if (!existsSync(join(OUT, "index.html"))) throw new Error("No out-shell/: run `node scripts/build-shell.mjs --no-copy` first (pnpm test:shell does both).");
});

test("the export is one page: index.html plus Next's not-found page, with no route-handler output", () => {
  const files = walk(OUT).map(rel);
  const pages = files.filter((f) => f.endsWith(".html"));
  expect(pages.sort()).toEqual(["404.html", "_not-found.html", "index.html"]);
  // Route handlers (/api/*, sitemap.xml, robots.txt, manifest.webmanifest, opengraph images) and server pages
  // (auth, share links, /s/[token], the session-checking catch-all) would show up as files or folders here.
  const top = new Set(readdirSync(OUT));
  for (const name of ["api", "admin", "s", "signin", "signup", "share", "share-target", "d", "documents", "mcp", "dev", "signout", "manifest.webmanifest", "sitemap.xml", "robots.txt", "opengraph-image", "opengraph-image.png"]) {
    expect(top.has(name), `${name} in the export`).toBe(false);
  }
  // Everything else at the top is Next's own output, public/ files the product uses, and the snapshot.
  const expected = new Set(["_next", "_not-found", "404.html", "_not-found.html", "_not-found.txt", "index.html", "index.txt", "brand", "covers", "shell"]);
  for (const name of top) expect(expected.has(name) || /^__next\..+\.txt$/.test(name), `unexpected ${name} in the export`).toBe(true);
});

test("nothing only the website uses: no marketing art, service worker, verification file or PWA icons", () => {
  const files = walk(OUT).map(rel);
  expect(files.filter((f) => /^(marketing\/|icons\/|brand\/email\/)|^sw\.js$|^google[0-9a-f]+\.html$|^favicon|^apple-icon|^icon\.svg$/.test(f))).toEqual([]);
  // What the product draws from public/ is there: every note cover in its three sizes, and the brand marks.
  const covers = readdirSync(join(WEB, "public/covers"));
  expect(readdirSync(join(OUT, "covers")).sort()).toEqual(covers.sort());
  for (const f of ["brand/folevi-mark.svg", "brand/folevi-mark-dark.svg"]) expect(existsSync(join(OUT, f)), f).toBe(true);
});

test("index.html carries the shell's Content Security Policy before any script, and the theme boot script", () => {
  const html = readFileSync(join(OUT, "index.html"), "utf8");
  const csp = html.indexOf('http-equiv="Content-Security-Policy"');
  expect(csp).toBeGreaterThan(0);
  expect(csp).toBeLessThan(html.indexOf("<script"));
  const policy = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1]?.replace(/&#x27;/g, "'") ?? "";
  expect(policy).toContain("default-src 'self'");
  expect(policy).toContain("object-src 'none'");
  expect(policy).not.toContain("frame-ancestors");
  expect(html).toContain("folevi:appearance");
});

test("the snapshot of admin-managed themes and templates is in the export", () => {
  const snap = JSON.parse(readFileSync(join(OUT, "shell/snapshot.json"), "utf8")) as { version: number; themes: { image: { full: string | null } | null }[]; templates: { disabled: string[] } };
  expect(snap.version).toBe(1);
  expect(Array.isArray(snap.themes)).toBe(true);
  expect(Array.isArray(snap.templates.disabled)).toBe(true);
  // Uploaded theme images are copied in: the rows point at the shell's files, never at Convex storage.
  for (const t of snap.themes) if (t.image?.full) expect(t.image.full).toMatch(/^\/shell\/themes\//);
});

// ---------------------------------------------------------------- no admin or marketing code in the bundle

/** ASCII UI strings (24+ characters with a space) written in these files. */
function stringsIn(files: string[]): Set<string> {
  const out = new Set<string>();
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    for (const m of text.matchAll(/"([^"\\\n]{24,})"|'([^'\\\n]{24,})'|>([^<>{}\n]{24,})</g)) {
      const s = (m[1] ?? m[2] ?? m[3] ?? "").trim();
      // Prose only (a capital, then words and punctuation): CSS values and class lists are shared by design.
      if (s.length >= 24 && /^[A-Z][a-z]+ [\w ,.:;!?'"-]+$/.test(s) && !/https?:/.test(s)) out.add(s);
    }
  }
  return out;
}

const sourceFiles = (dir: string) => walk(dir).filter((f) => /\.(tsx?|mts)$/.test(f));
const ADMIN = [...sourceFiles(join(SRC, "components/admin")), ...sourceFiles(join(SRC, "app/admin"))];
const MARKETING = [...sourceFiles(join(SRC, "components/marketing")), ...sourceFiles(join(SRC, "app/(marketing)"))];
const isOther = (f: string) => !ADMIN.includes(f) && !MARKETING.includes(f);

/** Strings written only in `files`: nothing the product, the server, the shared packages or Next also writes. */
function sentinels(files: string[]): string[] {
  const corpus = [...sourceFiles(SRC).filter(isOther), ...sourceFiles(join(WEB, "../../convex")).filter((f) => !f.includes("_generated")), ...sourceFiles(join(WEB, "../../packages")), ...walk(join(WEB, "node_modules/next/dist/client/components")).filter((f) => f.endsWith(".js"))]
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");
  return [...stringsIn(files)].filter((s) => !corpus.includes(s));
}

function bundleText(): string {
  return walk(join(OUT, "_next"))
    .filter((f) => /\.(js|css|txt|json)$/.test(f))
    .concat(walk(OUT).filter((f) => /\.(html|txt)$/.test(f) && !f.includes(`${OUT}/_next`)))
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");
}

test("the bundle has no admin chunks: none of the admin console's own strings is in any file", () => {
  const marks = sentinels(ADMIN);
  // Enough to mean something: the console has hundreds of strings of its own.
  expect(marks.length).toBeGreaterThan(40);
  const bundle = bundleText();
  expect(marks.filter((s) => bundle.includes(s))).toEqual([]);
});

test("the bundle has no marketing pages: none of the website's own strings is in any file", () => {
  const marks = sentinels(MARKETING);
  expect(marks.length).toBeGreaterThan(40);
  const bundle = bundleText();
  expect(marks.filter((s) => bundle.includes(s))).toEqual([]);
});
