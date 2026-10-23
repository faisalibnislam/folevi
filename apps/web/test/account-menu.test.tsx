// The account menu's places (components/app/WorkspaceMenu.tsx placeEntries): a "Places" label, each account with
// its workspaces under it (and New workspace under the open one), the library last, one check where you are.
import { describe, expect, test, vi } from "vitest";
import type { MenuEntry, MenuItem } from "@/components/ui/Menu";
import { placeEntries, type HerePlace } from "@/components/app/WorkspaceMenu";
import type { Place } from "@/lib/places";

const ana: Place = { kind: "account", id: "acct:ana", userId: "ana", profileId: "p1", name: "Ana", email: "ana@example.com", avatarUrl: null, workspaces: [{ id: "w1", name: "Ana Studio", logoUrl: null }], unread: 3, reminders: 0, waiting: 0, lastOpenedAt: 0 };
const ben: Place = { kind: "account", id: "acct:ben", userId: "ben", profileId: "p2", name: "Ben", email: "ben@example.com", avatarUrl: null, workspaces: [], unread: 0, reminders: 1, waiting: 0, lastOpenedAt: 0 };
const library: Place = { kind: "library", id: "library", syncs: "Kept on this device only", unread: 0, reminders: 0, waiting: 2, lastOpenedAt: 0 };

const row = (e: MenuEntry) => (typeof e === "string" ? e : "heading" in e ? `# ${e.heading}` : `${e.row ?? "-"}:${e.label}${e.checked ? " ✓" : ""}`);

function asBen(personal: boolean): HerePlace {
  return {
    kind: "account",
    id: "acct:ben",
    name: "Ben",
    email: "ben@example.com",
    personal,
    workspaces: [{ id: "w9", name: "Ben Co", logoUrl: null, plan: "Pro", open: !personal }],
    pickPersonal: vi.fn(),
    pickWorkspace: vi.fn(),
    newWorkspace: vi.fn(),
  };
}

describe("placeEntries", () => {
  test("accounts in order with their workspaces, New workspace under the open one, the library last", () => {
    const entries = placeEntries([ana, ben, library], asBen(true), vi.fn());
    expect(entries.map(row)).toEqual(["# Places", "place:Ana", "sub:Ana Studio", "place:Ben ✓", "sub:Ben Co", "sub:New workspace…", "place:On this Mac"]);
    const me = entries[3] as MenuItem;
    // "Personal" to assistive tech, the email under the name, cut in the middle.
    expect(me).toMatchObject({ name: "Personal", description: "ben@example.com", middle: true });
    // The workspace's plan as its caption; another account's count and the library's dot.
    expect(entries[4]).toMatchObject({ detail: "Pro", checked: false });
    expect(entries[1]).toMatchObject({ badge: 3, description: "ana@example.com" });
    expect(entries[6]).toMatchObject({ dot: true, description: "Kept on this device only" });
  });

  test("a workspace open: it has the check, Personal doesn't", () => {
    const entries = placeEntries([ben], asBen(false), vi.fn());
    expect(entries.map(row)).toEqual(["# Places", "place:Ben", "sub:Ben Co ✓", "sub:New workspace…"]);
  });

  test("the open account shows even when this page knows no other places", () => {
    expect(placeEntries([], asBen(true), vi.fn()).map(row)).toEqual(["# Places", "place:Ben ✓", "sub:Ben Co", "sub:New workspace…"]);
  });

  test("in the library: it's checked, and picking another account or its workspace opens that place", () => {
    const open = vi.fn();
    const entries = placeEntries([library, ana], { kind: "library", syncs: "Syncs with iCloud Drive" }, open);
    expect(entries.map(row)).toEqual(["# Places", "place:Ana", "sub:Ana Studio", "place:On this Mac ✓"]);
    (entries[2] as MenuItem).onSelect();
    expect(open).toHaveBeenCalledWith(ana, "w1");
    (entries[1] as MenuItem).onSelect();
    expect(open).toHaveBeenCalledWith(ana, null);
  });
});
