// The native Mac app's menu bar (apps/mac/Folevi/Chrome/MenuModel.swift) sends its page commands to
// DesktopBridge.tsx by id: the page's list (lib/desktop.ts MAC_MENU_COMMANDS) must be exactly the menus' page
// commands, so no menu item is sent to a page that doesn't know it and nothing is listed that no item sends.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAC_MENU_COMMANDS } from "@/lib/desktop";

const model = readFileSync(join(__dirname, "../../mac/Folevi/Chrome/MenuModel.swift"), "utf8");

describe("the Mac menu bar's page commands", () => {
  it("are the ones the page knows", () => {
    const native = new Set<string>();
    for (const m of model.matchAll(/page\("([a-z0-9.-]+)"/g)) native.add(m[1]!);
    // Go > Go to Tab: Tab 1 to 9, made in a loop.
    expect(model).toContain('page("go.tab-\\(n)"');
    native.delete("go.tab-\\(n)");
    for (let n = 1; n <= 9; n++) native.add(`go.tab-${n}`);
    expect([...native].sort()).toEqual([...new Set(MAC_MENU_COMMANDS)].sort());
  });

  it("lists each once", () => {
    expect(new Set(MAC_MENU_COMMANDS).size).toBe(MAC_MENU_COMMANDS.length);
  });
});
