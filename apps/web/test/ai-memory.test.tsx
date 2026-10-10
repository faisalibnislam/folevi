// Memory, suggestions and digests on the web (docs/AI_ASSISTANT.md milestone 8, part A): the memory list
// in Settings > AI, the save-memory card under a chat answer, a note's suggestion chips, and the editor
// changes the chips make (a line turned into a task, a [[ link added).
import { afterEach, describe, expect, test, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Editor } from "@tiptap/core";
import { UndoRedo } from "@tiptap/extensions";
import type { WireBlock } from "@folevi/editor-schema";
import { ALL_MARKS, ALL_NODES } from "@/components/editor/extensions";
import { blocksToDoc, docToBlocks } from "@/components/editor/convert";
import type { Id } from "@/lib/convex/api";
import { MemoryList, type MemoryItem } from "@/components/views/settings/AiMemory";
import { hourLabel, nextLabel } from "@/components/views/settings/AiDigest";
import { SaveMemoryCard } from "@/components/ai/chat/SaveMemoryCard";
import { appendPageLink, lineToTask, SuggestionChips, type NoteSuggestion } from "@/components/doc/NoteSuggestions";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

function render(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(node));
  return { host, root };
}

/** Types into a controlled input the way React hears it. */
function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const button = (host: HTMLElement, name: string) => [...host.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") ?? b.textContent?.trim()) === name)!;

const memory = (id: string, kind: MemoryItem["kind"], text: string, workspace: MemoryItem["workspace"] = null): MemoryItem => ({ id: id as Id<"aiMemories">, kind, text, source: "settings", workspace, updatedAt: 1 });

describe("the memory list", () => {
  const handlers = () => ({
    onAdd: vi.fn(async () => null),
    onUpdate: vi.fn(async () => null),
    onRemove: vi.fn(async () => null),
    onClear: vi.fn(async () => 0),
  });

  test("lists entries, adds one, edits and deletes", async () => {
    const h = handlers();
    const { host } = render(<MemoryList on max={40} items={[memory("m1", "language", "Use British spelling"), memory("m2", "term", "Atlas is the rebrand", { id: "W1", name: "Studio" })]} workspaces={[{ id: "W1", name: "Studio" }]} {...h} />);
    const list = host.querySelector('ul[aria-label="What Foli remembers"]')!;
    expect([...list.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["LanguageUse British spelling", "TermAtlas is the rebrandOnly in Studio"]);
    expect(host.textContent).not.toContain("Memory is off");

    // Add: what's typed, with the kind and (here) where it applies.
    const add = host.querySelector("form")!;
    const input = add.querySelector<HTMLInputElement>('input[aria-label="What to remember"]')!;
    expect(button(host, "Add").disabled).toBe(true);
    typeInto(input, "  Keep answers short ");
    await act(async () => add.requestSubmit());
    expect(h.onAdd).toHaveBeenCalledWith("instruction", "Keep answers short", null);
    expect(input.value).toBe("");

    // Edit in place, then save.
    act(() => button(host, 'Edit "Use British spelling"').click());
    const edit = list.querySelector("form")!;
    typeInto(edit.querySelector<HTMLInputElement>("input")!, "Use Canadian spelling");
    await act(async () => edit.requestSubmit());
    expect(h.onUpdate).toHaveBeenCalledWith("m1", "language", "Use Canadian spelling");

    act(() => button(host, 'Delete "Atlas is the rebrand"').click());
    expect(h.onRemove).toHaveBeenCalledWith("m2");
  });

  test("off: says so, nothing can be added, entries can still be deleted", () => {
    const h = handlers();
    const { host } = render(<MemoryList on={false} max={40} items={[memory("m1", "tone", "Warm")]} workspaces={[]} {...h} />);
    expect(host.querySelector('[role="status"]')?.textContent).toMatch(/^Memory is off/);
    expect(host.querySelector('input[aria-label="What to remember"]')).toBeNull();
    act(() => button(host, 'Delete "Warm"').click());
    expect(h.onRemove).toHaveBeenCalledWith("m1");
    expect(button(host, "Clear all")).toBeTruthy();
  });

  test("empty, and full", () => {
    const { host } = render(<MemoryList on max={1} items={[]} workspaces={[]} {...handlers()} />);
    expect(host.textContent).toContain("Nothing yet.");
    expect(button(host, "Clear all")).toBeUndefined();
    const full = render(<MemoryList on max={1} items={[memory("m1", "tone", "Warm")]} workspaces={[]} {...handlers()} />);
    typeInto(full.host.querySelector<HTMLInputElement>('input[aria-label="What to remember"]')!, "Another");
    expect(button(full.host, "Add").disabled).toBe(true);
  });
});

describe("the save-memory card", () => {
  test("offers Save and Not now, then says it's saved; dismissed shows nothing", () => {
    const onSave = vi.fn();
    const onDismiss = vi.fn();
    const offer = { kind: "language" as const, text: "Prefers British spelling.", status: "proposed" as const };
    const { host, root } = render(<SaveMemoryCard memory={offer} onSave={onSave} onDismiss={onDismiss} />);
    expect(host.querySelector('[role="group"]')?.getAttribute("aria-label")).toBe("Remember this?");
    expect(host.textContent).toContain("Remember this for next time?Prefers British spelling.");
    act(() => button(host, "Save").click());
    act(() => button(host, "Not now").click());
    expect(onSave).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
    act(() => root.render(<SaveMemoryCard memory={{ ...offer, status: "saved" }} onSave={onSave} onDismiss={onDismiss} />));
    expect(host.textContent).toContain("Saved to memory.");
    expect(button(host, "Save")).toBeUndefined();
    act(() => root.render(<SaveMemoryCard memory={{ ...offer, status: "dismissed" }} onSave={onSave} onDismiss={onDismiss} />));
    expect(host.innerHTML).toBe("");
  });

  test("busy while it saves", () => {
    const { host } = render(<SaveMemoryCard memory={{ kind: "tone", text: "Warm", status: "proposed" }} busy onSave={() => {}} onDismiss={() => {}} />);
    expect(button(host, "Save").disabled).toBe(true);
  });
});

describe("suggestion chips", () => {
  const items: NoteSuggestion[] = [
    { key: "q:B1", kind: "question", label: "Who owns the checklist?", blockId: "B1" },
    { key: "act:B2", kind: "action", label: "send the deck to Sam", blockId: "B2", strip: 6 },
    { key: "link:N2", kind: "connection", label: "Atlas budget", noteId: "N2", reason: "Both mention Project Atlas" },
    { key: "dup:N3", kind: "duplicate", label: "Plan (copy)", noteId: "N3" },
  ];

  test("quiet chips with the actions each kind allows", () => {
    const on = { onOpen: vi.fn(), onLink: vi.fn(), onTask: vi.fn(), onDismiss: vi.fn() };
    const { host } = render(<SuggestionChips items={items} canEdit {...on} />);
    const section = host.querySelector('section[aria-label="Suggestions"]')!;
    const chips = [...section.querySelectorAll("li")];
    expect(chips.map((c) => c.getAttribute("aria-label"))).toEqual(["Open question: Who owns the checklist?", "Action item: send the deck to Sam", "Related: Atlas budget", "Possible duplicate: Plan (copy)"]);
    const names = (li: Element) => [...li.querySelectorAll("button")].map((b) => b.getAttribute("aria-label") ?? "open");
    expect(chips.map(names)).toEqual([
      ["open", "Dismiss"],
      ["open", "Turn into a task", "Dismiss"],
      ["open", "Link it here", "Dismiss"],
      ["open", "Link it here", "Dismiss"],
    ]);
    act(() => chips[0]!.querySelector("button")!.click());
    expect(on.onOpen).toHaveBeenCalledWith(items[0]);
    act(() => button(chips[1] as HTMLElement, "Turn into a task").click());
    expect(on.onTask).toHaveBeenCalledWith(items[1]);
    act(() => button(chips[2] as HTMLElement, "Link it here").click());
    expect(on.onLink).toHaveBeenCalledWith(items[2]);
    act(() => button(chips[3] as HTMLElement, "Dismiss").click());
    expect(on.onDismiss).toHaveBeenCalledWith(items[3]);
    expect(chips[2]!.querySelector("button")!.title).toBe("Both mention Project Atlas");
  });

  test("read-only: open and dismiss only; nothing to show: nothing at all", () => {
    const on = { onOpen: vi.fn(), onLink: vi.fn(), onTask: vi.fn(), onDismiss: vi.fn() };
    const { host } = render(<SuggestionChips items={items} canEdit={false} {...on} />);
    expect(host.querySelectorAll('button[aria-label="Turn into a task"], button[aria-label="Link it here"]')).toHaveLength(0);
    const empty = render(<SuggestionChips items={[]} canEdit {...on} />);
    expect(empty.host.innerHTML).toBe("");
  });
});

describe("what the chips change in the note", () => {
  const block = (id: string, text: string): WireBlock => ({ id, type: "paragraph", parentId: null, rank: id === "01JSUGGESTWEB0000000000000A" ? "M" : "V", schemaVersion: 1, text: [{ type: "text", text }], props: {} });
  const A = "01JSUGGESTWEB0000000000000A";
  const B = "01JSUGGESTWEB0000000000000B";
  const editor = () => new Editor({ extensions: [...ALL_NODES, ...ALL_MARKS, UndoRedo], content: blocksToDoc([block(A, "TODO: send the deck to Sam"), block(B, "Notes")]) });

  test("a line becomes an unchecked to-do without its marker, undone in one step", () => {
    const ed = editor();
    expect(lineToTask(ed, A, 6)).toBe(true);
    const [task] = docToBlocks(ed.state.doc, new Map());
    expect(task).toMatchObject({ id: A, type: "todo", props: { checked: false }, text: [{ type: "text", text: "send the deck to Sam" }] });
    expect(lineToTask(ed, A, 6)).toBe(false);
    expect(lineToTask(ed, "missing", 0)).toBe(false);
    ed.commands.undo();
    expect(docToBlocks(ed.state.doc, new Map())[0]).toMatchObject({ type: "paragraph", text: [{ type: "text", text: "TODO: send the deck to Sam" }] });
    ed.destroy();
  });

  test("a [[ link to the other note at the end", () => {
    const ed = editor();
    expect(appendPageLink(ed, "N2", "Atlas budget")).toBe(true);
    const blocks = docToBlocks(ed.state.doc, new Map());
    expect(blocks).toHaveLength(3);
    expect(blocks[2]!.text).toEqual([{ type: "pageLink", documentId: "N2", label: "Atlas budget" }]);
    ed.destroy();
  });
});

describe("digest settings", () => {
  test("hours and the next time read in the person's own way", () => {
    expect(hourLabel(8, "en-GB")).toBe("8:00");
    expect(hourLabel(15, "en-US")).toBe("3:00 PM");
    // 06:00 UTC is 08:00 in Berlin.
    expect(nextLabel(Date.UTC(2026, 9, 12, 6), "Europe/Berlin", "en-GB")).toMatch(/^Monday 12 October.* 8:00$/);
  });
});
