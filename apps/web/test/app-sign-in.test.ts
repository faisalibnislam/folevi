// "Continue with Google" and "Continue with Apple" in the Mac and iOS apps go straight to the provider: the
// app's own buttons choose, the sign-in sheet opens on /app-google (lib/auth/appSignIn.ts), which serves only
// the apps' own clients at their registered return addresses, and the choice survives every way into signing in
// (the signed-out screen, "Sign in to another account", the library's "Sign in to Folevi").
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { APP_SIGN_IN_CLIENTS, appSignInRequestValid, appSignInUrl } from "@/lib/auth/appSignIn";
import { SIGN_IN_WAYS, signInOptionsFor } from "@/lib/auth/shellSignInWay";

const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

describe("/app-google's requests", () => {
  const ok = { clientId: "folevi-shell", redirectUri: "folevi://auth/callback", codeChallenge: CHALLENGE, codeChallengeMethod: "S256" };

  test("serves the apps' web views and the built-in interface, each at its own return address", () => {
    expect(APP_SIGN_IN_CLIENTS).toEqual(["folevi-app", "folevi-shell"]);
    expect(appSignInRequestValid(ok)).toBe(true);
    expect(appSignInRequestValid({ ...ok, clientId: "folevi-app", redirectUri: "folevi://auth/google" })).toBe(true);
    // Another client's return address, or one nobody registered.
    expect(appSignInRequestValid({ ...ok, redirectUri: "folevi://auth/google" })).toBe(false);
    expect(appSignInRequestValid({ ...ok, clientId: "folevi-app", redirectUri: "folevi://auth/callback" })).toBe(false);
    expect(appSignInRequestValid({ ...ok, redirectUri: "https://evil.example/cb" })).toBe(false);
  });

  test("not for other clients, even registered ones (they approve on /connect)", () => {
    expect(appSignInRequestValid({ ...ok, clientId: "folevi-mac", redirectUri: "com.folevi.mac://auth/callback" })).toBe(false);
    expect(appSignInRequestValid({ ...ok, clientId: "folevi-android", redirectUri: "https://app.folevi.com/native/callback" })).toBe(false);
    expect(appSignInRequestValid({ ...ok, clientId: "constructor" })).toBe(false);
    expect(appSignInRequestValid({ ...ok, clientId: "" })).toBe(false);
  });

  test("only with an S256 challenge", () => {
    expect(appSignInRequestValid({ ...ok, codeChallengeMethod: "plain" })).toBe(false);
    expect(appSignInRequestValid({ ...ok, codeChallenge: "" })).toBe(false);
    expect(appSignInRequestValid({ ...ok, codeChallenge: `${CHALLENGE}=` })).toBe(false);
    expect(appSignInRequestValid({ ...ok, codeChallenge: CHALLENGE.slice(1) })).toBe(false);
  });

  test("its address names the provider (Google, the page's default, without one)", () => {
    const base = { clientId: "folevi-shell", redirectUri: "folevi://auth/callback", codeChallenge: CHALLENGE, state: "st" };
    const apple = new URL(appSignInUrl("https://app.folevi.com", { ...base, provider: "apple" }));
    expect(apple.origin + apple.pathname).toBe("https://app.folevi.com/app-google");
    expect(Object.fromEntries(apple.searchParams)).toEqual({ client_id: "folevi-shell", redirect_uri: "folevi://auth/callback", code_challenge: CHALLENGE, code_challenge_method: "S256", state: "st", provider: "apple" });
    const google = new URL(appSignInUrl("https://app.folevi.com", { ...base, provider: "google" }));
    expect(google.pathname).toBe("/app-google");
    expect(google.searchParams.has("provider")).toBe(false);
  });
});

describe("the app's own choice", () => {
  test("Apple, Google, then email; email is the website's sign-in page", () => {
    expect(SIGN_IN_WAYS.map((w) => w.title)).toEqual(["Continue with Apple", "Continue with Google", "Sign in with email"]);
    expect(signInOptionsFor("google")).toEqual({ provider: "google" });
    expect(signInOptionsFor("apple")).toEqual({ provider: "apple" });
    expect(signInOptionsFor("email")).toEqual({});
  });

  test("chooseSignInWay asks once and answers with the host's options, or null when dismissed", async () => {
    const chooseAction = vi.fn(async (_o: unknown): Promise<string | null> => "google");
    vi.resetModules();
    vi.doMock("@/lib/native/ui", () => ({ chooseAction }));
    try {
      const { chooseSignInWay } = await import("@/lib/auth/shellSignInWay");
      expect(await chooseSignInWay()).toEqual({ provider: "google" });
      const asked = chooseAction.mock.calls[0]![0] as { title: string; actions: { id: string; title: string }[] };
      expect(asked.title).toBe("Sign in to Folevi");
      expect(asked.actions.map((a) => a.id)).toEqual(["apple", "google", "email"]);
      chooseAction.mockResolvedValueOnce("email");
      expect(await chooseSignInWay()).toEqual({});
      chooseAction.mockResolvedValueOnce(null);
      expect(await chooseSignInWay()).toBeNull();
      chooseAction.mockResolvedValueOnce("facebook");
      expect(await chooseSignInWay()).toBeNull();
    } finally {
      vi.doUnmock("@/lib/native/ui");
      vi.resetModules();
    }
  });
});

describe("Sign in to another account, in the apps", () => {
  const w = () => window as unknown as { __foleviTestShell?: unknown };
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_FOLEVI_SHELL", "1");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.folevi.com");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    delete w().__foleviTestShell;
    vi.doUnmock("@/lib/auth/shellSignInWay");
    vi.doUnmock("@/lib/local/signIn");
    vi.resetModules();
  });

  function fakePlaces(current: string) {
    const places = { current, signIn: vi.fn(async (_o?: unknown) => null as string | null), switchTo: vi.fn(async () => undefined) };
    w().__foleviTestShell = { platform: "mac", shellVersion: "1.15.0", places, auth: { signIn: vi.fn() } };
    return places;
  }

  test("asks how, then opens the sheet on that provider; dismissed, nothing opens", async () => {
    const chooseSignInWay = vi.fn(async (): Promise<{ provider?: "google" | "apple" } | null> => ({ provider: "google" }));
    vi.doMock("@/lib/auth/shellSignInWay", () => ({ chooseSignInWay }));
    const places = fakePlaces("acct:u1");
    const { signInToAnotherAccount } = await import("@/lib/places");
    await signInToAnotherAccount();
    expect(places.signIn).toHaveBeenCalledWith({ provider: "google" });
    chooseSignInWay.mockResolvedValueOnce(null);
    await signInToAnotherAccount();
    expect(places.signIn).toHaveBeenCalledTimes(1);
    chooseSignInWay.mockResolvedValueOnce({});
    await signInToAnotherAccount();
    expect(places.signIn.mock.calls.at(-1)).toEqual([]);
  });

  test("from the library, the move's flow gets the provider", async () => {
    vi.doMock("@/lib/auth/shellSignInWay", () => ({ chooseSignInWay: vi.fn(async () => ({ provider: "apple" })) }));
    const flow = vi.fn(async (_o?: unknown) => undefined);
    vi.doMock("@/lib/local/signIn", () => ({ signInToFolevi: () => flow }));
    const places = fakePlaces("library");
    const { signInToAnotherAccount } = await import("@/lib/places");
    await signInToAnotherAccount();
    expect(flow).toHaveBeenCalledWith({ provider: "apple" });
    expect(places.signIn).not.toHaveBeenCalled();
  });
});
