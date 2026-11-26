// /app-google (components/auth/AppSocialSignIn.tsx) hands an app a one-time sign-in code. Two rules keep a link
// from doing that by itself: "back from the provider" is only what this tab noted before it left (never the
// address's own word), and the code is issued only when the person presses Continue.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { APP_SIGN_IN_MARK, appSignInReturned, clearAppSignInMark, markAppSignInStart } from "@/lib/auth/appSignIn";

const auth = vi.hoisted(() => ({
  social: vi.fn(async (_o: { provider: string; callbackURL: string; errorCallbackURL: string }) => ({ data: { url: "https://accounts.google.com/" }, error: null })),
  fetch: vi.fn(async (_path: string, _o: unknown) => ({ data: { code: "one-time-code" }, error: null })),
  session: { data: { user: { email: "ada@example.com" } } as { user: { email: string } } | null, isPending: false },
}));
vi.mock("@/lib/auth/client", () => ({
  authClient: { signIn: { social: auth.social }, $fetch: auth.fetch, useSession: () => auth.session },
  authErrorMessage: (e: { message?: string } | null | undefined) => e?.message ?? "Something went wrong.",
}));

const { AppSocialSignIn } = await import("@/components/auth/AppSocialSignIn");

const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const props = { provider: "google" as const, clientId: "folevi-shell", redirectUri: "folevi://auth/callback", codeChallenge: CHALLENGE, codeChallengeMethod: "S256", state: "st" };

let root: Root | null = null;
let host: HTMLElement | null = null;
async function render(returned: string, over: Partial<typeof props> = {}): Promise<HTMLElement> {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(createElement(AppSocialSignIn, { ...props, ...over, returned })));
  await act(async () => {});
  return host;
}
const button = (el: HTMLElement, name: RegExp) => [...el.querySelectorAll("button")].find((b) => name.test(b.textContent?.trim() ?? ""));

const assign = vi.fn();
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  sessionStorage.clear();
  auth.social.mockClear();
  auth.fetch.mockClear();
  assign.mockClear();
  auth.session = { data: { user: { email: "ada@example.com" } }, isPending: false };
  Object.defineProperty(window, "location", { configurable: true, value: { href: `https://app.folevi.com/app-google?client_id=folevi-shell&code_challenge=${CHALLENGE}`, assign } });
});
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe("the note this tab keeps of a sign-in it started", () => {
  test("a return is only the value this tab noted, for the same challenge", () => {
    const mark = markAppSignInStart(CHALLENGE)!;
    expect(mark).toMatch(/^[0-9a-f]{32}$/);
    expect(appSignInReturned(mark, CHALLENGE)).toBe(true);
    expect(appSignInReturned("1", CHALLENGE)).toBe(false);
    expect(appSignInReturned(mark, CHALLENGE.replace("E", "F"))).toBe(false);
    expect(appSignInReturned("", CHALLENGE)).toBe(false);
    clearAppSignInMark();
    expect(appSignInReturned(mark, CHALLENGE)).toBe(false);
  });

  test("nothing noted, or a note someone else could have written, is no return", () => {
    expect(appSignInReturned("1", CHALLENGE)).toBe(false);
    sessionStorage.setItem(APP_SIGN_IN_MARK, "not json");
    expect(appSignInReturned("1", CHALLENGE)).toBe(false);
    sessionStorage.setItem(APP_SIGN_IN_MARK, JSON.stringify({ mark: "1", codeChallenge: CHALLENGE }));
    expect(appSignInReturned("1", CHALLENGE)).toBe(false);
  });

  test("a tab that can't keep a note can't start", () => {
    const off = { getItem: () => null, setItem: () => { throw new Error("off"); }, removeItem: () => {} };
    expect(markAppSignInStart(CHALLENGE, off)).toBeNull();
    expect(markAppSignInStart(CHALLENGE, null)).toBeNull();
  });
});

describe("/app-google", () => {
  test("a link that says returned=1 issues nothing: it is a fresh start, on to the provider", async () => {
    await render("1");
    expect(auth.fetch).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
    expect(auth.social).toHaveBeenCalledTimes(1);
    const back = new URL(auth.social.mock.calls[0]![0].callbackURL, "https://app.folevi.com");
    const noted = JSON.parse(sessionStorage.getItem(APP_SIGN_IN_MARK)!) as { mark: string };
    expect(back.pathname).toBe("/app-google");
    expect(back.searchParams.get("returned")).toBe(noted.mark);
  });

  test("back from a trip this tab started: it asks, and only Continue issues the code", async () => {
    const mark = markAppSignInStart(CHALLENGE)!;
    const el = await render(mark);
    expect(auth.social).not.toHaveBeenCalled();
    expect(auth.fetch).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
    expect(el.textContent).toContain("Folevi app will be signed in as ada@example.com");
    const go = button(el, /^Continue as ada@example\.com$/)!;
    expect(go).toBeTruthy();
    await act(async () => go.click());
    expect(auth.fetch).toHaveBeenCalledTimes(1);
    expect(auth.fetch.mock.calls[0]![0]).toBe("/native/authorize");
    expect(assign).toHaveBeenCalledWith("folevi://auth/callback?code=one-time-code&state=st");
    expect(sessionStorage.getItem(APP_SIGN_IN_MARK)).toBeNull();
  });

  test("Cancel goes back to the app without a code", async () => {
    const el = await render(markAppSignInStart(CHALLENGE)!);
    await act(async () => button(el, /^Cancel$/)!.click());
    expect(auth.fetch).not.toHaveBeenCalled();
    expect(assign).toHaveBeenCalledWith("folevi://auth/callback?error=access_denied&state=st");
  });

  test("back but signed in as nobody: Continue can't be pressed", async () => {
    auth.session = { data: null, isPending: false };
    const el = await render(markAppSignInStart(CHALLENGE)!);
    expect(button(el, /^Continue/)!.disabled).toBe(true);
    expect(auth.fetch).not.toHaveBeenCalled();
  });

  test("a client it doesn't serve gets nothing at all", async () => {
    const el = await render("1", { clientId: "folevi-mac", redirectUri: "com.folevi.mac://auth/callback" });
    expect(el.textContent).toContain("This link doesn't work");
    expect(auth.social).not.toHaveBeenCalled();
    expect(auth.fetch).not.toHaveBeenCalled();
  });
});
