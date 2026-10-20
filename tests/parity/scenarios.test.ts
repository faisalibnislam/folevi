// Runs every scenario in tests/parity/scenarios/ against account mode (Convex) and, once WP5 has wired
// lib/local/testing.ts and the scenario isn't local-pending, against local mode too, and compares the
// normalized results. How to add one: tests/parity/types.ts.
import { afterAll, describe, expect, test } from "vitest";
import { ConvexDriver } from "./drivers/convexDriver";
import { localAvailability, openLocalDriver } from "./drivers/localDriver";
import { Kit } from "./kit";
import { normalize } from "./normalize";
import { loadRegistry } from "./registry";
import type { ParityBackend, Scenario } from "./types";

const files = import.meta.glob<{ scenarios?: Scenario[] }>("./scenarios/*.ts", { eager: true });
const all: { file: string; s: Scenario }[] = Object.entries(files).flatMap(([file, mod]) => (mod.scenarios ?? []).map((s) => ({ file: file.replace("./scenarios/", ""), s })));
const tryPending = process.env.PARITY_TRY_PENDING === "1";

async function observe(b: ParityBackend, s: Scenario) {
  try {
    const raw = await s.run(b, new Kit(b));
    return normalize(raw, { known: b.known, ignore: s.ignore });
  } finally {
    await b.close();
  }
}

const tally = { both: 0, convexOnly: 0, byDesign: 0, couldUnpend: [] as string[] };

describe("parity scenarios", async () => {
  const local = await localAvailability();
  const registry = await loadRegistry();

  for (const { file, s } of all) {
    const compareLocal = local.ready && !s.accountOnly && (!s.localPending || tryPending);
    const label = `${file}: ${s.name}`;
    const why = s.accountOnly ? `, by design: ${s.accountOnly}` : s.localPending ? `, local pending: ${s.localPending}` : !local.ready ? ", local mode not wired yet" : "";
    test(compareLocal ? `${label} (account = local)` : `${label} (account only${why})`, async () => {
      const convex = await ConvexDriver.open();
      const calls = convex.calls;
      const expected = await observe(convex, s);
      if (process.env.PARITY_PRINT === "1") console.info(`[parity] ${label}\n${JSON.stringify(expected, null, 2)}`);
      // A second fresh account must give the same normalized answer, or a local difference wouldn't mean anything.
      expect(await observe(await ConvexDriver.open(), s), "the scenario is deterministic once normalized").toEqual(expected);
      if (s.localPending && registry.ready && [...calls].every((name) => registry.ported(name))) tally.couldUnpend.push(label);
      if (!compareLocal) {
        if (s.accountOnly) tally.byDesign++;
        else tally.convexOnly++;
        return;
      }
      const driver = await openLocalDriver(convex.deviceId);
      if (!driver) throw new Error("local mode was available a moment ago");
      const actual = await observe(driver, s);
      tally.both++;
      expect(actual).toEqual(expected);
    });
  }

  if (!local.ready) test.todo(`local mode: ${local.reason}`);
});

afterAll(() => {
  const lines = [`[parity] ${all.length} scenarios: ${tally.both} compared on both backends, ${tally.convexOnly} on account mode only for now, ${tally.byDesign} account-only by design.`];
  if (tally.couldUnpend.length) lines.push(`[parity] every function these call is ported locally; try removing localPending: ${tally.couldUnpend.join("; ")}`);
  console.info(lines.join("\n"));
});
