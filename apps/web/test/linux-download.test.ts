import { describe, expect, test } from "vitest";
import { linuxSuggestion } from "@/components/marketing/LinuxDownload";

// Download for Linux suggests the package this computer most likely wants, and only when it can tell.
const FIREFOX_UBUNTU = "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0";
const FIREFOX_FEDORA_ARM = "Mozilla/5.0 (X11; Fedora; Linux aarch64; rv:133.0) Gecko/20100101 Firefox/133.0";
const CHROME_LINUX = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
const CHROME_LINUX_GENERIC = "Mozilla/5.0 (X11; Linux) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
const data = (architecture: string) => ({ platform: "Linux", getHighEntropyValues: async () => ({ architecture }) });

describe("linuxSuggestion", () => {
  test("the distribution's own package, for the right kind of PC", async () => {
    expect(await linuxSuggestion(FIREFOX_UBUNTU, undefined)).toEqual({ format: "deb", arch: "x64" });
    expect(await linuxSuggestion(FIREFOX_FEDORA_ARM, undefined)).toEqual({ format: "rpm", arch: "arm64" });
  });
  test("no distribution named: the AppImage; the kind of PC from the browser when the address doesn't say", async () => {
    expect(await linuxSuggestion(CHROME_LINUX, undefined)).toEqual({ format: "appimage", arch: "x64" });
    expect(await linuxSuggestion(CHROME_LINUX_GENERIC, data("arm"))).toEqual({ format: "appimage", arch: "arm64" });
  });
  test("nothing suggested off Linux or when the kind of PC is unknown", async () => {
    expect(await linuxSuggestion("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15", undefined)).toBeNull();
    expect(await linuxSuggestion("Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/131.0 Mobile Safari/537.36", undefined)).toBeNull();
    expect(await linuxSuggestion("Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) Chrome/131.0 Safari/537.36", undefined)).toBeNull();
    expect(await linuxSuggestion(CHROME_LINUX_GENERIC, undefined)).toBeNull();
  });
});
