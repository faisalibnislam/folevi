// Sign in with Apple's return (lib/auth/appleCallback.ts): Apple's cross-site form post to the callback is
// answered by the web app with a same-site GET of it, which carries the cookie that ties the sign-in to this
// browser; the backend never sees a cross-site POST. Apple's `user` field rides in a short-lived cookie, not
// the address, and is handed to the backend on the GET.
import { describe, expect, test } from "vitest";
import { APPLE_CALLBACK_PATH, APPLE_USER_COOKIE, appleFormPost, withAppleUser } from "@/lib/auth/appleCallback";

const APP = "https://app.folevi.com";
const user = JSON.stringify({ name: { firstName: "Ada", lastName: "Lovelace" }, email: "x7k2@privaterelay.appleid.com" });

/** What Safari or Chrome sends when Apple's page submits its form to Folevi. */
function applePost(fields: Record<string, string>, path = APPLE_CALLBACK_PATH) {
  return new Request(`${APP}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://appleid.apple.com", "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate" },
    body: new URLSearchParams(fields).toString(),
  });
}

describe("Apple's form post", () => {
  test("becomes a 303 to the same callback by GET, with the code and state, and nothing else in the address", async () => {
    const res = await appleFormPost(applePost({ code: "c0de", state: "st4te", id_token: "header.payload.sig", user }), true);
    expect(res?.status).toBe(303);
    const location = new URL(res!.headers.get("location")!, APP);
    expect(location.pathname).toBe(APPLE_CALLBACK_PATH);
    expect(Object.fromEntries(location.searchParams)).toEqual({ code: "c0de", state: "st4te" });
    // Relative, so the browser stays on the host Apple posted to.
    expect(res!.headers.get("location")!.startsWith("/")).toBe(true);
    expect(res!.headers.get("cache-control")).toBe("no-store");
  });

  test("keeps Apple's user field in a short-lived HttpOnly cookie for the callback only", async () => {
    const res = await appleFormPost(applePost({ code: "c", state: "s", user }), true);
    const [cookie] = res!.headers.getSetCookie();
    expect(cookie).toContain(`${APPLE_USER_COOKIE}=${encodeURIComponent(user)}`);
    expect(cookie).toContain(`Path=${APPLE_CALLBACK_PATH}`);
    expect(cookie).toContain("Max-Age=600");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");
    // Locally (http) the cookie can't be Secure.
    expect((await appleFormPost(applePost({ code: "c", state: "s", user }), false))!.headers.getSetCookie()[0]).not.toContain("Secure");
  });

  test("passes Apple's error on (someone cancelled), and drops a user field that isn't Apple's", async () => {
    const cancelled = await appleFormPost(applePost({ error: "user_cancelled_authorize", state: "s" }), true);
    expect(Object.fromEntries(new URL(cancelled!.headers.get("location")!, APP).searchParams)).toEqual({ error: "user_cancelled_authorize", state: "s" });
    for (const bad of ["not json", "[1,2]", JSON.stringify({ name: "x".repeat(3000) })]) {
      expect((await appleFormPost(applePost({ code: "c", state: "s", user: bad }), true))!.headers.getSetCookie()).toEqual([]);
    }
    const stray = await appleFormPost(applePost({}), true);
    expect(stray!.headers.get("location")).toBe(APPLE_CALLBACK_PATH);
  });

  test("only Apple's callback is answered here: every other POST goes to Better Auth with its usual checks", async () => {
    expect(await appleFormPost(applePost({ code: "c", state: "s" }, "/api/auth/callback/google"), true)).toBeNull();
    expect(await appleFormPost(applePost({ code: "c", state: "s" }, "/api/auth/sign-in/social"), true)).toBeNull();
    expect(await appleFormPost(new Request(`${APP}${APPLE_CALLBACK_PATH}?code=c&state=s`), true)).toBeNull();
  });
});

describe("the GET that finishes it", () => {
  test("gets Apple's user field back from its cookie, which is then cleared", () => {
    const req = new Request(`${APP}${APPLE_CALLBACK_PATH}?code=c&state=s`, { headers: { cookie: `folevi.state=abc; ${APPLE_USER_COOKIE}=${encodeURIComponent(user)}` } });
    const { request, clear } = withAppleUser(req, true);
    const url = new URL(request.url);
    expect(url.searchParams.get("user")).toBe(user);
    expect(url.searchParams.get("code")).toBe("c");
    expect(request.headers.get("cookie")).toContain("folevi.state=abc");
    expect(clear).toBe(`${APPLE_USER_COOKIE}=; Path=${APPLE_CALLBACK_PATH}; Max-Age=0; HttpOnly; SameSite=Lax; Secure`);
  });

  test("leaves every other request, and a GET without the cookie, as it is", () => {
    const plain = new Request(`${APP}${APPLE_CALLBACK_PATH}?code=c&state=s`);
    expect(withAppleUser(plain, true)).toEqual({ request: plain, clear: null });
    const google = new Request(`${APP}/api/auth/callback/google?code=c`, { headers: { cookie: `${APPLE_USER_COOKIE}=${encodeURIComponent(user)}` } });
    expect(withAppleUser(google, true)).toEqual({ request: google, clear: null });
  });

  test("a damaged cookie is cleared and not passed on", () => {
    const req = new Request(`${APP}${APPLE_CALLBACK_PATH}?code=c&state=s`, { headers: { cookie: `${APPLE_USER_COOKIE}=%E0%A4%A` } });
    const { request, clear } = withAppleUser(req, false);
    expect(new URL(request.url).searchParams.has("user")).toBe(false);
    expect(clear).toContain("Max-Age=0");
  });
});
