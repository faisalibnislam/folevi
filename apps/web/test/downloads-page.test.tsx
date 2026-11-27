// /downloads: every platform has its real mark and a place in the bottom bar, the Mac, Windows and Linux rows
// link to real files, and Folevi Server's rows come from its release manifest ("Coming soon" without one, never a
// dead link). Linux and Folevi Server keep their Beta badges (lib/beta.ts).
import { afterEach, describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import DownloadsPage from "@/app/(marketing)/downloads/page";
import { DownloadsBar } from "@/components/marketing/DownloadsBar";
import { LINUX_DOWNLOADS, MAC_DOWNLOAD_URL, WINDOWS_DOWNLOAD_ARM64_URL, WINDOWS_DOWNLOAD_X64_URL } from "@/components/marketing/site";

const PLATFORM_IDS = ["mac", "windows", "linux", "iphone-ipad", "android", "web", "server"];

function serve(body: unknown, ok = true) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok, status: ok ? 200 : 404, json: async () => body }) as Response));
}

async function render(): Promise<string> {
  return renderToStaticMarkup(await DownloadsPage());
}

afterEach(() => vi.unstubAllGlobals());

describe("/downloads", () => {
  test("every platform has a section with its mark and a link in the bottom bar", async () => {
    serve(null, false);
    const html = await render();
    for (const id of PLATFORM_IDS) {
      expect(html).toContain(`id="${id}"`);
      expect(html).toContain(`href="#${id}"`);
    }
    expect(html).toContain('aria-label="Platforms"');
    // One mark per section heading plus one per bar link.
    expect(html.match(/<svg/g)?.length ?? 0).toBeGreaterThanOrEqual(PLATFORM_IDS.length * 2);
  });

  test("the Mac, Windows and Linux rows link to the real files", async () => {
    serve(null, false);
    const html = await render();
    for (const url of [MAC_DOWNLOAD_URL, WINDOWS_DOWNLOAD_X64_URL, WINDOWS_DOWNLOAD_ARM64_URL, LINUX_DOWNLOADS.appimage.x64, LINUX_DOWNLOADS.deb.arm64, LINUX_DOWNLOADS.rpm.x64]) {
      expect(html).toContain(`href="${url}"`);
    }
  });

  test("with no server release, Folevi Server says Coming soon and links to no package", async () => {
    serve(null, false);
    const html = await render();
    const server = html.slice(html.indexOf('id="server"'));
    expect(server).toContain("Coming soon");
    expect(server).not.toContain("/download/server/");
  });

  test("with a server release, each package gets a button per kind of PC", async () => {
    serve({
      version: "0.1.0",
      releasedAt: "2026-11-27T10:00:00Z",
      files: [
        { platform: "synology", arch: "x86_64", name: "folevi-x86_64.spk", url: "https://folevi.com/download/server/folevi-x86_64.spk", sha256: "a".repeat(64), sizeBytes: 80 * 1024 ** 2 },
        { platform: "synology", arch: "aarch64", name: "folevi-aarch64.spk", url: "https://folevi.com/download/server/folevi-aarch64.spk", sha256: "b".repeat(64), sizeBytes: 78 * 1024 ** 2 },
        { platform: "deb", arch: "x86_64", name: "folevi-server_amd64.deb", url: "https://folevi.com/download/server/folevi-server_amd64.deb", sha256: "c".repeat(64), sizeBytes: 70 * 1024 ** 2 },
      ],
    });
    const html = await render();
    expect(html).toContain('href="https://folevi.com/download/server/folevi-x86_64.spk"');
    expect(html).toContain('href="https://folevi.com/download/server/folevi-aarch64.spk"');
    expect(html).toContain('href="https://folevi.com/download/server/folevi-server_amd64.deb"');
    expect(html).toContain("Version 0.1.0");
    expect(html).not.toContain("The first beta is almost ready");
  });

  test("Linux and Folevi Server keep their Beta badges", async () => {
    serve(null, false);
    const html = await render();
    for (const id of ["linux", "server"]) {
      const heading = html.slice(html.indexOf(`id="${id}-title"`), html.indexOf("</h2>", html.indexOf(`id="${id}-title"`)));
      expect(heading).toContain("Beta");
    }
  });

  test("the bar says Beta to screen readers and marks nothing current before scrolling", () => {
    const html = renderToStaticMarkup(
      <DownloadsBar items={[{ id: "linux", title: "Linux", mark: "linux", beta: true }, { id: "mac", title: "Mac", mark: "apple" }]} />,
    );
    expect(html).toContain("(Beta)");
    expect(html).not.toContain("aria-current");
  });
});
