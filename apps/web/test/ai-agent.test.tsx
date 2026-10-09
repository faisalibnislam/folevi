// The AI agent in the chat (docs/AI_ASSISTANT.md milestone 3): its steps in a few words, the preview card
// with a checkbox per change (nothing happens until Approve), partial approval, the report with links, and
// Undo, including the question when notes changed since.
import { afterEach, describe, expect, test, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AgentRunCard, resultHref, type AgentOperation, type AgentRun, type RunActivity } from "@/components/ai/chat/AgentRunCard";
import { phaseLabel, stepLines } from "@/components/ai/chat/chatText";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

function op(o: Partial<AgentOperation> & Pick<AgentOperation, "id" | "kind" | "summary">): AgentOperation {
  return {
    status: "proposed",
    error: null,
    noteId: null,
    noteTitle: null,
    title: null,
    fromTitle: null,
    folderName: null,
    fromFolderName: null,
    movesOut: false,
    markdown: null,
    edits: [],
    items: [],
    tags: [],
    sources: [],
    result: null,
    verified: null,
    undone: null,
    ...o,
  };
}

const PREVIEW: AgentRun = {
  id: "RUN1",
  status: "preview",
  executedAt: null,
  undoneAt: null,
  changed: null,
  operations: [
    op({ id: "op1", kind: "rename_note", summary: "Rename “Plans” to “Trip plans”", noteId: "N1", noteTitle: "Plans", fromTitle: "Plans", title: "Trip plans" }),
    op({ id: "op2", kind: "update_note", summary: "Edit “Plans” (1 change)", noteId: "N1", noteTitle: "Plans", edits: [{ action: "replace", before: "Book the ferry", after: "Book the early ferry" }] }),
    op({ id: "op3", kind: "create_folder", summary: "New folder “Travel”", folderName: "Travel" }),
  ],
};

const IDLE: RunActivity = { busy: null, error: null };

function mount(run: AgentRun, activity: RunActivity = IDLE) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  const calls = { approve: vi.fn(), discard: vi.fn(), undo: vi.fn(), open: vi.fn() };
  const render = (r: AgentRun, a: RunActivity = activity) =>
    act(() => root.render(<AgentRunCard run={r} activity={a} onApprove={calls.approve} onDiscard={calls.discard} onUndo={calls.undo} onOpen={calls.open} />));
  render(run);
  const button = (name: string | RegExp) => [...host.querySelectorAll("button")].find((b) => (typeof name === "string" ? b.textContent?.trim() === name : name.test(b.textContent ?? "")))!;
  return { host, root, calls, render, button };
}

describe("steps", () => {
  test("an agent's steps read as a few short lines, in order", () => {
    expect(
      stepLines([
        { tool: "search_notes", count: 4, ok: true },
        { tool: "get_note", count: 1, ok: true },
        { tool: "get_notes", count: 2, ok: true },
        { tool: "search_notes", count: 1, ok: true },
        { tool: "rename_note", count: 1, ok: true },
        { tool: "move_note", count: 1, ok: true },
        { tool: "rename_note", count: 0, ok: false },
        { tool: "calculate", count: 0, ok: true },
      ]),
    ).toEqual(["Searched notes 2 times", "Read 3 notes", "Proposed 2 changes", "Did a calculation", "A step didn't work"]);
    expect(stepLines([{ tool: "get_note", count: 1, ok: true }])).toEqual(["Read a note"]);
    expect(stepLines([])).toEqual([]);
    expect(phaseLabel("planning", false)).toBe("Planning…");
  });
});

