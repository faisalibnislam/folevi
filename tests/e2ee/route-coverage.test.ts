// @vitest-environment node
// Every Convex function the product calls has a route for end-to-end encrypted spaces (docs/E2EE_DESIGN.md
// §6.4, WP7): E2EE_ROUTES names it, or its module's `*` (only modules with no content use one). The same scan
// as the local-mode coverage test (tests/parity/callers.ts). Also: every function a device route sends to the
// replica has a local handler, and every e2ee function the router calls by name exists on the server.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getFunctionName, type FunctionReference } from "convex/server";
import { describe, expect, test } from "vitest";
import { calledFunctions, ROOT } from "../parity/callers";
import { E2EE_ROUTES, hasRoute, routeOf } from "../../apps/web/src/lib/e2ee/router/routes";
import { content, files, keysStatus, pullHead, pullMine, pullPage, spacesMine } from "../../apps/web/src/lib/e2ee/router/refs";
import { localStatus } from "../../apps/web/src/lib/local/registry";
import "../../apps/web/src/lib/local/functions";

/** Modules whose functions carry no note content: a `module:*` pass is allowed for them. */
const NO_CONTENT = new Set(["users", "workspaces", "billing", "workspaceBilling", "settings", "themes", "presence", "push", "apiTokens", "mcp", "webhooks", "authEmails", "signInOptions", "passkeyUsage", "support", "clock", "unsplash", "externalCalendars", "calendarFeeds", "emailNotes", "aiDigest", "routines", "proposals", "e2ee"]);

describe("E2EE route coverage", () => {
  test("every Convex function the product calls has a route", () => {
    const called = calledFunctions();
    expect(called.length).toBeGreaterThan(100);
    const missing = called.filter((n) => !hasRoute(n));
    expect(missing, "add each to apps/web/src/lib/e2ee/router/routes.ts E2EE_ROUTES").toEqual([]);
    const wildcards = Object.keys(E2EE_ROUTES).filter((k) => k.endsWith(":*") && E2EE_ROUTES[k]!.kind === "pass").map((k) => k.split(":")[0]!);
    // A module's `*` may only pass when its functions carry no content (AI modules use `*` with the ai route).
    expect(wildcards.filter((m) => !NO_CONTENT.has(m)), "only modules without content may pass as a whole").toEqual([]);
  });

  test("every function a device route answers has a local handler", () => {
    const device = Object.entries(E2EE_ROUTES).filter(([, r]) => r.kind === "device").map(([n]) => n);
    expect(device.length).toBeGreaterThan(10);
    expect(device.filter((n) => localStatus(n).kind !== "ported")).toEqual([]);
  });

  test("composed and record-sealed functions run local handlers that exist", () => {
    const captured = ["documents:duplicate", "tasks:update", "tasks:quickAdd", "tasks:inbox", "tasks:moveToDocument", "imports:importText", "aiWriting:saveDraft", "aiActions:apply"];
    const records = Object.entries(E2EE_ROUTES).filter(([, r]) => r.kind === "sealed" && r.to && getFunctionName(r.to) === "e2ee/content:putRecord").map(([n]) => n);
    for (const n of [...captured, ...records]) expect(localStatus(n).kind, n).toBe("ported");
  });

  test("every e2ee function the router calls by name exists on the server", () => {
    const refs: FunctionReference<"query" | "mutation" | "action">[] = [keysStatus, spacesMine, pullHead, pullPage, pullMine, ...Object.values(content), ...Object.values(files)];
    for (const r of refs) {
      const name = getFunctionName(r);
      const [mod, fn] = name.split(":") as [string, string];
      const text = readFileSync(join(ROOT, "convex", `${mod}.ts`), "utf8");
      expect(new RegExp(`export const ${fn}\\b`).test(text), name).toBe(true);
    }
  });

  test("a function no entry names passes", () => {
    expect(routeOf("users:me").kind).toBe("pass");
    expect(routeOf("e2ee/keys:status").kind).toBe("pass");
  });
});
