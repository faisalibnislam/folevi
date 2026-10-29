import { afterEach, describe, expect, test, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { setPendingMove } from "@/lib/migrate/session";

// The move between modes (components/migrate): the gate is light and loads the move's screens only where a move can
// happen, the apps' built-in interface (docs/WEB_PERFORMANCE.md). The screens themselves are stood in for here.
vi.mock("@/components/migrate/MigrationMove", () => ({
  MigrationMove: ({ move }: { move: { direction: string } }) => <p data-testid="move">{`moving: ${move.direction}`}</p>,
}));

const flush = async () => {
  for (let i = 0; i < 5; i++) await act(async () => await new Promise((r) => setTimeout(r, 0)));
};

describe("MigrationGate", () => {
  afterEach(() => {
    setPendingMove(null);
    delete (window as { __foleviTestShell?: unknown }).__foleviTestShell;
    document.body.innerHTML = "";
  });

  test("the app at once with no move under way, and on the website even with one", async () => {
    const { MigrationGate } = await import("@/components/migrate/MigrationGate");
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<MigrationGate><p>the app</p></MigrationGate>));
    expect(host.textContent).toBe("the app");
    act(() => setPendingMove({ direction: "upload", startedAt: 1, versions: true }));
    await flush();
    expect(host.textContent).toBe("the app");
    act(() => root.unmount());
  });

  test("in the apps, a move under way shows its screens instead of the app, and the app again once it's done", async () => {
    (window as { __foleviTestShell?: unknown }).__foleviTestShell = { library: {} };
    const { MigrationGate } = await import("@/components/migrate/MigrationGate");
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => setPendingMove({ direction: "upload", startedAt: 1, versions: true }));
    act(() => root.render(<MigrationGate><p>the app</p></MigrationGate>));
    await flush();
    expect(host.textContent).toBe("moving: upload");
    act(() => setPendingMove(null));
    expect(host.textContent).toBe("the app");
    act(() => root.unmount());
  });
});