describe("the preview card", () => {
  test("every change has its own checkbox; approving sends only the chosen ones; nothing is sent before", async () => {
    const { host, calls, button } = mount(PREVIEW);
    expect(host.textContent).toContain("Nothing changes until you approve");
    const boxes = [...host.querySelectorAll<HTMLButtonElement>('[role="checkbox"]')];
    expect(boxes.map((b) => [b.textContent, b.getAttribute("aria-checked")])).toEqual([
      ["Rename “Plans” to “Trip plans”", "true"],
      ["Edit “Plans” (1 change)", "true"],
      ["New folder “Travel”", "true"],
    ]);
    expect(calls.approve).not.toHaveBeenCalled();
    await act(async () => boxes[2]!.click());
    expect(boxes[2]!.getAttribute("aria-checked")).toBe("false");
    await act(async () => button("Approve selected (2)").click());
    expect(calls.approve).toHaveBeenCalledWith(["op1", "op2"]);
    // None chosen: nothing to approve.
    await act(async () => button("Select all").click());
    expect(boxes.every((b) => b.getAttribute("aria-checked") === "true")).toBe(true);
    await act(async () => button("Select none").click());
    expect(button(/Approve/).disabled).toBe(true);
    await act(async () => button("Discard").click());
    expect(calls.discard).toHaveBeenCalled();
  });

  test("a change's preview shows what it removes and adds, on demand", async () => {
    const { host, button } = mount(PREVIEW);
    const toggles = [...host.querySelectorAll<HTMLButtonElement>("button[aria-expanded]")];
    expect(toggles.every((t) => t.getAttribute("aria-expanded") === "false")).toBe(true);
    await act(async () => toggles[1]!.click());
    expect(toggles[1]!.getAttribute("aria-expanded")).toBe("true");
    const region = host.querySelector(`#${CSS.escape(toggles[1]!.getAttribute("aria-controls")!)}`)!;
    expect(region.querySelector("ins")?.textContent).toContain("early");
    expect(host.textContent).toContain("Changed");
    void button;
  });

  test("while applying: progress; after: what happened, links to the notes, and Undo", async () => {
    const { host, calls, render, button } = mount({ ...PREVIEW, status: "executing", operations: PREVIEW.operations.map((o, i) => (i === 0 ? { ...o, status: "applied" } : o)) });
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Applying 2 of 3");
    const done: AgentRun = {
      ...PREVIEW,
      status: "partial",
      executedAt: 1,
      operations: [
        { ...PREVIEW.operations[0]!, status: "applied", verified: true, result: { noteId: "N1", folderId: null, title: "Trip plans" } },
        { ...PREVIEW.operations[1]!, status: "failed", error: "“Plans” changed after this was proposed, so it wasn't changed." },
        { ...PREVIEW.operations[2]!, status: "skipped" },
      ],
    };
    render(done);
    expect(host.textContent).toContain("1 change made, 1 couldn't be made.");
    expect(host.textContent).toContain("changed after this was proposed");
    await act(async () => button("Open Trip plans").click());
    expect(calls.open).toHaveBeenCalledWith("/d/N1");
    await act(async () => button("Undo").click());
    expect(calls.undo).toHaveBeenCalledWith();
    expect(resultHref({ ...PREVIEW.operations[2]!, result: { noteId: null, folderId: "F1", title: "Travel" } })).toBe("/folders/F1");
  });

  test("Undo asks first when notes changed since: undo anyway, undo the rest, or cancel", async () => {
    const changed: AgentRun = {
      ...PREVIEW,
      status: "done",
      executedAt: 1,
      changed: [{ key: "note:N1", label: "“Trip plans” was edited after the AI changed it." }],
      operations: PREVIEW.operations.map((o) => ({ ...o, status: "applied" as const })),
    };
    const { host, calls, button, render } = mount(changed);
    const alert = host.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain("was edited after the AI changed it");
    await act(async () => button("Undo anyway").click());
    expect(calls.undo).toHaveBeenLastCalledWith("all");
    await act(async () => button("Undo the rest").click());
    expect(calls.undo).toHaveBeenLastCalledWith("rest");
    await act(async () => button("Cancel").click());
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(button("Undo")).toBeTruthy();
    // Undone: said plainly, with nothing left to approve or undo.
    render({ ...changed, status: "undone", changed: null, undoneAt: 2, operations: changed.operations.map((o, i) => ({ ...o, undone: i === 0 ? ("kept" as const) : ("done" as const) })) });
    expect(host.textContent).toContain("Undone");
    expect(host.textContent).toContain("Left as it was.");
    expect([...host.querySelectorAll("button")].some((b) => b.textContent?.trim() === "Undo")).toBe(false);
  });

  test("a failed action shows its message on the card", () => {
    const { host } = mount(PREVIEW, { busy: null, error: "Too many requests. Please wait a moment and try again." });
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Too many requests. Please wait a moment and try again.");
  });
});
