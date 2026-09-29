import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

let pathname = "/documents";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(),
}));

const { AppRouterProvider } = await import("@/lib/app/router");
const { TabsProvider, tabsStorageKeys, useTabs } = await import("@/lib/app/tabs");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let seen: string[] = [];
function Probe() {
  const { tabs } = useTabs();
  seen = tabs.map((t) => t.id);
  return null;
}

let root: Root;
let host: HTMLDivElement;
function render(path: string, workspaceId: string | null) {
  pathname = path;
  act(() =>
    root.render(
      <AppRouterProvider>
        <TabsProvider accountKey="acct" workspaceId={workspaceId}>
          <Probe />
        </TabsProvider>
      </AppRouterProvider>,
    ),
  );
}

beforeEach(() => {
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("tabs belong to a context", () => {
  test("Personal keeps the account's original keys; each workspace has its own", () => {
    expect(tabsStorageKeys("acct", null)).toEqual({ tabs: "folevi:tabs:acct", homeHref: "folevi:home-href:acct" });
    expect(tabsStorageKeys("acct", "w1")).toEqual({ tabs: "folevi:tabs:acct:w1", homeHref: "folevi:home-href:acct:w1" });
  });

  test("a page opened in Personal isn't in a workspace's tabs, and is still there back in Personal", () => {
    render("/d/01PERSONALPAGE000000000000", null);
    expect(seen).toEqual(["01PERSONALPAGE000000000000"]);

    render("/documents", "w1");
    expect(seen).toEqual([]);
    render("/d/01WORKSPACEPAGE00000000000", "w1");
    expect(seen).toEqual(["01WORKSPACEPAGE00000000000"]);

    render("/documents", null);
    expect(seen).toEqual(["01PERSONALPAGE000000000000"]);
  });
});
