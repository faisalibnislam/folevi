// Local mode never talks to Folevi (docs/LOCAL_MODE_PLAN.md §5.4): no ConvexReactClient is ever made, the
// account's client can't be had, purchases are never offered, and the hooks run against the library.
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

const constructed = vi.hoisted(() => ({ count: 0 }));
vi.mock("convex/react", async (importOriginal) => {
  const real = await importOriginal<typeof import("convex/react")>();
  class CountedConvexReactClient extends real.ConvexReactClient {
    constructor(...args: ConstructorParameters<typeof real.ConvexReactClient>) {
      constructed.count++;
      super(...args);
    }
  }
  return { ...real, ConvexReactClient: CountedConvexReactClient };
});

import { useConvexConnectionState, useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convex/api";
import { BackendProvider, getConvexClient, useLocalClient } from "@/lib/convex/provider";
import { canPurchaseHere, currentBackendMode, useBackendMode, useCapabilities } from "@/lib/mode";
import { setCurrentBackendMode } from "@/lib/backendMode";
import { closeLocalLibrary, configureLocalLibrary, MemoryStore } from "@/lib/local";
import { settle } from "./local-fixtures";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fetches: string[] = [];
const realFetch = globalThis.fetch;
beforeAll(() => {
  // Anything that tries the network fails the test.
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    fetches.push(String(input));
    throw new Error("local mode must not use the network");
  }) as typeof fetch;
  configureLocalLibrary({ openStore: async () => new MemoryStore(), host: { locks: null, target: null, channel: () => new BroadcastChannel(`local-mode-test`) as never } });
});
afterAll(async () => {
  globalThis.fetch = realFetch;
  await closeLocalLibrary();
  setCurrentBackendMode("account");
});

describe("local mode", () => {
  test("renders the real hooks on the library, sets up a profile, and never makes a ConvexReactClient", async () => {
    const seen: Record<string, unknown> = {};
    function Probe() {
      const me = useQuery(api.users.me, {});
      const workspaces = useQuery(api.workspaces.mine, {});
      const conn = useConvexConnectionState();
      const local = useLocalClient();
      seen.mode = useBackendMode();
      seen.caps = useCapabilities();
      seen.push = useMutation(api.sync.push);
      seen.local = local;
      return createElement("p", null, `${me?.state ?? "loading"}|${JSON.stringify(workspaces)}|${conn.isWebSocketConnected}`);
    }
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(
        <BackendProvider backend="local">
          <Probe />
        </BackendProvider>,
      ));
    await settle();
    expect(host.textContent).toBe("needs_bootstrap|[]|true");
    await act(async () => void (await (seen.local as NonNullable<ReturnType<typeof useLocalClient>>).local.setup({ timeZone: "UTC", locale: "en" })));
    await settle();
    expect(host.textContent).toBe("ready|[]|true");
    expect(seen.mode).toBe("local");
    expect(seen.caps).toMatchObject({ sharing: false, comments: false, workspaces: false, billing: false, aiServer: false });

    expect(constructed.count).toBe(0);
    expect(currentBackendMode()).toBe("local");
    expect(() => getConvexClient()).toThrow(/local mode/);
    expect(canPurchaseHere()).toBe(false);
    expect(fetches).toEqual([]);
    act(() => root.unmount());
  });

  test("account mode is unchanged: purchases are offered in a browser again", () => {
    setCurrentBackendMode("account");
    expect(canPurchaseHere()).toBe(true);
    expect(() => getConvexClient()).not.toThrow(/local mode/);
    expect(constructed.count).toBe(0);
  });
});
