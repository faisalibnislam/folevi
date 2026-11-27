// Space Cherries LLC operates Folevi (the owner, 2026-11-27). The website keeps the company's details once, in
// apps/web/src/components/marketing/site.ts (OPERATOR). The Swift apps, the emails and the package metadata can't
// import that file, so they hold their own copy; this test fails if any copy drifts from the website's, if the street
// address leaks out of the legal places, or if an identifier that makes a shipped app the same app changed.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const ROOT = join(__dirname, "..", "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const site = read("apps/web/src/components/marketing/site.ts");
const field = (key: string) => site.match(new RegExp(`\\b${key}: "([^"]+)"`))?.[1];
const NAME = field("name")!;
const URL_ = field("url")!;
const ADDRESS = `${field("street")}, ${field("city")}, ${field("region")} ${field("postalCode")}, ${field("country")}`;
const COPYRIGHT = `© 2026 ${NAME}`;

describe("Folevi's operator, everywhere outside the website", () => {
  test("the website's source is Space Cherries LLC", () => {
    expect(NAME).toBe("Space Cherries LLC");
    expect(URL_).toBe("https://www.spacecherries.com");
    expect(ADDRESS).toBe("5242 Elbetee Lane, Alexandria, VA 22312, USA");
  });

  test("the emails' copy matches", () => {
    const email = read("packages/email/src/operator.ts");
    expect(email).toContain(`name: "${NAME}"`);
    expect(email).toContain(`url: "${URL_}"`);
    expect(email).toContain(`address: "${ADDRESS}"`);
  });

  test("the Mac and iPhone apps' copy matches", () => {
    const swift = read("apps/native-kit/Sources/FoleviDesign/Operator.swift");
    expect(swift).toContain(`name = "${NAME}"`);
    expect(swift).toContain(`URL(string: "${URL_}")`);
    expect(swift).toContain(`address = "${ADDRESS}"`);
    expect(swift).toContain('copyright = "© 2026 \\(name)"');
  });

  test.each(["apps/mac/Folevi/Resources/Info.plist", "apps/ios/ios/App/App/Info.plist"])("%s carries the copyright line", (path) => {
    expect(read(path)).toMatch(new RegExp(`<key>NSHumanReadableCopyright</key>\\s*<string>${COPYRIGHT}</string>`));
  });

  test("Windows and Linux name the company as publisher, with the copyright line, and keep their identifiers", () => {
    const windows = JSON.parse(read("apps/desktop/src-tauri/tauri.conf.json"));
    expect(windows.bundle.publisher).toBe(NAME);
    expect(windows.bundle.copyright).toBe(COPYRIGHT);
    expect(windows.identifier).toBe("com.folevi.desktop");
    expect(windows.productName).toBe("Folevi");
    const linux = JSON.parse(read("apps/desktop/src-tauri/tauri.linux.conf.json"));
    expect(linux.bundle.publisher).toBe(NAME);
    // ASCII in deb and rpm metadata.
    expect(linux.bundle.copyright).toBe(`Copyright 2026 ${NAME}`);
    expect(linux.identifier).toBe("com.folevi.Folevi");
    expect(read("apps/desktop/src-tauri/Cargo.toml")).toContain(`authors = ["${NAME}"]`);
  });

  test("Linux listings name it, and the Beta tag stays", () => {
    const metainfo = read("packaging/linux/com.folevi.Folevi.metainfo.xml");
    expect(metainfo).toContain('<id>com.folevi.Folevi</id>');
    expect(metainfo).toMatch(new RegExp(`<developer id="com.folevi">\\s*<name>${NAME}</name>`));
    expect(metainfo).toContain(`Folevi is operated by ${NAME} (${URL_}).`);
    expect(metainfo).toContain("(Beta)");
    const snap = read("packaging/linux/snap/snapcraft.yaml");
    expect(snap).toContain("name: folevi\n");
    expect(snap).toContain(`Folevi is operated by ${NAME} (${URL_}).`);
    expect(snap).toContain("(Beta)");
  });

  test.each([
    ["packaging/linux/nfpm.yaml", `vendor: ${NAME}`],
    ["packaging/lib/common.sh", `FOLEVI_MAINTAINER="${NAME}"`],
    ["packaging/docker/Dockerfile", `org.opencontainers.image.vendor="${NAME}"`],
    ["packaging/synology/INFO.in", `distributor="${NAME}"`],
    ["packaging/qnap/qpkg.cfg.in", `QPKG_AUTHOR="${NAME}"`],
    ["packaging/terramaster/manifest.json.in", `"author": "${NAME}"`],
    ["packaging/ugreen/manifest.json.in", `"developer": "${NAME}"`],
    ["packaging/asustor/CONTROL/config.json.in", `"developer": "${NAME}"`],
    ["packaging/unraid/folevi.plg.in", `<!ENTITY author    "${NAME}">`],
    ["packaging/catalogs/runtipi/folevi/config.json", `"author": "${NAME}"`],
    ["packaging/catalogs/umbrel/folevi/umbrel-app.yml", `developer: ${NAME}`],
    ["packaging/catalogs/casaos/Folevi/docker-compose.yml", `developer: ${NAME}`],
    ["packaging/catalogs/truenas/folevi/app.yaml", `name: ${NAME}`],
    ["apps/clipper/manifest.json", `"author": "${NAME}"`],
    ["apps/clipper/STORE.md", `Folevi is operated by ${NAME} (${URL_}).`],
  ])("%s names it", (path, line) => {
    expect(read(path)).toContain(line);
  });

  test("the street address only appears in the legal places", () => {
    // Listings, installers, sign-up and Folevi Server's pages get the name and link only.
    for (const path of [
      "apps/desktop/src-tauri/tauri.conf.json",
      "apps/desktop/src-tauri/tauri.linux.conf.json",
      "packaging/linux/com.folevi.Folevi.metainfo.xml",
      "packaging/linux/snap/snapcraft.yaml",
      "packaging/linux/nfpm.yaml",
      "apps/clipper/manifest.json",
      "apps/clipper/STORE.md",
      "apps/web/src/components/auth/SignUpForm.tsx",
      "apps/web/src/components/server/MadeBy.tsx",
      "apps/native-kit/Sources/FoleviScreens/Auth/SignInScreens.swift",
    ]) {
      const text = read(path);
      expect(text, path).not.toContain("Elbetee");
      expect(text, path).not.toContain("OPERATOR_ADDRESS");
      expect(text, path).not.toContain("FoleviOperator.address");
    }
  });
});
