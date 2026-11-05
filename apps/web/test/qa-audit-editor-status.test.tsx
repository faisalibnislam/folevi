// QA audit 1.2.32, the editor and note status findings: the Share button's state while loading (F01), where a
// new note says it lives (F13), the tools panel beside a joined note (F02), the floating bar's icons-only width
// (F03), one chip per suggested note (F24) and the In Trash status with Restore (F22).
import { afterEach, describe, expect, test, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { noteFolderIdOf, shareIndicatorLabel, shareIndicatorOf, type SharingLike } from "@/components/doc/noteStatus";
import { NOTE_MIN_WRITABLE, clampPanelWidth, toolsPanelOverlays } from "@/components/doc/panelLayout";
import { DOCK_COMPACT_BELOW, dockCompact } from "@/components/doc/PageDock";
import { SuggestionChips, groupSuggestions, type NoteSuggestion } from "@/components/doc/NoteSuggestions";
import { TrashBanner } from "@/components/doc/TrashBanner";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

function render(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(node));
  return host;
}

const sharing = (o: Partial<SharingLike> = {}): SharingLike => ({ links: [], youAreGuest: false, people: [{ isYou: true }], pendingInvites: [], accessMode: "restricted", ...o });

describe("F01: the Share button says nothing definite until it knows", () => {
  test("loading is neutral, never private", () => {
    expect(shareIndicatorOf(undefined, { sharingEnabled: true, workspaceId: "W1" })).toBe("loading");
    expect(shareIndicatorLabel("loading")).not.toMatch(/only you/i);
  });

  test("the first definite state matches the Share dialog's access", () => {
    expect(shareIndicatorOf(sharing({ accessMode: "workspace" }), { sharingEnabled: true, workspaceId: "W1" })).toBe("people");
    expect(shareIndicatorOf(sharing({ accessMode: "workspace" }), { sharingEnabled: true, workspaceId: null })).toBe("private");
    expect(shareIndicatorOf(sharing({ links: [{ expired: false }] }), { sharingEnabled: true, workspaceId: null })).toBe("link");
    expect(shareIndicatorOf(sharing({ links: [{ expired: true }] }), { sharingEnabled: true, workspaceId: null })).toBe("private");
    expect(shareIndicatorOf(sharing({ people: [{ isYou: true }, { isYou: false }] }), { sharingEnabled: true, workspaceId: null })).toBe("people");
    expect(shareIndicatorOf(sharing({ youAreGuest: true }), { sharingEnabled: true, workspaceId: null })).toBe("people");
    expect(shareIndicatorOf(sharing(), { sharingEnabled: true, workspaceId: "W1" })).toBe("private");
    expect(shareIndicatorLabel("private")).toBe("Only you can open this");
  });

  test("without sharing (local mode) a note is only yours, at once", () => {
    expect(shareIndicatorOf(undefined, { sharingEnabled: false, workspaceId: null })).toBe("private");
  });
});

describe("F13: a new note's place", () => {
  test("a note made in a folder names that folder before the server answers", () => {
    expect(noteFolderIdOf({ movedTo: undefined, meta: undefined, createdIn: "F1" })).toBe("F1");
    expect(noteFolderIdOf({ movedTo: undefined, meta: undefined, createdIn: null })).toBeNull();
  });

  test("unknown while nothing says (no guess of Drafts)", () => {
    expect(noteFolderIdOf({ movedTo: undefined, meta: undefined, createdIn: undefined })).toBeUndefined();
  });

  test("the server's answer, then a waiting move, win", () => {
    expect(noteFolderIdOf({ movedTo: undefined, meta: { folder: { id: "F2" } }, createdIn: "F1" })).toBe("F2");
    expect(noteFolderIdOf({ movedTo: undefined, meta: { folder: null }, createdIn: undefined })).toBeNull();
    expect(noteFolderIdOf({ movedTo: "F3", meta: { folder: { id: "F2" } }, createdIn: undefined })).toBe("F3");
    expect(noteFolderIdOf({ movedTo: null, meta: { folder: { id: "F2" } }, createdIn: undefined })).toBeNull();
  });
});

