// Onboarding as gate actions (components/app/Onboarding.tsx), in native chrome mode: the step and its choices
// go to native, and Continue carries the choice (useCases, noteStyle, appearance, aiEnabled) to the server.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { actOnGate, currentGate, resetGates } from "@/lib/engine/gates";

const saved: Record<string, unknown>[] = [];
const looks: string[] = [];
vi.mock("convex/react", () => ({
  useMutation: () => async (args: Record<string, unknown>) => void saved.push(args),
  useQuery: () => ({ page: [] }),
}));
vi.mock("@/lib/app/state", () => ({
  useAppState: () => ({ profile: { entitlements: { trialEndsAt: null, trialing: false, plan: "free" }, displayName: "Faisal", email: "f@example.com", onboardingStep: "workspace", onboardingUseCases: [], appearance: "system", aiEnabled: true }, setContext: () => undefined, setAppearance: (a: string) => looks.push(a), appearance: "system" }),
}));
vi.mock("@/lib/app/router", () => ({ useAppRouter: () => ({ navigate: () => undefined }) }));
vi.mock("@/components/app/onboarding/OnboardingPreview", () => ({ OnboardingPreview: () => null, artOf: () => null, artThumb: () => "" }));

let root: Root;
let el: HTMLDivElement;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  saved.length = 0;
  looks.length = 0;
  (window as unknown as Record<string, unknown>).__foleviNativeChrome = { platform: "ios", protocol: 1 };
  window.scrollTo = () => undefined;
  el = document.createElement("div");
  root = createRoot(el);
});
afterEach(() => {
  act(() => root.unmount());
  delete (window as unknown as Record<string, unknown>).__foleviNativeChrome;
  resetGates();
});

describe("onboarding as gate actions", () => {
  it("Continue through the steps with native's choices; Back and Skip setup", async () => {
    const { Onboarding } = await import("@/components/app/Onboarding");
    act(() => root.render(<Onboarding />));
    expect(currentGate()).toMatchObject({ gate: "onboarding", onboarding: { step: "workspace", index: 0, total: 6 } });
    expect(currentGate().actions.map((a) => a.id)).toEqual(["continue", "skip", "skipAll"]);
    expect(currentGate().onboarding!.useCaseOptions.length).toBeGreaterThan(0);

    await act(async () => void (await actOnGate("continue", {})));
    expect(saved.at(-1)).toEqual({ step: "workspace" });
    expect(currentGate().onboarding).toMatchObject({ step: "uses", index: 1 });
    const two = currentGate().onboarding!.useCaseOptions.slice(0, 2).map((o) => o.id);
    await act(async () => void (await actOnGate("continue", { useCases: two.join(", ") })));
    expect(saved.at(-1)).toEqual({ step: "uses", useCases: two });
    expect(currentGate().onboarding).toMatchObject({ step: "style", useCases: two });

    await act(async () => void (await actOnGate("back", {})));
    expect(currentGate().onboarding!.step).toBe("uses");
    await act(async () => void (await actOnGate("skip", {})));
    await act(async () => void (await actOnGate("skip", {})));
    expect(currentGate().onboarding!.step).toBe("appearance");
    await act(async () => void (await actOnGate("continue", { appearance: "dark" })));
    expect(saved.at(-1)).toEqual({ step: "appearance", appearance: "dark" });
    expect(looks).toContain("dark");
    await act(async () => void (await actOnGate("continue", { aiEnabled: "false" })));
    expect(saved.at(-1)).toEqual({ step: "ai", aiEnabled: false });
    expect(currentGate().onboarding).toMatchObject({ step: "welcome", aiEnabled: false });
    expect(currentGate().actions.map((a) => a.id)).toEqual(["finish", "back"]);
  });
});
