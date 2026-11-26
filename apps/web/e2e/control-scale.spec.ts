// The control scale in the browser (docs/DESIGN_SYSTEM.md, Controls; the owner, 2026-11-26: "use consistent
// rules/size/space for all UI elements"). Every screen's toolbars ([data-toolbar], ListPageHeader's title row) are
// measured: each control (field, dropdown, button, icon button, segmented track) is the control height (36, the
// All notes toolbar's), corners on the scale (10 for a control, 6 for a segment), one edge (1px of --color-line,
// inside the box) on every edged control, one weight per role (550 labels, 400 values), one icon size and stroke.
// Then a dialog's footer (New folder) the same way, and nothing clickable under the Mac's window buttons or
// Windows' caption buttons. In the web look, the Mac look (data-desktop="mac") and the Windows look
// (data-desktop="windows" with --win-caption-inset), light and dark, in Chromium (project "local") and WebKit
// ("mac-webkit"). Local mode, headless, against the shell dev server:
//   E2E_LOCAL_BASE_URL=http://localhost:3003 E2E_NO_SERVER=1 \
//     npx playwright test e2e/control-scale.spec.ts --project local --project mac-webkit
// With CONTROL_SCALE_SHOTS set to a folder, each screen is also saved there.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/localShell";

const SHOTS = process.env.CONTROL_SCALE_SHOTS;

/** The screens with a toolbar, and what proves the toolbar is drawn. */
const SCREENS: { path: string; name: string; ready: string }[] = [
  { path: "/notes", name: "all-notes", ready: "[data-toolbar] input[placeholder='Filter notes']" },
  { path: "/folders", name: "folders", ready: "[data-toolbar] input[placeholder='Filter folders']" },
  { path: "/drafts", name: "drafts", ready: "[data-toolbar] .ui-seg" },
  { path: "/templates", name: "templates", ready: "[data-toolbar] .ui-btn-primary" },
  { path: "/tags", name: "tags", ready: "[data-toolbar] input" },
  { path: "/tasks", name: "tasks", ready: "[data-toolbar] .ui-btn-primary" },
  { path: "/calendar", name: "calendar", ready: "[data-toolbar] .ui-seg" },
];

type Look = "web" | "mac" | "windows";
const LOOKS: Look[] = ["web", "mac", "windows"];
/** Folevi for Windows' caption buttons: three 46 px buttons, 40 px tall, in the top right (apps/desktop host.js). */
const CAPTION = { width: 46 * 3, height: 40 };
/** The Mac's window buttons in the top left (the sidebar's top bar keeps .ui-traffic-space, 60 px, for them). */
const TRAFFIC = { width: 76, height: 36 };

async function setLook(page: Page, look: Look, scheme: "light" | "dark") {
  await page.emulateMedia({ colorScheme: scheme });
  await page.evaluate(
    ([l, s, inset]) => {
      const root = document.documentElement;
      root.setAttribute("data-theme", s);
      if (l === "web") {
        root.removeAttribute("data-desktop");
        root.style.removeProperty("--win-caption-inset");
      } else {
        root.setAttribute("data-desktop", l);
        if (l === "windows") root.style.setProperty("--win-caption-inset", `${inset}px`);
        else root.style.removeProperty("--win-caption-inset");
      }
    },
    [look, scheme, CAPTION.width - 2] as const,
  );
  await page.waitForTimeout(250);
}

interface Measured {
  what: string;
  kind: "field" | "button" | "edged-button" | "quiet-button" | "segmented" | "segment";
  height: number;
  radius: string;
  edge: string | null;
  weight: string;
  icons: { size: number; stroke: string; chevron: boolean }[];
}