describe("F02: the tools panel never squeezes a note below a writable width", () => {
  test("beside a wide note, over a narrow one", () => {
    expect(toolsPanelOverlays({ narrowWindow: false, rowWidth: 1400, panelWidth: 280 })).toBe(false);
    // One of three joined notes on a wide window: about 600 wide, with a 280 panel the note would be 320.
    expect(toolsPanelOverlays({ narrowWindow: false, rowWidth: 600, panelWidth: 280 })).toBe(true);
    expect(toolsPanelOverlays({ narrowWindow: false, rowWidth: 280 + NOTE_MIN_WRITABLE, panelWidth: 280 })).toBe(false);
    expect(toolsPanelOverlays({ narrowWindow: false, rowWidth: 279 + NOTE_MIN_WRITABLE, panelWidth: 280 })).toBe(true);
  });

  test("a wider panel needs a wider note row; a narrow window always overlays", () => {
    expect(toolsPanelOverlays({ narrowWindow: false, rowWidth: 900, panelWidth: 520 })).toBe(true);
    expect(toolsPanelOverlays({ narrowWindow: true, rowWidth: 2000, panelWidth: 280 })).toBe(true);
    expect(clampPanelWidth(Number.NaN)).toBe(280);
    expect(clampPanelWidth(9999)).toBe(520);
  });
});

describe("F03: the floating bar fits the note it floats over", () => {
  test("icons only below the width its words need, measured on the note (a tools panel beside it counts)", () => {
    expect(dockCompact(0)).toBe(false);
    expect(dockCompact(DOCK_COMPACT_BELOW - 1)).toBe(true);
    expect(dockCompact(DOCK_COMPACT_BELOW)).toBe(false);
    // A 700 wide pane with Style open beside its note: 420 left for the bar.
    expect(dockCompact(700 - 280)).toBe(true);
  });
});

describe("F24: one chip per suggested note", () => {
  const items: NoteSuggestion[] = [
    { key: "link:N2", kind: "connection", label: "Cedar", noteId: "N2", reason: "Both mention Cedar" },
    { key: "q:B1", kind: "question", label: "Who owns it?", blockId: "B1" },
    { key: "dup:N2", kind: "duplicate", label: "Cedar", noteId: "N2" },
    { key: "dup:N3", kind: "duplicate", label: "Cedar", noteId: "N3" },
  ];

  test("both reasons for one note make one chip, the duplicate leading", () => {
    const chips = groupSuggestions(items);
    expect(chips.map((c) => [c.lead.key, c.all.map((x) => x.key), c.reason])).toEqual([
      ["dup:N2", ["link:N2", "dup:N2"], "Possible duplicate, also related"],
      ["q:B1", ["q:B1"], "Open question"],
      ["dup:N3", ["dup:N3"], "Possible duplicate"],
    ]);
  });

  test("the reason is in the chip's visible text, and dismissing it dismisses every reason", () => {
    const on = { onOpen: vi.fn(), onLink: vi.fn(), onTask: vi.fn(), onDismiss: vi.fn() };
    const host = render(<SuggestionChips items={items} canEdit {...on} />);
    const lis = [...host.querySelectorAll("li")];
    expect(lis).toHaveLength(3);
    expect(lis[0]!.querySelector("button")!.textContent).toBe("CedarPossible duplicate, also related");
    expect(lis[2]!.querySelector("button")!.textContent).toBe("CedarPossible duplicate");
    expect(lis[0]!.getAttribute("aria-label")).toBe("Possible duplicate, also related: Cedar");
    expect(lis[0]!.querySelector("button")!.title).toBe("Both mention Cedar");
    act(() => [...lis[0]!.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Dismiss")!.click());
    expect(on.onDismiss.mock.calls.map((c) => (c[0] as NoteSuggestion).key)).toEqual(["link:N2", "dup:N2"]);
  });
});

describe("F22: a note in Trash says so, with Restore", () => {
  test("a persistent status with a Restore button", () => {
    const onRestore = vi.fn();
    const host = render(<TrashBanner canRestore onRestore={onRestore} />);
    const section = host.querySelector('[data-note-status="trash"]')!;
    expect(section.querySelector("h2")!.textContent).toBe("In Trash");
    const restore = [...section.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Restore")!;
    act(() => restore.click());
    expect(onRestore).toHaveBeenCalledOnce();
  });

  test("without edit access: the status, no Restore", () => {
    const host = render(<TrashBanner canRestore={false} onRestore={() => undefined} />);
    expect(host.querySelector('[data-note-status="trash"]')).not.toBeNull();
    expect(host.querySelectorAll("button")).toHaveLength(0);
  });

  test("toasts sit above a note's floating page tools", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const css = readFileSync(join(__dirname, "../src/app/globals.css"), "utf8");
    expect(css).toMatch(/:has\(\[role="toolbar"\]\[aria-label="Page tools"\]\) \.ui-toasts \{ bottom: calc\(6rem/);
  });
});
