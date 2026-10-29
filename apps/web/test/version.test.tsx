// Folevi's one version (version.json, scripts/version.mjs): the owner's format (MAJOR.UPDATE.PATCH as #.#.##), the
// three kinds of release and their rollover, numeric comparison, the changelog (CHANGELOG.json and .md), the release
// action that writes it all into every app's project, and the places that show it, always "Folevi 1.0.00" and never
// with a build number.
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
  test("MAJOR.UPDATE.PATCH as #.#.##: one digit for UPDATE, two for PATCH", () => {
    for (const ok of ["1.0.00", "1.0.01", "1.9.99", "2.0.00", "10.3.07", "0.1.00", "999.9.99"]) expect(v.isVersion(ok)).toBe(true);
    for (const bad of ["1.0.1", "1.0.001", "1.10.00", "1.12.99", "1.0.0", "1.0", "01.0.00", "1000.0.00", "1.0.0a", "v1.0.00", " 1.0.00", "1.0.00 (4)", "", null, 1]) expect(v.isVersion(bad)).toBe(false);
    expect(() => v.parseVersion("1.0.1")).toThrow(/#\.#\.##/);
    expect(v.parseVersion("1.2.03")).toEqual({ major: 1, update: 2, patch: 3 });
    expect(v.formatVersion({ major: 1, update: 2, patch: 3 })).toBe("1.2.03");
    expect(v.formatVersion({ major: 1, update: 0, patch: 0 })).toBe("1.0.00");
    for (const bad of [{ major: 1, update: 10, patch: 0 }, { major: 1, update: 0, patch: 100 }, { major: -1, update: 0, patch: 0 }, { major: 1, update: 0.5, patch: 0 }]) expect(() => v.formatVersion(bad)).toThrow();
  });

  test("the owner's examples", () => {
    const cases: Array<[string, string, string]> = [
      ["1.0.00", "patch", "1.0.01"],
      ["1.0.09", "patch", "1.0.10"],
      ["1.0.25", "update", "1.1.00"],
      ["1.1.99", "patch", "1.2.00"],
      ["1.9.99", "patch", "2.0.00"],
      ["1.5.20", "major", "2.0.00"],
    ];
    for (const [from, kind, to] of cases) expect(v.nextVersion(from, kind)).toBe(to);
  });

  test("rollover: 99 into UPDATE, 9 into MAJOR, for every kind", () => {
    expect(v.nextVersion("1.0.98", "patch")).toBe("1.0.99");
    expect(v.nextVersion("1.0.99", "patch")).toBe("1.1.00");
    expect(v.nextVersion("1.8.99", "patch")).toBe("1.9.00");
    expect(v.nextVersion("1.8.40", "update")).toBe("1.9.00");
    expect(v.nextVersion("1.9.00", "update")).toBe("2.0.00");
    expect(v.nextVersion("1.9.40", "update")).toBe("2.0.00");
    expect(v.nextVersion("9.9.99", "patch")).toBe("10.0.00");
    expect(v.nextVersion("1.0.00", "major")).toBe("2.0.00");
    expect(() => v.nextVersion("999.9.99", "patch")).toThrow(/last version/);
    expect(() => v.nextVersion("999.0.00", "major")).toThrow(/last version/);
  });

  test("every next version is newer and keeps the format, all the way from 1.0.00 to 3.0.00", () => {
    let at = "1.0.00";
    let steps = 0;
    while (at !== "3.0.00") {
      const next = v.nextVersion(at, "patch");
      expect(v.isVersion(next)).toBe(true);
      expect(v.compareVersions(next, at)).toBeGreaterThan(0);
      at = next;
      steps++;
    }
    expect(steps).toBe(2 * 10 * 100);
  });

  test("the kinds of release by name, the old names too, and nothing else", () => {
    expect(v.RELEASE_TYPES).toEqual({ major: "Major release", update: "Big update", patch: "Small update" });
    expect(v.nextVersion("1.0.04", "minor")).toBe("1.0.05");
    expect(v.nextVersion("1.0.05", "big")).toBe("1.1.00");
    expect(v.nextVersion("1.3.07", "biggest")).toBe("2.0.00");
    expect(v.nextVersion("1.3.07", "small")).toBe("1.3.08");
    for (const bad of ["Patch", "build", "", "toString", "__proto__"]) expect(() => v.nextVersion("1.0.00", bad)).toThrow(/major, update or patch/);
    expect(v.releaseTypeOf("1.0.25", "1.1.00")).toBe("update");
    expect(v.releaseTypeOf("1.0.25", "1.0.26")).toBe("patch");
    expect(v.releaseTypeOf("1.0.25", "1.0.27")).toBe(null);
    expect(v.releaseTypeOf("1.0.25", "1.2.00")).toBe(null);
  });

  test("compares as numbers, never as text", () => {
    expect(v.compareVersions("1.0.10", "1.0.09")).toBeGreaterThan(0);
    expect(v.compareVersions("1.1.00", "1.0.99")).toBeGreaterThan(0);
    expect(v.compareVersions("10.0.00", "9.9.99")).toBeGreaterThan(0);
    expect(v.compareVersions("2.0.00", "2.0.00")).toBe(0);
    expect(v.compareVersions("1.9.99", "2.0.00")).toBeLessThan(0);
    expect(() => v.compareVersions("1.0.1", "1.0.01")).toThrow();
    // As text, "10.0.00" < "9.9.99" and "1.0.10" < "1.0.9x": sorting must not go by text.
    expect(v.sortVersions(["10.0.00", "1.0.10", "9.9.99", "1.0.09", "1.1.00"])).toEqual(["1.0.09", "1.0.10", "1.1.00", "9.9.99", "10.0.00"]);
    expect(v.sortVersions(["1.0.09", "10.0.00", "1.0.10"], { newest: true })).toEqual(["10.0.00", "1.0.10", "1.0.09"]);
  });

  test("a Sparkle feed's versions and builds, both ways it writes them", () => {
    const xml = `<item><sparkle:version>14</sparkle:version><sparkle:shortVersionString>1.1.04</sparkle:shortVersionString><sparkle:minimumSystemVersion>13.0</sparkle:minimumSystemVersion></item>
      <item><enclosure sparkle:version="13" sparkle:shortVersionString="1.1.03" /></item>`;
    expect(v.appcastReleases(xml)).toEqual({ versions: ["1.1.04", "1.1.03"], builds: [14, 13] });
    expect(v.appcastReleases("")).toEqual({ versions: [], builds: [] });
  });

  test("release notes for Sparkle: an HTML fragment, escaped", () => {
    const html = v.releaseNotesHtml({ version: "1.1.05", build: 15, date: "2026-10-30", type: "patch", changes: ["<b> & \"x\""] });
    expect(html).toContain("<h2>Folevi 1.1.05</h2>");
    expect(html).toContain("Small update, 2026-10-30");
    expect(html).toContain("<li>&lt;b&gt; &amp; &quot;x&quot;</li>");
    expect(html).not.toMatch(/<body|DOCTYPE/i);
  });
});

