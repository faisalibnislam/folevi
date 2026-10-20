"use client";

// Tools that fold into a More menu when a bar is too narrow for them (a phone, a narrow card, full canvas
// with the Mac's window buttons beside it), so a toolbar never scrolls sideways and nothing is out of reach.
// The bar is measured (ResizeObserver on the bar, its container and every tool) and the tools that don't fit
// go into a More button at the end of the tools, least important first: each tool says how it reads as rows
// of that menu. Used by CanvasCard's toolbar and by the blocks' own floating bars. Styles: canvas.css.
import { Ellipsis } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { MenuButton, type MenuEntry } from "@/components/ui/Menu";

export interface FoldTool {
  /** Stable and unique within the bar. */
  key: string;
  /** The tool as it shows in the bar. */
  node: ReactNode;
  /** The tool as rows of the More menu once it doesn't fit (a heading and items for a tool with its own menu).
   *  Leave it out for a tool that always stays in the bar. */
  menu?: MenuEntry[];
  /** Tools with a higher priority stay longest; among equals, the last folds first. Default 0. */
  priority?: number;
  /** A divider before the tool (it folds with the tool, and isn't shown with nothing before it). */
  sep?: boolean;
}

interface FoldState {
  folded: string[];
  squeezed: boolean;
}

const GUESS = 32;

/**
 * Which tools fit. The bar is the toolbar (a flex row) the More button sits in (`anchor`, always rendered);
 * its other children (a title, Export…) stay as they are and are counted. The room is the bar's container less `--fold-inset` (20px: 10px a side), or, for a bar
 * centred on a point (`centred`), what fits on both sides of that point. `squeeze` is a part of the bar
 * (the block's name) that is hidden, for screen readers only, before any tool folds.
 */
function useToolFold(anchor: RefObject<HTMLElement | null>, tools: FoldTool[], squeeze: RefObject<HTMLElement | null> | undefined, centred: boolean, at: unknown): FoldState {
  const [state, setState] = useState<FoldState>({ folded: [], squeezed: false });
  const widths = useRef(new Map<string, number>());
  const squeezeWidth = useRef(0);
  const moreWidth = useRef(0);
  const sepWidth = useRef(0);
  const toolsRef = useRef(tools);
  toolsRef.current = tools;
  const stateRef = useRef(state);
  stateRef.current = state;
  const keys = tools.map((t) => `${t.key}:${t.menu?.length ? 1 : 0}:${t.priority ?? 0}`).join(",");

  const measure = useRef(() => {});
  measure.current = () => {
    const el = anchor.current?.parentElement;
    const box = el?.parentElement;
    if (!el || !box) return;
    const cs = getComputedStyle(el);
    const inset = parseFloat(cs.getPropertyValue("--fold-inset"));
    const pad = Number.isFinite(inset) ? inset : 20;
    let max = box.clientWidth - pad;
    if (centred) max = Math.min(max, 2 * Math.min(el.offsetLeft, box.clientWidth - el.offsetLeft) - pad);
    // Not laid out (a closed sheet, a hidden tab): nothing to decide yet.
    if (!box.clientWidth || max <= 0) return;
    const gap = parseFloat(cs.columnGap) || 0;
    // Widths in the layout's own pixels (a scaled page would otherwise skew them against clientWidth).
    const scale = el.offsetWidth ? el.getBoundingClientRect().width / el.offsetWidth || 1 : 1;
    const widthOf = (x: Element) => x.getBoundingClientRect().width / scale;
    let fixed = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0) + (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0);
    let count = 0;
    const sq = squeeze?.current;
    const direct = sq?.parentElement === el;
    for (const child of Array.from(el.children) as HTMLElement[]) {
      if (child === sq) continue;
      if (child.dataset.foldKey !== undefined) {
        if (!child.hidden) {
          // A tool's own width, without its divider (that depends on what's shown before it).
          let w = widthOf(child);
          const sep = child.firstElementChild instanceof HTMLElement && child.firstElementChild.classList.contains("fb-vc-sep") ? child.firstElementChild : null;
          if (sep) {
            const scs = getComputedStyle(sep);
            sepWidth.current = widthOf(sep) + (parseFloat(scs.marginLeft) || 0) + (parseFloat(scs.marginRight) || 0) + (parseFloat(getComputedStyle(child).columnGap) || 0);
            w -= sepWidth.current;
          }
          if (w > 0) widths.current.set(child.dataset.foldKey, w);
        }
        continue;
      }
      const ccs = getComputedStyle(child);
      if (child.dataset.foldMore !== undefined) {
        if (ccs.display !== "none") moreWidth.current = widthOf(child) || moreWidth.current;
        continue;
      }
      if (ccs.display === "none" || ccs.position === "absolute" || ccs.position === "fixed") continue;
      const margins = (parseFloat(ccs.marginLeft) || 0) + (parseFloat(ccs.marginRight) || 0);
      // A spacer that grows counts at its smallest.
      fixed += (child.dataset.foldGrow !== undefined ? parseFloat(ccs.minWidth) || 0 : widthOf(child)) + margins;
      count++;
    }
    // The squeezable part: what showing it takes (itself and a gap). Inside another child (the block's name in
    // its title) that child was measured with it, unless it's squeezed now.
    if (!sq) squeezeWidth.current = 0;
    else if (!stateRef.current.squeezed) {
      const w = widthOf(sq);
      if (w > 0) {
        const scs = getComputedStyle(sq);
        squeezeWidth.current = direct ? w + (parseFloat(scs.marginLeft) || 0) + (parseFloat(scs.marginRight) || 0) + gap : w + (parseFloat(getComputedStyle(sq.parentElement ?? sq).columnGap) || 0);
      }
      if (!direct) fixed -= squeezeWidth.current;
    }
    const list = toolsRef.current;
    const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
    const guess = coarse ? 44 : GUESS;
    const more = moreWidth.current || guess;
    const folded = new Set<string>();
    let squeezed = false;
    const need = () => {
      let w = fixed + (squeezed ? 0 : squeezeWidth.current);
      let n = count;
      let before = false;
      for (const t of list) {
        if (folded.has(t.key)) continue;
        w += (widths.current.get(t.key) ?? guess) + (t.sep && before ? sepWidth.current || 11 : 0);
        before = true;
        n++;
      }
      if (folded.size) {
        w += more;
        n++;
      }
      return w + gap * Math.max(0, n - 1);
    };
    // Half a pixel of slack for rounding.
    const fits = () => need() <= max + 0.5;
    if (!fits() && squeezeWidth.current) squeezed = true;
    const order = list
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => t.menu?.length)
      .sort((a, b) => (a.t.priority ?? 0) - (b.t.priority ?? 0) || b.i - a.i);
    for (const { t } of order) {
      if (fits()) break;
      folded.add(t.key);
    }
    // A wide tool that folded can leave room for smaller ones that went before it: bring back what fits,
    // most important first.
    for (let i = order.length - 1; i >= 0; i--) {
      const key = order[i]!.t.key;
      if (!folded.has(key)) continue;
      folded.delete(key);
      if (!fits()) folded.add(key);
    }
    const next = { folded: list.filter((t) => folded.has(t.key)).map((t) => t.key), squeezed };
    const cur = stateRef.current;
    if (next.squeezed !== cur.squeezed || next.folded.join(",") !== cur.folded.join(",")) setState(next);
  };

  // Measure before the first paint and after every fold, and whenever the bar, its box or a tool changes size.
  const foldedKey = state.folded.join(",");
  useLayoutEffect(() => {
    measure.current();
  }, [keys, foldedKey, state.squeezed, at]);
  useLayoutEffect(() => {
    const el = anchor.current?.parentElement;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure.current());
    if (el.parentElement) ro.observe(el.parentElement);
    for (const child of Array.from(el.children)) ro.observe(child);
    if (squeeze?.current) ro.observe(squeeze.current);
    return () => ro.disconnect();
  }, [anchor, squeeze, keys, foldedKey]);

  // The squeezed part keeps being read out; it just takes no room.
  useLayoutEffect(() => {
    squeeze?.current?.toggleAttribute("data-squeezed", state.squeezed);
  }, [squeeze, state.squeezed]);
  return state;
}

