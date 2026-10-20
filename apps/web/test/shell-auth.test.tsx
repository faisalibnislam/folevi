// Signed-in mode in the apps' built-in interface (docs/LOCAL_MODE_PLAN.md §1, WP4): Better Auth's client
// fetches through the host's bridge, Convex tokens come from the host, and sign-in and sign-out go through it.
// The native side (the bearer, the allowlist, the scrubbing) is apps/desktop/src/authBridge.test.ts.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { FoleviShell } from "@/lib/shell";
import { authFetch, hostAuth, hostConvexToken, shellAuthFetch, shellAuthPath, shellSignIn, websitePage } from "@/lib/auth/shellFetch";
import { shellNeedsUpdate } from "../../../convex/lib/shellVersions";

// (Typed loosely: the e2e fixture declares the hook as a whole FoleviShell, and these are partial.)
const w = () => window as unknown as { __foleviTestShell?: Partial<FoleviShell> };

function fakeAuth(over: Partial<FoleviShell["auth"]> = {}) {
  const auth = {
    signIn: vi.fn(async () => true),
    signOut: vi.fn(async () => undefined),
    fetch: vi.fn(async () => ({ status: 200, headers: { "content-type": "application/json" }, body: '{"session":{"id":"s1"}}' })),
    convexToken: vi.fn(async () => "jwt.token.here"),
    ...over,
  };
  w().__foleviTestShell = { platform: "mac", shellVersion: "1.15.0", auth } as Partial<FoleviShell>;
  return auth;
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_FOLEVI_SHELL", "1");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.folevi.com");
});
afterEach(() => {
  vi.unstubAllEnvs();
  delete w().__foleviTestShell;
  document.body.innerHTML = "";
});

