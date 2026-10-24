// Library setup as gate actions (components/app/LibrarySetup.tsx), in native chrome mode: one action per place
// (library.setup shows the system folder picker for "Choose a folder"), then an optional passphrase and Open.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { actOnGate, currentGate, resetGates } from "@/lib/engine/gates";

let holds = false;
vi.mock("@/lib/local/libraryPlace", async (orig) => ({ ...(await orig<typeof import("@/lib/local/libraryPlace")>()), holdsLibrary: async () => holds, rememberSetupIntent: () => undefined }));

const calls: string[] = [];
let root: Root;
let el: HTMLDivElement;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  calls.length = 0;
  holds = false;
  const w = window as unknown as Record<string, unknown>;
  w.__foleviNativeChrome = { platform: "mac", protocol: 1 };
  w.__foleviTestShell = {
    platform: "mac",
    library: {
      setup: async ({ kind }: { kind: string }) => {
        calls.push(`setup:${kind}`);
        return { kind, displayPath: "~/Notes" };
      },
      setPassphrase: async (p: string) => void calls.push(`passphrase:${p}`),
    },
  };
  el = document.createElement("div");
  root = createRoot(el);
});
afterEach(() => {
  act(() => root.unmount());
  const w = window as unknown as Record<string, unknown>;
  delete w.__foleviNativeChrome;
  delete w.__foleviTestShell;
  resetGates();
});

describe("library setup as gate actions", () => {
  it("a place, then a passphrase and Open", async () => {
    const { LibrarySetup } = await import("@/components/app/LibrarySetup");
    const onDone = vi.fn(async () => undefined);
    const onBack = vi.fn();
    act(() => root.render(<LibrarySetup onDone={onDone} onBack={onBack} />));
    expect(currentGate()).toMatchObject({ gate: "librarySetup", title: "Where should your library live?" });
    expect(currentGate().actions.map((a) => a.id)).toEqual(["place:icloud", "place:folder", "place:device", "back"]);

    await act(() => actOnGate("place:folder", {}));
    expect(calls).toEqual(["setup:folder"]);
    expect(currentGate()).toMatchObject({ title: "Your library is ready", message: "Folevi keeps your notes as files in ~/Notes." });
    expect(currentGate().fields.map((f) => f.id)).toEqual(["passphrase"]);
    expect(currentGate().actions.map((a) => a.id)).toEqual(["open", "elsewhere"]);

    await act(() => actOnGate("open", { passphrase: "short" }));
    expect(currentGate().error).toMatchObject({ message: "Use at least 8 characters." });
    expect(onDone).not.toHaveBeenCalled();
    await act(() => actOnGate("open", { passphrase: "correct horse" }));
    expect(calls).toEqual(["setup:folder", "passphrase:correct horse"]);
    expect(onDone).toHaveBeenCalledWith({ joining: false });
  });

  it("a place that already holds a library joins it", async () => {
    holds = true;
    const { LibrarySetup } = await import("@/components/app/LibrarySetup");
    const onDone = vi.fn(async () => undefined);
    act(() => root.render(<LibrarySetup onDone={onDone} />));
    expect(currentGate().actions.map((a) => a.id)).not.toContain("back");
    await act(() => actOnGate("place:icloud", {}));
    expect(onDone).toHaveBeenCalledWith({ joining: true });
  });
});
