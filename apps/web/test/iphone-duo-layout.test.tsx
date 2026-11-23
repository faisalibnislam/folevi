// iPhone Duo: open, the iPhone app shows the iPad's wide layout; closed, the phone's. The app says which on its marker
// (`wide`, RebuildPageLayout in the iOS app) and fires folevi-native-layout when it changes, and the note page
// follows: the iPad's look and floating dock inside, the phone's (native bars) outside (lib/iphone.ts).
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test } from "vitest";
import { isIpadNativeWide, isIphoneApp, useIpadNativeWide, useIphoneApp } from "@/lib/iphone";

type Marker = { platform: string; protocol: number; place: string | null; wide?: boolean };
const marker = (m: Marker | undefined) => {
  (window as unknown as { __foleviNativeChrome?: Marker }).__foleviNativeChrome = m;
};
/** Renders a hook and keeps its latest value. */
function watch<T>(hook: () => T): { current: T } {
  const seen = { current: undefined as T };
  function Probe() {
    seen.current = hook();
    return null;
  }
  act(() => createRoot(document.createElement("div")).render(<Probe />));
  return seen;
}

const tell = (wide: boolean) => {
  (window as unknown as { __foleviNativeChrome: Marker }).__foleviNativeChrome.wide = wide;
  window.dispatchEvent(new Event("folevi-native-layout"));
};

describe("the iPhone app's layout on iPhone Duo", () => {
  afterEach(() => marker(undefined));

  test("an iPhone that says nothing keeps the phone's page", () => {
    marker({ platform: "ios", protocol: 1, place: null });
    expect(isIphoneApp()).toBe(true);
    expect(isIpadNativeWide()).toBe(false);
  });

  test("open, the page takes the iPad's wide look; closed, the phone's", () => {
    marker({ platform: "ios", protocol: 1, place: null, wide: true });
    expect(isIphoneApp()).toBe(false);
    expect(isIpadNativeWide()).toBe(true);
    marker({ platform: "ios", protocol: 1, place: null, wide: false });
    expect(isIphoneApp()).toBe(true);
    expect(isIpadNativeWide()).toBe(false);
  });

  test("the page follows as the phone folds and unfolds", () => {
    marker({ platform: "ios", protocol: 1, place: null, wide: false });
    const phone = watch(useIphoneApp);
    const wide = watch(useIpadNativeWide);
    expect(phone.current).toBe(true);
    expect(wide.current).toBe(false);
    act(() => tell(true));
    expect(phone.current).toBe(false);
    expect(wide.current).toBe(true);
    act(() => tell(false));
    expect(phone.current).toBe(true);
    expect(wide.current).toBe(false);
  });
});
