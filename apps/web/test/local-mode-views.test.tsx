// A development guard for local mode (docs/LOCAL_MODE_PLAN.md §5.2, WP10): the app's main views render on a
// local library, and none of them calls a function local mode doesn't have. A hidden one (LOCAL_HIDDEN) means
// its interface is showing when its capability says it shouldn't; a planned or unclassified one means a view
// reaches for something that isn't ported yet. Either fails here, naming the function.
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ConvexProvider, type ConvexReactClient } from "convex/react";
import { getFunctionName, type FunctionReference } from "convex/server";

const nav = vi.hoisted(() => ({ path: "/documents" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.path, useSearchParams: () => new URLSearchParams() }));

import { api } from "@/lib/convex/api";
import { BackendModeContext } from "@/lib/mode";
import { setCurrentBackendMode } from "@/lib/backendMode";
import { createTestLocalClient, type TestLocalClient } from "@/lib/local/testing";
import { localStatus } from "@/lib/local/registry";
import { AppRouterProvider } from "@/lib/app/router";
import { AppStateProvider, type Profile } from "@/lib/app/state";
import { ToastProvider } from "@/components/ui/Toast";
import { Shell } from "@/components/app/Shell";
import { SIGN_IN_TO_COLLABORATE } from "@/components/app/SignInToCollaborate";
import { settle } from "./local-fixtures";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// What jsdom lacks and the app's chrome reads.
window.matchMedia ??= ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as unknown as typeof window.matchMedia;
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
globalThis.IntersectionObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
} as unknown as typeof IntersectionObserver;
Element.prototype.scrollIntoView ??= () => undefined;

let client: TestLocalClient;
let profile: Profile;
/** Every function the views asked the library for, by name. */
const called = new Set<string>();
const fetches: string[] = [];
const realFetch = globalThis.fetch;

beforeAll(async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    fetches.push(String(input));
    throw new Error("local mode must not use the network");
  }) as typeof fetch;
  setCurrentBackendMode("local");
  client = await createTestLocalClient({ seed: true });
  // Every way a hook reaches the backend goes through one of these.
  const target = client as unknown as Record<string, (ref: FunctionReference<"query" | "mutation" | "action">, ...rest: unknown[]) => unknown>;
  for (const method of ["watchQuery", "query", "mutation", "action"]) {
    const original = target[method]!.bind(client);
    target[method] = (ref, ...rest) => {
      called.add(getFunctionName(ref));
      return original(ref, ...rest);
    };
  }
  const me = (await client.query(api.users.me, {})) as { profile: Profile };
  profile = me.profile;
}, 60_000);

afterAll(async () => {
  globalThis.fetch = realFetch;
  await client.close();
  setCurrentBackendMode("account");
});

function App({ children }: { children?: ReactNode }) {
  return (
    <BackendModeContext.Provider value="local">
      <ConvexProvider client={client as unknown as ConvexReactClient}>
        <AppRouterProvider>
          <ToastProvider>
            <AppStateProvider profile={profile}>{children ?? <Shell />}</AppStateProvider>
          </ToastProvider>
        </AppRouterProvider>
      </ConvexProvider>
    </BackendModeContext.Provider>
  );
}

/** What was asked for that local mode doesn't have, with why. */
function notHere(): string[] {
  return [...called]
    .map((name) => [name, localStatus(name)] as const)
    .filter(([, status]) => status.kind !== "ported")
    .map(([name, status]) => `${name} (${status.kind === "hidden" ? `hidden behind ${status.capability}` : status.kind === "planned" ? `planned for ${status.phase}` : "unclassified"})`);
}

async function open(path: string): Promise<{ host: HTMLElement; root: Root }> {
  nav.path = path.split("?")[0]!;
  window.history.replaceState(null, "", path);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(<App />));
  await settle(20);
  return { host, root };
}

async function close({ host, root }: { host: HTMLElement; root: Root }) {
  act(() => root.unmount());
  host.remove();
  await settle(2);
}

describe("local mode's main views", () => {
  const views = ["/documents", "/notes", "/starred", "/drafts", "/archive", "/trash", "/templates", "/folders", "/tags", "/tasks/today", "/tasks/upcoming", "/calendar", "/review", "/graph", "/ai", "/help", "/changes", "/shared"];
  const settings = ["/settings", "/settings/appearance", "/settings/data", "/settings/desktop", "/settings/billing", "/settings/account", "/settings/workspace"];

  for (const path of [...views, ...settings]) {
    test(`${path} calls nothing local mode doesn't have`, async () => {
      called.clear();
      const view = await open(path);
      expect(view.host.querySelector("main"), "the view rendered").not.toBeNull();
      expect(view.host.textContent).not.toContain("couldn’t load");
      expect(notHere()).toEqual([]);
      await close(view);
    });
  }

  test("a note calls nothing local mode doesn't have, and has no account surfaces", async () => {
    const recent = (await client.query(api.documents.recentNotes, { scope: { kind: "personal" }, limit: 1 })) as { id: string }[];
    expect(recent.length).toBe(1);
    called.clear();
    const view = await open(`/d/${recent[0]!.id}`);
    // The note's code loads on its own: give it time.
    for (let i = 0; i < 40 && !view.host.querySelector(".fb-editor"); i++) await settle(4);
    expect(view.host.querySelector(".fb-editor"), "the editor rendered").not.toBeNull();
    expect(notHere()).toEqual([]);
    await close(view);
  }, 60_000);

  test("the sidebar has the one note where the workspace switcher was, and no Shared with Me or Changes", async () => {
    const view = await open("/documents");
    const nav = view.host.querySelector('nav[aria-label="Folio"]')!;
    expect(nav.textContent).toContain(SIGN_IN_TO_COLLABORATE);
    for (const gone of ["Shared with Me", "Changes", "Work with Foli AI"]) expect([...nav.querySelectorAll("a")].map((a) => a.textContent?.trim())).not.toContain(gone);
    expect(view.host.querySelector('button[aria-label^="Notifications"]')).toBeNull();
    await close(view);
  });

  test("never used the network", () => {
    expect(fetches).toEqual([]);
  });
});
