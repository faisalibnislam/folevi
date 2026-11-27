// The sidebar's layout (lib/app/sidebarLayout.ts): which items sit under More, their order, and new items.
import { describe, expect, test } from "vitest";
import {
  defaultSidebarLayout,
  moveSidebarItem,
  placeSidebarItem,
  resolveSidebarLayout,
  sameSidebarLayout,
  saveSidebarLayout,
  SIDEBAR_ITEM_IDS,
  stepSidebarItem,
  type SidebarItemId,
} from "@/lib/app/sidebarLayout";

const ids = (slots: { id: string }[]) => slots.map((s) => s.id);
const more = (slots: { id: string; more: boolean }[]) => slots.filter((s) => s.more).map((s) => s.id);

describe("the sidebar's layout", () => {
  test("by default Shared with Me, Changes and Templates are under More and the rest on the sidebar", () => {
    const d = defaultSidebarLayout();
    expect(ids(d)).toEqual([...SIDEBAR_ITEM_IDS]);
    expect(more(d)).toEqual(["shared", "changes", "templates"]);
    expect(resolveSidebarLayout(null)).toEqual(d);
    expect(resolveSidebarLayout(undefined)).toEqual(d);
  });

  test("a saved layout comes back as saved", () => {
    const mine = moveSidebarItem(placeSidebarItem(defaultSidebarLayout(), "calendar", "home", true), "tasks", true);
    const back = resolveSidebarLayout(saveSidebarLayout(mine));
    expect(sameSidebarLayout(back, mine)).toBe(true);
    expect(ids(back).slice(0, 2)).toEqual(["home", "calendar"]);
    expect(more(back)).toContain("tasks");
  });

  test("an item added later goes to its default place, on the sidebar or under More as its default says", () => {
    // Saved before Reviews and Templates existed, with Calendar moved to the top and Shared with Me on the sidebar.
    const saved = { order: ["home", "calendar", "ai", "dna", "bookmarks", "drafts", "notes", "tasks", "shared", "vault", "changes"], more: ["changes"] };
    const slots = resolveSidebarLayout(saved);
    expect(ids(slots)).toEqual(["home", "calendar", "ai", "dna", "bookmarks", "drafts", "notes", "tasks", "reviews", "shared", "vault", "changes", "templates"]);
    // Reviews' default is the sidebar, Templates' is More; Shared with Me stays where the person put it.
    expect(more(slots)).toEqual(["changes", "templates"]);
  });

  test("ids the app no longer has are left out, and duplicates keep their first place", () => {
    const slots = resolveSidebarLayout({ order: ["tasks", "gone", "home", "tasks"], more: ["gone", "tasks"] });
    expect(ids(slots).indexOf("tasks")).toBeLessThan(ids(slots).indexOf("home"));
    expect(ids(slots)).not.toContain("gone");
    expect(new Set(ids(slots)).size).toBe(SIDEBAR_ITEM_IDS.length);
    expect(slots.find((s) => s.id === "tasks")!.more).toBe(true);
  });

  test("Home and Drafts never go under More, even from a saved layout that says so", () => {
    const d = defaultSidebarLayout();
    expect(moveSidebarItem(d, "home", true)).toEqual(d);
    expect(moveSidebarItem(d, "drafts", true)).toEqual(d);
    expect(more(resolveSidebarLayout({ order: ["home", "drafts"], more: ["home", "drafts"] }))).not.toContain("home");
    expect(more(resolveSidebarLayout({ order: ["home", "drafts"], more: ["home", "drafts"] }))).not.toContain("drafts");
  });

  test("moving to More and back keeps the item's place in the order", () => {
    const d = defaultSidebarLayout();
    const moved = moveSidebarItem(d, "calendar", true);
    expect(ids(moved)).toEqual(ids(d));
    expect(more(moved)).toEqual(["calendar", "shared", "changes", "templates"]);
    expect(moveSidebarItem(moved, "calendar", false)).toEqual(d);
  });

  test("placing an item before or after another", () => {
    const d = defaultSidebarLayout();
    expect(ids(placeSidebarItem(d, "templates", "home", false)).slice(0, 2)).toEqual(["templates", "home"]);
    expect(ids(placeSidebarItem(d, "home", "templates", true)).at(-1)).toBe("home");
    expect(placeSidebarItem(d, "home", "home", true)).toEqual(d);
  });

  test("Move up and Move down step over items that aren't shown here", () => {
    const d = defaultSidebarLayout();
    // Foli AI and Foli DNA are off here: Bookmarks moving up steps over them and lands before Home.
    const shown = SIDEBAR_ITEM_IDS.filter((id) => id !== "ai" && id !== "dna") as SidebarItemId[];
    const up = stepSidebarItem(d, "bookmarks", -1, shown);
    expect(ids(up).filter((id) => shown.includes(id as SidebarItemId)).slice(0, 2)).toEqual(["bookmarks", "home"]);
    // The first can't go up and the last can't go down.
    expect(stepSidebarItem(d, "home", -1, shown)).toEqual(d);
    expect(stepSidebarItem(d, "templates", 1, shown)).toEqual(d);
    const down = stepSidebarItem(d, "tasks", 1, shown);
    expect(ids(down).indexOf("tasks")).toBe(ids(d).indexOf("calendar"));
  });

  test("what's saved names every item, and the ones under More", () => {
    const saved = saveSidebarLayout(defaultSidebarLayout());
    expect(saved.order).toEqual([...SIDEBAR_ITEM_IDS]);
    expect(saved.more).toEqual(["shared", "changes", "templates"]);
  });
});
