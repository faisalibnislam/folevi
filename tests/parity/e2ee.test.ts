// Every parity scenario against an encrypted Personal (docs/E2EE_DESIGN.md §11.3, WP7): the router over
// convex-test (drivers/e2ee.ts) must normalize to the same results as plain Convex. Fields only encrypted
// results carry (which file ids a note references, its lock) are dropped before comparing; nothing else is.
//
// E2EE_PARITY_ONLY=<substring> runs only matching scenarios; E2EE_PARITY_PRINT=1 prints both results.
import { describe, expect, test } from "vitest";
import { ConvexDriver } from "./drivers/convexDriver";
import { E2eeDriver, PlainWorkspaceDriver } from "./drivers/e2ee";
import { Kit } from "./kit";
import { normalize } from "./normalize";
import { E2EE_KNOWN, E2EE_WORKSPACE_KNOWN } from "./e2eeKnown";
import type { ParityBackend, Scenario } from "./types";

const files = import.meta.glob<{ scenarios?: Scenario[] }>("./scenarios/*.ts", { eager: true });
const all = Object.entries(files).flatMap(([file, mod]) => (mod.scenarios ?? []).map((s) => ({ file: file.replace("./scenarios/", ""), s })));
const only = process.env.E2EE_PARITY_ONLY;

/** Keys only an encrypted note's results carry. */
const E2EE_ONLY_KEYS = ["fileIds", "locked", "lockedVia"];

async function observe(b: ParityBackend, s: Scenario) {
  try {
    return normalize(await s.run(b, new Kit(b)), { known: b.known, ignore: [...(s.ignore ?? []), ...E2EE_ONLY_KEYS] });
  } finally {
    await b.close();
  }
}

describe("parity scenarios over an encrypted Personal", () => {
  for (const { file, s } of all) {
    const label = `${file}: ${s.name}`;
    if (only && !label.includes(only)) continue;
    const known = E2EE_KNOWN[label];
    const run = known ? test.skip : test;
    run(known ? `${label} (differs: ${known})` : `${label} (account = encrypted)`, async () => {
      const expected = await observe(await ConvexDriver.open(), s);
      const actual = await observe(await E2eeDriver.open(), s);
      if (process.env.E2EE_PARITY_PRINT === "1") console.info(`[e2ee parity] ${label}\n${JSON.stringify({ expected, actual }, null, 1)}`);
      expect(actual).toEqual(expected);
    }, 60_000);
  }
});

// The same scenarios in a team workspace (§11.3; the replica answers for the workspace, owner fields included).
describe("parity scenarios over an encrypted team workspace", () => {
  for (const { file, s } of all) {
    const label = `${file}: ${s.name}`;
    if (only && !label.includes(only)) continue;
    const known = E2EE_WORKSPACE_KNOWN[label] ?? E2EE_KNOWN[label];
    const run = known ? test.skip : test;
    run(known ? `${label} (differs: ${known})` : `${label} (workspace = encrypted workspace)`, async () => {
      const expected = await observe(await PlainWorkspaceDriver.open(), s);
      const actual = await observe(await E2eeDriver.open("workspace"), s);
      if (process.env.E2EE_PARITY_PRINT === "1") console.info(`[e2ee parity ws] ${label}\n${JSON.stringify({ expected, actual }, null, 1)}`);
      expect(actual).toEqual(expected);
    }, 60_000);
  }
});
