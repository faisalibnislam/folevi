import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { cleanPlaces, LIBRARY, PlacesStore, userIdOf } from "./places";

const dirs: string[] = [];
const file = () => {
  const d = mkdtempSync(join(tmpdir(), "folevi-places-"));
  dirs.push(d);
  return join(d, "places.json");
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("places.json (several places, docs/MULTI_ACCOUNT_PLAN.md §2.2)", () => {
  test("the library and accounts, the open one, Quick Add's; kept across launches", () => {
    const f = file();
    const p = new PlacesStore(f);
    expect(PlacesStore.exists(f)).toBe(false);
    p.setLibrary(true);
    const ana = p.addAccount({ userId: "userAna", name: "Ana", email: "ana@example.com", avatarUrl: null })!;
    p.addAccount({ userId: "userBen", name: "Ben", email: "ben@example.com", avatarUrl: "https://example.com/b.png" });
    p.setCurrent(ana.id);
    p.setQuickAdd(LIBRARY);
    const again = new PlacesStore(f);
    expect(again.state.current).toBe("acct:userAna");
    expect(again.state.accounts.map((a) => a.email)).toEqual(["ana@example.com", "ben@example.com"]);
    expect(again.state.quickAdd).toBe(LIBRARY);
    expect(again.modeOf(LIBRARY)).toBe("local");
    expect(again.modeOf("acct:userBen")).toBe("account");
    expect(again.modeOf(null)).toBe("unset");
    expect(JSON.parse(readFileSync(f, "utf8"))).not.toHaveProperty("token");
  });

  test("what a page says of its account updates it; counts go to the Dock badge; junk is dropped", () => {
    const p = new PlacesStore(file());
    const a = p.addAccount({ userId: "userAna", name: "Ana", email: "ana@example.com", avatarUrl: null })!;
    p.describe(a.id, { profileId: "prof_1", name: "Ana Lima", workspaces: [{ id: "w1", name: "Acme", logoUrl: "javascript:alert(1)" }, { bad: true }], unread: 4, waiting: 2 });
    const now = p.account(a.id)!;
    expect(now).toMatchObject({ profileId: "prof_1", name: "Ana Lima", unread: 4, waiting: 2 });
    expect(now.workspaces).toEqual([{ id: "w1", name: "Acme", logoUrl: null }]);
    expect(p.unreadTotal()).toBe(4);
    p.describe("acct:nobody", { unread: 9 });
    expect(p.unreadTotal()).toBe(4);
    expect(cleanPlaces({ current: "acct:ghost", accounts: [{ userId: "bad id" }], library: "yes" })).toMatchObject({ current: null, accounts: [], library: false });
    expect(userIdOf("acct:abc")).toBe("abc");
    expect(userIdOf(LIBRARY)).toBeNull();
  });

  test("removing the open account opens the next place; forgetting the library leaves the accounts", () => {
    const p = new PlacesStore(file());
    p.setLibrary(true);
    const a = p.addAccount({ userId: "userAna", name: "Ana", email: "a@example.com", avatarUrl: null })!;
    const b = p.addAccount({ userId: "userBen", name: "Ben", email: "b@example.com", avatarUrl: null })!;
    p.setCurrent(a.id);
    p.setQuickAdd(a.id);
    expect(p.removeAccount(a.id)).toBe(b.id);
    expect(p.state.quickAdd).toBeNull();
    expect(p.state.current).toBe(b.id);
    expect(p.removeAccount(b.id)).toBe(LIBRARY);
    p.setCurrent(LIBRARY);
    p.setLibrary(false);
    expect(p.state.current).toBeNull();
    expect(p.list({ libraryKind: null, displayPath: "", configured: false })).toEqual([]);
  });
});
