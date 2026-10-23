// Folevi's one version (version.json, scripts/version.mjs): the owner's format (biggest.big.minor, two digits
// last), the script that sets and bumps it and writes it into every app's project, and the places that show it,
// always "Folevi 1.0.00" and never with a build number.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
// @ts-expect-error: a plain .mjs script without types
import * as v from "../../../scripts/version.mjs";
import { VersionFooter } from "@/components/iphone/SettingsKit";
import { FOLEVI_VERSION, versionLabel } from "@/lib/version";

const repo = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(join(repo, path), "utf8");
const files = v.TARGETS.map((t: { file: string }) => t.file) as string[];

describe("the format", () => {
  test("biggest.big.minor with two digits last", () => {
    for (const ok of ["1.0.00", "1.0.01", "1.12.99", "2.0.00", "10.3.07"]) expect(v.isVersion(ok)).toBe(true);
    for (const bad of ["1.0.0", "1.0", "1.0.000", "1.0.0a", "v1.0.00", "1.0.00 (4)", "", null]) expect(v.isVersion(bad)).toBe(false);
    expect(() => v.parseVersion("1.0.0")).toThrow(/two digits last/);
    expect(v.formatVersion({ biggest: 1, big: 2, minor: 3 })).toBe("1.2.03");
  });

  test("bumps: minor, then big from .00, biggest from .0.00", () => {
    expect(v.nextVersion("1.0.00", "minor")).toBe("1.0.01");
    expect(v.nextVersion("1.0.09", "minor")).toBe("1.0.10");
    expect(v.nextVersion("1.0.05", "big")).toBe("1.1.00");
    expect(v.nextVersion("1.3.07", "biggest")).toBe("2.0.00");
    expect(() => v.nextVersion("1.0.99", "minor")).toThrow(/bump big/);
    expect(() => v.nextVersion("1.0.00", "patch")).toThrow(/minor, big or biggest/);
  });

  test("compares as whole numbers", () => {
    expect(v.compareVersions("1.0.10", "1.0.09")).toBeGreaterThan(0);
    expect(v.compareVersions("1.1.00", "1.0.99")).toBeGreaterThan(0);
    expect(v.compareVersions("2.0.00", "2.0.00")).toBe(0);
  });
});

describe("scripts/version.mjs on a copy of the projects", () => {
  let root = "";
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "folevi-version-"));
    for (const f of ["version.json", ...files]) {
      mkdirSync(dirname(join(root, f)), { recursive: true });
      cpSync(join(repo, f), join(root, f));
    }
    writeFileSync(join(root, "version.json"), JSON.stringify({ version: "1.0.00", build: 4 }));
    v.writeVersion(root, { version: "1.0.00", build: 4 });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));
  const at = (f: string) => readFileSync(join(root, f), "utf8");

  test("a bump writes the version into every app and the hidden build goes up by one", () => {
    const r = v.bumpVersion("minor", { root });
    expect(r).toMatchObject({ version: "1.0.01", build: 5 });
    expect(r.changed).toEqual(["version.json", ...files]);
    expect(JSON.parse(at("version.json"))).toEqual({ version: "1.0.01", build: 5 });
    // Folevi for Mac (XcodeGen): the version quoted so YAML keeps "1.0.01" as written.
    expect(at("apps/mac/project.yml")).toMatch(/^\s*MARKETING_VERSION: "1\.0\.01"$/m);
    expect(at("apps/mac/project.yml")).toMatch(/^\s*CURRENT_PROJECT_VERSION: 5$/m);
    // iPhone and iPad: the app and every extension (App Store Connect wants them the same).
    const pbx = at("apps/ios/ios/App/App.xcodeproj/project.pbxproj");
    const marketing = [...pbx.matchAll(/MARKETING_VERSION = ([^;]*);/g)].map((m) => m[1]);
    const builds = [...pbx.matchAll(/CURRENT_PROJECT_VERSION = ([^;]*);/g)].map((m) => m[1]);
    expect(marketing.length).toBeGreaterThanOrEqual(3);
    expect(new Set(marketing)).toEqual(new Set(["1.0.01"]));
    expect(new Set(builds)).toEqual(new Set(["5"]));
    // Android: versionName shown, versionCode the hidden whole number.
    const gradle = at("apps/android/android/app/build.gradle.kts");
    expect(gradle).toMatch(/^\s*versionName = "1\.0\.01"$/m);
    expect(gradle).toMatch(/^\s*versionCode = 5$/m);
    expect(v.outOfSync(root)).toEqual([]);
  });

  test("big and biggest; set; the same version again keeps its build; older is refused", () => {
    expect(v.bumpVersion("big", { root })).toMatchObject({ version: "1.1.00", build: 5 });
    expect(v.bumpVersion("biggest", { root })).toMatchObject({ version: "2.0.00", build: 6 });
    expect(v.setVersion("2.0.00", { root })).toMatchObject({ version: "2.0.00", build: 6, changed: [] });
    expect(() => v.setVersion("1.9.00", { root })).toThrow(/older/);
    expect(() => v.setVersion("2.1", { root })).toThrow(/two digits last/);
    expect(v.bumpBuild({ root })).toMatchObject({ version: "2.0.00", build: 7 });
  });

  test("a project edited by hand shows up as out of step", () => {
    writeFileSync(join(root, "apps/mac/project.yml"), at("apps/mac/project.yml").replace(/MARKETING_VERSION: .*/, "MARKETING_VERSION: 2.0.0"));
    expect(v.outOfSync(root)).toEqual(["apps/mac/project.yml"]);
  });
});

