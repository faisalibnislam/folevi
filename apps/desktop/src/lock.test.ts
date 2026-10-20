import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { AppLock, UNLOCK_URL, coverHtml, electronCover, type CoverView, type CoverWindow } from "./lock";

function setup(o: { touchID?: boolean; file?: string; prompt?: () => Promise<void> } = {}) {
  const file = o.file ?? join(mkdtempSync(join(tmpdir(), "folevi-lock-")), "lock.json");
  let now = 1_000_000;
  const cover = { show: vi.fn(), hide: vi.fn() };
  const prompt = vi.fn(o.prompt ?? (async () => undefined));
  const lock = new AppLock({ file, canPrompt: () => o.touchID ?? true, prompt, cover, now: () => now });
  return { lock, cover, prompt, file, tick: (ms: number) => (now += ms) };
}

describe("AppLock", () => {
  test("off by default; turning it on asks for Touch ID and is kept", async () => {
    const { lock, prompt, file, cover } = setup();
    expect(lock.getSettings()).toEqual({ lock: false, lockAfter: 0, method: "touchID" });
    expect(await lock.setSettings({ lock: true, lockAfter: 300 })).toEqual({ lock: true, lockAfter: 300, method: "touchID" });
    expect(prompt).toHaveBeenCalledWith("turn on the Touch ID lock");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ lock: true, lockAfter: 300 });
    expect(cover.show).not.toHaveBeenCalled();
    // The next launch opens covered.
    const again = setup({ file });
    expect(again.lock.locked).toBe(true);
    expect(again.cover.show).toHaveBeenCalled();
  });

  test("a cancelled Touch ID leaves it as it was", async () => {
    const { lock } = setup({ prompt: () => Promise.reject(new Error("cancel")) });
    await expect(lock.setSettings({ lock: true })).rejects.toMatchObject({ code: "cancelled" });
    expect(lock.getSettings().lock).toBe(false);
  });

  test("a Mac without Touch ID can't turn it on, and an old setting doesn't shut anyone out", async () => {
    const dir = mkdtempSync(join(tmpdir(), "folevi-lock-"));
    const file = join(dir, "lock.json");
    writeFileSync(file, JSON.stringify({ lock: true, lockAfter: 60 }));
    const { lock, cover } = setup({ touchID: false, file });
    expect(lock.locked).toBe(false);
    expect(cover.show).not.toHaveBeenCalled();
    expect(lock.getSettings()).toMatchObject({ lock: false, method: "none" });
    await expect(lock.setSettings({ lock: false })).rejects.toMatchObject({ code: "unavailable" });
  });

  test("locks after being away longer than the setting, then Touch ID uncovers", async () => {
    const { lock, cover, prompt, tick } = setup();
    await lock.setSettings({ lock: true, lockAfter: 60 });
    prompt.mockClear();
    lock.away();
    tick(30_000);
    lock.back();
    expect(lock.locked).toBe(false);
    lock.away();
    tick(61_000);
    lock.back();
    expect(lock.locked).toBe(true);
    expect(cover.show).toHaveBeenCalledTimes(1);
    expect(prompt).toHaveBeenCalledWith("unlock your notes");
    await vi.waitFor(() => expect(lock.locked).toBe(false));
    expect(cover.hide).toHaveBeenCalledTimes(1);
  });

  test("the Mac locking covers at once; a failed Touch ID stays covered", async () => {
    let allow = false;
    const { lock, cover } = setup({ prompt: async () => (allow ? undefined : Promise.reject(new Error("no"))) });
    allow = true;
    await lock.setSettings({ lock: true });
    allow = false;
    lock.lockNow();
    expect(await lock.unlock()).toBe(false);
    expect(lock.locked).toBe(true);
    allow = true;
    expect(await lock.unlock()).toBe(true);
    expect(cover.hide).toHaveBeenCalled();
  });

  test("odd values are refused or rounded down to a choice", async () => {
    const { lock } = setup();
    await expect(lock.setSettings({ lock: "yes" })).rejects.toMatchObject({ code: "invalid_argument" });
    await expect(lock.setSettings({ lockAfter: -1 })).rejects.toMatchObject({ code: "invalid_argument" });
    expect((await lock.setSettings({ lockAfter: 1000 })).lockAfter).toBe(900);
  });
});

describe("the cover", () => {
  function fakeWindow(): CoverWindow & { views: unknown[] } {
    const views: unknown[] = [];
    return {
      views,
      isDestroyed: () => false,
      getContentBounds: () => ({ width: 800, height: 600 }),
      on: () => undefined,
      removeListener: () => undefined,
      contentView: { addChildView: (v) => views.push(v), removeChildView: (v) => views.splice(views.indexOf(v), 1) },
      webContents: { focus: () => undefined },
    };
  }
  function fakeView(): CoverView & { navigate(url: string): boolean; loaded: string } {
    let nav: ((e: { preventDefault(): void }, url: string) => void) | null = null;
    const v = {
      loaded: "",
      setBounds: vi.fn(),
      webContents: {
        loadURL: async (url: string) => void (v.loaded = url),
        on: (_: "will-navigate", l: (e: { preventDefault(): void }, url: string) => void) => (nav = l),
        setWindowOpenHandler: () => undefined,
        focus: () => undefined,
        close: vi.fn(),
      },
      navigate(url: string) {
        let prevented = false;
        nav?.({ preventDefault: () => (prevented = true) }, url);
        return prevented;
      },
    };
    return v;
  }

  test("covers every window, and windows opened while it's up; Unlock is a cancelled navigation", () => {
    const a = fakeWindow();
    const b = fakeWindow();
    const made: ReturnType<typeof fakeView>[] = [];
    const onUnlock = vi.fn();
    const cover = electronCover({ windows: () => [a], makeView: () => (made.push(fakeView()), made[made.length - 1]!), onUnlock });
    cover.attach(b);
    expect(b.views).toHaveLength(0);
    cover.show();
    expect(a.views).toHaveLength(1);
    cover.attach(b);
    expect(b.views).toHaveLength(1);
    expect(made[0]!.setBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 800, height: 600 });
    expect(decodeURIComponent(made[0]!.loaded)).toContain("Folevi is locked");
    expect(made[0]!.navigate("https://example.com/")).toBe(true);
    expect(onUnlock).not.toHaveBeenCalled();
    expect(made[0]!.navigate(UNLOCK_URL)).toBe(true);
    expect(onUnlock).toHaveBeenCalledTimes(1);
    cover.hide();
    expect(a.views).toHaveLength(0);
    expect(b.views).toHaveLength(0);
  });

  test("its page runs nothing and loads nothing", () => {
    const html = coverHtml();
    expect(html).toContain("default-src 'none'");
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain("\u2014");
  });
});
