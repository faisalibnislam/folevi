// WP7 accept (docs/E2EE_DESIGN.md §12): Standard users get the raw ConvexReactClient. provider.tsx wraps the
// account's client in E2eeRouterClient only when e2ee.keys.status says encryption is set up, and never loads
// the router otherwise.
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ConvexReactClient } from "convex/react";
import { getFunctionName } from "convex/server";
import { useAccountClient } from "@/lib/convex/provider";
import { activeRouter } from "@/lib/e2ee/router/active";
import type { E2eeRouterClient } from "@/lib/e2ee/router/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function rawClient(status: { setUp: boolean } | undefined) {
  const listeners = new Set<() => void>();
  let value = status;
  const asked: string[] = [];
  const client = {
    watchQuery: (ref: never) => {
      asked.push(getFunctionName(ref));
      return { onUpdate: (cb: () => void) => (listeners.add(cb), () => listeners.delete(cb)), localQueryResult: () => value };
    },
  } as unknown as ConvexReactClient;
  return {
    client,
    asked,
    set(next: { setUp: boolean }) {
      value = next;
      for (const l of listeners) l();
    },
  };
}

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  localStorage.clear();
});

function mount(raw: ConvexReactClient, make: (raw: ConvexReactClient) => Promise<E2eeRouterClient>) {
  const seen: { client: ConvexReactClient; ready: boolean }[] = [];
  function Probe() {
    seen.push(useAccountClient(raw, make));
    return null;
  }
  root = createRoot(document.createElement("div"));
  act(() => root!.render(createElement(Probe)));
  return seen;
}

describe("the account's client", () => {
  test("a Standard account gets the raw ConvexReactClient and the router is never made", async () => {
    const raw = rawClient({ setUp: false });
    const make = vi.fn(async () => ({}) as E2eeRouterClient);
    const seen = mount(raw.client, make);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(seen.every((s) => s.client === raw.client && s.ready)).toBe(true);
    expect(make).not.toHaveBeenCalled();
    expect(raw.asked).toEqual(["e2ee/keys:status"]);
    expect(activeRouter()).toBeNull();
  });

  test("before the status answers (signed out, loading), the raw client is used", async () => {
    const raw = rawClient(undefined);
    const make = vi.fn(async () => ({}) as E2eeRouterClient);
    const seen = mount(raw.client, make);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(seen.at(-1)!.client).toBe(raw.client);
    expect(make).not.toHaveBeenCalled();
  });

  test("an account with E2EE set up gets the router, which becomes the active one", async () => {
    const raw = rawClient({ setUp: false });
    const router = { dispose: vi.fn(async () => {}) } as unknown as E2eeRouterClient;
    const make = vi.fn(async () => router);
    const seen = mount(raw.client, make);
    await act(async () => {
      raw.set({ setUp: true });
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(make).toHaveBeenCalledTimes(1);
    expect(seen.at(-1)).toEqual({ client: router, ready: true });
    expect(activeRouter()).toBe(router);
    // Turned off again (reset, sign-out): back to the raw client, and the router lets go of what it holds.
    await act(async () => {
      raw.set({ setUp: false });
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(seen.at(-1)!.client).toBe(raw.client);
    expect(activeRouter()).toBeNull();
    expect((router as unknown as { dispose: ReturnType<typeof vi.fn> }).dispose).toHaveBeenCalled();
  });
});
