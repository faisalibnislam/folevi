// Development-only pages (/dev/*, the dev mailbox) never answer on a production deployment, and never on a Folevi
// server: a server is always production, but folevid tells only the backend so (FOLEVI_ENV), not the web process,
// so the pages ask the edition as well (lib/edition.ts devPagesAvailable).
import { afterEach, describe, expect, test, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { devPagesAvailable } from "@/lib/edition";

vi.mock("server-only", () => ({}));
const { devMailboxAvailable } = await import("@/lib/devMailbox");

afterEach(() => vi.unstubAllEnvs());

const env = (o: Record<string, string>) => {
  for (const name of ["VERCEL_ENV", "FOLEVI_ENV", "NEXT_PUBLIC_FOLEVI_EDITION", "FOLEVI_DEV_MAILBOX_SECRET"]) vi.stubEnv(name, o[name] ?? "");
};

describe("development-only pages", () => {
  test("answer in development and on a preview", () => {
    env({});
    expect(devPagesAvailable()).toBe(true);
    env({ VERCEL_ENV: "preview" });
    expect(devPagesAvailable()).toBe(true);
  });

  test("never on production", () => {
    env({ VERCEL_ENV: "production" });
    expect(devPagesAvailable()).toBe(false);
    env({ FOLEVI_ENV: "production" });
    expect(devPagesAvailable()).toBe(false);
  });

  test("never on a Folevi server, whose web process has no FOLEVI_ENV", () => {
    env({ NEXT_PUBLIC_FOLEVI_EDITION: "server" });
    expect(devPagesAvailable()).toBe(false);
    env({ NEXT_PUBLIC_FOLEVI_EDITION: "server", FOLEVI_DEV_MAILBOX_SECRET: "set" });
    expect(devMailboxAvailable()).toBe(false);
  });

  test("the dev mailbox also needs its secret", () => {
    env({});
    expect(devMailboxAvailable()).toBe(false);
    env({ FOLEVI_DEV_MAILBOX_SECRET: "set" });
    expect(devMailboxAvailable()).toBe(true);
    env({ FOLEVI_DEV_MAILBOX_SECRET: "set", VERCEL_ENV: "production" });
    expect(devMailboxAvailable()).toBe(false);
  });

  test("/dev/share-card is not found on a Folevi server", async () => {
    const { GET } = await import("@/app/dev/share-card/route");
    env({ NEXT_PUBLIC_FOLEVI_EDITION: "server" });
    await expect(GET(new Request("https://notes.example/dev/share-card?n=0"))).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
  });

  test("every page and route under /dev and /api/dev asks before it answers", () => {
    const app = join(process.cwd(), "src", "app");
    const entries: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (name === "page.tsx" || name === "route.ts") entries.push(path);
      }
    };
    walk(join(app, "dev"));
    walk(join(app, "api", "dev"));
    expect(entries.length).toBeGreaterThanOrEqual(6);
    for (const path of entries) {
      const source = readFileSync(path, "utf8");
      expect(/if \(!dev(Pages|Mailbox)Available\(\)\) (notFound\(\)|return new NextResponse\("Not found", \{ status: 404 \}\));/.test(source), path).toBe(true);
    }
  });
});
