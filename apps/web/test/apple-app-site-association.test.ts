// @vitest-environment node
// app.folevi.com/.well-known/apple-app-site-association: the iPhone and iPad app (team 7K32QQ2FX8) opens the
// site's note and app-page links, and only pages the app's deep links accept.
import { describe, expect, test } from "vitest";
import { GET } from "@/app/.well-known/apple-app-site-association/route";
import { parseDeepLink } from "@/lib/deepLink";

type Aasa = { applinks: { details: { appIDs: string[]; components: { "/": string }[] }[] }; webcredentials: { apps: string[] } };

describe("apple-app-site-association", () => {
  test("names the iOS app under the paid team, as JSON with no redirect", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as Aasa;
    expect(body.applinks.details).toHaveLength(1);
    expect(body.applinks.details[0]!.appIDs).toEqual(["7K32QQ2FX8.com.folevi.ios"]);
    expect(body.webcredentials.apps).toEqual(["7K32QQ2FX8.com.folevi.ios"]);
  });

  test("every claimed path is one the app's folevi:// links open; sign-in, shares and the API stay on the web", async () => {
    const body = (await GET().json()) as Aasa;
    const paths = body.applinks.details[0]!.components.map((c) => c["/"]);
    expect(paths).toContain("/d/*");
    for (const p of paths) {
      const sample = p.replace("/*", "/x").replace(/^\/d\/x$/, "/d/01JABCDEFGHJKMNPQRSTVWXYZ0");
      expect(parseDeepLink(`folevi:/${sample}`), p).not.toBeNull();
    }
    for (const kept of ["/signin", "/connect", "/s/", "/api/", "/admin"]) expect(paths.some((p) => p.startsWith(kept))).toBe(false);
  });
});
