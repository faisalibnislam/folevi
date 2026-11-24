#!/usr/bin/env node
// Phase 0 spike: one origin and one port for everything, with no dependencies (plain Node).
//   /convex/*       -> the backend's client API, WebSocket included (prefix removed)
//   /convex-site/*  -> the backend's HTTP actions (prefix removed)
//   everything else -> the Next.js server
// Env: PORT (3580), BIND (127.0.0.1), WEB (http://127.0.0.1:3500), CLOUD (http://127.0.0.1:3510),
// SITE (http://127.0.0.1:3511). Start the backend with CLOUD_ORIGIN=http://<host>:<PORT>/convex and
// SITE_ORIGIN=http://<host>:<PORT>/convex-site, and build the web app with the same two addresses.
import http from "node:http";
import net from "node:net";

const PORT = Number(process.env.PORT ?? 3580);
const BIND = process.env.BIND ?? "127.0.0.1";
const routes = [
  { prefix: "/convex-site", target: new URL(process.env.SITE ?? "http://127.0.0.1:3511") },
  { prefix: "/convex", target: new URL(process.env.CLOUD ?? "http://127.0.0.1:3510") },
];
const web = new URL(process.env.WEB ?? "http://127.0.0.1:3500");

function route(url) {
  for (const r of routes) {
    if (url === r.prefix || url.startsWith(`${r.prefix}/`) || url.startsWith(`${r.prefix}?`)) {
      const rest = url.slice(r.prefix.length);
      return { target: r.target, path: rest.startsWith("/") ? rest : `/${rest}` };
    }
  }
  return { target: web, path: url };
}

function forwardedHeaders(req) {
  const headers = { ...req.headers };
  const ip = req.socket.remoteAddress ?? "";
  headers["x-forwarded-for"] = headers["x-forwarded-for"] ? `${headers["x-forwarded-for"]}, ${ip}` : ip;
  headers["x-forwarded-host"] = headers["x-forwarded-host"] ?? req.headers.host ?? "";
  headers["x-forwarded-proto"] = headers["x-forwarded-proto"] ?? "http";
  return headers;
}

const server = http.createServer((req, res) => {
  const { target, path } = route(req.url ?? "/");
  const upstream = http.request(
    { hostname: target.hostname, port: target.port, method: req.method, path, headers: forwardedHeaders(req) },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on("error", (e) => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
    res.end(`proxy error: ${e.message}`);
  });
  req.pipe(upstream);
});

// WebSockets (the Convex sync protocol): replay the upgrade request to the backend, then splice the sockets.
server.on("upgrade", (req, socket, head) => {
  const { target, path } = route(req.url ?? "/");
  const up = net.connect(Number(target.port), target.hostname, () => {
    const headers = forwardedHeaders(req);
    const lines = [`${req.method} ${path} HTTP/1.1`, ...Object.entries(headers).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => `${k}: ${x}`) : [`${k}: ${v}`]))];
    up.write(`${lines.join("\r\n")}\r\n\r\n`);
    if (head?.length) up.write(head);
    up.pipe(socket);
    socket.pipe(up);
  });
  const close = () => {
    socket.destroy();
    up.destroy();
  };
  up.on("error", close);
  socket.on("error", close);
});

server.listen(PORT, BIND, () => console.log(`one-origin proxy on http://${BIND}:${PORT} -> web ${web.origin}, /convex ${routes[1].target.origin}, /convex-site ${routes[0].target.origin}`));
