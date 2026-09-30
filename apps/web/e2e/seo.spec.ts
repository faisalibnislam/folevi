import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// The public site's SEO basics: every page in the sitemap answers 200 with its own title, a canonical URL,
// a meta description and valid structured data; robots.txt keeps the app's /templates out while the
// template gallery stays open; and the new feature, template and docs pages are accessible in light and dark.
// Runs against the marketing host: E2E_SITE_URL, or E2E_BASE_URL with the "app." removed.
const SITE = (process.env.E2E_SITE_URL ?? (process.env.E2E_BASE_URL ?? "http://app.localhost:3000").replace("://app.", "://")).replace(/\/$/, "");

/** A sitemap URL on the host under test (the sitemap names the configured marketing host). */
const onSite = (url: string) => SITE + new URL(url).pathname;

function attr(html: string, pattern: RegExp): string | null {
  return pattern.exec(html)?.[1] ?? null;
}

test("every sitemap URL answers 200 with a unique title, a canonical, a description and valid JSON-LD", async ({ request }) => {
  test.setTimeout(180_000);
  const xml = await (await request.get(`${SITE}/sitemap.xml`)).text();
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);
  const lastmods = [...xml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]!);
  expect(urls.length).toBeGreaterThan(50);
  expect(lastmods).toHaveLength(urls.length);
  for (const path of ["/features", "/features/offline-notes", "/template-gallery", "/template-gallery/meeting-notes", "/docs", "/docs/sync-and-offline", "/compare", "/compare/notion", "/blog", "/blog/how-offline-first-notes-work"]) {
    expect(urls.map((u) => new URL(u).pathname)).toContain(path);
  }
  expect(urls.some((u) => new URL(u).pathname.startsWith("/templates"))).toBe(false);

  const titles = new Map<string, string>();
  const problems: string[] = [];
  for (const url of urls) {
    const res = await request.get(onSite(url));
    const path = new URL(url).pathname;
    if (res.status() !== 200) {
      problems.push(`${path}: status ${res.status()}`);
      continue;
    }
    const html = await res.text();
    const title = attr(html, /<title>([^<]*)<\/title>/);
    const canonical = attr(html, /<link rel="canonical" href="([^"]+)"/);
    const description = attr(html, /<meta name="description" content="([^"]*)"/);
    if (!title) problems.push(`${path}: no title`);
    else if (titles.has(title)) problems.push(`${path}: same title as ${titles.get(title)}`);
    else titles.set(title, path);
    if (!canonical || new URL(canonical).pathname !== path) problems.push(`${path}: canonical ${canonical}`);
    if (!description || description.length < 50) problems.push(`${path}: description "${description}"`);
    if (!/<meta property="og:image" content="[^"]+"/.test(html)) problems.push(`${path}: no og:image`);
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
    if (path !== "/" && path.split("/").length > 2 && !blocks.some((b) => b.includes('"BreadcrumbList"'))) problems.push(`${path}: no BreadcrumbList`);
    for (const block of blocks) {
      try {
        const data = JSON.parse(block) as unknown;
        for (const item of Array.isArray(data) ? data : [data]) {
          const typed = item as { "@context"?: string; "@type"?: string };
          if (typed["@context"] !== "https://schema.org" || !typed["@type"]) problems.push(`${path}: JSON-LD without @context or @type`);
        }
      } catch {
        problems.push(`${path}: invalid JSON-LD`);
      }
    }
    if (html.includes("\u2014")) problems.push(`${path}: contains an em dash`);
  }
  expect(problems).toEqual([]);
});

test("pages with questions carry FAQPage data, and home names a support contact", async ({ request }) => {
  for (const path of ["/pricing", "/support", "/features/ai-notes"]) {
    expect(await (await request.get(`${SITE}${path}`)).text(), path).toContain('"FAQPage"');
  }
  const home = await (await request.get(`${SITE}/`)).text();
  expect(home).toContain('"SoftwareApplication"');
  expect(home).toMatch(/"contactType":"customer support","email":"support@folevi.com"/);
  expect(await (await request.get(`${SITE}/docs/getting-started`)).text()).toContain('"TechArticle"');
});

