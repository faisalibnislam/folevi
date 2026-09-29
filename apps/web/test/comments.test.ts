import { describe, expect, test, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { ALL_MARKS, ALL_NODES } from "@/components/editor/extensions";
import { BlockDecorations, BlockIdentity, blockElements, decorationsKey, type DecorationInputs } from "@/components/editor/plugins";
import { notificationHref } from "@/components/app/NotificationsButton";

const para = (id: string, text: string) => ({ type: "paragraph", attrs: { id, depth: 0 }, content: [{ type: "text", text }] });

function editorWithComments(summaries: DecorationInputs["commentSummaries"], onOpenComments = vi.fn()) {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({ element, extensions: [...ALL_NODES, ...ALL_MARKS, BlockIdentity, BlockDecorations], content: { type: "doc", content: [para("a", "First"), para("b", "Second"), para("c", "Third")] } });
  const inputs: DecorationInputs = { presence: [], commentBlocks: new Set(), selectedBlocks: new Set(), conflictBlocks: new Set(), commentSummaries: summaries, onOpenComments };
  editor.view.dispatch(editor.state.tr.setMeta(decorationsKey, inputs));
  return { editor, onOpenComments };
}

describe("comment lines under blocks", () => {
  test("a block with open comments gets a line that opens its thread; block lookups skip it", () => {
    const { editor, onOpenComments } = editorWithComments(new Map([["b", { count: 2, lastActivityAt: Date.now(), unread: true, authors: [{ name: "Faisal", avatarUrl: null }, { name: "Mira", avatarUrl: null }] }]]));
    const dom = editor.view.dom as HTMLElement;
    const chip = dom.querySelector<HTMLButtonElement>('[data-comment-chip="b"]')!;
    expect(chip).toBeTruthy();
    expect(chip.getAttribute("aria-label")).toMatch(/^2 comments, latest .+, unread\. Open comments$/);
    expect(chip.textContent).toMatch(/^FM2 comments · /);
    // It sits right after its block, and doesn't count as a block.
    expect(chip.closest("[data-fb-widget]")!.previousElementSibling!.getAttribute("data-block-id")).toBe("b");
    expect(blockElements(dom).map((el) => el.getAttribute("data-block-id"))).toEqual(["a", "b", "c"]);
    chip.click();
    expect(onOpenComments).toHaveBeenCalledWith("b");
    // The line is decoration only: the document is unchanged.
    expect(editor.getText()).toBe("First\n\nSecond\n\nThird");
    editor.destroy();
  });

  test("no summaries, no lines", () => {
    const { editor } = editorWithComments(new Map());
    expect(editor.view.dom.querySelectorAll("[data-fb-widget]")).toHaveLength(0);
    editor.destroy();
  });
});

describe("notification links", () => {
  test("open the note on the thread, else the block, else the note", () => {
    expect(notificationHref({ documentId: "D1", threadId: "T1", blockId: "B1" })).toBe("/d/D1#comment-T1");
    expect(notificationHref({ documentId: "D1", threadId: null, blockId: "B1" })).toBe("/d/D1#block-B1");
    expect(notificationHref({ documentId: "D1", threadId: null, blockId: null })).toBe("/d/D1");
    // Nothing to open when the note isn't readable any more.
    expect(notificationHref({ documentId: null, threadId: null, blockId: null })).toBeNull();
  });
});
