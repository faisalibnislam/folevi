import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import WindowsPage from "@/app/(marketing)/windows/page";
import LinuxPage from "@/app/(marketing)/linux/page";
import { BETA_NOTE } from "@/lib/beta";
import { LINUX_CHECKSUMS_URL, LINUX_DOWNLOADS, MARKETING_ROUTES, WINDOWS_DOWNLOAD_ARM64_URL, WINDOWS_DOWNLOAD_X64_URL } from "@/components/marketing/site";

// The /windows and /linux pages (owner, 2026-11-27): the right downloads, Beta on Linux only (lib/beta.ts), the
// SmartScreen note while the Windows installers are unsigned, never a build number and never an em or en dash.
const windows = renderToStaticMarkup(<WindowsPage />);
const linux = renderToStaticMarkup(<LinuxPage />);
const text = (html: string) => html.replace(/<[^>]+>/g, " ");

describe("the Windows and Linux pages", () => {
  test("Windows links both installers and no Linux package", () => {
    expect(windows).toContain(`href="${WINDOWS_DOWNLOAD_X64_URL}"`);
    expect(windows).toContain(`href="${WINDOWS_DOWNLOAD_ARM64_URL}"`);
    expect(windows).not.toContain("/download/linux/");
  });

  test("Linux links every package and the checksums, and no Windows installer", () => {
    for (const format of Object.values(LINUX_DOWNLOADS)) for (const href of Object.values(format)) expect(linux).toContain(`href="${href}"`);
    expect(linux).toContain(`href="${LINUX_CHECKSUMS_URL}"`);
    expect(linux).not.toContain("/download/windows/");
  });

  test("Beta on Linux, not on Windows", () => {
    expect(linux).toContain(">Beta<");
    expect(linux).toContain(BETA_NOTE);
    expect(windows).not.toContain(">Beta<");
    expect(windows).not.toContain(BETA_NOTE);
  });

  test("Windows says SmartScreen asks first", () => {
    expect(text(windows)).toContain("SmartScreen");
    expect(text(windows)).toContain("More info, then Run anyway");
  });

  test("no build numbers, no em or en dashes, no store links for the phones", () => {
    for (const html of [windows, linux]) {
      expect(html).not.toMatch(/[–—]/);
      expect(text(html)).not.toMatch(/\bbuild\s*\d/i);
      expect(text(html)).not.toMatch(/\b\d+\.\d+\.\d+\b/);
      expect(html).not.toContain("apps.apple.com");
      expect(html).not.toContain("play.google.com");
    }
  });

  test("both are in the sitemap", () => {
    const paths = MARKETING_ROUTES.map((route) => route.path as string);
    expect(paths).toContain("/windows");
    expect(paths).toContain("/linux");
  });
});