describe("scripts/version.mjs on a copy of the projects", () => {
  let root = "";
  const first = { version: "1.0.00", build: 4, date: "2026-10-23", type: "major", changes: ["One version"] };
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "folevi-version-"));
    for (const f of ["version.json", "CHANGELOG.json", ...files]) {
      mkdirSync(dirname(join(root, f)), { recursive: true });
      cpSync(join(repo, f), join(root, f));
    }
    v.writeVersion(root, { version: "1.0.00", build: 4 });
    v.writeChangelog(root, [first]);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));
  const at = (f: string) => readFileSync(join(root, f), "utf8");
  const changes = ["A change"];

  test("a release writes the version into every app, the build goes up by one, and the changelog has it", () => {
    const r = v.release("patch", { root, changes, date: "2026-10-24" });
    expect(r).toMatchObject({ version: "1.0.01", build: 5, type: "patch", date: "2026-10-24", changes });
    expect(r.changed).toEqual(["version.json", ...files, "CHANGELOG.json", "CHANGELOG.md"]);
    expect(JSON.parse(at("version.json"))).toEqual({ version: "1.0.01", build: 5 });
    expect(v.readChangelog(root)).toEqual([{ version: "1.0.01", build: 5, date: "2026-10-24", type: "patch", changes }, first]);
    expect(at("CHANGELOG.md")).toContain("## 1.0.01 (2026-10-24)\n\nSmall update, build 5\n\n- A change");
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
    expect(v.problems(root)).toEqual([]);
  });

  test("each kind in turn, set to a next version, a rebuild; skipped, repeated or older versions are refused", () => {
    expect(v.release("update", { root, changes, date: "2026-10-24" })).toMatchObject({ version: "1.1.00", build: 5 });
    expect(v.release("major", { root, changes, date: "2026-10-24" })).toMatchObject({ version: "2.0.00", build: 6 });
    expect(v.setVersion("2.0.01", { root, changes, date: "2026-10-25" })).toMatchObject({ version: "2.0.01", build: 7, type: "patch" });
    expect(() => v.setVersion("2.0.01", { root, changes })).toThrow(/never released twice/);
    expect(() => v.setVersion("1.9.00", { root, changes })).toThrow(/isn't newer/);
    expect(() => v.setVersion("2.0.03", { root, changes })).toThrow(/isn't the next version/);
    expect(() => v.setVersion("2.1", { root, changes })).toThrow(/#\.#\.##/);
    expect(v.bumpBuild({ root })).toMatchObject({ version: "2.0.01", build: 8 });
    expect(v.readChangelog(root)[0]).toMatchObject({ version: "2.0.01", build: 8 });
    expect(v.problems(root)).toEqual([]);
  });

  test("a release says what changed and isn't dated before the last", () => {
    expect(() => v.release("patch", { root, changes: [] })).toThrow(/what changed/);
    expect(() => v.release("patch", { root, changes: ["  "] })).toThrow(/what changed/);
    expect(() => v.release("patch", { root, changes, date: "2026-10-22" })).toThrow(/on or after/);
    expect(() => v.release("patch", { root, changes, date: "29/10/2026" })).toThrow(/YYYY-MM-DD/);
    // Nothing was written by the refused releases.
    expect(JSON.parse(at("version.json"))).toEqual({ version: "1.0.00", build: 4 });
    expect(v.planRelease("patch", { root, changes, date: "2026-10-24" }).release).toMatchObject({ version: "1.0.01", build: 5 });
    expect(JSON.parse(at("version.json"))).toEqual({ version: "1.0.00", build: 4 });
  });

  test("a version changed by hand, without a release, is caught", () => {
    writeFileSync(join(root, "version.json"), JSON.stringify({ version: "1.0.01", build: 5 }));
    v.writeVersion(root, { version: "1.0.01", build: 5 });
    expect(v.problems(root)).toEqual([expect.stringMatching(/newest release in CHANGELOG\.json is 1\.0\.00/)]);
    expect(() => v.release("patch", { root, changes })).toThrow(/Fix the changelog first/);
  });

  test("a project edited by hand shows up as out of step", () => {
    writeFileSync(join(root, "apps/mac/project.yml"), at("apps/mac/project.yml").replace(/MARKETING_VERSION: .*/, "MARKETING_VERSION: 2.0.0"));
    expect(v.outOfSync(root)).toEqual(["apps/mac/project.yml"]);
    expect(v.problems(root)).toEqual([expect.stringMatching(/apps\/mac\/project\.yml/)]);
  });

  test("the changelog's own checks", () => {
    const next = { version: "1.0.01", build: 5, date: "2026-10-24", type: "patch", changes };
    expect(v.changelogProblems([next, first], { version: "1.0.01", build: 5 })).toEqual([]);
    expect(v.changelogProblems([first, next])).toEqual([expect.stringMatching(/isn't newer/), expect.stringMatching(/build 4 isn't above/), expect.stringMatching(/Major release after 1\.0\.01 is 2\.0\.00, not 1\.0\.00/), expect.stringMatching(/dated before/)]);
    expect(v.changelogProblems([next, next])).toEqual(expect.arrayContaining([expect.stringMatching(/there twice/)]));
    expect(v.changelogProblems([{ ...next, version: "1.0.02" }, first])).toEqual([expect.stringMatching(/is 1\.0\.01, not 1\.0\.02/)]);
    expect(v.changelogProblems([{ ...next, type: "update" }, first])).toEqual([expect.stringMatching(/Big update after 1\.0\.00 is 1\.1\.00/)]);
    expect(v.changelogProblems([{ ...next, type: "small" }, first])).toEqual([expect.stringMatching(/type is major, update or patch/)]);
    expect(v.changelogProblems([{ ...next, changes: [] }, first])).toEqual([expect.stringMatching(/no changes/)]);
    expect(v.changelogProblems([{ ...next, date: "2026-13-45" }, first])).toEqual([expect.stringMatching(/YYYY-MM-DD/)]);
    expect(v.changelogProblems([{ ...next, version: "1.0.1" }])).toEqual([expect.stringMatching(/not a version/)]);
  });
});

describe("the repository", () => {
  test("version.json holds a version in the format, every project says it, and the changelog's newest release is it", () => {
    const info = v.readVersion();
    expect(v.isVersion(info.version)).toBe(true);
    expect(Number.isInteger(info.build)).toBe(true);
    expect(v.problems()).toEqual([]);
    expect(v.readChangelog()[0]).toMatchObject(info);
  });

  test("the release history from 1.0.00 is kept", () => {
    const releases = v.readChangelog();
    const versions = releases.map((r: { version: string }) => r.version);
    for (const shipped of ["1.0.00", "1.0.01", "1.0.02", "1.0.03", "1.0.04", "1.0.05", "1.1.00", "1.1.01", "1.1.02", "1.1.03", "1.1.04"]) expect(versions).toContain(shipped);
    expect(releases.at(-1)).toMatchObject({ version: "1.0.00", build: 4, date: "2026-10-23" });
    expect(releases.find((r: { version: string }) => r.version === "1.1.04")).toMatchObject({ build: 14, date: "2026-10-29", type: "patch" });
    expect(JSON.stringify(releases)).not.toMatch(/\u2014/);
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
    // Publishing checks the version against the live feed and gives Sparkle the changelog's notes.
    expect(read("apps/mac/scripts/publish.mjs")).toMatch(/appcastReleases\(feed\)/);
    expect(read("apps/mac/scripts/publish.mjs")).toMatch(/releaseNotesHtml\(notes\)/);
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
