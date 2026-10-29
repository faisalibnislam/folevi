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
let api: ReturnType<typeof useTabs>;
function Probe() {
  api = useTabs();
  seen = api.tabs.map((t) => t.id);
  return null;
}

let root: Root;
let host: HTMLDivElement;
function render(path: string, workspaceId: string | null) {
  pathname = path;
  // The router follows the address bar once it has moved (join() navigates), so keep it on the same page.
  window.history.replaceState(null, "", path);
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

const A = "01AAAAAAAAAAAAAAAAAAAAAAAA";
const B = "01BBBBBBBBBBBBBBBBBBBBBBBB";
const C = "01CCCCCCCCCCCCCCCCCCCCCCCC";
/** Opens notes A, B and C (each in a new tab, as from Home), ending on C. */
function openThree() {
  for (const id of [A, B, C]) {
    render("/documents", null);
    render(`/d/${id}`, null);
  }
  expect(seen).toEqual([A, B, C]);
}

describe("pinned tabs", () => {
  test("pinning moves a tab to the end of the pinned ones; unpinning to the start of the others", () => {
    openThree();
    act(() => api.setPinned(C, true));
    expect(seen).toEqual([C, A, B]);
    act(() => api.setPinned(B, true));
    expect(seen).toEqual([C, B, A]);
    act(() => api.setPinned(C, false));
    expect(seen).toEqual([B, C, A]);
    expect(api.tabs.find((t) => t.id === B)?.pinned).toBe(true);
  });

  test("a tab moves only among its own kind", () => {
    openThree();
    act(() => api.setPinned(A, true));
    act(() => api.move(B, 0));
    expect(seen).toEqual([A, B, C]);
    act(() => api.move(C, 1));
    expect(seen).toEqual([A, C, B]);
  });
});

describe("joined tabs", () => {
  test("joining merges the note's own tab into the joined one; unjoining splits it back", () => {
    openThree();
    act(() => api.join(A, B));
    expect(api.tabs).toHaveLength(2);
    const joined = api.tabs[0]!;
    expect(joined.panes).toEqual([A, B]);
    expect(joined.id.startsWith("join:")).toBe(true);
    act(() => api.join(joined.id, C));
    expect(api.tabs).toHaveLength(1);
    expect(api.tabs[0]!.panes).toEqual([A, B, C]);
    // No more than three side by side.
    act(() => api.join(api.tabs[0]!.id, "01DDDDDDDDDDDDDDDDDDDDDDDD"));
    expect(api.tabs[0]!.panes).toEqual([A, B, C]);
    // Split after the first: A alone, then B and C still joined.
    act(() => api.unjoin(api.tabs[0]!.id, 0));
    expect(api.tabs[0]).toMatchObject({ id: A });
    expect(api.tabs[1]!.panes).toEqual([B, C]);
  });

  test("a joined tab keeps its pin", () => {
    openThree();
    act(() => api.setPinned(A, true));
    act(() => api.join(A, B));
    expect(api.tabs[0]).toMatchObject({ pinned: true, panes: [A, B] });
  });

  test("opening one of its notes focuses that pane instead of opening another tab", () => {
    localStorage.setItem("folevi:tabs:acct", JSON.stringify([{ id: "join:x", title: "", panes: [A, B], at: B }, { id: C, at: C, title: "" }]));
    render(`/d/${B}`, null);
    render(`/d/${A}`, null);
    expect(seen).toEqual(["join:x", C]);
    expect(api.tabs[0]!.at).toBe(A);
  });
});
