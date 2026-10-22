import { describe, expect, test } from "vitest";
import { buildContentSecurityPolicy, createNonce } from "@/lib/security/csp";
import { EMBED_FRAME_ORIGINS, embedFor } from "@folevi/editor-schema";

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

  test("embeds may frame exactly the players they're built for", () => {
    const frames = buildContentSecurityPolicy({ ...env, dev: false }).split("; ").find((d) => d.startsWith("frame-src"))!;
    for (const o of EMBED_FRAME_ORIGINS) expect(frames).toContain(o);
    for (const url of ["https://youtu.be/dQw4w9WgXcQ", "https://vimeo.com/76979871", "https://www.loom.com/share/0281766fa2d04bb788eaf19e65135184", "https://www.figma.com/design/AbCdEfGhIjKlMnOp/x", "https://www.google.com/maps/place/Oban"]) {
      expect(EMBED_FRAME_ORIGINS).toContain(new URL(embedFor(url)!.src).origin);
    }
  });

  test("only /place-sync may be framed, and only by the app itself", () => {
    expect(buildContentSecurityPolicy({ ...env, dev: false, frameAncestors: "self" })).toContain("frame-ancestors 'self'");
    expect(buildContentSecurityPolicy({ ...env, dev: false })).toContain("frame-ancestors 'none'");
    expect(buildContentSecurityPolicy({ ...env, dev: false }).split("; ").find((d) => d.startsWith("frame-src"))).toMatch(/^frame-src 'self' /);
  });

  test("nonces are unique and unguessable-length", () => {
    const a = createNonce();
    const b = createNonce();
    expect(a).not.toBe(b);
    expect(atob(a)).toHaveLength(16);
  });
});
