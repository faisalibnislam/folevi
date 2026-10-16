// The iPhone and iPad app on the web side (lib/nativeApp.ts, lib/deepLink.ts): finding the bridge, folevi://
// links read the same way as the Mac app reads them, and App Store rule 3.1.1: inside the iOS app nothing
// offers plans, prices or purchases (Settings > Plan & billing, the AI panels' "Buy more" and "Upgrade",
// and server messages that say where to buy).
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseDeepLink as desktopParse } from "../../desktop/src/urls";

const convex = vi.hoisted(() => ({ results: {} as Record<string, unknown> }));
vi.mock("convex/react", () => ({
  useQuery: (ref: string) => convex.results[ref],
  useMutation: () => vi.fn(),
  useAction: () => vi.fn(),
}));
// Function references as their names ("billing.mine"), so the mocked useQuery can answer by name.
vi.mock("@/lib/convex/api", () => {
  const path = (parts: string[]): unknown => new Proxy({}, { get: (_t, key) => (key === Symbol.toPrimitive || key === "toString" ? () => parts.join(".") : path([...parts, String(key)])) });
  return { api: path([]) };
});
vi.mock("@/lib/app/state", () => ({ useAppState: () => ({ scope: { kind: "personal" }, workspaces: [] }) }));
vi.mock("@/lib/app/router", () => ({
  useAppRouter: () => ({ navigate: vi.fn() }),
  AppLink: (p: { href: string; className?: string; children: unknown }) => createElement("a", { href: p.href, className: p.className }, p.children as never),
}));
vi.mock("@/components/ui/Toast", async () => {
  const { withoutPurchaseHints } = await import("@/lib/nativeApp");
  return { useToast: () => ({ show: vi.fn() }), errorMessage: (e: { data?: { message?: string } }) => withoutPurchaseHints(e?.data?.message ?? "Something went wrong.") };
});

const { MANAGED_ELSEWHERE, canPurchaseHere, inIosApp, nativeApp, withoutPurchaseHints } = await import("@/lib/nativeApp");
const { parseDeepLink } = await import("@/lib/deepLink");
const { BillingSection } = await import("@/components/views/settings/BillingSection");
const { AiProblemNotice, aiProblem } = await import("@/components/ai/AiCredits");
const { AiUnavailable } = await import("@/components/ai/AiUnavailable");

const DAY = 86_400_000;
const bridge = { platform: "ios", version: "1.0", haptic: vi.fn(), setStatusBar: vi.fn(), openExternal: vi.fn(), getSettings: vi.fn(), setSettings: vi.fn(), onCommand: vi.fn() };

/** What the iOS app does before the page's first script: the bridge and the mark on <html>. */
function inTheApp() {
  Object.defineProperty(window, "foleviNative", { value: bridge, configurable: true, writable: true });
  document.documentElement.dataset.native = "ios";
}

let root: Root | null = null;
let host: HTMLElement | null = null;
function render(node: React.ReactElement): HTMLElement {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  delete (window as { foleviNative?: unknown }).foleviNative;
  delete document.documentElement.dataset.native;
  convex.results = {};
});

describe("the bridge", () => {
  test("absent in a browser (and in the Mac app): nothing native, and purchases are offered", () => {
    expect(nativeApp()).toBeNull();
    expect(inIosApp()).toBe(false);
    expect(canPurchaseHere()).toBe(true);
    (window as { foleviDesktop?: unknown }).foleviDesktop = { platform: "mac" };
    expect(nativeApp()).toBeNull();
    expect(canPurchaseHere()).toBe(true);
    delete (window as { foleviDesktop?: unknown }).foleviDesktop;
  });

  test("in the iOS app: the bridge, and no purchases", () => {
    inTheApp();
    expect(nativeApp()?.platform).toBe("ios");
    expect(inIosApp()).toBe(true);
    expect(canPurchaseHere()).toBe(false);
  });

  test("the mark alone (before the bridge is read) is enough to hide purchases", () => {
    document.documentElement.dataset.native = "ios";
    expect(nativeApp()).toBeNull();
    expect(canPurchaseHere()).toBe(false);
  });

  test("a bridge for another platform isn't taken for the iOS app's", () => {
    Object.defineProperty(window, "foleviNative", { value: { ...bridge, platform: "android" }, configurable: true, writable: true });
    expect(nativeApp()).toBeNull();
  });
});