describe("the repository", () => {
  test("version.json holds a version in the format and every project says it", () => {
    const info = v.readVersion();
    expect(v.isVersion(info.version)).toBe(true);
    expect(Number.isInteger(info.build)).toBe(true);
    expect(v.outOfSync()).toEqual([]);
  });

  test("the old bump-after-the-first-number scripts are gone", () => {
    expect(() => read("apps/mac/scripts/bump-version.mjs")).toThrow();
    expect(read("apps/mac/scripts/release.mjs")).not.toMatch(/bump-version/);
    expect(read("apps/mac/scripts/publish.mjs")).not.toMatch(/bump-version/);
  });

  test("the apps read their version from the project, and the build is never handed to the page", () => {
    for (const plist of ["apps/mac/Folevi/Resources/Info.plist", "apps/ios/ios/App/App/Info.plist", "apps/ios/ios/App/ShareExtension/Info.plist", "apps/ios/ios/App/Widgets/Info.plist"]) {
      expect(read(plist)).toMatch(/<key>CFBundleShortVersionString<\/key>\s*<string>\$\(MARKETING_VERSION\)<\/string>/);
      expect(read(plist)).toMatch(/<key>CFBundleVersion<\/key>\s*<string>\$\(CURRENT_PROJECT_VERSION\)<\/string>/);
    }
    expect(read("apps/ios/ios/App/App/bridge.js")).not.toMatch(/BUILD/);
    expect(read("apps/ios/ios/App/App/FoleviViewController.swift")).not.toMatch(/__FOLEVI_BUILD__/);
    expect(read("apps/android/android/app/src/main/java/com/folevi/android/MainActivity.kt")).toMatch(/put\("version", BuildConfig\.VERSION_NAME\)/);
    // The Mac's About panel: the version alone, an empty build.
    expect(read("apps/mac/Folevi/App/AppDelegate.swift")).toMatch(/\.applicationVersion: Paths\.version, \.version: ""/);
    expect(read("apps/mac/Folevi/Chrome/MenuModel.swift")).toMatch(/"app\.about", "About Folevi", "showAboutPanel:"/);
    // Sparkle compares the hidden build; the release checks both.
    expect(read("apps/mac/scripts/publish.mjs")).toMatch(/sparkle:version>\$\{build\}</);
    expect(read("apps/mac/scripts/release.mjs")).toMatch(/CFBundleVersion/);
  });
});

describe("where it's shown", () => {
  let root: Root | null = null;
  let host: HTMLElement | null = null;
  const show = () => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root!.render(createElement(VersionFooter)));
    return host.textContent;
  };
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });
  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    delete (window as { foleviNative?: unknown }).foleviNative;
  });

  test("the website: Folevi and version.json's version", () => {
    const { version } = v.readVersion();
    expect(FOLEVI_VERSION).toBe(version);
    expect(versionLabel()).toBe(`Folevi ${version}`);
    expect(show()).toBe(`Folevi ${version}`);
  });

  test("in the iPhone app: the app's own version, never its build number", () => {
    Object.defineProperty(window, "foleviNative", { value: { platform: "ios", version: "1.0.07", build: "12" }, configurable: true, writable: true });
    expect(show()).toBe("Folevi 1.0.07");
  });
});
