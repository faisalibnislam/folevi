// Spacing sits on the 4 pt grid (packages/design-tokens space; docs/DESIGN_SYSTEM.md "Spacing"): Tailwind's
// steps (p-1 = 4 px … p-24), with 2, 6, 10 and 14 for the insides of small controls. This test fails on
// padding, margins, gaps and offsets set off the grid: arbitrary Tailwind values (p-[7px]), fractional steps
// past 3.5 (p-4.5) and odd px in CSS (padding: 0 9px). Optical nudges of 1 to 3 px (a hairline, an icon
// lined up with a line of text) are fine. The exceptions below follow a measurement, each with its reason.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";

const SRC = join(__dirname, "../src");

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files(path, out);
    else if (/\.(tsx?|css)$/.test(name)) out.push(path);
  }
  return out;
}

/** On the grid: up to 3 px (optical), even up to 14, then multiples of 4. */
export const onGrid = (px: number) => px <= 3 || (Number.isInteger(px) && (px % 4 === 0 || (px % 2 === 0 && px <= 14)));

/** Values off the grid on purpose, by file, with why. */
const MEASURED: Record<string, { values: number[]; why: string }> = {
  // A 44 pt hit target around a 22 pt control: (44 - 22) / 2.
  "components/iphone/TaskSheet.tsx": { values: [11], why: "hit target inset" },
  "components/iphone/Tasks.tsx": { values: [11, 15], why: "hit target inset; a 52 pt row around a 22 pt line" },
  // Apple's grouped list rows: 52 pt for one 22 pt line ((52 - 22) / 2), 44 pt rows with a second line.
  "components/iphone/SettingsKit.tsx": { values: [11, 15], why: "52 pt rows around 22 pt lines" },
  "components/iphone/Grouped.tsx": { values: [15], why: "52 pt rows around a 22 pt line" },
  // The 34 pt send button inside its 44 pt target: (44 - 34) / 2.
  "components/ai/chat/ChatThread.tsx": { values: [5], why: "send button hit target" },
  "components/iphone/Rows.tsx": { values: [5], why: "the chevron's 34 pt button inside the row's 44 pt edge" },
  "components/iphone/Sheet.tsx": { values: [5], why: "the grabber's place under the sheet's top edge" },
  // The row's actions start under its text: the 16 px inset, the avatar (28 / 46) and its gap (6).
  "components/app/NotificationsButton.tsx": { values: [50], why: "aligned with the row's text column" },
  // Pictures of the product on the marketing site, drawn to the real app's measurements.
  "components/marketing/mac/MacMenuBar.tsx": { values: [38, 46], why: "the Mac's menu bar, drawn" },
  "components/marketing/demos/EditDemo.tsx": { values: [5, 7], why: "a picture of the editor" },
  "components/marketing/demos/TitleDemo.tsx": { values: [7], why: "a picture of the editor" },
  "app/(marketing)/template-gallery/[key]/page.tsx": { values: [9], why: "a template's card, drawn" },
  "components/support/SupportForm.tsx": { values: [10000], why: "the honeypot field, off screen" },
};

/** CSS rules that follow a native measurement (AppKit's menus, the iPhone's keyboard bar). */
const CSS_MEASURED: { file: string; selector: RegExp; why: string }[] = [
  { file: "app/globals.css", selector: /data-desktop="mac"/, why: "AppKit's menu metrics (5 pt insets)" },
  { file: "app/globals.css", selector: /data-iphone-keyboard/, why: "the writing bar: 48 pt, 6 above the keyboard, 12 of air" },
  { file: "app/globals.css", selector: /\[data-native="ios"\]\) :is\(\[role="menu"\]/, why: "iOS menu rows: 44 pt around a 22 pt line" },
  { file: "components/editor/flowchart/flowchart-ai.css", selector: /\.fc-check-box/, why: "a 26 px box centred in a 44 px target" },
];

const SPACE = "p|px|py|pt|pb|pl|pr|ps|pe|m|mx|my|mt|mb|ml|mr|ms|me|gap|gap-x|gap-y|space-x|space-y|inset|inset-x|inset-y|top|bottom|left|right|start|end";
const at = (text: string, i: number) => text.slice(0, i).split("\n").length;

function violations(path: string, text: string): string[] {
  const rel = relative(SRC, path);
  const found: string[] = [];
  if (path.endsWith(".css")) {
    let selector = "";
    text.split("\n").forEach((line, i) => {
      if (line.includes("{") && !line.trim().startsWith("@")) selector = line.split("{")[0]!.trim();
      for (const d of line.matchAll(/\b(?:padding|margin|gap|row-gap|column-gap)[a-z-]*:\s*([^;}]+)/g)) {
        for (const n of d[1]!.matchAll(/(-?)\b(\d+(?:\.\d+)?)px/g)) {
          // Negative offsets centre a drawn mark (a dot, a drop line) on its point.
          if (n[1] === "-" || onGrid(Number(n[2]))) continue;
          if (CSS_MEASURED.some((m) => m.file === rel && m.selector.test(selector))) continue;
          if (rel.endsWith("marketing.css") || rel.endsWith("onboarding.css")) continue; // pictures of the app
          found.push(`${rel}:${i + 1} ${selector.slice(0, 50)} ${d[0]}`);
        }
      }
    });
    return found;
  }
  for (const m of text.matchAll(new RegExp(`(?<![\\w-])!?-?(?:${SPACE})-(?:\\[(-?\\d+(?:\\.\\d+)?)px\\]|(\\d+\\.\\d+)(?![\\w.-]))`, "g"))) {
    if (m[1] !== undefined) {
      const px = Math.abs(Number(m[1]));
      if (onGrid(px) || MEASURED[rel]?.values.includes(px)) continue;
    } else if (["0.5", "1.5", "2.5", "3.5"].includes(m[2]!)) continue;
    found.push(`${rel}:${at(text, m.index!)} ${m[0]}`);
  }
  return found;
}

describe("spacing scale", () => {
  test("padding, margins, gaps and offsets sit on the 4 pt grid", () => {
    const all = files(SRC).flatMap((path) => violations(path, readFileSync(path, "utf8")));
    expect(all).toEqual([]);
  });

  test("the scale: Tailwind's steps, so a token and a class say the same thing", async () => {
    const { tokens } = await import("@folevi/design-tokens");
    const { $description: _, ...space } = tokens.space as Record<string, number | string>;
    for (const [step, px] of Object.entries(space)) {
      expect(px).toBe(Number(step) * 4);
      expect(onGrid(px as number)).toBe(true);
    }
    // The iPhone's readable margins (Apple's HIG): 16 pt, 20 on the larger phones.
    expect(tokens.spaceRoles.screenMargin).toEqual({ desktop: 32, ios: 16, iosLarge: 20 });
  });
});
