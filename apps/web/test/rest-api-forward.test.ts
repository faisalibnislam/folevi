// /api/v1/* is forwarded to the backend as it is. Only the REST API's own paths may be: an address is read the way
// the forwarding fetch reads it, so one written to climb out ("/api/v1/%2e%2e/x") is refused (lib/api/forward.ts).
import { afterEach, describe, expect, test, vi } from "vitest";
import { restApiTarget } from "@/lib/api/forward";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/mcp", () => ({ convexSiteUrl: () => "https://backend.example" }));

afterEach(() => vi.unstubAllGlobals());

describe("the REST API's forwarding", () => {
  test("its own paths go through with their query", () => {
    expect(restApiTarget("https://app.folevi.com/api/v1/notes")).toBe("/api/v1/notes");
    expect(restApiTarget("https://app.folevi.com/api/v1/notes/01HZX?limit=5&q=a%2Fb")).toBe("/api/v1/notes/01HZX?limit=5&q=a%2Fb");
  });

  test("an address that leaves /api/v1 once it is read is refused", () => {
    for (const path of [
      "/api/v1/../auth/get-session",
      "/api/v1/%2e%2e/%2e%2e/files/x",
      "/api/v1/%2E%2E/auth/sign-in/email",
      "/api/v1/.%2e/x",
      "/api/v1/..%2Fauth",
      "/api/v1/x%2F..%2F..%2Fauth",
      "/api/v1/notes%5C..%5C..%5Cauth",
      "/api/v1\\..\\auth",
      "/api/v1",
      "/api/v10/notes",
      "/mcp",
    ]) {
      expect(restApiTarget(`https://app.folevi.com${path}`), path).toBeNull();
    }
    expect(restApiTarget("not an address")).toBeNull();
  });

  test("the route asks the backend only for what passed, and answers 404 itself otherwise", async () => {
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      asked.push(url);
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });
    const { GET } = await import("@/app/api/v1/[...path]/route");
    const bad = await GET(new Request("https://app.folevi.com/api/v1/%2e%2e/%2e%2e/api/auth/get-session"));
    expect(bad.status).toBe(404);
    expect(asked).toEqual([]);
    const ok = await GET(new Request("https://app.folevi.com/api/v1/notes?limit=1"));
    expect(ok.status).toBe(200);
    expect(asked).toEqual(["https://backend.example/api/v1/notes?limit=1"]);
  });
});
