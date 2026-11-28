import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import WindowsPage, { metadata as windowsMetadata } from "@/app/(marketing)/windows/page";
import LinuxPage, { metadata as linuxMetadata } from "@/app/(marketing)/linux/page";
import { BETA_NOTE } from "@/lib/beta";
import { COMING_SOON_NOTE, MARKETING_ROUTES, WEB_APP_URL } from "@/components/marketing/site";

// The /windows and /linux pages while the apps are paused (owner, 2026-11-28): the routes stay, say Coming soon,
// offer no download and no install steps, point to the web app, and stay out of the sitemap and search results.
// The Linux app's Beta tag is gone. Never an em or en dash.
const windows = renderToStaticMarkup(<WindowsPage />);
const linux = renderToStaticMarkup(<LinuxPage />);
const text = (html: string) => html.replace(/<[^>]+>/g, " ");

describe("the Windows and Linux pages", () => {
  test("both say Coming soon and link to no download", () => {
    for (const html of [windows, linux]) {
      expect(html).toContain("Coming soon");
      expect(html).toContain(COMING_SOON_NOTE);
      expect(html).not.toMatch(/\/download\/(windows|linux|android)\//);
      expect(html).not.toContain("SHA256SUMS");
      expect(html).toContain(`href="${WEB_APP_URL}"`);
    }
  });

  test("no install steps for the paused apps", () => {
    expect(text(windows)).not.toContain("SmartScreen");
    expect(text(linux)).not.toMatch(/AppImage|apt|Snap Store/);
  });

  test("Linux points Linux servers to Folevi Server", () => {
    expect(linux).toContain('href="/server#linux"');
  });

  test("no Beta tag on either app page", () => {
    for (const html of [windows, linux]) expect(html).not.toContain(BETA_NOTE);
    expect(linux).not.toContain(">Beta<");
    expect(windows).not.toContain(">Beta<");
  });

  test("no em or en dashes, no store links", () => {
    for (const html of [windows, linux]) {
      expect(html).not.toMatch(/[–—]/);
      expect(html).not.toContain("apps.apple.com");
      expect(html).not.toContain("play.google.com");
    }
  });

  test("both are kept out of search results and the sitemap", () => {
    for (const meta of [windowsMetadata, linuxMetadata]) expect(meta.robots).toEqual({ index: false, follow: true });
    const paths = MARKETING_ROUTES.map((route) => route.path as string);
    expect(paths).not.toContain("/windows");
    expect(paths).not.toContain("/linux");
  });
});
