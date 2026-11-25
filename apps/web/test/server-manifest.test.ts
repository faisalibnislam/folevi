import { describe, expect, test } from "vitest";
import { fetchServerManifest, formatSize, installCommand, parseServerManifest, safeFoleviUrl, serverFile } from "@/components/marketing/server/manifest";

// The /server page takes every download from Folevi Server's release manifest, checked field by field. Whatever
// is missing or fails a check shows as "Coming soon" (serverFile returns null), never as a link.
const SHA = "a".repeat(64);
const file = (platform: string, arch: string, extra: Record<string, unknown> = {}) => ({
  platform,
  arch,
  name: `folevi-server-1.0.0-${platform}-${arch}`,
  url: `https://folevi.com/download/server/1.0.0/${platform}-${arch}`,
  sha256: SHA,
  sizeBytes: 300 * 1024 * 1024,
  ...extra,
});
const sample = {
  version: "1.0.0-beta.1",
  releasedAt: "2026-11-25T10:00:00Z",
  channel: "beta",
  notesUrl: "https://folevi.com/changelog",
  baseUrl: "https://folevi.com/download/server/1.0.0/",
  files: [file("synology", "x86_64"), file("qnap", "aarch64"), file("deb", "x86_64")],
  unraidPluginUrl: "https://folevi.com/download/server/unraid/folevi.plg",
  installScript: "https://get.folevi.com/server",
  dockerImage: "ghcr.io/folevi/server:1.0.0-beta.1",
};

describe("parseServerManifest", () => {
  test("a good manifest keeps its version, files and addresses", () => {
    const m = parseServerManifest(sample)!;
    expect(m.version).toBe("1.0.0-beta.1");
    expect(m.files).toHaveLength(3);
    expect(serverFile(m, "synology", "x86_64")?.url).toBe("https://folevi.com/download/server/1.0.0/synology-x86_64");
    expect(m.unraidPluginUrl).toBe("https://folevi.com/download/server/unraid/folevi.plg");
    expect(installCommand(m)).toBe("curl -fsSL https://get.folevi.com/server | sh");
    expect(m.dockerImage).toBe("ghcr.io/folevi/server:1.0.0-beta.1");
  });

  test("no manifest, or one without a usable version, is null: everything is Coming soon", () => {
    for (const bad of [null, undefined, "nope", [], {}, { version: "" }, { version: "<script>" }, { ...sample, version: 3 }]) {
      expect(parseServerManifest(bad)).toBeNull();
    }
    expect(serverFile(null, "synology", "x86_64")).toBeNull();
    expect(installCommand(null)).toBeNull();
  });

  test("a platform or chip with no file is Coming soon", () => {
    const m = parseServerManifest(sample)!;
    expect(serverFile(m, "synology", "aarch64")).toBeNull();
    expect(serverFile(m, "asustor", "x86_64")).toBeNull();
    expect(parseServerManifest({ ...sample, files: "x" })!.files).toEqual([]);
  });

  test("files that fail a check are left out, the rest kept", () => {
    const m = parseServerManifest({
      ...sample,
      files: [
        file("synology", "x86_64", { url: "http://folevi.com/download/a.spk" }),
        file("synology", "aarch64", { url: "https://evil.example/folevi.spk" }),
        file("qnap", "x86_64", { url: "https://folevi.com.evil.example/a.qpkg" }),
        file("qnap", "aarch64", { sha256: "abc" }),
        file("asustor", "x86_64", { sizeBytes: -1 }),
        file("windows", "x86_64"),
        file("deb", "armv7"),
        file("rpm", "x86_64", { name: "" }),
        file("ugreen", "x86_64"),
        file("ugreen", "x86_64", { url: "https://folevi.com/second" }),
      ],
    })!;
    expect(m.files.map((f) => `${f.platform}/${f.arch}`)).toEqual(["ugreen/x86_64"]);
    expect(serverFile(m, "ugreen", "x86_64")?.url).toBe("https://folevi.com/download/server/1.0.0/ugreen-x86_64");
  });

  test("addresses outside https folevi.com are dropped", () => {
    const m = parseServerManifest({
      ...sample,
      notesUrl: "javascript:alert(1)",
      unraidPluginUrl: "https://user:pw@folevi.com/x.plg",
      installScript: "https://get.folevi.com:8443/server",
      dockerImage: "ghcr.io/folevi/server; rm -rf /",
    })!;
    expect(m.notesUrl).toBeNull();
    expect(m.unraidPluginUrl).toBeNull();
    expect(installCommand(m)).toBeNull();
    expect(m.dockerImage).toBeNull();
    expect(safeFoleviUrl("https://download.folevi.com/a")).toBe("https://download.folevi.com/a");
    expect(safeFoleviUrl("https://notfolevi.com/a")).toBeNull();
  });
});

describe("fetchServerManifest", () => {
  test("a failed or slow fetch gives null instead of an error", async () => {
    expect(await fetchServerManifest((async () => new Response("", { status: 404 })) as typeof fetch)).toBeNull();
    expect(await fetchServerManifest((async () => { throw new Error("timeout"); }) as typeof fetch)).toBeNull();
    expect(await fetchServerManifest((async () => new Response("not json")) as typeof fetch)).toBeNull();
    expect((await fetchServerManifest((async () => Response.json(sample)) as typeof fetch))?.version).toBe("1.0.0-beta.1");
  });
});

test("formatSize", () => {
  expect(formatSize(300 * 1024 * 1024)).toBe("300 MB");
  expect(formatSize(1.5 * 1024 ** 3)).toBe("1.5 GB");
  expect(formatSize(2048)).toBe("2 KB");
});
