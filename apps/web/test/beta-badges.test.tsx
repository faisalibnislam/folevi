import { afterEach, describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BETA_FEEDBACK_URL, BETA_NOTE, isLinuxApp } from "@/lib/beta";
import { BetaBadge, BetaNote } from "@/components/ui/Beta";
import { BetaNote as SiteBetaNote } from "@/components/marketing/Beta";
import { AboutSection } from "@/components/views/settings/AboutSection";

// Folevi for Linux and Folevi Server carry a Beta badge with one note and one feedback link (owner, 2026-11-26).
// Windows, which runs the same Tauri app, must not show it.
const w = window as { __foleviTestShell?: unknown };

afterEach(() => {
  delete w.__foleviTestShell;
});

describe("Beta badges", () => {
  test("the note has no em dash and links to support", () => {
    expect(BETA_NOTE).toBe("Beta: works, but expect rough edges.");
    expect(BETA_NOTE).not.toContain("—");
    for (const html of [renderToStaticMarkup(<BetaNote badge />), renderToStaticMarkup(<SiteBetaNote badge />)]) {
      expect(html).toContain(BETA_NOTE);
      expect(html).toContain(`href="${BETA_FEEDBACK_URL}"`);
      expect(html).toContain(">Beta<");
      expect(html).toContain("Send feedback");
    }
    expect(renderToStaticMarkup(<BetaBadge />)).toContain(">Beta<");
  });

  test("only the Linux app counts as Linux", () => {
    expect(isLinuxApp()).toBe(false);
    w.__foleviTestShell = { platform: "windows" };
    expect(isLinuxApp()).toBe(false);
    w.__foleviTestShell = { platform: "linux" };
    expect(isLinuxApp()).toBe(true);
  });

  test("Settings > About shows Beta in the Linux app, not on Windows or the web", () => {
    expect(renderToStaticMarkup(<AboutSection />)).not.toContain(BETA_NOTE);
    w.__foleviTestShell = { platform: "windows" };
    expect(renderToStaticMarkup(<AboutSection />)).not.toContain(BETA_NOTE);
    w.__foleviTestShell = { platform: "linux" };
    const html = renderToStaticMarkup(<AboutSection />);
    expect(html).toContain(BETA_NOTE);
    expect(html).toContain(">Beta<");
  });
});
