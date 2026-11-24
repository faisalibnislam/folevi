import { describe, expect, test } from "vitest";
import { windowsBuild } from "@/components/marketing/WindowsDownload";

// Download for Windows picks the installer for this PC when the browser says which kind it is.
const ua = (platform: string, architecture?: string) => ({ platform, getHighEntropyValues: async () => ({ architecture }) });

describe("windowsBuild", () => {
  test("an Arm PC gets arm64, an Intel or AMD PC gets x64", async () => {
    expect(await windowsBuild(ua("Windows", "arm"))).toBe("arm64");
    expect(await windowsBuild(ua("Windows", "x86"))).toBe("x64");
  });
  test("can't tell: Firefox (no userAgentData), another system, or no answer", async () => {
    expect(await windowsBuild(undefined)).toBeNull();
    expect(await windowsBuild(ua("macOS", "arm"))).toBeNull();
    expect(await windowsBuild(ua("Windows"))).toBeNull();
    expect(await windowsBuild({ platform: "Windows", getHighEntropyValues: async () => Promise.reject(new Error("no")) })).toBeNull();
  });
});
