// The Mac's menu bar note, the page's side (lib/desktop/menuBarNote.ts): where new notes can go (Personal and the
// workspaces, each folder under its parent), the empty page's target, the panel mode, and a screenshot put into the
// note as a paste.
import { describe, expect, it, vi } from "vitest";
import { composerTarget, folderTree, inMenuBarPanel, noteSpaces, pasteImage, scopeOfSpace } from "@/lib/desktop/menuBarNote";

describe("menu bar note: where new notes go", () => {
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

  it("lists Personal first, then the workspaces, leaving out locked folder names", async () => {
    const query = vi.fn(async (_fn: never, args: never) => {
      const scope = (args as { scope: { kind: string } }).scope;
      return { folders: scope.kind === "personal" ? [{ id: "p1", name: "Ideas", parentFolderId: null }, { id: "p2", name: "", parentFolderId: null, sealedName: { c: "x" } }] : [{ id: "w1", name: "Projects", parentFolderId: null }] };
    });
    const spaces = await noteSpaces({ query }, [{ id: "ws_1", name: "Studio", canEdit: true, logoUrl: "https://files/studio.png" }, { id: "ws_2", name: "Clients", canEdit: false }], { displayName: "Faisal", avatarUrl: null });
    expect(spaces.map((s) => [s.id, s.name, s.canEdit])).toEqual([
      ["personal", "Personal", true],
      ["ws_1", "Studio", true],
      ["ws_2", "Clients", false],
    ]);
    expect(spaces.map((s) => [s.imageUrl, s.markName])).toEqual([
      [null, "Faisal"],
      ["https://files/studio.png", "Studio"],
      [null, "Clients"],
    ]);
    expect(spaces[0]!.folders).toEqual([{ id: "p1", name: "Ideas", depth: 0 }]);
    expect(spaces[1]!.folders).toEqual([{ id: "w1", name: "Projects", depth: 0 }]);
  });

  it("reads the empty page's target: Drafts unless a folder is named", () => {
    expect(composerTarget(new URLSearchParams("panel=1&space=personal"))).toEqual({ space: "personal", folderId: null });
    expect(composerTarget(new URLSearchParams("panel=1&space=ws_1&folder=fld_s"))).toEqual({ space: "ws_1", folderId: "fld_s" });
    expect(composerTarget(new URLSearchParams("panel=1"))).toEqual({ space: "personal", folderId: null });
    expect(inMenuBarPanel(new URLSearchParams("panel=1"))).toBe(true);
    expect(inMenuBarPanel(new URLSearchParams(""))).toBe(false);
  });

  it("names Personal and workspaces as the server's scope", () => {
    expect(scopeOfSpace("personal")).toEqual({ kind: "personal" });
    expect(scopeOfSpace("ws_1")).toEqual({ kind: "workspace", workspaceId: "ws_1" });
  });
});

describe("menu bar note: a screenshot into the note", () => {
  it("is pasted into the note's editor as a file", () => {
    // jsdom has no DataTransfer and its ClipboardEvent takes no data (WebKit, where this runs, has both).
    class FakeTransfer {
      files: File[] = [];
      items = { add: (f: File) => void this.files.push(f) };
    }
    class FakeClipboardEvent extends Event {
      clipboardData: FakeTransfer | null;
      constructor(type: string, init: EventInit & { clipboardData?: FakeTransfer }) {
        super(type, init);
        this.clipboardData = init.clipboardData ?? null;
      }
    }
    vi.stubGlobal("DataTransfer", FakeTransfer);
    vi.stubGlobal("ClipboardEvent", FakeClipboardEvent);
    document.body.innerHTML = `<div class="ProseMirror" contenteditable="true"></div>`;
    const editor = document.querySelector<HTMLElement>(".ProseMirror")!;
    const seen: { files: File[] }[] = [];
    editor.addEventListener("paste", (e) => seen.push({ files: [...((e as ClipboardEvent).clipboardData?.files ?? [])] }));
    expect(pasteImage(document, btoa("png"), "image/png", "Screenshot.png")).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.files[0]!.name).toBe("Screenshot.png");
    expect(seen[0]!.files[0]!.type).toBe("image/png");
    vi.unstubAllGlobals();
  });

  it("says no when the page has no editor (the empty page)", () => {
    document.body.innerHTML = `<textarea></textarea>`;
    expect(pasteImage(document, btoa("png"), "image/png", "Screenshot.png")).toBe(false);
  });
});
