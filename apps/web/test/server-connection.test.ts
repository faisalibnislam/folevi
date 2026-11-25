import { describe, expect, it, vi } from "vitest";
import { answersAsServer, bestOrigin, candidateOrigins, isHomeName, originOf, urlsAt, watchBestOrigin, type Fetcher } from "@/lib/server-edition/connection";

const place = {
  addedOrigin: "http://192.168.1.20:8460",
  hostnames: ["abc1234567.folevi.app", "192-168-1-20.abc1234567.folevi.app"],
  serverId: "abc1234567",
};

function fakeFetch(answers: Record<string, unknown | "down">): Fetcher {
  return async (url) => {
    const origin = new URL(url).origin;
    const a = answers[origin];
    if (a === undefined || a === "down") throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify(a), { status: 200, headers: { "content-type": "application/json" } });
  };
}
const me = { kind: "folevi-server", connect: { serverId: "abc1234567" } };

describe("best connection", () => {
  it("reads origins and home names", () => {
    expect(originOf("abc.folevi.app")).toBe("https://abc.folevi.app");
    expect(originOf("abc.folevi.app:8443")).toBe("https://abc.folevi.app:8443");
    expect(originOf("http://example.com")).toBeNull();
    expect(originOf("https://x.example/path")).toBeNull();
    expect(isHomeName("https://192-168-1-20.abc.folevi.app")).toBe(true);
    expect(isHomeName("https://abc.folevi.app")).toBe(false);
  });

  it("orders home names, then the added address, then the rest", () => {
    expect(candidateOrigins(place)).toEqual([
      "https://192-168-1-20.abc1234567.folevi.app",
      "http://192.168.1.20:8460",
      "https://abc1234567.folevi.app",
    ]);
    expect(candidateOrigins({ addedOrigin: "https://notes.example.com", hostnames: [], serverId: null })).toEqual(["https://notes.example.com"]);
  });

  it("moves urls on the added origin to the chosen one", () => {
    const urls = { app: "http://192.168.1.20:8460", convex: "http://192.168.1.20:8460/convex", convexSite: "http://192.168.1.20:8460/convex-site" };
    expect(urlsAt(urls, place.addedOrigin, "https://abc1234567.folevi.app")).toEqual({
      app: "https://abc1234567.folevi.app",
      convex: "https://abc1234567.folevi.app/convex",
      convexSite: "https://abc1234567.folevi.app/convex-site",
    });
  });

  it("picks the first that answers as this server", async () => {
    // At home: everything answers, the home name wins.
    let fetcher = fakeFetch({
      "https://192-168-1-20.abc1234567.folevi.app": me,
      "http://192.168.1.20:8460": me,
      "https://abc1234567.folevi.app": me,
    });
    expect(await bestOrigin(place, { fetcher })).toBe("https://192-168-1-20.abc1234567.folevi.app");
    // Away: only the public name (direct or relay).
    fetcher = fakeFetch({ "https://abc1234567.folevi.app": me });
    expect(await bestOrigin(place, { fetcher })).toBe("https://abc1234567.folevi.app");
    // Another server on the same home address isn't this one.
    fetcher = fakeFetch({ "http://192.168.1.20:8460": { kind: "folevi-server", connect: { serverId: "zzzzzzzzzz" } }, "https://abc1234567.folevi.app": me });
    expect(await bestOrigin(place, { fetcher })).toBe("https://abc1234567.folevi.app");
    // Offline.
    expect(await bestOrigin(place, { fetcher: fakeFetch({}) })).toBeNull();
  });

  it("refuses Folevi Cloud and times out slow addresses", async () => {
    expect(await answersAsServer("https://folevi.com", { serverId: null }, { fetcher: fakeFetch({ "https://folevi.com": { kind: "folevi-cloud" } }) })).toBe(false);
    const hang: Fetcher = (_url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))));
    expect(await answersAsServer("https://slow.example", { serverId: null }, { fetcher: hang, timeoutMs: 20 })).toBe(false);
  });

  it("re-checks when the device comes back online", async () => {
    const listeners: Record<string, () => void> = {};
    const target = { addEventListener: (t: string, f: () => void) => (listeners[t] = f), removeEventListener: vi.fn() } as unknown as Pick<Window, "addEventListener" | "removeEventListener">;
    let answers: Record<string, unknown> = { "https://192-168-1-20.abc1234567.folevi.app": me, "https://abc1234567.folevi.app": me };
    const fetcher: Fetcher = (url, init) => fakeFetch(answers)(url, init);
    const changes: string[] = [];
    const stop = watchBestOrigin(place, "https://192-168-1-20.abc1234567.folevi.app", (o) => changes.push(o), { fetcher, target, minGapMs: 0 });
    await vi.waitFor(() => expect(listeners.online).toBeDefined());
    answers = { "https://abc1234567.folevi.app": me };
    listeners.online!();
    await vi.waitFor(() => expect(changes).toEqual(["https://abc1234567.folevi.app"]));
    stop();
  });
});
