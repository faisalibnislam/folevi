// Notifications in the iPhone and iPad app (lib/nativePush.ts, Settings > Notifications' NativePushCard):
// hidden until Folevi can send them, the switch asks iOS and registers the device token, turning it off
// removes it, "Open iOS Settings" when iOS has them off, the first reminder asks once, and signing out
// removes the device.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const convex = vi.hoisted(() => ({ results: {} as Record<string, unknown>, calls: [] as [string, unknown][] }));
vi.mock("convex/react", () => ({
  useQuery: (ref: string, args: unknown) => (args === "skip" ? undefined : convex.results[String(ref)]),
  useMutation: () => vi.fn(),
}));
vi.mock("@/lib/convex/api", () => {
  const path = (parts: string[]): unknown => new Proxy({}, { get: (_t, key) => (key === Symbol.toPrimitive || key === "toString" ? () => parts.join(".") : path([...parts, String(key)])) });
  return { api: path([]) };
});
vi.mock("@/lib/convex/provider", () => ({
  getConvexClient: () => ({
    mutation: async (ref: unknown, args: unknown) => void convex.calls.push([String(ref), args]),
    query: async (ref: unknown) => convex.results[String(ref)],
  }),
}));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ show: vi.fn() }), errorMessage: () => "Something went wrong." }));

const { PushCard } = await import("@/components/views/settings/PushCard");
const { offerPushAfterReminder, syncPushRegistration } = await import("@/lib/nativePush");
const { forgetThisDevice } = await import("@/lib/nativeDevice");

type Status = { permission: "notDetermined" | "denied" | "granted"; enabled: boolean; asked: boolean; token: string | null; environment: "sandbox" | "production"; bundleId: string };
const TOKEN = "ab".repeat(32);
let status: Status;
const bridge = {
  platform: "ios",
  version: "1.0",
  haptic: vi.fn(),
  setStatusBar: vi.fn(),
  openExternal: vi.fn(),
  getSettings: vi.fn(),
  setSettings: vi.fn(),
  onCommand: vi.fn(),
  device: vi.fn(async () => ({ id: "install-1234-abcd", family: "iPhone", model: "iPhone 18 Pro", accountId: "acc", tokenId: null, scanner: false })),
  clearCredential: vi.fn(async () => undefined),
  pushStatus: vi.fn(async () => ({ ...status })),
  enablePush: vi.fn(async () => {
    status = { ...status, asked: true, permission: "granted", enabled: true, token: TOKEN };
    return { ...status };
  }),
  disablePush: vi.fn(async () => void (status = { ...status, enabled: false, token: null })),
  setBadge: vi.fn(),
  openNotificationSettings: vi.fn(async () => undefined),
};

let root: Root | null = null;
let host: HTMLElement | null = null;
async function render(node: React.ReactElement): Promise<HTMLElement> {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(node));
  await act(async () => undefined);
  return host;
}
const flush = () => act(async () => await new Promise((r) => setTimeout(r, 0)));

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(window, "foleviNative", { value: bridge, configurable: true, writable: true });
  document.documentElement.dataset.native = "ios";
  status = { permission: "notDetermined", enabled: false, asked: false, token: null, environment: "sandbox", bundleId: "com.folevi.ios" };
  convex.results = { "push.apnsAvailable": true, "push.apnsStatus": { devices: 0, thisDevice: false } };
  convex.calls = [];
  vi.clearAllMocks();
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  delete (window as { foleviNative?: unknown }).foleviNative;
  delete document.documentElement.dataset.native;
});

describe("Settings > Notifications in the iOS app", () => {
  test("hidden until Folevi can send to the app (no APNs key on the server)", async () => {
    convex.results["push.apnsAvailable"] = false;
    const el = await render(<PushCard />);
    expect(el.textContent).toBe("");
  });

  test("the switch asks iOS, then registers this device's token; turning it off removes it", async () => {
    const el = await render(<PushCard />);
    expect(el.textContent).toContain("Notifications on this iPhone");
    expect(el.textContent).toContain("Turning them on asks iOS once.");
    // Never the browser's web push copy in the app.
    expect(el.textContent).not.toContain("This browser");
    const toggle = el.querySelector<HTMLButtonElement>('[role="switch"]')!;
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await act(async () => toggle.click());
    await flush();
    expect(bridge.enablePush).toHaveBeenCalledTimes(1);
    expect(convex.calls).toEqual([["push.registerApns", { token: TOKEN, environment: "sandbox", bundleId: "com.folevi.ios", deviceId: "install-1234-abcd", deviceName: "iPhone 18 Pro" }]]);
    expect(el.querySelector('[role="switch"]')!.getAttribute("aria-checked")).toBe("true");

    convex.calls = [];
    await act(async () => el.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
    await flush();
    expect(convex.calls).toEqual([["push.unregisterApns", { token: TOKEN, deviceId: "install-1234-abcd" }]]);
    expect(bridge.disablePush).toHaveBeenCalledTimes(1);
    expect(el.querySelector('[role="switch"]')!.getAttribute("aria-checked")).toBe("false");
  });

  test("turned off in iOS Settings: says so, and opens them", async () => {
    status = { ...status, permission: "denied", asked: true };
    const el = await render(<PushCard />);
    expect(el.textContent).toContain("turned off for Folevi in iOS Settings");
    const button = [...el.querySelectorAll("button")].find((b) => b.textContent === "Open iOS Settings")!;
    await act(async () => button.click());
    expect(bridge.openNotificationSettings).toHaveBeenCalled();
  });
});

describe("when the app asks, and keeping the server in step", () => {
  test("a first reminder asks once; never again after that, and never without APNs", async () => {
    convex.results["push.apnsAvailable"] = false;
    await offerPushAfterReminder();
    expect(bridge.enablePush).not.toHaveBeenCalled();
    convex.results["push.apnsAvailable"] = true;
    await offerPushAfterReminder();
    expect(bridge.enablePush).toHaveBeenCalledTimes(1);
    expect(convex.calls.map(([name]) => name)).toEqual(["push.registerApns"]);
    await offerPushAfterReminder();
    expect(bridge.enablePush).toHaveBeenCalledTimes(1);
  });

  test("on launch: a new token is registered; notifications turned off in iOS stop being sent", async () => {
    status = { ...status, enabled: true, asked: true, permission: "granted", token: "cd".repeat(32) };
    await syncPushRegistration();
    expect(convex.calls.at(-1)).toEqual(["push.registerApns", expect.objectContaining({ token: "cd".repeat(32) })]);
    status = { ...status, permission: "denied" };
    await syncPushRegistration();
    expect(convex.calls.at(-1)).toEqual(["push.unregisterApns", { deviceId: "install-1234-abcd" }]);
  });

  test("signing out removes this device from Folevi's list", async () => {
    await forgetThisDevice();
    expect(convex.calls).toContainEqual(["push.unregisterApns", { deviceId: "install-1234-abcd" }]);
    expect(bridge.clearCredential).toHaveBeenCalled();
  });
});
