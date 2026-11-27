// What shipped through 1.8.79, as the website must say it (owner decisions, 2026-11-27): iOS 26 for the iPhone and
// iPad app, Foli AI on Google, OpenAI and Anthropic, Windows and Linux that update themselves, and feature and docs
// pages for spell check and prediction, self-hosting (Beta) and Apple Notes import.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DOC_ARTICLES } from "@/components/marketing/content/docs";
import { FEATURES } from "@/components/marketing/content/features";
import { FOLEVI_ROWS } from "@/components/marketing/content/compare";
import { IOS_REQUIREMENT } from "@/components/marketing/site";

const SRC = join(__dirname, "../src");
const read = (path: string) => readFileSync(join(SRC, path), "utf8");

describe("the website's copy matches what shipped", () => {
  test("the iPhone and iPad app needs iOS 26", () => {
    expect(IOS_REQUIREMENT).toBe("iOS 26 or iPadOS 26 or later");
    expect(read("components/marketing/seo.tsx")).not.toMatch(/iOS 18|iPadOS 18/);
  });

  test("Privacy, Security and Terms name every AI provider Folevi Cloud can use", () => {
    for (const path of ["app/(marketing)/privacy/page.tsx", "app/(marketing)/security/page.tsx", "app/(marketing)/terms/page.tsx"]) {
      const text = read(path);
      for (const provider of ["Google", "OpenAI", "Anthropic"]) expect(text, `${path} names ${provider}`).toContain(provider);
    }
  });

  test("Windows and Linux are no longer described as not updating themselves", () => {
    for (const path of ["app/(marketing)/apps/page.tsx", "app/(marketing)/downloads/page.tsx"]) {
      expect(read(path)).not.toMatch(/doesn’t update itself yet|aren’t signed yet, and/);
    }
  });

  test.each([
    ["spell-check", "/docs/writing-settings"],
    ["self-hosting", "/docs/your-own-server"],
  ])("the %s feature page exists and its docs article too", (slug, docsHref) => {
    const feature = FEATURES.find((f) => f.slug === slug);
    expect(feature).toBeDefined();
    expect(feature?.docs?.href).toBe(docsHref);
    expect(DOC_ARTICLES.some((a) => `/docs/${a.slug}` === docsHref)).toBe(true);
    expect(read("app/(marketing)/features/page.tsx")).toContain(`slug: "${slug}"`);
  });

  test("self-hosting is marked as beta wherever it is described", () => {
    const feature = FEATURES.find((f) => f.slug === "self-hosting");
    for (const text of [feature?.summary, feature?.intro, feature?.description, FOLEVI_ROWS.platforms.value, FOLEVI_ROWS.files.value]) {
      expect(text?.toLowerCase()).toContain("beta");
    }
  });

  test("Apple Notes import is on the import page, the docs, the comparison and the Mac page", () => {
    const importPage = FEATURES.find((f) => f.slug === "import-and-export");
    expect(importPage?.description).toContain("Apple Notes");
    expect(FOLEVI_ROWS.import.value).toContain("Apple Notes");
    expect(read("components/marketing/content/docs.tsx")).toContain("Apple Notes (Mac app)");
    expect(read("app/(marketing)/mac/page.tsx")).toContain("Apple Notes");
  });
});
