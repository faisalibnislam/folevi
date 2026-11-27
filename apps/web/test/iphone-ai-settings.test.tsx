import { afterEach, describe, expect, test, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

// The iPhone app's Foli AI settings are the app's own rows only (e2e/iphone-settings.spec.ts, nativeOnly). Your own
// AI key has a native screen there (native-kit PhoneOwnKey.swift), so the web card with its buttons stays out of it.
const look = vi.hoisted(() => ({ iphone: true }));
vi.mock("convex/react", () => ({ useMutation: () => vi.fn(), useQuery: () => undefined }));
vi.mock("@/lib/convex/api", () => ({ api: new Proxy({}, { get: (_t, mod) => new Proxy({}, { get: (_u, fn) => `${String(mod)}.${String(fn)}` }) }) }));
vi.mock("@/lib/app/state", () => ({ useAppState: () => ({ profile: { aiPrefs: {} } }) }));
vi.mock("@/lib/iphone", () => ({ useIphoneLook: () => look.iphone }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ show: vi.fn() }), errorMessage: String }));
vi.mock("@/components/iphone/SettingsKit", () => ({ IosRow: () => null, IosSection: () => null, Subscreen: () => null, SwitchRow: () => null }));
vi.mock("@/components/views/settings/AccountSection", () => ({ AiSettingCard: () => null }));
vi.mock("@/components/views/settings/AiMemory", () => ({ AiMemoryCard: () => null }));
vi.mock("@/components/views/settings/AiDigest", () => ({ AiDigestCard: () => null }));
vi.mock("@/components/views/settings/AiRoutines", () => ({ AiRoutinesCard: () => null }));
vi.mock("@/components/views/settings/AiUsage", () => ({ AiUsageCard: () => null }));
vi.mock("@/components/views/settings/AiExport", () => ({ AiExportCard: () => null }));
vi.mock("@/components/views/settings/OwnKeyCard", () => ({ OwnKeyCard: () => <section data-own-key-card /> }));

async function render() {
  const { AiSection } = await import("@/components/views/settings/AiSection");
  const host = document.createElement("div");
  document.body.appendChild(host);
  act(() => createRoot(host).render(<AiSection />));
  return host;
}

describe("Foli AI settings: your own AI key", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("the iPhone look leaves the web card out", async () => {
    look.iphone = true;
    expect((await render()).querySelector("[data-own-key-card]")).toBeNull();
  });

  test("everywhere else the card is there", async () => {
    look.iphone = false;
    expect((await render()).querySelector("[data-own-key-card]")).not.toBeNull();
  });
});
