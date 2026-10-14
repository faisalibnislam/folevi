// Breached passwords (convex/lib/breachedPasswords.ts): sign-up, password change and reset refuse a password
// in Have I Been Pwned's list, sending only the first 5 characters of its SHA-1; if the service is down or
// slow, the password is allowed.
import { createHash } from "node:crypto";
import { afterEach, describe, expect, test, vi } from "vitest";
import { components } from "../../convex/_generated/api";
import { BREACHED_PASSWORD_MESSAGE, pwnedPasswordStatus } from "../../convex/lib/breachedPasswords";
import { setup, type T } from "./helpers";

process.env.BETTER_AUTH_SECRET ??= "test-secret-".repeat(4);

const ORIGIN = "http://app.localhost:3000";
const BREACHED = "correct horse battery staple";
const FINE = "quiet folio test password 7c1f";

const sha1 = (s: string) => createHash("sha1").update(s).digest("hex").toUpperCase();

/** A fake Pwned Passwords range API that knows BREACHED (and some padding rows), recording what it was asked. */
function stubRangeApi(mode: "up" | "down" | "error" | "hang" = "up") {
  const asked: { url: string; padding: string | null }[] = [];
  const real = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith("https://api.pwnedpasswords.com/")) return real(input, init);
    asked.push({ url, padding: new Headers(init?.headers).get("Add-Padding") });
    if (mode === "down") throw new TypeError("fetch failed");
    if (mode === "error") return new Response("busy", { status: 503 });
    if (mode === "hang") return await new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    const prefix = url.slice(-5);
    const known = sha1(BREACHED);
    const rows = ["0018A45C4D1DEF81644B54AB7F969B88D65:0", "00D4F6E8FA6EECAD2A3AA415EEC418D38EC:2"];
    if (known.startsWith(prefix)) rows.push(`${known.slice(5)}:3861493`);
    return new Response(rows.join("\r\n"), { status: 200 });
  });
  return asked;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

async function signUp(t: T, email: string, password: string) {
  const res = await t.fetch("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ name: "Pat", email, password }),
  });
  return { status: res.status, body: (await res.json()) as { code?: string; message?: string } };
}

async function userExists(t: T, email: string) {
  return (await t.run(async (ctx) => await ctx.runQuery(components.betterAuth.adapter.findOne, { model: "user", where: [{ field: "email", value: email }] }))) !== null;
}

describe("sign-up", () => {
  test("a breached password is refused, sending only the hash prefix", async () => {
    const t = setup();
    const asked = stubRangeApi();
    const res = await signUp(t, "breached@example.com", BREACHED);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("PASSWORD_COMPROMISED");
    expect(res.body.message).toBe(BREACHED_PASSWORD_MESSAGE);
    expect(await userExists(t, "breached@example.com")).toBe(false);
    expect(asked).toEqual([{ url: `https://api.pwnedpasswords.com/range/${sha1(BREACHED).slice(0, 5)}`, padding: "true" }]);
  });

  test("a password that isn't in the list is accepted", async () => {
    const t = setup();
    stubRangeApi();
    const res = await signUp(t, "fine@example.com", FINE);
    expect(res.status).toBe(200);
    expect(await userExists(t, "fine@example.com")).toBe(true);
  });

  test("if the service is down, the password is allowed and the warning never includes it", async () => {
    const t = setup();
    const asked = stubRangeApi("down");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await signUp(t, "down@example.com", BREACHED);
    expect(res.status).toBe(200);
    expect(asked).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).not.toContain(BREACHED);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(sha1(BREACHED).slice(0, 5));
    warn.mockRestore();
  });

  test("too-short passwords are refused by the length rule without asking the service", async () => {
    const t = setup();
    const asked = stubRangeApi();
    const res = await signUp(t, "short@example.com", "short");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("PASSWORD_TOO_SHORT");
    expect(asked).toHaveLength(0);
  });
});

describe("password change and reset", () => {
  test("both check the new password", async () => {
    const t = setup();
    const asked = stubRangeApi();
    const reset = await t.fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ newPassword: BREACHED, token: "not-a-real-token" }),
    });
    expect(reset.status).toBe(400);
    expect(((await reset.json()) as { code: string }).code).toBe("PASSWORD_COMPROMISED");
    const change = await t.fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ currentPassword: FINE, newPassword: BREACHED }),
    });
    expect(change.status).toBe(400);
    expect(((await change.json()) as { code: string }).code).toBe("PASSWORD_COMPROMISED");
    expect(asked).toHaveLength(2);
  });
});

describe("pwnedPasswordStatus", () => {
  test("an error reply or a reply slower than the limit counts as unknown", async () => {
    stubRangeApi("error");
    expect(await pwnedPasswordStatus(BREACHED)).toBe("unknown");
    vi.unstubAllGlobals();
    stubRangeApi("hang");
    const started = Date.now();
    expect(await pwnedPasswordStatus(BREACHED, fetch, 50)).toBe("unknown");
    expect(Date.now() - started).toBeLessThan(1000);
  });

  test("padding rows (count 0) never match", async () => {
    vi.stubGlobal("fetch", async () => new Response(`${sha1(FINE).slice(5)}:0\r\nABC:1`, { status: 200 }));
    expect(await pwnedPasswordStatus(FINE)).toBe("ok");
  });
});
