import { describe, expect, test } from "vitest";
import { addressProblem, downloadCalendar, isFoleviHost, isPrivateAddress } from "./calendarFetch";

const SERVICE = "app.folevi.com";
const ICS = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n";

type Call = { url: string; init: RequestInit };

/** A fetch answering from a table of URL → response, recording what was asked. */
function fakeFetch(answers: Record<string, () => Response>) {
  const calls: Call[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    const answer = answers[url];
    if (!answer) throw new TypeError("fetch failed");
    return answer();
  }) as typeof fetch;
  return { f, calls };
}

const publicDns = async () => ["93.184.216.34"];

describe("calendar links on the Mac", () => {
  test("Folevi's own hosts, private addresses and anything but https are refused", () => {
    expect(isFoleviHost("folevi.com", SERVICE)).toBe(true);
    expect(isFoleviHost("API.Folevi.com.", SERVICE)).toBe(true);
    expect(isFoleviHost("happy-cat-123.convex.cloud", SERVICE)).toBe(true);
    expect(isFoleviHost("notfolevi.com", SERVICE)).toBe(false);
    expect(addressProblem("https://app.folevi.com/feed.ics", SERVICE)).toMatch(/Folevi's own/);
    expect(addressProblem("https://calendar.google.com/x.ics", SERVICE)).toBeNull();
    expect(addressProblem("http://calendar.example.com/x.ics", SERVICE)).toMatch(/secure \(https\)/);
    expect(addressProblem("file:///etc/passwd", SERVICE)).toMatch(/isn't a web link/);
    expect(addressProblem("https://user:pw@example.com/x.ics", SERVICE)).toMatch(/isn't a web link/);
    expect(addressProblem("https://example.com:8443/x.ics", SERVICE)).toMatch(/isn't a web link/);
    expect(addressProblem("https://localhost/x.ics", SERVICE)).toMatch(/private or local/);
    expect(addressProblem("https://nas.local/x.ics", SERVICE)).toMatch(/private or local/);
    expect(addressProblem("https://10.0.0.5/x.ics", SERVICE)).toMatch(/private or local/);
    expect(addressProblem("https://[::1]/x.ics", SERVICE)).toMatch(/private or local/);
    expect(isPrivateAddress("169.254.169.254")).toBe(true);
    expect(isPrivateAddress("::ffff:192.168.0.1")).toBe(true);
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
  });

  test("a calendar is fetched without cookies, conditionally when it has an ETag", async () => {
    const { f, calls } = fakeFetch({ "https://cal.example.com/team.ics": () => new Response(ICS, { headers: { etag: '"v2"', "last-modified": "Tue, 20 Oct 2026 10:00:00 GMT" } }) });
    const got = await downloadCalendar(" webcal://cal.example.com/team.ics ", { etag: '"v1"' }, { serviceHost: SERVICE, fetch: f, lookup: publicDns });
    expect(got).toEqual({ kind: "ok", text: ICS, etag: '"v2"', lastModified: "Tue, 20 Oct 2026 10:00:00 GMT" });
    expect(calls[0]!.init).toMatchObject({ redirect: "manual", credentials: "omit", headers: { "if-none-match": '"v1"' } });
  });

  test("304 is unchanged; errors say why in the server's words", async () => {
    const { f } = fakeFetch({
      "https://a.example.com/x.ics": () => new Response(null, { status: 304 }),
      "https://b.example.com/x.ics": () => new Response("nope", { status: 404 }),
      "https://c.example.com/x.ics": () => new Response("<html>hello</html>"),
    });
    const deps = { serviceHost: SERVICE, fetch: f, lookup: publicDns };
    expect(await downloadCalendar("https://a.example.com/x.ics", {}, deps)).toEqual({ kind: "notModified" });
    expect(await downloadCalendar("https://b.example.com/x.ics", {}, deps)).toEqual({ kind: "error", message: "Couldn't load this calendar: the address returned 404." });
    expect(await downloadCalendar("https://c.example.com/x.ics", {}, deps)).toEqual({ kind: "error", message: "Couldn't load this calendar: the address didn't return a calendar." });
    expect(await downloadCalendar("https://d.example.com/x.ics", {}, deps)).toEqual({ kind: "error", message: "Couldn't load this calendar: the address couldn't be reached." });
    expect(await downloadCalendar(42, {}, deps)).toMatchObject({ kind: "error" });
  });

  test("every redirect is checked again: to a private address, to Folevi or to http it stops", async () => {
    const { f, calls } = fakeFetch({
      "https://hop.example.com/x.ics": () => new Response(null, { status: 302, headers: { location: "https://internal.example.com/x.ics" } }),
      "https://folevi-hop.example.com/x.ics": () => new Response(null, { status: 301, headers: { location: "https://app.folevi.com/feed" } }),
      "https://http-hop.example.com/x.ics": () => new Response(null, { status: 301, headers: { location: "http://plain.example.com/x.ics" } }),
      "https://ok-hop.example.com/x.ics": () => new Response(null, { status: 307, headers: { location: "/real.ics" } }),
      "https://ok-hop.example.com/real.ics": () => new Response(ICS),
    });
    const lookup = async (host: string) => (host === "internal.example.com" ? ["10.1.2.3"] : ["93.184.216.34"]);
    const deps = { serviceHost: SERVICE, fetch: f, lookup };
    expect(await downloadCalendar("https://hop.example.com/x.ics", {}, deps)).toEqual({ kind: "error", message: "Couldn't load this calendar: addresses on private or local networks can't be used." });
    expect(await downloadCalendar("https://folevi-hop.example.com/x.ics", {}, deps)).toEqual({ kind: "error", message: "Couldn't load this calendar: Folevi's own addresses can't be subscribed to." });
    expect(await downloadCalendar("https://http-hop.example.com/x.ics", {}, deps)).toMatchObject({ kind: "error", message: expect.stringMatching(/secure \(https\)/) });
    expect(await downloadCalendar("https://ok-hop.example.com/x.ics", {}, deps)).toMatchObject({ kind: "ok", text: ICS });
    // Nothing private or Folevi's was ever asked.
    expect(calls.map((c) => new URL(c.url).hostname)).not.toContain("internal.example.com");
    expect(calls.map((c) => new URL(c.url).hostname)).not.toContain("app.folevi.com");
  });

  test("a host whose DNS answers are private is refused; one that can't be found says so", async () => {
    const { f, calls } = fakeFetch({});
    expect(await downloadCalendar("https://rebind.example.com/x.ics", {}, { serviceHost: SERVICE, fetch: f, lookup: async () => ["127.0.0.1"] })).toMatchObject({ message: expect.stringMatching(/private or local/) });
    expect(await downloadCalendar("https://gone.example.com/x.ics", {}, { serviceHost: SERVICE, fetch: f, lookup: async () => Promise.reject(new Error("ENOTFOUND")) })).toMatchObject({ message: "Couldn't load this calendar: the address couldn't be found." });
    expect(calls).toEqual([]);
  });

  test("more than 5 MB is refused", async () => {
    const big = "BEGIN:VCALENDAR\r\n" + "X".repeat(5 * 1024 * 1024 + 10);
    const { f } = fakeFetch({ "https://big.example.com/x.ics": () => new Response(big) });
    expect(await downloadCalendar("https://big.example.com/x.ics", {}, { serviceHost: SERVICE, fetch: f, lookup: publicDns })).toEqual({ kind: "error", message: "Couldn't load this calendar: it's larger than 5 MB." });
  });
});