/** Every control in the page's toolbars, measured. */
async function measureToolbars(page: Page, root = "[data-toolbar]"): Promise<{ line: string; controls: Measured[] }> {
  return await page.evaluate((rootSel) => {
    const probe = document.createElement("div");
    probe.style.cssText = "position:absolute;visibility:hidden;color:var(--color-line)";
    document.body.append(probe);
    const line = getComputedStyle(probe).color;
    probe.remove();
    const visible = (e: Element) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden";
    };
    /** The control's edge: a border, or a 1px ring drawn inside its box (inset 0 0 0 1px <colour>). */
    const edgeOf = (e: Element) => {
      const s = getComputedStyle(e);
      if (parseFloat(s.borderTopWidth) > 0) return `border ${s.borderTopWidth} ${s.borderTopColor}`;
      const shadow = s.boxShadow;
      if (!shadow || shadow === "none") return null;
      // Split the layers on top-level commas.
      const layers: string[] = [];
      let depth = 0;
      let cur = "";
      for (const ch of shadow) {
        if (ch === "(") depth++;
        if (ch === ")") depth--;
        if (ch === "," && !depth) {
          layers.push(cur.trim());
          cur = "";
        } else cur += ch;
      }
      layers.push(cur.trim());
      for (const layer of layers) {
        const color = layer.match(/(rgba?|oklab|oklch|color)\([^)]*\)/)?.[0] ?? "";
        const rest = layer.replace(color, "").trim();
        if (/^(inset )?0px 0px 0px 1px( inset)?$/.test(rest)) return `${/inset/.test(rest) ? "inset" : "outset"} 1px ${color}`;
      }
      return null;
    };
    const out: Measured[] = [];
    for (const bar of document.querySelectorAll(rootSel)) {
      if (!visible(bar)) continue;
      const controls = [...bar.querySelectorAll<HTMLElement>(".ui-btn, .ui-input, .ui-seg, [role='combobox']")].filter(
        (e) => visible(e) && !e.parentElement?.closest(".ui-btn, .ui-input, [role='combobox']") && !(e.matches("[role='combobox']") && e.closest(".ui-input") !== e && e.closest(".ui-input")),
      );
      for (const c of controls) {
        const s = getComputedStyle(c);
        const what = (c.getAttribute("aria-label") ?? c.getAttribute("placeholder") ?? c.textContent ?? "").trim().slice(0, 30) || c.className.toString().slice(0, 30);
        const icons = [...c.querySelectorAll<SVGElement>(":scope svg.lucide")].filter(visible).map((i) => ({
          size: Math.round(i.getBoundingClientRect().width),
          stroke: getComputedStyle(i).strokeWidth,
          // A dropdown's chevron (down, up), not an arrow that is the button's whole meaning (‹ ›).
          chevron: /lucide-chevron(s-up-down|-down|-up)\b/.test(i.getAttribute("class") ?? ""),
        }));
        if (c.matches(".ui-seg")) {
          out.push({ what, kind: "segmented", height: c.getBoundingClientRect().height, radius: s.borderTopLeftRadius, edge: edgeOf(c), weight: s.fontWeight, icons: [] });
          for (const seg of [...c.children].filter(visible) as HTMLElement[]) {
            const ss = getComputedStyle(seg);
            const segIcons = [...seg.querySelectorAll<SVGElement>("svg.lucide")].filter(visible).map((i) => ({ size: Math.round(i.getBoundingClientRect().width), stroke: getComputedStyle(i).strokeWidth, chevron: false }));
            const label = (seg.getAttribute("aria-label") ?? seg.textContent ?? "").trim().slice(0, 30);
            out.push({ what: `${what} › ${label}`, kind: "segment", height: seg.getBoundingClientRect().height, radius: ss.borderTopLeftRadius, edge: null, weight: ss.fontWeight, icons: segIcons });
          }
          continue;
        }
        const field = c.matches(".ui-input, input, [role='combobox']");
        const quiet = c.matches(".ui-btn-quiet, .ui-btn-ghost, .ui-btn-primary, .ui-btn-danger") || (c.matches(".ui-btn") && !c.matches(".ui-btn-secondary"));
        out.push({
          what,
          kind: field ? "field" : quiet ? "quiet-button" : "edged-button",
          height: c.getBoundingClientRect().height,
          radius: s.borderTopLeftRadius,
          // A field being typed in draws the focus ring instead of its edge.
          edge: c.matches(":focus, :focus-within") ? "focused" : edgeOf(c),
          weight: s.fontWeight,
          icons,
        });
      }
    }
    return { line, controls: out };
  }, root);
}

