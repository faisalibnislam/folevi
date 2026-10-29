// Folevi's one version (version.json, scripts/version.mjs): the owner's format (MAJOR.UPDATE.PATCH, PATCH at least
// two digits, no limits), the three kinds of release without rollover, a Major release only when the owner asks,
// numeric comparison with BigInts, the changelog (CHANGELOG.json and .md), the release action that writes it all
// into every app's project or nothing, and the places that show it, always "Folevi 1.0.00", never a build number.
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  test("MAJOR.UPDATE.PATCH, PATCH at least two digits, no other leading zeros, no upper limit", () => {
    for (const ok of ["1.0.00", "1.0.01", "1.0.09", "1.0.10", "1.1.01", "1.9.99", "1.10.100", "1.100.1000", "2.0.00", "10.250.1500", "10.1000.10000", "0.0.00"]) expect(v.validateVersion(ok)).toBe(true);
    for (const bad of ["1.0.1", "1.0.001", "1.0.010", "1.01.00", "01.0.00", "1.0.0", "1.0", "1.0.00.00", "-1.0.00", "1.-1.00", "1.0.-1", "1.5.00.5", "1.0.0a", "v1.0.00", " 1.0.00", "1.0.00 (4)", "1.0.1e3", "", null, 1, undefined]) expect(v.validateVersion(bad)).toBe(false);
    expect(() => v.parseVersion("1.0.1")).toThrow(/at least two digits/);
    expect(v.parseVersion("1.10.100")).toEqual({ major: 1n, update: 10n, patch: 100n });
  });

  test("formatting pads PATCH to two digits and never cuts a number", () => {
    expect(v.formatVersion("1.0.0")).toBe("1.0.00");
    expect(v.formatVersion("1.0.9")).toBe("1.0.09");
    expect(v.formatVersion("1.0.10")).toBe("1.0.10");
    expect(v.formatVersion("1.10.100")).toBe("1.10.100");
    expect(v.formatVersion("1.100.1000")).toBe("1.100.1000");
    expect(v.formatVersion(1, 0, 1)).toBe("1.0.01");
    expect(v.formatVersion({ major: 2n, update: 3n, patch: 4n })).toBe("2.3.04");
    for (const bad of [[-1, 0, 0], [1, 0.5, 0], [1, 0, -2], [1, 0, Number.NaN], [1, 0, 2 ** 60], ["1", "a", "0"]]) expect(() => v.formatVersion(...bad)).toThrow(/whole number/);
    expect(() => v.formatVersion("1.0")).toThrow(/three numbers/);
  });

  test("the owner's tables: Major release, Big update, Small update", () => {
    const major = [["1.0.00", "2.0.00"], ["1.5.25", "2.0.00"], ["1.9.99", "2.0.00"], ["1.100.1000", "2.0.00"], ["9.999.9999", "10.0.00"]];
    for (const [from, to] of major) expect(v.incrementMajor(from, { authorized: true })).toBe(to);
    const big = [["1.0.00", "1.1.00"], ["1.0.05", "1.1.05"], ["1.9.99", "1.10.99"], ["1.10.100", "1.11.100"], ["1.99.999", "1.100.999"], ["2.100.1000", "2.101.1000"]];
    for (const [from, to] of big) expect(v.incrementUpdate(from)).toBe(to);
    const small = [["1.0.00", "1.0.01"], ["1.0.09", "1.0.10"], ["1.0.99", "1.0.100"], ["1.9.99", "1.9.100"], ["1.10.100", "1.10.101"], ["1.100.999", "1.100.1000"]];
    for (const [from, to] of small) expect(v.incrementPatch(from)).toBe(to);
  });

  test("no rollover: a Big update keeps PATCH, a Small update keeps UPDATE, neither touches MAJOR", () => {
    let at = "1.0.00";
    for (let i = 0; i < 250; i++) at = v.incrementPatch(at);
    expect(at).toBe("1.0.250");
    for (let i = 0; i < 120; i++) at = v.incrementUpdate(at);
    expect(at).toBe("1.120.250");
    for (const kind of ["patch", "update", "small", "big", "minor"]) expect(v.parseVersion(v.nextVersion("7.9.99", kind)).major).toBe(7n);
  });

  test("huge numbers don't overflow", () => {
    const big = "123456789012345678901234567890.98765432109876543210.99999999999999999999";
    expect(v.validateVersion(big)).toBe(true);
    expect(v.incrementPatch(big)).toBe("123456789012345678901234567890.98765432109876543210.100000000000000000000");
    expect(v.incrementUpdate(big)).toBe("123456789012345678901234567890.98765432109876543211.99999999999999999999");
    expect(v.incrementMajor(big, { authorized: true })).toBe("123456789012345678901234567891.0.00");
    expect(v.compareVersions(v.incrementPatch(big), big)).toBe(1);
    // Past Number.MAX_SAFE_INTEGER, where plain numbers would round.
    expect(v.compareVersions("1.0.9007199254740993", "1.0.9007199254740992")).toBe(1);
  });

  test("a Major release is never automatic", () => {
    expect(() => v.incrementMajor("1.5.25")).toThrow(/explicit instruction/);
    expect(() => v.incrementMajor("1.5.25", { authorized: "yes" })).toThrow(/explicit instruction/);
    expect(() => v.nextVersion("1.5.25", "major")).toThrow(/explicit instruction/);
    // "biggest" was the old name for it; a Major release is only ever asked for by name now.
    for (const bad of ["biggest", "Major", "Patch", "build", "", "toString", "__proto__"]) expect(() => v.nextVersion("1.0.00", bad)).toThrow(/major, update or patch/);
    expect(v.RELEASE_TYPES).toEqual({ major: "Major release", update: "Big update", patch: "Small update" });
  });

  test("compares as numbers across digit lengths, never as text", () => {
    expect(v.compareVersions("1.0.10", "1.0.09")).toBeGreaterThan(0);
    expect(v.compareVersions("1.0.100", "1.0.99")).toBeGreaterThan(0);
    expect(v.compareVersions("1.10.00", "1.9.99")).toBeGreaterThan(0);
    expect(v.compareVersions("10.0.00", "9.999.9999")).toBeGreaterThan(0);
    expect(v.compareVersions("2.0.00", "2.0.00")).toBe(0);
    expect(v.compareVersions("1.9.100", "1.10.00")).toBeLessThan(0);
    expect(() => v.compareVersions("1.0.1", "1.0.01")).toThrow();
    const mixed = ["10.0.00", "1.0.100", "9.9.99", "1.0.09", "1.10.00", "1.9.100", "1.0.10"];
    expect([...mixed].sort()).not.toEqual(v.sortVersions(mixed));
    expect(v.sortVersions(mixed)).toEqual(["1.0.09", "1.0.10", "1.0.100", "1.9.100", "1.10.00", "9.9.99", "10.0.00"]);
    expect(v.sortVersions(mixed, { newest: true })[0]).toBe("10.0.00");
  });

  test("a Sparkle feed's versions and builds, both ways it writes them", () => {
    const xml = `<item><sparkle:version>14</sparkle:version><sparkle:shortVersionString>1.1.04</sparkle:shortVersionString><sparkle:minimumSystemVersion>13.0</sparkle:minimumSystemVersion></item>
      <item><enclosure sparkle:version="13" sparkle:shortVersionString="1.10.100" /></item>`;
    expect(v.appcastReleases(xml)).toEqual({ versions: ["1.1.04", "1.10.100"], builds: [14, 13] });
    expect(v.appcastReleases("")).toEqual({ versions: [], builds: [] });
  });

  test("release notes for Sparkle: an HTML fragment by section, escaped", () => {
    const html = v.releaseNotesHtml({ version: "1.1.05", build: 15, released: "2026-10-30T10:00:00+06:00", type: "patch", summary: "Fixes.", fixed: ['<b> & "x"'] });
    expect(html).toContain("<h2>Folevi 1.1.05</h2>");
    expect(html).toContain("<p>Small update. Fixes.</p>");
    expect(html).toContain("<h3>Fixed</h3>");
    expect(html).toContain("<li>&lt;b&gt; &amp; &quot;x&quot;</li>");
    expect(html).not.toMatch(/<body|DOCTYPE|Added/i);
  });

  test("a notes file by section", () => {
    expect(v.parseNotes("## Summary\nA fix.\n\n## Fixed\n- One\n* Two\n### Breaking changes\n- Three\n")).toEqual({ summary: "A fix.", added: [], improved: [], fixed: ["One", "Two"], breaking: ["Three"] });
    expect(() => v.parseNotes("- loose")).toThrow(/section heading/);
    expect(() => v.parseNotes("## Misc\n- x")).toThrow(/Unknown section/);
  });
});

