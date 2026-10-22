// "Continue with Apple" and "Continue with Google" (components/auth/SocialSignIn.tsx) on the sign-in and
// sign-up pages: each only when the server offers it, Apple's in Apple's own black and white, both going
// through the browser in the Mac app; and Settings > Security > Sign-in methods (SignInMethods.tsx).
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const auth = vi.hoisted(() => ({
  social: vi.fn(async () => ({ data: { url: "https://appleid.apple.com/auth/authorize" }, error: null })),
  linkSocial: vi.fn(async () => ({ data: null, error: null })),
  unlinkAccount: vi.fn(async () => ({ data: { status: true }, error: null as { code?: string } | null })),
  listAccounts: vi.fn(async () => ({ data: [] as unknown[], error: null })),
}));
vi.mock("@/lib/auth/client", () => ({
  authClient: {
    signIn: { social: auth.social, email: vi.fn(), passkey: vi.fn(async () => ({ data: null, error: null })) },
    linkSocial: auth.linkSocial,
    unlinkAccount: auth.unlinkAccount,
    listAccounts: auth.listAccounts,
    $fetch: vi.fn(),
  },
  authErrorMessage: (e: { message?: string } | null) => e?.message ?? "Something went wrong.",
}));
vi.mock("@/lib/auth/passkeys", () => ({ passkeysAvailable: async () => false, passkeyAutofillAvailable: async () => false }));
const convex = vi.hoisted(() => ({ results: {} as Record<string, unknown> }));
vi.mock("convex/react", () => ({ useQuery: (ref: string) => convex.results[ref], useMutation: () => vi.fn(), useAction: () => vi.fn() }));
vi.mock("@/lib/convex/api", () => {
  const path = (parts: string[]): unknown => new Proxy({}, { get: (_t, key) => (key === Symbol.toPrimitive || key === "toString" ? () => parts.join(".") : path([...parts, String(key)])) });
  return { api: path([]) };
});
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ show: vi.fn() }) }));
// jsdom has no modal dialogs.
Object.assign(HTMLDialogElement.prototype, {
  showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  },
  close(this: HTMLDialogElement) {
    this.removeAttribute("open");
  },
});

const { SocialSignIn } = await import("@/components/auth/SocialSignIn");
const { SignInForm, socialLede } = await import("@/components/auth/SignInForm");
const { SignUpForm } = await import("@/components/auth/SignUpForm");
const { SignInMethodsCard } = await import("@/components/views/settings/SignInMethods");

let root: Root | null = null;
let host: HTMLElement | null = null;
async function render(node: React.ReactElement): Promise<HTMLElement> {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(node));
  return host;
}
const buttons = (el: HTMLElement) => [...el.querySelectorAll("button")].map((b) => b.textContent?.trim());
const button = (el: HTMLElement, name: string) => [...el.querySelectorAll("button")].find((b) => b.textContent?.trim() === name || b.getAttribute("aria-label") === name)!;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  auth.listAccounts.mockReset();
  auth.listAccounts.mockResolvedValue({ data: [], error: null });
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  convex.results = {};
  delete (window as { foleviDesktop?: unknown }).foleviDesktop;
});

