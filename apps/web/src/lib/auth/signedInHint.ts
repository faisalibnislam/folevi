// A "this browser is signed in" hint the marketing site can read. The session cookie itself stays
// host-only and HTTP-only on the app host; this one carries no secret (just "1"), is shared with the
// marketing host, and only decides whether folevi.com sends someone straight to their notes. The app still
// checks the real session on every request, so a stale hint costs one redirect to the sign-in page.

export const SIGNED_IN_HINT = "folevi_signed_in";
const ONE_YEAR = 60 * 60 * 24 * 365;

const hostname = (host: string) => host.split(":")[0]?.toLowerCase() ?? "";

/**
 * The Domain the hint is shared on: the marketing host when the app host is under it (app.folevi.com and
 * folevi.com). Browsers ignore Domain=localhost, so locally the hint stays on the app host.
 */
export function hintDomain(appHost: string, marketingHost: string): string | null {
  const app = hostname(appHost);
  const site = hostname(marketingHost);
  if (!site || site === "localhost" || !site.includes(".")) return null;
  return app === site || app.endsWith(`.${site}`) ? site : null;
}

export function hintCookie(on: boolean, domain: string | null, secure: boolean): string {
  const parts = [`${SIGNED_IN_HINT}=${on ? "1" : ""}`, "Path=/", `Max-Age=${on ? ONE_YEAR : 0}`, "SameSite=Lax"];
  if (domain) parts.push(`Domain=${domain}`);
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/**
 * What a Better Auth response did to the session cookie: "set" when it signed someone in (or refreshed
 * the session), "cleared" when it signed them out, null when it didn't touch it.
 */
export function sessionChange(setCookies: string[]): "set" | "cleared" | null {
  let change: "set" | "cleared" | null = null;
  for (const raw of setCookies) {
    const [pair = "", ...attrs] = raw.split(";");
    const eq = pair.indexOf("=");
    const name = pair.slice(0, eq).trim();
    if (!name.endsWith("session_token")) continue;
    const value = pair.slice(eq + 1).trim();
    const expired = attrs.some((a) => {
      const [k = "", v = ""] = a.split("=").map((s) => s.trim());
      if (k.toLowerCase() === "max-age") return Number(v) <= 0;
      if (k.toLowerCase() === "expires") return Date.parse(v) <= Date.now();
      return false;
    });
    change = !value || expired ? "cleared" : "set";
  }
  return change;
}