describe("server messages in the iOS app", () => {
  const OUT = "You've used this month's AI credits. They reset on November 1. Buy more in Settings → Plan & billing.";
  test("the sentence that says where to buy goes; what happened stays", () => {
    expect(withoutPurchaseHints(OUT, true)).toBe("You've used this month's AI credits. They reset on November 1.");
    expect(withoutPurchaseHints("Foli AI comes with Pro and Pro AI. Upgrade in Settings → Plan & billing.", true)).toBe("Foli AI comes with Pro and Pro AI.");
    expect(withoutPurchaseHints("Routines are part of Pro and Pro AI. Upgrade in Settings > Plan & billing.", true)).toBe("Routines are part of Pro and Pro AI.");
    expect(withoutPurchaseHints("Credit packs are for Pro and Pro AI. Choose a plan first.", true)).toBe("Credit packs are for Pro and Pro AI.");
    expect(withoutPurchaseHints("Your plan's device limit is reached. Sign out on another device or upgrade to use Folevi here.", true)).toBe("Your plan's device limit is reached.");
    expect(withoutPurchaseHints("Your plan, Core, has no AI: nothing is sent to an AI model. You can change plans in Settings.", true)).toBe("Your plan, Core, has no AI: nothing is sent to an AI model.");
  });

  test("messages with nothing about buying are untouched, and so is everything outside the app", () => {
    expect(withoutPurchaseHints("Couldn't save. Try again.", true)).toBe("Couldn't save. Try again.");
    expect(withoutPurchaseHints(OUT, false)).toBe(OUT);
    expect(withoutPurchaseHints(OUT)).toBe(OUT);
  });

  test("a message that's only about buying still says something", () => {
    expect(withoutPurchaseHints("Upgrade to use it.", true)).toBe("This isn't part of your plan.");
  });
});

describe("folevi:// links", () => {
  const LINKS = [
    "folevi://d/01J9ZQ4K8W2M3N4P5Q6R7S8T9V",
    "folevi://d/01j9zq4k8w2m3n4p5q6r7s8t9v#blockA1",
    "folevi:///d/01J9ZQ4K8W2M3N4P5Q6R7S8T9V",
    "folevi://d/inbox-2d0a97ae3b345608",
    "folevi://inbox",
    "folevi://d/INBOX-2D0A97AE3B345608",
    "folevi://tasks/today",
    "folevi://settings/this-device",
    "folevi://foli-ai",
    "folevi://new",
    "folevi://quick-add",
    "folevi://",
    "folevi://d/not-an-id",
    "folevi://admin",
    "folevi://d/01J9ZQ4K8W2M3N4P5Q6R7S8T9V/extra",
    "folevi://tasks/a/b/c",
    "folevi://new/x",
    "folevi://..%2F..%2Fetc",
    "https://app.folevi.com/d/01J9ZQ4K8W2M3N4P5Q6R7S8T9V",
    "javascript:alert(1)",
    `folevi://tasks/${"a".repeat(700)}`,
  ];

  test("the iOS app (in the page) reads them exactly as the Mac app does", () => {
    for (const link of LINKS) expect(parseDeepLink(link), link).toEqual(desktopParse(link));
  });

  test("what they open", () => {
    expect(parseDeepLink("folevi://d/01j9zq4k8w2m3n4p5q6r7s8t9v#blockA1")).toEqual({ type: "open", path: "/d/01J9ZQ4K8W2M3N4P5Q6R7S8T9V#blockA1" });
    expect(parseDeepLink("folevi://settings/this-device")).toEqual({ type: "open", path: "/settings/this-device" });
    expect(parseDeepLink("folevi://new")).toEqual({ type: "new-note" });
    expect(parseDeepLink("folevi://d/inbox-2d0a97ae3b345608")).toEqual({ type: "open", path: "/d/inbox-2d0a97ae3b345608" });
    expect(parseDeepLink("folevi://d/inbox-../x")).toBeNull();
    expect(parseDeepLink("folevi://inbox")).toEqual({ type: "open", path: "/inbox" });
    expect(parseDeepLink("folevi://admin")).toBeNull();
  });

  test("a broken escape is refused, not thrown", () => {
    expect(parseDeepLink("folevi://tasks/%E0%A4")).toBeNull();
  });
});

