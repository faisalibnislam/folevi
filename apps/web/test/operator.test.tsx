// Folevi is operated by Space Cherries LLC (owner, 2026-11-27). The company, its website and its address live
// once in components/marketing/site.ts (OPERATOR) and appear in the footer, the terms, the privacy policy, the
// support page and the home page's Organization data for search engines.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { organizationLd } from "@/components/marketing/seo";
import { OPERATOR, OPERATOR_ADDRESS, OPERATOR_COPYRIGHT } from "@/components/marketing/site";

const SRC = join(__dirname, "../src");
const read = (path: string) => readFileSync(join(SRC, path), "utf8");

describe("the operator, Space Cherries LLC", () => {
  test("is spelled out once, with its address", () => {
    expect(OPERATOR.name).toBe("Space Cherries LLC");
    expect(OPERATOR.url).toBe("https://www.spacecherries.com");
    expect(OPERATOR_ADDRESS).toBe("5242 Elbetee Lane, Alexandria, VA 22312, USA");
  });

  test.each([
    ["footer", "components/marketing/SiteFooter.tsx"],
    ["terms", "app/(marketing)/terms/page.tsx"],
    ["privacy policy", "app/(marketing)/privacy/page.tsx"],
    ["support page", "app/(marketing)/support/page.tsx"],
  ])("the %s names it from site.ts", (_, path) => {
    const source = read(path);
    expect(source).toContain("OPERATOR.name");
    expect(source).toContain("OPERATOR.url");
    // Never typed out by hand, so it can only change in one place.
    expect(source).not.toContain("Space Cherries");
  });

  test("the terms, privacy policy and support page give the postal address", () => {
    for (const path of ["app/(marketing)/terms/page.tsx", "app/(marketing)/privacy/page.tsx", "app/(marketing)/support/page.tsx"]) {
      expect(read(path)).toContain("OPERATOR_ADDRESS");
    }
  });

  test("the apps carry one copyright line", () => {
    expect(OPERATOR_COPYRIGHT).toBe("© 2026 Space Cherries LLC");
  });

  test("Settings > About, next to the terms and privacy links, names it with its address and the copyright", () => {
    const source = read("components/views/settings/AboutSection.tsx");
    for (const name of ["OPERATOR.name", "OPERATOR.url", "OPERATOR_ADDRESS", "OPERATOR_COPYRIGHT"]) expect(source).toContain(name);
    expect(source).not.toContain("Space Cherries");
  });

  test("sign-up says who operates Folevi under the terms line, and only on Folevi Cloud", () => {
    const source = read("components/auth/SignUpForm.tsx");
    expect(source).toMatch(/Folevi is operated by <TextLink href=\{OPERATOR\.url\}>\{OPERATOR\.name\}<\/TextLink>/);
    // The street address stays in the legal places; sign-up has the name and link only.
    expect(source).not.toContain("OPERATOR_ADDRESS");
    expect(source.indexOf("By creating an account")).toBeLessThan(source.indexOf("Folevi is operated by"));
    expect(source).toMatch(/hidden=\{Boolean\(server\)\}>\s*<p>\s*By creating an account/);
  });

  test("search engines see it as the company behind Folevi", () => {
    const parent = organizationLd().parentOrganization as Record<string, unknown>;
    expect(parent).toMatchObject({ "@type": "Organization", name: "Space Cherries LLC", url: "https://www.spacecherries.com" });
    expect(parent.address).toMatchObject({ streetAddress: "5242 Elbetee Lane", addressLocality: "Alexandria", addressRegion: "VA", postalCode: "22312", addressCountry: "US" });
  });
});
