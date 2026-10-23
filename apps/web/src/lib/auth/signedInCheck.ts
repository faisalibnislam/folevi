// folevi.com opens your notes when you're signed in. The proxy does that from the signed-in hint cookie
// (lib/auth/signedInHint.ts); this is the fallback for a browser that is signed in on the app host but has no
// hint on the marketing host (it was never set there, a browser or extension dropped it, the landing page came
// back from the back/forward cache). The landing page asks the app host, with the browser's own cookies,
// whether there is a live session, and if there is it goes to the notes.
//
// The answer is one boolean, readable by the marketing origin only (CORS), never cached.

const MARKETING_URL = process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://folevi.com";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.folevi.com";

export const SIGNED_IN_PATH = "/api/signed-in";

const originOf = (url: string) => {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
};

/**
 * Who may ask: the marketing site (cross-origin, so it gets CORS headers with credentials) and the app itself
 * (same origin, or no Origin header at all). Anyone else is refused, and gets no CORS headers to read it with.
 */
export function signedInCors(requestOrigin: string | null, marketingOrigin: string, appOrigin: string): { allowed: boolean; headers: Record<string, string> } {
  const base = { "cache-control": "private, no-store", vary: "Origin" };
  if (!requestOrigin || requestOrigin === appOrigin) return { allowed: true, headers: base };
  if (requestOrigin === marketingOrigin) {
    return { allowed: true, headers: { ...base, "access-control-allow-origin": marketingOrigin, "access-control-allow-credentials": "true" } };
  }
  return { allowed: false, headers: base };
}

/** The headers a preflight gets (a plain GET without custom headers needs none, but a browser may still ask). */
export function signedInPreflight(requestOrigin: string | null, marketingOrigin: string, appOrigin: string): Record<string, string> {
  const { allowed, headers } = signedInCors(requestOrigin, marketingOrigin, appOrigin);
  if (!allowed || !headers["access-control-allow-origin"]) return headers;
  return { ...headers, "access-control-allow-methods": "GET", "access-control-max-age": "600" };
}

/** What the landing page does with the answer: only an explicit `{ signedIn: true }` leaves the page. */
export function isSignedInAnswer(body: unknown): boolean {
  return typeof body === "object" && body !== null && (body as { signedIn?: unknown }).signedIn === true;
}

const MARKETING_HOST = (() => {
  try {
    return new URL(MARKETING_URL).host;
  } catch {
    return "";
  }
})();

/**
 * Runs in <head> of every page and does nothing off the marketing home page (or on /?home, which always shows
 * it). On folevi.com/ it asks SIGNED_IN_PATH on the app host and replaces the page with the notes when the answer
 * is yes. The page is only hidden while it asks if this browser was found signed in here before (so a first-time
 * visitor never waits), and never for longer than 1.5 seconds: a slow or failed answer shows the page as usual.
 * A page restored from the back/forward cache asks again; a prerendered one asks when it's shown.
 */
export const SIGNED_IN_CHECK_SCRIPT = `(function(){try{var h=${JSON.stringify(MARKETING_HOST)},u=${JSON.stringify(originOf(APP_URL) + SIGNED_IN_PATH)},to=${JSON.stringify(originOf(APP_URL) + "/documents")},k="folevi:signed-in-here",d=document.documentElement;if(location.host!==h||location.pathname!=="/"||typeof fetch!=="function")return;if(new URLSearchParams(location.search).has("home"))return;var mark=function(on){try{if(on)localStorage.setItem(k,"1");else localStorage.removeItem(k);}catch(e){}};var check=function(){var hide=false,done=false,t=0;try{hide=localStorage.getItem(k)==="1";}catch(e){}var show=function(){if(done)return;done=true;clearTimeout(t);if(hide)d.style.visibility="";};if(hide){d.style.visibility="hidden";t=setTimeout(show,1500);}fetch(u,{credentials:"include",cache:"no-store"}).then(function(r){return r.ok?r.json():null;}).then(function(b){if(b&&b.signedIn===true){mark(true);if(!done){done=true;clearTimeout(t);}location.replace(to);return;}if(b)mark(false);show();},show);};if(document.prerendering)document.addEventListener("prerenderingchange",check,{once:true});else check();addEventListener("pageshow",function(e){if(e.persisted)check();});}catch(e){}})();`;

let cached: Promise<string> | null = null;
/** `'sha256-…'` source expression for SIGNED_IN_CHECK_SCRIPT (the nonce CSP allows it, as for the theme script). */
export function signedInCheckScriptHash(): Promise<string> {
  cached ??= crypto.subtle.digest("SHA-256", new TextEncoder().encode(SIGNED_IN_CHECK_SCRIPT)).then((buf) => {
    let bin = "";
    for (const b of new Uint8Array(buf)) bin += String.fromCharCode(b);
    return `'sha256-${btoa(bin)}'`;
  });
  return cached;
}