/** Settings > Plan & billing for someone on the Pro AI trial (checkout connected, so everything is offered in a browser). */
function trialBilling() {
  const now = Date.now();
  convex.results["billing.mine"] = {
    entitlements: { paidPlan: "pro_ai", paidPlanId: null, paid: false, trialing: true, trialEndsAt: now + 7 * DAY, devices: null },
    subscription: null,
    credits: { aiIncluded: true, available: 100, allowance: 100, monthlyLeft: 100, packCredits: 0, resetsAt: now + 7 * DAY, nextPackExpiry: null, trialing: true },
    storageUsedBytes: 0,
    storageLimitBytes: 50 * 1024 ** 3,
    storageRule: "own",
    poolWorkspaces: 0,
    checkoutAvailable: true,
    testPurchases: false,
    devicesActive: 2,
    payments: [{ id: "p1", createdAt: now - DAY, plan: "pro", interval: "month", amountCents: 999, currency: "usd", status: "paid", credits: null }],
  };
  convex.results["billing.creditAccounts"] = {
    accounts: [{ kind: "personal", workspaceId: null, name: "Personal", plan: "Pro AI trial", aiIncluded: true, available: 100, allowance: 100, monthlyLeft: 100, packCredits: 0, resetsAt: now + 7 * DAY, nextPackExpiry: null, trialing: true, canBuy: true }],
  };
}

/** Everything a purchase looks like: prices, buy and upgrade buttons, checkout and the billing portal. */
const PURCHASE = /\$\d|choose (a|pro|core)|upgrade|buy|checkout|manage billing|switch to|per month|\/mo\b|billed|polar/i;
const actions = (el: HTMLElement) => [...el.querySelectorAll("a, button")].map((n) => n.textContent ?? "");

describe("Settings > Plan & billing", () => {
  test("in a browser: plans, prices, credit packs and checkout", () => {
    trialBilling();
    const el = render(createElement(BillingSection));
    expect(el.textContent).toContain("Choose a personal plan");
    expect(el.textContent).toMatch(/\$\d/);
    expect(actions(el).some((t) => /Choose|Upgrade/.test(t))).toBe(true);
    expect(actions(el)).toContain("Buy credits");
  });

  test("in the iOS app: the plan as it is, managed on folevi.com, and nothing to buy", () => {
    trialBilling();
    inTheApp();
    const el = render(createElement(BillingSection));
    expect(el.textContent).toContain("Pro AI trial");
    expect(el.textContent).toContain(MANAGED_ELSEWHERE);
    expect(el.textContent).not.toMatch(PURCHASE);
    expect(el.textContent).not.toContain("Choose a personal plan");
    expect(el.textContent).not.toContain("Billing history");
    for (const a of el.querySelectorAll("a")) expect(a.getAttribute("href")).not.toMatch(/pricing|checkout|polar/);
    expect(actions(el).filter((t) => PURCHASE.test(t))).toEqual([]);
  });
});

describe("Foli AI out of credits", () => {
  const refused = { data: { code: "out_of_credits", action: "buy", message: "You've used this month's AI credits. They reset on November 1. Buy more in Settings → Plan & billing." } };

  test("in a browser: the server's message and Buy more", () => {
    const el = render(createElement(AiProblemNotice, { problem: aiProblem(refused) }));
    expect(el.textContent).toContain("Buy more in Settings");
    expect(actions(el)).toContain("Buy more");
  });

  test("in the iOS app: what happened and when credits reset, no way to buy", () => {
    inTheApp();
    const el = render(createElement(AiProblemNotice, { problem: aiProblem(refused) }));
    expect(el.textContent).toBe("You've used this month's AI credits. They reset on November 1.");
    expect(el.querySelector("a")).toBeNull();
  });

  test("Foli AI not on the plan: Upgrade in a browser, only the explanation in the app", () => {
    const ai = { setting: true, context: "personal" } as const;
    expect(actions(render(createElement(AiUnavailable, { ai })))).toContain("Upgrade");
    act(() => root?.unmount());
    inTheApp();
    const el = render(createElement(AiUnavailable, { ai }));
    expect(el.textContent).toContain("Foli AI isn't part of your plan");
    expect(el.querySelector("a")).toBeNull();
  });
});