/** What's off the scale in one set of measurements, each a line naming the control. */
function offScale({ line, controls }: { line: string; controls: Measured[] }, height = 36, compact = 28): string[] {
  const bad: string[] = [];
  const edges = new Set<string>();
  for (const c of controls) {
    const at = `${c.kind} "${c.what}"`;
    const h = Math.round(c.height * 2) / 2;
    if (c.kind === "segment") {
      if (h !== compact) bad.push(`${at}: ${h}px tall, not ${compact}`);
      if (c.radius !== "6px") bad.push(`${at}: corner ${c.radius}, not 6px`);
      if (c.weight !== "550") bad.push(`${at}: weight ${c.weight}, not 550`);
    } else {
      // A segmented track that wraps to a second row (Tasks' views) is a whole number of rows of segments.
      if (h !== height && !(c.kind === "segmented" && (h - 8) % (compact + 4) <= 4 && h > height)) bad.push(`${at}: ${h}px tall, not ${height}`);
      if (c.radius !== "10px") bad.push(`${at}: corner ${c.radius}, not 10px`);
      if (c.kind === "field" && c.weight !== "400") bad.push(`${at}: weight ${c.weight}, not 400`);
      if ((c.kind === "edged-button" || c.kind === "quiet-button") && c.weight !== "550") bad.push(`${at}: weight ${c.weight}, not 550`);
      if ((c.kind === "field" || c.kind === "edged-button" || c.kind === "segmented") && c.edge !== "focused") {
        if (!c.edge) bad.push(`${at}: no edge`);
        else {
          edges.add(c.edge);
          if (!c.edge.startsWith("inset 1px")) bad.push(`${at}: edge ${c.edge}, not a 1px line inside the box`);
          else if (!c.edge.endsWith(line)) bad.push(`${at}: edge colour ${c.edge}, not --color-line (${line})`);
        }
      }
    }
    for (const i of c.icons) {
      const want = i.chevron || (c.kind !== "segment" && h === compact) ? 14 : 16;
      if (i.size !== want) bad.push(`${at}: a ${i.size}px icon, not ${want}`);
      if (i.stroke !== "1.5px") bad.push(`${at}: icon stroke ${i.stroke}, not 1.5px`);
    }
  }
  if (edges.size > 1) bad.push(`more than one edge: ${[...edges].join(" | ")}`);
  return bad;
}

