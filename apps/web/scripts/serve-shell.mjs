#!/usr/bin/env node
// Serves the shell export (out-shell/) the way the Mac host's app:// handler does (apps/desktop, and later the
// iPhone and iPad app's): a path that is a file is served; /api/* and /_next/* misses are 404; every other path
// gets index.html, so a deep link like /d/<id> opens the app at that route (the SPA fallback).
// For the shell e2e tests (playwright.shell.config.ts) and for trying a build in a browser:
//   node scripts/serve-shell.mjs [port] [root]
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { URL } from "node:url";

const port = Number(process.argv[2] ?? 4319);
const root = resolve(process.argv[3] ?? join(import.meta.dirname, "../out-shell"));
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".wasm": "application/wasm",
  ".mjs": "text/javascript; charset=utf-8",
};

createServer(async (req, res) => {
  let path;
  try {
    path = decodeURIComponent(new URL(req.url ?? "/", "http://shell").pathname);
  } catch {
    return res.writeHead(400).end();
  }
  const file = normalize(join(root, path));
  if (file !== root && !file.startsWith(root + sep)) return res.writeHead(400).end();
  try {
    if ((await stat(file)).isFile()) {
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "x-content-type-options": "nosniff" });
      return res.end(await readFile(file));
    }
  } catch {
    // Not a file: the SPA fallback below.
  }
  if (path.startsWith("/api/") || path.startsWith("/_next/")) return res.writeHead(404).end();
  res.writeHead(200, { "content-type": TYPES[".html"] });
  res.end(await readFile(join(root, "index.html")));
}).listen(port, "127.0.0.1", () => console.log(`shell on http://127.0.0.1:${port} from ${root}`));
