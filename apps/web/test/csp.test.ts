import { describe, expect, test } from "vitest";
import { buildContentSecurityPolicy, createNonce } from "@/lib/security/csp";

const env = {
  convexUrl: "https://happy-otter-123.convex.cloud",
  convexSiteUrl: "https://happy-otter-123.convex.site",
  appUrl: "https://app.folevi.com",
};

describe("content security policy", () => {
  test("next.config's static policy matches the shared builder", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = env.convexUrl;
    process.env.NEXT_PUBLIC_CONVEX_SITE_URL = env.convexSiteUrl;
    process.env.NEXT_PUBLIC_APP_URL = env.appUrl;
    const { staticCsp } = await import("../next.config");
    const dev = process.env.NODE_ENV !== "production";
    expect(staticCsp).toBe(buildContentSecurityPolicy({ ...env, dev }));
  });

  test("with a nonce, inline scripts need the nonce ('unsafe-inline' is gone)", () => {
    const nonce = createNonce();
    const policy = buildContentSecurityPolicy({ ...env, dev: false, nonce });
    const script = policy.split("; ").find((d) => d.startsWith("script-src"))!;
    expect(script).toBe(`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`);
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).not.toMatch(/\s{2,}/);
  });

  test("nonces are unique and unguessable-length", () => {
    const a = createNonce();
    const b = createNonce();
    expect(a).not.toBe(b);
    expect(atob(a)).toHaveLength(16);
  });
});