test("robots.txt keeps /templates disallowed and leaves the new pages open", async ({ request }) => {
  const robots = await (await request.get(`${SITE}/robots.txt`)).text();
  const disallowed = [...robots.matchAll(/^Disallow: (\S+)$/gm)].map((m) => m[1]!);
  // Preview and local builds disallow everything; production lists the app's paths.
  if (disallowed.includes("/")) return;
  expect(disallowed).toContain("/templates");
  for (const path of ["/template-gallery/meeting-notes", "/features/tasks", "/docs/getting-started", "/compare/notion", "/blog", "/blog/rss.xml"]) {
    expect(disallowed.filter((rule) => path.startsWith(rule)), path).toEqual([]);
  }
  expect(robots).toContain("sitemap.xml");
});

test("old /docs anchors forward to their articles", async ({ page }) => {
  await page.goto(`${SITE}/docs#sync`);
  await expect(page).toHaveURL(/\/docs\/sync-and-offline$/);
  await expect(page.getByRole("heading", { level: 1, name: "Sync and offline" })).toBeVisible();
});

const PAGES = [
  { path: "/features/offline-notes", h1: "Offline notes that sync when you’re back online" },
  { path: "/features/flowcharts", h1: "Flowcharts and diagrams inside your notes" },
  { path: "/template-gallery/meeting-notes", h1: "Meeting notes template" },
  { path: "/docs/sync-and-offline", h1: "Sync and offline" },
  { path: "/features", h1: "Everything Folevi does, one page each." },
  { path: "/template-gallery", h1: "Free note templates for Folevi." },
  { path: "/docs", h1: "How Folevi works." },
  // Pages that gained links to the new ones.
  { path: "/", h1: "A quieter place for ideas that keep growing." },
  { path: "/pricing", h1: "Start free. Pay for room, or for AI." },
  // Comparison pages and the blog.
  { path: "/compare", h1: "How Folevi compares." },
  { path: "/compare/notion", h1: "Folevi vs Notion" },
  { path: "/blog", h1: "Notes from the Folevi team." },
  { path: "/blog/how-offline-first-notes-work", h1: "How offline-first notes work in Folevi" },
];

for (const scheme of ["light", "dark"] as const) {
  test(`feature, template and docs pages have an h1 and no serious axe issues (${scheme})`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    // The pages above, then every other feature page (each has its own product picture).
    const xml = await (await page.request.get(`${SITE}/sitemap.xml`)).text();
    const features = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]!).pathname).filter((p) => p.startsWith("/features/") && !PAGES.some((x) => x.path === p));
    for (const { path, h1 } of [...PAGES, ...features.map((path) => ({ path, h1: null }))]) {
      await page.goto(`${SITE}${path}`);
      await expect(page.locator("html")).toHaveAttribute("data-theme", scheme);
      if (h1) await expect(page.getByRole("heading", { level: 1 })).toHaveText(h1);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious.map((v) => `${path}: ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
    }
  });
}

test("the new pages fit a 360 px screen without sideways scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  for (const { path } of PAGES) {
    await page.goto(`${SITE}${path}`);
    const overflow = await page.evaluate(() => {
      const limit = window.innerWidth + 1;
      // An element that sticks out is fine when a scroll or clip container (a table, a picture's frame)
      // inside the page holds it; .mk-root itself clips, so it doesn't count.
      const held = (el: Element) => {
        for (let a = el.parentElement; a && !a.classList.contains("mk-root"); a = a.parentElement) {
          if (getComputedStyle(a).overflowX !== "visible" && a.getBoundingClientRect().right <= limit) return true;
        }
        return false;
      };
      return [...document.querySelectorAll("main *")]
        .filter((el) => el.getBoundingClientRect().right > limit && !held(el))
        .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)}`);
    });
    expect(overflow, path).toEqual([]);
  }
});

