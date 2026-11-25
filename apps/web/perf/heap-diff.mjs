#!/usr/bin/env node
// What grew between two heap snapshots (docs/perf/web-results.md): self size and count per constructor or string
// kind, the biggest growth first.
//   node perf/heap-diff.mjs <before.heapsnapshot> <after.heapsnapshot> [--top 30]
import { readFileSync } from "node:fs";

function summary(file) {
  const snap = JSON.parse(readFileSync(file, "utf8"));
  const f = snap.snapshot.meta.node_fields;
  const types = snap.snapshot.meta.node_types[0];
  const n = f.length;
  const [ti, ni, si] = [f.indexOf("type"), f.indexOf("name"), f.indexOf("self_size")];
  const out = new Map();
  const nodes = snap.nodes;
  for (let i = 0; i < nodes.length; i += n) {
    const type = types[nodes[i + ti]];
    const name = type === "object" || type === "closure" || type === "native" ? snap.strings[nodes[i + ni]] : `(${type})`;
    const k = `${type === "closure" ? "closure " : ""}${name}`.slice(0, 90);
    const e = out.get(k) ?? { count: 0, size: 0 };
    e.count++;
    e.size += nodes[i + si];
    out.set(k, e);
  }
  return out;
}

const [a, b, ...rest] = process.argv.slice(2);
const top = Number(rest[rest.indexOf("--top") + 1] ?? 30) || 30;
const before = summary(a);
const after = summary(b);
const rows = [...after].map(([k, v]) => {
  const w = before.get(k) ?? { count: 0, size: 0 };
  return { k, dc: v.count - w.count, ds: v.size - w.size };
});
console.log("Growth by size:");
for (const r of rows.sort((x, y) => y.ds - x.ds).slice(0, top)) console.log(`${(r.ds / 1024).toFixed(1).padStart(9)} KB ${String(r.dc).padStart(7)}  ${r.k}`);
