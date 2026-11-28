// The Mac menu bar's quick notes, the page's side (lib/desktop/quickNotes.ts): the destination list, the checks on
// what the Mac sends, the save (images uploaded first, then the note from Markdown in the chosen folder), and that
// the Markdown the Mac's editor writes (bullets, checklists, dividers, images) becomes Folevi blocks.
import { describe, expect, it, vi } from "vitest";
import { markdownToBlocks } from "@folevi/editor-schema";
import { folderTree, quickNoteSpaces, saveQuickNote, scopeOfSpace, validateSave } from "@/lib/desktop/quickNotes";
import { uploadFileNow } from "@/lib/sync/uploads";

vi.mock("@/lib/sync/uploads", () => ({ uploadFileNow: vi.fn(async () => "file-1") }));

describe("quick notes on the Mac: where a note can go", () => {
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
    const spaces = await quickNoteSpaces({ query }, [{ id: "ws_1", name: "Studio", canEdit: true }, { id: "ws_2", name: "Clients", canEdit: false }]);
    expect(spaces.map((s) => [s.id, s.name, s.canEdit])).toEqual([
      ["personal", "Personal", true],
      ["ws_1", "Studio", true],
      ["ws_2", "Clients", false],
    ]);
    expect(spaces[0]!.folders).toEqual([{ id: "p1", name: "Ideas", depth: 0 }]);
    expect(spaces[1]!.folders).toEqual([{ id: "w1", name: "Projects", depth: 0 }]);
  });

  it("names Personal and workspaces as the server's scope", () => {
    expect(scopeOfSpace("personal")).toEqual({ kind: "personal" });
    expect(scopeOfSpace("ws_1")).toEqual({ kind: "workspace", workspaceId: "ws_1" });
  });
});

describe("quick notes on the Mac: saving", () => {
  it("refuses what isn't a quick note", () => {
    expect(validateSave(null)).toBeNull();
    expect(validateSave({ space: "personal", title: "a" })).toBeNull();
    expect(validateSave({ space: "personal", title: "a", markdown: "b", images: [{ ref: "x", mime: "text/html", data: "" }] })).toBeNull();
    expect(validateSave({ space: "personal", title: "a", markdown: "b", folderId: 4 })).toBeNull();
    expect(validateSave({ space: "personal", title: "a".repeat(300), markdown: "b" })).toEqual({ space: "personal", folderId: null, title: "a".repeat(200), markdown: "b", images: [] });
  });

  it("uploads the images it uses, then makes the note in the folder", async () => {
    const importText = vi.fn(async () => ({ document: { id: "doc_1" } }));
    const id = await saveQuickNote({} as never, importText, {
      space: "ws_1",
      folderId: "fld_1",
      title: "Bug report",
      markdown: "Steps\n\n![Screenshot](quick-note-image-1)",
      images: [
        { ref: "quick-note-image-1", mime: "image/png", name: "Screenshot.png", data: btoa("png") },
        { ref: "quick-note-image-2", mime: "image/png", name: "Unused.png", data: btoa("x") },
      ],
    });
    expect(id).toBe("doc_1");
    expect(vi.mocked(uploadFileNow)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(uploadFileNow).mock.calls[0]![1]).toMatchObject({ scope: { kind: "workspace", workspaceId: "ws_1" }, filename: "Screenshot.png", mimeType: "image/png", kind: "image" });
    expect(importText).toHaveBeenCalledWith({ scope: { kind: "workspace", workspaceId: "ws_1" }, filename: "Bug report", content: "Steps\n\n![Screenshot](quick-note-image-1)", format: "markdown", folderId: "fld_1", imageMap: { "quick-note-image-1": "file-1" } });
  });

  it("goes to Drafts with no folder, Untitled with no title", async () => {
    const importText = vi.fn(async () => ({ document: { id: "doc_2" } }));
    await saveQuickNote({} as never, importText, { space: "personal", folderId: null, title: "", markdown: "just text", images: [] });
    expect(importText).toHaveBeenCalledWith({ scope: { kind: "personal" }, filename: "Untitled", content: "just text", format: "markdown" });
  });

  it("reads the Mac editor's Markdown as Folevi blocks", () => {
    const md = "Intro with **bold** and *italic*\n\n- one\n    - nested\n- [ ] open task\n- [x] done task\n1. first\n\n---\n\n![Shot](quick-note-image-1)";
    const { blocks } = markdownToBlocks(md, { resolveImage: (src) => (src === "quick-note-image-1" ? { fileId: "file-1" } : null) });
    const types = blocks.map((b) => (b as { type: string }).type);
    expect(types).toContain("paragraph");
    expect(types.some((t) => /bullet/i.test(t))).toBe(true);
    expect(types.some((t) => /todo|check|task/i.test(t))).toBe(true);
    expect(types.some((t) => /divider|rule/i.test(t))).toBe(true);
    expect(types.some((t) => /image/i.test(t))).toBe(true);
  });
});
