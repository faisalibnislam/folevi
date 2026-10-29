import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

let pathname = "/documents";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(),
}));

const { AppRouterProvider } = await import("@/lib/app/router");
const { NativeTabsProvider, TabsProvider, tabsStorageKeys, useDocTab, useTabs, useWarmTabs } = await import("@/lib/app/tabs");
const { setNativePanes } = await import("@/lib/engine/noteHost");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let seen: string[] = [];
let api: ReturnType<typeof useTabs>;
function Probe() {
  api = useTabs();
  seen = api.tabs.map((t) => t.id);
  return null;
}

/** A note's page naming its tab (as DocumentView does), counting how often it's drawn. */
let page: { id: string; title: string } | null = null;
let pageDrawn = 0;
function Page() {
  pageDrawn++;
  useDocTab(page!.id, page!.title, null);
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
          {page ? <Page /> : null}
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
  page = null;
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

  test("a joined note moves among the others with its width, or comes out into its own tab", () => {
    localStorage.setItem("folevi:tabs:acct", JSON.stringify([{ id: "join:x", title: "", panes: [A, B, C], at: A, sizes: [0.5, 0.3, 0.2] }]));
    render(`/d/${A}`, null);
    act(() => api.movePane("join:x", 0, 2));
    expect(api.tabs[0]).toMatchObject({ panes: [B, C, A], sizes: [0.3, 0.2, 0.5] });
    act(() => api.detachPane("join:x", C));
    expect(api.tabs.map((t) => t.id)).toEqual(["join:x", C]);
    expect(api.tabs[0]!.panes).toEqual([B, A]);
    expect(api.tabs[0]!.sizes![0]).toBeCloseTo(0.375);
    // Down to one note: the joined tab becomes that note's own tab.
    act(() => api.detachPane("join:x", B));
    expect(api.tabs.map((t) => t.id)).toEqual([A, B, C]);
  });
});

describe("a note's page names its tab", () => {
  test("the tab made after the page named it takes the name, and a tab changing elsewhere doesn't draw the page again", () => {
    openThree();
    // The page is drawn (and names its tab) in the same pass that opens the tab.
    page = { id: A, title: "Alpha" };
    render(`/d/${A}`, null);
    expect(api.tabs.find((t) => t.id === A)?.title).toBe("Alpha");
    const drawn = pageDrawn;
    act(() => api.setPinned(B, true));
    act(() => api.move(A, 2));
    expect(seen).toEqual([B, C, A]);
    expect(api.tabs[0]!.pinned).toBe(true);
    expect(pageDrawn).toBe(drawn);
    // A tab replaced under the page (moving within the note) takes the name again.
    act(() => api.close(A));
    render(`/d/${A}`, null);
    expect(api.tabs.find((t) => t.id === A)?.title).toBe("Alpha");
  });
});

describe("the Mac app's page (native draws the strip)", () => {
  test("the joined notes come from native, pages naming their tabs and the warm notes need nothing, sizes show at once", () => {
    setNativePanes({ panes: [A, B], sizes: null, tabs: [{ id: C, title: "Gamma" }] });
    let warm: string[] = ["x"];
    function NativeProbe() {
      api = useTabs();
      seen = api.tabs.map((t) => t.id);
      warm = useWarmTabs();
      useDocTab(A, "Alpha", null);
      return null;
    }
    pathname = `/d/${A}`;
    window.history.replaceState(null, "", pathname);
    act(() =>
      root.render(
        <AppRouterProvider>
          <NativeTabsProvider>
            <NativeProbe />
          </NativeTabsProvider>
        </AppRouterProvider>,
      ),
    );
    expect(api.tabs[0]).toMatchObject({ panes: [A, B], at: A });
    expect(seen).toEqual(["join:native", C]);
    expect(warm).toEqual([]);
    act(() => api.setSizes("join:native", [0.6, 0.4]));
    expect(api.tabs[0]!.sizes).toEqual([0.6, 0.4]);
    setNativePanes({ panes: null, sizes: null, tabs: [] });
  });
});
