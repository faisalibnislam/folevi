// /downloads: every platform has its real mark and a place in the bottom bar, the Mac row links to the real file,
// and Folevi Server's rows come from its release manifest ("Coming soon" without one, never a dead link). The
// paused Android, Windows and Linux apps (owner, 2026-11-28) come last, each "Coming soon" with no download.
// Folevi Server keeps its Early Beta badge (lib/beta.ts); the Linux app has none now.
import { afterEach, describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import DownloadsPage from "@/app/(marketing)/downloads/page";
import { DownloadsBar } from "@/components/marketing/DownloadsBar";
import { ANDROID_DOWNLOAD_URL, APP_STORE_URL, LINUX_CHECKSUMS_URL, LINUX_DOWNLOADS, MAC_DOWNLOAD_URL, WINDOWS_DOWNLOAD_ARM64_URL, WINDOWS_DOWNLOAD_X64_URL } from "@/components/marketing/site";

const PLATFORM_IDS = ["mac", "iphone-ipad", "web", "server", "windows", "linux", "android"];
const PAUSED = ["windows", "linux", "android"];

/** The section with this id, up to the next section. */
function section(html: string, id: string): string {
  const start = html.indexOf(`id="${id}"`);
  const ends = ["<section", "<nav"].map((tag) => html.indexOf(tag, start + 1)).filter((i) => i !== -1);
  return html.slice(start, ends.length ? Math.min(...ends) : undefined);
}

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

  test("the available platforms come first, the paused ones last", async () => {
    serve(null, false);
    const html = await render();
    const order = PLATFORM_IDS.map((id) => html.indexOf(`id="${id}"`));
    expect([...order].sort((x, y) => x - y)).toEqual(order);
  });

  test("Android, Windows and Linux say Coming soon and link to no file", async () => {
    serve(null, false);
    const html = await render();
    for (const id of PAUSED) {
      const part = section(html, id);
      expect(part).toContain("Coming soon");
      expect(part).not.toContain("<a ");
    }
    const all = [ANDROID_DOWNLOAD_URL, WINDOWS_DOWNLOAD_X64_URL, WINDOWS_DOWNLOAD_ARM64_URL, LINUX_CHECKSUMS_URL, ...Object.values(LINUX_DOWNLOADS).flatMap((f) => Object.values(f))];
    for (const url of all) expect(html).not.toContain(url);
    expect(html).not.toContain("play.google.com");
  });

  test("the Mac and iPhone and iPad rows link to the real download and the App Store", async () => {
    serve(null, false);
    const html = await render();
    expect(section(html, "mac")).toContain(`href="${MAC_DOWNLOAD_URL}"`);
    expect(section(html, "iphone-ipad")).toContain(`href="${APP_STORE_URL}"`);
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

  test("Folevi Server keeps its Early Beta badge; the paused Linux app has none", async () => {
    serve(null, false);
    const html = await render();
    const heading = (id: string) => html.slice(html.indexOf(`id="${id}-title"`), html.indexOf("</h2>", html.indexOf(`id="${id}-title"`)));
    expect(heading("server")).toContain("Early Beta");
    expect(heading("linux")).not.toContain("Beta");
  });

  test("the bar says Early Beta to screen readers and marks nothing current before scrolling", () => {
    const html = renderToStaticMarkup(
      <DownloadsBar items={[{ id: "server", title: "Folevi Server", mark: "server", beta: true }, { id: "mac", title: "Mac", mark: "apple" }]} />,
    );
    expect(html).toContain("(Early Beta)");
    expect(html).not.toContain("aria-current");
  });
});