describe("the sign-in buttons", () => {
  test("show only what the server offers", async () => {
    expect(buttons(await render(createElement(SocialSignIn, { providers: { google: true, apple: true }, returnTo: "/documents" })))).toEqual(["Continue with Apple", "Continue with Google"]);
    act(() => root?.unmount());
    expect(buttons(await render(createElement(SocialSignIn, { providers: { google: false, apple: true }, returnTo: "/documents" })))).toEqual(["Continue with Apple"]);
    act(() => root?.unmount());
    const none = await render(createElement(SocialSignIn, { providers: { google: false, apple: false }, returnTo: "/documents" }));
    expect(buttons(none)).toEqual([]);
    // No "or" divider either.
    expect(none.textContent).toBe("");
  });

  test("Apple's is black on a light page and white on a dark one, with Apple's logo, 44 points tall", async () => {
    const el = await render(createElement(SocialSignIn, { providers: { google: false, apple: true }, returnTo: "/documents" }));
    const apple = button(el, "Continue with Apple");
    for (const cls of ["bg-black", "text-white", "dark:bg-white", "dark:text-black", "h-11", "w-full", "ui-btn"]) expect(apple.className.split(/\s+/)).toContain(cls);
    expect(apple.querySelector("svg")?.getAttribute("aria-hidden")).not.toBeNull();
  });

  test("in a browser, goes to Apple, and comes back to /signin with an error the page explains", async () => {
    const el = await render(createElement(SocialSignIn, { providers: { google: true, apple: true }, returnTo: "/documents", newUserTo: "/onboarding" }));
    await act(async () => button(el, "Continue with Apple").click());
    expect(auth.social).toHaveBeenCalledWith({ provider: "apple", callbackURL: "/documents", newUserCallbackURL: "/onboarding", errorCallbackURL: "/signin?via=apple" });
  });

  test("in the Mac app, signs in through the browser's /app-google page with provider=apple", async () => {
    const signInInBrowser = vi.fn(async () => null);
    (window as { foleviDesktop?: unknown }).foleviDesktop = { platform: "mac", signInInBrowser };
    const el = await render(createElement(SocialSignIn, { providers: { google: true, apple: true }, returnTo: "/documents" }));
    await act(async () => button(el, "Continue with Apple").click());
    const opened = new URL((signInInBrowser.mock.calls[0] as unknown as [string])[0]);
    expect(opened.pathname).toBe("/app-google");
    expect(opened.searchParams.get("provider")).toBe("apple");
    expect(opened.searchParams.get("redirect_uri")).toBe("folevi://auth/google");
    expect(opened.searchParams.get("code_challenge_method")).toBe("S256");
    expect(auth.social).not.toHaveBeenCalled();
  });

  test("the pages name what's offered", async () => {
    expect(socialLede({ google: true, apple: true })).toBe("Apple or Google, or with ");
    expect(socialLede({ google: false, apple: false })).toBe("");
    const signIn = await render(createElement(SignInForm, { social: { google: false, apple: true }, socialProblem: "Apple sign-in was cancelled." }));
    expect(signIn.textContent).toContain("Sign in with Apple, or with your email and password.");
    expect(signIn.textContent).toContain("Apple sign-in was cancelled.");
    expect(buttons(signIn)).toContain("Continue with Apple");
    act(() => root?.unmount());
    const signUp = await render(createElement(SignUpForm, { social: { google: true, apple: true } }));
    expect(signUp.textContent).toContain("Create your Folevi account with Apple or Google");
    expect(buttons(signUp).slice(0, 2)).toEqual(["Continue with Apple", "Continue with Google"]);
  });
});

describe("Settings > Security > Sign-in methods", () => {
  test("lists Apple as linked with Remove, and offers to link Google", async () => {
    convex.results["signInOptions.options"] = { google: true, apple: true };
    auth.listAccounts.mockResolvedValueOnce({ data: [{ id: "a1", providerId: "credential", accountId: "u" }, { id: "a2", providerId: "apple", accountId: "001.apple", createdAt: "2026-10-01T10:00:00Z" }], error: null });
    const el = await render(createElement(SignInMethodsCard));
    await act(async () => {});
    expect(el.textContent).toContain("Sign-in methods");
    expect(button(el, "Remove Apple")).toBeTruthy();
    await act(async () => button(el, "Link Google").click());
    expect(auth.linkSocial).toHaveBeenCalledWith({ provider: "google", callbackURL: "/settings/security", errorCallbackURL: "/settings/security?via=google" });
  });

  test("removing asks first, and a session that's too old asks to sign in again", async () => {
    convex.results["signInOptions.options"] = { google: false, apple: true };
    auth.listAccounts.mockResolvedValue({ data: [{ id: "a1", providerId: "credential", accountId: "u" }, { id: "a2", providerId: "apple", accountId: "001.apple" }], error: null });
    auth.unlinkAccount.mockResolvedValueOnce({ data: null as never, error: { code: "SESSION_NOT_FRESH" } });
    const el = await render(createElement(SignInMethodsCard));
    await act(async () => {});
    await act(async () => button(el, "Remove Apple").click());
    expect(auth.unlinkAccount).not.toHaveBeenCalled();
    const dialog = document.querySelector<HTMLElement>("dialog[open]")!;
    expect(dialog.textContent).toContain("Remove Apple?");
    await act(async () => button(dialog, "Remove").click());
    expect(auth.unlinkAccount).toHaveBeenCalledWith({ providerId: "apple" });
    expect(document.body.textContent).toContain("Sign in again to remove it");
  });

  test("is hidden when the server offers neither and nothing is linked; in the Mac app linking happens in the browser", async () => {
    convex.results["signInOptions.options"] = { google: false, apple: false };
    const none = await render(createElement(SignInMethodsCard));
    await act(async () => {});
    expect(none.textContent).toBe("");
    act(() => root?.unmount());
    convex.results["signInOptions.options"] = { google: false, apple: true };
    (window as { foleviDesktop?: unknown }).foleviDesktop = { platform: "mac" };
    const mac = await render(createElement(SignInMethodsCard));
    await act(async () => {});
    expect(buttons(mac)).not.toContain("Link");
    expect(mac.textContent).toContain("open Settings > Security in your browser");
  });
});
