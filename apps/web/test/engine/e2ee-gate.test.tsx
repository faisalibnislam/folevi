// The E2EE setup steps as gate actions (components/e2ee/NativeE2eeSetup.tsx), in native chrome mode: make the
// keys, add a recovery key (shown once, confirmed with groups 3 and 7) and a passphrase, then Done.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { actOnGate, currentGate, resetGates } from "@/lib/engine/gates";

const calls: string[] = [];
let methods: { publicId: string; kind: string; label: string; createdAt: number }[] = [];
let state = "none";
const listeners = new Set<() => void>();
vi.mock("@/lib/e2ee/keys", () => ({
  useKeySession: () => ({ state, methods }),
  setup: {
    createAccount: async () => {
      calls.push("createAccount");
      state = "unlocked";
    },
    addRecoveryKey: async () => ({ text: "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH-IIII", confirm: async (g: [string, string]) => g[0] === "CCCC" && g[1] === "GGGG" }),
    addPassphrase: async (p: string) => {
      calls.push(`passphrase:${p}`);
      methods = [...methods, { publicId: "m2", kind: "passphrase", label: "", createdAt: 1 }];
      for (const l of listeners) l();
    },
  },
}));
vi.mock("@/components/e2ee/SetupWizard", () => ({ methodKinds: (m: { kind: string }[]) => new Set(m.map((x) => x.kind)) }));

let root: Root;
let el: HTMLDivElement;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  (window as unknown as { __foleviNativeChrome?: unknown }).__foleviNativeChrome = { platform: "ios", protocol: 1 };
  el = document.createElement("div");
  root = createRoot(el);
});
afterEach(() => {
  act(() => root.unmount());
  delete (window as unknown as { __foleviNativeChrome?: unknown }).__foleviNativeChrome;
  resetGates();
});

describe("E2EE setup as gate actions", () => {
  it("steps from making the keys to Done", async () => {
    const { NativeE2eeSetup } = await import("@/components/e2ee/NativeE2eeSetup");
    const render = () => act(() => root.render(<NativeE2eeSetup space="ws_vault" spaceName="Vault" />));
    render();
    expect(currentGate()).toMatchObject({ gate: "e2eeSetup", e2ee: { setupStep: "start" } });
    await act(() => actOnGate("begin", {}));
    expect(calls).toEqual(["createAccount"]);
    expect(currentGate().e2ee?.setupStep).toBe("methods");
    expect(currentGate().actions.map((a) => [a.id, a.enabled])).toEqual([["recoveryKey", true], ["passphrase", true], ["finish", false]]);

    await act(() => actOnGate("recoveryKey", {}));
    expect(currentGate().e2ee).toMatchObject({ setupStep: "recovery", recoveryKey: "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH-IIII" });
    await act(() => expect(actOnGate("confirmRecovery", { group3: "XXXX", group7: "GGGG" })).rejects.toMatchObject({ code: "wrong_groups" }));
    expect(currentGate().error).toMatchObject({ code: "wrong_groups" });
    methods = [{ publicId: "m1", kind: "recoveryKey", label: "", createdAt: 1 }];
    await act(() => actOnGate("confirmRecovery", { group3: "CCCC", group7: "GGGG" }));
    expect(currentGate().e2ee).toMatchObject({ setupStep: "methods", recoveryKey: null, methodsAdded: ["recoveryKey"] });

    await act(() => actOnGate("passphrase", { passphrase: "correct horse battery" }));
    render();
    expect(currentGate().actions.find((a) => a.id === "finish")!.enabled).toBe(true);
    await act(() => actOnGate("finish", {}));
    expect(currentGate().e2ee?.setupStep).toBe("done");
  });
});
