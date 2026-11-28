// The Android, Windows and Linux apps are paused (owner, 2026-11-28). Folevi Server's setup, admin and join screens
// tell people which apps connect: Mac, iPhone and iPad, with the paused ones as coming soon and no store links.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";
import { COMING_SOON_APPS_NOTE } from "@/lib/platforms";

const SRC = join(__dirname, "../src");

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files(path, out);
    else if (/\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

const SERVER_SCREENS = [...files(join(SRC, "components/server")), ...files(join(SRC, "components/admin/server"))];
const isComment = (line: string) => /^\s*(\/\/|\*|\/\*)/.test(line);

describe("Folevi Server's screens offer only the apps you can get", () => {
  test("no line offers the Android, Windows or Linux app, or Google Play", () => {
    const hits: string[] = [];
    for (const file of SERVER_SCREENS) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (isComment(line)) return;
          if (/Android|Google Play|Windows app|Linux app|download\/(android|windows|linux)/.test(line)) hits.push(`${relative(SRC, file)}:${i + 1}`);
        });
    }
    expect(hits).toEqual([]);
  });

  test("Connect your apps says the paused ones are coming soon", () => {
    expect(COMING_SOON_APPS_NOTE).toBe("Android, Windows and Linux are coming soon.");
    expect(readFileSync(join(SRC, "components/server/ConnectApps.tsx"), "utf8")).toContain("{COMING_SOON_APPS_NOTE}");
  });
});
