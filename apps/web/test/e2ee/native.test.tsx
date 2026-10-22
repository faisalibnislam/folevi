// WP6: the native apps' device keys (docs/E2EE_DESIGN.md §6.2, §6.11). The Mac, the iPhone and iPad app and
// the Android app hold the device's keys behind the same bridge (`foleviShell.e2ee`); the device is named and
// registered after the app it runs in, and passkeys are never offered in any of them.
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { generateEd25519, generateX25519, openSealed } from "@folevi/local-store/e2ee";
import { setup, startKeySession } from "@/lib/e2ee/keys";
import { resetKeyRingForTests } from "@/lib/e2ee/keys/keyring";
import { memoryKeyStore } from "@/lib/e2ee/keys/keystore";
import { devicePlatform, inMacApp, inNativeApp, nativeE2ee, nativeLabel, nativePlatform, thisDevice } from "@/lib/e2ee/keys/macBridge";
import { passkeysPossible } from "@/lib/e2ee/keys/passkey";
import { resetKeySessionForTests, sessionImpl } from "@/lib/e2ee/keys/session";
import type { ShellE2ee } from "@/lib/shell/types";
import { FakeKeysServer } from "./keysFakeServer";

/** A native bridge as the apps implement it: keys made once, kept "in the app" (here, in this closure). */
async function fakeBridge(deviceId: string): Promise<ShellE2ee> {
  const [x, ed] = await Promise.all([generateX25519(), generateEd25519()]);
  return {
    deviceKeys: async () => ({ deviceId, x25519Pub: x.publicKey, ed25519Pub: ed.publicKey }),
    open: (box, context) => openSealed(x.privateKey, x.publicKey, context, box),
    sign: async () => "",
    reset: async () => undefined,
  };
}

type W = { foleviShell?: unknown; foleviDesktop?: unknown; foleviNative?: unknown; PublicKeyCredential?: unknown };
const w = () => window as unknown as W;
function as(globals: W) {
  delete w().foleviShell;
  delete w().foleviDesktop;
  delete w().foleviNative;
  Object.assign(window, globals);
}

beforeEach(() => {
  // A browser whose passkeys could work, so only the app decides.
  w().PublicKeyCredential = function PublicKeyCredential() {};
  Object.defineProperty(navigator, "credentials", { value: { create() {}, get() {} }, configurable: true });
});
afterEach(() => {
  as({});
  delete w().PublicKeyCredential;
  resetKeySessionForTests();
  resetKeyRingForTests();
});

describe("which app", () => {
  test("a browser: no native app, passkeys can be tried, the device is a web one", () => {
    as({});
    expect(nativePlatform()).toBeNull();
    expect(inNativeApp()).toBe(false);
    expect(nativeE2ee()).toBeNull();
    expect(passkeysPossible()).toBe(true);
    expect(devicePlatform()).toBe("web");
  });

  test("the Mac (website and built-in interface): unchanged", async () => {
    as({ foleviDesktop: { platform: "mac", e2ee: await fakeBridge("mac-1") } });
    expect([nativePlatform(), inMacApp(), passkeysPossible(), devicePlatform()]).toEqual(["mac", true, false, "mac"]);
    expect(nativeLabel()).toBe("Folevi for Mac");
    expect(thisDevice()).toBe("this Mac");
    expect(nativeE2ee()).not.toBeNull();
    as({ foleviShell: { platform: "mac", deviceName: "Studio" } });
    expect(nativeLabel()).toBe("Folevi for Mac on Studio");
  });

  test("the iPhone and iPad app: named after the family and the device's name, no passkeys", () => {
    as({ foleviShell: { platform: "ios", deviceFamily: "iPhone", deviceName: "Faisal's iPhone" }, foleviNative: { platform: "ios" } });
    expect([nativePlatform(), inMacApp(), inNativeApp(), passkeysPossible(), devicePlatform()]).toEqual(["ios", false, true, false, "ios"]);
    expect(nativeLabel()).toBe("Folevi for iPhone on Faisal's iPhone");
    expect(thisDevice()).toBe("this iPhone");
    as({ foleviShell: { platform: "ios", deviceFamily: "iPad", deviceName: "iPad" } });
    expect(nativeLabel()).toBe("Folevi for iPad");
    expect(thisDevice()).toBe("this iPad");
    // The website in the iOS app (no foleviShell): still the app, still no passkeys.
    as({ foleviNative: { platform: "ios" } });
    expect([nativePlatform(), passkeysPossible()]).toEqual(["ios", false]);
  });

  test("the Android app: named after the phone (its name, else its model), no passkeys", () => {
    as({ foleviShell: { platform: "android", deviceName: "Pixel 9" }, foleviNative: { platform: "android" } });
    expect([nativePlatform(), inMacApp(), passkeysPossible(), devicePlatform()]).toEqual(["android", false, false, "android"]);
    expect(nativeLabel()).toBe("Folevi for Android on Pixel 9");
    expect(thisDevice()).toBe("this phone");
    as({ foleviShell: { platform: "android", model: "Pixel 8a" } });
    expect(nativeLabel()).toBe("Folevi for Android on Pixel 8a");
  });
});

