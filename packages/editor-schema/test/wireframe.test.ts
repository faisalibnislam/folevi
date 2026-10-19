// The wireframe block's parts and options (src/wireframe.ts), and its layout and drafts (src/wireframeLayout.ts):
// what Foli AI returns and what a ```wireframe fence in Markdown becomes.
import { describe, expect, it } from "vitest";
import {
  WIREFRAME_COMPONENTS,
  WIREFRAME_FRAME_SIZE,
  WIREFRAME_OPTIONS,
  blocksToMarkdown,
  markdownToBlocks,
  normalizeWireframe,
  parseWireframe,
  serializeWireframe,
  validateWireBlock,
  wireframeDataIssue,
  wireframeFromDraft,
  wireframeFromFence,
  wireframeKind,
  wireframeNextSpot,
  wireframePartSize,
  type WireBlock,
} from "../src";

const screen = { id: "s1", name: "Sign in", frame: "phone", x: 0, y: 0, w: 390, h: 844 };
const wf = (items: Record<string, unknown>[]) => JSON.stringify({ v: 1, screens: [screen], items });
const item = (extra: Record<string, unknown>) => ({ id: "i1", screen: "s1", kind: "button", x: 16, y: 16, w: 120, h: 48, ...extra });

describe("wireframe parts and their options", () => {
  it("every part in the library has a label, a size, and only the options it uses", () => {
    expect(WIREFRAME_COMPONENTS).toContain("paragraph");
    for (const kind of WIREFRAME_COMPONENTS) {
      const size = wireframePartSize(kind, screen);
      expect(size.w).toBeGreaterThanOrEqual(4);
      expect(size.w).toBeLessThanOrEqual(390);
      expect(wireframeDataIssue(wf([item({ kind, ...size })]))).toBeNull();
    }
  });

  it("the server takes valid options and refuses wrong ones", () => {
    expect(wireframeDataIssue(wf([item({ variant: "secondary" })]))).toBeNull();
    expect(wireframeDataIssue(wf([item({ kind: "checkbox", checked: true })]))).toBeNull();
    expect(wireframeDataIssue(wf([item({ kind: "slider", value: 30 })]))).toBeNull();
    expect(wireframeDataIssue(wf([item({ kind: "table", count: 6, cols: 4 })]))).toBeNull();
    expect(wireframeDataIssue(wf([item({ variant: "loud" })]))).toMatch(/invalid variant/);
    expect(wireframeDataIssue(wf([item({ kind: "checkbox", checked: "yes" })]))).toMatch(/invalid checked/);
    expect(wireframeDataIssue(wf([item({ kind: "progress", value: 101 })]))).toMatch(/invalid value/);
    expect(wireframeDataIssue(wf([item({ kind: "tabs", count: 0 })]))).toMatch(/invalid count/);
    expect(wireframeDataIssue(wf([item({ kind: "tabs", count: 2.5 })]))).toMatch(/invalid count/);
    expect(wireframeDataIssue(wf([item({ kind: "table", cols: 13 })]))).toMatch(/invalid cols/);
    // An option the part doesn't use is refused, like any other stray field.
    expect(wireframeDataIssue(wf([item({ checked: true })]))).toMatch(/unexpected field checked/);
    expect(wireframeDataIssue(wf([item({ kind: "image", count: 3 })]))).toMatch(/unexpected field count/);
  });

  it("the reader keeps what a part uses, clamps it, and drops the rest; defaults aren't written", () => {
    const read = normalizeWireframe(JSON.parse(wf([item({ variant: "secondary", checked: true }), item({ id: "i2", kind: "slider", value: 250, count: 3 }), item({ id: "i3", kind: "table", count: 99.4, cols: "4" })])));
    expect(read.items[0]).toMatchObject({ variant: "secondary" });
    expect(read.items[0]!.checked).toBeUndefined();
    expect(read.items[1]).toMatchObject({ value: 100 });
    expect(read.items[1]!.count).toBeUndefined();
    expect(read.items[2]).toMatchObject({ count: 50 });
    expect(read.items[2]!.cols).toBeUndefined();
    const out = serializeWireframe(normalizeWireframe(JSON.parse(wf([item({ variant: "primary" }), item({ id: "i2", kind: "toggle", checked: false }), item({ id: "i3", kind: "toggle", checked: true })]))));
    expect(out).not.toContain("primary");
    expect(out).not.toContain('"checked":false');
    expect(out).toContain('"checked":true');
    expect(wireframeDataIssue(out)).toBeNull();
    expect(serializeWireframe(parseWireframe(out))).toBe(out);
    for (const [kind, options] of Object.entries(WIREFRAME_OPTIONS)) {
      expect(WIREFRAME_COMPONENTS).toContain(kind);
      expect(options!.length).toBeGreaterThan(0);
    }
  });

  it("text exports say which parts are on and list every label", () => {
    const data = wf([item({ kind: "checkbox", text: "Remember me", checked: true, y: 10 }), item({ id: "i2", kind: "tabs", text: "Home\nSearch\nProfile", y: 80 })]);
    const md = blocksToMarkdown([{ id: "B", parentId: null, rank: "a", type: "wireframe", text: [], props: { data, height: 520 } } as unknown as WireBlock]);
    expect(md).toContain("- Checkbox: Remember me (on)");
    expect(md).toContain("- Tabs: Home, Search, Profile");
  });
});

