import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { redact, requestIdFrom, withRequestLog } = await import("@/lib/server/log");

afterEach(() => vi.restoreAllMocks());

describe("structured server logs", () => {
  test("drop anything that could carry content, identity or secrets", () => {
    const out = redact({
      requestId: "req-12345678",
      route: "/api/x",
      status: 200,
      email: "a@example.com",
      password: "hunter2",
      token: "abc",
      title: "Private plans",
      ip: "10.0.0.1",
      cookie: "a=b",
      outcome: "ok",
    });
    expect(out).toEqual({ requestId: "req-12345678", route: "/api/x", status: 200, outcome: "ok" });
  });

  test("request ids come from trusted upstream headers when well-formed", () => {
    expect(requestIdFrom(new Headers({ "x-request-id": "abc12345-ok" }))).toBe("abc12345-ok");
    expect(requestIdFrom(new Headers({ "x-vercel-id": "iad1::abcd-1234567" }))).toBe("iad1::abcd-1234567");
    const generated = requestIdFrom(new Headers({ "x-request-id": "<script>" }));
    expect(generated).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("route wrapper tags responses and hides unexpected errors", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((l: string) => void lines.push(l));
    vi.spyOn(console, "error").mockImplementation((l: string) => void lines.push(l));
    const ok = withRequestLog("/api/ok", async () => new Response("fine"));
    const res = await ok(new Request("https://app.folevi.com/api/ok?token=secret", { headers: { "x-request-id": "req-abcdefgh" } }));
    expect(res.headers.get("x-request-id")).toBe("req-abcdefgh");
    const boom = withRequestLog("/api/boom", async () => {
      throw new Error("db password is hunter2");
    });
    const failed = await boom(new Request("https://app.folevi.com/api/boom", { method: "POST" }));
    expect(failed.status).toBe(500);
    expect(await failed.text()).toBe("Something went wrong.");
    const joined = lines.join("\n");
    expect(joined).not.toMatch(/hunter2|token=secret/);
    expect(lines.map((l) => JSON.parse(l).event)).toEqual(["http.request", "http.unhandled"]);
  });
});