describe("registering the device", () => {
  for (const [name, globals, label, platform] of [
    ["iPhone", { foleviShell: { platform: "ios", deviceFamily: "iPhone", deviceName: "Work phone" } }, "Folevi for iPhone on Work phone", "ios"],
    ["iPad", { foleviShell: { platform: "ios", deviceFamily: "iPad" } }, "Folevi for iPad", "ios"],
    ["Android", { foleviShell: { platform: "android", deviceName: "Pixel 9" } }, "Folevi for Android on Pixel 9", "android"],
    ["Mac", { foleviDesktop: { platform: "mac" } }, "Folevi for Mac", "mac"],
  ] as const) {
    test(`${name}: an app device with the app's keys, label and platform; a passkey isn't offered`, async () => {
      const bridge = await fakeBridge(`${platform}-device`);
      as({ ...globals, ...(globals.foleviShell ? { foleviShell: { ...globals.foleviShell, e2ee: bridge } } : { foleviDesktop: { ...globals.foleviDesktop, e2ee: bridge } }) });
      const fake = new FakeKeysServer();
      resetKeySessionForTests();
      resetKeyRingForTests();
      await startKeySession({ server: fake.as("p1"), profileId: "p1", store: memoryKeyStore(), reload: () => undefined });
      await setup.createAccount();
      expect(sessionImpl().state()).toBe("unlocked");
      expect(fake.devices).toHaveLength(1);
      expect(fake.devices[0]).toMatchObject({ deviceId: `${platform}-device`, kind: "app", label, platform, status: "trusted" });
      expect(JSON.parse(fake.devices[0]!.statement!.body)).toMatchObject({ label, kind: "app" });
      expect(await setup.addPasskey("Passkey")).toBe("unsupported");
      expect(await sessionImpl().unlockWithPasskey()).toBe("unsupported");
      // Restarted: unlocks with the app's own key.
      resetKeySessionForTests();
      resetKeyRingForTests();
      await startKeySession({ server: fake.as("p1"), profileId: "p1", store: memoryKeyStore(), reload: () => undefined });
      expect(sessionImpl().state()).toBe("unlocked");
      await new Promise((r) => setTimeout(r, 0));
      expect(sessionImpl().methods.find((m) => m.kind === "device")?.label).toBe(name === "Android" ? "This phone" : `This ${name}`);
    });
  }
});

describe("the unlock screen", () => {
  const render = async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const { UnlockScreen } = await import("@/components/e2ee/UnlockScreen");
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => root.render(<UnlockScreen />));
    const buttons = [...host.querySelectorAll("button")].map((b) => b.textContent?.trim());
    const text = host.textContent ?? "";
    act(() => root.unmount());
    host.remove();
    return { buttons, text };
  };

  for (const [name, globals, device] of [
    ["Mac", { foleviDesktop: { platform: "mac" } }, "this Mac"],
    ["iPhone", { foleviShell: { platform: "ios", deviceFamily: "iPhone" } }, "this iPhone"],
    ["iPad", { foleviShell: { platform: "ios", deviceFamily: "iPad" } }, "this iPad"],
    ["Android", { foleviShell: { platform: "android" } }, "this phone"],
  ] as const) {
    test(`${name}: no passkey; it says to approve ${device} from a browser`, async () => {
      as(globals);
      const { buttons, text } = await render();
      expect(buttons).not.toContain("Use a passkey");
      expect(buttons).toEqual(expect.arrayContaining(["Approve from another device", "Enter passphrase", "Enter recovery key"]));
      expect(text).toContain(`To use your passkey, open Folevi in your browser and approve ${device} from there.`);
    });
  }

  test("a browser still offers the passkey", async () => {
    as({});
    const { buttons, text } = await render();
    expect(buttons).toContain("Use a passkey");
    expect(text).not.toContain("open Folevi in your browser");
  });
});
