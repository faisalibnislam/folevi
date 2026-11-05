// The ⌘K palette (components/app/CommandPalette.tsx), QA audit 1.2.32: the field has the focus as soon as the
// palette opens, before another key arrives (F04), and each result is an option of its own with its title, what
// it is, whether it's selected, and a click that opens it (F05).
import { afterEach, describe, expect, test, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

const recent = [
  { id: "d1", title: "Cedar forest", icon: null, updatedAt: Date.now() - 60_000 },
  { id: "d2", title: "Violet bridge", icon: null, updatedAt: Date.now() - 120_000 },
  { id: "d3", title: "", icon: null, updatedAt: Date.now() - 180_000 },
];
const navigate = vi.fn();
vi.mock("convex/react", () => ({
  // Recent documents for the palette; nothing else is asked for while nothing is typed.
  useQuery: (_fn: unknown, args: unknown) => (args === "skip" ? undefined : recent),
  useAction: () => async () => [],
}));
vi.mock("@/lib/hooks/useLocalNotes", () => ({ useLocalSearch: () => [] }));
vi.mock("@/lib/mode", () => ({ useCanCall: () => false }));
vi.mock("@/lib/app/folders", () => ({ useFolderTree: () => ({ folders: [], tags: [] }) }));
vi.mock("@/lib/app/dragSession", () => ({ startPointerDrag: vi.fn() }));
vi.mock("@/lib/app/tabs", () => ({ openNextInNewTab: vi.fn() }));
vi.mock("@/lib/app/state", () => ({ useAppState: () => ({ scope: "personal", workspace: null, appearance: "light", setAppearance: vi.fn() }) }));
vi.mock("@/lib/app/router", () => ({ useAppRouter: () => ({ navigate }) }));
vi.mock("@/components/app/useCreateDocument", () => ({ useCreateDocument: () => vi.fn() }));
vi.mock("@/components/app/Shell", () => ({ useShell: () => ({ openAsk: vi.fn() }) }));
vi.mock("@/components/ai/useAi", () => ({ useAiEnabled: () => false }));
vi.mock("@/lib/iphone", () => ({ useIphoneApp: () => false }));

const { CommandPalette, paletteOptionLabel, paletteOptionDetail } = await import("@/components/app/CommandPalette");

// jsdom's <dialog> may lack the modal methods.
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
}

function mount() {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  return { host, root };
}

describe("command palette", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    navigate.mockReset();
  });

  test("the field has the focus in the same pass that opens the palette (F04)", () => {
    const { root } = mount();
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    editor.tabIndex = 0;
    document.body.append(editor);
    editor.focus();
    act(() => root.render(<CommandPalette open={false} onClose={() => {}} />));
    // One synchronous render for ⌘K: by the time it returns, keys go to the search field, not the note.
    act(() => root.render(<CommandPalette open onClose={() => {}} />));
    const field = document.querySelector<HTMLInputElement>('input[role="combobox"]');
    expect(field).not.toBeNull();
    expect(document.activeElement).toBe(field);
    act(() => root.unmount());
  });

  test("each result is an option with its title, kind, selected state and activation (F05)", () => {
    const { root } = mount();
    act(() => root.render(<CommandPalette open onClose={() => {}} />));
    const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
    const docs = options.filter((o) => o.getAttribute("aria-label")?.endsWith(", document"));
    expect(docs.map((o) => o.getAttribute("aria-label"))).toEqual(["Cedar forest, document", "Violet bridge, document", "Untitled, document"]);
    expect(docs.every((o) => o.getAttribute("aria-description")?.startsWith("Edited "))).toBe(true);
    expect(options.map((o) => o.getAttribute("aria-selected"))).toEqual(options.map((_, i) => String(i === 0)));
    // Commands are options too, named as commands.
    expect(options.some((o) => o.getAttribute("aria-label") === "New document, command")).toBe(true);
    // Activating the third match opens it.
    act(() => docs[2]!.click());
    expect(navigate).toHaveBeenCalledWith("/d/d3");
    act(() => root.unmount());
  });

  test("option names and details", () => {
    expect(paletteOptionLabel({ kind: "doc", title: "Kyoto", meaning: true })).toBe("Kyoto, document found by meaning");
    expect(paletteOptionLabel({ kind: "action", label: "Open Trash" })).toBe("Open Trash, command");
    expect(paletteOptionDetail({ kind: "doc", snippet: "a match", place: "Work" })).toBe("Work, a match");
    expect(paletteOptionDetail({ kind: "action", hint: "⌘J" })).toBe("Shortcut ⌘J");
    expect(paletteOptionDetail({ kind: "action" })).toBeUndefined();
  });
});
