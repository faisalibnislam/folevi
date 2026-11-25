// The script Tauri injects into Folevi's pages (src-tauri/bridge/host.js with the shared shell-bridge.js inside, as
// lib.rs boot_script builds it) must parse: one stray brace and the page gets no bridge at all. Also checks that it
// waits for the page's own boot before making foleviShell, and that the scripted smoke walk parses.
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const host = readFileSync(resolve(root, "src-tauri/bridge/host.js"), "utf8");
const shellBridge = readFileSync(resolve(root, "../ios/ios/App/Native/Shell/shell-bridge.js"), "utf8");
const MARKER = '/*BOOT*/ { shell: false, platform: "windows", window: "main" } /*BOOT_END*/';

// The shared Dropbox and Google Drive code, when this checkout has it built (CI does: apps/ios/scripts/bundle-cloud.mjs).
const kitFile = resolve(root, "../ios/ios/App/Native/Shell/folevi-cloud.js");
const kit = existsSync(kitFile) ? readFileSync(kitFile, "utf8") : "";
const compose = (boot) => host.replace(MARKER, JSON.stringify(boot)).replace("/*SHELL_BRIDGE*/", shellBridge).replace("/*CLOUD_KIT*/", kit);

describe("the injected bridge", () => {
  test("has the markers lib.rs fills", () => {
    expect(host).toContain(MARKER);
    expect(host).toContain("/*SHELL_BRIDGE*/");
    expect(host).toContain("/*CLOUD_KIT*/");
  });

  test.runIf(kit !== "")("carries the Dropbox and Google Drive kit when it's built", () => {
    expect(kit).toContain("FoleviCloudKit");
    expect(() => new Function(compose({ shell: true, platform: "linux", window: "main" }))).not.toThrow();
  });

  test("parses as lib.rs composes it", () => {
    expect(() => new Function(compose({ shell: true, platform: "windows", window: "main" }))).not.toThrow();
    expect(() => new Function(host)).not.toThrow();
  });

  test("makes foleviShell only when the page's boot comes, over the host's calls", () => {
    const calls = [];
    const win = {
      __TAURI_INTERNALS__: { invoke: (cmd, args) => (calls.push([cmd, args]), Promise.resolve(null)) },
      addEventListener() {},
      matchMedia: () => ({ matches: false, addEventListener() {} }),
    };
    win.window = win;
    const doc = {
      documentElement: { setAttribute() {}, getAttribute: () => null, removeAttribute() {}, style: { setProperty() {}, removeProperty() {} } },
      readyState: "loading",
      addEventListener() {},
      querySelector: () => null,
    };
    const location = { origin: "https://app.localhost", pathname: "/documents", search: "", hash: "", href: "https://app.localhost/documents" };
    const history = { replaceState() {}, state: null };
    const run = new Function("window", "document", "location", "history", "MutationObserver", "Element", compose({ shell: true, platform: "windows", window: "main", origins: ["https://app.localhost"] }));
    run(win, doc, location, history, function () { return { observe() {} }; }, function () {});
    expect(win.foleviShell).toBeUndefined();
    expect(win.foleviDesktop.platform).toBe("windows");
    win.__foleviHost.boot({ mode: "local", deviceName: "PC", start: "/documents", places: { current: "library", background: false } });
    expect(win.foleviShell.platform).toBe("windows");
    expect(win.foleviShell.initialMode).toBe("local");
    void win.foleviShell.library.info();
    expect(calls.some(([cmd, a]) => cmd === "shell_call" && a.method === "libInfo" && a.plugin === "FoleviShell")).toBe(true);
  });
});

describe("the helper scripts", () => {
  test("the smoke walk parses", () => {
    const flow = readFileSync(resolve(root, "scripts/smoke-flow.js"), "utf8");
    expect(() => new Function("report", flow)).not.toThrow();
  });
});
