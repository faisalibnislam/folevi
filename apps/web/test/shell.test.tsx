// The bundled app shell (docs/LOCAL_MODE_PLAN.md §1, WP1): the build switch, the bridge accessor, the shell's
// CSP and ShellRoot's choice of what to open. The export itself is checked in e2e/shell (pnpm test:shell).
import { afterEach, describe, expect, test, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { EMBED_FRAME_ORIGINS } from "@folevi/editor-schema";
import { shellContentSecurityPolicy } from "@/lib/shell/csp";
import { initialShellMode, isShell, setShellMode, shell, type FoleviShell } from "@/lib/shell";

vi.mock("@/components/app/ProductApp", () => ({
  ProductApp: ({ backend }: { backend?: string }) => <div data-testid="product">{backend ?? "default"}</div>,
}));

// Partial fakes: the e2e fixture declares these globals as full shells, so this test types them loosely.
type TestWindow = Omit<Window, "__foleviTestShell" | "foleviShell"> & { __foleviTestShell?: Partial<FoleviShell>; foleviShell?: Partial<FoleviShell> };
const w = () => window as unknown as TestWindow;

afterEach(() => {
  delete w().__foleviTestShell;
  delete w().foleviShell;
  document.body.innerHTML = "";
});

describe("the build switch (next.config.ts)", () => {
  test("the website build has no shell settings at all", async () => {
    vi.resetModules();
    delete process.env.FOLEVI_BUILD;
    const config = (await import("../next.config")).default;
    expect(config.output).toBeUndefined();
    expect(config.pageExtensions).toBeUndefined();
    expect(config.distDir).toBe(process.env.NEXT_DIST_DIR);
    expect(config.env).not.toHaveProperty("NEXT_PUBLIC_FOLEVI_SHELL");
    expect(typeof config.headers).toBe("function");
    expect(typeof config.redirects).toBe("function");
  });

  test("FOLEVI_BUILD=shell is a static export of *.shell.tsx with the flag baked in", async () => {
    vi.resetModules();
    process.env.FOLEVI_BUILD = "shell";
    vi.stubEnv("NODE_ENV", "production");
    try {
      const config = (await import("../next.config")).default;
      expect(config.output).toBe("export");
      expect(config.pageExtensions).toEqual(["shell.tsx", "shell.ts"]);
      expect(config.images).toEqual({ unoptimized: true });
      expect(config.env).toMatchObject({ NEXT_PUBLIC_FOLEVI_SHELL: "1" });
      expect(config.headers).toBeUndefined();
      expect(config.redirects).toBeUndefined();
    } finally {
      delete process.env.FOLEVI_BUILD;
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  test("`next dev` with the flag serves the same pages with an SPA fallback and its own build folder", async () => {
    vi.resetModules();
    process.env.FOLEVI_BUILD = "shell";
    vi.stubEnv("NODE_ENV", "development");
    try {
      const config = (await import("../next.config")).default;
      expect(config.output).toBeUndefined();
      expect(config.pageExtensions).toEqual(["shell.tsx", "shell.ts"]);
      expect(config.distDir).toBe(process.env.NEXT_DIST_DIR ?? ".next-shell");
      const rewrites = (await config.rewrites!()) as { fallback: { source: string; destination: string }[] };
      expect(rewrites.fallback).toEqual([{ source: "/:path((?!api/).*)", destination: "/" }]);
    } finally {
      delete process.env.FOLEVI_BUILD;
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});

describe("the bridge accessor (lib/shell)", () => {
  test("on the website there's no shell, even if a page sets window.foleviShell", () => {
    expect(isShell()).toBe(false);
    w().foleviShell = { initialMode: "local" } as FoleviShell;
    expect(shell()).toBeNull();
    expect(initialShellMode()).toBe("account");
  });

  test("development builds honour the e2e FakeShell", async () => {
    const setMode = vi.fn(async () => {});
    w().__foleviTestShell = { initialMode: "unset", setMode };
    expect(shell()).toBe(w().__foleviTestShell);
    expect(initialShellMode()).toBe("unset");
    await setShellMode("local");
    expect(setMode).toHaveBeenCalledWith("local");
  });

  test("a mode this build doesn't know opens the account", () => {
    w().__foleviTestShell = { initialMode: "cloud" as "local" };
    expect(initialShellMode()).toBe("account");
  });
});

describe("the shell's Content Security Policy", () => {
  const opts = { convexUrl: "https://happy-otter-123.convex.cloud", convexSiteUrl: "https://happy-otter-123.convex.site", dev: false };

  test("allows the build's Convex deployment, the library's files and the embed players, nothing else", () => {
    const policy = shellContentSecurityPolicy(opts);
    const d = (name: string) => policy.split("; ").find((x) => x.startsWith(`${name} `));
    expect(d("default-src")).toBe("default-src 'self'");
    expect(d("script-src")).toBe("script-src 'self' 'unsafe-inline'");
    expect(d("connect-src")).toBe("connect-src 'self' folevi-file: https://happy-otter-123.convex.cloud wss://happy-otter-123.convex.cloud https://happy-otter-123.convex.site");
    expect(d("img-src")).toContain("folevi-file:");
    expect(d("frame-src")).toBe(`frame-src https://happy-otter-123.convex.site ${EMBED_FRAME_ORIGINS.join(" ")}`);
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).not.toMatch(/\s{2,}/);
  });

  test("leaves out what a meta tag can't carry", () => {
    const policy = shellContentSecurityPolicy(opts);
    for (const d of ["frame-ancestors", "report-uri", "sandbox", "manifest-src"]) expect(policy).not.toContain(d);
  });

  test("the dev shell allows eval and the local HMR socket", () => {
    const policy = shellContentSecurityPolicy({ ...opts, dev: true });
    expect(policy).toContain("'unsafe-eval'");
    expect(policy).toContain("ws://localhost:*");
  });
});

describe("ShellRoot", () => {
  async function render() {
    const { ShellRoot } = await import("@/components/app/ShellRoot");
    const el = document.createElement("div");
    document.body.append(el);
    const root = createRoot(el);
    await act(async () => root.render(<ShellRoot />));
    return el;
  }

  test("a host that chose already opens the product on that backend", async () => {
    w().__foleviTestShell = { initialMode: "local" };
    const el = await render();
    expect(el.querySelector('[data-testid="product"]')?.textContent).toBe("local");
  });

  test("without a host it's the product on the account, as on the website", async () => {
    const el = await render();
    expect(el.querySelector('[data-testid="product"]')?.textContent).toBe("account");
  });

  test("the first launch asks, saves the answer with the host, then opens the product", async () => {
    const setMode = vi.fn(async () => {});
    w().__foleviTestShell = { initialMode: "unset", setMode };
    const el = await render();
    const keep = [...el.querySelectorAll("button")].find((b) => b.textContent?.includes("Keep notes on my devices"));
    expect(keep).toBeTruthy();
    expect(el.textContent).toContain("Free forever. No account.");
    expect(el.textContent).toContain("Sign in to Folevi");
    await act(async () => keep!.click());
    expect(setMode).toHaveBeenCalledWith("local");
    expect(el.querySelector('[data-testid="product"]')?.textContent).toBe("local");
  });

  test("a choice the host couldn't save stays on the question", async () => {
    w().__foleviTestShell = { initialMode: "unset", setMode: vi.fn(async () => Promise.reject(new Error("disk full"))) };
    const el = await render();
    const signIn = [...el.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Sign in to Folevi"))!;
    await act(async () => signIn.click());
    expect(el.querySelector('[data-testid="product"]')).toBeNull();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain("Try again");
  });
  test("keeping notes on this device asks where the library lives before saving the choice", async () => {
    const setMode = vi.fn(async () => {});
    const setup = vi.fn(async () => ({ kind: "device" as const, displayPath: "On this Mac", available: true, encrypted: false, locked: false, configured: true }));
    const library = { setup, info: vi.fn(async () => ({ kind: "device" as const, displayPath: "", available: false, encrypted: false, locked: false, configured: false })), list: vi.fn(async () => []) };
    w().__foleviTestShell = { initialMode: "unset", setMode, platform: "mac", library: library as unknown as FoleviShell["library"] };
    const el = await render();
    const keep = [...el.querySelectorAll("button")].find((b) => b.textContent?.includes("Keep notes on my devices"))!;
    await act(async () => keep.click());
    expect(setMode).not.toHaveBeenCalled();
    expect(el.querySelector('[data-testid="library-setup"]')).toBeTruthy();
    expect(el.textContent).toContain("This device only");
    await act(async () => el.querySelector<HTMLButtonElement>('[data-testid="place-device"]')!.click());
    expect(setup).toHaveBeenCalledWith({ kind: "device" });
    // A new library: the welcome notes come, after an optional passphrase.
    expect(el.textContent).toContain("Your library is ready");
    const open = [...el.querySelectorAll("button")].find((b) => b.textContent === "Open Folevi")!;
    await act(async () => open.click());
    expect(setMode).toHaveBeenCalledWith("local");
    expect(localStorage.getItem("folevi:local-setup-intent")).toBe("new");
    expect(el.querySelector('[data-testid="product"]')?.textContent).toBe("local");
  });

  test("a place that already holds a library is joined at once", async () => {
    const setMode = vi.fn(async () => {});
    const info = { kind: "icloud" as const, displayPath: "iCloud Drive › Folevi", available: true, encrypted: false, locked: false, configured: true };
    const library = { setup: vi.fn(async () => info), info: vi.fn(async () => info), list: vi.fn(async (dir: string) => (dir === "notes" ? [{ path: "notes/01J.fnote" }] : [])) };
    w().__foleviTestShell = { initialMode: "unset", setMode, platform: "mac", library: library as unknown as FoleviShell["library"] };
    const el = await render();
    await act(async () => [...el.querySelectorAll("button")].find((b) => b.textContent?.includes("Keep notes on my devices"))!.click());
    await act(async () => el.querySelector<HTMLButtonElement>('[data-testid="place-icloud"]')!.click());
    expect(setMode).toHaveBeenCalledWith("local");
    expect(localStorage.getItem("folevi:local-setup-intent")).toBe("join");
    expect(el.querySelector('[data-testid="product"]')?.textContent).toBe("local");
  });

  test("local mode with nothing set up yet opens the setup, not the product", async () => {
    const library = { info: vi.fn(async () => ({ kind: "device" as const, displayPath: "", available: false, encrypted: false, locked: false, configured: false })), list: vi.fn(async () => []) };
    w().__foleviTestShell = { initialMode: "local", platform: "mac", library: library as unknown as FoleviShell["library"] };
    const el = await render();
    await act(async () => undefined);
    expect(el.querySelector('[data-testid="product"]')).toBeNull();
    expect(el.querySelector('[data-testid="library-setup"]')).toBeTruthy();
  });

  test("iCloud Drive turned off is explained", async () => {
    const library = {
      setup: vi.fn(async () => Promise.reject({ name: "LocalFsError", code: "unavailable", message: "iCloud Drive is turned off on this Mac.", path: "drive_off" })),
      info: vi.fn(async () => ({ kind: "device" as const, displayPath: "", available: false, encrypted: false, locked: false, configured: false })),
      list: vi.fn(async () => []),
    };
    w().__foleviTestShell = { initialMode: "local", platform: "mac", library: library as unknown as FoleviShell["library"] };
    const el = await render();
    await act(async () => undefined);
    await act(async () => el.querySelector<HTMLButtonElement>('[data-testid="place-icloud"]')!.click());
    expect(el.querySelector('[role="alert"]')?.textContent).toContain("Turn it on in System Settings");
    expect(el.querySelector('[data-testid="product"]')).toBeNull();
  });
});
