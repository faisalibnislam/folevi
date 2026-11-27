// Folevi runs on Mac, Windows, Linux, iPhone, iPad and the web, with Android coming to Google Play (owner,
// 2026-11-26: every platform launches). The website once said there was no Windows, Linux or Android app; this
// test keeps those lines from coming back and checks that the home page title and the site description name
// every platform you can download today.
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

/** Lines that were true before the Windows, Linux and Android apps and aren't now. */
const STALE = [
  /no (Android|Windows|Linux)( or (Android|Windows|Linux))? app/i,
  /Is there an app for Windows or Android/i,
  /Not yet\. On Windows/i,
  /a digital workspace for Mac, iPhone, iPad and web/i,
];

describe("platform copy on the website", () => {
  test("no page says Windows, Linux or Android has no app", () => {
    const hits: string[] = [];
    for (const file of WEBSITE) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (STALE.some((re) => re.test(line))) hits.push(`${relative(SRC, file)}:${i + 1}`);
        });
    }
    expect(hits).toEqual([]);
  });

  test.each([
    ["home page title", "app/(marketing)/page.tsx", /title: "Folevi: [^"]*"/],
    ["site description", "app/layout.tsx", /"Folevi is a notes and writing workspace for [^"]*"/],
    ["share image", "app/opengraph-image.tsx", /On the web, [^\n<]*/],
    ["footer", "components/marketing/SiteFooter.tsx", /A digital workspace for [^\n<]*/],
  ])("the %s names Mac, Windows, Linux, iPhone and iPad", (_, path, pattern) => {
    const text = readFileSync(join(SRC, path), "utf8").match(pattern)?.[0] ?? "";
    for (const platform of ["Mac", "Windows", "Linux", "iPhone", "iPad"]) expect(text).toContain(platform);
  });
});
