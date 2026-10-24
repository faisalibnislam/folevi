// Frame by frame: where an iPhone sheet and its parts are on every frame the page draws (a requestAnimationFrame
// probe in the page), and the screen itself as Chromium's screencast sends it (for strips of frames to look at).
// Used by the sheet specs (iphone-ai-sheet, iphone-shell-sheets) to check a sheet comes in from below and never
// jumps, and to save before/after strips when $FOLEVI_SHOTS is set.
import { mkdirSync, writeFileSync } from "node:fs";
import type { Browser, CDPSession, Page } from "@playwright/test";

export interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}
export interface Frame {
  t: number;
  boxes: Record<string, Box | null>;
  /** Visible text length of the last answer (Foli AI), when probed. */
  answer?: number;
  /** How far the sheet's title runs over a header button, in points (0: clear). */
  overlap?: number;
}

/** The probe, installed before the page's scripts: on each frame, the boxes of the selectors in window.__probe. */
export function installFrameProbe() {
  const w = window as unknown as { __probe: Record<string, string>; __frames: Frame[]; __t0: number; __recording: boolean };
  w.__probe = {};
  w.__frames = [];
  w.__t0 = 0;
  w.__recording = false;
  const loop = () => {
    if (w.__recording) {
      const boxes: Record<string, Box | null> = {};
      for (const [name, sel] of Object.entries(w.__probe)) {
        const el = document.querySelector(sel);
        const r = el?.getBoundingClientRect();
        boxes[name] = r && r.height > 0 ? { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) } : null;
      }
      const answers = document.querySelectorAll("[data-iphone-sheet] .fb-ai-answer");
      const last = answers[answers.length - 1];
      // How far the sheet's title runs over any of its header's buttons (0: clear of them).
      let overlap = 0;
      const title = document.querySelector("[data-iphone-sheet] header h2")?.getBoundingClientRect();
      if (title && title.width) {
        for (const b of document.querySelectorAll("[data-iphone-sheet] header button")) {
          const r = b.getBoundingClientRect();
          // (The 32 pt circle drawn in each 44 pt button.)
          const left = r.left + 6;
          const right = r.right - 6;
          overlap = Math.max(overlap, Math.min(title.right, right) - Math.max(title.left, left));
        }
      }
      w.__frames.push({ t: Math.round(performance.now() - w.__t0), boxes, answer: last ? (last.textContent ?? "").trim().length : 0, overlap: Math.max(0, Math.round(overlap)) });
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

export interface Recording {
  frames: Frame[];
  shots: { t: number; data: string }[];
}

/** Records from now until `stop()`: the probe's frames and (Chromium) the screencast, with the CPU slowed `slow` times. */
export async function record(page: Page, probe: Record<string, string>, slow = 4): Promise<{ stop: () => Promise<Recording> }> {
  const chromium = page.context().browser()?.browserType().name() === "chromium";
  let cdp: CDPSession | null = null;
  const shots: { t: number; data: string }[] = [];
  const wall = Date.now();
  if (chromium) {
    cdp = await page.context().newCDPSession(page);
    if (slow > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: slow });
    cdp.on("Page.screencastFrame", (f) => {
      shots.push({ t: Math.round((f.metadata.timestamp ?? 0) * 1000 - wall), data: f.data });
      void cdp!.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => undefined);
    });
    const vp = page.viewportSize() ?? { width: 402, height: 874 };
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 55, maxWidth: vp.width, maxHeight: vp.height, everyNthFrame: 1 });
  }
  await page.evaluate((p) => {
    const w = window as unknown as { __probe: Record<string, string>; __frames: Frame[]; __t0: number; __recording: boolean };
    w.__probe = p;
    w.__frames = [];
    w.__t0 = performance.now();
    w.__recording = true;
  }, probe);
  return {
    stop: async () => {
      const frames = await page.evaluate(() => {
        const w = window as unknown as { __frames: Frame[]; __recording: boolean };
        w.__recording = false;
        return w.__frames;
      });
      if (cdp) {
        await cdp.send("Page.stopScreencast").catch(() => undefined);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 }).catch(() => undefined);
        await cdp.detach().catch(() => undefined);
      }
      return { frames, shots };
    },
  };
}

