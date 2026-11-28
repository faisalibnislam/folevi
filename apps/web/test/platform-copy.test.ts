// The Android, Windows and Linux apps are paused (owner, 2026-11-28): the website offers the Mac app, the iPhone
// and iPad app, the web app and Folevi Server, and says the paused apps are coming soon. This test keeps download
// links, store links and "free on Windows" lines for the paused apps from coming back, and checks that the home
// page title, the site description, the share image and the footer name only what you can get today.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";

const SRC = join(__dirname, "../src");

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files(path, out);
    else if (/\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

const WEBSITE = [...files(join(SRC, "app/(marketing)")), ...files(join(SRC, "components/marketing"))];

/** The paused apps' download constants and store links: no page may use them (site.ts keeps them for later). */
const PAUSED_LINKS = [/\b(ANDROID_DOWNLOAD_URL|WINDOWS_DOWNLOAD_(ARM64|X64)_URL|LINUX_DOWNLOADS|LINUX_CHECKSUMS_URL)\b/, /<(WindowsDownload|LinuxDownload)\b/, /play\.google\.com/, /download\/(android|windows|linux)\//];
/** Lines that offer the paused apps as if they were out. */
const STALE = [/Download for (Android|Windows|Linux)/i, /Linux \(Beta\)/, /Windows, Linux(,| and) iPhone/, /(iPhone|iPad),? (iPad )?and Android/];
/** Files allowed: where the links are defined, the paused download buttons, past releases, and the terms (which
 *  cover the apps people already have and promise no download). */
const ALLOWED = /(components\/marketing\/(site\.ts|WindowsDownload\.tsx|LinuxDownload\.tsx|content\/(changelog\.ts|blog\.tsx))|app\/\(marketing\)\/terms\/page\.tsx)$/;

describe("platform copy on the website", () => {
  test("no page links to or offers the paused Android, Windows and Linux apps", () => {
    const hits: string[] = [];
    for (const file of WEBSITE) {
      if (ALLOWED.test(file)) continue;
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if ([...PAUSED_LINKS, ...STALE].some((re) => re.test(line))) hits.push(`${relative(SRC, file)}:${i + 1}`);
        });
    }
    expect(hits).toEqual([]);
  });

  test.each([
    ["home page title", "app/(marketing)/page.tsx", /title: "Folevi: [^"]*"/],
    ["site description", "app/layout.tsx", /"Folevi is a digital workspace for [^"]*"/],
    ["share image", "app/opengraph-image.tsx", /On the web, [^\n<]*/],
    ["footer", "components/marketing/SiteFooter.tsx", /A digital workspace for [^\n<]*/],
  ])("the %s names Mac, iPhone and iPad and none of the paused apps", (_, path, pattern) => {
    const text = readFileSync(join(SRC, path), "utf8").match(pattern)?.[0] ?? "";
    for (const platform of ["Mac", "iPhone", "iPad"]) expect(text).toContain(platform);
    for (const platform of ["Windows", "Linux", "Android"]) expect(text).not.toContain(platform);
  });
});
