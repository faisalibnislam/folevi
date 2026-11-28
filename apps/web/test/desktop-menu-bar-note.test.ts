// The Mac's menu bar note, the page's side (lib/desktop/menuBarNote.ts): where a note can go (Personal and the
// workspaces with their marks, each folder under its parent), the checks on what the Mac sends, and the note's title
// and content as Home's quick note makes them, with screenshots.
import { describe, expect, it, vi } from "vitest";
import { noteFromText } from "@/lib/desktop/capabilities";
import { folderTree, inMenuBarPanel, menuNoteContent, noteSpaces, scopeOfSpace, validateMenuNote } from "@/lib/desktop/menuBarNote";

describe("menu bar note: where a note goes", () => {
  it("puts each folder under its parent, in sidebar order", () => {
    const tree = folderTree([
      { id: "b", name: "Later", parentFolderId: "a" },
      { id: "a", name: "Ideas", parentFolderId: null },
      { id: "c", name: "Work", parentFolderId: null },
      { id: "d", name: "Orphan", parentFolderId: "gone" },
      { id: "e", name: "", parentFolderId: "b" },
    ]);
    expect(tree).toEqual([
      { id: "a", name: "Ideas", depth: 0 },
      { id: "b", name: "Later", depth: 1 },
      { id: "e", name: "Untitled folder", depth: 2 },
      { id: "c", name: "Work", depth: 0 },
      { id: "d", name: "Orphan", depth: 0 },
    ]);
  });

  it("lists Personal first with your mark, then the workspaces with their logos, leaving out locked folder names", async () => {
    const query = vi.fn(async (_fn: never, args: never) => {
      const scope = (args as { scope: { kind: string } }).scope;
      return { folders: scope.kind === "personal" ? [{ id: "p1", name: "Ideas", parentFolderId: null }, { id: "p2", name: "", parentFolderId: null, sealedName: { c: "x" } }] : [{ id: "w1", name: "Projects", parentFolderId: null }] };
    });
    const spaces = await noteSpaces({ query }, [{ id: "ws_1", name: "Studio", canEdit: true, logoUrl: "https://files/studio.png" }, { id: "ws_2", name: "Clients", canEdit: false }], { displayName: "Sam", avatarUrl: null });
    expect(spaces.map((s) => [s.id, s.name, s.canEdit, s.imageUrl, s.markName])).toEqual([
      ["personal", "Personal", true, null, "Sam"],
      ["ws_1", "Studio", true, "https://files/studio.png", "Studio"],
      ["ws_2", "Clients", false, null, "Clients"],
    ]);
    expect(spaces[0]!.folders).toEqual([{ id: "p1", name: "Ideas", depth: 0 }]);
  });

  it("knows the panel's page and the server's scopes", () => {
    expect(inMenuBarPanel(new URLSearchParams("panel=1"))).toBe(true);
    expect(inMenuBarPanel(new URLSearchParams(""))).toBe(false);
    expect(scopeOfSpace("personal")).toEqual({ kind: "personal" });
    expect(scopeOfSpace("ws_1")).toEqual({ kind: "workspace", workspaceId: "ws_1" });
  });
});

describe("menu bar note: saving", () => {
  it("checks what the Mac sends", () => {
    expect(validateMenuNote(null)).toBeNull();
    expect(validateMenuNote({ space: "personal", text: "   " })).toBeNull();
    expect(validateMenuNote({ space: "personal", text: "a", images: [{ mime: "text/html", data: "" }] })).toBeNull();
    expect(validateMenuNote({ space: "personal", text: "Hello", folderId: "f1" })).toEqual({ space: "personal", folderId: "f1", text: "Hello", images: [] });
    expect(validateMenuNote({ space: "ws_1", text: "", images: [{ mime: "image/png", data: "eA==" }] })).toEqual({ space: "ws_1", folderId: null, text: "", images: [{ mime: "image/png", name: "Screenshot", data: "eA==" }] });
  });

  it("makes the note as Home does: first line the title, each other line a paragraph", () => {
    expect(menuNoteContent("Groceries\nmilk\n\neggs", 0, noteFromText)).toEqual({ title: "Groceries", content: "milk\n\neggs", format: "text" });
  });

  it("adds the screenshots after the text, the text kept as typed", () => {
    expect(menuNoteContent("Bug\n- not a list *really*\nsee #2", 2, noteFromText)).toEqual({
      title: "Bug",
      content: "\\- not a list \\*really\\*\n\nsee \\#2\n\n![](menu-note-image-1)\n\n![](menu-note-image-2)",
      format: "markdown",
    });
    expect(menuNoteContent("", 1, noteFromText)).toEqual({ title: "Screenshot", content: "![](menu-note-image-1)", format: "markdown" });
  });
});
