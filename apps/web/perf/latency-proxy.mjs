#!/usr/bin/env node
// A TCP relay that adds a fixed delay each way, so a local Convex backend answers like one far away
// (docs/perf/feel-results.md). Account mode waits on the network in places local mode never does; this makes
// those waits show up in a measurement on one Mac.
//
//   node perf/latency-proxy.mjs <listen>:<target>[,<listen>:<target>...] [delayMs]
//   node perf/latency-proxy.mjs 3310:3210,3311:3211 100        # 100 ms each way = a 200 ms round trip
//
// The delay can be changed while it runs: GET http://127.0.0.1:<control>/?ms=150 (control port = PERF_PROXY_CONTROL,
// default 3399), so one built app can be measured near and far without a rebuild.
import { createServer as createHttp } from "node:http";
import { connect, createServer } from "node:net";
import { setTimeout } from "node:timers";

const pairs = (process.argv[2] ?? "").split(",").filter(Boolean).map((p) => p.split(":").map(Number));
let delay = Number(process.argv[3] ?? 0);
if (!pairs.length || pairs.some(([a, b]) => !a || !b)) {
  console.error("usage: latency-proxy.mjs <listen>:<target>[,...] [delayMs]");
  process.exit(2);
}

/** Forwards `from` to `to`, each chunk `delay` ms late and in order. */
function relay(from, to) {
  let last = 0;
  from.on("data", (chunk) => {
    const at = Math.max(Date.now() + delay, last);
    last = at;
    setTimeout(() => {
      if (!to.destroyed) to.write(chunk);
    }, at - Date.now());
  });
  from.on("end", () => setTimeout(() => to.end(), Math.max(0, last - Date.now()) + 1));
  from.on("error", () => to.destroy());
}

for (const [listen, target] of pairs) {
  createServer((client) => {
    const upstream = connect(target, "127.0.0.1");
    client.setNoDelay(true);
    upstream.setNoDelay(true);
    relay(client, upstream);
    relay(upstream, client);
    upstream.on("error", () => client.destroy());
  }).listen(listen, "127.0.0.1", () => console.log(`latency-proxy ${listen} -> ${target}`));
}

const control = Number(process.env.PERF_PROXY_CONTROL ?? 3399);
createHttp((req, res) => {
  const ms = new URL(req.url ?? "/", "http://x").searchParams.get("ms");
  if (ms !== null && Number.isFinite(Number(ms))) delay = Math.max(0, Number(ms));
  res.setHeader("access-control-allow-origin", "*");
  res.end(JSON.stringify({ delayMs: delay }));
}).listen(control, "127.0.0.1", () => console.log(`latency-proxy control on ${control}, delay ${delay} ms each way`));