describe("scripts/version.mjs on a copy of the projects", () => {
  let root = "";
  const first = { version: "1.0.00", build: 4, released: "2026-10-23T06:50:15+06:00", type: "major", summary: "First.", added: ["One version"], tag: "mac-v1.0.00", commit: "3832da01" };
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
  const notes = { summary: "A fix.", fixed: ["A fix"], released: "2026-10-24T09:00:00+06:00" };
  const state = () => [at("version.json"), at("CHANGELOG.json"), at("CHANGELOG.md"), ...files.map(at)];

  test("a release writes the version into every app, the build goes up by one, and the changelog has it", () => {
    const r = v.release("patch", { root, ...notes });
    expect(r).toMatchObject({ version: "1.0.01", build: 5, type: "patch", released: notes.released, summary: "A fix.", fixed: ["A fix"], tag: "v1.0.01" });
    expect(r.changed).toEqual(["version.json", ...files, "CHANGELOG.json", "CHANGELOG.md"]);
    expect(v.readVersion(root)).toEqual({ version: "1.0.01", build: 5 });
    expect(v.getCurrentVersion(root)).toBe("1.0.01");
    expect(v.getReleaseHistory(root)).toEqual([{ version: "1.0.01", build: 5, released: notes.released, type: "patch", summary: "A fix.", fixed: ["A fix"], tag: "v1.0.01" }, first]);
    expect(at("CHANGELOG.md")).toContain("## Version 1.0.01: Small update\n\nReleased 2026-10-24 09:00:00+06:00 (build 5, tag v1.0.01)\n\nA fix.\n\n### Fixed\n\n- A fix");
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

  test("each kind does exactly what was asked, and history only grows", () => {
    for (let i = 0; i < 9; i++) v.release("patch", { root, ...notes });
    expect(v.getCurrentVersion(root)).toBe("1.0.09");
    expect(v.release("small", { root, ...notes }).version).toBe("1.0.10");
    expect(v.release("update", { root, ...notes }).version).toBe("1.1.10");
    expect(v.release("big", { root, ...notes }).version).toBe("1.2.10");
    expect(v.release("major", { root, ...notes, authorizeMajor: "2.0.00" }).version).toBe("2.0.00");
    const history = v.getReleaseHistory(root);
    expect(history.map((r: { version: string }) => r.version)).toEqual(["2.0.00", "1.2.10", "1.1.10", "1.0.10", "1.0.09", "1.0.08", "1.0.07", "1.0.06", "1.0.05", "1.0.04", "1.0.03", "1.0.02", "1.0.01", "1.0.00"]);
    expect(history.at(-1)).toEqual(first);
    expect(v.bumpBuild({ root })).toMatchObject({ version: "2.0.00", build: 18 });
    expect(v.setBuild(20, { root })).toMatchObject({ version: "2.0.00", build: 20 });
    expect(() => v.setBuild(20, { root })).toThrow(/above 20/);
    expect(v.getReleaseHistory(root)[0]).toMatchObject({ version: "2.0.00", build: 20 });
    expect(v.problems(root)).toEqual([]);
  });

  test("a Major release only with the owner's confirmation of the version it gives", () => {
    const before = state();
    expect(() => v.release("major", { root, ...notes })).toThrow(/--authorize-major 2\.0\.00/);
    expect(() => v.release("major", { root, ...notes, authorizeMajor: "3.0.00" })).toThrow(/--authorize-major 2\.0\.00/);
    expect(() => v.release("major", { root, ...notes, authorizeMajor: true })).toThrow(/--authorize-major/);
    expect(() => v.release("patch", { root, ...notes, authorizeMajor: "2.0.00" })).toThrow(/only for a Major release/);
    expect(() => v.release("update", { root, ...notes, authorizeMajor: "2.0.00" })).toThrow(/only for a Major release/);
    expect(state()).toEqual(before);
  });

  test("a release needs a summary and what changed, and isn't dated before the last; refused ones write nothing", () => {
    const before = state();
    expect(() => v.release("patch", { root, ...notes, summary: " " })).toThrow(/summary/);
    expect(() => v.release("patch", { root, summary: "x", fixed: ["  "] })).toThrow(/what changed/);
    expect(() => v.release("patch", { root, ...notes, released: "2026-10-22T09:00:00+06:00" })).toThrow(/on or after/);
    expect(() => v.release("patch", { root, ...notes, released: "2026-10-30" })).toThrow(/with its zone/);
    expect(() => v.release("huge", { root, ...notes })).toThrow(/major, update or patch/);
    expect(state()).toEqual(before);
    expect(v.planRelease("patch", { root, ...notes }).release).toMatchObject({ version: "1.0.01", build: 5 });
    expect(state()).toEqual(before);
  });

  test("a release that fails halfway leaves every file as it was", () => {
    const before = state();
    // A project with no version to set fails before anything is written.
    writeFileSync(join(root, "apps/mac/project.yml"), "name: Folevi\n");
    const broken = state();
    expect(() => v.release("patch", { root, ...notes })).toThrow(/MARKETING_VERSION/);
    expect(state()).toEqual(broken);
    writeFileSync(join(root, "apps/mac/project.yml"), before[3]!);
    // A move that fails after others succeeded puts the moved ones back.
    const target = join(root, "CHANGELOG.md");
    rmSync(target);
    mkdirSync(join(target, "blocker"), { recursive: true });
    expect(() => v.release("patch", { root, ...notes })).toThrow();
    rmSync(target, { recursive: true });
    writeFileSync(target, before[2]!);
    expect(state()).toEqual(before);
    expect(readdirSync(root).filter((f) => f.endsWith(".version-tmp"))).toEqual([]);
  });

  test("a version changed without a release is caught, and nothing can be released until it's fixed", () => {
    v.writeVersion(root, { version: "1.0.01", build: 5 });
    expect(v.problems(root)).toEqual([expect.stringMatching(/newest release in CHANGELOG\.json is 1\.0\.00/)]);
    expect(() => v.release("patch", { root, ...notes })).toThrow(/Fix the changelog first/);
  });

  test("a project edited by hand shows up as out of step", () => {
    writeFileSync(join(root, "apps/mac/project.yml"), at("apps/mac/project.yml").replace(/MARKETING_VERSION: .*/, "MARKETING_VERSION: 2.0.0"));
    expect(v.outOfSync(root)).toEqual(["apps/mac/project.yml"]);
    expect(v.problems(root)).toEqual([expect.stringMatching(/apps\/mac\/project\.yml/)]);
  });

  test("the changelog's own checks", () => {
    const next = { version: "1.0.01", build: 5, released: "2026-10-24T09:00:00+06:00", type: "patch", summary: "x", fixed: ["x"] };
    expect(v.changelogProblems([next, first], { version: "1.0.01", build: 5 })).toEqual([]);
    expect(v.changelogProblems([first, next])).toEqual([expect.stringMatching(/isn't newer/), expect.stringMatching(/build 4 isn't above/), expect.stringMatching(/dated before/)]);
    expect(v.changelogProblems([next, next])).toEqual(expect.arrayContaining([expect.stringMatching(/there twice/)]));
    expect(v.changelogProblems([{ ...next, version: "1.0.02" }, first])).toEqual([expect.stringMatching(/Small update after 1\.0\.00 is 1\.0\.01, not 1\.0\.02/)]);
    expect(v.changelogProblems([{ ...next, version: "1.1.00", type: "patch" }, first])).toEqual([expect.stringMatching(/Small update after 1\.0\.00 is 1\.0\.01/)]);
    expect(v.changelogProblems([{ ...next, version: "2.0.00", type: "update" }, first])).toEqual([expect.stringMatching(/never changes MAJOR/)]);
    expect(v.changelogProblems([{ ...next, version: "3.0.00", type: "major" }, first])).toEqual([expect.stringMatching(/Major release after 1\.0\.00 is 2\.0\.00/)]);
    // A Big update keeps PATCH; before 2026-10-29 it set PATCH to 00, which stays valid history.
    const at5 = { ...next, version: "1.0.05" };
    expect(v.changelogProblems([{ ...next, version: "1.1.05", type: "update", build: 6 }, at5])).toEqual([]);
    expect(v.changelogProblems([{ ...next, version: "1.1.00", type: "update", build: 6 }, at5])).toEqual([]);
    expect(v.changelogProblems([{ ...next, version: "1.1.03", type: "update", build: 6 }, at5])).toEqual([expect.stringMatching(/Big update after 1\.0\.05 is 1\.1\.05/)]);
    expect(v.changelogProblems([{ ...next, type: "small" }, first])).toEqual([expect.stringMatching(/type is major, update or patch/)]);
    expect(v.changelogProblems([{ ...next, summary: "" }, first])).toEqual([expect.stringMatching(/no summary/)]);
    expect(v.changelogProblems([{ ...next, fixed: [] }, first])).toEqual([expect.stringMatching(/nothing added, improved, fixed or broken/)]);
    expect(v.changelogProblems([{ ...next, released: "2026-10-24" }, first])).toEqual([expect.stringMatching(/with its zone/)]);
    expect(v.changelogProblems([{ ...next, version: "1.0.1" }])).toEqual([expect.stringMatching(/not a version/)]);
  });
});

describe("the repository", () => {
  test("version.json holds a version in the format, every project says it, and the changelog's newest release is it", () => {
    const info = v.readVersion();
    expect(v.validateVersion(info.version)).toBe(true);
    expect(Number.isInteger(info.build)).toBe(true);
    expect(v.problems()).toEqual([]);
    expect(v.getReleaseHistory()[0]).toMatchObject(info);
  });

  test("the release history from 1.0.00 is kept, with its commits and tags", () => {
    const releases = v.getReleaseHistory();
    const versions = releases.map((r: { version: string }) => r.version);
    for (const shipped of ["1.0.00", "1.0.01", "1.0.02", "1.0.03", "1.0.04", "1.0.05", "1.1.00", "1.1.01", "1.1.02", "1.1.03", "1.1.04"]) expect(versions).toContain(shipped);
    expect(releases.at(-1)).toMatchObject({ version: "1.0.00", build: 4, released: "2026-10-23T06:50:15+06:00", type: "major", tag: "mac-v1.0.00", commit: "3832da01" });
    expect(releases.find((r: { version: string }) => r.version === "1.1.00")).toMatchObject({ build: 10, type: "update", tag: "mac-v1.1.00", commit: "fd5390b7" });
    expect(releases.find((r: { version: string }) => r.version === "1.1.04")).toMatchObject({ build: 14, type: "patch", released: "2026-10-29T06:18:23+06:00" });
    expect(JSON.stringify(releases)).not.toMatch(/—/);
  });

  test("only scripts/version.mjs writes the version: no other script, hook or workflow touches version.json", () => {
    const writers = ["apps/mac/scripts/release.mjs", "apps/mac/scripts/publish.mjs", "apps/ios/scripts/release.mjs", "apps/web/scripts/build-shell.mjs", ".github/workflows/ci.yml"];
    for (const f of writers) {
      expect(read(f)).not.toMatch(/writeFileSync\([^)]*version\.json/);
      expect(read(f)).not.toMatch(/\b(writeVersion|writeFiles|release|bumpBuild)\(/);
      expect(read(f)).not.toMatch(/["'`]scripts\/version\.mjs["'`],\s*["'`](release|bump|build)/);
    }
    expect(() => read(".husky/pre-commit")).toThrow();
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