/** Saves a strip of the recording's screens (up to `max`, evenly spread) as one PNG, labelled with their times. */
export async function saveStrip(browser: Browser, rec: Recording, path: string, max = 16, columns = 8) {
  if (!rec.shots.length) return;
  const step = Math.max(1, Math.ceil(rec.shots.length / max));
  const pick = rec.shots.filter((_, i) => i % step === 0).slice(0, max);
  const cells = pick.map((s) => `<figure><img src="data:image/jpeg;base64,${s.data}"><figcaption>${s.t} ms</figcaption></figure>`).join("");
  const page = await browser.newPage({ viewport: { width: columns * 222, height: 600 } });
  await page.setContent(`<style>body{margin:0;background:#fff;font:600 14px system-ui;display:grid;grid-template-columns:repeat(${columns},1fr);gap:2px}figure{margin:0;position:relative}img{width:100%;display:block;border:1px solid #ddd}figcaption{position:absolute;left:4px;bottom:4px;color:#d22;background:#fffc;padding:1px 4px}</style>${cells}`);
  await page.waitForTimeout(100);
  mkdirSync(path.replace(/\/[^/]+$/, ""), { recursive: true });
  await page.screenshot({ path, fullPage: true });
  await page.close();
}

/** Saves the probe's frames as JSON next to a strip (for reading what moved, frame by frame). */
export function saveFrames(rec: Recording, path: string) {
  mkdirSync(path.replace(/\/[^/]+$/, ""), { recursive: true });
  writeFileSync(path, JSON.stringify(rec.frames));
}

/**
 * Checks a sheet came in from below: every frame it shows, its top is at or below where it ends up, moving up
 * (never above its resting top, never back down past a frame's step), and its first frame is in the lower part
 * of the screen. Returns the problems found (empty when it's right).
 */
export function cameInFromBelow(frames: Frame[], key: string, screenH: number): string[] {
  const shown = frames.filter((f) => f.boxes[key]);
  if (!shown.length) return [`${key} never showed`];
  const rest = shown[shown.length - 1]!.boxes[key]!.top;
  const problems: string[] = [];
  const first = shown[0]!.boxes[key]!.top;
  if (first < screenH * 0.4) problems.push(`first frame's top at ${first} (above 40% of ${screenH})`);
  let prev = Infinity;
  for (const f of shown) {
    const top = f.boxes[key]!.top;
    if (top < rest - 2) problems.push(`at ${f.t} ms the top (${top}) is above its resting place (${rest})`);
    if (top > prev + 2) problems.push(`at ${f.t} ms it moved back down (${prev} to ${top})`);
    prev = top;
  }
  return problems;
}

/** The largest move of a box's top between two frames (what a jump would show as). */
export function largestStep(frames: Frame[], key: string): number {
  let worst = 0;
  let prev: number | null = null;
  for (const f of frames) {
    const b = f.boxes[key];
    if (!b) {
      prev = null;
      continue;
    }
    if (prev !== null) worst = Math.max(worst, Math.abs(b.top - prev));
    prev = b.top;
  }
  return worst;
}

/** Frames where a box's edge turned back (moved one way, then the other by more than `slack`): a jump shows as one. */
export function turnsBack(frames: Frame[], key: string, edge: "top" | "bottom" = "top", slack = 2): number[] {
  const at: number[] = [];
  let dir = 0;
  let prev: number | null = null;
  for (const f of frames) {
    const v = f.boxes[key]?.[edge];
    if (v === undefined) {
      prev = null;
      dir = 0;
      continue;
    }
    if (prev !== null && Math.abs(v - prev) > slack) {
      const d = Math.sign(v - prev);
      if (dir && d !== dir) at.push(f.t);
      dir = d;
    }
    if (prev === null || Math.abs(v - prev) > slack) prev = v;
  }
  return at;
}