/** Clickable things under the Mac's window buttons or Windows' caption buttons. */
async function underWindowButtons(page: Page, look: Look): Promise<string[]> {
  if (look === "web") return [];
  return await page.evaluate(
    ([l, caption, traffic]) => {
      const w = window.innerWidth;
      const zone = l === "windows" ? { left: w - caption.width, top: 0, right: w, bottom: caption.height } : { left: 0, top: 0, right: traffic.width, bottom: traffic.height };
      const hits: string[] = [];
      for (const e of document.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, [role='button'], [role='tab'], [role='combobox']")) {
        const r = e.getBoundingClientRect();
        const s = getComputedStyle(e);
        // (A skip link is a 1px box until it's focused.)
        if (r.width <= 1 || r.height <= 1 || s.visibility === "hidden" || s.pointerEvents === "none" || e.closest("[aria-hidden='true'], .sr-only, [inert]")) continue;
        if (!(r.right > zone.left && r.left < zone.right && r.bottom > zone.top && r.top < zone.bottom)) continue;
        // Only what a click there reaches (a tab scrolled out of the strip is clipped, not under the buttons).
        const x0 = Math.max(r.left, zone.left), x1 = Math.min(r.right, zone.right), y0 = Math.max(r.top, zone.top), y1 = Math.min(r.bottom, zone.bottom);
        const points = [[(x0 + x1) / 2, (y0 + y1) / 2], [x0 + 1, y0 + 1], [x1 - 1, y1 - 1]];
        if (points.some(([x, y]) => { const top = document.elementFromPoint(x!, y!); return !!top && (top === e || e.contains(top)); })) hits.push(`${e.tagName.toLowerCase()} "${(e.getAttribute("aria-label") ?? e.textContent ?? "").trim().slice(0, 30)}" at ${Math.round(r.left)},${Math.round(r.top)}`);
      }
      return hits;
    },
    [look, CAPTION, TRAFFIC] as const,
  );
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

test.describe("the control scale", { tag: ["@local", "@mac"] }, () => {
  test.beforeEach(({ backendMode }) => {
    test.skip(backendMode !== "local", "local mode only");
  });

  test("every toolbar's controls share one height, corner, edge, weight and icon", async ({ page, browserName }) => {
    test.setTimeout(600_000);
    const problems: string[] = [];
    let measured = 0;
    for (const screen of SCREENS) {
      await page.goto(screen.path);
      await expect(page.locator(screen.ready).first()).toBeVisible({ timeout: 60_000 });
      for (const look of LOOKS) {
        for (const scheme of ["light", "dark"] as const) {
          await setLook(page, look, scheme);
          const m = await measureToolbars(page);
          measured += m.controls.length;
          expect(m.controls.length, `${screen.name}: its toolbar's controls`).toBeGreaterThan(0);
          for (const p of offScale(m)) problems.push(`${screen.name} (${look}, ${scheme}): ${p}`);
          for (const p of await underWindowButtons(page, look)) problems.push(`${screen.name} (${look}, ${scheme}): under the window buttons: ${p}`);
          await shot(page, `${browserName}-${screen.name}-${look}-${scheme}`);
        }
      }
    }
    expect(measured).toBeGreaterThan(SCREENS.length * LOOKS.length * 2 * 3);
    expect(problems).toEqual([]);
  });

  test("a dialog's footer buttons are on the scale", async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto("/folders");
    const newFolder = page.locator("[data-toolbar] .ui-btn-primary", { hasText: "New folder" });
    await expect(newFolder).toBeVisible({ timeout: 60_000 });
    const problems: string[] = [];
    for (const look of LOOKS) {
      for (const scheme of ["light", "dark"] as const) {
        await setLook(page, look, scheme);
        await newFolder.click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        // Measured once the dialog has grown in (its spring scales it).
        await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
        await page.waitForTimeout(200);
        const m = await measureToolbars(page, "dialog[open], [role='dialog']");
        expect(m.controls.length).toBeGreaterThanOrEqual(3);
        for (const p of offScale(m)) problems.push(`New folder dialog (${look}, ${scheme}): ${p}`);
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
      }
    }
    expect(problems).toEqual([]);
  });

  test("touch: the iPhone layout's controls are 44 pt", async ({ browser }, testInfo) => {
    test.setTimeout(240_000);
    const { prepareContext } = await import("./fixtures/localShell");
    const context = await browser.newContext({ viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: testInfo.project.name !== "mac-webkit", deviceScaleFactor: 2 });
    await prepareContext(context, testInfo);
    const page = await context.newPage();
    await page.goto("/notes");
    const filter = page.getByPlaceholder("Filter notes").first();
    await expect(filter).toBeVisible({ timeout: 60_000 });
    const sizes = await page.evaluate(() => {
      const s = getComputedStyle(document.documentElement);
      return { height: s.getPropertyValue("--control-height").trim(), compact: s.getPropertyValue("--control-compact").trim() };
    });
    expect(sizes).toEqual({ height: "44px", compact: "36px" });
    const box = await filter.boundingBox();
    expect(Math.round(box!.height)).toBe(44);
    await context.close();
  });
});