describe("Better Auth's fetch in the shell", () => {
  test("only the service's /api/auth paths, as path and query", () => {
    expect(shellAuthPath("https://app.folevi.com/api/auth/get-session?disableCookieCache=true")).toBe("/api/auth/get-session?disableCookieCache=true");
    expect(shellAuthPath(new URL("https://app.folevi.com/api/auth/convex/token"))).toBe("/api/auth/convex/token");
    expect(shellAuthPath("https://evil.example/api/auth/get-session")).toBeNull();
    expect(shellAuthPath("https://app.folevi.com/api/files/x")).toBeNull();
    expect(shellAuthPath("https://app.folevi.com/api/auth/../admin")).toBeNull();
  });

  test("hands the request to the host as plain values and rebuilds the Response", async () => {
    const auth = fakeAuth();
    const res = await shellAuthFetch("https://app.folevi.com/api/auth/two-factor/verify-totp", {
      method: "post",
      headers: new Headers({ "Content-Type": "application/json" }),
      body: '{"code":"123456"}',
    });
    expect(auth.fetch).toHaveBeenCalledWith("/api/auth/two-factor/verify-totp", { method: "POST", headers: { "content-type": "application/json" }, body: '{"code":"123456"}' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ session: { id: "s1" } });
  });

  test("a body that isn't text, or another host, never reaches the bridge", async () => {
    const auth = fakeAuth();
    await expect(shellAuthFetch("https://app.folevi.com/api/auth/x", { method: "POST", body: new Blob(["x"]) })).rejects.toThrow(TypeError);
    await expect(shellAuthFetch("https://evil.example/api/auth/x")).rejects.toThrow(TypeError);
    expect(auth.fetch).not.toHaveBeenCalled();
  });

  test("statuses without a body, and an abort, behave like fetch", async () => {
    fakeAuth({ fetch: vi.fn(async () => ({ status: 204, headers: {}, body: "" })) });
    expect((await shellAuthFetch("https://app.folevi.com/api/auth/x")).status).toBe(204);
    let release: () => void = () => undefined;
    fakeAuth({ fetch: vi.fn(() => new Promise<{ status: number; headers: Record<string, string>; body: string }>((r) => (release = () => r({ status: 200, headers: {}, body: "" })))) });
    const controller = new AbortController();
    const pending = shellAuthFetch("https://app.folevi.com/api/auth/x", { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    release();
  });

  test("without a host's auth (a plain browser, or a bridge without it) it's the page's own fetch", async () => {
    const native = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    w().__foleviTestShell = { platform: "mac" } as Partial<FoleviShell>;
    expect(hostAuth()).toBe(false);
    await authFetch("https://app.folevi.com/api/auth/get-session");
    expect(native).toHaveBeenCalledTimes(1);
    const auth = fakeAuth();
    expect(hostAuth()).toBe(true);
    await authFetch("https://app.folevi.com/api/auth/get-session");
    expect(auth.fetch).toHaveBeenCalledTimes(1);
    expect(native).toHaveBeenCalledTimes(1);
    native.mockRestore();
  });

  test("the website never uses the host, even when a test shell is around", () => {
    vi.stubEnv("NEXT_PUBLIC_FOLEVI_SHELL", "");
    fakeAuth();
    expect(hostAuth()).toBe(false);
    expect(websitePage("/forgot-password")).toBe("/forgot-password");
    vi.stubEnv("NEXT_PUBLIC_FOLEVI_SHELL", "1");
    expect(websitePage("/forgot-password")).toBe("https://app.folevi.com/forgot-password");
  });
});

describe("Convex tokens from the host", () => {
  test("a token, a 401 when signed out, a rejection when the host can't reach the service", async () => {
    fakeAuth();
    expect(await hostConvexToken(1000)).toEqual({ data: { token: "jwt.token.here" }, error: null });
    fakeAuth({ convexToken: vi.fn(async () => null) });
    expect(await hostConvexToken(1000)).toEqual({ data: null, error: { status: 401 } });
    fakeAuth({ convexToken: vi.fn(async () => Promise.reject(new TypeError("offline"))) });
    await expect(hostConvexToken(1000)).rejects.toThrow("offline");
    fakeAuth({ convexToken: vi.fn(() => new Promise<string | null>(() => undefined)) });
    await expect(hostConvexToken(20)).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("signing in and out through the host", () => {
  test("shellSignIn reloads only when the host signed in", async () => {
    const reload = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...original, reload } });
    try {
      fakeAuth({ signIn: vi.fn(async () => false) });
      expect(await shellSignIn()).toBe(false);
      expect(reload).not.toHaveBeenCalled();
      fakeAuth();
      expect(await shellSignIn()).toBe(true);
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: original });
    }
  });

  test("the sign-in screen calls the host and says so when it didn't finish", async () => {
    const auth = fakeAuth({ signIn: vi.fn(async () => false) });
    const { ShellSignIn } = await import("@/components/app/ShellSignIn");
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<ShellSignIn />));
    const button = [...host.querySelectorAll("button")].find((b) => b.textContent === "Sign in to Folevi")!;
    await act(async () => button.click());
    expect(auth.signIn).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role="alert"]')?.textContent).toMatch(/didn.t finish/);
    expect(host.textContent).not.toMatch(/\/signin/);
    act(() => root.unmount());
  });

  test("signOutNow in the shell ends the host's session and opens the app's own sign-in", async () => {
    vi.doMock("@/lib/nativeDevice", () => ({ forgetThisDevice: vi.fn(async () => undefined) }));
    vi.doMock("@/lib/sync/db", () => ({ clearAllLocalData: vi.fn(async () => undefined), localDb: vi.fn() }));
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...original, assign } });
    try {
      const auth = fakeAuth();
      const { signOutNow } = await import("@/components/auth/SignOut");
      await signOutNow("/signin?notice=signed_out");
      expect(auth.signOut).toHaveBeenCalledTimes(1);
      expect(assign).toHaveBeenCalledWith("/");
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: original });
      vi.doUnmock("@/lib/nativeDevice");
      vi.doUnmock("@/lib/sync/db");
    }
  });
});

describe("the update gate", () => {
  test("only an app older than the floor for its platform", () => {
    expect(shellNeedsUpdate("1.15.0", "1.16.0")).toBe(true);
    expect(shellNeedsUpdate("1.16.0", "1.16.0")).toBe(false);
    expect(shellNeedsUpdate("1.15.0", null)).toBe(false);
  });
});
