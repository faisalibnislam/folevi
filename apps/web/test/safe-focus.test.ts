// The editor's focus never keeps an editor alive (components/editor/safeFocus.ts): tiptap focused on the next
// animation frame, which a hidden window never draws, so every focus there held its editor after the note had gone.
import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { ALL_MARKS, ALL_NODES, BlockFormat } from "@/components/editor/extensions";
import { BlockIdentity } from "@/components/editor/plugins";
import { SafeFocus } from "@/components/editor/safeFocus";

const p = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });

function editor() {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({ element, extensions: [...ALL_NODES, ...ALL_MARKS, BlockFormat, BlockIdentity, SafeFocus], content: { type: "doc", content: [p("One"), p("Two")] } });
}

const visibility = (state: "visible" | "hidden") => vi.spyOn(document, "visibilityState", "get").mockReturnValue(state);

describe("the editor's focus", () => {
  afterEach(() => vi.restoreAllMocks());

  it("in a hidden window focuses at once and waits for no frame", () => {
    visibility("hidden");
    const raf = vi.spyOn(window, "requestAnimationFrame");
    const ed = editor();
    ed.commands.focus("end", { scrollIntoView: false });
    expect(raf).not.toHaveBeenCalled();
    expect(ed.state.selection.from).toBe(ed.state.doc.content.size - 1);
    ed.destroy();
  });

  it("in a visible one waits for the frame as before, and the frame goes with the editor", () => {
    visibility("visible");
    const callbacks = new Map<number, FrameRequestCallback>();
    let next = 1;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      callbacks.set(next, cb);
      return next++;
    });
    const cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => void callbacks.delete(id));
    const ed = editor();
    ed.commands.focus("start", { scrollIntoView: false });
    expect(callbacks.size).toBe(1);
    // A frame that comes focuses (the editor's own frames are let be).
    const [id, cb] = [...callbacks][0]!;
    callbacks.delete(id);
    cb(0);
    ed.commands.focus("end", { scrollIntoView: false });
    expect(callbacks.size).toBe(1);
    const pending = [...callbacks.keys()][0]!;
    ed.destroy();
    // The editor gone, its frame is too: nothing holds the editor any more.
    expect(cancel).toHaveBeenCalledWith(pending);
    expect(callbacks.has(pending)).toBe(false);
  });

  it("is the focus the editor's commands use", () => {
    visibility("hidden");
    const ed = editor();
    expect(ed.extensionManager.extensions.at(-1)?.name).toBe("safeFocus");
    ed.destroy();
  });
});