test("a template page links to sign-up with the template's key", async ({ page }) => {
  await page.goto(`${SITE}/template-gallery/weekly-reset`);
  const use = page.getByRole("link", { name: "Use this template" }).first();
  await expect(use).toHaveAttribute("href", /\/signup\?template=weekly-reset$/);
  // The preview shows the template's real blocks.
  await expect(page.getByRole("heading", { name: "Look back" })).toBeVisible();
  await expect(page.getByText("Empty the Tasks inbox")).toBeVisible();
});

test("a comparison page has a table with a value per product, sources and FAQ data", async ({ page }) => {
  const html = await (await page.request.get(`${SITE}/compare/notion`)).text();
  expect(html).toContain('"FAQPage"');
  expect(html).toContain('"BreadcrumbList"');
  await page.goto(`${SITE}/compare/notion`);
  const table = page.getByRole("region", { name: "Folevi and Notion compared" }).getByRole("table");
  await expect(table.getByRole("columnheader", { name: "Folevi" })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Notion" })).toBeVisible();
  const rows = table.locator("tbody tr");
  expect(await rows.count()).toBeGreaterThanOrEqual(10);
  // Every row has a plain value in both product columns, and Folevi's platforms are stated plainly.
  for (const row of await rows.all()) {
    for (const cell of await row.getByRole("cell").all()) expect((await cell.innerText()).trim().length).toBeGreaterThan(2);
  }
  await expect(table.getByRole("row", { name: /^Apps/ })).toContainText("No iOS");
  // Sources: official links, each with the day it was checked, and the disclaimer.
  const sources = page.locator("ol li[id^='source-'] a");
  expect(await sources.count()).toBeGreaterThanOrEqual(5);
  for (const href of await sources.evaluateAll((links) => links.map((a) => (a as HTMLAnchorElement).href))) expect(href).toMatch(/^https:\/\/(www\.)?notion\.com\//);
  await expect(page.getByText("may have changed", { exact: false })).toBeVisible();
  await expect(page.getByText("Notion is a trademark of its owner.", { exact: false })).toBeVisible();
});

test("the blog lists posts newest first, each post is a BlogPosting, and the RSS feed lists them", async ({ page }) => {
  const post = await (await page.request.get(`${SITE}/blog/what-an-ai-credit-is`)).text();
  expect(post).toContain('"BlogPosting"');
  expect(post).toContain('"The Folevi team"');
  expect(post).toMatch(/<link rel="canonical" href="[^"]+\/blog\/what-an-ai-credit-is"/);

  const res = await page.request.get(`${SITE}/blog/rss.xml`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("xml");
  const xml = await res.text();
  await page.goto(`${SITE}/blog`);
  const feed = await page.evaluate((text) => {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    if (doc.querySelector("parsererror")) return null;
    return {
      version: doc.documentElement.getAttribute("version"),
      title: doc.querySelector("channel > title")?.textContent,
      items: [...doc.querySelectorAll("item")].map((item) => ({
        link: item.querySelector("link")?.textContent ?? "",
        guid: item.querySelector("guid")?.textContent ?? "",
        pubDate: item.querySelector("pubDate")?.textContent ?? "",
        title: item.querySelector("title")?.textContent ?? "",
      })),
    };
  }, xml);
  expect(feed).not.toBeNull();
  expect(feed!.version).toBe("2.0");
  expect(feed!.items).toHaveLength(5);
  for (const item of feed!.items) {
    expect(item.link).toMatch(/^https?:\/\/[^/]+\/blog\/[a-z0-9-]+$/);
    expect(item.guid).toBe(item.link);
    expect(Number.isNaN(Date.parse(item.pubDate))).toBe(false);
  }
  // The index shows the same posts, and links the feed.
  const titles = await page.locator("main ol h2").allInnerTexts();
  expect(titles).toEqual(feed!.items.map((i) => i.title));
  expect(await page.locator('link[rel="alternate"][type="application/rss+xml"]').getAttribute("href")).toMatch(/\/blog\/rss\.xml$/);
});
