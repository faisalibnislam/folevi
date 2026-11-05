// QA audit 1.2.32: the Templates count (F08), note cards' two named times (F14) and Quick add's missing-title
// message under the title field (F16).
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const added = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock("convex/react", () => ({
  useMutation: () => async (args: unknown) => {
    added.calls.push(args);
    return { documentId: "d1" };
  },
  useQuery: () => undefined,
}));
vi.mock("@/lib/app/state", () => ({
  useAppState: () => ({ scope: { kind: "personal" }, today: "2026-11-05", deviceId: null, engine: null, profile: { id: "p1" }, online: true }),
}));
vi.mock("@/lib/app/router", () => ({ useAppRouter: () => ({ navigate: vi.fn(), route: { name: "tasks" } }), AppLink: (p: { children: unknown }) => p.children }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ show: vi.fn() }), errorMessage: (e: unknown) => String((e as Error)?.message ?? e) }));

const { createdText, editedText, templatesCountText } = await import("@/lib/format");
const { QuickAddForm } = await import("@/components/app/QuickAddTask");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("labels", () => {
  test("Templates counts built-in and custom templates apart (F08)", () => {
    expect(templatesCountText(26, 0)).toBe("26 built-in · 0 custom templates");
    expect(templatesCountText(26, 1)).toBe("26 built-in · 1 custom template");
    expect(templatesCountText(0, 3)).toBe("3 custom templates");
    expect(templatesCountText(26, 50, true)).toBe("26 built-in · 50+ custom templates");
  });
  test("a card names its created and edited times (F14)", () => {
    const now = Date.UTC(2026, 10, 5, 12);
    expect(createdText(now - 24 * 60_000, now)).toBe("Created 24 mins ago");
    expect(editedText(now - 3 * 60_000, now)).toBe("Edited 3 mins ago");
    expect(editedText(now - 10_000, now)).toBe("Edited just now");
  });
});

describe("Quick add without a title (F16)", () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;
  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    added.calls = [];
  });

  test("says so under the title, described by it, keeps focus there and clears once the title has words", async () => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root!.render(createElement(QuickAddForm, { onClose: () => undefined })));
    const input = host.querySelector<HTMLInputElement>("#qa-title")!;
    const add = [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Add task")!;
    add.focus();
    await act(async () => add.click());

    const message = host.querySelector("#qa-title-error");
    expect(message?.textContent).toBe("Write the task first.");
    expect(message?.getAttribute("role")).toBe("alert");
    // Right after the title field, before the due date, priority and Add to fields.
    expect(input.nextElementSibling).toBe(message);
    expect(input.getAttribute("aria-describedby")).toContain("qa-title-error");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(input);
    expect(added.calls).toHaveLength(0);

    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setValue.call(input, "Call Sam");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.querySelector("#qa-title-error")).toBeNull();
    expect(input.getAttribute("aria-describedby")).toBeNull();
    expect(input.getAttribute("aria-invalid")).toBeNull();
  });
});
