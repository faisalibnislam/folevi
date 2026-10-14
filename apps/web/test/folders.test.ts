import { describe, expect, test } from "vitest";
import { folderMoveMessage, moveFolderLocally } from "@/lib/app/folders";

const f = (id: string, parentFolderId: string | null = null) => ({ id, name: id, color: null, rank: id, parentFolderId });

// work > clients > acme, home
const folders = [f("work"), f("clients", "work"), f("acme", "clients"), f("home")];

describe("moving folders in the sidebar before the server answers", () => {
  test("a folder moves with what's inside it", () => {
    const next = moveFolderLocally(folders, "clients", "home")!;
    expect(next.find((x) => x.id === "clients")!.parentFolderId).toBe("home");
    // Its subfolder stays inside it, and nothing else changes.
    expect(next.find((x) => x.id === "acme")!.parentFolderId).toBe("clients");
    expect(next.filter((x) => x.id !== "clients")).toEqual(folders.filter((x) => x.id !== "clients"));
    expect(moveFolderLocally(folders, "acme", null)!.find((x) => x.id === "acme")!.parentFolderId).toBeNull();
  });

  test("moves the server would refuse change nothing", () => {
    expect(moveFolderLocally(folders, "work", "acme")).toBeNull();
    expect(moveFolderLocally(folders, "work", "work")).toBeNull();
    expect(moveFolderLocally(folders, "clients", "work")).toBeNull();
    expect(moveFolderLocally(folders, "clients", "gone")).toBeNull();
    expect(moveFolderLocally(folders, "gone", null)).toBeNull();
    const chain = [f("l1"), f("l2", "l1"), f("l3", "l2"), f("l4", "l3"), f("l5", "l4"), f("solo")];
    expect(moveFolderLocally(chain, "solo", "l5")).toBeNull();
    expect(moveFolderLocally(chain, "solo", "l4")).not.toBeNull();
  });

  test("says why a folder can't go there", () => {
    expect(folderMoveMessage("depth")).toBe("Folders can be nested up to 5 levels deep.");
    expect(folderMoveMessage("descendant")).toMatch(/inside itself or one of its subfolders/);
  });
});