describe("wireframe layout", () => {
  it("new parts stack under the last one, inside the margins and clear of the status bar", () => {
    const s = { ...screen, frame: "phone" as const };
    const size = wireframePartSize("input", s);
    expect(size).toEqual({ w: 358, h: 48 });
    const first = wireframeNextSpot(s, [], size, "input");
    expect(first).toEqual({ x: 16, y: 60 });
    const placed = [{ id: "a", screen: "s1", kind: "input" as const, ...first, ...size, text: "" }];
    expect(wireframeNextSpot(s, placed, size, "input")).toEqual({ x: 16, y: 60 + 48 + 12 });
    // A nav bar runs edge to edge under the status bar; a modal is centred.
    expect(wireframeNextSpot(s, placed, wireframePartSize("navBar", s), "navBar")).toEqual({ x: 0, y: 44 });
    const modal = wireframePartSize("modal", s);
    expect(wireframeNextSpot(s, placed, modal, "modal").x).toBe((390 - modal.w) / 2);
    // Wide screens cap full-width parts.
    expect(wireframePartSize("button", { w: 1280, h: 800 }).w).toBe(280);
  });

  it("loose names map to library parts", () => {
    expect(wireframeKind("Text field")).toBe("input");
    expect(wireframeKind("switch")).toBe("toggle");
    expect(wireframeKind("datepicker")).toBe("datePicker");
    expect(wireframeKind("NAV_BAR")).toBe("navBar");
    expect(wireframeKind("rocket")).toBe("text");
  });
});

describe("wireframe drafts", () => {
  const draft = {
    screens: [
      { name: "Sign up", frame: "phone", parts: [{ kind: "heading", text: "Create your account" }, { kind: "text field", text: "Email" }, { kind: "button", text: "Continue with Google", variant: "outline", goesTo: "home" }, { kind: "checkbox", text: "Keep me signed in", checked: "yes" }] },
      { id: "home", name: "Home", frame: "browser", parts: [{ kind: "navBar", text: "Home" }, { kind: "table", items: [["Name", "Status"], ["Ada", "Done"]], x: 24, y: 120 }] },
    ],
    links: [{ from: "Sign up", to: "Home" }, { from: "nowhere", to: "Home" }],
  };

  it("lays screens side by side and parts top to bottom, with links by name or id", () => {
    const out = wireframeFromDraft(draft, { origin: { x: 1000, y: 200 } });
    expect(wireframeDataIssue(serializeWireframe(out))).toBeNull();
    expect(out.screens.map((s) => [s.name, s.frame, s.x, s.y, s.w])).toEqual([
      ["Sign up", "phone", 1000, 200, 390],
      ["Home", "browser", 1000 + 390 + 120, 200, WIREFRAME_FRAME_SIZE.browser.w],
    ]);
    const [heading, email, button, check] = out.items;
    expect([heading!.kind, email!.kind, button!.kind, check!.kind]).toEqual(["heading", "input", "button", "checkbox"]);
    expect(email!.y).toBeGreaterThan(heading!.y + heading!.h - 1);
    expect(button).toMatchObject({ variant: "secondary", text: "Continue with Google" });
    expect(check!.checked).toBe(true);
    const table = out.items.find((i) => i.kind === "table")!;
    expect(table).toMatchObject({ x: 24, y: 120, text: "Name | Status\nAda | Done" });
    expect(out.links.map((l) => [l.from, l.to])).toEqual([
      [button!.id, "home"],
      [out.screens[0]!.id, "home"],
    ]);
  });

  it("reads a stored wireframe as it is, and survives junk", () => {
    const stored = { v: 1, screens: [screen], items: [item({})] };
    expect(wireframeFromDraft(stored).items[0]).toMatchObject({ x: 16, y: 16 });
    expect(wireframeFromDraft(null).screens).toEqual([]);
    expect(wireframeFromDraft({ screens: "x" }).screens).toEqual([]);
    const hostile = wireframeFromDraft({ screens: [{ name: "<b>x</b>\n\nY".repeat(40), frame: "watch", w: 1e9, parts: [{ kind: "button", x: -50, y: 99999, w: 1e6, text: "\u0000Go" }, 42, null] }] });
    expect(hostile.screens[0]!.frame).toBe("phone");
    expect(hostile.screens[0]!.w).toBe(4000);
    expect(hostile.screens[0]!.name).not.toContain("\n");
    expect(hostile.items).toHaveLength(1);
    expect(hostile.items[0]!.text).toBe("Go");
    expect(wireframeDataIssue(serializeWireframe(hostile))).toBeNull();
  });

  it("a ```wireframe fence in Markdown becomes a wireframe block; anything else stays code", () => {
    const md = ["Here's the flow:", "", "```wireframe", JSON.stringify(draft), "```", "", "```wireframe", "not json", "```"].join("\n");
    const { blocks } = markdownToBlocks(md, { titleFromHeading: false });
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "wireframe", "code"]);
    const block = blocks[1]!;
    expect(validateWireBlock(block)).toEqual([]);
    expect(parseWireframe(String(block.props.data)).screens.map((s) => s.name)).toEqual(["Sign up", "Home"]);
    expect(wireframeFromFence('{"screens":[]}')).toBeNull();
  });
});
