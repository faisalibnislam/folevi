// @vitest-environment node
// What the app's first screen must not load (docs/perf/web-results.md): code only some people use, which a static
// import from the app page would put in every start's JavaScript. Each was found there once.
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error: a plain script, no types.
import { importChains } from "../perf/import-chain.mjs";

const APP_PAGE = fileURLToPath(new URL("../src/app/(app)/[...path]/page.tsx", import.meta.url));

describe("the app page's start-up imports", () => {
  it.each([
    ["local mode's backend", "apps/web/src/lib/local/backend"],
    ["local mode's functions", "apps/web/src/lib/local/functions/"],
    ["moving a library (copy, targets)", "apps/web/src/lib/migrate/copy"],
    ["the phone interface's shell", "apps/web/src/components/iphone/IphoneShell"],
    ["the phone interface's Home", "apps/web/src/components/iphone/IphoneHome"],
    ["the note editor", "apps/web/src/components/editor/Editor.tsx"],
  ])("don't reach %s", (_what, target) => {
    const chains = (importChains(APP_PAGE, target) as string[][]).map((c) => c.join(" -> "));
    expect(chains).toEqual([]);
  });
});
