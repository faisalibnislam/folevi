// The persistent local store in the browser (lib/local/store, docs/LOCAL_MODE_PLAN.md §3): the library lives in
// the FakeShell's folder (OPFS) and this device's copy in IndexedDB; a reload shows the same notes, and a note
// another device changed in the folder is taken in without a reload. Local project only:
//   E2E_LOCAL_BASE_URL=http://localhost:3003 E2E_BASE_URL=http://app.localhost:3002 E2E_NO_SERVER=1 \
//     npx playwright test e2e/local-library.spec.ts --project local
import { HybridClock, decodeNoteFile, encodeNoteFile, setDocField, type NoteFile } from "@folevi/local-store";
import { WELCOME_TITLE } from "@folevi/editor-schema";
import { expect, test } from "./fixtures/localShell";
import type { Page } from "@playwright/test";

async function noteFiles(page: Page, list: (page: Page, dir?: string) => Promise<string[]>) {
  return (await list(page, "notes")).filter((p) => p.endsWith(".fnote"));
}

/** A document row as this device's copy (IndexedDB) holds it, by title. */
async function rowTitled(page: Page, title: string): Promise<{ id: string; title: string } | null> {
  return await page.evaluate(async (wanted) => {
    const names = (await indexedDB.databases()).map((d) => d.name ?? "").filter((n) => n.startsWith("folevi-local-"));
    for (const name of names) {
      const db = await new Promise<IDBDatabase>((ok, ko) => {
        const r = indexedDB.open(name);
        r.onsuccess = () => ok(r.result);
        r.onerror = () => ko(r.error);
      });
      if (!db.objectStoreNames.contains("rows")) continue;
      const rows = await new Promise<unknown[]>((ok, ko) => {
        const r = db.transaction("rows").objectStore("rows").getAll();
        r.onsuccess = () => ok(r.result);
        r.onerror = () => ko(r.error);
      });
      db.close();
      const hit = rows.find((r) => (r as { title?: unknown; revision?: unknown }).title === wanted && typeof (r as { revision?: unknown }).revision === "number");
      if (hit) return hit as { id: string; title: string };
    }
    return null;
  }, title);
}

// What's checked is the library itself (the folder in OPFS, the copy in IndexedDB). The product's local-mode
// screens come with WP10; until then a hidden surface (changes, notifications) can stop the page, so nothing
// here depends on what's on screen.
test.describe("the library on this device", { tag: "@local" }, () => {
  test("is written to the folder, survives a reload, and takes in another device's change", async ({ page, localShell, backendMode }) => {
    test.skip(backendMode !== "local", "local mode only");
    test.setTimeout(120_000);
    await page.goto("/");

    // The welcome notes reach the folder within a few seconds (1 s of quiet, 5 s at most).
    await expect.poll(async () => (await noteFiles(page, localShell.list)).length, { timeout: 30_000 }).toBeGreaterThan(5);
    await expect.poll(async () => await localShell.list(page, ""), { timeout: 15_000 }).toEqual(expect.arrayContaining(["folevi-library.json", "index/library.findex"]));
    await expect.poll(() => rowTitled(page, WELCOME_TITLE), { timeout: 15_000 }).not.toBeNull();
    await page.waitForTimeout(6000);
    const files = (await noteFiles(page, localShell.list)).sort();

    // A reload opens the same library: nothing set up twice.
    await page.reload();
    await page.waitForTimeout(6000);
    expect((await noteFiles(page, localShell.list)).sort()).toEqual(files);

    // Another device renames the welcome note: its sync writes the file, and this device takes it in.
    let welcome: { path: string; note: NoteFile } | null = null;
    for (const path of files) {
      const text = await localShell.readText(page, path);
      const note = decodeNoteFile(new TextEncoder().encode(text ?? "")) as NoteFile;
      if ("doc" in note && note.doc.title?.v === WELCOME_TITLE) welcome = { path, note };
    }
    expect(welcome).not.toBeNull();
    const other = new HybridClock("otherMac", { now: () => Date.now() + 1000 });
    const renamed = setDocField(welcome!.note, "title", "Renamed on my other Mac", other);
    await localShell.writeExternal(page, welcome!.path, new TextDecoder().decode(encodeNoteFile(renamed)));
    await expect.poll(() => rowTitled(page, "Renamed on my other Mac"), { timeout: 15_000 }).toMatchObject({ id: welcome!.note.id });

    // And after a reload too.
    await page.reload();
    await expect.poll(() => rowTitled(page, "Renamed on my other Mac"), { timeout: 30_000 }).toMatchObject({ id: welcome!.note.id });
  });
});
