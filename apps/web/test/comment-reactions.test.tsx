import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { REACTIONS, ReactionChips, ReactionPicker, reactedBy, toggleReaction, type ReactionGroup } from "@/components/doc/CommentReactions";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  // jsdom has no popover API; the picker only needs to render.
  const proto = HTMLElement.prototype as unknown as { showPopover?: () => void; hidePopover?: () => void };
  proto.showPopover ??= () => {};
  proto.hidePopover ??= () => {};
  const matches = Element.prototype.matches;
  Element.prototype.matches = function (this: Element, sel: string) {
    return sel === ":popover-open" ? true : matches.call(this, sel);
  } as typeof Element.prototype.matches;
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;
function render(ui: React.ReactNode) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(ui));
  return host;
}
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

const group = (kind: ReactionGroup["kind"], count: number, mine: boolean, names: string[] = []): ReactionGroup => ({ kind, count, mine, names });

describe("reaction logic", () => {
  test("six plain reactions, each with a word for it", () => {
    expect(REACTIONS.map((r) => r.label)).toEqual(["Agree", "Love it", "Done", "Looking", "Funny", "Idea"]);
  });

  test("who reacted reads naturally", () => {
    expect(reactedBy(group("thumbsUp", 1, true))).toBe("You");
    expect(reactedBy(group("thumbsUp", 2, true, ["Sam"]))).toBe("You and Sam");
    expect(reactedBy(group("thumbsUp", 3, false, ["Ann", "Bo", "Cy"]))).toBe("Ann, Bo and Cy");
    expect(reactedBy(group("thumbsUp", 14, true, ["Ann", "Bo"]))).toBe("You, Ann, Bo and 11 more");
  });

  test("toggling adds, counts up, takes back, and keeps the usual order", () => {
    let r: ReactionGroup[] = [group("idea", 1, false, ["Ann"])];
    r = toggleReaction(r, "thumbsUp");
    expect(r.map((x) => [x.kind, x.count, x.mine])).toEqual([
      ["thumbsUp", 1, true],
      ["idea", 1, false],
    ]);
    r = toggleReaction(r, "idea");
    expect(r.find((x) => x.kind === "idea")).toMatchObject({ count: 2, mine: true });
    r = toggleReaction(r, "thumbsUp");
    expect(r.map((x) => x.kind)).toEqual(["idea"]);
    r = toggleReaction(r, "idea");
    expect(r).toEqual([group("idea", 1, false, ["Ann"])]);
  });
});

describe("ReactionChips", () => {
  test("pressed chips for mine, names on hover, and no buttons for readers", () => {
    const onToggle = vi.fn();
    const el = render(<ReactionChips reactions={[group("thumbsUp", 2, true, ["Sam"]), group("heart", 1, false, ["Ann"])]} canReact onToggle={onToggle} />);
    const agree = el.querySelector<HTMLButtonElement>('button[aria-label="Agree, 2"]')!;
    expect(agree.getAttribute("aria-pressed")).toBe("true");
    expect(agree.title).toBe("Agree: You and Sam");
    expect(el.querySelector('button[aria-label="Love it, 1"]')!.getAttribute("aria-pressed")).toBe("false");
    // Icons only: no emoji characters anywhere.
    expect(el.textContent).toBe("21");
    act(() => agree.click());
    expect(onToggle).toHaveBeenCalledWith("thumbsUp");
  });

  test("readers see the counts without buttons", () => {
    const el = render(<ReactionChips reactions={[group("check", 3, false, ["Ann", "Bo", "Cy"])]} canReact={false} onToggle={() => {}} />);
    expect(el.querySelectorAll("button")).toHaveLength(0);
    expect(el.querySelector('[title="Done: Ann, Bo and Cy"]')).not.toBeNull();
  });
});

describe("ReactionPicker", () => {
  test("arrow keys move between the six reactions; Enter toggles; Escape closes", () => {
    const onToggle = vi.fn();
    const onClose = vi.fn();
    const anchor = createRef<HTMLButtonElement>();
    render(
      <>
        <button ref={anchor}>Add reaction</button>
        <ReactionPicker open anchor={anchor} reactions={[group("heart", 1, true)]} onToggle={onToggle} onClose={onClose} />
      </>,
    );
    const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
    const items = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]')];
    expect(items.map((b) => b.getAttribute("aria-label"))).toEqual(["Agree", "Love it", "Done", "Looking", "Funny", "Idea"]);
    expect(items[1]!.getAttribute("aria-checked")).toBe("true");
    items[0]!.focus();
    act(() => menu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(document.activeElement).toBe(items[1]);
    act(() => menu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
    act(() => menu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
    expect(document.activeElement).toBe(items[5]);
    act(() => menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
    expect(document.activeElement).toBe(items[0]);
    act(() => items[3]!.click());
    expect(onToggle).toHaveBeenCalledWith("eyes");
    act(() => menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(onClose).toHaveBeenCalled();
    expect(document.activeElement).toBe(anchor.current);
  });
});
