import { expect, test } from "./fixtures/localShell";

// The local-mode test setup itself (e2e/fixtures/localShell.ts), in both projects: the account project has
// no shell; the local project has a FakeShell whose library lives in OPFS and a guard that catches any
// request to Folevi or Convex. The page is a blank one served at the app's origin by the test, so this
// runs before local mode has a product page to open.

test.describe("local-mode test setup", { tag: "@both" }, () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await page.route(`${baseURL}/__local-shell-fixture`, (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Fixture page</title><p>Fixture page</p>" }));
    await page.goto("/__local-shell-fixture");
  });

  test("the bridge is there only in local mode", async ({ page, backendMode }) => {
    const present = await page.evaluate(() => ({ test: typeof window.__foleviTestShell, real: typeof window.foleviShell }));
    expect(present.real).toBe("undefined");
    expect(present.test).toBe(backendMode === "local" ? "object" : "undefined");
  });

  test("the library keeps files in OPFS, checks etags and paths, and tells watchers", async ({ page, backendMode, localShell }) => {
    test.skip(backendMode !== "local", "local mode only");
    const result = await page.evaluate(async () => {
      const shell = window.__foleviTestShell!;
      const control = window.__foleviTestShellControl!;
      await control.ready;
      const enc = (s: string) => new TextEncoder().encode(s);
      const dec = (b: Uint8Array) => new TextDecoder().decode(b);
      const info = await shell.library.setup({ kind: "device" });
      const created = await shell.library.write("notes/A.fnote", enc("one"), { ifMatch: null });
      const again = await shell.library.write("notes/A.fnote", enc("two"), { ifMatch: null });
      const etag = "etag" in created ? created.etag : "";
      const stale = await shell.library.write("notes/A.fnote", enc("two"), { ifMatch: "not-the-etag" });
      const updated = await shell.library.write("notes/A.fnote", enc("two"), { ifMatch: etag });
      const read = await shell.library.read("notes/A.fnote");
      const bad: string[] = [];
      for (const p of ["../escape", "/abs", "a//b", "a\u0001b", "a\\b"]) {
        await shell.library.read(p).then(
          () => bad.push(`accepted ${p}`),
          () => undefined,
        );
      }
      const seen: string[] = [];
      const stop = shell.library.watch((changes) => seen.push(...changes.map((c) => `${c.kind} ${c.path}`)));
      await control.externalWrite("notes/B.fnote", enc("from another device"));
      await new Promise((r) => setTimeout(r, 50));
      stop();
      await shell.library.journal.append(enc("j1"));
      await shell.library.journal.append(enc("j2"));
      await shell.library.journal.append(enc("j3"));
      await shell.library.journal.truncate(2);
      const journal = (await shell.library.journal.readAll()).map(dec);
      await shell.setMode("local");
      return {
        info,
        created: "etag" in created,
        again: "mismatch" in again,
        stale: "mismatch" in stale && stale.etag === etag,
        updated: "etag" in updated && updated.etag !== etag,
        read: "bytes" in read ? dec(read.bytes) : null,
        bad,
        seen,
        journal,
        listed: (await shell.library.list("")).map((e) => e.path),
        inNotes: (await shell.library.list("notes")).map((e) => e.path),
      };
    });
    expect(result).toEqual({
      info: { kind: "device", displayPath: "Test library (library)", available: true, encrypted: false, locked: false, configured: true },
      created: true,
      again: true,
      stale: true,
      updated: true,
      read: "two",
      bad: [],
      seen: ["changed notes/B.fnote"],
      journal: ["j3"],
      listed: ["notes/A.fnote", "notes/B.fnote"],
      inNotes: ["notes/A.fnote", "notes/B.fnote"],
    });

    // A reload keeps the library and the chosen mode.
    await page.reload();
    expect(await localShell.readText(page, "notes/A.fnote")).toBe("two");
    expect(await page.evaluate(() => window.__foleviTestShell!.initialMode)).toBe("local");
    expect((await localShell.calls(page)).map((c) => c.call)).toEqual([]);
  });

  test("the guard catches requests to Folevi and Convex", async ({ page, backendMode, localShell }) => {
    test.skip(backendMode !== "local", "local mode only");
    const outcome = await page.evaluate(async () => {
      const tries = ["https://app.folevi.com/api/auth/get-session", "https://example-123.convex.cloud/api/query", "/api/auth/get-session"];
      const out: string[] = [];
      for (const url of tries) out.push(await fetch(url).then(() => "reached", () => "blocked"));
      return out;
    });
    expect(outcome).toEqual(["blocked", "blocked", "blocked"]);
    expect(localShell.guard!.violations).toHaveLength(3);
    // These were on purpose; anything else would fail the test when it ends.
    localShell.guard!.clear();
  });
});
