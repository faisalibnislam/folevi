// Bookmark previews fetch a link the person typed, on the server (security audit 2026-11-26, M1). The link is
// checked like a page Foli AI reads (lib/ai/web.ts checkHost): standard ports only, and every address the host
// name has must be public, on the first request and on every redirect hop. Before, only the host as written was
// looked at, so a public name pointing at a private address (or any port) was fetched and its title returned.
import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { person, setup } from "./helpers";

interface Route {
  status?: number;
  body?: string;
  headers?: Record<string, string>;
}

/** A stubbed network: DNS-over-HTTPS answers from `dns` (host to address), pages from `routes`. Returns every page request. */
function network(dns: Record<string, string>, routes: Record<string, Route>) {
  const requests: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.startsWith("https://dns.google/resolve")) {
        const u = new URL(url);
        const ip = dns[u.searchParams.get("name") ?? ""];
        const type = u.searchParams.get("type");
        const answer = ip && (type === "A") === !ip.includes(":") ? [{ type: type === "A" ? 1 : 28, data: ip }] : [];
        return new Response(JSON.stringify({ Status: 0, Answer: answer }), { status: 200 });
      }
      requests.push(url);
      const route = routes[url];
      if (!route) return new Response("not found", { status: 404 });
      return new Response(route.body ?? "", { status: route.status ?? 200, headers: route.headers });
    }),
  );
  return requests;
}

const page = (title: string): Route => ({ body: `<html><head><title>${title}</title></head><body></body></html>`, headers: { "content-type": "text/html; charset=utf-8" } });
const EMPTY = { title: null, description: null, siteName: null, image: null, icon: null };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("bookmark previews never reach a private address", { timeout: 30_000 }, () => {
  test("a public name that points at a private, loopback or metadata address is never fetched", async () => {
    const t = setup();
    const a = await person(t, "ssrf-dns@example.com");
    const requests = network(
      { "inside.attacker.example": "10.0.0.5", "loop.attacker.example": "127.0.0.1", "meta.attacker.example": "169.254.169.254", "v6.attacker.example": "fd00::1" },
      {
        "http://inside.attacker.example/admin": page("Router admin"),
        "http://loop.attacker.example/": page("Local service"),
        "http://meta.attacker.example/latest/meta-data/": page("Metadata"),
        "http://v6.attacker.example/": page("Inside v6"),
      },
    );
    for (const url of ["http://inside.attacker.example/admin", "http://loop.attacker.example/", "http://meta.attacker.example/latest/meta-data/", "http://v6.attacker.example/"]) {
      expect(await a.as.action(api.bookmarks.preview, { url }), url).toEqual(EMPTY);
    }
    // A name that has no address at all isn't fetched either.
    expect(await a.as.action(api.bookmarks.preview, { url: "http://nowhere.attacker.example/" })).toEqual(EMPTY);
    expect(requests).toEqual([]);
  });

  test("only ports 80 and 443", async () => {
    const t = setup();
    const a = await person(t, "ssrf-port@example.com");
    const requests = network({ "site.example.com": "93.184.216.34" }, { "http://site.example.com:8080/admin": page("Admin on 8080"), "https://site.example.com:8443/": page("Admin on 8443") });
    expect(await a.as.action(api.bookmarks.preview, { url: "http://site.example.com:8080/admin" })).toEqual(EMPTY);
    expect(await a.as.action(api.bookmarks.preview, { url: "https://site.example.com:8443/" })).toEqual(EMPTY);
    expect(requests).toEqual([]);
  });

  test("a redirect is checked like the first request: its host is looked up, its port must be standard", async () => {
    const t = setup();
    const a = await person(t, "ssrf-redirect@example.com");
    const requests = network(
      { "outside.example.com": "93.184.216.34", "inside.attacker.example": "192.168.1.1" },
      {
        "https://outside.example.com/a": { status: 302, headers: { location: "http://inside.attacker.example/status" } },
        "https://outside.example.com/b": { status: 302, headers: { location: "http://outside.example.com:9200/_cat" } },
        "https://outside.example.com/c": { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } },
        "http://inside.attacker.example/status": page("Printer status"),
        "http://outside.example.com:9200/_cat": page("Search cluster"),
      },
    );
    for (const path of ["a", "b", "c"]) expect(await a.as.action(api.bookmarks.preview, { url: `https://outside.example.com/${path}` }), path).toEqual(EMPTY);
    expect(requests).toEqual(["https://outside.example.com/a", "https://outside.example.com/b", "https://outside.example.com/c"]);
  });

  test("a public page still gets its preview, through a redirect too", async () => {
    const t = setup();
    const a = await person(t, "ssrf-ok@example.com");
    network(
      { "outside.example.com": "93.184.216.34", "www.example.org": "93.184.216.35" },
      { "https://outside.example.com/go": { status: 301, headers: { location: "https://www.example.org/page" } }, "https://www.example.org/page": page("A public page") },
    );
    expect(await a.as.action(api.bookmarks.preview, { url: "https://outside.example.com/go" })).toEqual({ ...EMPTY, title: "A public page", icon: "https://www.example.org/favicon.ico" });
  });
});
