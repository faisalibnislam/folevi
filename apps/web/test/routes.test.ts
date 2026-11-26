import { describe, expect, test } from "vitest";
import { parseRoute } from "@/lib/app/router";
import { APP_ROUTE_HEADS } from "@/lib/app/routes";

describe("members and guests routes", () => {
  test("the Guests settings page and the page-invitation link are product routes", () => {
    expect(parseRoute("/settings/workspace-guests")).toEqual({ name: "settings", section: "workspace-guests" });
    expect(parseRoute("/share-invite/AbCdEf123")).toEqual({ name: "share-invite", token: "AbCdEf123" });
    expect(parseRoute("/share-invite")).toEqual({ name: "not_found" });
    expect(APP_ROUTE_HEADS.has("share-invite")).toBe(true);
  });
});

describe("reviews", () => {
  test("/review (and /review?note=…) is a product route", () => {
    expect(parseRoute("/review")).toEqual({ name: "review" });
    expect(APP_ROUTE_HEADS.has("review")).toBe(true);
  });
});

describe("changes", () => {
  test("/changes is a product route", () => {
    expect(parseRoute("/changes")).toEqual({ name: "changes" });
    expect(APP_ROUTE_HEADS.has("changes")).toBe(true);
  });
});

describe("the Inbox", () => {
  test("/inbox opens the Inbox page (folevi://inbox), and /tasks/inbox stays the Tasks view", () => {
    expect(parseRoute("/inbox")).toEqual({ name: "inbox" });
    expect(APP_ROUTE_HEADS.has("inbox")).toBe(true);
    expect(parseRoute("/tasks/inbox")).toEqual({ name: "tasks", view: "inbox" });
  });
});

describe("the nonce content policy (no 'unsafe-inline') covers every page rendered per request", () => {
  test("every product route there is, alone and with more of a path", async () => {
    const { isNonceRoute } = await import("@/lib/app/routes");
    expect(APP_ROUTE_HEADS.size).toBeGreaterThan(25);
    for (const head of APP_ROUTE_HEADS) {
      expect(isNonceRoute(`/${head}`), head).toBe(true);
      expect(isNonceRoute(`/${head}/x/y`), head).toBe(true);
    }
    // The ones that were left out before.
    for (const path of ["/daily", "/inbox", "/vault", "/quick-add", "/float/01ABC", "/oauth/consent", "/native", "/native/callback", "/app-google"]) expect(isNonceRoute(path), path).toBe(true);
  });

  test("the admin, sign-in flows, share pages, invitations and Vault links", async () => {
    const { isNonceRoute } = await import("@/lib/app/routes");
    for (const path of ["/admin", "/admin/users", "/setup", "/signin", "/signup", "/connect", "/connect/approve", "/verify-email", "/reset-password", "/two-factor", "/two-factor/setup", "/s/AbCdEf", "/join/AbCdEf", "/join/welcome", "/vault-link/AbCdEf"]) {
      expect(isNonceRoute(path), path).toBe(true);
    }
  });

  test("not prerendered pages (they have no per-request nonce), nor a name that only starts like a route", async () => {
    const { isNonceRoute } = await import("@/lib/app/routes");
    for (const path of ["/", "/pricing", "/forgot-password", "/offline", "/showcase-app", "/blog/x", "/api/places", "/s", "/join", "/dailyish", "/documents-old"]) expect(isNonceRoute(path), path).toBe(false);
  });

  test("the proxy answers each with a nonce policy, and a prerendered page without one", async () => {
    const { NextRequest } = await import("next/server");
    const { proxy } = await import("@/proxy");
    const policy = async (path: string) => (await proxy(new NextRequest(`https://app.folevi.com${path}`, { headers: { host: "app.folevi.com" } }))).headers.get("content-security-policy");
    for (const head of [...APP_ROUTE_HEADS, "app-google", "admin", "signin"]) {
      const csp = await policy(`/${head}`);
      expect(csp, head).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' /);
      expect(csp, head).toContain("'strict-dynamic'");
      expect(csp!.split("; ").find((d) => d.startsWith("script-src")), head).not.toContain("'unsafe-inline'");
    }
    expect(await policy("/forgot-password")).toBeNull();
    // Two loads never share a nonce.
    expect(await policy("/daily")).not.toBe(await policy("/daily"));
  });

  test("the same routes are never cached by a shared cache (next.config's list has them all)", async () => {
    const { PRIVATE_ROUTE_HEADS } = await import("../next.config");
    const { REQUEST_PAGE_HEADS, REQUEST_PAGE_PREFIXES } = await import("@/lib/app/routes");
    const listed = new Set<string>(PRIVATE_ROUTE_HEADS);
    for (const head of [...APP_ROUTE_HEADS, ...REQUEST_PAGE_HEADS, ...REQUEST_PAGE_PREFIXES, "api"]) expect(listed.has(head), head).toBe(true);
  });
});

describe("redirects between Folevi's own hosts", () => {
  test("keep the host they were given, whatever the path says", async () => {
    const { onHost } = await import("@/lib/security/redirects");
    expect(onHost("https://folevi.com", "/pricing", "?a=1").href).toBe("https://folevi.com/pricing?a=1");
    for (const path of ["//evil.example/x", "/\\evil.example", "///evil.example", "/\\/evil.example", "//", "/%2F%2Fevil.example"]) {
      expect(onHost("https://folevi.com", path, "").host, path).toBe("folevi.com");
    }
    expect(onHost("https://folevi.com", "//evil.example/x", "?q=1").href).toBe("https://folevi.com/evil.example/x?q=1");
  });
});