/** The tools of a bar, folding into More as needed. Render it directly inside the bar (a flex row). */
export function ToolFold({
  tools,
  squeeze,
  centred = false,
  at,
  label = "More tools",
  side = "bottom",
  triggerClassName = "fb-vc-btn",
}: {
  tools: FoldTool[];
  squeeze?: RefObject<HTMLElement | null>;
  /** The bar is centred on its `left` (a floating selection bar). */
  centred?: boolean;
  /** Changes when the bar moves (its position), so the room is measured again. */
  at?: unknown;
  label?: string;
  side?: "bottom" | "top";
  /** The More button's look (the bar's own button class). */
  triggerClassName?: string;
}) {
  const moreRef = useRef<HTMLSpanElement>(null);
  const { folded } = useToolFold(moreRef, tools, squeeze, centred, at);
  const hidden = new Set(folded);
  const foldedKey = folded.join(",");

  // A tool that folds while it has the keyboard hands it to More, so focus isn't lost in a hidden button.
  useLayoutEffect(() => {
    const active = document.activeElement;
    const el = moreRef.current?.parentElement;
    if (!active || !el?.contains(active)) return;
    const holder = active.closest<HTMLElement>("[data-fold-key]");
    if (holder?.hidden) moreRef.current?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
  }, [foldedKey]);

  const items: MenuEntry[] = [];
  let lastMulti = false;
  for (const t of tools) {
    if (!hidden.has(t.key) || !t.menu?.length) continue;
    const multi = t.menu.length > 1;
    if (items.length && (multi || lastMulti)) items.push("separator");
    items.push(...t.menu);
    lastMulti = multi;
  }

  // A divider shows only with a tool before it in the bar.
  let shown = false;
  return (
    <>
      {tools.map((t) => {
        const folds = hidden.has(t.key);
        const sep = t.sep && shown;
        if (!folds) shown = true;
        return (
          <span key={t.key} className="fb-fold-tool" data-fold-key={t.key} hidden={folds || undefined}>
            {sep ? <span className="fb-vc-sep" aria-hidden /> : null}
            {t.node}
          </span>
        );
      })}
      <span ref={moreRef} className="fb-fold-more" data-fold-more="" hidden={!items.length || undefined}>
        {items.length ? <MenuButton label={label} side={side} triggerClassName={triggerClassName} trigger={<Ellipsis size={15} aria-hidden />} items={items} /> : null}
      </span>
    </>
  );
}
