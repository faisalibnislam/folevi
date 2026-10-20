// SPIKE S1: a static server for out-shell/ with the SPA fallback the Mac and iOS hosts will have: a path that
// is a file is served, /api/* and /_next/* misses are 404, and everything else gets index.html.
//   node spikes/s1-shell/serve.mjs [port] [root]
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.argv[2] ?? 4319);
const root = resolve(process.argv[3] ?? fileURLToPath(new URL("../../out-shell", import.meta.url)));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".txt": "text/plain", ".json": "application/json", ".woff2": "font/woff2", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webp": "image/webp", ".jpg": "image/jpeg" };

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = normalize(join(root, path));
  if (!file.startsWith(root)) return res.writeHead(400).end();
  try {
    if ((await stat(file)).isFile()) {
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
      return res.end(await readFile(file));
    }
  } catch {
    // Not a file: fall through to the SPA fallback.
  }
  if (path.startsWith("/api/") || path.startsWith("/_next/")) return res.writeHead(404).end();
  res.writeHead(200, { "content-type": TYPES[".html"] });
  res.end(await readFile(join(root, "index.html")));
}).listen(port, () => console.log(`shell on http://127.0.0.1:${port} from ${root}`));
